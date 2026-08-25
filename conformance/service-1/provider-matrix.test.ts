import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { ComponentPeer, type Message } from "../run-1/harness/peer";

const root = resolve(import.meta.dir, "../..");
const MAX_FRAME_BYTES = 16_777_216;
const python = Bun.which("python3");
const providers: ReadonlyArray<{
  readonly name: string;
  readonly command: readonly string[];
  readonly environment?: Record<string, string>;
}> = [
  {
    name: "TypeScript",
    command: [process.execPath, "run", resolve(import.meta.dir, "components/provider.ts")],
  },
  ...(python === null ? [] : [{
    name: "Python",
    command: [python, resolve(import.meta.dir, "components/provider.py")],
    environment: { PYTHONPATH: resolve(root, "packages/flowmd-sdk/src") },
  }]),
];

if (python === null) test.skip("Python Service/1 Provider matrix requires python3", () => {});

for (const provider of providers) {
  describe(`${provider.name} Service/1 Provider`, () => {
    test("serves concurrent invocations, errors, owned calls, and cleanup", async () => {
      await withPeer(provider, async (peer) => {
        await ready(peer);

        peer.send(invoke("host:2", "slow", null));
        peer.send(invoke("host:3", "echo", "fast"));
        expect(await peer.receive()).toEqual({
          jsonrpc: "2.0",
          id: "host:3",
          result: { value: "fast" },
        });
        peer.send(cancel("host:2"));
        expectOperationError(await peer.receive(), "host:2", "CANCELLED");

        peer.send(invoke("host:4", "missing", { session: "s-1" }));
        expect(await peer.receive()).toEqual({
          jsonrpc: "2.0",
          id: "host:4",
          result: { error: { name: "not-found", data: { session: "s-1" } } },
        });

        peer.send(invoke("host:5", "dependency", { key: "s-2" }));
        const dependency = await peer.receive();
        expect(dependency).toMatchObject({
          method: "effect/call",
          params: {
            ownerRequestId: "host:5",
            operationId: "storage:1",
            slot: "storage",
            method: "read",
            input: { key: "s-2" },
          },
        });
        peer.send(operationError(dependency.id as string, "UNAVAILABLE"));
        expectOperationError(await peer.receive(), "host:5", "UNAVAILABLE");

        await stop(peer);
      });
    });

    test("attributes initialization work to the Mount", async () => {
      await withPeer(provider, async (peer) => {
        peer.send(mount({ initialize: true }));
        const initialization = await peer.receive();
        expect(initialization).toMatchObject({
          method: "effect/call",
          params: { ownerRequestId: "host:1", operationId: "initialize:1" },
        });
        peer.send({ jsonrpc: "2.0", id: initialization.id, result: { value: null } });
        await acknowledgeReady(peer);
        await stop(peer);
      });
    });

    test("rejects detached invocation work and waits for wire settlement", async () => {
      await withPeer(provider, async (peer) => {
        await ready(peer);
        peer.send(invoke("host:2", "detached", { key: "s-3" }));

        const dependency = await peer.receive();
        expect(dependency).toMatchObject({
          method: "effect/call",
          params: {
            ownerRequestId: "host:2",
            operationId: "detached:1",
          },
        });
        expect(await peer.receive()).toEqual(cancel(dependency.id as string));
        await expect(peer.receive(75)).rejects.toThrow("timed out");

        peer.send(operationError(dependency.id as string, "CANCELLED"));
        expectOperationError(await peer.receive(), "host:2", "EXECUTION_FAILED");
        await stop(peer);
      });
    });

    test("never exposes a 65th concurrent Provider request", async () => {
      await withPeer(provider, async (peer) => {
        await ready(peer);
        peer.send(invoke("host:2", "fanout", null));

        const requests: Message[] = [];
        for (let index = 0; index < 64; index += 1) {
          const request = await peer.receive();
          expect(request).toMatchObject({
            method: "effect/call",
            params: { ownerRequestId: "host:2" },
          });
          requests.push(request);
        }
        await expect(peer.receive(75)).rejects.toThrow("timed out");

        peer.send({ jsonrpc: "2.0", id: requests[0]!.id, result: { value: null } });
        let queued: Message | undefined;
        try {
          queued = await peer.receive(100);
        } catch (error) {
          expect(String(error)).toContain("timed out");
        }
        if (queued !== undefined) {
          expect(queued).toMatchObject({ method: "effect/call", params: { ownerRequestId: "host:2" } });
        }
        for (const request of requests.slice(1)) {
          peer.send({ jsonrpc: "2.0", id: request.id, result: { value: null } });
        }
        if (queued !== undefined) {
          peer.send({ jsonrpc: "2.0", id: queued.id, result: { value: null } });
        }

        const terminal = await peer.receive();
        expect(terminal.id).toBe("host:2");
        const value = (terminal.result as { value?: unknown }).value;
        expect(Array.isArray(value)).toBeTrue();
        expect(value as unknown[]).toHaveLength(65);
        await stop(peer);
      });
    });

    test("rejects detached Mount work before voluntary completion", async () => {
      await withPeer(provider, async (peer) => {
        peer.send(mount({ detachedMount: true }));
        await acknowledgeReady(peer);
        const dependency = await peer.receive();
        expect(dependency).toMatchObject({
          method: "effect/call",
          params: { ownerRequestId: "host:1", operationId: "mount-detached:1" },
        });
        expect(await peer.receive()).toEqual(cancel(dependency.id as string));
        await expect(peer.receive(75)).rejects.toThrow("timed out");
        peer.send(operationError(dependency.id as string, "OWNER_CLOSED"));
        expectOperationError(await peer.receive(), "host:1", "EXECUTION_FAILED");
        await peer.finish();
      });
    });

    test("fails fatally when the Host invokes before readiness acknowledgement", async () => {
      await withPeer(provider, async (peer) => {
        peer.send(mount());
        expect((await peer.receive()).method).toBe("service/ready");
        peer.send(invoke("host:2", "echo", null));
        expect(await peer.receive()).toMatchObject({ id: "host:2", error: { code: -32600 } });
        expect(await peer.exit()).toBe(1);
      });
    });

    test("fails fatally on an invalid readiness acknowledgement", async () => {
      await withPeer(provider, async (peer) => {
        peer.send(mount());
        const readiness = await peer.receive();
        peer.send({ jsonrpc: "2.0", id: readiness.id, result: { extra: true } });
        expect(await peer.exit()).toBe(1);
      });
    });

    test("keeps request errors local but closes on malformed cancellation", async () => {
      await withPeer(provider, async (peer) => {
        await ready(peer);
        peer.send({ jsonrpc: "2.0", id: "host:2", method: "unknown/request", params: {} });
        expect(await peer.receive()).toMatchObject({ id: "host:2", error: { code: -32601 } });
        peer.send({
          jsonrpc: "2.0",
          id: "host:3",
          method: "service/invoke",
          params: { export: "sessions" },
        });
        expect(await peer.receive()).toMatchObject({ id: "host:3", error: { code: -32602 } });
        peer.send({
          jsonrpc: "2.0",
          method: "request/cancel",
          params: { requestId: "host:1", extra: true },
        });
        expect(await peer.exit()).toBe(1);
      });
    });

    test("closes after the 65,536-request peer lifetime", async () => {
      await withPeer(provider, async (peer) => {
        for (let index = 1; index <= 65_536; index += 1) {
          const id = `host:lifetime:${index}`;
          peer.send({ jsonrpc: "2.0", id, method: "unknown/request", params: {} });
          expect(await peer.receive()).toMatchObject({ id, error: { code: -32601 } });
        }
        peer.send({
          jsonrpc: "2.0",
          id: "host:lifetime:65537",
          method: "unknown/request",
          params: {},
        });
        expect(await peer.exit()).toBe(1);
      });
    }, 120_000);

    test("accepts an exactly 16 MiB Mount frame", async () => {
      await withPeer(provider, async (peer) => {
        peer.sendBytes(paddedFrame(mount(), MAX_FRAME_BYTES));
        await acknowledgeReady(peer);
        await stop(peer);
      });
    }, 30_000);

    test("closes on a Mount frame one byte over 16 MiB", async () => {
      await withPeer(provider, async (peer) => {
        peer.sendBytes(paddedFrame(mount(), MAX_FRAME_BYTES + 1));
        expect(await peer.exit(30_000)).toBe(1);
      });
    }, 30_000);

    test("closes on invalid UTF-8 and incomplete EOF", async () => {
      await withPeer(provider, async (peer) => {
        peer.sendBytes(Uint8Array.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xff, 0x7d, 0x0a]));
        expect(await peer.exit()).toBe(1);
      });
      await withPeer(provider, async (peer) => {
        peer.sendBytes(new TextEncoder().encode('{"jsonrpc":"2.0"}'));
        peer.closeInput();
        expect(await peer.exit()).toBe(1);
      });
    });
  });
}

