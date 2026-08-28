import { mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { StartRootRunRequest } from "../src/administration/root.js";
import {
  createPrivateActivationCandidateV5,
} from "../src/internal/activation-admission.js";
import {
  applyPrivateActivationReviewPlan,
  createPrivateActivationReviewPlan,
  publishPrivateActivationCandidate,
} from "../src/internal/activation-admission-store.js";
import {
  createPrivateActivationPlanningObservation,
} from "../src/internal/activation-planning.js";
import {
  observeAgentSandboxRuntimeSupport,
  type PrivateRuntimeSupportObservation,
} from "../src/internal/agent-sandbox-runtime-support.js";
import {
  planPrivateDirectRun,
  type PrivateDirectRunRecipe,
} from "../src/internal/direct-run.js";
import { privateDomainDigest } from "../src/internal/identity.js";
import { PrivateLinuxCgroupBackend } from "../src/internal/linux-cgroup-backend.js";
import { openPrivateRootAdministrationController } from "../src/internal/root-administration-controller.js";
import { executePrivateRootRunLaunch } from "../src/internal/root-run-controller.js";
import {
  buildPrivateActivationRequests,
  resolveRetainedPackageProjectObservation,
} from "../src/project/package-resolution.js";
import { retainPackageProject } from "../src/project/retained-project.js";

// Proof-host dogfood only. This file is intentionally outside src/, exports no
// API, and must not become a shortcut around a future reviewed control plane.
const PRIVATE_STORE = ".jig/private-package-store";
const RUN_TIMEOUT_MS = 60_000;

type RuntimeSupport = Readonly<{
  bun: PrivateRuntimeSupportObservation;
  python: PrivateRuntimeSupportObservation;
}>;

interface ProofHost {
  readonly backend: PrivateLinuxCgroupBackend;
  readonly bunPath: string;
  readonly runtimeSupport: RuntimeSupport;
}

async function plan(projectPath: string): Promise<object> {
  const projectRoot = await realpath(projectPath);
  const packageStoreRoot = join(projectRoot, PRIVATE_STORE);
  await mkdir(packageStoreRoot, { recursive: true, mode: 0o700 });
  const host = await proofHost();
  const aggregate = await retainPackageProject({
    projectRoot,
    storeRoot: packageStoreRoot,
    evaluator: {
      backend: host.backend,
      bunPath: host.bunPath,
      runtimeMounts: host.runtimeSupport.bun.closureSources.map(
        (source) => ({ source, destination: source }),
      ),
      runtimeSupport: host.runtimeSupport.bun,
      jigDistributionPath: await realpath(join(import.meta.dir, "..", "dist")),
    },
  });
  const requests = buildPrivateActivationRequests(aggregate.linked);
  if (requests.length === 0) throw new Error("private foreground project has no exact Run target");

  const recipes: PrivateDirectRunRecipe[] = [];
  for (const request of requests) {
    recipes.push(await planPrivateDirectRun({
      request,
      runtimeSupport: host.runtimeSupport,
      backend: host.backend,
    }));
  }
  const mechanismDigests = new Set(recipes.map(({ mechanismDigest }) => mechanismDigest));
  if (mechanismDigests.size !== 1) {
    throw new Error("private foreground targets did not resolve through one exact host mechanism");
  }
  const planning = createPrivateActivationPlanningObservation({
    policyDigest: privateDomainDigest("JIG-Private-Foreground-Policy/1", {
      targetPolicy: "all-exact-or-fail",
    }),
    mechanismDigest: recipes[0]!.mechanismDigest,
    entries: recipes.map((recipe) => ({
      target: recipe.request.target,
      requestDigest: recipe.request.digest,
      disposition: { state: "planned" as const, observation: recipe.observation },
    })),
  });
  const candidate = createPrivateActivationCandidateV5(
    aggregate,
    resolveRetainedPackageProjectObservation(aggregate, planning),
    recipes,
  );
  const head = await publishPrivateActivationCandidate({
    projectRoot,
    packageStoreRoot,
    candidate,
  });
  const review = await createPrivateActivationReviewPlan({
    projectRoot,
    packageStoreRoot,
    lockMode: "update",
  });

  return {
    kind: "private-foreground-plan/1",
    projectRoot,
    packageStoreRoot,
    candidateRevision: head.candidateRevision,
    candidateDigest: head.candidateDigest,
    planDigest: review.planDigest,
    baseGeneration: review.plan.baseGeneration,
    lockMode: review.plan.lockMode,
    targets: recipes.map((recipe) => ({
      target: recipe.request.target,
      requestDigest: recipe.request.digest,
      recipeDigest: recipe.digest,
      observationDigest: recipe.observation.digest,
    })),
  };
}

async function applyRun(input: {
  readonly projectPath: string;
  readonly planDigest: string;
  readonly baseGeneration: string | null;
  readonly requests: readonly StartRootRunRequest[];
}): Promise<object> {
  const projectRoot = await realpath(input.projectPath);
  const packageStoreRoot = join(projectRoot, PRIVATE_STORE);
  const admission = await applyPrivateActivationReviewPlan({
    projectRoot,
    packageStoreRoot,
    planDigest: input.planDigest,
    baseGeneration: input.baseGeneration,
  });
  const host = await proofHost();
  const controller = await openPrivateRootAdministrationController({
    projectRoot,
    packageStoreRoot,
    runTimeoutMs: RUN_TIMEOUT_MS,
    execute: (runId, coordinator, signal, notifyWorkAvailable) => executePrivateRootRunLaunch({
      projectRoot,
      packageStoreRoot,
      runId,
      coordinator,
      runtimeSupport: host.runtimeSupport,
      backend: host.backend,
      notifyWorkAvailable,
      signal,
    }),
  });
  try {
    const runs = [];
    for (const request of input.requests) {
      const receipt = await controller.administration.startRun(request);
      await controller.drain();
      runs.push({
        submissionId: request.submissionId,
        receipt,
        status: await controller.administration.runStatus(receipt),
      });
    }
    return {
      kind: "private-foreground-apply-run/1",
      projectRoot,
      planDigest: input.planDigest,
      admissionDigest: admission.admissionDigest,
      runs,
    };
  } finally {
    await controller.dispose();
  }
}

async function proofHost(): Promise<ProofHost> {
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
    bunPath,
    runtimeSupport: Object.freeze({ bun, python }),
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

function parseApplyRunArguments(values: readonly string[]): {
  readonly projectPath: string;
  readonly planDigest: string;
  readonly baseGeneration: string | null;
  readonly requests: readonly StartRootRunRequest[];
} {
  const projectPath = values[0];
  if (projectPath === undefined) throw new Error("apply-run requires <project-root>");
  let planDigest: string | undefined;
  let baseGeneration: string | null | undefined;
  let approved = false;
  const requests: StartRootRunRequest[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === "--yes") {
      if (approved) throw new Error("--yes was supplied more than once");
      approved = true;
      continue;
    }
    const value = values[index + 1];
    if (value === undefined) throw new Error(`${flag} requires a value`);
    index += 1;
    if (flag === "--plan") {
      if (planDigest !== undefined) throw new Error("--plan was supplied more than once");
      planDigest = value;
    } else if (flag === "--base") {
      if (baseGeneration !== undefined) throw new Error("--base was supplied more than once");
      baseGeneration = value === "null" ? null : value;
    } else if (flag === "--request") {
      requests.push(JSON.parse(value) as StartRootRunRequest);
    } else {
      throw new Error(`unknown apply-run argument ${flag}`);
    }
  }
  if (!approved) throw new Error("apply-run requires explicit --yes approval");
  if (planDigest === undefined || baseGeneration === undefined) {
    throw new Error("apply-run requires the reviewed --plan and --base pair");
  }
  if (requests.length === 0) throw new Error("apply-run requires at least one --request");
  return { projectPath, planDigest, baseGeneration, requests };
}

async function main(values: readonly string[]): Promise<object> {
  const [command, ...rest] = values;
  if (command === "plan") {
    if (rest.length !== 1) throw new Error("usage: private-foreground plan <project-root>");
    return await plan(rest[0]!);
  }
  if (command === "apply-run") return await applyRun(parseApplyRunArguments(rest));
  throw new Error(
    "usage: private-foreground <plan <project-root> | apply-run <project-root> --plan <digest> --base <digest|null> --yes --request <json>...>",
  );
}

if (import.meta.main) {
  try {
    process.stdout.write(`${JSON.stringify(await main(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
