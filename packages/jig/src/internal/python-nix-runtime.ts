import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";

import { privateDomainDigest, privateFileDigest } from "./identity.js";
import type { JsonValue } from "../json.js";

const STORE_PATH = /^\/nix\/store\/[0-9a-z]{32}-[^/\u0000-\u001f\u007f]+$/u;
const MAX_CLOSURE_STORES = 256;
const MAX_COMMAND_OUTPUT = 1024 * 1024;
const OBSERVATION_TIMEOUT_MS = 10_000;

const authenticRuntimeObservations = new WeakSet<object>();

export interface PrivatePythonNixRuntimeOptions {
  readonly pythonPath: string;
  readonly nixStorePath: string;
}

export interface PrivatePythonNixRuntimeObservation {
  readonly kind: "python-nix-runtime-observation/1";
  readonly digest: string;
  readonly observerRevision: "python-nix-runtime-observer/1";
  readonly executable: string;
  readonly executableDigest: string;
  readonly version: string;
  readonly closureQueryExecutable: string;
  readonly closureQueryExecutableDigest: string;
  readonly closureQueryArgv0: "nix-store";
  readonly closureStores: readonly string[];
}

/** Observe one exact immutable Nix Python runtime; do not select among runtimes. */
export async function observePrivatePythonNixRuntime(
  options: PrivatePythonNixRuntimeOptions,
): Promise<PrivatePythonNixRuntimeObservation> {
  requireAbsolutePath(options.pythonPath, "Python executable");
  requireAbsolutePath(options.nixStorePath, "nix-store executable");
  const [executable, closureQueryExecutable] = await Promise.all([
    realpath(options.pythonPath),
    realpath(options.nixStorePath),
  ]);
  const runtimeStore = storeRoot(executable, "Python executable");
  await Promise.all([
    requireProtectedRegularFile(executable, "Python executable"),
    requireProtectedRegularFile(closureQueryExecutable, "nix-store executable"),
  ]);
  const [executableDigest, closureQueryExecutableDigest, versionResult, closureResult] =
    await Promise.all([
      privateFileDigest(executable),
      privateFileDigest(closureQueryExecutable),
      runTrusted(executable, ["--version"]),
      runTrusted(closureQueryExecutable, ["-qR", runtimeStore], "nix-store"),
    ]);
  const version = singleVersion(versionResult);
  const closureStores = normalizeClosureStores(closureResult.stdout, runtimeStore);
  await Promise.all(closureStores.map((path) => requireProtectedStore(path)));
  const identity = Object.freeze({
    kind: "python-nix-runtime-observation/1" as const,
    observerRevision: "python-nix-runtime-observer/1" as const,
    executable,
    executableDigest,
    version,
    closureQueryExecutable,
    closureQueryExecutableDigest,
    closureQueryArgv0: "nix-store" as const,
    closureStores,
  });
  const observation = Object.freeze({
    ...identity,
    digest: privateDomainDigest(
      "JIG-Python-Nix-Runtime-Observation/1",
      identity as unknown as JsonValue,
    ),
  });
  authenticRuntimeObservations.add(observation);
  return observation;
}

export function requirePrivatePythonNixRuntimeObservation(
  value: unknown,
): PrivatePythonNixRuntimeObservation {
  if (value === null || typeof value !== "object" || !authenticRuntimeObservations.has(value)) {
    throw new TypeError("Python runtime was not produced by the private Nix observer");
  }
  return value as PrivatePythonNixRuntimeObservation;
}

/** Reobserve one pinned runtime and reject change; never select a substitute. */
export async function verifyPrivatePythonNixRuntime(
  value: PrivatePythonNixRuntimeObservation,
): Promise<PrivatePythonNixRuntimeObservation> {
  const expected = requirePrivatePythonNixRuntimeObservation(value);
  const [executable, closureQueryExecutable] = await Promise.all([
    realpath(expected.executable),
    realpath(expected.closureQueryExecutable),
  ]);
  if (executable !== expected.executable ||
      closureQueryExecutable !== expected.closureQueryExecutable) {
    throw new Error("pinned Python Nix runtime path changed");
  }
  await Promise.all([
    requireProtectedRegularFile(executable, "Python executable"),
    requireProtectedRegularFile(closureQueryExecutable, "nix-store executable"),
    ...expected.closureStores.map((path) => requireProtectedStore(path)),
  ]);
  const [executableDigest, closureQueryExecutableDigest] = await Promise.all([
    privateFileDigest(executable),
    privateFileDigest(closureQueryExecutable),
  ]);
  if (executableDigest !== expected.executableDigest ||
      closureQueryExecutableDigest !== expected.closureQueryExecutableDigest) {
    throw new Error("pinned Python Nix runtime observation changed");
  }
  return expected;
}

