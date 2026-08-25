import { decodeJson, encodeJson, JsonViolation } from "./json.js";
import {
  attributedEffectCall,
  attributedFlowCall,
  cancelMessage,
  effectResultMessage,
  emptyResultMessage,
  errorMessage,
  operationErrorMessage,
  parseEffectResult,
  parseEnvelope,
  parseOperationError,
  parseRunResult,
  parseServiceInvokeParams,
  parseServiceMountParams,
  requestMessage,
  requireLocalName,
  serviceReadyParams,
  type ParsedMessage,
  type ServiceInvokeParams,
  type ServiceMountParams,
} from "./protocol.js";
import { FramingViolation, readFrames, type Transport } from "./transport.js";
import {
  EffectError,
  OperationError,
  OPERATION_ERROR_CODES,
  ServiceError,
  type CallOptions,
  type EffectCall,
  type FlowCall,
  type JsonObject,
  type JsonValue,
  type OperationErrorCode,
  type RunResult,
  type ServiceDefinition,
  type ServiceExportHandler,
  type ServiceInvocationContext,
  type ServiceMountContext,
} from "./types.js";

const MAX_PENDING_REQUESTS = 64;
const MAX_REQUEST_IDS = 65_536;
type WireOperationErrorCode = Exclude<OperationErrorCode, "PROTOCOL_ERROR" | "CHANNEL_LOST">;
const wireCodes = new Set<string>(
  OPERATION_ERROR_CODES.filter((code) => code !== "PROTOCOL_ERROR" && code !== "CHANNEL_LOST"),
);

class PeerProtocolViolation extends Error {}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

interface OwnerBase {
  readonly id: string;
  readonly controller: AbortController;
  readonly outbound: Set<Outbound>;
  phase: "open" | "publishing" | "terminal";
}

interface MountOwner extends OwnerBase {
  readonly kind: "mount";
  readonly params: ServiceMountParams;
  readonly cancelled: Deferred<void>;
  readiness: "not-called" | "pending" | "acknowledged";
  task?: Promise<void>;
}

interface InvocationOwner extends OwnerBase {
  readonly kind: "invocation";
  readonly params: ServiceInvokeParams;
  readonly handler: ServiceExportHandler;
  task?: Promise<void>;
}

type Owner = MountOwner | InvocationOwner;

interface Outbound {
  readonly owner: Owner;
  readonly method: "service/ready" | "flow/call" | "effect/call";
  readonly kind: "ready" | "flow" | "effect";
  readonly params: JsonObject;
  readonly user: Deferred<JsonValue>;
  readonly wire: Deferred<void>;
  readonly signals: readonly AbortSignal[];
  readonly abortListeners: Array<readonly [AbortSignal, () => void]>;
  id?: string;
  state: "queued" | "sent" | "settled";
  userSettled: boolean;
  cancelSent: boolean;
}

