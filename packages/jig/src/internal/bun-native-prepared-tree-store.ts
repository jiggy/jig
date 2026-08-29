import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { resolve } from "node:path";
import { types as utilTypes } from "node:util";

import { invalid, unavailable } from "../diagnostics.js";
import {
  canonicalJson,
  decodeJson1,
  Json1Error,
  type JsonObject,
  type JsonValue,
} from "../json.js";
import {
  PACKAGE_CAPTURE_LIMITS,
  type CapturedFile,
  type CapturedPackage,
} from "../package/capture.js";
import { packageDigest, PACKAGE_1_LIMITS } from "../package/digest.js";
import {
  assertNoPathCollisions,
  comparePathBytes,
  fullCaseFold15_1,
  validateLogicalPath,
} from "../package/paths.js";
import {
  requirePrivateBunNativePreparedCandidate,
  type PrivateBunNativePreparedCandidate,
  type PrivateBunNativePreparedCandidateFile,
} from "./bun-native-prepared-candidate.js";
import {
  requirePrivateBunNativePreparationObservation,
  type PrivateBunNativePreparationObservation,
} from "./bun-native-preparation.js";
import { privateDomainDigest } from "./identity.js";
import {
  captureStoredPackage,
  normalizePackageArtifactRef,
} from "./package-artifact-store.js";
import type { PrivateMaterializationSource } from "./package-materialization.js";

const RECORD_KIND = "private-bun-native-prepared-tree-record/1";
const REFERENCE_KIND = "private-bun-native-prepared-tree/1";
const CAPTURE_KIND = "private-bun-native-prepared-tree-capture/1";
const DEPENDENCY_ROOT = "node_modules/@flowmd/sdk";
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_DEPENDENCY_FILES = 256;
const MAX_DEPENDENCY_BYTES = 1024 * 1024;
const MAX_RECORD_BYTES = 3 * 1024 * 1024;
const COPY_CHUNK_BYTES = 1024 * 1024;
const SDK_NAME = "@flowmd/sdk";
const SDK_VERSION = "0.0.0";
const SDK_ENTRY = "dist/index.js";

interface PreparedTreeRecord {
  readonly kind: typeof RECORD_KIND;
  readonly sourcePackageDigest: string;
  readonly observationDigest: string;
  readonly requestDigest: string;
  readonly candidateDigest: string;
  readonly dependencyDigest: string;
  readonly files: readonly PrivateBunNativePreparedCandidateFile[];
}

/** A private durable identity. It is deliberately not Package/1. */
export interface PrivateBunNativePreparedTreeRef {
  readonly kind: typeof REFERENCE_KIND;
  readonly digest: string;
  readonly sourcePackageDigest: string;
  readonly observationDigest: string;
  readonly requestDigest: string;
  readonly candidateDigest: string;
  readonly dependencyDigest: string;
}

/** One invocation-local snapshot of the complete prepared logical tree. */
export interface PrivateBunNativePreparedTreeCapture {
  readonly kind: typeof CAPTURE_KIND;
  readonly reference: PrivateBunNativePreparedTreeRef;
  readonly materializationDigest: string;
  readonly files: readonly CapturedFile[];
  read(path: string, maximumBytes?: number): Promise<Uint8Array>;
  stream(path: string, maximumBytes?: number): AsyncIterable<Uint8Array>;
  dispose(): Promise<void>;
}

const authenticCaptures = new WeakSet<object>();

/**
 * Publish only an authenticated preparation observation and its matching,
 * already-normalized candidate. The lifecycle owner must call this boundary
 * only after successful payload exit and a complete enforcement fence.
 *
 * The source Package/1 remains a separately retained immutable object. This
 * store owns the exact installed dependency subtree and the composite identity.
 */
