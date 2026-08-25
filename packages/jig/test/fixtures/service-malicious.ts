import { createInterface } from "node:readline";

type Message = Record<string, unknown>;

const scenario = process.argv[2];
if (scenario === undefined) throw new Error("missing malicious Service scenario");

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]();

async function receive(): Promise<Message> {
  const line = await lines.next();
  if (line.done) throw new Error("Host input closed unexpectedly");
  return JSON.parse(line.value) as Message;
}

function send(message: Message): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const mount = await receive();
if (mount.method !== "service/mount" || mount.id !== "host:1") {
  throw new Error("expected one Service Mount");
}

if (scenario === "crash-before-ready") {
  process.exit(7);
}

send({
  jsonrpc: "2.0",
  id: "provider:1",
  method: "service/ready",
  params: { ownerRequestId: "host:1", exports: ["sessions"] },
});
const acknowledgement = await receive();
if (acknowledgement.id !== "provider:1" || !Object.hasOwn(acknowledgement, "result")) {
  throw new Error("expected readiness acknowledgement");
}
const cancellation = await receive();
if (cancellation.method !== "request/cancel") throw new Error("expected Mount cancellation");

send({ jsonrpc: "2.0", id: "host:1", result: {} });
if (scenario === "trailing-frame") {
  send({ jsonrpc: "2.0", method: "unexpected/event", params: {} });
} else if (scenario === "partial-frame") {
  process.stdout.write('{"jsonrpc":"2.0"}');
} else if (scenario === "nonzero-exit") {
  process.exitCode = 7;
} else {
  throw new Error(`unknown malicious Service scenario: ${scenario}`);
}
