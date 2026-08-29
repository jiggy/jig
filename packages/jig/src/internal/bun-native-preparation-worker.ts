import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  opendir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson, decodeJson1, type JsonObject, type JsonValue } from "../json.js";
import {
  assertNoPathCollisions,
  comparePathBytes,
  validateLogicalPath,
} from "../package/paths.js";

const KIND = "private-bun-native-prepared-candidate/1";
const PACKAGE_NAME = "@flowmd/sdk";
const PACKAGE_VERSION = "0.0.0";
const WORK_ROOT = "/work";
const PROJECT_ROOT = "/work/project";
const CACHE_ROOT = "/work/cache";
const NODE_MODULES_ROOT = "/work/project/node_modules";
const SCOPE_ROOT = "/work/project/node_modules/@flowmd";
const INSTALLED_ROOT = "/work/project/node_modules/@flowmd/sdk";
const ARCHIVE_PREFIX = "/package/";
const ARCHIVE_MEMBER = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*\.tgz$/;
const BUN_WORKER_POLICY = Object.freeze([
  "--no-env-file",
  "--no-install",
  "--config=/dev/null",
] as const);
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
const MAX_FILES = 256;
const MAX_DIRECTORIES = 256;
const MAX_DECODED_BYTES = 1024 * 1024;

// This source reuses private Jig helpers. Host build/installation must produce
// and authenticate one immutable bundle; the preparation plan mounts only
// that exact bundle. The Backend launches it without compiling or exposing
// this source tree at activation.

interface CandidateFile {
  readonly path: string;
  readonly contentBase64: string;
}

try {
  await main();
} catch (error) {
  await writeStream(process.stderr, `Bun native preparation worker failed: ${boundedMessage(error)}\n`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const archivePath = requireStartupPosture();
  await requireEmptyWorkRoot();
  await mkdir(PROJECT_ROOT, { mode: 0o700 });
  await mkdir(CACHE_ROOT, { mode: 0o700 });

  const dependencyDigest = await digestArchive(archivePath);
  const projectManifest = canonicalJson({
    private: true,
    type: "module",
    dependencies: { [PACKAGE_NAME]: `file:${archivePath}` },
  });
  await writeFile(
    join(PROJECT_ROOT, "package.json"),
    projectManifest,
    { mode: 0o600 },
  );
  await install();
  await requireExactInstallTree(projectManifest);
  await requireInstalledManifest();

  const files = await captureInstalledFiles();
  const candidate = {
    kind: KIND,
    dependencyDigest,
    files,
  } as unknown as JsonValue;
  await writeStream(process.stdout, canonicalJson(candidate));
}

function requireStartupPosture(): string {
  if (process.cwd() !== WORK_ROOT) {
    throw new Error(`worker requires fixed cwd ${WORK_ROOT}`);
  }
  const environmentKeys = Object.keys(process.env).sort();
  if (environmentKeys.length !== 1 || environmentKeys[0] !== "PWD" || process.env.PWD !== WORK_ROOT) {
    throw new Error("worker requires only the Backend-synthesized PWD=/work environment");
  }
  if (process.execArgv.length !== BUN_WORKER_POLICY.length ||
      process.execArgv.some((value, index) => value !== BUN_WORKER_POLICY[index])) {
    throw new Error("worker requires the fixed Bun execution policy");
  }
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 2 || arguments_[0] !== "--archive" ||
      typeof arguments_[1] !== "string" || !arguments_[1].startsWith(ARCHIVE_PREFIX)) {
    throw new Error("worker requires one fixed package archive argument");
  }
  const member = validateLogicalPath(arguments_[1].slice(ARCHIVE_PREFIX.length));
  if (!ARCHIVE_MEMBER.test(member)) {
    throw new Error("worker package archive argument is not a portable .tgz member");
  }
  return `${ARCHIVE_PREFIX}${member}`;
}

async function requireEmptyWorkRoot(): Promise<void> {
  const directory = await opendir(WORK_ROOT, { bufferSize: 1 });
  try {
    if (await directory.read() !== null) throw new Error(`${WORK_ROOT} must begin empty`);
  } finally {
    await directory.close();
  }
}

async function digestArchive(path: string): Promise<string> {
  const bytes = await readStableRegularFile(
    path,
    MAX_DECODED_BYTES,
    "worker package archive",
  );
  const hash = createHash("sha256");
  hash.update(bytes);
  return `sha256:${hash.digest("hex")}`;
}

async function install(): Promise<void> {
  const result = await runBun([
    "--no-env-file",
    "install",
    "--production",
    "--no-save",
    "--ignore-scripts",
    "--no-cache",
    `--cache-dir=${CACHE_ROOT}`,
    "--config=/dev/null",
    "--no-progress",
    "--no-summary",
    "--network-concurrency=1",
    "--backend=copyfile",
    `--cwd=${PROJECT_ROOT}`,
  ], PROJECT_ROOT);
  if (result.code !== 0) {
    throw new Error(
      `fixed Bun install exited ${result.code ?? result.signal}: ${childDiagnostic(result)}`,
    );
  }
}

