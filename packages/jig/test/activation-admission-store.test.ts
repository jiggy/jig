import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { privateDomainDigest } from "../src/internal/identity.js";
import {
  decodePrivateHookRevision,
  decodePrivateHookAdmissionBoundary,
  encodePrivateHookAdmissionBoundary,
  encodePrivateHookSelectionSet,
  encodePrivateHookRevision,
  normalizePrivateHookRevision,
  normalizePrivateHookAdmissionBoundary,
  normalizePrivateHookSelectionSet,
  privateHookAdmissionBoundaryDigest,
  privateHookMeaningDigest,
  privateHookRevisionDigest,
  privateHookSelectionSetDigest,
} from "../src/internal/hook-runtime-state.js";
import {
  captureStoredPackage,
  publishCapturedPackage,
  type PackageArtifactRef,
} from "../src/internal/package-artifact-store.js";
import { inspectCapturedPackage } from "../src/package/inspect.js";
import {
  decodePrivateProjectLocalLock,
  encodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
} from "../src/internal/project-local-lock.js";
import {
  allocatePrivateRootFlowCall,
  allocatePrivateServiceLease,
  allocatePrivateServiceInvocation,
  appendPrivateRootJournalEvent,
  applyPrivateActivationReviewPlan,
  closePrivateRootFlowCall,
  completePrivateServiceInvocation,
  closePrivateRootExecution,
  completePrivateRootRun,
  createPrivateActivationReviewPlan,
  loadPrivateActiveActivation,
  loadPrivateActivationReviewPlan,
  loadPrivateRootRun,
  loadPrivateRootJournalAppend,
  loadPrivateRootFlowCall,
  listPrivateRootExecutionWork,
  listPrivateRootJournalAppends,
  listPrivateServiceLeases,
  listPrivateServiceInvocations,
  loadPrivateServiceInvocation,
  loadPrivateServiceLease,
  openPrivateProjectCoordinator,
  reacquirePrivateRootExecutionWork,
  recordPrivateRootExecutionCheckpoint,
  recordPrivateRootFlowCallCheckpoint,
  recordPrivateServiceInvocationDispatch,
  recordPrivateServiceLeaseRelease,
  recordPrivateServiceMountRelease,
  recoverPrivateServiceInvocation,
  requirePrivateServiceMountFinalizationReady,
  requirePrivateStoredActivationCandidate,
  submitPrivateRootRun,
  type PrivateProjectCoordinator,
  type PrivateRootRunTerminal,
} from "../src/internal/activation-admission-store.js";
import {
  encodePrivateServiceLeaseAllocation,
  encodePrivateServiceInvocationClosure,
  encodePrivateServiceInvocationTerminal,
  encodePrivateServiceMountAcknowledged,
  encodePrivateServiceMountAllocation,
  encodePrivateServiceMountBacking,
  encodePrivateServiceMountGeneration,
  encodePrivateServiceMountFence,
  encodePrivateServiceMountPlan,
  encodePrivateServiceMountPrepared,
  encodePrivateServiceMountProvisional,
  encodePrivateServiceMountSandbox,
  normalizePrivateServiceMountAcknowledged,
  normalizePrivateServiceInvocationClosure,
  normalizePrivateServiceInvocationTerminal,
  normalizePrivateServiceMountAllocation,
  normalizePrivateServiceMountBacking,
  normalizePrivateServiceMountGeneration,
  normalizePrivateServiceMountFence,
  normalizePrivateServiceMountPlan,
  normalizePrivateServiceMountPrepared,
  normalizePrivateServiceMountProvisional,
  normalizePrivateServiceMountSandbox,
  privateServiceMountAcknowledgedDigest,
  privateServiceInvocationClosureDigest,
  privateServiceInvocationTerminalDigest,
  privateServiceMountAllocationDigest,
  privateServiceMountBackingDigest,
  privateServiceMountGenerationDigest,
  privateServiceMountFenceDigest,
  privateServiceMountPlanDigest,
  privateServiceMountPreparedDigest,
  privateServiceMountProvisionalDigest,
  privateServiceMountSandboxDigest,
} from "../src/internal/private-service-state.js";
import { normalizePrivateRootFlowCallAllocation } from "../src/internal/root-flow-call-state.js";
import {
  normalizePrivateRootJournalAppendAllocation,
  privateJournalEventDigest,
} from "../src/internal/root-journal-effect-state.js";
import {
  createPrivateExternalSubmissionOrigin,
  decodePrivateRootRunRequest,
  encodePrivateRootRunOrigin,
  privateRootRunOriginDigest,
} from "../src/internal/root-run-state.js";
import {
  decodePrivateActivationCandidateV5,
  decodePrivateActivationPlanV2,
  encodePrivateActivationCandidateV5,
  privateActivationCandidateDigestV5,
  privateActivationPlanDigestV2,
  requirePrivateCreatedActivationCandidateV5,
} from "../src/internal/activation-admission.js";
import { canonicalJson, decodeJson1, type JsonValue } from "../src/json.js";
import { capturePackageDirectory } from "../src/package/capture.js";
import { RootAdministrationError } from "../src/administration/root.js";
import { CheckError } from "../src/diagnostics.js";
import {
  attachPrivateRootAdministrationController,
  openPrivateRootAdministrationController,
} from "../src/internal/root-administration-controller.js";
import { awaitRootRun } from "../../../conformance/root-administration-1/consumer.js";
import { privateHookRelationDigest } from "../src/project/package-project.js";

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

setDefaultTimeout(30_000);

