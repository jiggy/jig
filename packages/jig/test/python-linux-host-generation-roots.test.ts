import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { CheckError } from "../src/diagnostics.js";
import {
  encodePrivatePythonLinuxHostGeneration,
  observePrivatePythonLinuxHostGeneration,
  type PrivatePythonLinuxHostGeneration,
} from "../src/internal/python-linux-host-generation.js";
import {
  convergePrivatePythonLinuxRoots,
  requirePrivatePythonLinuxRootConvergence,
  stagePrivatePythonLinuxRootIntent,
  type PrivatePythonLinuxRootMember,
} from "../src/internal/python-linux-host-generation-roots.js";
import { observePrivatePythonNixRuntime } from "../src/internal/python-nix-runtime.js";

const hostDescribe = process.env.JIG_NIX_GENERATION_HOST === "1" ? describe.serial : describe.skip;
const DATABASE_NAME = "private-python-linux-roots-v1.sqlite3";
const ROOTS_DIRECTORY = "runtime-roots";
const STATE_PREFIX = "jig-host-roots-test-";
const PROBE_TIMEOUT_MS = 20_000;
const MAX_PROBE_OUTPUT_BYTES = 1024 * 1024;
const EXPECTED_SCHEMA = "CREATE TABLE generation (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), generation_digest TEXT NOT NULL UNIQUE, generation_bytes BLOB NOT NULL CHECK (length(generation_bytes) BETWEEN 2 AND 65536)) STRICT";

