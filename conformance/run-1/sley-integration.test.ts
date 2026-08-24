import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ComponentPeer, type Message } from "./harness/peer";

const component = [process.execPath, resolve(import.meta.dir, "components/sley.ts")];

describe("Sley behind FLOW Run/1", () => {
  test("routes local graph work without inventing another boundary", async () => {
    await withPeer(async (peer, scratch) => {
      peer.send(rootRequest(scratch, { route: "local", value: "hello" }));
      expect(await peer.receive()).toEqual({
        jsonrpc: "2.0",
        id: "host:1",
        result: { outcome: "done", output: { value: "HELLO" } },
      });
      await peer.finish();
    });
  });

  test("routes a graph node through the existing child-Flow operation", async () => {
    await withPeer(async (peer, scratch) => {
      peer.send(rootRequest(scratch, { route: "child", value: "hello" }));
      const call = request(await peer.receive());
      expect(call).toEqual({
        jsonrpc: "2.0",
        id: call.id,
        method: "flow/call",
        params: {
          operationId: "delegate:1",
          slot: "delegate",
          intent: "Process the supplied value.",
          input: { value: "hello" },
        },
      });

      peer.send({
        jsonrpc: "2.0",
        id: call.id,
        result: { outcome: "done", output: { value: "delegated" } },
      });
      expect(await peer.receive()).toEqual({
        jsonrpc: "2.0",
        id: "host:1",
        result: { outcome: "done", output: { value: "delegated" } },
      });
      await peer.finish();
    });
  });

  test("preserves a Run/1 operation failure through Sley's RunError", async () => {
    await withPeer(async (peer, scratch) => {
      peer.send(rootRequest(scratch, { route: "child", value: "hello" }));
      const call = request(await peer.receive());
      peer.send({
        jsonrpc: "2.0",
        id: call.id,
        error: {
          code: -32000,
          message: "delegate is unavailable",
          data: { code: "UNAVAILABLE" },
        },
      });

      expect(await peer.receive()).toEqual({
        jsonrpc: "2.0",
        id: "host:1",
        error: {
          code: -32000,
          message: "delegate is unavailable",
          data: { code: "UNAVAILABLE" },
        },
      });
      await peer.finish();
    });
  });
});

async function withPeer(
  run: (peer: ComponentPeer, scratch: string) => Promise<void>,
): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), "flow-sley-"));
  const peer = new ComponentPeer(component);
  try {
    await run(peer, scratch);
  } finally {
    await peer.dispose();
    await rm(scratch, { recursive: true, force: true });
  }
}

function rootRequest(scratch: string, input: Record<string, unknown>): Message {
  return {
    jsonrpc: "2.0",
    id: "host:1",
    method: "flow/run",
    params: {
      protocol: "run/1",
      input,
      settings: {},
      attachments: {},
      scratch,
      deadlineUnixMs: Date.now() + 60_000,
    },
  };
}

interface Request extends Message {
  readonly id: string;
  readonly method: string;
}

function request(message: Message): Request {
  if (typeof message.id !== "string" || typeof message.method !== "string") {
    throw new Error(`expected request, received ${JSON.stringify(message)}`);
  }
  return message as Request;
}
