import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { resolve } from "node:path";
import { types as utilTypes } from "node:util";

import { CheckError, invalid, unavailable } from "../diagnostics.js";

const KIND = "host-extension-blob/1";
const DOMAIN = Buffer.from("JIG-Host-Extension-Blob/1\0", "ascii");
const DIGEST = /^sha256:([0-9a-f]{64})$/;
const STAGE = /^\.stage-([0-9a-f]{32})-([0-9]+)-([0-9]+)-([1-9][0-9]*)-([1-9][0-9]*)-([0-9a-f]{64})-([1-9][0-9]*)-([0-9a-f]{32})\.blob$/;
export const PRIVATE_HOST_EXTENSION_BLOB_LIMIT = 16 * 1024 * 1024;

declare const hostExtensionDigestBrand: unique symbol;

type HostExtensionDigest = string & {
  readonly [hostExtensionDigestBrand]: "HostExtensionBlob/1";
};

/** Durable host-private bytes. This is neither FLOW Package/1 nor admission. */
export interface PrivateHostExtensionBlobRef {
  readonly kind: typeof KIND;
  readonly digest: HostExtensionDigest;
  readonly bytes: number;
}

export interface PrivateCapturedHostExtensionBlob {
  readonly reference: PrivateHostExtensionBlobRef;
  read(): Uint8Array;
  dispose(): void;
}

const capturedBlobs = new WeakSet<object>();

