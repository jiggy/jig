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
  publishCapturedPackage,
  type PackageArtifactRef,
} from "../src/internal/package-artifact-store.js";
import {
  decodePrivateProjectLocalLock,
  encodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
} from "../src/internal/project-local-lock.js";
import {
  applyPrivateActivationReviewPlan,
  closePrivateRootExecution,
  completePrivateRootRun,
  createPrivateActivationReviewPlan,
  loadPrivateActiveActivation,
  loadPrivateActivationReviewPlan,
  loadPrivateRootRun,
  listPrivateRootExecutionWork,
  openPrivateProjectCoordinator,
  reacquirePrivateRootExecutionWork,
  recordPrivateRootExecutionCheckpoint,
  requirePrivateStoredActivationCandidate,
  submitPrivateRootRun,
  type PrivateProjectCoordinator,
  type PrivateRootRunTerminal,
} from "../src/internal/activation-admission-store.js";
import {
  decodePrivateActivationCandidate,
  encodePrivateActivationCandidate,
  privateActivationCandidateDigest,
  requirePrivateCreatedActivationCandidate,
} from "../src/internal/activation-admission.js";
import { canonicalJson, type JsonValue } from "../src/json.js";
import { capturePackageDirectory } from "../src/package/capture.js";
import { RootAdministrationError } from "../src/administration/root.js";
import { openPrivateRootAdministrationController } from "../src/internal/root-administration-controller.js";
import { awaitRootRun } from "../../../conformance/root-administration-1/consumer.js";

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

setDefaultTimeout(20_000);

describe.serial("private activation admission SQLite store", () => {
  test("creates and reloads one immutable plan under ordinary Linux CI", async () => {
    const fixture = await createFixture();
    try {
      expect(() => requirePrivateCreatedActivationCandidate(fixture.candidate)).toThrow(
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
        candidateRevision: 1,
        candidateDigest: privateActivationCandidateDigest(fixture.candidate),
        baseGeneration: null,
        lockMode: "update",
        observedLock: { state: "absent" },
      });
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
          "review_plans",
          "root_execution_closures",
          "root_execution_lifecycles",
          "root_runs",
          "root_spawn_intents",
          "root_terminals",
        ]);
        expect(database.query("PRAGMA application_id").get().application_id).toBe(0x4a494737);
        expect(database.query("PRAGMA user_version").get().user_version).toBe(7);
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
      const firstPlan = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      expect(firstPlan.plan.baseGeneration).toBeNull();
      const first = await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: firstPlan.planDigest,
        baseGeneration: null,
      });
      expect(new Uint8Array(await readFile(join(fixture.root, "jig.lock")))).toEqual(
        encodePrivateProjectLocalLock(fixture.candidate.lock),
      );
      expect(await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: firstPlan.planDigest,
        baseGeneration: null,
      })).toEqual(first);

      const secondPlan = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      expect(secondPlan.plan.baseGeneration).toBe(first.admissionDigest);
      const competingPlan = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "locked",
      });
      expect(competingPlan.plan.baseGeneration).toBe(first.admissionDigest);
      const second = await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: secondPlan.planDigest,
        baseGeneration: first.admissionDigest,
      });
      expect(second.admission.baseGeneration).toBe(first.admissionDigest);
      expect(second.admissionDigest).not.toBe(first.admissionDigest);
      await expect(applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: competingPlan.planDigest,
        baseGeneration: first.admissionDigest,
      })).rejects.toMatchObject({ code: "STALE_PLAN" });
      expect(await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: firstPlan.planDigest,
        baseGeneration: null,
      })).toEqual(first);

      const active = await loadPrivateActiveActivation({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
      });
      expect(active.admission).toEqual(second);
      expect(active.candidate.candidate.target.request).toMatchObject({
        target: { kind: "flow", path: "flows/run" },
        packagePath: "flows/run",
        entrypoint: { path: "flow.py", suffix: "py" },
      });
      expect(requirePrivateStoredActivationCandidate(active.candidate)).toBe(active.candidate);

      const database = openSqlite(fixture.database, "readonly");
      try {
        expect(database.query("SELECT count(*) AS count FROM admissions").get().count).toBe(2);
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
        baseGeneration: null,
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
        submissionId: "ticket-1",
        target: { kind: "flow", path: "flows/run" },
        input: { value: "first" },
        coordinatorEpoch: 1,
        state: "spawn-intent",
      });
      expect(first.launch?.intent).toMatchObject({
        runId: first.run.runId,
        requestDigest: fixture.candidate.candidate.target.request.digest,
        coordinatorEpoch: 1,
      });

      const duplicate = attempts.find(({ launch }) => launch === undefined)!;
      expect(duplicate.run).toEqual(first.run);
      expect(duplicate.launch).toBeUndefined();
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
        ["backing", { package: fixture.candidate.candidate.target.request.package.digest }],
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
        ["backing", { package: fixture.candidate.candidate.target.request.package.digest }],
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
        baseGeneration: null,
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

      const first = await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
        baseGeneration: null,
      });
      expect(new Uint8Array(await readFile(lock))).toEqual(proposed);
      expect((await stat(lock)).ino).toBe(before.ino);
      await expect(stat(stage)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
        baseGeneration: null,
      })).toEqual(first);

      const locked = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "locked",
      });
      const lockedBefore = await stat(lock);
      const second = await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: locked.planDigest,
        baseGeneration: first.admissionDigest,
      });
      expect(second.admission.baseGeneration).toBe(first.admissionDigest);
      expect((await stat(lock)).ino).toBe(lockedBefore.ino);
      expect(new Uint8Array(await readFile(lock))).toEqual(proposed);
      await expect(stat(stage)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await fixture.dispose(); }
  });

  test("serializes concurrent replay and admits exactly one competing child", async () => {
    const fixture = await createFixture();
    try {
      const firstPlan = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      const receipts = await Promise.all(Array.from({ length: 4 }, () => retryBusy(
        () => applyPrivateActivationReviewPlan({
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          planDigest: firstPlan.planDigest,
          baseGeneration: null,
        }),
      )));
      expect(receipts).toEqual(Array.from({ length: 4 }, () => receipts[0]));

      const update = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      const locked = await createPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "locked",
      });
      const attempts = await Promise.allSettled([update, locked].map((plan) => retryBusy(
        () => applyPrivateActivationReviewPlan({
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          planDigest: plan.planDigest,
          baseGeneration: receipts[0]!.admissionDigest,
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
        baseGeneration: null,
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
        baseGeneration: null,
      })).rejects.toMatchObject({ code: "ADMISSION_LOCK_STAGE_UNSAFE" });
      expect((await stat(stage)).isDirectory()).toBeTrue();
      await rm(stage, { recursive: true });

      await writeFile(stage, "partial", { mode: 0o600 });
      const receipt = await applyPrivateActivationReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
        baseGeneration: null,
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
        kind: "private-package-project-lock/1",
        packages: {},
        bindings: {},
      }));
      await expect(applyPrivateActivationReviewPlan({
        projectRoot: drift.root,
        packageStoreRoot: drift.store,
        planDigest: plan.planDigest,
        baseGeneration: null,
      })).rejects.toMatchObject({ code: "STALE_PLAN" });
      const database = openSqlite(drift.database, "readonly");
      try { expect(database.query("SELECT count(*) AS count FROM admissions").get().count).toBe(0); }
      finally { database.close(true); }
    } finally { await drift.dispose(); }
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
        .run(privateActivationCandidateDigest(fixture.candidate));
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
  readonly candidate: ReturnType<typeof decodePrivateActivationCandidate>;
  dispose(): Promise<void>;
}