export class ServiceSession {
  private readonly completion = deferred<void>();
  private readonly exports: Readonly<Record<string, ServiceExportHandler>>;
  private readonly exportNames: readonly string[];
  private readonly mountHandler: ServiceDefinition["mount"];
  private readonly seenHostIds = new Set<string>();
  private readonly usedProviderIds = new Set<string>();
  private readonly owners = new Map<string, Owner>();
  private readonly pendingById = new Map<string, Outbound>();
  private readonly outbound = new Set<Outbound>();
  private readonly queue: Outbound[] = [];
  private mount: MountOwner | undefined;
  private nextId = 1;
  private sentCount = 0;
  private channel: "open" | "mount-publishing" | "fatal" | "complete" | "failed" = "open";
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly transport: Transport,
    definition: ServiceDefinition,
  ) {
    const snapshot = snapshotDefinition(definition);
    this.exports = snapshot.exports;
    this.exportNames = snapshot.names;
    this.mountHandler = snapshot.mount;
    void this.completion.promise.catch(() => undefined);
  }

  async run(): Promise<void> {
    void this.readLoop();
    return this.completion.promise;
  }

  private async readLoop(): Promise<void> {
    try {
      for await (const frame of readFrames(this.transport.input)) {
        if (this.channel !== "open") return;
        let value: JsonValue;
        try {
          value = decodeJson(frame);
        } catch (error) {
          if (error instanceof JsonViolation && error.reportable) {
            await this.failWithDiagnostic("PROTOCOL_ERROR", message(error), errorMessage(null, -32700, "Parse error"));
          } else {
            this.failChannel("PROTOCOL_ERROR", message(error));
          }
          return;
        }
        let parsed: ParsedMessage;
        try {
          parsed = parseEnvelope(value);
        } catch (error) {
          await this.failWithDiagnostic("PROTOCOL_ERROR", message(error), errorMessage(null, -32600, "Invalid Request"));
          return;
        }
        await this.receive(parsed);
      }
      if (this.channel === "open") this.failChannel("CHANNEL_LOST", "protocol input closed before Service completion");
    } catch (error) {
      if (this.channel !== "open") return;
      const code = error instanceof JsonViolation || error instanceof FramingViolation || error instanceof PeerProtocolViolation
        ? "PROTOCOL_ERROR"
        : "CHANNEL_LOST";
      this.failChannel(code, message(error));
    }
  }

  private async receive(frame: ParsedMessage): Promise<void> {
    switch (frame.kind) {
      case "request":
        await this.receiveRequest(frame.value.id, frame.value.method, frame.value.params);
        return;
      case "notification":
        this.receiveNotification(frame.value.method, frame.value.params);
        return;
      case "success":
        this.receiveSuccess(frame.value.id, frame.value.result);
        return;
      case "error":
        this.receiveError(frame.value.id, frame.value.error);
        return;
    }
  }

  private async receiveRequest(id: string, method: string, params: JsonValue | undefined): Promise<void> {
    if (this.seenHostIds.has(id)) {
      this.failChannel("PROTOCOL_ERROR", `host reused request ID ${id}`);
      return;
    }
    if (this.seenHostIds.size >= MAX_REQUEST_IDS) {
      this.failChannel("PROTOCOL_ERROR", "host exceeded the Service/1 request-ID lifetime limit");
      return;
    }
    this.seenHostIds.add(id);

    if (method === "service/mount") {
      await this.receiveMount(id, params);
      return;
    }
    if (method === "service/invoke") {
      await this.receiveInvocation(id, params);
      return;
    }
    await this.send(errorMessage(id, -32601, "Method not found"));
  }

  private async receiveMount(id: string, params: JsonValue | undefined): Promise<void> {
    if (this.mount !== undefined) {
      await this.failWithDiagnostic(
        "PROTOCOL_ERROR",
        "host sent more than one service/mount",
        errorMessage(id, -32600, "Only one service/mount is allowed"),
      );
      return;
    }
    let parsed: ServiceMountParams;
    try {
      parsed = parseServiceMountParams(params as JsonValue);
    } catch {
      try {
        await this.sendMountTerminal(errorMessage(id, -32602, "Invalid params"));
        await this.complete();
      } catch (error) {
        this.failMountPublication(message(error));
      }
      return;
    }
    const owner: MountOwner = {
      id,
      kind: "mount",
      params: parsed,
      controller: new AbortController(),
      cancelled: deferred<void>(),
      readiness: "not-called",
      outbound: new Set(),
      phase: "open",
    };
    this.mount = owner;
    this.owners.set(id, owner);
    owner.task = this.handleMount(owner);
    void owner.task.catch(() => undefined);
  }

  private async receiveInvocation(id: string, params: JsonValue | undefined): Promise<void> {
    const mount = this.mount;
    if (mount === undefined || mount.phase !== "open" || mount.readiness !== "acknowledged") {
      await this.failWithDiagnostic(
        "PROTOCOL_ERROR",
        "host invoked a Service before acknowledged readiness",
        errorMessage(id, -32600, "Service is not ready"),
      );
      return;
    }
    if (this.owners.size >= MAX_PENDING_REQUESTS) {
      await this.send(operationErrorMessage(id, "RESOURCE_EXHAUSTED", "too many pending Service requests"));
      return;
    }
    let parsed: ServiceInvokeParams;
    try {
      parsed = parseServiceInvokeParams(params as JsonValue);
    } catch {
      await this.send(errorMessage(id, -32602, "Invalid params"));
      return;
    }
    const handler = this.exports[parsed.exportName];
    if (handler === undefined) {
      await this.failWithDiagnostic(
        "PROTOCOL_ERROR",
        `host invoked undeclared export ${parsed.exportName}`,
        errorMessage(id, -32602, "Undeclared Service export"),
      );
      return;
    }
    const owner: InvocationOwner = {
      id,
      kind: "invocation",
      params: parsed,
      handler,
      controller: new AbortController(),
      outbound: new Set(),
      phase: "open",
    };
    this.owners.set(id, owner);
    owner.task = this.handleInvocation(owner);
    void owner.task.catch(() => undefined);
  }

  private receiveNotification(method: string, params: JsonValue | undefined): void {
    if (method !== "request/cancel") return;
    if (!isCancelParams(params)) {
      this.failChannel("PROTOCOL_ERROR", "malformed request/cancel notification");
      return;
    }
    const owner = this.owners.get(params.requestId);
    if (owner === undefined || owner.phase !== "open") return;
    if (owner.kind === "mount") this.cancelMount(owner);
    else this.cancelOwner(owner, new OperationError("CANCELLED", "Service invocation was cancelled"));
  }

  private receiveSuccess(id: string, result: JsonValue): void {
    const pending = this.pendingById.get(id);
    if (pending === undefined) {
      this.failChannel("PROTOCOL_ERROR", `unknown or duplicate response ID ${id}`);
      return;
    }
    try {
      if (pending.kind === "ready") {
        if (!isEmptyObject(result)) throw new PeerProtocolViolation("invalid service/ready acknowledgement");
        const mount = pending.owner as MountOwner;
        mount.readiness = "acknowledged";
        this.settleOutbound(pending, { result });
      } else if (pending.kind === "flow") {
        this.settleOutbound(pending, { result: parseRunResult(result) as unknown as JsonValue });
      } else {
        const parsed = parseEffectResult(result);
        if (parsed.kind === "value") this.settleOutbound(pending, { result: parsed.value });
        else this.settleOutbound(pending, { error: new EffectError(parsed.name, parsed.data) });
      }
    } catch (error) {
      this.failChannel("PROTOCOL_ERROR", message(error));
    }
  }

  private receiveError(
    id: string | null,
    error: { readonly code: number; readonly message: string; readonly data?: JsonValue },
  ): void {
    if (id === null) {
      this.failChannel("PROTOCOL_ERROR", `peer reported ${error.message}`);
      return;
    }
    const pending = this.pendingById.get(id);
    if (pending === undefined) {
      this.failChannel("PROTOCOL_ERROR", `unknown or duplicate response ID ${id}`);
      return;
    }
    try {
      const operation = parseOperationError(error);
      if (operation === null) throw new PeerProtocolViolation(`host returned JSON-RPC error ${error.code}`);
      this.settleOutbound(pending, {
        error: new OperationError(operation.code, error.message, operation.details),
      });
    } catch (cause) {
      this.failChannel("PROTOCOL_ERROR", message(cause));
    }
  }

  private async handleMount(mount: MountOwner): Promise<void> {
    let failure: WireOperationErrorCode | undefined;
    let failureMessage: string | undefined;
    let failureDetails: JsonValue | undefined;
    try {
      await this.mountHandler(this.mountContext(mount));
      if (mount.readiness !== "acknowledged" && !mount.controller.signal.aborted) failure = "INVALID_RESULT";
    } catch (error) {
      if (!mount.controller.signal.aborted) {
        ({ code: failure, text: failureMessage, details: failureDetails } = classifyFailure(error, this.diagnose));
      }
    }
    if (mount.phase !== "open" || this.channel !== "open") return;
    mount.phase = "publishing";
    for (const owner of [...this.owners.values()]) {
      if (owner.kind === "invocation" && owner.phase === "open") {
        this.cancelOwner(owner, new OperationError("OWNER_CLOSED", "Service Mount is closing"));
      }
    }
    this.cancelOwnerOutbound(mount, new OperationError("OWNER_CLOSED", "Service Mount is closing"));
    await Promise.allSettled(
      [...this.owners.values()]
        .filter((owner): owner is InvocationOwner => owner.kind === "invocation")
        .map((owner) => owner.task),
    );
    await Promise.allSettled([...mount.outbound].map((pending) => pending.wire.promise));
    if (this.channel !== "open") return;
    try {
      if (mount.controller.signal.aborted || failure === undefined) {
        await this.sendMountTerminal(emptyResultMessage(mount.id));
      } else {
        await this.sendMountTerminal(operationErrorMessage(
          mount.id,
          failure,
          failureMessage ?? failureText(failure),
          failureDetails,
        ));
      }
      mount.phase = "terminal";
      this.owners.delete(mount.id);
      await this.complete();
    } catch (error) {
      this.failMountPublication(message(error));
    }
  }

  private async handleInvocation(owner: InvocationOwner): Promise<void> {
    let result: JsonValue | undefined;
    let serviceFailure: ServiceError | undefined;
    let failure: WireOperationErrorCode | undefined;
    let failureMessage: string | undefined;
    let failureDetails: JsonValue | undefined;
    try {
      result = await owner.handler(this.invocationContext(owner));
      if (owner.controller.signal.aborted) failure = "CANCELLED";
    } catch (error) {
      if (owner.controller.signal.aborted) failure = "CANCELLED";
      else if (error instanceof ServiceError) serviceFailure = error;
      else ({ code: failure, text: failureMessage, details: failureDetails } = classifyFailure(error, this.diagnose));
    }
    if (owner.phase !== "open" || this.channel !== "open") return;
    owner.phase = "publishing";
    if (owner.outbound.size !== 0) {
      const detached = [...owner.outbound].some((pending) => !pending.userSettled);
      if (detached) failure ??= "EXECUTION_FAILED";
      this.cancelOwnerOutbound(owner, new OperationError("OWNER_CLOSED", "Service invocation returned with pending calls"));
      await Promise.allSettled([...owner.outbound].map((pending) => pending.wire.promise));
    }
    if (this.channel !== "open") return;
    let terminal: JsonObject;
    if (failure !== undefined) {
      terminal = operationErrorMessage(owner.id, failure, failureMessage ?? failureText(failure), failureDetails);
    } else if (serviceFailure !== undefined) {
      try {
        const name = requireLocalName(serviceFailure.errorName);
        const data = snapshotJson(serviceFailure.data);
        terminal = effectResultMessage(owner.id, { error: { name, data } });
      } catch (error) {
        this.diagnose(error);
        terminal = operationErrorMessage(owner.id, "INVALID_RESULT", failureText("INVALID_RESULT"));
      }
    } else {
      try {
        terminal = effectResultMessage(owner.id, { value: snapshotJson(result as JsonValue) });
      } catch (error) {
        this.diagnose(error);
        terminal = operationErrorMessage(owner.id, "INVALID_RESULT", failureText("INVALID_RESULT"));
      }
    }
    try {
      await this.send(terminal);
      owner.phase = "terminal";
      this.owners.delete(owner.id);
    } catch (error) {
      this.failChannel("CHANNEL_LOST", message(error));
    }
  }

  private mountContext(mount: MountOwner): ServiceMountContext {
    return Object.freeze({
      settings: mount.params.settings,
      attachments: mount.params.attachments,
      scratch: mount.params.scratch,
      startupDeadlineUnixMs: mount.params.startupDeadlineUnixMs,
      signal: mount.controller.signal,
      cancelled: mount.cancelled.promise,
      ready: () => this.ready(mount),
      callFlow: (call: FlowCall, options?: CallOptions) => this.callFlow(mount, call, options),
      callEffect: (call: EffectCall, options?: CallOptions) => this.callEffect(mount, call, options),
    });
  }

  private invocationContext(owner: InvocationOwner): ServiceInvocationContext {
    return Object.freeze({
      exportName: owner.params.exportName,
      method: owner.params.method,
      input: owner.params.input,
      deadlineUnixMs: owner.params.deadlineUnixMs,
      signal: owner.controller.signal,
      callFlow: (call: FlowCall, options?: CallOptions) => this.callFlow(owner, call, options),
      callEffect: (call: EffectCall, options?: CallOptions) => this.callEffect(owner, call, options),
    });
  }

  private ready(mount: MountOwner): Promise<void> {
    if (mount.phase !== "open" || mount.controller.signal.aborted) {
      return Promise.reject(new OperationError("OWNER_CLOSED", "Service Mount is closing"));
    }
    if (mount.readiness !== "not-called") {
      return Promise.reject(new OperationError("PROTOCOL_ERROR", "ready() may be called exactly once"));
    }
    mount.readiness = "pending";
    let params: JsonObject;
    try {
      params = serviceReadyParams(mount.id, this.exportNames);
    } catch (error) {
      return Promise.reject(new TypeError(message(error)));
    }
    return this.call(mount, "service/ready", "ready", params).then(() => undefined);
  }

  private callFlow(owner: Owner, call: FlowCall, options?: CallOptions): Promise<RunResult> {
    try {
      const params = snapshotJson(attributedFlowCall(owner.id, call)) as JsonObject;
      return this.call(owner, "flow/call", "flow", params, options).then(parseRunResult);
    } catch (error) {
      return Promise.reject(new TypeError(message(error)));
    }
  }

  private callEffect(owner: Owner, call: EffectCall, options?: CallOptions): Promise<JsonValue> {
    try {
      const params = snapshotJson(attributedEffectCall(owner.id, call)) as JsonObject;
      return this.call(owner, "effect/call", "effect", params, options);
    } catch (error) {
      return Promise.reject(new TypeError(message(error)));
    }
  }

  private call(
    owner: Owner,
    method: Outbound["method"],
    kind: Outbound["kind"],
    params: JsonObject,
    options?: CallOptions,
  ): Promise<JsonValue> {
    if (this.channel !== "open" || owner.phase !== "open" || owner.controller.signal.aborted) {
      return Promise.reject(new OperationError("OWNER_CLOSED", "Service owner is not accepting calls"));
    }
    const signals = options?.signal ? [owner.controller.signal, options.signal] : [owner.controller.signal];
    if (signals.some((signal) => signal.aborted)) return Promise.reject(cancellationError());
    if (this.outbound.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new OperationError("RESOURCE_EXHAUSTED", "too many live Provider requests"));
    }
    if (this.usedProviderIds.size >= MAX_REQUEST_IDS) {
      return Promise.reject(new OperationError("RESOURCE_EXHAUSTED", "Service request-ID lifetime exhausted"));
    }
    const pending: Outbound = {
      owner,
      method,
      kind,
      params,
      user: deferred<JsonValue>(),
      wire: deferred<void>(),
      signals,
      abortListeners: [],
      state: "queued",
      userSettled: false,
      cancelSent: false,
    };
    void pending.user.promise.catch(() => undefined);
    void pending.wire.promise.catch(() => undefined);
    for (const signal of signals) {
      const listener = () => this.cancelOutbound(pending, cancellationError());
      signal.addEventListener("abort", listener, { once: true });
      pending.abortListeners.push([signal, listener]);
    }
    owner.outbound.add(pending);
    this.outbound.add(pending);
    this.queue.push(pending);
    this.drainQueue();
    return pending.user.promise;
  }

  private drainQueue(): void {
    if (this.channel !== "open") return;
    while (this.sentCount < MAX_PENDING_REQUESTS) {
      const pending = this.queue.shift();
      if (pending === undefined) return;
      if (pending.state !== "queued") continue;
      const id = `provider:${this.nextId}`;
      this.nextId += 1;
      this.usedProviderIds.add(id);
      pending.id = id;
      pending.state = "sent";
      this.sentCount += 1;
      this.pendingById.set(id, pending);
      void this.send(requestMessage(id, pending.method, pending.params)).catch((error) => {
        this.failChannel("CHANNEL_LOST", message(error));
      });
    }
  }

  private cancelMount(mount: MountOwner): void {
    if (mount.phase !== "open") return;
    mount.cancelled.resolve();
    this.cancelOwner(mount, new OperationError("CANCELLED", "Service Mount was cancelled"));
    for (const owner of [...this.owners.values()]) {
      if (owner.kind === "invocation") this.cancelOwner(owner, new OperationError("OWNER_CLOSED", "Service Mount was cancelled"));
    }
  }

  private cancelOwner(owner: Owner, reason: OperationError): void {
    if (owner.phase !== "open") return;
    owner.controller.abort(reason);
    this.cancelOwnerOutbound(owner, reason);
  }

  private cancelOwnerOutbound(owner: Owner, reason: OperationError): void {
    for (const pending of [...owner.outbound]) this.cancelOutbound(pending, reason);
  }

  private cancelOutbound(pending: Outbound, reason: unknown): void {
    if (pending.state === "settled") return;
    if (!pending.userSettled) {
      pending.userSettled = true;
      pending.user.reject(reason);
    }
    if (pending.state === "queued") {
      pending.state = "settled";
      this.outbound.delete(pending);
      pending.owner.outbound.delete(pending);
      this.removeAbortListeners(pending);
      pending.wire.resolve();
      return;
    }
    if (!pending.cancelSent && pending.id !== undefined) {
      pending.cancelSent = true;
      void this.send(cancelMessage(pending.id)).catch((error) => this.failChannel("CHANNEL_LOST", message(error)));
    }
  }

  private settleOutbound(
    pending: Outbound,
    settlement: { readonly result: JsonValue } | { readonly error: unknown },
  ): void {
    if (pending.state !== "sent" || pending.id === undefined) return;
    pending.state = "settled";
    this.pendingById.delete(pending.id);
    this.outbound.delete(pending);
    pending.owner.outbound.delete(pending);
    this.sentCount -= 1;
    this.removeAbortListeners(pending);
    pending.wire.resolve();
    if (!pending.userSettled) {
      pending.userSettled = true;
      if ("error" in settlement) pending.user.reject(settlement.error);
      else pending.user.resolve(settlement.result);
    }
    this.drainQueue();
  }

  private removeAbortListeners(pending: Outbound): void {
    for (const [signal, listener] of pending.abortListeners) signal.removeEventListener("abort", listener);
    pending.abortListeners.length = 0;
  }

  private async send(value: JsonObject): Promise<void> {
    return this.enqueueWrite(value, "ordinary");
  }

  private async sendMountTerminal(value: JsonObject): Promise<void> {
    return this.enqueueWrite(value, "mount");
  }

  private async sendFatalDiagnostic(value: JsonObject): Promise<void> {
    return this.enqueueWrite(value, "fatal");
  }

  private async enqueueWrite(value: JsonObject, kind: "ordinary" | "mount" | "fatal"): Promise<void> {
    if ((kind === "fatal" && this.channel !== "fatal") || (kind !== "fatal" && this.channel !== "open")) {
      throw new Error("protocol channel is closed");
    }
    const frame = encodeJson(value);
    const line = new Uint8Array(frame.byteLength + 1);
    line.set(frame);
    line[frame.byteLength] = 0x0a;
    const write = this.writeTail.then(() => {
      if (kind === "fatal") {
        if (this.channel !== "fatal") throw new Error("protocol channel is closed");
      } else {
        if (this.channel !== "open") throw new Error("protocol channel is closed");
      }
      if (kind === "mount") this.channel = "mount-publishing";
      return this.transport.write(line);
    });
    this.writeTail = write.catch(() => undefined);
    return write;
  }

  private async complete(): Promise<void> {
    if (this.channel !== "mount-publishing") return;
    this.channel = "complete";
    try {
      await this.transport.stopReading();
      this.completion.resolve();
    } catch (error) {
      this.channel = "failed";
      this.completion.reject(new OperationError("CHANNEL_LOST", message(error)));
    }
  }

  private failChannel(code: "PROTOCOL_ERROR" | "CHANNEL_LOST", text: string): void {
    const failure = this.claimFatal(code, text);
    if (failure !== undefined) this.finishFatal(failure);
  }

  private async failWithDiagnostic(
    code: "PROTOCOL_ERROR" | "CHANNEL_LOST",
    text: string,
    diagnostic: JsonObject,
  ): Promise<void> {
    const failure = this.claimFatal(code, text);
    if (failure === undefined) return;
    try {
      await this.sendFatalDiagnostic(diagnostic);
    } catch {
      // Best effort only.
    }
    this.finishFatal(failure);
  }

  private claimFatal(code: "PROTOCOL_ERROR" | "CHANNEL_LOST", text: string): OperationError | undefined {
    if (this.channel !== "open") return undefined;
    this.channel = "fatal";
    const failure = new OperationError(code, text);
    for (const owner of this.owners.values()) {
      owner.controller.abort(failure);
      if (owner.kind === "mount") owner.cancelled.reject(failure);
    }
    for (const pending of [...this.outbound]) {
      if (pending.state === "sent" && pending.id !== undefined) {
        this.pendingById.delete(pending.id);
        this.sentCount -= 1;
      }
      pending.state = "settled";
      this.outbound.delete(pending);
      pending.owner.outbound.delete(pending);
      this.removeAbortListeners(pending);
      if (!pending.userSettled) {
        pending.userSettled = true;
        pending.user.reject(failure);
      }
      pending.wire.resolve();
    }
    void this.transport.stopReading().catch(() => undefined);
    return failure;
  }

  private finishFatal(failure: OperationError): void {
    if (this.channel !== "fatal") return;
    this.channel = "failed";
    this.completion.reject(failure);
  }

  private failMountPublication(text: string): void {
    if (this.channel === "open") {
      this.failChannel("CHANNEL_LOST", text);
      return;
    }
    if (this.channel !== "mount-publishing") return;
    this.channel = "failed";
    this.completion.reject(new OperationError("CHANNEL_LOST", text));
  }

  private diagnose = (error: unknown): void => {
    try {
      const consoleLike = (globalThis as { console?: { error(...values: unknown[]): void } }).console;
      const text = error instanceof Error ? `${error.name}: ${error.message}` : message(error);
      consoleLike?.error(Array.from(text).slice(0, 4_096).join(""));
    } catch {
      // Diagnostics never alter protocol results.
    }
  };
}