export async function publishPrivateBunNativePreparedTree(input: {
  readonly preparedStoreRoot: string;
  readonly packageStoreRoot: string;
  readonly observation: PrivateBunNativePreparationObservation;
  readonly candidate: PrivateBunNativePreparedCandidate;
}): Promise<PrivateBunNativePreparedTreeRef> {
  const observation = requirePrivateBunNativePreparationObservation(input.observation);
  const candidate = requirePrivateBunNativePreparedCandidate(input.candidate);
  requireMatchingEvidence(observation, candidate);

  const source = await captureSource(input.packageStoreRoot, observation.packageDigest);
  let sourceFailure: unknown;
  try {
    requireDisjointSource(source.files);
    requireCompleteTreeTopology(source.files, candidate.files);
  } catch (error) {
    sourceFailure = error;
  }
  try {
    await source.dispose();
  } catch (error) {
    if (sourceFailure !== undefined) {
      throw new AggregateError([sourceFailure, error], "prepared-tree source validation cleanup failed");
    }
    throw error;
  }
  if (sourceFailure !== undefined) throw sourceFailure;

  const record = recordFrom(observation, candidate);
  const reference = referenceFor(record);
  const bytes = canonicalJson(record as unknown as JsonValue);
  if (bytes.byteLength > MAX_RECORD_BYTES) {
    throw new TypeError("Bun native prepared-tree record exceeds its byte bound");
  }
  await publishRecord(input.preparedStoreRoot, reference, bytes);
  return reference;
}

/** Reacquire a detached prepared-tree snapshot without source observation objects. */
export async function capturePrivateBunNativePreparedTree(input: {
  readonly preparedStoreRoot: string;
  readonly packageStoreRoot: string;
  readonly reference: PrivateBunNativePreparedTreeRef;
}): Promise<PrivateBunNativePreparedTreeCapture> {
  const reference = normalizePrivateBunNativePreparedTreeRef(input.reference);
  const record = await readRecord(input.preparedStoreRoot, reference);
  const source = await captureSource(input.packageStoreRoot, reference.sourcePackageDigest);
  try {
    requireDisjointSource(source.files);
    requireCompleteTreeTopology(source.files, record.files);
    const materializationDigest = await preparedMaterializationDigest(source, record.files);
    return preparedCapture(reference, materializationDigest, source, record.files);
  } catch (error) {
    try {
      await source.dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "prepared-tree reacquisition cleanup failed");
    }
    throw error;
  }
}

/** Normalize one persisted private reference without trusting accessors or proxies. */
export function normalizePrivateBunNativePreparedTreeRef(
  value: unknown,
): PrivateBunNativePreparedTreeRef {
  const record = ordinaryDataRecord(value, "Bun native prepared-tree reference");
  const expected = [
    "candidateDigest",
    "dependencyDigest",
    "digest",
    "kind",
    "observationDigest",
    "requestDigest",
    "sourcePackageDigest",
  ];
  if (!exactKeys(record, expected) || record.kind !== REFERENCE_KIND) {
    throw new TypeError("Bun native prepared-tree reference has invalid canonical fields");
  }
  for (const field of expected.filter((field) => field === "digest" || field.endsWith("Digest"))) {
    if (typeof record[field] !== "string" || !DIGEST.test(record[field] as string)) {
      throw new TypeError(`Bun native prepared-tree reference ${field} is invalid`);
    }
  }
  return frozenReference({
    kind: REFERENCE_KIND,
    digest: record.digest as string,
    sourcePackageDigest: record.sourcePackageDigest as string,
    observationDigest: record.observationDigest as string,
    requestDigest: record.requestDigest as string,
    candidateDigest: record.candidateDigest as string,
    dependencyDigest: record.dependencyDigest as string,
  });
}

/**
 * Give the private durable materializer only the authenticated byte-tree view
 * it consumes. The prepared reference remains the artifact identity; this
 * checksum is used solely to verify a detached per-Run materialization.
 */