describe.serial("private activation admission SQLite store", () => {
  test("initializes one complete fresh schema before reporting a missing candidate", async () => {
    const base = await mkdtemp(join(tmpdir(), "jig-admission-fresh-"));
    const root = join(base, "project");
    const store = join(base, "store");
    const state = join(root, ".jig");
    const databasePath = join(state, "private-activation-admission-v18.sqlite3");
    try {
      await mkdir(root, { mode: 0o700 });
      await mkdir(store, { mode: 0o700 });
      await mkdir(state, { mode: 0o700 });
      const file = await open(
        databasePath,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      await file.close();
      await expect(createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      })).rejects.toMatchObject({ code: "ADMISSION_CANDIDATE_MISSING" });
      const database = openSqlite(databasePath, "readonly");
      try {
        expect(database.query(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'hook_derivations'",
        ).get()).toEqual({ name: "hook_derivations" });
        expect(database.query("PRAGMA user_version").get().user_version).toBe(18);
        for (const table of [
          "lock_repairs",
          "service_mounts",
          "service_mount_facts",
          "service_leases",
          "service_invocations",
        ]) {
          expect(database.query(`SELECT count(*) AS count FROM ${table}`).get().count).toBe(0);
        }
        expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { database.close(true); }
    } finally { await rm(base, { recursive: true, force: true }); }
  });

  test("rejects the exact preceding database path without creating v18 state", async () => {
    const base = await mkdtemp(join(tmpdir(), "jig-admission-legacy-"));
    const root = join(base, "project");
    const store = join(base, "store");
    const state = join(root, ".jig");
    const legacy = join(state, "private-activation-admission-v17.sqlite3");
    const oldest = join(state, "private-activation-admission-v3.sqlite3");
    const current = join(state, "private-activation-admission-v18.sqlite3");
    const sentinel = new TextEncoder().encode("legacy-private-state\n");
    try {
      await mkdir(state, { recursive: true, mode: 0o700 });
      await mkdir(store, { mode: 0o700 });
      await writeFile(legacy, sentinel, { mode: 0o600 });
      await writeFile(oldest, sentinel, { mode: 0o600 });

      await expect(createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      })).rejects.toMatchObject({ code: "ADMISSION_SCHEMA_VERSION" });

      expect(new Uint8Array(await readFile(legacy))).toEqual(sentinel);
      expect(new Uint8Array(await readFile(oldest))).toEqual(sentinel);
      await expect(stat(current)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test("rejects an abandoned legacy sidecar without creating v18 state", async () => {
    const base = await mkdtemp(join(tmpdir(), "jig-admission-legacy-sidecar-"));
    const root = join(base, "project");
    const store = join(base, "store");
    const state = join(root, ".jig");
    const sidecar = join(state, "private-activation-admission-v8.sqlite3-wal");
    const current = join(state, "private-activation-admission-v18.sqlite3");
    const sentinel = new TextEncoder().encode("abandoned-private-sidecar\n");
    try {
      await mkdir(state, { recursive: true, mode: 0o700 });
      await mkdir(store, { mode: 0o700 });
      await writeFile(sidecar, sentinel, { mode: 0o600 });

      await expect(createPrivateActivationReviewPlan({
        projectRoot: root,
        packageStoreRoot: store,
        lockMode: "update",
      })).rejects.toMatchObject({ code: "ADMISSION_SCHEMA_VERSION" });

      expect(new Uint8Array(await readFile(sidecar))).toEqual(sentinel);
      await expect(stat(current)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test("rejects mixed-version authority beside an existing valid v18 store", async () => {
    const fixture = await createFixture();
    const legacy = join(fixture.root, ".jig", "private-activation-admission-v17.sqlite3");
    const sentinel = new TextEncoder().encode("ignored-legacy-state\n");
    try {
      await writeFile(legacy, sentinel, { mode: 0o600 });
      await expect(createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      })).rejects.toMatchObject({ code: "ADMISSION_SCHEMA_VERSION" });
      expect(new Uint8Array(await readFile(legacy))).toEqual(sentinel);
      await rm(legacy);
      const plan = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      }));
      expect(plan.plan.kind).toBe("private-activation-plan/2");
    } finally {
      await fixture.dispose();
    }
  });

  test("binds a foreground-style review to the exact expected candidate head", async () => {
    const fixture = await createFixture();
    try {
      await expect(createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
        expectedCandidate: {
          candidateRevision: 1,
          candidateDigest: digest("different-candidate"),
        },
      })).rejects.toMatchObject({ code: "PROJECT_BUSY" });

      const result = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
        expectedCandidate: {
          candidateRevision: 1,
          candidateDigest: privateActivationCandidateDigestV5(fixture.candidate),
        },
      }));
      expect(result.plan.candidateRevision).toBe(1);
      expect(result.plan.candidateDigest).toBe(privateActivationCandidateDigestV5(fixture.candidate));
    } finally {
      await fixture.dispose();
    }
  });

  test("enforces exact Service fact, lease, and invocation relations while still inert", async () => {
    const fixture = await createFixture("ready");
    let coordinator: Awaited<ReturnType<typeof openPrivateProjectCoordinator>> | undefined;
    try {
      await applyLatestCandidate(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const submission = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "service-schema-owner",
        target: { kind: "flow", path: "flows/run" },
        input: { value: "owner" },
        deadlineUnixMs: Date.now() + 60_000,
      });
      expect(submission.launch).toBeDefined();

      const database = openSqlite(fixture.database, "readwrite");
      try {
        database.exec("PRAGMA foreign_keys=ON");
        const owner = database.query(
          "SELECT admission_digest, coordinator_epoch FROM root_runs WHERE run_id = ?1",
        ).get(submission.run.runId) as {
          admission_digest: string;
          coordinator_epoch: number;
        };
        const mountId = "service-mount-1";
        const generationDigest = digest("service-generation");
        const acknowledgedDigest = digest("service-acknowledged");
        database.query([
          "INSERT INTO service_mounts(",
          "mount_id, binding_id, admission_digest, coordinator_epoch,",
          "allocation_digest, allocation_bytes",
          ") VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        ].join(" ")).run(
          mountId,
          "counter",
          owner.admission_digest,
          owner.coordinator_epoch,
          digest("service-mount-allocation"),
          json1({ mount: 1 }),
        );
        expect(database.query("PRAGMA table_info(service_mounts)").all()
          .map(({ name }: { name: string }) => name)).toEqual([
            "mount_id",
            "binding_id",
            "admission_digest",
            "coordinator_epoch",
            "allocation_digest",
            "allocation_bytes",
          ]);
        const insertFact = database.query([
          "INSERT INTO service_mount_facts(",
          "mount_id, fact_name, fact_digest, fact_bytes",
          ") VALUES (?1, ?2, ?3, ?4)",
        ].join(" "));
        insertFact.run(mountId, "generation", generationDigest, json1({ generation: 1 }));
        insertFact.run(
          mountId,
          "acknowledged",
          acknowledgedDigest,
          json1({ acknowledged: true }),
        );

        const insertLease = database.query([
          "INSERT INTO service_leases(",
          "owner_run_id, slot, mount_id, generation_fact_name, generation_digest,",
          "acknowledged_fact_name, acknowledged_digest, allocation_digest, allocation_bytes,",
          "release_digest, release_bytes",
          ") VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        ].join(" "));
        insertLease.run(
          submission.run.runId,
          "counter",
          mountId,
          "generation",
          generationDigest,
          "acknowledged",
          acknowledgedDigest,
          digest("service-lease-allocation"),
          json1({ lease: 1 }),
          null,
          null,
        );

        const insertInvocation = database.query([
          "INSERT INTO service_invocations(",
          "owner_run_id, operation_id, slot, request_digest, allocation_digest, allocation_bytes,",
          "dispatch_digest, dispatch_bytes, terminal_digest, terminal_bytes, closure_digest, closure_bytes",
          ") VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        ].join(" "));
        insertInvocation.run(
          submission.run.runId,
          "next-1",
          "counter",
          digest("service-request"),
          digest("service-invocation-allocation"),
          json1({ invocation: 1 }),
          digest("service-dispatch"),
          json1({ dispatched: true }),
          digest("service-terminal"),
          json1({ value: 1 }),
          digest("service-invocation-closure"),
          json1({ closed: true }),
        );

        expect(() => insertLease.run(
          submission.run.runId,
          "wrong-kind",
          mountId,
          "generation",
          acknowledgedDigest,
          "acknowledged",
          acknowledgedDigest,
          digest("wrong-kind-lease"),
          json1({ lease: "wrong-kind" }),
          null,
          null,
        )).toThrow();
        expect(() => insertLease.run(
          submission.run.runId,
          "wrong-mount",
          "service-mount-2",
          "generation",
          generationDigest,
          "acknowledged",
          acknowledgedDigest,
          digest("wrong-mount-lease"),
          json1({ lease: "wrong-mount" }),
          null,
          null,
        )).toThrow();
        expect(() => insertLease.run(
          submission.run.runId,
          "bad-release-digest",
          mountId,
          "generation",
          generationDigest,
          "acknowledged",
          acknowledgedDigest,
          digest("bad-release-digest-lease"),
          json1({ lease: "bad-release" }),
          digest("release-without-bytes"),
          null,
        )).toThrow();
        expect(() => insertLease.run(
          submission.run.runId,
          "bad-release-bytes",
          mountId,
          "generation",
          generationDigest,
          "acknowledged",
          acknowledgedDigest,
          digest("bad-release-bytes-lease"),
          json1({ lease: "bad-release" }),
          null,
          json1({ released: true }),
        )).toThrow();
        expect(() => insertInvocation.run(
          submission.run.runId,
          "without-lease",
          "missing",
          digest("without-lease-request"),
          digest("without-lease-allocation"),
          json1({ invocation: "without-lease" }),
          null,
          null,
          null,
          null,
          null,
          null,
        )).toThrow();
        expect(() => insertInvocation.run(
          submission.run.runId,
          "bad-dispatch-parity",
          "counter",
          digest("bad-dispatch-parity-request"),
          digest("bad-dispatch-parity-allocation"),
          json1({ invocation: "bad-dispatch-parity" }),
          digest("dispatch-without-bytes"),
          null,
          null,
          null,
          null,
          null,
        )).toThrow();
        expect(() => insertInvocation.run(
          submission.run.runId,
          "terminal-without-closure",
          "counter",
          digest("terminal-without-closure-request"),
          digest("terminal-without-closure-allocation"),
          json1({ invocation: "terminal-without-closure" }),
          null,
          null,
          digest("terminal-without-closure"),
          json1({ terminal: true }),
          null,
          null,
        )).toThrow();
        expect(() => insertInvocation.run(
          submission.run.runId,
          "closure-without-terminal",
          "counter",
          digest("closure-without-terminal-request"),
          digest("closure-without-terminal-allocation"),
          json1({ invocation: "closure-without-terminal" }),
          null,
          null,
          null,
          null,
          digest("closure-without-terminal"),
          json1({ closure: true }),
        )).toThrow();

        expect(database.query("SELECT count(*) AS count FROM service_mounts").get().count).toBe(1);
        expect(database.query("SELECT count(*) AS count FROM service_mount_facts").get().count)
          .toBe(2);
        expect(database.query("SELECT count(*) AS count FROM service_leases").get().count).toBe(1);
        expect(database.query("SELECT count(*) AS count FROM service_invocations").get().count)
          .toBe(1);
        expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally { database.close(true); }
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  }, 30_000);

  test("allocates and reopens one exact acknowledged Service lease", async () => {
    const fixture = await createFixture("ready", false, false, true);
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      const admission = await applyLatestCandidate(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const submission = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "service-lease-owner",
        target: { kind: "binding", id: "app" },
        input: { value: "owner" },
        deadlineUnixMs: Date.now() + 60_000,
      });
      expect(submission.launch).toBeDefined();
      installAcknowledgedServiceMount(fixture, admission.admissionDigest, coordinator.epoch);

      // A live root is pinned to its own admitted candidate. Later project
      // admission movement cannot revoke or retarget that immutable owner.
      await installChangedMeaningCandidate(fixture);
      const movedAdmission = await applyLatestCandidate(fixture);
      expect(movedAdmission.admissionDigest).not.toBe(admission.admissionDigest);

      const lease = await allocatePrivateServiceLease({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        ownerRunId: submission.run.runId,
        slot: "counter",
      });
      expect(lease).toMatchObject({
        coordinator: "current",
        allocation: {
          ownerRunId: submission.run.runId,
          coordinatorEpoch: coordinator.epoch,
          slot: "counter",
          providerBinding: "counter",
          providerExport: "counter",
        },
      });
      expect(await allocatePrivateServiceLease({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        ownerRunId: submission.run.runId,
        slot: "counter",
      })).toEqual(lease);
      expect(await loadPrivateServiceLease({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        slot: "counter",
      })).toEqual(lease);
      expect(await listPrivateServiceLeases({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
      })).toEqual([lease]);

      await coordinator.dispose();
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      expect((await loadPrivateServiceLease({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        slot: "counter",
      })).coordinator).toBe("older");
      expect((await allocatePrivateServiceLease({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: join(fixture.root, "missing-store"),
        ownerRunId: submission.run.runId,
        slot: "counter",
      })).coordinator).toBe("older");

      const database = openSqlite(fixture.database, "readwrite");
      database.query(
        "UPDATE service_leases SET release_digest = ?1, release_bytes = ?2 WHERE owner_run_id = ?3 AND slot = 'counter'",
      ).run(digest("unsupported-release"), json1({ unsupported: true }), submission.run.runId);
      database.close(true);
      await expect(loadPrivateServiceLease({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        slot: "counter",
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  }, 30_000);

  test("persists Service dispatch and terminal closure", async () => {
    const fixture = await createFixture("ready", false, false, true);
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      const admission = await applyLatestCandidate(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const deadlineUnixMs = Date.now() + 60_000;
      const submission = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "service-invocation-owner",
        target: { kind: "binding", id: "app" },
        input: { value: "owner" },
        deadlineUnixMs,
      });
      installAcknowledgedServiceMount(fixture, admission.admissionDigest, coordinator.epoch);
      await allocatePrivateServiceLease({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        ownerRunId: submission.run.runId,
        slot: "counter",
      });

      const first = await allocatePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:z",
        slot: "counter",
        method: "next",
        input: { amount: 1 },
      });
      expect(first).toMatchObject({
        created: true,
        snapshot: {
          coordinator: "current",
          allocation: {
            ownerRunId: submission.run.runId,
            coordinatorEpoch: coordinator.epoch,
            deadlineUnixMs,
            call: { operationId: "counter:z", slot: "counter", method: "next", input: { amount: 1 } },
          },
        },
      });
      const allocationReplay = await allocatePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:z",
        slot: "counter",
        method: "next",
        input: { amount: 1 },
      });
      expect(allocationReplay).toEqual({ snapshot: first.snapshot, created: false });
      await expect(recordPrivateServiceInvocationDispatch({
        coordinator,
        projectRoot: fixture.root,
        allocation: allocationReplay,
      })).rejects.toThrow("did not create dispatch ownership");
      await expect(allocatePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:z",
        slot: "counter",
        method: "next",
        input: { amount: 2 },
      })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
      const dispatched = await recordPrivateServiceInvocationDispatch({
        coordinator,
        projectRoot: fixture.root,
        allocation: first,
      });
      expect(dispatched).toMatchObject({
        created: true,
        snapshot: { dispatch: { digest: expect.any(String) } },
      });
      expect(await recordPrivateServiceInvocationDispatch({
        coordinator,
        projectRoot: fixture.root,
        allocation: first,
      })).toEqual({ snapshot: dispatched.snapshot, created: false });
      const completed = await completePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:z",
        observation: { source: "provider-response", terminal: { status: "succeeded", value: 1 } },
      });
      expect(completed).toMatchObject({
        dispatch: { digest: dispatched.snapshot.dispatch!.digest },
        terminal: { digest: expect.any(String) },
        closure: { digest: expect.any(String) },
      });
      expect(await completePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:z",
        observation: { source: "provider-response", terminal: { status: "succeeded", value: 1 } },
      })).toEqual(completed);
      await expect(completePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:z",
        observation: { source: "provider-response", terminal: { status: "succeeded", value: 2 } },
      })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
      const second = await allocatePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:a",
        slot: "counter",
        method: "next",
        input: {},
      });
      expect(second.created).toBeTrue();
      await expect(recordPrivateServiceLeaseRelease({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        slot: "counter",
        reason: "owner-closed",
      })).rejects.toMatchObject({ code: "SERVICE_INVOCATION_UNCLOSED" });
      await expect(completePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:a",
        observation: { source: "provider-response", terminal: { status: "succeeded", value: 2 } },
      })).rejects.toMatchObject({ code: "SERVICE_INVOCATION_UNDISPATCHED" });
      const prewrite = await completePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:a",
        observation: {
          source: "host-prewrite",
          terminal: { status: "failed", code: "UNAVAILABLE", message: "not written" },
        },
      });
      expect(prewrite.dispatch).toBeUndefined();
      expect(prewrite).toMatchObject({
        terminal: { value: { dispatchDigest: null } },
        closure: { value: { dispatchDigest: null } },
      });
      await expect(recordPrivateServiceLeaseRelease({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        slot: "counter",
        reason: "owner-closed",
        mountFenceDigest: digest("forbidden-owner-fence"),
      })).rejects.toThrow("cannot name a Mount fence");
      const released = await recordPrivateServiceLeaseRelease({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        slot: "counter",
        reason: "owner-closed",
      });
      expect(released.release).toMatchObject({
        digest: expect.any(String),
        value: {
          reason: "owner-closed",
          mountFenceDigest: null,
          invocations: [
            { operationId: "counter:a", closureDigest: prewrite.closure!.digest },
            { operationId: "counter:z", closureDigest: completed.closure!.digest },
          ],
        },
      });
      expect(await recordPrivateServiceLeaseRelease({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        slot: "counter",
        reason: "owner-closed",
      })).toEqual(released);
      await expect(recordPrivateServiceLeaseRelease({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        slot: "counter",
        reason: "mount-closed",
        mountFenceDigest: digest("different-release"),
      })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
      await expect(allocatePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:after-release",
        slot: "counter",
        method: "next",
        input: {},
      })).rejects.toMatchObject({ code: "SERVICE_PROVIDER_UNAVAILABLE" });
      expect((await listPrivateServiceInvocations({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
      })).map(({ allocation }) => allocation.call.operationId)).toEqual(["counter:a", "counter:z"]);
      expect(await loadPrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:z",
      })).toEqual(completed);

      await coordinator.dispose();
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const replay = await allocatePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:z",
        slot: "counter",
        method: "next",
        input: { amount: 1 },
      });
      expect(replay).toMatchObject({
        created: false,
        snapshot: { coordinator: "older", terminal: { digest: completed.terminal!.digest } },
      });
      expect(await completePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:z",
        observation: { source: "provider-response", terminal: { status: "succeeded", value: 1 } },
      })).toMatchObject({ coordinator: "older", terminal: { digest: completed.terminal!.digest } });
      expect(await recordPrivateServiceLeaseRelease({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        slot: "counter",
        reason: "owner-closed",
      })).toMatchObject({
        coordinator: "older",
        release: { digest: released.release!.digest },
      });
      const impossibleTerminal = normalizePrivateServiceInvocationTerminal({
        ...completed.terminal!.value,
        dispatchDigest: null,
        observation: {
          source: "host-prewrite",
          terminal: { status: "failed", code: "UNAVAILABLE", message: "impossible after dispatch" },
        },
      });
      const impossibleTerminalDigest = privateServiceInvocationTerminalDigest(impossibleTerminal);
      const impossibleClosure = normalizePrivateServiceInvocationClosure({
        ...completed.closure!.value,
        dispatchDigest: null,
        terminalDigest: impossibleTerminalDigest,
      });
      const corruptTerminal = openSqlite(fixture.database, "readwrite");
      corruptTerminal.query([
        "UPDATE service_invocations SET terminal_digest = ?1, terminal_bytes = ?2,",
        "closure_digest = ?3, closure_bytes = ?4",
        "WHERE owner_run_id = ?5 AND operation_id = 'counter:z'",
      ].join(" ")).run(
        impossibleTerminalDigest,
        encodePrivateServiceInvocationTerminal(impossibleTerminal),
        privateServiceInvocationClosureDigest(impossibleClosure),
        encodePrivateServiceInvocationClosure(impossibleClosure),
        submission.run.runId,
      );
      corruptTerminal.close(true);
      await expect(loadPrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:z",
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  }, 30_000);

  test("recovers never-written and possibly-dispatched Service invocations after the Mount fence", async () => {
    const fixture = await createFixture("ready", false, false, true);
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      const admission = await applyLatestCandidate(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const submission = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "service-invocation-recovery-owner",
        target: { kind: "binding", id: "app" },
        input: { value: "owner" },
        deadlineUnixMs: Date.now() + 60_000,
      });
      const installed = installAcknowledgedServiceMount(
        fixture,
        admission.admissionDigest,
        coordinator.epoch,
      );
      await allocatePrivateServiceLease({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        ownerRunId: submission.run.runId,
        slot: "counter",
      });
      await allocatePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:never-written",
        slot: "counter",
        method: "next",
        input: { amount: 1 },
      });
      const possibleDispatch = await allocatePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:possible-dispatch",
        slot: "counter",
        method: "next",
        input: { amount: 1 },
      });
      const dispatched = await recordPrivateServiceInvocationDispatch({
        coordinator,
        projectRoot: fixture.root,
        allocation: possibleDispatch,
      });
      const fence = installServiceMountFence(fixture, installed, "provider-loss");
      const fenceDigest = privateServiceMountFenceDigest(fence);

      await expect(recoverPrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:never-written",
        mountFenceDigest: digest("wrong-recovery-fence"),
      })).rejects.toMatchObject({ code: "SERVICE_INVOCATION_FENCE_MISMATCH" });
      const neverWritten = await recoverPrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:never-written",
        mountFenceDigest: fenceDigest,
      });
      expect(neverWritten).toMatchObject({
        terminal: {
          value: {
            dispatchDigest: null,
            observation: {
              source: "host-prewrite",
              terminal: { status: "failed", code: "UNAVAILABLE" },
            },
          },
        },
        closure: { value: { dispatchDigest: null } },
      });
      expect(neverWritten.dispatch).toBeUndefined();
      const uncertain = await recoverPrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:possible-dispatch",
        mountFenceDigest: fenceDigest,
      });
      expect(uncertain).toMatchObject({
        dispatch: { digest: expect.any(String) },
        terminal: {
          value: {
            dispatchDigest: dispatched.snapshot.dispatch!.digest,
            observation: {
              source: "provider-loss",
              terminal: { status: "failed", code: "UNCERTAIN" },
            },
          },
        },
        closure: { value: { dispatchDigest: expect.any(String) } },
      });
      expect(await recoverPrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:possible-dispatch",
        mountFenceDigest: digest("ignored-after-terminal"),
      })).toEqual(uncertain);
      await recordPrivateServiceLeaseRelease({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        slot: "counter",
        reason: "provider-lost",
        mountFenceDigest: fenceDigest,
      });
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  }, 30_000);

  test("releases closed Service leases before their fenced Mount", async () => {
    const fixture = await createFixture("ready", false, false, true);
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      const admission = await applyLatestCandidate(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const submission = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "service-mount-release-owner",
        target: { kind: "binding", id: "app" },
        input: { value: "owner" },
        deadlineUnixMs: Date.now() + 60_000,
      });
      const installed = installAcknowledgedServiceMount(
        fixture,
        admission.admissionDigest,
        coordinator.epoch,
      );
      const lease = await allocatePrivateServiceLease({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        ownerRunId: submission.run.runId,
        slot: "counter",
      });
      const allocation = await allocatePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:closed",
        slot: "counter",
        method: "next",
        input: {},
      });
      const invocation = await completePrivateServiceInvocation({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        operationId: "counter:closed",
        observation: {
          source: "host-prewrite",
          terminal: { status: "failed", code: "UNAVAILABLE", message: "not dispatched" },
        },
      });
      expect(allocation.created).toBeTrue();
      const fence = installServiceMountFence(fixture, installed, "host-lifetime");
      await expect(requirePrivateServiceMountFinalizationReady({
        coordinator,
        projectRoot: fixture.root,
        mountId: installed.mountId,
      })).rejects.toMatchObject({ code: "SERVICE_LEASE_UNRELEASED" });
      await expect(recordPrivateServiceMountRelease({
        coordinator,
        projectRoot: fixture.root,
        mountId: installed.mountId,
        packageReleased: true,
        ownerRelease: ownerReleaseForInstalledMount(installed),
      })).rejects.toMatchObject({ code: "SERVICE_LEASE_UNRELEASED" });
      await expect(recordPrivateServiceLeaseRelease({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        slot: "counter",
        reason: "mount-closed",
        mountFenceDigest: digest("wrong-fence"),
      })).rejects.toMatchObject({ code: "SERVICE_LEASE_FENCE_MISMATCH" });
      await expect(recordPrivateServiceLeaseRelease({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        slot: "counter",
        reason: "provider-lost",
        mountFenceDigest: privateServiceMountFenceDigest(fence),
      })).rejects.toMatchObject({ code: "SERVICE_LEASE_REASON_MISMATCH" });
      const releasedLease = await recordPrivateServiceLeaseRelease({
        coordinator,
        projectRoot: fixture.root,
        ownerRunId: submission.run.runId,
        slot: "counter",
        reason: "mount-closed",
        mountFenceDigest: privateServiceMountFenceDigest(fence),
      });
      expect(releasedLease.release?.value).toMatchObject({
        reason: "mount-closed",
        mountFenceDigest: privateServiceMountFenceDigest(fence),
        invocations: [{ operationId: "counter:closed", closureDigest: invocation.closure!.digest }],
      });
      const finalizationReady = await requirePrivateServiceMountFinalizationReady({
        coordinator,
        projectRoot: fixture.root,
        mountId: installed.mountId,
      });
      expect(finalizationReady).toMatchObject({
        allocation: { mountId: installed.mountId },
        fence: { digest: privateServiceMountFenceDigest(fence) },
      });
      expect(finalizationReady.release).toBeUndefined();

      const database = openSqlite(fixture.database, "readwrite");
      database.query(
        "UPDATE service_leases SET allocation_bytes = ?1 WHERE owner_run_id = ?2 AND slot = 'counter'",
      ).run(json1({ corrupt: true }), submission.run.runId);
      database.close(true);
      await expect(recordPrivateServiceMountRelease({
        coordinator,
        projectRoot: fixture.root,
        mountId: installed.mountId,
        packageReleased: true,
        ownerRelease: ownerReleaseForInstalledMount(installed),
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
      const repair = openSqlite(fixture.database, "readwrite");
      repair.query(
        "UPDATE service_leases SET allocation_bytes = ?1 WHERE owner_run_id = ?2 AND slot = 'counter'",
      ).run(encodePrivateServiceLeaseAllocation(lease.allocation), submission.run.runId);
      repair.close(true);

      const corruptInvocation = openSqlite(fixture.database, "readwrite");
      corruptInvocation.query(
        "UPDATE service_invocations SET slot = 'other' WHERE owner_run_id = ?1 AND operation_id = 'counter:closed'",
      ).run(submission.run.runId);
      corruptInvocation.close(true);
      await expect(recordPrivateServiceMountRelease({
        coordinator,
        projectRoot: fixture.root,
        mountId: installed.mountId,
        packageReleased: true,
        ownerRelease: ownerReleaseForInstalledMount(installed),
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
      const repairInvocation = openSqlite(fixture.database, "readwrite");
      repairInvocation.query(
        "UPDATE service_invocations SET slot = 'counter' WHERE owner_run_id = ?1 AND operation_id = 'counter:closed'",
      ).run(submission.run.runId);
      repairInvocation.close(true);

      const releasedMount = await recordPrivateServiceMountRelease({
        coordinator,
        projectRoot: fixture.root,
        mountId: installed.mountId,
        packageReleased: true,
        ownerRelease: ownerReleaseForInstalledMount(installed),
      });
      expect(releasedMount.release?.value.leaseReleases).toEqual([{
        ownerRunId: submission.run.runId,
        slot: "counter",
        releaseDigest: releasedLease.release!.digest,
      }]);
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  }, 30_000);

  test("creates and reloads one immutable plan under ordinary Linux CI", async () => {
    const fixture = await createFixture();
    try {
      expect(() => requirePrivateCreatedActivationCandidateV5(fixture.candidate)).toThrow(
        "was not built from a retained project",
      );
      expect(() => requirePrivateStoredActivationCandidate(fixture.candidate)).toThrow(
        "has not been reverified",
      );
      const plans = await Promise.all(Array.from({ length: 4 }, () => retryBusy(
        () => createPrivateActivationReviewPlan({
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          lockMode: "update",
        }),
      )));
      expect(new Set(plans.map(({ planDigest }) => planDigest)).size).toBe(1);
      expect(plans[0]!.plan).toMatchObject({
        kind: "private-activation-plan/2",
        candidateRevision: 1,
        candidateDigest: privateActivationCandidateDigestV5(fixture.candidate),
        baseGeneration: null,
        observedSemanticDigest: fixture.candidate.candidate.observedSemanticDigest,
        activationMeaningDigest: fixture.candidate.candidate.activationMeaningDigest,
        lockMode: "update",
        observedLock: { state: "absent" },
        operation: "admission",
        proposed: {
          lockDigest: fixture.candidate.candidate.lockDigest,
          targets: fixture.candidate.candidate.targets,
        },
      });
      expect(plans[0]!.baseCandidate).toBeNull();
      expect(requirePrivateStoredActivationCandidate(plans[0]!.candidate)).toBe(
        plans[0]!.candidate,
      );
      const restarted = await loadPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plans[0]!.planDigest,
      });
      expect(restarted.plan).toEqual(plans[0]!.plan);
      expect(restarted.planBytes).toEqual(plans[0]!.planBytes);
      expect(restarted.baseCandidate).toBeNull();
      expect(requirePrivateStoredActivationCandidate(restarted.candidate)).toBe(
        restarted.candidate,
      );

      const database = openSqlite(fixture.database, "readonly");
      try {
        expect(database.query(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        ).all().map(({ name }: { name: string }) => name)).toEqual([
          "admission_head",
          "admissions",
          "candidate_head",
          "candidates",
          "coordinator_head",
          "hook_admission_boundaries",
          "hook_derivations",
          "hook_revisions",
          "journal_events",
          "journal_head",
          "lock_repairs",
          "review_plans",
          "root_execution_closures",
          "root_execution_lifecycles",
          "root_flow_call_closures",
          "root_flow_call_facts",
          "root_flow_calls",
          "root_journal_appends",
          "root_journal_closures",
          "root_journal_hook_selections",
          "root_journal_terminals",
          "root_runs",
          "root_spawn_intents",
          "root_terminals",
          "service_invocations",
          "service_leases",
          "service_mount_facts",
          "service_mounts",
        ]);
        expect(database.query(
          "SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        ).all().map(({ name }: { name: string }) => name)).toEqual([
          "hook_revisions_one_open",
        ]);
        expect(database.query("PRAGMA application_id").get().application_id).toBe(0x4a494741);
        expect(database.query("PRAGMA user_version").get().user_version).toBe(18);
        expect(database.query("SELECT count(*) AS count FROM review_plans").get().count).toBe(1);
      } finally {
        database.close(true);
      }
    } finally {
      await fixture.dispose();
    }
  });

  test("applies sequential generations and replays historical receipts without moving the head", async () => {
    const fixture = await createFixture();
    try {
      const firstPlan = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      }));
      expect(firstPlan.plan.baseGeneration).toBeNull();
      const first = requireAdmissionReceipt(await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: firstPlan.planDigest,
      }));
      expect(new Uint8Array(await readFile(join(fixture.root, "jig.lock")))).toEqual(
        encodePrivateProjectLocalLock(fixture.candidate.lock),
      );
      expect(await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: firstPlan.planDigest,
      })).toEqual(first);

      await installEquivalentCaptureCandidate(fixture);
      expect(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      })).toEqual({ state: "unchanged" });
      const afterNoop = openSqlite(fixture.database, "readonly");
      try { expect(afterNoop.query("SELECT count(*) AS count FROM review_plans").get().count).toBe(1); }
      finally { afterNoop.close(true); }

      await rm(join(fixture.root, "jig.lock"));
      await expect(createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "locked",
      })).rejects.toMatchObject({ code: "LOCK_MISMATCH" });
      const repairPlan = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      }));
      expect(repairPlan.plan).toMatchObject({
        baseGeneration: first.admissionDigest,
        operation: "lock-repair",
      });
      expect(repairPlan.baseCandidate?.candidate.activationMeaningDigest).toBe(
        fixture.candidate.candidate.activationMeaningDigest,
      );
      const reloadedRepairPlan = await loadPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: repairPlan.planDigest,
      });
      expect(reloadedRepairPlan.baseCandidate?.candidate.activationMeaningDigest).toBe(
        fixture.candidate.candidate.activationMeaningDigest,
      );
      const repair = await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: repairPlan.planDigest,
      });
      expect(repair).toMatchObject({
        repair: {
          kind: "private-lock-repair/1",
          planDigest: repairPlan.planDigest,
          activeAdmissionDigest: first.admissionDigest,
          proposedLockDigest: fixture.candidate.candidate.lockDigest,
        },
      });
      expect(await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: repairPlan.planDigest,
      })).toEqual(repair);

      await installHookCandidate(fixture, { enabled: false });
      const secondPlan = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      }));
      expect(secondPlan.plan).toMatchObject({
        baseGeneration: first.admissionDigest,
        operation: "admission",
      });
      expect(secondPlan.baseCandidate?.candidate.activationMeaningDigest).toBe(
        fixture.candidate.candidate.activationMeaningDigest,
      );
      const second = requireAdmissionReceipt(await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: secondPlan.planDigest,
      }));
      expect(second.admission.baseGeneration).toBe(first.admissionDigest);
      expect(second.admissionDigest).not.toBe(first.admissionDigest);
      expect(await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: firstPlan.planDigest,
      })).toEqual(first);

      const active = await loadPrivateActiveActivation({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
      });
      expect(active.admission).toEqual(second);
      expect(active.candidate.candidate.targets[0]!.request).toMatchObject({
        target: { kind: "flow", path: "flows/run" },
        packagePath: "flows/run",
        entrypoint: { path: "flow.py", suffix: "py" },
      });
      expect(requirePrivateStoredActivationCandidate(active.candidate)).toBe(active.candidate);

      const database = openSqlite(fixture.database, "readonly");
      try {
        expect(database.query("SELECT count(*) AS count FROM admissions").get().count).toBe(2);
        expect(database.query("SELECT count(*) AS count FROM lock_repairs").get().count).toBe(1);
        expect(database.query(
          "SELECT admissions.admission_digest FROM admission_head JOIN admissions USING (revision) WHERE singleton = 1",
        ).get().admission_digest).toBe(second.admissionDigest);
      } finally { database.close(true); }
      await expect(stat(join(fixture.root, ".jig", "private-activation-jig-lock-v1.stage")))
        .rejects.toMatchObject({ code: "ENOENT" });

      const corruptor = openSqlite(fixture.database, "readwrite");
      corruptor.query(
        "UPDATE admissions SET admission_bytes = (SELECT admission_bytes FROM admissions WHERE revision = 2) WHERE revision = 1",
      ).run();
      corruptor.close(true);
      await expect(loadPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: secondPlan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await fixture.dispose();
    }
  });

  test("reconciles Hook revisions at one atomic Journal boundary", async () => {
    const fixture = await createFixture();
    try {
      const initial = await applyLatestCandidate(fixture);
      expect(readHookRevisionRows(fixture.database)).toEqual([]);

      await installHookCandidate(fixture, { enabled: true });
      const added = await applyLatestCandidate(fixture);
      let rows = readHookRevisionRows(fixture.database);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        hook_id: "on-work",
        opening_candidate_revision: 2,
        opening_admission_digest: added.admissionDigest,
        start_position: 1,
        closing_admission_digest: null,
        end_position: null,
      });
      const originalRevision = rows[0]!.revision_digest;

      await installHookCandidate(fixture, {
        enabled: true,
        extraEventTypes: ["https://example.org/events/unrelated"],
      });
      const unchanged = await applyLatestCandidate(fixture);
      rows = readHookRevisionRows(fixture.database);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.revision_digest).toBe(originalRevision);
      expect(rows[0]!.opening_candidate_revision).toBe(2);

      await installHookCandidate(fixture, {
        enabled: true,
        dispositionEvidence: "replacement-one",
      });
      const replacedOnce = await applyLatestCandidate(fixture);
      await installHookCandidate(fixture, {
        enabled: true,
        dispositionEvidence: "replacement-two",
      });
      const replacedTwice = await applyLatestCandidate(fixture);
      rows = readHookRevisionRows(fixture.database);
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => ({
        opening: row.opening_candidate_revision,
        start: row.start_position,
        closing: row.closing_admission_digest,
        end: row.end_position,
      }))).toEqual([
        { opening: 2, start: 1, closing: replacedOnce.admissionDigest, end: 1 },
        { opening: 4, start: 1, closing: replacedTwice.admissionDigest, end: 1 },
        { opening: 5, start: 1, closing: null, end: null },
      ]);
      expect(new Set(rows.map((row) => row.revision_digest)).size).toBe(3);

      await installHookCandidate(fixture, { enabled: false });
      const removed = await applyLatestCandidate(fixture);
      rows = readHookRevisionRows(fixture.database);
      expect(rows).toHaveLength(3);
      expect(rows[2]).toMatchObject({
        opening_candidate_revision: 5,
        closing_admission_digest: removed.admissionDigest,
        start_position: 1,
        end_position: 1,
      });
      expect(rows.filter((row) => row.end_position === null)).toHaveLength(0);
      expect(readHookBoundaryRows(fixture.database).map((row) => ({
        admission: row.admission_digest,
        position: row.boundary.boundaryPosition,
      }))).toEqual([
        { admission: initial.admissionDigest, position: null },
        { admission: added.admissionDigest, position: 1 },
        { admission: unchanged.admissionDigest, position: null },
        { admission: replacedOnce.admissionDigest, position: 1 },
        { admission: replacedTwice.admissionDigest, position: 1 },
        { admission: removed.admissionDigest, position: 1 },
      ]);
    } finally {
      await fixture.dispose();
    }
  }, 60_000);

  test("roots Hook changes immediately after one real Journal Event", async () => {
    const fixture = await createFixture("ready", true);
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      const initial = await applyLatestCandidate(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const submission = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "hook-boundary-publisher",
        target: { kind: "binding", id: "producer" },
        input: { value: "root" },
        deadlineUnixMs: Date.now() + 30_000,
      });
      const event = await appendPrivateRootJournalEvent({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        allocation: normalizePrivateRootJournalAppendAllocation({
          kind: "private-root-journal-append-allocation/1",
          parentRunId: submission.run.runId,
          coordinatorEpoch: coordinator.epoch,
          publisherBinding: "publisher",
          eventTypes: ["https://example.org/events/work-created"],
          call: {
            operationId: "hook-boundary:1",
            slot: "journal",
            method: "append",
            input: {
              type: "https://example.org/events/work-created",
              data: { value: 1 },
            },
          },
        }),
        committedAtUnixMs: 1_000,
      });
      expect(event.event.journalPosition).toBe(1);

      await installHookCandidate(fixture, { enabled: true });
      const added = await applyLatestCandidate(fixture);
      await installHookCandidate(fixture, {
        enabled: true,
        dispositionEvidence: "after-event-replacement-one",
      });
      const replaced = await applyLatestCandidate(fixture);
      await installHookCandidate(fixture, {
        enabled: true,
        dispositionEvidence: "after-event-replacement-two",
      });
      const replacedAgain = await applyLatestCandidate(fixture);
      await installHookCandidate(fixture, { enabled: false });
      const removed = await applyLatestCandidate(fixture);

      const boundaries = readHookBoundaryRows(fixture.database);
      expect(boundaries.map((row) => ({
        admission: row.admission_digest,
        observed: row.boundary.observedJournalPosition,
        eventDigest: row.boundary.observedJournalEventDigest,
        boundary: row.boundary.boundaryPosition,
      }))).toEqual([
        { admission: initial.admissionDigest, observed: 0, eventDigest: null, boundary: null },
        { admission: added.admissionDigest, observed: 1, eventDigest: event.eventDigest, boundary: 2 },
        { admission: replaced.admissionDigest, observed: 1, eventDigest: event.eventDigest, boundary: 2 },
        { admission: replacedAgain.admissionDigest, observed: 1, eventDigest: event.eventDigest, boundary: 2 },
        { admission: removed.admissionDigest, observed: 1, eventDigest: event.eventDigest, boundary: 2 },
      ]);
      expect(readHookRevisionRows(fixture.database).map((row) => [
        row.start_position,
        row.end_position,
      ])).toEqual([[2, 2], [2, 2], [2, 2]]);

      const corruptor = openSqlite(fixture.database, "readwrite");
      try {
        corruptor.query("UPDATE journal_events SET event_digest = ?1 WHERE position = 1")
          .run(digest("forged-predecessor"));
      } finally { corruptor.close(true); }
      await expect(loadPrivateActiveActivation({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  }, 60_000);

  test("refuses a coherently rewritten Event whose append closure is unchanged", async () => {
    const fixture = await createFixture("ready", true);
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      await applyLatestCandidate(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const submission = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "hook-boundary-corrupt-publisher",
        target: { kind: "binding", id: "producer" },
        input: { value: "root" },
        deadlineUnixMs: Date.now() + 30_000,
      });
      const receipt = await appendPrivateRootJournalEvent({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        allocation: normalizePrivateRootJournalAppendAllocation({
          kind: "private-root-journal-append-allocation/1",
          parentRunId: submission.run.runId,
          coordinatorEpoch: coordinator.epoch,
          publisherBinding: "publisher",
          eventTypes: ["https://example.org/events/work-created"],
          call: {
            operationId: "hook-boundary:corrupt",
            slot: "journal",
            method: "append",
            input: {
              type: "https://example.org/events/work-created",
              data: { value: 1 },
            },
          },
        }),
        committedAtUnixMs: 1_000,
      });
      const pseudoEvent = Object.freeze({
        ...receipt.event,
        data: Object.freeze({ value: "coherent-but-not-allocated" }),
      });
      const corruptor = openSqlite(fixture.database, "readwrite");
      try {
        corruptor.query([
          "UPDATE journal_events SET event_digest = ?1, event_bytes = ?2",
          "WHERE position = ?3",
        ].join(" ")).run(
          privateJournalEventDigest(pseudoEvent),
          canonicalJson(pseudoEvent as unknown as JsonValue),
          receipt.event.journalPosition,
        );
      } finally { corruptor.close(true); }

      await installHookCandidate(fixture, { enabled: true });
      await expect(applyLatestCandidate(fixture)).rejects.toMatchObject({
        code: "ADMISSION_STATE_CORRUPT",
      });

      const unchanged = openSqlite(fixture.database, "readonly");
      try {
        expect(unchanged.query("SELECT count(*) AS count FROM admissions").get().count).toBe(1);
        expect(unchanged.query("SELECT count(*) AS count FROM hook_revisions").get().count).toBe(0);
        expect(unchanged.query("SELECT count(*) AS count FROM root_journal_terminals").get().count)
          .toBe(1);
        expect(unchanged.query("SELECT count(*) AS count FROM root_journal_hook_selections").get().count)
          .toBe(1);
        expect(unchanged.query("SELECT count(*) AS count FROM root_journal_closures").get().count)
          .toBe(1);
      } finally { unchanged.close(true); }
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  }, 60_000);

  test("fails closed on canonical Hook meaning and closing-attribution corruption", async () => {
    const meaningFixture = await createFixture();
    try {
      await applyLatestCandidate(meaningFixture);
      await installHookCandidate(meaningFixture, { enabled: true });
      await applyLatestCandidate(meaningFixture);
      const stored = readHookRevisionRows(meaningFixture.database)[0]!;
      const revision = decodePrivateHookRevision(stored.revision_bytes);
      const meaning = {
        ...revision.meaning,
        target: {
          ...revision.meaning.target,
          dispositionDigest: digest("forged-target-disposition"),
        },
      };
      const forged = normalizePrivateHookRevision({
        ...revision,
        meaning,
        meaningDigest: privateHookMeaningDigest(meaning),
      });
      const forgedDigest = privateHookRevisionDigest(forged);
      const corruptor = openSqlite(meaningFixture.database, "readwrite");
      try {
        corruptor.query([
          "UPDATE hook_revisions SET revision_digest = ?1, meaning_digest = ?2, revision_bytes = ?3",
          "WHERE revision_digest = ?4",
        ].join(" ")).run(
          forgedDigest,
          forged.meaningDigest,
          encodePrivateHookRevision(forged),
          stored.revision_digest,
        );
      } finally { corruptor.close(true); }
      await expect(loadPrivateActiveActivation({
        projectRoot: meaningFixture.root,
        packageStoreRoot: meaningFixture.store,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await meaningFixture.dispose();
    }

    const closingFixture = await createFixture();
    try {
      await applyLatestCandidate(closingFixture);
      await installHookCandidate(closingFixture, { enabled: true });
      await applyLatestCandidate(closingFixture);
      await installHookCandidate(closingFixture, {
        enabled: true,
        extraEventTypes: ["https://example.org/events/unrelated"],
      });
      const unchanged = await applyLatestCandidate(closingFixture);
      const stored = readHookRevisionRows(closingFixture.database)[0]!;
      const corruptor = openSqlite(closingFixture.database, "readwrite");
      try {
        corruptor.query([
          "UPDATE hook_revisions SET closing_admission_digest = ?1, end_position = 1",
          "WHERE revision_digest = ?2",
        ].join(" ")).run(unchanged.admissionDigest, stored.revision_digest);
      } finally { corruptor.close(true); }
      await expect(loadPrivateActiveActivation({
        projectRoot: closingFixture.root,
        packageStoreRoot: closingFixture.store,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await closingFixture.dispose();
    }
  }, 60_000);

  test("reconstructs rooted Hook history and rejects deletion, boundary forgery, and gaps", async () => {
    const deletion = await createFixture();
    try {
      await applyLatestCandidate(deletion);
      await installHookCandidate(deletion, { enabled: true });
      await applyLatestCandidate(deletion);
      await installHookCandidate(deletion, {
        enabled: true,
        dispositionEvidence: "close-the-first-revision",
      });
      await applyLatestCandidate(deletion);
      const closed = readHookRevisionRows(deletion.database).find(
        (row) => row.end_position !== null,
      )!;
      const corruptor = openSqlite(deletion.database, "readwrite");
      try {
        corruptor.query("DELETE FROM hook_revisions WHERE revision_digest = ?1")
          .run(closed.revision_digest);
      } finally { corruptor.close(true); }
      await expect(loadPrivateActiveActivation({
        projectRoot: deletion.root,
        packageStoreRoot: deletion.store,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally { await deletion.dispose(); }

    const missingBoundary = await createFixture();
    try {
      const admitted = await applyLatestCandidate(missingBoundary);
      const corruptor = openSqlite(missingBoundary.database, "readwrite");
      try {
        corruptor.query(
          "DELETE FROM hook_admission_boundaries WHERE admission_digest = ?1",
        ).run(admitted.admissionDigest);
      } finally { corruptor.close(true); }
      await expect(loadPrivateActiveActivation({
        projectRoot: missingBoundary.root,
        packageStoreRoot: missingBoundary.store,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally { await missingBoundary.dispose(); }

    const boundaryForgery = await createFixture();
    try {
      await applyLatestCandidate(boundaryForgery);
      await installHookCandidate(boundaryForgery, { enabled: true });
      const added = await applyLatestCandidate(boundaryForgery);
      const stored = readHookBoundaryRows(boundaryForgery.database).find(
        (row) => row.admission_digest === added.admissionDigest,
      )!;
      const forged = normalizePrivateHookAdmissionBoundary({
        ...stored.boundary,
        observedJournalPosition: stored.boundary.observedJournalPosition + 1,
        observedJournalEventDigest: digest("forged-observed-event"),
        boundaryPosition: stored.boundary.boundaryPosition + 1,
      });
      const corruptor = openSqlite(boundaryForgery.database, "readwrite");
      try {
        corruptor.query([
          "UPDATE hook_admission_boundaries SET boundary_digest = ?1, boundary_bytes = ?2",
          "WHERE admission_digest = ?3",
        ].join(" ")).run(
          privateHookAdmissionBoundaryDigest(forged),
          encodePrivateHookAdmissionBoundary(forged),
          added.admissionDigest,
        );
      } finally { corruptor.close(true); }
      await expect(loadPrivateActiveActivation({
        projectRoot: boundaryForgery.root,
        packageStoreRoot: boundaryForgery.store,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally { await boundaryForgery.dispose(); }

    const gap = await createFixture();
    try {
      await applyLatestCandidate(gap);
      await installHookCandidate(gap, { enabled: true });
      await applyLatestCandidate(gap);
      await installHookCandidate(gap, {
        enabled: true,
        dispositionEvidence: "open-after-gap",
      });
      await applyLatestCandidate(gap);
      const stored = readHookRevisionRows(gap.database).find(
        (row) => row.end_position === null,
      )!;
      const revision = decodePrivateHookRevision(stored.revision_bytes);
      const forged = normalizePrivateHookRevision({
        ...revision,
        startPosition: revision.startPosition + 1,
      });
      const corruptor = openSqlite(gap.database, "readwrite");
      try {
        corruptor.query([
          "UPDATE hook_revisions SET revision_digest = ?1, start_position = ?2, revision_bytes = ?3",
          "WHERE revision_digest = ?4",
        ].join(" ")).run(
          privateHookRevisionDigest(forged),
          forged.startPosition,
          encodePrivateHookRevision(forged),
          stored.revision_digest,
        );
      } finally { corruptor.close(true); }
      await expect(loadPrivateActiveActivation({
        projectRoot: gap.root,
        packageStoreRoot: gap.store,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally { await gap.dispose(); }
  }, 90_000);

  test("refuses Hook-boundary Journal exhaustion before publishing the visible lock", async () => {
    const fixture = await createFixture();
    try {
      await applyLatestCandidate(fixture);
      const visibleBefore = new Uint8Array(await readFile(join(fixture.root, "jig.lock")));
      await installHookCandidate(fixture, { enabled: true });

      const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
      const probe = sqlite.Database.open(":memory:");
      const prototype = Object.getPrototypeOf(probe) as any;
      probe.close(true);
      const original = prototype.query;
      prototype.query = function queryWithExhaustedJournal(sql: string): any {
        let rows: readonly Record<string, bigint>[] | undefined;
        if (sql === "SELECT singleton, position FROM journal_head") {
          rows = [{ singleton: 1n, position: BigInt(Number.MAX_SAFE_INTEGER) }];
        } else if (sql === [
          "SELECT count(*) AS count, min(position) AS minimum, max(position) AS maximum",
          "FROM journal_events",
        ].join(" ")) {
          rows = [{
            count: BigInt(Number.MAX_SAFE_INTEGER),
            minimum: 1n,
            maximum: BigInt(Number.MAX_SAFE_INTEGER),
          }];
        }
        if (rows === undefined) return original.call(this, sql);
        const fake = {
          safeIntegers(): typeof fake { return fake; },
          get(): Record<string, bigint> | null { return rows![0] ?? null; },
          all(): readonly Record<string, bigint>[] { return rows!; },
          finalize(): void {},
        };
        return fake;
      };
      try {
        await expect(applyLatestCandidate(fixture)).rejects.toMatchObject({
          code: "RESOURCE_EXHAUSTED",
        });
      } finally {
        prototype.query = original;
      }

      expect(new Uint8Array(await readFile(join(fixture.root, "jig.lock"))))
        .toEqual(visibleBefore);
      const database = openSqlite(fixture.database, "readonly");
      try {
        expect(database.query("SELECT count(*) AS count FROM admissions").get().count).toBe(1);
        expect(database.query("SELECT count(*) AS count FROM hook_revisions").get().count).toBe(0);
        expect(database.query("SELECT count(*) AS count FROM hook_admission_boundaries").get().count)
          .toBe(1);
      } finally { database.close(true); }
    } finally { await fixture.dispose(); }
  }, 30_000);

  test("fails closed on the preceding private schema instead of migrating it", async () => {
    const fixture = await createFixture();
    try {
      const plan = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      const database = openSqlite(fixture.database, "readwrite");
      database.exec("PRAGMA user_version=17");
      database.close(true);

      await expect(loadPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_SCHEMA_VERSION" });

      const unchanged = openSqlite(fixture.database, "readonly");
      try {
        expect(unchanged.query("PRAGMA user_version").get().user_version).toBe(17);
      } finally { unchanged.close(true); }
    } finally {
      await fixture.dispose();
    }
  });

  test("persists write-once root execution closure and leaves takeover work pending until fenced", async () => {
    const fixture = await createFixture("ready");
    let coordinator: Awaited<ReturnType<typeof openPrivateProjectCoordinator>> | undefined;
    try {
      const plan = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      });
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      expect(coordinator).toMatchObject({ epoch: 1, recoveredRootRuns: [] });
      await expect(openPrivateProjectCoordinator({ projectRoot: fixture.root }))
        .rejects.toMatchObject({ code: "COORDINATOR_BUSY" });
      const deadlineUnixMs = Date.now() + 60_000;
      const attempts = await Promise.all([deadlineUnixMs, deadlineUnixMs + 1].map(
        (deadline) => retryBusy(() => submitPrivateRootRun({
          coordinator: coordinator!,
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          submissionId: "ticket-1",
          target: { kind: "flow", path: "flows/run" },
          input: { value: "first" },
          deadlineUnixMs: deadline,
        })),
      ));
      expect(attempts.filter(({ launch }) => launch !== undefined)).toHaveLength(1);
      const first = attempts.find(({ launch }) => launch !== undefined)!;
      expect(first.run).toMatchObject({
        origin: {
          kind: "private-root-external-submission-origin/1",
          submissionId: "ticket-1",
        },
        target: { kind: "flow", path: "flows/run" },
        input: { value: "first" },
        coordinatorEpoch: 1,
        state: "spawn-intent",
      });
      expect(first.launch?.intent).toMatchObject({
        runId: first.run.runId,
        requestDigest: fixture.candidate.candidate.targets[0]!.request.digest,
        coordinatorEpoch: 1,
      });

      const duplicate = attempts.find(({ launch }) => launch === undefined)!;
      expect(duplicate.run).toEqual(first.run);
      expect(duplicate.launch).toBeUndefined();
      const expectedOrigin = createPrivateExternalSubmissionOrigin("ticket-1");
      const expectedOriginBytes = encodePrivateRootRunOrigin(expectedOrigin);
      let originStore = openSqlite(fixture.database, "readwrite");
      const storedOrigin = originStore.query(
        "SELECT origin_digest, origin_bytes FROM root_runs WHERE run_id = ?1",
      ).get(first.run.runId) as { origin_digest: string; origin_bytes: Uint8Array };
      expect(storedOrigin.origin_digest).toBe(privateRootRunOriginDigest(expectedOrigin));
      expect(new Uint8Array(storedOrigin.origin_bytes)).toEqual(expectedOriginBytes);
      originStore.query("UPDATE root_runs SET origin_digest = ?1 WHERE run_id = ?2")
        .run(`sha256:${"0".repeat(64)}`, first.run.runId);
      originStore.close(true);
      await expect(loadPrivateRootRun({
        projectRoot: fixture.root,
        runId: first.run.runId,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });

      originStore = openSqlite(fixture.database, "readwrite");
      originStore.query("UPDATE root_runs SET origin_digest = ?1, origin_bytes = ?2 WHERE run_id = ?3")
        .run(
          storedOrigin.origin_digest,
          encodePrivateRootRunOrigin(createPrivateExternalSubmissionOrigin("ticket-other")),
          first.run.runId,
        );
      originStore.close(true);
      await expect(loadPrivateRootRun({
        projectRoot: fixture.root,
        runId: first.run.runId,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });

      originStore = openSqlite(fixture.database, "readwrite");
      originStore.query("UPDATE root_runs SET origin_bytes = ?1 WHERE run_id = ?2")
        .run(expectedOriginBytes, first.run.runId);
      originStore.close(true);
      expect(await loadPrivateRootRun({
        projectRoot: fixture.root,
        runId: first.run.runId,
      })).toEqual(first.run);
      await expect(submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "ticket-1",
        target: { kind: "flow", path: "flows/run" },
        input: { value: "changed" },
        deadlineUnixMs,
      })).rejects.toMatchObject({ code: "SUBMISSION_CONFLICT" });

      const rawSuccess = {
        status: "succeeded" as const,
        result: { outcome: "undeclared", output: { accepted: true } },
        diagnostics: { stderr: "bounded", stderrBytes: 7, stderrTruncated: false },
      };
      await expect(completePrivateRootRun({
        projectRoot: fixture.root,
        launch: first.launch!,
        terminal: rawSuccess,
      })).rejects.toMatchObject({ code: "RUN_EXECUTION_CLOSURE_REQUIRED" });

      const atomicWork = (await listPrivateRootExecutionWork({
        coordinator,
        projectRoot: fixture.root,
        epoch: "current",
      })).find(({ run }) => run.runId === first.run.runId);
      expect(atomicWork?.lifecycle).toMatchObject({
        runId: first.run.runId,
        allocation: { value: null },
      });
      await expect(recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        checkpoint: "plan_digest = NULL WHERE 1 = 1 --" as never,
        value: null,
      })).rejects.toThrow("root execution checkpoint name is invalid");
      await expect(listPrivateRootExecutionWork({
        coordinator,
        projectRoot: fixture.root,
        epoch: "future" as never,
      })).rejects.toThrow("root execution work epoch must be current or older");
      await expect(recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        checkpoint: "sandbox",
        value: { owner: "sandbox-1" },
      })).rejects.toMatchObject({ code: "RUN_EXECUTION_ORDER" });

      const planCheckpoint = await recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        checkpoint: "plan",
        value: { recipe: first.launch!.intent.recipeDigest },
      });
      expect(planCheckpoint.plan).toBeDefined();
      expect(await recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        checkpoint: "plan",
        value: { recipe: first.launch!.intent.recipeDigest },
      })).toEqual(planCheckpoint);
      await expect(recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        checkpoint: "plan",
        value: { recipe: digest("different-recipe") },
      })).rejects.toMatchObject({ code: "RUN_EXECUTION_CHECKPOINT_CONFLICT" });

      for (const [checkpoint, value] of [
        ["backing", { package: fixture.candidate.candidate.targets[0]!.request.package.digest }],
        ["sandbox", { owner: "sandbox-1" }],
      ] as const) {
        await recordPrivateRootExecutionCheckpoint({
          coordinator,
          projectRoot: fixture.root,
          runId: first.run.runId,
          checkpoint,
          value,
        });
      }
      await expect(recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        checkpoint: "provisional",
        value: rawSuccess,
      })).rejects.toMatchObject({ code: "RUN_EXECUTION_ORDER" });
      await recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        checkpoint: "prepared",
        value: { prepared: true },
      });
      await recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        checkpoint: "provisional",
        value: rawSuccess,
      });
      await expect(recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        checkpoint: "release",
        value: { released: true },
      })).rejects.toMatchObject({ code: "RUN_EXECUTION_ORDER" });
      await expect(recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        checkpoint: "admitted",
        value: rawSuccess,
      })).rejects.toMatchObject({ code: "RUN_EXECUTION_ORDER" });

      const pending = await listPrivateRootExecutionWork({
        coordinator,
        projectRoot: fixture.root,
        epoch: "current",
      });
      expect(pending.map(({ run }) => run.runId)).toContain(first.run.runId);
      const reacquired = await reacquirePrivateRootExecutionWork({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        runId: first.run.runId,
      });
      expect(reacquired.run).toEqual(first.run);
      expect(reacquired.intent).toEqual(first.launch!.intent);
      expect(requirePrivateStoredActivationCandidate(reacquired.candidate)).toBe(reacquired.candidate);

      await recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        checkpoint: "fence",
        value: { populated: false },
      });
      await recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        checkpoint: "release",
        value: { released: true },
      });
      await expect(recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        checkpoint: "admitted",
        value: {
          status: "failed",
          code: "EXECUTION_FAILED",
          message: "arbitrary drift",
          diagnostics: rawSuccess.diagnostics,
        },
      })).rejects.toMatchObject({ code: "RUN_TERMINAL_CONFLICT" });
      const invalidResult = {
        status: "failed" as const,
        code: "INVALID_RESULT" as const,
        message: "component returned undeclared outcome",
        details: { outcome: "undeclared" },
        diagnostics: rawSuccess.diagnostics,
      };
      await recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        checkpoint: "admitted",
        value: invalidResult,
      });
      const completed = await closePrivateRootExecution({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        terminal: invalidResult,
      });
      expect(completed).toMatchObject({
        runId: first.run.runId,
        state: "terminal",
        terminal: { status: "failed", code: "INVALID_RESULT" },
      });
      expect(await closePrivateRootExecution({
        coordinator,
        projectRoot: fixture.root,
        runId: first.run.runId,
        terminal: invalidResult,
      })).toEqual(completed);
      expect(await loadPrivateRootRun({
        projectRoot: fixture.root,
        runId: completed.runId,
      })).toEqual(completed);

      const invalidInput = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "ticket-invalid",
        target: { kind: "flow", path: "flows/run" },
        input: { unexpected: true },
        deadlineUnixMs,
      });
      expect(invalidInput.launch).toBeUndefined();
      expect(invalidInput.run).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "INVALID_INPUT" },
      });

      const fencedBeforePreparation = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "ticket-fenced-before-preparation",
        target: { kind: "flow", path: "flows/run" },
        input: { value: "fenced" },
        deadlineUnixMs,
      });
      for (const [checkpoint, value] of [
        ["plan", { recipe: fencedBeforePreparation.launch!.intent.recipeDigest }],
        ["backing", { package: fixture.candidate.candidate.targets[0]!.request.package.digest }],
        ["sandbox", { owner: "sandbox-fenced" }],
        ["fence", { populated: false }],
      ] as const) {
        await recordPrivateRootExecutionCheckpoint({
          coordinator,
          projectRoot: fixture.root,
          runId: fencedBeforePreparation.run.runId,
          checkpoint,
          value,
        });
      }
      await expect(recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: fencedBeforePreparation.run.runId,
        checkpoint: "prepared",
        value: { prepared: true },
      })).rejects.toMatchObject({ code: "RUN_EXECUTION_ORDER" });
      const fencedFailure = {
        status: "failed" as const,
        code: "EXECUTION_FAILED" as const,
        message: "admission never occurred",
        diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
      };
      for (const [checkpoint, value] of [
        ["provisional", fencedFailure],
        ["release", { released: true }],
        ["admitted", fencedFailure],
      ] as const) {
        await recordPrivateRootExecutionCheckpoint({
          coordinator,
          projectRoot: fixture.root,
          runId: fencedBeforePreparation.run.runId,
          checkpoint,
          value,
        });
      }
      await closePrivateRootExecution({
        coordinator,
        projectRoot: fixture.root,
        runId: fencedBeforePreparation.run.runId,
        terminal: fencedFailure,
      });

      const abandoned = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "ticket-2",
        target: { kind: "flow", path: "flows/run" },
        input: { value: "second" },
        deadlineUnixMs,
      });
      expect(abandoned.launch).toBeDefined();
      await recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: abandoned.run.runId,
        checkpoint: "plan",
        value: { recipe: abandoned.launch!.intent.recipeDigest },
      });
      const unallocated = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "ticket-unallocated",
        target: { kind: "flow", path: "flows/run" },
        input: { value: "unallocated" },
        deadlineUnixMs,
      });
      expect(unallocated.launch).toBeDefined();
      await coordinator.dispose();
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      expect(coordinator.epoch).toBe(2);
      expect(coordinator.recoveredRootRuns).toHaveLength(2);
      expect(coordinator.recoveredRootRuns).toEqual(expect.arrayContaining([
        expect.objectContaining({
          runId: abandoned.run.runId,
          coordinatorEpoch: 1,
          state: "spawn-intent",
        }),
        expect.objectContaining({
          runId: unallocated.run.runId,
          coordinatorEpoch: 1,
          state: "spawn-intent",
        }),
      ]));
      const older = await listPrivateRootExecutionWork({
        coordinator,
        projectRoot: fixture.root,
        epoch: "older",
      });
      expect(older.map(({ run }) => run.runId)).toEqual([
        abandoned.run.runId,
        unallocated.run.runId,
      ].sort());
      expect((await reacquirePrivateRootExecutionWork({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        runId: abandoned.run.runId,
      })).run).toEqual(abandoned.run);
      await expect(completePrivateRootRun({
        projectRoot: fixture.root,
        launch: abandoned.launch!,
        terminal: {
          status: "failed",
          code: "EXECUTION_FAILED",
          message: "late completion",
          diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
        },
      })).rejects.toMatchObject({ code: "COORDINATOR_CLOSED" });

      const lost = {
        status: "lost" as const,
        code: "COORDINATOR_LOST" as const,
        message: "the prior coordinator disappeared before an independently proved result",
      };
      for (const [checkpoint, value] of [
        ["provisional", lost],
        ["release", { released: true }],
        ["admitted", lost],
      ] as const) {
        await recordPrivateRootExecutionCheckpoint({
          coordinator,
          projectRoot: fixture.root,
          runId: abandoned.run.runId,
          checkpoint,
          value,
        });
      }
      expect(await closePrivateRootExecution({
        coordinator,
        projectRoot: fixture.root,
        runId: abandoned.run.runId,
        terminal: lost,
      })).toMatchObject({ state: "terminal", terminal: lost });

      await expect(recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: unallocated.run.runId,
        checkpoint: "plan",
        value: { recipe: unallocated.launch!.intent.recipeDigest },
      })).rejects.toMatchObject({ code: "RUN_COORDINATOR_STALE" });
      await expect(recordPrivateRootExecutionCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        runId: unallocated.run.runId,
        checkpoint: "provisional",
        value: fencedFailure,
      })).rejects.toMatchObject({ code: "RUN_COORDINATOR_STALE" });
      for (const [checkpoint, value] of [
        ["provisional", lost],
        ["release", { released: true }],
        ["admitted", lost],
      ] as const) {
        await recordPrivateRootExecutionCheckpoint({
          coordinator,
          projectRoot: fixture.root,
          runId: unallocated.run.runId,
          checkpoint,
          value,
        });
      }
      expect(await closePrivateRootExecution({
        coordinator,
        projectRoot: fixture.root,
        runId: unallocated.run.runId,
        terminal: lost,
      })).toMatchObject({ state: "terminal", terminal: lost });

      let corruptor = openSqlite(fixture.database, "readwrite");
      const admittedDigest = corruptor.query(
        "SELECT admitted_digest FROM root_execution_lifecycles WHERE run_id = ?1",
      ).get(completed.runId).admitted_digest;
      corruptor.query("UPDATE root_execution_lifecycles SET admitted_digest = ?1 WHERE run_id = ?2")
        .run(`sha256:${"0".repeat(64)}`, completed.runId);
      corruptor.close(true);
      await expect(loadPrivateRootRun({
        projectRoot: fixture.root,
        runId: completed.runId,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
      corruptor = openSqlite(fixture.database, "readwrite");
      corruptor.query("UPDATE root_execution_lifecycles SET admitted_digest = ?1 WHERE run_id = ?2")
        .run(admittedDigest, completed.runId);
      corruptor.query("UPDATE root_terminals SET terminal_digest = ?1 WHERE run_id = ?2")
        .run(`sha256:${"0".repeat(64)}`, completed.runId);
      corruptor.close(true);
      await expect(loadPrivateRootRun({
        projectRoot: fixture.root,
        runId: completed.runId,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  });

  test("persists one closed child Flow operation beneath its parent root Run", async () => {
    const fixture = await createComposedFixture();
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      const plan = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      });
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const deadlineUnixMs = Date.now() + 30_000;
      const submission = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "composed-root",
        target: { kind: "binding", id: "parent" },
        input: { value: "parent" },
        deadlineUnixMs,
      });
      expect(submission.launch).toBeDefined();
      const child = fixture.candidate.candidate.targets.find(
        ({ request }) => request.target.kind === "flow",
      )!;
      expect(child.disposition.state).toBe("ready");
      if (child.disposition.state !== "ready") throw new Error("fixture child is not READY");
      const allocation = normalizePrivateRootFlowCallAllocation({
        kind: "private-root-flow-call-allocation/1",
        parentRunId: submission.run.runId,
        coordinatorEpoch: coordinator.epoch,
        call: {
          operationId: "child:1",
          slot: "child",
          intent: "Run the exact admitted child",
          input: { value: "child" },
        },
        target: child.request.target,
        requestDigest: child.request.digest,
        recipeDigest: child.disposition.recipeDigest,
        observationDigest: child.disposition.observationDigest,
        effectiveDeadlineUnixMs: deadlineUnixMs,
      });
      const allocated = await allocatePrivateRootFlowCall({
        coordinator,
        projectRoot: fixture.root,
        allocation,
      });
      expect(allocated.allocation).toEqual(allocation);
      expect((await loadPrivateRootFlowCall({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submission.run.runId,
      }))?.allocation).toEqual(allocation);
      await expect(allocatePrivateRootFlowCall({
        coordinator,
        projectRoot: fixture.root,
        allocation: normalizePrivateRootFlowCallAllocation({
          ...allocation,
          call: { ...allocation.call, operationId: "child:2" },
        }),
      })).rejects.toMatchObject({ code: "RESOURCE_EXHAUSTED" });
      await expect(recordPrivateRootFlowCallCheckpoint({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submission.run.runId,
        checkpoint: "release",
        value: { released: true },
      })).rejects.toMatchObject({ code: "RUN_EXECUTION_CHECKPOINT_ORDER" });

      const terminal: PrivateRootRunTerminal = {
        status: "succeeded",
        result: { outcome: "done", output: { value: "child" } },
        diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
      };
      for (const [checkpoint, value] of [
        ["plan", { planned: true }],
        ["backing", { retained: true }],
        ["sandbox", { sealed: true }],
        ["prepared", { prepared: true }],
        ["provisional", terminal],
        ["fence", { populated: false }],
        ["release", { released: true }],
        ["admitted", terminal],
      ] as const) {
        await recordPrivateRootFlowCallCheckpoint({
          coordinator,
          projectRoot: fixture.root,
          parentRunId: submission.run.runId,
          checkpoint,
          value: value as JsonValue,
        });
      }
      const closed = await closePrivateRootFlowCall({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submission.run.runId,
      });
      expect(closed.closureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect((await closePrivateRootFlowCall({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submission.run.runId,
      })).closureDigest).toBe(closed.closureDigest);
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  });

  test("atomically commits, replays, and reloads multiple root Journal appends", async () => {
    const fixture = await createFixture("ready", true);
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      const plan = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      });
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const submission = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "journal-root",
        target: { kind: "binding", id: "producer" },
        input: { value: "root" },
        deadlineUnixMs: Date.now() + 30_000,
      });
      expect(submission.launch).toBeDefined();
      const allocation = (operationId: string, value: number) => normalizePrivateRootJournalAppendAllocation({
        kind: "private-root-journal-append-allocation/1",
        parentRunId: submission.run.runId,
        coordinatorEpoch: coordinator!.epoch,
        publisherBinding: "publisher",
        eventTypes: ["https://example.org/events/work-created"],
        call: {
          operationId,
          slot: "journal",
          method: "append",
          input: {
            type: "https://example.org/events/work-created",
            data: { value },
          },
        },
      });
      const firstAllocation = allocation("journal:1", 1);
      const first = await appendPrivateRootJournalEvent({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        allocation: firstAllocation,
        committedAtUnixMs: 1_000,
      });
      expect(first.event).toMatchObject({ journalPosition: 1, committedAtUnixMs: 1_000, data: { value: 1 } });
      expect(await appendPrivateRootJournalEvent({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        allocation: firstAllocation,
        committedAtUnixMs: 9_999,
      })).toEqual(first);
      await expect(appendPrivateRootJournalEvent({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        allocation: allocation("journal:1", 2),
        committedAtUnixMs: 2_000,
      })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
      const second = await appendPrivateRootJournalEvent({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        allocation: allocation("journal:2", 2),
        committedAtUnixMs: 2_000,
      });
      expect(second.event.journalPosition).toBe(2);
      expect(await loadPrivateRootJournalAppend({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submission.run.runId,
        operationId: "journal:1",
      })).toEqual(first);
      expect((await listPrivateRootJournalAppends({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submission.run.runId,
      })).map(({ event }) => event.journalPosition)).toEqual([1, 2]);

      const database = openSqlite(fixture.database, "readwrite");
      database.query("UPDATE journal_events SET event_digest = ?1 WHERE position = 1")
        .run(`sha256:${"0".repeat(64)}`);
      database.close(true);
      await expect(loadPrivateRootJournalAppend({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: submission.run.runId,
        operationId: "journal:1",
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  });

  test("atomically selects ordered Hooks and allocates exact derived root Runs", async () => {
    const fixture = await createFixture("ready", true);
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      await applyLatestCandidate(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const parent = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "hook-fanout-parent",
        target: { kind: "binding", id: "producer" },
        input: { value: "root" },
        deadlineUnixMs: 50_000,
      });
      await installHookCandidate(fixture, {
        enabled: true,
        hookIds: ["zeta-work", "alpha-work"],
      });
      await applyLatestCandidate(fixture);
      const allocation = normalizePrivateRootJournalAppendAllocation({
        kind: "private-root-journal-append-allocation/1",
        parentRunId: parent.run.runId,
        coordinatorEpoch: coordinator.epoch,
        publisherBinding: "publisher",
        eventTypes: ["https://example.org/events/work-created"],
        call: {
          operationId: "hook-fanout:1",
          slot: "journal",
          method: "append",
          input: {
            type: "https://example.org/events/work-created",
            data: { ticket: 1 },
          },
        },
      });
      const racedReceipts = await Promise.all([10_000, 10_000].map((committedAtUnixMs) =>
        retryBusy(() => appendPrivateRootJournalEvent({
          coordinator: coordinator!,
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          allocation,
          committedAtUnixMs,
        }))
      ));
      const receipt = racedReceipts[0]!;
      expect(racedReceipts[1]).toEqual(receipt);
      expect(receipt.hookSelection.entries.map((entry) => entry.hookId)).toEqual([
        "alpha-work",
        "zeta-work",
      ]);
      expect(receipt.derivedRuns.map((run) => run.runId)).toEqual(
        receipt.hookSelection.entries.map((entry) => entry.runId),
      );
      for (const run of receipt.derivedRuns) {
        expect(run).toMatchObject({
          origin: {
            kind: "private-root-hook-derived-origin/1",
            eventId: receipt.event.eventId,
          },
          input: receipt.event,
          target: { kind: "binding", id: "producer" },
          deadlineUnixMs: 50_000,
          state: "spawn-intent",
        });
      }
      expect(await appendPrivateRootJournalEvent({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        allocation,
        committedAtUnixMs: 99_999,
      })).toEqual(receipt);
      await expect(appendPrivateRootJournalEvent({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        allocation: normalizePrivateRootJournalAppendAllocation({
          ...allocation,
          call: { ...allocation.call, input: { ...allocation.call.input, data: { ticket: 2 } } },
        }),
        committedAtUnixMs: 10_000,
      })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });

      const pending = await listPrivateRootExecutionWork({
        coordinator,
        projectRoot: fixture.root,
        epoch: "current",
      });
      expect(pending.filter(({ run }) =>
        run.origin.kind === "private-root-hook-derived-origin/1",
      ).map(({ run }) => run.runId).sort()).toEqual(
        receipt.derivedRuns.map((run) => run.runId).sort(),
      );
      const database = openSqlite(fixture.database, "readonly");
      try {
        expect(database.query("SELECT count(*) AS count FROM hook_derivations").get().count).toBe(2);
      } finally { database.close(true); }

      const corruptor = openSqlite(fixture.database, "readwrite");
      try {
        corruptor.query("DELETE FROM hook_derivations WHERE run_id = ?1")
          .run(receipt.derivedRuns[0]!.runId);
      } finally { corruptor.close(true); }
      await expect(loadPrivateRootJournalAppend({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: parent.run.runId,
        operationId: "hook-fanout:1",
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
      await expect(listPrivateRootExecutionWork({
        coordinator,
        projectRoot: fixture.root,
        epoch: "current",
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  }, 60_000);

  test("refuses partial or coherently stale append evidence before derived execution", async () => {
    const fixture = await createFixture("ready", true);
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      await applyLatestCandidate(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const parent = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "hook-corruption-parent",
        target: { kind: "binding", id: "producer" },
        input: { value: "root" },
        deadlineUnixMs: 50_000,
      });
      await installHookCandidate(fixture, { enabled: true, hookIds: ["work"] });
      await applyLatestCandidate(fixture);
      const allocation = normalizePrivateRootJournalAppendAllocation({
        kind: "private-root-journal-append-allocation/1",
        parentRunId: parent.run.runId,
        coordinatorEpoch: coordinator.epoch,
        publisherBinding: "publisher",
        eventTypes: ["https://example.org/events/work-created"],
        call: {
          operationId: "hook-corruption:1",
          slot: "journal",
          method: "append",
          input: { type: "https://example.org/events/work-created", data: { ticket: 1 } },
        },
      });
      const receipt = await appendPrivateRootJournalEvent({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        allocation,
        committedAtUnixMs: 10_000,
      });
      const runId = receipt.derivedRuns[0]!.runId;
      const expectExecutionCorrupt = async (): Promise<void> => {
        await expect(listPrivateRootExecutionWork({
          coordinator: coordinator!,
          projectRoot: fixture.root,
          epoch: "current",
        })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
      };

      let database = openSqlite(fixture.database, "readwrite");
      const parentStored = database.query([
        "SELECT origin_bytes, request_bytes, admission_digest FROM root_runs",
        "WHERE run_id = ?1",
      ].join(" ")).get(parent.run.runId);
      const latestAdmission = database.query(
        "SELECT admission_digest FROM admissions ORDER BY revision DESC LIMIT 1",
      ).get();
      database.query("UPDATE root_runs SET origin_bytes = ?1 WHERE run_id = ?2").run(
        encodePrivateRootRunOrigin(createPrivateExternalSubmissionOrigin("forged-parent")),
        parent.run.runId,
      );
      database.close(true);
      await expectExecutionCorrupt();
      database = openSqlite(fixture.database, "readwrite");
      database.query("UPDATE root_runs SET origin_bytes = ?1 WHERE run_id = ?2")
        .run(parentStored.origin_bytes, parent.run.runId);
      const parentRequest = decodePrivateRootRunRequest(parentStored.request_bytes);
      database.query("UPDATE root_runs SET request_bytes = ?1 WHERE run_id = ?2").run(
        canonicalJson({ ...parentRequest, deadlineUnixMs: parentRequest.deadlineUnixMs + 1 } as JsonValue),
        parent.run.runId,
      );
      database.close(true);
      await expectExecutionCorrupt();
      database = openSqlite(fixture.database, "readwrite");
      database.query("UPDATE root_runs SET request_bytes = ?1 WHERE run_id = ?2")
        .run(parentStored.request_bytes, parent.run.runId);
      database.query("UPDATE root_runs SET admission_digest = ?1 WHERE run_id = ?2")
        .run(latestAdmission.admission_digest, parent.run.runId);
      database.close(true);
      await expectExecutionCorrupt();
      database = openSqlite(fixture.database, "readwrite");
      database.query("UPDATE root_runs SET admission_digest = ?1 WHERE run_id = ?2")
        .run(parentStored.admission_digest, parent.run.runId);
      database.query("UPDATE journal_head SET position = 0 WHERE singleton = 1").run();
      database.close(true);
      await expectExecutionCorrupt();
      database = openSqlite(fixture.database, "readwrite");
      database.query("UPDATE journal_head SET position = 1 WHERE singleton = 1").run();
      const closure = database.query(
        "SELECT closure_digest, closure_bytes FROM root_journal_closures WHERE parent_run_id = ?1 AND operation_id = ?2",
      ).get(parent.run.runId, allocation.call.operationId);
      database.query(
        "DELETE FROM root_journal_closures WHERE parent_run_id = ?1 AND operation_id = ?2",
      ).run(parent.run.runId, allocation.call.operationId);
      database.close(true);
      await expectExecutionCorrupt();
      database = openSqlite(fixture.database, "readwrite");
      database.query(
        "INSERT INTO root_journal_closures(parent_run_id, operation_id, closure_digest, closure_bytes) VALUES (?1, ?2, ?3, ?4)",
      ).run(parent.run.runId, allocation.call.operationId, closure.closure_digest, closure.closure_bytes);
      const staleSelection = normalizePrivateHookSelectionSet({
        kind: "private-hook-selection-set/1",
        eventId: receipt.event.eventId,
        entries: [],
      });
      database.query([
        "UPDATE root_journal_hook_selections SET selection_digest = ?1, selection_bytes = ?2",
        "WHERE parent_run_id = ?3 AND operation_id = ?4",
      ].join(" ")).run(
        privateHookSelectionSetDigest(staleSelection),
        encodePrivateHookSelectionSet(staleSelection),
        parent.run.runId,
        allocation.call.operationId,
      );
      database.close(true);
      await expectExecutionCorrupt();

      database = openSqlite(fixture.database, "readwrite");
      database.query([
        "UPDATE root_journal_hook_selections SET selection_digest = ?1, selection_bytes = ?2",
        "WHERE parent_run_id = ?3 AND operation_id = ?4",
      ].join(" ")).run(
        receipt.hookSelectionDigest,
        encodePrivateHookSelectionSet(receipt.hookSelection),
        parent.run.runId,
        allocation.call.operationId,
      );
      const storedRequest = database.query("SELECT request_bytes FROM root_runs WHERE run_id = ?1").get(runId);
      const request = decodePrivateRootRunRequest(storedRequest.request_bytes);
      database.close(true);
      for (const forged of [
        { ...request, target: { kind: "flow", path: "flows/run" } },
        { ...request, input: { forged: true } },
        { ...request, deadlineUnixMs: request.deadlineUnixMs + 1 },
      ] as const) {
        database = openSqlite(fixture.database, "readwrite");
        database.query("UPDATE root_runs SET request_bytes = ?1 WHERE run_id = ?2")
          .run(canonicalJson(forged as unknown as JsonValue), runId);
        database.close(true);
        await expectExecutionCorrupt();
      }
      database = openSqlite(fixture.database, "readwrite");
      database.query("UPDATE root_runs SET request_bytes = ?1 WHERE run_id = ?2")
        .run(storedRequest.request_bytes, runId);
      database.close(true);
      expect(await loadPrivateRootJournalAppend({
        coordinator,
        projectRoot: fixture.root,
        parentRunId: parent.run.runId,
        operationId: allocation.call.operationId,
      })).toEqual(receipt);
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  }, 90_000);

  test("refuses excessive Hook fanout before target Package inspection", async () => {
    const fixture = await createFixture("ready", true);
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      await applyLatestCandidate(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const parent = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "hook-fanout-bound-parent",
        target: { kind: "binding", id: "producer" },
        input: { value: "root" },
        deadlineUnixMs: 50_000,
      });
      await installHookCandidate(fixture, {
        enabled: true,
        hookIds: Array.from({ length: 257 }, (_, index) =>
          `hook-${index.toString().padStart(3, "0")}`),
      });
      await applyLatestCandidate(fixture);
      await rm(fixture.store, { recursive: true, force: true });
      await expect(appendPrivateRootJournalEvent({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        allocation: normalizePrivateRootJournalAppendAllocation({
          kind: "private-root-journal-append-allocation/1",
          parentRunId: parent.run.runId,
          coordinatorEpoch: coordinator.epoch,
          publisherBinding: "publisher",
          eventTypes: ["https://example.org/events/work-created"],
          call: {
            operationId: "hook-fanout-bound:1",
            slot: "journal",
            method: "append",
            input: { type: "https://example.org/events/work-created", data: null },
          },
        }),
        committedAtUnixMs: 10_000,
      })).rejects.toMatchObject({ code: "RESOURCE_EXHAUSTED" });
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  }, 60_000);

  test("reprepares concurrent distinct Journal operations without losing either append", async () => {
    const fixture = await createFixture("ready", true);
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      await applyLatestCandidate(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const parent = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "hook-distinct-race-parent",
        target: { kind: "binding", id: "producer" },
        input: { value: "root" },
        deadlineUnixMs: 50_000,
      });
      await installHookCandidate(fixture, { enabled: true, hookIds: ["work"] });
      await applyLatestCandidate(fixture);
      const append = (operationId: string, ticket: number) => retryBusy(() =>
        appendPrivateRootJournalEvent({
          coordinator: coordinator!,
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          allocation: normalizePrivateRootJournalAppendAllocation({
            kind: "private-root-journal-append-allocation/1",
            parentRunId: parent.run.runId,
            coordinatorEpoch: coordinator!.epoch,
            publisherBinding: "publisher",
            eventTypes: ["https://example.org/events/work-created"],
            call: {
              operationId,
              slot: "journal",
              method: "append",
              input: { type: "https://example.org/events/work-created", data: { ticket } },
            },
          }),
          committedAtUnixMs: 10_000 + ticket,
        })
      );
      const receipts = await Promise.all([
        append("hook-distinct-race:1", 1),
        append("hook-distinct-race:2", 2),
      ]);
      expect(receipts.map(({ event }) => event.journalPosition).sort()).toEqual([1, 2]);
      expect(receipts.flatMap(({ hookSelection }) =>
        hookSelection.entries.map(({ hookId }) => hookId),
      )).toEqual(["work", "work"]);
      expect(new Set(receipts.flatMap(({ derivedRuns }) =>
        derivedRuns.map(({ runId }) => runId),
      )).size).toBe(2);
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  }, 90_000);

  test("keeps an admission race on one side of the exact Event boundary", async () => {
    const fixture = await createFixture("ready", true);
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      await applyLatestCandidate(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const parent = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "hook-admission-race-parent",
        target: { kind: "binding", id: "producer" },
        input: { value: "root" },
        deadlineUnixMs: 50_000,
      });
      await installHookCandidate(fixture, { enabled: true, hookIds: ["raced"] });
      const allocation = (operationId: string) => normalizePrivateRootJournalAppendAllocation({
        kind: "private-root-journal-append-allocation/1",
        parentRunId: parent.run.runId,
        coordinatorEpoch: coordinator!.epoch,
        publisherBinding: "publisher",
        eventTypes: ["https://example.org/events/work-created"],
        call: {
          operationId,
          slot: "journal",
          method: "append",
          input: { type: "https://example.org/events/work-created", data: null },
        },
      });
      const [raced] = await Promise.all([
        retryBusy(() => appendPrivateRootJournalEvent({
          coordinator: coordinator!,
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          allocation: allocation("hook-admission-race:1"),
          committedAtUnixMs: 10_000,
        })),
        retryBusy(() => applyLatestCandidate(fixture)),
      ]);
      expect([[], ["raced"]]).toContainEqual(
        raced.hookSelection.entries.map(({ hookId }) => hookId),
      );
      const after = await appendPrivateRootJournalEvent({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        allocation: allocation("hook-admission-race:2"),
        committedAtUnixMs: 10_001,
      });
      expect(after.hookSelection.entries.map(({ hookId }) => hookId)).toEqual(["raced"]);
      expect(after.event.journalPosition).toBe(2);
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  }, 90_000);

  test("matches Hook source and type exactly and persists terminal derivations", async () => {
    const noMatch = await createFixture("ready", true);
    let noMatchCoordinator: PrivateProjectCoordinator | undefined;
    try {
      await applyLatestCandidate(noMatch);
      noMatchCoordinator = await openPrivateProjectCoordinator({ projectRoot: noMatch.root });
      const parent = await submitPrivateRootRun({
        coordinator: noMatchCoordinator,
        projectRoot: noMatch.root,
        packageStoreRoot: noMatch.store,
        submissionId: "hook-no-match-parent",
        target: { kind: "binding", id: "producer" },
        input: { value: "root" },
        deadlineUnixMs: 50_000,
      });
      await installHookCandidate(noMatch, {
        enabled: true,
        publisherBinding: "other-publisher",
        hookType: "https://example.org/events/other",
      });
      await applyLatestCandidate(noMatch);
      const receipt = await appendPrivateRootJournalEvent({
        coordinator: noMatchCoordinator,
        projectRoot: noMatch.root,
        packageStoreRoot: noMatch.store,
        allocation: normalizePrivateRootJournalAppendAllocation({
          kind: "private-root-journal-append-allocation/1",
          parentRunId: parent.run.runId,
          coordinatorEpoch: noMatchCoordinator.epoch,
          publisherBinding: "publisher",
          eventTypes: ["https://example.org/events/work-created"],
          call: {
            operationId: "hook-no-match:1",
            slot: "journal",
            method: "append",
            input: { type: "https://example.org/events/work-created", data: null },
          },
        }),
        committedAtUnixMs: 10_000,
      });
      expect(receipt.hookSelection.entries).toEqual([]);
      expect(receipt.derivedRuns).toEqual([]);
    } finally {
      await noMatchCoordinator?.dispose();
      await noMatch.dispose();
    }

    for (const testCase of [
      { name: "unavailable", fixture: await createFixture("ready", true), evidence: "unavailable-target" },
      { name: "invalid", fixture: await createFixture("ready", true, true), evidence: undefined },
    ] as const) {
      let coordinator: PrivateProjectCoordinator | undefined;
      try {
        await applyLatestCandidate(testCase.fixture);
        coordinator = await openPrivateProjectCoordinator({ projectRoot: testCase.fixture.root });
        const parent = await submitPrivateRootRun({
          coordinator,
          projectRoot: testCase.fixture.root,
          packageStoreRoot: testCase.fixture.store,
          submissionId: `hook-${testCase.name}-parent`,
          target: { kind: "binding", id: "producer" },
          input: { value: "root" },
          deadlineUnixMs: 50_000,
        });
        await installHookCandidate(testCase.fixture, {
          enabled: true,
          ...(testCase.evidence === undefined ? {} : { dispositionEvidence: testCase.evidence }),
        });
        await applyLatestCandidate(testCase.fixture);
        const receipt = await appendPrivateRootJournalEvent({
          coordinator,
          projectRoot: testCase.fixture.root,
          packageStoreRoot: testCase.fixture.store,
          allocation: normalizePrivateRootJournalAppendAllocation({
            kind: "private-root-journal-append-allocation/1",
            parentRunId: parent.run.runId,
            coordinatorEpoch: coordinator.epoch,
            publisherBinding: "publisher",
            eventTypes: ["https://example.org/events/work-created"],
            call: {
              operationId: `hook-${testCase.name}:1`,
              slot: "journal",
              method: "append",
              input: { type: "https://example.org/events/work-created", data: null },
            },
          }),
          committedAtUnixMs: 10_000,
        });
        expect(receipt.derivedRuns).toHaveLength(1);
        expect(receipt.derivedRuns[0]).toMatchObject({
          state: "terminal",
          terminal: {
            status: "failed",
            code: testCase.name === "invalid" ? "INVALID_INPUT" : "UNAVAILABLE",
          },
        });
      } finally {
        await coordinator?.dispose();
        await testCase.fixture.dispose();
      }
    }
  }, 90_000);

  test("wakes Hook-derived work before its publisher settles and rescans a lost wake", async () => {
    const fixture = await createFixture("ready", true);
    let controller: Awaited<ReturnType<typeof openPrivateRootAdministrationController>> | undefined;
    let releasePublisher!: () => void;
    const publisherGate = new Promise<void>((resolve) => { releasePublisher = resolve; });
    let derivedSettled!: (run: Awaited<ReturnType<typeof loadPrivateRootRun>>) => void;
    let nextDerived = new Promise<Awaited<ReturnType<typeof loadPrivateRootRun>>>(
      (resolve) => { derivedSettled = resolve; },
    );
    const executions = new Map<string, number>();
    try {
      await installHookCandidate(fixture, { enabled: true });
      await applyLatestCandidate(fixture);
      controller = await openPrivateRootAdministrationController({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        runTimeoutMs: 60_000,
        execute: async (runId, coordinator, _signal, notifyWorkAvailable) => {
          executions.set(runId, (executions.get(runId) ?? 0) + 1);
          const work = await reacquirePrivateRootExecutionWork({
            coordinator,
            projectRoot: fixture.root,
            packageStoreRoot: fixture.store,
            runId,
          });
          if (work.run.origin.kind === "private-root-external-submission-origin/1") {
            const mode = (work.run.input as { readonly mode: string }).mode;
            await appendPrivateRootJournalEvent({
              coordinator,
              projectRoot: fixture.root,
              packageStoreRoot: fixture.store,
              allocation: normalizePrivateRootJournalAppendAllocation({
                kind: "private-root-journal-append-allocation/1",
                parentRunId: runId,
                coordinatorEpoch: coordinator.epoch,
                publisherBinding: "publisher",
                eventTypes: ["https://example.org/events/work-created"],
                call: {
                  operationId: `controller-wake:${mode}`,
                  slot: "journal",
                  method: "append",
                  input: {
                    type: "https://example.org/events/work-created",
                    data: { mode },
                  },
                },
              }),
              committedAtUnixMs: 10_000,
            });
            if (mode === "immediate") {
              notifyWorkAvailable();
              notifyWorkAvailable();
              await publisherGate;
            }
          }
          const settled = await closeTestRootExecution(fixture.root, coordinator, runId, {
            status: "succeeded",
            result: { outcome: "done", output: { accepted: work.run.input } },
            diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
          });
          if (work.run.origin.kind === "private-root-hook-derived-origin/1") {
            derivedSettled(settled.run);
          }
          return settled;
        },
      });

      const immediate = await controller.administration.startRun({
        submissionId: "hook-controller-immediate",
        target: { kind: "binding", id: "producer" },
        input: { mode: "immediate" },
      });
      const immediateDerived = await nextDerived;
      expect(immediateDerived).toMatchObject({
        origin: { kind: "private-root-hook-derived-origin/1" },
        state: "terminal",
        terminal: { status: "succeeded" },
      });
      expect(await controller.administration.runStatus(immediate)).toMatchObject({ state: "pending" });
      releasePublisher();
      await controller.drain();

      nextDerived = new Promise((resolve) => { derivedSettled = resolve; });
      const rescanned = await controller.administration.startRun({
        submissionId: "hook-controller-terminal-rescan",
        target: { kind: "binding", id: "producer" },
        input: { mode: "terminal-rescan" },
      });
      const rescannedDerived = await nextDerived;
      await controller.drain();
      expect(await controller.administration.runStatus(rescanned)).toMatchObject({
        state: "terminal",
        terminal: { status: "succeeded" },
      });
      expect(rescannedDerived).toMatchObject({
        origin: { kind: "private-root-hook-derived-origin/1" },
        state: "terminal",
        terminal: { status: "succeeded" },
      });
      expect([...executions.values()]).toEqual([1, 1, 1, 1]);
    } finally {
      releasePublisher();
      await controller?.dispose();
      await fixture.dispose();
    }
  }, 90_000);

  test("separates attached root authority disposal from coordinator ownership", async () => {
    const fixture = await createFixture("ready");
    let coordinator: PrivateProjectCoordinator | undefined;
    let attached: Awaited<ReturnType<typeof attachPrivateRootAdministrationController>> | undefined;
    let owned: Awaited<ReturnType<typeof openPrivateRootAdministrationController>> | undefined;
    let reopened: PrivateProjectCoordinator | undefined;
    try {
      await applyLatestCandidate(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      attached = await attachPrivateRootAdministrationController({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        runTimeoutMs: 60_000,
        execute: async () => { throw new Error("empty project must not execute root work"); },
      });
      await attached.dispose();
      await expect(attached.administration.runStatus({
        runId: `sha256:${"0".repeat(64)}`,
      })).rejects.toMatchObject({ code: "PROJECT_CLOSED" });
      await coordinator.verify();
      await expect(openPrivateProjectCoordinator({ projectRoot: fixture.root })).rejects.toMatchObject({
        code: "COORDINATOR_BUSY",
      });

      await coordinator.dispose();
      coordinator = undefined;
      attached = undefined;
      owned = await openPrivateRootAdministrationController({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        runTimeoutMs: 60_000,
        execute: async () => { throw new Error("empty project must not execute root work"); },
      });
      await expect(openPrivateProjectCoordinator({ projectRoot: fixture.root })).rejects.toMatchObject({
        code: "COORDINATOR_BUSY",
      });
      await owned.dispose();
      owned = undefined;
      reopened = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      await reopened.verify();
    } finally {
      await reopened?.dispose();
      await owned?.dispose();
      await attached?.dispose();
      await coordinator?.dispose();
      await fixture.dispose();
    }
  }, 90_000);

  test("retries only store-busy durable root executors", async () => {
    for (const testCase of [
      { name: "busy-once", expectedAttempts: 2, succeeds: true },
      { name: "non-busy", expectedAttempts: null, succeeds: false },
      { name: "busy-exhausted", expectedAttempts: 8, succeeds: false },
    ] as const) {
      const fixture = await createFixture("ready");
      let controller: Awaited<ReturnType<typeof openPrivateRootAdministrationController>> | undefined;
      let attempts = 0;
      let releaseFailure!: () => void;
      const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
      let markFailureEntered!: () => void;
      const failureEntered = new Promise<void>((resolve) => { markFailureEntered = resolve; });
      try {
        await applyLatestCandidate(fixture);
        controller = await openPrivateRootAdministrationController({
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          runTimeoutMs: 60_000,
          execute: async (runId, coordinator) => {
            attempts += 1;
            if (testCase.name === "busy-exhausted" ||
                (testCase.name === "busy-once" && attempts === 1)) {
              throw new CheckError(
                "unavailable",
                "ADMISSION_STATE_BUSY",
                "retry the complete durable root operation",
              );
            }
            if (testCase.name === "non-busy") {
              markFailureEntered();
              await failureGate;
              throw new Error("non-retryable executor failure");
            }
            return await closeTestRootExecution(fixture.root, coordinator, runId, {
              status: "succeeded",
              result: { outcome: "done", output: { attempts } },
              diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
            });
          },
        });
        const submitted = await controller.administration.startRun({
          submissionId: `executor-retry-${testCase.name}`,
          target: { kind: "flow", path: "flows/run" },
          input: { value: testCase.name },
        });
        if (testCase.succeeds) {
          releaseFailure();
          await controller.drain();
          expect(await controller.administration.runStatus(submitted)).toMatchObject({
            state: "terminal",
            terminal: { status: "succeeded", output: { attempts: 2 } },
          });
        } else if (testCase.name === "non-busy") {
          await failureEntered;
          const disposing = controller.dispose();
          await Bun.sleep(0);
          releaseFailure();
          await expect(disposing).rejects.toThrow(
            "root Run controller cleanup failed",
          );
          controller = undefined;
        } else {
          releaseFailure();
          await expect(controller.drain()).rejects.toThrow(
            "root Run controller did not settle cleanly",
          );
        }
        if (testCase.expectedAttempts === null) {
          // The controller's pre-existing fixed-point rescan may schedule an
          // unresolved failed Run again. A non-busy error must still avoid
          // the bounded eight-attempt store-contention retry burst.
          expect(attempts).toBeGreaterThan(0);
          expect(attempts).toBeLessThan(8);
        } else {
          expect(attempts).toBe(testCase.expectedAttempts);
        }
      } finally {
        releaseFailure();
        await controller?.dispose().catch(() => undefined);
        await fixture.dispose();
      }
    }
  }, 90_000);

  test("retries a store-busy durable executor during older-epoch recovery", async () => {
    const fixture = await createFixture("ready");
    let prior: PrivateProjectCoordinator | undefined;
    let recovered: Awaited<ReturnType<typeof openPrivateRootAdministrationController>> | undefined;
    let attempts = 0;
    try {
      await applyLatestCandidate(fixture);
      prior = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const abandoned = await submitPrivateRootRun({
        coordinator: prior,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "executor-retry-older",
        target: { kind: "flow", path: "flows/run" },
        input: { value: "older" },
        deadlineUnixMs: Date.now() + 60_000,
      });
      await prior.dispose();
      prior = undefined;

      recovered = await openPrivateRootAdministrationController({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        runTimeoutMs: 60_000,
        execute: async (runId, coordinator) => {
          attempts += 1;
          if (attempts === 1) {
            throw new CheckError(
              "unavailable",
              "ADMISSION_STATE_BUSY",
              "retry the complete durable recovery operation",
            );
          }
          return await closeTestRootExecutionWithoutPlan(fixture.root, coordinator, runId, {
            status: "lost",
            code: "COORDINATOR_LOST",
            message: "the prior coordinator disappeared before a proved result",
          });
        },
      });
      expect(attempts).toBe(2);
      expect(await recovered.administration.runStatus({ runId: abandoned.run.runId })).toMatchObject({
        state: "terminal",
        terminal: { status: "lost", code: "COORDINATOR_LOST" },
      });
    } finally {
      await recovered?.dispose().catch(() => undefined);
      await prior?.dispose().catch(() => undefined);
      await fixture.dispose();
    }
  }, 90_000);

  test("projects durable root Runs through the closed administration authority", async () => {
    const fixture = await createFixture("ready");
    let controller: Awaited<ReturnType<typeof openPrivateRootAdministrationController>> | undefined;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let cancellationStarted!: () => void;
    const cancellationReady = new Promise<void>((resolve) => { cancellationStarted = resolve; });
    let executions = 0;
    try {
      const plan = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      });
      controller = await openPrivateRootAdministrationController({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        runTimeoutMs: 60_000,
        execute: async (runId, coordinator, signal) => {
          executions += 1;
          const work = await reacquirePrivateRootExecutionWork({
            coordinator,
            projectRoot: fixture.root,
            packageStoreRoot: fixture.store,
            runId,
          });
          const value = (work.run.input as { readonly value: string }).value;
          let terminal: PrivateRootRunTerminal;
          if (value === "fail") {
            terminal = {
              status: "failed",
              code: "EXECUTION_FAILED",
              message: "simulated executor failure",
              diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
            };
            return await closeTestRootExecution(fixture.root, coordinator, runId, terminal);
          }
          if (value === "cancel") {
            cancellationStarted();
            if (!signal.aborted) {
              await new Promise<void>((resolve) => {
                signal.addEventListener("abort", () => resolve(), { once: true });
              });
            }
            terminal = {
              status: "failed",
              code: "CANCELLED",
              message: "simulated executor cancellation",
              diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
            };
            return await closeTestRootExecution(fixture.root, coordinator, runId, terminal);
          }
          await gate;
          terminal = {
            status: "succeeded",
            result: { outcome: "done", output: { accepted: work.run.input } },
            diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
          };
          return await closeTestRootExecution(fixture.root, coordinator, runId, terminal);
        },
      });
      await expect(openPrivateRootAdministrationController({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        runTimeoutMs: 60_000,
        execute: async () => { throw new Error("must not execute"); },
      })).rejects.toMatchObject({ name: "RootAdministrationError", code: "PROJECT_BUSY" });
      await expect(controller.administration.startRun({
        submissionId: "invalid",
        target: { kind: "flow", path: "flows/run" },
        input: undefined,
      } as any)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await controller.drain();

      const mutable = { value: "first" };
      let waits = 0;
      const completion = awaitRootRun({
        administration: controller.administration,
        request: {
          submissionId: "ticket-admin-1",
          target: { kind: "flow", path: "flows/run" },
          input: mutable,
        },
        wait: async () => {
          waits += 1;
          mutable.value = "changed";
          release();
          await Bun.sleep(1);
        },
      });
      const completed = await completion;
      expect(waits).toBeGreaterThan(0);
      expect(await controller.administration.startRun({
        submissionId: "ticket-admin-1",
        target: { kind: "flow", path: "flows/run" },
        input: { value: "first" },
      })).toEqual({ runId: completed.runId });
      expect(executions).toBe(1);

      const ordered = await controller.administration.startRun({
        submissionId: "opaque\0 replay\nkey 🚀",
        target: { kind: "flow", path: "./flows/run" },
        input: { value: "first", nested: { a: 1, b: 2 } },
      });
      const reordered = await controller.administration.startRun({
        submissionId: "opaque\0 replay\nkey 🚀",
        target: { kind: "flow", path: "flows/run" },
        input: { nested: { b: 2, a: 1 }, value: "first" },
      });
      expect(reordered).toEqual(ordered);

      await expect(controller.administration.startRun({
        submissionId: "ticket-admin-1",
        target: { kind: "flow", path: "flows/run" },
        input: { value: "different" },
      })).rejects.toMatchObject({
        name: "RootAdministrationError",
        code: "SUBMISSION_CONFLICT",
      });
      await expect(controller.administration.runStatus({
        runId: `sha256:${"0".repeat(64)}`,
      })).rejects.toMatchObject({
        name: "RootAdministrationError",
        code: "RUN_NOT_FOUND",
      });

      await controller.drain();
      expect(completed).toEqual({
        runId: completed.runId,
        submissionId: "ticket-admin-1",
        target: { kind: "flow", path: "flows/run" },
        state: "terminal",
        terminal: {
          status: "succeeded",
          outcome: "done",
          output: { accepted: { value: "first" } },
          diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
        },
      });
      expect(Object.keys(completed).sort()).toEqual([
        "runId", "state", "submissionId", "target", "terminal",
      ]);
      expect(Object.isFrozen(completed)).toBe(true);
      expect(Object.isFrozen(completed.terminal)).toBe(true);

      const failed = await controller.administration.startRun({
        submissionId: "ticket-admin-fail",
        target: { kind: "flow", path: "flows/run" },
        input: { value: "fail" },
      });
      await controller.drain();
      expect(await controller.administration.runStatus(failed)).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "EXECUTION_FAILED" },
      });

      const cancelledSubmission = controller.administration.startRun({
        submissionId: "ticket-admin-cancel",
        target: { kind: "flow", path: "flows/run" },
        input: { value: "cancel" },
      });
      const disposing = controller.dispose();
      const cancelled = await cancelledSubmission;
      await Promise.all([cancellationReady, disposing]);
      expect(await loadPrivateRootRun({
        projectRoot: fixture.root,
        runId: cancelled.runId,
      })).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "CANCELLED" },
      });
      await expect(controller.administration.startRun({
        submissionId: "ticket-closed",
        target: { kind: "flow", path: "flows/run" },
        input: { value: "closed" },
      })).rejects.toBeInstanceOf(RootAdministrationError);
      await expect(controller.administration.runStatus({ runId: completed.runId })).rejects.toMatchObject({
        code: "PROJECT_CLOSED",
      });
    } finally {
      release();
      await controller?.dispose();
      await fixture.dispose();
    }
  });

  test("converges a published-lock crash state and applies locked mode without replacing the lock", async () => {
    const fixture = await createFixture();
    try {
      const plan = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      const lock = join(fixture.root, "jig.lock");
      const stage = join(fixture.root, ".jig", "private-activation-jig-lock-v1.stage");
      const proposed = encodePrivateProjectLocalLock(fixture.candidate.lock);
      await writeFile(lock, proposed, { mode: 0o644 });
      await writeFile(stage, "partial crash residue", { mode: 0o600 });
      const before = await stat(lock);
      const database = openSqlite(fixture.database, "readonly");
      expect(database.query("SELECT count(*) AS count FROM admissions").get().count).toBe(0);
      expect(database.query("SELECT revision FROM admission_head WHERE singleton = 1").get().revision)
        .toBeNull();
      database.close(true);

      const first = requireAdmissionReceipt(await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      }));
      expect(new Uint8Array(await readFile(lock))).toEqual(proposed);
      expect((await stat(lock)).ino).toBe(before.ino);
      await expect(stat(stage)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      })).toEqual(first);

      const locked = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "locked",
      });
      const lockedBefore = await stat(lock);
      expect(locked).toEqual({ state: "unchanged" });
      expect((await stat(lock)).ino).toBe(lockedBefore.ino);
      expect(new Uint8Array(await readFile(lock))).toEqual(proposed);
      await expect(stat(stage)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await fixture.dispose(); }
  });

  test("serializes concurrent replay and admits exactly one competing child", async () => {
    const fixture = await createFixture();
    try {
      const firstPlan = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      }));
      const receipts = await Promise.all(Array.from({ length: 4 }, () => retryBusy(
        () => applyPrivateActivationReviewPlan({
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          planDigest: firstPlan.planDigest,
        }),
      )));
      expect(receipts).toEqual(Array.from({ length: 4 }, () => receipts[0]));

      await installHookCandidate(fixture, { enabled: false });
      const stalePlan = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      }));
      await installHookCandidate(fixture, {
        enabled: false,
        extraEventTypes: ["https://example.org/events/second"],
      });
      const currentPlan = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      }));
      const attempts = await Promise.allSettled([stalePlan, currentPlan].map((plan) => retryBusy(
        () => applyPrivateActivationReviewPlan({
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          planDigest: plan.planDigest,
        }),
      )));
      const admitted = attempts.filter((result) => result.status === "fulfilled");
      const rejected = attempts.filter((result) => result.status === "rejected");
      expect(admitted).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "STALE_PLAN" });

      const database = openSqlite(fixture.database, "readonly");
      expect(database.query("SELECT count(*) AS count FROM admissions").get().count).toBe(2);
      expect(database.query(
        "SELECT admissions.admission_digest FROM admission_head JOIN admissions USING (revision) WHERE singleton = 1",
      ).get().admission_digest).toBe((admitted[0] as PromiseFulfilledResult<{
        admissionDigest: string;
      }>).value.admissionDigest);
      database.close(true);
      expect(await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: firstPlan.planDigest,
      })).toEqual(receipts[0]);
    } finally { await fixture.dispose(); }
  });

  test("bounds crash residue and rejects third-state lock drift before admission", async () => {
    const fixture = await createFixture();
    try {
      const plan = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      const stage = join(fixture.root, ".jig", "private-activation-jig-lock-v1.stage");
      await mkdir(stage, { mode: 0o700 });
      await expect(applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_LOCK_STAGE_UNSAFE" });
      expect((await stat(stage)).isDirectory()).toBeTrue();
      await rm(stage, { recursive: true });

      await writeFile(stage, "partial", { mode: 0o600 });
      const receipt = await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      });
      expect(receipt.admission.planDigest).toBe(plan.planDigest);
      await expect(stat(stage)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await fixture.dispose(); }

    const drift = await createFixture();
    try {
      const plan = await createPrivateActivationReviewPlan({
        projectRoot: drift.root,
        packageStoreRoot: drift.store,
        lockMode: "update",
      });
      await writeFile(join(drift.root, "jig.lock"), json1({
        kind: "private-package-project-lock/3",
        packages: {},
        bindings: {},
        journalPublishers: {},
        hooks: {},
      }));
      await expect(applyPrivateActivationReviewPlan({
        projectRoot: drift.root,
        packageStoreRoot: drift.store,
        planDigest: plan.planDigest,
      })).rejects.toMatchObject({ code: "STALE_PLAN" });
      const database = openSqlite(drift.database, "readonly");
      try { expect(database.query("SELECT count(*) AS count FROM admissions").get().count).toBe(0); }
      finally { database.close(true); }
    } finally { await drift.dispose(); }
  });

  test("normalizes malformed visible-lock parsing at the Plan and apply boundaries", async () => {
    const planning = await createFixture();
    try {
      await writeFile(join(planning.root, "jig.lock"), "not canonical JSON/1\n");
      await expect(createPrivateActivationReviewPlan({
        projectRoot: planning.root,
        packageStoreRoot: planning.store,
        lockMode: "update",
      })).rejects.toMatchObject({ code: "LOCK_MISMATCH" });
    } finally { await planning.dispose(); }

    const applying = await createFixture();
    try {
      const plan = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: applying.root,
        packageStoreRoot: applying.store,
        lockMode: "update",
      }));
      await writeFile(join(applying.root, "jig.lock"), "not canonical JSON/1\n");
      await expect(applyPrivateActivationReviewPlan({
        projectRoot: applying.root,
        packageStoreRoot: applying.store,
        planDigest: plan.planDigest,
      })).rejects.toMatchObject({ code: "STALE_PLAN" });
    } finally { await applying.dispose(); }
  });

  test("accepts a safe non-hot journal but rejects unsafe and WAL sidecars", async () => {
    const fixture = await createFixture();
    try {
      const plan = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      const journal = `${fixture.database}-journal`;
      const bytes = new Uint8Array(512);
      await writeFile(journal, bytes, { mode: 0o600 });
      expect((await loadPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      })).plan).toEqual(plan.plan);
      expect(new Uint8Array(await readFile(journal))).toEqual(bytes);

      await chmod(journal, 0o644);
      await expect(loadPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_SQLITE_SIDECAR" });
      await rm(journal);

      await writeFile(`${fixture.database}-wal`, new Uint8Array(), { mode: 0o600 });
      await expect(loadPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_SQLITE_SIDECAR" });
    } finally {
      await fixture.dispose();
    }
  });

  test("rejects a codec-valid Plan whose proposal differs from its named candidate", async () => {
    const fixture = await createFixture();
    try {
      const retained = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      const value = decodeJson1(retained.planBytes) as any;
      const targets = value.proposed.targets.map((target: any, index: number) => index === 0
        ? {
            ...target,
            disposition: {
              state: "unavailable",
              code: "RUNTIME_UNAVAILABLE",
              evidenceDigests: [digest("tampered-plan-proposal")],
            },
          }
        : target);
      const tamperedBytes = json1({
        ...value,
        activationMeaningDigest: privateDomainDigest(
          "JIG-Private-Activation-Meaning/1",
          { observedSemanticDigest: value.observedSemanticDigest, targets },
        ),
        proposed: { ...value.proposed, targets },
      });
      const tampered = decodePrivateActivationPlanV2(tamperedBytes);
      const tamperedDigest = privateActivationPlanDigestV2(tampered);
      const database = openSqlite(fixture.database, "readwrite");
      database.query(
        "UPDATE review_plans SET plan_digest = ?1, plan_bytes = ?2 WHERE plan_digest = ?3",
      ).run(tamperedDigest, tamperedBytes, retained.planDigest);
      database.close(true);

      await expect(loadPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: tamperedDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await fixture.dispose();
    }
  });

  test("rejects a codec-valid admission operation when protected state derives lock repair", async () => {
    const fixture = await createFixture();
    try {
      await applyLatestCandidate(fixture);
      await rm(join(fixture.root, "jig.lock"));
      const retained = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      }));
      expect(retained.plan.operation).toBe("lock-repair");
      const tamperedBytes = json1({
        ...(decodeJson1(retained.planBytes) as Record<string, JsonValue>),
        operation: "admission",
      });
      const tampered = decodePrivateActivationPlanV2(tamperedBytes);
      const tamperedDigest = privateActivationPlanDigestV2(tampered);
      const database = openSqlite(fixture.database, "readwrite");
      database.query(
        "UPDATE review_plans SET plan_digest = ?1, plan_bytes = ?2 WHERE plan_digest = ?3",
      ).run(tamperedDigest, tamperedBytes, retained.planDigest);
      database.close(true);

      await expect(loadPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: tamperedDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
      await expect(applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: tamperedDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
      const unchanged = openSqlite(fixture.database, "readonly");
      try { expect(unchanged.query("SELECT count(*) AS count FROM admissions").get().count).toBe(1); }
      finally { unchanged.close(true); }
    } finally {
      await fixture.dispose();
    }
  });

  test("rejects a persisted exact-observed Plan when classification derives unchanged", async () => {
    const fixture = await createFixture();
    try {
      await applyLatestCandidate(fixture);
      await rm(join(fixture.root, "jig.lock"));
      const retained = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      }));
      const value = decodeJson1(retained.planBytes) as Record<string, JsonValue>;
      const proposed = value.proposed as Record<string, JsonValue>;
      const tamperedBytes = json1({
        ...value,
        operation: "admission",
        observedLock: {
          state: "present",
          digest: proposed.lockDigest,
          lock: proposed.lock,
        },
      });
      const tampered = decodePrivateActivationPlanV2(tamperedBytes);
      const tamperedDigest = privateActivationPlanDigestV2(tampered);
      const database = openSqlite(fixture.database, "readwrite");
      database.query(
        "UPDATE review_plans SET plan_digest = ?1, plan_bytes = ?2 WHERE plan_digest = ?3",
      ).run(tamperedDigest, tamperedBytes, retained.planDigest);
      database.close(true);

      await expect(loadPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: tamperedDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
      await expect(applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: tamperedDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await fixture.dispose();
    }
  });

  test("applies and replays one lock repair without mutating admission authority", async () => {
    const fixture = await createFixture();
    try {
      const admission = await applyLatestCandidate(fixture);
      const lockPath = join(fixture.root, "jig.lock");
      await rm(lockPath);
      const retained = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      }));
      expect(retained.plan.operation).toBe("lock-repair");
      const proposed = encodePrivateProjectLocalLock(fixture.candidate.lock);
      const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
      const probe = sqlite.Database.open(":memory:");
      const prototype = Object.getPrototypeOf(probe) as any;
      probe.close(true);
      const original = prototype.query;
      prototype.query = function queryWithRepairReceiptFailure(sql: string): any {
        const statement = original.call(this, sql);
        if (sql !== "INSERT INTO lock_repairs(plan_digest, repair_digest, repair_bytes) VALUES (?1, ?2, ?3)") {
          return statement;
        }
        return {
          safeIntegers(): any { return this; },
          get: statement.get.bind(statement),
          all: statement.all.bind(statement),
          run(): never { throw new Error("injected lock-repair receipt failure"); },
          finalize: statement.finalize.bind(statement),
        };
      };
      try {
        await expect(applyPrivateActivationReviewPlan({
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          planDigest: retained.planDigest,
        })).rejects.toThrow("injected lock-repair receipt failure");
      } finally {
        prototype.query = original;
      }
      expect(new Uint8Array(await readFile(lockPath))).toEqual(proposed);
      const crashed = openSqlite(fixture.database, "readonly");
      try { expect(crashed.query("SELECT count(*) AS count FROM lock_repairs").get().count).toBe(0); }
      finally { crashed.close(true); }

      const concurrent = await Promise.all(Array.from({ length: 4 }, () => retryBusy(
        () => applyPrivateActivationReviewPlan({
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          planDigest: retained.planDigest,
        }),
      )));
      expect(concurrent).toEqual(Array.from({ length: 4 }, () => concurrent[0]));
      const receipt = concurrent[0]!;
      expect(receipt).toMatchObject({
        repair: {
          kind: "private-lock-repair/1",
          planDigest: retained.planDigest,
          activeAdmissionDigest: admission.admissionDigest,
          proposedLockDigest: fixture.candidate.candidate.lockDigest,
        },
      });

      // Historical acknowledgement loss replays before inspecting mutable
      // visible-lock state.
      await writeFile(lockPath, "not a canonical lock\n");
      expect(await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: retained.planDigest,
      })).toEqual(receipt);

      const unchanged = openSqlite(fixture.database, "readonly");
      try {
        expect(unchanged.query("SELECT count(*) AS count FROM admissions").get().count).toBe(1);
        expect(unchanged.query("SELECT count(*) AS count FROM lock_repairs").get().count).toBe(1);
        expect(unchanged.query("SELECT count(*) AS count FROM hook_admission_boundaries").get().count)
          .toBe(1);
        expect(unchanged.query("SELECT revision FROM admission_head WHERE singleton = 1").get())
          .toEqual({ revision: 1 });
      } finally {
        unchanged.close(true);
      }

      const corrupted = openSqlite(fixture.database, "readwrite");
      corrupted.query("UPDATE lock_repairs SET repair_digest = ?1 WHERE plan_digest = ?2")
        .run("not-a-digest", retained.planDigest);
      corrupted.close(true);
      await expect(applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: retained.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
      if (!("repairDigest" in receipt)) throw new Error("test expected a repair receipt");
      const malformed = openSqlite(fixture.database, "readwrite");
      malformed.query(
        "UPDATE lock_repairs SET repair_digest = ?1, repair_bytes = ?2 WHERE plan_digest = ?3",
      ).run(receipt.repairDigest, json1({ kind: "not-a-repair" }), retained.planDigest);
      malformed.close(true);
      await expect(applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: retained.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await fixture.dispose();
    }
  });

  test("commutes explicitly applied equivalent lock-repair Plans without advancing authority", async () => {
    const fixture = await createFixture();
    try {
      const admission = await applyLatestCandidate(fixture);
      const lockPath = join(fixture.root, "jig.lock");
      const proposed = encodePrivateProjectLocalLock(fixture.candidate.lock);
      await rm(lockPath);
      const absentPlan = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      }));
      await writeFile(lockPath, json1({
        kind: "private-package-project-lock/3",
        packages: {},
        bindings: {},
        journalPublishers: {},
        hooks: {},
      }));
      const driftPlan = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      }));
      expect(absentPlan.plan.operation).toBe("lock-repair");
      expect(driftPlan.plan.operation).toBe("lock-repair");
      expect(driftPlan.planDigest).not.toBe(absentPlan.planDigest);

      // Both explicit reviews commute after an exact lock-first crash state.
      await writeFile(lockPath, proposed);
      const receipts = await Promise.all([absentPlan, driftPlan].map((plan) => retryBusy(
        () => applyPrivateActivationReviewPlan({
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          planDigest: plan.planDigest,
        }),
      )));
      expect(new Set(receipts.map((receipt) => "repairDigest" in receipt
        ? receipt.repairDigest
        : "not-a-repair")).size).toBe(2);
      const database = openSqlite(fixture.database, "readonly");
      try {
        expect(database.query("SELECT count(*) AS count FROM admissions").get().count).toBe(1);
        expect(database.query("SELECT count(*) AS count FROM lock_repairs").get().count).toBe(2);
        expect(database.query(
          "SELECT admissions.admission_digest FROM admission_head JOIN admissions USING (revision) WHERE singleton = 1",
        ).get().admission_digest).toBe(admission.admissionDigest);
      } finally { database.close(true); }
    } finally {
      await fixture.dispose();
    }
  });

  test("keeps an active-base lock repair valid across inert candidate-head advances", async () => {
    const fixture = await createFixture();
    try {
      const admission = await applyLatestCandidate(fixture);
      const lockPath = join(fixture.root, "jig.lock");
      const proposed = encodePrivateProjectLocalLock(fixture.candidate.lock);
      await rm(lockPath);
      const originalPlan = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      }));

      await installEquivalentCaptureCandidate(fixture);
      const equivalentReceipt = await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: originalPlan.planDigest,
      });
      expect(equivalentReceipt).toMatchObject({
        repair: { activeAdmissionDigest: admission.admissionDigest },
      });

      await writeFile(lockPath, json1({
        kind: "private-package-project-lock/3",
        packages: {},
        bindings: {},
        journalPublishers: {},
        hooks: {},
      }));
      const beforeMeaningChange = requireApplicablePlan(await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      }));
      expect(beforeMeaningChange.plan.operation).toBe("lock-repair");
      await installHookCandidate(fixture, { enabled: false });
      const meaningChangedReceipt = await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: beforeMeaningChange.planDigest,
      });
      expect(meaningChangedReceipt).toMatchObject({
        repair: { activeAdmissionDigest: admission.admissionDigest },
      });
      expect(new Uint8Array(await readFile(lockPath))).toEqual(proposed);

      const database = openSqlite(fixture.database, "readonly");
      try {
        expect(database.query("SELECT revision FROM candidate_head WHERE singleton = 1").get())
          .toEqual({ revision: 3 });
        expect(database.query("SELECT revision FROM admission_head WHERE singleton = 1").get())
          .toEqual({ revision: 1 });
        expect(database.query("SELECT count(*) AS count FROM lock_repairs").get().count).toBe(2);
      } finally { database.close(true); }
    } finally {
      await fixture.dispose();
    }
  });

  test("rejects current-head corruption and weakened protected paths", async () => {
    const fixture = await createFixture();
    try {
      const plan = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      let database = openSqlite(fixture.database, "readwrite");
      database.query("UPDATE candidates SET candidate_digest = ?1 WHERE revision = 1")
        .run(`sha256:${"0".repeat(64)}`);
      database.close(true);
      await expect(loadPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });

      database = openSqlite(fixture.database, "readwrite");
      database.query("UPDATE candidates SET candidate_digest = ?1 WHERE revision = 1")
        .run(privateActivationCandidateDigestV5(fixture.candidate));
      database.close(true);
      await chmod(fixture.database, 0o644);
      await expect(loadPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_DATABASE_PERMISSIONS" });
      await chmod(fixture.database, 0o600);
      await chmod(join(fixture.root, ".jig"), 0o755);
      await expect(loadPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_PERMISSIONS" });
    } finally {
      await fixture.dispose();
    }
  });
});

