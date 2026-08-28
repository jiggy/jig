import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, rename, unlink, type FileHandle } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

import { CheckError, invalid, unavailable } from "../diagnostics.js";
import { canonicalJson, decodeJson1, Json1Error, JSON_1_LIMITS, type JsonValue } from "../json.js";
import { inspectCapturedPackage, type InspectedPackage } from "../package/inspect.js";
import { SchemaDiagnostic } from "../schema/index.js";
import type { ContractIdentity, RunTargetIdentity } from "../project/package-project.js";
import { isDirectRunEligible } from "../project/flow-source.js";
import { privateActivationTargetKey } from "./activation-planning.js";
import { privateDomainDigest } from "./identity.js";
import { openPrivateProjectRoot, type PrivateProjectRoot } from "../project/root.js";
import { captureStoredPackage, normalizePackageArtifactRef } from "./package-artifact-store.js";
import {
  decodePrivateProjectLocalLock,
  encodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
  type PrivateLockPackage,
  type PrivateProjectLocalLock,
} from "./project-local-lock.js";
import {
  requirePrivateBunServiceRecipe,
  type PrivateBunServiceRecipe,
} from "./bun-service-recipe.js";
import {
  decodePrivateServiceMountAcknowledged,
  decodePrivateServiceMountAllocation,
  decodePrivateServiceMountBacking,
  decodePrivateServiceMountClosure,
  decodePrivateServiceMountFence,
  decodePrivateServiceMountGeneration,
  decodePrivateServiceMountPlan,
  decodePrivateServiceMountPrepared,
  decodePrivateServiceMountProvisional,
  decodePrivateServiceMountRelease,
  decodePrivateServiceMountSandbox,
  encodePrivateServiceMountAcknowledged,
  encodePrivateServiceMountAllocation,
  encodePrivateServiceMountBacking,
  encodePrivateServiceMountClosure,
  encodePrivateServiceMountFence,
  encodePrivateServiceMountGeneration,
  encodePrivateServiceMountPlan,
  encodePrivateServiceMountPrepared,
  encodePrivateServiceMountProvisional,
  encodePrivateServiceMountRelease,
  encodePrivateServiceMountSandbox,
  normalizePrivateServiceMountAcknowledged,
  normalizePrivateServiceMountAllocation,
  normalizePrivateServiceMountBacking,
  normalizePrivateServiceMountClosure,
  normalizePrivateServiceMountFence,
  normalizePrivateServiceMountGeneration,
  normalizePrivateServiceMountPlan,
  normalizePrivateServiceMountPrepared,
  normalizePrivateServiceMountProvisional,
  normalizePrivateServiceMountRelease,
  normalizePrivateServiceMountSandbox,
  privateServiceMountAcknowledgedDigest,
  privateServiceMountAllocationDigest,
  privateServiceMountBackingDigest,
  privateServiceMountClosureDigest,
  privateServiceMountFenceDigest,
  privateServiceMountGenerationDigest,
  privateServiceMountPlanDigest,
  privateServiceMountPreparedDigest,
  privateServiceMountProvisionalDigest,
  privateServiceMountReleaseDigest,
  privateServiceMountSandboxDigest,
  type PrivateServiceMountAcknowledged,
  type PrivateServiceMountAllocation,
  type PrivateServiceMountBacking,
  type PrivateServiceMountClosure,
  type PrivateServiceMountFence,
  type PrivateServiceMountFenceProof,
  type PrivateServiceMountGeneration,
  type PrivateServiceMountPlan,
  type PrivateServiceMountPrepared,
  type PrivateServiceMountProvisional,
  type PrivateServiceMountRelease,
  type PrivateServiceMountSandbox,
  type PrivateServiceMountClassification,
  decodePrivateServiceLeaseAllocation,
  decodePrivateServiceLeaseRelease,
  encodePrivateServiceLeaseAllocation,
  encodePrivateServiceLeaseRelease,
  normalizePrivateServiceLeaseAllocation,
  normalizePrivateServiceLeaseRelease,
  privateServiceLeaseAllocationDigest,
  privateServiceLeaseReleaseDigest,
  type PrivateServiceLeaseAllocation,
  type PrivateServiceLeaseRelease,
  decodePrivateServiceInvocationAllocation,
  encodePrivateServiceInvocationAllocation,
  normalizePrivateServiceInvocationAllocation,
  privateServiceInvocationAllocationDigest,
  privateServiceInvocationRequestDigest,
  type PrivateServiceInvocationAllocation,
  decodePrivateServiceInvocationClosure,
  decodePrivateServiceInvocationDispatch,
  decodePrivateServiceInvocationTerminal,
  encodePrivateServiceInvocationClosure,
  encodePrivateServiceInvocationDispatch,
  encodePrivateServiceInvocationTerminal,
  normalizePrivateServiceInvocationClosure,
  normalizePrivateServiceInvocationDispatch,
  normalizePrivateServiceInvocationObservation,
  normalizePrivateServiceInvocationTerminal,
  privateServiceInvocationClosureDigest,
  privateServiceInvocationDispatchDigest,
  privateServiceInvocationTerminalDigest,
  type PrivateServiceInvocationClosure,
  type PrivateServiceInvocationDispatch,
  type PrivateServiceInvocationObservation,
  type PrivateServiceInvocationTerminal,
} from "./private-service-state.js";
import {
  normalizePrivateLinuxConfirmedEnforcementReceipt,
  normalizePrivateLinuxOwnerStateAllocationIdentity,
  normalizePrivateLinuxOwnerStateCancellation,
  normalizePrivateLinuxOwnerStateReleaseReceipt,
  normalizePrivateLinuxPreparedOwnerIdentity,
  normalizePrivateLinuxSealedOwnerIdentity,
  type PrivateLinuxConfirmedEnforcementReceipt,
  type PrivateLinuxOwnerStateAllocationIdentity,
  type PrivateLinuxOwnerStateCancellation,
  type PrivateLinuxOwnerStateReleaseReceipt,
  type PrivateLinuxPreparedOwnerIdentity,
  type PrivateLinuxSealedOwnerIdentity,
} from "./linux-cgroup-backend.js";
import {
  normalizePrivatePackageMaterializationAllocationIdentity,
  normalizePrivatePackageMaterializationLeaseIdentity,
  type PrivatePackageMaterializationAllocationIdentity,
  type PrivatePackageMaterializationLeaseIdentity,
} from "./package-materialization.js";
import type { ServiceHostTerminal } from "../service/session.js";
import {
  createPrivateActivationAdmission,
  createPrivateActivationPlanV2,
  createPrivateLockRepair,
  decodePrivateActivationAdmission,
  decodePrivateActivationCandidateV5,
  decodePrivateActivationPlanV2,
  decodePrivateLockRepair,
  encodePrivateActivationAdmission,
  encodePrivateActivationCandidateV5,
  encodePrivateActivationPlanV2,
  encodePrivateLockRepair,
  findPrivateActivationCandidateTargetV5,
  privateActivationAdmissionDigest,
  privateActivationCandidateDigestV5,
  privateActivationPlanDigestV2,
  privateLockRepairDigest,
  requirePrivateCreatedActivationCandidateV5,
  type PrivateActivationAdmission,
  type PrivateActivationCandidateArtifactV5,
  type PrivateActivationPlanV2,
  type PrivateLockRepair,
} from "./activation-admission.js";
import {
  createPrivateExternalSubmissionOrigin,
  createPrivateHookDerivedOrigin,
  createPrivateRootRunRequest,
  decodePrivateRootRunOrigin,
  decodePrivateRootRunRequest,
  encodePrivateRootRunOrigin,
  failedPrivateRootTerminal,
  normalizePrivateRootSpawnIntent,
  normalizePrivateRootTerminal,
  privateRootRunIdentityDigest,
  privateRootRunOriginDigest,
  privateRootSpawnIntentDigest,
  privateRootRequestDigest,
  privateRootSubmissionDigest,
  privateRootTerminalBytes,
  type PrivateRootRunOrigin,
  type PrivateRootRunSnapshot,
  type PrivateRootRunSpawnIntent,
  type PrivateRootRunTerminal,
  type PrivateRootRunRequest,
} from "./root-run-state.js";
import {
  decodePrivateRootFlowCallAllocation,
  encodePrivateRootFlowCallAllocation,
  normalizePrivateRootFlowCallAllocation,
  normalizePrivateRootFlowCallCheckpoint,
  normalizePrivateRootFlowCallClosure,
  privateRootFlowCallAllocationDigest,
  privateRootFlowCallCheckpointDigest,
  privateRootFlowCallClosureDigest,
  requirePrivateRootFlowCallCheckpointName,
  type PrivateRootFlowCallAllocation,
  type PrivateRootFlowCallCheckpointName,
  type PrivateRootFlowCallFact,
  type PrivateRootFlowCallLifecycle,
} from "./root-flow-call-state.js";
import {
  createPrivateJournalEvent,
  decodePrivateRootJournalAppendAllocation,
  encodePrivateRootJournalAppendAllocation,
  normalizePrivateRootJournalAppendAllocation,
  normalizePrivateRootJournalAppendClosure,
  privateJournalEventDigest,
  privateRootJournalAppendAllocationDigest,
  privateRootJournalAppendClosureDigest,
  privateRootJournalEffectTerminalDigest,
  type PrivateJournalEvent,
  type PrivateRootJournalAppendAllocation,
  type PrivateRootJournalAppendReceipt,
} from "./root-journal-effect-state.js";
import type { RunHostEffectResult } from "../run/session.js";
import {
  decodePrivateHookRevision,
  decodePrivateHookAdmissionBoundary,
  decodePrivateHookSelectionSet,
  encodePrivateHookAdmissionBoundary,
  encodePrivateHookMeaning,
  encodePrivateHookRevision,
  encodePrivateHookSelectionSet,
  normalizePrivateHookMeaning,
  normalizePrivateHookAdmissionBoundary,
  normalizePrivateHookRevision,
  normalizePrivateHookSelectionSet,
  privateHookMeaningDigest,
  privateHookAdmissionBoundaryDigest,
  privateHookAdmissionBoundaryPosition,
  privateHookRevisionDigest,
  privateHookSelectionSetDigest,
  privateHookTargetDispositionDigest,
  type PrivateHookMeaning,
  type PrivateHookAdmissionBoundary,
  type PrivateHookRevision,
  type PrivateHookSelectionSet,
} from "./hook-runtime-state.js";

export type {
  PrivateRootRunSnapshot,
  PrivateRootRunSpawnIntent,
  PrivateRootRunTerminal,
} from "./root-run-state.js";

const STATE_DIRECTORY = ".jig";
const DATABASE_NAME = "private-activation-admission-v17.sqlite3";
const ADMISSION_DATABASE_FAMILY =
  /^private-activation-admission-v[0-9]+\.sqlite3(?:-journal|-wal|-shm)?$/;
const CURRENT_DATABASE_SIDECARS = new Set([
  `${DATABASE_NAME}-journal`,
  `${DATABASE_NAME}-wal`,
  `${DATABASE_NAME}-shm`,
]);
const COORDINATOR_DATABASE_NAME = "private-project-coordinator-v1.sqlite3";
const LOCK_NAME = "jig.lock";
const LOCK_STAGE_NAME = "private-activation-jig-lock-v1.stage";
const SCHEMA_VERSION = 17n;
const APPLICATION_ID = 0x4a494741n; // JIGA: schema 17
const COORDINATOR_SCHEMA_VERSION = 1n;
const COORDINATOR_APPLICATION_ID = 0x4a494743n; // JIGC
const BUSY_TIMEOUT_MS = 250;
const MAX_STORED_BYTES = 16_777_216;
const MAX_SAFE_REVISION = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_ROOT_JOURNAL_APPENDS = 65_536n;
const MAX_HOOK_DERIVATIONS_PER_EVENT = 256;
const MAX_HOOK_APPEND_REPREPARATIONS = 4;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const WIRE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

const CREATE_CANDIDATES = "CREATE TABLE candidates (revision INTEGER PRIMARY KEY CHECK (revision BETWEEN 1 AND 9007199254740991), candidate_digest TEXT NOT NULL, candidate_bytes BLOB NOT NULL CHECK (length(candidate_bytes) BETWEEN 1 AND 16777216), lock_bytes BLOB NOT NULL CHECK (length(lock_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_CANDIDATE_HEAD = "CREATE TABLE candidate_head (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER REFERENCES candidates(revision)) STRICT";
const CREATE_REVIEW_PLANS = "CREATE TABLE review_plans (plan_digest TEXT PRIMARY KEY, candidate_revision INTEGER NOT NULL REFERENCES candidates(revision), plan_bytes BLOB NOT NULL CHECK (length(plan_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_LOCK_REPAIRS = "CREATE TABLE lock_repairs (plan_digest TEXT PRIMARY KEY REFERENCES review_plans(plan_digest), repair_digest TEXT NOT NULL UNIQUE, repair_bytes BLOB NOT NULL CHECK (length(repair_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_ADMISSIONS = "CREATE TABLE admissions (revision INTEGER PRIMARY KEY CHECK (revision BETWEEN 1 AND 9007199254740991), admission_digest TEXT NOT NULL UNIQUE, base_generation TEXT UNIQUE REFERENCES admissions(admission_digest), plan_digest TEXT NOT NULL UNIQUE REFERENCES review_plans(plan_digest), admission_bytes BLOB NOT NULL CHECK (length(admission_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_ADMISSION_HEAD = "CREATE TABLE admission_head (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER REFERENCES admissions(revision)) STRICT";
const CREATE_COORDINATOR_HEAD = "CREATE TABLE coordinator_head (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), epoch INTEGER NOT NULL CHECK (epoch BETWEEN 0 AND 9007199254740991)) STRICT";
const CREATE_ROOT_RUNS = "CREATE TABLE root_runs (run_id TEXT PRIMARY KEY, origin_digest TEXT NOT NULL UNIQUE, origin_bytes BLOB NOT NULL CHECK (length(origin_bytes) BETWEEN 1 AND 16777216), admission_digest TEXT NOT NULL REFERENCES admissions(admission_digest), candidate_revision INTEGER NOT NULL REFERENCES candidates(revision), coordinator_epoch INTEGER NOT NULL CHECK (coordinator_epoch BETWEEN 1 AND 9007199254740991), request_bytes BLOB NOT NULL CHECK (length(request_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_ROOT_SPAWN_INTENTS = "CREATE TABLE root_spawn_intents (run_id TEXT PRIMARY KEY REFERENCES root_runs(run_id), intent_digest TEXT NOT NULL UNIQUE, intent_bytes BLOB NOT NULL CHECK (length(intent_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_ROOT_EXECUTION_LIFECYCLES = "CREATE TABLE root_execution_lifecycles (run_id TEXT PRIMARY KEY REFERENCES root_spawn_intents(run_id), allocation_digest TEXT NOT NULL UNIQUE, allocation_bytes BLOB NOT NULL CHECK (length(allocation_bytes) BETWEEN 1 AND 16777216), plan_digest TEXT UNIQUE, plan_bytes BLOB, backing_digest TEXT UNIQUE, backing_bytes BLOB, sandbox_digest TEXT UNIQUE, sandbox_bytes BLOB, prepared_digest TEXT UNIQUE, prepared_bytes BLOB, provisional_digest TEXT UNIQUE, provisional_bytes BLOB, fence_digest TEXT UNIQUE, fence_bytes BLOB, release_digest TEXT UNIQUE, release_bytes BLOB, admitted_digest TEXT UNIQUE, admitted_bytes BLOB, CHECK ((plan_digest IS NULL) = (plan_bytes IS NULL)), CHECK ((backing_digest IS NULL) = (backing_bytes IS NULL)), CHECK ((sandbox_digest IS NULL) = (sandbox_bytes IS NULL)), CHECK ((prepared_digest IS NULL) = (prepared_bytes IS NULL)), CHECK ((provisional_digest IS NULL) = (provisional_bytes IS NULL)), CHECK ((fence_digest IS NULL) = (fence_bytes IS NULL)), CHECK ((release_digest IS NULL) = (release_bytes IS NULL)), CHECK ((admitted_digest IS NULL) = (admitted_bytes IS NULL)), CHECK (backing_digest IS NULL OR plan_digest IS NOT NULL), CHECK (sandbox_digest IS NULL OR backing_digest IS NOT NULL), CHECK (prepared_digest IS NULL OR sandbox_digest IS NOT NULL), CHECK (fence_digest IS NULL OR sandbox_digest IS NOT NULL), CHECK (admitted_digest IS NULL OR (provisional_digest IS NOT NULL AND release_digest IS NOT NULL))) STRICT";
const CREATE_ROOT_EXECUTION_CLOSURES = "CREATE TABLE root_execution_closures (run_id TEXT PRIMARY KEY REFERENCES root_execution_lifecycles(run_id), closure_digest TEXT NOT NULL UNIQUE, closure_bytes BLOB NOT NULL CHECK (length(closure_bytes) BETWEEN 1 AND 16777216), UNIQUE (run_id, closure_digest)) STRICT";
const CREATE_ROOT_FLOW_CALLS = "CREATE TABLE root_flow_calls (parent_run_id TEXT PRIMARY KEY REFERENCES root_spawn_intents(run_id), allocation_digest TEXT NOT NULL UNIQUE, allocation_bytes BLOB NOT NULL CHECK (length(allocation_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_ROOT_FLOW_CALL_FACTS = "CREATE TABLE root_flow_call_facts (parent_run_id TEXT NOT NULL REFERENCES root_flow_calls(parent_run_id), fact_name TEXT NOT NULL CHECK (fact_name IN ('plan','backing','sandbox','prepared','provisional','fence','release','admitted')), fact_digest TEXT NOT NULL UNIQUE, fact_bytes BLOB NOT NULL CHECK (length(fact_bytes) BETWEEN 1 AND 16777216), PRIMARY KEY (parent_run_id, fact_name)) WITHOUT ROWID, STRICT";
const CREATE_ROOT_FLOW_CALL_CLOSURES = "CREATE TABLE root_flow_call_closures (parent_run_id TEXT PRIMARY KEY REFERENCES root_flow_calls(parent_run_id), closure_digest TEXT NOT NULL UNIQUE, closure_bytes BLOB NOT NULL CHECK (length(closure_bytes) BETWEEN 1 AND 16777216), UNIQUE (parent_run_id, closure_digest)) STRICT";
const CREATE_JOURNAL_HEAD = "CREATE TABLE journal_head (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 9007199254740991)) STRICT";
const CREATE_JOURNAL_EVENTS = "CREATE TABLE journal_events (position INTEGER PRIMARY KEY CHECK (position BETWEEN 1 AND 9007199254740991), event_id TEXT NOT NULL UNIQUE, event_digest TEXT NOT NULL UNIQUE, event_bytes BLOB NOT NULL CHECK (length(event_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_HOOK_ADMISSION_BOUNDARIES = "CREATE TABLE hook_admission_boundaries (admission_digest TEXT PRIMARY KEY REFERENCES admissions(admission_digest), boundary_digest TEXT NOT NULL UNIQUE, boundary_bytes BLOB NOT NULL CHECK (length(boundary_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_HOOK_REVISIONS = "CREATE TABLE hook_revisions (revision_digest TEXT PRIMARY KEY, hook_id TEXT NOT NULL, meaning_digest TEXT NOT NULL, opening_admission_digest TEXT NOT NULL REFERENCES admissions(admission_digest), opening_candidate_revision INTEGER NOT NULL REFERENCES candidates(revision), start_position INTEGER NOT NULL CHECK (start_position BETWEEN 1 AND 9007199254740991), closing_admission_digest TEXT REFERENCES admissions(admission_digest), end_position INTEGER CHECK (end_position IS NULL OR end_position BETWEEN start_position AND 9007199254740991), revision_bytes BLOB NOT NULL CHECK (length(revision_bytes) BETWEEN 1 AND 16777216), CHECK ((closing_admission_digest IS NULL) = (end_position IS NULL))) STRICT";
const CREATE_HOOK_REVISIONS_ONE_OPEN = "CREATE UNIQUE INDEX hook_revisions_one_open ON hook_revisions(hook_id) WHERE end_position IS NULL";
const CREATE_HOOK_DERIVATIONS = "CREATE TABLE hook_derivations (hook_revision_digest TEXT NOT NULL REFERENCES hook_revisions(revision_digest), event_id TEXT NOT NULL REFERENCES journal_events(event_id), run_id TEXT NOT NULL UNIQUE REFERENCES root_runs(run_id), PRIMARY KEY (hook_revision_digest, event_id)) WITHOUT ROWID, STRICT";
const CREATE_ROOT_JOURNAL_APPENDS = "CREATE TABLE root_journal_appends (parent_run_id TEXT NOT NULL REFERENCES root_spawn_intents(run_id), operation_id TEXT NOT NULL, event_position INTEGER NOT NULL UNIQUE REFERENCES journal_events(position), allocation_digest TEXT NOT NULL UNIQUE, allocation_bytes BLOB NOT NULL CHECK (length(allocation_bytes) BETWEEN 1 AND 16777216), PRIMARY KEY (parent_run_id, operation_id)) WITHOUT ROWID, STRICT";
const CREATE_ROOT_JOURNAL_TERMINALS = "CREATE TABLE root_journal_terminals (parent_run_id TEXT NOT NULL, operation_id TEXT NOT NULL, terminal_digest TEXT NOT NULL UNIQUE, terminal_bytes BLOB NOT NULL CHECK (length(terminal_bytes) BETWEEN 1 AND 16777216), PRIMARY KEY (parent_run_id, operation_id), FOREIGN KEY (parent_run_id, operation_id) REFERENCES root_journal_appends(parent_run_id, operation_id)) WITHOUT ROWID, STRICT";
const CREATE_ROOT_JOURNAL_HOOK_SELECTIONS = "CREATE TABLE root_journal_hook_selections (parent_run_id TEXT NOT NULL, operation_id TEXT NOT NULL, selection_digest TEXT NOT NULL UNIQUE, selection_bytes BLOB NOT NULL CHECK (length(selection_bytes) BETWEEN 1 AND 16777216), PRIMARY KEY (parent_run_id, operation_id), FOREIGN KEY (parent_run_id, operation_id) REFERENCES root_journal_appends(parent_run_id, operation_id)) WITHOUT ROWID, STRICT";
const CREATE_ROOT_JOURNAL_CLOSURES = "CREATE TABLE root_journal_closures (parent_run_id TEXT NOT NULL, operation_id TEXT NOT NULL, closure_digest TEXT NOT NULL UNIQUE, closure_bytes BLOB NOT NULL CHECK (length(closure_bytes) BETWEEN 1 AND 16777216), PRIMARY KEY (parent_run_id, operation_id), FOREIGN KEY (parent_run_id, operation_id) REFERENCES root_journal_appends(parent_run_id, operation_id)) WITHOUT ROWID, STRICT";
const CREATE_ROOT_TERMINALS = "CREATE TABLE root_terminals (run_id TEXT PRIMARY KEY REFERENCES root_runs(run_id), execution_closure_digest TEXT, terminal_digest TEXT NOT NULL, terminal_bytes BLOB NOT NULL CHECK (length(terminal_bytes) BETWEEN 1 AND 16777216), FOREIGN KEY (run_id, execution_closure_digest) REFERENCES root_execution_closures(run_id, closure_digest)) STRICT";
const CREATE_SERVICE_MOUNTS = "CREATE TABLE service_mounts (mount_id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, admission_digest TEXT NOT NULL REFERENCES admissions(admission_digest), coordinator_epoch INTEGER NOT NULL CHECK (coordinator_epoch BETWEEN 1 AND 9007199254740991), allocation_digest TEXT NOT NULL UNIQUE, allocation_bytes BLOB NOT NULL CHECK (length(allocation_bytes) BETWEEN 1 AND 16777216), UNIQUE (admission_digest, binding_id)) STRICT";
const CREATE_SERVICE_MOUNT_FACTS = "CREATE TABLE service_mount_facts (mount_id TEXT NOT NULL REFERENCES service_mounts(mount_id), fact_name TEXT NOT NULL CHECK (fact_name IN ('plan','backing','sandbox','prepared','generation','acknowledged','provisional','fence','release','closure')), fact_digest TEXT NOT NULL UNIQUE, fact_bytes BLOB NOT NULL CHECK (length(fact_bytes) BETWEEN 1 AND 16777216), PRIMARY KEY (mount_id, fact_name), UNIQUE (mount_id, fact_name, fact_digest)) WITHOUT ROWID, STRICT";
const CREATE_SERVICE_LEASES = "CREATE TABLE service_leases (owner_run_id TEXT NOT NULL REFERENCES root_spawn_intents(run_id), slot TEXT NOT NULL, mount_id TEXT NOT NULL REFERENCES service_mounts(mount_id), generation_fact_name TEXT NOT NULL CHECK (generation_fact_name = 'generation'), generation_digest TEXT NOT NULL, acknowledged_fact_name TEXT NOT NULL CHECK (acknowledged_fact_name = 'acknowledged'), acknowledged_digest TEXT NOT NULL, allocation_digest TEXT NOT NULL UNIQUE, allocation_bytes BLOB NOT NULL CHECK (length(allocation_bytes) BETWEEN 1 AND 16777216), release_digest TEXT UNIQUE, release_bytes BLOB, PRIMARY KEY (owner_run_id, slot), FOREIGN KEY (mount_id, generation_fact_name, generation_digest) REFERENCES service_mount_facts(mount_id, fact_name, fact_digest), FOREIGN KEY (mount_id, acknowledged_fact_name, acknowledged_digest) REFERENCES service_mount_facts(mount_id, fact_name, fact_digest), CHECK ((release_digest IS NULL) = (release_bytes IS NULL)), CHECK (release_bytes IS NULL OR length(release_bytes) BETWEEN 1 AND 16777216)) WITHOUT ROWID, STRICT";
const CREATE_SERVICE_INVOCATIONS = "CREATE TABLE service_invocations (owner_run_id TEXT NOT NULL, operation_id TEXT NOT NULL, slot TEXT NOT NULL, request_digest TEXT NOT NULL, allocation_digest TEXT NOT NULL UNIQUE, allocation_bytes BLOB NOT NULL CHECK (length(allocation_bytes) BETWEEN 1 AND 16777216), dispatch_digest TEXT UNIQUE, dispatch_bytes BLOB, terminal_digest TEXT UNIQUE, terminal_bytes BLOB, closure_digest TEXT UNIQUE, closure_bytes BLOB, PRIMARY KEY (owner_run_id, operation_id), FOREIGN KEY (owner_run_id, slot) REFERENCES service_leases(owner_run_id, slot), CHECK ((dispatch_digest IS NULL) = (dispatch_bytes IS NULL)), CHECK ((terminal_digest IS NULL) = (terminal_bytes IS NULL)), CHECK ((closure_digest IS NULL) = (closure_bytes IS NULL)), CHECK ((terminal_digest IS NULL) = (closure_digest IS NULL)), CHECK (dispatch_bytes IS NULL OR length(dispatch_bytes) BETWEEN 1 AND 16777216), CHECK (terminal_bytes IS NULL OR length(terminal_bytes) BETWEEN 1 AND 16777216), CHECK (closure_bytes IS NULL OR length(closure_bytes) BETWEEN 1 AND 16777216)) WITHOUT ROWID, STRICT";
const CREATE_COORDINATOR_LOCK = "CREATE TABLE coordinator_lock (singleton INTEGER PRIMARY KEY CHECK (singleton = 1)) STRICT";
const EXPECTED_SCHEMA = Object.freeze([
  Object.freeze({ type: "table", name: "admission_head", table: "admission_head", sql: CREATE_ADMISSION_HEAD }),
  Object.freeze({ type: "table", name: "admissions", table: "admissions", sql: CREATE_ADMISSIONS }),
  Object.freeze({ type: "table", name: "candidate_head", table: "candidate_head", sql: CREATE_CANDIDATE_HEAD }),
  Object.freeze({ type: "table", name: "candidates", table: "candidates", sql: CREATE_CANDIDATES }),
  Object.freeze({ type: "table", name: "coordinator_head", table: "coordinator_head", sql: CREATE_COORDINATOR_HEAD }),
  Object.freeze({ type: "table", name: "hook_admission_boundaries", table: "hook_admission_boundaries", sql: CREATE_HOOK_ADMISSION_BOUNDARIES }),
  Object.freeze({ type: "table", name: "hook_derivations", table: "hook_derivations", sql: CREATE_HOOK_DERIVATIONS }),
  Object.freeze({ type: "table", name: "hook_revisions", table: "hook_revisions", sql: CREATE_HOOK_REVISIONS }),
  Object.freeze({ type: "index", name: "hook_revisions_one_open", table: "hook_revisions", sql: CREATE_HOOK_REVISIONS_ONE_OPEN }),
  Object.freeze({ type: "table", name: "journal_events", table: "journal_events", sql: CREATE_JOURNAL_EVENTS }),
  Object.freeze({ type: "table", name: "journal_head", table: "journal_head", sql: CREATE_JOURNAL_HEAD }),
  Object.freeze({ type: "table", name: "lock_repairs", table: "lock_repairs", sql: CREATE_LOCK_REPAIRS }),
  Object.freeze({ type: "table", name: "review_plans", table: "review_plans", sql: CREATE_REVIEW_PLANS }),
  Object.freeze({ type: "table", name: "root_execution_closures", table: "root_execution_closures", sql: CREATE_ROOT_EXECUTION_CLOSURES }),
  Object.freeze({ type: "table", name: "root_execution_lifecycles", table: "root_execution_lifecycles", sql: CREATE_ROOT_EXECUTION_LIFECYCLES }),
  Object.freeze({ type: "table", name: "root_flow_call_closures", table: "root_flow_call_closures", sql: CREATE_ROOT_FLOW_CALL_CLOSURES }),
  Object.freeze({ type: "table", name: "root_flow_call_facts", table: "root_flow_call_facts", sql: CREATE_ROOT_FLOW_CALL_FACTS }),
  Object.freeze({ type: "table", name: "root_flow_calls", table: "root_flow_calls", sql: CREATE_ROOT_FLOW_CALLS }),
  Object.freeze({ type: "table", name: "root_journal_appends", table: "root_journal_appends", sql: CREATE_ROOT_JOURNAL_APPENDS }),
  Object.freeze({ type: "table", name: "root_journal_closures", table: "root_journal_closures", sql: CREATE_ROOT_JOURNAL_CLOSURES }),
  Object.freeze({ type: "table", name: "root_journal_hook_selections", table: "root_journal_hook_selections", sql: CREATE_ROOT_JOURNAL_HOOK_SELECTIONS }),
  Object.freeze({ type: "table", name: "root_journal_terminals", table: "root_journal_terminals", sql: CREATE_ROOT_JOURNAL_TERMINALS }),
  Object.freeze({ type: "table", name: "root_runs", table: "root_runs", sql: CREATE_ROOT_RUNS }),
  Object.freeze({ type: "table", name: "root_spawn_intents", table: "root_spawn_intents", sql: CREATE_ROOT_SPAWN_INTENTS }),
  Object.freeze({ type: "table", name: "root_terminals", table: "root_terminals", sql: CREATE_ROOT_TERMINALS }),
  Object.freeze({ type: "table", name: "service_invocations", table: "service_invocations", sql: CREATE_SERVICE_INVOCATIONS }),
  Object.freeze({ type: "table", name: "service_leases", table: "service_leases", sql: CREATE_SERVICE_LEASES }),
  Object.freeze({ type: "table", name: "service_mount_facts", table: "service_mount_facts", sql: CREATE_SERVICE_MOUNT_FACTS }),
  Object.freeze({ type: "table", name: "service_mounts", table: "service_mounts", sql: CREATE_SERVICE_MOUNTS }),
]);

const storedCandidates = new WeakSet<object>();
const authenticRootRunLaunches = new WeakSet<object>();
const claimedRootRunLaunches = new WeakSet<object>();
const authenticCreatedServiceMountAllocations = new WeakSet<object>();
const authenticCreatedServiceInvocationAllocations = new WeakSet<object>();
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

interface LockRepairRow {
  readonly plan_digest: string;
  readonly repair_digest: string;
  readonly repair_bytes: Uint8Array;
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

interface ServiceMountRow {
  readonly mount_id: string;
  readonly binding_id: string;
  readonly admission_digest: string;
  readonly coordinator_epoch: bigint;
  readonly allocation_digest: string;
  readonly allocation_bytes: Uint8Array;
}

type ServiceMountFactName =
  | "plan"
  | "backing"
  | "sandbox"
  | "prepared"
  | "generation"
  | "acknowledged"
  | "provisional"
  | "fence"
  | "release"
  | "closure";

interface ServiceMountFactRow {
  readonly mount_id: string;
  readonly fact_name: ServiceMountFactName;
  readonly fact_digest: string;
  readonly fact_bytes: Uint8Array;
}

interface ServiceLeaseRow {
  readonly owner_run_id: string;
  readonly slot: string;
  readonly mount_id: string;
  readonly generation_fact_name: string;
  readonly generation_digest: string;
  readonly acknowledged_fact_name: string;
  readonly acknowledged_digest: string;
  readonly allocation_digest: string;
  readonly allocation_bytes: Uint8Array;
  readonly release_digest: string | null;
  readonly release_bytes: Uint8Array | null;
}

interface ServiceInvocationRow {
  readonly owner_run_id: string;
  readonly operation_id: string;
  readonly slot: string;
  readonly request_digest: string;
  readonly allocation_digest: string;
  readonly allocation_bytes: Uint8Array;
  readonly dispatch_digest: string | null;
  readonly dispatch_bytes: Uint8Array | null;
  readonly terminal_digest: string | null;
  readonly terminal_bytes: Uint8Array | null;
  readonly closure_digest: string | null;
  readonly closure_bytes: Uint8Array | null;
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
  readonly origin_digest: string;
  readonly origin_bytes: Uint8Array;
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

interface RootFlowCallRow {
  readonly parent_run_id: string;
  readonly allocation_digest: string;
  readonly allocation_bytes: Uint8Array;
}

interface RootFlowCallFactRow {
  readonly parent_run_id: string;
  readonly fact_name: string;
  readonly fact_digest: string;
  readonly fact_bytes: Uint8Array;
}

interface RootFlowCallClosureRow {
  readonly parent_run_id: string;
  readonly closure_digest: string;
  readonly closure_bytes: Uint8Array;
}

interface JournalHeadRow {
  readonly singleton: bigint;
  readonly position: bigint;
}

interface RootJournalAppendRow {
  readonly parent_run_id: string;
  readonly operation_id: string;
  readonly event_position: bigint;
  readonly allocation_digest: string;
  readonly allocation_bytes: Uint8Array;
}

interface JournalEventRow {
  readonly position: bigint;
  readonly event_id: string;
  readonly event_digest: string;
  readonly event_bytes: Uint8Array;
}

interface HookRevisionRow {
  readonly revision_digest: string;
  readonly hook_id: string;
  readonly meaning_digest: string;
  readonly opening_admission_digest: string;
  readonly opening_candidate_revision: bigint;
  readonly start_position: bigint;
  readonly closing_admission_digest: string | null;
  readonly end_position: bigint | null;
  readonly revision_bytes: Uint8Array;
}

interface HookAdmissionBoundaryRow {
  readonly admission_digest: string;
  readonly boundary_digest: string;
  readonly boundary_bytes: Uint8Array;
}

interface HookDerivationRow {
  readonly hook_revision_digest: string;
  readonly event_id: string;
  readonly run_id: string;
}

interface PreparedHookAdmissionTransition {
  readonly boundary: PrivateHookAdmissionBoundary;
  readonly boundaryDigest: string;
  readonly boundaryBytes: Uint8Array;
  readonly closes: readonly LoadedHookRevision[];
  readonly opens: ReadonlyMap<string, PrivateHookMeaning>;
}

interface PreparedHookDerivedRun {
  readonly hookId: string;
  readonly hookRevision: LoadedHookRevision;
  readonly admissionRow: AdmissionRow;
  readonly candidateRow: CandidateRow;
  readonly origin: ReturnType<typeof createPrivateHookDerivedOrigin>;
  readonly originDigest: string;
  readonly originBytes: Uint8Array;
  readonly request: PrivateRootRunRequest;
  readonly requestBytes: Uint8Array;
  readonly runId: string;
  readonly coordinatorEpoch: number;
  readonly terminal: PrivateRootRunTerminal | undefined;
  readonly spawnIntent: PrivateRootRunSpawnIntent | undefined;
  readonly spawnIntentDigest: string | undefined;
  readonly spawnIntentBytes: Uint8Array | undefined;
  readonly lifecycleAllocation: ReturnType<typeof normalizeRootExecutionAllocation> | undefined;
  readonly lifecycleAllocationBytes: Uint8Array | undefined;
}

interface PreparedHookDerivations {
  readonly admissionHeadRevision: bigint | null;
  readonly revisions: readonly LoadedHookRevision[];
  readonly runs: readonly PreparedHookDerivedRun[];
  readonly selection: PrivateHookSelectionSet;
  readonly selectionDigest: string;
  readonly selectionBytes: Uint8Array;
}

interface LoadedHookRevision {
  readonly revisionDigest: string;
  readonly revision: PrivateHookRevision;
  readonly endPosition: number | null;
  readonly openingAdmissionRevision: number;
  readonly closingAdmissionRevision: number | null;
}

interface RootJournalTerminalRow {
  readonly parent_run_id: string;
  readonly operation_id: string;
  readonly terminal_digest: string;
  readonly terminal_bytes: Uint8Array;
}

interface RootJournalHookSelectionRow {
  readonly parent_run_id: string;
  readonly operation_id: string;
  readonly selection_digest: string;
  readonly selection_bytes: Uint8Array;
}

interface RootJournalClosureRow {
  readonly parent_run_id: string;
  readonly operation_id: string;
  readonly closure_digest: string;
  readonly closure_bytes: Uint8Array;
}

export interface PrivateActivationCandidateHead {
  readonly candidateRevision: number;
  readonly candidateDigest: string;
}

export interface PrivateActivationReviewPlan {
  readonly plan: PrivateActivationPlanV2;
  readonly planBytes: Uint8Array;
  readonly planDigest: string;
  readonly candidate: PrivateActivationCandidateArtifactV5;
}

export type PrivateActivationPlanResult =
  | { readonly state: "unchanged" }
  | ({ readonly state: "applicable" } & PrivateActivationReviewPlan);

export interface PrivateActivationAdmissionReceipt {
  readonly admission: PrivateActivationAdmission;
  readonly admissionBytes: Uint8Array;
  readonly admissionDigest: string;
}

export interface PrivateLockRepairReceipt {
  readonly repair: PrivateLockRepair;
  readonly repairBytes: Uint8Array;
  readonly repairDigest: string;
}

export type PrivateActivationApplyReceipt =
  | PrivateActivationAdmissionReceipt
  | PrivateLockRepairReceipt;

export interface PrivateActiveActivation {
  readonly admission: PrivateActivationAdmissionReceipt;
  readonly candidate: PrivateActivationCandidateArtifactV5;
}

export interface PrivateServiceMountFact<Value> {
  readonly digest: string;
  readonly value: Value;
}

/** Exact immutable Mount lifecycle, classified against the owning coordinator. */
export interface PrivateServiceMountSnapshot {
  readonly allocation: PrivateServiceMountAllocation;
  readonly allocationDigest: string;
  readonly coordinator: "current" | "older";
  readonly plan?: PrivateServiceMountFact<PrivateServiceMountPlan>;
  readonly backing?: PrivateServiceMountFact<PrivateServiceMountBacking>;
  readonly sandbox?: PrivateServiceMountFact<PrivateServiceMountSandbox>;
  readonly prepared?: PrivateServiceMountFact<PrivateServiceMountPrepared>;
  readonly generation?: PrivateServiceMountFact<PrivateServiceMountGeneration>;
  readonly acknowledged?: PrivateServiceMountFact<PrivateServiceMountAcknowledged>;
  readonly provisional?: PrivateServiceMountFact<PrivateServiceMountProvisional>;
  readonly fence?: PrivateServiceMountFact<PrivateServiceMountFence>;
  readonly release?: PrivateServiceMountFact<PrivateServiceMountRelease>;
  readonly closure?: PrivateServiceMountFact<PrivateServiceMountClosure>;
}

/** The only capability which may advance a newly allocated Mount startup. */
export interface PrivateServiceMountAllocationResult {
  readonly snapshot: PrivateServiceMountSnapshot;
  readonly created: boolean;
}

/** One immutable owner-slot lease pinned to an acknowledged Service generation. */
export interface PrivateServiceLeaseSnapshot {
  readonly allocation: PrivateServiceLeaseAllocation;
  readonly allocationDigest: string;
  readonly coordinator: "current" | "older";
  readonly release?: PrivateServiceMountFact<PrivateServiceLeaseRelease>;
}

/** One immutable Service operation allocation, before dispatch ownership exists. */
export interface PrivateServiceInvocationSnapshot {
  readonly allocation: PrivateServiceInvocationAllocation;
  readonly allocationDigest: string;
  readonly coordinator: "current" | "older";
  readonly dispatch?: PrivateServiceMountFact<PrivateServiceInvocationDispatch>;
  readonly terminal?: PrivateServiceMountFact<PrivateServiceInvocationTerminal>;
  readonly closure?: PrivateServiceMountFact<PrivateServiceInvocationClosure>;
}

export interface PrivateServiceInvocationAllocationResult {
  readonly snapshot: PrivateServiceInvocationSnapshot;
  readonly created: boolean;
}

export interface PrivateServiceInvocationDispatchResult {
  readonly snapshot: PrivateServiceInvocationSnapshot;
  readonly created: boolean;
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
  readonly candidate: PrivateActivationCandidateArtifactV5;
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
  readonly candidate: PrivateActivationCandidateArtifactV5;
}

/** Persist a factory-produced proposal as the monotonic activation head. */
export async function publishPrivateActivationCandidate(input: {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly candidate: PrivateActivationCandidateArtifactV5;
}): Promise<PrivateActivationCandidateHead> {
  const created = requirePrivateCreatedActivationCandidateV5(input.candidate);
  const encoded = encodePrivateActivationCandidateV5(created);
  requireStoredSize(encoded.candidate, "candidate");
  requireStoredSize(encoded.lock, "candidate lock");
  const candidateDigest = privateActivationCandidateDigestV5(created);
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
          const prior = encodePrivateActivationCandidateV5(latest);
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
  /** Optional private CAS used by the foreground proof after candidate publication. */
  readonly expectedCandidate?: PrivateActivationCandidateHead;
}): Promise<PrivateActivationPlanResult> {
  requireLockMode(input.lockMode);
  if (input.expectedCandidate !== undefined) {
    safeRevision(input.expectedCandidate.candidateRevision);
    requireDigest(input.expectedCandidate.candidateDigest, "expected candidate");
  }
  const owner = await openStateOwner(input.projectRoot, false);
  let artifacts: ReacquiredArtifacts | undefined;
  let failure: unknown;
  try {
    const initialHeads = await immediate(owner, () => Object.freeze({
      candidate: readCandidateHead(owner.database, owner.root),
      admission: readAdmissionHead(owner.database, owner.root),
    }));
    if (initialHeads.candidate.revision === null) {
      unavailable("ADMISSION_CANDIDATE_MISSING", "no activation candidate has been published");
    }
    if (input.expectedCandidate !== undefined && (
      initialHeads.candidate.revision !== BigInt(input.expectedCandidate.candidateRevision) ||
      requireCandidateRow(owner.database, initialHeads.candidate.revision).candidate_digest !==
        input.expectedCandidate.candidateDigest
    )) projectBusy("published activation candidate is no longer the candidate head");
    const initialRow = requireCandidateRow(owner.database, initialHeads.candidate.revision);
    const candidate = loadCandidateRow(initialRow);
    requireCandidateRoot(candidate, owner.root);
    artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot, candidate);
    const persisted = await immediate(owner, async () => {
      const currentHead = readCandidateHead(owner.database, owner.root);
      const admissionHead = readAdmissionHead(owner.database, owner.root);
      if (
        currentHead.revision !== initialHeads.candidate.revision ||
        admissionHead.revision !== initialHeads.admission.revision
      ) projectBusy("activation heads changed while the review plan was prepared");
      const currentRow = requireCandidateRow(owner.database, initialRow.revision);
      requireSameCandidateRow(initialRow, currentRow);
      const observed = await observeVisibleLockForPlanning(owner.root);
      const proposed = encodePrivateProjectLocalLock(candidate.lock);
      const visibleExact = observed.state === "present" && sameBytes(observed.bytes, proposed);
      if (input.lockMode === "locked" && !visibleExact) {
        invalid("LOCK_MISMATCH", "locked planning requires the exact proposed jig.lock bytes");
      }

      let baseGeneration: string | null = null;
      let operation: "admission" | "lock-repair" | "unchanged" = "admission";
      if (admissionHead.revision !== null) {
        const activeRow = requireAdmissionRow(owner.database, admissionHead.revision);
        const active = loadAndCrossCheckAdmission(owner.database, activeRow, owner.root);
        baseGeneration = active.admissionDigest;
        const activeCandidateRow = requireCandidateRow(
          owner.database,
          BigInt(active.admission.candidateRevision),
        );
        const activeCandidate = loadCandidateRow(activeCandidateRow);
        requireCandidateRoot(activeCandidate, owner.root);
        const sameMeaning = activeCandidate.candidate.activationMeaningDigest ===
          candidate.candidate.activationMeaningDigest;
        const sameLock = activeCandidate.candidate.lockDigest === candidate.candidate.lockDigest &&
          sameBytes(
            encodePrivateProjectLocalLock(activeCandidate.lock),
            encodePrivateProjectLocalLock(candidate.lock),
          );
        if (sameMeaning && sameLock) {
          operation = visibleExact ? "unchanged" : "lock-repair";
        }
      }

      if (operation === "unchanged") {
        return Object.freeze({ state: "unchanged" as const });
      }
      const plan = createPrivateActivationPlanV2({
        candidate,
        candidateRevision: safeRevision(currentRow.revision),
        baseGeneration,
        lockMode: input.lockMode,
        observedLock: observed.state === "absent"
          ? { state: "absent" }
          : { state: "present", lock: observed.lock },
        operation,
      });
      const planBytes = encodePrivateActivationPlanV2(plan);
      requireStoredSize(planBytes, "review plan");
      const planDigest = privateActivationPlanDigestV2(plan);
      persistReviewPlan(owner.database, {
        plan_digest: planDigest,
        candidate_revision: currentRow.revision,
        plan_bytes: planBytes,
      });
      return Object.freeze({ state: "applicable" as const, plan, planBytes, planDigest, candidate });
    });
    await owner.finish();
    if (persisted.state === "unchanged") return persisted;
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
    crossCheckPlanCandidate(plan, initialPlanRow, initialCandidateRow, candidate);
    requireCandidateRoot(candidate, owner.root);
    requireDerivedPlanOperation(owner.database, plan, candidate, owner.root);
    artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot, candidate);
    await immediate(owner, () => {
      readCandidateHead(owner.database, owner.root);
      readAdmissionHead(owner.database, owner.root);
      const currentPlanRow = requirePlanRow(owner.database, input.planDigest);
      const currentCandidateRow = requireCandidateRow(owner.database, initialPlanRow.candidate_revision);
      requireSamePlanRow(initialPlanRow, currentPlanRow);
      requireSameCandidateRow(initialCandidateRow, currentCandidateRow);
      crossCheckPlanCandidate(plan, currentPlanRow, currentCandidateRow, candidate);
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
 * Allocate the one exact Mount attempt for the active admission's supported
 * Service Binding. This records no readiness or launch authority.
 */
export async function allocatePrivateServiceMount(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly recipe: PrivateBunServiceRecipe;
  readonly effectiveDeadlineUnixMs: number;
}): Promise<PrivateServiceMountAllocationResult> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  const recipe = requirePrivateBunServiceRecipe(input.recipe);
  await coordinator.verify();
  if (!Number.isSafeInteger(input.effectiveDeadlineUnixMs) || input.effectiveDeadlineUnixMs < 0 ||
      input.effectiveDeadlineUnixMs > Date.now() + recipe.mountLifetimeCeilingMs) {
    throw new TypeError("Service Mount deadline exceeds the admitted lifetime ceiling");
  }
  const owner = await openStateOwner(input.projectRoot, false);
  let artifacts: ReacquiredArtifacts | undefined;
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const head = readAdmissionHead(owner.database, owner.root);
    if (head.revision === null) unavailable("ADMISSION_MISSING", "no activation generation is active");
    const admissionRow = requireAdmissionRow(owner.database, head.revision);
    const admission = loadAndCrossCheckAdmission(owner.database, admissionRow, owner.root);
    const candidateRow = requireCandidateRow(
      owner.database,
      BigInt(admission.admission.candidateRevision),
    );
    const candidate = loadCandidateRow(candidateRow);
    requireCandidateRoot(candidate, owner.root);
    artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot, candidate);
    requireCurrentServiceRecipe(candidate, recipe, artifacts);

    const bindingId = serviceRecipeBindingId(recipe);
    const mountId = privateServiceMountId(admission.admissionDigest, bindingId);
    const allocation = normalizePrivateServiceMountAllocation({
      kind: "private-service-mount-allocation/1",
      mountId,
      coordinatorEpoch: coordinator.epoch,
      admissionDigest: admission.admissionDigest,
      candidateRevision: admission.admission.candidateRevision,
      bindingId,
      requestDigest: recipe.request.digest,
      recipeDigest: recipe.digest,
      observationDigest: recipe.observation.digest,
      expectedExports: recipe.expectedExports,
      effectiveDeadlineUnixMs: input.effectiveDeadlineUnixMs,
    });
    const allocationBytes = encodePrivateServiceMountAllocation(allocation);
    const allocationDigest = privateServiceMountAllocationDigest(allocation);
    requireStoredSize(allocationBytes, "Service Mount allocation");

    const result = await immediate(owner, async () => {
      await coordinator.verify();
      const currentHead = readAdmissionHead(owner.database, owner.root);
      if (currentHead.revision !== head.revision) {
        stale("active generation changed before Service Mount allocation");
      }
      const currentAdmission = requireAdmissionRow(owner.database, head.revision!);
      const currentCandidate = requireCandidateRow(owner.database, candidateRow.revision);
      requireSameAdmissionRow(admissionRow, currentAdmission);
      requireSameCandidateRow(candidateRow, currentCandidate);
      loadAndCrossCheckAdmission(owner.database, currentAdmission, owner.root);

      const prior = findServiceMountByAdmissionBinding(
        owner.database,
        admission.admissionDigest,
        bindingId,
      );
      if (prior !== null) {
        const replay = loadServiceMountSnapshot(
          owner.database,
          prior,
          owner.root,
          coordinator,
          candidate,
          artifacts!,
          recipe,
        );
        if (replay.coordinator !== "current" || serviceMountHasRelease(owner.database, mountId)) {
          invalid(
            "SERVICE_MOUNT_ALREADY_ATTEMPTED",
            "this admission and Service Binding already consumed its Mount attempt",
          );
        }
        if (replay.allocationDigest !== allocationDigest ||
            !sameBytes(prior.allocation_bytes, allocationBytes)) {
          invalid(
            "SERVICE_MOUNT_CONFLICT",
            "Service Mount allocation was replayed with different parameters",
          );
        }
        return Object.freeze({ snapshot: replay, created: false });
      }

      runFinalized(owner.database,
        "INSERT INTO service_mounts(mount_id, binding_id, admission_digest, coordinator_epoch, allocation_digest, allocation_bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        [mountId, bindingId, admission.admissionDigest, coordinator.epoch, allocationDigest, allocationBytes],
      );
      return Object.freeze({
        snapshot: loadServiceMountSnapshot(
          owner.database,
          requireServiceMountRow(owner.database, mountId),
          owner.root,
          coordinator,
          candidate,
          artifacts!,
          recipe,
        ),
        created: true,
      });
    });
    await owner.finish();
    if (result.created) authenticCreatedServiceMountAllocations.add(result);
    return result;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, artifacts, failure);
  }
}

/** Reopen one immutable Mount allocation and authenticate its full pinned closure. */
export async function loadPrivateServiceMount(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly mountId: string;
  readonly recipe?: PrivateBunServiceRecipe;
}): Promise<PrivateServiceMountSnapshot> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  const recipe = input.recipe === undefined
    ? undefined
    : requirePrivateBunServiceRecipe(input.recipe);
  await coordinator.verify();
  requireDigest(input.mountId, "Service Mount");
  const owner = await openStateOwner(input.projectRoot, false);
  let artifacts: ReacquiredArtifacts | undefined;
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const initialRow = requireServiceMountRow(owner.database, input.mountId);
    const admissionRow = requireAdmissionByDigest(owner.database, initialRow.admission_digest);
    const admission = loadAndCrossCheckAdmission(owner.database, admissionRow, owner.root);
    const candidateRow = requireCandidateRow(
      owner.database,
      BigInt(admission.admission.candidateRevision),
    );
    const candidate = loadCandidateRow(candidateRow);
    requireCandidateRoot(candidate, owner.root);
    artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot, candidate);

    const snapshot = await immediate(owner, async () => {
      await coordinator.verify();
      const currentRow = requireServiceMountRow(owner.database, input.mountId);
      const currentAdmission = requireAdmissionByDigest(owner.database, initialRow.admission_digest);
      const currentCandidate = requireCandidateRow(owner.database, candidateRow.revision);
      requireSameServiceMountRow(initialRow, currentRow);
      requireSameAdmissionRow(admissionRow, currentAdmission);
      requireSameCandidateRow(candidateRow, currentCandidate);
      loadAndCrossCheckAdmission(owner.database, currentAdmission, owner.root);
      return loadServiceMountSnapshot(
        owner.database,
        currentRow,
        owner.root,
        coordinator,
        candidate,
        artifacts!,
        recipe,
      );
    });
    await owner.finish();
    return snapshot;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, artifacts, failure);
  }
}

/** Reproduce and authenticate the exact recipe-specific Mount lifecycle. */
export async function reacquirePrivateServiceMount(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly mountId: string;
  readonly recipe: PrivateBunServiceRecipe;
}): Promise<PrivateServiceMountSnapshot> {
  return await loadPrivateServiceMount(input);
}

/** List authenticated Mount allocations from this or an older coordinator epoch. */
export async function listPrivateServiceMounts(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly epoch: "current" | "older";
}): Promise<readonly PrivateServiceMountSnapshot[]> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  if (input.epoch !== "current" && input.epoch !== "older") {
    throw new TypeError("Service Mount epoch must be current or older");
  }
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  let mountIds: readonly string[] = [];
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    mountIds = await immediate(owner, async () => {
      await coordinator.verify();
      const future = statement<{ readonly count: bigint }>(owner.database,
        "SELECT count(*) AS count FROM service_mounts WHERE coordinator_epoch > ?1",
      ).safeIntegers(true);
      try {
        const aggregate = future.get(BigInt(coordinator.epoch));
        if (aggregate === null || aggregate.count !== 0n) {
          corrupt("Service Mount belongs to a future coordinator epoch");
        }
      } finally { future.finalize(); }
      const comparison = input.epoch === "current" ? "=" : "<";
      const query = statement<{ readonly mount_id: string }>(owner.database, [
        "SELECT mount_id FROM service_mounts",
        `WHERE coordinator_epoch ${comparison} ?1 ORDER BY mount_id`,
      ].join(" ")).safeIntegers(true);
      try { return Object.freeze(query.all(BigInt(coordinator.epoch)).map((row) => row.mount_id)); }
      finally { query.finalize(); }
    });
    await owner.finish();
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
  const snapshots: PrivateServiceMountSnapshot[] = [];
  for (const mountId of mountIds) {
    snapshots.push(await loadPrivateServiceMount({
      coordinator,
      projectRoot: input.projectRoot,
      packageStoreRoot: input.packageStoreRoot,
      mountId,
    }));
  }
  return Object.freeze(snapshots);
}

