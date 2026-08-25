import { describe, expect, test } from "bun:test";

import { canonicalJson, decodeJson1, type JsonObject, type JsonValue } from "../src/json.js";
import type { ExactComponentExit, ExactComponentProcess } from "../src/run/session.js";
import {
  ServiceHostSession,
  type ServiceHostActivation,
} from "../src/service/session.js";

describe("private ServiceHostSession", () => {
  test("mounts, admits one invocation after readiness, and stops cleanly", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    const started = service.start();
    expect(await process.nextHost()).toMatchObject({ id: "host:1", method: "service/mount" });
    process.emit(ready("provider:1", ["sessions"]));
    expect(await process.nextHost()).toEqual({ jsonrpc: "2.0", id: "provider:1", result: {} });
    await started;

    const invoked = service.invoke(invocation("read", { session: "s-1" }));
    expect(await process.nextHost()).toEqual({
      jsonrpc: "2.0",
      id: "host:2",
      method: "service/invoke",
      params: {
        export: "sessions",
        method: "read",
        input: { session: "s-1" },
        deadlineUnixMs: 4_000_000_000_000,
      },
    });
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: { found: true } } });
    expect(await invoked).toEqual({ status: "succeeded", value: { found: true } });

    const stopped = service.stop();
    expect(await process.nextHost()).toEqual(cancel("host:1"));
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.finish(0);
    expect(await stopped).toMatchObject({ status: "succeeded" });
  });

  test("rejects a readiness set that differs from admission", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    const started = service.start();
    await process.nextHost();
    process.emit(ready("provider:1", ["documents"]));
    expect(await process.nextHost()).toMatchObject({ id: "provider:1", error: { code: -32602 } });
    await expect(started).rejects.toThrow("PROTOCOL_ERROR");
    expect(await service.result()).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("accepts mount-owned calls before readiness and scopes operation reuse", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    const started = service.start();
    await process.nextHost();
    const first = providerEffect("provider:1", "host:1", "open:1", null);
    process.emit(first);
    expect(operationCode(await process.nextHost())).toBe("UNAVAILABLE");
    process.emit({ ...first, id: "provider:2" });
    expect(operationCode(await process.nextHost())).toBe("UNAVAILABLE");
    process.emit(providerEffect("provider:3", "host:1", "open:1", { changed: true }));
    expect(operationCode(await process.nextHost())).toBe("OPERATION_CONFLICT");
    process.emit(ready("provider:4", ["sessions"]));
    await process.nextHost();
    await started;
    const stopped = service.stop();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.finish(0);
    expect((await stopped).status).toBe("succeeded");
  });

  test("keeps unknown Provider requests local but closes on malformed cancellation", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    const started = service.start();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "provider:1", method: "unknown/request", params: {} });
    expect(await process.nextHost()).toMatchObject({ id: "provider:1", error: { code: -32601 } });
    process.emit({
      jsonrpc: "2.0",
      method: "request/cancel",
      params: { requestId: "host:1", extra: true },
    });
    await expect(started).rejects.toThrow("PROTOCOL_ERROR");
    expect(await service.result()).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("settles concurrent invocations out of order", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const first = service.invoke(invocation("read", "first"));
    const second = service.invoke(invocation("read", "second"));
    expect((await process.nextHost() as JsonObject).id).toBe("host:2");
    expect((await process.nextHost() as JsonObject).id).toBe("host:3");
    process.emit({ jsonrpc: "2.0", id: "host:3", result: { value: "second" } });
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { error: { name: "not-found", data: null } } });
    expect(await second).toEqual({ status: "succeeded", value: "second" });
    expect(await first).toEqual({ status: "application-error", name: "not-found", data: null });
    await cleanStop(service, process);
  });

  test("admits at most 63 invocations beside the pending Mount", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const pending = Array.from({ length: 63 }, (_, index) => service.invoke(invocation("read", index)));
    for (let index = 0; index < pending.length; index += 1) {
      expect(await process.nextHost()).toMatchObject({ id: `host:${index + 2}`, method: "service/invoke" });
    }
    expect(await service.invoke(invocation("read", "overflow"))).toMatchObject({
      status: "failed",
      code: "RESOURCE_EXHAUSTED",
    });
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      process.emit({ jsonrpc: "2.0", id: `host:${index + 2}`, result: { value: index } });
    }
    expect(await Promise.all(pending)).toHaveLength(63);
    await cleanStop(service, process);
  });

  test("cancels one invocation without cancelling its sibling", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation(), { cancellationGraceMs: 100 });
    await startReady(service, process);
    const controller = new AbortController();
    const slow = service.invoke({ ...invocation("read", "slow"), signal: controller.signal });
    const fast = service.invoke(invocation("read", "fast"));
    await process.nextHost();
    await process.nextHost();
    controller.abort();
    expect(await process.nextHost()).toEqual(cancel("host:2"));
    process.emit({ jsonrpc: "2.0", id: "host:3", result: { value: "fast" } });
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: "too-late" } });
    expect(await fast).toEqual({ status: "succeeded", value: "fast" });
    expect(await slow).toMatchObject({ status: "failed", code: "CANCELLED" });
    await cleanStop(service, process);
  });

  test("lets a committed invocation result win later cancellation", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const controller = new AbortController();
    const invoked = service.invoke({ ...invocation("read", null), signal: controller.signal });
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: "committed" } });
    expect(await invoked).toEqual({ status: "succeeded", value: "committed" });
    controller.abort();
    await cleanStop(service, process);
  });

  test("keeps the first deadline decision when a response arrives later", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation(), { cancellationGraceMs: 100 });
    await startReady(service, process);
    const invoked = service.invoke({ ...invocation("read", null), deadlineUnixMs: Date.now() + 10 });
    await process.nextHost();
    expect(await process.nextHost()).toEqual(cancel("host:2"));
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: "too-late" } });
    expect(await invoked).toMatchObject({ status: "failed", code: "DEADLINE_EXCEEDED" });
    await cleanStop(service, process);
  });

  test("rejects stale invocation ownership without losing the Mount", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const invoked = service.invoke(invocation("read", null));
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: null } });
    await invoked;
    process.emit(providerEffect("provider:2", "host:2", "late:1", null));
    expect(operationCode(await process.nextHost())).toBe("OWNER_CLOSED");
    await cleanStop(service, process);
  });

  test("treats mount success before readiness as a protocol failure", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    const started = service.start();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    await expect(started).rejects.toThrow("PROTOCOL_ERROR");
    expect(await service.result()).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("does not report Mount success after an unclean process exit", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const stopped = service.stop();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.finish(7);
    expect(await stopped).toMatchObject({ status: "failed", code: "EXECUTION_FAILED" });
  });

  test("invalidates Mount success after a trailing frame", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const stopped = service.stop();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.emit({ jsonrpc: "2.0", method: "unknown/event", params: {} });
    expect(await stopped).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("invalidates Mount success after an incomplete trailing frame", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const stopped = service.stop();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.emitBytes(new TextEncoder().encode("{\"jsonrpc\":\"2.0\"}"));
    process.finish(0);
    expect(await stopped).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("classifies process loss before readiness as channel loss", async () => {
    const clean = new FakeProcess();
    const cleanService = new ServiceHostSession(clean, activation());
    const cleanStart = cleanService.start();
    await clean.nextHost();
    clean.finish(0);
    await expect(cleanStart).rejects.toThrow("CHANNEL_LOST");
    expect(await cleanService.result()).toMatchObject({ status: "failed", code: "CHANNEL_LOST" });

    const unclean = new FakeProcess();
    const uncleanService = new ServiceHostSession(unclean, activation());
    const uncleanStart = uncleanService.start();
    await unclean.nextHost();
    unclean.finish(9);
    await expect(uncleanStart).rejects.toThrow("CHANNEL_LOST");
    expect(await uncleanService.result()).toMatchObject({ status: "failed", code: "CHANNEL_LOST" });
  });

  test("enforces the startup deadline and terminates an unready Provider", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, {
      ...activation(),
      startupDeadlineUnixMs: Date.now() + 10,
    }, { cancellationGraceMs: 1 });
    const started = service.start();
    await process.nextHost();
    await expect(started).rejects.toThrow("DEADLINE_EXCEEDED");
    expect(await process.nextHost()).toEqual(cancel("host:1"));
    expect(await service.result()).toMatchObject({ status: "failed", code: "DEADLINE_EXCEEDED" });
  });

  test("invalidates Mount success when diagnostics exceed the host budget", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation(), {
      stderrBytes: 4,
      capturedStderrBytes: 3,
    });
    await startReady(service, process);
    const stopped = service.stop();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.emitStderr(new TextEncoder().encode("diagnostic"));
    expect(await stopped).toMatchObject({
      status: "failed",
      code: "RESOURCE_EXHAUSTED",
      diagnostics: { stderr: "dia", stderrBytes: 10, stderrTruncated: true },
    });
  });

  test("snapshots activation and invocation values before delayed transport", async () => {
    const process = new FakeProcess();
    const mutableSettings = { mode: "original" };
    const mutableActivation = {
      ...activation(),
      settings: mutableSettings,
      exports: ["sessions"],
    };
    const service = new ServiceHostSession(process, mutableActivation);
    mutableSettings.mode = "changed";
    mutableActivation.exports[0] = "documents";
    const started = service.start();
    expect(await process.nextHost()).toMatchObject({
      params: { settings: { mode: "original" } },
    });
    process.emit(ready("provider:1", ["sessions"]));
    await process.nextHost();
    await started;

    const input = { key: "original" };
    const invoked = service.invoke(invocation("read", input));
    input.key = "changed";
    expect(await process.nextHost()).toMatchObject({ params: { input: { key: "original" } } });
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: null } });
    await invoked;
    await cleanStop(service, process);
  });

  test("does not dispatch an invocation already cancelled or expired", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const controller = new AbortController();
    controller.abort();
    expect(await service.invoke({ ...invocation("read", null), signal: controller.signal })).toMatchObject({
      status: "failed",
      code: "CANCELLED",
    });
    expect(await service.invoke({ ...invocation("read", null), deadlineUnixMs: 0 })).toMatchObject({
      status: "failed",
      code: "DEADLINE_EXCEEDED",
    });

    const valid = service.invoke(invocation("read", null));
    expect(await process.nextHost()).toMatchObject({ id: "host:2", method: "service/invoke" });
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: null } });
    await valid;
    await cleanStop(service, process);
  });
});

