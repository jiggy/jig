import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

import { invalid, unavailable } from "../diagnostics.js";
import { canonicalJson, JSON_1_LIMITS, type JsonValue } from "../json.js";
import { inspectCapturedPackage, type InspectedPackage } from "../package/inspect.js";
import { isDirectRunEligible } from "../project/flow-source.js";
import { openPrivateProjectRoot, type PrivateProjectRoot } from "../project/root.js";
import { captureStoredPackage, normalizePackageArtifactRef } from "./package-artifact-store.js";
import {
  decodePrivateProjectLocalLock,
  encodePrivateProjectLocalLock,
  type PrivateLockPackage,
} from "./project-local-lock.js";
import {
  createPrivateActivationAdmission,
  createPrivateActivationPlan,
  decodePrivateActivationAdmission,
  decodePrivateActivationCandidate,
  decodePrivateActivationPlan,
  encodePrivateActivationAdmission,
  encodePrivateActivationCandidate,
  encodePrivateActivationPlan,
  privateActivationAdmissionDigest,
  privateActivationCandidateDigest,
  privateActivationPlanDigest,
  requirePrivateCreatedActivationCandidate,
  type PrivateActivationAdmission,
  type PrivateActivationCandidateArtifact,
  type PrivateActivationPlan,
} from "./activation-admission.js";

const STATE_DIRECTORY = ".jig";
const DATABASE_NAME = "private-activation-admission-v3.sqlite3";
const LOCK_NAME = "jig.lock";
const LOCK_STAGE_NAME = "private-activation-jig-lock-v1.stage";
const SCHEMA_VERSION = 3n;
const APPLICATION_ID = 0x4a494733n; // JIG3
const BUSY_TIMEOUT_MS = 250;
const MAX_STORED_BYTES = 16_777_216;
const MAX_SAFE_REVISION = BigInt(Number.MAX_SAFE_INTEGER);
const DIGEST = /^sha256:[0-9a-f]{64}$/;

const CREATE_CANDIDATES = "CREATE TABLE candidates (revision INTEGER PRIMARY KEY CHECK (revision BETWEEN 1 AND 9007199254740991), candidate_digest TEXT NOT NULL, candidate_bytes BLOB NOT NULL CHECK (length(candidate_bytes) BETWEEN 1 AND 16777216), lock_bytes BLOB NOT NULL CHECK (length(lock_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_CANDIDATE_HEAD = "CREATE TABLE candidate_head (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER REFERENCES candidates(revision)) STRICT";
const CREATE_REVIEW_PLANS = "CREATE TABLE review_plans (plan_digest TEXT PRIMARY KEY, candidate_revision INTEGER NOT NULL REFERENCES candidates(revision), plan_bytes BLOB NOT NULL CHECK (length(plan_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_ADMISSIONS = "CREATE TABLE admissions (revision INTEGER PRIMARY KEY CHECK (revision BETWEEN 1 AND 9007199254740991), admission_digest TEXT NOT NULL UNIQUE, base_generation TEXT UNIQUE REFERENCES admissions(admission_digest), plan_digest TEXT NOT NULL UNIQUE REFERENCES review_plans(plan_digest), admission_bytes BLOB NOT NULL CHECK (length(admission_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_ADMISSION_HEAD = "CREATE TABLE admission_head (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER REFERENCES admissions(revision)) STRICT";
const EXPECTED_SCHEMA = Object.freeze([
  Object.freeze({ type: "table", name: "admission_head", table: "admission_head", sql: CREATE_ADMISSION_HEAD }),
  Object.freeze({ type: "table", name: "admissions", table: "admissions", sql: CREATE_ADMISSIONS }),
  Object.freeze({ type: "table", name: "candidate_head", table: "candidate_head", sql: CREATE_CANDIDATE_HEAD }),
  Object.freeze({ type: "table", name: "candidates", table: "candidates", sql: CREATE_CANDIDATES }),
  Object.freeze({ type: "table", name: "review_plans", table: "review_plans", sql: CREATE_REVIEW_PLANS }),
]);

const storedCandidates = new WeakSet<object>();

interface SqliteRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
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
  new (...args: readonly unknown[]): Error & { readonly code?: string; readonly errno?: number };
  readonly prototype: Error & { readonly code?: string; readonly errno?: number };
}

interface SqliteModule {
  readonly Database: { open(path: string, flags?: number): SqliteDatabase };
  readonly SQLiteError: SqliteErrorConstructor;
  readonly constants: Readonly<Record<string, number>>;
}

interface CandidateRow {
  readonly revision: bigint;
  readonly candidate_digest: string;
  readonly candidate_bytes: Uint8Array;
  readonly lock_bytes: Uint8Array;
}

interface CandidateHeadRow {
  readonly singleton: bigint;
  readonly revision: bigint | null;
}

interface CandidateCountRow {
  readonly count: bigint;
  readonly minimum: bigint | null;
  readonly maximum: bigint | null;
}

interface PlanRow {
  readonly plan_digest: string;
  readonly candidate_revision: bigint;
  readonly plan_bytes: Uint8Array;
}

interface AdmissionRow {
  readonly revision: bigint;
  readonly admission_digest: string;
  readonly base_generation: string | null;
  readonly plan_digest: string;
  readonly admission_bytes: Uint8Array;
}

interface AdmissionHeadRow {
  readonly singleton: bigint;
  readonly revision: bigint | null;
}

interface AdmissionCountRow {
  readonly count: bigint;
  readonly minimum: bigint | null;
  readonly maximum: bigint | null;
  readonly roots: bigint | null;
}

interface StateOwner {
  readonly root: PrivateProjectRoot;
  readonly directory: FileHandle;
  readonly database: SqliteDatabase;
  verify(): Promise<void>;
  finish(): Promise<void>;
  dispose(): Promise<void>;
}

interface ReacquiredArtifacts { dispose(): Promise<void> }

export interface PrivateActivationCandidateHead {
  readonly candidateRevision: number;
  readonly candidateDigest: string;
}

export interface PrivateActivationReviewPlan {
  readonly plan: PrivateActivationPlan;
  readonly planBytes: Uint8Array;
  readonly planDigest: string;
  readonly candidate: PrivateActivationCandidateArtifact;
}

export interface PrivateActivationAdmissionReceipt {
  readonly admission: PrivateActivationAdmission;
  readonly admissionBytes: Uint8Array;
  readonly admissionDigest: string;
}

/** Persist a factory-produced proposal as the monotonic activation head. */
export async function publishPrivateActivationCandidate(input: {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly candidate: PrivateActivationCandidateArtifact;
}): Promise<PrivateActivationCandidateHead> {
  const created = requirePrivateCreatedActivationCandidate(input.candidate);
  const encoded = encodePrivateActivationCandidate(created);
  requireStoredSize(encoded.candidate, "candidate");
  requireStoredSize(encoded.lock, "candidate lock");
  const candidateDigest = privateActivationCandidateDigest(created);
  const owner = await openStateOwner(input.projectRoot, true);
  let artifacts: ReacquiredArtifacts | undefined;
  let failure: unknown;
  try {
    requireCandidateRoot(created, owner.root);
    artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot, created);
    const result = await immediate(owner, () => {
      const head = readCandidateHead(owner.database, owner.root);
      if (head.revision !== null) {
        const latestRow = requireCandidateRow(owner.database, head.revision);
        const latest = loadCandidateRow(latestRow);
        requireCandidateRoot(latest, owner.root);
        if (latestRow.candidate_digest === candidateDigest) {
          const prior = encodePrivateActivationCandidate(latest);
          if (!sameBytes(prior.candidate, encoded.candidate) || !sameBytes(prior.lock, encoded.lock)) {
            corrupt("latest candidate digest names different canonical bytes");
          }
          return Object.freeze({
            candidateRevision: safeRevision(latestRow.revision),
            candidateDigest,
          });
        }
      }
      const next = head.revision === null ? 1n : head.revision + 1n;
      if (next > MAX_SAFE_REVISION) {
        unavailable("ADMISSION_REVISION_EXHAUSTED", "private admission candidate revision is exhausted");
      }
      statement<never>(owner.database,
        "INSERT INTO candidates(revision, candidate_digest, candidate_bytes, lock_bytes) VALUES (?1, ?2, ?3, ?4)",
      ).run(next, candidateDigest, encoded.candidate, encoded.lock);
      const changed = statement<never>(owner.database,
        "UPDATE candidate_head SET revision = ?1 WHERE singleton = 1 AND revision IS ?2",
      ).run(next, head.revision).changes;
      if (changed !== 1) corrupt("candidate head compare-and-set did not update exactly one row");
      readCandidateHead(owner.database, owner.root);
      return Object.freeze({ candidateRevision: Number(next), candidateDigest });
    });
    await owner.finish();
    return result;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, artifacts, failure);
  }
}