hostDescribe("private Python/Linux retained host generation", () => {
  let generation: PrivatePythonLinuxHostGeneration;
  let alternateGeneration: PrivatePythonLinuxHostGeneration;
  let stateParent: string;
  let parentBaseline: readonly string[];
  let fakeNixStore: string;
  let fakeNixLog: string;
  let fakeNixControl: string;
  const liveFixtures = new Set<string>();

  beforeAll(async () => {
    stateParent = await realpath(requiredEnvironment("JIG_TEST_HOST_STATE_PARENT"));
    parentBaseline = await testStateDirectories(stateParent);
    ({
      storePath: fakeNixStore,
      logPath: fakeNixLog,
      controlPath: fakeNixControl,
    } = await createFakeNixStore(stateParent));
    generation = await observeGeneration(false, fakeNixStore);
    alternateGeneration = await observeGeneration(true, fakeNixStore);
    expect(alternateGeneration.digest).not.toBe(generation.digest);
    expect(alternateGeneration.members.map((member) => member.storePath)).toEqual(
      generation.members.map((member) => member.storePath),
    );
  }, 120_000);

  afterAll(async () => {
    const live = [...liveFixtures];
    const stateDirectories = await testStateDirectories(stateParent);
    const controlWasPresent = await exists(fakeNixControl);
    let logEvidence: Readonly<Record<string, unknown>> | undefined;
    try {
      const information = await lstat(fakeNixLog, { bigint: true });
      logEvidence = Object.freeze({
        file: information.isFile(),
        uid: information.uid,
        links: information.nlink,
        mode: information.mode & 0o7777n,
      });
    } finally {
      await unlinkOwnedFixtureFile(fakeNixControl);
      await unlinkOwnedFixtureFile(fakeNixLog);
    }
    expect(live).toEqual([]);
    expect(stateDirectories).toEqual(parentBaseline);
    expect(controlWasPresent).toBe(false);
    expect(logEvidence).toEqual({
      file: true,
      uid: BigInt(process.geteuid!()),
      links: 1n,
      mode: 0o600n,
    });
  });

  test("durably stages and repeatedly converges one exact generation", async () => {
    const stateRoot = await createStateRoot(stateParent, liveFixtures);
    try {
      await stagePrivatePythonLinuxRootIntent({ stateRoot, generation });
      await stagePrivatePythonLinuxRootIntent({ stateRoot, generation });
      await expectSqliteState(stateRoot, generation.digest);

      const first = await convergePrivatePythonLinuxRoots({
        stateRoot,
        expectedDigest: generation.digest,
      });
      const second = await convergePrivatePythonLinuxRoots({
        stateRoot,
        expectedDigest: generation.digest,
      });
      expect(requirePrivatePythonLinuxRootConvergence(first)).toBe(first);
      expect(requirePrivatePythonLinuxRootConvergence(second)).toBe(second);
      expect(() => requirePrivatePythonLinuxRootConvergence({ ...second })).toThrow(
        "were not produced by the private converger",
      );
      expect(first.admissible).toBe(false);
      expect(first.roots.length).toBe(generation.members.length);
      expect(second.digest).toBe(first.digest);
      await expectExactRootSet(first.roots);

      const beforeDatabase = await databaseSnapshot(stateRoot);
      const effectsBefore = (await readFakeEffects(fakeNixLog)).length;
      expect(await freshProcessConverge(stateRoot, generation.digest)).toEqual({
        admissible: false,
        digest: first.digest,
        generationDigest: generation.digest,
        roots: generation.members.length,
      });
      expect(await databaseSnapshot(stateRoot)).toEqual(beforeDatabase);
      expect((await readFakeEffects(fakeNixLog)).length).toBe(effectsBefore + first.roots.length);
      await expectExactRootSet(first.roots);
      expectFakeNixPosture(await readFakeEffects(fakeNixLog));
    } finally {
      await cleanupStateRoot(stateRoot, generation, liveFixtures);
    }
  }, 120_000);

  test("serializes singleton intent and converges concurrent same-generation publishers", async () => {
    const stateRoot = await createStateRoot(stateParent, liveFixtures);
    let winner: PrivatePythonLinuxHostGeneration | undefined;
    try {
      const staged = await Promise.allSettled([
        stagePrivatePythonLinuxRootIntent({ stateRoot, generation }),
        stagePrivatePythonLinuxRootIntent({ stateRoot, generation: alternateGeneration }),
      ]);
      expect(staged.some((result) => result.status === "fulfilled")).toBe(true);
      for (const result of staged) {
        if (result.status === "rejected") expectCheckError(result.reason, [
          "HOST_ROOT_BUSY",
          "HOST_ROOT_GENERATION_CONFLICT",
        ]);
      }

      const storedDigest = readStoredDigest(stateRoot);
      winner = storedDigest === generation.digest ? generation : alternateGeneration;
      const loser = winner === generation ? alternateGeneration : generation;
      await stagePrivatePythonLinuxRootIntent({ stateRoot, generation: winner });
      await expectCheckErrorAsync(
        () => stagePrivatePythonLinuxRootIntent({ stateRoot, generation: loser }),
        ["HOST_ROOT_GENERATION_CONFLICT"],
      );

      const effectsBeforeRace = (await readFakeEffects(fakeNixLog)).length;
      const raced = await Promise.allSettled(Array.from({ length: 4 }, () => (
        convergePrivatePythonLinuxRoots({ stateRoot, expectedDigest: winner!.digest })
      )));
      for (const result of raced) {
        if (result.status === "rejected") expectCheckError(result.reason, [
          "HOST_ROOT_INCOMPLETE",
          "HOST_ROOT_CHANGED",
          "HOST_ROOT_TARGET",
        ]);
      }
      const raceEffects = (await readFakeEffects(fakeNixLog)).slice(effectsBeforeRace);
      expectFakeNixPosture(raceEffects);
      const allowedPairs = new Set(expectedRoots(stateRoot, winner).map((root) => (
        `${root.rootPath}\u0000${root.storePath}`
      )));
      for (const effect of raceEffects) {
        expect(allowedPairs.has(`${effect.rootPath}\u0000${effect.storePath}`)).toBe(true);
      }
      const final = await convergePrivatePythonLinuxRoots({
        stateRoot,
        expectedDigest: winner.digest,
      });
      expect((await convergePrivatePythonLinuxRoots({
        stateRoot,
        expectedDigest: winner.digest,
      })).digest).toBe(final.digest);
    } finally {
      if (winner === undefined) {
        winner = storedGenerationIfPresent(stateRoot, [generation, alternateGeneration]) ?? generation;
      }
      await cleanupStateRoot(stateRoot, winner, liveFixtures);
    }
  }, 120_000);

  test("replays a deterministic partially materialized prefix", async () => {
    const stateRoot = await createStateRoot(stateParent, liveFixtures);
    try {
      await stagePrivatePythonLinuxRootIntent({ stateRoot, generation });
      const roots = expectedRoots(stateRoot, generation);
      expect(roots.length).toBeGreaterThan(2);
      await createRootTree(stateRoot, generation);
      await symlink(roots[0]!.storePath, roots[0]!.rootPath);
      await symlink(roots[1]!.storePath, roots[1]!.rootPath);
      await syncDirectory(dirname(roots[0]!.rootPath));
      const effectsBefore = (await readFakeEffects(fakeNixLog)).length;

      const converged = await convergePrivatePythonLinuxRoots({
        stateRoot,
        expectedDigest: generation.digest,
      });
      expect((await readFakeEffects(fakeNixLog)).length).toBe(effectsBefore + roots.length);
      expect((await convergePrivatePythonLinuxRoots({
        stateRoot,
        expectedDigest: generation.digest,
      })).digest).toBe(converged.digest);
      await expectExactRootSet(converged.roots);
    } finally {
      await cleanupStateRoot(stateRoot, generation, liveFixtures);
    }
  }, 120_000);

  test("reconverges while an exact same-target Nix client outlives its coordinator", async () => {
    const stateRoot = await createStateRoot(stateParent, liveFixtures);
    const roots = expectedRoots(stateRoot, generation);
    const suffix = stateRoot.slice(stateRoot.lastIndexOf("/") + 1);
    const claimPath = join(stateParent, `${suffix}.claim`);
    const markerPath = join(stateParent, `${suffix}.marker`);
    const releasePath = join(stateParent, `${suffix}.release`);
    let wrapper: ReturnType<typeof spawn> | undefined;
    let coordinatorPid: number | undefined;
    let escapedPid: number | undefined;
    let coordinatorExited = false;
    let escapedReaped = false;
    try {
      await stagePrivatePythonLinuxRootIntent({ stateRoot, generation });
      await writeFile(fakeNixControl, JSON.stringify({
        claimPath,
        markerPath,
        releasePath,
        rootPath: roots[0]!.rootPath,
      }) + "\n", { flag: "wx", mode: 0o600 });
      const workerSource = convergenceWorkerSource(stateRoot, generation.digest);
      wrapper = spawnSubreaper(
        generation.roles.find((role) => role.role === "python")!.path,
        generation.roles.find((role) => role.role === "coordinator-bun")!.path,
        workerSource,
      );
      coordinatorPid = Number(await firstLine(wrapper.stdout!));
      if (!Number.isSafeInteger(coordinatorPid) || coordinatorPid <= 1) {
        throw new Error("subreaper returned an invalid coordinator PID");
      }
      await waitForPath(markerPath);
      escapedPid = (JSON.parse(await readFile(markerPath, "utf8")) as { readonly pid: number }).pid;
      expect(processAlive(coordinatorPid)).toBe(true);
      expect(processAlive(escapedPid)).toBe(true);

      process.kill(coordinatorPid, "SIGKILL");
      await waitForProcessExit(coordinatorPid);
      coordinatorExited = true;
      const effectsBeforeRecovery = (await readFakeEffects(fakeNixLog)).length;
      const recovery = convergePrivatePythonLinuxRoots({
        stateRoot,
        expectedDigest: generation.digest,
      });
      await waitForEffectCount(fakeNixLog, effectsBeforeRecovery + 1);
      const converged = await recovery;
      expect(requirePrivatePythonLinuxRootConvergence(converged)).toBe(converged);
      await expectExactRootSet(converged.roots);
      await writeFile(releasePath, "release\n", { flag: "wx", mode: 0o600 });
      const wrapperResult = await waitForChild(wrapper, 15_000);
      expect(wrapperResult.code).toBe(0);
      expect(wrapperResult.signal).toBeNull();
      escapedReaped = true;
      await expectExactRootSet(converged.roots);
    } finally {
      if (!await exists(releasePath)) await writeFile(releasePath, "release\n", { mode: 0o600 });
      if (wrapper !== undefined) {
        if (wrapper.exitCode === null && wrapper.signalCode === null) {
          await waitForChild(wrapper, 30_000);
        }
        coordinatorExited = true;
        escapedReaped = true;
      }
      if (coordinatorPid !== undefined && !coordinatorExited) {
        throw new Error(`coordinator ${coordinatorPid} has no completion fence`);
      }
      if (escapedPid !== undefined && !escapedReaped) {
        throw new Error(`escaped fake Nix process ${escapedPid} has no subreaper fence`);
      }
      for (const path of [fakeNixControl, claimPath, markerPath, releasePath]) {
        await unlinkOwnedFixtureFile(path);
      }
      await cleanupStateRoot(stateRoot, generation, liveFixtures);
    }
  }, 120_000);

  test("rejects and preserves root collisions before invoking Nix", async () => {
    await collisionCase("wrong symlink", async (root) => {
      const wrongTarget = generation.members.find((member) => member.storePath !== root.storePath)!.storePath;
      await symlink(wrongTarget, root.rootPath);
      const before = await lstat(root.rootPath, { bigint: true });
      return {
        expectedCode: "HOST_ROOT_TARGET",
        async verify(): Promise<void> {
          const after = await lstat(root.rootPath, { bigint: true });
          expect(after.ino).toBe(before.ino);
          expect(await readlink(root.rootPath)).toBe(wrongTarget);
        },
        async remove(): Promise<void> {
          if (await readlink(root.rootPath) !== wrongTarget) throw new Error("wrong-link fixture changed");
          await unlink(root.rootPath);
        },
      };
    });

    await collisionCase("regular file", async (root) => {
      await writeFile(root.rootPath, "collision\n", { mode: 0o600, flag: "wx" });
      const before = await lstat(root.rootPath, { bigint: true });
      return {
        expectedCode: "HOST_ROOT_ENTRY",
        async verify(): Promise<void> {
          const after = await lstat(root.rootPath, { bigint: true });
          expect(after.ino).toBe(before.ino);
          expect(await readFile(root.rootPath, "utf8")).toBe("collision\n");
        },
        async remove(): Promise<void> {
          const current = await lstat(root.rootPath, { bigint: true });
          if (!current.isFile() || current.ino !== before.ino) throw new Error("file fixture changed");
          await unlink(root.rootPath);
        },
      };
    });

    await collisionCase("hard-linked symlink", async (root) => {
      const outside = join(stateParent, `${stateRootName(dirname(dirname(dirname(root.rootPath))))}.root-hardlink`);
      await symlink(root.storePath, root.rootPath);
      await link(root.rootPath, outside);
      const before = await lstat(root.rootPath, { bigint: true });
      return {
        expectedCode: "HOST_ROOT_ENTRY",
        async verify(): Promise<void> {
          const [current, external] = await Promise.all([
            lstat(root.rootPath, { bigint: true }),
            lstat(outside, { bigint: true }),
          ]);
          expect(current.ino).toBe(before.ino);
          expect(external.ino).toBe(before.ino);
          expect(current.nlink).toBe(2n);
        },
        async remove(): Promise<void> {
          const [current, external] = await Promise.all([
            lstat(root.rootPath, { bigint: true }),
            lstat(outside, { bigint: true }),
          ]);
          if (current.ino !== before.ino || external.ino !== before.ino) {
            throw new Error("root hardlink fixture changed");
          }
          await unlink(outside);
          await syncDirectory(dirname(outside));
          await unlink(root.rootPath);
        },
      };
    });

    const stateRoot = await createStateRoot(stateParent, liveFixtures);
    try {
      await stagePrivatePythonLinuxRootIntent({ stateRoot, generation });
      const generationPath = await createRootTree(stateRoot, generation);
      const surprise = join(generationPath, "surprise");
      await writeFile(surprise, "preserve\n", { mode: 0o600, flag: "wx" });
      const before = await lstat(surprise, { bigint: true });
      await expectCheckErrorAsync(() => convergePrivatePythonLinuxRoots({
        stateRoot,
        expectedDigest: generation.digest,
      }), ["HOST_ROOT_ENTRY"]);
      const after = await lstat(surprise, { bigint: true });
      expect(after.ino).toBe(before.ino);
      expect(await readFile(surprise, "utf8")).toBe("preserve\n");
      await unlink(surprise);
      await syncDirectory(generationPath);
    } finally {
      await cleanupStateRoot(stateRoot, generation, liveFixtures);
    }

    async function collisionCase(
      _label: string,
      seed: (root: PrivatePythonLinuxRootMember) => Promise<{
        readonly expectedCode: string;
        verify(): Promise<void>;
        remove(): Promise<void>;
      }>,
    ): Promise<void> {
      const collisionRoot = await createStateRoot(stateParent, liveFixtures);
      try {
        await stagePrivatePythonLinuxRootIntent({ stateRoot: collisionRoot, generation });
        await createRootTree(collisionRoot, generation);
        const root = expectedRoots(collisionRoot, generation)[0]!;
        const fixture = await seed(root);
        const effectsBefore = (await readFakeEffects(fakeNixLog)).length;
        try {
          await expectCheckErrorAsync(() => convergePrivatePythonLinuxRoots({
            stateRoot: collisionRoot,
            expectedDigest: generation.digest,
          }), [fixture.expectedCode]);
          await fixture.verify();
          expect((await readFakeEffects(fakeNixLog)).length).toBe(effectsBefore);
        } finally {
          await fixture.remove();
          await syncDirectory(dirname(root.rootPath));
        }
      } finally {
        await cleanupStateRoot(collisionRoot, generation, liveFixtures);
      }
    }
  }, 120_000);

  test("rejects unsafe database identities and sidecars without losing exact intent", async () => {
    const stateRoot = await createStateRoot(stateParent, liveFixtures);
    const databasePath = join(stateRoot, DATABASE_NAME);
    try {
      await stagePrivatePythonLinuxRootIntent({ stateRoot, generation });

      await chmod(databasePath, 0o644);
      try {
        await expectCheckErrorAsync(() => convergePrivatePythonLinuxRoots({
          stateRoot,
          expectedDigest: generation.digest,
        }), ["HOST_ROOT_DATABASE"]);
      } finally {
        await chmod(databasePath, 0o600);
      }

      const outsideLink = join(stateParent, `${STATE_PREFIX}hardlink-${process.pid}`);
      await link(databasePath, outsideLink);
      try {
        await expectCheckErrorAsync(() => convergePrivatePythonLinuxRoots({
          stateRoot,
          expectedDigest: generation.digest,
        }), ["HOST_ROOT_DATABASE"]);
      } finally {
        const outside = await lstat(outsideLink, { bigint: true });
        const database = await lstat(databasePath, { bigint: true });
        if (!outside.isFile() || outside.ino !== database.ino) throw new Error("database hardlink fixture changed");
        await unlink(outsideLink);
      }

      const wal = `${databasePath}-wal`;
      await writeFile(wal, "unsafe\n", { mode: 0o600, flag: "wx" });
      try {
        await expectCheckErrorAsync(() => convergePrivatePythonLinuxRoots({
          stateRoot,
          expectedDigest: generation.digest,
        }), ["HOST_ROOT_SQLITE_SIDECAR"]);
        expect(await readFile(wal, "utf8")).toBe("unsafe\n");
      } finally {
        await unlink(wal);
      }

      const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
      const mutate = (sql: string): void => {
        const database = sqlite.Database.open(databasePath);
        try { database.exec(sql); } finally { database.close(true); }
      };
      const effectsBeforeCorruption = (await readFakeEffects(fakeNixLog)).length;
      mutate("PRAGMA application_id=1");
      try {
        await expectCheckErrorAsync(() => convergePrivatePythonLinuxRoots({
          stateRoot,
          expectedDigest: generation.digest,
        }), ["HOST_ROOT_SCHEMA"]);
      } finally {
        mutate("PRAGMA application_id=1246253617");
      }

      mutate("PRAGMA user_version=2");
      try {
        await expectCheckErrorAsync(() => convergePrivatePythonLinuxRoots({
          stateRoot,
          expectedDigest: generation.digest,
        }), ["HOST_ROOT_SCHEMA"]);
      } finally {
        mutate("PRAGMA user_version=1");
      }

      mutate(`UPDATE generation SET generation_digest = '${alternateGeneration.digest}' WHERE singleton = 1`);
      try {
        await expectCheckErrorAsync(() => convergePrivatePythonLinuxRoots({
          stateRoot,
          expectedDigest: generation.digest,
        }), ["HOST_ROOT_CORRUPT"]);
      } finally {
        mutate(`UPDATE generation SET generation_digest = '${generation.digest}' WHERE singleton = 1`);
      }
      expect((await readFakeEffects(fakeNixLog)).length).toBe(effectsBeforeCorruption);

      await convergePrivatePythonLinuxRoots({ stateRoot, expectedDigest: generation.digest });
      await expectSqliteState(stateRoot, generation.digest);
    } finally {
      await cleanupStateRoot(stateRoot, generation, liveFixtures);
    }
  }, 120_000);

  test("recovers immutable intent after a SQLite writer dies with a hot journal", async () => {
    const stateRoot = await createStateRoot(stateParent, liveFixtures);
    const markerPath = join(stateParent, `${stateRoot.slice(stateRoot.lastIndexOf("/") + 1)}.sqlite-marker`);
    const databasePath = join(stateRoot, DATABASE_NAME);
    let writer: ReturnType<typeof spawn> | undefined;
    try {
      await stagePrivatePythonLinuxRootIntent({ stateRoot, generation });
      const source = `
import { Database } from "bun:sqlite";
import { writeFile } from "node:fs/promises";
const database = Database.open(${JSON.stringify(databasePath)});
database.exec("PRAGMA journal_mode=DELETE;PRAGMA synchronous=EXTRA;BEGIN IMMEDIATE");
database.query("UPDATE generation SET generation_digest = ?1 WHERE singleton = 1")
  .run(${JSON.stringify(alternateGeneration.digest)});
await writeFile(${JSON.stringify(markerPath)}, "ready\\n", { flag: "wx", mode: 0o600 });
while (true) await Bun.sleep(1_000);
`;
      writer = spawn(
        generation.roles.find((role) => role.role === "coordinator-bun")!.path,
        ["--no-env-file", "--no-install", "--config=/dev/null", "--eval", source],
        {
          argv0: "bun",
          cwd: "/",
          detached: true,
          env: Object.create(null) as NodeJS.ProcessEnv,
          stdio: "ignore",
        },
      );
      const completion = waitForChild(writer, 10_000);
      await waitForPath(markerPath);
      expect(await exists(`${databasePath}-journal`)).toBe(true);
      if (writer.pid === undefined) throw new Error("SQLite crash writer omitted its PID");
      process.kill(-writer.pid, "SIGKILL");
      const result = await completion;
      expect(result.code).toBeNull();
      expect(result.signal).toBe("SIGKILL");

      await stagePrivatePythonLinuxRootIntent({ stateRoot, generation });
      await expectSqliteState(stateRoot, generation.digest);
      const converged = await convergePrivatePythonLinuxRoots({
        stateRoot,
        expectedDigest: generation.digest,
      });
      await expectExactRootSet(converged.roots);
    } finally {
      if (writer !== undefined && writer.exitCode === null && writer.signalCode === null) {
        if (writer.pid === undefined) throw new Error("SQLite crash writer omitted its PID");
        try { process.kill(-writer.pid, "SIGKILL"); } catch { /* writer already exited */ }
        await waitForChild(writer, 5_000);
      }
      await unlinkOwnedFixtureFile(markerPath);
      await cleanupStateRoot(stateRoot, generation, liveFixtures);
    }
  }, 120_000);

  test("publishes nothing from schema-only state and recovers a killed first insert", async () => {
    const stateRoot = await createStateRoot(stateParent, liveFixtures);
    const markerPath = join(stateParent, `${stateRoot.slice(stateRoot.lastIndexOf("/") + 1)}.insert-marker`);
    const databasePath = join(stateRoot, DATABASE_NAME);
    let writer: ReturnType<typeof spawn> | undefined;
    try {
      await stagePrivatePythonLinuxRootIntent({ stateRoot, generation });
      const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
      const database = sqlite.Database.open(databasePath);
      try {
        database.exec("PRAGMA journal_mode=DELETE;PRAGMA synchronous=EXTRA;DELETE FROM generation");
      } finally {
        database.close(true);
      }
      const effectsBefore = (await readFakeEffects(fakeNixLog)).length;
      await expectCheckErrorAsync(() => convergePrivatePythonLinuxRoots({
        stateRoot,
        expectedDigest: generation.digest,
      }), ["HOST_ROOT_INTENT_MISSING"]);
      expect((await readFakeEffects(fakeNixLog)).length).toBe(effectsBefore);

      const encoded = Buffer.from(encodePrivatePythonLinuxHostGeneration(generation)).toString("base64");
      const source = `
import { Database } from "bun:sqlite";
import { writeFile } from "node:fs/promises";
const database = Database.open(${JSON.stringify(databasePath)});
database.exec("PRAGMA journal_mode=DELETE;PRAGMA synchronous=EXTRA;BEGIN IMMEDIATE");
database.query("INSERT INTO generation(singleton, generation_digest, generation_bytes) VALUES (1, ?1, ?2)")
  .run(${JSON.stringify(generation.digest)}, Uint8Array.from(Buffer.from(${JSON.stringify(encoded)}, "base64")));
await writeFile(${JSON.stringify(markerPath)}, "ready\\n", { flag: "wx", mode: 0o600 });
while (true) await Bun.sleep(1_000);
`;
      writer = spawn(
        generation.roles.find((role) => role.role === "coordinator-bun")!.path,
        ["--no-env-file", "--no-install", "--config=/dev/null", "--eval", source],
        {
          argv0: "bun",
          cwd: "/",
          detached: true,
          env: Object.create(null) as NodeJS.ProcessEnv,
          stdio: "ignore",
        },
      );
      const completion = waitForChild(writer, 10_000);
      await waitForPath(markerPath);
      expect(await exists(`${databasePath}-journal`)).toBe(true);
      if (writer.pid === undefined) throw new Error("SQLite first-insert writer omitted its PID");
      process.kill(-writer.pid, "SIGKILL");
      const result = await completion;
      expect(result.code).toBeNull();
      expect(result.signal).toBe("SIGKILL");

      await expectCheckErrorAsync(() => convergePrivatePythonLinuxRoots({
        stateRoot,
        expectedDigest: generation.digest,
      }), ["HOST_ROOT_INTENT_MISSING"]);
      expect((await readFakeEffects(fakeNixLog)).length).toBe(effectsBefore);

      await stagePrivatePythonLinuxRootIntent({ stateRoot, generation });
      await expectSqliteState(stateRoot, generation.digest);
      const converged = await convergePrivatePythonLinuxRoots({
        stateRoot,
        expectedDigest: generation.digest,
      });
      await expectExactRootSet(converged.roots);
    } finally {
      if (writer !== undefined && writer.exitCode === null && writer.signalCode === null) {
        if (writer.pid === undefined) throw new Error("SQLite first-insert writer omitted its PID");
        try { process.kill(-writer.pid, "SIGKILL"); } catch { /* writer already exited */ }
        await waitForChild(writer, 5_000);
      }
      await unlinkOwnedFixtureFile(markerPath);
      await cleanupStateRoot(stateRoot, generation, liveFixtures);
    }
  }, 120_000);
});

