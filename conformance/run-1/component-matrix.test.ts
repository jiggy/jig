import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ComponentPeer, type Message } from "./harness/peer";

const root = resolve(import.meta.dir, "../..");
const standardComponents = componentCommands("flow");
const matrixComponents = componentCommands("matrix");

if (!standardComponents.some((component) => component.name.startsWith("Python "))) {
  test.skip("Python Run/1 component matrix (python3 or need launcher unavailable)", () => {});
}

for (const component of standardComponents) {
  describe(`${component.name} Run/1 component matrix`, () => {
    test("enforces request form and direction without poisoning the channel", async () => {
      await withPeer(component.command, async (peer) => {
        const wrongRequests = ["request/cancel", "flow/call", "effect/call"];
        for (const [index, method] of wrongRequests.entries()) {
          const id = `host:wrong:${index}`;
          peer.send({
            jsonrpc: "2.0",
            id,
            method,
            params: method === "request/cancel" ? { requestId: "host:none" } : {},
          });
          expectStandardError(await peer.receive(), id, -32601);
        }

        for (const method of ["flow/run", "flow/call", "effect/call", "unknown/event"]) {
          peer.send({ jsonrpc: "2.0", method, params: {} });
        }
        peer.send(invalidRoot("host:end"));
        expectStandardError(await peer.receive(), "host:end", -32602);
        await expectClosed(peer);
      });
    });

    for (const [name, params] of invalidRootParams()) {
      test(`rejects malformed root params: ${name}`, async () => {
        await withPeer(component.command, async (peer) => {
          peer.send({
            jsonrpc: "2.0",
            id: "host:bad-root",
            method: "flow/run",
            params,
          });
          expectStandardError(await peer.receive(), "host:bad-root", -32602);
          await expectClosed(peer);
        });
      });
    }

    test("treats a second root Run as fatal", async () => {
      await withScratch(async (scratch) => {
        await withPeer(component.command, async (peer) => {
          peer.send(rootRequest("host:1", scratch));
          peer.send(rootRequest("host:2", scratch));

          let secondRootError: Message | undefined;
          for (let count = 0; count < 4 && secondRootError === undefined; count += 1) {
            const message = await peer.receive();
            if (message.id === "host:2") secondRootError = message;
          }
          expectStandardError(secondRootError, "host:2", -32600);
          await expectClosed(peer);
        });
      });
    });

    test("cancels the owned subtree but waits for outbound wire settlement", async () => {
      await withScratch(async (scratch) => {
        await withPeer(component.command, async (peer) => {
          peer.send(rootRequest("host:cancel", scratch));
          const requests = [asRequest(await peer.receive()), asRequest(await peer.receive())];

          peer.send(cancel("host:cancel"));
          peer.send(cancel("host:cancel"));
          const cancellations = [await peer.receive(), await peer.receive()];
          expect(
            cancellations.map(cancelTarget).sort(),
          ).toEqual(requests.map((request) => request.id).sort());

          await expect(peer.receive(75)).rejects.toThrow("timed out");

          for (const request of requests) {
            peer.send({
              jsonrpc: "2.0",
              id: request.id,
              result: request.method === "flow/call"
                ? { outcome: "done", output: null }
                : { value: null },
            });
          }

          expectOperationError(await peer.receive(), "host:cancel", "CANCELLED");
          await expectClosed(peer);
        });
      });
    });

    test("treats malformed cancellation as fatal", async () => {
      await withScratch(async (scratch) => {
        await withPeer(component.command, async (peer) => {
          peer.send(rootRequest("host:1", scratch));
          await peer.receive();
          await peer.receive();
          peer.send({
            jsonrpc: "2.0",
            method: "request/cancel",
            params: { requestId: "host:1", extra: true },
          });
          await expectClosed(peer);
        });
      });
    });

    for (const frameCase of fatalFrames()) {
      test(`closes on ${frameCase.name}`, async () => {
        await withPeer(component.command, async (peer) => {
          peer.sendBytes(frameCase.bytes);
          if (frameCase.responseCode === undefined) {
            await expect(peer.receive()).rejects.toThrow("stdout closed");
          } else {
            expectStandardError(await peer.receive(), null, frameCase.responseCode);
          }
          await expectClosed(peer);
        });
      });
    }
  });
}

for (const component of matrixComponents) {
  test(`${component.name} never puts a 65th component request on the wire concurrently`, async () => {
    await withScratch(async (scratch) => {
      await withPeer(component.command, async (peer) => {
        peer.send(rootRequest("host:fanout", scratch, { case: "fanout-65" }));

        const pending: Request[] = [];
        for (let count = 0; count < 64; count += 1) {
          pending.push(asRequest(await peer.receive()));
        }
        expect(new Set(pending.map((request) => request.id)).size).toBe(64);
        expect(pending.every((request) => request.method === "effect/call")).toBeTrue();
        await expect(peer.receive(75)).rejects.toThrow("timed out");

        for (const request of pending) {
          peer.send({ jsonrpc: "2.0", id: request.id, result: { value: null } });
        }

        const next = await peer.receive();
        if (next.method === "effect/call") {
          const queued = asRequest(next);
          peer.send({ jsonrpc: "2.0", id: queued.id, result: { value: null } });
          expect(await peer.receive()).toEqual({
            jsonrpc: "2.0",
            id: "host:fanout",
            result: { outcome: "done", output: { settled: 65 } },
          });
        } else {
          expect(next).toEqual({
            jsonrpc: "2.0",
            id: "host:fanout",
            result: { outcome: "done", output: { settled: 65 } },
          });
        }
        await peer.finish();
      });
    });
  });
}

