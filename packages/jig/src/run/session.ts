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

const ROOT_ID = "host:1";
const MAX_PENDING_COMPONENT_REQUESTS = 64;
const MAX_COMPONENT_REQUEST_IDS = 65_536;
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

export type WireFailureCode =
  | "CANCELLED"
  | "DEADLINE_EXCEEDED"
  | "OWNER_CLOSED"
  | "OPERATION_CONFLICT"
  | "UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "RESOURCE_EXHAUSTED"
  | "INVALID_INPUT"
  | "INVALID_RESULT"
  | "UNCERTAIN"
  | "EXECUTION_FAILED";

export type RunHostFailureCode = WireFailureCode | "PROTOCOL_ERROR" | "CHANNEL_LOST";

export interface RunAttachment {
  readonly path: string;
  readonly access: "read" | "read-write";
}

export interface RunResult {
  readonly outcome: string;
  readonly output: JsonValue;
}

export interface RunHostInvocation {
  readonly input: JsonValue;
  readonly settings: JsonObject;
  readonly attachments: Readonly<Record<string, RunAttachment>>;
  readonly scratch: string;
  readonly deadlineUnixMs: number;
  readonly signal?: AbortSignal;
}

export interface RunHostLimits {
  readonly cancellationGraceMs: number;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly capturedStderrBytes: number;
}

export interface ExactComponentExit {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly fenced: boolean;
  readonly cleanupError?: unknown;
}

/** Private seam supplied by the Sandbox Backend after exact activation. */
export interface ExactComponentProcess {
  readonly stdout: AsyncIterable<Uint8Array>;
  readonly stderr: AsyncIterable<Uint8Array>;
  readonly completion: Promise<ExactComponentExit>;
  write(bytes: Uint8Array): Promise<void>;
  closeInput(): Promise<void>;
  terminate(): Promise<void>;
}

export interface RunDiagnostics {
  readonly stderr: string;
  readonly stderrBytes: number;
  readonly stderrTruncated: boolean;
}

export type RunHostTerminal =
  | {
      readonly status: "succeeded";
      readonly result: RunResult;
      readonly diagnostics: RunDiagnostics;
    }
  | {
      readonly status: "failed";
      readonly code: RunHostFailureCode;
      readonly message: string;
      readonly details?: JsonValue;
      readonly diagnostics: RunDiagnostics;
    };

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

interface RootSuccess {
  readonly kind: "success";
  readonly result: RunResult;
}

interface RootFailure {
  readonly kind: "failure";
  readonly code: WireFailureCode;
  readonly message: string;
  readonly details?: JsonValue;
}

type RootTerminal = RootSuccess | RootFailure;

interface OperationRecord {
  readonly signature: string;
}

interface LocalTerminal {
  readonly code: WireFailureCode;
  readonly message: string;
}

const DEFAULT_LIMITS: RunHostLimits = Object.freeze({
  cancellationGraceMs: 1_000,
  stdoutBytes: 64 * 1024 * 1024,
  stderrBytes: 16 * 1024 * 1024,
  capturedStderrBytes: 64 * 1024,
});

/**
 * One pre-release host session for one already selected and sandboxed process.
 * It deliberately has no child-Flow or effect dispatcher yet.
 */
export class RunHostSession {
  private readonly limits: RunHostLimits;
  private readonly componentIds = new Set<string>();
  private readonly operations = new Map<string, OperationRecord>();
  private readonly stderrChunks: Uint8Array[] = [];
  private readonly ownedTasks = new Set<Promise<void>>();
  private writeTail: Promise<void> = Promise.resolve();
  private rootWritten = false;
  private rootOpen = false;
  private rootResponse?: RootTerminal;
  private localTerminal?: LocalTerminal;
  private protocolFailure?: string;
  private channelFailure?: string;
  private pendingResponses = 0;
  private responseOverflowed = false;
  private stderrLength = 0;
  private stderrKept = 0;
  private stderrTruncated = false;
  private stdoutLength = 0;
  private inputClosed = false;
  private cancelSent = false;
  private terminateStarted = false;
  private postResponseTermination = false;
  private started = false;
  private deadlineTimer?: ReturnType<typeof setTimeout>;
  private graceTimer?: ReturnType<typeof setTimeout>;
  private abortListener?: () => void;