async function observeGeneration(
  swapBundles: boolean,
  closureQueryExecutable: string,
): Promise<PrivatePythonLinuxHostGeneration> {
  const nixStore = await realpath(requiredEnvironment("JIG_TEST_NIX_STORE"));
  const coordinator = await addFlatStoreObject(
    nixStore,
    resolve(import.meta.dir, "../dist/internal/python-linux-coordinator.bundle.js"),
  );
  const helper = await addFlatStoreObject(
    nixStore,
    resolve(import.meta.dir, "../dist/internal/linux-cgroup-helper.bundle.js"),
  );
  const runtime = await observePrivatePythonNixRuntime({
    pythonPath: requiredEnvironment("JIG_TEST_PYTHON"),
    nixStorePath: closureQueryExecutable,
  });
  const first = (await readFile("/bin/sh", "utf8")).split("\n", 1)[0]!;
  if (!first.startsWith("#!/")) throw new Error("host did not expose the expected Bash shebang");
  return observePrivatePythonLinuxHostGeneration({
    coordinatorPath: swapBundles ? helper : coordinator,
    helperPath: swapBundles ? coordinator : helper,
    coordinatorBunPath: "/bin/bun",
    helperBunPath: "/bin/bun",
    bubblewrapPath: "/usr/bin/bwrap",
    bashPath: first.slice(2),
    runtime,
  });
}

