import { describe, expect, spyOn, test } from "bun:test";

import { decodeJson, encodeJson } from "../src/json.ts";
import { RunSession } from "../src/session.ts";
import type { Transport } from "../src/transport.ts";
import {
  EffectError,
  OperationError,
  type JsonObject,
  type JsonValue,
} from "../src/types.ts";

class MemoryTransport implements Transport {
  readonly writes: Uint8Array[] = [];
  private readonly chunks: Uint8Array[] = [];
  private readonly readers: Array<(value: IteratorResult<Uint8Array>) => void> = [];
  private readonly writeWaiters: Array<() => void> = [];
  private stopped = false;

  readonly input: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => ({
      next: () => this.nextChunk(),
    }),
  };

  async write(bytes: Uint8Array): Promise<void> {
    this.writes.push(bytes.slice());
    for (const waiter of this.writeWaiters.splice(0)) waiter();
  }

  async stopReading(): Promise<void> {
    this.stopped = true;
    for (const reader of this.readers.splice(0)) reader({ done: true, value: undefined });
  }

  push(value: JsonObject): void {
    const frame = encodeJson(value);
    const line = new Uint8Array(frame.byteLength + 1);
    line.set(frame);
    line[frame.byteLength] = 0x0a;
    this.pushRaw(line);
  }

  pushRaw(bytes: Uint8Array): void {
    const reader = this.readers.shift();
    if (reader) reader({ done: false, value: bytes });
    else this.chunks.push(bytes);
  }

  closeInput(): void {
    this.stopped = true;
    for (const reader of this.readers.splice(0)) {
      reader({ done: true, value: undefined });
    }
  }

  async waitForWrites(count: number): Promise<void> {
    while (this.writes.length < count) {
      await new Promise<void>((resolve) => this.writeWaiters.push(resolve));
    }
  }

  message(index: number): Record<string, JsonValue> {
    const line = this.writes[index];
    if (!line) throw new Error(`missing write ${index}`);
    const value = decodeJson(line.subarray(0, line.byteLength - 1));
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      throw new Error("write was not an object");
    }
    return value as Record<string, JsonValue>;
  }

  private nextChunk(): Promise<IteratorResult<Uint8Array>> {
    const chunk = this.chunks.shift();
    if (chunk) return Promise.resolve({ done: false, value: chunk });
    if (this.stopped) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve) => this.readers.push(resolve));
  }
}

class ControlledFirstWriteTransport extends MemoryTransport {
  private firstWrite = true;
  private release!: () => void;
  private reject!: (reason: unknown) => void;
  private markStopped!: () => void;
  private readonly settlement = new Promise<void>((resolve, reject) => {
    this.release = resolve;
    this.reject = reject;
  });
  private readonly stopObserved = new Promise<void>((resolve) => {
    this.markStopped = resolve;
  });

  override async write(bytes: Uint8Array): Promise<void> {
    await super.write(bytes);
    if (!this.firstWrite) return;
    this.firstWrite = false;
    await this.settlement;
  }

  resolveFirstWrite(): void {
    this.release();
  }

  rejectFirstWrite(reason: unknown): void {
    this.reject(reason);
  }

  override async stopReading(): Promise<void> {
    await super.stopReading();
    this.markStopped();
  }

  async waitForStop(): Promise<void> {
    await this.stopObserved;
  }
}

class RejectingStopTransport extends MemoryTransport {
  override async stopReading(): Promise<void> {
    await super.stopReading();
    throw new Error("stdin shutdown failed");
  }
}

function rootRequest(id = "host:1"): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    method: "flow/run",
    params: {
      protocol: "run/1",
      input: { subject: "test" },
      settings: {},
      attachments: {},
      scratch: "/tmp/run",
      deadlineUnixMs: 4_000_000_000_000,
    },
  };
}

