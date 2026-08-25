const decoder = new TextDecoder();
const input = Bun.stdin.stream().getReader();
let buffered = new Uint8Array();

await readFrame();

const reuse = process.argv[2] === "reuse";
const requests = reuse ? 2 : 65_537;
for (let index = 1; index <= requests; index += 1) {
  const params = !reuse && index === 65_536
    ? {}
    : {
        operationId: `lifetime:${index}`,
        slot: "sink",
        method: "write",
        input: null,
      };
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: reuse ? "component:1" : `component:${index}`,
    method: "effect/call",
    params,
  })}\n`);
  await readFrame();
}

async function readFrame(): Promise<unknown> {
  while (true) {
    const lf = buffered.indexOf(0x0a);
    if (lf >= 0) {
      const frame = buffered.subarray(0, lf);
      buffered = buffered.slice(lf + 1);
      return JSON.parse(decoder.decode(frame));
    }
    const { value, done } = await input.read();
    if (done) throw new Error("host closed before the expected response");
    const joined = new Uint8Array(buffered.byteLength + value.byteLength);
    joined.set(buffered);
    joined.set(value, buffered.byteLength);
    buffered = joined;
  }
}