export function privateBunNativePreparedTreeMaterializationSource(
  value: PrivateBunNativePreparedTreeCapture,
): PrivateMaterializationSource {
  if (value === null || typeof value !== "object" || !authenticCaptures.has(value)) {
    throw new TypeError("prepared-tree materialization requires an authenticated capture");
  }
  return Object.freeze({
    files: value.files,
    digest: value.materializationDigest,
    stream(path: string, maximumBytes?: number): AsyncIterable<Uint8Array> {
      return value.stream(path, maximumBytes);
    },
  });
}

function requireMatchingEvidence(
  observation: PrivateBunNativePreparationObservation,
  candidate: PrivateBunNativePreparedCandidate,
): void {
  if (
    candidate.observationDigest !== observation.digest ||
    candidate.requestDigest !== observation.requestDigest ||
    candidate.packageDigest !== observation.packageDigest ||
    candidate.dependencyDigest !== observation.dependency.memberDigest
  ) {
    throw new TypeError("Bun native prepared candidate belongs to another observation");
  }
}

function recordFrom(
  observation: PrivateBunNativePreparationObservation,
  candidate: PrivateBunNativePreparedCandidate,
): PreparedTreeRecord {
  return Object.freeze({
    kind: RECORD_KIND,
    sourcePackageDigest: observation.packageDigest,
    observationDigest: observation.digest,
    requestDigest: observation.requestDigest,
    candidateDigest: candidate.digest,
    dependencyDigest: observation.dependency.memberDigest,
    files: candidate.files,
  });
}

function referenceFor(record: PreparedTreeRecord): PrivateBunNativePreparedTreeRef {
  return frozenReference({
    kind: REFERENCE_KIND,
    digest: privateDomainDigest(
      "JIG-Private-Bun-Native-Prepared-Tree/1",
      record as unknown as JsonValue,
    ),
    sourcePackageDigest: record.sourcePackageDigest,
    observationDigest: record.observationDigest,
    requestDigest: record.requestDigest,
    candidateDigest: record.candidateDigest,
    dependencyDigest: record.dependencyDigest,
  });
}

function frozenReference(value: PrivateBunNativePreparedTreeRef): PrivateBunNativePreparedTreeRef {
  return Object.freeze(value);
}

async function captureSource(packageStoreRoot: string, digest: string): Promise<CapturedPackage> {
  return await captureStoredPackage(
    packageStoreRoot,
    normalizePackageArtifactRef({ kind: "flow-package/1", digest }),
  );
}

function requireDisjointSource(files: readonly CapturedFile[]): void {
  for (const file of files) {
    const first = file.path.split("/", 1)[0]!;
    if (fullCaseFold15_1(first) === "node_modules") {
      invalid(
        "BUN_PREPARED_TREE_SOURCE_COLLISION",
        `source Package/1 path ${file.path} collides with the prepared dependency root`,
        file.path,
      );
    }
  }
}

function requireCompleteTreeTopology(
  sourceFiles: readonly CapturedFile[],
  dependencyFiles: readonly PrivateBunNativePreparedCandidateFile[],
): void {
  const paths = [
    ...sourceFiles.map((file) => file.path),
    ...dependencyFiles.map((file) => dependencyPath(file.path)),
  ];
  if (paths.length > PACKAGE_1_LIMITS.files) {
    invalid(
      "BUN_PREPARED_TREE_LIMIT",
      `prepared tree exceeds the ${PACKAGE_1_LIMITS.files}-file materialization limit`,
    );
  }
  const totalBytes = sourceFiles.reduce((sum, file) => sum + file.size, 0) +
    dependencyFiles.reduce(
      (sum, file) => sum + Buffer.from(file.contentBase64, "base64").byteLength,
      0,
    );
  if (!Number.isSafeInteger(totalBytes) || totalBytes > PACKAGE_1_LIMITS.totalBytes) {
    invalid(
      "BUN_PREPARED_TREE_LIMIT",
      `prepared tree exceeds the ${PACKAGE_1_LIMITS.totalBytes}-byte materialization limit`,
    );
  }
  const directories = new Set<string>([""]);
  for (const path of paths) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  if (directories.size > PACKAGE_CAPTURE_LIMITS.directories) {
    invalid(
      "BUN_PREPARED_TREE_LIMIT",
      `prepared tree exceeds the ${PACKAGE_CAPTURE_LIMITS.directories}-directory materialization limit`,
    );
  }
  assertNoPathCollisions(paths);
  const foldedFiles = new Map(paths.map((path) => [fullCaseFold15_1(path), path]));
  for (const path of paths) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const prefix = segments.slice(0, index).join("/");
      const prior = foldedFiles.get(fullCaseFold15_1(prefix));
      if (prior !== undefined) {
        invalid(
          "BUN_PREPARED_TREE_PATH_COLLISION",
          `prepared-tree file ${prior} collides with directory ${prefix}`,
          path,
        );
      }
    }
  }
}

