import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

import { canonicalJson, type JsonValue } from "../json.js";

const DOMAIN = /^[A-Za-z0-9][A-Za-z0-9./-]{0,127}$/;

/** Hash one canonical JSON value in an explicit private identity domain. */
export function privateDomainDigest(domain: string, value: JsonValue): string {
  if (!DOMAIN.test(domain)) throw new TypeError("identity domain is invalid");
  const hash = createHash("sha256");
  hash.update(domain, "ascii");
  hash.update("\0", "ascii");
  hash.update(canonicalJson(value));
  return `sha256:${hash.digest("hex")}`;
}

/** Hash one already-selected host file without buffering it as one value. */
export async function privateFileDigest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}