/** Publish one opaque host-extension byte bundle; role and closure are unproved here. */
export async function publishPrivateHostExtensionBlob(
  storeRoot: string,
  source: Uint8Array,
): Promise<PrivateHostExtensionBlobRef> {
  if (utilTypes.isProxy(source) || !(source instanceof Uint8Array)) {
    throw new TypeError("host-extension blob source must be bytes");
  }
  requireSourceBlobSize(source.byteLength);
  const bytes = Uint8Array.from(source);
  const digest = blobDigest(bytes);
  const reference = blobRef(digest, bytes.byteLength);
  const stageOwner = await readCurrentStageOwner();
  const staging = await openStagingDirectory(storeRoot, true);
  let location: ArtifactShard;
  try {
    await collectStaleStages(storeRoot, staging, stageOwner);
    location = await openArtifactShard(storeRoot, digest, true);
  } catch (error) {
    return await closeAfterFailure(
      staging.directory,
      error,
      "host-extension publication setup cleanup did not complete",
    );
  }
  const stage = `${staging.directoryPath}/${stageName(stageOwner, reference)}`;
  let stageHandle: FileHandle | undefined;
  let stageExists = false;
  let result: PrivateHostExtensionBlobRef | undefined;
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

    await verifyArtifactFile(stage, reference, location.ownerUid, "staged host-extension blob");
    try {
      await link(stage, location.finalPath);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) {
        if (hasCode(error, "EPERM") || hasCode(error, "EOPNOTSUPP") || hasCode(error, "EXDEV")) {
          unavailable(
            "HOST_EXTENSION_ARTIFACT_ATOMIC_PUBLISH_UNAVAILABLE",
            "the protected store does not support same-filesystem hard-link publication",
          );
        }
        throw error;
      }
      await location.directory.sync();
      await unlink(stage);
      stageExists = false;
      await staging.directory.sync();
      await verifyArtifactFile(
        location.finalPath,
        reference,
        location.ownerUid,
        `stored host-extension blob ${digest}`,
      );
      result = reference;
      return result;
    }

    await requireSameFile(stage, location.finalPath);
    await location.directory.sync();
    await unlink(stage);
    stageExists = false;
    await staging.directory.sync();
    result = reference;
    return result;
  } catch (error) {
    failure = !(error instanceof AggregateError) && isResourceError(error)
      ? new CheckError(
        "unavailable",
        "HOST_EXTENSION_ARTIFACT_RESOURCE_EXHAUSTED",
        `cannot publish host-extension blob: ${errorText(error)}`,
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
        await staging.directory.sync();
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    try {
      await location.directory.close();
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      await staging.directory.close();
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (cleanupFailures.length > 0) {
      if (failure !== undefined) cleanupFailures.unshift(failure);
      throw new AggregateError(cleanupFailures, "host-extension publication cleanup did not complete");
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) throw new Error("host-extension publication produced no result");
  return result;
}

/** Remove staging residue whose exact process publication lease is no longer live. */
export async function recoverPrivateHostExtensionBlobStore(storeRoot: string): Promise<number> {
  const owner = await readCurrentStageOwner();
  const staging = await openStagingDirectory(storeRoot, true);
  let removed: number | undefined;
  let failure: unknown;
  try {
    removed = await collectStaleStages(storeRoot, staging, owner);
  } catch (error) {
    failure = error;
  } finally {
    try {
      await staging.directory.close();
    } catch (error) {
      failure = failure === undefined
        ? error
        : new AggregateError([failure, error], "host-extension recovery cleanup did not complete");
    }
  }
  if (failure !== undefined) throw failure;
  if (removed === undefined) throw new Error("host-extension recovery produced no result");
  return removed;
}

/** Reacquire and copy one exact durable bundle into invocation-local memory. */
export async function capturePrivateHostExtensionBlob(
  storeRoot: string,
  value: PrivateHostExtensionBlobRef,
): Promise<PrivateCapturedHostExtensionBlob> {
  const reference = normalizePrivateHostExtensionBlobRef(value);
  let location: ArtifactShard | undefined;
  let contents: Uint8Array | undefined;
  let failure: unknown;
  try {
    location = await openArtifactShard(storeRoot, reference.digest, false);
    await location.directory.sync();
    contents = await verifyArtifactFile(
      location.finalPath,
      reference,
      location.ownerUid,
      `stored host-extension blob ${reference.digest}`,
    );
  } catch (error) {
    failure = error;
  } finally {
    if (location !== undefined) {
      try {
        await location.directory.close();
      } catch (error) {
        if (contents !== undefined) contents.fill(0);
        failure = failure === undefined
          ? error
          : new AggregateError([failure, error], "host-extension acquisition cleanup did not complete");
      }
    }
  }
  if (failure !== undefined) {
    if (contents !== undefined) contents.fill(0);
    if (failure instanceof AggregateError) throw failure;
    if (hasCode(failure, "ENOENT")) {
      unavailable(
        "HOST_EXTENSION_ARTIFACT_MISSING",
        `stored host-extension blob ${reference.digest} is missing`,
      );
    }
    if (isResourceError(failure)) {
      unavailable(
        "HOST_EXTENSION_ARTIFACT_RESOURCE_EXHAUSTED",
        `cannot acquire host-extension blob: ${errorText(failure)}`,
      );
    }
    throw failure;
  }

  let retained: Uint8Array | undefined = contents;
  const captured = Object.freeze({
    reference,
    read(): Uint8Array {
      if (retained === undefined) {
        unavailable("HOST_EXTENSION_ARTIFACT_CAPTURE_CLOSED", "host-extension capture is closed");
      }
      return retained.slice();
    },
    dispose(): void {
      if (retained === undefined) return;
      retained.fill(0);
      retained = undefined;
    },
  });
  capturedBlobs.add(captured);
  return captured;
}

export function requirePrivateCapturedHostExtensionBlob(
  value: unknown,
): PrivateCapturedHostExtensionBlob {
  if (value === null || typeof value !== "object" || !capturedBlobs.has(value)) {
    throw new TypeError("host-extension blob was not captured from the protected store");
  }
  return value as PrivateCapturedHostExtensionBlob;
}

/** Strict inert reference parsing; it does not prove artifact availability. */
export function normalizePrivateHostExtensionBlobRef(
  value: unknown,
): PrivateHostExtensionBlobRef {
  if (value === null || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) {
    invalid("HOST_EXTENSION_ARTIFACT_REF", "host-extension artifact reference must be a plain object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid("HOST_EXTENSION_ARTIFACT_REF", "host-extension artifact reference must be a plain object");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 3 || !keys.includes("kind") || !keys.includes("digest") || !keys.includes("bytes")) {
    invalid(
      "HOST_EXTENSION_ARTIFACT_REF",
      `host-extension artifact reference must contain only kind=${KIND}, digest, and bytes`,
    );
  }
  const kind = dataField(value, "kind");
  const digest = dataField(value, "digest");
  const bytes = dataField(value, "bytes");
  if (kind !== KIND) invalid("HOST_EXTENSION_ARTIFACT_REF", `host-extension artifact kind must be ${KIND}`);
  if (typeof digest !== "string" || !DIGEST.test(digest)) {
    invalid(
      "HOST_EXTENSION_ARTIFACT_DIGEST",
      "host-extension artifact digest must be sha256: followed by 64 lowercase hexadecimal digits",
    );
  }
  requireReferenceBlobSize(bytes);
  return blobRef(digest as HostExtensionDigest, bytes);
}

function blobRef(digest: HostExtensionDigest, bytes: number): PrivateHostExtensionBlobRef {
  return Object.freeze({ kind: KIND, digest, bytes });
}

function blobDigest(bytes: Uint8Array): HostExtensionDigest {
  const hash = createHash("sha256");
  hash.update(DOMAIN);
  hash.update(bytes);
  return `sha256:${hash.digest("hex")}` as HostExtensionDigest;
}

function requireSourceBlobSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > PRIVATE_HOST_EXTENSION_BLOB_LIMIT) {
    throw new TypeError(
      `host-extension blob must contain 1-${PRIVATE_HOST_EXTENSION_BLOB_LIMIT} bytes`,
    );
  }
}

function requireReferenceBlobSize(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 ||
      (value as number) > PRIVATE_HOST_EXTENSION_BLOB_LIMIT) {
    invalid(
      "HOST_EXTENSION_ARTIFACT_BYTES",
      `host-extension artifact bytes must be an integer from 1 through ${PRIVATE_HOST_EXTENSION_BLOB_LIMIT}`,
    );
  }
}

