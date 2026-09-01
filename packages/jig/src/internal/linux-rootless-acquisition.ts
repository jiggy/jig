import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  readFile,
  readdir,
  realpath,
  stat,
  statfs,
} from "node:fs/promises";
import { posix } from "node:path";

const CGROUP_ROOT = "/sys/fs/cgroup";
const CGROUP2_SUPER_MAGIC = 0x6367_7270n;
const BUBBLEWRAP_PATH = "/usr/bin/bwrap";
const MAX_PROCESS_OUTPUT_BYTES = 16 * 1024;
const REQUIRED_CONTROLLERS = Object.freeze(["cpu", "memory", "pids"] as const);
const REQUIRED_BUBBLEWRAP_FEATURES = Object.freeze([
  "--unshare-all",
  "--share-net",
  "--unshare-user",
  "--disable-userns",
  "--assert-userns-disabled",
  "--as-pid-1",
  "--die-with-parent",
  "--new-session",
  "--clearenv",
  "--remount-ro",
  "--cap-drop",
] as const);
const UNAVAILABLE_MESSAGE = "the required rootless Linux sandbox is unavailable";

interface PrivateFileInformation {
  readonly uid: number;
  readonly mode: number;
  isDirectory(): boolean;
  isFile(): boolean;
}

interface PrivateExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
}

/** Test seam only. This is not a host, Backend, or runtime-provider SPI. */
export interface PrivateRootlessLinuxAcquisitionDependencies {
  readonly uid: () => number | undefined;
  readonly gid: () => number | undefined;
  readonly readText: (path: string) => Promise<string>;
  readonly listDirectories: (path: string) => Promise<readonly string[]>;
  readonly information: (path: string) => Promise<PrivateFileInformation>;
  readonly filesystemType: (path: string) => Promise<number | bigint>;
  readonly resolve: (path: string) => Promise<string>;
  readonly requireAccess: (path: string, mode: number) => Promise<void>;
  readonly execute: (path: string, arguments_: readonly string[]) => Promise<PrivateExecutionResult>;
}

export interface PrivateRootlessLinuxAcquisitionObservation {
  readonly kind: "private-rootless-linux-acquisition/1";
  readonly delegatedCgroup: string;
  readonly currentCgroup: string;
  readonly bubblewrapPath: string;
  readonly bubblewrapVersion: string;
  readonly payloadUid: number;
  readonly payloadGid: number;
}

export class PrivateRootlessLinuxAcquisitionError extends Error {
  readonly code = "SANDBOX_UNAVAILABLE" as const;

  constructor() {
    super(UNAVAILABLE_MESSAGE);
    this.name = "PrivateRootlessLinuxAcquisitionError";
  }
}

/**
 * Recognize one complete delegation already inherited by this process.
 *
 * Only the current cgroup's immediate parent may qualify. This function does
 * not scan ancestors, move processes, activate controllers, call a service
 * manager, or manufacture authority which the caller did not inherit.
 */
export async function acquirePrivateRootlessLinux(
  dependencies: PrivateRootlessLinuxAcquisitionDependencies = systemDependencies,
): Promise<PrivateRootlessLinuxAcquisitionObservation> {
  try {
    return await observe(dependencies);
  } catch {
    throw new PrivateRootlessLinuxAcquisitionError();
  }
}

