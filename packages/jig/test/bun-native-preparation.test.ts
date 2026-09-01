import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  preparePrivateBunPackage,
  recoverPrivateBunPreparationOwner,
} from "../src/internal/bun-native-preparation.js";
import {
  initializePrivateActivationState,
  openPrivateProjectCoordinator,
  readPrivateBunPreparationOwner,
} from "../src/internal/activation-admission-store.js";
import { openPrivateInstalledBunHost } from "../src/internal/installed-bun-host.js";
import { PrivateLinuxFenceUnconfirmedError } from "../src/internal/linux-rootless-backend.js";
import { capturePackageDirectory } from "../src/package/capture.js";

const HOSTILE = process.env.JIG_LINUX_ROOTLESS_HOSTILE === "1";
const proofDescribe = HOSTILE ? describe.serial : describe.skip;
const executable = join(import.meta.dir, "..", "bin", "jig");

proofDescribe("private contained Bun dependency preparation", () => {
  test("prepares one frozen transitive graph without lifecycle scripts or residue", async () => {
    const initialTemporary = new Set((await readdir(tmpdir())).filter(rootlessTemporaryEntry));
    const initialCgroups = new Set(await rootlessCgroups());
    const root = await fixture();
    try {
      const captured = await capturePackageDirectory(root);
      try {
        await initializePrivateActivationState({ projectRoot: root });
        const coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
        try {
        const host = await openPrivateInstalledBunHost(executable);
        const first = await preparePrivateBunPackage({
          captured,
          installedSupport: host.installedBunSupport,
          backend: host.backend,
          projectRoot: root,
          coordinator,
        });
        try {
          expect(first.files.some(({ path }) => path === "node_modules/is-number/index.js")).toBeTrue();
          expect(first.files.some(({ path }) => path === "node_modules/is-odd/index.js")).toBeTrue();
          expect(first.files.some(({ path }) => path === "node_modules/zod/index.js")).toBeTrue();
          expect(first.files.some(({ path }) => path === "postinstall-ran")).toBeFalse();
          expect(first.files.some(({ path }) => path.includes("/.bin/"))).toBeFalse();
          expect(new TextDecoder().decode(await first.read("flow.ts"))).toContain('from "is-odd"');

          const second = await preparePrivateBunPackage({
            captured,
            installedSupport: host.installedBunSupport,
            backend: host.backend,
            projectRoot: root,
            coordinator,
          });
          try {
            expect(second.digest).toBe(first.digest);
          } finally {
            await second.dispose();
          }
        } finally {
          await first.dispose();
        }
        } finally {
          await coordinator.dispose();
        }
      } finally {
        await captured.dispose();
      }
      await waitForCgroups(initialCgroups);
      await waitForTemporary(initialTemporary);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  test("rejects non-registry lock sources before granting network", async () => {
    const root = await fixture();
    try {
      await writeFile(join(root, "bun.lock"), `${JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { dependencies: { local: "file:../local" } } },
        packages: { local: ["local@file:../local", {}] },
      }, null, 2)}\n`);
      const captured = await capturePackageDirectory(root);
      try {
        await initializePrivateActivationState({ projectRoot: root });
        const coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
        try {
        const host = await openPrivateInstalledBunHost(executable);
        await expect(preparePrivateBunPackage({
          captured,
          installedSupport: host.installedBunSupport,
          backend: host.backend,
          projectRoot: root,
          coordinator,
        })).rejects.toMatchObject({
          code: "PACKAGE_BUN_SOURCE_UNSUPPORTED",
          path: "bun.lock",
        });
        } finally {
          await coordinator.dispose();
        }
      } finally {
        await captured.dispose();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("recovers an active preparation after its coordinator is killed", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "jig-bun-preparation-project-"));
    const packageRoot = await fixture();
    const initialTemporary = new Set((await readdir(tmpdir())).filter(rootlessTemporaryEntry));
    const initialCgroups = new Set(await rootlessCgroups());
    try {
      await initializePrivateActivationState({ projectRoot });
      const helper = spawn(process.execPath, [
        "--no-env-file",
        "--no-install",
        "--config=/dev/null",
        join(import.meta.dir, "fixtures", "bun-preparation-coordinator.ts"),
        projectRoot,
        packageRoot,
        executable,
      ], {
        cwd: "/",
        env: { ...process.env, BUN_BE_BUN: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const closed = childClose(helper);
      const diagnostics = collectChild(helper.stderr);
      await Promise.race([
        waitForActivePreparation(projectRoot),
        closed.then(async (exit) => {
          throw new Error(`preparation helper exited before activation (${exit.code ?? exit.signal}): ${await diagnostics}`);
        }),
      ]);
      helper.kill("SIGKILL");
      const exit = await closed;
      expect(exit.signal).toBe("SIGKILL");

      const host = await openPrivateInstalledBunHost(executable);
      const coordinator = await openPrivateProjectCoordinator({ projectRoot });
      try {
        await recoverEventually({
          projectRoot,
          coordinator,
          backend: host.backend,
        });
        expect(await readPrivateBunPreparationOwner({ projectRoot, coordinator })).toBeNull();
        const captured = await capturePackageDirectory(packageRoot);
        try {
          const prepared = await preparePrivateBunPackage({
            captured,
            installedSupport: host.installedBunSupport,
            backend: host.backend,
            projectRoot,
            coordinator,
          });
          await prepared.dispose();
        } finally {
          await captured.dispose();
        }
      } finally {
        await coordinator.dispose();
      }
      await waitForCgroups(initialCgroups);
      await waitForTemporary(initialTemporary);
      expect(await readdir(join(projectRoot, ".jig", "private-preparation-linux-owners"))).toEqual([]);
    } finally {
      await Promise.all([
        rm(projectRoot, { recursive: true, force: true }),
        rm(packageRoot, { recursive: true, force: true }),
      ]);
    }
  }, 120_000);
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "jig-bun-preparation-"));
  await writeFile(join(root, "FLOW.md"), [
    "---",
    "name: native-dependency-fixture",
    "description: Exercises contained Bun dependency preparation.",
    "---",
    "",
  ].join("\n"));
  await writeFile(join(root, "flow.ts"), [
    'import isOdd from "is-odd";',
    'import { z } from "zod";',
    "export const result = { odd: isOdd(3), parsed: z.string().parse('ok') };",
    "",
  ].join("\n"));
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "jig-native-preparation-fixture",
    private: true,
    scripts: { postinstall: "touch postinstall-ran" },
    dependencies: { "is-odd": "3.0.1", zod: "4.1.5" },
  }, null, 2)}\n`);
  await writeFile(join(root, "bun.lock"), `{
  "lockfileVersion": 1,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "jig-native-preparation-fixture",
      "dependencies": {
        "is-odd": "3.0.1",
        "zod": "4.1.5",
      },
    },
  },
  "packages": {
    "is-number": ["is-number@6.0.0", "", {}, "sha512-Wu1VHeILBK8KAWJUAiSZQX94GmOE45Rg6/538fKwiloUu21KncEkYGPqob2oSZ5mUT73vLGrHQjKw3KMPwfDzg=="],
    "is-odd": ["is-odd@3.0.1", "", { "dependencies": { "is-number": "^6.0.0" } }, "sha512-CQpnWPrDwmP1+SMHXZhtLtJv90yiyVfluGsX5iNCVkrhQtU3TQHsUWPG9wkdk9Lgd5yNpAg9jQEo90CBaXgWMA=="],
    "zod": ["zod@4.1.5", "", {}, "sha512-rcUUZqlLJgBC33IT3PNMgsCq6TzLQEG/Ei/KTCU0PedSWRMAXoOUN+4t/0H+Q8bdnLPdqUYnvboJT0bn/229qg=="],
  },
}\n`);
  return root;
}

function rootlessTemporaryEntry(name: string): boolean {
  return name.startsWith("jig-rootless-control-") || name.startsWith("jig-rootless-owner-") ||
    name.startsWith("jig-rootless-devices-");
}

async function waitForActivePreparation(projectRoot: string): Promise<void> {
  const parent = join(projectRoot, ".jig", "private-preparation-linux-owners");
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try {
      for (const name of await readdir(parent)) {
        try {
          const claim = JSON.parse(await readFile(join(parent, name, "claim.json"), "utf8"));
          const owner = JSON.parse(await readFile(join(parent, name, "owner.json"), "utf8"));
          if (claim.state === "active" && typeof owner.runCgroup === "string") {
            const events = await readFile(join(owner.runCgroup, "cgroup.events"), "utf8");
            if (/^populated 1$/m.test(events)) return;
          }
        } catch {
          // The exact claim, cgroup, or admitted payload may not exist yet.
        }
      }
    } catch {
      // The protected owner parent may not have been created yet.
    }
    await Bun.sleep(10);
  }
  throw new Error("preparation did not reach active ownership");
}

function childClose(child: ReturnType<typeof spawn>): Promise<{
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function collectChild(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (stream === null) return "";
  let result = "";
  for await (const chunk of stream) {
    result += String(chunk);
    if (Buffer.byteLength(result) > 16 * 1024) return "diagnostic limit exceeded";
  }
  return result;
}

async function recoverEventually(
  input: Parameters<typeof recoverPrivateBunPreparationOwner>[0],
): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      await recoverPrivateBunPreparationOwner(input);
      return;
    } catch (error) {
      if (!(error instanceof PrivateLinuxFenceUnconfirmedError)) throw error;
    }
    await Bun.sleep(25);
  }
  const ownerParent = join(input.projectRoot, ".jig", "private-preparation-linux-owners");
  const owners = await readdir(ownerParent).catch(() => []);
  const evidence = await Promise.all(owners.map(async (name) => ({
    name,
    entries: await readdir(join(ownerParent, name)).catch(() => []),
  })));
  throw new Error(`preparation cleanup owner did not publish its fence: ${JSON.stringify(evidence)}`);
}

async function rootlessCgroups(): Promise<readonly string[]> {
  const configured = process.env.JIG_ROOTLESS_CGROUP;
  if (configured === undefined) return [];
  try {
    return (await readdir(configured)).filter((name) => name.startsWith("jig-run-"));
  } catch {
    return [];
  }
}

async function waitForCgroups(initial: ReadonlySet<string>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await rootlessCgroups()).every((name) => initial.has(name))) return;
    await Bun.sleep(25);
  }
  throw new Error("contained preparation left a rootless cgroup");
}

async function waitForTemporary(initial: ReadonlySet<string>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = (await readdir(tmpdir())).filter(rootlessTemporaryEntry);
    if (current.every((name) => initial.has(name))) return;
    await Bun.sleep(25);
  }
  throw new Error("contained preparation left rootless temporary state");
}
