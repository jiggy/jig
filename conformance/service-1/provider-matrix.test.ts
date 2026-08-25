import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { ComponentPeer, type Message } from "../run-1/harness/peer";

const root = resolve(import.meta.dir, "../..");
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