interface Fixture {
  readonly root: string;
  readonly store: string;
  readonly database: string;
  readonly candidate: ReturnType<typeof decodePrivateActivationCandidateV5>;
  dispose(): Promise<void>;
}

async function createFixture(
  disposition: "unavailable" | "ready" = "unavailable",
  journal = false,
  rejectDerivedEventInput = false,
  service = false,
): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "jig-admission-store-"));
  const root = join(base, "project");
  const store = join(base, "store");
  const flowSource = join(base, "run-flow");
  const serviceSource = join(base, "service-flow");
  const declarationSource = join(base, "declaration");
  try {
    await mkdir(root, { mode: 0o700 });
    await mkdir(store, { mode: 0o700 });
    await mkdir(flowSource);
    if (service) await mkdir(join(serviceSource, "contracts"), { recursive: true });
    await mkdir(declarationSource);
    await writeFile(join(flowSource, "FLOW.md"), [
      "---",
      "name: run",
      "description: Ordinary admission-store fixture.",
      ...(journal ? [
        "uses:",
        "  journal:",
        "    contract: ./contracts/journal.capability.json",
      ] : service ? [
        "uses:",
        "  counter:",
        "    contract: ./contracts/counter.capability.json",
      ] : []),
      "---",
      "",
    ].join("\n"));
    await writeFile(join(flowSource, "flow.py"), "print('unused')\n");
    if (journal) {
      await mkdir(join(flowSource, "contracts"));
      await writeFile(join(flowSource, "contracts", "journal.capability.json"), await readFile(
        new URL("../../../docs/spec/contracts/jig/journal.capability.json", import.meta.url),
      ));
    }
    if (service) {
      await mkdir(join(flowSource, "contracts"));
      const contractBytes = JSON.stringify({
        $schema: "https://flow.dev/schemas/capability-contract-1.schema.json",
        flowCapabilityContract: 1,
        id: "https://example.test/capabilities/counter",
        version: "1.0.0",
        methods: { next: { input: { type: "object" }, output: { type: "integer" }, errors: {} } },
      });
      await writeFile(join(flowSource, "contracts", "counter.capability.json"), contractBytes);
      await writeFile(join(serviceSource, "contracts", "counter.capability.json"), contractBytes);
      await writeFile(join(serviceSource, "FLOW.md"), [
        "---",
        "name: counter",
        "description: Service lease fixture.",
        "service: 1",
        "provides:",
        "  counter: ./contracts/counter.capability.json",
        "---",
        "",
      ].join("\n"));
      await writeFile(join(serviceSource, "flow.ts"), "#!/usr/bin/env bun\nexport {};\n");
    }
    if (disposition === "ready") {
      await writeFile(join(flowSource, "input.schema.json"), JSON.stringify({
        $schema: "https://flow.dev/schemas/schema-1.json",
        type: "object",
        properties: journal && !rejectDerivedEventInput
          ? {}
          : { value: { type: "string" } },
        required: journal && !rejectDerivedEventInput ? [] : ["value"],
        additionalProperties: journal && !rejectDerivedEventInput,
      }));
    }
    await writeFile(join(declarationSource, "jig.ts"), "export default {};\n");

    const flow = await retainPackage(store, flowSource);
    const servicePackage = service ? await retainPackage(store, serviceSource) : undefined;
    const declaration = await retainPackage(store, declarationSource);
    let serviceContract: { readonly id: string; readonly version: string; readonly digest: string } | undefined;
    if (servicePackage !== undefined) {
      const captured = await captureStoredPackage(store, servicePackage);
      try {
        const inspected = await inspectCapturedPackage(captured);
        const checked = inspected.providedContracts[0]!;
        serviceContract = Object.freeze({
          id: checked.contract.descriptor.id,
          version: checked.contract.descriptor.version,
          digest: checked.contract.digest,
        });
      } finally { await captured.dispose(); }
    }
    const rootInformation = await stat(root, { bigint: true });
    const lockBytes = json1({
      kind: "private-package-project-lock/3",
      packages: {
        "flows/run": {
          digest: flow.digest,
          mode: "run",
          directRun: !journal && !service,
          attachments: {},
          uses: journal ? {
            journal: {
              kind: "contract",
              id: "https://jig.dev/contracts/journal",
              version: "1.0.0",
              digest: "sha256:dd749f53de3a5f80e02386699355e28c1fd7e707b2b12bdf2d5c725eb436ddf9",
            },
          } : service ? { counter: { kind: "contract", ...serviceContract! } } : {},
          provides: {},
        },
        ...(service ? {
          "flows/counter": {
            digest: servicePackage!.digest,
            mode: "service",
            directRun: false,
            attachments: {},
            uses: {},
            provides: { counter: serviceContract! },
          },
        } : {}),
      },
      bindings: journal ? {
        producer: {
          packagePath: "flows/run",
          attachments: {},
          slots: {
            journal: {
              kind: "capability",
              provider: { binding: "publisher", export: "journal" },
            },
          },
        },
      } : service ? {
        app: {
          packagePath: "flows/run",
          attachments: {},
          slots: {
            counter: {
              kind: "capability",
              provider: { binding: "counter", export: "counter" },
            },
          },
        },
        counter: { packagePath: "flows/counter", attachments: {}, slots: {} },
      } : {},
      journalPublishers: journal ? {
        publisher: {
          source: "binding:publisher",
          contract: {
            id: "https://jig.dev/contracts/journal",
            version: "1.0.0",
            digest: "sha256:dd749f53de3a5f80e02386699355e28c1fd7e707b2b12bdf2d5c725eb436ddf9",
          },
          eventTypes: ["https://example.org/events/work-created"],
        },
      } : {},
      hooks: {},
    });
    const lock = decodePrivateProjectLocalLock(lockBytes);
    const captureDigest = digest("capture");
    const planningObservationDigest = digest("planning");
    const candidate = decodePrivateActivationCandidateV5({
      candidate: json1(candidateV5({
        kind: "private-activation-candidate/4",
        projectRoot: {
          device: rootInformation.dev.toString(),
          inode: rootInformation.ino.toString(),
        },
        captureDigest,
        semanticDigest: digest("semantic"),
        resolutionInputDigest: privateDomainDigest(
          "JIG-Package-Project-Resolution-Input/1",
          { captureDigest, planningObservationDigest },
        ),
        planningObservationDigest,
        lockDigest: privateProjectLocalLockDigest(lock),
        declarationArtifact: {
          kind: "author-closure/1",
          closureDigest: digest("declaration-closure"),
          package: declaration,
        },
        targets: [{
          request: activationRequest({
            target: journal
              ? { kind: "binding", id: "producer" }
              : service
                ? { kind: "binding", id: "app" }
              : { kind: "flow", path: "flows/run" },
            mode: "run",
            packagePath: "flows/run",
            package: flow,
            entrypoint: { path: "flow.py", suffix: "py" },
            settings: {},
            attachments: {},
            slots: journal ? {
              journal: {
                kind: "capability",
                contract: {
                  id: "https://jig.dev/contracts/journal",
                  version: "1.0.0",
                  digest: "sha256:dd749f53de3a5f80e02386699355e28c1fd7e707b2b12bdf2d5c725eb436ddf9",
                },
                provider: { binding: "publisher", export: "journal" },
              },
            } : service ? {
              counter: {
                kind: "capability",
                contract: serviceContract!,
                provider: { binding: "counter", export: "counter" },
              },
            } : {},
          }),
          disposition: disposition === "ready"
            ? {
                state: "ready",
                recipeDigest: digest("recipe"),
                observationDigest: digest("observation"),
              }
            : {
                state: "unavailable",
                code: "RUNTIME_UNAVAILABLE",
                evidenceDigests: [digest("evidence")],
              },
        }, ...(service ? [{
          request: activationRequest({
            target: { kind: "binding", id: "counter" },
            mode: "service",
            packagePath: "flows/counter",
            package: servicePackage!,
            entrypoint: { path: "flow.ts", suffix: "ts" },
            settings: {},
            attachments: {},
            slots: {},
          }),
          disposition: {
            state: "ready",
            recipeDigest: digest("service-recipe"),
            observationDigest: digest("service-observation"),
          },
        }] : [])],
      })),
      lock: lockBytes,
    });
    const encoded = encodePrivateActivationCandidateV5(candidate);

    const state = join(root, ".jig");
    const databasePath = join(state, "private-activation-admission-v18.sqlite3");
    await mkdir(state, { mode: 0o700 });
    const databaseFile = await open(
      databasePath,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await databaseFile.close();
    const database = openSqlite(databasePath, "readwrite");
    try {
      database.exec([
        "PRAGMA journal_mode=DELETE",
        "PRAGMA synchronous=EXTRA",
        "PRAGMA foreign_keys=ON",
        CREATE_CANDIDATES,
        CREATE_CANDIDATE_HEAD,
        CREATE_REVIEW_PLANS,
        CREATE_LOCK_REPAIRS,
        CREATE_ADMISSIONS,
        CREATE_ADMISSION_HEAD,
        CREATE_COORDINATOR_HEAD,
        CREATE_ROOT_RUNS,
        CREATE_ROOT_SPAWN_INTENTS,
        CREATE_ROOT_EXECUTION_LIFECYCLES,
        CREATE_ROOT_EXECUTION_CLOSURES,
        CREATE_ROOT_FLOW_CALLS,
        CREATE_ROOT_FLOW_CALL_FACTS,
        CREATE_ROOT_FLOW_CALL_CLOSURES,
        CREATE_JOURNAL_HEAD,
        CREATE_JOURNAL_EVENTS,
        CREATE_HOOK_ADMISSION_BOUNDARIES,
        CREATE_HOOK_DERIVATIONS,
        CREATE_HOOK_REVISIONS,
        CREATE_HOOK_REVISIONS_ONE_OPEN,
        CREATE_ROOT_JOURNAL_APPENDS,
        CREATE_ROOT_JOURNAL_TERMINALS,
        CREATE_ROOT_JOURNAL_HOOK_SELECTIONS,
        CREATE_ROOT_JOURNAL_CLOSURES,
        CREATE_ROOT_TERMINALS,
        CREATE_SERVICE_MOUNTS,
        CREATE_SERVICE_MOUNT_FACTS,
        CREATE_SERVICE_LEASES,
        CREATE_SERVICE_INVOCATIONS,
        "INSERT INTO candidate_head(singleton, revision) VALUES (1, NULL)",
        "INSERT INTO admission_head(singleton, revision) VALUES (1, NULL)",
        "INSERT INTO coordinator_head(singleton, epoch) VALUES (1, 0)",
        "INSERT INTO journal_head(singleton, position) VALUES (1, 0)",
        "PRAGMA application_id=1246316353",
        "PRAGMA user_version=18",
      ].join(";"));
      database.exec("BEGIN IMMEDIATE");
      database.query(
        "INSERT INTO candidates(revision, candidate_digest, candidate_bytes, lock_bytes) VALUES (1, ?1, ?2, ?3)",
      ).run(privateActivationCandidateDigestV5(candidate), encoded.candidate, encoded.lock);
      database.query("UPDATE candidate_head SET revision = 1 WHERE singleton = 1").run();
      database.exec("COMMIT");
    } finally {
      database.close(true);
    }
    return Object.freeze({
      root,
      store,
      database: databasePath,
      candidate,
      async dispose(): Promise<void> { await rm(base, { recursive: true, force: true }); },
    });
  } catch (error) {
    await rm(base, { recursive: true, force: true });
    throw error;
  }
}

