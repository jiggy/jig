import { spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  opendir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

const PACKAGE_ROOT = "/work/package";
const CACHE_ROOT = "/work/cache";
const MAX_SOURCE_FILES = 4_096;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_PREPARED_FILES = 16_384;
const MAX_PREPARED_BYTES = 64 * 1024 * 1024;
const MAX_INPUT_LINE_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_LINE_BYTES = 128 * 1024 * 1024;
const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)[^\0]+$/;

interface SourceFile {
  readonly path: string;
  readonly content: string;
}

class WorkerFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

let outputQueue = Promise.resolve();

try {
  const iterator = jsonLines(process.stdin, MAX_INPUT_LINE_BYTES)[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) throw new WorkerFailure("PACKAGE_BUN_PROTOCOL", "preparation source is missing");
  const source = requireSource(first.value);
  if (!(await iterator.next()).done) {
    throw new WorkerFailure("PACKAGE_BUN_PROTOCOL", "preparation source has trailing data");
  }
  await materializeSource(source.files);
  await requireSupportedLock();
  await install();
  await verifySource(source.files);
  const prepared = await capturePrepared();
  await sendPrepared(prepared);
  await outputQueue;
} catch (error) {
  const failure = error instanceof WorkerFailure
    ? error
    : new WorkerFailure("PACKAGE_BUN_PREPARATION_FAILED", "locked Bun dependency preparation failed");
  await send({ type: "failure", code: failure.code, message: failure.message }).catch(() => undefined);
  await outputQueue.catch(() => undefined);
  process.exitCode = 1;
}

async function materializeSource(files: readonly SourceFile[]): Promise<void> {
  await mkdir(PACKAGE_ROOT, { recursive: true, mode: 0o700 });
  for (const file of files) {
    const bytes = decodeBase64(file.content, file.path);
    const destination = join(PACKAGE_ROOT, ...file.path.split("/"));
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes, { mode: 0o600, flag: "wx" });
  }
}

async function verifySource(files: readonly SourceFile[]): Promise<void> {
  for (const file of files) {
    const expected = decodeBase64(file.content, file.path);
    const actual = new Uint8Array(await readFile(join(PACKAGE_ROOT, ...file.path.split("/"))));
    if (!Buffer.from(actual).equals(Buffer.from(expected))) {
      throw new WorkerFailure("PACKAGE_BUN_SOURCE_CHANGED", "Bun preparation changed authored package bytes");
    }
  }
}

async function requireSupportedLock(): Promise<void> {
  const lockCopy = "/work/bun-lock.jsonc";
  await copyFile(join(PACKAGE_ROOT, "bun.lock"), lockCopy);
  let value: unknown;
  try {
    const result = await runChild([
      "--no-env-file",
      "--no-install",
      "--config=/dev/null",
      "-e",
      "const value=(await import(process.argv[1])).default;process.stdout.write(JSON.stringify(value));",
      lockCopy,
    ], {
      cwd: "/work",
      env: { LD_LIBRARY_PATH: "/jig-runtime/lib" },
    }, 2 * 1024 * 1024, 64 * 1024);
    if (result.exit !== 0 || result.stderr !== "") throw new Error("lock parser failed");
    value = JSON.parse(result.stdout);
  } catch {
    throw new WorkerFailure("PACKAGE_BUN_LOCK_INVALID", "bun.lock is not valid for the pinned Bun runtime");
  }
  const lock = ordinaryRecord(value);
  const workspaces = ordinaryRecord(lock?.workspaces);
  const packages = ordinaryRecord(lock?.packages);
  if (lock?.lockfileVersion !== 1 || workspaces === undefined || packages === undefined ||
      Object.keys(workspaces).length !== 1 || !("" in workspaces) ||
      lock.patchedDependencies !== undefined) {
    unsupportedSource();
  }
  for (const resolution of Object.values(packages)) {
    if (!Array.isArray(resolution) || resolution.length !== 4 ||
        typeof resolution[0] !== "string" || typeof resolution[1] !== "string" ||
        resolution[1] !== "" && resolution[1] !== "https://registry.npmjs.org" &&
        resolution[1] !== "https://registry.npmjs.org/" ||
        ordinaryRecord(resolution[2]) === undefined ||
        typeof resolution[3] !== "string" || !/^sha(?:256|512)-[A-Za-z0-9+/]+={0,2}$/.test(resolution[3])) {
      unsupportedSource();
    }
  }
}

