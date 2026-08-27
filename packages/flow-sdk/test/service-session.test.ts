import { describe, expect, test } from "bun:test";

import { decodeJson, encodeJson } from "../src/json.ts";
import { ServiceSession } from "../src/service-session.ts";
import type { Transport } from "../src/transport.ts";
import {
  ServiceError,
  type JsonObject,
  type JsonValue,
  type ServiceMountContext,
} from "../src/types.ts";

class MemoryTransport implements Transport {
  readonly writes: Uint8Array[] = [];
  private readonly chunks: Uint8Array[] = [];
  private readonly readers: Array<(value: IteratorResult<Uint8Array>) => void> = [];
  private readonly writeWaiters: Array<() => void> = [];
  private stopped = false;

  readonly input: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => ({ next: () => this.nextChunk() }),
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
    const reader = this.readers.shift();
    if (reader) reader({ done: false, value: line });
    else this.chunks.push(line);
  }

  async waitForWrites(count: number): Promise<void> {
    while (this.writes.length < count) await new Promise<void>((resolve) => this.writeWaiters.push(resolve));
  }

  message(index: number): Record<string, JsonValue> {
    const line = this.writes[index];
    if (line === undefined) throw new Error(`missing write ${index}`);
    const value = decodeJson(line.subarray(0, line.byteLength - 1));
    if (value === null || Array.isArray(value) || typeof value !== "object") throw new Error("write was not an object");
    return value as Record<string, JsonValue>;
  }

  private nextChunk(): Promise<IteratorResult<Uint8Array>> {
    const chunk = this.chunks.shift();
    if (chunk !== undefined) return Promise.resolve({ done: false, value: chunk });
    if (this.stopped) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve) => this.readers.push(resolve));
  }
}

