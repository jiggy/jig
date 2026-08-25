import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { CheckError, invalid, unavailable } from "../diagnostics.js";
import {
  createCapturedPackage,
  type CapturedFile,
  type CapturedPackage,
  type CapturedPackageBacking,
} from "../package/capture.js";
import { encodePackage1, PACKAGE_1_LIMITS } from "../package/digest.js";
import {
  assertNoPathCollisions,
  comparePathBytes,
  validateLogicalPath,
} from "../package/paths.js";

const ARTIFACT_KIND = "flow-package/1";
const DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/;
const HEADER = Buffer.from("FLOW-Package/1\0", "ascii");
const MAX_PATH_BYTES = 1_024;
const COPY_CHUNK_BYTES = 1024 * 1024;
// Linux O_TMPFILE is __O_TMPFILE | O_DIRECTORY; Node does not expose it.
const O_TMPFILE = 0o20000000 | constants.O_DIRECTORY;

declare const packageArtifactDigestBrand: unique symbol;

export type PackageDigest = string & {
  readonly [packageArtifactDigestBrand]: "Package/1";
};

/** A private durable reference to Package/1 bytes, not provenance or admission. */
export interface PackageArtifactRef {
  readonly kind: typeof ARTIFACT_KIND;
  readonly digest: PackageDigest;
}

/**
 * Publish one captured Package/1 value into an already-protected host store.
 * The source capture remains owned by the caller.
 */