/** Observe and persist one inert plan for the current activation head. */
export async function createPrivateActivationReviewPlan(input: {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly lockMode: "update" | "locked";
}): Promise<PrivateActivationReviewPlan> {
  requireLockMode(input.lockMode);
  const owner = await openStateOwner(input.projectRoot, false);
  let artifacts: ReacquiredArtifacts | undefined;
  let failure: unknown;
  try {
    const initialHead = readCandidateHead(owner.database, owner.root);
    if (initialHead.revision === null) {
      unavailable("ADMISSION_CANDIDATE_MISSING", "no activation candidate has been published");
    }
    const initialRow = requireCandidateRow(owner.database, initialHead.revision);
    const candidate = loadCandidateRow(initialRow);
    requireCandidateRoot(candidate, owner.root);
    artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot, candidate);
    const persisted = await immediate(owner, async () => {
      const currentHead = readCandidateHead(owner.database, owner.root);
      if (currentHead.revision !== initialRow.revision) candidateChanged();
      const currentRow = requireCandidateRow(owner.database, initialRow.revision);
      requireSameCandidateRow(initialRow, currentRow);
      const admissionHead = readAdmissionHead(owner.database, owner.root);
      const observed = await observeVisibleLock(owner.root);
      const proposed = encodePrivateProjectLocalLock(candidate.lock);
      if (input.lockMode === "locked" && (
        observed.state !== "present" || !sameBytes(observed.bytes, proposed)
      )) {
        invalid("LOCK_MISMATCH", "locked planning requires the exact proposed jig.lock bytes");
      }
      const plan = createPrivateActivationPlan({
        candidateDigest: currentRow.candidate_digest,
        candidateRevision: safeRevision(currentRow.revision),
        baseGeneration: admissionHead.revision === null
          ? null
          : requireAdmissionRow(owner.database, admissionHead.revision).admission_digest,
        lockMode: input.lockMode,
        observedLock: observed.state === "absent"
          ? { state: "absent" }
          : { state: "present", digest: observed.digest },
      });
      const planBytes = encodePrivateActivationPlan(plan);
      requireStoredSize(planBytes, "review plan");
      const planDigest = privateActivationPlanDigest(plan);
      persistReviewPlan(owner.database, {
        plan_digest: planDigest,
        candidate_revision: currentRow.revision,
        plan_bytes: planBytes,
      });
      return Object.freeze({ plan, planBytes, planDigest, candidate });
    });
    await owner.finish();
    return Object.freeze({ ...persisted, candidate: markStored(persisted.candidate) });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, artifacts, failure);
  }
}

/** Reopen one persisted plan and reprove its candidate's protected artifacts. */
export async function loadPrivateActivationReviewPlan(input: {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly planDigest: string;
}): Promise<PrivateActivationReviewPlan> {
  requireDigest(input.planDigest, "review plan");
  const owner = await openStateOwner(input.projectRoot, false);
  let artifacts: ReacquiredArtifacts | undefined;
  let failure: unknown;
  try {
    readCandidateHead(owner.database, owner.root);
    readAdmissionHead(owner.database, owner.root);
    const initialPlanRow = requirePlanRow(owner.database, input.planDigest);
    const plan = loadPlanRow(initialPlanRow);
    requirePlanBase(owner.database, plan, owner.root);
    const initialCandidateRow = requireCandidateRow(owner.database, initialPlanRow.candidate_revision);
    const candidate = loadCandidateRow(initialCandidateRow);
    crossCheckPlanCandidate(plan, initialPlanRow, initialCandidateRow);
    requireCandidateRoot(candidate, owner.root);
    artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot, candidate);
    await immediate(owner, () => {
      readCandidateHead(owner.database, owner.root);
      readAdmissionHead(owner.database, owner.root);
      const currentPlanRow = requirePlanRow(owner.database, input.planDigest);
      const currentCandidateRow = requireCandidateRow(owner.database, initialPlanRow.candidate_revision);
      requireSamePlanRow(initialPlanRow, currentPlanRow);
      requireSameCandidateRow(initialCandidateRow, currentCandidateRow);
      crossCheckPlanCandidate(plan, currentPlanRow, currentCandidateRow);
      requirePlanBase(owner.database, plan, owner.root);
    });
    await owner.finish();
    return Object.freeze({
      plan,
      planBytes: copiedBlob(initialPlanRow.plan_bytes, "stored review plan"),
      planDigest: input.planDigest,
      candidate: markStored(candidate),
    });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, artifacts, failure);
  }
}

/**
 * Durably converge the visible lock, then advance one activation admission
 * generation. The returned canonical record is the idempotent receipt.
 */