describe("RunSession", () => {
  test("handles one ordinary root Run", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async (run) => {
      return {
        outcome: "done",
        output: run.input,
      };
    });
    const completion = session.run();
    transport.push(rootRequest());
    await completion;

    expect(transport.message(0)).toEqual({
      jsonrpc: "2.0",
      id: "host:1",
      result: {
        outcome: "done",
        output: { subject: "test" },
      },
    });
  });

  test("completes when input closes after the root terminal frame is observable", async () => {
    const transport = new ControlledFirstWriteTransport();
    const session = new RunSession(transport, async (run) => ({
      outcome: "done",
      output: run.input,
    }));
    const completion = session.run();
    transport.push(rootRequest());

    await transport.waitForWrites(1);
    expect(transport.message(0).result).toEqual({
      outcome: "done",
      output: { subject: "test" },
    });
    transport.closeInput();
    transport.resolveFirstWrite();

    await completion;
  });

  test("fails when the observable root terminal write rejects", async () => {
    const transport = new ControlledFirstWriteTransport();
    const session = new RunSession(transport, async (run) => ({
      outcome: "done",
      output: run.input,
    }));
    const completion = session.run();
    transport.push(rootRequest());

    await transport.waitForWrites(1);
    transport.rejectFirstWrite(new Error("stdout failed"));

    await expect(completion).rejects.toMatchObject({ code: "CHANNEL_LOST" });
  });

  test("fails when input shutdown rejects after publishing the root terminal frame", async () => {
    const transport = new RejectingStopTransport();
    const session = new RunSession(transport, async (run) => ({
      outcome: "done",
      output: run.input,
    }));
    const completion = session.run();
    transport.push(rootRequest());

    await expect(completion).rejects.toMatchObject({ code: "CHANNEL_LOST" });
    expect(transport.writes).toHaveLength(1);
    expect(transport.message(0)).toEqual({
      jsonrpc: "2.0",
      id: "host:1",
      result: {
        outcome: "done",
        output: { subject: "test" },
      },
    });
  });

  test("fails when an invalid-params terminal write rejects", async () => {
    const transport = new ControlledFirstWriteTransport();
    const session = new RunSession(transport, async () => ({
      outcome: "done",
      output: null,
    }));
    const completion = session.run();
    transport.push({
      jsonrpc: "2.0",
      id: "host:invalid",
      method: "flow/run",
      params: {},
    });

    await transport.waitForWrites(1);
    transport.rejectFirstWrite(new Error("stdout failed"));

    await expect(completion).rejects.toMatchObject({ code: "CHANNEL_LOST" });
  });

  test("fails when input closes before root terminal publication", async () => {
    const transport = new MemoryTransport();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const session = new RunSession(transport, async (run) => {
      markStarted();
      await new Promise<void>((resolve) => {
        run.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { outcome: "done", output: null };
    });
    const completion = session.run();
    transport.push(rootRequest());
    await started;

    transport.closeInput();

    await expect(completion).rejects.toMatchObject({ code: "CHANNEL_LOST" });
    expect(transport.writes).toHaveLength(0);
  });

  test("suppresses queued writes after a fatal protocol decision", async () => {
    const transport = new ControlledFirstWriteTransport();
    let markFatal!: () => void;
    const fatal = new Promise<void>((resolve) => {
      markFatal = resolve;
    });
    const session = new RunSession(transport, async (run) => {
      run.signal.addEventListener("abort", markFatal, { once: true });
      const calls = [
        run.callEffect({
          operationId: "queued:1",
          slot: "store",
          method: "write",
          input: 1,
        }),
        run.callEffect({
          operationId: "queued:2",
          slot: "store",
          method: "write",
          input: 2,
        }),
      ];
      await Promise.allSettled(calls);
      return { outcome: "done", output: null };
    });
    const completion = session.run();
    transport.push(rootRequest());
    await transport.waitForWrites(1);

    transport.pushRaw(new TextEncoder().encode("{}\n"));
    await fatal;
    transport.resolveFirstWrite();

    await expect(completion).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(transport.writes).toHaveLength(2);
    expect(transport.message(0).method).toBe("effect/call");
    expect(transport.message(1)).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  test("suppresses a queued root response after a fatal protocol decision", async () => {
    const transport = new ControlledFirstWriteTransport();
    let markHandlerDone!: () => void;
    const handlerDone = new Promise<void>((resolve) => {
      markHandlerDone = resolve;
    });
    const session = new RunSession(transport, async (run) => {
      const output = await run.callEffect({
        operationId: "before-root:1",
        slot: "store",
        method: "read",
        input: null,
      });
      markHandlerDone();
      return { outcome: "done", output };
    });
    const completion = session.run();
    transport.push(rootRequest());
    await transport.waitForWrites(1);
    const request = transport.message(0);

    transport.push({
      jsonrpc: "2.0",
      id: request.id as string,
      result: { value: "stored" },
    });
    await handlerDone;
    // Let handleRoot enqueue its response behind the unresolved first write.
    await Promise.resolve();
    transport.pushRaw(new TextEncoder().encode("{}\n"));
    await transport.waitForStop();
    transport.resolveFirstWrite();

    await expect(completion).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(transport.writes).toHaveLength(2);
    expect(transport.message(0).method).toBe("effect/call");
    expect(transport.message(1)).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  test("keeps the channel full-duplex while calls settle out of order", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async (run) => {
      const child = run.callFlow({
        operationId: "child:1",
        slot: "research",
        intent: "Research the subject.",
        input: run.input,
      });
      const effect = run.callEffect({
        operationId: "effect:1",
        slot: "store",
        method: "write",
        input: { value: 1 },
      });
      return {
        outcome: "done",
        output: { child: (await child).output, effect: await effect },
      };
    });
    const completion = session.run();
    transport.push(rootRequest());
    await transport.waitForWrites(2);

    const first = transport.message(0);
    const second = transport.message(1);
    expect(first.method).toBe("flow/call");
    expect(second.method).toBe("effect/call");
    transport.push({
      jsonrpc: "2.0",
      id: second.id as string,
      result: { value: { stored: true } },
    });
    transport.push({
      jsonrpc: "2.0",
      id: first.id as string,
      result: { outcome: "done", output: { researched: true } },
    });
    await completion;

    expect(transport.message(2).result).toEqual({
      outcome: "done",
      output: {
        child: { researched: true },
        effect: { stored: true },
      },
    });
  });

  test("projects declared effect errors without exposing wire envelopes", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async (run) => {
      try {
        await run.callEffect({
          operationId: "read:1",
          slot: "records",
          method: "read",
          input: null,
        });
        throw new Error("expected an EffectError");
      } catch (error) {
        if (!(error instanceof EffectError)) throw error;
        return {
          outcome: "done",
          output: { name: error.errorName, data: error.data },
        };
      }
    });
    const completion = session.run();
    transport.push(rootRequest());
    await transport.waitForWrites(1);
    const request = transport.message(0);
    transport.push({
      jsonrpc: "2.0",
      id: request.id as string,
      result: { error: { name: "not-found", data: { id: 7 } } },
    });
    await completion;

    expect(transport.message(1).result).toEqual({
      outcome: "done",
      output: { name: "not-found", data: { id: 7 } },
    });
  });

  test("propagates root cancellation and returns a cancellation failure", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async (run) => {
      await new Promise<void>((resolve) => {
        run.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { outcome: "done", output: "too late" };
    });
    const completion = session.run();
    transport.push(rootRequest());
    transport.push({
      jsonrpc: "2.0",
      method: "request/cancel",
      params: { requestId: "host:1" },
    });
    await completion;

    const response = transport.message(0);
    expect(response.error).toEqual({
      code: -32000,
      message: "Run was cancelled",
      data: { code: "CANCELLED" },
    });
  });

  test("cannot report success while an unawaited outbound call is live", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async (run) => {
      void run.callEffect({
        operationId: "detached:1",
        slot: "store",
        method: "write",
        input: null,
      });
      return { outcome: "done", output: null };
    });
    const completion = session.run();
    transport.push(rootRequest());
    await transport.waitForWrites(2);
    const request = transport.message(0);
    expect(transport.message(1)).toEqual({
      jsonrpc: "2.0",
      method: "request/cancel",
      params: { requestId: request.id },
    });
    transport.push({
      jsonrpc: "2.0",
      id: request.id as string,
      error: {
        code: -32000,
        message: "Owner closed",
        data: { code: "OWNER_CLOSED" },
      },
    });
    await completion;

    const root = transport.message(2);
    expect((root.error as Record<string, JsonValue>).data).toEqual({
      code: "EXECUTION_FAILED",
    });
  });

  test("call cancellation rejects promptly but retains wire quiescence", async () => {
    const transport = new MemoryTransport();
    let rejected = false;
    const session = new RunSession(transport, async (run) => {
      const controller = new AbortController();
      const child = run.callFlow(
        {
          operationId: "cancel-race:1",
          slot: "worker",
          input: null,
        },
        { signal: controller.signal },
      );
      controller.abort();
      try {
        await child;
        throw new Error("expected cancellation");
      } catch (error) {
        if (!(error instanceof OperationError) || error.code !== "CANCELLED") {
          throw error;
        }
        rejected = true;
      }
      return { outcome: "done", output: "cancelled-locally" };
    });
    const completion = session.run();
    transport.push(rootRequest());
    await transport.waitForWrites(2);
    const request = transport.message(0);
    expect(transport.message(1)).toEqual({
      jsonrpc: "2.0",
      method: "request/cancel",
      params: { requestId: request.id },
    });
    expect(rejected).toBe(true);
    expect(transport.writes).toHaveLength(2);
    transport.push({
      jsonrpc: "2.0",
      id: request.id as string,
      result: { outcome: "done", output: "remote-result-was-tombstoned" },
    });
    await completion;
    expect(transport.message(2).result).toEqual({
      outcome: "done",
      output: "cancelled-locally",
    });
  });

  test("already-aborted call signals reject both call kinds as CANCELLED without dispatch", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async (run) => {
      const controller = new AbortController();
      controller.abort();

      const calls = [
        run.callFlow(
          {
            operationId: "cancelled-flow:1",
            slot: "worker",
            input: null,
          },
          { signal: controller.signal },
        ),
        run.callEffect(
          {
            operationId: "cancelled-effect:1",
            slot: "records",
            method: "write",
            input: null,
          },
          { signal: controller.signal },
        ),
      ];

      const settlements = await Promise.allSettled(calls);
      for (const settlement of settlements) {
        expect(settlement.status).toBe("rejected");
        if (settlement.status !== "rejected") throw new Error("expected cancellation");
        expect(settlement.reason).toBeInstanceOf(OperationError);
        expect((settlement.reason as OperationError).code).toBe("CANCELLED");
      }

      return { outcome: "done", output: "no-call-dispatched" };
    });
    const completion = session.run();
    transport.push(rootRequest());
    await completion;

    expect(transport.writes).toHaveLength(1);
    expect(transport.message(0).result).toEqual({
      outcome: "done",
      output: "no-call-dispatched",
    });
  });

  test("already-aborted call signals take precedence over live-call capacity", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async (run) => {
      const pending = Array.from({ length: 64 }, (_, index) =>
        run.callEffect({
          operationId: `capacity:${index}`,
          slot: "records",
          method: "write",
          input: null,
        }),
      );
      await transport.waitForWrites(64);

      const controller = new AbortController();
      controller.abort();
      await expect(
        run.callEffect(
          {
            operationId: "capacity:cancelled",
            slot: "records",
            method: "write",
            input: null,
          },
          { signal: controller.signal },
        ),
      ).rejects.toMatchObject({ code: "CANCELLED" });
      expect(transport.writes).toHaveLength(64);

      for (let index = 0; index < 64; index += 1) {
        const request = transport.message(index);
        transport.push({ jsonrpc: "2.0", id: request.id as string, result: { value: null } });
      }
      await Promise.all(pending);
      return { outcome: "done", output: null };
    });

    const completion = session.run();
    transport.push(rootRequest());
    await completion;
  });

  test("already-aborted call signals take precedence over lifetime capacity", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async (run) => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        run.callEffect(
          {
            operationId: "lifetime:cancelled",
            slot: "records",
            method: "write",
            input: null,
          },
          { signal: controller.signal },
        ),
      ).rejects.toMatchObject({ code: "CANCELLED" });
      return { outcome: "done", output: null };
    });
    const internals = session as unknown as { usedComponentIds: Set<string> };
    for (let index = 0; index < 65_536; index += 1) {
      internals.usedComponentIds.add(`seed:${index}`);
    }

    const completion = session.run();
    transport.push(rootRequest());
    await completion;
    expect(transport.writes).toHaveLength(1);
  });

  test("a cancellation-only catch preserves unrelated call failures", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async (run) => {
      const controller = new AbortController();
      try {
        await run.callEffect(
          {
            operationId: "write:permission-check",
            slot: "records",
            method: "write",
            input: null,
          },
          { signal: controller.signal },
        );
        throw new Error("expected an operational failure");
      } catch (error) {
        if (error instanceof OperationError && error.code === "CANCELLED") {
          return { outcome: "done", output: "cancelled" };
        }
        throw error;
      }
    });
    const completion = session.run();
    transport.push(rootRequest());
    await transport.waitForWrites(1);
    const request = transport.message(0);
    transport.push({
      jsonrpc: "2.0",
      id: request.id as string,
      error: {
        code: -32000,
        message: "The records slot denied write access",
        data: { code: "PERMISSION_DENIED" },
      },
    });
    await completion;

    expect(transport.message(1).error).toEqual({
      code: -32000,
      message: "The records slot denied write access",
      data: { code: "PERMISSION_DENIED" },
    });
  });

  test("preserves an unhandled operational failure at the root", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async () => {
      throw new OperationError(
        "PERMISSION_DENIED",
        "The records slot denied write access",
        { slot: "records" },
      );
    });
    const completion = session.run();
    transport.push(rootRequest());
    await completion;
    expect(transport.message(0).error).toEqual({
      code: -32000,
      message: "The records slot denied write access",
      data: {
        code: "PERMISSION_DENIED",
        details: { slot: "records" },
      },
    });
  });

  test("does not put an unknown operational code on the wire", async () => {
    const diagnostic = spyOn(console, "error").mockImplementation(() => undefined);
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async () => {
      throw new OperationError("NOT_A_RUN_CODE" as never, "invalid local code");
    });
    const completion = session.run();
    transport.push(rootRequest());
    await completion;
    expect(transport.message(0).error).toEqual({
      code: -32000,
      message: "Run execution failed",
      data: { code: "EXECUTION_FAILED" },
    });
    diagnostic.mockRestore();
  });

  test("does not let malformed operational metadata corrupt the channel", async () => {
    const diagnostic = spyOn(console, "error").mockImplementation(() => undefined);
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async () => {
      throw new OperationError("PERMISSION_DENIED", "\ud800");
    });
    const completion = session.run();
    transport.push(rootRequest());
    await completion;
    expect(transport.message(0).error).toEqual({
      code: -32000,
      message: "Run execution failed",
      data: { code: "EXECUTION_FAILED" },
    });
    diagnostic.mockRestore();
  });

  test("keeps diagnostic failures out of the Run terminal decision", async () => {
    const diagnostic = spyOn(console, "error").mockImplementation(() => {
      throw new Error("stderr unavailable");
    });
    try {
      const transport = new MemoryTransport();
      const session = new RunSession(transport, async () => {
        throw new Error("handler failed");
      });
      const completion = session.run();
      transport.push(rootRequest());
      await completion;
      expect(transport.message(0).error).toEqual({
        code: -32000,
        message: "Run execution failed",
        data: { code: "EXECUTION_FAILED" },
      });
    } finally {
      diagnostic.mockRestore();
    }
  });

  test("snapshots outbound input before caller mutation", async () => {
    const transport = new MemoryTransport();
    const mutable = { value: "before" };
    const session = new RunSession(transport, async (run) => {
      const effect = run.callEffect({
        operationId: "snapshot:1",
        slot: "store",
        method: "write",
        input: mutable,
      });
      mutable.value = "after";
      return { outcome: "done", output: await effect };
    });
    const completion = session.run();
    transport.push(rootRequest());
    await transport.waitForWrites(1);
    const request = transport.message(0);
    expect((request.params as Record<string, JsonValue>).input).toEqual({
      value: "before",
    });
    transport.push({
      jsonrpc: "2.0",
      id: request.id as string,
      result: { value: null },
    });
    await completion;
  });

  test("maps invalid handler output to INVALID_RESULT", async () => {
    const diagnostic = spyOn(console, "error").mockImplementation(() => undefined);
    const transport = new MemoryTransport();
    const session = new RunSession(
      transport,
      async () => ({ outcome: "done" }) as never,
    );
    const completion = session.run();
    transport.push(rootRequest());
    await completion;
    const response = transport.message(0);
    expect((response.error as Record<string, JsonValue>).data).toEqual({
      code: "INVALID_RESULT",
    });
    diagnostic.mockRestore();
  });

  test("classifies a complete invalid JSON/1 frame as PROTOCOL_ERROR", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async () => ({
      outcome: "done",
      output: null,
    }));
    const completion = session.run();
    transport.pushRaw(new TextEncoder().encode('{"x":1,"x":2}\n'));
    await expect(completion).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(transport.message(0)).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });

  test("reports a BOM as invalid JSON/1 before closing", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async () => ({
      outcome: "done",
      output: null,
    }));
    const completion = session.run();
    transport.pushRaw(
      new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("{}\n")]),
    );
    await expect(completion).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(transport.message(0)).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });

  test("silently closes invalid UTF-8 as PROTOCOL_ERROR", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async () => ({
      outcome: "done",
      output: null,
    }));
    const completion = session.run();
    transport.pushRaw(new Uint8Array([0xff, 0x0a]));
    await expect(completion).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(transport.writes).toHaveLength(0);
  });

  test("classifies an invalid envelope as PROTOCOL_ERROR", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async () => ({
      outcome: "done",
      output: null,
    }));
    const completion = session.run();
    transport.pushRaw(new TextEncoder().encode('{}\n'));
    await expect(completion).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(transport.message(0)).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" },
    });
  });

  test("silently closes an incomplete frame as PROTOCOL_ERROR", async () => {
    const transport = new MemoryTransport();
    const session = new RunSession(transport, async () => ({
      outcome: "done",
      output: null,
    }));
    const completion = session.run();
    transport.pushRaw(new TextEncoder().encode('{"jsonrpc":"2.0"'));
    transport.closeInput();
    await expect(completion).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(transport.writes).toHaveLength(0);
  });

  test("treats invalid operation-error responses as fatal protocol violations", async () => {
    const invalidErrors: JsonObject[] = [
      {
        code: -32000,
        message: "Missing data",
      },
      {
        code: -32000,
        message: "Local code on the wire",
        data: { code: "PROTOCOL_ERROR" },
      },
      {
        code: -32000,
        message: "Another local code on the wire",
        data: { code: "CHANNEL_LOST" },
      },
      {
        code: -32042,
        message: "Unknown JSON-RPC code",
      },
      {
        code: -32601,
        message: "Method not found",
      },
    ];

    for (const error of invalidErrors) {
      const transport = new MemoryTransport();
      const session = new RunSession(transport, async (run) => ({
        outcome: "done",
        output: await run.callEffect({
          operationId: "invalid-response:1",
          slot: "store",
          method: "write",
          input: null,
        }),
      }));
      const completion = session.run();
      transport.push(rootRequest());
      await transport.waitForWrites(1);
      const request = transport.message(0);
      transport.push({
        jsonrpc: "2.0",
        id: request.id as string,
        error,
      });
      await expect(completion).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    }
  });

  test("rejects a pending call with the channel's protocol classification", async () => {
    const transport = new MemoryTransport();
    let resolveObserved!: (code: string) => void;
    const observed = new Promise<string>((resolve) => {
      resolveObserved = resolve;
    });
    const session = new RunSession(transport, async (run) => {
      try {
        await run.callEffect({
          operationId: "peer-failure:1",
          slot: "store",
          method: "write",
          input: null,
        });
      } catch (error) {
        resolveObserved(error instanceof OperationError ? error.code : "not-operation-error");
        throw error;
      }
      return { outcome: "done", output: null };
    });
    const completion = session.run();
    transport.push(rootRequest());
    await transport.waitForWrites(1);
    const request = transport.message(0);
    transport.push({
      jsonrpc: "2.0",
      id: request.id as string,
      error: {
        code: -32000,
        message: "Local code on the wire",
        data: { code: "PROTOCOL_ERROR" },
      },
    });
    await expect(completion).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(await observed).toBe("PROTOCOL_ERROR");
  });
});