  constructor(
    private readonly process: ExactComponentProcess,
    private readonly invocation: RunHostInvocation,
    limits: Partial<RunHostLimits> = {},
  ) {
    this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits });
    validateLimits(this.limits);
    validateInvocation(invocation);
  }

  async run(): Promise<RunHostTerminal> {
    if (this.started) throw new Error("RunHostSession is single-use");
    this.started = true;
    const stdout = this.readStdout();
    const stderr = this.readStderr();
    this.armCancellation();

    try {
      if (this.invocation.signal?.aborted) {
        this.observeCancellation("CANCELLED", "root Run was cancelled before dispatch");
      } else if (Date.now() >= this.invocation.deadlineUnixMs) {
        this.observeCancellation("DEADLINE_EXCEEDED", "root Run deadline elapsed before dispatch");
      } else {
        try {
          await this.sendFrame(rootRequest(this.invocation), () => {
            // Ownership begins immediately before the serialized transport
            // write. A peer may receive and answer before that write Promise
            // settles, but output preceding this point is premature.
            this.rootWritten = true;
            this.rootOpen = this.localTerminal === undefined &&
              this.protocolFailure === undefined && this.channelFailure === undefined;
          });
          if (this.rootResponse === undefined && (
            this.localTerminal?.code === "CANCELLED" ||
            this.localTerminal?.code === "DEADLINE_EXCEEDED"
          )) {
            this.sendRootCancellation();
          }
        } catch (error) {
          this.rootOpen = false;
          this.recordChannelFailure(`failed to write flow/run: ${errorText(error)}`);
          this.startTermination();
        }
      }

      const [exitResult] = await Promise.all([
        settle(this.process.completion),
        settle(stdout),
        settle(stderr),
      ]);
      await settle(this.writeTail);
      await this.drainOwnedTasks();

      if (exitResult.status === "rejected") {
        this.recordChannelFailure(`component completion failed: ${errorText(exitResult.reason)}`);
        return this.finish(undefined);
      }
      return this.finish(exitResult.value);
    } finally {
      this.clearWatchers();
    }
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
          this.recordResourceFailure("component stdout exceeded its host byte budget");
          this.startTermination();
        }
        if (discard || this.protocolFailure !== undefined) continue;

        let start = 0;
        for (let index = 0; index < chunk.byteLength; index += 1) {
          if (chunk[index] !== 0x0a) continue;
          const segment = chunk.subarray(start, index);
          const frameLength = length + segment.byteLength;
          if (frameLength > JSON_1_LIMITS.bytes) {
            discard = true;
            this.failProtocol("component emitted an oversized frame");
            break;
          }
          ensureCapacity(frameLength);
          buffer.set(segment, length);
          this.receiveFrame(buffer.subarray(0, frameLength));
          length = 0;
          start = index + 1;
          if (this.protocolFailure !== undefined) {
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
            this.failProtocol("component emitted an oversized frame");
            continue;
          }
          ensureCapacity(nextLength);
          buffer.set(remainder, length);
          length = nextLength;
        }
      }
      if (!discard && length !== 0) {
        this.failProtocol("component stdout ended with an incomplete frame");
      } else if (
        !discard &&
        this.rootResponse === undefined &&
        this.localTerminal === undefined &&
        this.protocolFailure === undefined
      ) {
        this.recordChannelFailure("component stdout closed before a root response");
        this.startTermination();
      }
    } catch (error) {
      this.recordChannelFailure(`component stdout failed: ${errorText(error)}`);
      this.startTermination();
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
        if (this.stderrLength > this.limits.stderrBytes && this.localTerminal === undefined) {
          this.recordResourceFailure("component stderr exceeded its host byte budget");
          this.startTermination();
        }
      }
    } catch (error) {
      this.recordChannelFailure(`component stderr failed: ${errorText(error)}`);
      this.startTermination();
    }
  }

  private receiveFrame(bytes: Uint8Array): void {
    if (this.rootResponse !== undefined) {
      this.failProtocol("component emitted a frame after its root terminal response");
      return;
    }

    try {
      utf8.decode(bytes);
    } catch {
      this.failProtocol("component emitted invalid UTF-8");
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

    switch (envelope.kind) {
      case "request":
        this.receiveRequest(envelope);
        return;
      case "notification":
        this.receiveNotification(envelope);
        return;
      case "success":
        this.receiveRootSuccess(envelope);
        return;
      case "error":
        this.receiveRootError(envelope);
        return;
    }
  }

  private receiveRequest(request: ParsedRequest): void {
    if (this.componentIds.has(request.id)) {
      this.failProtocol(`component reused request ID ${request.id}`);
      return;
    }
    if (this.componentIds.size >= MAX_COMPONENT_REQUEST_IDS) {
      this.failProtocol("component exceeded the Run/1 request-ID lifetime limit");
      return;
    }
    this.componentIds.add(request.id);

    if (this.responseOverflowed) return;
    if (this.pendingResponses >= MAX_PENDING_COMPONENT_REQUESTS) {
      this.responseOverflowed = true;
      this.recordResourceFailure("too many pending component response writes");
      this.queueResponse(
        request.id,
        operationError(request.id, "RESOURCE_EXHAUSTED", "too many pending component requests"),
      );
      this.graceTimer ??= setTimeout(() => this.startTermination(), this.limits.cancellationGraceMs);
      return;
    }

    if (request.method !== "flow/call" && request.method !== "effect/call") {
      this.queueResponse(request.id, errorMessage(request.id, -32601, "Method not found"));
      return;
    }

    let operation: { readonly operationId: string; readonly signature: string };
    try {
      operation = parseUnavailableOperation(request);
    } catch {
      this.queueResponse(request.id, errorMessage(request.id, -32602, "Invalid params"));
      return;
    }

    if (!this.rootOpen || this.localTerminal !== undefined) {
      this.queueResponse(
        request.id,
        operationError(request.id, "OWNER_CLOSED", "root Run is not accepting work"),
      );
      return;
    }

    const prior = this.operations.get(operation.operationId);
    if (prior !== undefined && prior.signature !== operation.signature) {
      this.queueResponse(
        request.id,
        operationError(request.id, "OPERATION_CONFLICT", "operationId was reused differently"),
      );
      return;
    }
    if (prior === undefined) this.operations.set(operation.operationId, { signature: operation.signature });
    this.queueResponse(
      request.id,
      operationError(request.id, "UNAVAILABLE", "no child Flow or effect dispatcher is installed"),
    );
  }

  private receiveNotification(notification: ParsedNotification): void {
    if (notification.method !== "request/cancel") return;
    try {
      const params = requireObject(notification.params, "request/cancel params");
      requireExactKeys(params, ["requestId"]);
      requireWireId(params.requestId);
      // Every host decision in this initial no-dispatch slice is immediate.
      // A later cancellation therefore targets an already-terminal waiter.
    } catch (error) {
      this.failProtocol(`malformed request/cancel: ${errorText(error)}`);
    }
  }

  private receiveRootSuccess(response: ParsedSuccess): void {
    if (response.id !== ROOT_ID || !this.rootWritten) {
      this.failProtocol(`unknown response ID ${response.id}`);
      return;
    }
    if (this.pendingResponses !== 0) {
      this.failProtocol("component returned its root result before owned requests settled");
      return;
    }
    let result: RunResult;
    try {
      result = parseRunResult(response.result);
    } catch (error) {
      this.failProtocol(`invalid root result: ${errorText(error)}`);
      return;
    }
    this.rootOpen = false;
    this.rootResponse = { kind: "success", result };
    this.closeProtocolInput();
  }

  private receiveRootError(response: ParsedError): void {
    if (response.id !== ROOT_ID || !this.rootWritten) {
      this.failProtocol(`unknown response ID ${String(response.id)}`);
      return;
    }
    if (this.pendingResponses !== 0) {
      this.failProtocol("component returned its root error before owned requests settled");
      return;
    }
    let failure: RootFailure;
    try {
      failure = parseRootFailure(response.error);
    } catch (error) {
      this.failProtocol(`invalid root error: ${errorText(error)}`);
      return;
    }
    this.rootOpen = false;
    this.rootResponse = failure;
    this.closeProtocolInput();
  }

  private queueResponse(id: string, value: JsonObject): void {
    this.pendingResponses += 1;
    this.own(this.sendFrame(value, () => {
      // The response decision is terminal when it reaches the transport, not
      // when an adapter-specific write completion callback eventually fires.
      this.pendingResponses -= 1;
    }).then(
      () => undefined,
      (error) => {
        this.recordChannelFailure(`failed to respond to ${id}: ${errorText(error)}`);
        this.startTermination();
      },
    ));
  }

  private sendFrame(value: JsonObject, onWriteStart?: () => void): Promise<void> {
    const payload = canonicalJson(value);
    const line = new Uint8Array(payload.byteLength + 1);
    line.set(payload);
    line[payload.byteLength] = 0x0a;
    const write = this.writeTail.then(() => {
      onWriteStart?.();
      return this.process.write(line);
    });
    this.writeTail = write.catch(() => undefined);
    return write;
  }

  private failProtocol(message: string, response?: JsonObject): void {
    if (this.protocolFailure !== undefined) return;
    this.protocolFailure = message;
    this.rootOpen = false;
    if (response === undefined) {
      this.startTermination();
      return;
    }
    const bestEffort = this.sendFrame(response).catch(() => undefined);
    this.own(bestEffort.then(() => this.startTermination()));
    this.graceTimer ??= setTimeout(() => this.startTermination(), this.limits.cancellationGraceMs);
  }

  private recordResourceFailure(message: string): void {
    if (this.channelFailure !== undefined) return;
    this.localTerminal ??= { code: "RESOURCE_EXHAUSTED", message };
    this.rootOpen = false;
  }

  private recordChannelFailure(message: string): void {
    if (this.localTerminal !== undefined) return;
    this.channelFailure ??= message;
    this.rootOpen = false;
  }

  private armCancellation(): void {
    const signal = this.invocation.signal;
    if (signal !== undefined) {
      this.abortListener = () => this.observeCancellation("CANCELLED", "root Run was cancelled");
      signal.addEventListener("abort", this.abortListener, { once: true });
    }
    this.armDeadlineTimer();
  }

  private armDeadlineTimer(): void {
    const remaining = this.invocation.deadlineUnixMs - Date.now();
    if (remaining <= 0) {
      queueMicrotask(() => this.observeCancellation("DEADLINE_EXCEEDED", "root Run deadline elapsed"));
      return;
    }
    const delay = Math.min(remaining, 2_147_483_647);
    this.deadlineTimer = setTimeout(() => {
      if (Date.now() >= this.invocation.deadlineUnixMs) {
        this.observeCancellation("DEADLINE_EXCEEDED", "root Run deadline elapsed");
      } else {
        this.armDeadlineTimer();
      }
    }, delay);
  }

  private observeCancellation(code: "CANCELLED" | "DEADLINE_EXCEEDED", message: string): void {
    if (this.rootResponse !== undefined) {
      // A committed response wins a later cancellation. The absolute deadline
      // still bounds process cleanup, but only an actual forced termination
      // invalidates that response.
      if (code === "DEADLINE_EXCEEDED") {
        this.graceTimer ??= setTimeout(() => this.startTermination(), this.limits.cancellationGraceMs);
      }
      return;
    }
    if (this.channelFailure === undefined) this.localTerminal ??= { code, message };
    this.rootOpen = false;
    if (this.rootWritten && this.rootResponse === undefined) this.sendRootCancellation();
    if (!this.rootWritten) {
      this.startTermination();
      return;
    }
    this.graceTimer ??= setTimeout(() => this.startTermination(), this.limits.cancellationGraceMs);
  }

  private sendRootCancellation(): void {
    if (this.cancelSent) return;
    this.cancelSent = true;
    this.own(this.sendFrame({
      jsonrpc: "2.0",
      method: "request/cancel",
      params: { requestId: ROOT_ID },
    }).catch((error) => {
      this.recordChannelFailure(`failed to cancel root Run: ${errorText(error)}`);
      this.startTermination();
    }));
  }

  private closeProtocolInput(): void {
    if (this.inputClosed) return;
    this.inputClosed = true;
    this.own(this.writeTail.then(() => this.process.closeInput()).catch((error) => {
      this.recordChannelFailure(`failed to close component stdin: ${errorText(error)}`);
      this.startTermination();
    }));
  }

  private startTermination(): void {
    if (this.terminateStarted) return;
    this.terminateStarted = true;
    if (this.rootResponse !== undefined) this.postResponseTermination = true;
    this.own(this.process.terminate().catch((error) => {
      this.recordChannelFailure(`failed to terminate component: ${errorText(error)}`);
    }));
  }

  private finish(exit: ExactComponentExit | undefined): RunHostTerminal {
    const diagnostics = this.diagnostics();
    const failure = (
      code: RunHostFailureCode,
      message: string,
      details?: JsonValue,
    ): RunHostTerminal => ({
      status: "failed",
      code,
      message,
      ...(details === undefined ? {} : { details }),
      diagnostics,
    });

    if (this.protocolFailure !== undefined) {
      return failure("PROTOCOL_ERROR", this.protocolFailure);
    }
    if (this.channelFailure !== undefined) {
      return failure("CHANNEL_LOST", this.channelFailure);
    }
    if (exit === undefined) {
      return failure("CHANNEL_LOST", "component completion was unavailable");
    }
    if (exit?.cleanupError !== undefined || exit?.fenced !== true) {
      return failure("EXECUTION_FAILED", "component cleanup or fencing failed");
    }
    if (this.localTerminal !== undefined) {
      return failure(this.localTerminal.code, this.localTerminal.message);
    }
    if (this.postResponseTermination) {
      return failure("EXECUTION_FAILED", "component did not quiesce after its terminal response");
    }
    if (exit.exitCode !== 0 || exit.signal !== null) {
      return failure(
        "EXECUTION_FAILED",
        `component exited with code ${String(exit.exitCode)} and signal ${String(exit.signal)}`,
      );
    }
    if (this.rootResponse === undefined) {
      return failure("CHANNEL_LOST", "component exited before a root response");
    }
    if (this.pendingResponses !== 0) {
      return failure("EXECUTION_FAILED", "component exited with pending owned protocol work");
    }
    if (this.rootResponse.kind === "failure") {
      return failure(
        this.rootResponse.code,
        this.rootResponse.message,
        this.rootResponse.details,
      );
    }
    return { status: "succeeded", result: this.rootResponse.result, diagnostics };
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

  private clearWatchers(): void {
    if (this.deadlineTimer !== undefined) clearTimeout(this.deadlineTimer);
    if (this.graceTimer !== undefined) clearTimeout(this.graceTimer);
    if (this.invocation.signal !== undefined && this.abortListener !== undefined) {
      this.invocation.signal.removeEventListener("abort", this.abortListener);
    }
  }

  private own(task: Promise<void>): void {
    this.ownedTasks.add(task);
    void task.then(
      () => this.ownedTasks.delete(task),
      () => this.ownedTasks.delete(task),
    );
  }

  private async drainOwnedTasks(): Promise<void> {
    while (this.ownedTasks.size !== 0) {
      await Promise.allSettled([...this.ownedTasks]);
    }
  }
}

function rootRequest(invocation: RunHostInvocation): JsonObject {
  return {
    jsonrpc: "2.0",
    id: ROOT_ID,
    method: "flow/run",
    params: {
      protocol: "run/1",
      input: invocation.input,
      settings: invocation.settings,
      attachments: invocation.attachments as unknown as JsonObject,
      scratch: invocation.scratch,
      deadlineUnixMs: invocation.deadlineUnixMs,
    },
  };
}

function validateInvocation(invocation: RunHostInvocation): void {
  validateJson1(invocation.input);
  validateJson1(invocation.settings);
  if (
    invocation.settings === null ||
    Array.isArray(invocation.settings) ||
    typeof invocation.settings !== "object"
  ) {
    throw new TypeError("settings must be an object");
  }
  if (
    invocation.attachments === null ||
    Array.isArray(invocation.attachments) ||
    typeof invocation.attachments !== "object"
  ) {
    throw new TypeError("attachments must be an object");
  }
  const attachments = Object.entries(invocation.attachments);
  if (attachments.length > 256) throw new TypeError("at most 256 attachments are allowed");
  for (const [name, attachment] of attachments) {
    requireLocalName(name);
    if (attachment === null || Array.isArray(attachment) || typeof attachment !== "object") {
      throw new TypeError("attachment must be an object");
    }
    const keys = Object.keys(attachment).sort();
    if (keys.length !== 2 || keys[0] !== "access" || keys[1] !== "path") {
      throw new TypeError("attachment must contain exactly path and access");
    }
    if (typeof attachment.path !== "string" || attachment.path.length === 0) {
      throw new TypeError("attachment paths must be nonempty");
    }
    if (attachment.access !== "read" && attachment.access !== "read-write") {
      throw new TypeError("invalid attachment access");
    }
  }
  if (typeof invocation.scratch !== "string" || invocation.scratch.length === 0) {
    throw new TypeError("scratch must be nonempty");
  }
  if (!Number.isSafeInteger(invocation.deadlineUnixMs) || invocation.deadlineUnixMs < 0) {
    throw new TypeError("deadlineUnixMs must be a nonnegative safe integer");
  }
  canonicalJson(rootRequest(invocation));
}

function validateLimits(limits: RunHostLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`invalid Run host limit ${name}`);
  }
  if (limits.stdoutBytes < JSON_1_LIMITS.bytes + 1) {
    throw new TypeError("stdoutBytes must admit one maximum-size frame and LF");
  }
  if (limits.cancellationGraceMs > 2_147_483_647) {
    throw new TypeError("cancellationGraceMs exceeds the timer range");
  }
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
    if (
      hasParams &&
      (object.params === null || typeof object.params !== "object")
    ) {
      throw new Error("JSON-RPC params must be a structured value");
    }
    requireExactKeys(
      object,
      hasId
        ? hasParams ? ["jsonrpc", "id", "method", "params"] : ["jsonrpc", "id", "method"]
        : hasParams ? ["jsonrpc", "method", "params"] : ["jsonrpc", "method"],
    );
    if (hasId) {
      return {
        kind: "request",
        id: requireWireId(object.id),
        method: object.method,
        ...(hasParams ? { params: object.params } : {}),
      };
    }
    return {
      kind: "notification",
      method: object.method,
      ...(hasParams ? { params: object.params } : {}),
    };
  }

  if (!hasId || hasResult === hasError) throw new Error("invalid response envelope");
  requireExactKeys(object, hasResult ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"]);
  if (hasResult) {
    return { kind: "success", id: requireWireId(object.id), result: object.result! };
  }
  const id = object.id === null ? null : requireWireId(object.id);
  return { kind: "error", id, error: parseErrorPayload(object.error!) };
}