export async function applyPrivateActivationReviewPlan(input: {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly planDigest: string;
  readonly baseGeneration: string | null;
}): Promise<PrivateActivationAdmissionReceipt> {
  requireDigest(input.planDigest, "review plan");
  if (input.baseGeneration !== null) requireDigest(input.baseGeneration, "expected base generation");
  const owner = await openStateOwner(input.projectRoot, false);
  let artifacts: ReacquiredArtifacts | undefined;
  let failure: unknown;
  try {
    const initialPlanRow = requirePlanRow(owner.database, input.planDigest);
    const plan = loadPlanRow(initialPlanRow);
    if (plan.baseGeneration !== input.baseGeneration) stale("apply base differs from the reviewed plan");

    const committed = findAdmissionByPlan(owner.database, input.planDigest);
    if (committed !== null) {
      const receipt = loadAndCrossCheckAdmission(owner.database, committed, owner.root);
      await owner.finish();
      return receipt;
    }

    const initialCandidateRow = requireCandidateRow(owner.database, initialPlanRow.candidate_revision);
    const candidate = loadCandidateRow(initialCandidateRow);
    crossCheckPlanCandidate(plan, initialPlanRow, initialCandidateRow);
    requirePlanBase(owner.database, plan, owner.root);
    requireCandidateRoot(candidate, owner.root);
    artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot, candidate);

    const receipt = await immediate(owner, async () => {
      const raced = findAdmissionByPlan(owner.database, input.planDigest);
      if (raced !== null) return loadAndCrossCheckAdmission(owner.database, raced, owner.root);

      const currentPlanRow = requirePlanRow(owner.database, input.planDigest);
      const currentCandidateRow = requireCandidateRow(owner.database, initialPlanRow.candidate_revision);
      requireSamePlanRow(initialPlanRow, currentPlanRow);
      requireSameCandidateRow(initialCandidateRow, currentCandidateRow);
      crossCheckPlanCandidate(plan, currentPlanRow, currentCandidateRow);
      requirePlanBase(owner.database, plan, owner.root);

      const candidateHead = readCandidateHead(owner.database, owner.root);
      if (
        candidateHead.revision !== currentCandidateRow.revision ||
        currentCandidateRow.candidate_digest !== plan.candidateDigest
      ) stale("reviewed candidate is no longer the candidate head");
      const admissionHead = readAdmissionHead(owner.database, owner.root);
      const currentBase = admissionHead.revision === null
        ? null
        : requireAdmissionRow(owner.database, admissionHead.revision).admission_digest;
      if (currentBase !== plan.baseGeneration) stale("reviewed base generation is no longer active");

      const proposedLock = encodePrivateProjectLocalLock(candidate.lock);
      await convergeVisibleLock(owner, plan, proposedLock);

      const finalCandidateHead = readCandidateHead(owner.database, owner.root);
      if (finalCandidateHead.revision !== currentCandidateRow.revision) {
        stale("candidate head changed during lock publication");
      }
      const finalAdmissionHead = readAdmissionHead(owner.database, owner.root);
      if (finalAdmissionHead.revision !== admissionHead.revision) {
        stale("admission head changed during lock publication");
      }
      const finalPlanRow = requirePlanRow(owner.database, input.planDigest);
      const finalCandidateRow = requireCandidateRow(owner.database, currentCandidateRow.revision);
      requireSamePlanRow(currentPlanRow, finalPlanRow);
      requireSameCandidateRow(currentCandidateRow, finalCandidateRow);

      const admission = createPrivateActivationAdmission({
        baseGeneration: plan.baseGeneration,
        planDigest: input.planDigest,
        candidateRevision: safeRevision(finalCandidateRow.revision),
        candidateDigest: finalCandidateRow.candidate_digest,
        lockDigest: candidate.candidate.lockDigest,
      });
      const admissionBytes = encodePrivateActivationAdmission(admission);
      requireStoredSize(admissionBytes, "activation admission");
      const admissionDigest = privateActivationAdmissionDigest(admission);
      const next = admissionHead.revision === null ? 1n : admissionHead.revision + 1n;
      if (next > MAX_SAFE_REVISION) {
        unavailable("ADMISSION_REVISION_EXHAUSTED", "private admission generation revision is exhausted");
      }
      statement<never>(owner.database,
        "INSERT INTO admissions(revision, admission_digest, base_generation, plan_digest, admission_bytes) VALUES (?1, ?2, ?3, ?4, ?5)",
      ).run(
        next,
        admissionDigest,
        plan.baseGeneration,
        input.planDigest,
        admissionBytes,
      );
      const changed = statement<never>(owner.database,
        "UPDATE admission_head SET revision = ?1 WHERE singleton = 1 AND revision IS ?2",
      ).run(next, admissionHead.revision).changes;
      if (changed !== 1) corrupt("admission head compare-and-set did not update exactly one row");
      const applied = requireAdmissionRow(owner.database, next);
      const stored = loadAndCrossCheckAdmission(owner.database, applied, owner.root);
      readAdmissionHead(owner.database, owner.root);
      return stored;
    });
    await owner.finish();
    return receipt;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, artifacts, failure);
  }
}

/** Require restart provenance minted by this store, not by the byte decoder. */
export function requirePrivateStoredActivationCandidate(value: unknown): PrivateActivationCandidateArtifact {
  if (value === null || typeof value !== "object" || !storedCandidates.has(value)) {
    throw new TypeError("activation candidate has not been reverified from protected storage");
  }
  return value as PrivateActivationCandidateArtifact;
}

async function openStateOwner(projectRoot: string, create: boolean): Promise<StateOwner> {
  const root = await openPrivateProjectRoot(projectRoot);
  let directory: FileHandle | undefined;
  let database: SqliteDatabase | undefined;
  try {
    const statePath = descriptorChild(root.handle, STATE_DIRECTORY);
    if (create) {
      try {
        await mkdir(statePath, { mode: 0o700 });
        await root.handle.sync();
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
    }
    directory = await openCheckedDirectory(statePath, root.information.dev);
    const directoryInformation = await directory.stat({ bigint: true });
    if (create) await root.handle.sync();
    const databasePath = descriptorChild(directory, DATABASE_NAME);
    const databaseInformation = await ensureDatabaseFile(
      databasePath,
      directory,
      directoryInformation.dev,
      create,
    );
    await validateSidecars(directory, databaseInformation.dev);
    const visibleStatePath = join(root.requestedPath, STATE_DIRECTORY);
    const visibleDatabasePath = join(visibleStatePath, DATABASE_NAME);
    await verifyVisibleHierarchy(
      root,
      visibleStatePath,
      directoryInformation,
      visibleDatabasePath,
      databaseInformation,
    );
    const sqlite = loadSqlite();
    const flags = sqliteFlag(sqlite, "SQLITE_OPEN_READWRITE") |
      sqliteFlag(sqlite, "SQLITE_OPEN_NOFOLLOW");
    database = sqlite.Database.open(visibleDatabasePath, flags);
    await verifyVisibleHierarchy(
      root,
      visibleStatePath,
      directoryInformation,
      visibleDatabasePath,
      databaseInformation,
    );
    configureConnection(database);
    initializeOrVerifySchema(database, root);
    await verifyPathIdentity(
      databasePath,
      databaseInformation,
      "admission database",
      (information) => requireDatabaseFile(information, directoryInformation.dev),
    );
    await validateSidecars(directory, databaseInformation.dev);

    let databaseClosed = false;
    let disposed = false;
    const owner: StateOwner = Object.freeze({
      root,
      directory,
      database,
      async verify(): Promise<void> {
        if (disposed) unavailable("ADMISSION_STATE_CLOSED", "admission state owner has been disposed");
        await root.verify();
        await verifyPathIdentity(
          statePath,
          directoryInformation,
          "admission state directory",
          (information) => requireStateDirectory(information, root.information.dev),
        );
        await verifyPathIdentity(
          databasePath,
          databaseInformation,
          "admission database",
          (information) => requireDatabaseFile(information, directoryInformation.dev),
        );
        await verifyVisibleHierarchy(
          root,
          visibleStatePath,
          directoryInformation,
          visibleDatabasePath,
          databaseInformation,
        );
        await validateSidecars(directory!, databaseInformation.dev);
      },
      async finish(): Promise<void> {
        if (disposed) unavailable("ADMISSION_STATE_CLOSED", "admission state owner has been disposed");
        await owner.verify();
        database!.close(true);
        databaseClosed = true;
        await owner.verify();
      },
      async dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        const failures: unknown[] = [];
        if (!databaseClosed) {
          try { database!.close(true); } catch (error) { failures.push(error); }
          databaseClosed = true;
        }
        try { await directory!.close(); } catch (error) { failures.push(error); }
        try { await root.dispose(); } catch (error) { failures.push(error); }
        if (failures.length > 0) throw new AggregateError(failures, "admission state cleanup did not complete");
      },
    });
    return owner;
  } catch (error) {
    try { database?.close(true); } catch { /* preserve the primary open failure */ }
    await directory?.close().catch(() => undefined);
    await root.dispose().catch(() => undefined);
    if (isSqliteBusy(error)) busy();
    throw error;
  }
}

