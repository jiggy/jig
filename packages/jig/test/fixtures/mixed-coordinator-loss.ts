import { readFile, readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

import { observeAgentSandboxRuntimeSupport } from "../../src/internal/agent-sandbox-runtime-support.js";
import {
  loadPrivateActiveActivation,
  openPrivateProjectCoordinator,
} from "../../src/internal/activation-admission-store.js";
import {
  observePrivateBunServicePackage,
  planPrivateBunService,
} from "../../src/internal/bun-service-recipe.js";
import { PrivateLinuxCgroupBackend } from "../../src/internal/linux-cgroup-backend.js";
import { attachPrivateRootAdministrationController } from "../../src/internal/root-administration-controller.js";
import { executePrivateRootRunLaunch } from "../../src/internal/root-run-controller.js";
import { startPrivateBunServiceMount } from "../../src/internal/private-service-controller.js";

const [projectRoot, packageStoreRoot] = process.argv.slice(2);
const scope = process.env.JIG_TEST_SCOPE;
const bash = process.env.JIG_TEST_BASH;
const receiptsDirectory = process.env.AGENT_RUNTIME_RECEIPTS_DIR;
const expectedLeaseId = process.env.AGENT_RUNTIME_LEASE_ID;
if (projectRoot === undefined || packageStoreRoot === undefined || scope === undefined ||
    bash === undefined || receiptsDirectory === undefined || expectedLeaseId === undefined) {
  throw new Error("mixed coordinator-loss fixture lacks its trusted test inputs");
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
if (pythonCandidates.length === 0) throw new Error("proof host Python runtime receipt is absent");
const pythonObservations = await Promise.all(pythonCandidates.map(async (candidate) =>
  await observeAgentSandboxRuntimeSupport({
    receiptsDirectory,
    expectedLeaseId,
    receiptName: candidate.receiptName,
    executablePath: candidate.executablePath,
  })
));
const python = pythonObservations[0]!;
if (pythonObservations.some(({ digest }) => digest !== python.digest)) {
  throw new Error("proof host Python runtime receipt is ambiguous");
}

const backend = new PrivateLinuxCgroupBackend({
  cgroupScope: await realpath(scope),
  sudoPath: "/agent-sudo/bin/sudo",
  subreaperPath: "/run/podman-init",
  mknodPath: "/bin/mknod",
  bunPath,
  bubblewrapPath: "/usr/bin/bwrap",
  bashPath: await realpath(bash),
  payloadUid: 1000,
  payloadGid: 100,
});
const runtimeSupport = Object.freeze({ bun, python });
const active = await loadPrivateActiveActivation({ projectRoot, packageStoreRoot });
const serviceRequest = active.candidate.candidate.targets.find(({ request }) => request.mode === "service")
  ?.request;
if (serviceRequest === undefined) throw new Error("mixed project has no active Service request");
const serviceObservation = await observePrivateBunServicePackage({
  request: serviceRequest,
  packageStoreRoot,
});
const serviceRecipe = await planPrivateBunService({
  request: serviceRequest,
  packageObservation: serviceObservation,
  runtimeSupport: bun,
  backend,
});

const coordinator = await openPrivateProjectCoordinator({ projectRoot });
let mounted: Awaited<ReturnType<typeof startPrivateBunServiceMount>> | undefined;
let controller: Awaited<ReturnType<typeof attachPrivateRootAdministrationController>> | undefined;
let observationDatabase: any;
try {
  mounted = await startPrivateBunServiceMount({
    coordinator,
    projectRoot,
    packageStoreRoot,
    recipe: serviceRecipe,
    effectiveDeadlineUnixMs: Date.now() + 29_950,
  });
  controller = await attachPrivateRootAdministrationController({
    coordinator,
    projectRoot,
    packageStoreRoot,
    runTimeoutMs: 25_000,
    execute: (runId, sharedCoordinator, signal, notifyWorkAvailable) => executePrivateRootRunLaunch({
      projectRoot,
      packageStoreRoot,
      runId,
      coordinator: sharedCoordinator,
      runtimeSupport,
      backend,
      notifyWorkAvailable,
      serviceMount: mounted,
      signal,
    }),
  });
  const root = await controller.administration.startRun({
    submissionId: "mixed-coordinator-loss",
    target: { kind: "binding", id: "mixed" },
    input: { counterHold: true, full: false, ticket: "T-loss" },
  });

  const deadline = Date.now() + 20_000;
  let lastFailure: unknown;
  let lastObservation: unknown = { invocations: [], root: "unobserved" };
  const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
  observationDatabase = sqlite.Database.open(
    join(projectRoot, ".jig", "private-activation-admission-v19.sqlite3"),
    sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
  );
  while (true) {
    try {
      const invocation = observationDatabase.query([
        "SELECT dispatch_digest, terminal_digest FROM service_invocations",
        "WHERE owner_run_id = ?1 AND operation_id = 'counter-next'",
      ].join(" ")).get(root.runId) as {
        readonly dispatch_digest: string | null;
        readonly terminal_digest: string | null;
      } | null;
      const rootTerminal = observationDatabase.query(
        "SELECT terminal_digest FROM root_terminals WHERE run_id = ?1",
      ).get(root.runId) as { readonly terminal_digest: string } | null;
      lastObservation = {
        invocation: invocation === null ? null : {
          dispatch: invocation.dispatch_digest,
          terminal: invocation.terminal_digest,
        },
        rootTerminal: rootTerminal?.terminal_digest ?? null,
      };
      if (invocation !== null && invocation.dispatch_digest !== null &&
          invocation.terminal_digest === null && rootTerminal === null) {
        observationDatabase.close(true);
        observationDatabase = undefined;
        console.log(JSON.stringify({
          runId: root.runId,
          mountId: mounted.mountId,
          dispatchDigest: invocation.dispatch_digest,
        }));
        await Bun.sleep(3_600_000);
        break;
      }
    } catch (error) {
      lastFailure = error;
    }
    if (Date.now() >= deadline) {
      throw new AggregateError(
        [
          new Error(`last durable observation: ${JSON.stringify(lastObservation)}`),
          ...(lastFailure === undefined ? [] : [lastFailure]),
        ],
        "mixed invocation did not reach durable possible-dispatch",
      );
    }
    await Bun.sleep(100);
  }
} catch (error) {
  const cleanup: unknown[] = [];
  try { observationDatabase?.close(true); } catch (cleanupError) { cleanup.push(cleanupError); }
  observationDatabase = undefined;
  try { await controller?.dispose(); } catch (cleanupError) { cleanup.push(cleanupError); }
  try { await mounted?.fence(); } catch (cleanupError) { cleanup.push(cleanupError); }
  try { await mounted?.stop(); } catch (cleanupError) { cleanup.push(cleanupError); }
  try { await coordinator.dispose(); } catch (cleanupError) { cleanup.push(cleanupError); }
  process.stderr.write(`${JSON.stringify({
    kind: "mixed-coordinator-loss-worker-failure/1",
    failure: errorDiagnostic(error),
    cleanup: cleanup.map((cleanupError) => errorDiagnostic(cleanupError)),
  })}\n`);
  process.exitCode = 1;
}

function errorDiagnostic(error: unknown, depth = 0): unknown {
  if (depth >= 4) return { name: "ErrorDepthExceeded", message: String(error) };
  if (!(error instanceof Error)) return { name: typeof error, message: String(error) };
  const coded = error as Error & { readonly code?: unknown; readonly cause?: unknown };
  return {
    name: error.name,
    message: error.message,
    ...(typeof coded.code === "string" ? { code: coded.code } : {}),
    ...(typeof error.stack === "string" ? { stack: error.stack } : {}),
    ...(error instanceof AggregateError
      ? { errors: error.errors.map((nested) => errorDiagnostic(nested, depth + 1)) }
      : {}),
    ...(coded.cause === undefined ? {} : { cause: errorDiagnostic(coded.cause, depth + 1) }),
  };
}
