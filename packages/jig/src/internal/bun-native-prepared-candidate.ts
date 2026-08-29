import { types as utilTypes } from "node:util";

import {
  canonicalJson,
  decodeJson1,
  Json1Error,
  type JsonObject,
  type JsonValue,
} from "../json.js";
import {
  assertNoPathCollisions,
  comparePathBytes,
  validateLogicalPath,
} from "../package/paths.js";
import {
  requirePrivateBunNativePreparationObservation,
  type PrivateBunNativePreparationObservation,
} from "./bun-native-preparation.js";
import { privateDomainDigest } from "./identity.js";

const CANDIDATE_KIND = "private-bun-native-prepared-candidate/1";
const PACKAGE_NAME = "@flowmd/sdk";
const PACKAGE_VERSION = "0.0.0";
const MAX_CANDIDATE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 256;
const MAX_DECODED_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const REQUIRED_RUNTIME_ENTRY = "dist/index.js";
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const authenticCandidates = new WeakSet<object>();

export interface PrivateBunNativePreparedCandidateFile {
  readonly path: string;
  readonly contentBase64: string;
}

/**
 * One detached, inert candidate parsed from an untrusted preparation worker's
 * output. It is not a prepared artifact, directory, mount, launch recipe,
 * execution authority, or evidence that the worker has been fenced.
 */
export interface PrivateBunNativePreparedCandidate {
  readonly kind: typeof CANDIDATE_KIND;
  readonly digest: string;
  readonly observationDigest: string;
  readonly requestDigest: string;
  readonly packageDigest: string;
  readonly dependencyDigest: string;
  readonly totalBytes: number;
  readonly files: readonly PrivateBunNativePreparedCandidateFile[];
}

/** The complete, inert payload decoded from one preparation worker response. */
export interface PrivateBunNativePreparedCandidatePayload {
  readonly dependencyDigest: string;
  readonly totalBytes: number;
  readonly files: readonly PrivateBunNativePreparedCandidateFile[];
}

/**
 * Normalize the complete stdout of the trusted ephemeral preparation worker.
 *
 * Normalization makes no lifecycle claim. A later lifecycle owner may promote
 * this value only after it separately proves successful exit and a complete
 * Sandbox Backend fence.
 */
export function normalizePrivateBunNativePreparedCandidate(
  observationValue: unknown,
  candidateBytesValue: unknown,
): PrivateBunNativePreparedCandidate {
  const observation = requirePrivateBunNativePreparationObservation(observationValue);
  const payload = decodePrivateBunNativePreparedCandidateBytes(candidateBytesValue);
  if (payload.dependencyDigest !== observation.dependency.memberDigest) {
    throw new TypeError("Bun native prepared candidate has an invalid identity");
  }

  const identity = Object.freeze({
    kind: CANDIDATE_KIND,
    observationDigest: observation.digest,
    requestDigest: observation.requestDigest,
    packageDigest: observation.packageDigest,
    dependencyDigest: payload.dependencyDigest,
    totalBytes: payload.totalBytes,
    files: payload.files,
  });
  const candidateValue = Object.freeze({
    ...identity,
    digest: privateDomainDigest(
      "JIG-Private-Bun-Native-Prepared-Candidate/1",
      identity as unknown as JsonValue,
    ),
  });
  authenticCandidates.add(candidateValue);
  return candidateValue;
}