async function applyLatestCandidate(
  fixture: Fixture,
): Promise<Extract<Awaited<ReturnType<typeof applyPrivateActivationReviewPlan>>, { admission: unknown }>> {
  const plan = requireApplicablePlan(await createPrivateActivationReviewPlan({
    projectRoot: fixture.root,
    packageStoreRoot: fixture.store,
    lockMode: "update",
  }));
  return requireAdmissionReceipt(await applyPrivateActivationReviewPlan({
    projectRoot: fixture.root,
    packageStoreRoot: fixture.store,
    planDigest: plan.planDigest,
  }));
}

function requireApplicablePlan<T extends { readonly state: string }>(
  result: T,
): Extract<T, { readonly state: "applicable" }> {
  if (result.state !== "applicable") throw new Error("test expected an applicable review plan");
  return result as Extract<T, { readonly state: "applicable" }>;
}

function requireAdmissionReceipt<T>(
  result: T,
): Extract<T, { readonly admission: unknown }> {
  if (result === null || typeof result !== "object" || !("admission" in result)) {
    throw new Error("test expected an admission receipt");
  }
  return result as Extract<T, { readonly admission: unknown }>;
}

function installAcknowledgedServiceMount(
  fixture: Fixture,
  admissionDigest: string,
  coordinatorEpoch: number,
) {
  const target = fixture.candidate.candidate.targets.find(({ request }) => request.mode === "service")!;
  const mountId = privateDomainDigest("JIG-Private-Service-Mount-ID/1", {
    admissionDigest,
    bindingId: "counter",
  });
  const allocation = normalizePrivateServiceMountAllocation({
    kind: "private-service-mount-allocation/1",
    mountId,
    coordinatorEpoch,
    admissionDigest,
    candidateRevision: 1,
    bindingId: "counter",
    requestDigest: target.request.digest,
    recipeDigest: target.disposition.state === "ready" ? target.disposition.recipeDigest : digest("missing"),
    observationDigest: target.disposition.state === "ready"
      ? target.disposition.observationDigest
      : digest("missing"),
    expectedExports: ["counter"],
    effectiveDeadlineUnixMs: Date.now() + 60_000,
  });
  const allocationDigest = privateServiceMountAllocationDigest(allocation);
  const hexadecimal = mountId.slice("sha256:".length);
  const materializations = join(fixture.root, ".jig", "private-root-materializations");
  const owners = join(fixture.root, ".jig", "private-root-linux-owners");
  const ownerFields = {
    kind: "private-linux-owner-state-allocation/1" as const,
    parent: owners,
    parentDevice: "1",
    parentInode: "2",
    name: `s-${hexadecimal.slice(0, 62)}`,
    directory: join(owners, `s-${hexadecimal.slice(0, 62)}`),
    ownerToken: hexadecimal,
  };
  const ownerAllocation = {
    ...ownerFields,
    digest: privateDomainDigest("JIG-Private-Linux-Owner-State-Allocation/1", ownerFields),
  };
  const packageAllocation = {
    kind: "private-package-materialization-allocation/1" as const,
    parent: { path: materializations, dev: "1", ino: "2" },
    name: `service-${hexadecimal}`,
    path: join(materializations, `service-${hexadecimal}`),
    packageDigest: target.request.package.digest,
    ownerToken: allocationDigest,
  };
  const plan = normalizePrivateServiceMountPlan({
    kind: "private-service-mount-plan/1",
    mountId,
    allocationDigest,
    cancellationGraceMs: 1_000,
    packageAllocation,
    ownerAllocation,
  });
  const backing = normalizePrivateServiceMountBacking({
    kind: "private-service-mount-backing/1",
    mountId,
    allocationDigest,
    planDigest: privateServiceMountPlanDigest(plan),
    lease: {
      kind: "private-package-materialization-lease/1",
      allocation: packageAllocation,
      transaction: { path: packageAllocation.path, dev: "3", ino: "4" },
      package: { path: join(packageAllocation.path, "package"), dev: "5", ino: "6" },
    },
  });
  const runId = `service-${hexadecimal.slice(0, 40)}`;
  const nonce = "b".repeat(24);
  const parentName = `jig-run-${runId}-${nonce}`;
  const parentCgroup = `/sys/fs/cgroup/jig/${parentName}`;
  const sealedFields = {
    kind: "private-linux-sealed-owner/1" as const,
    runId,
    nonce,
    ownerToken: ownerAllocation.ownerToken,
    mechanismDigest: digest("mechanism"),
    sealedPlanDigest: digest("sealed-plan"),
    cgroupScope: "/sys/fs/cgroup/jig",
    cgroupScopeDevice: "7",
    cgroupScopeInode: "8",
    parentName,
    parentCgroup,
    supervisorCgroup: `${parentCgroup}/supervisor`,
    runCgroup: `${parentCgroup}/run`,
    privateDeviceDirectory: `/dev/.jig-${parentName}-devices`,
    deadlineUnixMs: allocation.effectiveDeadlineUnixMs,
    cancellationGraceMs: plan.cancellationGraceMs,
    cleanupTimeoutMs: 5_000,
    trustedHelperPath: "/opt/jig/linux-cgroup-helper",
    trustedHelperDigest: digest("helper"),
    ownerStateParent: ownerAllocation.parent,
    ownerStateParentDevice: ownerAllocation.parentDevice,
    ownerStateParentInode: ownerAllocation.parentInode,
    ownerStateName: ownerAllocation.name,
    ownerStateDirectory: ownerAllocation.directory,
    ownerStateDevice: "9",
    ownerStateInode: "10",
    ownerStateAllocationDigest: ownerAllocation.digest,
  };
  const sealed = {
    ...sealedFields,
    digest: privateDomainDigest("JIG-Private-Linux-Sealed-Owner/1", sealedFields),
  };
  const sandbox = normalizePrivateServiceMountSandbox({
    kind: "private-service-mount-sandbox/1",
    mountId,
    allocationDigest,
    backingDigest: privateServiceMountBackingDigest(backing),
    owner: sealed,
  });
  const preparedOwner = {
    kind: "private-linux-prepared-owner/1" as const,
    digest: privateDomainDigest("JIG-Private-Linux-Prepared-Owner/1", sealed),
    owner: sealed,
  };
  const prepared = normalizePrivateServiceMountPrepared({
    kind: "private-service-mount-prepared/1",
    mountId,
    allocationDigest,
    sandboxDigest: privateServiceMountSandboxDigest(sandbox),
    prepared: preparedOwner,
  });
  const generation = normalizePrivateServiceMountGeneration({
    kind: "private-service-mount-generation/1",
    mountId,
    allocationDigest,
    preparedDigest: privateServiceMountPreparedDigest(prepared),
    generationId: privateDomainDigest("JIG-Private-Service-Generation-ID/1", {
      mountId,
      allocationDigest,
      preparedDigest: privateServiceMountPreparedDigest(prepared),
    }),
    exports: ["counter"],
  });
  const acknowledged = normalizePrivateServiceMountAcknowledged({
    kind: "private-service-mount-acknowledged/1",
    mountId,
    allocationDigest,
    generationDigest: privateServiceMountGenerationDigest(generation),
  });
  const facts: Array<readonly [string, string, Uint8Array]> = [
    ["plan", privateServiceMountPlanDigest(plan), encodePrivateServiceMountPlan(plan)],
    ["backing", privateServiceMountBackingDigest(backing), encodePrivateServiceMountBacking(backing)],
    ["sandbox", privateServiceMountSandboxDigest(sandbox), encodePrivateServiceMountSandbox(sandbox)],
    ["prepared", privateServiceMountPreparedDigest(prepared), encodePrivateServiceMountPrepared(prepared)],
    ["generation", privateServiceMountGenerationDigest(generation), encodePrivateServiceMountGeneration(generation)],
    ["acknowledged", privateServiceMountAcknowledgedDigest(acknowledged),
      encodePrivateServiceMountAcknowledged(acknowledged)],
  ];
  const database = openSqlite(fixture.database, "readwrite");
  try {
    database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    database.query([
      "INSERT INTO service_mounts(mount_id, binding_id, admission_digest, coordinator_epoch,",
      "allocation_digest, allocation_bytes) VALUES (?1, 'counter', ?2, ?3, ?4, ?5)",
    ].join(" ")).run(
      mountId,
      admissionDigest,
      coordinatorEpoch,
      allocationDigest,
      encodePrivateServiceMountAllocation(allocation),
    );
    const insert = database.query(
      "INSERT INTO service_mount_facts(mount_id, fact_name, fact_digest, fact_bytes) VALUES (?1, ?2, ?3, ?4)",
    );
    for (const [name, factDigest, bytes] of facts) insert.run(mountId, name, factDigest, bytes);
    database.exec("COMMIT");
  } catch (error) {
    if (database.inTransaction) database.exec("ROLLBACK");
    throw error;
  } finally { database.close(true); }
  return Object.freeze({
    mountId,
    allocationDigest,
    plan,
    sandbox,
    preparedOwner,
    generation,
    acknowledged,
  });
}

