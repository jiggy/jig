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
  privateProjectLocalLockDigest,
} from "../src/internal/project-local-lock.js";
import {
  createPrivateUnavailableReviewPlan,
  loadPrivateUnavailableReviewPlan,
  requirePrivateStoredUnavailableCandidate,
} from "../src/internal/unavailable-admission-store.js";
import {
  decodePrivateUnavailableCandidate,
  encodePrivateUnavailableCandidate,
  privateUnavailableCandidateDigest,
  requirePrivateCreatedUnavailableCandidate,
} from "../src/internal/unavailable-admission.js";
import { canonicalJson, type JsonValue } from "../src/json.js";
import { capturePackageDirectory } from "../src/package/capture.js";

const CREATE_CANDIDATES = "CREATE TABLE candidates (revision INTEGER PRIMARY KEY CHECK (revision BETWEEN 1 AND 9007199254740991), candidate_digest TEXT NOT NULL, candidate_bytes BLOB NOT NULL CHECK (length(candidate_bytes) BETWEEN 1 AND 16777216), lock_bytes BLOB NOT NULL CHECK (length(lock_bytes) BETWEEN 1 AND 16777216)) STRICT";
const CREATE_CANDIDATE_HEAD = "CREATE TABLE candidate_head (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER REFERENCES candidates(revision)) STRICT";
const CREATE_REVIEW_PLANS = "CREATE TABLE review_plans (plan_digest TEXT PRIMARY KEY, candidate_revision INTEGER NOT NULL REFERENCES candidates(revision), plan_bytes BLOB NOT NULL CHECK (length(plan_bytes) BETWEEN 1 AND 16777216)) STRICT";

setDefaultTimeout(20_000);

describe.serial("private unavailable admission SQLite store", () => {
  test("creates and reloads one immutable plan under ordinary Linux CI", async () => {
    const fixture = await createFixture();
    try {
      expect(() => requirePrivateCreatedUnavailableCandidate(fixture.candidate)).toThrow(
        "was not built from a retained project",
      );
      expect(() => requirePrivateStoredUnavailableCandidate(fixture.candidate)).toThrow(
        "has not been reverified",
      );
      const plans = await Promise.all(Array.from({ length: 4 }, () => retryBusy(
        () => createPrivateUnavailableReviewPlan({
          projectRoot: fixture.root,
          packageStoreRoot: fixture.store,
          lockMode: "update",
        }),
      )));
      expect(new Set(plans.map(({ planDigest }) => planDigest)).size).toBe(1);
      expect(plans[0]!.plan).toMatchObject({
        candidateRevision: 1,
        candidateDigest: privateUnavailableCandidateDigest(fixture.candidate),
        baseGeneration: null,
        lockMode: "update",
        observedLock: { state: "absent" },
      });
      expect(requirePrivateStoredUnavailableCandidate(plans[0]!.candidate)).toBe(
        plans[0]!.candidate,
      );
      const restarted = await loadPrivateUnavailableReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plans[0]!.planDigest,
      });
      expect(restarted.plan).toEqual(plans[0]!.plan);
      expect(restarted.planBytes).toEqual(plans[0]!.planBytes);
      expect(requirePrivateStoredUnavailableCandidate(restarted.candidate)).toBe(
        restarted.candidate,
      );

      const database = openSqlite(fixture.database, "readonly");
      try {
        expect(database.query(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        ).all().map(({ name }: { name: string }) => name)).toEqual([
          "candidate_head",
          "candidates",
          "review_plans",
        ]);
        expect(database.query("PRAGMA application_id").get().application_id).toBe(0x4a494731);
        expect(database.query("PRAGMA user_version").get().user_version).toBe(1);
        expect(database.query("SELECT count(*) AS count FROM review_plans").get().count).toBe(1);
      } finally {
        database.close(true);
      }
    } finally {
      await fixture.dispose();
    }
  });

  test("accepts a safe non-hot journal but rejects unsafe and WAL sidecars", async () => {
    const fixture = await createFixture();
    try {
      const plan = await createPrivateUnavailableReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      const journal = `${fixture.database}-journal`;
      const bytes = new Uint8Array(512);
      await writeFile(journal, bytes, { mode: 0o600 });
      expect((await loadPrivateUnavailableReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      })).plan).toEqual(plan.plan);
      expect(new Uint8Array(await readFile(journal))).toEqual(bytes);

      await chmod(journal, 0o644);
      await expect(loadPrivateUnavailableReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_SQLITE_SIDECAR" });
      await rm(journal);

      await writeFile(`${fixture.database}-wal`, new Uint8Array(), { mode: 0o600 });
      await expect(loadPrivateUnavailableReviewPlan({
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
      const plan = await createPrivateUnavailableReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        lockMode: "update",
      });
      let database = openSqlite(fixture.database, "readwrite");
      database.query("UPDATE candidates SET candidate_digest = ?1 WHERE revision = 1")
        .run(`sha256:${"0".repeat(64)}`);
      database.close(true);
      await expect(loadPrivateUnavailableReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_STATE_CORRUPT" });

      database = openSqlite(fixture.database, "readwrite");
      database.query("UPDATE candidates SET candidate_digest = ?1 WHERE revision = 1")
        .run(privateUnavailableCandidateDigest(fixture.candidate));
      database.close(true);
      await chmod(fixture.database, 0o644);
      await expect(loadPrivateUnavailableReviewPlan({
        projectRoot: fixture.root,
        packageStoreRoot: fixture.store,
        planDigest: plan.planDigest,
      })).rejects.toMatchObject({ code: "ADMISSION_DATABASE_PERMISSIONS" });
      await chmod(fixture.database, 0o600);
      await chmod(join(fixture.root, ".jig"), 0o755);
      await expect(loadPrivateUnavailableReviewPlan({
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
  readonly candidate: ReturnType<typeof decodePrivateUnavailableCandidate>;
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
    const candidate = decodePrivateUnavailableCandidate({
      candidate: json1({
        kind: "private-unavailable-candidate/1",
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
          identity: { kind: "flow", path: "flows/run" },
          requestDigest: digest("request"),
          disposition: {
            state: "unavailable",
            code: "RUNTIME_UNAVAILABLE",
            evidenceDigests: [digest("evidence")],
          },
        },
      }),
      lock: lockBytes,
    });
    const encoded = encodePrivateUnavailableCandidate(candidate);

    const state = join(root, ".jig");
    const databasePath = join(state, "private-unavailable-admission-v1.sqlite3");
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
        "INSERT INTO candidate_head(singleton, revision) VALUES (1, NULL)",
        "PRAGMA application_id=1246316337",
        "PRAGMA user_version=1",
      ].join(";"));
      database.exec("BEGIN IMMEDIATE");
      database.query(
        "INSERT INTO candidates(revision, candidate_digest, candidate_bytes, lock_bytes) VALUES (1, ?1, ?2, ?3)",
      ).run(privateUnavailableCandidateDigest(candidate), encoded.candidate, encoded.lock);
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