/** Pin one owner capability slot to the active acknowledged Service generation. */
export async function allocatePrivateServiceLease(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly ownerRunId: string;
  readonly slot: string;
}): Promise<PrivateServiceLeaseSnapshot> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.ownerRunId, "Service lease owner Run");
  const slot = requireServiceLeaseSlot(input.slot);
  const owner = await openStateOwner(input.projectRoot, false);
  let artifacts: ReacquiredArtifacts | undefined;
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const initialRun = requireRootRunRow(owner.database, input.ownerRunId);
    const candidateRow = requireCandidateRow(owner.database, initialRun.candidate_revision);
    const candidate = loadCandidateRow(candidateRow);
    requireCandidateRoot(candidate, owner.root);

    const replay = findServiceLease(owner.database, input.ownerRunId, slot);
    if (replay !== null) {
      const snapshot = await immediate(owner, async () => {
        await coordinator.verify();
        const currentRun = requireRootRunRow(owner.database, input.ownerRunId);
        const currentCandidate = requireCandidateRow(owner.database, candidateRow.revision);
        requireSameRootRunRow(initialRun, currentRun);
        requireSameCandidateRow(candidateRow, currentCandidate);
        return loadServiceLeaseSnapshot(
          owner.database,
          requireServiceLease(owner.database, input.ownerRunId, slot),
          owner.root,
          coordinator,
          candidate,
        );
      });
      await owner.finish();
      return snapshot;
    }

    artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot, candidate);
    const snapshot = await immediate(owner, async () => {
      await coordinator.verify();
      const currentRun = requireRootRunRow(owner.database, input.ownerRunId);
      const currentCandidate = requireCandidateRow(owner.database, candidateRow.revision);
      requireSameRootRunRow(initialRun, currentRun);
      requireSameCandidateRow(candidateRow, currentCandidate);

      const raced = findServiceLease(owner.database, input.ownerRunId, slot);
      if (raced !== null) {
        return loadServiceLeaseSnapshot(
          owner.database,
          raced,
          owner.root,
          coordinator,
          candidate,
        );
      }

      const context = requireNewServiceLeaseContext(
        owner.database,
        currentRun,
        owner.root,
        coordinator,
        candidate,
        artifacts!,
        slot,
      );
      const allocation = normalizePrivateServiceLeaseAllocation({
        kind: "private-service-lease-allocation/1",
        ownerRunId: input.ownerRunId,
        coordinatorEpoch: coordinator.epoch,
        slot,
        mountId: context.mount.allocation.mountId,
        mountAllocationDigest: context.mount.allocationDigest,
        generationId: context.generation.value.generationId,
        generationDigest: context.generation.digest,
        acknowledgedDigest: context.acknowledged.digest,
        providerBinding: context.providerBinding,
        providerExport: context.providerExport,
        contract: context.contract,
      });
      const bytes = encodePrivateServiceLeaseAllocation(allocation);
      const digest = privateServiceLeaseAllocationDigest(allocation);
      requireStoredSize(bytes, "Service lease allocation");
      runFinalized(owner.database, [
        "INSERT INTO service_leases(",
        "owner_run_id, slot, mount_id, generation_fact_name, generation_digest,",
        "acknowledged_fact_name, acknowledged_digest, allocation_digest, allocation_bytes,",
        "release_digest, release_bytes",
        ") VALUES (?1, ?2, ?3, 'generation', ?4, 'acknowledged', ?5, ?6, ?7, NULL, NULL)",
      ].join(" "), [
        input.ownerRunId,
        slot,
        allocation.mountId,
        allocation.generationDigest,
        allocation.acknowledgedDigest,
        digest,
        bytes,
      ]);
      return loadServiceLeaseSnapshot(
        owner.database,
        requireServiceLease(owner.database, input.ownerRunId, slot),
        owner.root,
        coordinator,
        candidate,
      );
    });
    await owner.finish();
    return snapshot;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, artifacts, failure);
  }
}

/** Reopen one immutable owner-slot Service lease from protected state. */
export async function loadPrivateServiceLease(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly ownerRunId: string;
  readonly slot: string;
}): Promise<PrivateServiceLeaseSnapshot> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.ownerRunId, "Service lease owner Run");
  const slot = requireServiceLeaseSlot(input.slot);
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const snapshot = await immediate(owner, async () => {
      await coordinator.verify();
      const run = requireRootRunRow(owner.database, input.ownerRunId);
      const candidate = loadCandidateRow(requireCandidateRow(owner.database, run.candidate_revision));
      requireCandidateRoot(candidate, owner.root);
      return loadServiceLeaseSnapshot(
        owner.database,
        requireServiceLease(owner.database, input.ownerRunId, slot),
        owner.root,
        coordinator,
        candidate,
      );
    });
    await owner.finish();
    return snapshot;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/** List one owner's authenticated leases in stable slot order. */
export async function listPrivateServiceLeases(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly ownerRunId: string;
}): Promise<readonly PrivateServiceLeaseSnapshot[]> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.ownerRunId, "Service lease owner Run");
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const snapshots = await immediate(owner, async () => {
      await coordinator.verify();
      const run = requireRootRunRow(owner.database, input.ownerRunId);
      const candidate = loadCandidateRow(requireCandidateRow(owner.database, run.candidate_revision));
      requireCandidateRoot(candidate, owner.root);
      return Object.freeze(listServiceLeaseRows(owner.database, input.ownerRunId).map((row) =>
        loadServiceLeaseSnapshot(owner.database, row, owner.root, coordinator, candidate)
      ));
    });
    await owner.finish();
    return snapshots;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/**
 * Close one exact owner-slot lease after every operation using it has a
 * durable closure. This records no Provider action: Mount-driven reasons are
 * admissible only after the exact Mount fence is already durable.
 */
export async function recordPrivateServiceLeaseRelease(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly ownerRunId: string;
  readonly slot: string;
  readonly reason: PrivateServiceLeaseRelease["reason"];
  readonly mountFenceDigest?: string;
}): Promise<PrivateServiceLeaseSnapshot> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.ownerRunId, "Service lease release owner Run");
  const slot = requireServiceLeaseSlot(input.slot);
  if (input.reason === "owner-closed" && input.mountFenceDigest !== undefined) {
    throw new TypeError("owner-closed Service lease release cannot name a Mount fence");
  }
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const snapshot = await immediate(owner, async () => {
      await coordinator.verify();
      const ownerRow = requireRootRunRow(owner.database, input.ownerRunId);
      const candidate = loadCandidateRow(requireCandidateRow(owner.database, ownerRow.candidate_revision));
      requireCandidateRoot(candidate, owner.root);
      const row = requireServiceLease(owner.database, input.ownerRunId, slot);
      const before = loadServiceLeaseSnapshot(owner.database, row, owner.root, coordinator, candidate);
      const mount = loadServiceMountSnapshot(
        owner.database,
        requireServiceMountRow(owner.database, before.allocation.mountId),
        owner.root,
        coordinator,
        candidate,
      );
      const value = normalizePrivateServiceLeaseRelease({
        kind: "private-service-lease-release/1",
        ownerRunId: before.allocation.ownerRunId,
        slot: before.allocation.slot,
        allocationDigest: before.allocationDigest,
        reason: input.reason,
        mountFenceDigest: input.reason === "owner-closed" ? null : input.mountFenceDigest ?? null,
        invocations: serviceInvocationClosureReferences(
          owner.database,
          before.allocation,
          before.allocationDigest,
          mount,
          owner.root,
          coordinator,
          candidate,
        ),
      });
      const bytes = encodePrivateServiceLeaseRelease(value);
      const digest = privateServiceLeaseReleaseDigest(value);
      requireStoredSize(bytes, "Service lease release");
      if (before.release !== undefined) {
        if (before.release.digest !== digest || !sameCanonical(before.release.value, value)) {
          invalid("OPERATION_CONFLICT", "Service lease already has a different release");
        }
        return before;
      }
      if (input.reason === "owner-closed") {
        if (before.coordinator !== "current") {
          invalid("SERVICE_LEASE_OWNER_INACTIVE", "owner-closed release requires a current owner Run");
        }
        if (mount.provisional !== undefined || mount.fence !== undefined) {
          invalid("SERVICE_PROVIDER_UNAVAILABLE", "owner-closed release requires its Provider to remain active");
        }
      } else {
        const fence = requireServiceMountFact(mount.fence, "fence");
        if (input.mountFenceDigest !== fence.digest) {
          invalid("SERVICE_LEASE_FENCE_MISMATCH", "Service lease release names a different Mount fence");
        }
        if (!serviceLeaseMountReasonMatches(input.reason, mount)) {
          invalid("SERVICE_LEASE_REASON_MISMATCH", "Service lease release reason differs from its Mount terminal");
        }
      }
      const changed = runFinalized(owner.database, [
        "UPDATE service_leases SET release_digest = ?1, release_bytes = ?2",
        "WHERE owner_run_id = ?3 AND slot = ?4 AND release_digest IS NULL AND release_bytes IS NULL",
      ].join(" "), [digest, bytes, value.ownerRunId, value.slot]).changes;
      if (changed !== 1) corrupt("Service lease release compare-and-set failed");
      return loadServiceLeaseSnapshot(
        owner.database,
        requireServiceLease(owner.database, value.ownerRunId, value.slot),
        owner.root,
        coordinator,
        candidate,
      );
    });
    await owner.finish();
    return snapshot;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/** Allocate one immutable Service operation without granting dispatch authority. */
export async function allocatePrivateServiceInvocation(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly ownerRunId: string;
  readonly operationId: string;
  readonly slot: string;
  readonly method: string;
  readonly input: JsonValue;
}): Promise<PrivateServiceInvocationAllocationResult> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.ownerRunId, "Service invocation owner Run");
  requireWireId(input.operationId, "Service invocation operation ID");
  const requestDigest = privateServiceInvocationRequestDigest({
    slot: input.slot,
    method: input.method,
    input: input.input,
  });
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const result = await immediate(owner, async () => {
      await coordinator.verify();
      const prior = findServiceInvocation(owner.database, input.ownerRunId, input.operationId);
      if (prior !== null) {
        const snapshot = loadServiceInvocationSnapshot(
          owner.database,
          prior,
          owner.root,
          coordinator,
        );
        if (snapshot.allocation.requestDigest !== requestDigest) {
          invalid("OPERATION_CONFLICT", "Service operation ID already names a different request");
        }
        return Object.freeze({ snapshot, created: false });
      }

      const context = requireNewServiceInvocationContext(
        owner.database,
        owner.root,
        coordinator,
        input.ownerRunId,
        input.slot,
      );
      const allocation = normalizePrivateServiceInvocationAllocation({
        kind: "private-service-invocation-allocation/1",
        ownerRunId: input.ownerRunId,
        coordinatorEpoch: coordinator.epoch,
        call: {
          operationId: input.operationId,
          slot: input.slot,
          method: input.method,
          input: input.input,
        },
        requestDigest,
        leaseDigest: context.lease.allocationDigest,
        mountId: context.lease.allocation.mountId,
        generationId: context.lease.allocation.generationId,
        exportName: context.lease.allocation.providerExport,
        deadlineUnixMs: Math.min(
          context.owner.deadlineUnixMs,
          context.mount.allocation.effectiveDeadlineUnixMs,
        ),
      });
      const bytes = encodePrivateServiceInvocationAllocation(allocation);
      const digest = privateServiceInvocationAllocationDigest(allocation);
      requireStoredSize(bytes, "Service invocation allocation");
      runFinalized(owner.database, [
        "INSERT INTO service_invocations(",
        "owner_run_id, operation_id, slot, request_digest, allocation_digest, allocation_bytes,",
        "dispatch_digest, dispatch_bytes, terminal_digest, terminal_bytes, closure_digest, closure_bytes",
        ") VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, NULL, NULL, NULL, NULL)",
      ].join(" "), [
        input.ownerRunId,
        input.operationId,
        allocation.call.slot,
        requestDigest,
        digest,
        bytes,
      ]);
      const snapshot = loadServiceInvocationSnapshot(
        owner.database,
        requireServiceInvocation(owner.database, input.ownerRunId, input.operationId),
        owner.root,
        coordinator,
      );
      return Object.freeze({ snapshot, created: true });
    });
    await owner.finish();
    if (result.created) authenticCreatedServiceInvocationAllocations.add(result);
    return result;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/** Reopen one immutable Service operation allocation. */
export async function loadPrivateServiceInvocation(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly ownerRunId: string;
  readonly operationId: string;
}): Promise<PrivateServiceInvocationSnapshot> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.ownerRunId, "Service invocation owner Run");
  requireWireId(input.operationId, "Service invocation operation ID");
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const snapshot = await immediate(owner, async () => {
      await coordinator.verify();
      return loadServiceInvocationSnapshot(
        owner.database,
        requireServiceInvocation(owner.database, input.ownerRunId, input.operationId),
        owner.root,
        coordinator,
      );
    });
    await owner.finish();
    return snapshot;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/** List one owner's immutable Service operation allocations in operation-ID order. */
export async function listPrivateServiceInvocations(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly ownerRunId: string;
}): Promise<readonly PrivateServiceInvocationSnapshot[]> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.ownerRunId, "Service invocation owner Run");
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const snapshots = await immediate(owner, async () => {
      await coordinator.verify();
      requireRootRunRow(owner.database, input.ownerRunId);
      return Object.freeze(listServiceInvocationRows(owner.database, input.ownerRunId).map((row) =>
        loadServiceInvocationSnapshot(owner.database, row, owner.root, coordinator)
      ));
    });
    await owner.finish();
    return snapshots;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/** Persist dispatch admission before any provider request bytes may be written. */
export async function recordPrivateServiceInvocationDispatch(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly allocation: PrivateServiceInvocationAllocationResult;
}): Promise<PrivateServiceInvocationDispatchResult> {
  const allocation = requireCreatedServiceInvocationAllocation(input.allocation);
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const result = await immediate(owner, async () => {
      await coordinator.verify();
      const row = requireServiceInvocation(
        owner.database,
        allocation.snapshot.allocation.ownerRunId,
        allocation.snapshot.allocation.call.operationId,
      );
      const before = loadServiceInvocationSnapshot(owner.database, row, owner.root, coordinator);
      if (before.allocationDigest !== allocation.snapshot.allocationDigest ||
          !sameCanonical(before.allocation, allocation.snapshot.allocation)) {
        corrupt("Service invocation dispatch authority differs from its durable allocation");
      }
      if (before.dispatch !== undefined) {
        return Object.freeze({ snapshot: before, created: false });
      }
      requireNewServiceInvocationContext(
        owner.database,
        owner.root,
        coordinator,
        before.allocation.ownerRunId,
        before.allocation.call.slot,
      );
      const dispatch = normalizePrivateServiceInvocationDispatch({
        kind: "private-service-invocation-dispatch/1",
        ownerRunId: before.allocation.ownerRunId,
        operationId: before.allocation.call.operationId,
        allocationDigest: before.allocationDigest,
      });
      const bytes = encodePrivateServiceInvocationDispatch(dispatch);
      const digest = privateServiceInvocationDispatchDigest(dispatch);
      requireStoredSize(bytes, "Service invocation dispatch");
      const changed = runFinalized(owner.database, [
        "UPDATE service_invocations SET dispatch_digest = ?1, dispatch_bytes = ?2",
        "WHERE owner_run_id = ?3 AND operation_id = ?4 AND dispatch_digest IS NULL",
        "AND terminal_digest IS NULL AND closure_digest IS NULL",
      ].join(" "), [
        digest,
        bytes,
        dispatch.ownerRunId,
        dispatch.operationId,
      ]).changes;
      if (changed !== 1) corrupt("Service invocation dispatch compare-and-set failed");
      return Object.freeze({
        snapshot: loadServiceInvocationSnapshot(
          owner.database,
          requireServiceInvocation(owner.database, dispatch.ownerRunId, dispatch.operationId),
          owner.root,
          coordinator,
        ),
        created: true,
      });
    });
    await owner.finish();
    return result;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/** Atomically persist the first exact Service terminal and its operation closure. */
export async function completePrivateServiceInvocation(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly ownerRunId: string;
  readonly operationId: string;
  readonly observation: PrivateServiceInvocationObservation;
}): Promise<PrivateServiceInvocationSnapshot> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  const observation = normalizePrivateServiceInvocationObservation(input.observation);
  await coordinator.verify();
  requireDigest(input.ownerRunId, "Service invocation owner Run");
  requireWireId(input.operationId, "Service invocation operation ID");
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const snapshot = await immediate(owner, async () => {
      await coordinator.verify();
      const row = requireServiceInvocation(owner.database, input.ownerRunId, input.operationId);
      const before = loadServiceInvocationSnapshot(owner.database, row, owner.root, coordinator);
      writeServiceInvocationTerminal(owner.database, before, observation, false);
      return loadServiceInvocationSnapshot(
        owner.database,
        requireServiceInvocation(owner.database, input.ownerRunId, input.operationId),
        owner.root,
        coordinator,
      );
    });
    await owner.finish();
    return snapshot;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/** Close an unresolved operation deterministically after its exact Mount fence is durable. */