function installServiceMountFence(
  fixture: Fixture,
  installed: ReturnType<typeof installAcknowledgedServiceMount>,
  classification: "host-lifetime" | "provider-loss",
) {
  const provisional = normalizePrivateServiceMountProvisional({
    kind: "private-service-mount-provisional/1",
    mountId: installed.mountId,
    allocationDigest: installed.allocationDigest,
    generationDigest: privateServiceMountGenerationDigest(installed.generation),
    acknowledgedDigest: privateServiceMountAcknowledgedDigest(installed.acknowledged),
    classification,
    terminal: classification === "host-lifetime"
      ? { status: "succeeded", diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false } }
      : {
          status: "failed",
          code: "CHANNEL_LOST",
          message: "provider lost",
          diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
        },
  });
  const fence = normalizePrivateServiceMountFence({
    kind: "private-service-mount-fence/1",
    mountId: installed.mountId,
    allocationDigest: installed.allocationDigest,
    provisionalDigest: privateServiceMountProvisionalDigest(provisional),
    planDigest: privateServiceMountPlanDigest(installed.plan),
    proof: {
      kind: "enforcement-confirmed",
      sandboxDigest: privateServiceMountSandboxDigest(installed.sandbox),
      receipt: {
        kind: "private-linux-confirmed-enforcement/1",
        ownerDigest: installed.preparedOwner.digest,
        stopReason: "payload_exit",
        exitCode: classification === "host-lifetime" ? 0 : 1,
        signal: null,
        fenced: true,
        evidence: { cpuStat: {}, memoryEvents: {}, pidsEvents: {} },
      },
    },
  });
  const database = openSqlite(fixture.database, "readwrite");
  try {
    database.exec("BEGIN IMMEDIATE");
    const insert = database.query(
      "INSERT INTO service_mount_facts(mount_id, fact_name, fact_digest, fact_bytes) VALUES (?1, ?2, ?3, ?4)",
    );
    insert.run(installed.mountId, "provisional", privateServiceMountProvisionalDigest(provisional),
      encodePrivateServiceMountProvisional(provisional));
    insert.run(installed.mountId, "fence", privateServiceMountFenceDigest(fence),
      encodePrivateServiceMountFence(fence));
    database.exec("COMMIT");
  } catch (error) {
    if (database.inTransaction) database.exec("ROLLBACK");
    throw error;
  } finally { database.close(true); }
  return fence;
}