async function openCheckedDirectory(path: string, projectDevice: bigint): Promise<FileHandle> {
  let observed: BigIntStats;
  try {
    observed = await lstat(path, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) unavailable("ADMISSION_STATE_MISSING", "protected .jig admission state does not exist");
    throw error;
  }
  requireStateDirectory(observed, projectDevice);
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const information = await handle.stat({ bigint: true });
    requireStateDirectory(information, projectDevice);
    if (!sameIdentity(observed, information)) {
      invalid("ADMISSION_STATE_CHANGED", "protected .jig admission state changed while opening");
    }
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

function requireStateDirectory(information: BigIntStats, projectDevice: bigint): void {
  if (information.isSymbolicLink() || !information.isDirectory()) {
    invalid("ADMISSION_STATE_KIND", "protected .jig admission state must be a real directory");
  }
  if (information.uid !== BigInt(currentEuid()) || (information.mode & 0o7777n) !== 0o700n) {
    invalid("ADMISSION_STATE_PERMISSIONS", "protected .jig admission state must be owner-only mode 0700");
  }
  if (information.dev !== projectDevice) {
    unavailable("ADMISSION_STATE_FILESYSTEM", "protected .jig admission state must share the project filesystem");
  }
}

async function ensureDatabaseFile(
  path: string,
  directory: FileHandle,
  expectedDevice: bigint,
  create: boolean,
): Promise<BigIntStats> {
  if (create) {
    let handle: FileHandle | undefined;
    try {
      handle = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await directory.sync();
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!hasCode(error, "EEXIST")) throw error;
    }
  }
  let observed: BigIntStats;
  try {
    observed = await lstat(path, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) unavailable("ADMISSION_STATE_MISSING", "private activation admission database does not exist");
    throw error;
  }
  requireDatabaseFile(observed, expectedDevice);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const information = await handle.stat({ bigint: true });
    requireDatabaseFile(information, expectedDevice);
    if (!sameIdentity(observed, information)) invalid("ADMISSION_STATE_CHANGED", "private activation admission database changed while opening");
    if (create) await handle.sync();
    return information;
  } finally {
    await handle.close();
    if (create) await directory.sync();
  }
}

function requireDatabaseFile(information: BigIntStats, expectedDevice: bigint): void {
  if (
    information.isSymbolicLink() || !information.isFile() || information.nlink !== 1n ||
    information.uid !== BigInt(currentEuid()) || (information.mode & 0o7777n) !== 0o600n ||
    information.dev !== expectedDevice
  ) {
    invalid("ADMISSION_DATABASE_PERMISSIONS", "private activation admission database must be a single-link owner-only mode 0600 regular file");
  }
}