describe("ServiceSession", () => {
  test("mounts, acknowledges readiness, invokes, and cleans up", async () => {
    const transport = new MemoryTransport();
    const session = new ServiceSession(transport, {
      exports: {
        sessions: async (context) => ({ method: context.method, input: context.input }),
      },
      async mount(context) {
        await context.ready();
        await context.cancelled;
      },
    });
    const completion = session.run();
    await acknowledgeReady(transport);

    transport.push(invoke("host:2", "sessions", "read", { session: "s-1" }));
    await transport.waitForWrites(2);
    expect(transport.message(1)).toEqual({
      jsonrpc: "2.0",
      id: "host:2",
      result: { value: { method: "read", input: { session: "s-1" } } },
    });

    transport.push(cancel("host:1"));
    await completion;
    expect(transport.message(2)).toEqual({ jsonrpc: "2.0", id: "host:1", result: {} });
  });

  test("projects declared Service errors as tagged results", async () => {
    const transport = new MemoryTransport();
    const session = new ServiceSession(transport, {
      exports: {
        sessions: async () => {
          throw new ServiceError("not-found", { session: "s-1" });
        },
      },
      async mount(context) {
        await context.ready();
        await context.cancelled;
      },
    });
    const completion = session.run();
    await acknowledgeReady(transport);
    transport.push(invoke("host:2", "sessions", "read", null));
    await transport.waitForWrites(2);
    expect(transport.message(1).result).toEqual({
      error: { name: "not-found", data: { session: "s-1" } },
    });
    transport.push(cancel("host:1"));
    await completion;
  });

  test("attributes dependency calls to the exact invocation owner", async () => {
    const transport = new MemoryTransport();
    const session = new ServiceSession(transport, {
      exports: {
        sessions: async (context) => await context.callEffect({
          operationId: "load:1",
          slot: "storage",
          method: "read",
          input: context.input,
        }),
      },
      async mount(context) {
        await context.ready();
        await context.cancelled;
      },
    });
    const completion = session.run();
    await acknowledgeReady(transport);
    transport.push(invoke("host:2", "sessions", "read", { key: "s-1" }));
    await transport.waitForWrites(2);
    expect(transport.message(1)).toEqual({
      jsonrpc: "2.0",
      id: "provider:2",
      method: "effect/call",
      params: {
        ownerRequestId: "host:2",
        operationId: "load:1",
        slot: "storage",
        method: "read",
        input: { key: "s-1" },
      },
    });
    transport.push({ jsonrpc: "2.0", id: "provider:2", result: { value: { found: true } } });
    await transport.waitForWrites(3);
    expect(transport.message(2)).toEqual({
      jsonrpc: "2.0",
      id: "host:2",
      result: { value: { found: true } },
    });
    transport.push(cancel("host:1"));
    await completion;
  });

  test("attributes initialization calls to the mount owner", async () => {
    const transport = new MemoryTransport();
    const session = new ServiceSession(transport, {
      exports: { sessions: async () => null },
      async mount(context) {
        await context.callEffect({
          operationId: "open:1",
          slot: "storage",
          method: "open",
          input: null,
        });
        await context.ready();
        await context.cancelled;
      },
    });
    const completion = session.run();
    transport.push(mount());
    await transport.waitForWrites(1);
    expect(transport.message(0)).toEqual({
      jsonrpc: "2.0",
      id: "provider:1",
      method: "effect/call",
      params: {
        ownerRequestId: "host:1",
        operationId: "open:1",
        slot: "storage",
        method: "open",
        input: null,
      },
    });
    transport.push({ jsonrpc: "2.0", id: "provider:1", result: { value: null } });
    await transport.waitForWrites(2);
    expect(transport.message(1)).toEqual({
      jsonrpc: "2.0",
      id: "provider:2",
      method: "service/ready",
      params: { ownerRequestId: "host:1", exports: ["sessions"] },
    });
    transport.push({ jsonrpc: "2.0", id: "provider:2", result: {} });
    transport.push(cancel("host:1"));
    await completion;
  });

  test("cancels one invocation without cancelling its sibling", async () => {
    const transport = new MemoryTransport();
    let slowStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      slowStarted = resolve;
    });
    const session = new ServiceSession(transport, {
      exports: {
        sessions: async (context) => {
          if (context.input !== "slow") return context.input;
          slowStarted();
          await new Promise<void>((resolve) => {
            context.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return "must-not-win";
        },
      },
      async mount(context) {
        await context.ready();
        await context.cancelled;
      },
    });
    const completion = session.run();
    await acknowledgeReady(transport);
    transport.push(invoke("host:2", "sessions", "read", "slow"));
    await started;
    transport.push(invoke("host:3", "sessions", "read", "fast"));
    await transport.waitForWrites(2);
    expect(transport.message(1)).toMatchObject({ id: "host:3", result: { value: "fast" } });

    transport.push(cancel("host:2"));
    await transport.waitForWrites(3);
    expect(transport.message(2)).toMatchObject({
      id: "host:2",
      error: { code: -32000, data: { code: "CANCELLED" } },
    });
    transport.push(cancel("host:1"));
    await completion;
  });

  test("rejects invocation before readiness acknowledgement", async () => {
    const transport = new MemoryTransport();
    const session = new ServiceSession(transport, {
      exports: { sessions: async () => null },
      async mount(context) {
        await context.ready();
      },
    });
    const completion = session.run();
    transport.push(mount());
    await transport.waitForWrites(1);
    transport.push(invoke("host:2", "sessions", "read", null));
    await expect(completion).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    expect(transport.message(1)).toMatchObject({
      jsonrpc: "2.0",
      id: "host:2",
      error: { code: -32600 },
    });
  });

  test("reports a mount that returns before readiness as an invalid result", async () => {
    const transport = new MemoryTransport();
    const session = new ServiceSession(transport, {
      exports: { sessions: async () => null },
      async mount() {},
    });
    const completion = session.run();
    transport.push(mount());
    await completion;
    expect(transport.message(0)).toMatchObject({
      jsonrpc: "2.0",
      id: "host:1",
      error: { code: -32000, data: { code: "INVALID_RESULT" } },
    });
  });

  test("reports non-JSON invocation output as an invalid result", async () => {
    const transport = new MemoryTransport();
    const session = new ServiceSession(transport, {
      exports: {
        sessions: async () => undefined as unknown as JsonValue,
      },
      async mount(context) {
        await context.ready();
        await context.cancelled;
      },
    });
    const completion = session.run();
    await acknowledgeReady(transport);
    transport.push(invoke("host:2", "sessions", "read", null));
    await transport.waitForWrites(2);
    expect(transport.message(1)).toMatchObject({
      jsonrpc: "2.0",
      id: "host:2",
      error: { code: -32000, data: { code: "INVALID_RESULT" } },
    });
    transport.push(cancel("host:1"));
    await completion;
  });

  test("captures a closed static export map and permits a background-only Mount", async () => {
    const transport = new MemoryTransport();
    const background = new ServiceSession(transport, {
      exports: {},
      async mount(context) {
        await context.ready();
        await context.cancelled;
      },
    });
    const completion = background.run();
    transport.push(mount());
    await transport.waitForWrites(1);
    expect(transport.message(0)).toMatchObject({
      method: "service/ready",
      params: { ownerRequestId: "host:1", exports: [] },
    });
    transport.push({ jsonrpc: "2.0", id: "provider:1", result: {} });
    transport.push(cancel("host:1"));
    await completion;
    expect(transport.message(1)).toEqual({ jsonrpc: "2.0", id: "host:1", result: {} });

    const exports = {} as Record<string, () => Promise<JsonValue>>;
    Object.defineProperty(exports, "sessions", { enumerable: true, get: () => async () => null });
    expect(() => new ServiceSession(transport, {
      exports,
      async mount() {},
    })).toThrow("enumerable data function");
  });

  test("snapshots the mount handler before protocol input", async () => {
    const transport = new MemoryTransport();
    const mutable = {
      exports: { sessions: async () => null },
      mount: async (context: ServiceMountContext) => {
        await context.ready();
        await context.cancelled;
      },
    };
    const session = new ServiceSession(transport, mutable);
    mutable.mount = async () => {
      throw new Error("mutated handler must not run");
    };
    const completion = session.run();
    await acknowledgeReady(transport);
    transport.push(cancel("host:1"));
    await completion;
  });
});

async function acknowledgeReady(transport: MemoryTransport): Promise<void> {
  transport.push(mount());
  await transport.waitForWrites(1);
  expect(transport.message(0)).toEqual({
    jsonrpc: "2.0",
    id: "provider:1",
    method: "service/ready",
    params: { ownerRequestId: "host:1", exports: ["sessions"] },
  });
  transport.push({ jsonrpc: "2.0", id: "provider:1", result: {} });
}

function mount(): JsonObject {
  return {
    jsonrpc: "2.0",
    id: "host:1",
    method: "service/mount",
    params: {
      protocol: "service/1",
      settings: {},
      attachments: {},
      scratch: "/scratch",
      startupDeadlineUnixMs: 4_000_000_000_000,
    },
  };
}

function invoke(id: string, exportName: string, method: string, input: JsonValue): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    method: "service/invoke",
    params: { export: exportName, method, input, deadlineUnixMs: 4_000_000_000_000 },
  };
}

function cancel(requestId: string): JsonObject {
  return { jsonrpc: "2.0", method: "request/cancel", params: { requestId } };
}