export async function publishCapturedPackage(
  storeRoot: string,
  captured: CapturedPackage,
): Promise<PackageArtifactRef> {
  const digest = parsePackageDigest(captured.digest);
  const location = await openArtifactShard(storeRoot, digest, true);
  const stage = `${location.directoryPath}/.stage-${process.pid}-${randomUUID()}`;
  let stageHandle: FileHandle | undefined;
  let stageExists = false;
  let result: PackageArtifactRef | undefined;
  let failure: unknown;

  try {
    stageHandle = await open(
      stage,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    stageExists = true;
    const observedDigest = await writeCapturedArchive(stageHandle, captured);
    if (observedDigest !== digest) {
      invalid(
        "PACKAGE_ARTIFACT_SOURCE_MISMATCH",
        `captured Package/1 bytes produced ${observedDigest}, not ${digest}`,
      );
    }

    await stageHandle.sync();
    await stageHandle.chmod(0o400);
    await stageHandle.sync();
    await stageHandle.close();
    stageHandle = undefined;

    const staged = await capturePackageArtifactFile(
      stage,
      digest,
      "staged Package/1 artifact",
      location.ownerUid,
    );
    await staged.dispose();

    try {
      await link(stage, location.finalPath);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) {
        if (hasCode(error, "EPERM") || hasCode(error, "EOPNOTSUPP") || hasCode(error, "EXDEV")) {
          unavailable(
            "PACKAGE_ARTIFACT_ATOMIC_PUBLISH_UNAVAILABLE",
            "the protected store does not support same-filesystem hard-link publication",
          );
        }
        throw error;
      }

      await unlink(stage);
      stageExists = false;
      await location.directory.sync();
      const existing = await capturePackageArtifactFile(
        location.finalPath,
        digest,
        `stored Package/1 ${digest}`,
        location.ownerUid,
      );
      await existing.dispose();
      result = packageArtifactRef(digest);
      return result;
    }

    await requireSameFile(stage, location.finalPath);
    await location.directory.sync();
    await unlink(stage);
    stageExists = false;
    await location.directory.sync();
    result = packageArtifactRef(digest);
    return result;
  } catch (error) {
    failure = isResourceError(error)
      ? new CheckError(
        "unavailable",
        "PACKAGE_ARTIFACT_RESOURCE_EXHAUSTED",
        `cannot publish Package/1 artifact: ${errorText(error)}`,
      )
      : error;
  } finally {
    const cleanupFailures: unknown[] = [];
    if (stageHandle !== undefined) {
      try {
        await stageHandle.close();
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    if (stageExists) {
      try {
        await unlink(stage);
        await location.directory.sync();
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    try {
      await location.directory.close();
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (cleanupFailures.length > 0) {
      if (failure !== undefined) cleanupFailures.unshift(failure);
      throw new AggregateError(cleanupFailures, "Package/1 publication cleanup did not complete");
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) throw new Error("Package/1 publication produced no result");
  return result;
}

/** Acquire a newly verified invocation-local capture of one retained package. */
export async function captureStoredPackage(
  storeRoot: string,
  reference: PackageArtifactRef,
): Promise<CapturedPackage> {
  const digest = parsePackageArtifactRef(reference);
  let location: ArtifactShard | undefined;
  let captured: CapturedPackage | undefined;
  try {
    location = await openArtifactShard(storeRoot, digest, false);
    await location.directory.sync();
    captured = await capturePackageArtifactFile(
      location.finalPath,
      digest,
      `stored Package/1 ${digest}`,
      location.ownerUid,
    );
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      unavailable("PACKAGE_ARTIFACT_MISSING", `stored Package/1 ${digest} is missing`);
    }
    if (isResourceError(error)) {
      unavailable(
        "PACKAGE_ARTIFACT_RESOURCE_EXHAUSTED",
        `cannot acquire Package/1 artifact: ${errorText(error)}`,
      );
    }
    throw error;
  } finally {
    if (location !== undefined) {
      try {
        await location.directory.close();
      } catch (error) {
        await captured?.dispose();
        throw error;
      }
    }
  }
  return captured!;
}

function packageArtifactRef(digest: PackageDigest): PackageArtifactRef {
  return Object.freeze({ kind: ARTIFACT_KIND, digest });
}

function parsePackageArtifactRef(reference: PackageArtifactRef): PackageDigest {
  if (typeof reference !== "object" || reference === null || Array.isArray(reference)) {
    invalid("PACKAGE_ARTIFACT_REF", "Package/1 artifact reference must be an object");
  }
  const record = reference as unknown as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "digest" || keys[1] !== "kind" || record.kind !== ARTIFACT_KIND) {
    invalid("PACKAGE_ARTIFACT_REF", `Package/1 artifact reference must contain only kind=${ARTIFACT_KIND} and digest`);
  }
  return parsePackageDigest(record.digest);
}

function parsePackageDigest(value: unknown): PackageDigest {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    invalid(
      "PACKAGE_ARTIFACT_DIGEST",
      "Package/1 artifact digest must be sha256: followed by 64 lowercase hexadecimal digits",
    );
  }
  return value as PackageDigest;
}

interface ArtifactShard {
  readonly directory: FileHandle;
  readonly directoryPath: string;
  readonly finalPath: string;
  readonly ownerUid: bigint;
}

async function openArtifactShard(
  storeRoot: string,
  digest: PackageDigest,
  create: boolean,
): Promise<ArtifactShard> {
  const hexadecimal = DIGEST_PATTERN.exec(digest)![1]!;
  let parent = await openStoreRoot(storeRoot);
  try {
    for (const segment of ["packages", "v1", "sha256", hexadecimal.slice(0, 2)]) {
      const childPath = `${descriptorPath(parent.handle)}/${segment}`;
      if (create) {
        try {
          await mkdir(childPath, { mode: 0o700 });
        } catch (error) {
          if (!hasCode(error, "EEXIST")) throw error;
        }
      }
      const child = await open(
        childPath,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const information = await child.stat({ bigint: true });
        requireProtectedDirectory(information, "protected Package/1 store directory", parent.ownerUid);
        // Every publisher establishes durability before relying on this name,
        // including one which lost the concurrent mkdir race.
        if (create) await parent.handle.sync();
      } catch (error) {
        await child.close().catch(() => undefined);
        throw error;
      }
      const ownerUid = parent.ownerUid;
      try {
        await parent.handle.close();
      } catch (error) {
        await child.close().catch(() => undefined);
        throw error;
      }
      parent = { handle: child, ownerUid };
    }
    const directory = parent.handle;
    const directoryPath = descriptorPath(directory);
    return {
      directory,
      directoryPath,
      finalPath: `${directoryPath}/${hexadecimal.slice(2)}.pkg`,
      ownerUid: parent.ownerUid,
    };
  } catch (error) {
    await parent.handle.close().catch(() => undefined);
    throw error;
  }
}

interface OpenStoreDirectory {
  readonly handle: FileHandle;
  readonly ownerUid: bigint;
}

async function openStoreRoot(storeRoot: string): Promise<OpenStoreDirectory> {
  const path = resolve(storeRoot);
  let observed: BigIntStats;
  try {
    observed = await lstat(path, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      unavailable("PACKAGE_ARTIFACT_STORE_MISSING", "protected Package/1 store root does not exist", path);
    }
    throw error;
  }
  if (observed.isSymbolicLink()) {
    invalid("PACKAGE_ARTIFACT_STORE", "protected Package/1 store root must not be a symlink", path);
  }
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const actual = await handle.stat({ bigint: true });
    if (!sameIdentity(observed, actual)) {
      unavailable("PACKAGE_ARTIFACT_STORE_CHANGED", "protected Package/1 store root changed while opening", path);
    }
    if (typeof process.geteuid !== "function") {
      unavailable("PACKAGE_ARTIFACT_STORE_UNAVAILABLE", "the Package/1 store requires a Unix effective user identity");
    }
    const expectedUid = BigInt(process.geteuid());
    requireProtectedDirectory(actual, "protected Package/1 store root", expectedUid);
    return { handle, ownerUid: expectedUid };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

function requireProtectedDirectory(
  information: BigIntStats,
  description: string,
  expectedUid: bigint,
): void {
  if (!information.isDirectory()) invalid("PACKAGE_ARTIFACT_STORE", `${description} must be a directory`);
  if (information.uid !== expectedUid) {
    invalid("PACKAGE_ARTIFACT_STORE_OWNER", `${description} must be owned by the Jig coordinator identity`);
  }
  if ((information.mode & 0o022n) !== 0n) {
    invalid("PACKAGE_ARTIFACT_STORE_PERMISSIONS", `${description} must not be writable by group or others`);
  }
}

function descriptorPath(handle: FileHandle): string {
  return `/proc/self/fd/${handle.fd}`;
}

async function capturePackageArtifactFile(
  path: string,
  expectedDigest: PackageDigest,
  sourceLabel: string,
  expectedOwnerUid: bigint,
): Promise<CapturedPackage> {
  let handle: FileHandle | undefined;
  let snapshot: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true });
    requireArtifactFile(before, sourceLabel, expectedOwnerUid);
    snapshot = await openAnonymousArchiveSnapshot();
    const parsed = await parsePackageArchive(handle, before, expectedDigest, snapshot);
    const after = await handle.stat({ bigint: true });
    if (!sameStableFile(before, after)) artifactCorrupt(`${sourceLabel} changed while it was verified`);
    requireArtifactFile(after, sourceLabel, expectedOwnerUid);
    await requirePathIdentity(path, after, sourceLabel);

    const backing = await sealArchiveSnapshot(snapshot, Number(before.size), parsed.records);
    snapshot = undefined;
    return createCapturedPackage(sourceLabel, parsed.files, expectedDigest, backing);
  } catch (error) {
    if (error instanceof CheckError && error.code.startsWith("PACKAGE_ARTIFACT_")) throw error;
    if (hasCode(error, "ENOENT")) throw error;
    if (isResourceError(error)) throw error;
    return artifactCorrupt(`${sourceLabel} is not a valid retained Package/1 artifact: ${errorText(error)}`);
  } finally {
    await handle?.close().catch(() => undefined);
    await snapshot?.close().catch(() => undefined);
  }
}

interface ArchiveRecord extends CapturedFile {
  readonly offset: number;
}

async function parsePackageArchive(
  handle: FileHandle,
  information: BigIntStats,
  expectedDigest: PackageDigest,
  snapshot: FileHandle,
): Promise<{ readonly files: readonly CapturedFile[]; readonly records: readonly ArchiveRecord[] }> {
  const hash = createHash("sha256");
  let position = 0;

  async function readHashed(length: number, description: string): Promise<Uint8Array> {
    const bytes = await readExact(handle, position, length, description);
    position += length;
    hash.update(bytes);
    try {
      await writeAll(snapshot, bytes);
    } catch (error) {
      if (isResourceError(error)) throw error;
      unavailable(
        "PACKAGE_ARTIFACT_SNAPSHOT_IO",
        `cannot copy verified Package/1 bytes into the invocation snapshot: ${errorText(error)}`,
      );
    }
    return bytes;
  }

  const header = await readHashed(HEADER.byteLength, "Package/1 header");
  if (!Buffer.from(header).equals(HEADER)) artifactCorrupt("stored artifact has the wrong Package/1 header");
  const count = bigintToNumber(readUnsigned(await readHashed(8, "Package/1 file count")), "file count");
  if (count > PACKAGE_1_LIMITS.files) artifactCorrupt("stored artifact exceeds the Package/1 file limit");

  const records: ArchiveRecord[] = [];
  let totalBytes = 0;
  let previousPath: string | undefined;
  for (let index = 0; index < count; index += 1) {
    const marker = await readHashed(1, "Package/1 record marker");
    if (marker[0] !== 0x01) artifactCorrupt("stored artifact has an invalid Package/1 record marker");
    const pathBytes = bigintToNumber(readUnsigned(await readHashed(4, "Package/1 path length")), "path length");
    if (pathBytes < 1 || pathBytes > MAX_PATH_BYTES) artifactCorrupt("stored artifact has an invalid Package/1 path length");
    const rawPath = await readHashed(pathBytes, "Package/1 path");
    let logicalPath: string;
    try {
      logicalPath = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawPath);
      validateLogicalPath(logicalPath);
    } catch (error) {
      artifactCorrupt(`stored artifact has an invalid Package/1 path: ${errorText(error)}`);
    }
    if (previousPath !== undefined && comparePathBytes(previousPath, logicalPath) >= 0) {
      artifactCorrupt("stored artifact paths are not in strict canonical order");
    }
    previousPath = logicalPath;

    const size = bigintToNumber(readUnsigned(await readHashed(8, "Package/1 content length")), "content length");
    if (size > PACKAGE_1_LIMITS.fileBytes) artifactCorrupt(`stored artifact file ${logicalPath} exceeds the Package/1 limit`);
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > PACKAGE_1_LIMITS.totalBytes) {
      artifactCorrupt("stored artifact exceeds the Package/1 total-content limit");
    }
    const offset = position;
    let remaining = size;
    while (remaining > 0) {
      const length = Math.min(COPY_CHUNK_BYTES, remaining);
      await readHashed(length, `Package/1 content ${logicalPath}`);
      remaining -= length;
    }
    records.push(Object.freeze({ path: logicalPath, size, offset }));
  }

  if (BigInt(position) !== information.size) artifactCorrupt("stored artifact has trailing bytes");
  try {
    assertNoPathCollisions(records.map((record) => record.path));
  } catch (error) {
    artifactCorrupt(`stored artifact paths collide: ${errorText(error)}`);
  }
  const observedDigest = `sha256:${hash.digest("hex")}`;
  if (observedDigest !== expectedDigest) {
    artifactCorrupt(`stored artifact digest is ${observedDigest}, not ${expectedDigest}`);
  }
  return {
    files: Object.freeze(records.map(({ path, size }) => Object.freeze({ path, size }))),
    records: Object.freeze(records),
  };
}