export async function recoverPrivateServiceInvocation(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly ownerRunId: string;
  readonly operationId: string;
  readonly mountFenceDigest: string;
}): Promise<PrivateServiceInvocationSnapshot> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.ownerRunId, "Service invocation owner Run");
  requireWireId(input.operationId, "Service invocation operation ID");
  requireDigest(input.mountFenceDigest, "Service invocation recovery Mount fence");
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const snapshot = await immediate(owner, async () => {
      await coordinator.verify();
      const row = requireServiceInvocation(owner.database, input.ownerRunId, input.operationId);
      const before = loadServiceInvocationSnapshot(owner.database, row, owner.root, coordinator);
      if (before.terminal !== undefined && before.closure !== undefined) return before;
      const ownerRow = requireRootRunRow(owner.database, before.allocation.ownerRunId);
      const candidate = loadCandidateRow(requireCandidateRow(owner.database, ownerRow.candidate_revision));
      requireCandidateRoot(candidate, owner.root);
      const lease = loadServiceLeaseSnapshot(
        owner.database,
        requireServiceLease(owner.database, before.allocation.ownerRunId, before.allocation.call.slot),
        owner.root,
        coordinator,
        candidate,
      );
      const mount = loadServiceMountSnapshot(
        owner.database,
        requireServiceMountRow(owner.database, lease.allocation.mountId),
        owner.root,
        coordinator,
        candidate,
      );
      if (mount.fence?.digest !== input.mountFenceDigest) {
        invalid("SERVICE_INVOCATION_FENCE_MISMATCH", "Service invocation recovery names another Mount fence");
      }
      const coordinatorLoss = mount.provisional?.value.classification === "coordinator-loss";
      const observation = normalizePrivateServiceInvocationObservation(before.dispatch === undefined ? {
        source: "host-prewrite",
        terminal: {
          status: "failed",
          code: "UNAVAILABLE",
          message: "Service invocation was never admitted for Provider dispatch",
        },
      } : {
        source: coordinatorLoss ? "coordinator-loss" : "provider-loss",
        terminal: {
          status: "failed",
          code: "UNCERTAIN",
          message: coordinatorLoss
            ? "Service invocation dispatch outcome was lost with its coordinator"
            : "Service invocation dispatch outcome was lost with its Provider lifecycle",
        },
      });
      writeServiceInvocationTerminal(owner.database, before, observation, true);
      return loadServiceInvocationSnapshot(
        owner.database,
        requireServiceInvocation(owner.database, input.ownerRunId, input.operationId),
        owner.root,
        coordinator,
      );
    });
    await owner.finish();
    return snapshot;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/**
 * Enumerate only unresolved Mounts from protected durable state. This grants
 * cleanup/recovery evidence, never launch authority, and deliberately does
 * not depend on the admitted runtime or retained Package/1 bytes remaining
 * available.
 */
export async function listPrivateServiceMountRecoveryWork(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly epoch: "current" | "older";
}): Promise<readonly PrivateServiceMountSnapshot[]> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  if (input.epoch !== "current" && input.epoch !== "older") {
    throw new TypeError("Service Mount recovery epoch must be current or older");
  }
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const snapshots = await immediate(owner, async () => {
      await coordinator.verify();
      const future = statement<{ readonly count: bigint }>(owner.database,
        "SELECT count(*) AS count FROM service_mounts WHERE coordinator_epoch > ?1",
      ).safeIntegers(true);
      try {
        const aggregate = future.get(BigInt(coordinator.epoch));
        if (aggregate === null || aggregate.count !== 0n) {
          corrupt("Service Mount belongs to a future coordinator epoch");
        }
      } finally { future.finalize(); }
      const comparison = input.epoch === "current" ? "=" : "<";
      const query = statement<ServiceMountRow>(owner.database, [
        "SELECT mount_id, binding_id, admission_digest, coordinator_epoch, allocation_digest, allocation_bytes",
        "FROM service_mounts WHERE coordinator_epoch", comparison, "?1",
        "ORDER BY mount_id",
      ].join(" ")).safeIntegers(true);
      let rows: readonly ServiceMountRow[];
      try { rows = query.all(BigInt(coordinator.epoch)).map(copiedServiceMountRow); }
      finally { query.finalize(); }
      const loaded = rows.map((row) => {
        const admissionRow = requireAdmissionByDigest(owner.database, row.admission_digest);
        const admission = loadAndCrossCheckAdmission(owner.database, admissionRow, owner.root);
        const candidate = loadCandidateRow(requireCandidateRow(
          owner.database,
          BigInt(admission.admission.candidateRevision),
        ));
        requireCandidateRoot(candidate, owner.root);
        return loadServiceMountSnapshot(
          owner.database,
          row,
          owner.root,
          coordinator,
          candidate,
        );
      });
      return Object.freeze(loaded.filter((snapshot) => snapshot.closure === undefined));
    });
    await owner.finish();
    return snapshots;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

interface PrivateServiceMountTransitionInput {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly packageStoreRoot?: string;
  readonly mountId: string;
  readonly recipe?: PrivateBunServiceRecipe;
}

interface PrivateServiceMountAdvanceInput extends PrivateServiceMountTransitionInput {
  readonly packageStoreRoot: string;
  readonly recipe: PrivateBunServiceRecipe;
  readonly allocation: PrivateServiceMountAllocationResult;
}

/** Persist the exact no-effect package and sandbox-owner allocations for one Mount. */
export async function recordPrivateServiceMountPlan(input: PrivateServiceMountAdvanceInput & {
  readonly packageAllocation: PrivatePackageMaterializationAllocationIdentity;
  readonly ownerAllocation: PrivateLinuxOwnerStateAllocationIdentity;
}): Promise<PrivateServiceMountSnapshot> {
  const packageAllocation = normalizePrivatePackageMaterializationAllocationIdentity(
    input.packageAllocation,
  );
  const ownerAllocation = normalizePrivateLinuxOwnerStateAllocationIdentity(input.ownerAllocation);
  return await transitionPrivateServiceMount(input, "advance", (database, before, context) => {
    const value = normalizePrivateServiceMountPlan({
      kind: "private-service-mount-plan/1",
      mountId: before.allocation.mountId,
      allocationDigest: before.allocationDigest,
      cancellationGraceMs: requireServiceMountTransitionRecipe(context).cancellationGraceMs,
      packageAllocation,
      ownerAllocation,
    });
    requireServiceMountPlanCorrelation(
      context.root,
      before,
      value,
      context.packageDigest,
      requireServiceMountTransitionRecipe(context),
    );
    requireServiceMountFactOrder(before, "plan");
    writeServiceMountFact(database, before, "plan", value, context);
  });
}

/** Persist the exact retained-package lease before sealing a sandbox owner. */
export async function recordPrivateServiceMountBacking(input: PrivateServiceMountAdvanceInput & {
  readonly lease: PrivatePackageMaterializationLeaseIdentity;
}): Promise<PrivateServiceMountSnapshot> {
  const lease = normalizePrivatePackageMaterializationLeaseIdentity(input.lease);
  return await transitionPrivateServiceMount(input, "advance", (database, before, context) => {
    const plan = requireServiceMountFact(before.plan, "plan");
    const value = normalizePrivateServiceMountBacking({
      kind: "private-service-mount-backing/1",
      mountId: before.allocation.mountId,
      allocationDigest: before.allocationDigest,
      planDigest: plan.digest,
      lease,
    });
    requireServiceMountBackingCorrelation(before, value);
    requireServiceMountFactOrder(before, "backing");
    writeServiceMountFact(database, before, "backing", value, context);
  });
}

/** Persist the exact sealed owner before package bytes may execute. */
export async function recordPrivateServiceMountSandbox(input: PrivateServiceMountAdvanceInput & {
  readonly owner: PrivateLinuxSealedOwnerIdentity;
}): Promise<PrivateServiceMountSnapshot> {
  const sealed = normalizePrivateLinuxSealedOwnerIdentity(input.owner);
  return await transitionPrivateServiceMount(input, "advance", (database, before, context) => {
    const backing = requireServiceMountFact(before.backing, "backing");
    const value = normalizePrivateServiceMountSandbox({
      kind: "private-service-mount-sandbox/1",
      mountId: before.allocation.mountId,
      allocationDigest: before.allocationDigest,
      backingDigest: backing.digest,
      owner: sealed,
    });
    requireServiceMountSandboxCorrelation(before, value, requireServiceMountTransitionRecipe(context));
    requireServiceMountFactOrder(before, "sandbox");
    writeServiceMountFact(database, before, "sandbox", value, context);
  });
}

/** Persist the trusted helper's exact prepared-owner observation. */
export async function recordPrivateServiceMountPrepared(input: PrivateServiceMountAdvanceInput & {
  readonly prepared: PrivateLinuxPreparedOwnerIdentity;
}): Promise<PrivateServiceMountSnapshot> {
  const prepared = normalizePrivateLinuxPreparedOwnerIdentity(input.prepared);
  return await transitionPrivateServiceMount(input, "advance", (database, before, context) => {
    const sandbox = requireServiceMountFact(before.sandbox, "sandbox");
    const value = normalizePrivateServiceMountPrepared({
      kind: "private-service-mount-prepared/1",
      mountId: before.allocation.mountId,
      allocationDigest: before.allocationDigest,
      sandboxDigest: sandbox.digest,
      prepared,
    });
    requireServiceMountPreparedCorrelation(before, value);
    requireServiceMountFactOrder(before, "prepared");
    writeServiceMountFact(database, before, "prepared", value, context);
  });
}

/** Allocate one fresh generation from an exact validated readiness export set. */
export async function recordPrivateServiceMountGeneration(input: PrivateServiceMountAdvanceInput & {
  readonly exports: readonly string[];
}): Promise<PrivateServiceMountSnapshot> {
  return await transitionPrivateServiceMount(input, "advance", (database, before, context) => {
    const prepared = requireServiceMountFact(before.prepared, "prepared");
    const generationId = privateDomainDigest("JIG-Private-Service-Generation-ID/1", {
      mountId: before.allocation.mountId,
      allocationDigest: before.allocationDigest,
      preparedDigest: prepared.digest,
    });
    const value = normalizePrivateServiceMountGeneration({
      kind: "private-service-mount-generation/1",
      mountId: before.allocation.mountId,
      allocationDigest: before.allocationDigest,
      preparedDigest: prepared.digest,
      generationId,
      exports: input.exports,
    });
    requireServiceMountGenerationCorrelation(before, value);
    requireServiceMountFactOrder(before, "generation");
    writeServiceMountFact(database, before, "generation", value, context);
  });
}

/** Record that the exact generation's empty readiness acknowledgement was flushed. */
export async function recordPrivateServiceMountAcknowledged(
  input: PrivateServiceMountAdvanceInput,
): Promise<PrivateServiceMountSnapshot> {
  return await transitionPrivateServiceMount(input, "advance", (database, before, context) => {
    const generation = requireServiceMountFact(before.generation, "generation");
    const value = normalizePrivateServiceMountAcknowledged({
      kind: "private-service-mount-acknowledged/1",
      mountId: before.allocation.mountId,
      allocationDigest: before.allocationDigest,
      generationDigest: generation.digest,
    });
    requireServiceMountAcknowledgedCorrelation(before, value);
    requireServiceMountFactOrder(before, "acknowledged");
    writeServiceMountFact(database, before, "acknowledged", value, context);
  });
}

/** Stop admission and retain one exact terminal classification before fencing. */
export async function recordPrivateServiceMountProvisional(
  input: PrivateServiceMountTransitionInput & {
    readonly classification: PrivateServiceMountClassification;
    readonly terminal: ServiceHostTerminal;
  },
): Promise<PrivateServiceMountSnapshot> {
  return await transitionPrivateServiceMount(input, "settle", (database, before, context) => {
    const value = normalizePrivateServiceMountProvisional({
      kind: "private-service-mount-provisional/1",
      mountId: before.allocation.mountId,
      allocationDigest: before.allocationDigest,
      generationDigest: before.generation?.digest ?? null,
      acknowledgedDigest: before.acknowledged?.digest ?? null,
      classification: input.classification,
      terminal: input.terminal,
    });
    requireServiceMountProvisionalCorrelation(before, value);
    requireServiceMountFactOrder(before, "provisional");
    writeServiceMountFact(database, before, "provisional", value, context);
  });
}

/** Persist exact no-start cancellation or complete-tree enforcement evidence. */
export async function recordPrivateServiceMountFence(input: PrivateServiceMountTransitionInput & {
  readonly proof: PrivateServiceMountFenceProof;
}): Promise<PrivateServiceMountSnapshot> {
  return await transitionPrivateServiceMount(input, "settle", (database, before, context) => {
    const provisional = requireServiceMountFact(before.provisional, "provisional");
    const plan = requireServiceMountFact(before.plan, "plan");
    const value = normalizePrivateServiceMountFence({
      kind: "private-service-mount-fence/1",
      mountId: before.allocation.mountId,
      allocationDigest: before.allocationDigest,
      provisionalDigest: provisional.digest,
      planDigest: plan.digest,
      proof: input.proof,
    });
    requireServiceMountFenceCorrelation(before, value);
    requireServiceMountFactOrder(before, "fence");
    writeServiceMountFact(database, before, "fence", value, context);
  });
}

/**
 * Verify that one fenced Mount has no live generation leases before trusted
 * machinery starts releasing its package and owner-state resources. A durable
 * fence prevents new leases, so the successful check remains monotonic.
 */
export async function requirePrivateServiceMountFinalizationReady(
  input: PrivateServiceMountTransitionInput,
): Promise<PrivateServiceMountSnapshot> {
  return await transitionPrivateServiceMount(input, "settle", (database, before, context) => {
    requireServiceMountFact(before.provisional, "provisional");
    if (before.plan !== undefined) requireServiceMountFact(before.fence, "fence");
    requireReleasedServiceLeases(
      database,
      before,
      context.root,
      context.coordinator,
      context.candidate,
    );
  });
}

/** Retain exact package/owner disposal after every linked Service lease closed. */
export async function recordPrivateServiceMountRelease(input: PrivateServiceMountTransitionInput & {
  readonly packageReleased: true;
  readonly ownerRelease: PrivateLinuxOwnerStateReleaseReceipt | null;
}): Promise<PrivateServiceMountSnapshot> {
  const ownerRelease = input.ownerRelease === null
    ? null
    : normalizePrivateLinuxOwnerStateReleaseReceipt(input.ownerRelease);
  return await transitionPrivateServiceMount(input, "settle", (database, before, context) => {
    const leaseReleases = requireReleasedServiceLeases(
      database,
      before,
      context.root,
      context.coordinator,
      context.candidate,
    );
    const value = normalizePrivateServiceMountRelease({
      kind: "private-service-mount-release/1",
      mountId: before.allocation.mountId,
      allocationDigest: before.allocationDigest,
      provisionalDigest: requireServiceMountFact(before.provisional, "provisional").digest,
      planDigest: before.plan?.digest ?? null,
      backingDigest: before.backing?.digest ?? null,
      fenceDigest: before.fence?.digest ?? null,
      packageReleased: input.packageReleased,
      ownerRelease,
      leaseReleases,
    });
    requireServiceMountReleaseCorrelation(
      database,
      context.root,
      context.coordinator,
      context.candidate,
      before,
      value,
    );
    requireServiceMountFactOrder(before, "release");
    writeServiceMountFact(database, before, "release", value, context);
  });
}