function dataField(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
    invalid("HOST_EXTENSION_ARTIFACT_REF", `${key} must be an enumerable data property`);
  }
  return descriptor.value;
}

interface ArtifactShard {
  readonly directory: FileHandle;
  readonly directoryPath: string;
  readonly finalPath: string;
  readonly ownerUid: bigint;
}

interface StagingDirectory {
  readonly directory: FileHandle;
  readonly directoryPath: string;
  readonly ownerUid: bigint;
}

interface StageOwner {
  readonly bootId: string;
  readonly pidNamespaceDevice: bigint;
  readonly pidNamespaceInode: bigint;
  readonly pid: number;
  readonly startTime: string;
}

async function openArtifactShard(
  storeRoot: string,
  digest: HostExtensionDigest,
  create: boolean,
): Promise<ArtifactShard> {
  const hexadecimal = DIGEST.exec(digest)![1]!;
  const opened = await openProtectedStorePath(
    storeRoot,
    ["host-extensions", "v1", "sha256", hexadecimal.slice(0, 2)],
    create,
  );
  const directoryPath = descriptorPath(opened.handle);
  return {
    directory: opened.handle,
    directoryPath,
    finalPath: `${directoryPath}/${hexadecimal.slice(2)}.blob`,
    ownerUid: opened.ownerUid,
  };
}

async function openProtectedStorePath(
  storeRoot: string,
  segments: readonly string[],
  create: boolean,
): Promise<OpenStoreDirectory> {
  let parent = await openStoreRoot(storeRoot);
  try {
    for (const segment of segments) {
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
        requireProtectedDirectory(information, "protected host-extension store directory", parent.ownerUid);
        if (create) await parent.handle.sync();
      } catch (error) {
        await closeAfterFailure(child, error, "host-extension child-directory cleanup did not complete");
      }
      const ownerUid = parent.ownerUid;
      try {
        await parent.handle.close();
      } catch (error) {
        await closeAfterFailure(child, error, "host-extension directory handoff did not complete");
      }
      parent = { handle: child, ownerUid };
    }
    return parent;
  } catch (error) {
    return await closeAfterFailure(parent.handle, error, "host-extension store-path cleanup did not complete");
  }
}

async function openStagingDirectory(storeRoot: string, create: boolean): Promise<StagingDirectory> {
  const opened = await openProtectedStorePath(
    storeRoot,
    ["host-extensions", "v1", "staging"],
    create,
  );
  return {
    directory: opened.handle,
    directoryPath: descriptorPath(opened.handle),
    ownerUid: opened.ownerUid,
  };
}

function stageName(owner: StageOwner, reference: PrivateHostExtensionBlobRef): string {
  return [
    ".stage",
    owner.bootId,
    owner.pidNamespaceDevice.toString(10),
    owner.pidNamespaceInode.toString(10),
    String(owner.pid),
    owner.startTime,
    reference.digest.slice("sha256:".length),
    String(reference.bytes),
    randomUUID().replaceAll("-", ""),
  ].join("-") + ".blob";
}

