import { createHash } from "node:crypto";

import {
  JSON_1_LIMITS,
  Json1Error,
  canonicalJson,
  decodeJson1,
  validateJson1,
  type JsonObject,
  type JsonValue,
} from "../json.js";
import type {
  ExactComponentExit,
  ExactComponentProcess,
  RunAttachment,
  RunDiagnostics,
  RunHostFailureCode,
  WireFailureCode,
} from "../run/session.js";

const MOUNT_ID = "host:1";
const MAX_PENDING_PROVIDER_REQUESTS = 64;
const MAX_REQUEST_IDS = 65_536;
const WIRE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const encoder = new TextEncoder();
const utf8 = new TextDecoder("utf-8", { fatal: true });

const WIRE_FAILURE_CODES = new Set<WireFailureCode>([
  "CANCELLED",
  "DEADLINE_EXCEEDED",
  "OWNER_CLOSED",
  "OPERATION_CONFLICT",
  "UNAVAILABLE",
  "PERMISSION_DENIED",
  "RESOURCE_EXHAUSTED",
  "INVALID_INPUT",
  "INVALID_RESULT",
  "UNCERTAIN",
  "EXECUTION_FAILED",
]);

export interface ServiceHostActivation {
  readonly settings: JsonObject;
  readonly attachments: Readonly<Record<string, RunAttachment>>;
  readonly scratch: string;
  readonly startupDeadlineUnixMs: number;
  readonly exports: readonly string[];
  readonly signal?: AbortSignal;
}

export interface ServiceHostInvocation {
  readonly exportName: string;
  readonly method: string;
  readonly input: JsonValue;
  readonly deadlineUnixMs: number;
  readonly signal?: AbortSignal;
}

export type ServiceInvocationTerminal =
  | { readonly status: "succeeded"; readonly value: JsonValue }
  | { readonly status: "application-error"; readonly name: string; readonly data: JsonValue }
  | {
      readonly status: "failed";
      readonly code: RunHostFailureCode;
      readonly message: string;
      readonly details?: JsonValue;
    };

export type ServiceHostTerminal =
  | { readonly status: "succeeded"; readonly diagnostics: RunDiagnostics }
  | {
      readonly status: "failed";
      readonly code: RunHostFailureCode;
      readonly message: string;
      readonly details?: JsonValue;
      readonly diagnostics: RunDiagnostics;
    };

export interface ServiceHostLimits {
  readonly cancellationGraceMs: number;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly capturedStderrBytes: number;
}

interface ParsedRequest {
  readonly kind: "request";
  readonly id: string;
  readonly method: string;
  readonly params?: JsonValue;
}

interface ParsedNotification {
  readonly kind: "notification";
  readonly method: string;
  readonly params?: JsonValue;
}

interface ParsedSuccess {
  readonly kind: "success";
  readonly id: string;
  readonly result: JsonValue;
}

interface ParsedError {
  readonly kind: "error";
  readonly id: string | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: JsonValue;
  };
}

type ParsedEnvelope = ParsedRequest | ParsedNotification | ParsedSuccess | ParsedError;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

interface InvocationRecord {
  readonly id: string;
  readonly request: ServiceHostInvocation;
  readonly terminal: Deferred<ServiceInvocationTerminal>;
  phase: "queued" | "open" | "terminal";
  cancellation?: { readonly code: "CANCELLED" | "DEADLINE_EXCEEDED"; readonly message: string };
  abortListener?: () => void;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  graceTimer?: ReturnType<typeof setTimeout>;
}

interface OperationRecord {
  readonly signature: string;
}

const DEFAULT_LIMITS: ServiceHostLimits = Object.freeze({
  cancellationGraceMs: 1_000,
  stdoutBytes: 64 * 1024 * 1024,
  stderrBytes: 16 * 1024 * 1024,
  capturedStderrBytes: 64 * 1024,
});

/** Private Service/1 Host seam over one already selected exact process. */
export class ServiceHostSession {
  private readonly limits: ServiceHostLimits;
  private readonly readyDeferred = deferred<void>();
  private readonly completionDeferred = deferred<ServiceHostTerminal>();
  private readonly providerIds = new Set<string>();
  private readonly hostIds = new Set<string>([MOUNT_ID]);
  private readonly invocations = new Map<string, InvocationRecord>();
  private readonly operations = new Map<string, OperationRecord>();
  private readonly ownedTasks = new Set<Promise<void>>();
  private readonly stderrChunks: Uint8Array[] = [];
  private writeTail: Promise<void> = Promise.resolve();
  private phase: "new" | "starting" | "ready-acking" | "ready" | "stopping" | "terminal" | "failed" = "new";
  private mountWritten = false;
  private readinessSeen = false;
  private mountTerminal?: { readonly kind: "success" } | {
    readonly kind: "failure";
    readonly code: WireFailureCode;
    readonly message: string;
    readonly details?: JsonValue;
  };
  private localFailure?: { readonly code: RunHostFailureCode; readonly message: string; readonly details?: JsonValue };
  private pendingProviderResponses = 0;
  private nextHostId = 2;
  private stdoutLength = 0;
  private stderrLength = 0;
  private stderrKept = 0;
  private stderrTruncated = false;
  private inputClosed = false;
  private mountCancelSent = false;
  private terminateStarted = false;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private mountGraceTimer?: ReturnType<typeof setTimeout>;
  private abortListener?: () => void;
  private readonly activation: ServiceHostActivation;