function normalizeClosureStores(stdout: string, runtimeStore: string): readonly string[] {
  if (!stdout.endsWith("\n")) throw new Error("nix-store closure output is not newline-terminated");
  const values = stdout.slice(0, -1).split("\n");
  if (values.length === 0 || values.length > MAX_CLOSURE_STORES) {
    throw new Error(`Python runtime closure must contain 1-${MAX_CLOSURE_STORES} stores`);
  }
  for (const value of values) {
    if (!STORE_PATH.test(value)) throw new Error("Python runtime closure contains an invalid store path");
  }
  values.sort(compareText);
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] === values[index]) {
      throw new Error("Python runtime closure contains a duplicate store path");
    }
  }
  if (!values.includes(runtimeStore)) throw new Error("Python runtime closure omits its root store");
  return Object.freeze(values);
}

function singleVersion(result: TrustedResult): string {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if ((stdout === "") === (stderr === "")) {
    throw new Error("Python version probe must produce exactly one output stream");
  }
  const value = stdout === "" ? stderr : stdout;
  if (!/^Python [0-9]+\.[0-9]+\.[0-9]+(?:[^\u0000-\u001f\u007f]*)$/u.test(value) ||
      Buffer.byteLength(value) > 256) {
    throw new Error("Python version probe returned an invalid version");
  }
  return value;
}

function storeRoot(path: string, label: string): string {
  const match = /^\/nix\/store\/[0-9a-z]{32}-[^/\u0000-\u001f\u007f]+/u.exec(path);
  if (match === null) throw new Error(`${label} is not beneath one immutable Nix store path`);
  return match[0]!;
}

async function requireProtectedRegularFile(path: string, label: string): Promise<void> {
  const information = await stat(path);
  if (!information.isFile() || information.uid !== 0 || (information.mode & 0o022) !== 0) {
    throw new Error(`${label} is not a root-owned non-writable regular file`);
  }
}

async function requireProtectedStore(path: string): Promise<void> {
  if (await realpath(path) !== path) throw new Error("Python runtime closure contains an aliased store");
  const information = await stat(path);
  if (!information.isDirectory() || information.uid !== 0 || (information.mode & 0o022) !== 0) {
    throw new Error("Python runtime closure contains an unprotected store");
  }
}

interface TrustedResult {
  readonly stdout: string;
  readonly stderr: string;
}

async function runTrusted(
  executable: string,
  arguments_: readonly string[],
  argv0?: string,
): Promise<TrustedResult> {
  const child = spawn(executable, [...arguments_], {
    ...(argv0 === undefined ? {} : { argv0 }),
    env: Object.create(null) as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const overflow = (): void => {
    child.kill("SIGKILL");
  };
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes <= MAX_COMMAND_OUTPUT) stdoutChunks.push(Buffer.from(chunk));
    else overflow();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes <= MAX_COMMAND_OUTPUT) stderrChunks.push(Buffer.from(chunk));
    else overflow();
  });
  const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), OBSERVATION_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  if (stdoutBytes > MAX_COMMAND_OUTPUT || stderrBytes > MAX_COMMAND_OUTPUT) {
    throw new Error("trusted runtime observation exceeded its output limit");
  }
  let stdout: string;
  let stderr: string;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    stdout = decoder.decode(Buffer.concat(stdoutChunks, stdoutBytes));
    stderr = decoder.decode(Buffer.concat(stderrChunks, stderrBytes));
  } catch {
    throw new Error("trusted runtime observation produced invalid UTF-8");
  }
  if (result.code !== 0) {
    throw new Error(`trusted runtime observation failed (${result.code ?? result.signal}): ${stderr.trim()}`);
  }
  return Object.freeze({ stdout, stderr });
}

function requireAbsolutePath(value: string, label: string): void {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\0")) {
    throw new TypeError(`${label} must be an absolute path`);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