function unsupportedSource(): never {
  throw new WorkerFailure(
    "PACKAGE_BUN_SOURCE_UNSUPPORTED",
    "bun.lock contains a dependency source unsupported by this Jig alpha; only the default npm registry is supported",
  );
}

async function install(): Promise<void> {
  const result = await runChild([
    "--no-env-file",
    "--config=/dev/null",
    "install",
    "--frozen-lockfile",
    "--production",
    "--ignore-scripts",
    "--backend=copyfile",
    "--linker=hoisted",
    `--cache-dir=${CACHE_ROOT}`,
    "--registry=https://registry.npmjs.org",
    "--no-progress",
    "--no-summary",
  ], {
    cwd: PACKAGE_ROOT,
    env: {
      LD_LIBRARY_PATH: "/jig-runtime/lib",
    },
  }, 64 * 1024, 64 * 1024);
  if (result.exit !== 0) {
    const output = `${result.stdout}\n${result.stderr}`;
    if (/lockfile|frozen|package\.json/i.test(output)) {
      throw new WorkerFailure(
        "PACKAGE_BUN_LOCK_STALE",
        "package.json and bun.lock disagree; regenerate bun.lock with bun install --lockfile-only",
      );
    }
    throw new WorkerFailure(
      "PACKAGE_BUN_PREPARATION_FAILED",
      "the locked production dependencies could not be prepared by the pinned Bun runtime",
    );
  }
  await rm(join(PACKAGE_ROOT, "node_modules", ".bin"), { recursive: true, force: true });
}

async function capturePrepared(): Promise<readonly SourceFile[]> {
  const files: SourceFile[] = [];
  let total = 0;
  const visit = async (root: string, prefix: string): Promise<void> => {
    const directory = await opendir(root);
    const names: string[] = [];
    for await (const entry of directory) names.push(entry.name);
    names.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    for (const name of names) {
      const path = prefix === "" ? name : `${prefix}/${name}`;
      requirePath(path);
      const physical = join(root, name);
      const information = await lstat(physical);
      if (information.isDirectory() && !information.isSymbolicLink()) {
        await visit(physical, path);
        continue;
      }
      if (!information.isFile() || information.isSymbolicLink() || information.nlink !== 1) {
        throw new WorkerFailure("PACKAGE_BUN_OUTPUT_UNSUPPORTED", "prepared dependencies contain a link or special file");
      }
      if (files.length >= MAX_PREPARED_FILES) {
        throw new WorkerFailure("PACKAGE_BUN_OUTPUT_LIMIT", "prepared dependency tree has too many files");
      }
      const bytes = new Uint8Array(await readFile(physical));
      total += bytes.byteLength;
      if (total > MAX_PREPARED_BYTES) {
        throw new WorkerFailure("PACKAGE_BUN_OUTPUT_LIMIT", "prepared dependency tree is too large");
      }
      files.push(Object.freeze({ path, content: Buffer.from(bytes).toString("base64") }));
    }
  };
  await visit(PACKAGE_ROOT, "");
  files.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  return Object.freeze(files);
}

