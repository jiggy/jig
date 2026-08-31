import { describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openPrivateInstalledBunSupport,
  requirePrivateInstalledBunSupport,
  revalidatePrivateInstalledBunSupport,
} from "../src/internal/installed-bun-support.js";

describe("fixed installed Bun support", () => {
  test("authenticates the fixed adjacent layout and detects drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-installed-support-"));
    const executable = join(root, "bin", "jig");
    const evaluator = join(root, "libexec", "evaluator");
    try {
      await mkdir(join(root, "bin"), { recursive: true });
      await mkdir(evaluator, { recursive: true });
      await copyFile(process.execPath, executable);
      await writeFile(join(root, "libexec", "linux-rootless-supervisor.js"), "supervisor\n");
      await writeFile(join(evaluator, "project-evaluator-worker.js"), "worker\n");
      await writeFile(join(evaluator, "project-evaluator-sdk.bundle.js"), "sdk\n");
      await writeFile(join(evaluator, "project-authoring-1.schema.json"), "{}\n");

      const support = await openPrivateInstalledBunSupport(executable);
      expect(requirePrivateInstalledBunSupport(support)).toBe(support);
      expect(() => requirePrivateInstalledBunSupport(Object.freeze({ ...support }))).toThrow(
        "installed Bun support was not produced by the fixed host factory",
      );
      expect((await openPrivateInstalledBunSupport(executable)).digest).toBe(support.digest);
      expect(support.sandboxExecutablePath).toBe("/jig-runtime/jig");
      expect(support.runtimeMounts.map(({ destination }) => destination)).toEqual([
        "/jig-runtime/jig",
        "/lib64/ld-linux-x86-64.so.2",
        "/jig-runtime/lib/libc.so.6",
        "/jig-runtime/lib/libm.so.6",
        "/jig-runtime/lib/libdl.so.2",
        "/jig-runtime/lib/libpthread.so.0",
      ]);
      await expect(revalidatePrivateInstalledBunSupport(support)).resolves.toBeUndefined();

      await writeFile(join(evaluator, "project-evaluator-worker.js"), "changed\n");
      await expect(revalidatePrivateInstalledBunSupport(support)).rejects.toThrow(
        "installed Bun support changed after selection",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