function archiveBacking(
  handle: FileHandle,
  records: readonly ArchiveRecord[],
): CapturedPackageBacking {
  const byPath = new Map(records.map((record) => [record.path, record]));
  let disposed = false;
  return {
    stream(path: string, maximumBytes = Number.MAX_SAFE_INTEGER): AsyncIterable<Uint8Array> {
      if (disposed) unavailable("PACKAGE_SNAPSHOT_CLOSED", "package snapshot has been disposed", path);
      const record = byPath.get(path);
      if (record === undefined) invalid("PACKAGE_FILE_MISSING", `package has no ${path}`, path);
      return readRange(handle, record.offset, Math.min(record.size, maximumBytes), path);
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      byPath.clear();
      await handle.close().catch(() => undefined);
    },
  };
}

async function openAnonymousArchiveSnapshot(): Promise<FileHandle> {
  try {
    return await open(tmpdir(), constants.O_RDWR | constants.O_EXCL | O_TMPFILE, 0o600);
  } catch (error) {
    if (isResourceError(error)) throw error;
    unavailable(
      "PACKAGE_ARTIFACT_SNAPSHOT_UNAVAILABLE",
      `cannot create an anonymous Package/1 snapshot: ${errorText(error)}`,
    );
  }
}

async function sealArchiveSnapshot(
  writable: FileHandle,
  expectedSize: number,
  records: readonly ArchiveRecord[],
): Promise<CapturedPackageBacking> {
  let readonly: FileHandle | undefined;
  try {
    const before = await writable.stat({ bigint: true });
    if (!before.isFile() || before.size !== BigInt(expectedSize)) {
      artifactCorrupt("anonymous Package/1 snapshot has the wrong size");
    }
    await writable.chmod(0o400);
    readonly = await open(`/proc/self/fd/${writable.fd}`, constants.O_RDONLY);
    const after = await readonly.stat({ bigint: true });
    if (!sameIdentity(before, after) || after.size !== BigInt(expectedSize)) {
      artifactCorrupt("anonymous Package/1 snapshot changed while sealing");
    }
    await writable.close();
    return archiveBacking(readonly, records);
  } catch (error) {
    await readonly?.close().catch(() => undefined);
    throw error;
  }
}