function ownerReleaseForInstalledMount(installed: ReturnType<typeof installAcknowledgedServiceMount>) {
  const fields = {
    kind: "private-linux-owner-state-release/1" as const,
    allocationDigest: installed.plan.ownerAllocation.digest,
    directoryDevice: installed.sandbox.owner.ownerStateDevice,
    directoryInode: installed.sandbox.owner.ownerStateInode,
    released: true as const,
  };
  return Object.freeze({
    ...fields,
    digest: privateDomainDigest("JIG-Private-Linux-Owner-State-Release/1", fields),
  });
}

async function installHookCandidate(
  fixture: Fixture,
  options: {
    readonly enabled: boolean;
    readonly extraEventTypes?: readonly string[];
    readonly dispositionEvidence?: string;
    readonly hookIds?: readonly string[];
    readonly hookType?: string;
    readonly publisherBinding?: string;
  },
): Promise<void> {
  const database = openSqlite(fixture.database, "readwrite");
  try {
    const head = database.query(
      "SELECT revision FROM candidate_head WHERE singleton = 1",
    ).get().revision as number;
    const stored = database.query(
      "SELECT candidate_bytes, lock_bytes FROM candidates WHERE revision = ?1",
    ).get(head) as { readonly candidate_bytes: Uint8Array; readonly lock_bytes: Uint8Array };
    const candidateValue = decodeJson1(stored.candidate_bytes) as any;
    const lockValue = decodeJson1(stored.lock_bytes) as any;
    const target = Object.hasOwn(lockValue.bindings, "producer")
      ? { kind: "binding" as const, id: "producer" }
      : { kind: "flow" as const, path: "flows/run" };
    const selectedType = options.hookType ?? "https://example.org/events/work-created";
    const publisherBinding = options.publisherBinding ?? "publisher";
    const eventTypes = [selectedType, ...(options.extraEventTypes ?? [])].sort();
    const hookIds = options.hookIds ?? ["on-work"];
    const lockBytes = json1({
      ...lockValue,
      journalPublishers: {
        ...lockValue.journalPublishers,
        [publisherBinding]: {
          source: `binding:${publisherBinding}`,
          contract: {
            id: "https://jig.dev/contracts/journal",
            version: "1.0.0",
            digest: "sha256:dd749f53de3a5f80e02386699355e28c1fd7e707b2b12bdf2d5c725eb436ddf9",
          },
          eventTypes,
        },
      },
      hooks: options.enabled ? Object.fromEntries(hookIds.map((hookId) => [hookId, {
        declarationPath: `hooks/${hookId}.ts`,
        source: `binding:${publisherBinding}`,
        publisherBinding,
        type: selectedType,
        target,
        relationDigest: privateHookRelationDigest({
          id: hookId,
          declarationPath: `hooks/${hookId}.ts`,
          source: `binding:${publisherBinding}`,
          publisherBinding,
          type: selectedType,
          target,
        }),
      }])) : {},
    } as JsonValue);
    const lock = decodePrivateProjectLocalLock(lockBytes);
    const disposition = options.dispositionEvidence === undefined
      ? candidateValue.targets[0].disposition
      : {
          state: "unavailable",
          code: "RUNTIME_UNAVAILABLE",
          evidenceDigests: [digest(options.dispositionEvidence)],
        };
    const next = head + 1;
    const candidate = decodePrivateActivationCandidateV5({
      candidate: json1(candidateV5({
        ...candidateValue,
        semanticDigest: digest(`hook-semantic-${next}`),
        lockDigest: privateProjectLocalLockDigest(lock),
        targets: [{
          ...candidateValue.targets[0],
          disposition,
        }],
      } as Record<string, JsonValue>)),
      lock: lockBytes,
    });
    const encoded = encodePrivateActivationCandidateV5(candidate);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.query(
        "INSERT INTO candidates(revision, candidate_digest, candidate_bytes, lock_bytes) VALUES (?1, ?2, ?3, ?4)",
      ).run(next, privateActivationCandidateDigestV5(candidate), encoded.candidate, encoded.lock);
      const changed = database.query(
        "UPDATE candidate_head SET revision = ?1 WHERE singleton = 1 AND revision = ?2",
      ).run(next, head).changes;
      if (changed !== 1) throw new Error("test candidate head changed concurrently");
      database.exec("COMMIT");
    } catch (error) {
      if (database.inTransaction) database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close(true);
  }
}

