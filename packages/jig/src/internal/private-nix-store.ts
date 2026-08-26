import { spawn } from "node:child_process";
import { resolve } from "node:path";

const STORE_PATH = /^\/nix\/store\/[0-9a-z]{32}-[^/\u0000-\u001f\u007f]+$/u;
const MAX_CLOSURE_STORES = 512;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10_000;
const GLOBAL_ARGUMENTS = Object.freeze([
  "--store",
  "daemon",
  "--option",
  "substitute",
  "false",
  "--option",
  "fallback",
  "false",
] as const);

export function requirePrivateNixStorePath(value: string, label: string): string {
  if (!STORE_PATH.test(value)) throw new Error(`${label} is not a canonical Nix store path`);
  return value;
}

export function privateNixStoreMember(path: string, label: string): string {
  requireAbsolutePath(path, label);
  const match = /^\/nix\/store\/[0-9a-z]{32}-[^/\u0000-\u001f\u007f]+/u.exec(path);
  if (match === null) throw new Error(`${label} is not beneath one immutable Nix store member`);
  return match[0]!;
}

export async function queryPrivateNixClosure(
  executable: string,
  target: string,
): Promise<readonly string[]> {
  requireAbsolutePath(executable, "nix-store executable");
  requirePrivateNixStorePath(target, "Nix closure target");
  const result = await runNixStore(executable, ["-qR", target], "closure query");
  if (!result.stdout.endsWith("\n")) {
    throw new Error("Nix closure output is not newline-terminated");
  }
  const stores = result.stdout.slice(0, -1).split("\n");
  if (stores.length === 0 || stores.length > MAX_CLOSURE_STORES) {
    throw new Error(`Nix closure must contain 1-${MAX_CLOSURE_STORES} stores`);
  }
  for (const store of stores) requirePrivateNixStorePath(store, "Nix closure member");
  stores.sort(compareText);
  for (let index = 1; index < stores.length; index += 1) {
    if (stores[index - 1] === stores[index]) throw new Error("Nix closure contains a duplicate store");
  }
  if (!stores.includes(target)) throw new Error("Nix closure omits its target");
  return Object.freeze(stores);
}

interface NixResult {
  readonly stdout: string;
  readonly stderr: string;
}

async function runNixStore(
  executable: string,
  arguments_: readonly string[],
  operation: string,
): Promise<NixResult> {
  const child = spawn(executable, [...GLOBAL_ARGUMENTS, ...arguments_], {
    argv0: "nix-store",
    cwd: "/",
    env: Object.create(null) as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  const terminate = (): void => {
    child.kill("SIGKILL");
  };
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes <= MAX_OUTPUT_BYTES) stdoutChunks.push(Buffer.from(chunk));
    else terminate();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes <= MAX_OUTPUT_BYTES) stderrChunks.push(Buffer.from(chunk));
    else terminate();
  });
  const status = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, COMMAND_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  if (stdoutBytes > MAX_OUTPUT_BYTES || stderrBytes > MAX_OUTPUT_BYTES) {
    throw new Error(`Nix ${operation} exceeded its output limit`);
  }
  if (timedOut) throw new Error(`Nix ${operation} exceeded its deadline`);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let stdout: string;
  let stderr: string;
  try {
    stdout = decoder.decode(Buffer.concat(stdoutChunks, stdoutBytes));
    stderr = decoder.decode(Buffer.concat(stderrChunks, stderrBytes));
  } catch {
    throw new Error(`Nix ${operation} produced invalid UTF-8`);
  }
  if (status.code !== 0) {
    throw new Error(`Nix ${operation} failed (${status.code ?? status.signal}): ${stderr.trim()}`);
  }
  return Object.freeze({ stdout, stderr });
}

function requireAbsolutePath(value: string, label: string): void {
  if (typeof value !== "string" || !value.startsWith("/") || resolve(value) !== value ||
      /[\u0000\r\n]/u.test(value)) {
    throw new TypeError(`${label} must be a canonical absolute single-line path`);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
