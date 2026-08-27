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
  createPrivateActivationReviewPlan,
  loadPrivateActiveActivation,
  loadPrivateActivationReviewPlan,
  requirePrivateStoredActivationCandidate,
} from "../src/internal/activation-admission-store.js";
import {
  decodePrivateActivationCandidate,
  encodePrivateActivationCandidate,
  privateActivationCandidateDigest,
  requirePrivateCreatedActivationCandidate,
} from "../src/internal/activation-admission.js";
import { canonicalJson, type JsonValue } from "../src/json.js";
import { capturePackageDirectory } from "../src/package/capture.js";

const CREATE_CANDIDATES = "CREATE TABLE candidates (revision INTEGER PRIMARY KEY CHECK (revision BETWEEN 1 AND 9007199254740991), candidate_digest TEXT NOT NULL, candidate_bytes BLOB NOT NULL CHECK (length(candidate_bytes) BETWEEN 1 AND 16777216), lock_bytes BLOB NOT NULL CHECK (length(lock_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_CANDIDATE_HEAD = "CREATE TABLE candidate_head (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER REFERENCES candidates(revision)) STRICT";
const CREATE_REVIEW_PLANS = "CREATE TABLE review_plans (plan_digest TEXT PRIMARY KEY, candidate_revision INTEGER NOT NULL REFERENCES candidates(revision), plan_bytes BLOB NOT NULL CHECK (length(plan_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_ADMISSIONS = "CREATE TABLE admissions (revision INTEGER PRIMARY KEY CHECK (revision BETWEEN 1 AND 9007199254740991), admission_digest TEXT NOT NULL UNIQUE, base_generation TEXT UNIQUE REFERENCES admissions(admission_digest), plan_digest TEXT NOT NULL UNIQUE REFERENCES review_plans(plan_digest), admission_bytes BLOB NOT NULL CHECK (length(admission_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_ADMISSION_HEAD = "CREATE TABLE admission_head (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER REFERENCES admissions(revision)) STRICT";

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
          "review_plans",
        ]);
        expect(database.query("PRAGMA application_id").get().application_id).toBe(0x4a494734);
        expect(database.query("PRAGMA user_version").get().user_version).toBe(4);
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

async function createFixture(): Promise<Fixture> {
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
          disposition: {
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
    const databasePath = join(state, "private-activation-admission-v4.sqlite3");
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
        "INSERT INTO candidate_head(singleton, revision) VALUES (1, NULL)",
        "INSERT INTO admission_head(singleton, revision) VALUES (1, NULL)",
        "PRAGMA application_id=1246316340",
        "PRAGMA user_version=4",
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
