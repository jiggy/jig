import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { type FileHandle, lstat, open } from "node:fs/promises";
import { resolve } from "node:path";

import { invalid, unavailable } from "../diagnostics.js";
import { fullCaseFold15_1 } from "../package/paths.js";
import { validateProjectPath } from "./paths.js";

const MAX_SOURCE_BYTES = 1024 * 1024;
const CAPTURE_ATTEMPTS = 3;
const READ_CHUNK_BYTES = 64 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });
const authenticCaptures = new WeakSet<object>();

export interface CapturedAuthorModule {
  readonly projectPath: string;
  readonly sourceBytes: number;
  readonly sourceDigest: string;
  read(): Uint8Array;
  dispose(): void;
}

interface OpenProject {
  readonly requestedPath: string;
  readonly handle: FileHandle;
  readonly information: BigIntStats;
}

interface CapturedAttempt {
  readonly bytes: Uint8Array;
  readonly information: BigIntStats;
}

/** Capture one TypeScript declaration without retaining a live project path. */
export async function captureAuthorModule(
  projectRoot: string,
  projectPath: string,
): Promise<CapturedAuthorModule> {
  validateAuthorPath(projectPath);
  if (process.platform !== "linux") {
    unavailable(
      "PROJECT_EVALUATOR_UNAVAILABLE",
      "the first author-module capture requires Linux descriptor paths",
      projectPath,
    );
  }

  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt += 1) {
    try {
      const project = await openProject(projectRoot);
      return await withOwnedHandle(project.handle, async () => {
        const captured = await captureFile(project.handle, projectPath);
        await verifyProject(project);
        await verifyFile(project.handle, projectPath, captured.information);
        return createCapture(projectPath, captured.bytes);
      }, "project-root descriptor");
    } catch (error) {
      if (isSourceChange(error) && attempt < CAPTURE_ATTEMPTS) continue;
      if (isSourceChange(error)) {
        unavailable(
          "PROJECT_SOURCE_CHANGED",
          `author module kept changing during ${CAPTURE_ATTEMPTS} capture attempts`,
          projectPath,
        );
      }
      throw error;
    }
  }
  throw new Error("unreachable author-module capture state");
}

export function isCapturedAuthorModule(value: unknown): value is CapturedAuthorModule {
  return typeof value === "object" && value !== null && authenticCaptures.has(value);
}

function createCapture(projectPath: string, source: Uint8Array): CapturedAuthorModule {
  const bytes = source.slice();
  let disposed = false;
  const capture = Object.freeze({
    projectPath,
    sourceBytes: bytes.byteLength,
    sourceDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    read(): Uint8Array {
      if (disposed) unavailable("PROJECT_CAPTURE_CLOSED", "author-module capture has been disposed", projectPath);
      return bytes.slice();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      bytes.fill(0);
    },
  });
  authenticCaptures.add(capture);
  return capture;
}