async function ready(peer: ComponentPeer): Promise<void> {
  peer.send(mount());
  await acknowledgeReady(peer);
}

async function acknowledgeReady(peer: ComponentPeer): Promise<void> {
  const readiness = await peer.receive();
  expect(readiness).toMatchObject({
    method: "service/ready",
    params: { ownerRequestId: "host:1", exports: ["sessions"] },
  });
  peer.send({ jsonrpc: "2.0", id: readiness.id, result: {} });
}

async function stop(peer: ComponentPeer): Promise<void> {
  peer.send(cancel("host:1"));
  expect(await peer.receive()).toEqual({ jsonrpc: "2.0", id: "host:1", result: {} });
  await peer.finish();
}

function mount(settings: Record<string, unknown> = {}): Message {
  return {
    jsonrpc: "2.0",
    id: "host:1",
    method: "service/mount",
    params: {
      protocol: "service/1",
      settings,
      attachments: {},
      scratch: "/scratch",
      startupDeadlineUnixMs: Date.now() + 10_000,
    },
  };
}

function invoke(id: string, method: string, input: unknown): Message {
  return {
    jsonrpc: "2.0",
    id,
    method: "service/invoke",
    params: {
      export: "sessions",
      method,
      input,
      deadlineUnixMs: Date.now() + 10_000,
    },
  };
}

function cancel(requestId: string): Message {
  return { jsonrpc: "2.0", method: "request/cancel", params: { requestId } };
}

function operationError(id: string, code: string): Message {
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32000, message: code, data: { code } },
  };
}

function expectOperationError(message: Message, id: string, code: string): void {
  expect(message).toMatchObject({ id, error: { code: -32000, data: { code } } });
}

function paddedFrame(message: Message, payloadBytes: number): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(message));
  if (encoded.byteLength > payloadBytes) throw new Error("message exceeds requested frame size");
  const frame = new Uint8Array(payloadBytes + 1);
  frame.fill(0x20);
  frame.set(encoded);
  frame[payloadBytes] = 0x0a;
  return frame;
}

async function withPeer(
  provider: (typeof providers)[number],
  run: (peer: ComponentPeer) => Promise<void>,
): Promise<void> {
  const peer = new ComponentPeer(provider.command, provider.environment);
  try {
    await run(peer);
  } finally {
    await peer.dispose();
  }
}
