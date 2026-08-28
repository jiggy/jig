import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  observeAgentSandboxRuntimeSupport,
  type PrivateRuntimeSupportObservation,
} from "../src/internal/agent-sandbox-runtime-support.js";
import { PrivateLinuxCgroupBackend } from "../src/internal/linux-cgroup-backend.js";
import type { PrivateProjectSessionHost } from "../src/internal/project-session-controller.js";

const RUN_TIMEOUT_MS = 60_000;

/** Construct the current agent-sandbox proof fixture, never portable host policy. */
export async function openAgentSandboxProofHost(): Promise<PrivateProjectSessionHost> {
  const receiptsDirectory = process.env.AGENT_RUNTIME_RECEIPTS_DIR;
  const expectedLeaseId = process.env.AGENT_RUNTIME_LEASE_ID;
  if (receiptsDirectory === undefined || expectedLeaseId === undefined) {
    throw new Error("proof host did not expose its runtime lease receipt");
  }
  const bunPath = await realpath("/bin/bun");
  const bun = await observeAgentSandboxRuntimeSupport({
    receiptsDirectory,
    expectedLeaseId,
    executablePath: bunPath,
  });
  const python = await proofHostPython(receiptsDirectory, expectedLeaseId);

  const relativeCgroup = (await readFile("/proc/self/cgroup", "utf8"))
    .trim()
    .split(":")
    .at(-1);
  if (relativeCgroup === undefined) throw new Error("proof host cgroup membership is unavailable");
  const selfCgroup = await realpath(`/sys/fs/cgroup${relativeCgroup}`);
  const shellWrapper = await realpath("/bin/sh");
  const shebang = (await readFile(shellWrapper, "utf8")).split("\n", 1)[0];
  if (shebang === undefined || !shebang.startsWith("#!/")) {
    throw new Error("proof host Bash shebang is unavailable");
  }
  return Object.freeze({
    backend: new PrivateLinuxCgroupBackend({
      cgroupScope: dirname(selfCgroup),
      sudoPath: "/agent-sudo/bin/sudo",
      subreaperPath: "/run/podman-init",
      mknodPath: "/bin/mknod",
      bunPath,
      bubblewrapPath: "/usr/bin/bwrap",
      bashPath: shebang.slice(2),
      payloadUid: 1000,
      payloadGid: 100,
    }),
    bunRuntimeSupport: bun,
    directRuntimeSupport: Object.freeze({ bun, python }),
    jigDistributionPath: await realpath(join(import.meta.dir, "..", "dist")),
    runTimeoutMs: RUN_TIMEOUT_MS,
  });
}

async function proofHostPython(
  receiptsDirectory: string,
  expectedLeaseId: string,
): Promise<PrivateRuntimeSupportObservation> {
  const candidates: Array<{ receiptName: string; executablePath: string }> = [];
  for (const receiptName of (await readdir(receiptsDirectory)).sort()) {
    if (!/^need-[0-9a-f]{64}\.json$/.test(receiptName)) continue;
    const value = JSON.parse(await readFile(join(receiptsDirectory, receiptName), "utf8")) as {
      kind?: unknown;
      installable?: unknown;
      selected_out_path?: unknown;
    };
    if (value.kind === "need-materialization" && value.installable === "nixpkgs#python314" &&
        typeof value.selected_out_path === "string") {
      candidates.push({
        receiptName,
        executablePath: join(value.selected_out_path, "bin", "python3"),
      });
    }
  }
  if (candidates.length === 0) throw new Error("proof host Python runtime receipt is absent");
  const observations = await Promise.all(candidates.map(async (candidate) =>
    await observeAgentSandboxRuntimeSupport({
      receiptsDirectory,
      expectedLeaseId,
      receiptName: candidate.receiptName,
      executablePath: candidate.executablePath,
    })
  ));
  const selected = observations[0]!;
  if (observations.some(({ digest }) => digest !== selected.digest)) {
    throw new Error("proof host Python runtime receipt is ambiguous");
  }
  return selected;
}