async function createFakeNixStore(parent: string): Promise<{
  readonly storePath: string;
  readonly logPath: string;
  readonly controlPath: string;
}> {
  const sourceDirectory = await mkdtemp(join(parent, "jig-host-roots-fake-nix-source-"));
  const sourcePath = join(sourceDirectory, "nix-store");
  const logPath = join(parent, `jig-host-roots-fake-nix-${sourceDirectory.slice(sourceDirectory.lastIndexOf("-") + 1)}.jsonl`);
  const controlPath = `${logPath}.control.json`;
  await writeFile(logPath, "", { flag: "wx", mode: 0o600 });
  const source = `#!/bin/bun
import { appendFile, readFile, readlink, symlink, unlink, writeFile } from "node:fs/promises";

const arguments_ = process.argv.slice(2);
const query = arguments_.indexOf("-qR");
if (query >= 0) {
  const target = arguments_[query + 1];
  if (typeof target !== "string" || !target.startsWith("/nix/store/")) process.exit(70);
  process.stdout.write(target + "\\n");
  process.exit(0);
}

const rootIndex = arguments_.indexOf("--add-root");
const realiseIndex = arguments_.indexOf("-r");
const root = arguments_[rootIndex + 1];
const target = arguments_[realiseIndex + 1];
const expected = [
  "--store", "daemon",
  "--option", "substitute", "false",
  "--option", "fallback", "false",
  "--add-root", root,
  "--indirect",
  "-r", target,
];
if (rootIndex < 0 || realiseIndex < 0 || JSON.stringify(arguments_) !== JSON.stringify(expected) ||
    typeof root !== "string" || !root.startsWith("/") ||
    typeof target !== "string" || !target.startsWith("/nix/store/") || process.cwd() !== "/") {
  process.stderr.write("invalid fake Nix invocation\\n");
  process.exit(70);
}
await appendFile(${JSON.stringify(logPath)}, JSON.stringify({
  arguments: arguments_,
  cwd: process.cwd(),
  environment: Object.keys(process.env).sort(),
  rootPath: root,
  storePath: target,
}) + "\\n");
try {
  const control = JSON.parse(await readFile(${JSON.stringify(controlPath)}, "utf8"));
  if (control.rootPath === root) {
    let claimed = false;
    try {
      await writeFile(control.claimPath, String(process.pid) + "\\n", { flag: "wx", mode: 0o600 });
      claimed = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    if (claimed) {
      await writeFile(control.markerPath, JSON.stringify({ pid: process.pid }) + "\\n", {
        flag: "wx",
        mode: 0o600,
      });
      const deadline = Date.now() + 8_000;
      while (true) {
        try { await readFile(control.releasePath); break; }
        catch (error) { if (error?.code !== "ENOENT") throw error; }
        if (Date.now() >= deadline) throw new Error("fake Nix pause deadline exceeded");
        await Bun.sleep(5);
      }
    }
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
try { await unlink(root); } catch (error) { if (error?.code !== "ENOENT") throw error; }
try {
  await symlink(target, root);
} catch (error) {
  if (error?.code !== "EEXIST" || await readlink(root) !== target) throw error;
}
process.stdout.write(root + "\\n");
`;
  try {
    await writeFile(sourcePath, source, { flag: "wx", mode: 0o755 });
    await chmod(sourcePath, 0o755);
    const storePath = await addFlatStoreObject(
      await realpath(requiredEnvironment("JIG_TEST_NIX_STORE")),
      sourcePath,
    );
    return Object.freeze({ storePath, logPath, controlPath });
  } catch (error) {
    await unlink(logPath).catch(() => undefined);
    throw error;
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    await rmdir(sourceDirectory).catch(() => undefined);
  }
}