function snapshotDefinition(definition: ServiceDefinition): {
  readonly exports: Readonly<Record<string, ServiceExportHandler>>;
  readonly names: readonly string[];
  readonly mount: ServiceDefinition["mount"];
} {
  if (typeof definition !== "object" || definition === null) {
    throw new TypeError("Service definition requires a mount handler");
  }
  const mount = definition.mount;
  if (typeof mount !== "function") {
    throw new TypeError("Service definition requires a mount handler");
  }
  const source = definition.exports;
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw new TypeError("Service exports must be an object");
  }
  if (Object.getOwnPropertySymbols(source).length !== 0) throw new TypeError("Service exports cannot use symbols");
  const descriptors = Object.getOwnPropertyDescriptors(source);
  const names = Object.keys(descriptors).sort();
  if (names.length === 0 || names.length > 256) throw new TypeError("Service requires 1-256 exports");
  const exports: Record<string, ServiceExportHandler> = Object.create(null) as Record<string, ServiceExportHandler>;
  for (const name of names) {
    requireLocalName(name);
    const descriptor = descriptors[name]!;
    if (!descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "function") {
      throw new TypeError(`Service export ${name} must be an enumerable data function`);
    }
    exports[name] = descriptor.value as ServiceExportHandler;
  }
  return { exports: Object.freeze(exports), names: Object.freeze(names), mount };
}