function activation(): ServiceHostActivation {
  return {
    settings: {},
    attachments: {},
    scratch: "/scratch",
    startupDeadlineUnixMs: 4_000_000_000_000,
    exports: ["sessions"],
  };
}

function invocation(method: string, input: JsonValue) {
  return {
    exportName: "sessions",
    method,
    input,
    deadlineUnixMs: 4_000_000_000_000,
  } as const;
}

async function startReady(service: ServiceHostSession, process: FakeProcess): Promise<void> {
  const started = service.start();
  await process.nextHost();
  process.emit(ready("provider:1", ["sessions"]));
  await process.nextHost();
  await started;
}

async function cleanStop(service: ServiceHostSession, process: FakeProcess): Promise<void> {
  const stopped = service.stop();
  expect(await process.nextHost()).toEqual(cancel("host:1"));
  process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
  process.finish(0);
  expect((await stopped).status).toBe("succeeded");
}

function ready(id: string, exports: readonly string[]): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    method: "service/ready",
    params: { ownerRequestId: "host:1", exports: [...exports] },
  };
}

function providerEffect(
  id: string,
  ownerRequestId: string,
  operationId: string,
  input: JsonValue,
): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    method: "effect/call",
    params: {
      ownerRequestId,
      operationId,
      slot: "storage",
      method: "read",
      input,
    },
  };
}

