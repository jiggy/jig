import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

import { invalid, unavailable } from "../diagnostics.js";
import { canonicalJson, decodeJson1, JSON_1_LIMITS, type JsonValue } from "../json.js";
import { inspectCapturedPackage, type InspectedPackage } from "../package/inspect.js";
import { SchemaDiagnostic } from "../schema/index.js";
import type { RunTargetIdentity } from "../project/package-project.js";
import { isDirectRunEligible } from "../project/flow-source.js";
import { privateActivationTargetKey } from "./activation-planning.js";
import { privateDomainDigest } from "./identity.js";
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
import {
  createPrivateRootSubmissionRequest,
  decodePrivateRootSubmissionRequest,
  failedPrivateRootTerminal,
  normalizePrivateRootSpawnIntent,
  normalizePrivateRootTerminal,
  privateRootSpawnIntentDigest,
  privateRootRequestDigest,
  privateRootSubmissionDigest,
  privateRootTerminalBytes,
  requirePrivateRootSubmissionId,
  type PrivateRootRunSnapshot,
  type PrivateRootRunSpawnIntent,
  type PrivateRootRunTerminal,
  type PrivateRootSubmissionRequest,
} from "./root-run-state.js";

export type {
  PrivateRootRunSnapshot,
  PrivateRootRunSpawnIntent,
  PrivateRootRunTerminal,
} from "./root-run-state.js";

const STATE_DIRECTORY = ".jig";
const DATABASE_NAME = "private-activation-admission-v7.sqlite3";
const COORDINATOR_DATABASE_NAME = "private-project-coordinator-v1.sqlite3";
const LOCK_NAME = "jig.lock";
const LOCK_STAGE_NAME = "private-activation-jig-lock-v1.stage";
const SCHEMA_VERSION = 7n;
const APPLICATION_ID = 0x4a494737n; // JIG7
const COORDINATOR_SCHEMA_VERSION = 1n;
const COORDINATOR_APPLICATION_ID = 0x4a494743n; // JIGC
const BUSY_TIMEOUT_MS = 250;
const MAX_STORED_BYTES = 16_777_216;
const MAX_SAFE_REVISION = BigInt(Number.MAX_SAFE_INTEGER);
const DIGEST = /^sha256:[0-9a-f]{64}$/;