async function addFlatStoreObject(nixStore: string, source: string): Promise<string> {
  const result = await invoke(nixStore, [
    "--store", "daemon",
    "--option", "substitute", "false",
    "--option", "fallback", "false",
    "--add", source,
  ], "nix-store");
  if (result.code !== 0) throw new Error(`could not add flat host fixture: ${result.stderr.trim()}`);
  const path = result.stdout.trim();
  if (!path.startsWith("/nix/store/")) throw new Error("nix-store --add returned an invalid path");
  return path;
}

async function createStateRoot(parent: string, live: Set<string>): Promise<string> {
  const root = await mkdtemp(join(parent, STATE_PREFIX));
  await chmod(root, 0o700);
  const canonical = await realpath(root);
  if (canonical !== root) throw new Error("test state root is not canonical");
  live.add(root);
  return root;
}

async function createRootTree(
  stateRoot: string,
  generation: PrivatePythonLinuxHostGeneration,
): Promise<string> {
  const collection = join(stateRoot, ROOTS_DIRECTORY);
  const generationPath = join(collection, generation.digest.slice("sha256:".length));
  await mkdir(collection, { mode: 0o700 });
  await mkdir(generationPath, { mode: 0o700 });
  await syncDirectory(generationPath);
  await syncDirectory(collection);
  await syncDirectory(stateRoot);
  return generationPath;
}