async function installEquivalentCaptureCandidate(fixture: Fixture): Promise<void> {
  const database = openSqlite(fixture.database, "readwrite");
  try {
    const head = database.query(
      "SELECT revision FROM candidate_head WHERE singleton = 1",
    ).get().revision as number;
    const stored = database.query(
      "SELECT candidate_bytes, lock_bytes FROM candidates WHERE revision = ?1",
    ).get(head) as { readonly candidate_bytes: Uint8Array; readonly lock_bytes: Uint8Array };
    const candidateValue = decodeJson1(stored.candidate_bytes) as Record<string, JsonValue>;
    const next = head + 1;
    const captureDigest = digest(`equivalent-capture-${next}`);
    const planningObservationDigest = candidateValue.planningObservationDigest;
    if (typeof planningObservationDigest !== "string" ||
        typeof candidateValue.observedSemanticDigest !== "string") {
      throw new TypeError("stored candidate fixture lacks its planning identity");
    }
    const candidate = decodePrivateActivationCandidateV5({
      candidate: json1(candidateV5({
        ...candidateValue,
        captureDigest,
        semanticDigest: candidateValue.observedSemanticDigest,
        resolutionInputDigest: privateDomainDigest(
          "JIG-Package-Project-Resolution-Input/1",
          { captureDigest, planningObservationDigest },
        ),
      })),
      lock: stored.lock_bytes,
    });
    const encoded = encodePrivateActivationCandidateV5(candidate);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.query(
        "INSERT INTO candidates(revision, candidate_digest, candidate_bytes, lock_bytes) VALUES (?1, ?2, ?3, ?4)",
      ).run(next, privateActivationCandidateDigestV5(candidate), encoded.candidate, encoded.lock);
      const changed = database.query(
        "UPDATE candidate_head SET revision = ?1 WHERE singleton = 1 AND revision = ?2",
      ).run(next, head).changes;
      if (changed !== 1) throw new Error("test candidate head changed concurrently");
      database.exec("COMMIT");
    } catch (error) {
      if (database.inTransaction) database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close(true);
  }
}

