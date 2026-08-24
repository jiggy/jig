import { constants, type BigIntStats } from "node:fs";
import { type FileHandle, lstat, open, opendir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { CheckError, invalid, unavailable } from "../diagnostics.js";
import { packageDigest } from "./digest.js";
import { assertNoPathCollisions, comparePathBytes, validateLogicalPath } from "./paths.js";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const MAX_FILES = 65_536;
const MAX_FILE_BYTES = 1_073_741_824;
const MAX_TOTAL_BYTES = 4_294_967_296;
const COPY_CHUNK_BYTES = 1024 * 1024;
const CAPTURE_ATTEMPTS = 3;
const MAX_DIRECTORIES = 65_536;
const MAX_DIRECTORY_NAME_BYTES = 16 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 262_144;
// Linux O_TMPFILE is __O_TMPFILE | O_DIRECTORY; Node does not expose it.
const O_TMPFILE = 0o20000000 | constants.O_DIRECTORY;

export interface CapturedFile {
  readonly path: string;
  readonly size: number;
}

export interface CapturedPackage {
  readonly sourceRoot: string;
  readonly files: readonly CapturedFile[];
  readonly digest: string;
  read(path: string, maximumBytes?: number): Promise<Uint8Array>;
  readPrefix(path: string, maximumBytes: number): Promise<Uint8Array>;
  stream(path: string, maximumBytes?: number): AsyncIterable<Uint8Array>;
  dispose(): Promise<void>;
}

interface CapturedRecord extends CapturedFile {
  readonly offset: number;
}

interface SourceFingerprint {
  readonly path: string;
  readonly device: bigint;
  readonly inode: bigint;
  readonly links: bigint;
  readonly size: bigint;
  readonly modifiedNs: bigint;
  readonly changedNs: bigint;
}

interface OpenRoot {
  readonly requestedPath: string;
  readonly handle: FileHandle;
  readonly information: BigIntStats;
}

/** Capture one mutable Linux directory into one unnamed read-only snapshot. */
export async function capturePackageDirectory(source: string): Promise<CapturedPackage> {
  if (process.platform !== "linux") {
    unavailable(
      "PACKAGE_CAPTURE_UNAVAILABLE",
      "the first filesystem source adapter requires Linux descriptor paths and O_TMPFILE",
    );
  }

  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt += 1) {
    let root: OpenRoot | undefined;
    let backing: FileHandle | undefined;
    try {
      root = await openDirectoryRoot(source);
      backing = await openAnonymousBacking();
      const { records, fingerprints } = await captureAttempt(root, backing);
      let verification: SourceFingerprint[];
      try {
        verification = await fingerprintTree(root);
      } catch (error) {
        if (isVerificationMutation(error)) {
          sourceChanged("package source changed before verification completed", root.requestedPath);
        }
        throw error;
      }
      await verifyRootPath(root);
      if (!sameFingerprints(fingerprints, verification)) {
        sourceChanged("package source changed between capture and verification", root.requestedPath);
      }

      records.sort((left, right) => comparePathBytes(left.path, right.path));
      const snapshot = await sealSnapshot(backing, records);
      backing = undefined;
      try {
        const files = Object.freeze(records.map(({ path, size }) => Object.freeze({ path, size })));
        const digest = await packageDigest(files, (file) => snapshot.stream(file.path));
        return createCapturedPackage(root.requestedPath, files, digest, snapshot);
      } catch (error) {
        await snapshot.dispose();
        throw error;
      }
    } catch (error) {
      await backing?.close().catch(() => undefined);
      if (isResourceError(error)) {
        resourceExhausted(error, "cannot capture package source", resolve(source));
      }
      if (isSourceChange(error) && attempt < CAPTURE_ATTEMPTS) continue;
      if (isSourceChange(error)) {
        unavailable(
          "PACKAGE_SOURCE_CHANGED",
          `package source kept changing during ${CAPTURE_ATTEMPTS} capture attempts`,
          resolve(source),
        );
      }
      throw error;
    } finally {
      await root?.handle.close().catch(() => undefined);
    }
  }
  throw new Error("unreachable package capture attempt state");
}