async function readCurrentStageOwner(): Promise<StageOwner> {
  let bootId: string;
  let namespace: BigIntStats;
  let startTime: string | undefined;
  try {
    const observedBootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8"))
      .trim()
      .replaceAll("-", "")
      .toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(observedBootId)) {
      return stageRecoveryUnavailable("the Linux boot identity is malformed");
    }
    bootId = observedBootId;
    namespace = await stat("/proc/self/ns/pid", { bigint: true });
    startTime = await readProcessStartTime(process.pid);
  } catch (error) {
    return stageRecoveryUnavailable(`cannot observe the publisher process lease: ${errorText(error)}`);
  }
  if (startTime === undefined) {
    return stageRecoveryUnavailable("the publisher process disappeared before staging");
  }
  return {
    bootId,
    pidNamespaceDevice: namespace.dev,
    pidNamespaceInode: namespace.ino,
    pid: process.pid,
    startTime,
  };
}

async function collectStaleStages(
  storeRoot: string,
  staging: StagingDirectory,
  current: StageOwner,
): Promise<number> {
  let names: string[];
  try {
    names = (await readdir(staging.directoryPath)).sort();
  } catch (error) {
    return stageRecoveryUnavailable(`cannot inspect host-extension staging: ${errorText(error)}`);
  }
  let removed = 0;
  for (const name of names) {
    const matched = STAGE.exec(name);
    if (matched === null) {
      artifactCorrupt(`host-extension staging contains an unexpected entry: ${name}`);
    }
    const stage = parseStage(matched);
    const path = `${staging.directoryPath}/${name}`;
    let information: BigIntStats;
    try {
      information = await lstat(path, { bigint: true });
    } catch (error) {
      if (hasCode(error, "ENOENT")) continue;
      throw error;
    }
    requireRecoverableStage(information, staging.ownerUid, name);
    if (await stageOwnerIsLive(stage.owner, current)) continue;
    if (information.nlink === 2n) {
      const stillPresent = await recoverPublishedStage(storeRoot, staging, path, stage.reference);
      if (!stillPresent) continue;
    }
    try {
      await unlink(path);
    } catch (error) {
      if (hasCode(error, "ENOENT")) continue;
      throw error;
    }
    removed += 1;
  }
  await staging.directory.sync();
  return removed;
}

function parseStage(matched: RegExpExecArray): {
  readonly owner: StageOwner;
  readonly reference: PrivateHostExtensionBlobRef;
} {
  const pid = Number(matched[4]);
  if (!Number.isSafeInteger(pid) || pid < 1) {
    return artifactCorrupt("host-extension staging contains an invalid process lease");
  }
  const bytes = Number(matched[7]);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > PRIVATE_HOST_EXTENSION_BLOB_LIMIT) {
    return artifactCorrupt("host-extension staging contains an invalid declared byte size");
  }
  return {
    owner: {
      bootId: matched[1]!,
      pidNamespaceDevice: BigInt(matched[2]!),
      pidNamespaceInode: BigInt(matched[3]!),
      pid,
      startTime: matched[5]!,
    },
    reference: blobRef(`sha256:${matched[6]!}` as HostExtensionDigest, bytes),
  };
}

function requireRecoverableStage(information: BigIntStats, expectedUid: bigint, name: string): void {
  if (!information.isFile()) artifactCorrupt(`host-extension stage ${name} is not a regular file`);
  if (information.uid !== expectedUid) artifactCorrupt(`host-extension stage ${name} has the wrong owner`);
  const permissions = information.mode & 0o777n;
  if ((permissions & ~0o600n) !== 0n) {
    artifactCorrupt(`host-extension stage ${name} has unexpected permissions`);
  }
  if (information.nlink !== 1n && information.nlink !== 2n) {
    artifactCorrupt(`host-extension stage ${name} has an unexpected link count`);
  }
}