const CREATE_CANDIDATES = "CREATE TABLE candidates (revision INTEGER PRIMARY KEY CHECK (revision BETWEEN 1 AND 9007199254740991), candidate_digest TEXT NOT NULL, candidate_bytes BLOB NOT NULL CHECK (length(candidate_bytes) BETWEEN 1 AND 16777216), lock_bytes BLOB NOT NULL CHECK (length(lock_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_CANDIDATE_HEAD = "CREATE TABLE candidate_head (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER REFERENCES candidates(revision)) STRICT";
const CREATE_REVIEW_PLANS = "CREATE TABLE review_plans (plan_digest TEXT PRIMARY KEY, candidate_revision INTEGER NOT NULL REFERENCES candidates(revision), plan_bytes BLOB NOT NULL CHECK (length(plan_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_ADMISSIONS = "CREATE TABLE admissions (revision INTEGER PRIMARY KEY CHECK (revision BETWEEN 1 AND 9007199254740991), admission_digest TEXT NOT NULL UNIQUE, base_generation TEXT UNIQUE REFERENCES admissions(admission_digest), plan_digest TEXT NOT NULL UNIQUE REFERENCES review_plans(plan_digest), admission_bytes BLOB NOT NULL CHECK (length(admission_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_ADMISSION_HEAD = "CREATE TABLE admission_head (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER REFERENCES admissions(revision)) STRICT";
const CREATE_COORDINATOR_HEAD = "CREATE TABLE coordinator_head (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), epoch INTEGER NOT NULL CHECK (epoch BETWEEN 0 AND 9007199254740991)) STRICT";
const CREATE_ROOT_RUNS = "CREATE TABLE root_runs (run_id TEXT PRIMARY KEY, submission_id TEXT NOT NULL UNIQUE, submission_digest TEXT NOT NULL, admission_digest TEXT NOT NULL REFERENCES admissions(admission_digest), candidate_revision INTEGER NOT NULL REFERENCES candidates(revision), coordinator_epoch INTEGER NOT NULL CHECK (coordinator_epoch BETWEEN 1 AND 9007199254740991), request_bytes BLOB NOT NULL CHECK (length(request_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_ROOT_SPAWN_INTENTS = "CREATE TABLE root_spawn_intents (run_id TEXT PRIMARY KEY REFERENCES root_runs(run_id), intent_digest TEXT NOT NULL UNIQUE, intent_bytes BLOB NOT NULL CHECK (length(intent_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_ROOT_EXECUTION_LIFECYCLES = "CREATE TABLE root_execution_lifecycles (run_id TEXT PRIMARY KEY REFERENCES root_spawn_intents(run_id), allocation_digest TEXT NOT NULL UNIQUE, allocation_bytes BLOB NOT NULL CHECK (length(allocation_bytes) BETWEEN 1 AND 16777216), plan_digest TEXT UNIQUE, plan_bytes BLOB, backing_digest TEXT UNIQUE, backing_bytes BLOB, sandbox_digest TEXT UNIQUE, sandbox_bytes BLOB, prepared_digest TEXT UNIQUE, prepared_bytes BLOB, provisional_digest TEXT UNIQUE, provisional_bytes BLOB, fence_digest TEXT UNIQUE, fence_bytes BLOB, release_digest TEXT UNIQUE, release_bytes BLOB, admitted_digest TEXT UNIQUE, admitted_bytes BLOB, CHECK ((plan_digest IS NULL) = (plan_bytes IS NULL)), CHECK ((backing_digest IS NULL) = (backing_bytes IS NULL)), CHECK ((sandbox_digest IS NULL) = (sandbox_bytes IS NULL)), CHECK ((prepared_digest IS NULL) = (prepared_bytes IS NULL)), CHECK ((provisional_digest IS NULL) = (provisional_bytes IS NULL)), CHECK ((fence_digest IS NULL) = (fence_bytes IS NULL)), CHECK ((release_digest IS NULL) = (release_bytes IS NULL)), CHECK ((admitted_digest IS NULL) = (admitted_bytes IS NULL)), CHECK (backing_digest IS NULL OR plan_digest IS NOT NULL), CHECK (sandbox_digest IS NULL OR backing_digest IS NOT NULL), CHECK (prepared_digest IS NULL OR sandbox_digest IS NOT NULL), CHECK (fence_digest IS NULL OR sandbox_digest IS NOT NULL), CHECK (admitted_digest IS NULL OR (provisional_digest IS NOT NULL AND release_digest IS NOT NULL))) STRICT";
const CREATE_ROOT_EXECUTION_CLOSURES = "CREATE TABLE root_execution_closures (run_id TEXT PRIMARY KEY REFERENCES root_execution_lifecycles(run_id), closure_digest TEXT NOT NULL UNIQUE, closure_bytes BLOB NOT NULL CHECK (length(closure_bytes) BETWEEN 1 AND 16777216), UNIQUE (run_id, closure_digest)) STRICT";
const CREATE_ROOT_TERMINALS = "CREATE TABLE root_terminals (run_id TEXT PRIMARY KEY REFERENCES root_runs(run_id), execution_closure_digest TEXT, terminal_digest TEXT NOT NULL, terminal_bytes BLOB NOT NULL CHECK (length(terminal_bytes) BETWEEN 1 AND 16777216), FOREIGN KEY (run_id, execution_closure_digest) REFERENCES root_execution_closures(run_id, closure_digest)) STRICT";
const CREATE_COORDINATOR_LOCK = "CREATE TABLE coordinator_lock (singleton INTEGER PRIMARY KEY CHECK (singleton = 1)) STRICT";
const EXPECTED_SCHEMA = Object.freeze([
  Object.freeze({ type: "table", name: "admission_head", table: "admission_head", sql: CREATE_ADMISSION_HEAD }),
  Object.freeze({ type: "table", name: "admissions", table: "admissions", sql: CREATE_ADMISSIONS }),
  Object.freeze({ type: "table", name: "candidate_head", table: "candidate_head", sql: CREATE_CANDIDATE_HEAD }),
  Object.freeze({ type: "table", name: "candidates", table: "candidates", sql: CREATE_CANDIDATES }),
  Object.freeze({ type: "table", name: "coordinator_head", table: "coordinator_head", sql: CREATE_COORDINATOR_HEAD }),
  Object.freeze({ type: "table", name: "review_plans", table: "review_plans", sql: CREATE_REVIEW_PLANS }),
  Object.freeze({ type: "table", name: "root_execution_closures", table: "root_execution_closures", sql: CREATE_ROOT_EXECUTION_CLOSURES }),
  Object.freeze({ type: "table", name: "root_execution_lifecycles", table: "root_execution_lifecycles", sql: CREATE_ROOT_EXECUTION_LIFECYCLES }),
  Object.freeze({ type: "table", name: "root_runs", table: "root_runs", sql: CREATE_ROOT_RUNS }),
  Object.freeze({ type: "table", name: "root_spawn_intents", table: "root_spawn_intents", sql: CREATE_ROOT_SPAWN_INTENTS }),
  Object.freeze({ type: "table", name: "root_terminals", table: "root_terminals", sql: CREATE_ROOT_TERMINALS }),
]);

const storedCandidates = new WeakSet<object>();
const authenticRootRunLaunches = new WeakSet<object>();
const claimedRootRunLaunches = new WeakSet<object>();
const authenticCoordinators = new WeakSet<object>();

interface SqliteRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

interface SqliteStatement<Row> {
  safeIntegers(enabled: boolean): SqliteStatement<Row>;
  get(...bindings: readonly unknown[]): Row | null;
  all(...bindings: readonly unknown[]): Row[];
  run(...bindings: readonly unknown[]): SqliteRunResult;
  finalize(): void;
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

interface CoordinatorLock {
  readonly database: SqliteDatabase;
  verify(): Promise<void>;
  dispose(): Promise<void>;
}

interface ReacquiredArtifacts {
  inspection(digest: string): InspectedPackage;
  dispose(): Promise<void>;
}

interface RootRunRow {
  readonly run_id: string;
  readonly submission_id: string;
  readonly submission_digest: string;
  readonly admission_digest: string;
  readonly candidate_revision: bigint;
  readonly coordinator_epoch: bigint;
  readonly request_bytes: Uint8Array;
}

interface RootSpawnRow {
  readonly run_id: string;
  readonly intent_digest: string;
  readonly intent_bytes: Uint8Array;
}

interface RootTerminalRow {
  readonly run_id: string;
  readonly execution_closure_digest: string | null;
  readonly terminal_digest: string;
  readonly terminal_bytes: Uint8Array;
}

interface RootExecutionLifecycleRow {
  readonly run_id: string;
  readonly allocation_digest: string;
  readonly allocation_bytes: Uint8Array;
  readonly plan_digest: string | null;
  readonly plan_bytes: Uint8Array | null;
  readonly backing_digest: string | null;
  readonly backing_bytes: Uint8Array | null;
  readonly sandbox_digest: string | null;
  readonly sandbox_bytes: Uint8Array | null;
  readonly prepared_digest: string | null;
  readonly prepared_bytes: Uint8Array | null;
  readonly provisional_digest: string | null;
  readonly provisional_bytes: Uint8Array | null;
  readonly fence_digest: string | null;
  readonly fence_bytes: Uint8Array | null;
  readonly release_digest: string | null;
  readonly release_bytes: Uint8Array | null;
  readonly admitted_digest: string | null;
  readonly admitted_bytes: Uint8Array | null;
}

interface RootExecutionClosureRow {
  readonly run_id: string;
  readonly closure_digest: string;
  readonly closure_bytes: Uint8Array;
}

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

export interface PrivateActiveActivation {
  readonly admission: PrivateActivationAdmissionReceipt;
  readonly candidate: PrivateActivationCandidateArtifact;
}

/** Exclusive, process-held authority for one project coordinator generation. */
export interface PrivateProjectCoordinator {
  readonly projectRoot: string;
  readonly epoch: number;
  readonly recoveredRootRuns: readonly PrivateRootRunSnapshot[];
  verify(): Promise<void>;
  dispose(): Promise<void>;
}

export interface PrivateRootRunLaunch {
  readonly run: PrivateRootRunSnapshot;
  readonly intent: PrivateRootRunSpawnIntent;
  readonly candidate: PrivateActivationCandidateArtifact;
  readonly coordinator: PrivateProjectCoordinator;
}

export interface PrivateRootRunSubmission {
  readonly run: PrivateRootRunSnapshot;
  /** Present only for the invocation that durably created a READY spawn intent. */
  readonly launch?: PrivateRootRunLaunch;
}

export type PrivateRootExecutionCheckpointName =
  | "plan"
  | "backing"
  | "sandbox"
  | "prepared"
  | "provisional"
  | "fence"
  | "release"
  | "admitted";

export interface PrivateRootExecutionFact {
  readonly digest: string;
  readonly value: JsonValue;
}

export interface PrivateRootExecutionLifecycle {
  readonly runId: string;
  readonly allocation: PrivateRootExecutionFact;
  readonly plan?: PrivateRootExecutionFact;
  readonly backing?: PrivateRootExecutionFact;
  readonly sandbox?: PrivateRootExecutionFact;
  readonly prepared?: PrivateRootExecutionFact;
  readonly provisional?: PrivateRootExecutionFact;
  readonly fence?: PrivateRootExecutionFact;
  readonly release?: PrivateRootExecutionFact;
  readonly admitted?: PrivateRootExecutionFact;
  readonly closureDigest?: string;
}

export interface PrivateRootExecutionWork {
  readonly run: PrivateRootRunSnapshot;
  readonly intent: PrivateRootRunSpawnIntent;
  readonly lifecycle: PrivateRootExecutionLifecycle;
}

export interface PrivateReacquiredRootExecutionWork extends PrivateRootExecutionWork {
  readonly candidate: PrivateActivationCandidateArtifact;
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
      runFinalized(owner.database,
        "INSERT INTO candidates(revision, candidate_digest, candidate_bytes, lock_bytes) VALUES (?1, ?2, ?3, ?4)",
        [next, candidateDigest, encoded.candidate, encoded.lock],
      );
      const changed = runFinalized(owner.database,
        "UPDATE candidate_head SET revision = ?1 WHERE singleton = 1 AND revision IS ?2",
        [next, head.revision],
      ).changes;
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

/** Reopen the exact active generation and reprove its protected packages. */
export async function loadPrivateActiveActivation(input: {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
}): Promise<PrivateActiveActivation> {
  const owner = await openStateOwner(input.projectRoot, false);
  let artifacts: ReacquiredArtifacts | undefined;
  let failure: unknown;
  try {
    const initialHead = readAdmissionHead(owner.database, owner.root);
    if (initialHead.revision === null) {
      unavailable("ADMISSION_MISSING", "no activation generation is active");
    }
    const initialAdmissionRow = requireAdmissionRow(owner.database, initialHead.revision);
    const admission = loadAndCrossCheckAdmission(owner.database, initialAdmissionRow, owner.root);
    const planRow = requirePlanRow(owner.database, admission.admission.planDigest);
    const candidateRow = requireCandidateRow(owner.database, planRow.candidate_revision);
    const candidate = loadCandidateRow(candidateRow);
    artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot, candidate);
    await immediate(owner, () => {
      const currentHead = readAdmissionHead(owner.database, owner.root);
      if (currentHead.revision !== initialHead.revision) {
        stale("active generation changed while it was reopened");
      }
      const currentAdmissionRow = requireAdmissionRow(owner.database, initialHead.revision!);
      const currentCandidateRow = requireCandidateRow(owner.database, candidateRow.revision);
      requireSameAdmissionRow(initialAdmissionRow, currentAdmissionRow);
      requireSameCandidateRow(candidateRow, currentCandidateRow);
      loadAndCrossCheckAdmission(owner.database, currentAdmissionRow, owner.root);
    });
    await owner.finish();
    return Object.freeze({ admission, candidate: markStored(candidate) });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, artifacts, failure);
  }
}

/**
 * Take the single local coordinator lease, advance its durable epoch, and
 * expose every unresolved older-epoch spawn intent for exact recovery before
 * the controller accepts more work. Epoch takeover itself never fabricates a
 * terminal before execution ownership has been fenced and released.
 */
export async function openPrivateProjectCoordinator(input: {
  readonly projectRoot: string;
}): Promise<PrivateProjectCoordinator> {
  const owner = await openStateOwner(input.projectRoot, false);
  let lock: CoordinatorLock | undefined;
  try {
    lock = await openCoordinatorLock(owner);
    try { lock.database.exec("BEGIN EXCLUSIVE"); }
    catch (error) {
      if (isSqliteBusy(error)) unavailable("COORDINATOR_BUSY", "another coordinator owns this project");
      throw error;
    }
    const recovered = await immediate(owner, () => {
      const current = readCoordinatorEpoch(owner.database);
      if (current >= MAX_SAFE_REVISION) {
        unavailable("COORDINATOR_EPOCH_EXHAUSTED", "project coordinator epoch is exhausted");
      }
      const epoch = current + 1n;
      const changed = runFinalized(owner.database,
        "UPDATE coordinator_head SET epoch = ?1 WHERE singleton = 1 AND epoch = ?2",
        [epoch, current],
      ).changes;
      if (changed !== 1) corrupt("coordinator epoch compare-and-set did not update exactly one row");
      return Object.freeze({
        epoch: safeRevision(epoch),
        runs: reconcileRootRunsBeforeEpoch(owner.database, owner.root, epoch),
      });
    });

    let disposed = false;
    const coordinator: PrivateProjectCoordinator = Object.freeze({
      projectRoot: owner.root.requestedPath,
      epoch: recovered.epoch,
      recoveredRootRuns: recovered.runs,
      async verify(): Promise<void> {
        if (disposed || !lock!.database.inTransaction) {
          unavailable("COORDINATOR_CLOSED", "project coordinator lease is no longer held");
        }
        await owner.verify();
        await lock!.verify();
      },
      async dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        const failures: unknown[] = [];
        try { await lock!.dispose(); } catch (error) { failures.push(error); }
        try { await owner.dispose(); } catch (error) { failures.push(error); }
        if (failures.length > 0) {
          throw new AggregateError(failures, "project coordinator cleanup did not complete");
        }
      },
    });
    authenticCoordinators.add(coordinator);
    await coordinator.verify();
    return coordinator;
  } catch (error) {
    const failures: unknown[] = [error];
    try { await lock?.dispose(); } catch (cleanup) { failures.push(cleanup); }
    try { await owner.dispose(); } catch (cleanup) { failures.push(cleanup); }
    if (failures.length > 1) {
      throw new AggregateError(failures, "project coordinator acquisition and cleanup did not both complete");
    }
    throw error;
  }
}

/**
 * Allocate or replay one root Run under the currently admitted generation.
 * Only the invocation which inserts a READY spawn intent receives launch
 * authority; duplicate submissions can observe state but cannot redispatch it.
 */
export async function submitPrivateRootRun(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly submissionId: string;
  readonly target: RunTargetIdentity;
  readonly input: JsonValue;
  readonly deadlineUnixMs: number;
}): Promise<PrivateRootRunSubmission> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  const request = createPrivateRootSubmissionRequest(input);
  const submissionDigest = privateRootSubmissionDigest(request);
  const owner = await openStateOwner(input.projectRoot, false);
  let artifacts: ReacquiredArtifacts | undefined;
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const replay = findRootRunBySubmission(owner.database, input.submissionId);
    if (replay !== null) {
      const run = loadRootRunSnapshot(owner.database, replay, owner.root);
      requireSameSubmission(run, submissionDigest);
      await owner.finish();
      return Object.freeze({ run });
    }

    const head = readAdmissionHead(owner.database, owner.root);
    if (head.revision === null) unavailable("ADMISSION_MISSING", "no activation generation is active");
    const admissionRow = requireAdmissionRow(owner.database, head.revision);
    const admission = loadAndCrossCheckAdmission(owner.database, admissionRow, owner.root);
    const candidateRow = requireCandidateRow(owner.database, BigInt(admission.admission.candidateRevision));
    const candidate = loadCandidateRow(candidateRow);
    requireCandidateRoot(candidate, owner.root);
    artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot, candidate);

    const terminal = rootPreflightTerminal(candidate, request, artifacts);
    const runId = privateDomainDigest("JIG-Private-Root-Run/1", {
      project: {
        device: owner.root.information.dev.toString(),
        inode: owner.root.information.ino.toString(),
      },
      submissionId: input.submissionId,
      submissionDigest,
      requestDigest: privateRootRequestDigest(request),
      coordinatorEpoch: coordinator.epoch,
    });
    const requestBytes = canonicalJson(request as unknown as JsonValue);
    requireStoredSize(requestBytes, "root Run request");

    const created = await immediate(owner, async () => {
      await coordinator.verify();
      const raced = findRootRunBySubmission(owner.database, input.submissionId);
      if (raced !== null) {
        const run = loadRootRunSnapshot(owner.database, raced, owner.root);
        requireSameSubmission(run, submissionDigest);
        return Object.freeze({ run });
      }
      const currentHead = readAdmissionHead(owner.database, owner.root);
      if (currentHead.revision !== head.revision) stale("active generation changed before root Run allocation");
      const currentAdmission = requireAdmissionRow(owner.database, head.revision!);
      const currentCandidate = requireCandidateRow(owner.database, candidateRow.revision);
      requireSameAdmissionRow(admissionRow, currentAdmission);
      requireSameCandidateRow(candidateRow, currentCandidate);
      loadAndCrossCheckAdmission(owner.database, currentAdmission, owner.root);

      runFinalized(owner.database,
        "INSERT INTO root_runs(run_id, submission_id, submission_digest, admission_digest, candidate_revision, coordinator_epoch, request_bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        [
        runId,
        input.submissionId,
        submissionDigest,
        admission.admissionDigest,
        candidateRow.revision,
        coordinator.epoch,
        requestBytes,
        ],
      );

      if (terminal !== undefined) {
        persistRootTerminal(owner.database, runId, terminal);
        const row = requireRootRunRow(owner.database, runId);
        return Object.freeze({ run: loadRootRunSnapshot(owner.database, row, owner.root) });
      }

      if (candidate.candidate.target.disposition.state !== "ready") {
        corrupt("root Run preflight omitted an unavailable candidate terminal");
      }
      const intent = normalizePrivateRootSpawnIntent({
        kind: "private-root-spawn-intent/1",
        runId,
        admissionDigest: admission.admissionDigest,
        candidateRevision: safeRevision(candidateRow.revision),
        coordinatorEpoch: coordinator.epoch,
        requestDigest: candidate.candidate.target.request.digest,
        recipeDigest: candidate.candidate.target.disposition.recipeDigest,
        observationDigest: candidate.candidate.target.disposition.observationDigest,
        deadlineUnixMs: request.deadlineUnixMs,
      });
      const intentBytes = canonicalJson(intent as unknown as JsonValue);
      requireStoredSize(intentBytes, "root Run spawn intent");
      const intentDigest = privateRootSpawnIntentDigest(intent);
      runFinalized(owner.database,
        "INSERT INTO root_spawn_intents(run_id, intent_digest, intent_bytes) VALUES (?1, ?2, ?3)",
        [runId, intentDigest, intentBytes],
      );
      const allocation = normalizeRootExecutionAllocation({
        kind: "private-root-execution-allocation/1",
        runId,
        spawnIntentDigest: intentDigest,
        coordinatorEpoch: coordinator.epoch,
        value: null,
      });
      const allocationBytes = canonicalJson(allocation);
      requireStoredSize(allocationBytes, "root execution allocation");
      runFinalized(owner.database,
        "INSERT INTO root_execution_lifecycles(run_id, allocation_digest, allocation_bytes) VALUES (?1, ?2, ?3)",
        [runId, rootExecutionAllocationDigest(allocation), allocationBytes],
      );
      const run = loadRootRunSnapshot(owner.database, requireRootRunRow(owner.database, runId), owner.root);
      const launch = Object.freeze({ run, intent, candidate: markStored(candidate), coordinator });
      authenticRootRunLaunches.add(launch);
      return Object.freeze({ run, launch });
    });
    await owner.finish();
    return created;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, artifacts, failure);
  }
}