function dependencyPath(path: string): string {
  return validateLogicalPath(`${DEPENDENCY_ROOT}/${validateLogicalPath(path)}`);
}

async function preparedMaterializationDigest(
  source: CapturedPackage,
  files: readonly PrivateBunNativePreparedCandidateFile[],
): Promise<string> {
  const dependency = new Map<string, Uint8Array>();
  const allFiles: CapturedFile[] = source.files.map((file) => Object.freeze({ ...file }));
  for (const file of files) {
    const path = dependencyPath(file.path);
    const bytes = Uint8Array.from(Buffer.from(file.contentBase64, "base64"));
    dependency.set(path, bytes);
    allFiles.push(Object.freeze({ path, size: bytes.byteLength }));
  }
  return await packageDigest(allFiles, (file) => {
    const bytes = dependency.get(file.path);
    return bytes === undefined
      ? source.stream(file.path, file.size)
      : detachedBytes(bytes);
  });
}

function preparedCapture(
  reference: PrivateBunNativePreparedTreeRef,
  materializationDigest: string,
  source: CapturedPackage,
  files: readonly PrivateBunNativePreparedCandidateFile[],
): PrivateBunNativePreparedTreeCapture {
  const dependency = new Map<string, Uint8Array>();
  const allFiles: CapturedFile[] = source.files.map((file) => Object.freeze({ ...file }));
  for (const file of files) {
    const path = dependencyPath(file.path);
    const bytes = Uint8Array.from(Buffer.from(file.contentBase64, "base64"));
    dependency.set(path, bytes);
    allFiles.push(Object.freeze({ path, size: bytes.byteLength }));
  }
  allFiles.sort((left, right) => comparePathBytes(left.path, right.path));
  const frozenFiles = Object.freeze(allFiles);
  let disposed = false;
  let disposal: Promise<void> | undefined;

  function requireOpen(path: string): void {
    if (disposed) unavailable("BUN_PREPARED_TREE_CLOSED", "prepared-tree snapshot is closed", path);
  }

  const capture: PrivateBunNativePreparedTreeCapture = {
    kind: CAPTURE_KIND,
    reference,
    materializationDigest,
    files: frozenFiles,
    async read(pathValue: string, maximumBytes = PACKAGE_1_LIMITS.fileBytes): Promise<Uint8Array> {
      const path = validateLogicalPath(pathValue);
      requireReadLimit(maximumBytes);
      requireOpen(path);
      const bytes = dependency.get(path);
      if (bytes !== undefined) {
        if (bytes.byteLength > maximumBytes) {
          invalid("BUN_PREPARED_TREE_FILE_LIMIT", `${path} exceeds its read limit`, path);
        }
        return Uint8Array.from(bytes);
      }
      return await source.read(path, maximumBytes);
    },
    stream(pathValue: string, maximumBytes = PACKAGE_1_LIMITS.fileBytes): AsyncIterable<Uint8Array> {
      const path = validateLogicalPath(pathValue);
      requireReadLimit(maximumBytes);
      requireOpen(path);
      const bytes = dependency.get(path);
      if (bytes === undefined) return source.stream(path, maximumBytes);
      if (bytes.byteLength > maximumBytes) {
        invalid("BUN_PREPARED_TREE_FILE_LIMIT", `${path} exceeds its stream limit`, path);
      }
      return detachedBytes(bytes);
    },
    dispose(): Promise<void> {
      if (disposal !== undefined) return disposal;
      disposed = true;
      dependency.clear();
      disposal = source.dispose();
      return disposal;
    },
  };
  const frozen = Object.freeze(capture);
  authenticCaptures.add(frozen);
  return frozen;
}

