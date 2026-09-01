import { PACKAGE_1_MAX_PATH_BYTES } from "../package/paths.js";

const MIB = 1024 * 1024;
const MAX_JSON_BYTES_PER_PATH_BYTE = 6;

export const PRIVATE_BUN_PREPARATION_LIMITS = Object.freeze({
  sourceFiles: 4_096,
  sourceBytes: 16 * MIB,
  preparedFiles: 4_096,
  preparedBytes: 32 * MIB,
});

/**
 * A conservative bound for one JSON line containing canonical file records.
 *
 * JSON escaping expands one UTF-8 path byte by at most six bytes. Split
 * base64 values add at most one four-byte quantum per file beyond the usual
 * encoding of their aggregate content. Fixed syntax is deliberately
 * over-counted so every value admitted by the raw limits fits the line bound.
 */
export function maximumPrivateBunFileMessageBytes(
  type: "source" | "prepared",
  maximumFiles: number,
  maximumContentBytes: number,
): number {
  requireNonnegativeInteger(maximumFiles, "file count");
  requireNonnegativeInteger(maximumContentBytes, "content bytes");
  const emptyMessageBytes = Buffer.byteLength(JSON.stringify({ type, files: [] }));
  const emptyFileBytes = Buffer.byteLength(JSON.stringify({ path: "", content: "" }));
  const pathBytes = maximumFiles * PACKAGE_1_MAX_PATH_BYTES * MAX_JSON_BYTES_PER_PATH_BYTE;
  const contentBytes = 4 * (Math.ceil(maximumContentBytes / 3) + maximumFiles);
  const separators = Math.max(0, maximumFiles - 1);
  const result = emptyMessageBytes + maximumFiles * emptyFileBytes +
    pathBytes + contentBytes + separators;
  if (!Number.isSafeInteger(result)) throw new RangeError("Bun preparation message bound is too large");
  return result;
}

export const PRIVATE_BUN_SOURCE_MESSAGE_BYTES = maximumPrivateBunFileMessageBytes(
  "source",
  PRIVATE_BUN_PREPARATION_LIMITS.sourceFiles,
  PRIVATE_BUN_PREPARATION_LIMITS.sourceBytes,
);

export const PRIVATE_BUN_PREPARED_MESSAGE_BYTES = maximumPrivateBunFileMessageBytes(
  "prepared",
  PRIVATE_BUN_PREPARATION_LIMITS.preparedFiles,
  PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes,
);

export function privateBunMessageFits(bytes: number, maximum: number): boolean {
  return Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= maximum;
}

/** Encode exactly one newline-delimited worker message. */
export function encodePrivateBunMessage(value: unknown): Uint8Array {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("Bun preparation message is not JSON-serializable");
  return new TextEncoder().encode(`${json}\n`);
}

function requireNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
}