/** Persist one monotonic, write-once execution checkpoint. */
export async function recordPrivateRootExecutionCheckpoint(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly runId: string;
  readonly checkpoint: PrivateRootExecutionCheckpointName;
  readonly value: JsonValue;
}): Promise<PrivateRootExecutionLifecycle> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.runId, "root Run");
  const checkpoint = requireRootExecutionCheckpointName(input.checkpoint);
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const lifecycle = await immediate(owner, async () => {
      await coordinator.verify();
      const runRow = requireRootRunRow(owner.database, input.runId);
      const run = loadRootRunSnapshot(owner.database, runRow, owner.root);
      if (run.state === "terminal") invalid("RUN_ALREADY_TERMINAL", "root Run is already terminal");
      if (run.coordinatorEpoch > coordinator.epoch) corrupt("root Run belongs to a future coordinator epoch");
      const row = requireRootExecutionLifecycle(owner.database, input.runId);
      const before = loadRootExecutionLifecycle(owner.database, row, runRow);
      const envelope = normalizeRootExecutionCheckpoint({
        kind: `private-root-execution-${checkpoint}/1`,
        runId: input.runId,
        allocationDigest: before.allocation.digest,
        value: checkpoint === "provisional" || checkpoint === "admitted"
          ? normalizePrivateRootTerminal(input.value) as unknown as JsonValue
          : input.value,
      }, checkpoint);
      const bytes = canonicalJson(envelope);
      requireStoredSize(bytes, `root execution ${checkpoint}`);
      const digest = rootExecutionCheckpointDigest(checkpoint, envelope);
      const current = executionFact(before, checkpoint);
      if (current !== undefined) {
        if (current.digest !== digest || !sameBytes(checkpointBytes(row, checkpoint)!, bytes)) {
          invalid("RUN_EXECUTION_CHECKPOINT_CONFLICT", `root execution ${checkpoint} checkpoint differs`);
        }
        return before;
      }
      requireCheckpointAuthority(run, coordinator, checkpoint, envelope.value);
      requireCheckpointOrder(before, checkpoint, envelope.value);
      const columns = checkpointColumns(checkpoint);
      const changed = runFinalized(owner.database,
        `UPDATE root_execution_lifecycles SET ${columns.digest} = ?1, ${columns.bytes} = ?2 WHERE run_id = ?3 AND ${columns.digest} IS NULL`,
        [digest, bytes, input.runId],
      ).changes;
      if (changed !== 1) corrupt("root execution checkpoint compare-and-set failed");
      return loadRootExecutionLifecycle(
        owner.database,
        requireRootExecutionLifecycle(owner.database, input.runId),
        runRow,
      );
    });
    await owner.finish();
    return lifecycle;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/** List unresolved spawn work without granting execution authority. */
export async function listPrivateRootExecutionWork(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly epoch: "current" | "older";
}): Promise<readonly PrivateRootExecutionWork[]> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    if (input.epoch !== "current" && input.epoch !== "older") {
      throw new TypeError("root execution work epoch must be current or older");
    }
    const comparison = input.epoch === "current" ? "=" : "<";
    const query = statement<RootRunRow>(owner.database, [
      "SELECT root_runs.run_id, root_runs.submission_id, root_runs.submission_digest,",
      "root_runs.admission_digest, root_runs.candidate_revision, root_runs.coordinator_epoch, root_runs.request_bytes",
      "FROM root_runs JOIN root_spawn_intents USING (run_id)",
      "LEFT JOIN root_terminals USING (run_id)",
      `WHERE root_terminals.run_id IS NULL AND root_runs.coordinator_epoch ${comparison} ?1`,
      "ORDER BY root_runs.run_id",
    ].join(" ")).safeIntegers(true);
    let rows: readonly RootRunRow[];
    try { rows = query.all(BigInt(coordinator.epoch)).map(copiedRootRunRow); }
    finally { query.finalize(); }
    const work = rows.map((row): PrivateRootExecutionWork => {
      const spawn = findRootSpawn(owner.database, row.run_id);
      if (spawn === null) corrupt("unresolved execution work has no spawn intent");
      const lifecycle = requireRootExecutionLifecycle(owner.database, row.run_id);
      return Object.freeze({
        run: loadRootRunSnapshot(owner.database, row, owner.root),
        intent: loadRootSpawnRow(spawn, row),
        lifecycle: loadRootExecutionLifecycle(owner.database, lifecycle, row),
      });
    });
    await owner.finish();
    return Object.freeze(work);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/**
 * Reopen one unresolved Run from its pinned admission and candidate revision,
 * then reprove every protected Package/1 artifact before returning work. This
 * never consults the current candidate or admission head.
 */
export async function reacquirePrivateRootExecutionWork(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly runId: string;
}): Promise<PrivateReacquiredRootExecutionWork> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.runId, "root Run");
  const owner = await openStateOwner(input.projectRoot, false);
  let artifacts: ReacquiredArtifacts | undefined;
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const initialRunRow = requireRootRunRow(owner.database, input.runId);
    const initialRun = loadRootRunSnapshot(owner.database, initialRunRow, owner.root);
    if (initialRun.state === "terminal") invalid("RUN_ALREADY_TERMINAL", "root Run is already terminal");
    if (initialRun.coordinatorEpoch > coordinator.epoch) corrupt("root Run belongs to a future coordinator epoch");
    const initialCandidateRow = requireCandidateRow(owner.database, initialRunRow.candidate_revision);
    const candidate = loadCandidateRow(initialCandidateRow);
    requireCandidateRoot(candidate, owner.root);
    artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot, candidate);

    const work = await immediate(owner, async () => {
      await coordinator.verify();
      const currentRunRow = requireRootRunRow(owner.database, input.runId);
      const currentCandidateRow = requireCandidateRow(owner.database, initialRunRow.candidate_revision);
      requireSameCandidateRow(initialCandidateRow, currentCandidateRow);
      const run = loadRootRunSnapshot(owner.database, currentRunRow, owner.root);
      if (run.state === "terminal") invalid("RUN_ALREADY_TERMINAL", "root Run became terminal during reacquisition");
      if (run.candidateRevision !== safeRevision(initialCandidateRow.revision) ||
          run.admissionDigest !== initialRun.admissionDigest ||
          run.submissionDigest !== initialRun.submissionDigest ||
          run.coordinatorEpoch !== initialRun.coordinatorEpoch) {
        corrupt("root Run identity changed during pinned candidate reacquisition");
      }
      const spawn = findRootSpawn(owner.database, input.runId);
      if (spawn === null) corrupt("unresolved execution work has no spawn intent");
      const lifecycle = requireRootExecutionLifecycle(owner.database, input.runId);
      return Object.freeze({
        run,
        intent: loadRootSpawnRow(spawn, currentRunRow),
        candidate: markStored(candidate),
        lifecycle: loadRootExecutionLifecycle(owner.database, lifecycle, currentRunRow),
      });
    });
    await owner.finish();
    return work;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, artifacts, failure);
  }
}

/**
 * Bind a spawning terminal to exact provisional, fence, and release evidence.
 * Result admission remains the controller's responsibility before this call.
 */
