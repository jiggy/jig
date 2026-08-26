import { spawn } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readlink,
  readdir,
  realpath,
  symlink,
  type FileHandle,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { invalid, unavailable } from "../diagnostics.js";
import { type JsonValue } from "../json.js";
import { privateDomainDigest } from "./identity.js";
import {
  decodePrivatePythonLinuxHostGeneration,
  encodePrivatePythonLinuxHostGeneration,
  observePrivatePythonLinuxHostGeneration,
  requirePrivatePythonLinuxHostGeneration,
  verifyPrivatePythonLinuxHostGeneration,
  type PrivatePythonLinuxHostGeneration,
  type PrivatePythonLinuxHostGenerationIntent,
} from "./python-linux-host-generation.js";
import { observePrivatePythonNixRuntime } from "./python-nix-runtime.js";

const DATABASE_NAME = "private-python-linux-roots-v1.sqlite3";
const ROOTS_DIRECTORY = "runtime-roots";
const SCHEMA_VERSION = 1n;
const APPLICATION_ID = 0x4a485231n; // JHR1
const BUSY_TIMEOUT_MS = 250;
const MAX_DATABASE_BYTES = 64 * 1024;
const MAX_NIX_OUTPUT_BYTES = 1024 * 1024;
const NIX_TIMEOUT_MS = 10_000;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CREATE_GENERATION = "CREATE TABLE generation (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), generation_digest TEXT NOT NULL UNIQUE, generation_bytes BLOB NOT NULL CHECK (length(generation_bytes) BETWEEN 2 AND 65536)) STRICT";
const authenticRootConvergences = new WeakSet<object>();
const authenticRootIntentObservations = new WeakSet<object>();

interface SqliteRunResult {
  readonly changes: number;
}

interface SqliteStatement<Row> {
  safeIntegers(enabled: boolean): SqliteStatement<Row>;
  get(...bindings: readonly unknown[]): Row | null;
  all(...bindings: readonly unknown[]): Row[];
  run(...bindings: readonly unknown[]): SqliteRunResult;
}

interface SqliteDatabase {
  readonly inTransaction: boolean;
  exec(sql: string): void;
  query<Row>(sql: string): SqliteStatement<Row>;
  close(throwOnError?: boolean): void;
}

interface SqliteErrorConstructor {
  new (...args: readonly unknown[]): Error & { readonly errno?: number };
  readonly prototype: Error & { readonly errno?: number };
}

interface SqliteModule {
  readonly Database: { open(path: string, flags?: number): SqliteDatabase };
  readonly SQLiteError: SqliteErrorConstructor;
  readonly constants: Readonly<Record<string, number>>;
}

interface GenerationRow {
  readonly singleton: bigint;
  readonly generation_digest: string;
  readonly generation_bytes: Uint8Array;
}

interface SchemaRow {
  readonly type: string;
  readonly name: string;
  readonly table: string;
  readonly sql: string;
}

interface ProtectedDirectory {
  readonly handle: FileHandle;
  readonly visiblePath: string;
  readonly information: BigIntStats;
  readonly ownerUid: bigint;
  verify(): Promise<void>;
}

interface RootStateOwner {
  readonly root: ProtectedDirectory;
  readonly database: SqliteDatabase;
  readonly databaseInformation: BigIntStats;
  verify(): Promise<void>;
  dispose(): Promise<void>;
}

interface RootTree {
  readonly collection: ProtectedDirectory;
  readonly generation: ProtectedDirectory;
  readonly expectedRoots: readonly PrivatePythonLinuxRootMember[];
  verify(requireComplete: boolean): Promise<void>;
  dispose(): Promise<void>;
}

export interface PrivatePythonLinuxRootMember {
  readonly rootPath: string;
  readonly storePath: string;
}

export interface PrivatePythonLinuxRootConvergence {
  readonly kind: "python-linux-root-convergence/1";
  readonly admissible: false;
  readonly digest: string;
  readonly generationDigest: string;
  readonly stateRoot: string;
  readonly roots: readonly PrivatePythonLinuxRootMember[];
}

export interface PrivatePythonLinuxStateRootIdentity {
  readonly path: string;
  readonly device: string;
  readonly inode: string;
  readonly ownerUid: string;
}

export interface PrivatePythonLinuxRootIntentObservation {
  readonly kind: "python-linux-root-intent-observation/1";
  readonly admissible: false;
  readonly digest: string;
  readonly generationDigest: string;
  readonly stateRoot: PrivatePythonLinuxStateRootIdentity;
}