  constructor(
    private readonly process: ExactComponentProcess,
    activation: ServiceHostActivation,
    limits: Partial<ServiceHostLimits> = {},
  ) {
    this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits });
    validateLimits(this.limits);
    validateActivation(activation);
    this.activation = snapshotActivation(activation);
    void this.readyDeferred.promise.catch(() => undefined);
    void this.completionDeferred.promise.catch(() => undefined);
  }

  async start(): Promise<void> {
    if (this.phase !== "new") throw new Error("ServiceHostSession is single-use");
    this.phase = "starting";
    void this.runProcess();
    if (this.activation.signal?.aborted) {
      this.fail("CANCELLED", "Service Mount was cancelled before dispatch");
      return this.readyDeferred.promise;
    }
    if (Date.now() >= this.activation.startupDeadlineUnixMs) {
      this.fail("DEADLINE_EXCEEDED", "Service startup deadline elapsed before dispatch");
      return this.readyDeferred.promise;
    }
    this.armActivationCancellation();
    try {
      await this.sendFrame(
        mountRequest(this.activation),
        () => {
          this.mountWritten = true;
        },
        () => this.phase === "starting" && this.localFailure === undefined,
      );
      if (this.mountWritten) this.armStartupDeadline();
    } catch (error) {
      this.fail("CHANNEL_LOST", `failed to write service/mount: ${errorText(error)}`);
    }
    return this.readyDeferred.promise;
  }

  invoke(request: ServiceHostInvocation): Promise<ServiceInvocationTerminal> {
    validateInvocation(request);
    if (request.signal?.aborted) {
      return Promise.resolve(failedInvocation("CANCELLED", "Service invocation was cancelled before dispatch"));
    }
    if (Date.now() >= request.deadlineUnixMs) {
      return Promise.resolve(failedInvocation("DEADLINE_EXCEEDED", "Service invocation deadline elapsed before dispatch"));
    }
    if (this.phase !== "ready") {
      return Promise.resolve(failedInvocation("OWNER_CLOSED", "Service is not accepting invocations"));
    }
    if (!this.activation.exports.includes(request.exportName)) {
      return Promise.resolve(failedInvocation("INVALID_INPUT", "Service export is not bound by this Mount"));
    }
    if (this.hostIds.size >= MAX_REQUEST_IDS) {
      return Promise.resolve(failedInvocation("RESOURCE_EXHAUSTED", "Service request-ID lifetime exhausted"));
    }
    if (this.invocations.size >= 63) {
      return Promise.resolve(failedInvocation("RESOURCE_EXHAUSTED", "too many live Service invocations"));
    }
    const id = `host:${this.nextHostId}`;
    this.nextHostId += 1;
    this.hostIds.add(id);
    const record: InvocationRecord = {
      id,
      request: snapshotInvocation(request),
      terminal: deferred<ServiceInvocationTerminal>(),
      phase: "queued",
    };
    this.invocations.set(id, record);
    this.armInvocation(record);
    const send = this.sendFrame(
      invokeRequest(id, record.request),
      () => {
        record.phase = "open";
      },
      () => record.phase === "queued" && this.phase === "ready",
    ).catch((error) => {
      this.finishInvocation(record, failedInvocation("CHANNEL_LOST", `failed to write service/invoke: ${errorText(error)}`));
      this.fail("CHANNEL_LOST", `failed to write service/invoke: ${errorText(error)}`);
    });
    this.own(send);
    return record.terminal.promise;
  }

  async stop(): Promise<ServiceHostTerminal> {
    if (this.phase === "new") throw new Error("Service has not started");
    if (this.phase === "starting" || this.phase === "ready-acking" || this.phase === "ready") {
      this.phase = "stopping";
      for (const invocation of this.invocations.values()) {
        this.cancelInvocation(invocation, "CANCELLED", "Service Mount is stopping");
      }
      this.sendMountCancellation();
      this.mountGraceTimer ??= setTimeout(() => this.startTermination(), this.limits.cancellationGraceMs);
    }
    return this.completionDeferred.promise;
  }

  result(): Promise<ServiceHostTerminal> {
    if (this.phase === "new") throw new Error("Service has not started");
    return this.completionDeferred.promise;
  }

  private async runProcess(): Promise<void> {
    const stdout = this.readStdout();
    const stderr = this.readStderr();
    const [exitResult] = await Promise.all([
      settle(this.process.completion),
      settle(stdout),
      settle(stderr),
    ]);
    await settle(this.writeTail);
    await this.drainOwnedTasks();

    let exit: ExactComponentExit | undefined;
    if (exitResult.status === "rejected") {
      this.recordFailure("CHANNEL_LOST", `component completion failed: ${errorText(exitResult.reason)}`);
    } else {
      exit = exitResult.value;
    }
    const terminal = this.finish(exit);
    this.phase = terminal.status === "succeeded" ? "terminal" : "failed";
    this.clearActivationWatchers();
    const readinessError = new Error(
      terminal.status === "failed" ? `${terminal.code}: ${terminal.message}` : "Service ended before readiness",
    );
    if (!this.readinessSeen || terminal.status === "failed") this.readyDeferred.reject(readinessError);
    for (const invocation of [...this.invocations.values()]) {
      this.finishInvocation(
        invocation,
        invocation.cancellation === undefined
          ? failedInvocation("UNAVAILABLE", "Service Provider was lost")
          : failedInvocation(invocation.cancellation.code, invocation.cancellation.message),
      );
    }
    this.completionDeferred.resolve(terminal);
  }

  private async readStdout(): Promise<void> {
    let buffer = new Uint8Array(8_192);
    let length = 0;
    let discard = false;
    const ensureCapacity = (required: number): void => {
      if (buffer.byteLength >= required) return;
      let capacity = buffer.byteLength;
      while (capacity < required) capacity = Math.min(JSON_1_LIMITS.bytes, capacity * 2);
      const grown = new Uint8Array(capacity);
      grown.set(buffer.subarray(0, length));
      buffer = grown;
    };

    try {
      for await (const chunk of this.process.stdout) {
        this.stdoutLength += chunk.byteLength;
        if (this.stdoutLength > this.limits.stdoutBytes && !discard) {
          discard = true;
          this.fail("RESOURCE_EXHAUSTED", "Service stdout exceeded its host byte budget");
        }
        if (discard || this.hasProtocolFailure()) continue;
        let start = 0;
        for (let index = 0; index < chunk.byteLength; index += 1) {
          if (chunk[index] !== 0x0a) continue;
          const segment = chunk.subarray(start, index);
          const frameLength = length + segment.byteLength;
          if (frameLength > JSON_1_LIMITS.bytes) {
            discard = true;
            this.failProtocol("Provider emitted an oversized frame");
            break;
          }
          ensureCapacity(frameLength);
          buffer.set(segment, length);
          this.receiveFrame(buffer.subarray(0, frameLength));
          length = 0;
          start = index + 1;
          if (this.hasProtocolFailure()) {
            discard = true;
            break;
          }
        }
        if (discard) continue;
        if (start < chunk.byteLength) {
          const remainder = chunk.subarray(start);
          const nextLength = length + remainder.byteLength;
          if (nextLength > JSON_1_LIMITS.bytes) {
            discard = true;
            this.failProtocol("Provider emitted an oversized frame");
            continue;
          }
          ensureCapacity(nextLength);
          buffer.set(remainder, length);
          length = nextLength;
        }
      }
      if (!discard && length !== 0) this.failProtocol("Provider stdout ended with an incomplete frame");
      else if (!discard && this.mountTerminal === undefined && this.localFailure === undefined) {
        this.fail("CHANNEL_LOST", "Provider stdout closed before the Mount terminal");
      }
    } catch (error) {
      this.fail("CHANNEL_LOST", `Provider stdout failed: ${errorText(error)}`);
    }
  }

  private async readStderr(): Promise<void> {
    try {
      for await (const chunk of this.process.stderr) {
        this.stderrLength += chunk.byteLength;
        const remaining = this.limits.capturedStderrBytes - this.stderrKept;
        if (remaining > 0) {
          const kept = chunk.slice(0, remaining);
          this.stderrChunks.push(kept);
          this.stderrKept += kept.byteLength;
        }
        if (chunk.byteLength > Math.max(remaining, 0)) this.stderrTruncated = true;
        if (this.stderrLength > this.limits.stderrBytes) {
          this.fail("RESOURCE_EXHAUSTED", "Service stderr exceeded its host byte budget");
        }
      }
    } catch (error) {
      this.fail("CHANNEL_LOST", `Provider stderr failed: ${errorText(error)}`);
    }
  }

  private receiveFrame(bytes: Uint8Array): void {
    if (this.mountTerminal !== undefined) {
      this.failProtocol("Provider emitted a frame after the Mount terminal");
      return;
    }
    try {
      utf8.decode(bytes);
    } catch {
      this.failProtocol("Provider emitted invalid UTF-8");
      return;
    }
    let value: JsonValue;
    try {
      value = decodeJson1(bytes);
    } catch (error) {
      if (error instanceof Json1Error) {
        this.failProtocol(error.message, errorMessage(null, -32700, "Parse error"));
        return;
      }
      throw error;
    }
    let envelope: ParsedEnvelope;
    try {
      envelope = parseEnvelope(value);
    } catch (error) {
      this.failProtocol(errorText(error), errorMessage(null, -32600, "Invalid Request"));
      return;
    }
    if (envelope.kind === "request") this.receiveRequest(envelope);
    else if (envelope.kind === "notification") this.receiveNotification(envelope);
    else this.receiveResponse(envelope);
  }

  private receiveRequest(request: ParsedRequest): void {
    if (this.providerIds.has(request.id)) {
      this.failProtocol(`Provider reused request ID ${request.id}`);
      return;
    }
    if (this.providerIds.size >= MAX_REQUEST_IDS) {
      this.failProtocol("Provider exceeded the Service/1 request-ID lifetime limit");
      return;
    }
    this.providerIds.add(request.id);
    if (this.pendingProviderResponses >= MAX_PENDING_PROVIDER_REQUESTS) {
      this.queueProviderResponse(operationError(request.id, "RESOURCE_EXHAUSTED", "too many pending Provider requests"));
      return;
    }
    if (request.method === "service/ready") {
      this.receiveReady(request);
      return;
    }
    if (request.method === "flow/call" || request.method === "effect/call") {
      this.receiveProviderCall(request);
      return;
    }
    this.queueProviderResponse(errorMessage(request.id, -32601, "Method not found"));
  }

  private receiveReady(request: ParsedRequest): void {
    if (this.phase !== "starting" || !this.mountWritten || this.readinessSeen) {
      this.failProtocol("Provider sent readiness outside Mount initialization", errorMessage(request.id, -32600, "Invalid readiness"));
      return;
    }
    try {
      const params = requireObject(request.params, "service/ready params");
      requireExactKeys(params, ["ownerRequestId", "exports"]);
      if (requireWireId(params.ownerRequestId) !== MOUNT_ID) throw new Error("readiness has the wrong owner");
      const names = requireNameArray(params.exports);
      if (!sameStrings(names, this.activation.exports)) throw new Error("readiness export set differs from admission");
    } catch (error) {
      this.failProtocol(errorText(error), errorMessage(request.id, -32602, "Invalid params"));
      return;
    }
    this.readinessSeen = true;
    this.phase = "ready-acking";
    this.pendingProviderResponses += 1;
    const task = this.sendFrame({ jsonrpc: "2.0", id: request.id, result: {} }).then(
      () => {
        this.pendingProviderResponses -= 1;
        if (this.localFailure !== undefined || this.phase !== "ready-acking") return;
        this.phase = "ready";
        if (this.startupTimer !== undefined) clearTimeout(this.startupTimer);
        this.readyDeferred.resolve();
      },
      (error) => {
        this.pendingProviderResponses -= 1;
        this.fail("CHANNEL_LOST", `failed to acknowledge Service readiness: ${errorText(error)}`);
      },
    );
    this.own(task);
  }

  private receiveProviderCall(request: ParsedRequest): void {
    let ownerRequestId: string;
    let operationId: string;
    let signature: string;
    try {
      const parsed = parseProviderCall(request);
      ({ ownerRequestId, operationId, signature } = parsed);
    } catch {
      this.queueProviderResponse(errorMessage(request.id, -32602, "Invalid params"));
      return;
    }
    const ownerOpen = ownerRequestId === MOUNT_ID
      ? this.phase === "starting" || this.phase === "ready-acking" || this.phase === "ready"
      : this.invocations.get(ownerRequestId)?.phase === "open";
    if (!ownerOpen) {
      this.queueProviderResponse(operationError(request.id, "OWNER_CLOSED", "Service owner is closed"));
      return;
    }
    const key = `${ownerRequestId}\u0000${operationId}`;
    const prior = this.operations.get(key);
    if (prior !== undefined && prior.signature !== signature) {
      this.queueProviderResponse(operationError(request.id, "OPERATION_CONFLICT", "operationId was reused differently"));
      return;
    }
    if (prior === undefined) this.operations.set(key, { signature });
    this.queueProviderResponse(operationError(request.id, "UNAVAILABLE", "no child Flow or effect dispatcher is installed"));
  }

  private receiveNotification(notification: ParsedNotification): void {
    if (notification.method !== "request/cancel") return;
    try {
      const params = requireObject(notification.params, "request/cancel params");
      requireExactKeys(params, ["requestId"]);
      requireWireId(params.requestId);
    } catch (error) {
      this.failProtocol(`malformed request/cancel: ${errorText(error)}`);
    }
  }

  private receiveResponse(response: ParsedSuccess | ParsedError): void {
    if (response.id === MOUNT_ID) {
      this.receiveMountTerminal(response);
      return;
    }
    if (response.id === null) {
      this.failProtocol("Provider sent an uncorrelated error response");
      return;
    }
    const invocation = this.invocations.get(response.id);
    if (invocation === undefined || invocation.phase === "terminal") {
      this.failProtocol(`Provider responded with unknown or duplicate ID ${response.id}`);
      return;
    }
    if (invocation.phase !== "open") {
      this.failProtocol(`Provider responded before invocation ${response.id} was dispatched`);
      return;
    }
    let terminal: ServiceInvocationTerminal;
    try {
      terminal = response.kind === "success"
        ? parseInvocationResult(response.result)
        : parseInvocationFailure(response.error);
    } catch (error) {
      this.failProtocol(`invalid invocation response: ${errorText(error)}`);
      return;
    }
    if (invocation.cancellation !== undefined) {
      terminal = failedInvocation(invocation.cancellation.code, invocation.cancellation.message);
    }
    this.finishInvocation(invocation, terminal);
  }

  private receiveMountTerminal(response: ParsedSuccess | ParsedError): void {
    if (!this.mountWritten || this.mountTerminal !== undefined) {
      this.failProtocol("Provider sent an unknown or duplicate Mount response");
      return;
    }
    if (this.invocations.size !== 0 || this.pendingProviderResponses !== 0) {
      this.failProtocol("Provider ended the Mount before owned requests settled");
      return;
    }
    try {
      if (response.kind === "success") {
        const result = requireObject(response.result, "service/mount result");
        requireExactKeys(result, []);
        if (!this.readinessSeen) throw new Error("Provider returned Mount success before readiness");
        this.mountTerminal = { kind: "success" };
      } else {
        this.mountTerminal = parseMountFailure(response.error);
      }
    } catch (error) {
      this.failProtocol(`invalid Mount response: ${errorText(error)}`);
      return;
    }
    this.phase = "terminal";
    this.clearActivationWatchers();
    this.closeProtocolInput();
  }

  private queueProviderResponse(value: JsonObject): void {
    this.pendingProviderResponses += 1;
    const task = this.sendFrame(value).then(
      () => {
        this.pendingProviderResponses -= 1;
      },
      (error) => {
        this.pendingProviderResponses -= 1;
        this.fail("CHANNEL_LOST", `failed to respond to Provider: ${errorText(error)}`);
      },
    );
    this.own(task);
  }

  private armActivationCancellation(): void {
    if (this.activation.signal !== undefined) {
      this.abortListener = () => this.fail("CANCELLED", "Service Mount was cancelled");
      this.activation.signal.addEventListener("abort", this.abortListener, { once: true });
    }
  }

  private armStartupDeadline(): void {
    const remaining = this.activation.startupDeadlineUnixMs - Date.now();
    if (remaining <= 0) {
      queueMicrotask(() => this.fail("DEADLINE_EXCEEDED", "Service startup deadline elapsed"));
      return;
    }
    this.startupTimer = setTimeout(
      () => this.fail("DEADLINE_EXCEEDED", "Service startup deadline elapsed"),
      Math.min(remaining, 2_147_483_647),
    );
  }

  private armInvocation(invocation: InvocationRecord): void {
    const signal = invocation.request.signal;
    if (signal !== undefined) {
      invocation.abortListener = () => this.cancelInvocation(invocation, "CANCELLED", "Service invocation was cancelled");
      signal.addEventListener("abort", invocation.abortListener, { once: true });
      if (signal.aborted) invocation.abortListener();
    }
    const remaining = invocation.request.deadlineUnixMs - Date.now();
    if (remaining <= 0) {
      queueMicrotask(() => this.cancelInvocation(invocation, "DEADLINE_EXCEEDED", "Service invocation deadline elapsed"));
    } else {
      invocation.deadlineTimer = setTimeout(
        () => this.cancelInvocation(invocation, "DEADLINE_EXCEEDED", "Service invocation deadline elapsed"),
        Math.min(remaining, 2_147_483_647),
      );
    }
  }

  private cancelInvocation(
    invocation: InvocationRecord,
    code: "CANCELLED" | "DEADLINE_EXCEEDED",
    message: string,
  ): void {
    if (invocation.phase === "terminal" || invocation.cancellation !== undefined) return;
    invocation.cancellation = { code, message };
    if (invocation.phase === "queued") {
      this.finishInvocation(invocation, failedInvocation(code, message));
      return;
    }
    this.own(this.sendFrame(cancelMessage(invocation.id)).catch((error) => {
      this.fail("CHANNEL_LOST", `failed to cancel Service invocation: ${errorText(error)}`);
    }));
    invocation.graceTimer = setTimeout(() => this.startTermination(), this.limits.cancellationGraceMs);
  }

  private finishInvocation(invocation: InvocationRecord, terminal: ServiceInvocationTerminal): void {
    if (invocation.phase === "terminal") return;
    invocation.phase = "terminal";
    this.invocations.delete(invocation.id);
    if (invocation.deadlineTimer !== undefined) clearTimeout(invocation.deadlineTimer);
    if (invocation.graceTimer !== undefined) clearTimeout(invocation.graceTimer);
    if (invocation.request.signal !== undefined && invocation.abortListener !== undefined) {
      invocation.request.signal.removeEventListener("abort", invocation.abortListener);
    }
    invocation.terminal.resolve(terminal);
  }

  private sendMountCancellation(): void {
    if (!this.mountWritten || this.mountCancelSent || this.mountTerminal !== undefined) return;
    this.mountCancelSent = true;
    this.own(this.sendFrame(cancelMessage(MOUNT_ID)).catch((error) => {
      this.fail("CHANNEL_LOST", `failed to cancel Service Mount: ${errorText(error)}`);
    }));
  }

  private fail(code: RunHostFailureCode, message: string, details?: JsonValue): void {
    if (this.localFailure !== undefined || this.mountTerminal !== undefined) return;
    this.recordFailure(code, message, details);
    if (this.phase !== "new" && this.phase !== "terminal") this.phase = "stopping";
    for (const invocation of this.invocations.values()) {
      this.cancelInvocation(invocation, "CANCELLED", "Service Mount failed");
    }
    this.sendMountCancellation();
    this.readyDeferred.reject(new Error(`${code}: ${message}`));
    this.mountGraceTimer ??= setTimeout(() => this.startTermination(), this.limits.cancellationGraceMs);
    if (!this.mountWritten) this.startTermination();
  }

  private failProtocol(message: string, diagnostic?: JsonObject): void {
    if (this.localFailure !== undefined || this.mountTerminal !== undefined) return;
    this.recordFailure("PROTOCOL_ERROR", message);
    this.phase = "stopping";
    this.readyDeferred.reject(new Error(`PROTOCOL_ERROR: ${message}`));
    if (diagnostic === undefined) {
      this.startTermination();
      return;
    }
    this.own(this.sendFrame(diagnostic).then(
      () => this.startTermination(),
      () => this.startTermination(),
    ));
  }

  private recordFailure(code: RunHostFailureCode, message: string, details?: JsonValue): void {
    this.localFailure ??= { code, message, ...(details === undefined ? {} : { details }) };
  }

  private hasProtocolFailure(): boolean {
    return this.localFailure?.code === "PROTOCOL_ERROR";
  }

  private sendFrame(
    value: JsonObject,
    onWriteStart?: () => void,
    shouldWrite: () => boolean = () => true,
  ): Promise<void> {
    const payload = canonicalJson(value);
    const line = new Uint8Array(payload.byteLength + 1);
    line.set(payload);
    line[payload.byteLength] = 0x0a;
    const write = this.writeTail.then(() => {
      if (!shouldWrite()) return;
      onWriteStart?.();
      return this.process.write(line);
    });
    this.writeTail = write.catch(() => undefined);
    return write;
  }

  private closeProtocolInput(): void {
    if (this.inputClosed) return;
    this.inputClosed = true;
    this.own(this.writeTail.then(() => this.process.closeInput()).catch((error) => {
      this.recordFailure("CHANNEL_LOST", `failed to close Provider stdin: ${errorText(error)}`);
      this.startTermination();
    }));
  }

  private startTermination(): void {
    if (this.terminateStarted) return;
    this.terminateStarted = true;
    this.own(this.process.terminate().catch((error) => {
      this.recordFailure("CHANNEL_LOST", `failed to terminate Provider: ${errorText(error)}`);
    }));
  }

  private finish(exit: ExactComponentExit | undefined): ServiceHostTerminal {
    const diagnostics = this.diagnostics();
    const failure = (
      code: RunHostFailureCode,
      message: string,
      details?: JsonValue,
    ): ServiceHostTerminal => ({
      status: "failed",
      code,
      message,
      ...(details === undefined ? {} : { details }),
      diagnostics,
    });
    if (this.localFailure !== undefined) {
      return failure(this.localFailure.code, this.localFailure.message, this.localFailure.details);
    }
    if (exit === undefined) return failure("CHANNEL_LOST", "Provider completion was unavailable");
    if (exit.cleanupError !== undefined || !exit.fenced) {
      return failure("EXECUTION_FAILED", "Provider cleanup or fencing failed");
    }
    if (exit.exitCode !== 0 || exit.signal !== null) {
      return failure("EXECUTION_FAILED", `Provider exited with code ${String(exit.exitCode)} and signal ${String(exit.signal)}`);
    }
    if (this.mountTerminal === undefined) return failure("CHANNEL_LOST", "Provider exited before the Mount terminal");
    if (this.mountTerminal.kind === "failure") {
      return failure(this.mountTerminal.code, this.mountTerminal.message, this.mountTerminal.details);
    }
    if (this.invocations.size !== 0 || this.pendingProviderResponses !== 0) {
      return failure("EXECUTION_FAILED", "Provider exited with pending owned work");
    }
    return { status: "succeeded", diagnostics };
  }

  private diagnostics(): RunDiagnostics {
    const bytes = new Uint8Array(this.stderrKept);
    let offset = 0;
    for (const chunk of this.stderrChunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      stderr: new TextDecoder().decode(bytes),
      stderrBytes: this.stderrLength,
      stderrTruncated: this.stderrTruncated,
    };
  }

  private clearActivationWatchers(): void {
    if (this.startupTimer !== undefined) clearTimeout(this.startupTimer);
    if (this.mountGraceTimer !== undefined) clearTimeout(this.mountGraceTimer);
    if (this.activation.signal !== undefined && this.abortListener !== undefined) {
      this.activation.signal.removeEventListener("abort", this.abortListener);
    }
  }

  private own(task: Promise<void>): void {
    this.ownedTasks.add(task);
    void task.finally(() => this.ownedTasks.delete(task)).catch(() => undefined);
  }

  private async drainOwnedTasks(): Promise<void> {
    while (this.ownedTasks.size !== 0) await Promise.allSettled([...this.ownedTasks]);
  }
}