/** Decode worker bytes without granting prepared-tree publication authority. */
export function decodePrivateBunNativePreparedCandidateBytes(
  candidateBytesValue: unknown,
): PrivateBunNativePreparedCandidatePayload {
  const candidateBytes = snapshotBytes(candidateBytesValue, MAX_CANDIDATE_BYTES);

  let decoded: JsonValue;
  try {
    decoded = decodeJson1(candidateBytes);
  } catch (error) {
    if (error instanceof Json1Error) {
      throw new TypeError(`Bun native prepared candidate is not strict JSON/1: ${error.message}`);
    }
    throw error;
  }
  if (!sameBytes(candidateBytes, canonicalJson(decoded))) {
    throw new TypeError("Bun native prepared candidate is not canonical JSON/1");
  }
  const candidate = requireObject(decoded, "Bun native prepared candidate");
  requireExactKeys(candidate, ["dependencyDigest", "files", "kind"], "Bun native prepared candidate");
  if (candidate.kind !== CANDIDATE_KIND ||
      typeof candidate.dependencyDigest !== "string" ||
      !DIGEST.test(candidate.dependencyDigest) ||
      !Array.isArray(candidate.files)) {
    throw new TypeError("Bun native prepared candidate has an invalid identity");
  }
  if (candidate.files.length === 0 || candidate.files.length > MAX_FILES) {
    throw new TypeError(`Bun native prepared candidate must contain 1-${MAX_FILES} files`);
  }

  const files: PrivateBunNativePreparedCandidateFile[] = [];
  let totalBytes = 0;
  let priorPath: string | undefined;
  for (const [index, value] of candidate.files.entries()) {
    const file = requireObject(value, `Bun native prepared candidate file ${index}`);
    requireExactKeys(
      file,
      ["contentBase64", "path"],
      `Bun native prepared candidate file ${index}`,
    );
    if (typeof file.path !== "string" || typeof file.contentBase64 !== "string") {
      throw new TypeError(`Bun native prepared candidate file ${index} has an invalid shape`);
    }
    const path = validateLogicalPath(file.path);
    if (priorPath !== undefined && comparePathBytes(priorPath, path) >= 0) {
      throw new TypeError("Bun native prepared candidate files are not strictly byte-sorted");
    }
    priorPath = path;
    const size = canonicalBase64Size(file.contentBase64, index);
    if (path === "package.json" && size > MAX_MANIFEST_BYTES) {
      throw new TypeError("installed @flowmd/sdk package.json exceeds its byte bound");
    }
    if (size > MAX_DECODED_BYTES - totalBytes) {
      throw new TypeError(`Bun native prepared candidate exceeds ${MAX_DECODED_BYTES} decoded bytes`);
    }
    if (Buffer.from(file.contentBase64, "base64").toString("base64") !== file.contentBase64) {
      throw new TypeError(`Bun native prepared candidate file ${index} is not canonical base64`);
    }
    totalBytes += size;
    files.push(Object.freeze({ path, contentBase64: file.contentBase64 }));
  }
  assertNoPathCollisions(files.map((file) => file.path));
  requireSdkManifest(files);

  return Object.freeze({
    dependencyDigest: candidate.dependencyDigest,
    totalBytes,
    files: Object.freeze(files),
  });
}

export function requirePrivateBunNativePreparedCandidate(
  value: unknown,
): PrivateBunNativePreparedCandidate {
  if (value === null || typeof value !== "object" || !authenticCandidates.has(value)) {
    throw new TypeError("Bun native prepared candidate was not produced by private normalization");
  }
  return value as PrivateBunNativePreparedCandidate;
}

function snapshotBytes(value: unknown, maximum: number): Uint8Array {
  if (!utilTypes.isUint8Array(value)) {
    throw new TypeError("Bun native prepared candidate must be Uint8Array bytes");
  }
  const byteLength = Reflect.apply(typedArrayByteLength, value, []) as number;
  if (byteLength === 0 || byteLength > maximum) {
    throw new TypeError("Bun native prepared candidate exceeds its byte bound");
  }
  const snapshot = new Uint8Array(byteLength);
  Reflect.apply(Uint8Array.prototype.set, snapshot, [value]);
  if (snapshot.byteLength !== byteLength) {
    throw new TypeError("Bun native prepared candidate changed while being copied");
  }
  return snapshot;
}

function requireObject(value: JsonValue, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonObject;
}

function requireExactKeys(
  value: JsonObject,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length ||
      actual.some((key, index) => key !== sortedExpected[index])) {
    throw new TypeError(`${label} has unexpected members`);
  }
}

function canonicalBase64Size(value: string, index: number): number {
  if (!CANONICAL_BASE64.test(value)) {
    throw new TypeError(`Bun native prepared candidate file ${index} is not canonical base64`);
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const size = (value.length / 4) * 3 - padding;
  if (!Number.isSafeInteger(size)) {
    throw new TypeError(`Bun native prepared candidate file ${index} is not canonical base64`);
  }
  return size;
}

function requireSdkManifest(files: readonly PrivateBunNativePreparedCandidateFile[]): void {
  const manifest = files.find((file) => file.path === "package.json");
  if (manifest === undefined) {
    throw new TypeError("Bun native prepared candidate is missing package.json");
  }
  let value: JsonValue;
  try {
    value = decodeJson1(Buffer.from(manifest.contentBase64, "base64"));
  } catch (error) {
    if (error instanceof Json1Error) {
      throw new TypeError(`installed @flowmd/sdk package.json is not strict JSON/1: ${error.message}`);
    }
    throw error;
  }
  const object = requireObject(value, "installed @flowmd/sdk package.json");
  if (object.name !== PACKAGE_NAME || object.version !== PACKAGE_VERSION) {
    throw new TypeError(`installed package must be exact ${PACKAGE_NAME}@${PACKAGE_VERSION}`);
  }
  if (!files.some((file) => file.path === REQUIRED_RUNTIME_ENTRY)) {
    throw new TypeError(`Bun native prepared candidate is missing ${REQUIRED_RUNTIME_ENTRY}`);
  }
}

const typedArrayByteLength: () => number = (() => {
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
  const getter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
  if (getter === undefined) {
    throw new Error("Uint8Array intrinsic byteLength getter is unavailable");
  }
  return getter;
})();

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}
