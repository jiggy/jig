import { CASE_FOLD_15_1 } from "./case-fold-15.1.js";
import { invalid, unavailable } from "../diagnostics.js";

const encoder = new TextEncoder();
const REQUIRED_UNICODE_VERSION = "15.1";

export const PACKAGE_1_MAX_PATH_BYTES = 1_024;

/** Test NFC with the exact Unicode database fixed by Package/1. */
export function isNfc15_1(value: string): boolean {
  const actual = process.versions.unicode;
  if (actual !== REQUIRED_UNICODE_VERSION) {
    unavailable(
      "PACKAGE_UNICODE_UNAVAILABLE",
      `Package/1 requires Unicode ${REQUIRED_UNICODE_VERSION} NFC; host reports ${actual ?? "no Unicode version"}`,
    );
  }
  return value === value.normalize("NFC");
}

export function validateLogicalPath(path: string): string {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    invalid("PACKAGE_PATH", `invalid logical path ${JSON.stringify(path)}`, path);
  }
  assertUnicodeScalarString(path);
  if (!isNfc15_1(path)) {
    invalid("PACKAGE_PATH_NFC", `logical path is not NFC: ${JSON.stringify(path)}`, path);
  }
  const segments = path.split("/");
  if (segments.length > 64) invalid("PACKAGE_PATH_LIMIT", `logical path exceeds 64 segments`, path);
  if (encoder.encode(path).byteLength > PACKAGE_1_MAX_PATH_BYTES) {
    invalid("PACKAGE_PATH_LIMIT", `logical path exceeds ${PACKAGE_1_MAX_PATH_BYTES} UTF-8 bytes`, path);
  }
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      invalid("PACKAGE_PATH", `logical path has an invalid segment`, path);
    }
    if (encoder.encode(segment).byteLength > 255) {
      invalid("PACKAGE_PATH_LIMIT", `logical path segment exceeds 255 UTF-8 bytes`, path);
    }
  }
  return path;
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        invalid("PACKAGE_PATH", "logical path contains a lone Unicode surrogate", value);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      invalid("PACKAGE_PATH", "logical path contains a lone Unicode surrogate", value);
    }
  }
}

export function fullCaseFold15_1(value: string): string {
  let result = "";
  for (const scalar of value) {
    result += CASE_FOLD_15_1.get(scalar.codePointAt(0)!) ?? scalar;
  }
  return result;
}

export function comparePathBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function assertNoPathCollisions(paths: readonly string[]): void {
  const exact = new Set<string>();
  const folded = new Map<string, string>();
  for (const path of paths) {
    validateLogicalPath(path);
    if (exact.has(path)) invalid("PACKAGE_PATH_COLLISION", `duplicate logical path ${path}`, path);
    exact.add(path);
    const key = fullCaseFold15_1(path);
    const prior = folded.get(key);
    if (prior !== undefined) {
      invalid(
        "PACKAGE_PATH_COLLISION",
        `logical paths collide under Unicode 15.1 case folding: ${prior} and ${path}`,
        path,
      );
    }
    folded.set(key, path);
  }
}
