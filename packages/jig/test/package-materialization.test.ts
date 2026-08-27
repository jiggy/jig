import { describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  allocatePrivatePackageMaterialization,
  disposePrivatePackageMaterializationLease,
  materializeCapturedPackage,
  materializePrivatePackageLease,
  reacquirePrivatePackageMaterializationLease,
  recoverPrivatePackageMaterializationAllocation,
  type PrivatePackageMaterializationLease,
} from "../src/internal/package-materialization.js";
import { capturePackageDirectory } from "../src/package/capture.js";

const crashFixture = join(import.meta.dir, "fixtures/package-materialization-crash.ts");

describe("private package materialization", () => {
  test("preserves the invocation-local materialization API", async () => {
    const source = await mkdtemp(join(tmpdir(), "jig-materialize-source-"));
    const stagingParent = await mkdtemp(join(tmpdir(), "jig-materialize-parent-"));
    try {
      await writeTree(source, {
        "FLOW.md": "---\nname: exact\ndescription: Exact fixture.\n---\n",
        "flow.ts": "export const captured = 'old';\n",
        "lib/value.ts": "export default 1;\n",
      });
      const captured = await capturePackageDirectory(source);
      try {
        await writeFile(join(source, "flow.ts"), "export const captured = 'new';\n");
        const materialized = await materializeCapturedPackage(captured, stagingParent);
        expect(materialized.packageDigest).toBe(captured.digest);
        expect(await readFile(join(materialized.root, "flow.ts"), "utf8"))
          .toBe("export const captured = 'old';\n");
        expect((await stat(materialized.root)).mode & 0o777).toBe(0o555);
        const first = materialized.dispose();
        expect(materialized.dispose()).toBe(first);
        await first;
        expect(await readdir(stagingParent)).toEqual([]);
      } finally {
        await captured.dispose();
      }
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(stagingParent, { recursive: true, force: true });
    }
  });

  test("allocates with no effect, then reacquires in a fresh process after capture disposal", async () => {
    const source = await mkdtemp(join(tmpdir(), "jig-materialize-source-"));
    const protectedParent = await mkdtemp(join(tmpdir(), "jig-materialize-leases-"));
    try {
      await writeTree(source, durableTree());
      const captured = await capturePackageDirectory(source);
      let lease: PrivatePackageMaterializationLease | undefined;
      let capturedDisposed = false;
      try {
        const allocation = await allocatePrivatePackageMaterialization({
          protectedParent,
          name: "run-fresh-process",
          packageDigest: captured.digest,
          ownerToken: "run:01HZX8JQ2J1M:dispatch:01",
        });
        expect(await readdir(protectedParent)).toEqual([]);
        expect(allocation.path).toBe(join(protectedParent, "run-fresh-process"));
        expect(Object.isFrozen(allocation)).toBe(true);
        expect(Object.isFrozen(allocation.parent)).toBe(true);
        expect((await recoverPrivatePackageMaterializationAllocation(
          protectedParent,
          JSON.parse(JSON.stringify(allocation)),
        )).state).toBe("absent");

        lease = await materializePrivatePackageLease(captured, allocation);
        const serializedIdentity = JSON.stringify(lease.identity);
        expect(Object.isFrozen(lease.identity)).toBe(true);
        expect(Object.isFrozen(lease.identity.allocation)).toBe(true);
        await captured.dispose();
        capturedDisposed = true;
        lease = undefined;

        const child = await runCrashFixture("fresh-reacquire", {
          JIG_TEST_PROTECTED_PARENT: protectedParent,
          JIG_TEST_IDENTITY: serializedIdentity,
        });
        expect(child.exitCode).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual({ value: "nested durable bytes\n" });

        await disposePrivatePackageMaterializationLease(
          protectedParent,
          JSON.parse(serializedIdentity),
        );
        expect(await readdir(protectedParent)).toEqual([]);
      } finally {
        if (!capturedDisposed) await captured.dispose();
        await lease?.dispose().catch(() => undefined);
      }
    } finally {
      await makeFixtureRemovable(protectedParent);
      await rm(source, { recursive: true, force: true });
      await rm(protectedParent, { recursive: true, force: true });
    }
  });

  test("recovers a subprocess crash after mkdir and before open", async () => {
    const source = await mkdtemp(join(tmpdir(), "jig-materialize-source-"));
    const protectedParent = await mkdtemp(join(tmpdir(), "jig-materialize-leases-"));
    try {
      await writeTree(source, durableTree());
      const captured = await capturePackageDirectory(source);
      try {
        const allocation = await allocatePrivatePackageMaterialization({
          protectedParent,
          name: "run-mkdir-crash",
          packageDigest: captured.digest,
          ownerToken: "run:mkdir-crash:dispatch:01",
        });
        const child = await runCrashFixture("mkdir-before-open", {
          JIG_TEST_ALLOCATION: JSON.stringify(allocation),
        });
        expect(child.exitCode).toBe(71);
        expect(await readdir(allocation.path)).toEqual([]);

        const recovered = await recoverPrivatePackageMaterializationAllocation(
          protectedParent,
          JSON.parse(JSON.stringify(allocation)),
        );
        expect(recovered.state).toBe("incomplete-removed");
        expect(await readdir(protectedParent)).toEqual([]);
        expect((await recoverPrivatePackageMaterializationAllocation(
          protectedParent,
          allocation,
        )).state).toBe("absent");
      } finally {
        await captured.dispose();
      }
    } finally {
      await makeFixtureRemovable(protectedParent);
      await rm(source, { recursive: true, force: true });
      await rm(protectedParent, { recursive: true, force: true });
    }
  });

  test("reconstructs a complete lease when its creating subprocess dies before returning it", async () => {
    const source = await mkdtemp(join(tmpdir(), "jig-materialize-source-"));
    const protectedParent = await mkdtemp(join(tmpdir(), "jig-materialize-leases-"));
    try {
      await writeTree(source, durableTree());
      const captured = await capturePackageDirectory(source);
      const allocation = await allocatePrivatePackageMaterialization({
        protectedParent,
        name: "run-complete-crash",
        packageDigest: captured.digest,
        ownerToken: "run:complete-crash:dispatch:01",
      });
      await captured.dispose();

      const child = await runCrashFixture("complete-without-identity", {
        JIG_TEST_ALLOCATION: JSON.stringify(allocation),
        JIG_TEST_SOURCE: source,
      });
      expect(child.exitCode).toBe(72);
      const recovered = await recoverPrivatePackageMaterializationAllocation(
        protectedParent,
        JSON.parse(JSON.stringify(allocation)),
      );
      expect(recovered.state).toBe("complete");
      if (recovered.state !== "complete") throw new Error("expected a complete lease");
      expect(await readFile(join(recovered.lease.root, "nested/value.txt"), "utf8"))
        .toBe("nested durable bytes\n");
      await recovered.lease.dispose();
      expect(await readdir(protectedParent)).toEqual([]);
    } finally {
      await makeFixtureRemovable(protectedParent);
      await rm(source, { recursive: true, force: true });
      await rm(protectedParent, { recursive: true, force: true });
    }
  });

  test("resumes nested disposal interrupted in a subprocess", async () => {
    const source = await mkdtemp(join(tmpdir(), "jig-materialize-source-"));
    const protectedParent = await mkdtemp(join(tmpdir(), "jig-materialize-leases-"));
    try {
      await writeTree(source, durableTree());
      const captured = await capturePackageDirectory(source);
      const allocation = await allocatePrivatePackageMaterialization({
        protectedParent,
        name: "run-dispose-crash",
        packageDigest: captured.digest,
        ownerToken: "run:dispose-crash:dispatch:01",
      });
      const lease = await materializePrivatePackageLease(captured, allocation);
      const serializedIdentity = JSON.stringify(lease.identity);
      await captured.dispose();

      const child = await runCrashFixture("interrupt-nested-disposal", {
        JIG_TEST_IDENTITY: serializedIdentity,
      });
      expect(child.exitCode).toBe(73);
      expect((await stat(join(allocation.path, "package.disposing"))).isDirectory()).toBe(true);

      await disposePrivatePackageMaterializationLease(
        protectedParent,
        JSON.parse(serializedIdentity),
      );
      await disposePrivatePackageMaterializationLease(
        protectedParent,
        JSON.parse(serializedIdentity),
      );
      expect(await readdir(protectedParent)).toEqual([]);
    } finally {
      await makeFixtureRemovable(protectedParent);
      await rm(source, { recursive: true, force: true });
      await rm(protectedParent, { recursive: true, force: true });
    }
  });

  test("does not remove unexpected, symlink, or wrong-kind allocation leaves", async () => {
    const source = await mkdtemp(join(tmpdir(), "jig-materialize-source-"));
    const protectedParent = await mkdtemp(join(tmpdir(), "jig-materialize-leases-"));
    try {
      await writeTree(source, durableTree());
      const captured = await capturePackageDirectory(source);
      try {
        const unexpected = await allocatePrivatePackageMaterialization({
          protectedParent,
          name: "run-unexpected",
          packageDigest: captured.digest,
          ownerToken: "run:unexpected:dispatch:01",
        });
        await mkdir(unexpected.path, { mode: 0o700 });
        await writeFile(join(unexpected.path, "sentinel"), "retain\n");
        await expect(recoverPrivatePackageMaterializationAllocation(
          protectedParent,
          unexpected,
        )).rejects.toThrow("unexpected entry");
        expect(await readFile(join(unexpected.path, "sentinel"), "utf8")).toBe("retain\n");

        const wrongKind = await allocatePrivatePackageMaterialization({
          protectedParent,
          name: "run-file",
          packageDigest: captured.digest,
          ownerToken: "run:wrong-kind:dispatch:01",
        });
        await writeFile(wrongKind.path, "retain file\n");
        await expect(recoverPrivatePackageMaterializationAllocation(
          protectedParent,
          wrongKind,
        )).rejects.toThrow("real directory");
        expect(await readFile(wrongKind.path, "utf8")).toBe("retain file\n");

        const symlinked = await allocatePrivatePackageMaterialization({
          protectedParent,
          name: "run-symlink",
          packageDigest: captured.digest,
          ownerToken: "run:symlink:dispatch:01",
        });
        const victim = join(protectedParent, "victim");
        await mkdir(victim, { mode: 0o700 });
        await writeFile(join(victim, "sentinel"), "victim remains\n");
        await symlink(victim, symlinked.path);
        await expect(recoverPrivatePackageMaterializationAllocation(
          protectedParent,
          symlinked,
        )).rejects.toThrow("real directory");
        expect(await readFile(join(victim, "sentinel"), "utf8")).toBe("victim remains\n");
      } finally {
        await captured.dispose();
      }
    } finally {
      await makeFixtureRemovable(protectedParent);
      await rm(source, { recursive: true, force: true });
      await rm(protectedParent, { recursive: true, force: true });
    }
  });

  test("requires canonical allocation inputs and a meaningful owner token", async () => {
    const protectedParent = await mkdtemp(join(tmpdir(), "jig-materialize-leases-"));
    const digest = `sha256:${"0".repeat(64)}`;
    try {
      await expect(allocatePrivatePackageMaterialization({
        protectedParent: "relative",
        name: "run-relative",
        packageDigest: digest,
        ownerToken: "run:relative:owner",
      })).rejects.toThrow("canonical absolute path");
      await expect(allocatePrivatePackageMaterialization({
        protectedParent,
        name: "../escape",
        packageDigest: digest,
        ownerToken: "run:escape:owner",
      })).rejects.toThrow("strict ASCII leaf");
      await expect(allocatePrivatePackageMaterialization({
        protectedParent,
        name: "run-token",
        packageDigest: digest,
        ownerToken: "placeholder",
      })).rejects.toThrow("16-256");
      await chmod(protectedParent, 0o770);
      await expect(allocatePrivatePackageMaterialization({
        protectedParent,
        name: "run-unprotected",
        packageDigest: digest,
        ownerToken: "run:unprotected:owner",
      })).rejects.toThrow("mode 0700");
    } finally {
      await chmod(protectedParent, 0o700).catch(() => undefined);
      await rm(protectedParent, { recursive: true, force: true });
    }
  });
});

function durableTree(): Readonly<Record<string, string>> {
  return {
    "FLOW.md": "---\nname: durable\ndescription: Durable fixture.\n---\n",
    "flow.ts": "export default 'durable';\n",
    "nested/value.txt": "nested durable bytes\n",
    "nested/removed/value.txt": "removed before crash\n",
    "nested/remaining/value.txt": "retained until recovery\n",
  };
}

async function runCrashFixture(
  mode: string,
  environment: Readonly<Record<string, string>>,
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const child = Bun.spawn([process.execPath, "run", crashFixture], {
    env: { ...process.env, ...environment, JIG_TEST_MODE: mode },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

async function makeFixtureRemovable(root: string): Promise<void> {
  async function walk(path: string): Promise<void> {
    const information = await stat(path).catch(() => undefined);
    if (information === undefined || !information.isDirectory()) return;
    await chmod(path, 0o700).catch(() => undefined);
    for (const name of await readdir(path).catch(() => [])) await walk(join(path, name));
  }
  await walk(root);
}