function requireSource(value: unknown): { readonly files: readonly SourceFile[] } {
  const root = ordinaryRecord(value);
  if (root?.type !== "source" || !Array.isArray(root.files) || root.files.length > MAX_SOURCE_FILES) {
    throw new WorkerFailure("PACKAGE_BUN_PROTOCOL", "preparation source is invalid");
  }
  const files: SourceFile[] = [];
  let total = 0;
  let prior: string | undefined;
  for (const raw of root.files) {
    const file = ordinaryRecord(raw);
    if (file === undefined || typeof file.path !== "string" || typeof file.content !== "string") {
      throw new WorkerFailure("PACKAGE_BUN_PROTOCOL", "preparation source file is invalid");
    }
    requirePath(file.path);
    if (prior !== undefined && Buffer.from(prior).compare(Buffer.from(file.path)) >= 0) {
      throw new WorkerFailure("PACKAGE_BUN_PROTOCOL", "preparation source paths are not canonical");
    }
    prior = file.path;
    const bytes = decodeBase64(file.content, file.path);
    total += bytes.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      throw new WorkerFailure("PACKAGE_BUN_INPUT_LIMIT", "locked Bun package is too large to prepare");
    }
    files.push(Object.freeze({ path: file.path, content: file.content }));
  }
  if (!files.some(({ path }) => path === "package.json") || !files.some(({ path }) => path === "bun.lock")) {
    throw new WorkerFailure("PACKAGE_BUN_PROTOCOL", "locked Bun source is incomplete");
  }
  return Object.freeze({ files: Object.freeze(files) });
}

function requirePath(path: string): void {
  if (!PATH.test(path) || Buffer.byteLength(path) > 1_024) {
    throw new WorkerFailure("PACKAGE_BUN_PROTOCOL", "preparation source path is invalid");
  }
}

function decodeBase64(value: string, label: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new WorkerFailure("PACKAGE_BUN_PROTOCOL", `${label} has invalid encoded bytes`);
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

function ordinaryRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  return value as Record<string, unknown>;
}

function send(value: Readonly<Record<string, unknown>>): Promise<void> {
  const bytes = `${JSON.stringify(value)}\n`;
  outputQueue = outputQueue.then(async () => {
    if (!process.stdout.write(bytes)) await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
  });
  return outputQueue;
}

function sendPrepared(files: readonly SourceFile[]): Promise<void> {
  const bytes = JSON.stringify({ type: "prepared", files });
  if (Buffer.byteLength(bytes) > MAX_OUTPUT_LINE_BYTES) {
    throw new WorkerFailure("PACKAGE_BUN_OUTPUT_LIMIT", "prepared dependency tree is too large");
  }
  return send({ type: "prepared", files });
}

async function* jsonLines(
  source: AsyncIterable<Uint8Array | string>,
  maximum: number,
): AsyncGenerator<unknown> {
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  for await (const chunk of source) {
    const bytes = Buffer.from(chunk);
    let start = 0;
    for (;;) {
      const end = bytes.indexOf(0x0a, start);
      if (end === -1) break;
      pending.push(bytes.subarray(start, end));
      pendingBytes += end - start;
      if (pendingBytes > maximum) throw new Error("protocol line exceeds bound");
      const line = pending.length === 1 ? pending[0]! : Buffer.concat(pending, pendingBytes);
      pending = [];
      pendingBytes = 0;
      yield JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line));
      start = end + 1;
    }
    if (start < bytes.byteLength) {
      pending.push(bytes.subarray(start));
      pendingBytes += bytes.byteLength - start;
      if (pendingBytes > maximum) throw new Error("protocol line exceeds bound");
    }
  }
  if (pendingBytes !== 0) throw new Error("protocol ended with a partial line");
}

async function collect(stream: NodeJS.ReadableStream | null, maximum: number): Promise<string> {
  if (stream === null) return "";
  let bytes = Buffer.alloc(0);
  for await (const chunk of stream) {
    bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
    if (bytes.byteLength > maximum) throw new Error("preparation child diagnostic exceeds bound");
  }
  return bytes.toString("utf8");
}

async function runChild(
  arguments_: readonly string[],
  options: { readonly cwd: string; readonly env: Readonly<Record<string, string>> },
  maximumStdout: number,
  maximumStderr: number,
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exit: number | null }> {
  const child = spawn(process.execPath, [...arguments_], {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exit = childExit(child);
  let settled = false;
  try {
    const [stdout, stderr, code] = await Promise.all([
      collect(child.stdout, maximumStdout),
      collect(child.stderr, maximumStderr),
      exit,
    ]);
    settled = true;
    return Object.freeze({ stdout, stderr, exit: code });
  } finally {
    if (!settled) {
      child.kill("SIGKILL");
      await exit.catch(() => undefined);
    }
  }
}

function childExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
}