export async function closePrivateRootExecution(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly runId: string;
  readonly terminal: PrivateRootRunTerminal;
}): Promise<PrivateRootRunSnapshot> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.runId, "root Run");
  const terminal = normalizePrivateRootTerminal(input.terminal);
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const run = await immediate(owner, async () => {
      await coordinator.verify();
      const runRow = requireRootRunRow(owner.database, input.runId);
      if (runRow.coordinator_epoch > BigInt(coordinator.epoch)) {
        corrupt("root Run belongs to a future coordinator epoch");
      }
      const before = loadRootRunSnapshot(owner.database, runRow, owner.root);
      if (before.state === "terminal") {
        if (!sameBytes(privateRootTerminalBytes(before.terminal!), privateRootTerminalBytes(terminal))) {
          invalid("RUN_TERMINAL_CONFLICT", "root Run already has a different terminal");
        }
        return before;
      }
      const lifecycleRow = requireRootExecutionLifecycle(owner.database, input.runId);
      const lifecycle = loadRootExecutionLifecycle(owner.database, lifecycleRow, runRow);
      requireExecutionClosable(lifecycle);
      const admitted = normalizePrivateRootTerminal(lifecycle.admitted!.value);
      if (!sameBytes(privateRootTerminalBytes(admitted), privateRootTerminalBytes(terminal))) {
        invalid("RUN_TERMINAL_CONFLICT", "final terminal differs from its admitted terminal checkpoint");
      }
      const closure = normalizeRootExecutionClosure({
        kind: "private-root-execution-closure/1",
        runId: input.runId,
        allocationDigest: lifecycle.allocation.digest,
        provisionalDigest: lifecycle.provisional!.digest,
        fenceDigest: lifecycle.fence?.digest ?? null,
        releaseDigest: lifecycle.release!.digest,
        admittedDigest: lifecycle.admitted!.digest,
      });
      const closureBytes = canonicalJson(closure);
      requireStoredSize(closureBytes, "root execution closure");
      const closureDigest = rootExecutionClosureDigest(closure);
      const priorClosure = findRootExecutionClosure(owner.database, input.runId);
      if (priorClosure === null) {
        runFinalized(owner.database,
          "INSERT INTO root_execution_closures(run_id, closure_digest, closure_bytes) VALUES (?1, ?2, ?3)",
          [input.runId, closureDigest, closureBytes],
        );
      } else {
        const loaded = loadRootExecutionClosure(priorClosure, lifecycle);
        if (loaded.digest !== closureDigest || !sameBytes(priorClosure.closure_bytes, closureBytes)) {
          corrupt("root execution already has a different closure");
        }
      }
      persistRootTerminal(owner.database, input.runId, terminal, closureDigest);
      return loadRootRunSnapshot(owner.database, runRow, owner.root);
    });
    await owner.finish();
    return run;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/** Reopen one durable root Run without granting launch authority. */