test("a nonzero exit invalidates a complete root response", async () => {
  const response = JSON.stringify({
    jsonrpc: "2.0",
    id: "host:1",
    result: { outcome: "done", output: null },
  });
  const peer = new ComponentPeer([
    process.execPath,
    "-e",
    `process.stdout.write(${JSON.stringify(`${response}\n`)}, () => process.exit(7))`,
  ]);
  try {
    expect(await peer.receive()).toEqual(JSON.parse(response));
    await expect(peer.finish()).rejects.toThrow("component exited 7");
  } finally {
    await peer.dispose();
  }
});

interface ComponentCommand {
  readonly name: string;
  readonly command: readonly string[];
}

interface Request extends Message {
  readonly id: string;
  readonly method: string;
}

function componentCommands(stem: string): ComponentCommand[] {
  const commands: ComponentCommand[] = [{
    name: `TypeScript ${stem}`,
    command: [process.execPath, resolve(import.meta.dir, `components/${stem}.ts`)],
  }];
  const python = Bun.which("python3");
  const script = resolve(import.meta.dir, `components/${stem}.py`);
  if (python) {
    commands.push({ name: `Python ${stem}`, command: [python, script] });
  } else {
    const need = Bun.which("need");
    if (need) {
      commands.push({
        name: `Python ${stem}`,
        command: [need, "run", "python3", "--", "python3", script],
      });
    }
  }
  return commands;
}

async function withPeer(
  command: readonly string[],
  action: (peer: ComponentPeer) => Promise<void>,
): Promise<void> {
  const peer = new ComponentPeer(command, {
    PYTHONPATH: resolve(root, "packages/flowmd-sdk/src"),
    XDG_CACHE_HOME: resolve(root, ".tmp/need-cache"),
  });
  try {
    await action(peer);
  } finally {
    await peer.dispose();
  }
}

async function withScratch(action: (scratch: string) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), "flow-run-1-matrix-"));
  try {
    await action(scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function expectClosed(peer: ComponentPeer): Promise<void> {
  await peer.exit();
  await expect(peer.receive(1_000)).rejects.toThrow("component stdout closed");
}

function rootRequest(id: string, scratch: string, input: unknown = {}): Message {
  return {
    jsonrpc: "2.0",
    id,
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

function invalidRoot(id: string): Message {
  return { jsonrpc: "2.0", id, method: "flow/run", params: {} };
}

function invalidRootParams(): Array<readonly [string, unknown]> {
  const valid = {
    protocol: "run/1",
    input: {},
    settings: {},
    attachments: {},
    scratch: "/scratch",
    deadlineUnixMs: 0,
  };
  return [
    ["missing field", { ...valid, scratch: undefined }],
    ["unknown field", { ...valid, unknown: true }],
    ["wrong protocol", { ...valid, protocol: "run/2" }],
    ["257 attachments", {
      ...valid,
      attachments: Object.fromEntries(
        Array.from({ length: 257 }, (_, index) => [`a${index}`, { path: "/x", access: "read" }]),
      ),
    }],
  ];
}

function fatalFrames(): Array<{
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly responseCode?: number;
}> {
  return [
    {
      name: "complete invalid JSON",
      bytes: new TextEncoder().encode("{\"jsonrpc\":\n"),
      responseCode: -32700,
    },
    {
      name: "a parsed batch",
      bytes: new TextEncoder().encode("[]\n"),
      responseCode: -32600,
    },
    {
      name: "invalid UTF-8",
      bytes: Uint8Array.from([0xff, 0x0a]),
    },
  ];
}

function expectStandardError(
  message: Message | undefined,
  id: string | null,
  code: number,
): void {
  expect(message).toMatchObject({ jsonrpc: "2.0", id, error: { code } });
  expect(typeof (message!.error as Record<string, unknown>).message).toBe("string");
}

function expectOperationError(message: Message, id: string, code: string): void {
  expect(message).toMatchObject({
    jsonrpc: "2.0",
    id,
    error: { code: -32000, data: { code } },
  });
  expect(typeof (message.error as Record<string, unknown>).message).toBe("string");
}

function cancel(requestId: string): Message {
  return { jsonrpc: "2.0", method: "request/cancel", params: { requestId } };
}

function cancelTarget(message: Message): string {
  expect(message).toMatchObject({ jsonrpc: "2.0", method: "request/cancel" });
  const params = message.params as Record<string, unknown>;
  expect(Object.keys(params)).toEqual(["requestId"]);
  expect(typeof params.requestId).toBe("string");
  return params.requestId as string;
}

function asRequest(message: Message): Request {
  expect(typeof message.id).toBe("string");
  expect(typeof message.method).toBe("string");
  return message as Request;
}
