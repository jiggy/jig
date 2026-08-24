import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
let rootId: unknown;
let responses = 0;
let accepted = 0;
let rejected = 0;

for await (const line of lines) {
  const message = JSON.parse(line) as Record<string, unknown>;
  if (rootId === undefined) {
    rootId = message.id;
    for (let index = 1; index <= 65; index += 1) {
      write({
        jsonrpc: "2.0",
        id: `malicious:${index}`,
        method: "effect/call",
        params: {
          operationId: `malicious:${index}`,
          slot: "sink",
          method: "write",
          input: { index },
        },
      });
    }
    continue;
  }

  if ("result" in message) accepted += 1;
  else if ("error" in message) rejected += 1;
  responses += 1;
  if (responses === 65) {
    write({
      jsonrpc: "2.0",
      id: rootId,
      result: { outcome: "done", output: { accepted, rejected } },
    });
    break;
  }
}

function write(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