async function openProject(projectRoot: string): Promise<OpenProject> {
  const requestedPath = resolve(projectRoot);
  let observed: BigIntStats;
  try {
    observed = await lstat(requestedPath, { bigint: true });
  } catch (error) {
    unavailable("PROJECT_ROOT_IO", `cannot inspect project root: ${errorText(error)}`, requestedPath);
  }
  if (observed.isSymbolicLink()) invalid("PROJECT_ROOT", "project root must not be a symlink", requestedPath);
  if (!observed.isDirectory()) invalid("PROJECT_ROOT", "project root is not a directory", requestedPath);

  let handle: FileHandle;
  try {
    handle = await open(
      requestedPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    unavailable("PROJECT_ROOT_IO", `cannot open project root: ${errorText(error)}`, requestedPath);
  }
  const information = await statOwned(handle, "project-root descriptor");
  if (!information.isDirectory() || !sameIdentity(observed, information)) {
    await closeHandles([handle], "changed project-root descriptor");
    sourceChanged("project root changed while it was opened", requestedPath);
  }
  return { requestedPath, handle, information };
}

async function captureFile(project: FileHandle, projectPath: string): Promise<CapturedAttempt> {
  const opened = await openProjectFile(project, projectPath, false);
  return await withOwnedHandle(opened.handle, async () => {
    if (opened.information.nlink !== 1n) {
      invalid(
        "PROJECT_EVALUATOR_SOURCE",
        "author modules must be singly linked so source confinement can be proven",
        projectPath,
      );
    }
    const bytes = await readBounded(opened.handle, projectPath);
    try {
      decoder.decode(bytes);
    } catch {
      invalid("PROJECT_EVALUATOR_COMPILE", "author module is not valid UTF-8", projectPath);
    }
    const after = await opened.handle.stat({ bigint: true });
    if (!sameFileState(opened.information, after) || BigInt(bytes.byteLength) !== after.size) {
      sourceChanged("author module changed while it was captured", projectPath);
    }
    return { bytes, information: after };
  }, "author-module descriptor");
}

async function openProjectFile(
  project: FileHandle,
  projectPath: string,
  missingIsChange: boolean,
): Promise<{ readonly handle: FileHandle; readonly information: BigIntStats }> {
  const segments = projectPath.split("/");
  let parent = project;
  const ancestors: FileHandle[] = [];
  let result: { readonly handle: FileHandle; readonly information: BigIntStats } | undefined;
  try {
    for (let index = 0; index < segments.length - 1; index += 1) {
      const logicalPath = segments.slice(0, index + 1).join("/");
      const child = await openEntry(parent, segments[index]!, logicalPath, true, missingIsChange);
      ancestors.push(child.handle);
      parent = child.handle;
    }
    result = await openEntry(parent, segments.at(-1)!, projectPath, false, missingIsChange);
  } catch (error) {
    await closeAfterFailure(ancestors, error, "author-module ancestor descriptors");
  }
  try {
    await closeHandles(ancestors, "author-module ancestor descriptors");
  } catch (error) {
    await closeAfterFailure(result === undefined ? [] : [result.handle], error, "author-module descriptor");
  }
  return result!;
}

async function openEntry(
  parent: FileHandle,
  name: string,
  logicalPath: string,
  directory: boolean,
  missingIsChange: boolean,
): Promise<{ readonly handle: FileHandle; readonly information: BigIntStats }> {
  const descriptorPath = `/proc/self/fd/${parent.fd}/${name}`;
  let observed: BigIntStats;
  try {
    observed = await lstat(descriptorPath, { bigint: true });
  } catch (error) {
    if (isEntryRace(error)) {
      if (missingIsChange) sourceChanged("author module path changed before it was reopened", logicalPath);
      invalid("PROJECT_EVALUATOR_SOURCE", "author module path is missing", logicalPath);
    }
    unavailable("PROJECT_SOURCE_IO", `cannot inspect author module path: ${errorText(error)}`, logicalPath);
  }
  if (observed.isSymbolicLink()) {
    invalid("PROJECT_SOURCE_SYMLINK", "author module paths cannot contain symlinks", logicalPath);
  }
  if (directory ? !observed.isDirectory() : !observed.isFile()) {
    invalid(
      "PROJECT_EVALUATOR_SOURCE",
      directory ? "author module parent is not a directory" : "author module is not a regular file",
      logicalPath,
    );
  }

  let handle: FileHandle;
  try {
    handle = await open(
      descriptorPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK |
        (directory ? constants.O_DIRECTORY : 0),
    );
  } catch (error) {
    if (isEntryRace(error)) sourceChanged("author module path changed while it was opened", logicalPath);
    unavailable("PROJECT_SOURCE_IO", `cannot open author module path: ${errorText(error)}`, logicalPath);
  }
  const information = await statOwned(handle, "author-module descriptor");
  if (!sameIdentity(observed, information) ||
      (directory ? !information.isDirectory() : !information.isFile())) {
    await closeHandles([handle], "changed author-module descriptor");
    sourceChanged("author module path changed while it was opened", logicalPath);
  }
  return { handle, information };
}

async function readBounded(file: FileHandle, projectPath: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const buffer = new Uint8Array(Math.min(READ_CHUNK_BYTES, MAX_SOURCE_BYTES + 1 - total));
    const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, total);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > MAX_SOURCE_BYTES) {
      invalid(
        "PROJECT_EVALUATION_LIMIT",
        `author module exceeds ${MAX_SOURCE_BYTES} bytes`,
        projectPath,
      );
    }
    chunks.push(buffer.subarray(0, bytesRead));
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function verifyProject(project: OpenProject): Promise<void> {
  let current: BigIntStats;
  try {
    current = await lstat(project.requestedPath, { bigint: true });
  } catch {
    sourceChanged("project root disappeared during author-module capture", project.requestedPath);
  }
  if (!current.isDirectory() || !sameIdentity(project.information, current)) {
    sourceChanged("project root changed during author-module capture", project.requestedPath);
  }
}