async function* detachedBytes(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += COPY_CHUNK_BYTES) {
    yield Uint8Array.from(bytes.subarray(offset, offset + COPY_CHUNK_BYTES));
  }
}

function requireReadLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > PACKAGE_1_LIMITS.fileBytes) {
    throw new RangeError("maximumBytes must be a bounded non-negative safe integer");
  }
}

async function publishRecord(
  storeRoot: string,
  reference: PrivateBunNativePreparedTreeRef,
  bytes: Uint8Array,
): Promise<void> {
  const location = await openPreparedShard(storeRoot, reference.digest, true);
  const stage = `${location.directoryPath}/.stage-${process.pid}-${randomUUID()}`;
  let stageHandle: FileHandle | undefined;
  let stageExists = false;
  let failure: unknown;
  try {
    stageHandle = await open(
      stage,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    stageExists = true;
    await writeAll(stageHandle, bytes);
    await stageHandle.sync();
    await stageHandle.chmod(0o400);
    await stageHandle.sync();
    await stageHandle.close();
    stageHandle = undefined;
    await verifyRecordPath(stage, reference, location.ownerUid);

    try {
      await link(stage, location.finalPath);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) {
        if (hasCode(error, "EPERM") || hasCode(error, "EOPNOTSUPP") || hasCode(error, "EXDEV")) {
          unavailable(
            "BUN_PREPARED_TREE_ATOMIC_PUBLISH_UNAVAILABLE",
            "the protected store does not support same-filesystem hard-link publication",
          );
        }
        throw error;
      }
      await unlink(stage);
      stageExists = false;
      await location.directory.sync();
      await verifyRecordPath(location.finalPath, reference, location.ownerUid);
      return;
    }

    await requireSameFile(stage, location.finalPath);
    await location.directory.sync();
    await unlink(stage);
    stageExists = false;
    await location.directory.sync();
  } catch (error) {
    failure = error;
  } finally {
    const cleanupFailures: unknown[] = [];
    if (stageHandle !== undefined) {
      try { await stageHandle.close(); } catch (error) { cleanupFailures.push(error); }
    }
    if (stageExists) {
      try {
        await unlink(stage);
        await location.directory.sync();
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    try { await location.directory.close(); } catch (error) { cleanupFailures.push(error); }
    if (cleanupFailures.length > 0) {
      if (failure !== undefined) cleanupFailures.unshift(failure);
      throw new AggregateError(cleanupFailures, "prepared-tree publication cleanup did not complete");
    }
  }
  if (failure !== undefined) throw failure;
}

async function readRecord(
  storeRoot: string,
  reference: PrivateBunNativePreparedTreeRef,
): Promise<PreparedTreeRecord> {
  let location: PreparedShard | undefined;
  try {
    location = await openPreparedShard(storeRoot, reference.digest, false);
    await location.directory.sync();
    return await readRecordPath(location.finalPath, reference, location.ownerUid);
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      unavailable("BUN_PREPARED_TREE_MISSING", `prepared tree ${reference.digest} is missing`);
    }
    throw error;
  } finally {
    await location?.directory.close().catch(() => undefined);
  }
}

async function verifyRecordPath(
  path: string,
  reference: PrivateBunNativePreparedTreeRef,
  ownerUid: bigint,
): Promise<void> {
  await readRecordPath(path, reference, ownerUid);
}

async function readRecordPath(
  path: string,
  reference: PrivateBunNativePreparedTreeRef,
  ownerUid: bigint,
): Promise<PreparedTreeRecord> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true });
    requireArtifactFile(before, ownerUid);
    if (before.size <= 0n || before.size > BigInt(MAX_RECORD_BYTES)) {
      invalid("BUN_PREPARED_TREE_CORRUPT", "stored prepared-tree record has an invalid byte size");
    }
    const bytes = new Uint8Array(Number(before.size));
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0) {
        invalid("BUN_PREPARED_TREE_CORRUPT", "stored prepared-tree record ended early");
      }
      offset += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    requireArtifactFile(after, ownerUid);
    if (!sameStableFile(before, after)) {
      invalid("BUN_PREPARED_TREE_CORRUPT", "stored prepared-tree record changed while reading");
    }
    await requirePathIdentity(path, after);
    return parseStoredRecord(reference, bytes);
  } catch (error) {
    if (hasCode(error, "ELOOP")) {
      invalid("BUN_PREPARED_TREE_CORRUPT", "stored prepared-tree record must not be a symlink");
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseStoredRecord(
  reference: PrivateBunNativePreparedTreeRef,
  bytes: Uint8Array,
): PreparedTreeRecord {
  let decoded: JsonValue;
  try {
    decoded = decodeJson1(bytes);
  } catch (error) {
    if (error instanceof Json1Error) {
      invalid("BUN_PREPARED_TREE_CORRUPT", `stored record is not strict JSON/1: ${error.message}`);
    }
    throw error;
  }
  if (!sameBytes(bytes, canonicalJson(decoded))) {
    invalid("BUN_PREPARED_TREE_CORRUPT", "stored prepared-tree record is not canonical JSON/1");
  }
  const value = jsonObject(decoded, "stored prepared-tree record");
  const keys = [
    "candidateDigest",
    "dependencyDigest",
    "files",
    "kind",
    "observationDigest",
    "requestDigest",
    "sourcePackageDigest",
  ];
  if (!exactKeys(value, keys) || value.kind !== RECORD_KIND || !Array.isArray(value.files)) {
    invalid("BUN_PREPARED_TREE_CORRUPT", "stored prepared-tree record has invalid canonical fields");
  }
  for (const field of keys.filter((field) => field.endsWith("Digest"))) {
    if (typeof value[field] !== "string" || !DIGEST.test(value[field] as string)) {
      invalid("BUN_PREPARED_TREE_CORRUPT", `stored prepared-tree ${field} is invalid`);
    }
  }
  const files = parseDependencyFiles(value.files);
  const totalBytes = files.reduce((sum, file) =>
    sum + Buffer.from(file.contentBase64, "base64").byteLength, 0);
  requireStoredSdk(files);
  const candidateIdentity = {
    kind: "private-bun-native-prepared-candidate/1",
    observationDigest: value.observationDigest,
    requestDigest: value.requestDigest,
    packageDigest: value.sourcePackageDigest,
    dependencyDigest: value.dependencyDigest,
    totalBytes,
    files,
  } as unknown as JsonValue;
  if (privateDomainDigest("JIG-Private-Bun-Native-Prepared-Candidate/1", candidateIdentity) !==
      value.candidateDigest) {
    invalid("BUN_PREPARED_TREE_CORRUPT", "stored prepared-tree candidate identity is invalid");
  }
  const record = Object.freeze({
    kind: RECORD_KIND,
    sourcePackageDigest: value.sourcePackageDigest as string,
    observationDigest: value.observationDigest as string,
    requestDigest: value.requestDigest as string,
    candidateDigest: value.candidateDigest as string,
    dependencyDigest: value.dependencyDigest as string,
    files,
  });
  const expected = referenceFor(record);
  if (
    expected.digest !== reference.digest ||
    expected.sourcePackageDigest !== reference.sourcePackageDigest ||
    expected.observationDigest !== reference.observationDigest ||
    expected.requestDigest !== reference.requestDigest ||
    expected.candidateDigest !== reference.candidateDigest ||
    expected.dependencyDigest !== reference.dependencyDigest
  ) {
    invalid("BUN_PREPARED_TREE_CORRUPT", "stored prepared-tree record does not match its reference");
  }
  return record;
}

function parseDependencyFiles(value: JsonValue[]): readonly PrivateBunNativePreparedCandidateFile[] {
  if (value.length === 0 || value.length > MAX_DEPENDENCY_FILES) {
    invalid("BUN_PREPARED_TREE_CORRUPT", "stored dependency file count is invalid");
  }
  const files: PrivateBunNativePreparedCandidateFile[] = [];
  let priorPath: string | undefined;
  let totalBytes = 0;
  for (const [index, item] of value.entries()) {
    const file = jsonObject(item, `stored dependency file ${index}`);
    if (!exactKeys(file, ["contentBase64", "path"]) ||
        typeof file.path !== "string" || typeof file.contentBase64 !== "string") {
      invalid("BUN_PREPARED_TREE_CORRUPT", `stored dependency file ${index} is invalid`);
    }
    const path = validateLogicalPath(file.path);
    if (priorPath !== undefined && comparePathBytes(priorPath, path) >= 0) {
      invalid("BUN_PREPARED_TREE_CORRUPT", "stored dependency paths are not canonical");
    }
    priorPath = path;
    if (!CANONICAL_BASE64.test(file.contentBase64) ||
        Buffer.from(file.contentBase64, "base64").toString("base64") !== file.contentBase64) {
      invalid("BUN_PREPARED_TREE_CORRUPT", `stored dependency file ${index} is not canonical base64`);
    }
    totalBytes += Buffer.from(file.contentBase64, "base64").byteLength;
    if (totalBytes > MAX_DEPENDENCY_BYTES) {
      invalid("BUN_PREPARED_TREE_CORRUPT", "stored dependency tree exceeds its byte bound");
    }
    files.push(Object.freeze({ path, contentBase64: file.contentBase64 }));
  }
  assertNoPathCollisions(files.map((file) => file.path));
  requireCompleteTreeTopology([], files);
  return Object.freeze(files);
}

function requireStoredSdk(files: readonly PrivateBunNativePreparedCandidateFile[]): void {
  const manifest = files.find((file) => file.path === "package.json");
  if (manifest === undefined || !files.some((file) => file.path === SDK_ENTRY)) {
    invalid(
      "BUN_PREPARED_TREE_CORRUPT",
      `stored dependency must contain package.json and ${SDK_ENTRY}`,
    );
  }
  let decoded: JsonValue;
  try {
    decoded = decodeJson1(Buffer.from(manifest.contentBase64, "base64"));
  } catch (error) {
    if (error instanceof Json1Error) {
      invalid("BUN_PREPARED_TREE_CORRUPT", `stored dependency manifest is invalid: ${error.message}`);
    }
    throw error;
  }
  const value = jsonObject(decoded, "stored dependency manifest");
  if (value.name !== SDK_NAME || value.version !== SDK_VERSION) {
    invalid(
      "BUN_PREPARED_TREE_CORRUPT",
      `stored dependency must be exact ${SDK_NAME}@${SDK_VERSION}`,
    );
  }
}

interface PreparedShard {
  readonly directory: FileHandle;
  readonly directoryPath: string;
  readonly finalPath: string;
  readonly ownerUid: bigint;
}

async function openPreparedShard(
  storeRoot: string,
  digest: string,
  create: boolean,
): Promise<PreparedShard> {
  if (!DIGEST.test(digest)) throw new TypeError("prepared-tree digest is invalid");
  const hexadecimal = digest.slice("sha256:".length);
  let parent = await openStoreRoot(storeRoot);
  try {
    for (const segment of ["prepared", "bun-v1", "sha256", hexadecimal.slice(0, 2)]) {
      const path = `${descriptorPath(parent.handle)}/${segment}`;
      if (create) {
        try { await mkdir(path, { mode: 0o700 }); } catch (error) {
          if (!hasCode(error, "EEXIST")) throw error;
        }
      }
      const child = await open(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const information = await child.stat({ bigint: true });
        requireProtectedDirectory(information, parent.ownerUid);
        if (create) await parent.handle.sync();
      } catch (error) {
        await child.close().catch(() => undefined);
        throw error;
      }
      const ownerUid = parent.ownerUid;
      await parent.handle.close();
      parent = { handle: child, ownerUid };
    }
    const directoryPath = descriptorPath(parent.handle);
    return {
      directory: parent.handle,
      directoryPath,
      finalPath: `${directoryPath}/${hexadecimal.slice(2)}.tree`,
      ownerUid: parent.ownerUid,
    };
  } catch (error) {
    await parent.handle.close().catch(() => undefined);
    throw error;
  }
}

interface OpenStoreRoot {
  readonly handle: FileHandle;
  readonly ownerUid: bigint;
}

async function openStoreRoot(storeRoot: string): Promise<OpenStoreRoot> {
  const path = resolve(storeRoot);
  const observed = await lstat(path, { bigint: true });
  if (observed.isSymbolicLink()) {
    invalid("BUN_PREPARED_TREE_STORE", "protected prepared-tree store root must not be a symlink", path);
  }
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const actual = await handle.stat({ bigint: true });
    if (!sameIdentity(observed, actual)) {
      unavailable("BUN_PREPARED_TREE_STORE_CHANGED", "prepared-tree store root changed while opening", path);
    }
    if (typeof process.geteuid !== "function") {
      unavailable("BUN_PREPARED_TREE_STORE_UNAVAILABLE", "prepared-tree storage requires a Unix identity");
    }
    const ownerUid = BigInt(process.geteuid());
    requireProtectedDirectory(actual, ownerUid);
    return { handle, ownerUid };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

function requireProtectedDirectory(information: BigIntStats, ownerUid: bigint): void {
  if (!information.isDirectory() || information.uid !== ownerUid ||
      (information.mode & 0o777n) !== 0o700n) {
    invalid(
      "BUN_PREPARED_TREE_STORE",
      "protected prepared-tree directories must be coordinator-owned with exact mode 0700",
    );
  }
}

function requireArtifactFile(information: BigIntStats, ownerUid: bigint): void {
  if (!information.isFile() || information.uid !== ownerUid ||
      (information.mode & 0o777n) !== 0o400n) {
    invalid(
      "BUN_PREPARED_TREE_CORRUPT",
      "stored prepared-tree record must be a coordinator-owned read-only regular file",
    );
  }
}

function descriptorPath(handle: FileHandle): string {
  return `/proc/self/fd/${handle.fd}`;
}

async function requirePathIdentity(path: string, expected: BigIntStats): Promise<void> {
  const observed = await lstat(path, { bigint: true });
  if (!observed.isFile() || !sameIdentity(observed, expected)) {
    invalid("BUN_PREPARED_TREE_CORRUPT", "stored prepared-tree pathname identity changed");
  }
}

async function requireSameFile(left: string, right: string): Promise<void> {
  const [first, second] = await Promise.all([
    lstat(left, { bigint: true }),
    lstat(right, { bigint: true }),
  ]);
  if (!first.isFile() || !second.isFile() || !sameIdentity(first, second)) {
    unavailable("BUN_PREPARED_TREE_PUBLISH_RACE", "prepared-tree publication identity changed");
  }
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFile(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs;
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (result.bytesWritten === 0) throw new Error("prepared-tree write made no progress");
    offset += result.bytesWritten;
  }
}

function ordinaryDataRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must be an ordinary data object`);
  }
  const prototype = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  if ((prototype !== Object.prototype && prototype !== null) || keys.some((key) => typeof key !== "string")) {
    throw new TypeError(`${label} must be an ordinary data object`);
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label} must contain enumerable data fields`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function jsonObject(value: JsonValue, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid("BUN_PREPARED_TREE_CORRUPT", `${label} must be an object`);
  }
  return value as JsonObject;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { readonly code?: unknown }).code === code;
}