async function validateSidecars(directory: FileHandle, expectedDevice: bigint): Promise<void> {
  for (const suffix of ["-wal", "-shm"] as const) {
    if (await pathExists(descriptorChild(directory, `${DATABASE_NAME}${suffix}`))) {
      invalid("ADMISSION_SQLITE_SIDECAR", `private admission database must not use SQLite ${suffix.slice(1).toUpperCase()} state`);
    }
  }
  const journalPath = descriptorChild(directory, `${DATABASE_NAME}-journal`);
  let journal: BigIntStats;
  try {
    journal = await lstat(journalPath, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
  if (
    journal.isSymbolicLink() || !journal.isFile() || journal.nlink !== 1n ||
    journal.uid !== BigInt(currentEuid()) || (journal.mode & 0o7777n) !== 0o600n || journal.dev !== expectedDevice
  ) {
    invalid("ADMISSION_SQLITE_SIDECAR", "private admission rollback journal has unsafe filesystem identity");
  }
}

function configureConnection(database: SqliteDatabase): void {
  database.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
  const journal = statement<{ readonly journal_mode: string }>(database, "PRAGMA journal_mode").get();
  if (journal?.journal_mode !== "delete") unavailable("ADMISSION_SQLITE_DURABILITY", "SQLite DELETE rollback journaling is required");
  database.exec(["PRAGMA synchronous=EXTRA", "PRAGMA foreign_keys=ON", "PRAGMA trusted_schema=OFF"].join(";"));
  const busy = statement<{ readonly timeout: bigint }>(database, "PRAGMA busy_timeout").get()?.timeout;
  if (
    pragmaInteger(database, "synchronous") !== 3n || pragmaInteger(database, "foreign_keys") !== 1n ||
    pragmaInteger(database, "trusted_schema") !== 0n || busy !== BigInt(BUSY_TIMEOUT_MS)
  ) unavailable("ADMISSION_SQLITE_DURABILITY", "SQLite admission durability PRAGMAs were not enforced");
}

function initializeOrVerifySchema(database: SqliteDatabase, root: PrivateProjectRoot): void {
  try { database.exec("BEGIN IMMEDIATE"); } catch (error) { if (isSqliteBusy(error)) busy(); throw error; }
  try {
    const version = pragmaInteger(database, "user_version");
    const application = pragmaInteger(database, "application_id");
    const existing = schemaRows(database);
    if (version === 0n && application === 0n && existing.length === 0) {
      database.exec(CREATE_CANDIDATES);
      database.exec(CREATE_CANDIDATE_HEAD);
      database.exec(CREATE_REVIEW_PLANS);
      database.exec(CREATE_ADMISSIONS);
      database.exec(CREATE_ADMISSION_HEAD);
      database.exec("INSERT INTO candidate_head(singleton, revision) VALUES (1, NULL)");
      database.exec("INSERT INTO admission_head(singleton, revision) VALUES (1, NULL)");
      database.exec(`PRAGMA application_id=${APPLICATION_ID}`);
      database.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
    } else if (version !== SCHEMA_VERSION || application !== APPLICATION_ID) {
      invalid("ADMISSION_SCHEMA_VERSION", "private admission database has an unsupported format identity");
    }
    verifySchema(database, root);
    database.exec("COMMIT");
  } catch (error) { rollback(database, error); }
}

function verifySchema(database: SqliteDatabase, root: PrivateProjectRoot): void {
  const actual = schemaRows(database);
  if (actual.length !== EXPECTED_SCHEMA.length || actual.some((row, index) => {
    const expected = EXPECTED_SCHEMA[index]!;
    return row.type !== expected.type || row.name !== expected.name || row.table !== expected.table || row.sql !== expected.sql;
  })) corrupt("private admission database schema differs from version 3");
  if (statement<Record<string, unknown>>(database, "PRAGMA foreign_key_check").all().length !== 0) {
    corrupt("private admission database has broken foreign keys");
  }
  readCandidateHead(database, root);
  readAdmissionHead(database, root);
}

function schemaRows(database: SqliteDatabase): readonly { readonly type: string; readonly name: string; readonly table: string; readonly sql: string }[] {
  return statement<{ readonly type: string; readonly name: string; readonly table: string; readonly sql: string }>(database,
    "SELECT type, name, tbl_name AS 'table', sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all();
}

async function immediate<T>(owner: StateOwner, action: () => Promise<T> | T): Promise<T> {
  try { owner.database.exec("BEGIN IMMEDIATE"); } catch (error) { if (isSqliteBusy(error)) busy(); throw error; }
  try {
    await owner.verify();
    const value = await action();
    await owner.verify();
    owner.database.exec("COMMIT");
    await owner.verify();
    return value;
  } catch (error) { rollback(owner.database, error); }
}

function rollback(database: SqliteDatabase, cause: unknown): never {
  if (!database.inTransaction) throw cause;
  try { database.exec("ROLLBACK"); } catch (rollbackFailure) {
    throw new AggregateError([cause, rollbackFailure], "admission transaction rollback failed");
  }
  if (isSqliteBusy(cause)) busy();
  throw cause;
}

function readCandidateHead(database: SqliteDatabase, root: PrivateProjectRoot): CandidateHeadRow {
  const heads = statement<CandidateHeadRow>(database, "SELECT singleton, revision FROM candidate_head").all();
  if (heads.length !== 1 || heads[0]!.singleton !== 1n) corrupt("candidate head singleton is invalid");
  const head = heads[0]!;
  const counts = statement<CandidateCountRow>(database,
    "SELECT count(*) AS count, min(revision) AS minimum, max(revision) AS maximum FROM candidates",
  ).all();
  if (counts.length !== 1) corrupt("candidate revision aggregate is invalid");
  const count = counts[0]!;
  if (count.count === 0n) {
    if (head.revision !== null || count.minimum !== null || count.maximum !== null) corrupt("empty candidate store has a non-empty head");
    return head;
  }
  if (
    head.revision === null || count.minimum !== 1n || count.maximum !== head.revision ||
    count.count !== head.revision || head.revision > MAX_SAFE_REVISION
  ) corrupt("candidate revisions are not one contiguous monotonic head");
  const candidate = loadCandidateRow(requireCandidateRow(database, head.revision));
  requireCandidateRoot(candidate, root);
  return head;
}

function readAdmissionHead(database: SqliteDatabase, root: PrivateProjectRoot): AdmissionHeadRow {
  const heads = statement<AdmissionHeadRow>(database, "SELECT singleton, revision FROM admission_head").all();
  if (heads.length !== 1 || heads[0]!.singleton !== 1n) corrupt("admission head singleton is invalid");
  const head = heads[0]!;
  const counts = statement<AdmissionCountRow>(database,
    "SELECT count(*) AS count, min(revision) AS minimum, max(revision) AS maximum, sum(CASE WHEN base_generation IS NULL THEN 1 ELSE 0 END) AS roots FROM admissions",
  ).all();
  if (counts.length !== 1) corrupt("admission revision aggregate is invalid");
  const count = counts[0]!;
  if (count.count === 0n) {
    if (
      head.revision !== null || count.minimum !== null || count.maximum !== null ||
      (count.roots !== 0n && count.roots !== null)
    ) corrupt("empty admission store has a non-empty head");
    return head;
  }
  if (
    head.revision === null || count.minimum !== 1n || count.maximum !== head.revision ||
    count.count !== head.revision || count.roots !== 1n || head.revision > MAX_SAFE_REVISION
  ) corrupt("admission revisions are not one contiguous linear head");
  for (let revision = 1n; revision <= head.revision; revision += 1n) {
    loadAndCrossCheckAdmission(database, requireAdmissionRow(database, revision), root);
  }
  return head;
}

function requireCandidateRow(database: SqliteDatabase, revision: bigint): CandidateRow {
  const rows = statement<CandidateRow>(database,
    "SELECT revision, candidate_digest, candidate_bytes, lock_bytes FROM candidates WHERE revision = ?1",
  ).all(revision);
  if (rows.length !== 1) corrupt(`candidate revision ${revision} is missing or duplicated`);
  return rows[0]!;
}

function requirePlanRow(database: SqliteDatabase, digest: string): PlanRow {
  const rows = statement<PlanRow>(database,
    "SELECT plan_digest, candidate_revision, plan_bytes FROM review_plans WHERE plan_digest = ?1",
  ).all(digest);
  if (rows.length === 0) unavailable("ADMISSION_PLAN_MISSING", `review plan ${digest} does not exist`);
  if (rows.length !== 1) corrupt(`review plan ${digest} is duplicated`);
  return rows[0]!;
}

function requireAdmissionRow(database: SqliteDatabase, revision: bigint): AdmissionRow {
  const rows = statement<AdmissionRow>(database,
    "SELECT revision, admission_digest, base_generation, plan_digest, admission_bytes FROM admissions WHERE revision = ?1",
  ).all(revision);
  if (rows.length !== 1) corrupt(`admission revision ${revision} is missing or duplicated`);
  return rows[0]!;
}

function findAdmissionByPlan(database: SqliteDatabase, planDigest: string): AdmissionRow | null {
  const rows = statement<AdmissionRow>(database,
    "SELECT revision, admission_digest, base_generation, plan_digest, admission_bytes FROM admissions WHERE plan_digest = ?1",
  ).all(planDigest);
  if (rows.length > 1) corrupt(`plan ${planDigest} names multiple admissions`);
  return rows[0] ?? null;
}

function requireAdmissionByDigest(database: SqliteDatabase, digest: string): AdmissionRow {
  const rows = statement<AdmissionRow>(database,
    "SELECT revision, admission_digest, base_generation, plan_digest, admission_bytes FROM admissions WHERE admission_digest = ?1",
  ).all(digest);
  if (rows.length !== 1) corrupt(`base admission ${digest} is missing or duplicated`);
  return rows[0]!;
}

function loadCandidateRow(row: CandidateRow): PrivateActivationCandidateArtifact {
  safeRevision(row.revision);
  const candidate = copiedBlob(row.candidate_bytes, "stored candidate");
  const lock = copiedBlob(row.lock_bytes, "stored candidate lock");
  requireStoredSize(candidate, "stored candidate");
  requireStoredSize(lock, "stored candidate lock");
  const decoded = decodePrivateActivationCandidate({ candidate, lock });
  if (privateActivationCandidateDigest(decoded) !== row.candidate_digest) corrupt("stored candidate row digest does not match canonical bytes");
  return decoded;
}

function loadPlanRow(row: PlanRow): PrivateActivationPlan {
  safeRevision(row.candidate_revision);
  requireDigest(row.plan_digest, "stored review plan");
  const bytes = copiedBlob(row.plan_bytes, "stored review plan");
  requireStoredSize(bytes, "stored review plan");
  const plan = decodePrivateActivationPlan(bytes);
  if (privateActivationPlanDigest(plan) !== row.plan_digest) corrupt("stored review plan digest does not match canonical bytes");
  return plan;
}

function loadAdmissionRow(row: AdmissionRow): PrivateActivationAdmission {
  safeRevision(row.revision);
  requireDigest(row.admission_digest, "stored admission");
  if (row.base_generation !== null) requireDigest(row.base_generation, "stored admission base");
  requireDigest(row.plan_digest, "stored admission plan");
  const bytes = copiedBlob(row.admission_bytes, "stored activation admission");
  requireStoredSize(bytes, "stored activation admission");
  const admission = decodePrivateActivationAdmission(bytes);
  if (privateActivationAdmissionDigest(admission) !== row.admission_digest) {
    corrupt("stored admission row digest does not match canonical bytes");
  }
  return admission;
}

function persistReviewPlan(database: SqliteDatabase, row: PlanRow): void {
  const existing = statement<PlanRow>(database,
    "SELECT plan_digest, candidate_revision, plan_bytes FROM review_plans WHERE plan_digest = ?1",
  ).get(row.plan_digest);
  if (existing !== null) {
    requireSamePlanRow(existing, row);
    loadPlanRow(existing);
    return;
  }
  statement<never>(database,
    "INSERT INTO review_plans(plan_digest, candidate_revision, plan_bytes) VALUES (?1, ?2, ?3)",
  ).run(row.plan_digest, row.candidate_revision, row.plan_bytes);
}

function crossCheckPlanCandidate(plan: PrivateActivationPlan, planRow: PlanRow, candidate: CandidateRow): void {
  if (
    plan.candidateRevision !== safeRevision(planRow.candidate_revision) || planRow.candidate_revision !== candidate.revision ||
    plan.candidateDigest !== candidate.candidate_digest
  ) corrupt("review plan does not name its stored candidate row exactly");
}

function requirePlanBase(
  database: SqliteDatabase,
  plan: PrivateActivationPlan,
  root: PrivateProjectRoot,
): void {
  if (plan.baseGeneration === null) return;
  const base = requireAdmissionByDigest(database, plan.baseGeneration);
  loadAndCrossCheckAdmission(database, base, root);
}

function loadAndCrossCheckAdmission(
  database: SqliteDatabase,
  row: AdmissionRow,
  root: PrivateProjectRoot,
): PrivateActivationAdmissionReceipt {
  const admission = loadAdmissionRow(row);
  const planRow = requirePlanRow(database, row.plan_digest);
  const plan = loadPlanRow(planRow);
  const candidateRow = requireCandidateRow(database, planRow.candidate_revision);
  const candidate = loadCandidateRow(candidateRow);
  requireCandidateRoot(candidate, root);
  crossCheckPlanCandidate(plan, planRow, candidateRow);
  if (
    admission.baseGeneration !== row.base_generation ||
    admission.baseGeneration !== plan.baseGeneration ||
    admission.planDigest !== row.plan_digest ||
    admission.candidateRevision !== safeRevision(planRow.candidate_revision) ||
    admission.candidateRevision !== plan.candidateRevision ||
    admission.candidateDigest !== candidateRow.candidate_digest ||
    admission.candidateDigest !== plan.candidateDigest ||
    admission.lockDigest !== candidate.candidate.lockDigest
  ) corrupt("stored admission does not match its plan and candidate closure");
  if (row.revision === 1n) {
    if (admission.baseGeneration !== null) corrupt("first admission has a non-null base generation");
  } else {
    if (admission.baseGeneration === null) corrupt("later admission has a null base generation");
    const prior = requireAdmissionRow(database, row.revision - 1n);
    if (prior.admission_digest !== admission.baseGeneration) {
      corrupt("admission base is not the immediately preceding generation");
    }
  }
  return Object.freeze({
    admission,
    admissionBytes: copiedBlob(row.admission_bytes, "stored activation admission"),
    admissionDigest: row.admission_digest,
  });
}

function requireSameCandidateRow(left: CandidateRow, right: CandidateRow): void {
  if (
    left.revision !== right.revision || left.candidate_digest !== right.candidate_digest ||
    !sameBytes(copiedBlob(left.candidate_bytes, "candidate"), copiedBlob(right.candidate_bytes, "candidate")) ||
    !sameBytes(copiedBlob(left.lock_bytes, "candidate lock"), copiedBlob(right.lock_bytes, "candidate lock"))
  ) corrupt("one candidate revision changed its immutable persisted row");
}

function requireSamePlanRow(left: PlanRow, right: PlanRow): void {
  if (
    left.plan_digest !== right.plan_digest || left.candidate_revision !== right.candidate_revision ||
    !sameBytes(copiedBlob(left.plan_bytes, "review plan"), copiedBlob(right.plan_bytes, "review plan"))
  ) corrupt("one review-plan identity names different persisted bytes");
}

async function observeVisibleLock(root: PrivateProjectRoot): Promise<
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly digest: string; readonly bytes: Uint8Array }
> {
  const path = descriptorChild(root.handle, LOCK_NAME);
  let handle: FileHandle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if (hasCode(error, "ENOENT")) return Object.freeze({ state: "absent" as const });
    if (hasCode(error, "ELOOP")) invalid("LOCK_KIND", "jig.lock must not be a symlink");
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.dev !== root.information.dev) {
      invalid("LOCK_KIND", "jig.lock must be a single-link regular file on the project filesystem");
    }
    if (before.size > BigInt(JSON_1_LIMITS.bytes)) invalid("LOCK_INVALID", "jig.lock exceeds the private lock byte ceiling");
    const bytes = await readBounded(handle, Number(before.size), JSON_1_LIMITS.bytes);
    const after = await handle.stat({ bigint: true });
    const pathInformation = await lstat(path, { bigint: true });
    if (!sameSnapshot(before, after) || !sameSnapshot(after, pathInformation)) {
      invalid("LOCK_CHANGED", "jig.lock changed while it was being observed");
    }
    decodePrivateProjectLocalLock(bytes);
    return Object.freeze({ state: "present" as const, digest: rawDigest(bytes), bytes });
  } finally { await handle.close(); }
}