async function observe(
  dependencies: PrivateRootlessLinuxAcquisitionDependencies,
): Promise<PrivateRootlessLinuxAcquisitionObservation> {
  const uid = dependencies.uid();
  const gid = dependencies.gid();
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid === undefined || gid === undefined ||
      uid <= 0 || gid <= 0) {
    throw new Error("unprivileged Linux identity is unavailable");
  }

  if (BigInt(await dependencies.filesystemType(CGROUP_ROOT)) !== CGROUP2_SUPER_MAGIC) {
    throw new Error("unified cgroup v2 is unavailable");
  }

  const relative = parseCurrentCgroup(await dependencies.readText("/proc/self/cgroup"));
  const currentCgroup = `${CGROUP_ROOT}${relative}`;
  const delegatedCgroup = posix.dirname(currentCgroup);
  if (delegatedCgroup === CGROUP_ROOT || !delegatedCgroup.startsWith(`${CGROUP_ROOT}/`) ||
      posix.dirname(`${delegatedCgroup}/child`) !== delegatedCgroup) {
    throw new Error("the current cgroup has no safe immediate parent");
  }
  if (await dependencies.resolve(currentCgroup) !== currentCgroup ||
      await dependencies.resolve(delegatedCgroup) !== delegatedCgroup) {
    throw new Error("the inherited cgroup path is not canonical");
  }

  const [currentInformation, delegatedInformation] = await Promise.all([
    dependencies.information(currentCgroup),
    dependencies.information(delegatedCgroup),
  ]);
  if (!currentInformation.isDirectory() || !delegatedInformation.isDirectory() ||
      currentInformation.uid !== uid || delegatedInformation.uid !== uid) {
    throw new Error("the inherited cgroup is not owned by the current user");
  }

  if ((await dependencies.readText(`${delegatedCgroup}/cgroup.procs`)).trim() !== "") {
    throw new Error("the immediate parent cgroup is populated");
  }
  const childDirectories = [...await dependencies.listDirectories(delegatedCgroup)].sort();
  if (childDirectories.length !== 1 || childDirectories[0] !== posix.basename(currentCgroup)) {
    throw new Error("the immediate parent cgroup is not exclusive to this payload");
  }

  requireWords(
    await dependencies.readText(`${delegatedCgroup}/cgroup.controllers`),
    REQUIRED_CONTROLLERS,
  );
  requireWords(
    await dependencies.readText(`${delegatedCgroup}/cgroup.subtree_control`),
    REQUIRED_CONTROLLERS,
  );
  await dependencies.requireAccess(delegatedCgroup, constants.W_OK | constants.X_OK);
  await dependencies.requireAccess(`${delegatedCgroup}/cgroup.procs`, constants.R_OK | constants.W_OK);
  await dependencies.requireAccess(`${delegatedCgroup}/cgroup.subtree_control`, constants.R_OK | constants.W_OK);
  for (const control of ["cpu.max", "memory.max", "pids.max"] as const) {
    await dependencies.requireAccess(`${currentCgroup}/${control}`, constants.R_OK | constants.W_OK);
  }
  await dependencies.requireAccess(`${currentCgroup}/cgroup.events`, constants.R_OK);
  await dependencies.requireAccess(`${currentCgroup}/cgroup.kill`, constants.W_OK);

  const bubblewrapPath = await dependencies.resolve(BUBBLEWRAP_PATH);
  if (!bubblewrapPath.startsWith("/") || bubblewrapPath.includes("\0")) {
    throw new Error("Bubblewrap did not resolve to an absolute path");
  }
  const bubblewrapInformation = await dependencies.information(bubblewrapPath);
  if (!bubblewrapInformation.isFile() || (bubblewrapInformation.mode & 0o111) === 0 ||
      (bubblewrapInformation.mode & 0o6000) !== 0) {
    throw new Error("Bubblewrap is not an ordinary unprivileged executable");
  }

  const versionResult = await dependencies.execute(bubblewrapPath, ["--version"]);
  const version = requireBubblewrapVersion(versionResult);
  const featureResult = await dependencies.execute(
    bubblewrapPath,
    bubblewrapFeatureProbe(bubblewrapPath),
  );
  if (featureResult.stderr !== "" || featureResult.stdout.trim() !== `bubblewrap ${version}`) {
    throw new Error("Bubblewrap feature probe returned an unexpected result");
  }

  return Object.freeze({
    kind: "private-rootless-linux-acquisition/1" as const,
    delegatedCgroup,
    currentCgroup,
    bubblewrapPath,
    bubblewrapVersion: version,
    payloadUid: uid,
    payloadGid: gid,
  });
}

function parseCurrentCgroup(input: string): string {
  const lines = input.split("\n").filter((line) => line !== "");
  if (lines.length !== 1 || !lines[0]!.startsWith("0::")) {
    throw new Error("the process is not in one unified cgroup");
  }
  const relative = lines[0]!.slice(3);
  if (!relative.startsWith("/") || relative === "/" || relative.endsWith("/") ||
      relative.includes("\0") || relative.includes("\\") || posix.normalize(relative) !== relative) {
    throw new Error("the current cgroup path is invalid");
  }
  return relative;
}

function requireWords(input: string, expected: readonly string[]): void {
  const actual = new Set(input.trim().split(/\s+/).filter((value) => value !== ""));
  for (const value of expected) {
    if (!actual.has(value)) throw new Error(`required cgroup controller is unavailable: ${value}`);
  }
}

function requireBubblewrapVersion(result: PrivateExecutionResult): string {
  if (result.stderr !== "") throw new Error("Bubblewrap version probe wrote a diagnostic");
  const match = /^bubblewrap ([0-9]+)\.([0-9]+)\.([0-9]+)\n?$/.exec(result.stdout);
  if (match === null) throw new Error("Bubblewrap returned an invalid version");
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || major < 0 || minor < 0 ||
      major === 0 && minor < 12) {
    throw new Error("Bubblewrap 0.12 or newer is required");
  }
  return `${major}.${minor}.${Number(match[3])}`;
}

function bubblewrapFeatureProbe(path: string): readonly string[] {
  const arguments_ = [
    "--unshare-all",
    "--share-net",
    "--unshare-user",
    "--disable-userns",
    "--assert-userns-disabled",
    "--as-pid-1",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--ro-bind", "/", "/",
    "--proc", "/proc",
    "--remount-ro", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--cap-drop", "ALL",
    "--",
    path,
    "--version",
  ];
  for (const feature of REQUIRED_BUBBLEWRAP_FEATURES) {
    if (!arguments_.includes(feature)) throw new Error("Bubblewrap feature probe is incomplete");
  }
  return Object.freeze(arguments_);
}

const systemDependencies: PrivateRootlessLinuxAcquisitionDependencies = Object.freeze({
  uid: () => process.getuid?.(),
  gid: () => process.getgid?.(),
  readText: (path: string) => readFile(path, "utf8"),
  listDirectories: async (path: string) => (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
  information: (path: string) => stat(path),
  filesystemType: async (path: string) => (await statfs(path)).type,
  resolve: (path: string) => realpath(path),
  requireAccess: (path: string, mode: number) => access(path, mode),
  execute: runExecutable,
});

function runExecutable(path: string, arguments_: readonly string[]): Promise<PrivateExecutionResult> {
  return new Promise((resolve, reject) => {
    execFile(path, [...arguments_], {
      cwd: "/",
      env: {},
      encoding: "utf8",
      maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
      timeout: 5_000,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
