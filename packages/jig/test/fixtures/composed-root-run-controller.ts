import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

import { observeAgentSandboxRuntimeSupport } from "../../src/internal/agent-sandbox-runtime-support.js";
import { PrivateLinuxCgroupBackend } from "../../src/internal/linux-cgroup-backend.js";
import { openPrivateRootAdministrationController } from "../../src/internal/root-administration-controller.js";
import { executePrivateRootRunLaunch } from "../../src/internal/root-run-controller.js";

const [projectRoot, packageStoreRoot, submissionId, bindingId = "parent"] = process.argv.slice(2);
if (projectRoot === undefined || packageStoreRoot === undefined || submissionId === undefined) {
  throw new Error(
    "usage: composed-root-run-controller <project-root> <package-store-root> <submission-id> [binding-id]",
  );
}
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
const pythonCandidates: Array<{ receiptName: string; executablePath: string }> = [];
for (const receiptName of (await readdir(receiptsDirectory)).sort()) {
  if (!/^need-[0-9a-f]{64}\.json$/.test(receiptName)) continue;
  const receipt = JSON.parse(await readFile(join(receiptsDirectory, receiptName), "utf8")) as {
    kind?: unknown;
    installable?: unknown;
    selected_out_path?: unknown;
  };
  if (receipt.kind === "need-materialization" && receipt.installable === "nixpkgs#python314" &&
      typeof receipt.selected_out_path === "string") {
    pythonCandidates.push({
      receiptName,
      executablePath: join(receipt.selected_out_path, "bin", "python3"),
    });
  }
}
if (pythonCandidates.length !== 1) throw new Error("proof host Python runtime receipt is absent or ambiguous");
const python = await observeAgentSandboxRuntimeSupport({
  receiptsDirectory,
  expectedLeaseId,
  receiptName: pythonCandidates[0]!.receiptName,
  executablePath: pythonCandidates[0]!.executablePath,
});

const relative = (await readFile("/proc/self/cgroup", "utf8")).trim().split(":").at(-1)!;
const self = await realpath(`/sys/fs/cgroup${relative}`);
const shellWrapper = await realpath("/bin/sh");
const shebang = (await readFile(shellWrapper, "utf8")).split("\n", 1)[0]!;
if (!shebang.startsWith("#!/")) throw new Error("proof host Bash shebang is unavailable");
const backendOptions = {
  cgroupScope: dirname(self),
  sudoPath: "/agent-sudo/bin/sudo",
  subreaperPath: "/run/podman-init",
  mknodPath: "/bin/mknod",
  bunPath: "/bin/bun",
  bubblewrapPath: "/usr/bin/bwrap",
  bashPath: shebang.slice(2),
  payloadUid: 1000,
  payloadGid: 100,
} as const;

const backend = new PrivateLinuxCgroupBackend(backendOptions);
const runtimeSupport = Object.freeze({ bun, python });
const controller = await openPrivateRootAdministrationController({
  projectRoot,
  packageStoreRoot,
  runTimeoutMs: 60_000,
  execute: (runId, coordinator, signal, notifyWorkAvailable) => executePrivateRootRunLaunch({
    projectRoot,
    packageStoreRoot,
    runId,
    coordinator,
    runtimeSupport,
    backend,
    notifyWorkAvailable,
    signal,
  }),
});
const handle = await controller.administration.startRun({
  submissionId,
  target: { kind: "binding", id: bindingId },
  input: { delayMs: 30_000, hookDelayMs: 30_000 },
});
console.log(JSON.stringify(handle));
await Bun.sleep(3_600_000);