function expectedRoots(
  stateRoot: string,
  generation: PrivatePythonLinuxHostGeneration,
): readonly PrivatePythonLinuxRootMember[] {
  const directory = join(stateRoot, ROOTS_DIRECTORY, generation.digest.slice("sha256:".length));
  return Object.freeze(generation.members.map((member, index) => Object.freeze({
    rootPath: join(directory, `member-${index.toString().padStart(4, "0")}`),
    storePath: member.storePath,
  })));
}

function stateRootName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

async function expectExactRootSet(roots: readonly PrivatePythonLinuxRootMember[]): Promise<void> {
  for (const root of roots) {
    const information = await lstat(root.rootPath, { bigint: true });
    expect(information.isSymbolicLink()).toBe(true);
    expect(information.uid).toBe(BigInt(process.geteuid!()));
    expect(await readlink(root.rootPath)).toBe(root.storePath);
  }
}

interface FakeNixEffect {
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: readonly string[];
  readonly rootPath: string;
  readonly storePath: string;
}

async function readFakeEffects(path: string): Promise<readonly FakeNixEffect[]> {
  const source = await readFile(path, "utf8");
  if (source === "") return Object.freeze([]);
  if (!source.endsWith("\n")) throw new Error("fake Nix log is not newline-terminated");
  return Object.freeze(source.slice(0, -1).split("\n").map((line) => (
    Object.freeze(JSON.parse(line) as FakeNixEffect)
  )));
}

function expectFakeNixPosture(effects: readonly FakeNixEffect[]): void {
  expect(effects.length).toBeGreaterThan(0);
  for (const effect of effects) {
    expect(effect.cwd).toBe("/");
    expect(effect.environment).toEqual([]);
    expect(effect.arguments).toEqual([
      "--store", "daemon",
      "--option", "substitute", "false",
      "--option", "fallback", "false",
      "--add-root", effect.rootPath,
      "--indirect",
      "-r", effect.storePath,
    ]);
  }
}

