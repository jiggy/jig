import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { link, lstat, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const HELPER_BUN_POLICY = Object.freeze([
  "--no-env-file",
  "--no-install",
  "--config=/dev/null",
] as const);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const CONTROL_BYTES = 64 * 1024;

interface Configuration {
  readonly ownerDirectory: string;
  readonly ownerDigest: string;
  readonly allocationDigest: string;
  readonly ownerToken: string;
  readonly helper: readonly [string, ...string[]];
  readonly finalizer: readonly [string, ...string[]];
}

/** Outside-owner wrapper; private proof machinery, not a public Backend SPI. */
async function main(): Promise<void> {
  requireStartupPosture();
  const config = parseArguments(process.argv.slice(2));
  await requireOwnerState(config);

  // This is the wrapper's first mutable effect after authenticating the
  // preallocated owner. Recovery competes for the same O_EXCL claim with the
  // value "cancelled". A losing delayed wrapper cannot start host mutation.
  if (!await claimActive(config)) return;

  let helperFailure: unknown;
  try {
    const helper = spawn(config.helper[0], config.helper.slice(1), {
      cwd: "/",
      env: {},
      stdio: ["inherit", "inherit", "inherit"],
    });
    await childClose(helper);
  } catch (error) {
    helperFailure = error;
  }

  const finalizer = await runFinalizer(config.finalizer);
  if (finalizer.code !== 0) {
    throw new Error(`trusted cgroup finalizer failed (${finalizer.code ?? finalizer.signal})`);
  }
  const receipt = validateFinalizerReceipt(finalizer.stdout, config.ownerDigest);
  await writeFinalReceipt(config.ownerDirectory, receipt);
  if (helperFailure !== undefined) {
    throw new Error(`trusted cgroup launch helper failed: ${errorText(helperFailure)}`);
  }
}

function requireStartupPosture(): void {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    throw new Error("trusted cgroup launch wrapper requires uid 0");
  }
  if (process.cwd() !== "/") throw new Error("trusted cgroup launch wrapper requires fixed cwd /");
  if (Object.keys(process.env).length !== 0) {
    throw new Error("trusted cgroup launch wrapper requires an empty environment");
  }
  if (process.execArgv.length !== HELPER_BUN_POLICY.length ||
      process.execArgv.some((value, index) => value !== HELPER_BUN_POLICY[index])) {
    throw new Error("trusted cgroup launch wrapper requires the fixed Bun policy");
  }
}

function parseArguments(arguments_: readonly string[]): Configuration {
  const helperAt = arguments_.indexOf("--helper");
  const finalizerAt = arguments_.indexOf("--finalizer");
  if (helperAt !== 8 || finalizerAt < helperAt + 3 || finalizerAt === arguments_.length - 1 ||
      arguments_[0] !== "--owner-dir" || arguments_[2] !== "--owner-digest" ||
      arguments_[4] !== "--allocation-digest" || arguments_[6] !== "--owner-token") {
    throw new Error("invalid trusted cgroup wrapper arguments");
  }
  const ownerDirectory = arguments_[1]!;
  const ownerDigest = arguments_[3]!;
  const allocationDigest = arguments_[5]!;
  const ownerToken = arguments_[7]!;
  const helper = arguments_.slice(helperAt + 1, finalizerAt);
  const finalizer = arguments_.slice(finalizerAt + 1);
  if (!ownerDirectory.startsWith("/") || !DIGEST.test(ownerDigest) || !DIGEST.test(allocationDigest) ||
      !TOKEN.test(ownerToken) ||
      helper.length === 0 || finalizer.length === 0 ||
      !helper[0]!.startsWith("/") || !finalizer[0]!.startsWith("/")) {
    throw new Error("invalid trusted cgroup wrapper command");
  }
  return {
    ownerDirectory,
    ownerDigest,
    allocationDigest,
    ownerToken,
    helper: helper as [string, ...string[]],
    finalizer: finalizer as [string, ...string[]],
  };
}