async function installChangedMeaningCandidate(fixture: Fixture): Promise<void> {
  const database = openSqlite(fixture.database, "readwrite");
  try {
    const head = database.query(
      "SELECT revision FROM candidate_head WHERE singleton = 1",
    ).get().revision as number;
    const stored = database.query(
      "SELECT candidate_bytes, lock_bytes FROM candidates WHERE revision = ?1",
    ).get(head) as { readonly candidate_bytes: Uint8Array; readonly lock_bytes: Uint8Array };
    const candidateValue = decodeJson1(stored.candidate_bytes) as Record<string, JsonValue>;
    const next = head + 1;
    const candidate = decodePrivateActivationCandidateV5({
      candidate: json1(candidateV5({
        ...candidateValue,
        semanticDigest: digest(`changed-meaning-${next}`),
      })),
      lock: stored.lock_bytes,
    });
    const encoded = encodePrivateActivationCandidateV5(candidate);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.query(
        "INSERT INTO candidates(revision, candidate_digest, candidate_bytes, lock_bytes) VALUES (?1, ?2, ?3, ?4)",
      ).run(next, privateActivationCandidateDigestV5(candidate), encoded.candidate, encoded.lock);
      const changed = database.query(
        "UPDATE candidate_head SET revision = ?1 WHERE singleton = 1 AND revision = ?2",
      ).run(next, head).changes;
      if (changed !== 1) throw new Error("test candidate head changed concurrently");
      database.exec("COMMIT");
    } catch (error) {
      if (database.inTransaction) database.exec("ROLLBACK");
      throw error;
    }
  } finally { database.close(true); }
}

function readHookRevisionRows(databasePath: string): readonly any[] {
  const database = openSqlite(databasePath, "readonly");
  try {
    return database.query([
      "SELECT revision_digest, hook_id, meaning_digest, opening_admission_digest,",
      "opening_candidate_revision, start_position, closing_admission_digest, end_position, revision_bytes",
      "FROM hook_revisions ORDER BY opening_candidate_revision",
    ].join(" ")).all().map((row: any) => ({
      ...row,
      revision_bytes: Uint8Array.from(row.revision_bytes),
    }));
  } finally {
    database.close(true);
  }
}

function readHookBoundaryRows(databasePath: string): readonly any[] {
  const database = openSqlite(databasePath, "readonly");
  try {
    return database.query([
      "SELECT hook_admission_boundaries.admission_digest, boundary_digest, boundary_bytes",
      "FROM hook_admission_boundaries JOIN admissions USING (admission_digest)",
      "ORDER BY admissions.revision",
    ].join(" ")).all().map((row: any) => ({
      ...row,
      boundary_bytes: Uint8Array.from(row.boundary_bytes),
      boundary: decodePrivateHookAdmissionBoundary(Uint8Array.from(row.boundary_bytes)),
    }));
  } finally {
    database.close(true);
  }
}

async function createComposedFixture(): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "jig-composed-admission-store-"));
  const root = join(base, "project");
  const store = join(base, "store");
  const parentSource = join(base, "parent-flow");
  const childSource = join(base, "child-flow");
  const declarationSource = join(base, "declaration");
  try {
    await Promise.all([
      mkdir(root, { mode: 0o700 }),
      mkdir(store, { mode: 0o700 }),
      mkdir(parentSource),
      mkdir(childSource),
      mkdir(declarationSource),
    ]);
    await writeFile(join(parentSource, "FLOW.md"), [
      "---",
      "name: parent",
      "description: Composed parent fixture.",
      "---",
      "",
    ].join("\n"));
    await writeFile(join(parentSource, "flow.ts"), "export {};\n");
    await writeFile(join(parentSource, "settings.schema.json"), JSON.stringify({
      $schema: "https://flow.dev/schemas/schema-1.json",
      type: "object",
      properties: { label: { type: "string" } },
      required: ["label"],
      additionalProperties: false,
    }));
    await writeFile(join(childSource, "FLOW.md"), [
      "---",
      "name: child",
      "description: Composed child fixture.",
      "---",
      "",
    ].join("\n"));
    await writeFile(join(childSource, "flow.py"), "print('unused')\n");
    await writeFile(join(declarationSource, "jig.ts"), "export default {};\n");

    const [parentPackage, childPackage, declaration] = await Promise.all([
      retainPackage(store, parentSource),
      retainPackage(store, childSource),
      retainPackage(store, declarationSource),
    ]);
    const rootInformation = await stat(root, { bigint: true });
    const lockBytes = json1({
      kind: "private-package-project-lock/3",
      packages: {
        "flows/child": {
          digest: childPackage.digest,
          mode: "run",
          directRun: true,
          attachments: {},
          uses: {},
          provides: {},
        },
        "flows/parent": {
          digest: parentPackage.digest,
          mode: "run",
          directRun: false,
          attachments: {},
          uses: {},
          provides: {},
        },
      },
      bindings: {
        parent: {
          packagePath: "flows/parent",
          attachments: {},
          slots: {
            child: {
              kind: "flow-call",
              source: "exact",
              targets: [{ kind: "flow", path: "flows/child" }],
            },
          },
        },
      },
      journalPublishers: {},
      hooks: {},
    });
    const lock = decodePrivateProjectLocalLock(lockBytes);
    const captureDigest = digest("composed-capture");
    const planningObservationDigest = digest("composed-planning");
    const parentRequest = activationRequest({
      target: { kind: "binding", id: "parent" },
      mode: "run",
      packagePath: "flows/parent",
      package: parentPackage,
      entrypoint: { path: "flow.ts", suffix: "ts" },
      settings: { label: "closed" },
      attachments: {},
      slots: {
        child: {
          kind: "flow-call",
          source: "exact",
          targets: [{ kind: "flow", path: "flows/child" }],
        },
      },
    });
    const childRequest = activationRequest({
      target: { kind: "flow", path: "flows/child" },
      mode: "run",
      packagePath: "flows/child",
      package: childPackage,
      entrypoint: { path: "flow.py", suffix: "py" },
      settings: {},
      attachments: {},
      slots: {},
    });
    const candidate = decodePrivateActivationCandidateV5({
      candidate: json1(candidateV5({
        kind: "private-activation-candidate/4",
        projectRoot: {
          device: rootInformation.dev.toString(),
          inode: rootInformation.ino.toString(),
        },
        captureDigest,
        semanticDigest: digest("composed-semantic"),
        resolutionInputDigest: privateDomainDigest(
          "JIG-Package-Project-Resolution-Input/1",
          { captureDigest, planningObservationDigest },
        ),
        planningObservationDigest,
        lockDigest: privateProjectLocalLockDigest(lock),
        declarationArtifact: {
          kind: "author-closure/1",
          closureDigest: digest("composed-declaration-closure"),
          package: declaration,
        },
        targets: [
          {
            request: parentRequest,
            disposition: {
              state: "ready",
              recipeDigest: digest("parent-recipe"),
              observationDigest: digest("parent-observation"),
            },
          },
          {
            request: childRequest,
            disposition: {
              state: "ready",
              recipeDigest: digest("child-recipe"),
              observationDigest: digest("child-observation"),
            },
          },
        ],
      })),
      lock: lockBytes,
    });
    const encoded = encodePrivateActivationCandidateV5(candidate);
    const state = join(root, ".jig");
    const databasePath = join(state, "private-activation-admission-v18.sqlite3");
    await mkdir(state, { mode: 0o700 });
    const databaseFile = await open(
      databasePath,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await databaseFile.close();
    const database = openSqlite(databasePath, "readwrite");
    try {
      database.exec([
        "PRAGMA journal_mode=DELETE",
        "PRAGMA synchronous=EXTRA",
        "PRAGMA foreign_keys=ON",
        CREATE_CANDIDATES,
        CREATE_CANDIDATE_HEAD,
        CREATE_REVIEW_PLANS,
        CREATE_LOCK_REPAIRS,
        CREATE_ADMISSIONS,
        CREATE_ADMISSION_HEAD,
        CREATE_COORDINATOR_HEAD,
        CREATE_ROOT_RUNS,
        CREATE_ROOT_SPAWN_INTENTS,
        CREATE_ROOT_EXECUTION_LIFECYCLES,
        CREATE_ROOT_EXECUTION_CLOSURES,
        CREATE_ROOT_FLOW_CALLS,
        CREATE_ROOT_FLOW_CALL_FACTS,
        CREATE_ROOT_FLOW_CALL_CLOSURES,
        CREATE_JOURNAL_HEAD,
        CREATE_JOURNAL_EVENTS,
        CREATE_HOOK_ADMISSION_BOUNDARIES,
        CREATE_HOOK_DERIVATIONS,
        CREATE_HOOK_REVISIONS,
        CREATE_HOOK_REVISIONS_ONE_OPEN,
        CREATE_ROOT_JOURNAL_APPENDS,
        CREATE_ROOT_JOURNAL_TERMINALS,
        CREATE_ROOT_JOURNAL_HOOK_SELECTIONS,
        CREATE_ROOT_JOURNAL_CLOSURES,
        CREATE_ROOT_TERMINALS,
        CREATE_SERVICE_MOUNTS,
        CREATE_SERVICE_MOUNT_FACTS,
        CREATE_SERVICE_LEASES,
        CREATE_SERVICE_INVOCATIONS,
        "INSERT INTO candidate_head(singleton, revision) VALUES (1, NULL)",
        "INSERT INTO admission_head(singleton, revision) VALUES (1, NULL)",
        "INSERT INTO coordinator_head(singleton, epoch) VALUES (1, 0)",
        "INSERT INTO journal_head(singleton, position) VALUES (1, 0)",
        "PRAGMA application_id=1246316353",
        "PRAGMA user_version=18",
      ].join(";"));
      database.exec("BEGIN IMMEDIATE");
      database.query(
        "INSERT INTO candidates(revision, candidate_digest, candidate_bytes, lock_bytes) VALUES (1, ?1, ?2, ?3)",
      ).run(privateActivationCandidateDigestV5(candidate), encoded.candidate, encoded.lock);
      database.query("UPDATE candidate_head SET revision = 1 WHERE singleton = 1").run();
      database.exec("COMMIT");
    } finally {
      database.close(true);
    }
    return Object.freeze({
      root,
      store,
      database: databasePath,
      candidate,
      async dispose(): Promise<void> { await rm(base, { recursive: true, force: true }); },
    });
  } catch (error) {
    await rm(base, { recursive: true, force: true });
    throw error;
  }
}

async function closeTestRootExecution(
  projectRoot: string,
  coordinator: PrivateProjectCoordinator,
  runId: string,
  terminal: PrivateRootRunTerminal,
): Promise<{ readonly state: "terminal"; readonly run: Awaited<ReturnType<typeof closePrivateRootExecution>> }> {
  for (const [checkpoint, value] of [
    ["plan", { kind: "test-plan/1", runId }],
    ["backing", { kind: "test-backing/1", runId }],
    ["sandbox", { kind: "test-sandbox/1", runId }],
    ["prepared", { kind: "test-prepared/1", runId }],
    ["provisional", terminal],
    ["fence", { kind: "test-fence/1", runId }],
    ["release", { kind: "test-release/1", runId }],
    ["admitted", terminal],
  ] as const) {
    await recordPrivateRootExecutionCheckpoint({
      coordinator,
      projectRoot,
      runId,
      checkpoint,
      value: value as JsonValue,
    });
  }
  return Object.freeze({
    state: "terminal" as const,
    run: await closePrivateRootExecution({ coordinator, projectRoot, runId, terminal }),
  });
}

async function closeTestRootExecutionWithoutPlan(
  projectRoot: string,
  coordinator: PrivateProjectCoordinator,
  runId: string,
  terminal: PrivateRootRunTerminal,
): Promise<{ readonly state: "terminal"; readonly run: Awaited<ReturnType<typeof closePrivateRootExecution>> }> {
  for (const [checkpoint, value] of [
    ["provisional", terminal],
    ["release", { kind: "test-release-without-plan/1", runId }],
    ["admitted", terminal],
  ] as const) {
    await recordPrivateRootExecutionCheckpoint({
      coordinator,
      projectRoot,
      runId,
      checkpoint,
      value: value as JsonValue,
    });
  }
  return Object.freeze({
    state: "terminal" as const,
    run: await closePrivateRootExecution({ coordinator, projectRoot, runId, terminal }),
  });
}

function activationRequest(content: Record<string, unknown>): Record<string, unknown> {
  const request = { kind: "activation-request/2", ...content };
  return {
    ...request,
    digest: privateDomainDigest("JIG-Activation-Request/2", request as unknown as JsonValue),
  };
}

async function retainPackage(store: string, source: string): Promise<PackageArtifactRef> {
  const captured = await capturePackageDirectory(source);
  try { return await publishCapturedPackage(store, captured); }
  finally { await captured.dispose(); }
}

function openSqlite(path: string, mode: "readonly" | "readwrite"): any {
  const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
  const access = mode === "readonly"
    ? sqlite.constants.SQLITE_OPEN_READONLY
    : sqlite.constants.SQLITE_OPEN_READWRITE;
  return sqlite.Database.open(path, access | sqlite.constants.SQLITE_OPEN_NOFOLLOW);
}

function json1(value: JsonValue): Uint8Array {
  const canonical = canonicalJson(value);
  return Uint8Array.from([...canonical, 0x0a]);
}

function candidateV5(value: Record<string, JsonValue>): JsonValue {
  const {
    semanticDigest,
    observedSemanticDigest: _observedSemanticDigest,
    activationMeaningDigest: _activationMeaningDigest,
    ...rest
  } = value;
  if (typeof semanticDigest !== "string" || !Array.isArray(value.targets)) {
    throw new TypeError("candidate fixture requires observed semantics and targets");
  }
  return {
    ...rest,
    kind: "private-activation-candidate/5",
    observedSemanticDigest: semanticDigest,
    activationMeaningDigest: privateDomainDigest(
      "JIG-Private-Activation-Meaning/1",
      { observedSemanticDigest: semanticDigest, targets: value.targets },
    ),
  } as JsonValue;
}

function digest(label: string): string {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

async function retryBusy<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try { return await action(); }
    catch (error) {
      if (
        typeof error !== "object" || error === null ||
        (error as { readonly code?: unknown }).code !== "ADMISSION_STATE_BUSY" || attempt === 8
      ) throw error;
      await Bun.sleep(attempt * 10);
    }
  }
  throw new Error("unreachable admission retry state");
}