function createCapturedPackage(
  sourceRoot: string,
  files: readonly CapturedFile[],
  digest: string,
  snapshot: AnonymousSnapshot,
): CapturedPackage {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return Object.freeze({
    sourceRoot,
    files,
    digest,
    async read(path: string, maximumBytes = MAX_FILE_BYTES): Promise<Uint8Array> {
      const file = requireCapturedFile(byPath, path);
      validateReadLimit(maximumBytes);
      if (file.size > maximumBytes) {
        invalid("PACKAGE_FILE_LIMIT", `${path} exceeds its ${maximumBytes}-byte read limit`, path);
      }
      const bytes = new Uint8Array(file.size);
      let offset = 0;
      for await (const chunk of snapshot.stream(path, file.size)) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (offset !== file.size) invalid("PACKAGE_STAGE_CHANGED", `captured file ${path} became short`, path);
      return bytes;
    },
    async readPrefix(path: string, maximumBytes: number): Promise<Uint8Array> {
      const file = requireCapturedFile(byPath, path);
      validateReadLimit(maximumBytes);
      const size = Math.min(file.size, maximumBytes);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for await (const chunk of snapshot.stream(path, size)) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (offset !== size) invalid("PACKAGE_STAGE_CHANGED", `captured file ${path} became short`, path);
      return bytes;
    },
    stream(path: string, maximumBytes = MAX_FILE_BYTES): AsyncIterable<Uint8Array> {
      const file = requireCapturedFile(byPath, path);
      validateReadLimit(maximumBytes);
      if (file.size > maximumBytes) {
        invalid("PACKAGE_FILE_LIMIT", `${path} exceeds its ${maximumBytes}-byte read limit`, path);
      }
      return snapshot.stream(path, file.size);
    },
    async dispose(): Promise<void> {
      await snapshot.dispose();
    },
  });
}

function requireCapturedFile(
  files: ReadonlyMap<string, CapturedFile>,
  path: string,
): CapturedFile {
  const file = files.get(path);
  if (file === undefined) invalid("PACKAGE_FILE_MISSING", `package has no ${path}`, path);
  return file;
}

function validateReadLimit(maximumBytes: number): void {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new RangeError("maximumBytes must be a non-negative safe integer");
  }
}