function parseErrorPayload(value: JsonValue): ParsedError["error"] {
  const object = requireObject(value, "JSON-RPC error");
  requireExactKeys(object, Object.hasOwn(object, "data")
    ? ["code", "message", "data"]
    : ["code", "message"]);
  if (!Number.isSafeInteger(object.code)) throw new Error("invalid error code");
  if (typeof object.message !== "string" || scalarLength(object.message) < 1 ||
    scalarLength(object.message) > 1_024) {
    throw new Error("invalid error message");
  }
  return {
    code: object.code as number,
    message: object.message,
    ...(Object.hasOwn(object, "data") ? { data: object.data } : {}),
  };
}

function parseRootFailure(error: ParsedError["error"]): RootFailure {
  if (error.code !== -32000 || error.data === undefined) {
    throw new Error("standard JSON-RPC errors cannot settle flow/run");
  }
  const data = requireObject(error.data, "operation error data");
  requireExactKeys(data, Object.hasOwn(data, "details") ? ["code", "details"] : ["code"]);
  if (typeof data.code !== "string" || !WIRE_FAILURE_CODES.has(data.code as WireFailureCode)) {
    throw new Error("unknown operation error code");
  }
  return {
    kind: "failure",
    code: data.code as WireFailureCode,
    message: error.message,
    ...(Object.hasOwn(data, "details") ? { details: data.details } : {}),
  };
}