async function verifyFile(
  project: FileHandle,
  projectPath: string,
  expected: BigIntStats,
): Promise<void> {
  const current = await openProjectFile(project, projectPath, true);
  await withOwnedHandle(current.handle, async () => {
    if (!sameFileState(expected, current.information)) {
      sourceChanged("author module changed before capture completed", projectPath);
    }
  }, "verified author-module descriptor");
}

async function withOwnedHandle<T>(
  handle: FileHandle,
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
  let result: T | undefined;
  let failure: unknown;
  let failed = false;
  try {
    result = await operation();
  } catch (error) {
    failure = error;
    failed = true;
  }
  try {
    await closeHandles([handle], label);
  } catch (cleanup) {
    if (failed) {
      throw new AggregateError([failure, cleanup], `${label} operation and cleanup failed`);
    }
    throw cleanup;
  }
  if (failed) throw failure;
  return result!;
}

async function statOwned(handle: FileHandle, label: string): Promise<BigIntStats> {
  try {
    return await handle.stat({ bigint: true });
  } catch (error) {
    return await closeAfterFailure([handle], error, label);
  }
}

async function closeHandles(handles: readonly FileHandle[], label: string): Promise<void> {
  const failures: unknown[] = [];
  for (const handle of [...handles].reverse()) {
    try {
      await handle.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `cannot close ${label}`);
  }
}

async function closeAfterFailure(
  handles: readonly FileHandle[],
  primary: unknown,
  label: string,
): Promise<never> {
  try {
    await closeHandles(handles, label);
  } catch (cleanup) {
    throw new AggregateError([primary, cleanup], `${label} operation and cleanup failed`);
  }
  throw primary;
}

function validateAuthorPath(projectPath: string): void {
  try {
    validateProjectPath(projectPath, "author module path");
  } catch (error) {
    invalid("PROJECT_EVALUATOR_SOURCE", errorText(error), projectPath);
  }
  if (fullCaseFold15_1(projectPath.split("/", 1)[0]!) === ".jig") {
    invalid("PROJECT_SOURCE_PROTECTED", "author module cannot use protected .jig state", projectPath);
  }
  if (!projectPath.endsWith(".ts") || projectPath.endsWith(".d.ts")) {
    invalid("PROJECT_EVALUATOR_SOURCE", "author module must have an exact .ts suffix", projectPath);
  }
}

function sameIdentity(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileState(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right) && left.nlink === right.nlink && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.mode === right.mode;
}

function sourceChanged(message: string, path: string): never {
  invalid("PROJECT_SOURCE_CHANGED", message, path);
}

function isSourceChange(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    String(error.code) === "PROJECT_SOURCE_CHANGED";
}

function isEntryRace(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    ["ENOENT", "ELOOP", "ENOTDIR", "EISDIR"].includes(String(error.code));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