async function createFixture(disposition: "unavailable" | "ready" = "unavailable"): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "jig-admission-store-"));
  const root = join(base, "project");
  const store = join(base, "store");
  const flowSource = join(base, "run-flow");
  const declarationSource = join(base, "declaration");
  try {
    await mkdir(root, { mode: 0o700 });
    await mkdir(store, { mode: 0o700 });
    await mkdir(flowSource);
    await mkdir(declarationSource);
    await writeFile(join(flowSource, "FLOW.md"), [
      "---",
      "name: run",
      "description: Ordinary admission-store fixture.",
      "---",
      "",
    ].join("\n"));
    await writeFile(join(flowSource, "flow.py"), "print('unused')\n");
    if (disposition === "ready") {
      await writeFile(join(flowSource, "input.schema.json"), JSON.stringify({
        $schema: "https://flow.dev/schemas/schema-1.json",
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      }));
    }
    await writeFile(join(declarationSource, "jig.ts"), "export default {};\n");

    const flow = await retainPackage(store, flowSource);
    const declaration = await retainPackage(store, declarationSource);
    const rootInformation = await stat(root, { bigint: true });
    const lockBytes = json1({
      kind: "private-package-project-lock/1",
      packages: {
        "flows/run": {
          digest: flow.digest,
          mode: "run",
          directRun: true,
          attachments: {},
          uses: {},
          provides: {},
        },
      },
      bindings: {},
    });
    const lock = decodePrivateProjectLocalLock(lockBytes);
    const captureDigest = digest("capture");
    const planningObservationDigest = digest("planning");
    const candidate = decodePrivateActivationCandidate({
      candidate: json1({
        kind: "private-activation-candidate/2",
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
        target: {
          request: activationRequest({
            target: { kind: "flow", path: "flows/run" },
            mode: "run",
            packagePath: "flows/run",
            package: flow,
            entrypoint: { path: "flow.py", suffix: "py" },
            settings: {},
            attachments: {},
            slots: {},
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
        },
      }),
      lock: lockBytes,
    });
    const encoded = encodePrivateActivationCandidate(candidate);

    const state = join(root, ".jig");
    const databasePath = join(state, "private-activation-admission-v7.sqlite3");
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
        CREATE_ADMISSIONS,
        CREATE_ADMISSION_HEAD,
        CREATE_COORDINATOR_HEAD,
        CREATE_ROOT_RUNS,
        CREATE_ROOT_SPAWN_INTENTS,
        CREATE_ROOT_EXECUTION_LIFECYCLES,
        CREATE_ROOT_EXECUTION_CLOSURES,
        CREATE_ROOT_TERMINALS,
        "INSERT INTO candidate_head(singleton, revision) VALUES (1, NULL)",
        "INSERT INTO admission_head(singleton, revision) VALUES (1, NULL)",
        "INSERT INTO coordinator_head(singleton, epoch) VALUES (1, 0)",
        "PRAGMA application_id=1246316343",
        "PRAGMA user_version=7",
      ].join(";"));
      database.exec("BEGIN IMMEDIATE");
      database.query(
        "INSERT INTO candidates(revision, candidate_digest, candidate_bytes, lock_bytes) VALUES (1, ?1, ?2, ?3)",
      ).run(privateActivationCandidateDigest(candidate), encoded.candidate, encoded.lock);
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

function activationRequest(content: Record<string, unknown>): Record<string, unknown> {
  const request = { kind: "activation-request/1", ...content };
  return {
    ...request,
    digest: privateDomainDigest("JIG-Activation-Request/1", request as unknown as JsonValue),
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