async function convergeVisibleLock(
  owner: StateOwner,
  plan: PrivateActivationPlan,
  proposed: Uint8Array,
): Promise<void> {
  const observed = await observeVisibleLock(owner.root);
  const exact = observed.state === "present" && sameBytes(observed.bytes, proposed);
  if (plan.lockMode === "locked") {
    if (!exact) stale("locked apply no longer sees the exact reviewed jig.lock bytes");
    await clearSafeLockStage(owner);
    await synchronizeExactVisibleLock(owner, proposed);
    return;
  }
  if (exact) {
    await clearSafeLockStage(owner);
    await synchronizeExactVisibleLock(owner, proposed);
    return;
  }
  if (!matchesObservedLock(plan, observed)) {
    stale("jig.lock changed after the review plan was created");
  }
  await publishVisibleLock(owner, plan, proposed);
}

function matchesObservedLock(
  plan: PrivateActivationPlan,
  observed: Awaited<ReturnType<typeof observeVisibleLock>>,
): boolean {
  if (plan.observedLock.state === "absent") return observed.state === "absent";
  return observed.state === "present" && observed.digest === plan.observedLock.digest;
}

async function synchronizeExactVisibleLock(owner: StateOwner, proposed: Uint8Array): Promise<void> {
  const path = descriptorChild(owner.root.handle, LOCK_NAME);
  let handle: FileHandle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if (hasCode(error, "ENOENT")) stale("jig.lock disappeared before admission");
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    requireVisibleLockFile(before, owner.root.information.dev);
    const bytes = await readBounded(handle, Number(before.size), JSON_1_LIMITS.bytes);
    if (!sameBytes(bytes, proposed)) stale("jig.lock differs from the exact proposed bytes");
    await handle.sync();
    const after = await handle.stat({ bigint: true });
    const visible = await lstat(path, { bigint: true });
    if (!sameSnapshot(before, after) || !sameSnapshot(after, visible)) {
      stale("jig.lock changed while it was synchronized");
    }
    await owner.root.handle.sync();
  } finally { await handle.close(); }
  const final = await observeVisibleLock(owner.root);
  if (final.state !== "present" || !sameBytes(final.bytes, proposed)) {
    stale("jig.lock changed after it was synchronized");
  }
}