export async function loadPrivateRootRun(input: {
  readonly projectRoot: string;
  readonly runId: string;
}): Promise<PrivateRootRunSnapshot> {
  requireDigest(input.runId, "root Run");
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    const run = loadRootRunSnapshot(
      owner.database,
      requireRootRunRow(owner.database, input.runId),
      owner.root,
    );
    await owner.finish();
    return run;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/** Publish exactly one terminal for an invocation-local authenticated launch. */
export async function completePrivateRootRun(input: {
  readonly projectRoot: string;
  readonly launch: PrivateRootRunLaunch;
  readonly terminal: PrivateRootRunTerminal;
}): Promise<PrivateRootRunSnapshot> {
  const launch = requirePrivateRootRunLaunch(input.launch);
  await launch.coordinator.verify();
  const terminal = normalizePrivateRootTerminal(input.terminal);
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(launch.coordinator, owner.root);
    const run = await immediate(owner, async () => {
      await launch.coordinator.verify();
      const row = requireRootRunRow(owner.database, launch.run.runId);
      const before = loadRootRunSnapshot(owner.database, row, owner.root);
      requireLaunchMatches(launch, before, owner.database);
      if (before.state === "terminal") {
        if (!sameBytes(privateRootTerminalBytes(before.terminal!), privateRootTerminalBytes(terminal))) {
          invalid("RUN_TERMINAL_CONFLICT", "root Run already has a different terminal");
        }
        return before;
      }
      invalid(
        "RUN_EXECUTION_CLOSURE_REQUIRED",
        "use the private execution closure boundary to publish a spawning root terminal",
      );
    });
    await owner.finish();
    return run;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/** Require launch authority minted only by the successful insert transaction. */
export function requirePrivateRootRunLaunch(value: unknown): PrivateRootRunLaunch {
  if (value === null || typeof value !== "object" || !authenticRootRunLaunches.has(value)) {
    throw new TypeError("root Run launch was not minted by durable submission");
  }
  return value as PrivateRootRunLaunch;
}

/** Consume invocation-local launch authority exactly once in this coordinator. */
export function claimPrivateRootRunLaunch(value: unknown): PrivateRootRunLaunch {
  const launch = requirePrivateRootRunLaunch(value);
  if (claimedRootRunLaunches.has(launch)) {
    throw new TypeError("root Run launch authority was already consumed");
  }
  claimedRootRunLaunches.add(launch);
  return launch;
}

function requirePrivateProjectCoordinator(value: unknown): PrivateProjectCoordinator {
  if (value === null || typeof value !== "object" || !authenticCoordinators.has(value)) {
    throw new TypeError("project coordinator was not produced by the private lease boundary");
  }
  return value as PrivateProjectCoordinator;
}

function requireCoordinatorRoot(coordinator: PrivateProjectCoordinator, root: PrivateProjectRoot): void {
  if (coordinator.projectRoot !== root.requestedPath) {
    invalid("COORDINATOR_PROJECT_MISMATCH", "project coordinator belongs to a different project root");
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
      runFinalized(owner.database,
        "INSERT INTO admissions(revision, admission_digest, base_generation, plan_digest, admission_bytes) VALUES (?1, ?2, ?3, ?4, ?5)",
        [next, admissionDigest, plan.baseGeneration, input.planDigest, admissionBytes],
      );
      const changed = runFinalized(owner.database,
        "UPDATE admission_head SET revision = ?1 WHERE singleton = 1 AND revision IS ?2",
        [next, admissionHead.revision],
      ).changes;
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

function rootPreflightTerminal(
  candidate: PrivateActivationCandidateArtifact,
  request: PrivateRootSubmissionRequest,
  artifacts: ReacquiredArtifacts,
): PrivateRootRunTerminal | undefined {
  const target = candidate.candidate.target;
  if (privateActivationTargetKey(target.request.target) !== privateActivationTargetKey(request.target)) {
    return failedPrivateRootTerminal("UNAVAILABLE", "the active generation does not contain the requested root target");
  }
  if (target.disposition.state === "unavailable") {
    return failedPrivateRootTerminal("UNAVAILABLE", `the admitted target is unavailable: ${target.disposition.code}`, {
      evidenceDigests: target.disposition.evidenceDigests,
    });
  }
  try {
    artifacts.inspection(target.request.package.digest).schemas.input?.validate(request.input, "INVALID_INPUT");
  } catch (error) {
    if (!(error instanceof SchemaDiagnostic)) throw error;
    return failedPrivateRootTerminal("INVALID_INPUT", error.message, {
      code: error.code,
      instancePointer: error.instancePointer,
      schemaPointer: error.schemaPointer,
      path: error.path,
      ...(error.keyword === undefined ? {} : { keyword: error.keyword }),
    });
  }
  return undefined;
}

function findRootRunBySubmission(database: SqliteDatabase, submissionId: string): RootRunRow | null {
  const query = statement<RootRunRow>(database, [
    "SELECT run_id, submission_id, submission_digest, admission_digest, candidate_revision, coordinator_epoch, request_bytes",
    "FROM root_runs WHERE submission_id = ?1",
  ].join(" ")).safeIntegers(true);
  try {
    const row = query.get(submissionId);
    return row === null ? null : copiedRootRunRow(row);
  } finally { query.finalize(); }
}

function requireRootRunRow(database: SqliteDatabase, runId: string): RootRunRow {
  const query = statement<RootRunRow>(database, [
    "SELECT run_id, submission_id, submission_digest, admission_digest, candidate_revision, coordinator_epoch, request_bytes",
    "FROM root_runs WHERE run_id = ?1",
  ].join(" ")).safeIntegers(true);
  let row: RootRunRow | null;
  try {
    const selected = query.get(runId);
    row = selected === null ? null : copiedRootRunRow(selected);
  } finally { query.finalize(); }
  if (row === null) unavailable("RUN_MISSING", "root Run does not exist");
  return row;
}

function findRootSpawn(database: SqliteDatabase, runId: string): RootSpawnRow | null {
  const query = statement<RootSpawnRow>(database,
    "SELECT run_id, intent_digest, intent_bytes FROM root_spawn_intents WHERE run_id = ?1",
  );
  try {
    const row = query.get(runId);
    return row === null ? null : Object.freeze({
      run_id: row.run_id,
      intent_digest: row.intent_digest,
      intent_bytes: copiedBlob(row.intent_bytes, "stored root spawn intent"),
    });
  } finally { query.finalize(); }
}

function findRootExecutionLifecycle(
  database: SqliteDatabase,
  runId: string,
): RootExecutionLifecycleRow | null {
  const query = statement<RootExecutionLifecycleRow>(database, [
    "SELECT run_id, allocation_digest, allocation_bytes, plan_digest, plan_bytes,",
    "backing_digest, backing_bytes, sandbox_digest, sandbox_bytes, prepared_digest, prepared_bytes,",
    "provisional_digest, provisional_bytes, fence_digest, fence_bytes, release_digest, release_bytes, admitted_digest, admitted_bytes",
    "FROM root_execution_lifecycles WHERE run_id = ?1",
  ].join(" "));
  try {
    const row = query.get(runId);
    return row === null ? null : copiedRootExecutionLifecycleRow(row);
  } finally { query.finalize(); }
}

function requireRootExecutionLifecycle(
  database: SqliteDatabase,
  runId: string,
): RootExecutionLifecycleRow {
  const row = findRootExecutionLifecycle(database, runId);
  if (row === null) invalid("RUN_EXECUTION_UNALLOCATED", "root Run has no durable execution allocation");
  return row;
}

function copiedRootExecutionLifecycleRow(row: RootExecutionLifecycleRow): RootExecutionLifecycleRow {
  return Object.freeze({
    run_id: row.run_id,
    allocation_digest: row.allocation_digest,
    allocation_bytes: copiedBlob(row.allocation_bytes, "stored root execution allocation"),
    plan_digest: row.plan_digest,
    plan_bytes: copiedOptionalBlob(row.plan_bytes, "stored root execution plan"),
    backing_digest: row.backing_digest,
    backing_bytes: copiedOptionalBlob(row.backing_bytes, "stored root execution backing"),
    sandbox_digest: row.sandbox_digest,
    sandbox_bytes: copiedOptionalBlob(row.sandbox_bytes, "stored root execution sandbox"),
    prepared_digest: row.prepared_digest,
    prepared_bytes: copiedOptionalBlob(row.prepared_bytes, "stored root execution preparation"),
    provisional_digest: row.provisional_digest,
    provisional_bytes: copiedOptionalBlob(row.provisional_bytes, "stored root execution provisional terminal"),
    fence_digest: row.fence_digest,
    fence_bytes: copiedOptionalBlob(row.fence_bytes, "stored root execution fence"),
    release_digest: row.release_digest,
    release_bytes: copiedOptionalBlob(row.release_bytes, "stored root execution release"),
    admitted_digest: row.admitted_digest,
    admitted_bytes: copiedOptionalBlob(row.admitted_bytes, "stored root execution admitted terminal"),
  });
}

function findRootExecutionClosure(database: SqliteDatabase, runId: string): RootExecutionClosureRow | null {
  const query = statement<RootExecutionClosureRow>(database,
    "SELECT run_id, closure_digest, closure_bytes FROM root_execution_closures WHERE run_id = ?1",
  );
  try {
    const row = query.get(runId);
    return row === null ? null : Object.freeze({
      run_id: row.run_id,
      closure_digest: row.closure_digest,
      closure_bytes: copiedBlob(row.closure_bytes, "stored root execution closure"),
    });
  } finally { query.finalize(); }
}

function requireRootExecutionClosure(database: SqliteDatabase, runId: string): RootExecutionClosureRow {
  const row = findRootExecutionClosure(database, runId);
  if (row === null) corrupt("spawning root terminal has no execution closure record");
  return row;
}

function loadRootExecutionLifecycle(
  database: SqliteDatabase,
  row: RootExecutionLifecycleRow,
  run: RootRunRow,
): PrivateRootExecutionLifecycle {
  if (row.run_id !== run.run_id) corrupt("stored root execution lifecycle names a different Run");
  requireDigest(row.allocation_digest, "stored root execution allocation");
  const allocationBytes = copiedBlob(row.allocation_bytes, "stored root execution allocation");
  let allocation: ReturnType<typeof normalizeRootExecutionAllocation>;
  try { allocation = normalizeRootExecutionAllocation(decodeJson1(allocationBytes)); }
  catch { corrupt("stored root execution allocation is invalid"); }
  if (!sameBytes(allocationBytes, canonicalJson(allocation)) ||
      rootExecutionAllocationDigest(allocation) !== row.allocation_digest ||
      allocation.runId !== run.run_id ||
      allocation.coordinatorEpoch !== safeRevision(run.coordinator_epoch)) {
    corrupt("stored root execution allocation differs from its durable identity");
  }
  const spawn = findRootSpawn(database, run.run_id);
  if (spawn === null) corrupt("stored root execution lifecycle has no spawn intent");
  if (allocation.spawnIntentDigest !== privateRootSpawnIntentDigest(loadRootSpawnRow(spawn, run))) {
    corrupt("stored root execution allocation names a different spawn intent");
  }
  const result: PrivateRootExecutionLifecycle = {
    runId: run.run_id,
    allocation: Object.freeze({ digest: row.allocation_digest, value: allocation.value }),
    ...loadOptionalExecutionFact(row, "plan", row.allocation_digest),
    ...loadOptionalExecutionFact(row, "backing", row.allocation_digest),
    ...loadOptionalExecutionFact(row, "sandbox", row.allocation_digest),
    ...loadOptionalExecutionFact(row, "prepared", row.allocation_digest),
    ...loadOptionalExecutionFact(row, "provisional", row.allocation_digest),
    ...loadOptionalExecutionFact(row, "fence", row.allocation_digest),
    ...loadOptionalExecutionFact(row, "release", row.allocation_digest),
    ...loadOptionalExecutionFact(row, "admitted", row.allocation_digest),
  };
  validateLoadedLifecycle(result);
  const closureRow = findRootExecutionClosure(database, run.run_id);
  if (closureRow === null) return Object.freeze(result);
  const closure = loadRootExecutionClosure(closureRow, result);
  return Object.freeze({ ...result, closureDigest: closure.digest });
}

function loadOptionalExecutionFact(
  row: RootExecutionLifecycleRow,
  checkpoint: PrivateRootExecutionCheckpointName,
  allocationDigest: string,
): Partial<Record<PrivateRootExecutionCheckpointName, PrivateRootExecutionFact>> {
  const digest = checkpointDigest(row, checkpoint);
  const bytes = checkpointBytes(row, checkpoint);
  if ((digest === null) !== (bytes === null)) corrupt(`stored root execution ${checkpoint} pair is incomplete`);
  if (digest === null || bytes === null) return {};
  requireDigest(digest, `stored root execution ${checkpoint}`);
  let envelope: ReturnType<typeof normalizeRootExecutionCheckpoint>;
  try { envelope = normalizeRootExecutionCheckpoint(decodeJson1(bytes), checkpoint); }
  catch { corrupt(`stored root execution ${checkpoint} checkpoint is invalid`); }
  if (!sameBytes(bytes, canonicalJson(envelope)) ||
      rootExecutionCheckpointDigest(checkpoint, envelope) !== digest ||
      envelope.runId !== row.run_id ||
      envelope.allocationDigest !== allocationDigest) {
    corrupt(`stored root execution ${checkpoint} differs from its durable identity`);
  }
  if (checkpoint === "provisional" || checkpoint === "admitted") {
    let terminal: PrivateRootRunTerminal;
    try { terminal = normalizePrivateRootTerminal(envelope.value); }
    catch { corrupt(`stored root execution ${checkpoint} terminal is invalid`); }
    envelope = Object.freeze({ ...envelope, value: terminal as unknown as JsonValue });
  }
  return { [checkpoint]: Object.freeze({ digest, value: envelope.value }) };
}

function loadRootExecutionClosure(
  row: RootExecutionClosureRow,
  lifecycle: PrivateRootExecutionLifecycle,
): { readonly digest: string } {
  if (row.run_id !== lifecycle.runId) corrupt("stored root execution closure names a different Run");
  requireDigest(row.closure_digest, "stored root execution closure");
  const bytes = copiedBlob(row.closure_bytes, "stored root execution closure");
  let closure: ReturnType<typeof normalizeRootExecutionClosure>;
  try { closure = normalizeRootExecutionClosure(decodeJson1(bytes)); }
  catch { corrupt("stored root execution closure is invalid"); }
  requireExecutionClosable(lifecycle);
  if (!sameBytes(bytes, canonicalJson(closure)) ||
      rootExecutionClosureDigest(closure) !== row.closure_digest ||
      closure.runId !== lifecycle.runId ||
      closure.allocationDigest !== lifecycle.allocation.digest ||
      closure.provisionalDigest !== lifecycle.provisional!.digest ||
      closure.fenceDigest !== (lifecycle.fence?.digest ?? null) ||
      closure.releaseDigest !== lifecycle.release!.digest ||
      closure.admittedDigest !== lifecycle.admitted!.digest) {
    corrupt("stored root execution closure differs from its durable evidence");
  }
  return Object.freeze({ digest: row.closure_digest });
}

function findRootTerminal(database: SqliteDatabase, runId: string): RootTerminalRow | null {
  const query = statement<RootTerminalRow>(database,
    "SELECT run_id, execution_closure_digest, terminal_digest, terminal_bytes FROM root_terminals WHERE run_id = ?1",
  );
  try {
    const row = query.get(runId);
    return row === null ? null : Object.freeze({
      run_id: row.run_id,
      execution_closure_digest: row.execution_closure_digest,
      terminal_digest: row.terminal_digest,
      terminal_bytes: copiedBlob(row.terminal_bytes, "stored root terminal"),
    });
  } finally { query.finalize(); }
}

function copiedRootRunRow(row: RootRunRow): RootRunRow {
  return Object.freeze({
    run_id: row.run_id,
    submission_id: row.submission_id,
    submission_digest: row.submission_digest,
    admission_digest: row.admission_digest,
    candidate_revision: row.candidate_revision,
    coordinator_epoch: row.coordinator_epoch,
    request_bytes: copiedBlob(row.request_bytes, "stored root Run request"),
  });
}

function loadRootRunSnapshot(
  database: SqliteDatabase,
  row: RootRunRow,
  root: PrivateProjectRoot,
): PrivateRootRunSnapshot {
  requireDigest(row.run_id, "stored root Run");
  try { requirePrivateRootSubmissionId(row.submission_id); }
  catch { corrupt("stored root submission ID is invalid"); }
  requireDigest(row.submission_digest, "stored root submission");
  requireDigest(row.admission_digest, "stored root admission");
  const coordinatorEpoch = safeRevision(row.coordinator_epoch);
  if (row.coordinator_epoch > readCoordinatorEpoch(database)) {
    corrupt("stored root Run names a future coordinator epoch");
  }
  let request: PrivateRootSubmissionRequest;
  try { request = decodePrivateRootSubmissionRequest(copiedBlob(row.request_bytes, "stored root Run request")); }
  catch { corrupt("stored root Run request is invalid"); }
  if (privateRootSubmissionDigest(request) !== row.submission_digest) corrupt("stored root submission digest differs from its request");
  const expectedRunId = privateDomainDigest("JIG-Private-Root-Run/1", {
    project: {
      device: root.information.dev.toString(),
      inode: root.information.ino.toString(),
    },
    submissionId: row.submission_id,
    submissionDigest: row.submission_digest,
    requestDigest: privateRootRequestDigest(request),
    coordinatorEpoch,
  });
  if (row.run_id !== expectedRunId) corrupt("stored root Run ID differs from its submission identity");
  const admissionRow = requireAdmissionByDigest(database, row.admission_digest);
  const admission = loadAndCrossCheckAdmission(database, admissionRow, root);
  const candidateRevision = safeRevision(row.candidate_revision);
  if (admission.admission.candidateRevision !== candidateRevision) {
    corrupt("stored root Run candidate differs from its pinned admission");
  }
  const spawn = findRootSpawn(database, row.run_id);
  const terminalRow = findRootTerminal(database, row.run_id);
  if (spawn === null && terminalRow === null) corrupt("stored root Run has neither a spawn intent nor a terminal");
  if (spawn !== null && findRootExecutionLifecycle(database, row.run_id) === null) {
    corrupt("stored root spawn intent has no atomic execution lifecycle");
  }
  if (spawn !== null && loadRootSpawnRow(spawn, row).deadlineUnixMs !== request.deadlineUnixMs) {
    corrupt("stored root spawn intent deadline differs from its root request");
  }
  if (spawn === null && terminalRow?.execution_closure_digest !== null) {
    corrupt("nonspawning root terminal names an execution closure");
  }
  if (spawn !== null && terminalRow !== null) {
    if (terminalRow.execution_closure_digest === null) {
      corrupt("spawning root terminal has no execution closure");
    }
    const lifecycleRow = requireRootExecutionLifecycle(database, row.run_id);
    const lifecycle = loadRootExecutionLifecycle(database, lifecycleRow, row);
    const closureRow = requireRootExecutionClosure(database, row.run_id);
    const closure = loadRootExecutionClosure(closureRow, lifecycle);
    if (closure.digest !== terminalRow.execution_closure_digest) {
      corrupt("root terminal names a different execution closure");
    }
  }
  const terminal = terminalRow === null ? undefined : loadRootTerminalRow(terminalRow, row.run_id);
  return Object.freeze({
    runId: row.run_id,
    submissionId: row.submission_id,
    submissionDigest: row.submission_digest,
    admissionDigest: row.admission_digest,
    candidateRevision,
    coordinatorEpoch,
    target: request.target,
    input: request.input,
    deadlineUnixMs: request.deadlineUnixMs,
    state: terminal === undefined ? "spawn-intent" as const : "terminal" as const,
    ...(terminal === undefined ? {} : { terminal }),
  });
}

function requireSameSubmission(run: PrivateRootRunSnapshot, submissionDigest: string): void {
  if (run.submissionDigest !== submissionDigest) {
    invalid("SUBMISSION_CONFLICT", "root submission ID already names different immutable content");
  }
}

function reconcileRootRunsBeforeEpoch(
  database: SqliteDatabase,
  root: PrivateProjectRoot,
  epoch: bigint,
): readonly PrivateRootRunSnapshot[] {
  const future = statement<{ readonly count: bigint }>(database,
    "SELECT count(*) AS count FROM root_runs WHERE coordinator_epoch >= ?1",
  ).safeIntegers(true);
  let futureCount: bigint | undefined;
  try { futureCount = future.get(epoch)?.count; }
  finally { future.finalize(); }
  if (futureCount !== 0n) corrupt("a root Run names the new or a future coordinator epoch before takeover");
  const query = statement<RootRunRow>(database, [
    "SELECT root_runs.run_id, root_runs.submission_id, root_runs.submission_digest,",
    "root_runs.admission_digest, root_runs.candidate_revision, root_runs.coordinator_epoch, root_runs.request_bytes",
    "FROM root_runs JOIN root_spawn_intents USING (run_id)",
    "LEFT JOIN root_terminals USING (run_id)",
    "WHERE root_terminals.run_id IS NULL AND root_runs.coordinator_epoch < ?1 ORDER BY root_runs.run_id",
  ].join(" ")).safeIntegers(true);
  let rows: readonly RootRunRow[];
  try { rows = query.all(epoch).map(copiedRootRunRow); }
  finally { query.finalize(); }
  const result: PrivateRootRunSnapshot[] = [];
  for (const row of rows) {
    result.push(loadRootRunSnapshot(database, row, root));
  }
  return Object.freeze(result);
}

function loadRootSpawnRow(row: RootSpawnRow, run: RootRunRow): PrivateRootRunSpawnIntent {
  if (row.run_id !== run.run_id) corrupt("stored root spawn intent names a different Run");
  requireDigest(row.intent_digest, "stored root spawn intent");
  const bytes = copiedBlob(row.intent_bytes, "stored root spawn intent");
  let intent: PrivateRootRunSpawnIntent;
  try { intent = normalizePrivateRootSpawnIntent(decodeJson1(bytes)); }
  catch { corrupt("stored root spawn intent is invalid"); }
  if (!sameBytes(bytes, canonicalJson(intent as unknown as JsonValue)) ||
      privateRootSpawnIntentDigest(intent) !== row.intent_digest ||
      intent.runId !== run.run_id ||
      intent.admissionDigest !== run.admission_digest ||
      intent.candidateRevision !== safeRevision(run.candidate_revision) ||
      intent.coordinatorEpoch !== safeRevision(run.coordinator_epoch)) {
    corrupt("stored root spawn intent differs from its durable identity");
  }
  return intent;
}

function persistRootTerminal(
  database: SqliteDatabase,
  runId: string,
  terminalValue: PrivateRootRunTerminal,
  executionClosureDigest: string | null = null,
): void {
  const terminal = normalizePrivateRootTerminal(terminalValue);
  const bytes = privateRootTerminalBytes(terminal);
  requireStoredSize(bytes, "root Run terminal");
  const digest = privateDomainDigest("JIG-Private-Root-Terminal/1", terminal as unknown as JsonValue);
  runFinalized(database,
    "INSERT INTO root_terminals(run_id, execution_closure_digest, terminal_digest, terminal_bytes) VALUES (?1, ?2, ?3, ?4)",
    [runId, executionClosureDigest, digest, bytes],
  );
}

function normalizeRootExecutionAllocation(value: unknown): Readonly<{
  readonly kind: "private-root-execution-allocation/1";
  readonly runId: string;
  readonly spawnIntentDigest: string;
  readonly coordinatorEpoch: number;
  readonly value: JsonValue;
}> {
  const root = exactJsonObject(value, [
    "kind", "runId", "spawnIntentDigest", "coordinatorEpoch", "value",
  ], "root execution allocation");
  if (root.kind !== "private-root-execution-allocation/1") {
    throw new TypeError("root execution allocation kind is invalid");
  }
  requireDigest(root.runId, "root execution allocation Run");
  requireDigest(root.spawnIntentDigest, "root execution allocation spawn intent");
  if (!Number.isSafeInteger(root.coordinatorEpoch) || (root.coordinatorEpoch as number) < 1) {
    throw new TypeError("root execution allocation coordinator epoch is invalid");
  }
  return Object.freeze({
    kind: "private-root-execution-allocation/1",
    runId: root.runId,
    spawnIntentDigest: root.spawnIntentDigest,
    coordinatorEpoch: root.coordinatorEpoch as number,
    value: decodeJson1(canonicalJson(root.value as JsonValue)),
  });
}

function rootExecutionAllocationDigest(
  value: ReturnType<typeof normalizeRootExecutionAllocation>,
): string {
  return privateDomainDigest("JIG-Private-Root-Execution-Allocation/1", value as unknown as JsonValue);
}

function normalizeRootExecutionCheckpoint(
  value: unknown,
  checkpoint: PrivateRootExecutionCheckpointName,
): Readonly<{
  readonly kind: `private-root-execution-${PrivateRootExecutionCheckpointName}/1`;
  readonly runId: string;
  readonly allocationDigest: string;
  readonly value: JsonValue;
}> {
  const root = exactJsonObject(
    value,
    ["kind", "runId", "allocationDigest", "value"],
    `root execution ${checkpoint}`,
  );
  const kind = `private-root-execution-${checkpoint}/1` as const;
  if (root.kind !== kind) throw new TypeError(`root execution ${checkpoint} kind is invalid`);
  requireDigest(root.runId, `root execution ${checkpoint} Run`);
  requireDigest(root.allocationDigest, `root execution ${checkpoint} allocation`);
  return Object.freeze({
    kind,
    runId: root.runId,
    allocationDigest: root.allocationDigest,
    value: decodeJson1(canonicalJson(root.value as JsonValue)),
  });
}

function rootExecutionCheckpointDigest(
  checkpoint: PrivateRootExecutionCheckpointName,
  value: ReturnType<typeof normalizeRootExecutionCheckpoint>,
): string {
  return privateDomainDigest(
    `JIG-Private-Root-Execution-${checkpoint[0]!.toUpperCase()}${checkpoint.slice(1)}/1`,
    value as unknown as JsonValue,
  );
}

function normalizeRootExecutionClosure(value: unknown): Readonly<{
  readonly kind: "private-root-execution-closure/1";
  readonly runId: string;
  readonly allocationDigest: string;
  readonly provisionalDigest: string;
  readonly fenceDigest: string | null;
  readonly releaseDigest: string;
  readonly admittedDigest: string;
}> {
  const root = exactJsonObject(value, [
    "kind", "runId", "allocationDigest", "provisionalDigest", "fenceDigest", "releaseDigest", "admittedDigest",
  ], "root execution closure");
  if (root.kind !== "private-root-execution-closure/1") {
    throw new TypeError("root execution closure kind is invalid");
  }
  requireDigest(root.runId, "root execution closure Run");
  requireDigest(root.allocationDigest, "root execution closure allocation");
  requireDigest(root.provisionalDigest, "root execution closure provisional terminal");
  if (root.fenceDigest !== null) requireDigest(root.fenceDigest, "root execution closure fence");
  requireDigest(root.releaseDigest, "root execution closure release");
  requireDigest(root.admittedDigest, "root execution closure admitted terminal");
  return Object.freeze({
    kind: "private-root-execution-closure/1",
    runId: root.runId,
    allocationDigest: root.allocationDigest,
    provisionalDigest: root.provisionalDigest,
    fenceDigest: root.fenceDigest,
    releaseDigest: root.releaseDigest,
    admittedDigest: root.admittedDigest,
  });
}

function rootExecutionClosureDigest(
  value: ReturnType<typeof normalizeRootExecutionClosure>,
): string {
  return privateDomainDigest("JIG-Private-Root-Execution-Closure/1", value as unknown as JsonValue);
}

function checkpointColumns(checkpoint: PrivateRootExecutionCheckpointName): {
  readonly digest: string;
  readonly bytes: string;
} {
  return Object.freeze({ digest: `${checkpoint}_digest`, bytes: `${checkpoint}_bytes` });
}

function checkpointDigest(
  row: RootExecutionLifecycleRow,
  checkpoint: PrivateRootExecutionCheckpointName,
): string | null {
  return row[`${checkpoint}_digest` as keyof RootExecutionLifecycleRow] as string | null;
}

function checkpointBytes(
  row: RootExecutionLifecycleRow,
  checkpoint: PrivateRootExecutionCheckpointName,
): Uint8Array | null {
  return row[`${checkpoint}_bytes` as keyof RootExecutionLifecycleRow] as Uint8Array | null;
}

function executionFact(
  lifecycle: PrivateRootExecutionLifecycle,
  checkpoint: PrivateRootExecutionCheckpointName,
): PrivateRootExecutionFact | undefined {
  return lifecycle[checkpoint];
}

function requireRootExecutionCheckpointName(value: unknown): PrivateRootExecutionCheckpointName {
  if (value !== "plan" && value !== "backing" && value !== "sandbox" &&
      value !== "prepared" && value !== "provisional" && value !== "fence" &&
      value !== "release" && value !== "admitted") {
    throw new TypeError("root execution checkpoint name is invalid");
  }
  return value;
}

function requireCheckpointAuthority(
  run: PrivateRootRunSnapshot,
  coordinator: PrivateProjectCoordinator,
  checkpoint: PrivateRootExecutionCheckpointName,
  value: JsonValue,
): void {
  const advancesExecution = checkpoint === "plan" || checkpoint === "backing" ||
    checkpoint === "sandbox" || checkpoint === "prepared";
  const replacement = run.coordinatorEpoch < coordinator.epoch;
  if (advancesExecution && replacement) {
    invalid(
      "RUN_COORDINATOR_STALE",
      "a recovery owner cannot advance an older root Run toward package admission",
    );
  }
  if (checkpoint === "provisional" && replacement) {
    const terminal = normalizePrivateRootTerminal(value);
    if (terminal.status !== "lost" || terminal.code !== "COORDINATOR_LOST") {
      invalid(
        "RUN_COORDINATOR_STALE",
        "a recovery owner may create only a COORDINATOR_LOST provisional terminal",
      );
    }
  }
}

function requireCheckpointOrder(
  lifecycle: PrivateRootExecutionLifecycle,
  checkpoint: PrivateRootExecutionCheckpointName,
  value: JsonValue,
): void {
  if (lifecycle.closureDigest !== undefined) {
    invalid("RUN_EXECUTION_CLOSED", "root execution already has durable closure evidence");
  }
  const effectClosed = lifecycle.provisional !== undefined || lifecycle.release !== undefined ||
    lifecycle.admitted !== undefined;
  switch (checkpoint) {
    case "plan":
      if (effectClosed) invalid("RUN_EXECUTION_ORDER", "root execution cannot be planned after settlement began");
      return;
    case "backing":
      if (lifecycle.plan === undefined || effectClosed) {
        invalid("RUN_EXECUTION_ORDER", "root execution backing requires an unsettled plan");
      }
      return;
    case "sandbox":
      if (lifecycle.backing === undefined || effectClosed) {
        invalid("RUN_EXECUTION_ORDER", "root execution sandbox requires retained backing");
      }
      return;
    case "prepared":
      if (lifecycle.sandbox === undefined || lifecycle.fence !== undefined || effectClosed) {
        invalid("RUN_EXECUTION_ORDER", "root execution preparation requires a sealed sandbox owner");
      }
      return;
    case "provisional":
      if (lifecycle.admitted !== undefined) {
        invalid("RUN_EXECUTION_ORDER", "root execution observation cannot change after result admission");
      }
      if (normalizePrivateRootTerminal(value).status === "succeeded" && lifecycle.prepared === undefined) {
        invalid("RUN_EXECUTION_ORDER", "successful root execution requires preparation evidence");
      }
      return;
    case "fence":
      if (lifecycle.sandbox === undefined || lifecycle.release !== undefined || lifecycle.admitted !== undefined) {
        invalid("RUN_EXECUTION_ORDER", "root execution fence requires an unreleased sandbox owner");
      }
      return;
    case "release":
      if (lifecycle.provisional === undefined || lifecycle.admitted !== undefined) {
        invalid("RUN_EXECUTION_ORDER", "root execution release requires a provisional terminal before result admission");
      }
      if (lifecycle.sandbox !== undefined && lifecycle.fence === undefined) {
        invalid("RUN_EXECUTION_ORDER", "root execution backing cannot be released before its sandbox fence");
      }
      return;
    case "admitted":
      if (lifecycle.provisional === undefined || lifecycle.release === undefined) {
        invalid("RUN_EXECUTION_ORDER", "root execution result admission requires provisional and release evidence");
      }
      if (lifecycle.sandbox !== undefined && lifecycle.fence === undefined) {
        invalid("RUN_EXECUTION_ORDER", "root execution result admission requires a confirmed sandbox fence");
      }
      requireFinalMatchesProvisional(lifecycle.provisional.value, normalizePrivateRootTerminal(value));
      return;
  }
}

function validateLoadedLifecycle(lifecycle: PrivateRootExecutionLifecycle): void {
  if (lifecycle.backing !== undefined && lifecycle.plan === undefined) {
    corrupt("stored root execution backing has no plan");
  }
  if (lifecycle.sandbox !== undefined && lifecycle.backing === undefined) {
    corrupt("stored root execution sandbox has no backing");
  }
  if (lifecycle.prepared !== undefined && lifecycle.sandbox === undefined) {
    corrupt("stored root execution preparation has no sandbox owner");
  }
  if (lifecycle.fence !== undefined && lifecycle.sandbox === undefined) {
    corrupt("stored root execution fence has no sandbox owner");
  }
  if (lifecycle.release !== undefined && lifecycle.sandbox !== undefined && lifecycle.fence === undefined) {
    corrupt("stored root execution released backing before its sandbox fence");
  }
  if (lifecycle.admitted !== undefined) {
    if (lifecycle.provisional === undefined || lifecycle.release === undefined) {
      corrupt("stored root execution admitted a result before provisional and release evidence");
    }
    if (lifecycle.sandbox !== undefined && lifecycle.fence === undefined) {
      corrupt("stored root execution admitted a result before its sandbox fence");
    }
    try {
      requireFinalMatchesProvisional(
        lifecycle.provisional.value,
        normalizePrivateRootTerminal(lifecycle.admitted.value),
      );
    } catch {
      corrupt("stored root execution admitted terminal is inconsistent with its provisional terminal");
    }
  }
  if (lifecycle.provisional !== undefined &&
      normalizePrivateRootTerminal(lifecycle.provisional.value).status === "succeeded" &&
      lifecycle.prepared === undefined) {
    corrupt("stored successful root execution has no preparation evidence");
  }
}

function requireExecutionClosable(lifecycle: PrivateRootExecutionLifecycle): void {
  if (lifecycle.provisional === undefined) {
    invalid("RUN_EXECUTION_INCOMPLETE", "root execution has no provisional terminal");
  }
  if (lifecycle.release === undefined) {
    invalid("RUN_EXECUTION_INCOMPLETE", "root execution backing has not been released");
  }
  if (lifecycle.admitted === undefined) {
    invalid("RUN_EXECUTION_INCOMPLETE", "root execution result has not been admitted");
  }
  if (lifecycle.sandbox !== undefined && lifecycle.fence === undefined) {
    invalid("RUN_EXECUTION_INCOMPLETE", "root execution sandbox has not been fenced");
  }
}

function requireFinalMatchesProvisional(value: JsonValue, terminal: PrivateRootRunTerminal): void {
  const provisional = normalizePrivateRootTerminal(value);
  if (provisional.status !== "succeeded") {
    if (!sameBytes(privateRootTerminalBytes(provisional), privateRootTerminalBytes(terminal))) {
      invalid("RUN_TERMINAL_CONFLICT", "final terminal differs from its provisional failure");
    }
    return;
  }
  if (terminal.status === "succeeded") {
    if (!sameBytes(privateRootTerminalBytes(provisional), privateRootTerminalBytes(terminal))) {
      invalid("RUN_TERMINAL_CONFLICT", "final success differs from its provisional result");
    }
    return;
  }
  if (terminal.status !== "failed" || terminal.code !== "INVALID_RESULT" ||
      !sameBytes(
        canonicalJson(provisional.diagnostics as unknown as JsonValue),
        canonicalJson(terminal.diagnostics as unknown as JsonValue),
      )) {
    invalid("RUN_TERMINAL_CONFLICT", "provisional success may change only to INVALID_RESULT");
  }
}

function exactJsonObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  return value as Record<string, unknown>;
}

function runFinalized(database: SqliteDatabase, sql: string, bindings: readonly unknown[]): SqliteRunResult {
  const query = statement<never>(database, sql);
  try { return query.run(...bindings); }
  finally { query.finalize(); }
}

function loadRootTerminalRow(row: RootTerminalRow, runId: string): PrivateRootRunTerminal {
  if (row.run_id !== runId) corrupt("stored root terminal names a different Run");
  requireDigest(row.terminal_digest, "stored root terminal");
  const bytes = copiedBlob(row.terminal_bytes, "stored root terminal");
  let terminal: PrivateRootRunTerminal;
  try { terminal = normalizePrivateRootTerminal(decodeJson1(bytes)); }
  catch { corrupt("stored root terminal is invalid"); }
  if (!sameBytes(bytes, privateRootTerminalBytes(terminal)) ||
      privateDomainDigest("JIG-Private-Root-Terminal/1", terminal as unknown as JsonValue) !== row.terminal_digest) {
    corrupt("stored root terminal differs from its durable identity");
  }
  return terminal;
}

function requireLaunchMatches(
  launch: PrivateRootRunLaunch,
  run: PrivateRootRunSnapshot,
  database: SqliteDatabase,
): void {
  if (launch.run.runId !== run.runId || launch.run.submissionDigest !== run.submissionDigest) {
    invalid("RUN_LAUNCH_CONFLICT", "root Run launch does not match durable submission state");
  }
  const row = requireRootRunRow(database, run.runId);
  const spawn = findRootSpawn(database, run.runId);
  if (spawn === null) corrupt("authenticated root Run launch has no durable spawn intent");
  const intent = loadRootSpawnRow(spawn, row);
  if (privateRootSpawnIntentDigest(intent) !== privateRootSpawnIntentDigest(launch.intent)) {
    invalid("RUN_LAUNCH_CONFLICT", "root Run launch differs from its durable spawn intent");
  }
  if (run.coordinatorEpoch !== launch.coordinator.epoch || intent.coordinatorEpoch !== launch.coordinator.epoch) {
    invalid("RUN_COORDINATOR_STALE", "root Run launch belongs to a different coordinator epoch");
  }
}

async function openCoordinatorLock(owner: StateOwner): Promise<CoordinatorLock> {
  const databasePath = descriptorChild(owner.directory, COORDINATOR_DATABASE_NAME);
  const directoryInformation = await owner.directory.stat({ bigint: true });
  const databaseInformation = await ensureDatabaseFile(
    databasePath,
    owner.directory,
    directoryInformation.dev,
    true,
    COORDINATOR_DATABASE_NAME,
  );
  await validateSidecars(owner.directory, databaseInformation.dev, COORDINATOR_DATABASE_NAME);
  const visibleStatePath = join(owner.root.requestedPath, STATE_DIRECTORY);
  const visibleDatabasePath = join(visibleStatePath, COORDINATOR_DATABASE_NAME);
  await verifyVisibleHierarchy(
    owner.root,
    visibleStatePath,
    directoryInformation,
    visibleDatabasePath,
    databaseInformation,
  );
  const sqlite = loadSqlite();
  const flags = sqliteFlag(sqlite, "SQLITE_OPEN_READWRITE") |
    sqliteFlag(sqlite, "SQLITE_OPEN_NOFOLLOW");
  const database = sqlite.Database.open(visibleDatabasePath, flags);
  try {
    configureConnection(database);
    initializeOrVerifyCoordinatorSchema(database);
    let disposed = false;
    const lock: CoordinatorLock = Object.freeze({
      database,
      async verify(): Promise<void> {
        if (disposed) unavailable("COORDINATOR_CLOSED", "project coordinator lock has been disposed");
        await owner.verify();
        await verifyPathIdentity(
          databasePath,
          databaseInformation,
          "coordinator database",
          (information) => requireDatabaseFile(information, directoryInformation.dev),
        );
        await verifyVisibleHierarchy(
          owner.root,
          visibleStatePath,
          directoryInformation,
          visibleDatabasePath,
          databaseInformation,
        );
        await validateSidecars(owner.directory, databaseInformation.dev, COORDINATOR_DATABASE_NAME);
      },
      async dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        const failures: unknown[] = [];
        if (database.inTransaction) {
          try { database.exec("ROLLBACK"); } catch (error) { failures.push(error); }
        }
        try { database.close(true); } catch (error) { failures.push(error); }
        if (failures.length > 0) throw new AggregateError(failures, "coordinator lock cleanup did not complete");
      },
    });
    await lock.verify();
    return lock;
  } catch (error) {
    try { database.close(true); } catch { /* preserve the primary open failure */ }
    if (isSqliteBusy(error)) unavailable("COORDINATOR_BUSY", "another coordinator owns this project");
    throw error;
  }
}

function initializeOrVerifyCoordinatorSchema(database: SqliteDatabase): void {
  try { database.exec("BEGIN IMMEDIATE"); }
  catch (error) {
    if (isSqliteBusy(error)) unavailable("COORDINATOR_BUSY", "another coordinator owns this project");
    throw error;
  }
  try {
    const version = pragmaInteger(database, "user_version");
    const application = pragmaInteger(database, "application_id");
    const existing = schemaRows(database);
    if (version === 0n && application === 0n && existing.length === 0) {
      database.exec(CREATE_COORDINATOR_LOCK);
      database.exec("INSERT INTO coordinator_lock(singleton) VALUES (1)");
      database.exec(`PRAGMA application_id=${COORDINATOR_APPLICATION_ID}`);
      database.exec(`PRAGMA user_version=${COORDINATOR_SCHEMA_VERSION}`);
    } else if (version !== COORDINATOR_SCHEMA_VERSION || application !== COORDINATOR_APPLICATION_ID) {
      invalid("COORDINATOR_SCHEMA_VERSION", "private coordinator database has an unsupported format identity");
    }
    const rows = schemaRows(database);
    if (rows.length !== 1 || rows[0]!.type !== "table" || rows[0]!.name !== "coordinator_lock" ||
        rows[0]!.table !== "coordinator_lock" || rows[0]!.sql !== CREATE_COORDINATOR_LOCK) {
      corrupt("private coordinator database schema differs from version 1");
    }
    const holderQuery = statement<{ readonly singleton: bigint }>(database,
      "SELECT singleton FROM coordinator_lock",
    ).safeIntegers(true);
    let holders: readonly { readonly singleton: bigint }[];
    try { holders = holderQuery.all(); }
    finally { holderQuery.finalize(); }
    if (holders.length !== 1 || holders[0]!.singleton !== 1n) corrupt("private coordinator lock row is invalid");
    database.exec("COMMIT");
  } catch (error) { rollback(database, error); }
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
  databaseName = DATABASE_NAME,
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
    if (hasCode(error, "ENOENT")) unavailable("ADMISSION_STATE_MISSING", `${databaseName} does not exist`);
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

async function validateSidecars(
  directory: FileHandle,
  expectedDevice: bigint,
  databaseName = DATABASE_NAME,
): Promise<void> {
  for (const suffix of ["-wal", "-shm"] as const) {
    if (await pathExists(descriptorChild(directory, `${databaseName}${suffix}`))) {
      invalid("ADMISSION_SQLITE_SIDECAR", `private admission database must not use SQLite ${suffix.slice(1).toUpperCase()} state`);
    }
  }
  const journalPath = descriptorChild(directory, `${databaseName}-journal`);
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
      database.exec(CREATE_COORDINATOR_HEAD);
      database.exec(CREATE_ROOT_RUNS);
      database.exec(CREATE_ROOT_SPAWN_INTENTS);
      database.exec(CREATE_ROOT_EXECUTION_LIFECYCLES);
      database.exec(CREATE_ROOT_EXECUTION_CLOSURES);
      database.exec(CREATE_ROOT_TERMINALS);
      database.exec("INSERT INTO candidate_head(singleton, revision) VALUES (1, NULL)");
      database.exec("INSERT INTO admission_head(singleton, revision) VALUES (1, NULL)");
      database.exec("INSERT INTO coordinator_head(singleton, epoch) VALUES (1, 0)");
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
  })) corrupt("private admission database schema differs from version 7");
  if (statement<Record<string, unknown>>(database, "PRAGMA foreign_key_check").all().length !== 0) {
    corrupt("private admission database has broken foreign keys");
  }
  readCandidateHead(database, root);
  readAdmissionHead(database, root);
  readCoordinatorEpoch(database);
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

function readCoordinatorEpoch(database: SqliteDatabase): bigint {
  const query = statement<{ readonly singleton: bigint; readonly epoch: bigint }>(database,
    "SELECT singleton, epoch FROM coordinator_head",
  ).safeIntegers(true);
  let rows: readonly { readonly singleton: bigint; readonly epoch: bigint }[];
  try { rows = query.all(); }
  finally { query.finalize(); }
  if (rows.length !== 1 || rows[0]!.singleton !== 1n || rows[0]!.epoch < 0n || rows[0]!.epoch > MAX_SAFE_REVISION) {
    corrupt("coordinator head singleton is invalid");
  }
  return rows[0]!.epoch;
}

function requireCandidateRow(database: SqliteDatabase, revision: bigint): CandidateRow {
  const query = statement<CandidateRow>(database,
    "SELECT revision, candidate_digest, candidate_bytes, lock_bytes FROM candidates WHERE revision = ?1",
  );
  let rows: readonly CandidateRow[];
  try { rows = query.all(revision).map(copiedCandidateRow); }
  finally { query.finalize(); }
  if (rows.length !== 1) corrupt(`candidate revision ${revision} is missing or duplicated`);
  return rows[0]!;
}

function requirePlanRow(database: SqliteDatabase, digest: string): PlanRow {
  const query = statement<PlanRow>(database,
    "SELECT plan_digest, candidate_revision, plan_bytes FROM review_plans WHERE plan_digest = ?1",
  );
  let rows: readonly PlanRow[];
  try { rows = query.all(digest).map(copiedPlanRow); }
  finally { query.finalize(); }
  if (rows.length === 0) unavailable("ADMISSION_PLAN_MISSING", `review plan ${digest} does not exist`);
  if (rows.length !== 1) corrupt(`review plan ${digest} is duplicated`);
  return rows[0]!;
}

function requireAdmissionRow(database: SqliteDatabase, revision: bigint): AdmissionRow {
  const query = statement<AdmissionRow>(database,
    "SELECT revision, admission_digest, base_generation, plan_digest, admission_bytes FROM admissions WHERE revision = ?1",
  );
  let rows: readonly AdmissionRow[];
  try { rows = query.all(revision).map(copiedAdmissionRow); }
  finally { query.finalize(); }
  if (rows.length !== 1) corrupt(`admission revision ${revision} is missing or duplicated`);
  return rows[0]!;
}

function findAdmissionByPlan(database: SqliteDatabase, planDigest: string): AdmissionRow | null {
  const query = statement<AdmissionRow>(database,
    "SELECT revision, admission_digest, base_generation, plan_digest, admission_bytes FROM admissions WHERE plan_digest = ?1",
  );
  let rows: readonly AdmissionRow[];
  try { rows = query.all(planDigest).map(copiedAdmissionRow); }
  finally { query.finalize(); }
  if (rows.length > 1) corrupt(`plan ${planDigest} names multiple admissions`);
  return rows[0] ?? null;
}

function requireAdmissionByDigest(database: SqliteDatabase, digest: string): AdmissionRow {
  const query = statement<AdmissionRow>(database,
    "SELECT revision, admission_digest, base_generation, plan_digest, admission_bytes FROM admissions WHERE admission_digest = ?1",
  );
  let rows: readonly AdmissionRow[];
  try { rows = query.all(digest).map(copiedAdmissionRow); }
  finally { query.finalize(); }
  if (rows.length !== 1) corrupt(`base admission ${digest} is missing or duplicated`);
  return rows[0]!;
}

function copiedCandidateRow(row: CandidateRow): CandidateRow {
  return Object.freeze({
    revision: row.revision,
    candidate_digest: row.candidate_digest,
    candidate_bytes: copiedBlob(row.candidate_bytes, "stored candidate"),
    lock_bytes: copiedBlob(row.lock_bytes, "stored candidate lock"),
  });
}

function copiedPlanRow(row: PlanRow): PlanRow {
  return Object.freeze({
    plan_digest: row.plan_digest,
    candidate_revision: row.candidate_revision,
    plan_bytes: copiedBlob(row.plan_bytes, "stored review plan"),
  });
}

function copiedAdmissionRow(row: AdmissionRow): AdmissionRow {
  return Object.freeze({
    revision: row.revision,
    admission_digest: row.admission_digest,
    base_generation: row.base_generation,
    plan_digest: row.plan_digest,
    admission_bytes: copiedBlob(row.admission_bytes, "stored admission"),
  });
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
  const query = statement<PlanRow>(database,
    "SELECT plan_digest, candidate_revision, plan_bytes FROM review_plans WHERE plan_digest = ?1",
  );
  let existing: PlanRow | null;
  try {
    const selected = query.get(row.plan_digest);
    existing = selected === null ? null : copiedPlanRow(selected);
  } finally { query.finalize(); }
  if (existing !== null) {
    requireSamePlanRow(existing, row);
    loadPlanRow(existing);
    return;
  }
  runFinalized(database,
    "INSERT INTO review_plans(plan_digest, candidate_revision, plan_bytes) VALUES (?1, ?2, ?3)",
    [row.plan_digest, row.candidate_revision, row.plan_bytes],
  );
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

function requireSameAdmissionRow(left: AdmissionRow, right: AdmissionRow): void {
  if (
    left.revision !== right.revision || left.admission_digest !== right.admission_digest ||
    left.base_generation !== right.base_generation || left.plan_digest !== right.plan_digest ||
    !sameBytes(
      copiedBlob(left.admission_bytes, "activation admission"),
      copiedBlob(right.admission_bytes, "activation admission"),
    )
  ) corrupt("one admission revision changed its immutable persisted row");
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
  const inspections = new Map<string, InspectedPackage>();
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
    inspection(digest: string): InspectedPackage {
      const inspected = inspections.get(digest);
      if (inspected === undefined) corrupt(`stored package ${digest} has no verified inspection`);
      return inspected;
    },
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

function copiedOptionalBlob(value: unknown, label: string): Uint8Array | null {
  return value === null ? null : copiedBlob(value, label);
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