function mountRequest(activation: ServiceHostActivation): JsonObject {
  return {
    jsonrpc: "2.0",
    id: MOUNT_ID,
    method: "service/mount",
    params: {
      protocol: "service/1",
      settings: activation.settings,
      attachments: activation.attachments as unknown as JsonObject,
      scratch: activation.scratch,
      startupDeadlineUnixMs: activation.startupDeadlineUnixMs,
    },
  };
}

function snapshotActivation(activation: ServiceHostActivation): ServiceHostActivation {
  const settings = snapshotJson(activation.settings) as JsonObject;
  const attachments = snapshotJson(activation.attachments as unknown as JsonValue) as unknown as Readonly<Record<string, RunAttachment>>;
  return Object.freeze({
    settings: Object.freeze(settings),
    attachments: Object.freeze(attachments),
    scratch: activation.scratch,
    startupDeadlineUnixMs: activation.startupDeadlineUnixMs,
    exports: Object.freeze([...activation.exports]),
    ...(activation.signal === undefined ? {} : { signal: activation.signal }),
  });
}

function snapshotInvocation(request: ServiceHostInvocation): ServiceHostInvocation {
  return Object.freeze({
    exportName: request.exportName,
    method: request.method,
    input: snapshotJson(request.input),
    deadlineUnixMs: request.deadlineUnixMs,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
}

function snapshotJson<T extends JsonValue>(value: T): T {
  return decodeJson1(canonicalJson(value)) as T;
}

function invokeRequest(id: string, request: ServiceHostInvocation): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    method: "service/invoke",
    params: {
      export: request.exportName,
      method: request.method,
      input: request.input,
      deadlineUnixMs: request.deadlineUnixMs,
    },
  };
}

