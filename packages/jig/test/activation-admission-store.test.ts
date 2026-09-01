import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyPrivateActivationReviewPlan,
  capturePrivateActivationPlanningBase,
  closePrivateRootExecution,
  initializePrivateActivationState,
  listPrivateRootExecutionWork,
  loadPrivateRootRunForCoordinator,
  openPrivateProjectCoordinator,
  readPrivateBunPreparationOwner,
  readPrivateAdmittedExecutionReuse,
  reacquirePrivateRootExecutionWork,
  recordPrivateRootExecutionCheckpoint,
  replacePrivateBunPreparationOwner,
  submitPrivateRootRun,
  type PrivateProjectCoordinator,
  type PrivateRootRunTerminal,
} from "../src/internal/activation-admission-store.js";
import {
  createPrivateActivationPlanV2,
  decodePrivateActivationCandidateV5,
  encodePrivateActivationCandidateV5,
  encodePrivateActivationPlanV2,
  privateActivationCandidateDigestV5,
  privateActivationPlanDigestV2,
  type PrivateActivationCandidateArtifactV5,
} from "../src/internal/activation-admission.js";
import { privateDomainDigest } from "../src/internal/identity.js";
import {
  decodePrivateProjectLocalLock,
  encodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
} from "../src/internal/project-local-lock.js";
import {
  normalizePackageArtifactRef,
  publishCapturedPackage,
  type PackageArtifactRef,
} from "../src/internal/package-artifact-store.js";
import { canonicalJson, type JsonValue } from "../src/json.js";
import { capturePackageDirectory } from "../src/package/capture.js";

const TABLES = [
  "admission_head",
  "admissions",
  "candidate_head",
  "candidates",
  "coordinator_head",
  "review_plans",
  "root_execution_lifecycles",
  "root_runs",
  "root_spawn_intents",
  "root_terminals",
] as const;

setDefaultTimeout(30_000);