function parseRunResult(value: JsonValue): RunResult {
  const object = requireObject(value, "Run result");
  requireExactKeys(object, ["outcome", "output"]);
  return { outcome: requireLocalName(object.outcome), output: object.output! };
}

function parseUnavailableOperation(request: ParsedRequest): {
  readonly operationId: string;
  readonly signature: string;
} {
  const params = requireObject(request.params, `${request.method} params`);
  if (request.method === "flow/call") {
    const keys = Object.hasOwn(params, "intent")
      ? ["operationId", "slot", "intent", "input"]
      : ["operationId", "slot", "input"];
    requireExactKeys(params, keys);
    const operationId = requireWireId(params.operationId);
    requireLocalName(params.slot);
    if (Object.hasOwn(params, "intent")) {
      if (typeof params.intent !== "string" || scalarLength(params.intent) < 1 ||
        scalarLength(params.intent) > 16_384) throw new Error("invalid intent");
    }
    return { operationId, signature: operationSignature(request.method, params) };
  }
  requireExactKeys(params, ["operationId", "slot", "method", "input"]);
  const operationId = requireWireId(params.operationId);
  requireLocalName(params.slot);
  requireLocalName(params.method);
  return { operationId, signature: operationSignature(request.method, params) };
}

function operationSignature(method: string, params: JsonObject): string {
  const semantic: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const [key, value] of Object.entries(params)) {
    if (key !== "operationId") semantic[key] = value;
  }
  const bytes = canonicalJson({ method, params: semantic });
  return createHash("sha256").update(bytes).digest("hex");
}

function errorMessage(id: string | null, code: number, message: string): JsonObject {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function operationError(id: string, code: WireFailureCode, message: string): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32000, message, data: { code } },
  };
}

function requireObject(value: JsonValue | undefined, description: string): JsonObject {
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${description} must be an object`);
  }
  return value as JsonObject;
}

function requireExactKeys(object: JsonObject, expected: readonly string[]): void {
  const actual = Object.keys(object).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`unexpected object members: ${actual.join(", ")}`);
  }
}

function requireWireId(value: JsonValue | undefined): string {
  if (typeof value !== "string" || value.length > 128 || !WIRE_ID.test(value) ||
    encoder.encode(value).byteLength > 128) throw new Error("invalid Run/1 request ID");
  return value;
}

function requireLocalName(value: JsonValue | undefined): string {
  if (typeof value !== "string" || value.length > 64 || !LOCAL_NAME.test(value)) {
    throw new Error("invalid LocalName");
  }
  return value;
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}