function cancelMessage(requestId: string): JsonObject {
  return { jsonrpc: "2.0", method: "request/cancel", params: { requestId } };
}

function validateActivation(activation: ServiceHostActivation): void {
  validateJson1(activation.settings);
  if (activation.settings === null || Array.isArray(activation.settings) || typeof activation.settings !== "object") {
    throw new TypeError("settings must be an object");
  }
  validateAttachments(activation.attachments);
  if (typeof activation.scratch !== "string" || activation.scratch.length === 0) throw new TypeError("scratch must be nonempty");
  validateDeadline(activation.startupDeadlineUnixMs, "startupDeadlineUnixMs");
  if (!Array.isArray(activation.exports) || activation.exports.length === 0 || activation.exports.length > 256) {
    throw new TypeError("Service requires 1-256 exports");
  }
  let previous: string | undefined;
  for (const name of activation.exports) {
    requireLocalName(name);
    if (previous !== undefined && previous >= name) throw new TypeError("Service exports must be unique and sorted");
    previous = name;
  }
  canonicalJson(mountRequest(activation));
}

function validateInvocation(request: ServiceHostInvocation): void {
  requireLocalName(request.exportName);
  requireLocalName(request.method);
  validateJson1(request.input);
  validateDeadline(request.deadlineUnixMs, "deadlineUnixMs");
}