async function expectSqliteState(stateRoot: string, digest: string): Promise<void> {
  const path = join(stateRoot, DATABASE_NAME);
  const information = await lstat(path, { bigint: true });
  expect(information.isFile()).toBe(true);
  expect(information.uid).toBe(BigInt(process.geteuid!()));
  expect(information.nlink).toBe(1n);
  expect(information.mode & 0o7777n).toBe(0o600n);
  const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
  const database = sqlite.Database.open(
    path,
    sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
  );
  try {
    const one = (sql: string): Record<string, unknown> => database.query(sql).safeIntegers(true).get();
    expect(one("PRAGMA application_id").application_id).toBe(0x4a485231n);
    expect(one("PRAGMA user_version").user_version).toBe(1n);
    expect(one("PRAGMA journal_mode").journal_mode).toBe("delete");
    expect(one("SELECT generation_digest FROM generation WHERE singleton = 1").generation_digest).toBe(digest);
    expect(one("SELECT sql FROM sqlite_schema WHERE name = 'generation'").sql).toBe(EXPECTED_SCHEMA);
  } finally {
    database.close(true);
  }
  expect((await readdir(stateRoot)).some((name) => name.endsWith("-wal") || name.endsWith("-shm"))).toBe(false);
  const journal = `${path}-journal`;
  if (await exists(journal)) {
    const information = await lstat(journal, { bigint: true });
    expect(information.isFile()).toBe(true);
    expect(information.uid).toBe(BigInt(process.geteuid!()));
    expect(information.nlink).toBe(1n);
    expect(information.mode & 0o7777n).toBe(0o600n);
  }
}

function readStoredDigest(stateRoot: string): string {
  const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
  const database = sqlite.Database.open(
    join(stateRoot, DATABASE_NAME),
    sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
  );
  try {
    return database.query("SELECT generation_digest FROM generation WHERE singleton = 1").get().generation_digest;
  } finally {
    database.close(true);
  }
}

function storedGenerationIfPresent(
  stateRoot: string,
  candidates: readonly PrivatePythonLinuxHostGeneration[],
): PrivatePythonLinuxHostGeneration | undefined {
  try {
    const digest = readStoredDigest(stateRoot);
    return candidates.find((candidate) => candidate.digest === digest);
  } catch {
    return undefined;
  }
}

async function freshProcessConverge(
  stateRoot: string,
  digest: string,
): Promise<{ admissible: false; digest: string; generationDigest: string; roots: number }> {
  const module = pathToFileURL(resolve(import.meta.dir, "../src/internal/python-linux-host-generation-roots.ts")).href;
  const source = `
const roots = await import(${JSON.stringify(module)});
const result = await roots.convergePrivatePythonLinuxRoots({
  stateRoot: ${JSON.stringify(stateRoot)},
  expectedDigest: ${JSON.stringify(digest)},
});
roots.requirePrivatePythonLinuxRootConvergence(result);
process.stdout.write(JSON.stringify({
  admissible: result.admissible,
  digest: result.digest,
  generationDigest: result.generationDigest,
  roots: result.roots.length,
}) + "\\n");
`;
  const result = await invoke(await realpath("/bin/bun"), [
    "--no-env-file",
    "--no-install",
    "--config=/dev/null",
    "--eval",
    source,
  ], "bun");
  if (result.code !== 0) throw new Error(`fresh root converger failed: ${result.stderr}`);
  return JSON.parse(result.stdout) as { admissible: false; digest: string; generationDigest: string; roots: number };
}

function convergenceWorkerSource(stateRoot: string, digest: string): string {
  const module = pathToFileURL(resolve(
    import.meta.dir,
    "../src/internal/python-linux-host-generation-roots.ts",
  )).href;
  return `
const roots = await import(${JSON.stringify(module)});
await roots.convergePrivatePythonLinuxRoots({
  stateRoot: ${JSON.stringify(stateRoot)},
  expectedDigest: ${JSON.stringify(digest)},
});
`;
}

function spawnSubreaper(
  python: string,
  bun: string,
  workerSource: string,
): ReturnType<typeof spawn> {
  const source = `
import ctypes
import os
import subprocess
import sys

PR_SET_CHILD_SUBREAPER = 36
if ctypes.CDLL(None, use_errno=True).prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "prctl(PR_SET_CHILD_SUBREAPER) failed")

child = subprocess.Popen(
    [${JSON.stringify(bun)}, "--no-env-file", "--no-install", "--config=/dev/null", "--eval", ${JSON.stringify(workerSource)}],
    cwd="/",
    env={},
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
print(child.pid, flush=True)
child.wait()
while True:
    try:
        os.wait()
    except ChildProcessError:
        break
sys.exit(0)
`;
  return spawn(python, ["-I", "-c", source], {
    argv0: "python3",
    cwd: "/",
    env: Object.create(null) as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

async function firstLine(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise<string>((resolveLine, rejectLine) => {
    let source = "";
    const timer = setTimeout(() => finish(new Error("subreaper did not publish its child PID")), 5_000);
    const onData = (chunk: Buffer | string): void => {
      source += chunk.toString();
      if (source.length > 4_096) return finish(new Error("subreaper PID output exceeded its bound"));
      const newline = source.indexOf("\n");
      if (newline >= 0) finish(undefined, source.slice(0, newline));
    };
    const onError = (error: Error): void => finish(error);
    const onEnd = (): void => finish(new Error("subreaper ended before publishing its child PID"));
    const finish = (error?: Error, line?: string): void => {
      clearTimeout(timer);
      stream.removeListener("data", onData);
      stream.removeListener("error", onError);
      stream.removeListener("end", onEnd);
      if (error !== undefined) rejectLine(error);
      else resolveLine(line!);
    };
    stream.on("data", onData);
    stream.once("error", onError);
    stream.once("end", onEnd);
  });
}

async function waitForPath(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!await exists(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await Bun.sleep(5);
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (hasCode(error, "ESRCH")) return false;
    throw error;
  }
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (processAlive(pid)) {
    if (Date.now() >= deadline) throw new Error(`process ${pid} did not exit`);
    await Bun.sleep(5);
  }
}

async function waitForEffectCount(path: string, expected: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while ((await readFakeEffects(path)).length < expected) {
    if (Date.now() >= deadline) throw new Error(`fake Nix log did not reach ${expected} effects`);
    await Bun.sleep(5);
  }
}

async function waitForChild(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Object.freeze({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolveChild, rejectChild) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* close remains the completion fence */ }
    }, timeoutMs);
    const onError = (error: Error): void => {
      clearTimeout(timer);
      rejectChild(error);
    };
    child.once("error", onError);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      child.removeListener("error", onError);
      if (timedOut) rejectChild(new Error("subreaper exceeded its deadline"));
      else resolveChild(Object.freeze({ code, signal }));
    });
  });
}