async function* readRange(
  handle: FileHandle,
  offset: number,
  size: number,
  path: string,
): AsyncIterable<Uint8Array> {
  let read = 0;
  while (read < size) {
    const length = Math.min(COPY_CHUNK_BYTES, size - read);
    const bytes = await readExact(handle, offset + read, length, `stored package member ${path}`);
    read += bytes.byteLength;
    yield bytes;
  }
}

async function readExact(
  handle: FileHandle,
  offset: number,
  length: number,
  description: string,
): Promise<Uint8Array> {
  const result = new Uint8Array(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await handle.read(result, read, length - read, offset + read);
    if (bytesRead === 0) artifactCorrupt(`stored artifact ended during ${description}`);
    read += bytesRead;
  }
  return result;
}

async function writeCapturedArchive(
  destination: FileHandle,
  captured: CapturedPackage,
): Promise<string> {
  const hash = createHash("sha256");
  const iterator = encodePackage1(
    captured.files,
    (file) => captured.stream(file.path),
  )[Symbol.asyncIterator]();
  let finished = false;
  let failure: unknown;
  try {
    while (true) {
      let item: IteratorResult<Uint8Array>;
      try {
        item = await iterator.next();
      } catch (error) {
        if (error instanceof CheckError || isResourceError(error)) throw error;
        invalid(
          "PACKAGE_ARTIFACT_SOURCE_INVALID",
          `captured Package/1 stream is inconsistent: ${errorText(error)}`,
        );
      }
      if (item.done) {
        finished = true;
        break;
      }
      hash.update(item.value);
      await writeAll(destination, item.value);
    }
  } catch (error) {
    failure = error;
  }

  let iteratorFailure: unknown;
  if (!finished && iterator.return !== undefined) {
    try {
      await iterator.return();
    } catch (error) {
      iteratorFailure = error;
    }
  }
  if (failure !== undefined && iteratorFailure !== undefined) {
    throw new AggregateError([failure, iteratorFailure], "Package/1 source iterator cleanup did not complete");
  }
  if (failure !== undefined) throw failure;
  if (iteratorFailure !== undefined) throw iteratorFailure;
  return `sha256:${hash.digest("hex")}`;
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let written = 0;
  while (written < bytes.byteLength) {
    const result = await handle.write(bytes, written, bytes.byteLength - written);
    if (result.bytesWritten === 0) throw new Error("Package/1 artifact write made no progress");
    written += result.bytesWritten;
  }
}