/** Close one fully released Mount without creating a replacement attempt. */
export async function closePrivateServiceMount(
  input: PrivateServiceMountTransitionInput,
): Promise<PrivateServiceMountSnapshot> {
  return await transitionPrivateServiceMount(input, "settle", (database, before, context) => {
    const provisional = requireServiceMountFact(before.provisional, "provisional");
    const release = requireServiceMountFact(before.release, "release");
    const value = normalizePrivateServiceMountClosure({
      kind: "private-service-mount-closure/1",
      mountId: before.allocation.mountId,
      allocationDigest: before.allocationDigest,
      provisionalDigest: provisional.digest,
      releaseDigest: release.digest,
    });
    requireServiceMountClosureCorrelation(before, value);
    requireServiceMountFactOrder(before, "closure");
    writeServiceMountFact(database, before, "closure", value, context);
  });
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
  const origin = createPrivateExternalSubmissionOrigin(input.submissionId);
  const request = createPrivateRootRunRequest(input);
  const originDigest = privateRootRunOriginDigest(origin);
  const submissionDigest = privateRootSubmissionDigest(request);
  const owner = await openStateOwner(input.projectRoot, false);
  let artifacts: ReacquiredArtifacts | undefined;
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const replay = findRootRunByOrigin(owner.database, originDigest);
    if (replay !== null) {
      const run = loadRootRunSnapshot(owner.database, replay, owner.root);
      requireSameExternalSubmission(run, submissionDigest);
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
    const runId = privateRootRunIdentityDigest({
      project: {
        device: owner.root.information.dev.toString(),
        inode: owner.root.information.ino.toString(),
      },
      origin,
      requestDigest: privateRootRequestDigest(request),
      coordinatorEpoch: coordinator.epoch,
    });
    const originBytes = encodePrivateRootRunOrigin(origin);
    const requestBytes = canonicalJson(request as unknown as JsonValue);
    requireStoredSize(originBytes, "root Run origin");
    requireStoredSize(requestBytes, "root Run request");

    const created = await immediate(owner, async () => {
      await coordinator.verify();
      const raced = findRootRunByOrigin(owner.database, originDigest);
      if (raced !== null) {
        const run = loadRootRunSnapshot(owner.database, raced, owner.root);
        requireSameExternalSubmission(run, submissionDigest);
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
        "INSERT INTO root_runs(run_id, origin_digest, origin_bytes, admission_digest, candidate_revision, coordinator_epoch, request_bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        [
        runId,
        originDigest,
        originBytes,
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

      const selectedTarget = findPrivateActivationCandidateTargetV5(candidate, request.target);
      if (selectedTarget === undefined || selectedTarget.disposition.state !== "ready") {
        corrupt("root Run preflight omitted an unavailable candidate terminal");
      }
      const intent = normalizePrivateRootSpawnIntent({
        kind: "private-root-spawn-intent/1",
        runId,
        admissionDigest: admission.admissionDigest,
        candidateRevision: safeRevision(candidateRow.revision),
        coordinatorEpoch: coordinator.epoch,
        requestDigest: selectedTarget.request.digest,
        recipeDigest: selectedTarget.disposition.recipeDigest,
        observationDigest: selectedTarget.disposition.observationDigest,
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

/**
 * Allocate the single exact child Flow operation allowed beneath one root
 * Run. The active transport may join duplicate waiters; durable state admits
 * no second distinct operation and never consults the current generation.
 */
export async function allocatePrivateRootFlowCall(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly allocation: PrivateRootFlowCallAllocation;
}): Promise<PrivateRootFlowCallLifecycle> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  const allocation = normalizePrivateRootFlowCallAllocation(input.allocation);
  const allocationBytes = encodePrivateRootFlowCallAllocation(allocation);
  requireStoredSize(allocationBytes, "root Flow call allocation");
  const allocationDigest = privateRootFlowCallAllocationDigest(allocation);
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const lifecycle = await immediate(owner, async () => {
      await coordinator.verify();
      const runRow = requireRootRunRow(owner.database, allocation.parentRunId);
      const run = loadRootRunSnapshot(owner.database, runRow, owner.root);
      if (run.state === "terminal") invalid("RUN_ALREADY_TERMINAL", "root Run is already terminal");
      if (run.coordinatorEpoch !== coordinator.epoch || allocation.coordinatorEpoch !== coordinator.epoch) {
        invalid("RUN_COORDINATOR_STALE", "only the current root coordinator may allocate a child Flow call");
      }
      requireRootFlowCallAllocationCandidate(owner.database, runRow, allocation);
      const prior = findRootFlowCall(owner.database, allocation.parentRunId);
      if (prior !== null) {
        if (prior.allocation_digest !== allocationDigest ||
            !sameBytes(prior.allocation_bytes, allocationBytes)) {
          invalid("RESOURCE_EXHAUSTED", "this root Run already allocated its one child Flow operation");
        }
        return loadRootFlowCallLifecycle(owner.database, prior, runRow);
      }
      runFinalized(owner.database,
        "INSERT INTO root_flow_calls(parent_run_id, allocation_digest, allocation_bytes) VALUES (?1, ?2, ?3)",
        [allocation.parentRunId, allocationDigest, allocationBytes],
      );
      return loadRootFlowCallLifecycle(
        owner.database,
        requireRootFlowCall(owner.database, allocation.parentRunId),
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

/** Persist one immutable child-operation fact under the parent Run owner. */
export async function recordPrivateRootFlowCallCheckpoint(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly parentRunId: string;
  readonly checkpoint: PrivateRootFlowCallCheckpointName;
  readonly value: JsonValue;
}): Promise<PrivateRootFlowCallLifecycle> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.parentRunId, "root Flow call parent Run");
  const checkpoint = requirePrivateRootFlowCallCheckpointName(input.checkpoint);
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const lifecycle = await immediate(owner, async () => {
      await coordinator.verify();
      const runRow = requireRootRunRow(owner.database, input.parentRunId);
      const run = loadRootRunSnapshot(owner.database, runRow, owner.root);
      if (run.state === "terminal") invalid("RUN_ALREADY_TERMINAL", "root Run is already terminal");
      if (run.coordinatorEpoch > coordinator.epoch) corrupt("root Flow call belongs to a future coordinator epoch");
      const row = requireRootFlowCall(owner.database, input.parentRunId);
      const before = loadRootFlowCallLifecycle(owner.database, row, runRow);
      const envelope = normalizePrivateRootFlowCallCheckpoint({
        kind: `private-root-flow-call-${checkpoint}/1`,
        parentRunId: input.parentRunId,
        allocationDigest: before.allocationDigest,
        value: input.value,
      }, checkpoint);
      const bytes = canonicalJson(envelope as unknown as JsonValue);
      requireStoredSize(bytes, `root Flow call ${checkpoint}`);
      const digest = privateRootFlowCallCheckpointDigest(checkpoint, envelope);
      const current = before[checkpoint];
      if (current !== undefined) {
        const stored = requireRootFlowCallFact(owner.database, input.parentRunId, checkpoint);
        if (current.digest !== digest || !sameBytes(stored.fact_bytes, bytes)) {
          invalid("RUN_EXECUTION_CHECKPOINT_CONFLICT", `root Flow call ${checkpoint} checkpoint differs`);
        }
        return before;
      }
      requireRootFlowCallCheckpointAuthority(run, coordinator, checkpoint);
      requireRootFlowCallCheckpointOrder(before, checkpoint);
      runFinalized(owner.database,
        "INSERT INTO root_flow_call_facts(parent_run_id, fact_name, fact_digest, fact_bytes) VALUES (?1, ?2, ?3, ?4)",
        [input.parentRunId, checkpoint, digest, bytes],
      );
      return loadRootFlowCallLifecycle(owner.database, row, runRow);
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

/** Reopen the optional child-operation lifecycle pinned beneath one root Run. */
export async function loadPrivateRootFlowCall(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly parentRunId: string;
}): Promise<PrivateRootFlowCallLifecycle | undefined> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.parentRunId, "root Flow call parent Run");
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const lifecycle = await immediate(owner, async () => {
      await coordinator.verify();
      const runRow = requireRootRunRow(owner.database, input.parentRunId);
      if (runRow.coordinator_epoch > BigInt(coordinator.epoch)) {
        corrupt("root Flow call belongs to a future coordinator epoch");
      }
      const row = findRootFlowCall(owner.database, input.parentRunId);
      return row === null ? undefined : loadRootFlowCallLifecycle(owner.database, row, runRow);
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

/** Bind the admitted child terminal to its complete release evidence. */
export async function closePrivateRootFlowCall(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly parentRunId: string;
}): Promise<PrivateRootFlowCallLifecycle> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.parentRunId, "root Flow call parent Run");
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const lifecycle = await immediate(owner, async () => {
      await coordinator.verify();
      const runRow = requireRootRunRow(owner.database, input.parentRunId);
      if (runRow.coordinator_epoch > BigInt(coordinator.epoch)) {
        corrupt("root Flow call belongs to a future coordinator epoch");
      }
      const row = requireRootFlowCall(owner.database, input.parentRunId);
      const before = loadRootFlowCallLifecycle(owner.database, row, runRow);
      requireRootFlowCallClosable(before);
      const closure = normalizePrivateRootFlowCallClosure({
        kind: "private-root-flow-call-closure/1",
        parentRunId: input.parentRunId,
        allocationDigest: before.allocationDigest,
        provisionalDigest: before.provisional!.digest,
        fenceDigest: before.fence?.digest ?? null,
        releaseDigest: before.release!.digest,
        admittedDigest: before.admitted!.digest,
      });
      const bytes = canonicalJson(closure as unknown as JsonValue);
      requireStoredSize(bytes, "root Flow call closure");
      const digest = privateRootFlowCallClosureDigest(closure);
      const prior = findRootFlowCallClosure(owner.database, input.parentRunId);
      if (prior === null) {
        runFinalized(owner.database,
          "INSERT INTO root_flow_call_closures(parent_run_id, closure_digest, closure_bytes) VALUES (?1, ?2, ?3)",
          [input.parentRunId, digest, bytes],
        );
      } else if (prior.closure_digest !== digest || !sameBytes(prior.closure_bytes, bytes)) {
        corrupt("root Flow call already has a different closure");
      }
      return loadRootFlowCallLifecycle(owner.database, row, runRow);
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

function matchingOpenHookRevisions(
  database: SqliteDatabase,
  event: PrivateJournalEvent,
): readonly LoadedHookRevision[] {
  const matches = [...requireOpenPrivateHookRevisions(database).values()].filter(({ revision }) => {
    if (revision.startPosition > event.journalPosition) {
      corrupt(`open Hook ${revision.meaning.hookId} starts after the next Journal Event`);
    }
    return revision.meaning.journalAuthority.source === event.source &&
      revision.meaning.journalAuthority.type === event.type;
  });
  matches.sort((left, right) => left.revision.meaning.hookId < right.revision.meaning.hookId
    ? -1
    : left.revision.meaning.hookId > right.revision.meaning.hookId ? 1 : 0);
  return Object.freeze(matches);
}

async function preparePrivateHookDerivations(input: {
  readonly database: SqliteDatabase;
  readonly root: PrivateProjectRoot;
  readonly packageStoreRoot: string;
  readonly event: PrivateJournalEvent;
  readonly coordinatorEpoch: number;
  readonly deadlineUnixMs: number;
  readonly artifacts: ReacquiredArtifacts[];
}): Promise<PreparedHookDerivations> {
  const admissionHead = readAdmissionHead(input.database, input.root);
  const revisions = matchingOpenHookRevisions(input.database, input.event);
  if (revisions.length > MAX_HOOK_DERIVATIONS_PER_EVENT) {
    invalid(
      "RESOURCE_EXHAUSTED",
      `one Journal Event may derive at most ${MAX_HOOK_DERIVATIONS_PER_EVENT} Hook Runs`,
    );
  }
  const candidates = new Map<number, {
    readonly row: CandidateRow;
    readonly value: PrivateActivationCandidateArtifactV5;
    readonly artifacts: ReacquiredArtifacts;
  }>();
  const runs: PreparedHookDerivedRun[] = [];

  for (const hookRevision of revisions) {
    const revision = hookRevision.revision;
    const admissionRow = requireAdmissionByDigest(input.database, revision.openingAdmissionDigest);
    const admission = loadAndCrossCheckAdmission(input.database, admissionRow, input.root).admission;
    if (admission.candidateRevision !== revision.openingCandidateRevision ||
        admission.candidateDigest !== revision.openingCandidateDigest) {
      corrupt(`Hook ${revision.meaning.hookId} opening evidence differs from its admission`);
    }
    let preparedCandidate = candidates.get(revision.openingCandidateRevision);
    if (preparedCandidate === undefined) {
      const row = requireCandidateRow(input.database, BigInt(revision.openingCandidateRevision));
      if (row.candidate_digest !== revision.openingCandidateDigest) {
        corrupt(`Hook ${revision.meaning.hookId} opening candidate digest changed`);
      }
      const value = loadCandidateRow(row);
      requireCandidateRoot(value, input.root);
      const artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot, value);
      input.artifacts.push(artifacts);
      preparedCandidate = Object.freeze({ row, value, artifacts });
      candidates.set(revision.openingCandidateRevision, preparedCandidate);
    }
    const target = findPrivateActivationCandidateTargetV5(
      preparedCandidate.value,
      revision.meaning.target.identity,
    );
    if (target === undefined || target.request.mode !== "run" ||
        target.request.digest !== revision.meaning.target.requestDigest ||
        privateHookTargetDispositionDigest(target.disposition) !==
          revision.meaning.target.dispositionDigest) {
      corrupt(`Hook ${revision.meaning.hookId} target differs from its opening candidate`);
    }
    const request = createPrivateRootRunRequest({
      target: revision.meaning.target.identity,
      input: input.event as unknown as JsonValue,
      deadlineUnixMs: input.deadlineUnixMs,
    });
    const terminal = rootPreflightTerminal(preparedCandidate.value, request, preparedCandidate.artifacts);
    const origin = createPrivateHookDerivedOrigin({
      hookRevisionDigest: hookRevision.revisionDigest,
      eventId: input.event.eventId,
    });
    const originDigest = privateRootRunOriginDigest(origin);
    const requestDigest = privateRootRequestDigest(request);
    const runId = privateRootRunIdentityDigest({
      project: {
        device: input.root.information.dev.toString(),
        inode: input.root.information.ino.toString(),
      },
      origin,
      requestDigest,
      coordinatorEpoch: input.coordinatorEpoch,
    });
    const originBytes = encodePrivateRootRunOrigin(origin);
    const requestBytes = canonicalJson(request as unknown as JsonValue);
    requireStoredSize(originBytes, `Hook ${revision.meaning.hookId} derived origin`);
    requireStoredSize(requestBytes, `Hook ${revision.meaning.hookId} derived request`);

    let spawnIntent: PrivateRootRunSpawnIntent | undefined;
    let spawnIntentDigest: string | undefined;
    let spawnIntentBytes: Uint8Array | undefined;
    let lifecycleAllocation: ReturnType<typeof normalizeRootExecutionAllocation> | undefined;
    let lifecycleAllocationBytes: Uint8Array | undefined;
    if (terminal === undefined) {
      if (target.disposition.state !== "ready") {
        corrupt(`Hook ${revision.meaning.hookId} preflight omitted an unavailable terminal`);
      }
      spawnIntent = normalizePrivateRootSpawnIntent({
        kind: "private-root-spawn-intent/1",
        runId,
        admissionDigest: revision.openingAdmissionDigest,
        candidateRevision: revision.openingCandidateRevision,
        coordinatorEpoch: input.coordinatorEpoch,
        requestDigest: target.request.digest,
        recipeDigest: target.disposition.recipeDigest,
        observationDigest: target.disposition.observationDigest,
        deadlineUnixMs: input.deadlineUnixMs,
      });
      spawnIntentDigest = privateRootSpawnIntentDigest(spawnIntent);
      spawnIntentBytes = canonicalJson(spawnIntent as unknown as JsonValue);
      lifecycleAllocation = normalizeRootExecutionAllocation({
        kind: "private-root-execution-allocation/1",
        runId,
        spawnIntentDigest,
        coordinatorEpoch: input.coordinatorEpoch,
        value: null,
      });
      lifecycleAllocationBytes = canonicalJson(lifecycleAllocation);
      requireStoredSize(spawnIntentBytes, `Hook ${revision.meaning.hookId} spawn intent`);
      requireStoredSize(lifecycleAllocationBytes, `Hook ${revision.meaning.hookId} execution allocation`);
    }
    runs.push(Object.freeze({
      hookId: revision.meaning.hookId,
      hookRevision,
      admissionRow,
      candidateRow: preparedCandidate.row,
      origin,
      originDigest,
      originBytes,
      request,
      requestBytes,
      runId,
      coordinatorEpoch: input.coordinatorEpoch,
      terminal,
      spawnIntent,
      spawnIntentDigest,
      spawnIntentBytes,
      lifecycleAllocation,
      lifecycleAllocationBytes,
    }));
  }

  const selection = normalizePrivateHookSelectionSet({
    kind: "private-hook-selection-set/1",
    eventId: input.event.eventId,
    entries: runs.map((run) => ({
      hookId: run.hookId,
      hookRevisionDigest: run.hookRevision.revisionDigest,
      runId: run.runId,
    })),
  });
  const selectionBytes = encodePrivateHookSelectionSet(selection);
  requireStoredSize(selectionBytes, "root Journal Hook selection");
  return Object.freeze({
    admissionHeadRevision: admissionHead.revision,
    revisions,
    runs: Object.freeze(runs),
    selection,
    selectionDigest: privateHookSelectionSetDigest(selection),
    selectionBytes,
  });
}

function requireSameRootRunRow(left: RootRunRow, right: RootRunRow): void {
  if (left.run_id !== right.run_id || left.origin_digest !== right.origin_digest ||
      left.admission_digest !== right.admission_digest ||
      left.candidate_revision !== right.candidate_revision ||
      left.coordinator_epoch !== right.coordinator_epoch ||
      !sameBytes(left.origin_bytes, right.origin_bytes) ||
      !sameBytes(left.request_bytes, right.request_bytes)) {
    corrupt("one root Run changed its immutable persisted row");
  }
}

function persistPrivateHookDerivedRun(
  database: SqliteDatabase,
  event: PrivateJournalEvent,
  prepared: PreparedHookDerivedRun,
): void {
  runFinalized(database,
    "INSERT INTO root_runs(run_id, origin_digest, origin_bytes, admission_digest, candidate_revision, coordinator_epoch, request_bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    [
      prepared.runId,
      prepared.originDigest,
      prepared.originBytes,
      prepared.hookRevision.revision.openingAdmissionDigest,
      prepared.hookRevision.revision.openingCandidateRevision,
      prepared.coordinatorEpoch,
      prepared.requestBytes,
    ],
  );
  // The coordinator epoch is part of the Run ID and must not be inferred from
  // an admission revision for terminal-only Runs.
  const inserted = requireRootRunRow(database, prepared.runId);
  if (inserted.coordinator_epoch !== BigInt(prepared.coordinatorEpoch)) {
    corrupt("Hook-derived root Run coordinator epoch was not persisted exactly");
  }
  if (prepared.terminal !== undefined) {
    persistRootTerminal(database, prepared.runId, prepared.terminal);
  } else {
    if (prepared.spawnIntent === undefined || prepared.spawnIntentDigest === undefined ||
        prepared.spawnIntentBytes === undefined || prepared.lifecycleAllocation === undefined ||
        prepared.lifecycleAllocationBytes === undefined) {
      corrupt("READY Hook-derived root Run lacks prepared execution evidence");
    }
    runFinalized(database,
      "INSERT INTO root_spawn_intents(run_id, intent_digest, intent_bytes) VALUES (?1, ?2, ?3)",
      [prepared.runId, prepared.spawnIntentDigest, prepared.spawnIntentBytes],
    );
    runFinalized(database,
      "INSERT INTO root_execution_lifecycles(run_id, allocation_digest, allocation_bytes) VALUES (?1, ?2, ?3)",
      [
        prepared.runId,
        rootExecutionAllocationDigest(prepared.lifecycleAllocation),
        prepared.lifecycleAllocationBytes,
      ],
    );
  }
  runFinalized(database,
    "INSERT INTO hook_derivations(hook_revision_digest, event_id, run_id) VALUES (?1, ?2, ?3)",
    [prepared.hookRevision.revisionDigest, event.eventId, prepared.runId],
  );
}

/**
 * Commit one canonical Journal append operation admitted beneath a root Run.
 * Package and Schema work is prepared outside the final writer transaction;
 * Event, Hook selection, derived roots, effect result, and closure are then
 * committed atomically. An exact retry returns the original receipt.
 */
export async function appendPrivateRootJournalEvent(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly allocation: PrivateRootJournalAppendAllocation;
  readonly committedAtUnixMs: number;
}): Promise<PrivateRootJournalAppendReceipt> {
  for (let attempt = 1; attempt <= MAX_HOOK_APPEND_REPREPARATIONS; attempt += 1) {
    try { return await appendPrivateRootJournalEventOnce(input); }
    catch (error) {
      if (!hasCode(error, "STALE_PLAN") || attempt === MAX_HOOK_APPEND_REPREPARATIONS) throw error;
    }
  }
  throw new Error("unreachable root Journal append repreparation state");
}

async function appendPrivateRootJournalEventOnce(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly allocation: PrivateRootJournalAppendAllocation;
  readonly committedAtUnixMs: number;
}): Promise<PrivateRootJournalAppendReceipt> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  const allocation = normalizePrivateRootJournalAppendAllocation(input.allocation);
  const allocationBytes = encodePrivateRootJournalAppendAllocation(allocation);
  const allocationDigest = privateRootJournalAppendAllocationDigest(allocation);
  requireStoredSize(allocationBytes, "root Journal append allocation");
  const owner = await openStateOwner(input.projectRoot, false);
  const artifacts: ReacquiredArtifacts[] = [];
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const initialRunRow = requireRootRunRow(owner.database, allocation.parentRunId);
    const initialRun = loadRootRunSnapshot(owner.database, initialRunRow, owner.root);
    const initialPrior = findRootJournalAppend(
      owner.database,
      allocation.parentRunId,
      allocation.call.operationId,
    );
    if (initialPrior !== null) {
      if (initialPrior.allocation_digest !== allocationDigest ||
          !sameBytes(initialPrior.allocation_bytes, allocationBytes)) {
        invalid("OPERATION_CONFLICT", "Journal operation ID was reused with different append parameters");
      }
      const replay = await immediate(owner, async () => {
        await coordinator.verify();
        const currentRunRow = requireRootRunRow(owner.database, allocation.parentRunId);
        requireSameRootRunRow(initialRunRow, currentRunRow);
        const prior = requireRootJournalAppend(
          owner.database,
          allocation.parentRunId,
          allocation.call.operationId,
        );
        return loadRootJournalAppendReceipt(owner.database, prior, currentRunRow, owner.root);
      });
      await owner.finish();
      return replay;
    }
    if (initialRun.state === "terminal") invalid("RUN_ALREADY_TERMINAL", "root Run is already terminal");
    if (initialRun.coordinatorEpoch !== coordinator.epoch || allocation.coordinatorEpoch !== coordinator.epoch) {
      invalid("RUN_COORDINATOR_STALE", "only the current root coordinator may append a Journal Event");
    }
    if (findRootSpawn(owner.database, allocation.parentRunId) === null) {
      corrupt("root Journal append parent has no spawn intent");
    }
    requireRootJournalAppendCandidate(owner.database, initialRunRow, allocation);
    const initialHead = readJournalHead(owner.database);
    if (initialHead.position >= MAX_SAFE_REVISION) {
      invalid("RESOURCE_EXHAUSTED", "Journal position space is exhausted");
    }
    const position = safeRevision(initialHead.position + 1n);
    const event = createPrivateJournalEvent({
      allocation,
      journalPosition: position,
      committedAtUnixMs: input.committedAtUnixMs,
    });
    const prepared = await preparePrivateHookDerivations({
      database: owner.database,
      root: owner.root,
      packageStoreRoot: input.packageStoreRoot,
      event,
      coordinatorEpoch: coordinator.epoch,
      deadlineUnixMs: initialRun.deadlineUnixMs,
      artifacts,
    });
    const eventBytes = canonicalJson(event as unknown as JsonValue);
    const eventDigest = privateJournalEventDigest(event);
    const terminal: RunHostEffectResult = Object.freeze({ value: event as unknown as JsonValue });
    const terminalBytes = canonicalJson(terminal as unknown as JsonValue);
    const terminalDigest = privateRootJournalEffectTerminalDigest(terminal);
    const closure = normalizePrivateRootJournalAppendClosure({
      kind: "private-root-journal-append-closure/1",
      parentRunId: allocation.parentRunId,
      allocationDigest,
      eventDigest,
      terminalDigest,
      hookSelectionDigest: prepared.selectionDigest,
    });
    const closureBytes = canonicalJson(closure as unknown as JsonValue);
    const closureDigest = privateRootJournalAppendClosureDigest(closure);
    for (const [bytes, label] of [
      [eventBytes, "Journal Event"],
      [terminalBytes, "root Journal effect terminal"],
      [closureBytes, "root Journal append closure"],
    ] as const) requireStoredSize(bytes, label);

    const receipt = await immediate(owner, async () => {
      await coordinator.verify();
      const runRow = requireRootRunRow(owner.database, allocation.parentRunId);
      requireSameRootRunRow(initialRunRow, runRow);
      const run = loadRootRunSnapshot(owner.database, runRow, owner.root);
      if (run.state === "terminal") invalid("RUN_ALREADY_TERMINAL", "root Run is already terminal");
      if (run.coordinatorEpoch !== coordinator.epoch || allocation.coordinatorEpoch !== coordinator.epoch) {
        invalid("RUN_COORDINATOR_STALE", "only the current root coordinator may append a Journal Event");
      }
      if (findRootSpawn(owner.database, allocation.parentRunId) === null) {
        corrupt("root Journal append parent has no spawn intent");
      }
      requireRootJournalAppendCandidate(owner.database, runRow, allocation);
      const prior = findRootJournalAppend(owner.database, allocation.parentRunId, allocation.call.operationId);
      if (prior !== null) {
        if (prior.allocation_digest !== allocationDigest ||
            !sameBytes(prior.allocation_bytes, allocationBytes)) {
          invalid("OPERATION_CONFLICT", "Journal operation ID was reused with different append parameters");
        }
        return loadRootJournalAppendReceipt(owner.database, prior, runRow, owner.root);
      }
      const countQuery = statement<{ readonly count: bigint }>(owner.database,
        "SELECT count(*) AS count FROM root_journal_appends WHERE parent_run_id = ?1",
      );
      let appendCount: bigint | undefined;
      try { appendCount = countQuery.get(allocation.parentRunId)?.count; }
      finally { countQuery.finalize(); }
      if (appendCount === undefined) corrupt("root Journal append count is invalid");
      if (appendCount >= MAX_ROOT_JOURNAL_APPENDS) {
        invalid("RESOURCE_EXHAUSTED", "root Run exhausted its Journal operation limit");
      }

      const head = readJournalHead(owner.database);
      if (head.position !== initialHead.position) {
        stale("Journal head changed while Hook derivations were prepared");
      }
      const admissionHead = readAdmissionHead(owner.database, owner.root);
      if (admissionHead.revision !== prepared.admissionHeadRevision) {
        stale("admission head changed while Hook derivations were prepared");
      }
      const currentMatches = matchingOpenHookRevisions(owner.database, event);
      if (currentMatches.length !== prepared.revisions.length ||
          currentMatches.some((entry, index) =>
            entry.revisionDigest !== prepared.revisions[index]!.revisionDigest)) {
        stale("active Hook revisions changed while derivations were prepared");
      }
      for (const derived of prepared.runs) {
        requireSameAdmissionRow(
          derived.admissionRow,
          requireAdmissionByDigest(owner.database, derived.admissionRow.admission_digest),
        );
        requireSameCandidateRow(
          derived.candidateRow,
          requireCandidateRow(owner.database, derived.candidateRow.revision),
        );
      }

      runFinalized(owner.database,
        "INSERT INTO journal_events(position, event_id, event_digest, event_bytes) VALUES (?1, ?2, ?3, ?4)",
        [position, event.eventId, eventDigest, eventBytes],
      );
      runFinalized(owner.database,
        "INSERT INTO root_journal_appends(parent_run_id, operation_id, event_position, allocation_digest, allocation_bytes) VALUES (?1, ?2, ?3, ?4, ?5)",
        [allocation.parentRunId, allocation.call.operationId, position, allocationDigest, allocationBytes],
      );
      runFinalized(owner.database,
        "INSERT INTO root_journal_terminals(parent_run_id, operation_id, terminal_digest, terminal_bytes) VALUES (?1, ?2, ?3, ?4)",
        [allocation.parentRunId, allocation.call.operationId, terminalDigest, terminalBytes],
      );
      for (const derived of prepared.runs) {
        persistPrivateHookDerivedRun(owner.database, event, derived);
      }
      runFinalized(owner.database,
        "INSERT INTO root_journal_hook_selections(parent_run_id, operation_id, selection_digest, selection_bytes) VALUES (?1, ?2, ?3, ?4)",
        [
          allocation.parentRunId,
          allocation.call.operationId,
          prepared.selectionDigest,
          prepared.selectionBytes,
        ],
      );
      runFinalized(owner.database,
        "INSERT INTO root_journal_closures(parent_run_id, operation_id, closure_digest, closure_bytes) VALUES (?1, ?2, ?3, ?4)",
        [allocation.parentRunId, allocation.call.operationId, closureDigest, closureBytes],
      );
      const advanced = runFinalized(owner.database,
        "UPDATE journal_head SET position = ?1 WHERE singleton = 1 AND position = ?2",
        [position, head.position],
      );
      if (advanced.changes !== 1) corrupt("Journal head did not advance exactly once");
      return loadRootJournalAppendReceipt(
        owner.database,
        requireRootJournalAppend(owner.database, allocation.parentRunId, allocation.call.operationId),
        runRow,
        owner.root,
      );
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

/** Reopen the optional immutable Journal append receipt beneath one root Run. */
export async function loadPrivateRootJournalAppend(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly parentRunId: string;
  readonly operationId: string;
}): Promise<PrivateRootJournalAppendReceipt | undefined> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.parentRunId, "root Journal append parent Run");
  requireWireId(input.operationId, "root Journal operation ID");
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const receipt = await immediate(owner, async () => {
      await coordinator.verify();
      const runRow = requireRootRunRow(owner.database, input.parentRunId);
      if (runRow.coordinator_epoch > BigInt(coordinator.epoch)) {
        corrupt("root Journal append belongs to a future coordinator epoch");
      }
      const row = findRootJournalAppend(owner.database, input.parentRunId, input.operationId);
      return row === null
        ? undefined
        : loadRootJournalAppendReceipt(owner.database, row, runRow, owner.root);
    });
    await owner.finish();
    return receipt;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await disposeOperation(owner, undefined, failure);
  }
}

/** List only fully closed Journal operation receipts for one parent Run. */
export async function listPrivateRootJournalAppends(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly parentRunId: string;
}): Promise<readonly PrivateRootJournalAppendReceipt[]> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  await coordinator.verify();
  requireDigest(input.parentRunId, "root Journal append parent Run");
  const owner = await openStateOwner(input.projectRoot, false);
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const receipts = await immediate(owner, async () => {
      await coordinator.verify();
      const runRow = requireRootRunRow(owner.database, input.parentRunId);
      if (runRow.coordinator_epoch > BigInt(coordinator.epoch)) {
        corrupt("root Journal appends belong to a future coordinator epoch");
      }
      const query = statement<RootJournalAppendRow>(owner.database, [
        "SELECT parent_run_id, operation_id, event_position, allocation_digest, allocation_bytes",
        "FROM root_journal_appends WHERE parent_run_id = ?1 ORDER BY event_position",
      ].join(" "));
      let rows: readonly RootJournalAppendRow[];
      try { rows = query.all(input.parentRunId); }
      finally { query.finalize(); }
      if (BigInt(rows.length) > MAX_ROOT_JOURNAL_APPENDS) corrupt("root Run exceeds its Journal operation limit");
      return Object.freeze(rows.map((row) => loadRootJournalAppendReceipt(
        owner.database,
        Object.freeze({
          ...row,
          allocation_bytes: copiedBlob(row.allocation_bytes, "stored root Journal append allocation"),
        }),
        runRow,
        owner.root,
      )));
    });
    await owner.finish();
    return receipts;
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
      "SELECT root_runs.run_id, root_runs.origin_digest, root_runs.origin_bytes,",
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
          privateRootRunOriginDigest(run.origin) !== privateRootRunOriginDigest(initialRun.origin) ||
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
}): Promise<PrivateActivationApplyReceipt> {
  requireDigest(input.planDigest, "review plan");
  const owner = await openStateOwner(input.projectRoot, false);
  let artifacts: ReacquiredArtifacts | undefined;
  let failure: unknown;
  try {
    const historical = loadAppliedPlanReceipt(owner.database, input.planDigest, owner.root);
    if (historical !== null) {
      await owner.finish();
      return historical;
    }

    const initialPlanRow = requirePlanRow(owner.database, input.planDigest);
    const plan = loadPlanRow(initialPlanRow);
    const initialCandidateRow = requireCandidateRow(owner.database, initialPlanRow.candidate_revision);
    const candidate = loadCandidateRow(initialCandidateRow);
    crossCheckPlanCandidate(plan, initialPlanRow, initialCandidateRow, candidate);
    requirePlanBase(owner.database, plan, owner.root);
    requireCandidateRoot(candidate, owner.root);
    requireDerivedPlanOperation(owner.database, plan, candidate, owner.root);
    artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot, candidate);

    const receipt = await immediate(owner, async () => {
      const raced = loadAppliedPlanReceipt(owner.database, input.planDigest, owner.root);
      if (raced !== null) return raced;

      const currentPlanRow = requirePlanRow(owner.database, input.planDigest);
      const currentCandidateRow = requireCandidateRow(owner.database, initialPlanRow.candidate_revision);
      requireSamePlanRow(initialPlanRow, currentPlanRow);
      requireSameCandidateRow(initialCandidateRow, currentCandidateRow);
      crossCheckPlanCandidate(plan, currentPlanRow, currentCandidateRow, candidate);
      requirePlanBase(owner.database, plan, owner.root);

      const candidateHead = readCandidateHead(owner.database, owner.root);
      if (plan.operation === "admission" && (
        candidateHead.revision !== currentCandidateRow.revision ||
        currentCandidateRow.candidate_digest !== plan.candidateDigest
      )) stale("reviewed candidate is no longer the candidate head");
      const admissionHead = readAdmissionHead(owner.database, owner.root);
      const currentBase = admissionHead.revision === null
        ? null
        : requireAdmissionRow(owner.database, admissionHead.revision).admission_digest;
      if (currentBase !== plan.baseGeneration) stale("reviewed base generation is no longer active");

      const proposedLock = encodePrivateProjectLocalLock(candidate.lock);
      if (plan.operation === "lock-repair") {
        if (plan.baseGeneration === null || admissionHead.revision === null) {
          corrupt("lock-repair plan has no active admission base");
        }
        const activeRow = requireAdmissionRow(owner.database, admissionHead.revision);
        const active = loadAndCrossCheckAdmission(owner.database, activeRow, owner.root);
        if (active.admissionDigest !== plan.baseGeneration) {
          stale("reviewed lock-repair base is no longer active");
        }
        const activeCandidateRow = requireCandidateRow(
          owner.database,
          BigInt(active.admission.candidateRevision),
        );
        const activeCandidate = loadCandidateRow(activeCandidateRow);
        requireCandidateRoot(activeCandidate, owner.root);
        if (
          activeCandidate.candidate.activationMeaningDigest !== plan.activationMeaningDigest ||
          activeCandidate.candidate.lockDigest !== plan.proposed.lockDigest ||
          !sameBytes(
            encodePrivateProjectLocalLock(activeCandidate.lock),
            encodePrivateProjectLocalLock(plan.proposed.lock),
          )
        ) corrupt("reviewed lock repair differs from its protected active activation meaning");

        await convergeVisibleLock(owner, plan, proposedLock);

        const finalAdmissionHead = readAdmissionHead(owner.database, owner.root);
        if (finalAdmissionHead.revision !== admissionHead.revision) {
          stale("admission head changed during lock repair");
        }
        const finalPlanRow = requirePlanRow(owner.database, input.planDigest);
        const finalCandidateRow = requireCandidateRow(owner.database, currentCandidateRow.revision);
        requireSamePlanRow(currentPlanRow, finalPlanRow);
        requireSameCandidateRow(currentCandidateRow, finalCandidateRow);

        const repair = createPrivateLockRepair({
          planDigest: input.planDigest,
          activeAdmissionDigest: active.admissionDigest,
          proposedLockDigest: plan.proposed.lockDigest,
        });
        const repairBytes = encodePrivateLockRepair(repair);
        requireStoredSize(repairBytes, "lock-repair receipt");
        const repairDigest = privateLockRepairDigest(repair);
        runFinalized(owner.database,
          "INSERT INTO lock_repairs(plan_digest, repair_digest, repair_bytes) VALUES (?1, ?2, ?3)",
          [input.planDigest, repairDigest, repairBytes],
        );
        return loadAndCrossCheckLockRepair(
          owner.database,
          requireLockRepairRow(owner.database, input.planDigest),
          owner.root,
        );
      }

      const transition = preparePrivateHookAdmissionTransition(owner.database, {
        root: owner.root,
        baseGeneration: plan.baseGeneration,
        planDigest: input.planDigest,
        candidateRevision: safeRevision(currentCandidateRow.revision),
        candidateDigest: currentCandidateRow.candidate_digest,
        lockDigest: candidate.candidate.lockDigest,
        candidate,
      });
      const admission = createPrivateActivationAdmission({
        baseGeneration: plan.baseGeneration,
        planDigest: input.planDigest,
        candidateRevision: safeRevision(currentCandidateRow.revision),
        candidateDigest: currentCandidateRow.candidate_digest,
        lockDigest: candidate.candidate.lockDigest,
        hookBoundaryDigest: transition.boundaryDigest,
      });
      const admissionBytes = encodePrivateActivationAdmission(admission);
      requireStoredSize(admissionBytes, "activation admission");
      const admissionDigest = privateActivationAdmissionDigest(admission);
      const next = admissionHead.revision === null ? 1n : admissionHead.revision + 1n;
      if (next > MAX_SAFE_REVISION) {
        unavailable("ADMISSION_REVISION_EXHAUSTED", "private admission generation revision is exhausted");
      }

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

      runFinalized(owner.database,
        "INSERT INTO admissions(revision, admission_digest, base_generation, plan_digest, admission_bytes) VALUES (?1, ?2, ?3, ?4, ?5)",
        [next, admissionDigest, plan.baseGeneration, input.planDigest, admissionBytes],
      );
      persistPrivateHookAdmissionTransition(owner.database, admissionDigest, transition);
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
export function requirePrivateStoredActivationCandidate(value: unknown): PrivateActivationCandidateArtifactV5 {
  if (value === null || typeof value !== "object" || !storedCandidates.has(value)) {
    throw new TypeError("activation candidate has not been reverified from protected storage");
  }
  return value as PrivateActivationCandidateArtifactV5;
}

function rootPreflightTerminal(
  candidate: PrivateActivationCandidateArtifactV5,
  request: PrivateRootRunRequest,
  artifacts: ReacquiredArtifacts,
): PrivateRootRunTerminal | undefined {
  const target = findPrivateActivationCandidateTargetV5(candidate, request.target);
  if (target === undefined) {
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

function findRootRunByOrigin(database: SqliteDatabase, originDigest: string): RootRunRow | null {
  const query = statement<RootRunRow>(database, [
    "SELECT run_id, origin_digest, origin_bytes, admission_digest, candidate_revision, coordinator_epoch, request_bytes",
    "FROM root_runs WHERE origin_digest = ?1",
  ].join(" ")).safeIntegers(true);
  try {
    const row = query.get(originDigest);
    return row === null ? null : copiedRootRunRow(row);
  } finally { query.finalize(); }
}

function requireRootRunRow(database: SqliteDatabase, runId: string): RootRunRow {
  const query = statement<RootRunRow>(database, [
    "SELECT run_id, origin_digest, origin_bytes, admission_digest, candidate_revision, coordinator_epoch, request_bytes",
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

function findRootJournalAppend(
  database: SqliteDatabase,
  parentRunId: string,
  operationId: string,
): RootJournalAppendRow | null {
  const query = statement<RootJournalAppendRow>(database, [
    "SELECT parent_run_id, operation_id, event_position, allocation_digest, allocation_bytes",
    "FROM root_journal_appends WHERE parent_run_id = ?1 AND operation_id = ?2",
  ].join(" "));
  try {
    const row = query.get(parentRunId, operationId);
    return row === null ? null : Object.freeze({
      parent_run_id: row.parent_run_id,
      operation_id: row.operation_id,
      event_position: row.event_position,
      allocation_digest: row.allocation_digest,
      allocation_bytes: copiedBlob(row.allocation_bytes, "stored root Journal append allocation"),
    });
  } finally { query.finalize(); }
}

function requireRootJournalAppend(
  database: SqliteDatabase,
  parentRunId: string,
  operationId: string,
): RootJournalAppendRow {
  const row = findRootJournalAppend(database, parentRunId, operationId);
  if (row === null) corrupt("root Run has no Journal append");
  return row;
}

function requireRootJournalAppendByEventPosition(
  database: SqliteDatabase,
  position: bigint,
): RootJournalAppendRow {
  const query = statement<RootJournalAppendRow>(database, [
    "SELECT parent_run_id, operation_id, event_position, allocation_digest, allocation_bytes",
    "FROM root_journal_appends WHERE event_position = ?1",
  ].join(" "));
  try {
    const rows = query.all(position).map((row) => Object.freeze({
      parent_run_id: row.parent_run_id,
      operation_id: row.operation_id,
      event_position: row.event_position,
      allocation_digest: row.allocation_digest,
      allocation_bytes: copiedBlob(row.allocation_bytes, "stored root Journal append allocation"),
    }));
    if (rows.length !== 1) {
      corrupt("observed Journal Event has no unique root append");
    }
    return rows[0]!;
  } finally { query.finalize(); }
}

function requireJournalEvent(database: SqliteDatabase, position: bigint): JournalEventRow {
  const query = statement<JournalEventRow>(database, [
    "SELECT position, event_id, event_digest, event_bytes",
    "FROM journal_events WHERE position = ?1",
  ].join(" "));
  try {
    const row = query.get(position);
    if (row === null) corrupt("root Journal append has no Event");
    return Object.freeze({
      position: row.position,
      event_id: row.event_id,
      event_digest: row.event_digest,
      event_bytes: copiedBlob(row.event_bytes, "stored Journal Event"),
    });
  } finally { query.finalize(); }
}

/**
 * Authenticate the exact existing Event named by an admission's Journal-head
 * observation. The surrounding admission transaction establishes that the
 * observed position was the head; this durable witness roots that position
 * and its canonical Event, not a total chronology across SQLite tables.
 */
function requireCanonicalJournalEventDigest(
  database: SqliteDatabase,
  root: PrivateProjectRoot,
  position: bigint,
): string {
  if (position < 1n || position > MAX_SAFE_REVISION) {
    corrupt("Hook admission observes an invalid Journal position");
  }
  const append = requireRootJournalAppendByEventPosition(database, position);
  const run = requireRootRunRow(database, append.parent_run_id);
  const receipt = loadRootJournalAppendReceipt(database, append, run, root);
  if (receipt.event.journalPosition !== safeRevision(position)) {
    corrupt("observed Journal Event differs from its root append position");
  }
  return receipt.eventDigest;
}

function requireRootJournalTerminal(
  database: SqliteDatabase,
  parentRunId: string,
  operationId: string,
): RootJournalTerminalRow {
  const query = statement<RootJournalTerminalRow>(database, [
    "SELECT parent_run_id, operation_id, terminal_digest, terminal_bytes",
    "FROM root_journal_terminals WHERE parent_run_id = ?1 AND operation_id = ?2",
  ].join(" "));
  try {
    const row = query.get(parentRunId, operationId);
    if (row === null) corrupt("root Journal append has no effect terminal");
    return Object.freeze({
      parent_run_id: row.parent_run_id,
      operation_id: row.operation_id,
      terminal_digest: row.terminal_digest,
      terminal_bytes: copiedBlob(row.terminal_bytes, "stored root Journal effect terminal"),
    });
  } finally { query.finalize(); }
}

function requireRootJournalHookSelection(
  database: SqliteDatabase,
  parentRunId: string,
  operationId: string,
): RootJournalHookSelectionRow {
  const query = statement<RootJournalHookSelectionRow>(database, [
    "SELECT parent_run_id, operation_id, selection_digest, selection_bytes",
    "FROM root_journal_hook_selections WHERE parent_run_id = ?1 AND operation_id = ?2",
  ].join(" "));
  try {
    const row = query.get(parentRunId, operationId);
    if (row === null) corrupt("root Journal append has no Hook-selection completion");
    return Object.freeze({
      parent_run_id: row.parent_run_id,
      operation_id: row.operation_id,
      selection_digest: row.selection_digest,
      selection_bytes: copiedBlob(row.selection_bytes, "stored root Journal Hook selection"),
    });
  } finally { query.finalize(); }
}

function readHookDerivationsForEvent(
  database: SqliteDatabase,
  eventId: string,
): readonly HookDerivationRow[] {
  const query = statement<HookDerivationRow>(database, [
    "SELECT hook_revision_digest, event_id, run_id FROM hook_derivations",
    "WHERE event_id = ?1 ORDER BY hook_revision_digest",
  ].join(" "));
  try {
    return Object.freeze(query.all(eventId).map((row) => Object.freeze({ ...row })));
  } finally { query.finalize(); }
}

function requireHookRevisionByDigest(
  database: SqliteDatabase,
  root: PrivateProjectRoot,
  revisionDigest: string,
): LoadedHookRevision {
  const query = statement<HookRevisionRow>(database, [
    "SELECT revision_digest, hook_id, meaning_digest, opening_admission_digest,",
    "opening_candidate_revision, start_position, closing_admission_digest, end_position, revision_bytes",
    "FROM hook_revisions WHERE revision_digest = ?1",
  ].join(" "));
  try {
    const rows = query.all(revisionDigest).map(copiedHookRevisionRow);
    if (rows.length !== 1) corrupt("Hook selection names a missing or duplicated revision");
    const loaded = decodeAndCrossCheckHookRevisionRow(database, rows[0]!);
    const revision = loaded.revision;
    const admissionRow = requireAdmissionByDigest(database, revision.openingAdmissionDigest);
    const admission = loadAndCrossCheckAdmission(database, admissionRow, root).admission;
    if (admission.candidateRevision !== revision.openingCandidateRevision ||
        admission.candidateDigest !== revision.openingCandidateDigest) {
      corrupt(`Hook ${revision.meaning.hookId} opening pin differs from its admission`);
    }
    const candidate = loadCandidateRow(requireCandidateRow(
      database,
      BigInt(revision.openingCandidateRevision),
    ));
    const meaning = privateHookMeaningsForCandidate(candidate).get(revision.meaning.hookId);
    if (meaning === undefined || privateHookMeaningDigest(meaning) !== revision.meaningDigest ||
        !sameBytes(encodePrivateHookMeaning(meaning), encodePrivateHookMeaning(revision.meaning))) {
      corrupt(`Hook ${revision.meaning.hookId} differs from its opening candidate`);
    }
    return loaded;
  } finally { query.finalize(); }
}

function matchingHookRevisionsAtEvent(
  database: SqliteDatabase,
  root: PrivateProjectRoot,
  event: PrivateJournalEvent,
): readonly LoadedHookRevision[] {
  const query = statement<{ readonly revision_digest: string }>(database, [
    "SELECT revision_digest FROM hook_revisions",
    "WHERE start_position <= ?1 AND (end_position IS NULL OR ?1 < end_position)",
    "ORDER BY hook_id, revision_digest",
  ].join(" "));
  let digests: readonly string[];
  try { digests = query.all(event.journalPosition).map(({ revision_digest }) => revision_digest); }
  finally { query.finalize(); }
  const matches = digests.map((digest) => requireHookRevisionByDigest(database, root, digest))
    .filter(({ revision }) =>
      revision.meaning.journalAuthority.source === event.source &&
      revision.meaning.journalAuthority.type === event.type);
  if (matches.length > MAX_HOOK_DERIVATIONS_PER_EVENT) {
    corrupt("stored Journal Event exceeds the Hook fanout bound");
  }
  return Object.freeze(matches);
}

function loadRootJournalHookSelection(
  database: SqliteDatabase,
  root: PrivateProjectRoot,
  parentRun: RootRunRow,
  operationId: string,
  event: PrivateJournalEvent,
): {
  readonly selection: PrivateHookSelectionSet;
  readonly selectionDigest: string;
  readonly revisions: readonly LoadedHookRevision[];
  readonly derivations: readonly HookDerivationRow[];
} {
  const row = requireRootJournalHookSelection(database, parentRun.run_id, operationId);
  requireDigest(row.selection_digest, "stored root Journal Hook selection");
  let selection: PrivateHookSelectionSet;
  try { selection = decodePrivateHookSelectionSet(row.selection_bytes); }
  catch { corrupt("stored root Journal Hook selection is invalid"); }
  const selectionDigest = privateHookSelectionSetDigest(selection);
  if (row.parent_run_id !== parentRun.run_id || row.operation_id !== operationId ||
      selection.eventId !== event.eventId || row.selection_digest !== selectionDigest ||
      !sameBytes(row.selection_bytes, encodePrivateHookSelectionSet(selection))) {
    corrupt("stored root Journal Hook selection differs from its durable identity");
  }
  const expectedRevisions = matchingHookRevisionsAtEvent(database, root, event);
  if (expectedRevisions.length !== selection.entries.length ||
      expectedRevisions.some((revision, index) => {
        const entry = selection.entries[index];
        return entry === undefined || entry.hookId !== revision.revision.meaning.hookId ||
          entry.hookRevisionDigest !== revision.revisionDigest;
      })) {
    corrupt("stored root Journal Hook selection differs from the exact active match set");
  }
  const derivations = readHookDerivationsForEvent(database, event.eventId);
  if (derivations.length !== selection.entries.length) {
    corrupt("stored Hook derivation set differs from its Journal selection");
  }
  const byRevision = new Map(derivations.map((derivation) => [
    derivation.hook_revision_digest,
    derivation,
  ] as const));
  if (byRevision.size !== derivations.length) {
    corrupt("stored Hook derivation set contains duplicate revisions");
  }
  for (const entry of selection.entries) {
    const derivation = byRevision.get(entry.hookRevisionDigest);
    if (derivation === undefined || derivation.event_id !== event.eventId ||
        derivation.run_id !== entry.runId) {
      corrupt(`Hook ${entry.hookId} derivation differs from its Journal selection`);
    }
    byRevision.delete(entry.hookRevisionDigest);
    const hookRevision = expectedRevisions.find(
      ({ revisionDigest }) => revisionDigest === entry.hookRevisionDigest,
    );
    if (hookRevision === undefined) {
      corrupt(`Hook ${entry.hookId} selection revision is not active`);
    }
    if (hookRevision.revision.meaning.hookId !== entry.hookId ||
        hookRevision.revision.startPosition > event.journalPosition ||
        (hookRevision.endPosition !== null && event.journalPosition >= hookRevision.endPosition) ||
        hookRevision.revision.meaning.journalAuthority.source !== event.source ||
        hookRevision.revision.meaning.journalAuthority.type !== event.type) {
      corrupt(`Hook ${entry.hookId} derivation was not active for its Event`);
    }
  }
  if (byRevision.size !== 0) corrupt("stored Hook derivation set contains unselected roots");
  return Object.freeze({
    selection,
    selectionDigest,
    revisions: expectedRevisions,
    derivations,
  });
}

function requireRootJournalClosure(
  database: SqliteDatabase,
  parentRunId: string,
  operationId: string,
): RootJournalClosureRow {
  const query = statement<RootJournalClosureRow>(database, [
    "SELECT parent_run_id, operation_id, closure_digest, closure_bytes",
    "FROM root_journal_closures WHERE parent_run_id = ?1 AND operation_id = ?2",
  ].join(" "));
  try {
    const row = query.get(parentRunId, operationId);
    if (row === null) corrupt("root Journal append has no closure");
    return Object.freeze({
      parent_run_id: row.parent_run_id,
      operation_id: row.operation_id,
      closure_digest: row.closure_digest,
      closure_bytes: copiedBlob(row.closure_bytes, "stored root Journal append closure"),
    });
  } finally { query.finalize(); }
}

interface LoadedRootJournalAppendEvidence {
  readonly parentRequest: PrivateRootRunRequest;
  readonly allocation: PrivateRootJournalAppendAllocation;
  readonly allocationDigest: string;
  readonly event: PrivateJournalEvent;
  readonly eventDigest: string;
  readonly terminal: RunHostEffectResult;
  readonly terminalDigest: string;
  readonly selection: PrivateHookSelectionSet;
  readonly selectionDigest: string;
  readonly revisions: readonly LoadedHookRevision[];
  readonly closureDigest: string;
}

/** Authenticate immutable publisher-Run evidence without traversing Hook ownership. */
function loadImmutableRootParentEvidence(
  database: SqliteDatabase,
  row: RootRunRow,
  root: PrivateProjectRoot,
): { readonly request: PrivateRootRunRequest } {
  requireDigest(row.run_id, "stored Journal publisher Run");
  requireDigest(row.origin_digest, "stored Journal publisher origin");
  requireDigest(row.admission_digest, "stored Journal publisher admission");
  const coordinatorEpoch = safeRevision(row.coordinator_epoch);
  if (row.coordinator_epoch > readCoordinatorEpoch(database)) {
    corrupt("stored Journal publisher names a future coordinator epoch");
  }
  const originBytes = copiedBlob(row.origin_bytes, "stored Journal publisher origin");
  let origin: PrivateRootRunOrigin;
  try { origin = decodePrivateRootRunOrigin(originBytes); }
  catch { corrupt("stored Journal publisher origin is invalid"); }
  if (!sameBytes(originBytes, encodePrivateRootRunOrigin(origin)) ||
      privateRootRunOriginDigest(origin) !== row.origin_digest) {
    corrupt("stored Journal publisher origin differs from its durable identity");
  }
  const requestBytes = copiedBlob(row.request_bytes, "stored Journal publisher request");
  let request: PrivateRootRunRequest;
  try { request = decodePrivateRootRunRequest(requestBytes); }
  catch { corrupt("stored Journal publisher request is invalid"); }
  if (!sameBytes(requestBytes, canonicalJson(request as unknown as JsonValue)) ||
      row.run_id !== privateRootRunIdentityDigest({
        project: {
          device: root.information.dev.toString(),
          inode: root.information.ino.toString(),
        },
        origin,
        requestDigest: privateRootRequestDigest(request),
        coordinatorEpoch,
      })) {
    corrupt("stored Journal publisher request differs from its Run identity");
  }
  const admissionRow = requireAdmissionByDigest(database, row.admission_digest);
  const admission = loadAndCrossCheckAdmission(database, admissionRow, root).admission;
  if (admission.candidateRevision !== safeRevision(row.candidate_revision)) {
    corrupt("stored Journal publisher candidate differs from its admission");
  }
  const candidate = loadCandidateRow(requireCandidateRow(database, row.candidate_revision));
  const target = findPrivateActivationCandidateTargetV5(candidate, request.target);
  const spawnRow = findRootSpawn(database, row.run_id);
  if (spawnRow === null) corrupt("stored Journal publisher has no spawn intent");
  const spawn = loadRootSpawnRow(spawnRow, row);
  if (target === undefined || target.request.mode !== "run" || target.disposition.state !== "ready" ||
      spawn.requestDigest !== target.request.digest ||
      spawn.recipeDigest !== target.disposition.recipeDigest ||
      spawn.observationDigest !== target.disposition.observationDigest ||
      spawn.deadlineUnixMs !== request.deadlineUnixMs) {
    corrupt("stored Journal publisher spawn intent differs from its admitted target");
  }
  return Object.freeze({ request });
}

function requireJournalAppendContiguity(database: SqliteDatabase, position: bigint): void {
  const head = readJournalHead(database).position;
  const summaryQuery = statement<{
    readonly count: bigint;
    readonly first_position: bigint | null;
    readonly last_position: bigint | null;
  }>(database, [
    "SELECT count(*) AS count, min(position) AS first_position, max(position) AS last_position",
    "FROM journal_events",
  ].join(" "));
  let eventSummary: {
    readonly count: bigint;
    readonly first_position: bigint | null;
    readonly last_position: bigint | null;
  } | null;
  try { eventSummary = summaryQuery.get(); }
  finally { summaryQuery.finalize(); }
  if (eventSummary === null) corrupt("Journal Event summary is missing");
  const countRows = (table: string): bigint => {
    const query = statement<{ readonly count: bigint }>(database, `SELECT count(*) AS count FROM ${table}`);
    try {
      const row = query.get();
      if (row === null) corrupt(`Journal ${table} count is missing`);
      return row.count;
    } finally { query.finalize(); }
  };
  const contiguous = head === 0n
    ? eventSummary.count === 0n && eventSummary.first_position === null && eventSummary.last_position === null
    : eventSummary.count === head && eventSummary.first_position === 1n && eventSummary.last_position === head;
  if (!contiguous || position < 1n || position > head ||
      countRows("root_journal_appends") !== head ||
      countRows("root_journal_terminals") !== head ||
      countRows("root_journal_hook_selections") !== head ||
      countRows("root_journal_closures") !== head) {
    corrupt("Journal append evidence is not complete and contiguous through its durable head");
  }
}

/** Authenticate append evidence without loading any derived root snapshot. */
function loadRootJournalAppendEvidence(
  database: SqliteDatabase,
  row: RootJournalAppendRow,
  run: RootRunRow,
  root: PrivateProjectRoot,
): LoadedRootJournalAppendEvidence {
  if (row.parent_run_id !== run.run_id || row.event_position < 1n || row.event_position > MAX_SAFE_REVISION) {
    corrupt("stored root Journal append names invalid parent evidence");
  }
  const parent = loadImmutableRootParentEvidence(database, run, root);
  requireJournalAppendContiguity(database, row.event_position);
  requireDigest(row.allocation_digest, "stored root Journal append allocation");
  const allocationBytes = copiedBlob(row.allocation_bytes, "stored root Journal append allocation");
  let allocation: PrivateRootJournalAppendAllocation;
  try { allocation = decodePrivateRootJournalAppendAllocation(allocationBytes); }
  catch { corrupt("stored root Journal append allocation is invalid"); }
  if (!sameBytes(allocationBytes, encodePrivateRootJournalAppendAllocation(allocation)) ||
      privateRootJournalAppendAllocationDigest(allocation) !== row.allocation_digest ||
      allocation.parentRunId !== run.run_id ||
      allocation.coordinatorEpoch !== safeRevision(run.coordinator_epoch) ||
      allocation.call.operationId !== row.operation_id) {
    corrupt("stored root Journal append allocation differs from its durable identity");
  }
  try { requireRootJournalAppendCandidate(database, run, allocation); }
  catch { corrupt("stored root Journal append exceeds its pinned publisher authority"); }

  const eventRow = requireJournalEvent(database, row.event_position);
  requireDigest(eventRow.event_id, "stored Journal Event ID");
  requireDigest(eventRow.event_digest, "stored Journal Event");
  let decodedEvent: JsonValue;
  try { decodedEvent = decodeJson1(eventRow.event_bytes); }
  catch { corrupt("stored Journal Event is invalid"); }
  if (decodedEvent === null || typeof decodedEvent !== "object" || Array.isArray(decodedEvent) ||
      typeof (decodedEvent as Readonly<Record<string, JsonValue>>).committedAtUnixMs !== "number") {
    corrupt("stored Journal Event has no valid commit time");
  }
  const eventObject = decodedEvent as Readonly<Record<string, JsonValue>>;
  let event: PrivateJournalEvent;
  try {
    event = createPrivateJournalEvent({
      allocation,
      journalPosition: safeRevision(eventRow.position),
      committedAtUnixMs: eventObject.committedAtUnixMs as number,
    });
  } catch { corrupt("stored Journal Event cannot be reproduced from its allocation"); }
  if (eventRow.position !== row.event_position || eventRow.event_id !== event.eventId ||
      eventRow.event_digest !== privateJournalEventDigest(event) ||
      !sameBytes(eventRow.event_bytes, canonicalJson(event as unknown as JsonValue))) {
    corrupt("stored Journal Event differs from its durable identity");
  }

  const terminal: RunHostEffectResult = Object.freeze({ value: event as unknown as JsonValue });
  const terminalRow = requireRootJournalTerminal(database, run.run_id, row.operation_id);
  const terminalDigest = privateRootJournalEffectTerminalDigest(terminal);
  if (terminalRow.parent_run_id !== run.run_id || terminalRow.operation_id !== row.operation_id ||
      terminalRow.terminal_digest !== terminalDigest ||
      !sameBytes(terminalRow.terminal_bytes, canonicalJson(terminal as unknown as JsonValue))) {
    corrupt("stored root Journal effect terminal differs from its durable identity");
  }
  const selected = loadRootJournalHookSelection(database, root, run, row.operation_id, event);
  const hookSelectionDigest = selected.selectionDigest;
  const closure = normalizePrivateRootJournalAppendClosure({
    kind: "private-root-journal-append-closure/1",
    parentRunId: run.run_id,
    allocationDigest: row.allocation_digest,
    eventDigest: eventRow.event_digest,
    terminalDigest,
    hookSelectionDigest,
  });
  const closureRow = requireRootJournalClosure(database, run.run_id, row.operation_id);
  const closureDigest = privateRootJournalAppendClosureDigest(closure);
  if (closureRow.parent_run_id !== run.run_id || closureRow.operation_id !== row.operation_id ||
      closureRow.closure_digest !== closureDigest ||
      !sameBytes(closureRow.closure_bytes, canonicalJson(closure as unknown as JsonValue))) {
    corrupt("stored root Journal append closure differs from its durable identity");
  }
  return Object.freeze({
    parentRequest: parent.request,
    allocation,
    allocationDigest: row.allocation_digest,
    event,
    eventDigest: eventRow.event_digest,
    terminal,
    terminalDigest,
    selection: selected.selection,
    selectionDigest: hookSelectionDigest,
    revisions: selected.revisions,
    closureDigest,
  });
}

function loadRootJournalAppendReceipt(
  database: SqliteDatabase,
  row: RootJournalAppendRow,
  run: RootRunRow,
  root: PrivateProjectRoot,
): PrivateRootJournalAppendReceipt {
  const evidence = loadRootJournalAppendEvidence(database, row, run, root);
  const derivedRuns = evidence.selection.entries.map((entry) => {
    const derived = loadRootRunSnapshot(database, requireRootRunRow(database, entry.runId), root);
    if (derived.origin.kind !== "private-root-hook-derived-origin/1" ||
        derived.origin.hookRevisionDigest !== entry.hookRevisionDigest ||
        derived.origin.eventId !== evidence.event.eventId) {
      corrupt(`Hook ${entry.hookId} derived Run differs from its exact selection`);
    }
    return derived;
  });
  return Object.freeze({
    allocation: evidence.allocation,
    allocationDigest: evidence.allocationDigest,
    event: evidence.event,
    eventDigest: evidence.eventDigest,
    terminal: evidence.terminal,
    terminalDigest: evidence.terminalDigest,
    hookSelection: evidence.selection,
    hookSelectionDigest: evidence.selectionDigest,
    derivedRuns: Object.freeze(derivedRuns),
    closureDigest: evidence.closureDigest,
  });
}

function requireRootJournalAppendCandidate(
  database: SqliteDatabase,
  run: RootRunRow,
  allocation: PrivateRootJournalAppendAllocation,
): void {
  if (allocation.parentRunId !== run.run_id ||
      allocation.coordinatorEpoch !== safeRevision(run.coordinator_epoch)) {
    corrupt("root Journal append allocation differs from its parent Run");
  }
  const request = decodePrivateRootRunRequest(run.request_bytes);
  const candidate = loadCandidateRow(requireCandidateRow(database, run.candidate_revision));
  const parent = findPrivateActivationCandidateTargetV5(candidate, request.target);
  const slot = parent?.request.slots[allocation.call.slot];
  if (parent === undefined || slot?.kind !== "capability" ||
      slot.provider.binding !== allocation.publisherBinding || slot.provider.export !== "journal") {
    invalid("UNAVAILABLE", "root Journal effect slot does not select the admitted publisher");
  }
  const publisher = candidate.lock.journalPublishers[allocation.publisherBinding];
  if (publisher === undefined || publisher.source !== `binding:${allocation.publisherBinding}` ||
      publisher.eventTypes.length !== allocation.eventTypes.length ||
      publisher.eventTypes.some((value, index) => value !== allocation.eventTypes[index])) {
    invalid("UNAVAILABLE", "root Journal publisher authority differs from the admitted generation");
  }
}

function findRootFlowCall(database: SqliteDatabase, parentRunId: string): RootFlowCallRow | null {
  const query = statement<RootFlowCallRow>(database, [
    "SELECT parent_run_id, allocation_digest, allocation_bytes",
    "FROM root_flow_calls WHERE parent_run_id = ?1",
  ].join(" "));
  try {
    const row = query.get(parentRunId);
    return row === null ? null : Object.freeze({
      parent_run_id: row.parent_run_id,
      allocation_digest: row.allocation_digest,
      allocation_bytes: copiedBlob(row.allocation_bytes, "stored root Flow call allocation"),
    });
  } finally { query.finalize(); }
}

function requireRootFlowCall(database: SqliteDatabase, parentRunId: string): RootFlowCallRow {
  const row = findRootFlowCall(database, parentRunId);
  if (row === null) corrupt("root Run has no allocated child Flow call");
  return row;
}

function findRootFlowCallFact(
  database: SqliteDatabase,
  parentRunId: string,
  checkpoint: PrivateRootFlowCallCheckpointName,
): RootFlowCallFactRow | null {
  const query = statement<RootFlowCallFactRow>(database, [
    "SELECT parent_run_id, fact_name, fact_digest, fact_bytes",
    "FROM root_flow_call_facts WHERE parent_run_id = ?1 AND fact_name = ?2",
  ].join(" "));
  try {
    const row = query.get(parentRunId, checkpoint);
    return row === null ? null : Object.freeze({
      parent_run_id: row.parent_run_id,
      fact_name: row.fact_name,
      fact_digest: row.fact_digest,
      fact_bytes: copiedBlob(row.fact_bytes, `stored root Flow call ${checkpoint}`),
    });
  } finally { query.finalize(); }
}

function requireRootFlowCallFact(
  database: SqliteDatabase,
  parentRunId: string,
  checkpoint: PrivateRootFlowCallCheckpointName,
): RootFlowCallFactRow {
  const row = findRootFlowCallFact(database, parentRunId, checkpoint);
  if (row === null) corrupt(`root Flow call has no ${checkpoint} fact`);
  return row;
}

function findRootFlowCallClosure(
  database: SqliteDatabase,
  parentRunId: string,
): RootFlowCallClosureRow | null {
  const query = statement<RootFlowCallClosureRow>(database, [
    "SELECT parent_run_id, closure_digest, closure_bytes",
    "FROM root_flow_call_closures WHERE parent_run_id = ?1",
  ].join(" "));
  try {
    const row = query.get(parentRunId);
    return row === null ? null : Object.freeze({
      parent_run_id: row.parent_run_id,
      closure_digest: row.closure_digest,
      closure_bytes: copiedBlob(row.closure_bytes, "stored root Flow call closure"),
    });
  } finally { query.finalize(); }
}

function loadRootFlowCallLifecycle(
  database: SqliteDatabase,
  row: RootFlowCallRow,
  run: RootRunRow,
): PrivateRootFlowCallLifecycle {
  if (row.parent_run_id !== run.run_id) corrupt("stored root Flow call names a different parent Run");
  requireDigest(row.allocation_digest, "stored root Flow call allocation");
  const allocationBytes = copiedBlob(row.allocation_bytes, "stored root Flow call allocation");
  let allocation: PrivateRootFlowCallAllocation;
  try { allocation = decodePrivateRootFlowCallAllocation(allocationBytes); }
  catch { corrupt("stored root Flow call allocation is invalid"); }
  if (privateRootFlowCallAllocationDigest(allocation) !== row.allocation_digest ||
      allocation.parentRunId !== run.run_id ||
      allocation.coordinatorEpoch !== safeRevision(run.coordinator_epoch)) {
    corrupt("stored root Flow call allocation differs from its durable identity");
  }
  const result: PrivateRootFlowCallLifecycle = {
    allocation,
    allocationDigest: row.allocation_digest,
  };
  const query = statement<RootFlowCallFactRow>(database, [
    "SELECT parent_run_id, fact_name, fact_digest, fact_bytes",
    "FROM root_flow_call_facts WHERE parent_run_id = ?1 ORDER BY fact_name",
  ].join(" "));
  let facts: readonly RootFlowCallFactRow[];
  try { facts = query.all(run.run_id); }
  finally { query.finalize(); }
  for (const raw of facts) {
    let checkpoint: PrivateRootFlowCallCheckpointName;
    try { checkpoint = requirePrivateRootFlowCallCheckpointName(raw.fact_name); }
    catch { corrupt("stored root Flow call fact name is invalid"); }
    requireDigest(raw.fact_digest, `stored root Flow call ${checkpoint}`);
    const bytes = copiedBlob(raw.fact_bytes, `stored root Flow call ${checkpoint}`);
    let envelope: ReturnType<typeof normalizePrivateRootFlowCallCheckpoint>;
    try { envelope = normalizePrivateRootFlowCallCheckpoint(decodeJson1(bytes), checkpoint); }
    catch { corrupt(`stored root Flow call ${checkpoint} fact is invalid`); }
    if (!sameBytes(bytes, canonicalJson(envelope as unknown as JsonValue)) ||
        privateRootFlowCallCheckpointDigest(checkpoint, envelope) !== raw.fact_digest ||
        envelope.parentRunId !== run.run_id ||
        envelope.allocationDigest !== row.allocation_digest) {
      corrupt(`stored root Flow call ${checkpoint} fact differs from its durable identity`);
    }
    (result as unknown as Record<string, unknown>)[checkpoint] = Object.freeze({
      digest: raw.fact_digest,
      value: envelope.value,
    } satisfies PrivateRootFlowCallFact);
  }
  validateRootFlowCallLifecycle(result);
  const closureRow = findRootFlowCallClosure(database, run.run_id);
  if (closureRow === null) return Object.freeze(result);
  requireRootFlowCallClosable(result);
  requireDigest(closureRow.closure_digest, "stored root Flow call closure");
  let closure: ReturnType<typeof normalizePrivateRootFlowCallClosure>;
  try { closure = normalizePrivateRootFlowCallClosure(decodeJson1(closureRow.closure_bytes)); }
  catch { corrupt("stored root Flow call closure is invalid"); }
  if (!sameBytes(closureRow.closure_bytes, canonicalJson(closure as unknown as JsonValue)) ||
      privateRootFlowCallClosureDigest(closure) !== closureRow.closure_digest ||
      closure.parentRunId !== run.run_id ||
      closure.allocationDigest !== result.allocationDigest ||
      closure.provisionalDigest !== result.provisional!.digest ||
      closure.fenceDigest !== (result.fence?.digest ?? null) ||
      closure.releaseDigest !== result.release!.digest ||
      closure.admittedDigest !== result.admitted!.digest) {
    corrupt("stored root Flow call closure differs from its durable evidence");
  }
  return Object.freeze({ ...result, closureDigest: closureRow.closure_digest });
}

function requireRootFlowCallAllocationCandidate(
  database: SqliteDatabase,
  run: RootRunRow,
  allocation: PrivateRootFlowCallAllocation,
): void {
  if (allocation.parentRunId !== run.run_id ||
      allocation.coordinatorEpoch !== safeRevision(run.coordinator_epoch)) {
    corrupt("root Flow call allocation differs from its parent Run");
  }
  const request = decodePrivateRootRunRequest(run.request_bytes);
  if (allocation.effectiveDeadlineUnixMs > request.deadlineUnixMs) {
    invalid("RUN_DEADLINE_INVALID", "child Flow deadline exceeds its parent root Run deadline");
  }
  const candidate = loadCandidateRow(requireCandidateRow(database, run.candidate_revision));
  const parent = findPrivateActivationCandidateTargetV5(candidate, request.target);
  const child = findPrivateActivationCandidateTargetV5(candidate, allocation.target);
  if (parent === undefined || child === undefined || child.disposition.state !== "ready") {
    corrupt("root Flow call allocation is absent from its pinned candidate");
  }
  const slot = parent.request.slots[allocation.call.slot];
  if (slot?.kind !== "flow-call" || slot.targets.length !== 1 ||
      privateActivationTargetKey(slot.targets[0]!) !== privateActivationTargetKey(allocation.target)) {
    invalid("UNAVAILABLE", "root Flow call slot does not select the admitted child target");
  }
  if (allocation.target.kind !== "flow" ||
      allocation.requestDigest !== child.request.digest ||
      allocation.recipeDigest !== child.disposition.recipeDigest ||
      allocation.observationDigest !== child.disposition.observationDigest) {
    corrupt("root Flow call allocation differs from its admitted child recipe");
  }
}

function requireRootFlowCallCheckpointAuthority(
  run: PrivateRootRunSnapshot,
  coordinator: PrivateProjectCoordinator,
  checkpoint: PrivateRootFlowCallCheckpointName,
): void {
  if (run.coordinatorEpoch === coordinator.epoch) return;
  if (checkpoint === "provisional" || checkpoint === "fence" ||
      checkpoint === "release" || checkpoint === "admitted") return;
  invalid("RUN_COORDINATOR_STALE", `replacement coordinator cannot create child Flow ${checkpoint} work`);
}

function requireRootFlowCallCheckpointOrder(
  before: PrivateRootFlowCallLifecycle,
  checkpoint: PrivateRootFlowCallCheckpointName,
): void {
  if (before.closureDigest !== undefined) invalid("RUN_ALREADY_TERMINAL", "root Flow call is already closed");
  const has = (name: PrivateRootFlowCallCheckpointName): boolean => before[name] !== undefined;
  if (checkpoint === "plan") {
    if (has("provisional") || has("release") || has("admitted")) orderError(checkpoint);
    return;
  }
  if (checkpoint === "backing") {
    if (!has("plan") || has("provisional") || has("release") || has("admitted")) orderError(checkpoint);
    return;
  }
  if (checkpoint === "sandbox") {
    if (!has("backing") || has("provisional") || has("release") || has("admitted")) orderError(checkpoint);
    return;
  }
  if (checkpoint === "prepared") {
    if (!has("sandbox") || has("provisional") || has("release") || has("admitted")) orderError(checkpoint);
    return;
  }
  if (checkpoint === "provisional") {
    if (has("release") || has("admitted")) orderError(checkpoint);
    return;
  }
  if (checkpoint === "fence") {
    if (!has("sandbox") || has("release") || has("admitted")) orderError(checkpoint);
    return;
  }
  if (checkpoint === "release") {
    if (!has("provisional") || has("admitted") || (has("sandbox") && !has("fence"))) orderError(checkpoint);
    return;
  }
  if (!has("provisional") || !has("release")) orderError(checkpoint);
}

function validateRootFlowCallLifecycle(lifecycle: PrivateRootFlowCallLifecycle): void {
  const ordered: readonly PrivateRootFlowCallCheckpointName[] = [
    "plan", "backing", "sandbox", "prepared", "provisional", "fence", "release", "admitted",
  ];
  const replay: PrivateRootFlowCallLifecycle = {
    allocation: lifecycle.allocation,
    allocationDigest: lifecycle.allocationDigest,
  };
  for (const checkpoint of ordered) {
    const fact = lifecycle[checkpoint];
    if (fact === undefined) continue;
    requireRootFlowCallCheckpointOrder(replay, checkpoint);
    (replay as unknown as Record<string, unknown>)[checkpoint] = fact;
  }
}

function requireRootFlowCallClosable(lifecycle: PrivateRootFlowCallLifecycle): void {
  if (lifecycle.provisional === undefined || lifecycle.release === undefined ||
      lifecycle.admitted === undefined ||
      (lifecycle.sandbox !== undefined && lifecycle.fence === undefined)) {
    invalid("RUN_EXECUTION_INCOMPLETE", "root Flow call cannot close before terminal admission and release");
  }
}

function orderError(checkpoint: PrivateRootFlowCallCheckpointName): never {
  invalid("RUN_EXECUTION_CHECKPOINT_ORDER", `root Flow call ${checkpoint} checkpoint is out of order`);
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
    origin_digest: row.origin_digest,
    origin_bytes: copiedBlob(row.origin_bytes, "stored root Run origin"),
    admission_digest: row.admission_digest,
    candidate_revision: row.candidate_revision,
    coordinator_epoch: row.coordinator_epoch,
    request_bytes: copiedBlob(row.request_bytes, "stored root Run request"),
  });
}

function requireRootHookDerivation(
  database: SqliteDatabase,
  root: PrivateProjectRoot,
  run: RootRunRow,
  origin: PrivateRootRunOrigin,
  request: PrivateRootRunRequest,
): void {
  const query = statement<HookDerivationRow>(database, [
    "SELECT hook_revision_digest, event_id, run_id FROM hook_derivations WHERE run_id = ?1",
  ].join(" "));
  let rows: readonly HookDerivationRow[];
  try { rows = query.all(run.run_id).map((row) => Object.freeze({ ...row })); }
  finally { query.finalize(); }
  if (origin.kind === "private-root-hook-derived-origin/1") {
    if (rows.length !== 1 || rows[0]!.run_id !== run.run_id ||
        rows[0]!.hook_revision_digest !== origin.hookRevisionDigest ||
        rows[0]!.event_id !== origin.eventId) {
      corrupt("Hook-derived root Run lacks its exact committed derivation");
    }
    const eventQuery = statement<JournalEventRow>(database, [
      "SELECT position, event_id, event_digest, event_bytes FROM journal_events",
      "WHERE event_id = ?1",
    ].join(" "));
    let eventRows: readonly JournalEventRow[];
    try {
      eventRows = eventQuery.all(origin.eventId).map((row) => Object.freeze({
        position: row.position,
        event_id: row.event_id,
        event_digest: row.event_digest,
        event_bytes: copiedBlob(row.event_bytes, "stored Hook-derived Journal Event"),
      }));
    } finally { eventQuery.finalize(); }
    if (eventRows.length !== 1) {
      corrupt("Hook-derived root Run has no unique Journal Event");
    }
    const append = requireRootJournalAppendByEventPosition(database, eventRows[0]!.position);
    const parent = requireRootRunRow(database, append.parent_run_id);
    const evidence = loadRootJournalAppendEvidence(database, append, parent, root);
    const selectedIndex = evidence.selection.entries.findIndex((entry) =>
      entry.runId === run.run_id && entry.hookRevisionDigest === origin.hookRevisionDigest
    );
    if (evidence.event.eventId !== origin.eventId || selectedIndex < 0 ||
        evidence.selection.entries.filter((entry) => entry.runId === run.run_id).length !== 1) {
      corrupt("Hook-derived root Run is outside its committed Journal selection");
    }
    const revision = evidence.revisions[selectedIndex];
    if (revision === undefined || revision.revisionDigest !== origin.hookRevisionDigest ||
        run.admission_digest !== revision.revision.openingAdmissionDigest ||
        run.candidate_revision !== BigInt(revision.revision.openingCandidateRevision) ||
        run.coordinator_epoch !== parent.coordinator_epoch) {
      corrupt("Hook-derived root Run differs from its selected Hook revision");
    }
    if (request.deadlineUnixMs !== evidence.parentRequest.deadlineUnixMs ||
        !sameBytes(canonicalJson(request.target as unknown as JsonValue), canonicalJson(
          revision.revision.meaning.target.identity as unknown as JsonValue,
        )) ||
        !sameBytes(canonicalJson(request.input), canonicalJson(evidence.event as unknown as JsonValue))) {
      corrupt("Hook-derived root Run request differs from its selected Event and target");
    }
  } else if (rows.length !== 0) {
    corrupt("external root Run is named by a Hook derivation");
  }
}

function loadRootRunSnapshot(
  database: SqliteDatabase,
  row: RootRunRow,
  root: PrivateProjectRoot,
): PrivateRootRunSnapshot {
  requireDigest(row.run_id, "stored root Run");
  requireDigest(row.origin_digest, "stored root Run origin");
  requireDigest(row.admission_digest, "stored root admission");
  const coordinatorEpoch = safeRevision(row.coordinator_epoch);
  if (row.coordinator_epoch > readCoordinatorEpoch(database)) {
    corrupt("stored root Run names a future coordinator epoch");
  }
  const originBytes = copiedBlob(row.origin_bytes, "stored root Run origin");
  let origin: PrivateRootRunOrigin;
  try { origin = decodePrivateRootRunOrigin(originBytes); }
  catch { corrupt("stored root Run origin is invalid"); }
  if (!sameBytes(originBytes, encodePrivateRootRunOrigin(origin)) ||
      privateRootRunOriginDigest(origin) !== row.origin_digest) {
    corrupt("stored root Run origin differs from its durable identity");
  }
  let request: PrivateRootRunRequest;
  try { request = decodePrivateRootRunRequest(copiedBlob(row.request_bytes, "stored root Run request")); }
  catch { corrupt("stored root Run request is invalid"); }
  const expectedRunId = privateRootRunIdentityDigest({
    project: {
      device: root.information.dev.toString(),
      inode: root.information.ino.toString(),
    },
    origin,
    requestDigest: privateRootRequestDigest(request),
    coordinatorEpoch,
  });
  if (row.run_id !== expectedRunId) corrupt("stored root Run ID differs from its origin identity");
  const admissionRow = requireAdmissionByDigest(database, row.admission_digest);
  const admission = loadAndCrossCheckAdmission(database, admissionRow, root);
  const candidateRevision = safeRevision(row.candidate_revision);
  if (admission.admission.candidateRevision !== candidateRevision) {
    corrupt("stored root Run candidate differs from its pinned admission");
  }
  requireRootHookDerivation(database, root, row, origin, request);
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
    origin,
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

function requireSameExternalSubmission(run: PrivateRootRunSnapshot, submissionDigest: string): void {
  if (run.origin.kind !== "private-root-external-submission-origin/1") {
    invalid("SUBMISSION_CONFLICT", "root submission ID collides with a non-submission Run origin");
  }
  const durableRequest = createPrivateRootRunRequest({
    target: run.target,
    input: run.input,
    deadlineUnixMs: run.deadlineUnixMs,
  });
  if (privateRootSubmissionDigest(durableRequest) !== submissionDigest) {
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
    "SELECT root_runs.run_id, root_runs.origin_digest, root_runs.origin_bytes,",
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
  if (launch.run.runId !== run.runId ||
      privateRootRunOriginDigest(launch.run.origin) !== privateRootRunOriginDigest(run.origin)) {
    invalid("RUN_LAUNCH_CONFLICT", "root Run launch does not match durable origin state");
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
    const databaseExists = await pathExists(databasePath);
    const alternates = (await readdir(descriptorChild(directory, "")))
      .filter((name) => ADMISSION_DATABASE_FAMILY.test(name))
      .filter((name) => name !== DATABASE_NAME)
      .filter((name) => !databaseExists || !CURRENT_DATABASE_SIDECARS.has(name))
      .sort();
    if (alternates.length !== 0) {
      invalid(
        "ADMISSION_SCHEMA_VERSION",
        `${alternates[0]} is an unsupported private admission format`,
      );
    }
    const databaseInformation = await ensureDatabaseFile(
      databasePath,
      directory,
      directoryInformation.dev,
      create && !databaseExists,
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
      database.exec(CREATE_LOCK_REPAIRS);
      database.exec(CREATE_ADMISSIONS);
      database.exec(CREATE_ADMISSION_HEAD);
      database.exec(CREATE_COORDINATOR_HEAD);
      database.exec(CREATE_ROOT_RUNS);
      database.exec(CREATE_ROOT_SPAWN_INTENTS);
      database.exec(CREATE_ROOT_EXECUTION_LIFECYCLES);
      database.exec(CREATE_ROOT_EXECUTION_CLOSURES);
      database.exec(CREATE_ROOT_FLOW_CALLS);
      database.exec(CREATE_ROOT_FLOW_CALL_FACTS);
      database.exec(CREATE_ROOT_FLOW_CALL_CLOSURES);
      database.exec(CREATE_JOURNAL_HEAD);
      database.exec(CREATE_JOURNAL_EVENTS);
      database.exec(CREATE_HOOK_ADMISSION_BOUNDARIES);
      database.exec(CREATE_HOOK_REVISIONS);
      database.exec(CREATE_HOOK_REVISIONS_ONE_OPEN);
      database.exec(CREATE_HOOK_DERIVATIONS);
      database.exec(CREATE_ROOT_JOURNAL_APPENDS);
      database.exec(CREATE_ROOT_JOURNAL_TERMINALS);
      database.exec(CREATE_ROOT_JOURNAL_HOOK_SELECTIONS);
      database.exec(CREATE_ROOT_JOURNAL_CLOSURES);
      database.exec(CREATE_ROOT_TERMINALS);
      database.exec(CREATE_SERVICE_MOUNTS);
      database.exec(CREATE_SERVICE_MOUNT_FACTS);
      database.exec(CREATE_SERVICE_LEASES);
      database.exec(CREATE_SERVICE_INVOCATIONS);
      database.exec("INSERT INTO candidate_head(singleton, revision) VALUES (1, NULL)");
      database.exec("INSERT INTO admission_head(singleton, revision) VALUES (1, NULL)");
      database.exec("INSERT INTO coordinator_head(singleton, epoch) VALUES (1, 0)");
      database.exec("INSERT INTO journal_head(singleton, position) VALUES (1, 0)");
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
  })) corrupt("private admission database schema differs from version 17");
  if (statement<Record<string, unknown>>(database, "PRAGMA foreign_key_check").all().length !== 0) {
    corrupt("private admission database has broken foreign keys");
  }
  readCandidateHead(database, root);
  readAdmissionHead(database, root);
  readCoordinatorEpoch(database);
  readJournalHead(database);
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
    readAndCrossCheckPrivateHookRevisions(database, root, head);
    return head;
  }
  if (
    head.revision === null || count.minimum !== 1n || count.maximum !== head.revision ||
    count.count !== head.revision || count.roots !== 1n || head.revision > MAX_SAFE_REVISION
  ) corrupt("admission revisions are not one contiguous linear head");
  readAndCrossCheckPrivateHookRevisions(database, root, head);
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

function readJournalHead(database: SqliteDatabase): JournalHeadRow {
  const headQuery = statement<JournalHeadRow>(database, "SELECT singleton, position FROM journal_head");
  let rows: readonly JournalHeadRow[];
  try { rows = headQuery.all(); }
  finally { headQuery.finalize(); }
  if (rows.length !== 1 || rows[0]!.singleton !== 1n || rows[0]!.position < 0n ||
      rows[0]!.position > MAX_SAFE_REVISION) {
    corrupt("Journal head singleton is invalid");
  }
  const head = rows[0]!;
  const aggregateQuery = statement<CandidateCountRow>(database,
    "SELECT count(*) AS count, min(position) AS minimum, max(position) AS maximum FROM journal_events",
  );
  let aggregate: CandidateCountRow | null;
  try { aggregate = aggregateQuery.get(); }
  finally { aggregateQuery.finalize(); }
  if (aggregate === null) corrupt("Journal position aggregate is invalid");
  if (head.position === 0n) {
    if (aggregate.count !== 0n || aggregate.minimum !== null || aggregate.maximum !== null) {
      corrupt("empty Journal has persisted Events");
    }
  } else if (aggregate.count !== head.position || aggregate.minimum !== 1n ||
      aggregate.maximum !== head.position) {
    corrupt("Journal positions are not one contiguous monotonic head");
  }
  return head;
}

function privateHookMeaningsForCandidate(
  candidate: PrivateActivationCandidateArtifactV5,
): ReadonlyMap<string, PrivateHookMeaning> {
  const meanings = new Map<string, PrivateHookMeaning>();
  for (const [hookId, hook] of Object.entries(candidate.lock.hooks)) {
    const publisher = candidate.lock.journalPublishers[hook.publisherBinding];
    if (publisher === undefined || publisher.source !== hook.source ||
        !publisher.eventTypes.includes(hook.type)) {
      corrupt(`Hook ${hookId} is not authorized by its pinned Journal publisher`);
    }
    const target = findPrivateActivationCandidateTargetV5(candidate, hook.target);
    if (target === undefined) {
      corrupt(`Hook ${hookId} target is absent from its pinned candidate`);
    }
    if (target.request.mode !== "run") {
      corrupt(`Hook ${hookId} target is not a Run activation`);
    }
    const meaning = normalizePrivateHookMeaning({
      kind: "private-hook-meaning/1",
      hookId,
      relationDigest: hook.relationDigest,
      journalAuthority: {
        publisherBinding: hook.publisherBinding,
        source: publisher.source,
        contract: publisher.contract,
        type: hook.type,
      },
      target: {
        identity: hook.target,
        requestDigest: target.request.digest,
        dispositionDigest: privateHookTargetDispositionDigest(target.disposition),
      },
    });
    meanings.set(hookId, meaning);
  }
  return meanings;
}

function preparePrivateHookAdmissionTransition(
  database: SqliteDatabase,
  input: {
    readonly root: PrivateProjectRoot;
    readonly baseGeneration: string | null;
    readonly planDigest: string;
    readonly candidateRevision: number;
    readonly candidateDigest: string;
    readonly lockDigest: string;
    readonly candidate: PrivateActivationCandidateArtifactV5;
  },
): PreparedHookAdmissionTransition {
  const journal = readJournalHead(database);
  const desired = new Map(privateHookMeaningsForCandidate(input.candidate));
  const current = requireOpenPrivateHookRevisions(database);
  const preserved = new Set<string>();

  for (const [hookId, opened] of current) {
    const next = desired.get(hookId);
    if (next !== undefined && privateHookMeaningDigest(next) === opened.revision.meaningDigest &&
        sameBytes(encodePrivateHookMeaning(next), encodePrivateHookMeaning(opened.revision.meaning))) {
      desired.delete(hookId);
      preserved.add(hookId);
    }
  }
  const closes = [...current.entries()].filter(([hookId]) => !preserved.has(hookId));
  const changed = closes.length !== 0 || desired.size !== 0;
  let boundaryPosition: number | null;
  try { boundaryPosition = privateHookAdmissionBoundaryPosition(journal.position, changed); }
  catch (error) {
    if (error instanceof RangeError) {
      invalid("RESOURCE_EXHAUSTED", "Journal position space is exhausted");
    }
    throw error;
  }
  const observedJournalEventDigest = journal.position === 0n
    ? null
    : requireCanonicalJournalEventDigest(database, input.root, journal.position);
  const boundary = normalizePrivateHookAdmissionBoundary({
    kind: "private-hook-admission-boundary/1",
    baseGeneration: input.baseGeneration,
    planDigest: input.planDigest,
    candidateRevision: input.candidateRevision,
    candidateDigest: input.candidateDigest,
    lockDigest: input.lockDigest,
    observedJournalPosition: Number(journal.position),
    observedJournalEventDigest,
    boundaryPosition,
  });
  const boundaryBytes = encodePrivateHookAdmissionBoundary(boundary);
  requireStoredSize(boundaryBytes, "Hook admission boundary");
  return Object.freeze({
    boundary,
    boundaryDigest: privateHookAdmissionBoundaryDigest(boundary),
    boundaryBytes,
    closes: Object.freeze(closes.map(([, opened]) => opened)),
    opens: desired,
  });
}

function persistPrivateHookAdmissionTransition(
  database: SqliteDatabase,
  admissionDigest: string,
  transition: PreparedHookAdmissionTransition,
): void {
  runFinalized(database, [
    "INSERT INTO hook_admission_boundaries(",
    "admission_digest, boundary_digest, boundary_bytes",
    ") VALUES (?1, ?2, ?3)",
  ].join(" "), [admissionDigest, transition.boundaryDigest, transition.boundaryBytes]);

  const boundary = transition.boundary.boundaryPosition;
  if (boundary === null) {
    if (transition.closes.length !== 0 || transition.opens.size !== 0) {
      corrupt("null Hook admission boundary carries a transition");
    }
    return;
  }

  for (const opened of transition.closes) {
    const changed = runFinalized(database,
      "UPDATE hook_revisions SET closing_admission_digest = ?1, end_position = ?2 WHERE revision_digest = ?3 AND closing_admission_digest IS NULL AND end_position IS NULL",
      [admissionDigest, boundary, opened.revisionDigest],
    ).changes;
    if (changed !== 1) corrupt(`open Hook revision ${opened.revisionDigest} was not closed exactly once`);
  }

  for (const [hookId, meaning] of transition.opens) {
    const revision = normalizePrivateHookRevision({
      kind: "private-hook-revision/1",
      meaning,
      meaningDigest: privateHookMeaningDigest(meaning),
      openingAdmissionDigest: admissionDigest,
      openingCandidateRevision: transition.boundary.candidateRevision,
      openingCandidateDigest: transition.boundary.candidateDigest,
      startPosition: boundary,
    });
    const revisionDigest = privateHookRevisionDigest(revision);
    const revisionBytes = encodePrivateHookRevision(revision);
    requireStoredSize(revisionBytes, `Hook ${hookId} revision`);
    runFinalized(database, [
      "INSERT INTO hook_revisions(",
      "revision_digest, hook_id, meaning_digest, opening_admission_digest,",
      "opening_candidate_revision, start_position, closing_admission_digest, end_position, revision_bytes",
      ") VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7)",
    ].join(" "), [
      revisionDigest,
      hookId,
      revision.meaningDigest,
      admissionDigest,
      transition.boundary.candidateRevision,
      boundary,
      revisionBytes,
    ]);
  }
}

function requireOpenPrivateHookRevisions(
  database: SqliteDatabase,
): Map<string, LoadedHookRevision> {
  const query = statement<HookRevisionRow>(database, [
    "SELECT revision_digest, hook_id, meaning_digest, opening_admission_digest,",
    "opening_candidate_revision, start_position, closing_admission_digest, end_position, revision_bytes",
    "FROM hook_revisions WHERE end_position IS NULL ORDER BY hook_id",
  ].join(" "));
  let rows: readonly HookRevisionRow[];
  try { rows = query.all().map(copiedHookRevisionRow); }
  finally { query.finalize(); }
  const opened = new Map<string, LoadedHookRevision>();
  for (const row of rows) {
    const loaded = decodeAndCrossCheckHookRevisionRow(database, row);
    if (opened.has(loaded.revision.meaning.hookId)) {
      corrupt(`Hook ${loaded.revision.meaning.hookId} has multiple open revisions`);
    }
    opened.set(loaded.revision.meaning.hookId, loaded);
  }
  return opened;
}

function readPrivateHookAdmissionBoundaryRows(
  database: SqliteDatabase,
): Map<string, HookAdmissionBoundaryRow> {
  const query = statement<HookAdmissionBoundaryRow>(database, [
    "SELECT admission_digest, boundary_digest, boundary_bytes",
    "FROM hook_admission_boundaries ORDER BY admission_digest",
  ].join(" "));
  let rows: readonly HookAdmissionBoundaryRow[];
  try {
    rows = query.all().map((row) => Object.freeze({
      admission_digest: row.admission_digest,
      boundary_digest: row.boundary_digest,
      boundary_bytes: copiedBlob(row.boundary_bytes, "stored Hook admission boundary"),
    }));
  } finally { query.finalize(); }
  return new Map(rows.map((row) => [row.admission_digest, row] as const));
}

function decodeAndCrossCheckHookAdmissionBoundaryRow(
  database: SqliteDatabase,
  root: PrivateProjectRoot,
  row: HookAdmissionBoundaryRow,
  admission: PrivateActivationAdmission,
): PrivateHookAdmissionBoundary {
  requireStoredSize(row.boundary_bytes, "stored Hook admission boundary");
  const boundary = decodePrivateHookAdmissionBoundary(row.boundary_bytes);
  const digest = privateHookAdmissionBoundaryDigest(boundary);
  if (row.boundary_digest !== digest || admission.hookBoundaryDigest !== digest ||
      boundary.baseGeneration !== admission.baseGeneration ||
      boundary.planDigest !== admission.planDigest ||
      boundary.candidateRevision !== admission.candidateRevision ||
      boundary.candidateDigest !== admission.candidateDigest ||
      boundary.lockDigest !== admission.lockDigest) {
    corrupt("stored Hook admission boundary differs from its rooted admission");
  }
  if (boundary.observedJournalPosition === 0) {
    if (boundary.observedJournalEventDigest !== null) {
      corrupt("genesis Hook admission boundary observes a Journal Event");
    }
  } else if (boundary.observedJournalEventDigest !== requireCanonicalJournalEventDigest(
    database,
    root,
    BigInt(boundary.observedJournalPosition),
  )) {
    corrupt("stored Hook admission boundary differs from its observed Journal Event");
  }
  return boundary;
}

function readAndCrossCheckPrivateHookRevisions(
  database: SqliteDatabase,
  root: PrivateProjectRoot,
  admissionHead: AdmissionHeadRow,
): readonly LoadedHookRevision[] {
  const query = statement<HookRevisionRow>(database, [
    "SELECT revision_digest, hook_id, meaning_digest, opening_admission_digest,",
    "opening_candidate_revision, start_position, closing_admission_digest, end_position, revision_bytes",
    "FROM hook_revisions ORDER BY hook_id, start_position, revision_digest",
  ].join(" "));
  let rows: readonly HookRevisionRow[];
  try { rows = query.all().map(copiedHookRevisionRow); }
  finally { query.finalize(); }
  const boundaryRows = readPrivateHookAdmissionBoundaryRows(database);
  if (admissionHead.revision === null) {
    if (rows.length !== 0 || boundaryRows.size !== 0) {
      corrupt("Hook history exists before the first admission");
    }
    return Object.freeze([]);
  }

  readJournalHead(database);
  const expected = new Map<string, LoadedHookRevision>();
  const open = new Map<string, LoadedHookRevision>();
  let lastObservedJournalPosition = 0;

  for (let admissionRevision = 1n; admissionRevision <= admissionHead.revision; admissionRevision += 1n) {
    const admissionRow = requireAdmissionRow(database, admissionRevision);
    const admission = loadAndCrossCheckAdmission(database, admissionRow, root).admission;
    const boundaryRow = boundaryRows.get(admissionRow.admission_digest);
    if (boundaryRow === undefined) {
      corrupt(`admission ${admissionRow.admission_digest} has no Hook boundary fact`);
    }
    boundaryRows.delete(admissionRow.admission_digest);
    const boundary = decodeAndCrossCheckHookAdmissionBoundaryRow(
      database,
      root,
      boundaryRow,
      admission,
    );
    if (boundary.observedJournalPosition < lastObservedJournalPosition) {
      corrupt(`admission ${admissionRow.admission_digest} observes Journal history before its predecessor`);
    }
    lastObservedJournalPosition = boundary.observedJournalPosition;
    const candidate = loadCandidateRow(requireCandidateRow(
      database,
      BigInt(admission.candidateRevision),
    ));
    const desired = new Map(privateHookMeaningsForCandidate(candidate));
    const preserved = new Set<string>();
    for (const [hookId, entry] of open) {
      const next = desired.get(hookId);
      if (next !== undefined && privateHookMeaningDigest(next) === entry.revision.meaningDigest &&
          sameBytes(encodePrivateHookMeaning(next), encodePrivateHookMeaning(entry.revision.meaning))) {
        preserved.add(hookId);
        desired.delete(hookId);
      }
    }
    const closes = [...open.entries()].filter(([hookId]) => !preserved.has(hookId));
    const changed = closes.length !== 0 || desired.size !== 0;
    if ((boundary.boundaryPosition === null) !== !changed) {
      corrupt(`admission ${admissionRow.admission_digest} Hook boundary does not describe its transition`);
    }
    if (!changed) continue;
    const position = boundary.boundaryPosition!;
    if (position !== boundary.observedJournalPosition + 1) {
      corrupt(`admission ${admissionRow.admission_digest} Hook boundary is not its observed Journal successor`);
    }

    for (const [hookId, entry] of closes) {
      const closed = Object.freeze({
        ...entry,
        endPosition: position,
        closingAdmissionRevision: Number(admissionRevision),
      });
      expected.set(entry.revisionDigest, closed);
      open.delete(hookId);
    }
    for (const [hookId, meaning] of desired) {
      const revision = normalizePrivateHookRevision({
        kind: "private-hook-revision/1",
        meaning,
        meaningDigest: privateHookMeaningDigest(meaning),
        openingAdmissionDigest: admissionRow.admission_digest,
        openingCandidateRevision: admission.candidateRevision,
        openingCandidateDigest: admission.candidateDigest,
        startPosition: position,
      });
      const entry = Object.freeze({
        revisionDigest: privateHookRevisionDigest(revision),
        revision,
        endPosition: null,
        openingAdmissionRevision: Number(admissionRevision),
        closingAdmissionRevision: null,
      });
      expected.set(entry.revisionDigest, entry);
      open.set(hookId, entry);
    }
  }
  if (boundaryRows.size !== 0) corrupt("Hook boundary facts exist outside admission history");
  if (rows.length !== expected.size) corrupt("stored Hook revision set is incomplete or excessive");

  const loaded: LoadedHookRevision[] = [];
  for (const row of rows) {
    const actual = decodeAndCrossCheckHookRevisionRow(database, row);
    const wanted = expected.get(actual.revisionDigest);
    if (wanted === undefined ||
        !sameBytes(encodePrivateHookRevision(actual.revision), encodePrivateHookRevision(wanted.revision)) ||
        actual.endPosition !== wanted.endPosition ||
        actual.openingAdmissionRevision !== wanted.openingAdmissionRevision ||
        actual.closingAdmissionRevision !== wanted.closingAdmissionRevision ||
        row.closing_admission_digest !== (wanted.closingAdmissionRevision === null
          ? null
          : requireAdmissionRow(database, BigInt(wanted.closingAdmissionRevision)).admission_digest)) {
      corrupt(`stored Hook revision ${actual.revisionDigest} differs from rooted admission history`);
    }
    loaded.push(actual);
  }
  return Object.freeze(loaded);
}

function decodeAndCrossCheckHookRevisionRow(
  database: SqliteDatabase,
  row: HookRevisionRow,
): LoadedHookRevision {
  requireStoredSize(row.revision_bytes, "stored Hook revision");
  const revision = decodePrivateHookRevision(row.revision_bytes);
  const revisionDigest = privateHookRevisionDigest(revision);
  if (row.revision_digest !== revisionDigest ||
      row.hook_id !== revision.meaning.hookId ||
      row.meaning_digest !== revision.meaningDigest ||
      row.opening_admission_digest !== revision.openingAdmissionDigest ||
      safeRevision(row.opening_candidate_revision) !== revision.openingCandidateRevision ||
      safeRevision(row.start_position) !== revision.startPosition) {
    corrupt("stored Hook revision columns differ from their canonical revision");
  }
  const endPosition = row.end_position === null ? null : safeRevision(row.end_position);
  if ((row.closing_admission_digest === null) !== (endPosition === null)) {
    corrupt(`Hook ${revision.meaning.hookId} closing admission and interval end differ`);
  }
  if (endPosition !== null && endPosition < revision.startPosition) {
    corrupt(`Hook ${revision.meaning.hookId} has an inverted revision interval`);
  }

  const admissionRow = requireAdmissionByDigest(database, revision.openingAdmissionDigest);
  const openingAdmissionRevision = safeRevision(admissionRow.revision);
  let closingAdmissionRevision: number | null = null;
  if (row.closing_admission_digest !== null) {
    const closingRow = requireAdmissionByDigest(database, row.closing_admission_digest);
    closingAdmissionRevision = safeRevision(closingRow.revision);
    if (closingAdmissionRevision <= openingAdmissionRevision) {
      corrupt(`Hook ${revision.meaning.hookId} closes before its opening admission`);
    }
  }
  return Object.freeze({
    revisionDigest,
    revision,
    endPosition,
    openingAdmissionRevision,
    closingAdmissionRevision,
  });
}

function copiedHookRevisionRow(row: HookRevisionRow): HookRevisionRow {
  return Object.freeze({
    revision_digest: row.revision_digest,
    hook_id: row.hook_id,
    meaning_digest: row.meaning_digest,
    opening_admission_digest: row.opening_admission_digest,
    opening_candidate_revision: row.opening_candidate_revision,
    start_position: row.start_position,
    closing_admission_digest: row.closing_admission_digest,
    end_position: row.end_position,
    revision_bytes: copiedBlob(row.revision_bytes, "stored Hook revision"),
  });
}

function serviceRecipeBindingId(recipe: PrivateBunServiceRecipe): string {
  if (recipe.request.mode !== "service" || recipe.request.target.kind !== "binding") {
    throw new TypeError("Bun Service recipe does not name a Service Binding");
  }
  return recipe.request.target.id;
}

function privateServiceMountId(admissionDigest: string, bindingId: string): string {
  return privateDomainDigest("JIG-Private-Service-Mount-ID/1", {
    admissionDigest,
    bindingId,
  });
}

function requireCurrentServiceRecipe(
  candidate: PrivateActivationCandidateArtifactV5,
  recipe: PrivateBunServiceRecipe,
  artifacts: ReacquiredArtifacts,
): void {
  const readyServices = candidate.candidate.targets.filter((target) =>
    target.request.mode === "service" && target.disposition.state === "ready");
  if (readyServices.length > 1) {
    invalid(
      "SERVICE_SCOPE_UNSUPPORTED",
      "the private Service proof supports at most one READY Service Binding",
    );
  }
  const bindingId = serviceRecipeBindingId(recipe);
  const selected = findPrivateActivationCandidateTargetV5(candidate, recipe.request.target);
  if (selected === undefined || readyServices.length !== 1 ||
      readyServices[0]!.request.digest !== selected.request.digest ||
      selected.request.mode !== "service" || selected.request.target.kind !== "binding" ||
      selected.request.target.id !== bindingId ||
      selected.request.digest !== recipe.request.digest ||
      !sameBytes(
        canonicalJson(selected.request as unknown as JsonValue),
        canonicalJson(recipe.request as unknown as JsonValue),
      ) ||
      selected.disposition.state !== "ready" ||
      selected.disposition.recipeDigest !== recipe.digest ||
      selected.disposition.observationDigest !== recipe.observation.digest) {
    invalid(
      "SERVICE_MOUNT_TARGET_MISMATCH",
      "Bun Service recipe differs from the active READY Service Binding",
    );
  }
  requireServicePackageEvidence(candidate, selected.request.packagePath, bindingId, recipe.expectedExports, artifacts);
  const inspected = artifacts.inspection(selected.request.package.digest);
  const observedExports = inspected.providedContracts.map((entry) => ({
    name: entry.slot,
    contract: {
      id: entry.contract.descriptor.id,
      version: entry.contract.descriptor.version,
      digest: entry.contract.digest,
    },
  })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  if (recipe.packageObservation.requestDigest !== recipe.request.digest ||
      recipe.packageObservation.packageDigest !== recipe.request.package.digest ||
      !sameBytes(
        canonicalJson(observedExports as unknown as JsonValue),
        canonicalJson(recipe.packageObservation.exports as unknown as JsonValue),
      )) {
    invalid(
      "ADMISSION_ARTIFACT_MISMATCH",
      "Bun Service recipe export evidence differs from its retained Package/1",
    );
  }
}

function requireServicePackageEvidence(
  candidate: PrivateActivationCandidateArtifactV5,
  packagePath: string,
  bindingId: string,
  expectedExports: readonly string[],
  artifacts?: ReacquiredArtifacts,
): void {
  const binding = candidate.lock.bindings[bindingId];
  const lockedPackage = candidate.lock.packages[packagePath];
  if (binding === undefined || binding.packagePath !== packagePath ||
      lockedPackage === undefined || lockedPackage.mode !== "service" ||
      Object.keys(binding.attachments).length !== 0 || Object.keys(binding.slots).length !== 0) {
    corrupt("stored Service Mount Binding differs from its candidate lock");
  }
  const exports = Object.keys(lockedPackage.provides).sort();
  if (exports.length !== expectedExports.length ||
      exports.some((value, index) => value !== expectedExports[index])) {
    corrupt("stored Service Mount exports differ from their protected Package/1");
  }
  if (artifacts === undefined) return;
  const inspected = artifacts.inspection(lockedPackage.digest);
  if (inspected.digest !== lockedPackage.digest || inspected.mode !== "service") {
    corrupt("stored Service Mount Package/1 evidence differs from its candidate lock");
  }
}

function loadServiceMountSnapshot(
  database: SqliteDatabase,
  row: ServiceMountRow,
  root: PrivateProjectRoot,
  coordinator: PrivateProjectCoordinator,
  candidate: PrivateActivationCandidateArtifactV5,
  artifacts?: ReacquiredArtifacts,
  recipe?: PrivateBunServiceRecipe,
): PrivateServiceMountSnapshot {
  requireDigest(row.mount_id, "stored Service Mount");
  requireDigest(row.admission_digest, "stored Service Mount admission");
  requireDigest(row.allocation_digest, "stored Service Mount allocation");
  const epoch = safeRevision(row.coordinator_epoch);
  if (epoch > coordinator.epoch) corrupt("Service Mount belongs to a future coordinator epoch");
  const bytes = copiedBlob(row.allocation_bytes, "stored Service Mount allocation");
  requireStoredSize(bytes, "stored Service Mount allocation");
  let allocation: PrivateServiceMountAllocation;
  try { allocation = decodePrivateServiceMountAllocation(bytes); }
  catch { corrupt("stored Service Mount allocation is invalid"); }
  if (!sameBytes(bytes, encodePrivateServiceMountAllocation(allocation)) ||
      privateServiceMountAllocationDigest(allocation) !== row.allocation_digest ||
      allocation.mountId !== row.mount_id || allocation.bindingId !== row.binding_id ||
      allocation.admissionDigest !== row.admission_digest || allocation.coordinatorEpoch !== epoch ||
      allocation.mountId !== privateServiceMountId(allocation.admissionDigest, allocation.bindingId)) {
    corrupt("stored Service Mount allocation differs from its durable identity");
  }

  const admissionRow = requireAdmissionByDigest(database, row.admission_digest);
  const admission = loadAndCrossCheckAdmission(database, admissionRow, root).admission;
  if (allocation.candidateRevision !== admission.candidateRevision ||
      candidate.candidate.lockDigest !== admission.lockDigest ||
      privateActivationCandidateDigestV5(candidate) !== admission.candidateDigest) {
    corrupt("stored Service Mount candidate differs from its admission");
  }
  const readyServices = candidate.candidate.targets.filter((target) =>
    target.request.mode === "service" && target.disposition.state === "ready");
  const selected = findPrivateActivationCandidateTargetV5(candidate, {
    kind: "binding",
    id: allocation.bindingId,
  });
  if (selected === undefined || readyServices.length !== 1 ||
      readyServices[0]!.request.digest !== selected.request.digest ||
      selected.request.mode !== "service" || selected.request.target.kind !== "binding" ||
      selected.request.digest !== allocation.requestDigest ||
      selected.disposition.state !== "ready" ||
      selected.disposition.recipeDigest !== allocation.recipeDigest ||
      selected.disposition.observationDigest !== allocation.observationDigest) {
    corrupt("stored Service Mount differs from its pinned READY target");
  }
  requireServicePackageEvidence(
    candidate,
    selected.request.packagePath,
    allocation.bindingId,
    allocation.expectedExports,
    artifacts,
  );
  if (recipe !== undefined) {
    if (artifacts === undefined) corrupt("exact Service Mount recipe load has no Package/1 evidence");
    requireCurrentServiceRecipe(candidate, recipe, artifacts);
    requireServiceMountAllocationRecipe(allocation, recipe);
  }
  const lifecycle = loadServiceMountLifecycleFacts(
    database,
    root,
    coordinator,
    candidate,
    allocation,
    row.allocation_digest,
    selected.request.package.digest,
    recipe,
  );
  return Object.freeze({
    allocation,
    allocationDigest: row.allocation_digest,
    coordinator: epoch === coordinator.epoch ? "current" : "older",
    ...lifecycle,
  });
}

interface ServiceMountTransitionContext {
  readonly coordinator: PrivateProjectCoordinator;
  readonly root: PrivateProjectRoot;
  readonly candidate: PrivateActivationCandidateArtifactV5;
  readonly recipe: PrivateBunServiceRecipe | undefined;
  readonly packageDigest: string;
  readonly mode: "advance" | "settle";
  readonly database: SqliteDatabase;
}

async function transitionPrivateServiceMount(
  input: PrivateServiceMountTransitionInput,
  mode: "advance" | "settle",
  transition: (
    database: SqliteDatabase,
    before: PrivateServiceMountSnapshot,
    context: ServiceMountTransitionContext,
  ) => void,
): Promise<PrivateServiceMountSnapshot> {
  const coordinator = requirePrivateProjectCoordinator(input.coordinator);
  const recipe = input.recipe === undefined
    ? undefined
    : requirePrivateBunServiceRecipe(input.recipe);
  const startupOwner = mode === "advance"
    ? requireCreatedServiceMountAllocation(
      (input as PrivateServiceMountAdvanceInput).allocation,
    )
    : undefined;
  if (mode === "advance" && recipe === undefined) {
    throw new TypeError("Service Mount forward transition requires its exact recipe");
  }
  await coordinator.verify();
  requireDigest(input.mountId, "Service Mount");
  const owner = await openStateOwner(input.projectRoot, false);
  let artifacts: ReacquiredArtifacts | undefined;
  let failure: unknown;
  try {
    requireCoordinatorRoot(coordinator, owner.root);
    const initialRow = requireServiceMountRow(owner.database, input.mountId);
    const admissionRow = requireAdmissionByDigest(owner.database, initialRow.admission_digest);
    const admission = loadAndCrossCheckAdmission(owner.database, admissionRow, owner.root);
    const candidateRow = requireCandidateRow(
      owner.database,
      BigInt(admission.admission.candidateRevision),
    );
    const candidate = loadCandidateRow(candidateRow);
    requireCandidateRoot(candidate, owner.root);
    if (mode === "advance") {
      artifacts = await reacquireCandidateArtifacts(input.packageStoreRoot!, candidate);
      requireCurrentServiceRecipe(candidate, recipe!, artifacts);
    }

    const result = await immediate(owner, async () => {
      await coordinator.verify();
      const currentRow = requireServiceMountRow(owner.database, input.mountId);
      const currentAdmission = requireAdmissionByDigest(owner.database, initialRow.admission_digest);
      const currentCandidate = requireCandidateRow(owner.database, candidateRow.revision);
      requireSameServiceMountRow(initialRow, currentRow);
      requireSameAdmissionRow(admissionRow, currentAdmission);
      requireSameCandidateRow(candidateRow, currentCandidate);
      loadAndCrossCheckAdmission(owner.database, currentAdmission, owner.root);
      const before = loadServiceMountSnapshot(
        owner.database,
        currentRow,
        owner.root,
        coordinator,
        candidate,
        artifacts,
        mode === "advance" ? recipe : undefined,
      );
      if (startupOwner !== undefined) {
        requireServiceMountStartupOwner(startupOwner, before, coordinator);
      }
      const selected = findPrivateActivationCandidateTargetV5(candidate, {
        kind: "binding",
        id: currentRow.binding_id,
      });
      if (selected === undefined || selected.request.mode !== "service") {
        corrupt("Service Mount recipe target disappeared from its pinned candidate");
      }
      const context: ServiceMountTransitionContext = Object.freeze({
        coordinator,
        root: owner.root,
        candidate,
        recipe,
        packageDigest: selected.request.package.digest,
        mode,
        database: owner.database,
      });
      transition(owner.database, before, context);
      return loadServiceMountSnapshot(
        owner.database,
        requireServiceMountRow(owner.database, input.mountId),
        owner.root,
        coordinator,
        candidate,
        artifacts,
        mode === "advance" ? recipe : undefined,
      );
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

function requireCreatedServiceMountAllocation(
  value: unknown,
): PrivateServiceMountAllocationResult {
  if (value === null || typeof value !== "object" ||
      !authenticCreatedServiceMountAllocations.has(value) ||
      (value as PrivateServiceMountAllocationResult).created !== true) {
    throw new TypeError("Service Mount allocation did not create startup ownership");
  }
  return value as PrivateServiceMountAllocationResult;
}

function requireServiceMountStartupOwner(
  owner: PrivateServiceMountAllocationResult,
  snapshot: PrivateServiceMountSnapshot,
  coordinator: PrivateProjectCoordinator,
): void {
  const allocated = owner.snapshot;
  if (allocated.coordinator !== "current" ||
      allocated.allocation.coordinatorEpoch !== coordinator.epoch ||
      allocated.allocation.mountId !== snapshot.allocation.mountId ||
      allocated.allocationDigest !== snapshot.allocationDigest ||
      !sameCanonical(allocated.allocation, snapshot.allocation)) {
    throw new TypeError("Service Mount startup ownership does not match this Mount");
  }
}

function loadServiceMountLifecycleFacts(
  database: SqliteDatabase,
  root: PrivateProjectRoot,
  coordinator: PrivateProjectCoordinator,
  candidate: PrivateActivationCandidateArtifactV5,
  allocation: PrivateServiceMountAllocation,
  allocationDigest: string,
  packageDigest: string,
  recipe?: PrivateBunServiceRecipe,
): Omit<PrivateServiceMountSnapshot, "allocation" | "allocationDigest" | "coordinator"> {
  const query = statement<ServiceMountFactRow>(database, [
    "SELECT mount_id, fact_name, fact_digest, fact_bytes FROM service_mount_facts",
    "WHERE mount_id = ?1 ORDER BY fact_name",
  ].join(" ")).safeIntegers(true);
  let rows: readonly ServiceMountFactRow[];
  try { rows = query.all(allocation.mountId).map(copiedServiceMountFactRow); }
  finally { query.finalize(); }
  if (rows.length > 10) corrupt("Service Mount has too many lifecycle facts");
  const byName = new Map<ServiceMountFactName, ServiceMountFactRow>();
  for (const row of rows) {
    if (row.mount_id !== allocation.mountId || !isServiceMountFactName(row.fact_name) ||
        byName.has(row.fact_name)) {
      corrupt("Service Mount lifecycle fact identity is invalid or duplicated");
    }
    byName.set(row.fact_name, row);
  }
  const lifecycle = Object.freeze({
    ...loadTypedServiceMountFact(byName.get("plan"), "plan", decodePrivateServiceMountPlan,
      encodePrivateServiceMountPlan, privateServiceMountPlanDigest),
    ...loadTypedServiceMountFact(byName.get("backing"), "backing", decodePrivateServiceMountBacking,
      encodePrivateServiceMountBacking, privateServiceMountBackingDigest),
    ...loadTypedServiceMountFact(byName.get("sandbox"), "sandbox", decodePrivateServiceMountSandbox,
      encodePrivateServiceMountSandbox, privateServiceMountSandboxDigest),
    ...loadTypedServiceMountFact(byName.get("prepared"), "prepared", decodePrivateServiceMountPrepared,
      encodePrivateServiceMountPrepared, privateServiceMountPreparedDigest),
    ...loadTypedServiceMountFact(byName.get("generation"), "generation", decodePrivateServiceMountGeneration,
      encodePrivateServiceMountGeneration, privateServiceMountGenerationDigest),
    ...loadTypedServiceMountFact(byName.get("acknowledged"), "acknowledged",
      decodePrivateServiceMountAcknowledged, encodePrivateServiceMountAcknowledged,
      privateServiceMountAcknowledgedDigest),
    ...loadTypedServiceMountFact(byName.get("provisional"), "provisional",
      decodePrivateServiceMountProvisional, encodePrivateServiceMountProvisional,
      privateServiceMountProvisionalDigest),
    ...loadTypedServiceMountFact(byName.get("fence"), "fence", decodePrivateServiceMountFence,
      encodePrivateServiceMountFence, privateServiceMountFenceDigest),
    ...loadTypedServiceMountFact(byName.get("release"), "release", decodePrivateServiceMountRelease,
      encodePrivateServiceMountRelease, privateServiceMountReleaseDigest),
    ...loadTypedServiceMountFact(byName.get("closure"), "closure", decodePrivateServiceMountClosure,
      encodePrivateServiceMountClosure, privateServiceMountClosureDigest),
  }) as Omit<PrivateServiceMountSnapshot, "allocation" | "allocationDigest" | "coordinator">;
  const snapshot = Object.freeze({
    allocation,
    allocationDigest,
    coordinator: "current" as const,
    ...lifecycle,
  });
  validateLoadedServiceMountLifecycle(
    database,
    root,
    coordinator,
    candidate,
    snapshot,
    packageDigest,
    recipe,
  );
  return lifecycle;
}

function loadTypedServiceMountFact<Name extends ServiceMountFactName, Value>(
  row: ServiceMountFactRow | undefined,
  name: Name,
  decode: (bytes: Uint8Array) => Value,
  encode: (value: unknown) => Uint8Array,
  digest: (value: unknown) => string,
): Partial<Record<Name, PrivateServiceMountFact<Value>>> {
  if (row === undefined) return {};
  requireDigest(row.fact_digest, `stored Service Mount ${name}`);
  const bytes = copiedBlob(row.fact_bytes, `stored Service Mount ${name}`);
  requireStoredSize(bytes, `stored Service Mount ${name}`);
  let value: Value;
  try { value = decode(bytes); }
  catch { corrupt(`stored Service Mount ${name} fact is invalid`); }
  if (!sameBytes(bytes, encode(value)) || digest(value) !== row.fact_digest) {
    corrupt(`stored Service Mount ${name} fact differs from its durable identity`);
  }
  return { [name]: Object.freeze({ digest: row.fact_digest, value }) } as Partial<
    Record<Name, PrivateServiceMountFact<Value>>
  >;
}

function validateLoadedServiceMountLifecycle(
  database: SqliteDatabase,
  root: PrivateProjectRoot,
  coordinator: PrivateProjectCoordinator,
  candidate: PrivateActivationCandidateArtifactV5,
  snapshot: PrivateServiceMountSnapshot,
  packageDigest: string,
  recipe?: PrivateBunServiceRecipe,
): void {
  if (snapshot.plan !== undefined) {
    requireServiceMountPlanCorrelation(root, snapshot, snapshot.plan.value, packageDigest, recipe);
  }
  if (snapshot.backing !== undefined) requireServiceMountBackingCorrelation(snapshot, snapshot.backing.value);
  if (snapshot.sandbox !== undefined) {
    requireServiceMountSandboxCorrelation(snapshot, snapshot.sandbox.value, recipe);
  }
  if (snapshot.prepared !== undefined) {
    requireServiceMountPreparedCorrelation(snapshot, snapshot.prepared.value);
  }
  if (snapshot.generation !== undefined) {
    requireServiceMountGenerationCorrelation(snapshot, snapshot.generation.value);
  }
  if (snapshot.acknowledged !== undefined) {
    requireServiceMountAcknowledgedCorrelation(snapshot, snapshot.acknowledged.value);
  }
  if (snapshot.provisional !== undefined) {
    requireServiceMountProvisionalCorrelation(snapshot, snapshot.provisional.value);
  }
  if (snapshot.fence !== undefined) requireServiceMountFenceCorrelation(snapshot, snapshot.fence.value);
  if (snapshot.release !== undefined) {
    requireServiceMountReleaseCorrelation(
      database,
      root,
      coordinator,
      candidate,
      snapshot,
      snapshot.release.value,
    );
  }
  if (snapshot.closure !== undefined) {
    requireServiceMountClosureCorrelation(snapshot, snapshot.closure.value);
  }
  requireLoadedServiceMountOrder(snapshot);
}

function requireServiceMountAllocationRecipe(
  allocation: PrivateServiceMountAllocation,
  recipe: PrivateBunServiceRecipe,
): void {
  if (allocation.bindingId !== serviceRecipeBindingId(recipe) ||
      allocation.requestDigest !== recipe.request.digest || allocation.recipeDigest !== recipe.digest ||
      allocation.observationDigest !== recipe.observation.digest ||
      allocation.expectedExports.length !== recipe.expectedExports.length ||
      allocation.expectedExports.some((value, index) => value !== recipe.expectedExports[index])) {
    invalid("SERVICE_MOUNT_RECIPE_MISMATCH", "Service Mount allocation differs from its exact recipe");
  }
}

function requireServiceMountPlanCorrelation(
  root: PrivateProjectRoot,
  snapshot: PrivateServiceMountSnapshot,
  value: PrivateServiceMountPlan,
  packageDigest: string,
  recipe?: PrivateBunServiceRecipe,
): void {
  requireMountFactBase(snapshot, value.mountId, value.allocationDigest, "plan");
  const roots = serviceMountProtectedRoots(root);
  const hexadecimal = serviceMountHex(snapshot.allocation.mountId);
  const packageAllocation = normalizePrivatePackageMaterializationAllocationIdentity(
    value.packageAllocation,
  );
  const ownerAllocation = normalizePrivateLinuxOwnerStateAllocationIdentity(value.ownerAllocation);
  if (packageAllocation.parent.path !== roots.materializations ||
      packageAllocation.name !== `service-${hexadecimal}` ||
      packageAllocation.path !== join(roots.materializations, `service-${hexadecimal}`) ||
      packageAllocation.packageDigest !== packageDigest ||
      packageAllocation.ownerToken !== snapshot.allocationDigest ||
      ownerAllocation.parent !== roots.owners || ownerAllocation.name !== `s-${hexadecimal.slice(0, 62)}` ||
      ownerAllocation.directory !== join(roots.owners, `s-${hexadecimal.slice(0, 62)}`)) {
    corrupt("Service Mount plan resource identities are not rooted in its exact allocation");
  }
  if (recipe !== undefined && value.cancellationGraceMs !== recipe.cancellationGraceMs) {
    corrupt("Service Mount plan cancellation grace differs from its exact recipe");
  }
}

function requireServiceMountBackingCorrelation(
  snapshot: PrivateServiceMountSnapshot,
  value: PrivateServiceMountBacking,
): void {
  requireMountFactBase(snapshot, value.mountId, value.allocationDigest, "backing");
  const plan = requireServiceMountFact(snapshot.plan, "plan");
  if (value.planDigest !== plan.digest || !sameCanonical(
    normalizePrivatePackageMaterializationLeaseIdentity(value.lease).allocation,
    plan.value.packageAllocation,
  )) corrupt("Service Mount backing differs from its plan allocation");
}

function requireServiceMountSandboxCorrelation(
  snapshot: PrivateServiceMountSnapshot,
  value: PrivateServiceMountSandbox,
  recipe?: PrivateBunServiceRecipe,
): void {
  requireMountFactBase(snapshot, value.mountId, value.allocationDigest, "sandbox");
  const plan = requireServiceMountFact(snapshot.plan, "plan");
  const backing = requireServiceMountFact(snapshot.backing, "backing");
  const owner = normalizePrivateLinuxSealedOwnerIdentity(value.owner);
  if (value.backingDigest !== backing.digest || owner.runId !== serviceMountRunId(value.mountId) ||
      owner.deadlineUnixMs !== snapshot.allocation.effectiveDeadlineUnixMs ||
      owner.cancellationGraceMs !== plan.value.cancellationGraceMs ||
      owner.ownerStateParent !== plan.value.ownerAllocation.parent ||
      owner.ownerStateParentDevice !== plan.value.ownerAllocation.parentDevice ||
      owner.ownerStateParentInode !== plan.value.ownerAllocation.parentInode ||
      owner.ownerStateName !== plan.value.ownerAllocation.name ||
      owner.ownerStateDirectory !== plan.value.ownerAllocation.directory ||
      owner.ownerStateAllocationDigest !== plan.value.ownerAllocation.digest ||
      owner.ownerToken !== plan.value.ownerAllocation.ownerToken) {
    corrupt("Service Mount sandbox owner differs from its exact plan");
  }
  if (recipe !== undefined && (owner.mechanismDigest !== recipe.mechanismDigest ||
      owner.cleanupTimeoutMs !== recipe.resourceCeilings.cleanupTimeoutMs)) {
    corrupt("Service Mount sandbox mechanism differs from its exact recipe");
  }
}

function requireServiceMountPreparedCorrelation(
  snapshot: PrivateServiceMountSnapshot,
  value: PrivateServiceMountPrepared,
): void {
  requireMountFactBase(snapshot, value.mountId, value.allocationDigest, "prepared");
  const sandbox = requireServiceMountFact(snapshot.sandbox, "sandbox");
  const prepared = normalizePrivateLinuxPreparedOwnerIdentity(value.prepared);
  if (value.sandboxDigest !== sandbox.digest || !sameCanonical(prepared.owner, sandbox.value.owner)) {
    corrupt("Service Mount prepared owner differs from its sandbox owner");
  }
}

function requireServiceMountGenerationCorrelation(
  snapshot: PrivateServiceMountSnapshot,
  value: PrivateServiceMountGeneration,
): void {
  requireMountFactBase(snapshot, value.mountId, value.allocationDigest, "generation");
  const prepared = requireServiceMountFact(snapshot.prepared, "prepared");
  const generationId = privateDomainDigest("JIG-Private-Service-Generation-ID/1", {
    mountId: snapshot.allocation.mountId,
    allocationDigest: snapshot.allocationDigest,
    preparedDigest: prepared.digest,
  });
  if (value.preparedDigest !== prepared.digest || value.generationId !== generationId ||
      value.exports.length !== snapshot.allocation.expectedExports.length ||
      value.exports.some((entry, index) => entry !== snapshot.allocation.expectedExports[index])) {
    corrupt("Service Mount generation differs from exact readiness evidence");
  }
}

function requireServiceMountAcknowledgedCorrelation(
  snapshot: PrivateServiceMountSnapshot,
  value: PrivateServiceMountAcknowledged,
): void {
  requireMountFactBase(snapshot, value.mountId, value.allocationDigest, "acknowledgement");
  if (value.generationDigest !== requireServiceMountFact(snapshot.generation, "generation").digest) {
    corrupt("Service Mount acknowledgement names a different generation");
  }
}

function requireServiceMountProvisionalCorrelation(
  snapshot: PrivateServiceMountSnapshot,
  value: PrivateServiceMountProvisional,
): void {
  requireMountFactBase(snapshot, value.mountId, value.allocationDigest, "provisional terminal");
  if (value.generationDigest !== (snapshot.generation?.digest ?? null) ||
      value.acknowledgedDigest !== (snapshot.acknowledged?.digest ?? null)) {
    corrupt("Service Mount provisional terminal differs from its readiness prefix");
  }
}

function requireServiceMountFenceCorrelation(
  snapshot: PrivateServiceMountSnapshot,
  value: PrivateServiceMountFence,
): void {
  requireMountFactBase(snapshot, value.mountId, value.allocationDigest, "fence");
  const plan = requireServiceMountFact(snapshot.plan, "plan");
  const provisional = requireServiceMountFact(snapshot.provisional, "provisional");
  if (value.planDigest !== plan.digest || value.provisionalDigest !== provisional.digest) {
    corrupt("Service Mount fence differs from its exact plan or terminal");
  }
  if (value.proof.kind === "allocation-cancelled") {
    const cancellation = normalizePrivateLinuxOwnerStateCancellation(value.proof.cancellation);
    if (snapshot.prepared !== undefined || cancellation.allocationDigest !== plan.value.ownerAllocation.digest ||
        (provisional.value.classification !== "startup-cancelled" &&
         provisional.value.classification !== "coordinator-loss")) {
      corrupt("Service Mount allocation fence does not prove an unprepared owner");
    }
    if (snapshot.sandbox !== undefined &&
        (cancellation.directoryDevice !== snapshot.sandbox.value.owner.ownerStateDevice ||
         cancellation.directoryInode !== snapshot.sandbox.value.owner.ownerStateInode)) {
      corrupt("Service Mount allocation fence differs from its sealed owner-state directory");
    }
    return;
  }
  const sandbox = requireServiceMountFact(snapshot.sandbox, "sandbox");
  if (value.proof.sandboxDigest !== sandbox.digest) {
    corrupt("Service Mount enforcement fence names a different sandbox");
  }
  const receipt = normalizePrivateLinuxConfirmedEnforcementReceipt(value.proof.receipt);
  const prepared = preparedIdentityForServiceSandbox(sandbox.value.owner);
  if (receipt.ownerDigest !== prepared.digest) {
    corrupt("Service Mount enforcement receipt belongs to another prepared owner");
  }
  requireServiceMountFenceClassification(provisional.value.classification, receipt);
}

function requireServiceMountReleaseCorrelation(
  database: SqliteDatabase,
  root: PrivateProjectRoot,
  coordinator: PrivateProjectCoordinator,
  candidate: PrivateActivationCandidateArtifactV5,
  snapshot: PrivateServiceMountSnapshot,
  value: PrivateServiceMountRelease,
): void {
  requireMountFactBase(snapshot, value.mountId, value.allocationDigest, "release");
  const provisional = requireServiceMountFact(snapshot.provisional, "provisional");
  if (value.provisionalDigest !== provisional.digest) {
    corrupt("Service Mount release names a different provisional terminal");
  }
  const leaseReleases = requireReleasedServiceLeases(
    database,
    snapshot,
    root,
    coordinator,
    candidate,
  );
  if (!sameCanonical(value.leaseReleases, leaseReleases)) {
    corrupt("Service Mount release differs from its linked lease releases");
  }
  if (snapshot.plan === undefined) {
    if (value.planDigest !== null || value.backingDigest !== null || value.fenceDigest !== null ||
        value.ownerRelease !== null || snapshot.backing !== undefined || snapshot.sandbox !== undefined ||
        snapshot.prepared !== undefined || snapshot.fence !== undefined) {
      corrupt("unplanned Service Mount release carries resource evidence");
    }
    return;
  }
  const fence = requireServiceMountFact(snapshot.fence, "fence");
  const ownerRelease = value.ownerRelease === null
    ? corrupt("planned Service Mount release omits owner disposal")
    : normalizePrivateLinuxOwnerStateReleaseReceipt(value.ownerRelease);
  if (value.planDigest !== snapshot.plan.digest ||
      value.backingDigest !== (snapshot.backing?.digest ?? null) || value.fenceDigest !== fence.digest ||
      ownerRelease.allocationDigest !== snapshot.plan.value.ownerAllocation.digest) {
    corrupt("Service Mount release differs from its resource lifecycle");
  }
  if (fence.value.proof.kind === "allocation-cancelled") {
    const cancellation = fence.value.proof.cancellation;
    if (ownerRelease.directoryDevice !== cancellation.directoryDevice ||
        ownerRelease.directoryInode !== cancellation.directoryInode) {
      corrupt("Service Mount owner release differs from allocation cancellation evidence");
    }
  } else {
    const sandbox = requireServiceMountFact(snapshot.sandbox, "sandbox");
    if (ownerRelease.directoryDevice !== sandbox.value.owner.ownerStateDevice ||
        ownerRelease.directoryInode !== sandbox.value.owner.ownerStateInode) {
      corrupt("Service Mount owner release differs from sandbox owner evidence");
    }
  }
}

function requireServiceMountClosureCorrelation(
  snapshot: PrivateServiceMountSnapshot,
  value: PrivateServiceMountClosure,
): void {
  requireMountFactBase(snapshot, value.mountId, value.allocationDigest, "closure");
  if (value.provisionalDigest !== requireServiceMountFact(snapshot.provisional, "provisional").digest ||
      value.releaseDigest !== requireServiceMountFact(snapshot.release, "release").digest) {
    corrupt("Service Mount closure differs from its terminal release");
  }
}

function writeServiceMountFact(
  database: SqliteDatabase,
  before: PrivateServiceMountSnapshot,
  name: ServiceMountFactName,
  value: unknown,
  context: ServiceMountTransitionContext,
): void {
  const encoded = encodeAndDigestServiceMountFact(name, value);
  requireStoredSize(encoded.bytes, `Service Mount ${name}`);
  const prior = findServiceMountFactRow(database, before.allocation.mountId, name);
  if (prior !== null) {
    if (prior.fact_digest !== encoded.digest || !sameBytes(prior.fact_bytes, encoded.bytes)) {
      invalid("SERVICE_MOUNT_FACT_CONFLICT", `Service Mount ${name} fact differs from its replay`);
    }
    return;
  }
  if (context.mode === "advance") requireServiceMountAdvanceAuthority(before, context);
  if (context.mode === "settle" && name === "provisional") {
    requireServiceMountSettlementAuthority(
      before,
      context.coordinator,
      normalizePrivateServiceMountProvisional(value).classification,
    );
  }
  runFinalized(database, [
    "INSERT INTO service_mount_facts(mount_id, fact_name, fact_digest, fact_bytes)",
    "VALUES (?1, ?2, ?3, ?4)",
  ].join(" "), [before.allocation.mountId, name, encoded.digest, encoded.bytes]);
}

function encodeAndDigestServiceMountFact(
  name: ServiceMountFactName,
  value: unknown,
): { readonly bytes: Uint8Array; readonly digest: string } {
  switch (name) {
    case "plan": return { bytes: encodePrivateServiceMountPlan(value), digest: privateServiceMountPlanDigest(value) };
    case "backing": return { bytes: encodePrivateServiceMountBacking(value), digest: privateServiceMountBackingDigest(value) };
    case "sandbox": return { bytes: encodePrivateServiceMountSandbox(value), digest: privateServiceMountSandboxDigest(value) };
    case "prepared": return { bytes: encodePrivateServiceMountPrepared(value), digest: privateServiceMountPreparedDigest(value) };
    case "generation": return { bytes: encodePrivateServiceMountGeneration(value), digest: privateServiceMountGenerationDigest(value) };
    case "acknowledged": return { bytes: encodePrivateServiceMountAcknowledged(value), digest: privateServiceMountAcknowledgedDigest(value) };
    case "provisional": return { bytes: encodePrivateServiceMountProvisional(value), digest: privateServiceMountProvisionalDigest(value) };
    case "fence": return { bytes: encodePrivateServiceMountFence(value), digest: privateServiceMountFenceDigest(value) };
    case "release": return { bytes: encodePrivateServiceMountRelease(value), digest: privateServiceMountReleaseDigest(value) };
    case "closure": return { bytes: encodePrivateServiceMountClosure(value), digest: privateServiceMountClosureDigest(value) };
  }
}

function findServiceMountFactRow(
  database: SqliteDatabase,
  mountId: string,
  name: ServiceMountFactName,
): ServiceMountFactRow | null {
  const query = statement<ServiceMountFactRow>(database, [
    "SELECT mount_id, fact_name, fact_digest, fact_bytes FROM service_mount_facts",
    "WHERE mount_id = ?1 AND fact_name = ?2",
  ].join(" ")).safeIntegers(true);
  try {
    const row = query.get(mountId, name);
    return row === null ? null : copiedServiceMountFactRow(row);
  } finally { query.finalize(); }
}

function copiedServiceMountFactRow(row: ServiceMountFactRow): ServiceMountFactRow {
  return Object.freeze({
    mount_id: row.mount_id,
    fact_name: row.fact_name,
    fact_digest: row.fact_digest,
    fact_bytes: copiedBlob(row.fact_bytes, `stored Service Mount ${row.fact_name}`),
  });
}

function requireServiceMountFact<Value>(
  fact: PrivateServiceMountFact<Value> | undefined,
  name: string,
): PrivateServiceMountFact<Value> {
  if (fact === undefined) invalid("SERVICE_MOUNT_FACT_ORDER", `Service Mount ${name} fact is missing`);
  return fact;
}

function requireMountFactBase(
  snapshot: PrivateServiceMountSnapshot,
  mountId: string,
  allocationDigest: string,
  label: string,
): void {
  if (mountId !== snapshot.allocation.mountId || allocationDigest !== snapshot.allocationDigest) {
    corrupt(`Service Mount ${label} belongs to another Mount allocation`);
  }
}

function requireServiceMountFactOrder(
  snapshot: PrivateServiceMountSnapshot,
  name: ServiceMountFactName,
): void {
  if (serviceMountFact(snapshot, name) !== undefined) return;
  if (snapshot.closure !== undefined) {
    invalid("SERVICE_MOUNT_CLOSED", "Service Mount lifecycle is already closed");
  }
  if (name === "plan") {
    if (snapshot.provisional !== undefined || snapshot.backing !== undefined || snapshot.sandbox !== undefined ||
        snapshot.prepared !== undefined || snapshot.generation !== undefined || snapshot.acknowledged !== undefined ||
        snapshot.fence !== undefined || snapshot.release !== undefined) {
      invalid("SERVICE_MOUNT_FACT_ORDER", "Service Mount plan cannot be added after later evidence");
    }
    return;
  }
  if (name === "backing") {
    requireServiceMountFact(snapshot.plan, "plan");
    requireNoServiceMountSettlement(snapshot, "backing");
    if (snapshot.sandbox !== undefined || snapshot.prepared !== undefined || snapshot.generation !== undefined ||
        snapshot.acknowledged !== undefined) {
      invalid("SERVICE_MOUNT_FACT_ORDER", "Service Mount backing cannot follow later startup evidence");
    }
    return;
  }
  if (name === "sandbox") {
    requireServiceMountFact(snapshot.backing, "backing");
    requireNoServiceMountSettlement(snapshot, "sandbox");
    if (snapshot.prepared !== undefined || snapshot.generation !== undefined || snapshot.acknowledged !== undefined) {
      invalid("SERVICE_MOUNT_FACT_ORDER", "Service Mount sandbox cannot follow later startup evidence");
    }
    return;
  }
  if (name === "prepared") {
    requireServiceMountFact(snapshot.sandbox, "sandbox");
    requireNoServiceMountSettlement(snapshot, "prepared");
    if (snapshot.generation !== undefined || snapshot.acknowledged !== undefined) {
      invalid("SERVICE_MOUNT_FACT_ORDER", "Service Mount preparation cannot follow readiness evidence");
    }
    return;
  }
  if (name === "generation") {
    requireServiceMountFact(snapshot.prepared, "prepared");
    requireNoServiceMountSettlement(snapshot, "generation");
    if (snapshot.acknowledged !== undefined) {
      invalid("SERVICE_MOUNT_FACT_ORDER", "Service Mount generation cannot follow acknowledgement");
    }
    return;
  }
  if (name === "acknowledged") {
    requireServiceMountFact(snapshot.generation, "generation");
    requireNoServiceMountSettlement(snapshot, "acknowledgement");
    return;
  }
  if (name === "provisional") {
    if (snapshot.fence !== undefined || snapshot.release !== undefined) {
      invalid("SERVICE_MOUNT_FACT_ORDER", "Service Mount provisional terminal cannot follow cleanup evidence");
    }
    return;
  }
  if (name === "fence") {
    requireServiceMountFact(snapshot.plan, "plan");
    requireServiceMountFact(snapshot.provisional, "provisional");
    if (snapshot.release !== undefined) {
      invalid("SERVICE_MOUNT_FACT_ORDER", "Service Mount fence cannot follow release");
    }
    return;
  }
  if (name === "release") {
    requireServiceMountFact(snapshot.provisional, "provisional");
    if (snapshot.plan !== undefined) requireServiceMountFact(snapshot.fence, "fence");
    return;
  }
  requireServiceMountFact(snapshot.release, "release");
}

function requireLoadedServiceMountOrder(snapshot: PrivateServiceMountSnapshot): void {
  if (snapshot.plan === undefined) {
    if (snapshot.backing !== undefined || snapshot.sandbox !== undefined || snapshot.prepared !== undefined ||
        snapshot.generation !== undefined || snapshot.acknowledged !== undefined || snapshot.fence !== undefined) {
      corrupt("unplanned Service Mount contains resource lifecycle evidence");
    }
  } else {
    if (snapshot.sandbox !== undefined && snapshot.backing === undefined) {
      corrupt("Service Mount sandbox has no package backing");
    }
    if (snapshot.prepared !== undefined && snapshot.sandbox === undefined) {
      corrupt("Service Mount preparation has no sandbox owner");
    }
    if (snapshot.generation !== undefined && snapshot.prepared === undefined) {
      corrupt("Service Mount generation has no prepared owner");
    }
    if (snapshot.acknowledged !== undefined && snapshot.generation === undefined) {
      corrupt("Service Mount acknowledgement has no generation");
    }
  }
  if (snapshot.provisional === undefined &&
      (snapshot.fence !== undefined || snapshot.release !== undefined || snapshot.closure !== undefined)) {
    corrupt("Service Mount cleanup precedes its provisional terminal");
  }
  if (snapshot.fence !== undefined && snapshot.plan === undefined) {
    corrupt("Service Mount fence has no plan");
  }
  if (snapshot.release === undefined && snapshot.closure !== undefined) {
    corrupt("Service Mount closure has no release");
  }
}

function requireNoServiceMountSettlement(snapshot: PrivateServiceMountSnapshot, label: string): void {
  if (snapshot.provisional !== undefined || snapshot.fence !== undefined || snapshot.release !== undefined) {
    invalid("SERVICE_MOUNT_FACT_ORDER", `Service Mount ${label} cannot advance after settlement began`);
  }
}

function requireServiceMountAdvanceAuthority(
  snapshot: PrivateServiceMountSnapshot,
  context: ServiceMountTransitionContext,
): void {
  if (snapshot.coordinator !== "current") {
    invalid("SERVICE_MOUNT_OLD_COORDINATOR", "older Service Mounts may only be settled and released");
  }
  const head = readAdmissionHead(context.database, context.root);
  if (head.revision === null) {
    invalid("SERVICE_MOUNT_SUPERSEDED", "Service Mount admission is no longer active");
  }
  const active = requireAdmissionRow(context.database, head.revision);
  if (active.admission_digest !== snapshot.allocation.admissionDigest) {
    invalid("SERVICE_MOUNT_SUPERSEDED", "Service Mount admission was replaced before readiness");
  }
  loadAndCrossCheckAdmission(context.database, active, context.root);
}

function requireServiceMountTransitionRecipe(
  context: ServiceMountTransitionContext,
): PrivateBunServiceRecipe {
  if (context.recipe === undefined) corrupt("Service Mount forward transition lost its exact recipe");
  return context.recipe;
}

function requireServiceMountSettlementAuthority(
  snapshot: PrivateServiceMountSnapshot,
  coordinator: PrivateProjectCoordinator,
  classification: PrivateServiceMountClassification,
): void {
  if (snapshot.allocation.coordinatorEpoch > coordinator.epoch) {
    corrupt("Service Mount belongs to a future coordinator epoch");
  }
  if (snapshot.coordinator === "older" && classification !== "coordinator-loss") {
    invalid("SERVICE_MOUNT_RECOVERY_CLASSIFICATION", "older Service Mount requires coordinator-loss settlement");
  }
  if (snapshot.coordinator === "current" && classification === "coordinator-loss") {
    invalid("SERVICE_MOUNT_RECOVERY_CLASSIFICATION", "current coordinator cannot claim its own loss");
  }
}

function requireServiceMountFenceClassification(
  classification: PrivateServiceMountClassification,
  receipt: PrivateLinuxConfirmedEnforcementReceipt,
): void {
  const accepted: Readonly<Record<PrivateServiceMountClassification,
    readonly PrivateLinuxConfirmedEnforcementReceipt["stopReason"][]>> = Object.freeze({
      "startup-cancelled": ["cancelled", "setup_failed", "recovered"],
      "readiness-timeout": ["deadline", "cancelled", "recovered"],
      "host-lifetime": ["deadline", "cancelled", "payload_exit", "recovered"],
      "voluntary-exit": ["payload_exit", "recovered"],
      "provider-loss": ["payload_exit", "setup_failed", "deadline", "cancelled", "recovered"],
      "coordinator-loss": ["coordinator_lost", "recovered"],
    });
  if (!accepted[classification].includes(receipt.stopReason)) {
    corrupt(`Service Mount ${classification} fence has incompatible enforcement evidence`);
  }
}

function requireReleasedServiceLeases(
  database: SqliteDatabase,
  mount: PrivateServiceMountSnapshot,
  root: PrivateProjectRoot,
  coordinator: PrivateProjectCoordinator,
  candidate: PrivateActivationCandidateArtifactV5,
): readonly { readonly ownerRunId: string; readonly slot: string; readonly releaseDigest: string }[] {
  const query = statement<ServiceLeaseRow>(database, [
    "SELECT owner_run_id, slot, mount_id, generation_fact_name, generation_digest,",
    "acknowledged_fact_name, acknowledged_digest, allocation_digest, allocation_bytes,",
    "release_digest, release_bytes FROM service_leases ORDER BY owner_run_id, slot",
  ].join(" ")).safeIntegers(true);
  let rows: readonly ServiceLeaseRow[];
  try { rows = Object.freeze(query.all().map(copiedServiceLeaseRow)); }
  finally { query.finalize(); }
  return Object.freeze(rows.map((row) => {
    const allocation = loadServiceLeaseAllocation(row);
    if (allocation.mountId !== mount.allocation.mountId) return undefined;
    requireServiceLeaseAllocationCorrelation(
      database,
      allocation,
      row.allocation_digest,
      mount,
      root,
      coordinator,
      candidate,
    );
    const release = loadServiceLeaseReleaseFact(row);
    if (release === undefined) {
      invalid("SERVICE_LEASE_UNRELEASED", "Service Mount has an unreleased owner lease");
    }
    requireServiceLeaseReleaseCorrelation(
      database,
      allocation,
      row.allocation_digest,
      mount,
      release,
      root,
      coordinator,
      candidate,
    );
    return Object.freeze({
      ownerRunId: row.owner_run_id,
      slot: row.slot,
      releaseDigest: release.digest,
    });
  }).filter((reference) => reference !== undefined));
}

interface ServiceLeaseLink {
  readonly providerBinding: string;
  readonly providerExport: string;
  readonly contract: ContractIdentity;
}

interface NewServiceLeaseContext extends ServiceLeaseLink {
  readonly mount: PrivateServiceMountSnapshot;
  readonly generation: PrivateServiceMountFact<PrivateServiceMountGeneration>;
  readonly acknowledged: PrivateServiceMountFact<PrivateServiceMountAcknowledged>;
}

function requireServiceLeaseSlot(value: unknown): string {
  if (typeof value !== "string" || value.length > 64 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new TypeError("Service lease slot must be a LocalName");
  }
  return value;
}

function findServiceLease(
  database: SqliteDatabase,
  ownerRunId: string,
  slot: string,
): ServiceLeaseRow | null {
  const query = statement<ServiceLeaseRow>(database, [
    "SELECT owner_run_id, slot, mount_id, generation_fact_name, generation_digest,",
    "acknowledged_fact_name, acknowledged_digest, allocation_digest, allocation_bytes,",
    "release_digest, release_bytes FROM service_leases",
    "WHERE owner_run_id = ?1 AND slot = ?2",
  ].join(" ")).safeIntegers(true);
  try {
    const row = query.get(ownerRunId, slot);
    return row === null ? null : copiedServiceLeaseRow(row);
  } finally { query.finalize(); }
}

function requireServiceLease(
  database: SqliteDatabase,
  ownerRunId: string,
  slot: string,
): ServiceLeaseRow {
  const row = findServiceLease(database, ownerRunId, slot);
  if (row === null) unavailable("SERVICE_LEASE_MISSING", "Service lease does not exist");
  return row;
}

function listServiceLeaseRows(database: SqliteDatabase, ownerRunId: string): readonly ServiceLeaseRow[] {
  const query = statement<ServiceLeaseRow>(database, [
    "SELECT owner_run_id, slot, mount_id, generation_fact_name, generation_digest,",
    "acknowledged_fact_name, acknowledged_digest, allocation_digest, allocation_bytes,",
    "release_digest, release_bytes FROM service_leases",
    "WHERE owner_run_id = ?1 ORDER BY slot",
  ].join(" ")).safeIntegers(true);
  try { return Object.freeze(query.all(ownerRunId).map(copiedServiceLeaseRow)); }
  finally { query.finalize(); }
}

function copiedServiceLeaseRow(row: ServiceLeaseRow): ServiceLeaseRow {
  return Object.freeze({
    owner_run_id: row.owner_run_id,
    slot: row.slot,
    mount_id: row.mount_id,
    generation_fact_name: row.generation_fact_name,
    generation_digest: row.generation_digest,
    acknowledged_fact_name: row.acknowledged_fact_name,
    acknowledged_digest: row.acknowledged_digest,
    allocation_digest: row.allocation_digest,
    allocation_bytes: copiedBlob(row.allocation_bytes, "stored Service lease allocation"),
    release_digest: row.release_digest,
    release_bytes: copiedOptionalBlob(row.release_bytes, "stored Service lease release"),
  });
}

function loadServiceLeaseAllocation(row: ServiceLeaseRow): PrivateServiceLeaseAllocation {
  requireDigest(row.owner_run_id, "stored Service lease owner Run");
  const slot = requireServiceLeaseSlot(row.slot);
  requireDigest(row.mount_id, "stored Service lease Mount");
  requireDigest(row.generation_digest, "stored Service lease generation");
  requireDigest(row.acknowledged_digest, "stored Service lease acknowledgement");
  requireDigest(row.allocation_digest, "stored Service lease allocation");
  if (row.generation_fact_name !== "generation" || row.acknowledged_fact_name !== "acknowledged") {
    corrupt("stored Service lease fact names are invalid");
  }
  const bytes = copiedBlob(row.allocation_bytes, "stored Service lease allocation");
  requireStoredSize(bytes, "stored Service lease allocation");
  let allocation: PrivateServiceLeaseAllocation;
  try { allocation = decodePrivateServiceLeaseAllocation(bytes); }
  catch { corrupt("stored Service lease allocation is invalid"); }
  if (!sameBytes(bytes, encodePrivateServiceLeaseAllocation(allocation)) ||
      privateServiceLeaseAllocationDigest(allocation) !== row.allocation_digest ||
      allocation.ownerRunId !== row.owner_run_id || allocation.slot !== slot ||
      allocation.mountId !== row.mount_id || allocation.generationDigest !== row.generation_digest ||
      allocation.acknowledgedDigest !== row.acknowledged_digest) {
    corrupt("stored Service lease allocation differs from its durable identity");
  }
  return allocation;
}

function loadServiceLeaseReleaseFact(
  row: ServiceLeaseRow,
): PrivateServiceMountFact<PrivateServiceLeaseRelease> | undefined {
  if ((row.release_digest === null) !== (row.release_bytes === null)) {
    corrupt("stored Service lease release columns are incomplete");
  }
  if (row.release_digest === null || row.release_bytes === null) return undefined;
  requireDigest(row.release_digest, "stored Service lease release");
  const bytes = copiedBlob(row.release_bytes, "stored Service lease release");
  requireStoredSize(bytes, "stored Service lease release");
  let value: PrivateServiceLeaseRelease;
  try { value = decodePrivateServiceLeaseRelease(bytes); }
  catch { corrupt("stored Service lease release is invalid"); }
  if (!sameBytes(bytes, encodePrivateServiceLeaseRelease(value)) ||
      privateServiceLeaseReleaseDigest(value) !== row.release_digest ||
      value.ownerRunId !== row.owner_run_id || value.slot !== row.slot ||
      value.allocationDigest !== row.allocation_digest) {
    corrupt("stored Service lease release differs from its durable identity");
  }
  return Object.freeze({ digest: row.release_digest, value });
}

function requireServiceLeaseReleaseCorrelation(
  database: SqliteDatabase,
  allocation: PrivateServiceLeaseAllocation,
  allocationDigest: string,
  mount: PrivateServiceMountSnapshot,
  release: PrivateServiceMountFact<PrivateServiceLeaseRelease>,
  root: PrivateProjectRoot,
  coordinator: PrivateProjectCoordinator,
  candidate: PrivateActivationCandidateArtifactV5,
): void {
  if (release.value.ownerRunId !== allocation.ownerRunId ||
      release.value.slot !== allocation.slot ||
      release.value.allocationDigest !== allocationDigest) {
    corrupt("stored Service lease release differs from its allocation");
  }
  if (!sameCanonical(
        release.value.invocations,
        serviceInvocationClosureReferences(
          database,
          allocation,
          allocationDigest,
          mount,
          root,
          coordinator,
          candidate,
        ),
      )) {
    corrupt("stored Service lease release differs from its owner, Mount, or invocation closures");
  }
  if (release.value.reason === "owner-closed") {
    if (release.value.mountFenceDigest !== null) {
      corrupt("owner-closed Service lease release carries Mount fence evidence");
    }
    return;
  }
  const fence = requireServiceMountFact(mount.fence, "fence");
  if (release.value.mountFenceDigest !== fence.digest) {
    corrupt("stored Service lease release differs from its Mount fence");
  }
  if (!serviceLeaseMountReasonMatches(release.value.reason, mount)) {
    corrupt(`stored Service lease ${release.value.reason} release conflicts with its Mount terminal`);
  }
}

function serviceLeaseMountReasonMatches(
  reason: Exclude<PrivateServiceLeaseRelease["reason"], "owner-closed">,
  mount: PrivateServiceMountSnapshot,
): boolean {
  const classification = requireServiceMountFact(mount.provisional, "provisional").value.classification;
  return reason === "provider-lost"
    ? classification === "provider-loss" || classification === "coordinator-loss"
    : classification === "host-lifetime" || classification === "voluntary-exit";
}

function requireServiceLeaseLink(
  candidate: PrivateActivationCandidateArtifactV5,
  ownerTarget: RunTargetIdentity,
  slot: string,
): ServiceLeaseLink {
  if (ownerTarget.kind !== "binding") {
    invalid("SERVICE_LEASE_SLOT_UNAVAILABLE", "root Flow target has no bound capability slots");
  }
  const ownerBinding = candidate.lock.bindings[ownerTarget.id];
  const ownerPackage = ownerBinding === undefined
    ? undefined
    : candidate.lock.packages[ownerBinding.packagePath];
  const linked = ownerBinding?.slots[slot];
  const required = ownerPackage?.uses[slot];
  if (ownerBinding === undefined || ownerPackage === undefined || linked?.kind !== "capability" ||
      required?.kind !== "contract") {
    invalid("SERVICE_LEASE_SLOT_UNAVAILABLE", "owner Run does not bind the requested capability slot");
  }
  const admittedTarget = findPrivateActivationCandidateTargetV5(candidate, ownerTarget);
  const admittedSlot = admittedTarget?.request.slots[slot];
  const contract = Object.freeze({ id: required.id, version: required.version, digest: required.digest });
  if (admittedTarget === undefined || admittedTarget.request.mode !== "run" ||
      admittedTarget.disposition.state !== "ready" || admittedSlot?.kind !== "capability" ||
      admittedSlot.provider.binding !== linked.provider.binding ||
      admittedSlot.provider.export !== linked.provider.export ||
      !sameCanonical(admittedSlot.contract, contract)) {
    corrupt("Service lease owner request differs from its candidate lock");
  }
  const providerBinding = candidate.lock.bindings[linked.provider.binding];
  const providerPackage = providerBinding === undefined
    ? undefined
    : candidate.lock.packages[providerBinding.packagePath];
  const provided = providerPackage?.provides[linked.provider.export];
  if (providerBinding === undefined || providerPackage?.mode !== "service" || provided === undefined ||
      !sameCanonical(contract, provided)) {
    corrupt("Service lease provider link differs from its candidate lock");
  }
  return Object.freeze({
    providerBinding: linked.provider.binding,
    providerExport: linked.provider.export,
    contract,
  });
}

function loadServiceLeaseSnapshot(
  database: SqliteDatabase,
  row: ServiceLeaseRow,
  root: PrivateProjectRoot,
  coordinator: PrivateProjectCoordinator,
  candidate: PrivateActivationCandidateArtifactV5,
): PrivateServiceLeaseSnapshot {
  const allocation = loadServiceLeaseAllocation(row);
  const mount = loadServiceMountSnapshot(
    database,
    requireServiceMountRow(database, allocation.mountId),
    root,
    coordinator,
    candidate,
  );
  requireServiceLeaseAllocationCorrelation(
    database,
    allocation,
    row.allocation_digest,
    mount,
    root,
    coordinator,
    candidate,
  );
  const release = loadServiceLeaseReleaseFact(row);
  if (release !== undefined) {
    requireServiceLeaseReleaseCorrelation(
      database,
      allocation,
      row.allocation_digest,
      mount,
      release,
      root,
      coordinator,
      candidate,
    );
  }
  return Object.freeze({
    allocation,
    allocationDigest: row.allocation_digest,
    coordinator: allocation.coordinatorEpoch === coordinator.epoch ? "current" : "older",
    ...(release === undefined ? {} : { release }),
  });
}

function requireServiceLeaseAllocationCorrelation(
  database: SqliteDatabase,
  allocation: PrivateServiceLeaseAllocation,
  allocationDigest: string,
  mount: PrivateServiceMountSnapshot,
  root: PrivateProjectRoot,
  coordinator: PrivateProjectCoordinator,
  candidate: PrivateActivationCandidateArtifactV5,
): PrivateRootRunSnapshot {
  requireDigest(allocationDigest, "stored Service lease allocation");
  if (allocation.coordinatorEpoch > coordinator.epoch) {
    corrupt("Service lease belongs to a future coordinator epoch");
  }
  const ownerRow = requireRootRunRow(database, allocation.ownerRunId);
  const ownerRun = loadRootRunSnapshot(database, ownerRow, root);
  if (ownerRow.candidate_revision !== BigInt(ownerRun.candidateRevision) ||
      ownerRun.coordinatorEpoch !== allocation.coordinatorEpoch) {
    corrupt("stored Service lease owner differs from its pinned Run");
  }
  const ownerCandidate = loadCandidateRow(requireCandidateRow(database, ownerRow.candidate_revision));
  requireCandidateRoot(ownerCandidate, root);
  if (privateActivationCandidateDigestV5(ownerCandidate) !== privateActivationCandidateDigestV5(candidate)) {
    corrupt("stored Service lease owner differs from its Mount candidate");
  }
  const link = requireServiceLeaseLink(candidate, ownerRun.target, allocation.slot);
  const generation = requireServiceMountFact(mount.generation, "generation");
  const acknowledged = requireServiceMountFact(mount.acknowledged, "acknowledged");
  if (allocation.providerBinding !== link.providerBinding ||
      allocation.providerExport !== link.providerExport ||
      !sameCanonical(allocation.contract, link.contract) ||
      mount.allocation.admissionDigest !== ownerRun.admissionDigest ||
      allocation.mountId !== mount.allocation.mountId ||
      allocation.coordinatorEpoch !== mount.allocation.coordinatorEpoch ||
      mount.allocation.bindingId !== allocation.providerBinding ||
      mount.allocationDigest !== allocation.mountAllocationDigest ||
      generation.digest !== allocation.generationDigest ||
      generation.value.generationId !== allocation.generationId ||
      acknowledged.digest !== allocation.acknowledgedDigest ||
      acknowledged.value.generationDigest !== generation.digest ||
      !generation.value.exports.includes(allocation.providerExport)) {
    corrupt("stored Service lease differs from its owner or acknowledged provider generation");
  }
  return ownerRun;
}

function requireNewServiceLeaseContext(
  database: SqliteDatabase,
  ownerRow: RootRunRow,
  root: PrivateProjectRoot,
  coordinator: PrivateProjectCoordinator,
  candidate: PrivateActivationCandidateArtifactV5,
  artifacts: ReacquiredArtifacts,
  slot: string,
): NewServiceLeaseContext {
  const ownerRun = loadRootRunSnapshot(database, ownerRow, root);
  if (ownerRun.state !== "spawn-intent" || ownerRun.coordinatorEpoch !== coordinator.epoch) {
    invalid("SERVICE_LEASE_OWNER_INACTIVE", "new Service lease requires a live current-coordinator owner Run");
  }
  const lifecycle = loadRootExecutionLifecycle(
    database,
    requireRootExecutionLifecycle(database, ownerRun.runId),
    ownerRow,
  );
  if (lifecycle.provisional !== undefined || lifecycle.fence !== undefined ||
      lifecycle.release !== undefined || lifecycle.admitted !== undefined ||
      lifecycle.closureDigest !== undefined) {
    invalid("SERVICE_LEASE_OWNER_SETTLING", "settling owner Run cannot acquire a new Service lease");
  }
  const link = requireServiceLeaseLink(candidate, ownerRun.target, slot);
  const mountRow = findServiceMountByAdmissionBinding(
    database,
    ownerRun.admissionDigest,
    link.providerBinding,
  );
  if (mountRow === null) unavailable("SERVICE_PROVIDER_UNAVAILABLE", "capability provider has no Service Mount");
  const mount = loadServiceMountSnapshot(database, mountRow, root, coordinator, candidate, artifacts);
  const generation = mount.generation;
  const acknowledged = mount.acknowledged;
  if (mount.coordinator !== "current" || generation === undefined || acknowledged === undefined ||
      mount.provisional !== undefined || mount.fence !== undefined || mount.release !== undefined ||
      mount.closure !== undefined || !generation.value.exports.includes(link.providerExport)) {
    unavailable("SERVICE_PROVIDER_UNAVAILABLE", "capability provider is not an active acknowledged generation");
  }
  return Object.freeze({ ...link, mount, generation, acknowledged });
}

function findServiceInvocation(
  database: SqliteDatabase,
  ownerRunId: string,
  operationId: string,
): ServiceInvocationRow | null {
  const query = statement<ServiceInvocationRow>(database, [
    "SELECT owner_run_id, operation_id, slot, request_digest, allocation_digest, allocation_bytes,",
    "dispatch_digest, dispatch_bytes, terminal_digest, terminal_bytes, closure_digest, closure_bytes",
    "FROM service_invocations WHERE owner_run_id = ?1 AND operation_id = ?2",
  ].join(" ")).safeIntegers(true);
  try {
    const row = query.get(ownerRunId, operationId);
    return row === null ? null : copiedServiceInvocationRow(row);
  } finally { query.finalize(); }
}

function requireServiceInvocation(
  database: SqliteDatabase,
  ownerRunId: string,
  operationId: string,
): ServiceInvocationRow {
  const row = findServiceInvocation(database, ownerRunId, operationId);
  if (row === null) unavailable("SERVICE_INVOCATION_MISSING", "Service invocation does not exist");
  return row;
}

function listServiceInvocationRows(
  database: SqliteDatabase,
  ownerRunId: string,
): readonly ServiceInvocationRow[] {
  const query = statement<ServiceInvocationRow>(database, [
    "SELECT owner_run_id, operation_id, slot, request_digest, allocation_digest, allocation_bytes,",
    "dispatch_digest, dispatch_bytes, terminal_digest, terminal_bytes, closure_digest, closure_bytes",
    "FROM service_invocations WHERE owner_run_id = ?1 ORDER BY operation_id",
  ].join(" ")).safeIntegers(true);
  try { return Object.freeze(query.all(ownerRunId).map(copiedServiceInvocationRow)); }
  finally { query.finalize(); }
}

function listAllServiceInvocationRows(database: SqliteDatabase): readonly ServiceInvocationRow[] {
  const query = statement<ServiceInvocationRow>(database, [
    "SELECT owner_run_id, operation_id, slot, request_digest, allocation_digest, allocation_bytes,",
    "dispatch_digest, dispatch_bytes, terminal_digest, terminal_bytes, closure_digest, closure_bytes",
    "FROM service_invocations ORDER BY owner_run_id, operation_id",
  ].join(" ")).safeIntegers(true);
  try { return Object.freeze(query.all().map(copiedServiceInvocationRow)); }
  finally { query.finalize(); }
}

function copiedServiceInvocationRow(row: ServiceInvocationRow): ServiceInvocationRow {
  return Object.freeze({
    owner_run_id: row.owner_run_id,
    operation_id: row.operation_id,
    slot: row.slot,
    request_digest: row.request_digest,
    allocation_digest: row.allocation_digest,
    allocation_bytes: copiedBlob(row.allocation_bytes, "stored Service invocation allocation"),
    dispatch_digest: row.dispatch_digest,
    dispatch_bytes: copiedOptionalBlob(row.dispatch_bytes, "stored Service invocation dispatch"),
    terminal_digest: row.terminal_digest,
    terminal_bytes: copiedOptionalBlob(row.terminal_bytes, "stored Service invocation terminal"),
    closure_digest: row.closure_digest,
    closure_bytes: copiedOptionalBlob(row.closure_bytes, "stored Service invocation closure"),
  });
}

interface LoadedServiceInvocationProgress {
  readonly allocation: PrivateServiceInvocationAllocation;
  readonly dispatch?: PrivateServiceMountFact<PrivateServiceInvocationDispatch>;
  readonly terminal?: PrivateServiceMountFact<PrivateServiceInvocationTerminal>;
  readonly closure?: PrivateServiceMountFact<PrivateServiceInvocationClosure>;
}

function loadServiceInvocationProgress(row: ServiceInvocationRow): LoadedServiceInvocationProgress {
  requireDigest(row.owner_run_id, "stored Service invocation owner Run");
  requireWireId(row.operation_id, "stored Service invocation operation ID");
  const slot = requireServiceLeaseSlot(row.slot);
  requireDigest(row.request_digest, "stored Service invocation request");
  requireDigest(row.allocation_digest, "stored Service invocation allocation");
  if ((row.dispatch_digest === null) !== (row.dispatch_bytes === null) ||
      (row.terminal_digest === null) !== (row.terminal_bytes === null) ||
      (row.closure_digest === null) !== (row.closure_bytes === null) ||
      (row.terminal_digest === null) !== (row.closure_digest === null)) {
    corrupt("stored Service invocation progress columns are incomplete");
  }
  const bytes = copiedBlob(row.allocation_bytes, "stored Service invocation allocation");
  requireStoredSize(bytes, "stored Service invocation allocation");
  let allocation: PrivateServiceInvocationAllocation;
  try { allocation = decodePrivateServiceInvocationAllocation(bytes); }
  catch { corrupt("stored Service invocation allocation is invalid"); }
  if (!sameBytes(bytes, encodePrivateServiceInvocationAllocation(allocation)) ||
      privateServiceInvocationAllocationDigest(allocation) !== row.allocation_digest ||
      allocation.ownerRunId !== row.owner_run_id || allocation.call.operationId !== row.operation_id ||
      allocation.call.slot !== slot || allocation.requestDigest !== row.request_digest) {
    corrupt("stored Service invocation allocation differs from its durable identity");
  }
  const dispatch = loadServiceInvocationFact(
    row.dispatch_digest,
    row.dispatch_bytes,
    "dispatch",
    decodePrivateServiceInvocationDispatch,
    encodePrivateServiceInvocationDispatch,
    privateServiceInvocationDispatchDigest,
  );
  const terminal = loadServiceInvocationFact(
    row.terminal_digest,
    row.terminal_bytes,
    "terminal",
    decodePrivateServiceInvocationTerminal,
    encodePrivateServiceInvocationTerminal,
    privateServiceInvocationTerminalDigest,
  );
  const closure = loadServiceInvocationFact(
    row.closure_digest,
    row.closure_bytes,
    "closure",
    decodePrivateServiceInvocationClosure,
    encodePrivateServiceInvocationClosure,
    privateServiceInvocationClosureDigest,
  );
  if (dispatch !== undefined && (dispatch.value.ownerRunId !== allocation.ownerRunId ||
      dispatch.value.operationId !== allocation.call.operationId ||
      dispatch.value.allocationDigest !== row.allocation_digest)) {
    corrupt("stored Service invocation dispatch differs from its allocation");
  }
  if (terminal !== undefined && (terminal.value.ownerRunId !== allocation.ownerRunId ||
      terminal.value.operationId !== allocation.call.operationId ||
      terminal.value.allocationDigest !== row.allocation_digest ||
      terminal.value.dispatchDigest !== (dispatch?.digest ?? null))) {
    corrupt("stored Service invocation terminal differs from its allocation and dispatch");
  }
  if (closure !== undefined && (terminal === undefined ||
      closure.value.ownerRunId !== allocation.ownerRunId ||
      closure.value.operationId !== allocation.call.operationId ||
      closure.value.allocationDigest !== row.allocation_digest ||
      closure.value.dispatchDigest !== terminal.value.dispatchDigest ||
      closure.value.terminalDigest !== terminal.digest)) {
    corrupt("stored Service invocation closure differs from its terminal");
  }
  return Object.freeze({
    allocation,
    ...(dispatch === undefined ? {} : { dispatch }),
    ...(terminal === undefined ? {} : { terminal }),
    ...(closure === undefined ? {} : { closure }),
  });
}

function serviceInvocationClosureReferences(
  database: SqliteDatabase,
  leaseAllocation: PrivateServiceLeaseAllocation,
  leaseDigest: string,
  mount: PrivateServiceMountSnapshot,
  root: PrivateProjectRoot,
  coordinator: PrivateProjectCoordinator,
  candidate: PrivateActivationCandidateArtifactV5,
): readonly { readonly operationId: string; readonly closureDigest: string }[] {
  return Object.freeze(listAllServiceInvocationRows(database)
    .map((row) => {
      const progress = loadServiceInvocationProgress(row);
      if (progress.allocation.ownerRunId !== leaseAllocation.ownerRunId) return undefined;
      if (progress.allocation.call.slot !== leaseAllocation.slot) return undefined;
      requireServiceInvocationAllocationCorrelation(
        database,
        progress.allocation,
        leaseAllocation,
        leaseDigest,
        mount,
        root,
        coordinator,
        candidate,
      );
      if (progress.closure === undefined) {
        invalid("SERVICE_INVOCATION_UNCLOSED", "Service lease has an unresolved invocation");
      }
      return Object.freeze({
        operationId: progress.allocation.call.operationId,
        closureDigest: progress.closure.digest,
      });
    })
    .filter((reference) => reference !== undefined));
}

function loadServiceInvocationSnapshot(
  database: SqliteDatabase,
  row: ServiceInvocationRow,
  root: PrivateProjectRoot,
  coordinator: PrivateProjectCoordinator,
): PrivateServiceInvocationSnapshot {
  const progress = loadServiceInvocationProgress(row);
  const { allocation, dispatch, terminal, closure } = progress;
  const ownerRow = requireRootRunRow(database, allocation.ownerRunId);
  const candidate = loadCandidateRow(requireCandidateRow(database, ownerRow.candidate_revision));
  requireCandidateRoot(candidate, root);
  const lease = loadServiceLeaseSnapshot(
    database,
    requireServiceLease(database, allocation.ownerRunId, allocation.call.slot),
    root,
    coordinator,
    candidate,
  );
  const mount = loadServiceMountSnapshot(
    database,
    requireServiceMountRow(database, lease.allocation.mountId),
    root,
    coordinator,
    candidate,
  );
  requireServiceInvocationAllocationCorrelation(
    database,
    allocation,
    lease.allocation,
    lease.allocationDigest,
    mount,
    root,
    coordinator,
    candidate,
  );
  return Object.freeze({
    allocation,
    allocationDigest: row.allocation_digest,
    coordinator: allocation.coordinatorEpoch === coordinator.epoch ? "current" : "older",
    ...(dispatch === undefined ? {} : { dispatch }),
    ...(terminal === undefined ? {} : { terminal }),
    ...(closure === undefined ? {} : { closure }),
  });
}

function requireServiceInvocationAllocationCorrelation(
  database: SqliteDatabase,
  allocation: PrivateServiceInvocationAllocation,
  leaseAllocation: PrivateServiceLeaseAllocation,
  leaseDigest: string,
  mount: PrivateServiceMountSnapshot,
  root: PrivateProjectRoot,
  coordinator: PrivateProjectCoordinator,
  candidate: PrivateActivationCandidateArtifactV5,
): void {
  if (allocation.coordinatorEpoch > coordinator.epoch) {
    corrupt("Service invocation belongs to a future coordinator epoch");
  }
  const ownerRun = requireServiceLeaseAllocationCorrelation(
    database,
    leaseAllocation,
    leaseDigest,
    mount,
    root,
    coordinator,
    candidate,
  );
  if (allocation.ownerRunId !== leaseAllocation.ownerRunId ||
      ownerRun.coordinatorEpoch !== allocation.coordinatorEpoch ||
      allocation.leaseDigest !== leaseDigest ||
      allocation.mountId !== leaseAllocation.mountId ||
      allocation.generationId !== leaseAllocation.generationId ||
      allocation.exportName !== leaseAllocation.providerExport ||
      allocation.call.slot !== leaseAllocation.slot ||
      allocation.deadlineUnixMs !== Math.min(
        ownerRun.deadlineUnixMs,
        mount.allocation.effectiveDeadlineUnixMs,
      )) {
    corrupt("stored Service invocation differs from its owner, lease, generation, export, or deadline");
  }
}

function writeServiceInvocationTerminal(
  database: SqliteDatabase,
  before: PrivateServiceInvocationSnapshot,
  observation: PrivateServiceInvocationObservation,
  allowOlderCoordinator: boolean,
): void {
  const dispatchDigest = observation.source === "host-prewrite"
    ? before.dispatch?.digest ?? null
    : requireServiceInvocationDispatch(before).digest;
  const terminal = normalizePrivateServiceInvocationTerminal({
    kind: "private-service-invocation-terminal/1",
    ownerRunId: before.allocation.ownerRunId,
    operationId: before.allocation.call.operationId,
    allocationDigest: before.allocationDigest,
    dispatchDigest,
    observation,
  });
  const terminalBytes = encodePrivateServiceInvocationTerminal(terminal);
  const terminalDigest = privateServiceInvocationTerminalDigest(terminal);
  const closure = normalizePrivateServiceInvocationClosure({
    kind: "private-service-invocation-closure/1",
    ownerRunId: before.allocation.ownerRunId,
    operationId: before.allocation.call.operationId,
    allocationDigest: before.allocationDigest,
    dispatchDigest,
    terminalDigest,
  });
  const closureBytes = encodePrivateServiceInvocationClosure(closure);
  const closureDigest = privateServiceInvocationClosureDigest(closure);
  requireStoredSize(terminalBytes, "Service invocation terminal");
  requireStoredSize(closureBytes, "Service invocation closure");
  if (before.terminal !== undefined || before.closure !== undefined) {
    if (before.terminal?.digest !== terminalDigest || before.closure?.digest !== closureDigest ||
        !sameCanonical(before.terminal.value, terminal) ||
        !sameCanonical(before.closure.value, closure)) {
      invalid("OPERATION_CONFLICT", "Service operation already has a different terminal");
    }
    return;
  }
  if (!allowOlderCoordinator && before.coordinator !== "current") {
    invalid("SERVICE_INVOCATION_OWNER_INACTIVE", "older coordinator operation cannot gain a terminal here");
  }
  const changed = runFinalized(database, [
    "UPDATE service_invocations SET terminal_digest = ?1, terminal_bytes = ?2,",
    "closure_digest = ?3, closure_bytes = ?4",
    "WHERE owner_run_id = ?5 AND operation_id = ?6",
    "AND terminal_digest IS NULL AND closure_digest IS NULL",
  ].join(" "), [
    terminalDigest,
    terminalBytes,
    closureDigest,
    closureBytes,
    before.allocation.ownerRunId,
    before.allocation.call.operationId,
  ]).changes;
  if (changed !== 1) corrupt("Service invocation terminal compare-and-set failed");
}

function loadServiceInvocationFact<Value>(
  storedDigest: string | null,
  storedBytes: Uint8Array | null,
  label: string,
  decode: (bytes: Uint8Array) => Value,
  encode: (value: unknown) => Uint8Array,
  digest: (value: unknown) => string,
): PrivateServiceMountFact<Value> | undefined {
  if (storedDigest === null || storedBytes === null) return undefined;
  requireDigest(storedDigest, `stored Service invocation ${label}`);
  const bytes = copiedBlob(storedBytes, `stored Service invocation ${label}`);
  requireStoredSize(bytes, `stored Service invocation ${label}`);
  let value: Value;
  try { value = decode(bytes); }
  catch { corrupt(`stored Service invocation ${label} is invalid`); }
  if (!sameBytes(bytes, encode(value)) || digest(value) !== storedDigest) {
    corrupt(`stored Service invocation ${label} differs from its durable identity`);
  }
  return Object.freeze({ digest: storedDigest, value });
}

function requireCreatedServiceInvocationAllocation(
  value: unknown,
): PrivateServiceInvocationAllocationResult {
  if (value === null || typeof value !== "object" ||
      !authenticCreatedServiceInvocationAllocations.has(value) ||
      (value as PrivateServiceInvocationAllocationResult).created !== true) {
    throw new TypeError("Service invocation allocation did not create dispatch ownership");
  }
  return value as PrivateServiceInvocationAllocationResult;
}

function requireServiceInvocationDispatch(
  snapshot: PrivateServiceInvocationSnapshot,
): PrivateServiceMountFact<PrivateServiceInvocationDispatch> {
  if (snapshot.dispatch === undefined) {
    invalid("SERVICE_INVOCATION_UNDISPATCHED", "Service invocation was not admitted for dispatch");
  }
  return snapshot.dispatch;
}

function requireNewServiceInvocationContext(
  database: SqliteDatabase,
  root: PrivateProjectRoot,
  coordinator: PrivateProjectCoordinator,
  ownerRunId: string,
  slot: string,
): {
  readonly owner: PrivateRootRunSnapshot;
  readonly lease: PrivateServiceLeaseSnapshot;
  readonly mount: PrivateServiceMountSnapshot;
} {
  const ownerRow = requireRootRunRow(database, ownerRunId);
  const owner = loadRootRunSnapshot(database, ownerRow, root);
  if (owner.state !== "spawn-intent" || owner.coordinatorEpoch !== coordinator.epoch) {
    invalid(
      "SERVICE_INVOCATION_OWNER_INACTIVE",
      "new Service invocation requires a live current-coordinator owner Run",
    );
  }
  const lifecycle = loadRootExecutionLifecycle(
    database,
    requireRootExecutionLifecycle(database, ownerRunId),
    ownerRow,
  );
  if (lifecycle.provisional !== undefined || lifecycle.fence !== undefined ||
      lifecycle.release !== undefined || lifecycle.admitted !== undefined ||
      lifecycle.closureDigest !== undefined) {
    invalid("SERVICE_INVOCATION_OWNER_SETTLING", "settling owner Run cannot allocate a Service operation");
  }
  const candidate = loadCandidateRow(requireCandidateRow(database, ownerRow.candidate_revision));
  requireCandidateRoot(candidate, root);
  const lease = loadServiceLeaseSnapshot(
    database,
    requireServiceLease(database, ownerRunId, requireServiceLeaseSlot(slot)),
    root,
    coordinator,
    candidate,
  );
  const mount = loadServiceMountSnapshot(
    database,
    requireServiceMountRow(database, lease.allocation.mountId),
    root,
    coordinator,
    candidate,
  );
  if (lease.coordinator !== "current" || lease.release !== undefined || mount.coordinator !== "current" ||
      mount.generation?.digest !== lease.allocation.generationDigest ||
      mount.acknowledged?.digest !== lease.allocation.acknowledgedDigest ||
      mount.provisional !== undefined || mount.fence !== undefined ||
      mount.release !== undefined || mount.closure !== undefined) {
    unavailable("SERVICE_PROVIDER_UNAVAILABLE", "Service lease provider generation is not active");
  }
  return Object.freeze({ owner, lease, mount });
}

function preparedIdentityForServiceSandbox(
  ownerValue: PrivateLinuxSealedOwnerIdentity,
): PrivateLinuxPreparedOwnerIdentity {
  const owner = normalizePrivateLinuxSealedOwnerIdentity(ownerValue);
  return normalizePrivateLinuxPreparedOwnerIdentity({
    kind: "private-linux-prepared-owner/1",
    digest: privateDomainDigest(
      "JIG-Private-Linux-Prepared-Owner/1",
      owner as unknown as JsonValue,
    ),
    owner,
  });
}

function serviceMountProtectedRoots(root: PrivateProjectRoot): {
  readonly materializations: string;
  readonly owners: string;
} {
  const state = join(root.requestedPath, STATE_DIRECTORY);
  return Object.freeze({
    materializations: join(state, "private-root-materializations"),
    owners: join(state, "private-root-linux-owners"),
  });
}

function serviceMountHex(mountId: string): string {
  requireDigest(mountId, "Service Mount");
  return mountId.slice("sha256:".length);
}

function serviceMountRunId(mountId: string): string {
  return `service-${serviceMountHex(mountId).slice(0, 40)}`;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return sameBytes(canonicalJson(left as JsonValue), canonicalJson(right as JsonValue));
}

function decodeProtectedRecord<Value>(label: string, decode: () => Value): Value {
  try { return decode(); }
  catch (error) {
    if (error instanceof Json1Error || error instanceof TypeError) {
      corrupt(`${label} is not a valid canonical protected value`);
    }
    throw error;
  }
}

function serviceMountFact(
  snapshot: PrivateServiceMountSnapshot,
  name: ServiceMountFactName,
): PrivateServiceMountFact<unknown> | undefined {
  return snapshot[name] as PrivateServiceMountFact<unknown> | undefined;
}

function isServiceMountFactName(value: unknown): value is ServiceMountFactName {
  return value === "plan" || value === "backing" || value === "sandbox" || value === "prepared" ||
    value === "generation" || value === "acknowledged" || value === "provisional" ||
    value === "fence" || value === "release" || value === "closure";
}

function findServiceMountByAdmissionBinding(
  database: SqliteDatabase,
  admissionDigest: string,
  bindingId: string,
): ServiceMountRow | null {
  const query = statement<ServiceMountRow>(database, [
    "SELECT mount_id, binding_id, admission_digest, coordinator_epoch, allocation_digest, allocation_bytes",
    "FROM service_mounts WHERE admission_digest = ?1 AND binding_id = ?2",
  ].join(" ")).safeIntegers(true);
  let rows: readonly ServiceMountRow[];
  try { rows = query.all(admissionDigest, bindingId).map(copiedServiceMountRow); }
  finally { query.finalize(); }
  if (rows.length > 1) corrupt("one admission and Service Binding name multiple Mount allocations");
  return rows[0] ?? null;
}

function requireServiceMountRow(database: SqliteDatabase, mountId: string): ServiceMountRow {
  const query = statement<ServiceMountRow>(database, [
    "SELECT mount_id, binding_id, admission_digest, coordinator_epoch, allocation_digest, allocation_bytes",
    "FROM service_mounts WHERE mount_id = ?1",
  ].join(" ")).safeIntegers(true);
  let rows: readonly ServiceMountRow[];
  try { rows = query.all(mountId).map(copiedServiceMountRow); }
  finally { query.finalize(); }
  if (rows.length === 0) unavailable("SERVICE_MOUNT_MISSING", "Service Mount does not exist");
  if (rows.length !== 1) corrupt("Service Mount identity is duplicated");
  return rows[0]!;
}

function copiedServiceMountRow(row: ServiceMountRow): ServiceMountRow {
  return Object.freeze({
    mount_id: row.mount_id,
    binding_id: row.binding_id,
    admission_digest: row.admission_digest,
    coordinator_epoch: row.coordinator_epoch,
    allocation_digest: row.allocation_digest,
    allocation_bytes: copiedBlob(row.allocation_bytes, "stored Service Mount allocation"),
  });
}

function requireSameServiceMountRow(left: ServiceMountRow, right: ServiceMountRow): void {
  if (left.mount_id !== right.mount_id || left.binding_id !== right.binding_id ||
      left.admission_digest !== right.admission_digest ||
      left.coordinator_epoch !== right.coordinator_epoch ||
      left.allocation_digest !== right.allocation_digest ||
      !sameBytes(left.allocation_bytes, right.allocation_bytes)) {
    corrupt("Service Mount allocation changed after durable insertion");
  }
}

function serviceMountHasRelease(database: SqliteDatabase, mountId: string): boolean {
  const query = statement<{ readonly count: bigint }>(database, [
    "SELECT count(*) AS count FROM service_mount_facts",
    "WHERE mount_id = ?1 AND fact_name IN ('release', 'closure')",
  ].join(" ")).safeIntegers(true);
  try {
    const aggregate = query.get(mountId);
    if (aggregate === null) corrupt("Service Mount release aggregate is missing");
    return aggregate.count !== 0n;
  }
  finally { query.finalize(); }
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

function findLockRepairByPlan(database: SqliteDatabase, planDigest: string): LockRepairRow | null {
  const query = statement<LockRepairRow>(database,
    "SELECT plan_digest, repair_digest, repair_bytes FROM lock_repairs WHERE plan_digest = ?1",
  );
  let rows: readonly LockRepairRow[];
  try {
    rows = query.all(planDigest).map((row) => Object.freeze({
      plan_digest: row.plan_digest,
      repair_digest: row.repair_digest,
      repair_bytes: copiedBlob(row.repair_bytes, "stored lock-repair receipt"),
    }));
  } finally { query.finalize(); }
  if (rows.length > 1) corrupt(`plan ${planDigest} names multiple lock repairs`);
  return rows[0] ?? null;
}

function requireLockRepairRow(database: SqliteDatabase, planDigest: string): LockRepairRow {
  const row = findLockRepairByPlan(database, planDigest);
  if (row === null) corrupt(`committed lock repair ${planDigest} is missing`);
  return row;
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

function loadCandidateRow(row: CandidateRow): PrivateActivationCandidateArtifactV5 {
  safeRevision(row.revision);
  const candidate = copiedBlob(row.candidate_bytes, "stored candidate");
  const lock = copiedBlob(row.lock_bytes, "stored candidate lock");
  requireStoredSize(candidate, "stored candidate");
  requireStoredSize(lock, "stored candidate lock");
  const decoded = decodeProtectedRecord(
    "stored candidate",
    () => decodePrivateActivationCandidateV5({ candidate, lock }),
  );
  if (privateActivationCandidateDigestV5(decoded) !== row.candidate_digest) corrupt("stored candidate row digest does not match canonical bytes");
  return decoded;
}

function loadPlanRow(row: PlanRow): PrivateActivationPlanV2 {
  safeRevision(row.candidate_revision);
  requireProtectedDigest(row.plan_digest, "stored review plan");
  const bytes = copiedBlob(row.plan_bytes, "stored review plan");
  requireStoredSize(bytes, "stored review plan");
  const plan = decodeProtectedRecord(
    "stored review plan",
    () => decodePrivateActivationPlanV2(bytes),
  );
  if (privateActivationPlanDigestV2(plan) !== row.plan_digest) corrupt("stored review plan digest does not match canonical bytes");
  return plan;
}

function loadAdmissionRow(row: AdmissionRow): PrivateActivationAdmission {
  safeRevision(row.revision);
  requireProtectedDigest(row.admission_digest, "stored admission");
  if (row.base_generation !== null) requireProtectedDigest(row.base_generation, "stored admission base");
  requireProtectedDigest(row.plan_digest, "stored admission plan");
  const bytes = copiedBlob(row.admission_bytes, "stored activation admission");
  requireStoredSize(bytes, "stored activation admission");
  const admission = decodeProtectedRecord(
    "stored activation admission",
    () => decodePrivateActivationAdmission(bytes),
  );
  if (privateActivationAdmissionDigest(admission) !== row.admission_digest) {
    corrupt("stored admission row digest does not match canonical bytes");
  }
  return admission;
}

function loadAndCrossCheckLockRepair(
  database: SqliteDatabase,
  row: LockRepairRow,
  root: PrivateProjectRoot,
): PrivateLockRepairReceipt {
  requireProtectedDigest(row.plan_digest, "stored lock-repair plan");
  requireProtectedDigest(row.repair_digest, "stored lock-repair receipt");
  const bytes = copiedBlob(row.repair_bytes, "stored lock-repair receipt");
  requireStoredSize(bytes, "stored lock-repair receipt");
  const repair = decodeProtectedRecord(
    "stored lock-repair receipt",
    () => decodePrivateLockRepair(bytes),
  );
  if (privateLockRepairDigest(repair) !== row.repair_digest) {
    corrupt("stored lock-repair digest does not match canonical bytes");
  }
  const planRow = requirePlanRow(database, row.plan_digest);
  const plan = loadPlanRow(planRow);
  if (
    plan.operation !== "lock-repair" ||
    repair.planDigest !== row.plan_digest ||
    repair.planDigest !== planRow.plan_digest ||
    repair.activeAdmissionDigest !== plan.baseGeneration ||
    repair.proposedLockDigest !== plan.proposed.lockDigest
  ) {
    corrupt("stored lock-repair receipt does not match its reviewed plan");
  }
  const candidateRow = requireCandidateRow(database, planRow.candidate_revision);
  const candidate = loadCandidateRow(candidateRow);
  requireCandidateRoot(candidate, root);
  crossCheckPlanCandidate(plan, planRow, candidateRow, candidate);
  const activeRow = requireAdmissionByDigest(database, repair.activeAdmissionDigest);
  const active = loadAndCrossCheckAdmission(database, activeRow, root);
  const activeCandidate = loadCandidateRow(requireCandidateRow(
    database,
    BigInt(active.admission.candidateRevision),
  ));
  requireCandidateRoot(activeCandidate, root);
  if (
    activeCandidate.candidate.activationMeaningDigest !== plan.activationMeaningDigest ||
    activeCandidate.candidate.lockDigest !== plan.proposed.lockDigest ||
    !sameBytes(
      encodePrivateProjectLocalLock(activeCandidate.lock),
      encodePrivateProjectLocalLock(plan.proposed.lock),
    )
  ) {
    corrupt("stored lock-repair receipt does not preserve its active admission meaning");
  }
  return Object.freeze({
    repair,
    repairBytes: bytes,
    repairDigest: row.repair_digest,
  });
}

function loadAppliedPlanReceipt(
  database: SqliteDatabase,
  planDigest: string,
  root: PrivateProjectRoot,
): PrivateActivationApplyReceipt | null {
  const admission = findAdmissionByPlan(database, planDigest);
  const repair = findLockRepairByPlan(database, planDigest);
  if (admission !== null && repair !== null) {
    corrupt("one review plan committed both an admission and a lock repair");
  }
  if (admission !== null) return loadAndCrossCheckAdmission(database, admission, root);
  if (repair !== null) return loadAndCrossCheckLockRepair(database, repair, root);
  return null;
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

function crossCheckPlanCandidate(
  plan: PrivateActivationPlanV2,
  planRow: PlanRow,
  candidate: CandidateRow,
  artifact: PrivateActivationCandidateArtifactV5,
): void {
  if (
    plan.candidateRevision !== safeRevision(planRow.candidate_revision) || planRow.candidate_revision !== candidate.revision ||
    plan.candidateDigest !== candidate.candidate_digest ||
    privateActivationCandidateDigestV5(artifact) !== candidate.candidate_digest ||
    plan.captureDigest !== artifact.candidate.captureDigest ||
    plan.resolutionInputDigest !== artifact.candidate.resolutionInputDigest ||
    plan.planningObservationDigest !== artifact.candidate.planningObservationDigest ||
    plan.observedSemanticDigest !== artifact.candidate.observedSemanticDigest ||
    plan.activationMeaningDigest !== artifact.candidate.activationMeaningDigest ||
    plan.proposed.lockDigest !== artifact.candidate.lockDigest ||
    !sameBytes(
      encodePrivateProjectLocalLock(plan.proposed.lock),
      encodePrivateProjectLocalLock(artifact.lock),
    ) ||
    !sameBytes(
      canonicalJson(plan.proposed.targets as unknown as JsonValue),
      canonicalJson(artifact.candidate.targets as unknown as JsonValue),
    )
  ) corrupt("review plan does not name its stored candidate row and proposal exactly");
}

function requirePlanBase(
  database: SqliteDatabase,
  plan: PrivateActivationPlanV2,
  root: PrivateProjectRoot,
): void {
  if (plan.baseGeneration === null) return;
  const base = requireAdmissionByDigest(database, plan.baseGeneration);
  loadAndCrossCheckAdmission(database, base, root);
}

function requireDerivedPlanOperation(
  database: SqliteDatabase,
  plan: PrivateActivationPlanV2,
  proposed: PrivateActivationCandidateArtifactV5,
  root: PrivateProjectRoot,
): void {
  let expected: "admission" | "lock-repair" = "admission";
  if (plan.baseGeneration !== null) {
    const baseRow = requireAdmissionByDigest(database, plan.baseGeneration);
    const base = loadAdmissionRow(baseRow);
    if (baseRow.admission_digest !== plan.baseGeneration) {
      corrupt("review plan base does not identify one exact admission");
    }
    const baseCandidateRow = requireCandidateRow(database, BigInt(base.candidateRevision));
    const baseCandidate = loadCandidateRow(baseCandidateRow);
    requireCandidateRoot(baseCandidate, root);
    if (
      base.candidateDigest !== baseCandidateRow.candidate_digest ||
      base.lockDigest !== baseCandidate.candidate.lockDigest
    ) corrupt("review plan base admission does not match its activation candidate");
    const sameMeaning = baseCandidate.candidate.activationMeaningDigest ===
      proposed.candidate.activationMeaningDigest;
    const sameLock = baseCandidate.candidate.lockDigest === proposed.candidate.lockDigest &&
      sameBytes(
        encodePrivateProjectLocalLock(baseCandidate.lock),
        encodePrivateProjectLocalLock(proposed.lock),
      );
    if (sameMeaning && sameLock) {
      const observedExact = plan.observedLock.state === "present" && sameBytes(
        encodePrivateProjectLocalLock(plan.observedLock.lock),
        encodePrivateProjectLocalLock(plan.proposed.lock),
      );
      if (observedExact) {
        corrupt("review plan persisted a normalized unchanged proposal");
      }
      expected = "lock-repair";
    }
  }
  if (plan.operation !== expected) {
    corrupt(`review plan operation is ${plan.operation}, but protected state derives ${expected}`);
  }
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
  crossCheckPlanCandidate(plan, planRow, candidateRow, candidate);
  if (plan.operation !== "admission") {
    corrupt("stored admission refers to a non-admission review plan");
  }
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
  requireDerivedPlanOperation(database, plan, candidate, root);
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
  | {
      readonly state: "present";
      readonly digest: string;
      readonly lock: PrivateProjectLocalLock;
      readonly bytes: Uint8Array;
    }
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
    let lock: PrivateProjectLocalLock;
    try { lock = decodePrivateProjectLocalLock(bytes); }
    catch (error) {
      if (error instanceof Json1Error || error instanceof TypeError) {
        invalid("LOCK_INVALID", "jig.lock is not a canonical private lock value");
      }
      throw error;
    }
    return Object.freeze({
      state: "present" as const,
      digest: privateProjectLocalLockDigest(lock),
      lock,
      bytes,
    });
  } finally { await handle.close(); }
}

async function observeVisibleLockForPlanning(
  root: PrivateProjectRoot,
): Promise<Awaited<ReturnType<typeof observeVisibleLock>>> {
  try {
    return await observeVisibleLock(root);
  } catch (error) {
    if (isExpectedLockObservationFailure(error)) {
      invalid(
        "LOCK_MISMATCH",
        "jig.lock is not an exact bounded canonical private lock observation",
      );
    }
    throw error;
  }
}

async function convergeVisibleLock(
  owner: StateOwner,
  plan: PrivateActivationPlanV2,
  proposed: Uint8Array,
): Promise<void> {
  try {
    await convergeVisibleLockUnchecked(owner, plan, proposed);
  } catch (error) {
    if (isExpectedLockObservationFailure(error)) {
      stale("jig.lock is no longer the exact reviewed bounded canonical lock state");
    }
    throw error;
  }
}

async function convergeVisibleLockUnchecked(
  owner: StateOwner,
  plan: PrivateActivationPlanV2,
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

function isExpectedLockObservationFailure(error: unknown): boolean {
  return (error instanceof CheckError && (
      error.code === "LOCK_KIND" || error.code === "LOCK_INVALID" ||
      error.code === "LOCK_CHANGED"
    )) || hasCode(error, "EACCES") || hasCode(error, "EPERM") || hasCode(error, "ENXIO");
}

function matchesObservedLock(
  plan: PrivateActivationPlanV2,
  observed: Awaited<ReturnType<typeof observeVisibleLock>>,
): boolean {
  if (plan.observedLock.state === "absent") return observed.state === "absent";
  return observed.state === "present" && observed.digest === plan.observedLock.digest &&
    sameBytes(observed.bytes, encodePrivateProjectLocalLock(plan.observedLock.lock));
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
  plan: PrivateActivationPlanV2,
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
  candidate: PrivateActivationCandidateArtifactV5,
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

function requireCandidateRoot(candidate: PrivateActivationCandidateArtifactV5, root: PrivateProjectRoot): void {
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

async function disposeOperation(
  owner: StateOwner,
  artifacts: ReacquiredArtifacts | readonly ReacquiredArtifacts[] | undefined,
  failure: unknown,
): Promise<void> {
  const cleanup: unknown[] = [];
  const owned = artifacts === undefined ? [] : Array.isArray(artifacts) ? artifacts : [artifacts];
  for (const artifact of [...owned].reverse()) {
    try { await artifact.dispose(); } catch (error) { cleanup.push(error); }
  }
  try { await owner.dispose(); } catch (error) { cleanup.push(error); }
  if (cleanup.length === 0) return;
  if (failure !== undefined) cleanup.unshift(failure);
  throw new AggregateError(cleanup, "private admission operation and cleanup did not both complete");
}

function markStored(candidate: PrivateActivationCandidateArtifactV5): PrivateActivationCandidateArtifactV5 {
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

function requireProtectedDigest(value: unknown, label: string): asserts value is string {
  try { requireDigest(value, label); }
  catch (error) {
    if (error instanceof TypeError) corrupt(`${label} digest is invalid protected state`);
    throw error;
  }
}

function requireWireId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length > 128 || !WIRE_ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
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
function projectBusy(message: string): never { unavailable("PROJECT_BUSY", message); }
function stale(message: string): never { unavailable("STALE_PLAN", message); }
function corrupt(message: string): never { invalid("ADMISSION_STATE_CORRUPT", message); }
function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { readonly code?: unknown }).code === code;
}