async function unlinkOwnedFixtureFile(path: string): Promise<void> {
  let information;
  try {
    information = await lstat(path, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
  if (!information.isFile() || information.uid !== BigInt(process.geteuid!()) ||
      information.nlink !== 1n || (information.mode & 0o7777n) !== 0o600n) {
    throw new Error(`refusing to remove mismatched test fixture ${path}`);
  }
  await unlink(path);
  await syncDirectory(dirname(path));
}

async function databaseSnapshot(stateRoot: string): Promise<Readonly<Record<string, string>>> {
  const information = await lstat(join(stateRoot, DATABASE_NAME), { bigint: true });
  return Object.freeze({
    dev: information.dev.toString(),
    ino: information.ino.toString(),
    mode: information.mode.toString(),
    size: information.size.toString(),
    mtimeNs: information.mtimeNs.toString(),
    ctimeNs: information.ctimeNs.toString(),
  });
}

async function cleanupStateRoot(
  stateRoot: string,
  generation: PrivatePythonLinuxHostGeneration,
  live: Set<string>,
): Promise<void> {
  const roots = expectedRoots(stateRoot, generation);
  const generationPath = dirname(roots[0]!.rootPath);
  const collection = dirname(generationPath);
  if (await exists(generationPath)) {
    const names = (await readdir(generationPath)).sort();
    for (const [index, root] of roots.entries()) {
      const name = `member-${index.toString().padStart(4, "0")}`;
      if (!names.includes(name)) continue;
      const information = await lstat(root.rootPath, { bigint: true });
      if (!information.isSymbolicLink() || information.uid !== BigInt(process.geteuid!()) ||
          await readlink(root.rootPath) !== root.storePath) {
        throw new Error(`refusing to remove mismatched test root ${root.rootPath}`);
      }
      await unlink(root.rootPath);
      await syncDirectory(generationPath);
    }
    if ((await readdir(generationPath)).length !== 0) throw new Error("test generation has unknown residue");
    await rmdir(generationPath);
  }
  if (await exists(collection)) {
    if ((await readdir(collection)).length !== 0) throw new Error("test root collection has unknown residue");
    await rmdir(collection);
  }
  for (const name of [`${DATABASE_NAME}-journal`, DATABASE_NAME]) {
    const path = join(stateRoot, name);
    if (!await exists(path)) continue;
    const information = await lstat(path, { bigint: true });
    if (!information.isFile() || information.uid !== BigInt(process.geteuid!()) ||
        information.nlink !== 1n || (information.mode & 0o7777n) !== 0o600n) {
      throw new Error(`refusing to remove mismatched test database state ${path}`);
    }
    await unlink(path);
    await syncDirectory(stateRoot);
  }
  if ((await readdir(stateRoot)).length !== 0) throw new Error("test state root has unknown residue");
  await rmdir(stateRoot);
  live.delete(stateRoot);
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function testStateDirectories(parent: string): Promise<readonly string[]> {
  return (await readdir(parent)).filter((name) => name.startsWith(STATE_PREFIX)).sort();
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

async function expectCheckErrorAsync(
  action: () => Promise<unknown>,
  codes: readonly string[],
): Promise<void> {
  try {
    await action();
    throw new Error("expected CheckError");
  } catch (error) {
    expectCheckError(error, codes);
  }
}

function expectCheckError(error: unknown, codes: readonly string[]): void {
  expect(error).toBeInstanceOf(CheckError);
  expect(codes).toContain((error as CheckError).code);
}

async function invoke(
  executable: string,
  arguments_: readonly string[],
  argv0: string,
): Promise<{ readonly code: number | null; readonly signal: string | null; readonly stdout: string; readonly stderr: string }> {
  const child = spawn(executable, [...arguments_], {
    argv0,
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
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* group may already be gone */ }
    }
    try { child.kill("SIGKILL"); } catch { /* close is the completion fence */ }
  };
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes <= MAX_PROBE_OUTPUT_BYTES) stdoutChunks.push(Buffer.from(chunk));
    else terminate();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes <= MAX_PROBE_OUTPUT_BYTES) stderrChunks.push(Buffer.from(chunk));
    else terminate();
  });
  const close = await new Promise<{ readonly code: number | null; readonly signal: string | null }>((accept, reject) => {
    const timer = setTimeout(() => { timedOut = true; terminate(); }, PROBE_TIMEOUT_MS);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => { clearTimeout(timer); accept({ code, signal }); });
  });
  if (stdoutBytes > MAX_PROBE_OUTPUT_BYTES || stderrBytes > MAX_PROBE_OUTPUT_BYTES) {
    throw new Error("host-root probe exceeded its output limit");
  }
  if (timedOut) throw new Error("host-root probe exceeded its deadline");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return Object.freeze({
    ...close,
    stdout: decoder.decode(Buffer.concat(stdoutChunks, stdoutBytes)),
    stderr: decoder.decode(Buffer.concat(stderrChunks, stderrBytes)),
  });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`missing test environment ${name}`);
  return value;
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { readonly code?: unknown }).code === code;
}