async function requireSameFile(left: string, right: string): Promise<void> {
  const [first, second] = await Promise.all([
    lstat(left, { bigint: true }),
    lstat(right, { bigint: true }),
  ]);
  if (!sameIdentity(first, second) || !first.isFile() || !second.isFile()) {
    unavailable("PACKAGE_ARTIFACT_PUBLISH_RACE", "published Package/1 artifact identity changed unexpectedly");
  }
}

async function requirePathIdentity(path: string, opened: BigIntStats, label: string): Promise<void> {
  let observed: BigIntStats;
  try {
    observed = await lstat(path, { bigint: true });
  } catch (error) {
    artifactCorrupt(`${label} pathname disappeared while it was verified: ${errorText(error)}`);
  }
  if (!observed.isFile() || !sameIdentity(opened, observed)) {
    artifactCorrupt(`${label} pathname identity changed while it was verified`);
  }
}

function requireArtifactFile(
  information: BigIntStats,
  label: string,
  expectedOwnerUid: bigint,
): void {
  if (!information.isFile()) artifactCorrupt(`${label} is not a regular file`);
  if (information.uid !== expectedOwnerUid) artifactCorrupt(`${label} has the wrong owner`);
  if ((information.mode & 0o222n) !== 0n) artifactCorrupt(`${label} is writable`);
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFile(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs;
}

function readUnsigned(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) | BigInt(byte);
  return result;
}

function bigintToNumber(value: bigint, description: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) artifactCorrupt(`stored artifact ${description} is too large`);
  return Number(value);
}

function artifactCorrupt(message: string): never {
  unavailable("PACKAGE_ARTIFACT_CORRUPT", message);
}

function isResourceError(error: unknown): boolean {
  return ["EMFILE", "ENFILE", "ENOMEM", "ENOSPC", "EDQUOT"].some((code) => hasCode(error, code));
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { readonly code?: unknown }).code === code;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
