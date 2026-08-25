import { decodeJson, encodeJson, JsonViolation } from "./json.js";
import {
  cancelMessage,
  errorMessage,
  operationErrorMessage,
  parseEffectResult,
  parseEnvelope,
  parseOperationError,
  parseRunParams,
  parseRunResult,
  requestMessage,
  resultMessage,
  validateEffectCall,
  validateFlowCall,
  type ParsedMessage,
  type RunParams,
} from "./protocol.js";
import {
  FramingViolation,
  readFrames,
  type Transport,
} from "./transport.js";
import {
  EffectError,
  OperationError,
  OPERATION_ERROR_CODES,
  type CallOptions,
  type EffectCall,
  type FlowCall,
  type JsonObject,
  type JsonValue,
  type OperationErrorCode,
  type RunContext,
  type RunHandler,
  type RunResult,
} from "./types.js";

const MAX_OUTBOUND_REQUESTS = 64;
const MAX_REQUEST_IDS = 65_536;
type WireOperationErrorCode = Exclude<
  OperationErrorCode,
  "PROTOCOL_ERROR" | "CHANNEL_LOST"
>;
const WIRE_OPERATION_ERROR_CODES = new Set<string>(
  OPERATION_ERROR_CODES.filter(
    (code) => code !== "PROTOCOL_ERROR" && code !== "CHANNEL_LOST",
  ),
);

class PeerProtocolViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeerProtocolViolation";
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

interface Outbound {
  readonly method: "flow/call" | "effect/call";
  readonly params: JsonObject;
  readonly kind: "flow" | "effect";
  readonly user: Deferred<JsonValue>;
  readonly wire: Deferred<void>;
  readonly signals: readonly AbortSignal[];
  readonly abortListeners: Array<readonly [AbortSignal, () => void]>;
  id?: string;
  state: "queued" | "sent" | "settled";
  userSettled: boolean;
  cancelSent: boolean;
}

interface Root {
  readonly id: string;
  readonly controller: AbortController;
  readonly params: RunParams;
  phase: "open" | "completing" | "terminal";
}