function cancel(requestId: string): JsonObject {
  return { jsonrpc: "2.0", method: "request/cancel", params: { requestId } };
}

function operationCode(value: JsonValue): string {
  return (((value as JsonObject).error as JsonObject).data as JsonObject).code as string;
}

class FakeProcess implements ExactComponentProcess {
  readonly stdout = new BytePipe();
  readonly stderr = new BytePipe();
  readonly completion: Promise<ExactComponentExit>;
  private readonly host = new ValuePipe();
  private readonly complete: (exit: ExactComponentExit) => void;
  private finished = false;

  constructor() {
    let complete!: (exit: ExactComponentExit) => void;
    this.completion = new Promise((resolve) => {
      complete = resolve;
    });
    this.complete = complete;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (this.finished) throw new Error("process already exited");
    if (bytes.at(-1) !== 0x0a) throw new Error("host write is not framed");
    this.host.push(decodeJson1(bytes.subarray(0, -1)));
  }

  async closeInput(): Promise<void> {}

  async terminate(): Promise<void> {
    this.finish(null, "SIGKILL");
  }

  async nextHost(): Promise<JsonValue> {
    return this.host.next();
  }

  emit(value: JsonValue): void {
    const bytes = canonicalJson(value);
    const frame = new Uint8Array(bytes.byteLength + 1);
    frame.set(bytes);
    frame[bytes.byteLength] = 0x0a;
    this.stdout.push(frame);
  }

  emitBytes(bytes: Uint8Array): void {
    this.stdout.push(bytes);
  }

  emitStderr(bytes: Uint8Array): void {
    this.stderr.push(bytes);
  }

  finish(exitCode: number | null, signal: string | null = null): void {
    if (this.finished) return;
    this.finished = true;
    this.stdout.end();
    this.stderr.end();
    this.complete({ exitCode, signal, fenced: true });
  }
}

class BytePipe implements AsyncIterable<Uint8Array> {
  private readonly values: Uint8Array[] = [];
  private readonly waiters: Array<(value: IteratorResult<Uint8Array>) => void> = [];
  private ended = false;

  push(value: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (waiter === undefined) this.values.push(value);
    else waiter({ done: false, value });
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
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

class ValuePipe {
  private readonly values: JsonValue[] = [];
  private readonly waiters: Array<(value: JsonValue) => void> = [];

  push(value: JsonValue): void {
    const waiter = this.waiters.shift();
    if (waiter === undefined) this.values.push(value);
    else waiter(value);
  }

  async next(): Promise<JsonValue> {
    const value = this.values.shift();
    if (value !== undefined) return value;
    return Promise.race([
      new Promise<JsonValue>((resolve) => this.waiters.push(resolve)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("host write timeout")), 1_000)),
    ]);
  }
}