async function recoverPublishedStage(
  storeRoot: string,
  staging: StagingDirectory,
  stagePath: string,
  reference: PrivateHostExtensionBlobRef,
): Promise<boolean> {
  const shard = await openArtifactShard(storeRoot, reference.digest, false);
  let failure: unknown;
  let verified: Uint8Array | undefined;
  let staged: BigIntStats | undefined;
  try {
    try {
      staged = await lstat(stagePath, { bigint: true });
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    if (staged !== undefined) {
      const final = await lstat(shard.finalPath, { bigint: true });
      if (!sameIdentity(staged, final) || !staged.isFile() || !final.isFile()) {
        unavailable(
          "HOST_EXTENSION_ARTIFACT_PUBLISH_RACE",
          "recovered host-extension artifact identity changed unexpectedly",
        );
      }
      verified = await verifyArtifactFile(
        shard.finalPath,
        reference,
        staging.ownerUid,
        `recovered host-extension blob ${reference.digest}`,
      );
      await shard.directory.sync();
    }
  } catch (error) {
    failure = error;
  } finally {
    verified?.fill(0);
    try {
      await shard.directory.close();
    } catch (error) {
      failure = failure === undefined
        ? error
        : new AggregateError([failure, error], "host-extension recovered-shard cleanup did not complete");
    }
  }
  if (failure !== undefined) throw failure;
  return staged !== undefined;
}

async function stageOwnerIsLive(owner: StageOwner, current: StageOwner): Promise<boolean> {
  if (owner.bootId !== current.bootId ||
      owner.pidNamespaceDevice !== current.pidNamespaceDevice ||
      owner.pidNamespaceInode !== current.pidNamespaceInode) {
    return false;
  }
  let namespace: BigIntStats;
  let startTime: string | undefined;
  try {
    namespace = await stat(`/proc/${owner.pid}/ns/pid`, { bigint: true });
    startTime = await readProcessStartTime(owner.pid);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    return stageRecoveryUnavailable(`cannot inspect host-extension stage owner ${owner.pid}: ${errorText(error)}`);
  }
  if (startTime === undefined) return false;
  return namespace.dev === owner.pidNamespaceDevice &&
    namespace.ino === owner.pidNamespaceInode &&
    startTime === owner.startTime;
}

async function readProcessStartTime(pid: number): Promise<string | undefined> {
  let value: string;
  try {
    value = await readFile(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
  const closing = value.lastIndexOf(")");
  if (closing < 0) return stageRecoveryUnavailable(`process ${pid} has malformed stat data`);
  const fields = value.slice(closing + 1).trim().split(/\s+/);
  const startTime = fields[19];
  if (startTime === undefined || !/^[1-9][0-9]*$/.test(startTime)) {
    return stageRecoveryUnavailable(`process ${pid} has malformed start time`);
  }
  return startTime;
}

function stageRecoveryUnavailable(message: string): never {
  unavailable("HOST_EXTENSION_ARTIFACT_STAGE_RECOVERY_UNAVAILABLE", message);
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
      unavailable("HOST_EXTENSION_ARTIFACT_STORE_MISSING", "protected artifact store root does not exist", path);
    }
    throw error;
  }
  if (observed.isSymbolicLink()) {
    invalid("HOST_EXTENSION_ARTIFACT_STORE", "protected artifact store root must not be a symlink", path);
  }
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const actual = await handle.stat({ bigint: true });
    if (!sameIdentity(observed, actual)) {
      unavailable("HOST_EXTENSION_ARTIFACT_STORE_CHANGED", "protected artifact store root changed while opening", path);
    }
    if (typeof process.geteuid !== "function") {
      unavailable("HOST_EXTENSION_ARTIFACT_STORE_UNAVAILABLE", "host-extension storage requires a Unix identity");
    }
    const expectedUid = BigInt(process.geteuid());
    requireProtectedDirectory(actual, "protected artifact store root", expectedUid);
    return { handle, ownerUid: expectedUid };
  } catch (error) {
    return await closeAfterFailure(handle, error, "host-extension store-root cleanup did not complete");
  }
}

