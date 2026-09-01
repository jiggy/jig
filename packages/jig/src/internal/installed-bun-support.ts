import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { JsonValue } from "../json.js";
import type { PrivateLinuxReadOnlyMount } from "./linux-rootless-backend.js";
import { privateDomainDigest, privateFileDigest } from "./identity.js";

const ELF_INTERPRETER = "/lib64/ld-linux-x86-64.so.2";
const LIBRARIES = Object.freeze([
  "libc.so.6",
  "libm.so.6",
  "libdl.so.2",
  "libpthread.so.0",
] as const);
const BUN_DESTINATION = "/jig-runtime/jig";
const LIBRARY_DESTINATION = "/jig-runtime/lib";
const EVALUATOR_DESTINATION = "/jig-evaluator";
const PREPARATION_WORKER_DESTINATION = "/jig-preparation-worker.js";
const authenticSupports = new WeakSet<object>();

export interface PrivateInstalledBunSupport {
  readonly kind: "private-installed-bun-support/1";
  readonly digest: string;
  readonly executablePath: string;
  readonly executableDigest: string;
  readonly sandboxExecutablePath: typeof BUN_DESTINATION;
  readonly hostLibraryDirectory: string;
  readonly runtimeMounts: readonly PrivateLinuxReadOnlyMount[];
  readonly supervisorPath: string;
  readonly supervisorDigest: string;
  readonly evaluatorSupportPath: string;
  readonly evaluatorSupportDigest: string;
  readonly preparationWorkerPath: string;
  readonly preparationWorkerDigest: string;
  readonly sandboxPreparationWorkerPath: typeof PREPARATION_WORKER_DESTINATION;
}

/**
 * Resolve the one fixed Linux-x64 release layout around a compiled Jig binary.
 *
 * The optional executable exists only so private tests can construct the same
 * layout around a copied Bun executable. Product code always uses process.execPath.
 */
export async function openPrivateInstalledBunSupport(
  executableInput: string = process.execPath,
): Promise<PrivateInstalledBunSupport> {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("the installed Bun host requires Linux x64");
  }
  const executablePath = await exactRegularFile(executableInput, true, "installed Jig executable");
  if (basename(executablePath) !== "jig" || basename(dirname(executablePath)) !== "bin") {
    throw new Error("the installed Jig executable is outside the fixed release layout");
  }
  const releaseRoot = dirname(dirname(executablePath));
  const supervisorPath = await exactRegularFile(
    join(releaseRoot, "libexec", "linux-rootless-supervisor.js"),
    false,
    "installed rootless supervisor",
  );
  const evaluatorSupportPath = await exactDirectory(
    join(releaseRoot, "libexec", "evaluator"),
    "installed evaluator support",
  );
  const evaluatorFiles = await Promise.all([
    "project-evaluator-worker.js",
    "project-evaluator-sdk.bundle.js",
    "project-authoring-1.schema.json",
  ].map(async (name) => Object.freeze({
    name,
    path: await exactRegularFile(
      join(evaluatorSupportPath, name),
      false,
      `installed evaluator asset ${name}`,
    ),
  })));
  const preparationWorkerPath = await exactRegularFile(
    join(releaseRoot, "libexec", "preparation", "bun-native-preparation-worker.js"),
    false,
    "installed Bun preparation worker",
  );

  const loaderPath = await exactRegularFile(ELF_INTERPRETER, true, "supported-host ELF interpreter");
  const hostLibraryDirectory = dirname(loaderPath);
  const libraries = await Promise.all(LIBRARIES.map(async (name) => Object.freeze({
    name,
    path: await exactRegularFile(
      join(hostLibraryDirectory, name),
      false,
      `supported-host library ${name}`,
    ),
  })));
  const [
    executableDigest,
    supervisorDigest,
    loaderDigest,
    libraryDigests,
    evaluatorDigests,
    preparationWorkerDigest,
  ] = await Promise.all([
    privateFileDigest(executablePath),
    privateFileDigest(supervisorPath),
    privateFileDigest(loaderPath),
    Promise.all(libraries.map(async ({ name, path }) => Object.freeze({
      name,
      digest: await privateFileDigest(path),
    }))),
    Promise.all(evaluatorFiles.map(async ({ name, path }) => Object.freeze({
      name,
      digest: await privateFileDigest(path),
    }))),
    privateFileDigest(preparationWorkerPath),
  ]);
  const evaluatorSupportDigest = privateDomainDigest(
    "JIG-Installed-Evaluator-Support/1",
    evaluatorDigests as unknown as JsonValue,
  );
  const identity = Object.freeze({
    kind: "private-installed-bun-support/1" as const,
    platform: "linux-x64-glibc",
    executableDigest,
    supervisorDigest,
    loader: Object.freeze({ destination: ELF_INTERPRETER, digest: loaderDigest }),
    libraries: libraryDigests,
    evaluatorSupportDigest,
    preparationWorkerDigest,
  });
  const runtimeMounts = Object.freeze([
    Object.freeze({ source: executablePath, destination: BUN_DESTINATION }),
    Object.freeze({ source: loaderPath, destination: ELF_INTERPRETER }),
    ...libraries.map(({ name, path }) => Object.freeze({
      source: path,
      destination: `${LIBRARY_DESTINATION}/${name}`,
    })),
  ]);
  const support = Object.freeze({
    kind: identity.kind,
    digest: privateDomainDigest("JIG-Installed-Bun-Support/1", identity as unknown as JsonValue),
    executablePath,
    executableDigest,
    sandboxExecutablePath: BUN_DESTINATION,
    hostLibraryDirectory,
    runtimeMounts,
    supervisorPath,
    supervisorDigest,
    evaluatorSupportPath,
    evaluatorSupportDigest,
    preparationWorkerPath,
    preparationWorkerDigest,
    sandboxPreparationWorkerPath: PREPARATION_WORKER_DESTINATION,
  });
  authenticSupports.add(support);
  return support;
}

export function requirePrivateInstalledBunSupport(value: unknown): PrivateInstalledBunSupport {
  if (value === null || typeof value !== "object" || !Object.isFrozen(value) ||
      !authenticSupports.has(value)) {
    throw new TypeError("installed Bun support was not produced by the fixed host factory");
  }
  return value as PrivateInstalledBunSupport;
}

/** Re-read every trusted byte immediately before an evaluator or Flow launch. */
export async function revalidatePrivateInstalledBunSupport(value: unknown): Promise<void> {
  const support = requirePrivateInstalledBunSupport(value);
  const current = await openPrivateInstalledBunSupport(support.executablePath);
  if (current.digest !== support.digest || current.executablePath !== support.executablePath ||
      current.supervisorPath !== support.supervisorPath ||
      current.evaluatorSupportPath !== support.evaluatorSupportPath ||
      current.preparationWorkerPath !== support.preparationWorkerPath) {
    throw new Error("installed Bun support changed after selection");
  }
}

async function exactRegularFile(path: string, executable: boolean, label: string): Promise<string> {
  const resolved = await realpath(path);
  const information = await lstat(resolved);
  if (!information.isFile() || information.isSymbolicLink() ||
      executable && (information.mode & 0o111) === 0) {
    throw new Error(`${label} is unavailable`);
  }
  if (executable) await access(resolved, constants.X_OK);
  return resolved;
}

async function exactDirectory(path: string, label: string): Promise<string> {
  const resolved = await realpath(path);
  const information = await lstat(resolved);
  if (!information.isDirectory() || information.isSymbolicLink()) {
    throw new Error(`${label} is unavailable`);
  }
  return resolved;
}
