import { lstat, readFile, rm, rmdir, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CGROUP2_SUPER_MAGIC = 0x63677270;
const HELPER_BUN_POLICY = Object.freeze([
  "--no-env-file",
  "--no-install",
  "--config=/dev/null",
] as const);
const PARENT = /^jig-run-[a-z0-9][a-z0-9-]{0,47}-[0-9a-f]{24}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

interface Configuration {
  readonly scope: string;
  readonly parent: string;
  readonly ownerDigest: string;
  readonly cleanupMs: number;
}

/**
 * Exact recovery for one previously sealed private Linux owner.
 *
 * This is trusted launcher code, not a package-facing command or a generic
 * Sandbox Backend protocol. It never enumerates the Jig cgroup subtree: every
 * path is derived from one validated sealed-owner record.
 */
async function main(): Promise<void> {
  requireStartupPosture();
  const config = parseArguments(process.argv.slice(2));
  const parentCgroup = join(config.scope, config.parent);
  const supervisorCgroup = join(parentCgroup, "supervisor");
  const runCgroup = join(parentCgroup, "run");
  const deviceDirectory = join("/dev", `.jig-${config.parent}-devices`);

  await requireCgroupScope(config.scope);
  // The launch helper is the only process that can create or launch package
  // descendants. Fence that exact owner first, then the package tree.
  await killExactCgroup(supervisorCgroup);
  await waitUntilEmpty(supervisorCgroup, config.cleanupMs, "supervisor");
  await killExactCgroup(runCgroup);
  const evidence = await cleanupExactCgroups(
    supervisorCgroup,
    runCgroup,
    parentCgroup,
    config.cleanupMs,
  );
  await cleanupExactDevices(deviceDirectory);

  process.stdout.write(`${JSON.stringify({
    type: "fenced",
    ownerDigest: config.ownerDigest,
    stopReason: "recovered",
    exitCode: null,
    signal: null,
    fenced: true,
    parentCgroup,
    supervisorCgroup,
    runCgroup,
    privateDeviceDirectory: deviceDirectory,
    evidence,
  })}\n`);
}

function requireStartupPosture(): void {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    throw new Error("trusted cgroup recovery helper requires uid 0");
  }
  if (process.cwd() !== "/") throw new Error("trusted cgroup recovery helper requires fixed cwd /");
  if (Object.keys(process.env).length !== 0) {
    throw new Error("trusted cgroup recovery helper requires an empty environment");
  }
  if (process.execArgv.length !== HELPER_BUN_POLICY.length ||
      process.execArgv.some((value, index) => value !== HELPER_BUN_POLICY[index])) {
    throw new Error("trusted cgroup recovery helper requires the fixed Bun policy");
  }
}

function parseArguments(arguments_: readonly string[]): Configuration {
  if (arguments_.length !== 8) throw new Error("invalid trusted cgroup recovery arguments");
  const fields = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (name === undefined || value === undefined || !name.startsWith("--") || fields.has(name)) {
      throw new Error("invalid trusted cgroup recovery arguments");
    }
    fields.set(name, value);
  }
  if ([...fields.keys()].sort().join("\0") !==
      ["--cleanup-ms", "--owner-digest", "--parent", "--scope"].sort().join("\0")) {
    throw new Error("invalid trusted cgroup recovery arguments");
  }
  const scope = fields.get("--scope")!;
  const parent = fields.get("--parent")!;
  const ownerDigest = fields.get("--owner-digest")!;
  const cleanupMs = Number(fields.get("--cleanup-ms"));
  if (!scope.startsWith("/sys/fs/cgroup/") || !PARENT.test(parent) || !DIGEST.test(ownerDigest) ||
      !Number.isSafeInteger(cleanupMs) || cleanupMs < 1 || cleanupMs > 60_000) {
    throw new Error("trusted cgroup recovery target is invalid");
  }
  return { scope, parent, ownerDigest, cleanupMs };
}

async function requireCgroupScope(scope: string): Promise<void> {
  if (Number((await statfs(scope)).type) !== CGROUP2_SUPER_MAGIC) {
    throw new Error("trusted cgroup recovery requires cgroup v2");
  }
}

async function killExactCgroup(cgroup: string): Promise<void> {
  await writeFile(join(cgroup, "cgroup.kill"), "1").catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function cleanupExactCgroups(
  supervisorCgroup: string,
  runCgroup: string,
  parentCgroup: string,
  timeoutMs: number,
): Promise<Readonly<Record<string, Readonly<Record<string, number>>>>> {
  const deadline = Date.now() + timeoutMs;
  await waitUntilEmpty(runCgroup, Math.max(1, deadline - Date.now()), "Run");
  const evidence = Object.freeze({
    cpuStat: await readCounters(join(runCgroup, "cpu.stat")),
    memoryEvents: await readCounters(join(runCgroup, "memory.events")),
    pidsEvents: await readCounters(join(runCgroup, "pids.events")),
  });
  await rmdir(runCgroup).catch(ignoreMissing);
  await rmdir(supervisorCgroup).catch(ignoreMissing);
  await rmdir(parentCgroup).catch(ignoreMissing);
  return evidence;
}

async function waitUntilEmpty(cgroup: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (await populatedIfPresent(cgroup)) {
    if (Date.now() >= deadline) throw new Error(`timed out fencing the exact ${label} cgroup`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function populatedIfPresent(cgroup: string): Promise<boolean> {
  try {
    const text = await readFile(join(cgroup, "cgroup.events"), "utf8");
    const match = /^populated ([01])$/m.exec(text);
    if (match === null) throw new Error("exact Run cgroup omitted populated state");
    return match[1] === "1";
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

async function readCounters(path: string): Promise<Readonly<Record<string, number>>> {
  try {
    const result: Record<string, number> = {};
    for (const line of (await readFile(path, "utf8")).trim().split("\n")) {
      const [name, raw] = line.split(/\s+/, 2);
      const count = Number(raw);
      if (name !== undefined && /^[a-z][a-z0-9_.]{0,63}$/.test(name) &&
          Number.isSafeInteger(count) && count >= 0) result[name] = count;
    }
    return Object.freeze(result);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return Object.freeze({});
    throw error;
  }
}

async function cleanupExactDevices(directory: string): Promise<void> {
  try {
    const information = await lstat(directory);
    if (!information.isDirectory() || information.uid !== 0 || information.gid !== 0 ||
        (information.mode & 0o777) !== 0o700) {
      throw new Error("exact private-device owner has an invalid identity");
    }
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
  await rm(directory, { recursive: true, force: false }).catch(ignoreMissing);
}

function ignoreMissing(error: NodeJS.ErrnoException): void {
  if (error.code !== "ENOENT") throw error;
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && (error as NodeJS.ErrnoException).code === code;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void main().catch((error) => {
  process.stderr.write(`jig cgroup recovery helper failed: ${errorText(error)}\n`);
  process.exitCode = 70;
});
