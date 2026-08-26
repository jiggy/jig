import { createHash } from "node:crypto";

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