export class RunSession {
  private readonly completion = deferred<void>();
  private readonly seenHostIds = new Set<string>();
  private readonly usedComponentIds = new Set<string>();
  private readonly pendingById = new Map<string, Outbound>();
  private readonly outbound = new Set<Outbound>();
  private readonly queue: Outbound[] = [];
  private root: Root | undefined;
  private nextId = 1;
  private sentCount = 0;
  private accepting = true;
  private channel: "open" | "root-publishing" | "fatal" | "complete" | "failed" = "open";
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly transport: Transport,
    private readonly handler: RunHandler,
  ) {
    // `serve()` owns this promise, but keeping an internal rejection handler
    // prevents a channel error from becoming an unhandled rejection first.
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
            await this.failWithDiagnostic(
              "PROTOCOL_ERROR",
              errorMessageText(error),
              errorMessage(null, -32700, "Parse error"),
            );
          } else {
            this.failChannel("PROTOCOL_ERROR", errorMessageText(error));
          }
          return;
        }

        let message: ParsedMessage;
        try {
          message = parseEnvelope(value);
        } catch (error) {
          await this.failWithDiagnostic(
            "PROTOCOL_ERROR",
            errorMessageText(error),
            errorMessage(null, -32600, "Invalid Request"),
          );
          return;
        }
        await this.receive(message);
      }

      if (this.channel === "open") {
        this.failChannel("CHANNEL_LOST", "protocol input closed before Run completion");
      }
    } catch (error) {
      if (this.channel === "open") {
        const code =
          error instanceof JsonViolation ||
          error instanceof FramingViolation ||
          error instanceof PeerProtocolViolation
            ? "PROTOCOL_ERROR"
            : "CHANNEL_LOST";
        this.failChannel(
          code,
          errorMessageText(error),
        );
      }
    }
  }

  private async receive(message: ParsedMessage): Promise<void> {
    switch (message.kind) {
      case "request":
        await this.receiveRequest(message.value.id, message.value.method, message.value.params);
        return;
      case "notification":
        await this.receiveNotification(message.value.method, message.value.params);
        return;
      case "success":
        this.receiveSuccess(message.value.id, message.value.result);
        return;
      case "error":
        this.receiveError(message.value.id, message.value.error);
        return;
    }
  }

  private async receiveRequest(
    id: string,
    method: string,
    params: JsonValue | undefined,
  ): Promise<void> {
    if (this.seenHostIds.has(id)) {
      this.failChannel("PROTOCOL_ERROR", `host reused request ID ${id}`);
      return;
    }
    if (this.seenHostIds.size >= MAX_REQUEST_IDS) {
      this.failChannel("PROTOCOL_ERROR", "host exceeded the Run/1 request-ID lifetime limit");
      return;
    }
    this.seenHostIds.add(id);

    if (method !== "flow/run") {
      await this.send(errorMessage(id, -32601, "Method not found"));
      return;
    }
    if (this.root !== undefined) {
      await this.failWithDiagnostic(
        "PROTOCOL_ERROR",
        "host sent more than one flow/run",
        errorMessage(id, -32600, "Only one flow/run is allowed"),
      );
      return;
    }

    let runParams: RunParams;
    try {
      runParams = parseRunParams(params as JsonValue);
    } catch {
      try {
        await this.sendTerminal(errorMessage(id, -32602, "Invalid params"));
        await this.complete();
      } catch (error) {
        this.failRootPublication(errorMessageText(error));
      }
      return;
    }

    const root: Root = {
      id,
      controller: new AbortController(),
      params: runParams,
      phase: "open",
    };
    this.root = root;
    void this.handleRoot(root);
  }

  private async receiveNotification(method: string, params: JsonValue | undefined): Promise<void> {
    if (method !== "request/cancel") return;
    if (!isCancelParams(params)) {
      this.failChannel("PROTOCOL_ERROR", "malformed request/cancel notification");
      return;
    }
    const root = this.root;
    if (root === undefined || params.requestId !== root.id || root.phase !== "open") return;
    this.accepting = false;
    root.controller.abort(new OperationError("CANCELLED", "root Run was cancelled"));
    this.cancelAllOutbound(new OperationError("CANCELLED", "root Run was cancelled"));
  }

  private receiveSuccess(id: string, result: JsonValue): void {
    const pending = this.pendingById.get(id);
    if (pending === undefined) {
      this.failChannel("PROTOCOL_ERROR", `unknown or duplicate response ID ${id}`);
      return;
    }
    try {
      if (pending.kind === "flow") {
        const parsed = parseRunResult(result);
        this.settleOutbound(pending, { result: parsed as unknown as JsonValue });
      } else {
        const parsed = parseEffectResult(result);
        if (parsed.kind === "value") {
          this.settleOutbound(pending, { result: parsed.value });
        } else {
          this.settleOutbound(pending, {
            error: new EffectError(parsed.name, parsed.data),
          });
        }
      }
    } catch (error) {
      this.failChannel("PROTOCOL_ERROR", errorMessageText(error));
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
      if (operation === null) {
        throw new PeerProtocolViolation(
          `host returned JSON-RPC error ${error.code} for ${pending.method}`,
        );
      }
      const failure = new OperationError(
        operation.code,
        error.message,
        operation.details,
      );
      this.settleOutbound(pending, { error: failure });
    } catch (cause) {
      this.failChannel("PROTOCOL_ERROR", errorMessageText(cause));
    }
  }

  private async handleRoot(root: Root): Promise<void> {
    const context = this.createContext(root);
    let result: RunResult | undefined;
    let failure: WireOperationErrorCode | undefined;
    let failureMessage: string | undefined;
    let failureDetails: JsonValue | undefined;

    try {
      result = await this.handler(context);
      if (root.controller.signal.aborted) failure = "CANCELLED";
    } catch (error) {
      if (root.controller.signal.aborted) {
        failure = "CANCELLED";
      } else if (
        error instanceof OperationError &&
        isWireOperationErrorCode(error.code)
      ) {
        try {
          failureMessage = snapshotOperationMessage(error.message);
          failureDetails =
            error.details === undefined
              ? undefined
              : decodeJson(encodeJson(error.details));
          failure = error.code;
        } catch (metadataError) {
          failure = "EXECUTION_FAILED";
          failureMessage = undefined;
          failureDetails = undefined;
          this.diagnose(metadataError);
        }
      } else {
        failure = "EXECUTION_FAILED";
        this.diagnose(error);
      }
    }

    if (root.phase !== "open") return;
    root.phase = "completing";
    this.accepting = false;

    if (this.outbound.size !== 0) {
      const hasDetachedCall = [...this.outbound].some(
        (pending) => !pending.userSettled,
      );
      if (hasDetachedCall) failure ??= "EXECUTION_FAILED";
      this.cancelAllOutbound(
        new OperationError("OWNER_CLOSED", "Run handler returned with pending calls"),
      );
      await Promise.allSettled([...this.outbound].map((pending) => pending.wire.promise));
    }
    if (this.channel !== "open") return;

    if (failure === undefined) {
      try {
        result = parseRunResult(result as unknown as JsonValue);
        // Validate the complete application value before selecting success.
        encodeJson(result as unknown as JsonValue);
      } catch (error) {
        failure = "INVALID_RESULT";
        this.diagnose(error);
      }
    }

    try {
      if (failure === undefined && result !== undefined) {
        await this.sendTerminal(resultMessage(root.id, result));
      } else {
        await this.sendTerminal(
          operationErrorMessage(
            root.id,
            failure ?? "EXECUTION_FAILED",
            failureMessage ?? rootFailureMessage(failure),
            failureDetails,
          ),
        );
      }
      root.phase = "terminal";
      await this.complete();
    } catch (error) {
      this.failRootPublication(errorMessageText(error));
    }
  }

  private createContext(root: Root): RunContext {
    const session = this;
    return Object.freeze({
      input: root.params.input,
      settings: root.params.settings,
      attachments: root.params.attachments,
      scratch: root.params.scratch,
      deadlineUnixMs: root.params.deadlineUnixMs,
      signal: root.controller.signal,
      callFlow(call: FlowCall, options?: CallOptions) {
        let params: JsonObject;
        try {
          params = validateFlowCall(call);
          params = decodeJson(encodeJson(params)) as JsonObject;
        } catch (error) {
          return Promise.reject(new TypeError(errorMessageText(error)));
        }
        return session.call("flow/call", "flow", params, options).then((value) =>
          parseRunResult(value),
        );
      },
      callEffect(call: EffectCall, options?: CallOptions) {
        let params: JsonObject;
        try {
          params = validateEffectCall(call);
          params = decodeJson(encodeJson(params)) as JsonObject;
        } catch (error) {
          return Promise.reject(new TypeError(errorMessageText(error)));
        }
        return session.call("effect/call", "effect", params, options);
      },
    });
  }

  private call(
    method: "flow/call" | "effect/call",
    kind: "flow" | "effect",
    params: JsonObject,
    options?: CallOptions,
  ): Promise<JsonValue> {
    const root = this.root;
    if (!this.accepting || root === undefined || root.phase !== "open") {
      return Promise.reject(new OperationError("OWNER_CLOSED", "Run is not accepting calls"));
    }
    const signals = options?.signal
      ? [root.controller.signal, options.signal]
      : [root.controller.signal];
    const alreadyAborted = signals.find((signal) => signal.aborted);
    if (alreadyAborted !== undefined) return Promise.reject(cancellationError());

    if (this.outbound.size >= MAX_OUTBOUND_REQUESTS) {
      return Promise.reject(
        new OperationError(
          "RESOURCE_EXHAUSTED",
          `at most ${MAX_OUTBOUND_REQUESTS} outbound calls may be live`,
        ),
      );
    }
    if (this.usedComponentIds.size >= MAX_REQUEST_IDS) {
      return Promise.reject(
        new OperationError(
          "RESOURCE_EXHAUSTED",
          `at most ${MAX_REQUEST_IDS} requests may be emitted during one Run`,
        ),
      );
    }

    const pending: Outbound = {
      method,
      params,
      kind,
      user: deferred<JsonValue>(),
      wire: deferred<void>(),
      signals,
      abortListeners: [],
      state: "queued",
      userSettled: false,
      cancelSent: false,
    };
    // Consumers may intentionally abandon a cancelled wait. Keep its internal
    // rejection from becoming a process-level unhandled rejection.
    void pending.user.promise.catch(() => undefined);
    void pending.wire.promise.catch(() => undefined);
    for (const signal of signals) {
      const listener = () => this.cancelOutbound(pending, cancellationError());
      signal.addEventListener("abort", listener, { once: true });
      pending.abortListeners.push([signal, listener]);
    }
    this.outbound.add(pending);
    this.queue.push(pending);
    this.drainQueue();
    return pending.user.promise;
  }

  private drainQueue(): void {
    if (!this.accepting || this.channel !== "open") return;
    while (this.sentCount < MAX_OUTBOUND_REQUESTS) {
      const pending = this.queue.shift();
      if (pending === undefined) return;
      if (pending.state !== "queued") continue;

      const id = `component:${this.nextId}`;
      this.nextId += 1;
      if (this.usedComponentIds.has(id)) {
        this.failChannel("PROTOCOL_ERROR", "component request ID generator reused an ID");
        return;
      }
      this.usedComponentIds.add(id);
      pending.id = id;
      pending.state = "sent";
      this.sentCount += 1;
      this.pendingById.set(id, pending);
      void this.send(requestMessage(id, pending.method, pending.params)).catch((error) => {
        this.failChannel("CHANNEL_LOST", errorMessageText(error));
      });
    }
  }

  private cancelAllOutbound(reason: OperationError): void {
    for (const pending of [...this.outbound]) this.cancelOutbound(pending, reason);
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
      this.removeAbortListeners(pending);
      pending.wire.resolve();
      return;
    }
    if (!pending.cancelSent && pending.id !== undefined) {
      pending.cancelSent = true;
      void this.send(cancelMessage(pending.id)).catch((error) => {
        this.failChannel("CHANNEL_LOST", errorMessageText(error));
      });
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
    for (const [signal, listener] of pending.abortListeners) {
      signal.removeEventListener("abort", listener);
    }
    pending.abortListeners.length = 0;
  }

  private async send(value: JsonObject): Promise<void> {
    return this.enqueueWrite(value, "ordinary");
  }

  private async sendTerminal(value: JsonObject): Promise<void> {
    return this.enqueueWrite(value, "root");
  }

  private async sendFatalDiagnostic(value: JsonObject): Promise<void> {
    return this.enqueueWrite(value, "fatal");
  }

  private async enqueueWrite(
    value: JsonObject,
    kind: "ordinary" | "root" | "fatal",
  ): Promise<void> {
    if (
      (kind === "fatal" && this.channel !== "fatal") ||
      (kind !== "fatal" && this.channel !== "open")
    ) {
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
      if (kind === "root") {
        // Claim the terminal decision immediately before publication. Once
        // `write()` starts, later peer input cannot overturn the root result;
        // only failure of this write can still fail the Run.
        this.channel = "root-publishing";
        this.accepting = false;
      }
      return this.transport.write(line);
    });
    this.writeTail = write.catch(() => undefined);
    return write;
  }

  private async complete(): Promise<void> {
    if (this.channel === "complete" || this.channel === "failed") return;
    if (this.channel !== "root-publishing") return;
    this.channel = "complete";
    this.accepting = false;
    try {
      await this.transport.stopReading();
    } catch (error) {
      this.channel = "failed";
      this.completion.reject(
        new OperationError("CHANNEL_LOST", errorMessageText(error)),
      );
      return;
    }
    this.completion.resolve();
  }

  private failChannel(
    code: "PROTOCOL_ERROR" | "CHANNEL_LOST",
    message: string,
  ): void {
    const failure = this.claimFatal(code, message);
    if (failure === undefined) return;
    this.finishFatal(failure);
  }

  private async failWithDiagnostic(
    code: "PROTOCOL_ERROR" | "CHANNEL_LOST",
    message: string,
    diagnostic: JsonObject,
  ): Promise<void> {
    const failure = this.claimFatal(code, message);
    if (failure === undefined) return;
    try {
      await this.sendFatalDiagnostic(diagnostic);
    } catch {
      // The diagnosed failure remains authoritative when stderr/stdout cannot
      // carry an additional best-effort protocol frame.
    }
    this.finishFatal(failure);
  }

  private claimFatal(
    code: "PROTOCOL_ERROR" | "CHANNEL_LOST",
    message: string,
  ): OperationError | undefined {
    if (this.channel !== "open") return undefined;
    this.channel = "fatal";
    this.accepting = false;
    const failure = new OperationError(code, message);
    const root = this.root;
    for (const pending of [...this.outbound]) {
      if (pending.state === "sent" && pending.id !== undefined) {
        this.pendingById.delete(pending.id);
        this.sentCount -= 1;
      }
      pending.state = "settled";
      this.outbound.delete(pending);
      this.removeAbortListeners(pending);
      if (!pending.userSettled) {
        pending.userSettled = true;
        pending.user.reject(failure);
      }
      pending.wire.resolve();
    }
    if (root?.phase === "open") root.controller.abort(failure);
    void this.transport.stopReading().catch(() => undefined);
    return failure;
  }

  private finishFatal(failure: OperationError): void {
    if (this.channel !== "fatal") return;
    this.channel = "failed";
    this.completion.reject(failure);
  }

  private failRootPublication(message: string): void {
    if (this.channel === "open") {
      this.failChannel("CHANNEL_LOST", message);
      return;
    }
    if (this.channel !== "root-publishing") return;
    this.channel = "failed";
    this.accepting = false;
    const failure = new OperationError("CHANNEL_LOST", message);
    void this.transport.stopReading().catch(() => undefined);
    this.completion.reject(failure);
  }

  private diagnose(error: unknown): void {
    try {
      // stderr is deliberately not structured protocol. Keep diagnostics short
      // and do not expose them as portable result data.
      const consoleLike = (globalThis as { console?: { error(...values: unknown[]): void } })
        .console;
      const description =
        error instanceof Error ? `${error.name}: ${error.message}` : errorMessageText(error);
      consoleLike?.error(Array.from(description).slice(0, 4_096).join(""));
    } catch {
      // Diagnostics never participate in the Run's terminal decision.
    }
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function isCancelParams(
  value: JsonValue | undefined,
): value is { readonly requestId: string } {
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const keys = Object.keys(value);
  const object = value as Readonly<Record<string, JsonValue>>;
  return (
    keys.length === 1 &&
    keys[0] === "requestId" &&
    typeof object.requestId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(object.requestId) &&
    object.requestId.length <= 128
  );
}

function cancellationError(): OperationError {
  return new OperationError("CANCELLED", "operation was cancelled");
}

function isWireOperationErrorCode(
  value: unknown,
): value is WireOperationErrorCode {
  return typeof value === "string" && WIRE_OPERATION_ERROR_CODES.has(value);
}

function snapshotOperationMessage(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("operation error message must be a string");
  const scalarLength = Array.from(value).length;
  if (scalarLength === 0 || scalarLength > 1_024) {
    throw new TypeError("operation error message must contain 1-1024 Unicode scalars");
  }
  encodeJson(value);
  return value;
}

function errorMessageText(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "unknown error";
  }
}

function rootFailureMessage(
  failure: WireOperationErrorCode | undefined,
): string {
  switch (failure) {
    case "CANCELLED":
      return "Run was cancelled";
    case "INVALID_RESULT":
      return "Run returned an invalid result";
    default:
      return "Run execution failed";
  }
}