async function verifyArtifactFile(
  path: string,
  reference: PrivateHostExtensionBlobRef,
  expectedOwnerUid: bigint,
  label: string,
): Promise<Uint8Array> {
  let handle: FileHandle | undefined;
  let bytes: Uint8Array | undefined;
  let failure: unknown;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true });
    requireArtifactFile(before, reference, label, expectedOwnerUid);
    bytes = await readExact(handle, reference.bytes, label);
    if (blobDigest(bytes) !== reference.digest) artifactCorrupt(`${label} has the wrong digest`);
    const after = await handle.stat({ bigint: true });
    if (!sameStableFile(before, after)) artifactCorrupt(`${label} changed while it was verified`);
    requireArtifactFile(after, reference, label, expectedOwnerUid);
    await requirePathIdentity(path, after, label);
  } catch (error) {
    failure = error;
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch (error) {
        if (bytes !== undefined) bytes.fill(0);
        failure = failure === undefined
          ? new AggregateError([error], "host-extension artifact cleanup did not complete")
          : new AggregateError([failure, error], "host-extension artifact cleanup did not complete");
      }
    }
  }
  if (failure !== undefined) {
    if (bytes !== undefined) bytes.fill(0);
    if (failure instanceof CheckError && failure.code.startsWith("HOST_EXTENSION_ARTIFACT_")) throw failure;
    if (hasCode(failure, "ENOENT") || isResourceError(failure) || failure instanceof AggregateError) {
      throw failure;
    }
    artifactCorrupt(`${label} is not a valid retained host-extension blob: ${errorText(failure)}`);
  }
  if (bytes === undefined) throw new Error("host-extension verification produced no bytes");
  return bytes;
}

function requireArtifactFile(
  information: BigIntStats,
  reference: PrivateHostExtensionBlobRef,
  label: string,
  expectedOwnerUid: bigint,
): void {
  if (!information.isFile()) artifactCorrupt(`${label} is not a regular file`);
  if (information.uid !== expectedOwnerUid) artifactCorrupt(`${label} has the wrong owner`);
  if ((information.mode & 0o222n) !== 0n) artifactCorrupt(`${label} is writable`);
  if (information.size !== BigInt(reference.bytes)) artifactCorrupt(`${label} has the wrong byte size`);
}

async function readExact(handle: FileHandle, size: number, label: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (result.bytesRead === 0) artifactCorrupt(`${label} ended before its declared size`);
    offset += result.bytesRead;
  }
  return bytes;
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (result.bytesWritten === 0) throw new Error("host-extension artifact write made no progress");
    offset += result.bytesWritten;
  }
}

async function requireSameFile(left: string, right: string): Promise<void> {
  const [first, second] = await Promise.all([
    lstat(left, { bigint: true }),
    lstat(right, { bigint: true }),
  ]);
  if (!sameIdentity(first, second) || !first.isFile() || !second.isFile()) {
    unavailable(
      "HOST_EXTENSION_ARTIFACT_PUBLISH_RACE",
      "published host-extension artifact identity changed unexpectedly",
    );
  }
}

async function requirePathIdentity(path: string, opened: BigIntStats, label: string): Promise<void> {
  let observed: BigIntStats;
  try {
    observed = await lstat(path, { bigint: true });
  } catch (error) {
    if (isResourceError(error)) throw error;
    return artifactCorrupt(`${label} pathname disappeared while verified: ${errorText(error)}`);
  }
  if (!observed.isFile() || !sameIdentity(opened, observed)) {
    artifactCorrupt(`${label} pathname identity changed while verified`);
  }
}

function requireProtectedDirectory(
  information: BigIntStats,
  label: string,
  expectedOwnerUid: bigint,
): void {
  if (!information.isDirectory()) invalid("HOST_EXTENSION_ARTIFACT_STORE", `${label} must be a directory`);
  if (information.uid !== expectedOwnerUid) {
    invalid("HOST_EXTENSION_ARTIFACT_STORE_OWNER", `${label} has the wrong owner`);
  }
  if ((information.mode & 0o022n) !== 0n) {
    invalid("HOST_EXTENSION_ARTIFACT_STORE_PERMISSIONS", `${label} must not be writable by group or others`);
  }
}

function descriptorPath(handle: FileHandle): string {
  return `/proc/self/fd/${handle.fd}`;
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFile(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs;
}

function artifactCorrupt(message: string): never {
  unavailable("HOST_EXTENSION_ARTIFACT_CORRUPT", message);
}

function isResourceError(error: unknown): boolean {
  if (["EMFILE", "ENFILE", "ENOMEM", "ENOSPC", "EDQUOT"].some((code) => hasCode(error, code))) {
    return true;
  }
  return error instanceof AggregateError && error.errors.some(isResourceError);
}

async function closeAfterFailure(handle: FileHandle, failure: unknown, message: string): Promise<never> {
  try {
    await handle.close();
  } catch (cleanupFailure) {
    throw new AggregateError([failure, cleanupFailure], message);
  }
  throw failure;
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { readonly code?: unknown }).code === code;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
