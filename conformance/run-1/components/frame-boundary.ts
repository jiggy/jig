const target = process.argv[2] === "oversized" ? 16_777_217 : 16_777_216;
const reader = Bun.stdin.stream().getReader();
const chunks: Uint8Array[] = [];

while (true) {
  const { value, done } = await reader.read();
  if (done) throw new Error("host closed before flow/run");
  chunks.push(value);
  const joined = join(chunks);
  const lf = joined.indexOf(0x0a);
  if (lf < 0) continue;
  const request = JSON.parse(new TextDecoder().decode(joined.subarray(0, lf))) as {
    id: string;
  };
  const response = JSON.stringify({
    jsonrpc: "2.0",
    id: request.id,
    result: { outcome: "done", output: null },
  });
  const size = new TextEncoder().encode(response).byteLength;
  if (size > target) throw new Error("response fixture exceeds its target size");
  process.stdout.write(`${response}${" ".repeat(target - size)}\n`);
  break;
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
