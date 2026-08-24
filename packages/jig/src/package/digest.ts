import { createHash } from "node:crypto";

import { invalid } from "../diagnostics.js";
import { assertNoPathCollisions, comparePathBytes } from "./paths.js";

const MAX_FILES = 65_536;
const MAX_FILE_BYTES = 1_073_741_824;
const MAX_TOTAL_BYTES = 4_294_967_296;

export interface PackageDigestFile {
  readonly path: string;
  readonly size: number;
}

export async function packageDigest(
  files: readonly PackageDigestFile[],
  contents: (file: PackageDigestFile) => AsyncIterable<Uint8Array>,
): Promise<string> {
  if (files.length > MAX_FILES) invalid("PACKAGE_LIMIT", `package exceeds ${MAX_FILES} files`);
  assertNoPathCollisions(files.map((file) => file.path));
  const ordered = files.slice().sort((left, right) => comparePathBytes(left.path, right.path));
  let totalBytes = 0;
  for (const file of ordered) {
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES) {
      invalid("PACKAGE_LIMIT", `invalid content size for ${file.path}`, file.path);
    }
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES) invalid("PACKAGE_LIMIT", `package exceeds ${MAX_TOTAL_BYTES} bytes`);
  }
  const hash = createHash("sha256");
  hash.update(Buffer.from("FLOW-Package/1\0", "ascii"));
  hash.update(unsignedBigEndian(BigInt(ordered.length), 8));
  for (const file of ordered) {
    const path = Buffer.from(file.path, "utf8");
    hash.update(Uint8Array.of(0x01));
    hash.update(unsignedBigEndian(BigInt(path.byteLength), 4));
    hash.update(path);
    hash.update(unsignedBigEndian(BigInt(file.size), 8));
    let observed = 0;
    for await (const chunk of contents(file)) {
      observed += chunk.byteLength;
      if (observed > file.size) throw new Error(`digest source ${file.path} exceeds its declared size`);
      hash.update(chunk);
    }
    if (observed !== file.size) throw new Error(`digest source ${file.path} does not match its declared size`);
  }
  return `sha256:${hash.digest("hex")}`;
}

function unsignedBigEndian(value: bigint, bytes: number): Buffer {
  const maximum = 1n << BigInt(bytes * 8);
  if (value < 0n || value >= maximum) throw new RangeError("integer does not fit digest encoding");
  const result = Buffer.alloc(bytes);
  let remaining = value;
  for (let index = bytes - 1; index >= 0; index -= 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}