async function requireExactInstallTree(expectedProjectManifest: Uint8Array): Promise<void> {
  await requireExactDirectoryEntries(
    PROJECT_ROOT,
    ["node_modules", "package.json"],
    "worker project root",
  );
  await requireExactDirectoryEntries(
    NODE_MODULES_ROOT,
    ["@flowmd"],
    "worker node_modules root",
  );
  await requireExactDirectoryEntries(
    SCOPE_ROOT,
    ["sdk"],
    "worker @flowmd scope root",
  );
  await requireDirectory(INSTALLED_ROOT, "installed @flowmd/sdk root");
  const projectManifest = await readStableRegularFile(
    join(PROJECT_ROOT, "package.json"),
    64 * 1024,
    "worker project package.json",
  );
  if (!Buffer.from(projectManifest).equals(Buffer.from(expectedProjectManifest))) {
    throw new Error("worker project package.json changed during fixed installation");
  }
}

async function requireExactDirectoryEntries(
  path: string,
  expected: readonly string[],
  label: string,
): Promise<void> {
  await requireDirectory(path, label);
  const actual = await readBoundedDirectoryNames(path, expected.length + 1, label);
  actual.sort((left, right) => comparePathBytes(left, right));
  const sortedExpected = [...expected].sort((left, right) => comparePathBytes(left, right));
  if (actual.length !== sortedExpected.length ||
      actual.some((name, index) => name !== sortedExpected[index])) {
    throw new Error(`${label} does not have its exact admitted entries`);
  }
}

async function requireDirectory(path: string, label: string): Promise<void> {
  const information = await lstat(path);
  if (!information.isDirectory() || information.isSymbolicLink()) {
    throw new Error(`${label} is not one regular directory`);
  }
}

async function readBoundedDirectoryNames(
  path: string,
  maximum: number,
  label: string,
): Promise<string[]> {
  const names: string[] = [];
  const directory = await opendir(path, { bufferSize: 1 });
  try {
    while (true) {
      const entry = await directory.read();
      if (entry === null) break;
      if (names.length >= maximum) {
        throw new Error(`${label} exceeds its directory-entry bound`);
      }
      names.push(entry.name);
    }
  } finally {
    await directory.close();
  }
  return names;
}

async function requireInstalledManifest(): Promise<void> {
  const path = join(INSTALLED_ROOT, "package.json");
  const bytes = await readStableRegularFile(
    path,
    64 * 1024,
    "installed @flowmd/sdk package.json",
  );
  const value = decodeJson1(bytes);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("installed @flowmd/sdk package.json is not an object");
  }
  const manifest = value as JsonObject;
  if (manifest.name !== PACKAGE_NAME || manifest.version !== PACKAGE_VERSION) {
    throw new Error(`installed package is not exact ${PACKAGE_NAME}@${PACKAGE_VERSION}`);
  }
}

async function captureInstalledFiles(): Promise<readonly CandidateFile[]> {
  await requireDirectory(INSTALLED_ROOT, "installed @flowmd/sdk root");
  const capture = {
    bytes: 0,
    directories: 0,
    files: [] as CandidateFile[],
  };
  await visitDirectory(INSTALLED_ROOT, "", capture);
  if (capture.files.length === 0 || capture.files.length > MAX_FILES) {
    throw new Error(`installed @flowmd/sdk must contain 1-${MAX_FILES} regular files`);
  }
  capture.files.sort((left, right) => comparePathBytes(left.path, right.path));
  assertNoPathCollisions(capture.files.map((file) => file.path));
  return Object.freeze(capture.files.map((file) => Object.freeze(file)));
}