async function requireOwnerState(config: Configuration): Promise<void> {
  const information = await lstat(config.ownerDirectory);
  if (!information.isDirectory() || information.isSymbolicLink() || (information.mode & 0o077) !== 0) {
    throw new Error("trusted cgroup owner directory is not protected");
  }
  const owner = JSON.parse(await readFile(join(config.ownerDirectory, "owner.json"), "utf8")) as unknown;
  if (owner === null || typeof owner !== "object" || Array.isArray(owner)) {
    throw new Error("trusted cgroup owner record is invalid");
  }
  const record = owner as Record<string, unknown>;
  if (Object.keys(record).sort().join("\0") !== ["allocationDigest", "kind", "token"].sort().join("\0") ||
      record.kind !== "private-linux-owner-state/1" ||
      record.allocationDigest !== config.allocationDigest ||
      record.token !== config.ownerToken) {
    throw new Error("trusted cgroup owner record is invalid");
  }
}

async function claimActive(config: Configuration): Promise<boolean> {
  const path = join(config.ownerDirectory, "claim.json");
  try {
    // The coordinator owns the containing 0700 directory. Root-created state
    // must remain readable by that unprivileged owner after restart.
    const file = await open(path, "wx", 0o644);
    try {
      await file.writeFile(`${JSON.stringify({
        allocationDigest: config.allocationDigest,
        kind: "private-linux-owner-claim/1",
        state: "active",
        token: config.ownerToken,
      })}\n`, "utf8");
      await file.chmod(0o644);
      await file.sync();
    } finally {
      await file.close();
    }
    await syncDirectory(config.ownerDirectory);
    return true;
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
    const claim = await readClaim(path, config);
    if (claim === "cancelled" || claim === "active") return false;
    throw new Error("trusted cgroup owner claim is invalid");
  }
}

async function readClaim(path: string, config: Configuration): Promise<"active" | "cancelled"> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("trusted cgroup owner claim is invalid");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\0") !== ["allocationDigest", "kind", "state", "token"].sort().join("\0") ||
      record.kind !== "private-linux-owner-claim/1" ||
      record.allocationDigest !== config.allocationDigest ||
      record.token !== config.ownerToken || !["active", "cancelled"].includes(String(record.state))) {
    throw new Error("trusted cgroup owner claim is invalid");
  }
  return record.state as "active" | "cancelled";
}

async function runFinalizer(command: readonly [string, ...string[]]): Promise<{
  readonly code: number | null;
  readonly signal: string | null;
  readonly stdout: string;
}> {
  const child = spawn(command[0], command.slice(1), {
    cwd: "/",
    env: {},
    stdio: ["ignore", "pipe", "inherit"],
  });
  let stdout = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
    if (Buffer.byteLength(stdout) > CONTROL_BYTES) child.kill("SIGKILL");
  });
  const exit = await childClose(child);
  if (Buffer.byteLength(stdout) > CONTROL_BYTES) throw new Error("trusted cgroup finalizer receipt overflow");
  return { ...exit, stdout };
}

function validateFinalizerReceipt(text: string, ownerDigest: string): Record<string, unknown> {
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    throw new Error("trusted cgroup finalizer returned an invalid receipt stream");
  }
  const value = JSON.parse(text.slice(0, -1)) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      (value as Record<string, unknown>).ownerDigest !== ownerDigest ||
      (value as Record<string, unknown>).fenced !== true) {
    throw new Error("trusted cgroup finalizer returned an invalid owner receipt");
  }
  return value as Record<string, unknown>;
}

async function writeFinalReceipt(directory: string, receipt: Record<string, unknown>): Promise<void> {
  const target = join(directory, "final.json");
  const temporary = join(directory, `.final-${process.pid}-${randomBytes(8).toString("hex")}`);
  const file = await open(temporary, "wx", 0o644);
  try {
    await file.writeFile(`${JSON.stringify(receipt)}\n`, "utf8");
    await file.chmod(0o644);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, target);
    await syncDirectory(directory);
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
    const existing = await readFile(target, "utf8");
    if (existing !== `${JSON.stringify(receipt)}\n`) {
      throw new Error("trusted cgroup owner already has a different final receipt");
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function childClose(child: ChildProcess): Promise<{ readonly code: number | null; readonly signal: string | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && (error as NodeJS.ErrnoException).code === code;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void main().catch((error) => {
  process.stderr.write(`jig cgroup launch wrapper failed: ${errorText(error)}\n`);
  process.exitCode = 70;
});