async function openDirectoryRoot(source: string): Promise<OpenRoot> {
  const requestedPath = resolve(source);
  let observed: BigIntStats;
  try {
    observed = await lstat(requestedPath, { bigint: true });
  } catch (error) {
    if (isResourceError(error)) resourceExhausted(error, "cannot inspect package directory", requestedPath);
    unavailable("PACKAGE_SOURCE_IO", `cannot inspect package directory: ${errorText(error)}`, requestedPath);
  }
  if (observed.isSymbolicLink()) invalid("PACKAGE_ROOT", "package source root must not be a symlink", requestedPath);
  if (!observed.isDirectory()) invalid("PACKAGE_ROOT", "package source is not a directory", requestedPath);

  let handle: FileHandle;
  try {
    handle = await open(
      requestedPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (isResourceError(error)) resourceExhausted(error, "cannot open package directory", requestedPath);
    if (isEntryRace(error)) sourceChanged("package source root changed while it was opened", requestedPath);
    unavailable("PACKAGE_SOURCE_IO", `cannot open package directory: ${errorText(error)}`, requestedPath);
  }
  try {
    const actual = await handle.stat({ bigint: true });
    if (!actual.isDirectory() || !sameIdentity(observed, actual)) {
      sourceChanged("package source root changed while it was opened", requestedPath);
    }
    return { requestedPath, handle, information: actual };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function verifyRootPath(root: OpenRoot): Promise<void> {
  let current: BigIntStats;
  try {
    current = await lstat(root.requestedPath, { bigint: true });
  } catch (error) {
    if (isResourceError(error)) resourceExhausted(error, "cannot verify package directory", root.requestedPath);
    sourceChanged("package source root disappeared during capture", root.requestedPath);
  }
  if (!current.isDirectory() || !sameIdentity(root.information, current)) {
    sourceChanged("package source root changed during capture", root.requestedPath);
  }
}

async function openAnonymousBacking(): Promise<FileHandle> {
  try {
    return await open(tmpdir(), constants.O_RDWR | O_TMPFILE, 0o600);
  } catch (error) {
    if (isResourceError(error)) resourceExhausted(error, "cannot create the package snapshot");
    unavailable(
      "PACKAGE_CAPTURE_UNAVAILABLE",
      `cannot create an unnamed package snapshot: ${errorText(error)}`,
    );
  }
}

async function rejectKnownOversizeFile(
  handle: FileHandle,
  information: BigIntStats,
  logicalPath: string,
): Promise<void> {
  if (information.size <= BigInt(MAX_FILE_BYTES)) return;
  const probe = new Uint8Array(1);
  try {
    const { bytesRead } = await handle.read(probe, 0, 1, MAX_FILE_BYTES);
    if (bytesRead !== 0) invalid("PACKAGE_LIMIT", `file exceeds ${MAX_FILE_BYTES} bytes`, logicalPath);
  } catch (error) {
    if (error instanceof CheckError) throw error;
    if (isResourceError(error)) resourceExhausted(error, "cannot probe package source file", logicalPath);
    unavailable(
      "PACKAGE_SOURCE_UNSUPPORTED",
      `source reports an oversized regular file but cannot prove its content extent: ${errorText(error)}`,
      logicalPath,
    );
  }
}

async function captureAttempt(
  root: OpenRoot,
  backing: FileHandle,
): Promise<{ records: CapturedRecord[]; fingerprints: SourceFingerprint[] }> {
  const records: CapturedRecord[] = [];
  const fingerprints: SourceFingerprint[] = [];
  const hardlinks = new Map<string, { expected: bigint; observed: number; firstPath: string }>();
  const directories = new Set<string>([identityKey(root.information)]);
  let totalBytes = 0;
  let directoryCount = 0;

  async function walk(
    directory: FileHandle,
    logicalDirectory: string,
  ): Promise<void> {
    directoryCount += 1;
    if (directoryCount > MAX_DIRECTORIES) {
      unavailable("PACKAGE_RESOURCE_EXHAUSTED", `source exceeds ${MAX_DIRECTORIES} directories`);
    }
    for await (const name of readDirectoryNames(directory)) {
      const logicalPath = validateLogicalPath(
        logicalDirectory.length === 0 ? name : `${logicalDirectory}/${name}`,
      );
      const entry = await openDirectoryEntry(directory, name, logicalPath);
      try {
        if (entry.information.isDirectory()) {
          const key = identityKey(entry.information);
          if (directories.has(key)) directoryAliasUnavailable(logicalPath);
          directories.add(key);
          await walk(entry.handle, logicalPath);
          continue;
        }

        if (records.length >= MAX_FILES) invalid("PACKAGE_LIMIT", `package exceeds ${MAX_FILES} files`, logicalPath);
        await rejectKnownOversizeFile(entry.handle, entry.information, logicalPath);
        const offset = totalBytes;
        const size = await copyToBacking(entry.handle, backing, offset, totalBytes, logicalPath);
        totalBytes += size;
        const after = await entry.handle.stat({ bigint: true });
        if (!sameStat(entry.information, after)) sourceChanged("source file changed during capture", logicalPath);
        fingerprints.push(fingerprint(logicalPath, after));
        records.push({ path: logicalPath, size, offset });
        noteHardlink(hardlinks, logicalPath, after);
      } finally {
        await entry.handle.close();
      }
    }
  }

  await walk(root.handle, "");
  assertNoPathCollisions(records.map((record) => record.path));
  for (const value of hardlinks.values()) {
    if (BigInt(value.observed) !== value.expected) {
      invalid(
        "PACKAGE_HARDLINK",
        `cannot prove every hardlink alias for ${value.firstPath} is inside the selected tree`,
        value.firstPath,
      );
    }
  }
  return { records, fingerprints };
}

async function copyToBacking(
  source: FileHandle,
  backing: FileHandle,
  backingOffset: number,
  priorTotal: number,
  logicalPath: string,
): Promise<number> {
  let sourceOffset = 0;
  while (true) {
    const buffer = new Uint8Array(COPY_CHUNK_BYTES);
    let bytesRead: number;
    try {
      ({ bytesRead } = await source.read(buffer, 0, buffer.byteLength, sourceOffset));
    } catch (error) {
      throwFilesystemFailure(error, "cannot read package source file", logicalPath);
    }
    if (bytesRead === 0) return sourceOffset;
    if (sourceOffset + bytesRead > MAX_FILE_BYTES) {
      invalid("PACKAGE_LIMIT", `file exceeds ${MAX_FILE_BYTES} bytes`, logicalPath);
    }
    if (priorTotal + sourceOffset + bytesRead > MAX_TOTAL_BYTES) {
      invalid("PACKAGE_LIMIT", `package exceeds ${MAX_TOTAL_BYTES} bytes`, logicalPath);
    }
    let written = 0;
    while (written < bytesRead) {
      let result: { bytesWritten: number };
      try {
        result = await backing.write(
          buffer,
          written,
          bytesRead - written,
          backingOffset + sourceOffset + written,
        );
      } catch (error) {
        throwFilesystemFailure(error, "cannot extend the package snapshot", logicalPath);
      }
      if (result.bytesWritten === 0) unavailable("PACKAGE_CAPTURE_IO", "package snapshot write made no progress");
      written += result.bytesWritten;
    }
    sourceOffset += bytesRead;
  }
}

async function fingerprintTree(root: OpenRoot): Promise<SourceFingerprint[]> {
  const result: SourceFingerprint[] = [];
  const directories = new Set<string>([identityKey(root.information)]);
  let directoryCount = 0;
  async function walk(
    directory: FileHandle,
    logicalDirectory: string,
  ): Promise<void> {
    directoryCount += 1;
    if (directoryCount > MAX_DIRECTORIES) {
      unavailable("PACKAGE_RESOURCE_EXHAUSTED", `source exceeds ${MAX_DIRECTORIES} directories`);
    }
    for await (const name of readDirectoryNames(directory)) {
      const logicalPath = validateLogicalPath(
        logicalDirectory.length === 0 ? name : `${logicalDirectory}/${name}`,
      );
      const entry = await openDirectoryEntry(directory, name, logicalPath);
      try {
        if (entry.information.isDirectory()) {
          const key = identityKey(entry.information);
          if (directories.has(key)) sourceChanged("directory alias appeared during verification", logicalPath);
          directories.add(key);
          await walk(entry.handle, logicalPath);
        } else {
          result.push(fingerprint(logicalPath, entry.information));
        }
      } finally {
        await entry.handle.close();
      }
    }
  }
  await walk(root.handle, "");
  result.sort((left, right) => comparePathBytes(left.path, right.path));
  return result;
}

async function* readDirectoryNames(directory: FileHandle): AsyncIterable<string> {
  let stream: RawDirectory;
  try {
    const openRawDirectory = opendir as unknown as (
      path: string,
      options: { readonly encoding: "buffer" },
    ) => Promise<RawDirectory>;
    stream = await openRawDirectory(`/proc/self/fd/${directory.fd}`, { encoding: "buffer" });
  } catch (error) {
    if (isResourceError(error)) resourceExhausted(error, "cannot open package directory enumeration");
    sourceChanged(`cannot enumerate package directory: ${errorText(error)}`);
  }
  let count = 0;
  let nameBytes = 0;
  try {
    while (true) {
      let entry: unknown;
      try {
        entry = await stream.read();
      } catch (error) {
        if (isResourceError(error)) resourceExhausted(error, "cannot enumerate package directory");
        sourceChanged(`cannot enumerate package directory: ${errorText(error)}`);
      }
      if (entry === null) return;
      const rawName = directoryEntryName(entry);
      count += 1;
      nameBytes += rawName.byteLength;
      if (count > MAX_DIRECTORY_ENTRIES) {
        unavailable(
          "PACKAGE_RESOURCE_EXHAUSTED",
          `one source directory exceeds the ${MAX_DIRECTORY_ENTRIES}-entry enumeration budget`,
        );
      }
      if (nameBytes > MAX_DIRECTORY_NAME_BYTES) {
        unavailable(
          "PACKAGE_RESOURCE_EXHAUSTED",
          `one source directory exceeds the ${MAX_DIRECTORY_NAME_BYTES}-byte name budget`,
        );
      }
      try {
        yield decoder.decode(rawName);
      } catch {
        invalid("PACKAGE_PATH_UTF8", "source path is not valid UTF-8");
      }
    }
  } finally {
    try {
      await stream.close();
    } catch (error) {
      if (!isDirectoryAlreadyClosed(error)) throw error;
    }
  }
}

interface RawDirectory {
  read(): Promise<unknown | null>;
  close(): Promise<void>;
}

function directoryEntryName(entry: unknown): Uint8Array {
  // Bun 1.3 returns the byte name itself for encoding:"buffer"; Node returns
  // a Dirent whose name is a Buffer. Supporting both keeps enumeration raw
  // and incremental without making decoded replacement characters ambiguous.
  if (entry instanceof Uint8Array) return entry;
  if (typeof entry === "object" && entry !== null && "name" in entry) {
    const name = (entry as { readonly name: unknown }).name;
    if (name instanceof Uint8Array) return name;
  }
  unavailable("PACKAGE_CAPTURE_UNAVAILABLE", "runtime cannot enumerate raw directory-entry names incrementally");
}

async function openDirectoryEntry(
  directory: FileHandle,
  name: string,
  logicalPath: string,
): Promise<{ handle: FileHandle; information: BigIntStats }> {
  const descriptorPath = `/proc/self/fd/${directory.fd}/${name}`;
  let observed: BigIntStats;
  try {
    observed = await lstat(descriptorPath, { bigint: true });
  } catch (error) {
    if (isResourceError(error)) resourceExhausted(error, "cannot inspect package entry", logicalPath);
    sourceChanged(`package entry changed before inspection: ${errorText(error)}`, logicalPath);
  }
  if (observed.isSymbolicLink()) invalid("PACKAGE_SYMLINK", "symlinks are not package files", logicalPath);
  if (!observed.isDirectory() && !observed.isFile()) {
    invalid("PACKAGE_SPECIAL_FILE", "special files are invalid", logicalPath);
  }

  const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK |
    (observed.isDirectory() ? constants.O_DIRECTORY : 0);
  let handle: FileHandle;
  try {
    handle = await open(descriptorPath, flags);
  } catch (error) {
    if (isResourceError(error)) resourceExhausted(error, "cannot open package entry", logicalPath);
    if (isEntryRace(error)) sourceChanged("package entry changed while it was opened", logicalPath);
    unavailable("PACKAGE_SOURCE_IO", `cannot open package entry: ${errorText(error)}`, logicalPath);
  }
  try {
    const actual = await handle.stat({ bigint: true });
    if (!sameIdentity(observed, actual) ||
        (observed.isDirectory() && !actual.isDirectory()) ||
        (observed.isFile() && !actual.isFile())) {
      sourceChanged("package entry changed while it was opened", logicalPath);
    }
    return { handle, information: actual };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

interface AnonymousSnapshot {
  stream(path: string, maximumBytes?: number): AsyncIterable<Uint8Array>;
  dispose(): Promise<void>;
}

async function sealSnapshot(
  writable: FileHandle,
  records: readonly CapturedRecord[],
): Promise<AnonymousSnapshot> {
  const expectedSize = records.reduce((total, record) => total + record.size, 0);
  let readonly: FileHandle | undefined;
  try {
    const byPath = new Map(records.map((record) => [record.path, record]));
    const before = await writable.stat({ bigint: true });
    if (!before.isFile() || before.size !== BigInt(expectedSize)) {
      invalid("PACKAGE_STAGE_CHANGED", "package snapshot size changed before sealing");
    }
    await writable.chmod(0o400);
    readonly = await open(`/proc/self/fd/${writable.fd}`, constants.O_RDONLY);
    const after = await readonly.stat({ bigint: true });
    if (!sameIdentity(before, after) || after.size !== BigInt(expectedSize)) {
      invalid("PACKAGE_STAGE_CHANGED", "package snapshot identity changed while sealing");
    }
    await writable.close();

    let disposed = false;
    return {
      stream(path: string, maximumBytes = Number.MAX_SAFE_INTEGER): AsyncIterable<Uint8Array> {
        if (disposed) unavailable("PACKAGE_SNAPSHOT_CLOSED", "package snapshot has been disposed", path);
        const record = byPath.get(path);
        if (record === undefined) invalid("PACKAGE_FILE_MISSING", `package has no ${path}`, path);
        return readRange(readonly!, record.offset, Math.min(record.size, maximumBytes), path);
      },
      async dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        await readonly!.close().catch(() => undefined);
        byPath.clear();
      },
    };
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
  let position = 0;
  while (position < size) {
    const length = Math.min(COPY_CHUNK_BYTES, size - position);
    const buffer = new Uint8Array(length);
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(buffer, 0, length, offset + position));
    } catch (error) {
      throwFilesystemFailure(error, "cannot read package snapshot", path);
    }
    if (bytesRead === 0) invalid("PACKAGE_STAGE_CHANGED", `captured file ${path} became short`, path);
    position += bytesRead;
    yield bytesRead === buffer.byteLength ? buffer : buffer.slice(0, bytesRead);
  }
}

function noteHardlink(
  hardlinks: Map<string, { expected: bigint; observed: number; firstPath: string }>,
  logicalPath: string,
  information: BigIntStats,
): void {
  if (information.nlink <= 1n) return;
  const key = identityKey(information);
  const prior = hardlinks.get(key);
  if (prior === undefined) {
    hardlinks.set(key, { expected: information.nlink, observed: 1, firstPath: logicalPath });
  } else {
    prior.observed += 1;
    if (prior.expected !== information.nlink) sourceChanged("hardlink count changed during capture", logicalPath);
  }
}

function fingerprint(path: string, information: BigIntStats): SourceFingerprint {
  return {
    path,
    device: information.dev,
    inode: information.ino,
    links: information.nlink,
    size: information.size,
    modifiedNs: information.mtimeNs,
    changedNs: information.ctimeNs,
  };
}

function sameFingerprints(left: readonly SourceFingerprint[], right: readonly SourceFingerprint[]): boolean {
  if (left.length !== right.length) return false;
  const sorted = left.slice().sort((a, b) => comparePathBytes(a.path, b.path));
  return sorted.every((item, index) => {
    const other = right[index];
    return other !== undefined &&
      item.path === other.path &&
      item.device === other.device &&
      item.inode === other.inode &&
      item.links === other.links &&
      item.size === other.size &&
      item.modifiedNs === other.modifiedNs &&
      item.changedNs === other.changedNs;
  });
}

function identityKey(value: { dev: bigint; ino: bigint }): string {
  return `${value.dev}:${value.ino}`;
}

function sameIdentity(left: { dev: bigint; ino: bigint }, right: { dev: bigint; ino: bigint }): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStat(
  left: { dev: bigint; ino: bigint; nlink: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint },
  right: { dev: bigint; ino: bigint; nlink: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint },
): boolean {
  return sameIdentity(left, right) && left.nlink === right.nlink && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function sourceChanged(message: string, path?: string): never {
  invalid("PACKAGE_SOURCE_CHANGED", message, path);
}

function directoryAliasUnavailable(path: string): never {
  unavailable(
    "PACKAGE_SOURCE_TOPOLOGY_UNSUPPORTED",
    "filesystem source adapter cannot prove a repeated directory identity as one logical tree",
    path,
  );
}

function throwFilesystemFailure(error: unknown, operation: string, path?: string): never {
  if (isResourceError(error)) resourceExhausted(error, operation, path);
  unavailable("PACKAGE_SOURCE_IO", `${operation}: ${errorText(error)}`, path);
}

function resourceExhausted(error: unknown, operation: string, path?: string): never {
  unavailable("PACKAGE_RESOURCE_EXHAUSTED", `${operation}: ${errorText(error)}`, path);
}

function isSourceChange(error: unknown): error is CheckError {
  return error instanceof CheckError && error.code === "PACKAGE_SOURCE_CHANGED";
}

function isVerificationMutation(error: unknown): error is CheckError {
  return error instanceof CheckError && (
    error.code.startsWith("PACKAGE_PATH") ||
    error.code === "PACKAGE_SYMLINK" ||
    error.code === "PACKAGE_SPECIAL_FILE"
  );
}

function isEntryRace(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return ["ENOENT", "ELOOP", "ENOTDIR", "EISDIR"].includes(String(error.code));
}

function isResourceError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return ["EDQUOT", "EFBIG", "EMFILE", "ENFILE", "ENOMEM", "ENOSPC"].includes(String(error.code));
}

function isDirectoryAlreadyClosed(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    String(error.code) === "ERR_DIR_CLOSED";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