/** Durably store one authentic expected generation before any Nix root effect. */
export async function stagePrivatePythonLinuxRootIntent(input: {
  readonly stateRoot: string;
  readonly generation: PrivatePythonLinuxHostGeneration;
}): Promise<void> {
  const request = snapshotStageRootIntentInput(input);
  const generation = await verifyPrivatePythonLinuxHostGeneration(
    requirePrivatePythonLinuxHostGeneration(request.generation),
  );
  const generationBytes = encodePrivatePythonLinuxHostGeneration(generation);
  if (generationBytes.byteLength > MAX_DATABASE_BYTES) {
    unavailable("HOST_ROOT_INTENT_SIZE", "host generation exceeds the root intent byte limit");
  }
  const owner = await openRootState(request.stateRoot, true);
  let failure: unknown;
  try {
    await immediate(owner, async () => {
      const current = readGeneration(owner.database);
      if (current === undefined) {
        await requireRootCollectionAbsent(owner.root);
        const inserted = statement<never>(owner.database,
          "INSERT INTO generation(singleton, generation_digest, generation_bytes) VALUES (1, ?1, ?2)",
        ).run(generation.digest, generationBytes).changes;
        if (inserted !== 1) corrupt("root intent did not insert exactly one singleton row");
        requireStoredGeneration(owner.database, generation.digest, generationBytes);
        return;
      }
      requireSameStoredGeneration(current, generation.digest, generationBytes);
    });
    await owner.verify();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOwner(owner, failure);
  }
}

/**
 * Reobserve the exact immutable intent without creating or registering roots.
 * This is bounded identity evidence, not an execution acquisition.
 */
export async function observePrivatePythonLinuxRootIntent(input: {
  readonly stateRoot: string;
  readonly expectedDigest: string;
}): Promise<PrivatePythonLinuxRootIntentObservation> {
  const request = snapshotRootIntentInput(input);
  const owner = await openRootState(request.stateRoot, false);
  let failure: unknown;
  try {
    await owner.verify();
    const stored = requireStoredGeneration(owner.database, request.expectedDigest);
    const live = await reobserveStoredGeneration(stored);
    await requireStoredGenerationStillLive(stored, live);
    requireStoredGeneration(owner.database, request.expectedDigest, stored.bytes);
    await owner.verify();
    const identity = Object.freeze({
      kind: "python-linux-root-intent-observation/1" as const,
      admissible: false as const,
      generationDigest: stored.intent.digest,
      stateRoot: stateRootIdentity(owner.root),
    });
    const observation = Object.freeze({
      ...identity,
      digest: privateDomainDigest(
        "JIG-Python-Linux-Root-Intent-Observation/1",
        identity as unknown as JsonValue,
      ),
    });
    authenticRootIntentObservations.add(observation);
    return observation;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOwner(owner, failure);
  }
}

function snapshotRootIntentInput(value: unknown): Readonly<{
  readonly stateRoot: string;
  readonly expectedDigest: string;
}> {
  const input = snapshotDataRecord(
    value,
    ["expectedDigest", "stateRoot"],
    "root intent observation",
  );
  const stateRoot = input.stateRoot;
  const expectedDigest = input.expectedDigest;
  if (typeof stateRoot !== "string") throw new TypeError("root intent state root must be a string");
  requireAbsolutePath(stateRoot, "root intent state root");
  requireDigest(expectedDigest, "expected generation");
  return Object.freeze({ stateRoot, expectedDigest });
}

function snapshotStageRootIntentInput(value: unknown): Readonly<{
  readonly stateRoot: string;
  readonly generation: PrivatePythonLinuxHostGeneration;
}> {
  const input = snapshotDataRecord(
    value,
    ["generation", "stateRoot"],
    "root intent staging",
  );
  if (typeof input.stateRoot !== "string") {
    throw new TypeError("root intent state root must be a string");
  }
  requireAbsolutePath(input.stateRoot, "root intent state root");
  return Object.freeze({
    stateRoot: input.stateRoot,
    generation: requirePrivatePythonLinuxHostGeneration(input.generation),
  });
}

function snapshotDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} input must be one plain data object`);
  }
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TypeError(`${label} properties could not be inspected`);
  }
  const propertyKeys = Reflect.ownKeys(descriptors);
  if (propertyKeys.some((key) => typeof key !== "string")) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
  const keys = (propertyKeys as string[]).sort(compareText);
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError(`${label}.${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

export function requirePrivatePythonLinuxRootIntentObservation(
  value: unknown,
): PrivatePythonLinuxRootIntentObservation {
  if (value === null || typeof value !== "object" || !authenticRootIntentObservations.has(value)) {
    throw new TypeError("Python/Linux root intent was not produced by the private observer");
  }
  return value as PrivatePythonLinuxRootIntentObservation;
}

/** Converge the one durably expected generation to a complete retain-only root set. */
export async function convergePrivatePythonLinuxRoots(input: {
  readonly stateRoot: string;
  readonly expectedDigest: string;
}): Promise<PrivatePythonLinuxRootConvergence> {
  const request = snapshotRootIntentInput(input);
  const owner = await openRootState(request.stateRoot, false);
  let failure: unknown;
  try {
    await owner.verify();
    const stored = requireStoredGeneration(owner.database, request.expectedDigest);
    const live = await reobserveStoredGeneration(stored);
    const tree = await openRootTree(owner.root, stored.intent, true);
    let treeFailure: unknown;
    try {
      await tree.verify(false);
      for (const root of tree.expectedRoots) await ensureExactRootLink(tree, root);
      await tree.generation.handle.sync();
      await tree.verify(true);

      const nixStore = rolePath(stored.intent, "nix-store");
      for (const root of tree.expectedRoots) {
        await tree.verify(true);
        await requireExactRootLink(tree.generation, root);
        await addNixIndirectRoot(nixStore, root);
        await tree.generation.handle.sync();
        await tree.verify(true);
        await requireExactRootLink(tree.generation, root);
      }

      await tree.generation.handle.sync();
      await tree.verify(true);
      await requireStoredGenerationStillLive(stored, live);
      requireStoredGeneration(owner.database, request.expectedDigest, stored.bytes);
      await owner.verify();
      await tree.verify(true);
      return authenticateRootConvergence(
        rootConvergence(request.stateRoot, stored.intent.digest, tree.expectedRoots),
      );
    } catch (error) {
      treeFailure = error;
      throw error;
    } finally {
      await disposeTree(tree, treeFailure);
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOwner(owner, failure);
  }
}

/** Require process-local evidence from a fresh exact convergence. */
export function requirePrivatePythonLinuxRootConvergence(
  value: unknown,
): PrivatePythonLinuxRootConvergence {
  if (value === null || typeof value !== "object" || !authenticRootConvergences.has(value)) {
    throw new TypeError("Python/Linux roots were not produced by the private converger");
  }
  return value as PrivatePythonLinuxRootConvergence;
}

interface StoredGeneration {
  readonly intent: PrivatePythonLinuxHostGenerationIntent;
  readonly bytes: Uint8Array;
}

async function reobserveStoredGeneration(stored: StoredGeneration): Promise<PrivatePythonLinuxHostGeneration> {
  const runtime = await observePrivatePythonNixRuntime({
    pythonPath: rolePath(stored.intent, "python"),
    nixStorePath: rolePath(stored.intent, "nix-store"),
  });
  const observed = await observePrivatePythonLinuxHostGeneration({
    coordinatorPath: rolePath(stored.intent, "coordinator"),
    helperPath: rolePath(stored.intent, "helper"),
    coordinatorBunPath: rolePath(stored.intent, "coordinator-bun"),
    helperBunPath: rolePath(stored.intent, "helper-bun"),
    bubblewrapPath: rolePath(stored.intent, "bubblewrap"),
    bashPath: rolePath(stored.intent, "bash"),
    runtime,
  });
  if (!sameBytes(encodePrivatePythonLinuxHostGeneration(observed), stored.bytes)) {
    unavailable("HOST_ROOT_GENERATION_DRIFT", "stored host generation no longer matches live protected bytes");
  }
  return observed;
}

async function requireStoredGenerationStillLive(
  stored: StoredGeneration,
  prior: PrivatePythonLinuxHostGeneration,
): Promise<void> {
  await verifyPrivatePythonLinuxHostGeneration(prior);
  const fresh = await reobserveStoredGeneration(stored);
  if (fresh.digest !== prior.digest) {
    unavailable("HOST_ROOT_GENERATION_DRIFT", "host generation changed during root verification");
  }
}

function rolePath(
  generation: PrivatePythonLinuxHostGenerationIntent,
  role: PrivatePythonLinuxHostGenerationIntent["roles"][number]["role"],
): string {
  return generation.roles.find((candidate) => candidate.role === role)!.path;
}

function rootConvergence(
  stateRoot: string,
  generationDigest: string,
  roots: readonly PrivatePythonLinuxRootMember[],
): PrivatePythonLinuxRootConvergence {
  const identity = Object.freeze({
    kind: "python-linux-root-convergence/1" as const,
    admissible: false as const,
    generationDigest,
    stateRoot,
    roots: Object.freeze(roots.map((root) => Object.freeze({ ...root }))),
  });
  return Object.freeze({
    ...identity,
    digest: privateDomainDigest(
      "JIG-Python-Linux-Root-Convergence/1",
      identity as unknown as JsonValue,
    ),
  });
}

function authenticateRootConvergence(
  convergence: PrivatePythonLinuxRootConvergence,
): PrivatePythonLinuxRootConvergence {
  authenticRootConvergences.add(convergence);
  return convergence;
}

function stateRootIdentity(root: ProtectedDirectory): PrivatePythonLinuxStateRootIdentity {
  return Object.freeze({
    path: root.visiblePath,
    device: root.information.dev.toString(10),
    inode: root.information.ino.toString(10),
    ownerUid: root.ownerUid.toString(10),
  });
}

async function openRootTree(
  stateRoot: ProtectedDirectory,
  generation: PrivatePythonLinuxHostGenerationIntent,
  create: boolean,
): Promise<RootTree> {
  let collection: ProtectedDirectory | undefined;
  let directory: ProtectedDirectory | undefined;
  try {
    collection = await openProtectedChild(stateRoot, ROOTS_DIRECTORY, create);
    const generationName = generation.digest.slice("sha256:".length);
    await requireExactDirectoryEntries(collection, [generationName], create);
    directory = await openProtectedChild(collection, generationName, create);
    const expectedRoots = Object.freeze(generation.members.map((member, index) => Object.freeze({
      rootPath: join(directory!.visiblePath, memberName(index)),
      storePath: member.storePath,
    })));
    let disposed = false;
    const tree: RootTree = Object.freeze({
      collection,
      generation: directory,
      expectedRoots,
      async verify(requireComplete: boolean): Promise<void> {
        if (disposed) unavailable("HOST_ROOT_STATE_CLOSED", "host root tree is closed");
        await stateRoot.verify();
        await collection!.verify();
        await requireExactDirectoryEntries(collection!, [generationName], false);
        await directory!.verify();
        const names = (await readdir(descriptorPath(directory!))).sort(compareText);
        const expectedNames = expectedRoots.map((_, index) => memberName(index));
        for (const name of names) {
          if (!expectedNames.includes(name)) invalid("HOST_ROOT_ENTRY", `unexpected host root entry ${name}`);
        }
        if (requireComplete && !sameStrings(names, expectedNames)) {
          unavailable("HOST_ROOT_INCOMPLETE", "host generation root set is incomplete");
        }
        for (let index = 0; index < names.length; index += 1) {
          const expectedIndex = expectedNames.indexOf(names[index]!);
          await requireExactRootLink(directory!, expectedRoots[expectedIndex]!);
        }
      },
      async dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        const failures: unknown[] = [];
        try { await directory!.handle.close(); } catch (error) { failures.push(error); }
        try { await collection!.handle.close(); } catch (error) { failures.push(error); }
        if (failures.length > 0) throw new AggregateError(failures, "host root tree did not close");
      },
    });
    return tree;
  } catch (error) {
    await directory?.handle.close().catch(() => undefined);
    await collection?.handle.close().catch(() => undefined);
    throw error;
  }
}

async function ensureExactRootLink(tree: RootTree, root: PrivatePythonLinuxRootMember): Promise<void> {
  const name = root.rootPath.slice(tree.generation.visiblePath.length + 1);
  const path = descriptorChild(tree.generation, name);
  try {
    await lstat(path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
    try {
      await symlink(root.storePath, path);
      await tree.generation.handle.sync();
    } catch (creationError) {
      if (!hasCode(creationError, "EEXIST")) throw creationError;
    }
  }
  await requireExactRootLink(tree.generation, root);
}

async function requireExactRootLink(
  directory: ProtectedDirectory,
  root: PrivatePythonLinuxRootMember,
): Promise<void> {
  const name = root.rootPath.slice(directory.visiblePath.length + 1);
  const descriptor = descriptorChild(directory, name);
  let before: BigIntStats;
  let visible: BigIntStats;
  try {
    [before, visible] = await Promise.all([
      lstat(descriptor, { bigint: true }),
      lstat(root.rootPath, { bigint: true }),
    ]);
  } catch (error) {
    if (hasCode(error, "ENOENT")) unavailable("HOST_ROOT_INCOMPLETE", `host root ${root.rootPath} is absent`);
    throw error;
  }
  requireRootLink(before, directory, root.rootPath);
  requireRootLink(visible, directory, root.rootPath);
  if (!sameIdentity(before, visible)) invalid("HOST_ROOT_CHANGED", `host root ${root.rootPath} has split path identity`);
  let descriptorTarget: string;
  let visibleTarget: string;
  let after: BigIntStats;
  try {
    [descriptorTarget, visibleTarget] = await Promise.all([readlink(descriptor), readlink(root.rootPath)]);
    after = await lstat(descriptor, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) unavailable("HOST_ROOT_INCOMPLETE", `host root ${root.rootPath} changed during verification`);
    throw error;
  }
  if (!sameStableLink(before, after) || descriptorTarget !== root.storePath || visibleTarget !== root.storePath) {
    invalid("HOST_ROOT_TARGET", `host root ${root.rootPath} does not name ${root.storePath}`);
  }
}

function requireRootLink(
  information: BigIntStats,
  directory: ProtectedDirectory,
  label: string,
): void {
  if (!information.isSymbolicLink() || information.uid !== directory.ownerUid ||
      information.nlink !== 1n || information.dev !== directory.information.dev) {
    invalid("HOST_ROOT_ENTRY", `${label} must be one owner-created single-link symlink`);
  }
}

function memberName(index: number): string {
  return `member-${index.toString().padStart(4, "0")}`;
}

async function addNixIndirectRoot(
  executable: string,
  root: PrivatePythonLinuxRootMember,
): Promise<void> {
  const result = await runNix(executable, [
    "--add-root", root.rootPath,
    "--indirect",
    "-r", root.storePath,
  ], "indirect-root registration");
  if (result.stdout !== `${root.rootPath}\n`) {
    throw new Error("Nix indirect-root registration returned unexpected output");
  }
}

async function runNix(
  executable: string,
  operationArguments: readonly string[],
  operation: string,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  requireAbsolutePath(executable, "Nix executable");
  const child = spawn(executable, [
    "--store", "daemon",
    "--option", "substitute", "false",
    "--option", "fallback", "false",
    ...operationArguments,
  ], {
    argv0: "nix-store",
    cwd: "/",
    detached: true,
    env: Object.create(null) as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  const terminate = (): void => {
    if (child.pid !== undefined) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* process group may already be gone */ }
    }
    try { child.kill("SIGKILL"); } catch { /* close is the completion fence */ }
  };
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes <= MAX_NIX_OUTPUT_BYTES) stdoutChunks.push(Buffer.from(chunk));
    else terminate();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes <= MAX_NIX_OUTPUT_BYTES) stderrChunks.push(Buffer.from(chunk));
    else terminate();
  });
  const status = await new Promise<{ readonly code: number | null; readonly signal: string | null }>((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, NIX_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  if (stdoutBytes > MAX_NIX_OUTPUT_BYTES || stderrBytes > MAX_NIX_OUTPUT_BYTES) {
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

async function openRootState(
  requestedRoot: string,
  createDatabase: boolean,
): Promise<RootStateOwner> {
  requireAbsolutePath(requestedRoot, "host state root");
  const visibleRoot = await realpath(requestedRoot).catch((error) => {
    if (hasCode(error, "ENOENT")) unavailable("HOST_ROOT_STATE_MISSING", "host state root does not exist");
    throw error;
  });
  if (visibleRoot !== requestedRoot) invalid("HOST_ROOT_STATE_PATH", "host state root must be a canonical real path");
  const root = await openProtectedDirectory(visibleRoot, undefined);
  let database: SqliteDatabase | undefined;
  try {
    await validateStateEntries(root);
    const descriptorDatabase = descriptorChild(root, DATABASE_NAME);
    const visibleDatabase = join(root.visiblePath, DATABASE_NAME);
    const databaseInformation = await ensureDatabaseFile(
      descriptorDatabase,
      root,
      createDatabase,
    );
    await verifyVisibleFile(visibleDatabase, databaseInformation, root, "host root database");
    await validateSqliteSidecars(root);
    const sqlite = loadSqlite();
    const flags = sqliteFlag(sqlite, "SQLITE_OPEN_READWRITE") |
      sqliteFlag(sqlite, "SQLITE_OPEN_NOFOLLOW");
    database = sqlite.Database.open(visibleDatabase, flags);
    configureConnection(database);
    if (createDatabase) initializeOrVerifySchema(database);
    else verifySchema(database);
    await verifyVisibleFile(visibleDatabase, databaseInformation, root, "host root database");
    await validateSqliteSidecars(root);

    let disposed = false;
    const owner: RootStateOwner = Object.freeze({
      root,
      database,
      databaseInformation,
      async verify(): Promise<void> {
        if (disposed) unavailable("HOST_ROOT_STATE_CLOSED", "host root state is closed");
        await root.verify();
        await verifyVisibleFile(visibleDatabase, databaseInformation, root, "host root database");
        await validateStateEntries(root);
        await validateSqliteSidecars(root);
      },
      async dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        const failures: unknown[] = [];
        try { database!.close(true); } catch (error) { failures.push(error); }
        try { await root.handle.close(); } catch (error) { failures.push(error); }
        if (failures.length > 0) throw new AggregateError(failures, "host root state did not close");
      },
    });
    return owner;
  } catch (error) {
    try { database?.close(true); } catch { /* preserve primary failure */ }
    await root.handle.close().catch(() => undefined);
    if (isSqliteBusy(error)) unavailable("HOST_ROOT_BUSY", "host root publisher is busy");
    throw error;
  }
}

async function openProtectedDirectory(
  visiblePath: string,
  expectedParent: ProtectedDirectory | undefined,
): Promise<ProtectedDirectory> {
  const observed = await lstat(visiblePath, { bigint: true });
  const handle = await open(
    visiblePath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const information = await handle.stat({ bigint: true });
    const ownerUid = expectedParent?.ownerUid ?? BigInt(currentEuid());
    requireProtectedDirectory(information, ownerUid, expectedParent?.information.dev);
    if (!sameIdentity(observed, information)) invalid("HOST_ROOT_STATE_CHANGED", `${visiblePath} changed while opening`);
    const directory: ProtectedDirectory = Object.freeze({
      handle,
      visiblePath,
      information,
      ownerUid,
      async verify(): Promise<void> {
        const [current, actual, resolved] = await Promise.all([
          lstat(visiblePath, { bigint: true }),
          handle.stat({ bigint: true }),
          realpath(visiblePath),
        ]);
        requireProtectedDirectory(current, ownerUid, expectedParent?.information.dev);
        requireProtectedDirectory(actual, ownerUid, expectedParent?.information.dev);
        if (!sameIdentity(information, current) || !sameIdentity(information, actual) || resolved !== visiblePath) {
          invalid("HOST_ROOT_STATE_CHANGED", `${visiblePath} changed during the operation`);
        }
      },
    });
    return directory;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function openProtectedChild(
  parent: ProtectedDirectory,
  name: string,
  create: boolean,
): Promise<ProtectedDirectory> {
  const descriptor = descriptorChild(parent, name);
  const visible = join(parent.visiblePath, name);
  if (create) {
    try {
      await mkdir(descriptor, { mode: 0o700 });
      await parent.handle.sync();
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
  }
  await parent.verify();
  let child: ProtectedDirectory;
  try {
    child = await openProtectedDirectory(descriptor, parent);
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      unavailable("HOST_ROOT_INCOMPLETE", `host root directory ${visible} is absent`);
    }
    if (hasCode(error, "ELOOP") || hasCode(error, "ENOTDIR")) {
      invalid("HOST_ROOT_ENTRY", `host root entry ${visible} is not a protected directory`);
    }
    throw error;
  }
  try {
    const visibleInformation = await lstat(visible, { bigint: true });
    if (!sameIdentity(child.information, visibleInformation)) {
      invalid("HOST_ROOT_STATE_CHANGED", `${visible} has split descriptor and visible identities`);
    }
    const directory: ProtectedDirectory = Object.freeze({
      ...child,
      visiblePath: visible,
      async verify(): Promise<void> {
        await parent.verify();
        const [descriptorInformation, visibleCurrent, actual] = await Promise.all([
          lstat(descriptor, { bigint: true }),
          lstat(visible, { bigint: true }),
          child.handle.stat({ bigint: true }),
        ]);
        requireProtectedDirectory(descriptorInformation, parent.ownerUid, parent.information.dev);
        requireProtectedDirectory(visibleCurrent, parent.ownerUid, parent.information.dev);
        if (!sameIdentity(child.information, descriptorInformation) ||
            !sameIdentity(child.information, visibleCurrent) ||
            !sameIdentity(child.information, actual)) {
          invalid("HOST_ROOT_STATE_CHANGED", `${visible} changed during the operation`);
        }
      },
    });
    return directory;
  } catch (error) {
    await child.handle.close().catch(() => undefined);
    throw error;
  }
}

function requireProtectedDirectory(
  information: BigIntStats,
  ownerUid: bigint,
  expectedDevice?: bigint,
): void {
  if (information.isSymbolicLink() || !information.isDirectory() ||
      information.uid !== ownerUid || (information.mode & 0o7777n) !== 0o700n ||
      (expectedDevice !== undefined && information.dev !== expectedDevice)) {
    invalid("HOST_ROOT_STATE_PERMISSIONS", "host root directories must be owner-only mode 0700 on one filesystem");
  }
}

async function ensureDatabaseFile(
  descriptorPathname: string,
  root: ProtectedDirectory,
  create: boolean,
): Promise<BigIntStats> {
  if (create) {
    let handle: FileHandle | undefined;
    try {
      handle = await open(
        descriptorPathname,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      await handle.sync();
      await handle.close();
      handle = undefined;
      await root.handle.sync();
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!hasCode(error, "EEXIST")) throw error;
    }
  }
  let observed: BigIntStats;
  try {
    observed = await lstat(descriptorPathname, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) unavailable("HOST_ROOT_STATE_MISSING", "host root database does not exist");
    throw error;
  }
  requireDatabaseFile(observed, root.information.dev);
  const handle = await open(descriptorPathname, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const actual = await handle.stat({ bigint: true });
    requireDatabaseFile(actual, root.information.dev);
    if (!sameIdentity(observed, actual)) invalid("HOST_ROOT_STATE_CHANGED", "host root database changed while opening");
    return actual;
  } finally {
    await handle.close();
  }
}

function requireDatabaseFile(information: BigIntStats, expectedDevice: bigint): void {
  if (information.isSymbolicLink() || !information.isFile() || information.nlink !== 1n ||
      information.uid !== BigInt(currentEuid()) || (information.mode & 0o7777n) !== 0o600n ||
      information.dev !== expectedDevice) {
    invalid("HOST_ROOT_DATABASE", "host root database must be one owner-only mode 0600 regular file");
  }
}

async function verifyVisibleFile(
  visiblePath: string,
  expected: BigIntStats,
  root: ProtectedDirectory,
  label: string,
): Promise<void> {
  await root.verify();
  const current = await lstat(visiblePath, { bigint: true });
  requireDatabaseFile(current, root.information.dev);
  if (!sameIdentity(current, expected)) invalid("HOST_ROOT_STATE_CHANGED", `${label} changed during the operation`);
}

async function validateStateEntries(root: ProtectedDirectory): Promise<void> {
  const names = (await readdir(descriptorPath(root))).sort(compareText);
  const allowed = [
    DATABASE_NAME,
    `${DATABASE_NAME}-journal`,
    `${DATABASE_NAME}-shm`,
    `${DATABASE_NAME}-wal`,
    ROOTS_DIRECTORY,
  ];
  for (const name of names) {
    if (!allowed.includes(name)) invalid("HOST_ROOT_STATE_ENTRY", `unexpected host state entry ${name}`);
  }
}

async function validateSqliteSidecars(root: ProtectedDirectory): Promise<void> {
  for (const suffix of ["-wal", "-shm"] as const) {
    if (await pathExists(descriptorChild(root, `${DATABASE_NAME}${suffix}`))) {
      invalid("HOST_ROOT_SQLITE_SIDECAR", `host root database must not use SQLite ${suffix.slice(1).toUpperCase()}`);
    }
  }
  const journalPath = descriptorChild(root, `${DATABASE_NAME}-journal`);
  try {
    const information = await lstat(journalPath, { bigint: true });
    requireDatabaseFile(information, root.information.dev);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

async function requireRootCollectionAbsent(root: ProtectedDirectory): Promise<void> {
  try {
    await lstat(descriptorChild(root, ROOTS_DIRECTORY));
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
  invalid("HOST_ROOT_UNCLAIMED_STATE", "an unclaimed host root tree already exists");
}

async function requireExactDirectoryEntries(
  directory: ProtectedDirectory,
  expected: readonly string[],
  allowMissing: boolean,
): Promise<void> {
  const names = (await readdir(descriptorPath(directory))).sort(compareText);
  for (const name of names) {
    if (!expected.includes(name)) invalid("HOST_ROOT_ENTRY", `unexpected host root directory ${name}`);
  }
  if (!allowMissing && !sameStrings(names, [...expected].sort(compareText))) {
    unavailable("HOST_ROOT_INCOMPLETE", "host root directory set is incomplete");
  }
}

function configureConnection(database: SqliteDatabase): void {
  database.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
  const journal = statement<{ readonly journal_mode: string }>(database, "PRAGMA journal_mode").get();
  const busy = statement<{ readonly timeout: bigint }>(database, "PRAGMA busy_timeout").get()?.timeout;
  if (journal?.journal_mode !== "delete") unavailable("HOST_ROOT_SQLITE", "SQLite DELETE journaling is required");
  database.exec("PRAGMA synchronous=EXTRA;PRAGMA trusted_schema=OFF");
  if (pragmaInteger(database, "synchronous") !== 3n ||
      pragmaInteger(database, "trusted_schema") !== 0n ||
      busy !== BigInt(BUSY_TIMEOUT_MS)) {
    unavailable("HOST_ROOT_SQLITE", "host root SQLite durability settings were not enforced");
  }
}

function initializeOrVerifySchema(database: SqliteDatabase): void {
  try { database.exec("BEGIN IMMEDIATE"); } catch (error) { if (isSqliteBusy(error)) busy(); throw error; }
  try {
    const version = pragmaInteger(database, "user_version");
    const application = pragmaInteger(database, "application_id");
    const existing = schemaRows(database);
    if (version === 0n && application === 0n && existing.length === 0) {
      database.exec(CREATE_GENERATION);
      database.exec(`PRAGMA application_id=${APPLICATION_ID}`);
      database.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
    } else if (version !== SCHEMA_VERSION || application !== APPLICATION_ID) {
      invalid("HOST_ROOT_SCHEMA", "host root database has an unsupported format identity");
    }
    verifySchema(database);
    database.exec("COMMIT");
  } catch (error) {
    rollback(database, error);
  }
}

function verifySchema(database: SqliteDatabase): void {
  if (pragmaInteger(database, "user_version") !== SCHEMA_VERSION ||
      pragmaInteger(database, "application_id") !== APPLICATION_ID) {
    invalid("HOST_ROOT_SCHEMA", "host root database has an unsupported format identity");
  }
  const rows = schemaRows(database);
  if (rows.length !== 1 || rows[0]!.type !== "table" || rows[0]!.name !== "generation" ||
      rows[0]!.table !== "generation" || rows[0]!.sql !== CREATE_GENERATION) {
    corrupt("host root database schema differs from version 1");
  }
  readGeneration(database);
}

function schemaRows(database: SqliteDatabase): readonly SchemaRow[] {
  return statement<SchemaRow>(database,
    "SELECT type, name, tbl_name AS 'table', sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all();
}

function readGeneration(database: SqliteDatabase): GenerationRow | undefined {
  const rows = statement<GenerationRow>(database,
    "SELECT singleton, generation_digest, generation_bytes FROM generation ORDER BY singleton",
  ).all();
  if (rows.length > 1) corrupt("host root generation singleton has multiple rows");
  if (rows.length === 0) return undefined;
  const row = rows[0]!;
  if (row.singleton !== 1n) corrupt("host root generation singleton key is invalid");
  if (typeof row.generation_digest !== "string" || !DIGEST.test(row.generation_digest)) {
    corrupt("stored generation digest is invalid");
  }
  if (!(row.generation_bytes instanceof Uint8Array) || row.generation_bytes.byteLength > MAX_DATABASE_BYTES) {
    corrupt("stored host generation bytes are invalid");
  }
  return Object.freeze({
    singleton: row.singleton,
    generation_digest: row.generation_digest,
    generation_bytes: Uint8Array.from(row.generation_bytes),
  });
}

function requireStoredGeneration(
  database: SqliteDatabase,
  expectedDigest: string,
  expectedBytes?: Uint8Array,
): StoredGeneration {
  const row = readGeneration(database);
  if (row === undefined) unavailable("HOST_ROOT_INTENT_MISSING", "host root generation intent is absent");
  return decodeStoredGeneration(row, expectedDigest, expectedBytes);
}

function decodeStoredGeneration(
  row: GenerationRow,
  expectedDigest: string,
  expectedBytes?: Uint8Array,
): StoredGeneration {
  const bytes = Uint8Array.from(row.generation_bytes);
  let intent: PrivatePythonLinuxHostGenerationIntent;
  try {
    intent = decodePrivatePythonLinuxHostGeneration(bytes);
  } catch (error) {
    corrupt(`stored host generation is invalid: ${errorText(error)}`);
  }
  if (row.generation_digest !== intent.digest) {
    corrupt("stored generation digest does not match its canonical bytes");
  }
  if (intent.digest !== expectedDigest ||
      (expectedBytes !== undefined && !sameBytes(bytes, expectedBytes))) {
    unavailable("HOST_ROOT_GENERATION_CONFLICT", "host root state belongs to a different generation");
  }
  return Object.freeze({ intent, bytes });
}

function requireSameStoredGeneration(
  row: GenerationRow,
  expectedDigest: string,
  expectedBytes: Uint8Array,
): void {
  decodeStoredGeneration(row, expectedDigest, expectedBytes);
}

async function immediate<T>(owner: RootStateOwner, action: () => Promise<T>): Promise<T> {
  try { owner.database.exec("BEGIN IMMEDIATE"); } catch (error) { if (isSqliteBusy(error)) busy(); throw error; }
  try {
    await owner.verify();
    const result = await action();
    await owner.verify();
    owner.database.exec("COMMIT");
    await owner.verify();
    return result;
  } catch (error) {
    rollback(owner.database, error);
  }
}

function rollback(database: SqliteDatabase, cause: unknown): never {
  if (!database.inTransaction) throw cause;
  try { database.exec("ROLLBACK"); } catch (rollbackFailure) {
    throw new AggregateError([cause, rollbackFailure], "host root transaction rollback failed");
  }
  if (isSqliteBusy(cause)) busy();
  throw cause;
}

function statement<Row>(database: SqliteDatabase, sql: string): SqliteStatement<Row> {
  return database.query<Row>(sql).safeIntegers(true);
}

function loadSqlite(): SqliteModule {
  try { return createRequire(import.meta.url)("bun:sqlite") as SqliteModule; }
  catch { unavailable("HOST_ROOT_SQLITE", "Bun SQLite is unavailable"); }
}

function sqliteFlag(sqlite: SqliteModule, name: string): number {
  const value = sqlite.constants[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    unavailable("HOST_ROOT_SQLITE", `Bun SQLite omitted ${name}`);
  }
  return value;
}

function pragmaInteger(database: SqliteDatabase, name: string): bigint | undefined {
  return statement<Record<string, bigint>>(database, `PRAGMA ${name}`).get()?.[name];
}

function isSqliteBusy(error: unknown): boolean {
  let sqlite: SqliteModule;
  try { sqlite = loadSqlite(); } catch { return false; }
  return error instanceof sqlite.SQLiteError &&
    ((error as { readonly errno?: number }).errno === 5 || (error as { readonly errno?: number }).errno === 6);
}

function busy(): never {
  unavailable("HOST_ROOT_BUSY", "another host root publisher holds the generation writer lock");
}

async function disposeOwner(owner: RootStateOwner, failure: unknown): Promise<void> {
  try {
    await owner.dispose();
  } catch (cleanupFailure) {
    if (failure !== undefined) throw new AggregateError([failure, cleanupFailure], "host root operation did not close");
    throw cleanupFailure;
  }
}

async function disposeTree(tree: RootTree, failure: unknown): Promise<void> {
  try {
    await tree.dispose();
  } catch (cleanupFailure) {
    if (failure !== undefined) throw new AggregateError([failure, cleanupFailure], "host root proof did not close");
    throw cleanupFailure;
  }
}

function requireAbsolutePath(value: string, label: string): void {
  if (typeof value !== "string" || !value.startsWith("/") || resolve(value) !== value ||
      /[\u0000\r\n]/u.test(value)) {
    throw new TypeError(`${label} must be a canonical absolute single-line path`);
  }
}

function requireDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} digest must be sha256: followed by 64 lowercase hexadecimal digits`);
  }
}

function currentEuid(): number {
  if (process.geteuid === undefined) unavailable("HOST_ROOT_STATE_UNAVAILABLE", "host roots require a POSIX effective identity");
  return process.geteuid();
}

function descriptorPath(directory: ProtectedDirectory): string {
  return `/proc/self/fd/${directory.handle.fd}`;
}

function descriptorChild(directory: ProtectedDirectory, name: string): string {
  return `${descriptorPath(directory)}/${name}`;
}

function sameIdentity(left: { readonly dev: bigint; readonly ino: bigint }, right: { readonly dev: bigint; readonly ino: bigint }): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableLink(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right) && left.uid === right.uid && left.gid === right.gid &&
    left.mode === right.mode && left.nlink === right.nlink && left.ctimeNs === right.ctimeNs;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if (hasCode(error, "ENOENT")) return false; throw error; }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { readonly code?: unknown }).code === code;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function corrupt(message: string): never {
  invalid("HOST_ROOT_CORRUPT", message);
}