function classifyFailure(
  error: unknown,
  diagnose: (error: unknown) => void,
): { code: WireOperationErrorCode; text?: string; details?: JsonValue } {
  if (error instanceof OperationError && isWireCode(error.code)) {
    try {
      return {
        code: error.code,
        text: snapshotMessage(error.message),
        ...(error.details === undefined ? {} : { details: snapshotJson(error.details) }),
      };
    } catch (metadataError) {
      diagnose(metadataError);
      return { code: "EXECUTION_FAILED" };
    }
  }
  diagnose(error);
  return { code: "EXECUTION_FAILED" };
}

function snapshotJson<T extends JsonValue>(value: T): T {
  return decodeJson(encodeJson(value)) as T;
}

function snapshotMessage(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("operation error message must be a string");
  const size = Array.from(value).length;
  if (size === 0 || size > 1_024) throw new TypeError("operation error message must contain 1-1024 Unicode scalars");
  encodeJson(value);
  return value;
}

function failureText(code: WireOperationErrorCode): string {
  return code === "INVALID_RESULT" ? "Service produced an invalid result" : code;
}

function isWireCode(value: unknown): value is WireOperationErrorCode {
  return typeof value === "string" && wireCodes.has(value);
}

function isCancelParams(value: JsonValue | undefined): value is { readonly requestId: string } {
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== "object") return false;
  const object = value as Readonly<Record<string, JsonValue>>;
  return Object.keys(object).length === 1 && typeof object.requestId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(object.requestId) && object.requestId.length <= 128;
}

function isEmptyObject(value: JsonValue): boolean {
  return value !== null && !Array.isArray(value) && typeof value === "object" && Object.keys(value).length === 0;
}

function cancellationError(): OperationError {
  return new OperationError("CANCELLED", "operation was cancelled");
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function message(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "unknown error";
  }
}
