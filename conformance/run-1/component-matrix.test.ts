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
    for (const envelope of invalidParamsEnvelopes()) {
      test(`rejects ${envelope.name} as an invalid envelope`, async () => {
        await withPeer(component.command, async (peer) => {
          peer.send(envelope.message);
          expectInvalidEnvelopeError(
            await peer.receive(),
            Object.hasOwn(envelope.message, "id") ? envelope.message.id as string : undefined,
          );
          await expectClosed(peer);
        });
      });
    }

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
  test(`${component.name} survives immediate host half-close after its root response`, async () => {
    await withScratch(async (scratch) => {
      await withPeer(component.command, async (peer) => {
        peer.send(rootRequest("host:half-close", scratch));
        const response = await peer.receive();

        expect(response).toEqual({
          jsonrpc: "2.0",
          id: "host:half-close",
          result: { outcome: "done", output: null },
        });
        peer.closeInput();
        expect(await peer.exit()).toBe(0);
        await expect(peer.receive()).rejects.toThrow("component stdout closed");
      });
    });
  });

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

  test(`${component.name} exercises host operation join, replay, and conflict`, async () => {
    await withScratch(async (scratch) => {
      await withPeer(component.command, async (peer) => {
        peer.send(rootRequest("host:identity", scratch, { case: "operation-identity" }));
        const operations = new ReferenceOperations();
        const first = asRequest(await peer.receive());
        const second = asRequest(await peer.receive());
        expect(operations.admit(first)).toEqual({ kind: "dispatch" });
        expect(operations.admit(second)).toEqual({ kind: "join" });
        expect(operations.dispatches).toBe(1);

        const sharedResult = { value: { receipt: "shared" } };
        for (const response of operations.settle("shared:1", sharedResult)) {
          peer.send(response);
        }

        const replay = asRequest(await peer.receive());
        expect(operations.admit(replay)).toEqual({ kind: "replay", result: sharedResult });
        peer.send({ jsonrpc: "2.0", id: replay.id, result: sharedResult });
        expect(operations.dispatches).toBe(1);

        const conflict = asRequest(await peer.receive());
        expect(operations.admit(conflict)).toEqual({ kind: "conflict" });
        peer.send(operationError(conflict.id, "OPERATION_CONFLICT"));
        expect(operations.dispatches).toBe(1);

        expect(await peer.receive()).toEqual({
          jsonrpc: "2.0",
          id: "host:identity",
          result: {
            outcome: "done",
            output: {
              first: { receipt: "shared" },
              second: { receipt: "shared" },
              replay: { receipt: "shared" },
              conflict: "OPERATION_CONFLICT",
            },
          },
        });
        await peer.finish();
      });
    });
  });

  test(`${component.name} retains a cancelled call until its late wire response`, async () => {
    await withScratch(async (scratch) => {
      await withPeer(component.command, async (peer) => {
        peer.send(rootRequest("host:call-cancel", scratch, { case: "cancel-one-call" }));
        const calls = [asRequest(await peer.receive()), asRequest(await peer.receive())];
        const child = calls.find((request) => request.method === "flow/call");
        const release = calls.find((request) => request.method === "effect/call");
        expect(child).toBeDefined();
        expect(release).toBeDefined();

        peer.send({ jsonrpc: "2.0", id: release!.id, result: { value: null } });
        expect(cancelTarget(await peer.receive())).toBe(child!.id);
        await expect(peer.receive(75)).rejects.toThrow("timed out");

        peer.send({
          jsonrpc: "2.0",
          id: child!.id,
          result: { outcome: "done", output: "late-success" },
        });
        expect(await peer.receive()).toEqual({
          jsonrpc: "2.0",
          id: "host:call-cancel",
          result: { outcome: "done", output: "cancelled-locally" },
        });
        await peer.finish();
      });
    });
  });

  test(`${component.name} fails an abandoned call only after wire quiescence`, async () => {
    await withScratch(async (scratch) => {
      await withPeer(component.command, async (peer) => {
        peer.send(rootRequest("host:abandoned", scratch, { case: "abandoned-call" }));
        const calls = [asRequest(await peer.receive()), asRequest(await peer.receive())];
        const child = calls.find((request) => request.method === "flow/call");
        const release = calls.find((request) => request.method === "effect/call");
        expect(child).toBeDefined();
        expect(release).toBeDefined();

        peer.send({ jsonrpc: "2.0", id: release!.id, result: { value: null } });
        expect(cancelTarget(await peer.receive())).toBe(child!.id);
        await expect(peer.receive(75)).rejects.toThrow("timed out");

        peer.send({
          jsonrpc: "2.0",
          id: child!.id,
          result: { outcome: "done", output: "late-success" },
        });
        expectOperationError(await peer.receive(), "host:abandoned", "EXECUTION_FAILED");
        await peer.finish();
      });
    });
  });

  test(`${component.name} closes on an unknown response ID`, async () => {
    await withScratch(async (scratch) => {
      await withPeer(component.command, async (peer) => {
        peer.send(rootRequest("host:unknown", scratch, { case: "one-flow" }));
        await peer.receive();
        peer.send({
          jsonrpc: "2.0",
          id: "component:unknown",
          result: { outcome: "done", output: null },
        });
        await expectClosed(peer);
      });
    });
  });

  test(`${component.name} closes on a malformed child Flow result`, async () => {
    await withScratch(async (scratch) => {
      await withPeer(component.command, async (peer) => {
        peer.send(rootRequest("host:bad-child", scratch, { case: "one-flow" }));
        const child = asRequest(await peer.receive());
        peer.send({
          jsonrpc: "2.0",
          id: child.id,
          result: { outcome: "done" },
        });
        await expectClosed(peer);
      });
    });
  });

  test(`${component.name} treats a standard child error as fatal`, async () => {
    await withScratch(async (scratch) => {
      await withPeer(component.command, async (peer) => {
        peer.send(rootRequest("host:standard-error", scratch, { case: "one-flow" }));
        const child = asRequest(await peer.receive());
        peer.send({
          jsonrpc: "2.0",
          id: child.id,
          error: { code: -32603, message: "Internal error" },
        });
        await expectClosed(peer);
      });
    });
  });

  test(`${component.name} closes on a duplicate response ID`, async () => {
    await withScratch(async (scratch) => {
      await withPeer(component.command, async (peer) => {
        peer.send(rootRequest("host:duplicate", scratch, { case: "two-effects" }));
        const first = asRequest(await peer.receive());
        peer.send({ jsonrpc: "2.0", id: first.id, result: { value: "first" } });
        await peer.receive();
        peer.send({ jsonrpc: "2.0", id: first.id, result: { value: "duplicate" } });
        await expectClosed(peer);
      });
    });
  });
}