async function visitDirectory(
  directory: string,
  relativeDirectory: string,
  capture: {
    bytes: number;
    directories: number;
    files: CandidateFile[];
  },
): Promise<void> {
  const filesBefore = capture.files.length;
  const names = await readBoundedDirectoryNames(
    directory,
    MAX_FILES + MAX_DIRECTORIES + 1,
    "installed @flowmd/sdk tree",
  );
  names.sort((left, right) => comparePathBytes(left, right));
  for (const name of names) {
    const path = join(directory, name);
    const relativePath = validateLogicalPath(
      relativeDirectory.length === 0 ? name : `${relativeDirectory}/${name}`,
    );
    const information = await lstat(path);
    if (information.isSymbolicLink()) {
      throw new Error(`installed @flowmd/sdk contains link ${relativePath}`);
    }
    if (information.isDirectory()) {
      if (name === "node_modules") {
        throw new Error(`installed @flowmd/sdk contains nested dependencies at ${relativePath}`);
      }
      capture.directories += 1;
      if (capture.directories > MAX_DIRECTORIES) {
        throw new Error(`installed @flowmd/sdk exceeds ${MAX_DIRECTORIES} directories`);
      }
      await visitDirectory(path, relativePath, capture);
      continue;
    }
    if (!information.isFile() || information.nlink !== 1) {
      throw new Error(`installed @flowmd/sdk contains non-regular file ${relativePath}`);
    }
    if (capture.files.length >= MAX_FILES || information.size > MAX_DECODED_BYTES) {
      throw new Error("installed @flowmd/sdk exceeds its file or byte bound");
    }
    if (information.size > MAX_DECODED_BYTES - capture.bytes) {
      throw new Error(`installed @flowmd/sdk exceeds ${MAX_DECODED_BYTES} bytes`);
    }
    const bytes = await readStableRegularFile(
      path,
      MAX_DECODED_BYTES - capture.bytes,
      `installed @flowmd/sdk file ${relativePath}`,
    );
    capture.bytes += bytes.byteLength;
    capture.files.push({
      path: relativePath,
      contentBase64: Buffer.from(bytes).toString("base64"),
    });
  }
  if (capture.files.length === filesBefore) {
    throw new Error(`installed @flowmd/sdk contains empty directory ${relativeDirectory || "."}`);
  }
}

async function readStableRegularFile(
  path: string,
  maximumBytes: number,
  label: string,
): Promise<Uint8Array> {
  const pathBefore = await lstat(path);
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.nlink !== 1 ||
      !Number.isSafeInteger(pathBefore.size) || pathBefore.size < 0 ||
      pathBefore.size > maximumBytes) {
    throw new Error(`${label} is not one bounded regular unlinked file`);
  }
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!sameFileState(pathBefore, before) || before.size > maximumBytes) {
      throw new Error(`${label} changed before its bounded read`);
    }
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0) throw new Error(`${label} became shorter during its bounded read`);
      offset += result.bytesRead;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    if ((await handle.read(overflowProbe, 0, 1, before.size)).bytesRead !== 0) {
      throw new Error(`${label} grew during its bounded read`);
    }
    const after = await handle.stat();
    const pathAfter = await lstat(path);
    if (!sameFileState(before, after) || !sameFileState(after, pathAfter)) {
      throw new Error(`${label} changed during its bounded read`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function sameFileState(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return left.isFile() && right.isFile() && !left.isSymbolicLink() && !right.isSymbolicLink() &&
    left.nlink === 1 && right.nlink === 1 && left.dev === right.dev && left.ino === right.ino &&
    left.mode === right.mode && left.size === right.size && left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

async function runBun(
  arguments_: readonly string[],
  cwd: string,
): Promise<{
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}> {
  const child = spawn(process.execPath, arguments_, {
    cwd,
    env: {},
    stdio: ["ignore", "pipe", "pipe"],
  });
  let overflow: Error | undefined;
  const stdout = collect(child.stdout, "stdout", () => {
    overflow ??= new Error("Bun child stdout exceeds its byte bound");
    child.kill("SIGKILL");
  });
  const stderr = collect(child.stderr, "stderr", () => {
    overflow ??= new Error("Bun child stderr exceeds its byte bound");
    child.kill("SIGKILL");
  });
  const terminal = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  const [stdoutBytes, stderrBytes] = await Promise.all([stdout, stderr]);
  if (overflow !== undefined) throw overflow;
  return { ...terminal, stdout: stdoutBytes, stderr: stderrBytes };
}

async function collect(
  stream: NodeJS.ReadableStream,
  label: string,
  overflow: () => void,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  let exceeded = false;
  for await (const value of stream) {
    const byteLength = typeof value === "string"
      ? Buffer.byteLength(value)
      : (value as Uint8Array).byteLength;
    if (byteLength > MAX_CHILD_OUTPUT_BYTES - total) {
      exceeded = true;
      overflow();
      continue;
    }
    const chunk = Buffer.isBuffer(value)
      ? value
      : typeof value === "string"
        ? Buffer.from(value)
        : Buffer.from(value as Uint8Array);
    total += byteLength;
    chunks.push(chunk);
  }
  if (exceeded) {
    throw new Error(`Bun child ${label} exceeds its byte bound`);
  }
  return Buffer.concat(chunks, total);
}

function childDiagnostic(result: { readonly stdout: Uint8Array; readonly stderr: Uint8Array }): string {
  const bytes = result.stderr.byteLength === 0 ? result.stdout : result.stderr;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
  return text.length === 0 ? "no diagnostic" : text.slice(0, 2_048);
}

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, " ").slice(0, 2_048);
}

async function writeStream(stream: NodeJS.WritableStream, value: string | Uint8Array): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(value, (error) => error === null || error === undefined ? resolve() : reject(error));
  });
}
