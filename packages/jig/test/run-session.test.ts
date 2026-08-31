import { describe, expect, test } from "bun:test";

import { canonicalJson, decodeJson1, type JsonObject, type JsonValue } from "../src/json.js";
import {
  RunHostSession,
  type ExactComponentExit,
  type ExactComponentProcess,
  type RunHostEffectCall,
  type RunHostEffectOperationTerminal,
  type RunHostFlowCall,
  type RunHostInvocation,
  type RunHostOperationDispatcher,
  type RunHostFlowOperationTerminal,
} from "../src/run/session.js";

const encoder = new TextEncoder();

describe("private RunHostSession", () => {
  test("accepts one structurally valid result only after clean exit", async () => {
    const process = new FakeProcess();
    const running = new RunHostSession(process, invocation()).run();
    expect(await process.nextHost()).toMatchObject({ method: "flow/run", id: "host:1" });

    process.emit(result({ greeting: "hello" }));
    process.finish(0);

    expect(await running).toEqual({
      status: "succeeded",
      result: { outcome: "done", output: { greeting: "hello" } },
      diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
    });
  });

  test("keeps the channel full-duplex and returns UNAVAILABLE without dispatch", async () => {
    const process = new FakeProcess();
    const running = new RunHostSession(process, invocation()).run();
    await process.nextHost();

    process.emit(request("component:1", "flow/call", {
      operationId: "research:1",
      slot: "research",
      intent: "Research this",
      input: {},
    }));
    process.emit(request("component:2", "effect/call", {
      operationId: "write:1",
      slot: "artifacts",
      method: "write",
      input: {},
    }));

    expect(operationCode(await process.nextHost())).toBe("UNAVAILABLE");
    expect(operationCode(await process.nextHost())).toBe("UNAVAILABLE");
    process.emit(result(null));
    process.finish(0);
    expect((await running).status).toBe("succeeded");
  });

  test("accepts a conforming response before the root write callback settles", async () => {
    const fast = new FakeProcess(Number.POSITIVE_INFINITY, 1);
    const running = new RunHostSession(fast, invocation()).run();
    expect(await fast.nextHost()).toMatchObject({ method: "flow/run", id: "host:1" });
    fast.emit(result("fast"));
    await tick();
    fast.releaseWrites();
    fast.finish(0);
    expect(await running).toMatchObject({
      status: "succeeded",
      result: { outcome: "done", output: "fast" },
    });
  });

  test("classifies a rejected root request write as CHANNEL_LOST", async () => {
    const process = new FakeProcess();
    process.failNextWrite(new Error("root request write failed"));

    expect(await new RunHostSession(process, invocation()).run()).toMatchObject({
      status: "failed",
      code: "CHANNEL_LOST",
    });
  });

  test("classifies a rejected child response write as CHANNEL_LOST", async () => {
    const process = new FakeProcess();
    const running = new RunHostSession(process, invocation()).run();
    await process.nextHost();
    process.failNextWrite(new Error("child response write failed"));
    process.emit(request("component:1", "effect/call", {
      operationId: "write-failure:1",
      slot: "artifacts",
      method: "write",
      input: null,
    }));

    expect(await running).toMatchObject({
      status: "failed",
      code: "CHANNEL_LOST",
    });
  });

  test("does not reopen root admission after a fast terminal response", async () => {
    const fast = new FakeProcess(Number.POSITIVE_INFINITY, 1);
    const running = new RunHostSession(fast, invocation()).run();
    await fast.nextHost();
    fast.emit(result("fast"));
    fast.releaseWrites();
    await tick();
    fast.emit(request("component:1", "effect/call", {
      operationId: "too-late:1",
      slot: "artifacts",
      method: "write",
      input: null,
    }));

    expect(await running).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("rejects root completion queued in the same read batch as an unsettled call", async () => {
    const process = new FakeProcess();
    const running = new RunHostSession(process, invocation()).run();
    await process.nextHost();

    process.emitTogether(
      request("component:1", "effect/call", {
        operationId: "same-batch:1",
        slot: "artifacts",
        method: "write",
        input: null,
      }),
      result("premature"),
    );

    expect(await running).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("accepts root completion after a response write starts but before it settles", async () => {
    const process = new FakeProcess(Number.POSITIVE_INFINITY, 2);
    const running = new RunHostSession(process, invocation()).run();
    await process.nextHost();

    process.emit(request("component:1", "effect/call", {
      operationId: "fast-response:1",
      slot: "artifacts",
      method: "write",
      input: null,
    }));
    expect(operationCode(await process.nextHost())).toBe("UNAVAILABLE");
    process.emit(result("settled"));
    await tick();
    process.releaseWrites();
    process.finish(0);

    expect(await running).toMatchObject({
      status: "succeeded",
      result: { outcome: "done", output: "settled" },
    });
  });

  test("replays an identical unavailable operation and rejects a conflicting reuse", async () => {
    const process = new FakeProcess();
    const running = new RunHostSession(process, invocation()).run();
    await process.nextHost();
    const first = {
      operationId: "same:1",
      slot: "artifacts",
      method: "write",
      input: { value: 1 },
    };
    process.emit(request("component:1", "effect/call", first));
    expect(operationCode(await process.nextHost())).toBe("UNAVAILABLE");
    process.emit(request("component:2", "effect/call", first));
    expect(operationCode(await process.nextHost())).toBe("UNAVAILABLE");
    process.emit(request("component:3", "effect/call", { ...first, input: { value: 2 } }));
    expect(operationCode(await process.nextHost())).toBe("OPERATION_CONFLICT");
    process.emit(result(null));
    process.finish(0);
    expect((await running).status).toBe("succeeded");
  });

  test("dispatches one flow operation and joins identical waiters", async () => {
    const process = new FakeProcess();
    const decision = deferred<RunHostFlowOperationTerminal>();
    const calls: RunHostFlowCall[] = [];
    const dispatcher: RunHostOperationDispatcher = {
      async callFlow(call) {
        calls.push(call);
        return await decision.promise;
      },
    };
    const running = new RunHostSession(process, invocation(), {}, dispatcher).run();
    await process.nextHost();
    const params = {
      operationId: "research:1",
      slot: "research",
      intent: "Research this",
      input: { subject: "FLOW" },
    };
    process.emit(request("component:1", "flow/call", params));
    process.emit(request("component:2", "flow/call", params));
    await tick();
    expect(calls).toEqual([params]);

    decision.resolve({
      status: "succeeded",
      result: { outcome: "done", output: { answer: 42 } },
    });
    expect(await process.nextHost()).toMatchObject({ result: { outcome: "done" } });
    expect(await process.nextHost()).toMatchObject({ result: { outcome: "done" } });
    process.emit(result("parent"));
    process.finish(0);
    expect(await running).toMatchObject({ status: "succeeded" });
  });

  test("dispatches effect values and declared errors with the complete snapshotted call", async () => {
    const process = new FakeProcess();
    const calls: RunHostEffectCall[] = [];
    const terminals: RunHostEffectOperationTerminal[] = [
      { status: "succeeded", result: { value: { eventId: "event-1" } } },
      { status: "succeeded", result: { error: { name: "type-denied", data: { type: "private" } } } },
    ];
    const running = new RunHostSession(process, invocation(), {}, {
      async callEffect(call) {
        calls.push(call);
        return terminals.shift()!;
      },
    }).run();
    await process.nextHost();

    process.emit(request("component:1", "effect/call", {
      operationId: "append:1",
      slot: "journal",
      method: "append",
      input: { type: "document-created", data: { id: 1 } },
    }));
    expect(await process.nextHost()).toEqual({
      jsonrpc: "2.0",
      id: "component:1",
      result: { value: { eventId: "event-1" } },
    });
    process.emit(request("component:2", "effect/call", {
      operationId: "append:2",
      slot: "journal",
      method: "append",
      input: { type: "private", data: null },
    }));
    expect(await process.nextHost()).toEqual({
      jsonrpc: "2.0",
      id: "component:2",
      result: { error: { name: "type-denied", data: { type: "private" } } },
    });
    expect(calls).toEqual([
      {
        operationId: "append:1",
        slot: "journal",
        method: "append",
        input: { type: "document-created", data: { id: 1 } },
      },
      {
        operationId: "append:2",
        slot: "journal",
        method: "append",
        input: { type: "private", data: null },
      },
    ]);
    process.emit(result(null));
    process.finish(0);
    expect(await running).toMatchObject({ status: "succeeded" });
  });

  test("rejects malformed effect dispatcher results and cross-method operation reuse", async () => {
    const invalid = new FakeProcess();
    const invalidRun = new RunHostSession(invalid, invocation(), {}, {
      async callEffect() {
        return { status: "succeeded", result: { value: null, extra: true } } as unknown as RunHostEffectOperationTerminal;
      },
    }).run();
    await invalid.nextHost();
    invalid.emit(request("component:1", "effect/call", {
      operationId: "append:1",
      slot: "journal",
      method: "append",
      input: null,
    }));
    expect(operationCode(await invalid.nextHost())).toBe("INVALID_RESULT");
    invalid.emit(result(null));
    invalid.finish(0);
    expect(await invalidRun).toMatchObject({ status: "succeeded" });

    const conflict = new FakeProcess();
    const conflictRun = new RunHostSession(conflict, invocation(), {}, {
      async callFlow() {
        return { status: "succeeded", result: { outcome: "done", output: null } };
      },
      async callEffect() {
        throw new Error("must not dispatch");
      },
    }).run();
    await conflict.nextHost();
    conflict.emit(request("component:1", "flow/call", {
      operationId: "shared:1",
      slot: "child",
      input: null,
    }));
    expect(await conflict.nextHost()).toMatchObject({ result: { outcome: "done" } });
    conflict.emit(request("component:2", "effect/call", {
      operationId: "shared:1",
      slot: "journal",
      method: "append",
      input: null,
    }));
    expect(operationCode(await conflict.nextHost())).toBe("OPERATION_CONFLICT");
    conflict.emit(result(null));
    conflict.finish(0);
    expect(await conflictRun).toMatchObject({ status: "succeeded" });
  });

  test("rejects a conflicting operation while the first dispatch is pending", async () => {
    const process = new FakeProcess();
    const decision = deferred<RunHostFlowOperationTerminal>();
    let calls = 0;
    const running = new RunHostSession(process, invocation(), {}, {
      async callFlow() {
        calls += 1;
        return await decision.promise;
      },
    }).run();
    await process.nextHost();
    process.emit(request("component:1", "flow/call", {
      operationId: "same:1",
      slot: "research",
      input: { value: 1 },
    }));
    process.emit(request("component:2", "flow/call", {
      operationId: "same:1",
      slot: "research",
      input: { value: 2 },
    }));
    expect(operationCode(await process.nextHost())).toBe("OPERATION_CONFLICT");
    expect(calls).toBe(1);
    decision.resolve({ status: "succeeded", result: { outcome: "done", output: null } });
    expect(await process.nextHost()).toMatchObject({ id: "component:1", result: {} });
    process.emit(result(null));
    process.finish(0);
    expect(await running).toMatchObject({ status: "succeeded" });
  });

  test("cancels one waiter and aborts shared work only after the final waiter", async () => {
    const process = new FakeProcess();
    const aborted = deferred<void>();
    const running = new RunHostSession(process, invocation(), {}, {
      async callFlow(_call, signal) {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted.resolve();
            resolve();
          }, { once: true });
        });
        return { status: "failed", code: "CANCELLED", message: "child cancelled" };
      },
    }).run();
    await process.nextHost();
    const params = { operationId: "shared:1", slot: "research", input: null };
    process.emit(request("component:1", "flow/call", params));
    process.emit(request("component:2", "flow/call", params));
    process.emit({
      jsonrpc: "2.0",
      method: "request/cancel",
      params: { requestId: "component:1" },
    });
    expect(operationCode(await process.nextHost())).toBe("CANCELLED");
    let observedAbort = false;
    void aborted.promise.then(() => { observedAbort = true; });
    await tick();
    expect(observedAbort).toBe(false);

    process.emit({
      jsonrpc: "2.0",
      method: "request/cancel",
      params: { requestId: "component:2" },
    });
    expect(operationCode(await process.nextHost())).toBe("CANCELLED");
    await aborted.promise;
    process.emit(result(null));
    process.finish(0);
    expect(await running).toMatchObject({ status: "succeeded" });
  });

  test("treats component request-ID reuse as fatal", async () => {
    const process = new FakeProcess();
    const running = new RunHostSession(process, invocation()).run();
    await process.nextHost();
    const call = request("component:1", "effect/call", {
      operationId: "one:1",
      slot: "artifacts",
      method: "write",
      input: null,
    });
    process.emit(call);
    await process.nextHost();
    process.emit(call);
    expect(await running).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("counts invalid method params before rejecting a 65,537th lifetime request", async () => {
    const process = new FakeProcess();
    const session = new RunHostSession(process, invocation());
    const ids = (session as unknown as { componentIds: Set<string> }).componentIds;
    for (let index = 1; index <= 65_535; index += 1) ids.add(`component:${index}`);

    const running = session.run();
    await process.nextHost();
    process.emit(request("component:65536", "effect/call", {}));
    expect(await process.nextHost()).toMatchObject({
      id: "component:65536",
      error: { code: -32602 },
    });
    process.emit(request("component:65537", "effect/call", {
      operationId: "overflow:1",
      slot: "sink",
      method: "write",
      input: null,
    }));

    expect(await running).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("rejects a 65th response-pending request while writes are blocked", async () => {
    const process = new FakeProcess(1);
    const running = new RunHostSession(process, invocation()).run();
    await process.nextHost();

    process.emitTogether(
      ...Array.from({ length: 63 }, (_, index) =>
        request(`component:${index + 1}`, "unknown/request", {})),
      request("component:64", "effect/call", {}),
      request("component:65", "effect/call", {
        operationId: "overflow:1",
        slot: "artifacts",
        method: "write",
        input: null,
      }),
    );
    await tick();
    process.releaseWrites();

    const codes: number[] = [];
    for (let index = 0; index < 65; index += 1) {
      codes.push(rpcCode(await process.nextHost()));
    }
    expect(codes.filter((code) => code === -32601)).toHaveLength(63);
    expect(codes.filter((code) => code === -32602)).toHaveLength(1);
    expect(codes.filter((code) => code === -32000)).toHaveLength(1);

    process.emit(result(null));
    process.finish(0);
    expect(await running).toMatchObject({ status: "failed", code: "RESOURCE_EXHAUSTED" });
  });

  test("reports parse failures and rejects trailing frames", async () => {
    const malformed = new FakeProcess();
    const malformedRun = new RunHostSession(malformed, invocation()).run();
    await malformed.nextHost();
    malformed.emitRaw(encoder.encode("{\"jsonrpc\":\n"));
    expect(await malformed.nextHost()).toMatchObject({ id: null, error: { code: -32700 } });
    expect(await malformedRun).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });

    const trailing = new FakeProcess();
    const trailingRun = new RunHostSession(trailing, invocation()).run();
    await trailing.nextHost();
    trailing.emitTogether(result(null), { jsonrpc: "2.0", method: "ignored", params: {} });
    trailing.finish(0);
    expect(await trailingRun).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("treats scalar params as an invalid envelope", async () => {
    const process = new FakeProcess();
    const running = new RunHostSession(process, invocation()).run();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "component:1", method: "unknown", params: 1 });
    expect(await process.nextHost()).toMatchObject({ id: null, error: { code: -32600 } });
    expect(await running).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("rejects unknown attachment members before writing flow/run", () => {
    const process = new FakeProcess();
    expect(() => new RunHostSession(process, {
      ...invocation(),
      attachments: {
        source: { path: "/source", access: "read", extra: true },
      } as unknown as RunHostInvocation["attachments"],
    })).toThrow("exactly path and access");
  });

  test("rejects scalar settings before writing flow/run", () => {
    const process = new FakeProcess();
    expect(() => new RunHostSession(process, {
      ...invocation(),
      settings: 1,
    } as unknown as RunHostInvocation)).toThrow("settings must be an object");
  });

  test("invalidates success after nonzero exit and enforces stderr bounds", async () => {
    const nonzero = new FakeProcess();
    const nonzeroRun = new RunHostSession(nonzero, invocation()).run();
    await nonzero.nextHost();
    nonzero.emit(result(null));
    nonzero.finish(7);
    expect(await nonzeroRun).toMatchObject({ status: "failed", code: "EXECUTION_FAILED" });

    const signalled = new FakeProcess();
    const signalledRun = new RunHostSession(signalled, invocation()).run();
    await signalled.nextHost();
    signalled.emit(result(null));
    signalled.finish(0, "SIGTERM");
    expect(await signalledRun).toMatchObject({ status: "failed", code: "EXECUTION_FAILED" });

    const noisy = new FakeProcess();
    const noisyRun = new RunHostSession(noisy, invocation(), {
      stderrBytes: 3,
      capturedStderrBytes: 2,
    }).run();
    await noisy.nextHost();
    noisy.diagnose(encoder.encode("noise"));
    const terminal = await noisyRun;
    expect(terminal).toMatchObject({
      status: "failed",
      code: "RESOURCE_EXHAUSTED",
      diagnostics: { stderr: "no", stderrBytes: 5, stderrTruncated: true },
    });
  });

  test("terminates promptly on pre-response EOF and handles completion rejection", async () => {
    const eof = new FakeProcess();
    const eofRun = new RunHostSession(eof, invocation()).run();
    await eof.nextHost();
    eof.closeStdout();
    expect(await eofRun).toMatchObject({ status: "failed", code: "CHANNEL_LOST" });

    const rejected = new FakeProcess();
    const rejectedRun = new RunHostSession(rejected, invocation()).run();
    await rejected.nextHost();
    rejected.failCompletion(new Error("backend wait failed"));
    expect(await rejectedRun).toMatchObject({ status: "failed", code: "CHANNEL_LOST" });
  });

  test("sends one cooperative cancellation and enforces cancellation and deadline", async () => {
    const controller = new AbortController();
    const cancelled = new FakeProcess();
    const cancelledRun = new RunHostSession(cancelled, {
      ...invocation(),
      signal: controller.signal,
    }, { cancellationGraceMs: 5 }).run();
    await cancelled.nextHost();
    controller.abort();
    expect(await cancelled.nextHost()).toEqual({
      jsonrpc: "2.0",
      method: "request/cancel",
      params: { requestId: "host:1" },
    });
    expect(await cancelledRun).toMatchObject({ status: "failed", code: "CANCELLED" });

    const deadline = new FakeProcess();
    const deadlineRun = new RunHostSession(deadline, invocation(Date.now() + 15), {
      cancellationGraceMs: 5,
    }).run();
    await deadline.nextHost();
    expect(await deadline.nextHost()).toEqual({
      jsonrpc: "2.0",
      method: "request/cancel",
      params: { requestId: "host:1" },
    });
    expect(await deadlineRun).toMatchObject({ status: "failed", code: "DEADLINE_EXCEEDED" });
  });

  test("lets a root response win later cancellation but not a later deadline kill", async () => {
    const controller = new AbortController();
    const completed = new FakeProcess();
    const completedRun = new RunHostSession(completed, {
      ...invocation(),
      signal: controller.signal,
    }).run();
    await completed.nextHost();
    completed.emit(result("settled"));
    await tick();
    controller.abort();
    completed.finish(0);
    expect(await completedRun).toMatchObject({ status: "succeeded" });

    const hung = new FakeProcess();
    const hungRun = new RunHostSession(hung, invocation(Date.now() + 15), {
      cancellationGraceMs: 5,
    }).run();
    await hung.nextHost();
    hung.emit(result("settled"));
    expect(await hungRun).toMatchObject({ status: "failed", code: "EXECUTION_FAILED" });
  });

  test("keeps the first ordered cancellation or deadline terminal decision", async () => {
    const cancelledController = new AbortController();
    const cancelled = new FakeProcess();
    const cancelledRun = new RunHostSession(cancelled, {
      ...invocation(Date.now() + 1_000),
      signal: cancelledController.signal,
    }, { cancellationGraceMs: 100 }).run();
    await cancelled.nextHost();
    cancelledController.abort();
    expect(await cancelled.nextHost()).toMatchObject({ method: "request/cancel" });
    cancelled.emit(result("too-late"));
    cancelled.finish(0);
    expect(await cancelledRun).toMatchObject({ status: "failed", code: "CANCELLED" });

    const deadlineController = new AbortController();
    const deadline = new FakeProcess();
    const deadlineRun = new RunHostSession(deadline, {
      ...invocation(Date.now() + 15),
      signal: deadlineController.signal,
    }, { cancellationGraceMs: 100 }).run();
    await deadline.nextHost();
    expect(await deadline.nextHost()).toMatchObject({ method: "request/cancel" });
    deadlineController.abort();
    deadline.emit(result("too-late"));
    deadline.finish(0);
    expect(await deadlineRun).toMatchObject({ status: "failed", code: "DEADLINE_EXCEEDED" });
  });

  test("uses a hard-deadline receipt only before a committed root response", async () => {
    const unanswered = new FakeProcess();
    const unansweredRun = new RunHostSession(unanswered, invocation(Date.now() + 10_000)).run();
    await unanswered.nextHost();
    unanswered.closeStdout();
    unanswered.finish(null, "SIGKILL", "deadline");
    expect(await unansweredRun).toMatchObject({ status: "failed", code: "DEADLINE_EXCEEDED" });

    const answered = new FakeProcess();
    const answeredRun = new RunHostSession(answered, invocation(Date.now() + 10_000)).run();
    await answered.nextHost();
    answered.emit(result("settled"));
    await tick();
    answered.finish(null, "SIGKILL", "deadline");
    expect(await answeredRun).toMatchObject({ status: "failed", code: "EXECUTION_FAILED" });
  });
});

function invocation(deadlineUnixMs = Date.now() + 10_000): RunHostInvocation {
  return {
    input: {},
    settings: {},
    attachments: {},
    scratch: "/scratch",
    deadlineUnixMs,
  };
}

function request(id: string, method: string, params: JsonObject): JsonObject {
  return { jsonrpc: "2.0", id, method, params };
}

function result(output: JsonValue): JsonObject {
  return { jsonrpc: "2.0", id: "host:1", result: { outcome: "done", output } };
}

function operationCode(value: JsonValue): string {
  const error = (value as JsonObject).error as JsonObject;
  const data = error.data as JsonObject;
  return data.code as string;
}

function rpcCode(value: JsonValue): number {
  return ((value as JsonObject).error as JsonObject).code as number;
}

class FakeProcess implements ExactComponentProcess {
  readonly stdout = new BytePipe();
  readonly stderr = new BytePipe();
  readonly completion: Promise<ExactComponentExit>;
  private readonly host = new ValuePipe();
  private readonly complete: (exit: ExactComponentExit) => void;
  private readonly rejectCompletion: (error: unknown) => void;
  private blocked?: Promise<void>;
  private release?: () => void;
  private writes = 0;
  private finished = false;
  private nextWriteFailure?: unknown;

  constructor(
    private readonly blockAfter = Number.POSITIVE_INFINITY,
    private readonly holdAfterDeliveryAt = Number.POSITIVE_INFINITY,
  ) {
    let complete!: (exit: ExactComponentExit) => void;
    let rejectCompletion!: (error: unknown) => void;
    this.completion = new Promise((resolve, reject) => {
      complete = resolve;
      rejectCompletion = reject;
    });
    this.complete = complete;
    this.rejectCompletion = rejectCompletion;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (this.finished) throw new Error("process already exited");
    if (this.nextWriteFailure !== undefined) {
      const failure = this.nextWriteFailure;
      this.nextWriteFailure = undefined;
      throw failure;
    }
    if (this.writes >= this.blockAfter) {
      this.blocked ??= new Promise<void>((resolve) => {
        this.release = resolve;
      });
      await this.blocked;
    }
    this.writes += 1;
    if (bytes.at(-1) !== 0x0a) throw new Error("host write is not framed");
    this.host.push(decodeJson1(bytes.subarray(0, -1)));
    if (this.writes === this.holdAfterDeliveryAt) {
      this.blocked ??= new Promise<void>((resolve) => {
        this.release = resolve;
      });
      await this.blocked;
    }
  }

  async closeInput(): Promise<void> {}

  async terminate(): Promise<void> {
    this.finish(null, "SIGKILL");
  }

  async nextHost(): Promise<JsonValue> {
    return await this.host.next();
  }

  releaseWrites(): void {
    this.release?.();
    this.release = undefined;
  }

  failNextWrite(error: unknown): void {
    this.nextWriteFailure = error;
  }

  emit(value: JsonValue): void {
    const bytes = canonicalJson(value);
    const frame = new Uint8Array(bytes.byteLength + 1);
    frame.set(bytes);
    frame[bytes.byteLength] = 0x0a;
    this.stdout.push(frame);
  }

  emitTogether(...values: JsonValue[]): void {
    const frames = values.map((value) => {
      const bytes = canonicalJson(value);
      const frame = new Uint8Array(bytes.byteLength + 1);
      frame.set(bytes);
      frame[bytes.byteLength] = 0x0a;
      return frame;
    });
    const joined = new Uint8Array(frames.reduce((sum, frame) => sum + frame.byteLength, 0));
    let offset = 0;
    for (const frame of frames) {
      joined.set(frame, offset);
      offset += frame.byteLength;
    }
    this.stdout.push(joined);
  }

  emitRaw(bytes: Uint8Array): void {
    this.stdout.push(bytes);
  }

  diagnose(bytes: Uint8Array): void {
    this.stderr.push(bytes);
  }

  closeStdout(): void {
    this.stdout.end();
  }

  failCompletion(error: unknown): void {
    if (this.finished) return;
    this.finished = true;
    this.releaseWrites();
    this.stdout.end();
    this.stderr.end();
    this.rejectCompletion(error);
  }

  finish(
    exitCode: number | null,
    signal: string | null = null,
    stopReason?: ExactComponentExit["stopReason"],
  ): void {
    if (this.finished) return;
    this.finished = true;
    this.releaseWrites();
    this.stdout.end();
    this.stderr.end();
    this.complete({ exitCode, signal, fenced: true, ...(stopReason === undefined ? {} : { stopReason }) });
  }
}

class BytePipe implements AsyncIterable<Uint8Array> {
  private readonly values: Uint8Array[] = [];
  private readonly waiters: Array<(value: IteratorResult<Uint8Array>) => void> = [];
  private ended = false;

  push(value: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter({ done: false, value });
    else this.values.push(value);
  }

  end(): void {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value !== undefined) return { done: false, value };
        if (this.ended) return { done: true, value: undefined };
        return await new Promise<IteratorResult<Uint8Array>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

class ValuePipe {
  private readonly values: JsonValue[] = [];
  private readonly waiters: Array<(value: JsonValue) => void> = [];

  push(value: JsonValue): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter(value);
    else this.values.push(value);
  }

  async next(): Promise<JsonValue> {
    const value = this.values.shift();
    if (value !== undefined) return value;
    return await Promise.race([
      new Promise<JsonValue>((resolve) => this.waiters.push(resolve)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("host write timeout")), 1_000)),
    ]);
  }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}