test("a reference host rejects a malicious 65th request without dispatch", async () => {
  await withScratch(async (scratch) => {
    const peer = new ComponentPeer([
      process.execPath,
      resolve(import.meta.dir, "components/malicious-65.ts"),
    ]);
    try {
      peer.send(rootRequest("host:malicious", scratch));
      const dispatched: Request[] = [];
      for (let count = 0; count < 65; count += 1) {
        const request = asRequest(await peer.receive());
        if (count < 64) {
          dispatched.push(request);
        } else {
          peer.send(operationError(request.id, "RESOURCE_EXHAUSTED"));
        }
      }
      expect(dispatched).toHaveLength(64);
      for (const request of dispatched) {
        peer.send({ jsonrpc: "2.0", id: request.id, result: { value: null } });
      }
      expect(await peer.receive()).toEqual({
        jsonrpc: "2.0",
        id: "host:malicious",
        result: { outcome: "done", output: { accepted: 64, rejected: 1 } },
      });
      await peer.finish();
    } finally {
      await peer.dispose();
    }
  });
});

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

function invalidParamsEnvelopes(): Array<{
  readonly name: string;
  readonly message: Message;
}> {
  const scalars: ReadonlyArray<readonly [string, null | boolean | number | string]> = [
    ["null", null],
    ["boolean", false],
    ["number", 1],
    ["string", "not-structured"],
  ];
  return (["request", "notification"] as const).flatMap((form) =>
    scalars.map(([name, params]) => ({
      name: `${form} params: ${name}`,
      message: {
        jsonrpc: "2.0",
        ...(form === "request" ? { id: `host:${name}-params` } : {}),
        method: `unknown/${form}`,
        params,
      },
    })),
  );
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

function expectInvalidEnvelopeError(message: Message, requestId?: string): void {
  expect(message).toMatchObject({ jsonrpc: "2.0", error: { code: -32600 } });
  expect(message.id === null || message.id === requestId).toBeTrue();
  if (requestId === undefined) expect(message.id).toBeNull();
  expect(typeof (message.error as Record<string, unknown>).message).toBe("string");
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

function operationError(id: string, code: string): Message {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: code,
      data: { code },
    },
  };
}

interface OperationRecord {
  readonly signature: string;
  readonly waiters: string[];
  result?: unknown;
}

class ReferenceOperations {
  private readonly records = new Map<string, OperationRecord>();
  dispatches = 0;

  admit(request: Request):
    | { readonly kind: "dispatch" }
    | { readonly kind: "join" }
    | { readonly kind: "replay"; readonly result: unknown }
    | { readonly kind: "conflict" } {
    const params = request.params as Record<string, unknown>;
    const operationId = params.operationId;
    expect(typeof operationId).toBe("string");
    const signature = canonicalOperation(request);
    const prior = this.records.get(operationId as string);
    if (prior === undefined) {
      this.records.set(operationId as string, { signature, waiters: [request.id] });
      this.dispatches += 1;
      return { kind: "dispatch" };
    }
    if (prior.signature !== signature) return { kind: "conflict" };
    if (prior.result !== undefined) return { kind: "replay", result: prior.result };
    prior.waiters.push(request.id);
    return { kind: "join" };
  }

  settle(operationId: string, result: unknown): Message[] {
    const record = this.records.get(operationId);
    if (record === undefined) throw new Error(`unknown operation ${operationId}`);
    record.result = result;
    return record.waiters.splice(0).map((id) => ({ jsonrpc: "2.0", id, result }));
  }
}

function canonicalOperation(request: Request): string {
  const { operationId: _operationId, ...params } = request.params as Record<string, unknown>;
  return JSON.stringify(canonicalize({ method: request.method, params }));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        // RFC 8785 orders object names by UTF-16 code units. Do not let the
        // process locale participate in the reference operation signature.
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}