describe.serial("direct alpha activation store", () => {
  test("creates only the current ten-table schema", async () => {
    const fixture = await createEmptyFixture();
    try {
      const database = openSqlite(fixture.database, "readonly");
      try {
        expect(tableNames(database)).toEqual(TABLES);
        expect(indexNames(database)).toEqual([]);
        expect(database.query("PRAGMA application_id").get().application_id).toBe(0x4a494731);
        expect(database.query("PRAGMA user_version").get().user_version).toBe(1);
        expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        database.close(true);
      }

      await expect(stat(join(fixture.root, ".jig", "coordinator.sqlite3")))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fixture.dispose();
    }
  });

  test("compare-and-sets one cumulative preparation cleanup proof", async () => {
    const fixture = await createEmptyFixture();
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      expect(await readPrivateBunPreparationOwner({
        projectRoot: fixture.root,
        coordinator,
      })).toBeNull();
      const allocation = { kind: "test-preparation-owner", stage: "allocation" } as const;
      const first = await replacePrivateBunPreparationOwner({
        projectRoot: fixture.root,
        coordinator,
        expectedDigest: null,
        value: allocation,
      });
      expect(first?.value).toEqual(allocation);
      await expect(replacePrivateBunPreparationOwner({
        projectRoot: fixture.root,
        coordinator,
        expectedDigest: null,
        value: allocation,
      })).rejects.toMatchObject({ code: "PREPARATION_OWNER_CONFLICT" });
      const sealed = { ...allocation, stage: "sealed" } as const;
      const second = await replacePrivateBunPreparationOwner({
        projectRoot: fixture.root,
        coordinator,
        expectedDigest: first!.digest,
        value: sealed,
      });
      expect((await readPrivateBunPreparationOwner({
        projectRoot: fixture.root,
        coordinator,
      }))?.value).toEqual(sealed);
      await replacePrivateBunPreparationOwner({
        projectRoot: fixture.root,
        coordinator,
        expectedDigest: second!.digest,
        value: null,
      });
      expect(await readPrivateBunPreparationOwner({
        projectRoot: fixture.root,
        coordinator,
      })).toBeNull();
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  });

  test("applies and exactly replays sequential admission generations", async () => {
    const fixture = await createFixture();
    try {
      const firstPlan = seedPlan(fixture, fixture.candidate, {
        baseGeneration: null,
        observedLock: "absent",
        operation: "admission",
      });
      const first = requireAdmission(await applyPlan(fixture, firstPlan));
      expect(new Uint8Array(await readFile(join(fixture.root, "jig.lock")))).toEqual(
        encodePrivateProjectLocalLock(fixture.candidate.lock),
      );
      expect(await applyPlan(fixture, firstPlan)).toEqual(first);

      const secondCandidate = insertCandidate(fixture, "second-meaning", false);
      const secondPlan = seedPlan(fixture, secondCandidate, {
        baseGeneration: first.admissionDigest,
        observedLock: "present",
        operation: "admission",
      });
      const second = requireAdmission(await applyPlan(fixture, secondPlan));
      expect(second.admission.baseGeneration).toBe(first.admissionDigest);
      expect(second.admissionDigest).not.toBe(first.admissionDigest);
      expect(await applyPlan(fixture, firstPlan)).toEqual(first);

      const database = openSqlite(fixture.database, "readonly");
      try {
        expect(database.query("SELECT count(*) AS count FROM admissions").get()).toEqual({ count: 2 });
        expect(database.query(
          "SELECT admissions.admission_digest FROM admission_head JOIN admissions USING (revision) WHERE singleton = 1",
        ).get().admission_digest).toBe(second.admissionDigest);
        expect(tableNames(database)).toEqual(TABLES);
      } finally {
        database.close(true);
      }
    } finally {
      await fixture.dispose();
    }
  });

  test("admits a retained execution Package distinct from the source Package", async () => {
    const fixture = await createFixture("ready");
    try {
      const executionPackage = await retainDistinctExecutionPackage(fixture, "retained");
      const candidate = insertExecutionCandidate(fixture, executionPackage, "retained");
      const plan = seedPlan(fixture, candidate, {
        baseGeneration: null,
        observedLock: "absent",
        operation: "admission",
      });

      const admitted = requireAdmission(await applyPlan(fixture, plan));
      expect(admitted.admission.candidateRevision).toBe(2);
      expect(candidate.candidate.targets[0]!.request.package).toEqual(fixture.flow);
      expect(candidate.candidate.targets[0]!.disposition).toMatchObject({
        state: "ready",
        executionPackage,
      });
      expect(executionPackage).not.toEqual(fixture.flow);
      expect(decodePrivateProjectLocalLock(
        new Uint8Array(await readFile(join(fixture.root, "jig.lock"))),
      ).packages["flows/run"]!.digest).toBe(fixture.flow.digest);
    } finally {
      await fixture.dispose();
    }
  });

  test("reopens prepared execution bytes only from the captured active admission", async () => {
    const fixture = await createFixture("ready");
    try {
      const request = fixture.candidate.candidate.targets[0]!.request;
      const before = await capturePrivateActivationPlanningBase({ projectRoot: fixture.root });
      expect(readPrivateAdmittedExecutionReuse({ planningBase: before, request })).toBeUndefined();

      await admit(fixture);
      const after = await capturePrivateActivationPlanningBase({ projectRoot: fixture.root });
      expect(readPrivateAdmittedExecutionReuse({ planningBase: after, request })).toEqual({
        recipeDigest: digest("direct-recipe"),
        observationDigest: digest("direct-observation"),
        executionPackage: fixture.flow,
      });
    } finally {
      await fixture.dispose();
    }
  });

  test("missing execution Package fails before Candidate, Plan, or admission mutation", async () => {
    const fixture = await createFixture("ready");
    try {
      const missing = normalizePackageArtifactRef({
        kind: "flow-package/1",
        digest: digest("missing-execution-package"),
      });
      const candidate = insertExecutionCandidate(fixture, missing, "missing");
      const plan = seedPlan(fixture, candidate, {
        baseGeneration: null,
        observedLock: "absent",
        operation: "admission",
      });
      const before = activationAuthoritySnapshot(fixture.database);

      await expect(applyPlan(fixture, plan)).rejects.toMatchObject({
        code: "PACKAGE_ARTIFACT_MISSING",
      });
      expect(activationAuthoritySnapshot(fixture.database)).toEqual(before);
      await expect(stat(join(fixture.root, "jig.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fixture.dispose();
    }
  });

  test("corrupt execution Package fails before Candidate, Plan, or admission mutation", async () => {
    const fixture = await createFixture("ready");
    try {
      const executionPackage = await retainDistinctExecutionPackage(fixture, "corrupt");
      const candidate = insertExecutionCandidate(fixture, executionPackage, "corrupt");
      const plan = seedPlan(fixture, candidate, {
        baseGeneration: null,
        observedLock: "absent",
        operation: "admission",
      });
      const artifact = packageArtifactPath(fixture.store, executionPackage);
      await chmod(artifact, 0o600);
      await writeFile(artifact, "corrupt\n");
      await chmod(artifact, 0o400);
      const before = activationAuthoritySnapshot(fixture.database);

      await expect(applyPlan(fixture, plan)).rejects.toMatchObject({
        code: "PACKAGE_ARTIFACT_CORRUPT",
      });
      expect(activationAuthoritySnapshot(fixture.database)).toEqual(before);
      await expect(stat(join(fixture.root, "jig.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fixture.dispose();
    }
  });

  test("repairs the visible lock without creating another authority record", async () => {
    const fixture = await createFixture();
    try {
      const admitted = requireAdmission(await applyPlan(
        fixture,
        seedPlan(fixture, fixture.candidate, {
          baseGeneration: null,
          observedLock: "absent",
          operation: "admission",
        }),
      ));
      const lockPath = join(fixture.root, "jig.lock");
      await rm(lockPath);
      const repairCandidate = insertCandidate(fixture, "equivalent-capture", true);
      const repairPlan = seedPlan(fixture, repairCandidate, {
        baseGeneration: admitted.admissionDigest,
        observedLock: "absent",
        operation: "lock-repair",
      });

      expect(await applyPlan(fixture, repairPlan)).toEqual({
        operation: "lock-repair",
        planDigest: repairPlan,
      });
      expect(new Uint8Array(await readFile(lockPath))).toEqual(
        encodePrivateProjectLocalLock(fixture.candidate.lock),
      );

      await rm(lockPath);
      expect(await applyPlan(fixture, repairPlan)).toEqual({
        operation: "lock-repair",
        planDigest: repairPlan,
      });
      const database = openSqlite(fixture.database, "readonly");
      try {
        expect(database.query("SELECT count(*) AS count FROM admissions").get()).toEqual({ count: 1 });
        expect(database.query("SELECT revision FROM admission_head WHERE singleton = 1").get())
          .toEqual({ revision: 1 });
        expect(tableNames(database)).toEqual(TABLES);
      } finally {
        database.close(true);
      }
      await expect(stat(join(fixture.root, ".jig", "jig-lock.stage")))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fixture.dispose();
    }
  });

  test("rejects a stale competing admission plan", async () => {
    const fixture = await createFixture();
    try {
      const first = requireAdmission(await applyPlan(
        fixture,
        seedPlan(fixture, fixture.candidate, {
          baseGeneration: null,
          observedLock: "absent",
          operation: "admission",
        }),
      ));
      const staleCandidate = insertCandidate(fixture, "stale-meaning", false);
      const stalePlan = seedPlan(fixture, staleCandidate, {
        baseGeneration: first.admissionDigest,
        observedLock: "present",
        operation: "admission",
      });
      const currentCandidate = insertCandidate(fixture, "current-meaning", false);
      const currentPlan = seedPlan(fixture, currentCandidate, {
        baseGeneration: first.admissionDigest,
        observedLock: "present",
        operation: "admission",
      });

      await expect(applyPlan(fixture, stalePlan)).rejects.toMatchObject({ code: "STALE_PLAN" });
      const current = requireAdmission(await applyPlan(fixture, currentPlan));
      expect(current.admission.candidateRevision).toBe(3);
      const database = openSqlite(fixture.database, "readonly");
      try {
        expect(database.query("SELECT count(*) AS count FROM admissions").get()).toEqual({ count: 2 });
      } finally {
        database.close(true);
      }
    } finally {
      await fixture.dispose();
    }
  });

  test("converges a lock-first crash without replacing exact visible bytes", async () => {
    const fixture = await createFixture();
    try {
      const plan = seedPlan(fixture, fixture.candidate, {
        baseGeneration: null,
        observedLock: "absent",
        operation: "admission",
      });
      const lockPath = join(fixture.root, "jig.lock");
      const stagePath = join(fixture.root, ".jig", "jig-lock.stage");
      const lock = encodePrivateProjectLocalLock(fixture.candidate.lock);
      await writeFile(lockPath, lock, { mode: 0o644 });
      await writeFile(stagePath, "abandoned stage", { mode: 0o600 });
      const before = await stat(lockPath);

      requireAdmission(await applyPlan(fixture, plan));
      expect((await stat(lockPath)).ino).toBe(before.ino);
      expect(new Uint8Array(await readFile(lockPath))).toEqual(lock);
      await expect(stat(stagePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fixture.dispose();
    }
  });

  test("allocates an idempotent root submission and rejects changed reuse", async () => {
    const fixture = await createFixture("ready");
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      await admit(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const deadlineUnixMs = Date.now() + 60_000;
      const input = { value: "first", nested: { a: 1, b: 2 } } as const;
      const created = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "ticket-1",
        target: { kind: "flow", path: "flows/run" },
        input,
        deadlineUnixMs,
      });
      expect(created.run).toMatchObject({ state: "spawn-intent", coordinatorEpoch: 1 });
      expect((await listPrivateRootExecutionWork({
        coordinator,
        projectRoot: fixture.root,
        epoch: "current",
      })).map(({ run }) => run.runId)).toEqual([created.run.runId]);

      const replay = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "ticket-1",
        target: { kind: "flow", path: "./flows/run" },
        input: { nested: { b: 2, a: 1 }, value: "first" },
        deadlineUnixMs,
      });
      expect(replay.run).toEqual(created.run);

      await expect(submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "ticket-1",
        target: { kind: "flow", path: "flows/run" },
        input: { value: "changed" },
        deadlineUnixMs,
      })).rejects.toMatchObject({ code: "SUBMISSION_CONFLICT" });

      const invalid = await submitPrivateRootRun({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "invalid-input",
        target: { kind: "flow", path: "flows/run" },
        input: { unexpected: true },
        deadlineUnixMs,
      });
      expect(invalid.run).toMatchObject({
        state: "terminal",
        terminal: { status: "failed", code: "INVALID_INPUT" },
      });
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  });

  test("enforces ordered write-once root lifecycle facts and one matching terminal", async () => {
    const fixture = await createFixture("ready");
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      await admit(fixture);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      const submission = await submitReadyRun(fixture, coordinator, "lifecycle");
      const runId = submission.run.runId;
      const terminal = successTerminal({ accepted: true });

      await expect(checkpoint(fixture, coordinator, runId, "sandbox", { owner: "early" }))
        .rejects.toMatchObject({ code: "RUN_EXECUTION_ORDER" });
      const planned = await checkpoint(fixture, coordinator, runId, "plan", { recipe: "exact" });
      expect(await checkpoint(fixture, coordinator, runId, "plan", { recipe: "exact" }))
        .toEqual(planned);
      await expect(checkpoint(fixture, coordinator, runId, "plan", { recipe: "changed" }))
        .rejects.toMatchObject({ code: "RUN_EXECUTION_CHECKPOINT_CONFLICT" });

      await checkpoint(fixture, coordinator, runId, "backing", { package: "retained" });
      await checkpoint(fixture, coordinator, runId, "sandbox", { owner: "sandbox-1" });
      await checkpoint(fixture, coordinator, runId, "prepared", { ready: true });
      await checkpoint(fixture, coordinator, runId, "provisional", terminal as unknown as JsonValue);
      await expect(closePrivateRootExecution({
        coordinator,
        projectRoot: fixture.root,
        runId,
        terminal,
      })).rejects.toMatchObject({ code: "RUN_EXECUTION_INCOMPLETE" });
      await expect(checkpoint(fixture, coordinator, runId, "release", { released: true }))
        .rejects.toMatchObject({ code: "RUN_EXECUTION_ORDER" });
      await checkpoint(fixture, coordinator, runId, "fence", { populated: false });
      await checkpoint(fixture, coordinator, runId, "release", { released: true });
      await expect(checkpoint(
        fixture,
        coordinator,
        runId,
        "admitted",
        successTerminal({ accepted: false }) as unknown as JsonValue,
      )).rejects.toMatchObject({ code: "RUN_TERMINAL_CONFLICT" });
      const admitted = await checkpoint(
        fixture,
        coordinator,
        runId,
        "admitted",
        terminal as unknown as JsonValue,
      );
      expect((await reacquirePrivateRootExecutionWork({
        coordinator,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        runId,
      })).lifecycle).toEqual(admitted);

      const completed = await closePrivateRootExecution({
        coordinator,
        projectRoot: fixture.root,
        runId,
        terminal,
      });
      expect(completed).toMatchObject({ state: "terminal", terminal: { status: "succeeded" } });
      expect(await closePrivateRootExecution({
        coordinator,
        projectRoot: fixture.root,
        runId,
        terminal,
      })).toEqual(completed);
      expect(await loadPrivateRootRunForCoordinator({
        coordinator,
        projectRoot: fixture.root,
        runId,
      })).toEqual(completed);

      const database = openSqlite(fixture.database, "readonly");
      try {
        expect(database.query("SELECT count(*) AS count FROM root_terminals").get()).toEqual({ count: 1 });
        expect(tableNames(database)).toEqual(TABLES);
      } finally {
        database.close(true);
      }
    } finally {
      await coordinator?.dispose();
      await fixture.dispose();
    }
  });

  test("recovers older work as coordinator loss without redispatch", async () => {
    const fixture = await createFixture("ready");
    let first: PrivateProjectCoordinator | undefined;
    let replacement: PrivateProjectCoordinator | undefined;
    try {
      await admit(fixture);
      first = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      await expect(openPrivateProjectCoordinator({ projectRoot: fixture.root }))
        .rejects.toMatchObject({ code: "COORDINATOR_BUSY" });
      const deadlineUnixMs = Date.now() + 60_000;
      const created = await submitReadyRun(fixture, first, "recover", deadlineUnixMs);
      const beforeRestart = await reacquirePrivateRootExecutionWork({
        coordinator: first,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        runId: created.run.runId,
      });
      await first.dispose();
      first = undefined;

      replacement = await openPrivateProjectCoordinator({ projectRoot: fixture.root });
      expect(replacement.epoch).toBe(2);
      expect(replacement.recoveredRootRuns).toEqual([
        expect.objectContaining({ runId: created.run.runId, coordinatorEpoch: 1 }),
      ]);
      expect(await listPrivateRootExecutionWork({
        coordinator: replacement,
        projectRoot: fixture.root,
        epoch: "current",
      })).toEqual([]);
      expect((await listPrivateRootExecutionWork({
        coordinator: replacement,
        projectRoot: fixture.root,
        epoch: "older",
      })).map(({ run }) => run.runId)).toEqual([created.run.runId]);
      const recovered = await reacquirePrivateRootExecutionWork({
        coordinator: replacement,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        runId: created.run.runId,
      });
      expect(recovered.run).toEqual(created.run);
      expect(recovered.lifecycle).toEqual(beforeRestart.lifecycle);

      const replay = await submitPrivateRootRun({
        coordinator: replacement,
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        submissionId: "recover",
        target: { kind: "flow", path: "flows/run" },
        input: { value: "recover" },
        deadlineUnixMs,
      });
      const database = openSqlite(fixture.database, "readonly");
      try {
        expect(database.query("SELECT count(*) AS count FROM root_runs").get()).toEqual({ count: 1 });
      } finally {
        database.close(true);
      }
      await expect(checkpoint(
        fixture,
        replacement,
        created.run.runId,
        "plan",
        { recipe: "must-not-restart" },
      )).rejects.toMatchObject({ code: "RUN_COORDINATOR_STALE" });

      const lost = {
        status: "lost" as const,
        code: "COORDINATOR_LOST" as const,
        message: "the prior coordinator disappeared before a proved result",
      };
      await checkpoint(fixture, replacement, created.run.runId, "provisional", lost as unknown as JsonValue);
      await checkpoint(fixture, replacement, created.run.runId, "release", { released: true });
      await checkpoint(fixture, replacement, created.run.runId, "admitted", lost as unknown as JsonValue);
      expect(await closePrivateRootExecution({
        coordinator: replacement,
        projectRoot: fixture.root,
        runId: created.run.runId,
        terminal: lost,
      })).toMatchObject({ state: "terminal", terminal: lost });
    } finally {
      await replacement?.dispose();
      await first?.dispose();
      await fixture.dispose();
    }
  });

  test("fails closed on current Candidate, Plan, admission, and terminal corruption", async () => {
    const candidate = await createFixture();
    try {
      const plan = seedPlan(candidate, candidate.candidate, {
        baseGeneration: null,
        observedLock: "absent",
        operation: "admission",
      });
      const database = openSqlite(candidate.database, "readwrite");
      database.query("UPDATE candidates SET candidate_digest = ?1 WHERE revision = 1")
        .run(digest("forged-candidate"));
      database.close(true);
      await expect(applyPlan(candidate, plan)).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await candidate.dispose();
    }

    const plan = await createFixture();
    try {
      const planDigest = seedPlan(plan, plan.candidate, {
        baseGeneration: null,
        observedLock: "absent",
        operation: "admission",
      });
      const database = openSqlite(plan.database, "readwrite");
      database.query("UPDATE review_plans SET plan_bytes = ?1 WHERE plan_digest = ?2")
        .run(json1({ kind: "not-a-plan" }), planDigest);
      database.close(true);
      await expect(applyPlan(plan, planDigest)).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await plan.dispose();
    }

    const admission = await createFixture("ready");
    let coordinator: PrivateProjectCoordinator | undefined;
    try {
      await admit(admission);
      const database = openSqlite(admission.database, "readwrite");
      database.query("UPDATE admissions SET admission_bytes = ?1 WHERE revision = 1")
        .run(json1({ kind: "not-an-admission" }));
      database.close(true);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: admission.root });
      await expect(submitReadyRun(admission, coordinator, "corrupt-admission"))
        .rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await coordinator?.dispose();
      await admission.dispose();
    }

    const terminal = await createFixture("ready");
    coordinator = undefined;
    try {
      await admit(terminal);
      coordinator = await openPrivateProjectCoordinator({ projectRoot: terminal.root });
      const submitted = await submitReadyRun(terminal, coordinator, "corrupt-terminal");
      const value = successTerminal({ ok: true });
      await settleExecution(terminal, coordinator, submitted.run.runId, value);
      await closePrivateRootExecution({
        coordinator,
        projectRoot: terminal.root,
        runId: submitted.run.runId,
        terminal: value,
      });
      const database = openSqlite(terminal.database, "readwrite");
      database.query("UPDATE root_terminals SET terminal_digest = ?1 WHERE run_id = ?2")
        .run(digest("forged-terminal"), submitted.run.runId);
      database.close(true);
      await expect(loadPrivateRootRunForCoordinator({
        coordinator,
        projectRoot: terminal.root,
        runId: submitted.run.runId,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });
    } finally {
      await coordinator?.dispose();
      await terminal.dispose();
    }
  }, 60_000);

  test("rejects schema drift, weak permissions, and unsafe SQLite sidecars", async () => {
    const schema = await createEmptyFixture();
    try {
      const database = openSqlite(schema.database, "readwrite");
      database.exec("PRAGMA user_version=2");
      database.close(true);
      await expect(openPrivateProjectCoordinator({ projectRoot: schema.root }))
        .rejects.toMatchObject({ code: "ADMISSION_SCHEMA_VERSION" });
    } finally {
      await schema.dispose();
    }

    const permissions = await createEmptyFixture();
    try {
      await chmod(permissions.database, 0o644);
      await expect(openPrivateProjectCoordinator({ projectRoot: permissions.root }))
        .rejects.toMatchObject({ code: "ADMISSION_DATABASE_PERMISSIONS" });
    } finally {
      await permissions.dispose();
    }

    const sidecar = await createEmptyFixture();
    try {
      await writeFile(`${sidecar.database}-wal`, new Uint8Array(), { mode: 0o600 });
      await expect(openPrivateProjectCoordinator({ projectRoot: sidecar.root }))
        .rejects.toMatchObject({ code: "ADMISSION_SQLITE_SIDECAR" });
    } finally {
      await sidecar.dispose();
    }
  });
});

interface EmptyFixture {
  readonly base: string;
  readonly root: string;
  readonly store: string;
  readonly database: string;
  dispose(): Promise<void>;
}

interface Fixture extends EmptyFixture {
  readonly candidate: PrivateActivationCandidateArtifactV5;
  readonly flow: PackageArtifactRef;
  readonly declaration: PackageArtifactRef;
}

async function createEmptyFixture(): Promise<EmptyFixture> {
  const base = await mkdtemp(join(tmpdir(), "jig-alpha-store-"));
  const root = join(base, "project");
  const store = join(base, "store");
  try {
    await mkdir(root, { mode: 0o700 });
    await mkdir(store, { mode: 0o700 });
    await initializePrivateActivationState({ projectRoot: root });
    return Object.freeze({
      base,
      root,
      store,
      database: join(root, ".jig", "jig.sqlite3"),
      async dispose(): Promise<void> {
        await rm(base, { recursive: true, force: true });
      },
    });
  } catch (error) {
    await rm(base, { recursive: true, force: true });
    throw error;
  }
}

async function createFixture(
  disposition: "ready" | "unavailable" = "unavailable",
): Promise<Fixture> {
  const empty = await createEmptyFixture();
  const flowSource = join(empty.base, "run-flow");
  const declarationSource = join(empty.base, "declaration");
  try {
    await mkdir(flowSource);
    await mkdir(declarationSource);
    await writeFile(join(flowSource, "FLOW.md"), [
      "---",
      "name: run",
      "description: Direct alpha store fixture.",
      "---",
      "",
    ].join("\n"));
    await writeFile(join(flowSource, "flow.ts"), "#!/usr/bin/env bun\nexport {};\n");
    await writeFile(join(flowSource, "input.schema.json"), JSON.stringify({
      $schema: "https://flow.jig.md/schemas/schema-1.json",
      type: "object",
      properties: {
        value: { type: "string" },
        nested: { type: "object" },
      },
      required: ["value"],
      additionalProperties: false,
    }));
    await writeFile(join(declarationSource, "jig.ts"), "export default {};\n");

    const flow = await retainPackage(empty.store, flowSource);
    const declaration = await retainPackage(empty.store, declarationSource);
    const information = await stat(empty.root, { bigint: true });
    const lockBytes = json1({
      packages: {
        "flows/run": {
          digest: flow.digest,
          directRun: true,
        },
      },
      bindings: {},
    });
    const lock = decodePrivateProjectLocalLock(lockBytes);
    const request = activationRequest({
      target: { kind: "flow", path: "flows/run" },
      mode: "run",
      packagePath: "flows/run",
      package: flow,
      entrypoint: { path: "flow.ts", suffix: "ts" },
      settings: {},
      attachments: {},
    });
    const targets = [{
      request,
      disposition: disposition === "ready"
        ? {
            state: "ready",
            recipeDigest: digest("direct-recipe"),
            observationDigest: digest("direct-observation"),
            executionPackage: flow,
          }
        : {
            state: "unavailable",
            code: "RUNTIME_UNAVAILABLE",
            evidenceDigests: [digest("runtime-unavailable")],
          },
    }];
    const captureDigest = digest("capture-1");
    const planningObservationDigest = digest("planning-1");
    const observedSemanticDigest = digest("meaning-1");
    const candidate = decodePrivateActivationCandidateV5({
      candidate: json1({
        kind: "private-activation-candidate/5",
        projectRoot: {
          device: information.dev.toString(),
          inode: information.ino.toString(),
        },
        captureDigest,
        observedSemanticDigest,
        activationMeaningDigest: activationMeaning(observedSemanticDigest, targets),
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
        targets,
      }),
      lock: lockBytes,
    });
    insertCandidateRow(empty.database, 1, candidate, true);
    return Object.freeze({ ...empty, candidate, flow, declaration });
  } catch (error) {
    await empty.dispose();
    throw error;
  }
}

function insertCandidate(
  fixture: Fixture,
  label: string,
  equivalent: boolean,
): PrivateActivationCandidateArtifactV5 {
  const database = openSqlite(fixture.database, "readonly");
  const revision = database.query("SELECT revision FROM candidate_head WHERE singleton = 1").get()
    .revision as number;
  database.close(true);
  const next = revision + 1;
  const captureDigest = digest(`capture-${label}`);
  const planningObservationDigest = digest(`planning-${label}`);
  const observedSemanticDigest = equivalent
    ? fixture.candidate.candidate.observedSemanticDigest
    : digest(`meaning-${label}`);
  const targets = fixture.candidate.candidate.targets;
  const candidate = decodePrivateActivationCandidateV5({
    candidate: json1({
      ...fixture.candidate.candidate,
      captureDigest,
      observedSemanticDigest,
      activationMeaningDigest: activationMeaning(observedSemanticDigest, targets),
      resolutionInputDigest: privateDomainDigest(
        "JIG-Package-Project-Resolution-Input/1",
        { captureDigest, planningObservationDigest },
      ),
      planningObservationDigest,
    } as unknown as JsonValue),
    lock: encodePrivateProjectLocalLock(fixture.candidate.lock),
  });
  insertCandidateRow(fixture.database, next, candidate, true);
  return candidate;
}

function insertExecutionCandidate(
  fixture: Fixture,
  executionPackage: PackageArtifactRef,
  label: string,
): PrivateActivationCandidateArtifactV5 {
  const database = openSqlite(fixture.database, "readonly");
  const revision = database.query("SELECT revision FROM candidate_head WHERE singleton = 1").get()
    .revision as number;
  database.close(true);
  const target = fixture.candidate.candidate.targets[0]!;
  if (target.disposition.state !== "ready") throw new Error("test fixture target is not ready");
  const targets = [{
    request: target.request,
    disposition: {
      ...target.disposition,
      recipeDigest: digest(`direct-recipe:${label}`),
      observationDigest: digest(`direct-observation:${label}`),
      executionPackage,
    },
  }];
  const captureDigest = digest(`capture-execution:${label}`);
  const planningObservationDigest = digest(`planning-execution:${label}`);
  const candidate = decodePrivateActivationCandidateV5({
    candidate: json1({
      ...fixture.candidate.candidate,
      captureDigest,
      activationMeaningDigest: activationMeaning(
        fixture.candidate.candidate.observedSemanticDigest,
        targets,
      ),
      resolutionInputDigest: privateDomainDigest(
        "JIG-Package-Project-Resolution-Input/1",
        { captureDigest, planningObservationDigest },
      ),
      planningObservationDigest,
      targets,
    } as unknown as JsonValue),
    lock: encodePrivateProjectLocalLock(fixture.candidate.lock),
  });
  insertCandidateRow(fixture.database, revision + 1, candidate, true);
  return candidate;
}

function insertCandidateRow(
  databasePath: string,
  revision: number,
  candidate: PrivateActivationCandidateArtifactV5,
  advanceHead: boolean,
): void {
  const encoded = encodePrivateActivationCandidateV5(candidate);
  const database = openSqlite(databasePath, "readwrite");
  try {
    database.exec("BEGIN IMMEDIATE");
    database.query(
      "INSERT INTO candidates(revision, candidate_digest, candidate_bytes, lock_bytes) VALUES (?1, ?2, ?3, ?4)",
    ).run(
      revision,
      privateActivationCandidateDigestV5(candidate),
      encoded.candidate,
      encoded.lock,
    );
    if (advanceHead) {
      database.query("UPDATE candidate_head SET revision = ?1 WHERE singleton = 1").run(revision);
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.inTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close(true);
  }
}

function seedPlan(
  fixture: Fixture,
  candidate: PrivateActivationCandidateArtifactV5,
  input: {
    readonly baseGeneration: string | null;
    readonly observedLock: "absent" | "present";
    readonly operation: "admission" | "lock-repair";
  },
): string {
  const database = openSqlite(fixture.database, "readonly");
  const candidateDigest = privateActivationCandidateDigestV5(candidate);
  const row = database.query(
    "SELECT revision FROM candidates WHERE candidate_digest = ?1 ORDER BY revision DESC LIMIT 1",
  ).get(candidateDigest) as { readonly revision: number } | null;
  database.close(true);
  if (row === null) throw new Error("test candidate was not retained");
  const plan = createPrivateActivationPlanV2({
    candidate,
    candidateRevision: row.revision,
    baseGeneration: input.baseGeneration,
    lockMode: "update",
    observedLock: input.observedLock === "absent"
      ? { state: "absent" }
      : { state: "present", lock: candidate.lock },
    operation: input.operation,
  });
  const bytes = encodePrivateActivationPlanV2(plan);
  const planDigest = privateActivationPlanDigestV2(plan);
  const writer = openSqlite(fixture.database, "readwrite");
  try {
    writer.query(
      "INSERT INTO review_plans(plan_digest, candidate_revision, plan_bytes) VALUES (?1, ?2, ?3)",
    ).run(planDigest, row.revision, bytes);
  } finally {
    writer.close(true);
  }
  return planDigest;
}

async function admit(fixture: Fixture): Promise<string> {
  const receipt = requireAdmission(await applyPlan(
    fixture,
    seedPlan(fixture, fixture.candidate, {
      baseGeneration: null,
      observedLock: "absent",
      operation: "admission",
    }),
  ));
  return receipt.admissionDigest;
}

function applyPlan(fixture: Fixture, planDigest: string) {
  return applyPrivateActivationReviewPlan({
    projectRoot: fixture.root,
    packageStoreRoot: fixture.store,
    planDigest,
  });
}

function requireAdmission<T>(value: T): Extract<T, { readonly operation: "admission" }> {
  if (value === null || typeof value !== "object" || !("operation" in value) ||
      value.operation !== "admission") {
    throw new Error("test expected an admission receipt");
  }
  return value as Extract<T, { readonly operation: "admission" }>;
}

async function submitReadyRun(
  fixture: Fixture,
  coordinator: PrivateProjectCoordinator,
  submissionId: string,
  deadlineUnixMs = Date.now() + 60_000,
) {
  return await submitPrivateRootRun({
    coordinator,
    projectRoot: fixture.root,
    packageStoreRoot: fixture.store,
    submissionId,
    target: { kind: "flow", path: "flows/run" },
    input: { value: submissionId },
    deadlineUnixMs,
  });
}

function checkpoint(
  fixture: Fixture,
  coordinator: PrivateProjectCoordinator,
  runId: string,
  name: Parameters<typeof recordPrivateRootExecutionCheckpoint>[0]["checkpoint"],
  value: JsonValue,
) {
  return recordPrivateRootExecutionCheckpoint({
    coordinator,
    projectRoot: fixture.root,
    runId,
    checkpoint: name,
    value,
  });
}

async function settleExecution(
  fixture: Fixture,
  coordinator: PrivateProjectCoordinator,
  runId: string,
  terminal: PrivateRootRunTerminal,
): Promise<void> {
  await checkpoint(fixture, coordinator, runId, "plan", { recipe: "exact" });
  await checkpoint(fixture, coordinator, runId, "backing", { package: "retained" });
  await checkpoint(fixture, coordinator, runId, "sandbox", { owner: "sandbox" });
  await checkpoint(fixture, coordinator, runId, "prepared", { ready: true });
  await checkpoint(fixture, coordinator, runId, "provisional", terminal as unknown as JsonValue);
  await checkpoint(fixture, coordinator, runId, "fence", { populated: false });
  await checkpoint(fixture, coordinator, runId, "release", { released: true });
  await checkpoint(fixture, coordinator, runId, "admitted", terminal as unknown as JsonValue);
}

function successTerminal(output: JsonValue): PrivateRootRunTerminal {
  return Object.freeze({
    status: "succeeded" as const,
    result: Object.freeze({ outcome: "done", output }),
    diagnostics: Object.freeze({ stderr: "", stderrBytes: 0, stderrTruncated: false }),
  });
}

function activationRequest(content: Record<string, unknown>): Record<string, unknown> {
  const request = { kind: "activation-request/2", ...content };
  return {
    ...request,
    digest: privateDomainDigest("JIG-Activation-Request/2", request as unknown as JsonValue),
  };
}

function activationMeaning(observedSemanticDigest: string, targets: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Activation-Meaning/1",
    { observedSemanticDigest, targets } as JsonValue,
  );
}

async function retainPackage(store: string, source: string): Promise<PackageArtifactRef> {
  const captured = await capturePackageDirectory(source);
  try {
    return await publishCapturedPackage(store, captured);
  } finally {
    await captured.dispose();
  }
}

async function retainDistinctExecutionPackage(
  fixture: Fixture,
  label: string,
): Promise<PackageArtifactRef> {
  const source = join(fixture.base, `execution-${label}`);
  await mkdir(join(source, "node_modules", "dependency"), { recursive: true });
  await writeFile(join(source, "FLOW.md"), [
    "---",
    "name: run",
    "description: Prepared direct alpha store fixture.",
    "---",
    "",
  ].join("\n"));
  await writeFile(join(source, "flow.ts"), "#!/usr/bin/env bun\nimport 'dependency';\nexport {};\n");
  await writeFile(join(source, "node_modules", "dependency", "index.js"), "export {};\n");
  return await retainPackage(fixture.store, source);
}

function packageArtifactPath(store: string, reference: PackageArtifactRef): string {
  const hexadecimal = reference.digest.slice("sha256:".length);
  return join(store, "packages", "v1", "sha256", hexadecimal.slice(0, 2), `${hexadecimal.slice(2)}.pkg`);
}

function activationAuthoritySnapshot(databasePath: string): Readonly<Record<string, unknown>> {
  const database = openSqlite(databasePath, "readonly");
  try {
    return Object.freeze({
      candidateHead: database.query("SELECT singleton, revision FROM candidate_head ORDER BY singleton").all(),
      candidates: database.query([
        "SELECT revision, candidate_digest, hex(candidate_bytes) AS candidate_bytes,",
        "hex(lock_bytes) AS lock_bytes FROM candidates ORDER BY revision",
      ].join(" ")).all(),
      plans: database.query([
        "SELECT plan_digest, candidate_revision, hex(plan_bytes) AS plan_bytes",
        "FROM review_plans ORDER BY plan_digest",
      ].join(" ")).all(),
      admissionHead: database.query("SELECT singleton, revision FROM admission_head ORDER BY singleton").all(),
      admissions: database.query([
        "SELECT revision, admission_digest, base_generation, plan_digest,",
        "hex(admission_bytes) AS admission_bytes FROM admissions ORDER BY revision",
      ].join(" ")).all(),
    });
  } finally {
    database.close(true);
  }
}

function tableNames(database: any): readonly string[] {
  return database.query(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(({ name }: { readonly name: string }) => name);
}

function indexNames(database: any): readonly string[] {
  return database.query(
    "SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map(({ name }: { readonly name: string }) => name);
}

function openSqlite(path: string, mode: "readonly" | "readwrite"): any {
  const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
  const access = mode === "readonly"
    ? sqlite.constants.SQLITE_OPEN_READONLY
    : sqlite.constants.SQLITE_OPEN_READWRITE;
  return sqlite.Database.open(path, access | sqlite.constants.SQLITE_OPEN_NOFOLLOW);
}

function json1(value: JsonValue): Uint8Array {
  const body = canonicalJson(value);
  const bytes = new Uint8Array(body.byteLength + 1);
  bytes.set(body);
  bytes[body.byteLength] = 0x0a;
  return bytes;
}

function digest(label: string): string {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}