async function publishVisibleLock(
  owner: StateOwner,
  plan: PrivateActivationPlan,
  proposed: Uint8Array,
): Promise<void> {
  await clearSafeLockStage(owner);
  const stagePath = descriptorChild(owner.directory, LOCK_STAGE_NAME);
  const lockPath = descriptorChild(owner.root.handle, LOCK_NAME);
  const handle = await open(
    stagePath,
    constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    0o600,
  );
  let failure: unknown;
  try {
    const opened = await handle.stat({ bigint: true });
    requireCreatingLockStage(opened, owner.root.information.dev);
    await handle.writeFile(proposed);
    await handle.chmod(0o644);
    await handle.sync();
    const prepared = await handle.stat({ bigint: true });
    requirePreparedLockStage(prepared, owner.root.information.dev, proposed.byteLength);
    const preparedPath = await lstat(stagePath, { bigint: true });
    if (!sameSnapshot(prepared, preparedPath)) {
      invalid("ADMISSION_LOCK_STAGE_CHANGED", "reserved lock stage changed while it was prepared");
    }
    const preparedBytes = await readBounded(handle, Number(prepared.size), JSON_1_LIMITS.bytes);
    if (!sameBytes(preparedBytes, proposed)) {
      invalid("ADMISSION_LOCK_STAGE_CHANGED", "reserved lock stage bytes changed while they were prepared");
    }
    await owner.directory.sync();

    const destination = await observeVisibleLock(owner.root);
    if (destination.state === "present" && sameBytes(destination.bytes, proposed)) {
      await clearOwnedStage(owner, stagePath, prepared);
      await synchronizeExactVisibleLock(owner, proposed);
      return;
    }
    if (!matchesObservedLock(plan, destination)) {
      stale("jig.lock changed before atomic publication");
    }

    await rename(stagePath, lockPath);
    const renamed = await handle.stat({ bigint: true });
    requirePreparedLockStage(renamed, owner.root.information.dev, proposed.byteLength);
    const visible = await lstat(lockPath, { bigint: true });
    if (!sameSnapshot(renamed, visible)) {
      invalid("LOCK_CHANGED", "published jig.lock path differs from its staged inode");
    }
    const visibleBytes = await readBounded(handle, Number(renamed.size), JSON_1_LIMITS.bytes);
    if (!sameBytes(visibleBytes, proposed)) invalid("LOCK_CHANGED", "published jig.lock bytes changed");
    await handle.sync();
    await owner.root.handle.sync();
    await owner.directory.sync();
    const final = await observeVisibleLock(owner.root);
    if (final.state !== "present" || !sameBytes(final.bytes, proposed)) {
      stale("jig.lock changed after atomic publication");
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const cleanup: unknown[] = [];
    if (failure !== undefined) {
      try {
        const information = await handle.stat({ bigint: true });
        await clearOwnedStage(owner, stagePath, information);
      } catch (error) {
        cleanup.push(error);
      }
    }
    try { await handle.close(); } catch (error) { cleanup.push(error); }
    if (cleanup.length > 0) {
      if (failure !== undefined) cleanup.unshift(failure);
      throw new AggregateError(cleanup, "lock publication and stage cleanup did not both complete");
    }
  }
}

async function clearSafeLockStage(owner: StateOwner): Promise<void> {
  const path = descriptorChild(owner.directory, LOCK_STAGE_NAME);
  let information: BigIntStats;
  try { information = await lstat(path, { bigint: true }); }
  catch (error) { if (hasCode(error, "ENOENT")) return; throw error; }
  requireAbandonedLockStage(information, owner.root.information.dev);
  await unlink(path);
  await owner.directory.sync();
}

async function clearOwnedStage(owner: StateOwner, path: string, expected: BigIntStats): Promise<void> {
  let current: BigIntStats;
  try { current = await lstat(path, { bigint: true }); }
  catch (error) { if (hasCode(error, "ENOENT")) return; throw error; }
  requireAbandonedLockStage(current, owner.root.information.dev);
  if (!sameIdentity(current, expected)) {
    invalid("ADMISSION_LOCK_STAGE_CHANGED", "reserved lock stage changed before cleanup");
  }
  await unlink(path);
  await owner.directory.sync();
}

function requireCreatingLockStage(information: BigIntStats, expectedDevice: bigint): void {
  const mode = information.mode & 0o7777n;
  if (
    !information.isFile() || information.nlink !== 1n ||
    information.uid !== BigInt(currentEuid()) || information.dev !== expectedDevice ||
    ![0o000n, 0o200n, 0o400n, 0o600n].includes(mode)
  ) invalid("ADMISSION_LOCK_STAGE_UNSAFE", "new reserved lock stage has unsafe filesystem identity");
}

function requirePreparedLockStage(
  information: BigIntStats,
  expectedDevice: bigint,
  expectedSize: number,
): void {
  if (
    !information.isFile() || information.nlink !== 1n ||
    information.uid !== BigInt(currentEuid()) || information.dev !== expectedDevice ||
    (information.mode & 0o7777n) !== 0o644n || information.size !== BigInt(expectedSize)
  ) invalid("ADMISSION_LOCK_STAGE_UNSAFE", "prepared lock stage has unsafe filesystem identity");
}

function requireAbandonedLockStage(information: BigIntStats, expectedDevice: bigint): void {
  const mode = information.mode & 0o7777n;
  if (
    !information.isFile() || information.nlink !== 1n ||
    information.uid !== BigInt(currentEuid()) || information.dev !== expectedDevice ||
    ![0o000n, 0o200n, 0o400n, 0o600n, 0o644n].includes(mode)
  ) invalid("ADMISSION_LOCK_STAGE_UNSAFE", "reserved lock stage requires operator repair");
}

function requireVisibleLockFile(information: BigIntStats, expectedDevice: bigint): void {
  if (!information.isFile() || information.nlink !== 1n || information.dev !== expectedDevice) {
    invalid("LOCK_KIND", "jig.lock must be a single-link regular file on the project filesystem");
  }
  if (information.size > BigInt(JSON_1_LIMITS.bytes)) invalid("LOCK_INVALID", "jig.lock exceeds the private lock byte ceiling");
}

async function reacquireCandidateArtifacts(
  packageStoreRoot: string,
  candidate: PrivateActivationCandidateArtifact,
): Promise<ReacquiredArtifacts> {
  const captures = new Map<string, Awaited<ReturnType<typeof captureStoredPackage>>>();
  let failure: unknown;
  try {
    const digests = new Set<string>([
      candidate.candidate.declarationArtifact.package.digest,
      ...Object.values(candidate.lock.packages).map((entry) => entry.digest),
    ]);
    for (const digest of [...digests].sort()) {
      const reference = normalizePackageArtifactRef({ kind: "flow-package/1", digest });
      captures.set(digest, await captureStoredPackage(packageStoreRoot, reference));
    }
    const inspections = new Map<string, InspectedPackage>();
    for (const [path, expected] of Object.entries(candidate.lock.packages)) {
      const captured = captures.get(expected.digest);
      if (captured === undefined) corrupt(`stored package ${path} was not reacquired`);
      let inspected = inspections.get(expected.digest);
      if (inspected === undefined) {
        inspected = await inspectCapturedPackage(captured);
        inspections.set(expected.digest, inspected);
      }
      requirePackageProjection(path, expected, inspected);
    }
  } catch (error) { failure = error; }
  if (failure !== undefined) {
    const cleanup = await disposeCaptures([...captures.values()]);
    if (cleanup !== undefined) throw new AggregateError([failure, cleanup], "artifact verification cleanup failed");
    throw failure;
  }
  let disposed = false;
  return Object.freeze({
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      const cleanup = await disposeCaptures([...captures.values()]);
      if (cleanup !== undefined) throw cleanup;
    },
  });
}

