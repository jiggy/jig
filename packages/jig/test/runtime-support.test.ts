import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  observePrivateRuntimeSupport,
  requirePrivateRuntimeSupportObservation,
} from "../src/internal/runtime-support.js";

describe("private runtime support", () => {
  test("observes one exact executable on a read-only host mount", async () => {
    const executablePath = await immutableExecutable();
    const observation = await observePrivateRuntimeSupport({
      supportId: "test-coreutils",
      executablePath,
      closureSources: [executablePath],
    });

    expect(observation).toMatchObject({
      kind: "runtime-support-observation/1",
      supportId: "test-coreutils",
      executablePath,
      closureSources: [executablePath],
    });
    expect(observation.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(observation.executableDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.isFrozen(observation)).toBe(true);
    expect(Object.isFrozen(observation.closureSources)).toBe(true);
    expect(requirePrivateRuntimeSupportObservation(observation)).toBe(observation);
  });

  test("rejects duplicate support sources", async () => {
    const executablePath = await immutableExecutable();

    await expect(observePrivateRuntimeSupport({
      supportId: "test-duplicates",
      executablePath,
      closureSources: [executablePath, executablePath],
    })).rejects.toThrow("runtime support contains duplicate sources");
  });

  test("rejects noncanonical executable and source paths", async () => {
    const executablePath = await immutableExecutable();

    await expect(observePrivateRuntimeSupport({
      supportId: "test-executable-alias",
      executablePath: "/bin/true",
      closureSources: [executablePath],
    })).rejects.toThrow("runtime executable must be canonical");

    await expect(observePrivateRuntimeSupport({
      supportId: "test-source-alias",
      executablePath,
      closureSources: ["/bin/true"],
    })).rejects.toThrow("runtime support source must be canonical");
  });

  test("rejects an executable outside the retained support set", async () => {
    const executablePath = await immutableExecutable();
    const unrelatedSource = await realpath("/usr/bin/bwrap");

    await expect(observePrivateRuntimeSupport({
      supportId: "test-outside",
      executablePath,
      closureSources: [unrelatedSource],
    })).rejects.toThrow("runtime executable is outside the retained support set");
  });

  test("rejects support covered only by a mutable host mount", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jig-runtime-support-"));
    const executablePath = join(directory, "runtime");
    try {
      await writeFile(executablePath, "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(executablePath, 0o755);

      await expect(observePrivateRuntimeSupport({
        supportId: "test-mutable",
        executablePath,
        closureSources: [executablePath],
      })).rejects.toThrow("runtime support is not covered by a read-only host mount");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects frozen lookalikes which lack observer authenticity", async () => {
    const executablePath = await immutableExecutable();
    const observation = await observePrivateRuntimeSupport({
      supportId: "test-authenticity",
      executablePath,
      closureSources: [executablePath],
    });
    const lookalike = Object.freeze({ ...observation });

    expect(() => requirePrivateRuntimeSupportObservation(lookalike)).toThrow(
      "runtime support was not produced by the private host observer",
    );
    expect(requirePrivateRuntimeSupportObservation(observation)).toBe(observation);
  });
});

async function immutableExecutable(): Promise<string> {
  return await realpath("/bin/true");
}