function validateAttachments(attachments: Readonly<Record<string, RunAttachment>>): void {
  if (attachments === null || Array.isArray(attachments) || typeof attachments !== "object") {
    throw new TypeError("attachments must be an object");
  }
  const entries = Object.entries(attachments);
  if (entries.length > 256) throw new TypeError("at most 256 attachments are allowed");
  for (const [name, attachment] of entries) {
    requireLocalName(name);
    if (attachment === null || Array.isArray(attachment) || typeof attachment !== "object") throw new TypeError("attachment must be an object");
    requireExactKeys(attachment as unknown as JsonObject, ["path", "access"]);
    if (typeof attachment.path !== "string" || attachment.path.length === 0) throw new TypeError("attachment path must be nonempty");
    if (attachment.access !== "read" && attachment.access !== "read-write") throw new TypeError("invalid attachment access");
  }
}

function validateLimits(limits: ServiceHostLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`invalid Service host limit ${name}`);
  }
  if (limits.stdoutBytes < JSON_1_LIMITS.bytes + 1) throw new TypeError("stdoutBytes must admit one maximum-size frame and LF");
  if (limits.cancellationGraceMs > 2_147_483_647) throw new TypeError("cancellationGraceMs exceeds the timer range");
}

function validateDeadline(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a nonnegative safe integer`);
}

function parseProviderCall(request: ParsedRequest): {
  readonly ownerRequestId: string;
  readonly operationId: string;
  readonly signature: string;
} {
  const params = requireObject(request.params, `${request.method} params`);
  if (request.method === "flow/call") {
    requireExactKeys(params, Object.hasOwn(params, "intent")
      ? ["ownerRequestId", "operationId", "slot", "intent", "input"]
      : ["ownerRequestId", "operationId", "slot", "input"]);
    requireLocalName(params.slot);
    if (Object.hasOwn(params, "intent")) {
      if (typeof params.intent !== "string" || scalarLength(params.intent) < 1 || scalarLength(params.intent) > 16_384) {
        throw new Error("invalid intent");
      }
    }
  } else {
    requireExactKeys(params, ["ownerRequestId", "operationId", "slot", "method", "input"]);
    requireLocalName(params.slot);
    requireLocalName(params.method);
  }
  const ownerRequestId = requireWireId(params.ownerRequestId);
  const operationId = requireWireId(params.operationId);
  return { ownerRequestId, operationId, signature: operationSignature(request.method, params) };
}

function operationSignature(method: string, params: JsonObject): string {
  const semantic: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const [key, value] of Object.entries(params)) {
    if (key !== "operationId" && key !== "ownerRequestId") semantic[key] = value;
  }
  return createHash("sha256").update(canonicalJson({ method, params: semantic })).digest("hex");
}

function parseInvocationResult(value: JsonValue): ServiceInvocationTerminal {
  const result = requireObject(value, "Service invocation result");
  if (Object.hasOwn(result, "value")) {
    requireExactKeys(result, ["value"]);
    return { status: "succeeded", value: result.value! };
  }
  requireExactKeys(result, ["error"]);
  const error = requireObject(result.error, "Service application error");
  requireExactKeys(error, ["name", "data"]);
  return { status: "application-error", name: requireLocalName(error.name), data: error.data! };
}

function parseInvocationFailure(error: ParsedError["error"]): ServiceInvocationTerminal {
  const failure = parseWireFailure(error);
  return failedInvocation(failure.code, failure.message, failure.details);
}

function parseMountFailure(error: ParsedError["error"]): {
  readonly kind: "failure";
  readonly code: WireFailureCode;
  readonly message: string;
  readonly details?: JsonValue;
} {
  return { kind: "failure", ...parseWireFailure(error) };
}

function parseWireFailure(error: ParsedError["error"]): {
  readonly code: WireFailureCode;
  readonly message: string;
  readonly details?: JsonValue;
} {
  if (error.code !== -32000 || error.data === undefined) throw new Error("standard JSON-RPC errors cannot settle Service operations");
  const data = requireObject(error.data, "operation error data");
  requireExactKeys(data, Object.hasOwn(data, "details") ? ["code", "details"] : ["code"]);
  if (typeof data.code !== "string" || !WIRE_FAILURE_CODES.has(data.code as WireFailureCode)) throw new Error("unknown operation error code");
  return {
    code: data.code as WireFailureCode,
    message: error.message,
    ...(Object.hasOwn(data, "details") ? { details: data.details } : {}),
  };
}

function failedInvocation(code: RunHostFailureCode, message: string, details?: JsonValue): ServiceInvocationTerminal {
  return { status: "failed", code, message, ...(details === undefined ? {} : { details }) };
}

function parseEnvelope(value: JsonValue): ParsedEnvelope {
  const object = requireObject(value, "JSON-RPC envelope");
  if (object.jsonrpc !== "2.0") throw new Error("invalid JSON-RPC version");
  const hasMethod = Object.hasOwn(object, "method");
  const hasId = Object.hasOwn(object, "id");
  const hasResult = Object.hasOwn(object, "result");
  const hasError = Object.hasOwn(object, "error");
  if (hasMethod) {
    if (typeof object.method !== "string") throw new Error("method must be a string");
    const hasParams = Object.hasOwn(object, "params");
    if (hasParams && (object.params === null || typeof object.params !== "object")) throw new Error("JSON-RPC params must be structured");
    requireExactKeys(object, hasId
      ? hasParams ? ["jsonrpc", "id", "method", "params"] : ["jsonrpc", "id", "method"]
      : hasParams ? ["jsonrpc", "method", "params"] : ["jsonrpc", "method"]);
    if (hasId) return { kind: "request", id: requireWireId(object.id), method: object.method, ...(hasParams ? { params: object.params } : {}) };
    return { kind: "notification", method: object.method, ...(hasParams ? { params: object.params } : {}) };
  }
  if (!hasId || hasResult === hasError) throw new Error("invalid response envelope");
  requireExactKeys(object, hasResult ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"]);
  if (hasResult) return { kind: "success", id: requireWireId(object.id), result: object.result! };
  return { kind: "error", id: object.id === null ? null : requireWireId(object.id), error: parseErrorPayload(object.error!) };
}

function parseErrorPayload(value: JsonValue): ParsedError["error"] {
  const object = requireObject(value, "JSON-RPC error");
  requireExactKeys(object, Object.hasOwn(object, "data") ? ["code", "message", "data"] : ["code", "message"]);
  if (!Number.isSafeInteger(object.code)) throw new Error("invalid error code");
  if (typeof object.message !== "string" || scalarLength(object.message) < 1 || scalarLength(object.message) > 1_024) throw new Error("invalid error message");
  return { code: object.code as number, message: object.message, ...(Object.hasOwn(object, "data") ? { data: object.data } : {}) };
}

function errorMessage(id: string | null, code: number, message: string): JsonObject {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function operationError(id: string, code: WireFailureCode, message: string): JsonObject {
  return { jsonrpc: "2.0", id, error: { code: -32000, message, data: { code } } };
}

function requireObject(value: JsonValue | undefined, description: string): JsonObject {
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== "object") throw new Error(`${description} must be an object`);
  return value as JsonObject;
}

function requireExactKeys(object: JsonObject, expected: readonly string[]): void {
  const actual = Object.keys(object).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(`unexpected object members: ${actual.join(", ")}`);
}

function requireNameArray(value: JsonValue | undefined): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) throw new Error("invalid Service exports");
  const names: string[] = [];
  let previous: string | undefined;
  for (const raw of value) {
    const name = requireLocalName(raw);
    if (previous !== undefined && previous >= name) throw new Error("Service exports must be unique and sorted");
    names.push(name);
    previous = name;
  }
  return names;
}

function requireWireId(value: JsonValue | undefined): string {
  if (typeof value !== "string" || value.length > 128 || !WIRE_ID.test(value) || encoder.encode(value).byteLength > 128) throw new Error("invalid Service/1 request ID");
  return value;
}

function requireLocalName(value: JsonValue | undefined): string {
  if (typeof value !== "string" || value.length > 64 || !LOCAL_NAME.test(value)) throw new Error("invalid LocalName");
  return value;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}