function requirePackageProjection(path: string, expected: PrivateLockPackage, inspected: InspectedPackage): void {
  const used = new Map(inspected.usedContracts.map((entry) => [entry.slot, entry]));
  const uses: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const slot of Object.keys(inspected.metadata.uses ?? {}).sort()) {
    const declaration = inspected.metadata.uses![slot]!;
    if (declaration.local === true) uses[slot] = { kind: "local" };
    else {
      const checked = used.get(slot);
      if (checked === undefined) corrupt(`stored package ${path} omitted checked capability ${slot}`);
      uses[slot] = {
        kind: "contract",
        id: checked.contract.descriptor.id,
        version: checked.contract.descriptor.version,
        digest: checked.contract.digest,
      };
    }
  }
  const provides: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const checked of inspected.providedContracts) {
    provides[checked.slot] = {
      id: checked.contract.descriptor.id,
      version: checked.contract.descriptor.version,
      digest: checked.contract.digest,
    };
  }
  const attachments: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const name of Object.keys(inspected.metadata.attachments ?? {}).sort()) {
    attachments[name] = inspected.metadata.attachments![name]!;
  }
  const observed: JsonValue = {
    digest: inspected.digest,
    mode: inspected.mode,
    directRun: isDirectRunEligible(inspected),
    attachments,
    uses,
    provides,
  };
  if (!sameBytes(canonicalJson(observed), canonicalJson(expected as unknown as JsonValue))) {
    invalid("ADMISSION_ARTIFACT_MISMATCH", `stored Package/1 ${path} no longer matches its candidate lock`);
  }
}

async function disposeCaptures(captures: readonly Awaited<ReturnType<typeof captureStoredPackage>>[]): Promise<unknown> {
  const failures: unknown[] = [];
  for (const captured of [...captures].reverse()) {
    try { await captured.dispose(); } catch (error) { failures.push(error); }
  }
  return failures.length === 0 ? undefined : new AggregateError(failures, "Package/1 captures did not all close");
}

function requireCandidateRoot(candidate: PrivateActivationCandidateArtifact, root: PrivateProjectRoot): void {
  const expected = candidate.candidate.projectRoot;
  if (root.information.dev.toString() !== expected.device || root.information.ino.toString() !== expected.inode) {
    invalid("ADMISSION_PROJECT_CHANGED", "activation candidate belongs to a different project root");
  }
}

async function verifyPathIdentity(
  path: string,
  expected: BigIntStats,
  label: string,
  validate?: (information: BigIntStats) => void,
): Promise<void> {
  let current: BigIntStats;
  try { current = await lstat(path, { bigint: true }); }
  catch { invalid("ADMISSION_STATE_CHANGED", `${label} disappeared during the operation`); }
  if (!sameIdentity(current, expected)) invalid("ADMISSION_STATE_CHANGED", `${label} changed during the operation`);
  validate?.(current);
}

async function verifyVisibleHierarchy(
  root: PrivateProjectRoot,
  statePath: string,
  stateInformation: BigIntStats,
  databasePath: string,
  databaseInformation: BigIntStats,
): Promise<void> {
  await root.verify();
  await verifyPathIdentity(
    statePath,
    stateInformation,
    "visible admission state directory",
    (information) => requireStateDirectory(information, root.information.dev),
  );
  await verifyPathIdentity(
    databasePath,
    databaseInformation,
    "visible admission database",
    (information) => requireDatabaseFile(information, stateInformation.dev),
  );
}

async function disposeOperation(owner: StateOwner, artifacts: ReacquiredArtifacts | undefined, failure: unknown): Promise<void> {
  const cleanup: unknown[] = [];
  try { await artifacts?.dispose(); } catch (error) { cleanup.push(error); }
  try { await owner.dispose(); } catch (error) { cleanup.push(error); }
  if (cleanup.length === 0) return;
  if (failure !== undefined) cleanup.unshift(failure);
  throw new AggregateError(cleanup, "private admission operation and cleanup did not both complete");
}

function markStored(candidate: PrivateActivationCandidateArtifact): PrivateActivationCandidateArtifact {
  storedCandidates.add(candidate);
  return candidate;
}

function statement<Row>(database: SqliteDatabase, sql: string): SqliteStatement<Row> {
  return database.query<Row>(sql).safeIntegers(true);
}

function loadSqlite(): SqliteModule {
  try { return createRequire(import.meta.url)("bun:sqlite") as SqliteModule; }
  catch { unavailable("ADMISSION_SQLITE_UNAVAILABLE", "Bun's built-in SQLite module is unavailable"); }
}

function sqliteFlag(sqlite: SqliteModule, name: string): number {
  const value = sqlite.constants[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) unavailable("ADMISSION_SQLITE_UNAVAILABLE", `Bun SQLite omitted ${name}`);
  return value;
}

function pragmaInteger(database: SqliteDatabase, name: string): bigint | undefined {
  return statement<Record<string, bigint>>(database, `PRAGMA ${name}`).get()?.[name];
}

function safeRevision(value: number | bigint): number {
  const revision = typeof value === "bigint" ? value : BigInt(value);
  if (revision < 1n || revision > MAX_SAFE_REVISION) unavailable("ADMISSION_REVISION_EXHAUSTED", "private admission candidate revision is exhausted");
  return Number(revision);
}

function requireStoredSize(bytes: Uint8Array, label: string): void {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_STORED_BYTES) {
    invalid("ADMISSION_RECORD_SIZE", `${label} is outside the private SQLite record byte ceiling`);
  }
}

function copiedBlob(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) corrupt(`${label} is not a SQLite BLOB`);
  return Uint8Array.from(value);
}

function requireDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`${label} digest must be sha256: followed by 64 lowercase hexadecimal digits`);
}

function requireLockMode(value: unknown): asserts value is "update" | "locked" {
  if (value !== "update" && value !== "locked") throw new TypeError("private activation plan lock mode must be update or locked");
}

async function readBounded(handle: FileHandle, initialSize: number, limit: number): Promise<Uint8Array> {
  const capacity = Math.min(limit + 1, initialSize + 1);
  const buffer = new Uint8Array(capacity);
  let offset = 0;
  while (offset < capacity) {
    const { bytesRead } = await handle.read(buffer, offset, capacity - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > limit || offset !== initialSize) invalid("LOCK_CHANGED", "jig.lock changed size while being read");
  return buffer.subarray(0, offset);
}

function rawDigest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function descriptorChild(parent: FileHandle, name: string): string { return `/proc/self/fd/${parent.fd}/${name}`; }

function sameIdentity(left: { readonly dev: bigint; readonly ino: bigint }, right: { readonly dev: bigint; readonly ino: bigint }): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right) && left.size === right.size && left.mode === right.mode && left.nlink === right.nlink &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if (hasCode(error, "ENOENT")) return false; throw error; }
}

function currentEuid(): number {
  if (process.geteuid === undefined) unavailable("ADMISSION_STATE_UNAVAILABLE", "private admission requires a POSIX effective owner identity");
  return process.geteuid();
}

function isSqliteBusy(error: unknown): boolean {
  let sqlite: SqliteModule;
  try { sqlite = loadSqlite(); } catch { return false; }
  if (!(error instanceof sqlite.SQLiteError)) return false;
  const errno = (error as { readonly errno?: number }).errno;
  return errno !== undefined && (errno & 0xff) === 5;
}

function busy(): never { unavailable("ADMISSION_STATE_BUSY", "private admission state is busy; retry the complete operation"); }
function candidateChanged(): never { unavailable("ADMISSION_CANDIDATE_CHANGED", "activation candidate head changed; retry planning"); }
function stale(message: string): never { unavailable("STALE_PLAN", message); }
function corrupt(message: string): never { invalid("ADMISSION_STATE_CORRUPT", message); }
function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { readonly code?: unknown }).code === code;
}
