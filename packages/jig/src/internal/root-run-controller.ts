import { lstat, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { CheckError } from "../diagnostics.js";
import { type JsonValue } from "../json.js";
import { inspectCapturedPackage } from "../package/inspect.js";
import { findPrivateActivationCandidateTargetV5 } from "./activation-admission.js";
import { RunHostSession, type RunHostTerminal } from "../run/session.js";
import {
  closePrivateRootExecution,
  reacquirePrivateRootExecutionWork,
  recordPrivateRootExecutionCheckpoint,
  type PrivateProjectCoordinator,
  type PrivateReacquiredRootExecutionWork,
  type PrivateRootExecutionCheckpointName,
  type PrivateRootExecutionLifecycle,
  type PrivateRootRunSnapshot,
  type PrivateRootRunTerminal,
} from "./activation-admission-store.js";
import {
  planPrivateDirectRun,
  type PrivateDirectRunRecipe,
  type PrivateDirectRunInstalledSupport,
} from "./direct-run.js";
import { revalidatePrivateInstalledBunSupport } from "./installed-bun-support.js";
import {
  PrivateLinuxFenceUnconfirmedError,
  cancelPrivateLinuxOwnerStateAllocation,
  normalizePrivateLinuxOwnerStateAllocationIdentity,
  normalizePrivateLinuxSealedOwnerIdentity,
  planPrivateLinuxOwnerStateAllocation,
  releasePrivateLinuxOwnerState,
  type PrivateLinuxCgroupBackend,
  type PrivateLinuxConfirmedEnforcementReceipt,
  type PrivateLinuxLaunchPlan,
  type PrivateLinuxOwnerStateAllocationIdentity,
  type PrivateLinuxOwnerStateReleaseReceipt,
  type PrivateLinuxSealedOwnerIdentity,
} from "./linux-rootless-backend.js";
import { captureStoredPackage } from "./package-artifact-store.js";
import {
  allocatePrivatePackageMaterialization,
  disposePrivatePackageMaterializationLease,
  reacquirePrivatePackageMaterializationLease,
  recoverPrivatePackageMaterializationAllocation,
  materializePrivatePackageLease,
  type PrivatePackageMaterializationAllocationIdentity,
  type PrivatePackageMaterializationLease,
  type PrivatePackageMaterializationLeaseIdentity,
} from "./package-materialization.js";
import { admitPrivatePackageResult } from "./package-result-admission.js";
import {
  failedPrivateRootTerminal,
  normalizePrivateRootTerminal,
} from "./root-run-state.js";

const PLAN_KIND = "private-direct-root-plan/1";
const BACKING_KIND = "private-direct-root-backing/1";
const SANDBOX_KIND = "private-direct-root-sandbox/1";
const PREPARED_KIND = "private-direct-root-prepared/1";
const FENCE_KIND = "private-direct-root-fence/1";
const RELEASE_KIND = "private-direct-root-release/1";
const CANCELLATION_GRACE_MS = 1_000;

export type PrivateRootExecutionDisposition =
  | { readonly state: "terminal"; readonly run: PrivateRootRunSnapshot }
  | { readonly state: "pending"; readonly reason: "fence-unconfirmed" };

interface PrivateDirectRootPlanRecord {
  readonly kind: typeof PLAN_KIND;
  readonly requestDigest: string;
  readonly recipeDigest: string;
  readonly observationDigest: string;
  readonly activationStartedUnixMs: number;
  readonly effectiveDeadlineUnixMs: number;
  readonly cancellationGraceMs: number;
  readonly packageAllocation: PrivatePackageMaterializationAllocationIdentity;
  readonly ownerAllocation: PrivateLinuxOwnerStateAllocationIdentity;
}

interface PrivateDirectRootBackingRecord {
  readonly kind: typeof BACKING_KIND;
  readonly lease: PrivatePackageMaterializationLeaseIdentity;
}

interface PrivateDirectRootSandboxRecord {
  readonly kind: typeof SANDBOX_KIND;
  readonly owner: PrivateLinuxSealedOwnerIdentity;
}

interface PrivateDirectRootFenceRecord {
  readonly kind: typeof FENCE_KIND;
  readonly receipt: PrivateLinuxConfirmedEnforcementReceipt;
}

/** Drive one exact durable root execution from its persisted lifecycle. */
export async function executePrivateRootRunLaunch(input: {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly runId: string;
  readonly coordinator: PrivateProjectCoordinator;
  readonly installedSupport: PrivateDirectRunInstalledSupport;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly signal?: AbortSignal;
}): Promise<PrivateRootExecutionDisposition> {
  await input.coordinator.verify();
  let work = await reacquire(input);
  if (work.lifecycle.admitted !== undefined) {
    return terminal(await closeFromAdmitted(input, work));
  }
  if (work.run.coordinatorEpoch < input.coordinator.epoch) {
    return await recoverOlderExecution(input, work);
  }
  if (work.lifecycle.sandbox !== undefined || work.lifecycle.provisional !== undefined) {
    return await recoverCurrentExecution(input, work);
  }
  return await startOrResumeCurrentExecution(input, work);
}

async function startOrResumeCurrentExecution(
  input: RootExecutionInput,
  initial: PrivateReacquiredRootExecutionWork,
): Promise<PrivateRootExecutionDisposition> {
  const stop = new FirstStop(input.signal, initial.intent.deadlineUnixMs);
  let work = initial;
  let observedTerminal: RunHostTerminal | undefined;
  try {
    let recipe: PrivateDirectRunRecipe;
    let plan: PrivateDirectRootPlanRecord;
    if (work.lifecycle.plan === undefined) {
      if (stop.terminal !== undefined) {
        return terminal(await settleWithoutPlan(input, work, stop.terminal));
      }
      const activationStartedUnixMs = Date.now();
      recipe = await reproduceRecipe(input, work);
      stop.narrow(Math.min(
        work.intent.deadlineUnixMs,
        activationStartedUnixMs + recipe.wallClockCeilingMs,
      ));
      if (stop.terminal !== undefined) {
        return terminal(await settleWithoutPlan(input, work, stop.terminal));
      }
      const roots = await protectedWorkRoots(input.projectRoot);
      const hexadecimal = runHex(work.run.runId);
      const [packageAllocation, ownerAllocation] = await Promise.all([
        allocatePrivatePackageMaterialization({
          protectedParent: roots.materializations,
          name: `root-${hexadecimal}`,
          packageDigest: recipe.executionPackage.digest,
          ownerToken: work.lifecycle.allocation.digest,
        }),
        planPrivateLinuxOwnerStateAllocation({
          parent: roots.owners,
          name: `r-${hexadecimal.slice(0, 62)}`,
        }),
      ]);
      plan = Object.freeze({
        kind: PLAN_KIND,
        requestDigest: work.intent.requestDigest,
        recipeDigest: recipe.digest,
        observationDigest: recipe.observation.digest,
        activationStartedUnixMs,
        effectiveDeadlineUnixMs: stop.deadlineUnixMs,
        cancellationGraceMs: CANCELLATION_GRACE_MS,
        packageAllocation,
        ownerAllocation,
      });
      work = await advanceCheckpoint(input, work, "plan", plan as unknown as JsonValue);
    } else {
      plan = parsePlan(work.lifecycle.plan.value);
      recipe = await reproduceRecipe(input, work);
      stop.narrow(plan.effectiveDeadlineUnixMs);
      await requirePlanMatches(
        input.projectRoot,
        plan,
        work,
        recipe,
        recipe.executionPackage.digest,
      );
    }

    if (stop.terminal !== undefined) {
      return await settleBeforeSandbox(input, work, plan, stop.terminal);
    }

    let backing = work.lifecycle.backing === undefined
      ? undefined
      : parseBacking(work.lifecycle.backing.value);
    let lease: PrivatePackageMaterializationLease;
    if (backing === undefined) {
      const recovered = await recoverPrivatePackageMaterializationAllocation(
        plan.packageAllocation.parent.path,
        plan.packageAllocation,
      );
      if (recovered.state === "complete") {
        lease = recovered.lease;
      } else {
        lease = await materializeRootBacking(input, recipe, plan.packageAllocation);
      }
      backing = Object.freeze({ kind: BACKING_KIND, lease: lease.identity });
      work = await advanceCheckpoint(input, work, "backing", backing as unknown as JsonValue);
    } else {
      lease = await reacquirePrivatePackageMaterializationLease(
        plan.packageAllocation.parent.path,
        backing.lease,
      );
    }
    if (stop.terminal !== undefined) {
      return await settleBeforeSandbox(input, work, plan, stop.terminal);
    }

    await revalidateRecipe(recipe);
    if (stop.terminal !== undefined) {
      return await settleBeforeSandbox(input, work, plan, stop.terminal);
    }
    const sealed = await input.backend.seal(
      backendPlan(recipe, lease.root, work.run.runId, plan),
      plan.ownerAllocation,
    );
    work = await advanceCheckpoint(input, work, "sandbox", {
      kind: SANDBOX_KIND,
      owner: sealed.identity,
    } as unknown as JsonValue);
    if (stop.terminal !== undefined) {
      return await settleSealedWithoutAdmission(input, work, sealed.identity, stop.terminal);
    }

    let provisional: RunHostTerminal;
    let fence: PrivateLinuxConfirmedEnforcementReceipt;
    try {
      const component = await sealed.admit(stop.enforcementSignal, async (prepared) => {
        work = await advanceCheckpoint(input, work, "prepared", {
          kind: PREPARED_KIND,
          prepared,
        } as unknown as JsonValue);
      });
      // The signal passed to Backend admission is startup-only. Once the
      // component is ready, RunHost owns cooperative cancellation/deadline
      // delivery and the helper's absolute timer owns the hard fence after
      // grace; aborting the Backend signal here would skip that protocol.
      stop.releaseStartupEnforcement();
      provisional = await new RunHostSession(component, {
        input: work.run.input,
        settings: recipe.request.settings,
        attachments: Object.freeze({}),
        scratch: recipe.scratch,
        deadlineUnixMs: plan.effectiveDeadlineUnixMs,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }, { cancellationGraceMs: plan.cancellationGraceMs }).run();
      observedTerminal = provisional;
      work = await advanceCheckpoint(
        input,
        work,
        "provisional",
        provisional as unknown as JsonValue,
      );
      try {
        fence = await component.enforcement;
      } catch (error) {
        if (error instanceof PrivateLinuxFenceUnconfirmedError) {
          return Object.freeze({ state: "pending", reason: "fence-unconfirmed" });
        }
        throw error;
      }
    } catch (error) {
      let retryableBusy = isAdmissionStateBusy(error) ? error : undefined;
      const knownTerminal = observedTerminal ?? stop.terminal;
      if (knownTerminal !== undefined) {
        // Persist a known protocol/cancellation/deadline result before a
        // possibly unconfirmed fence can make this invocation return pending.
        try {
          work = await advanceCheckpoint(
            input,
            work,
            "provisional",
            knownTerminal as unknown as JsonValue,
          );
        } catch (terminalError) {
          if (!isAdmissionStateBusy(terminalError)) throw terminalError;
          retryableBusy = terminalError;
        }
      }
      try {
        fence = await input.backend.recoverFence(sealed.identity);
      } catch (fenceError) {
        if (fenceError instanceof PrivateLinuxFenceUnconfirmedError) {
          return Object.freeze({ state: "pending", reason: "fence-unconfirmed" });
        }
        throw fenceError;
      }
      if (retryableBusy !== undefined) {
        // A sealed owner has existed, so publish its confirmed fence before
        // asking the durable controller to repeat this complete operation.
        // If the known terminal could not be recorded, the retry will recover
        // conservatively as UNCERTAIN; it must never infer success from the
        // fence alone. Sandbox state and the durable root execution identity
        // prevent another component launch.
        await recordCheckpoint(input, work.run.runId, "fence", {
          kind: FENCE_KIND,
          receipt: fence,
        } as unknown as JsonValue);
        throw retryableBusy;
      }
      // A helper hard deadline can win while the coordinator event loop is
      // delayed. Its confirmed typed receipt outranks a generic startup error.
      provisional = knownTerminal ?? terminalAfterConfirmedFence(error, fence);
      if (knownTerminal === undefined) {
        work = await advanceCheckpoint(
          input,
          work,
          "provisional",
          provisional as unknown as JsonValue,
        );
      }
    }

    work = await advanceCheckpoint(input, work, "fence", {
      kind: FENCE_KIND,
      receipt: fence,
    } as unknown as JsonValue);
    return terminal(await releaseAdmitAndClose(input, work));
  } catch (error) {
    if (error instanceof PrivateLinuxFenceUnconfirmedError) {
      return Object.freeze({ state: "pending", reason: "fence-unconfirmed" });
    }
    if (isAdmissionStateBusy(error)) throw error;
    work = await reacquire(input);
    if (work.lifecycle.sandbox !== undefined || work.lifecycle.provisional !== undefined) {
      return await recoverCurrentExecution(
        input,
        work,
        observedTerminal ?? stop.terminal,
        error,
      );
    }
    if (work.lifecycle.plan !== undefined) {
      return await settleBeforeSandbox(
        input,
        work,
        parsePlan(work.lifecycle.plan.value),
        stop.terminal ?? executionFailed(error),
      );
    }
    return terminal(await settleWithoutPlan(input, work, stop.terminal ?? executionFailed(error)));
  } finally {
    stop.dispose();
  }
}

async function settleSealedWithoutAdmission(
  input: RootExecutionInput,
  initial: PrivateReacquiredRootExecutionWork,
  owner: PrivateLinuxSealedOwnerIdentity,
  provisional: PrivateRootRunTerminal,
): Promise<PrivateRootExecutionDisposition> {
  let work = await advanceCheckpoint(
    input,
    initial,
    "provisional",
    provisional as unknown as JsonValue,
  );
  let fence: PrivateLinuxConfirmedEnforcementReceipt;
  try {
    fence = await input.backend.recoverFence(owner);
  } catch (error) {
    if (error instanceof PrivateLinuxFenceUnconfirmedError) {
      return Object.freeze({ state: "pending", reason: "fence-unconfirmed" });
    }
    throw error;
  }
  work = await advanceCheckpoint(input, work, "fence", {
    kind: FENCE_KIND,
    receipt: fence,
  } as unknown as JsonValue);
  return terminal(await releaseAdmitAndClose(input, work));
}

async function recoverCurrentExecution(
  input: RootExecutionInput,
  initial: PrivateReacquiredRootExecutionWork,
  knownTerminal?: PrivateRootRunTerminal,
  fallbackError?: unknown,
): Promise<PrivateRootExecutionDisposition> {
  let work = initial;
  let confirmedFence = work.lifecycle.fence === undefined
    ? undefined
    : parseFence(work.lifecycle.fence.value).receipt;
  if (work.lifecycle.provisional === undefined && knownTerminal !== undefined) {
    work = await advanceCheckpoint(
      input,
      work,
      "provisional",
      knownTerminal as unknown as JsonValue,
    );
  }
  if (work.lifecycle.sandbox !== undefined && work.lifecycle.fence === undefined) {
    const sandbox = parseSandbox(work.lifecycle.sandbox.value);
    let receipt: PrivateLinuxConfirmedEnforcementReceipt;
    try {
      receipt = await input.backend.recoverFence(sandbox.owner);
    } catch (error) {
      if (error instanceof PrivateLinuxFenceUnconfirmedError) {
        return Object.freeze({ state: "pending", reason: "fence-unconfirmed" });
      }
      throw error;
    }
    work = await advanceCheckpoint(input, work, "fence", {
      kind: FENCE_KIND,
      receipt,
    } as unknown as JsonValue);
    confirmedFence = receipt;
  }
  if (work.lifecycle.provisional === undefined) {
    work = await advanceCheckpoint(
      input,
      work,
      "provisional",
      (knownTerminal ?? terminalAfterRecoveredFence(confirmedFence, fallbackError)) as unknown as JsonValue,
    );
  }
  try {
    return terminal(await releaseAdmitAndClose(input, work));
  } catch (error) {
    if (error instanceof PrivateLinuxFenceUnconfirmedError) {
      return Object.freeze({ state: "pending", reason: "fence-unconfirmed" });
    }
    throw error;
  }
}

async function recoverOlderExecution(
  input: RootExecutionInput,
  initial: PrivateReacquiredRootExecutionWork,
): Promise<PrivateRootExecutionDisposition> {
  let work = initial;
  if (work.lifecycle.sandbox !== undefined && work.lifecycle.fence === undefined) {
    const sandbox = parseSandbox(work.lifecycle.sandbox.value);
    let receipt: PrivateLinuxConfirmedEnforcementReceipt;
    try {
      receipt = await input.backend.recoverFence(sandbox.owner);
    } catch (error) {
      if (error instanceof PrivateLinuxFenceUnconfirmedError) {
        return Object.freeze({ state: "pending", reason: "fence-unconfirmed" });
      }
      throw error;
    }
    work = await advanceCheckpoint(input, work, "fence", {
      kind: FENCE_KIND,
      receipt,
    } as unknown as JsonValue);
  }
  if (work.lifecycle.provisional === undefined) {
    const lost = Object.freeze({
      status: "lost" as const,
      code: "COORDINATOR_LOST" as const,
      message: "the prior coordinator disappeared before an independently proved result",
    });
    work = await advanceCheckpoint(input, work, "provisional", lost as unknown as JsonValue);
  }
  try {
    return terminal(await releaseAdmitAndClose(input, work));
  } catch (error) {
    if (error instanceof PrivateLinuxFenceUnconfirmedError) {
      return Object.freeze({ state: "pending", reason: "fence-unconfirmed" });
    }
    throw error;
  }
}

async function settleBeforeSandbox(
  input: RootExecutionInput,
  work: PrivateReacquiredRootExecutionWork,
  _plan: PrivateDirectRootPlanRecord,
  provisional: PrivateRootRunTerminal,
): Promise<PrivateRootExecutionDisposition> {
  work = await advanceCheckpoint(
    input,
    work,
    "provisional",
    provisional as unknown as JsonValue,
  );
  try {
    return terminal(await releaseAdmitAndClose(input, work));
  } catch (error) {
    if (error instanceof PrivateLinuxFenceUnconfirmedError) {
      return Object.freeze({ state: "pending", reason: "fence-unconfirmed" });
    }
    throw error;
  }
}

async function settleWithoutPlan(
  input: RootExecutionInput,
  work: PrivateReacquiredRootExecutionWork,
  provisional: PrivateRootRunTerminal,
): Promise<PrivateRootRunSnapshot> {
  work = await advanceCheckpoint(
    input,
    work,
    "provisional",
    provisional as unknown as JsonValue,
  );
  work = await advanceCheckpoint(input, work, "release", {
    kind: RELEASE_KIND,
    planDigest: null,
    backingDigest: null,
    fenceDigest: null,
    packageReleased: true,
    ownerRelease: null,
  } as unknown as JsonValue);
  const admitted = normalizePrivateRootTerminal(work.lifecycle.provisional!.value);
  work = await advanceCheckpoint(input, work, "admitted", admitted as unknown as JsonValue);
  return await closeFromAdmitted(input, work);
}

async function releaseAdmitAndClose(
  input: RootExecutionInput,
  initial: PrivateReacquiredRootExecutionWork,
): Promise<PrivateRootRunSnapshot> {
  let work = initial;
  if (work.lifecycle.release === undefined) {
    const plan = work.lifecycle.plan === undefined ? undefined : parsePlan(work.lifecycle.plan.value);
    let ownerRelease: PrivateLinuxOwnerStateReleaseReceipt | null = null;
    if (plan !== undefined) {
      if (work.lifecycle.sandbox !== undefined && work.lifecycle.fence === undefined) {
        throw new PrivateLinuxFenceUnconfirmedError(new Error("sandbox backing cannot be released before fencing"));
      }
      if (work.lifecycle.backing !== undefined) {
        const backing = parseBacking(work.lifecycle.backing.value);
        await disposePrivatePackageMaterializationLease(plan.packageAllocation.parent.path, backing.lease);
      } else {
        const recovered = await recoverPrivatePackageMaterializationAllocation(
          plan.packageAllocation.parent.path,
          plan.packageAllocation,
        );
        if (recovered.state === "complete") await recovered.lease.dispose();
      }
      if (work.lifecycle.sandbox !== undefined) {
        const sandbox = parseSandbox(work.lifecycle.sandbox.value);
        const fence = parseFence(work.lifecycle.fence!.value);
        ownerRelease = await releasePrivateLinuxOwnerState(sandbox.owner, fence.receipt);
      } else {
        const cancelled = await cancelPrivateLinuxOwnerStateAllocation(plan.ownerAllocation);
        ownerRelease = await releasePrivateLinuxOwnerState(plan.ownerAllocation, cancelled);
      }
    }
    work = await advanceCheckpoint(input, work, "release", {
      kind: RELEASE_KIND,
      planDigest: work.lifecycle.plan?.digest ?? null,
      backingDigest: work.lifecycle.backing?.digest ?? null,
      fenceDigest: work.lifecycle.fence?.digest ?? null,
      packageReleased: true,
      ownerRelease,
    } as unknown as JsonValue);
  }

  if (work.lifecycle.admitted === undefined) {
    const provisional = normalizePrivateRootTerminal(work.lifecycle.provisional!.value);
    const admitted = provisional.status === "succeeded"
      ? await admitProtectedResult(input, work, provisional)
      : provisional;
    work = await advanceCheckpoint(input, work, "admitted", admitted as unknown as JsonValue);
  }
  return await closeFromAdmitted(input, work);
}

async function admitProtectedResult(
  input: RootExecutionInput,
  work: PrivateReacquiredRootExecutionWork,
  provisional: Extract<RunHostTerminal, { readonly status: "succeeded" }>,
): Promise<RunHostTerminal> {
  const target = findPrivateActivationCandidateTargetV5(work.candidate, work.run.target);
  if (target === undefined) throw new Error("durable root Run target is absent from its candidate");
  const request = target.request;
  const captured = await captureStoredPackage(input.packageStoreRoot, request.package);
  try {
    return admitPrivatePackageResult(await inspectCapturedPackage(captured), provisional);
  } finally {
    await captured.dispose();
  }
}

async function materializeRootBacking(
  input: RootExecutionInput,
  recipe: PrivateDirectRunRecipe,
  allocation: PrivatePackageMaterializationAllocationIdentity,
): Promise<PrivatePackageMaterializationLease> {
  const captured = await captureStoredPackage(input.packageStoreRoot, recipe.executionPackage);
  try {
    return await materializePrivatePackageLease(
      captured,
      allocation,
    );
  } finally {
    await captured.dispose();
  }
}

async function reproduceRecipe(
  input: RootExecutionInput,
  work: PrivateReacquiredRootExecutionWork,
): Promise<PrivateDirectRunRecipe> {
  const target = findPrivateActivationCandidateTargetV5(work.candidate, work.run.target);
  if (target === undefined) throw new Error("durable root Run target is absent from its candidate");
  const request = target.request;
  if (request.digest !== work.intent.requestDigest ||
      target.disposition.state !== "ready") {
    throw new Error("durable root spawn intent differs from its admitted target");
  }
  const recipe = await planPrivateDirectRun({
    request,
    executionPackage: target.disposition.executionPackage,
    installedSupport: input.installedSupport,
    backend: input.backend,
  });
  if (recipe.digest !== work.intent.recipeDigest ||
      recipe.observation.digest !== work.intent.observationDigest) {
    throw new Error("current host mechanisms do not reproduce the admitted Run recipe");
  }
  return recipe;
}

async function revalidateRecipe(recipe: PrivateDirectRunRecipe): Promise<void> {
  const [mechanism] = await Promise.all([
    recipe.backend.observeMechanism(),
    revalidatePrivateInstalledBunSupport(recipe.installedSupport),
  ]);
  if (mechanism.digest !== recipe.mechanismDigest) {
    throw new Error("direct Run recipe no longer matches retained host support");
  }
}

function backendPlan(
  recipe: PrivateDirectRunRecipe,
  packageRoot: string,
  runId: string,
  plan: PrivateDirectRootPlanRecord,
): PrivateLinuxLaunchPlan {
  const readOnlyMounts = [
    ...recipe.installedSupport.runtimeMounts,
    { source: packageRoot, destination: recipe.packageDestination },
  ];
  const limits = Object.freeze({
    ...recipe.resourceCeilings,
    deadlineUnixMs: plan.effectiveDeadlineUnixMs,
    cancellationGraceMs: plan.cancellationGraceMs,
  });
  return Object.freeze({
    runId: backendRunLabel(runId),
    limits,
    readOnlyMounts,
    command: [
      recipe.sandboxExecutablePath,
      ...recipe.bunPolicy,
      `${recipe.packageDestination}/${recipe.request.entrypoint.path}`,
    ] as readonly [string, ...string[]],
  });
}

async function closeFromAdmitted(
  input: RootExecutionInput,
  work: PrivateReacquiredRootExecutionWork,
): Promise<PrivateRootRunSnapshot> {
  const admitted = normalizePrivateRootTerminal(work.lifecycle.admitted!.value);
  let first: unknown;
  // The SQLite close is replay-safe. Its transaction may commit before a
  // subsequent owner verification or descriptor cleanup reports failure, so
  // converge the exact terminal instead of falling back to launch recovery.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await closePrivateRootExecution({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        runId: work.run.runId,
        terminal: admitted,
      });
    } catch (error) {
      first ??= error;
      if (attempt < 3) await new Promise<void>((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
  throw first;
}

async function recordCheckpoint(
  input: RootExecutionInput,
  runId: string,
  checkpoint: PrivateRootExecutionCheckpointName,
  value: JsonValue,
): Promise<PrivateRootExecutionLifecycle> {
  let first: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await recordPrivateRootExecutionCheckpoint({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        runId,
        checkpoint,
        value,
      });
    } catch (error) {
      first ??= error;
      if (attempt < 3) await new Promise<void>((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
  throw first;
}

/** Advance healthy in-process work from the exact lifecycle just committed. */
async function advanceCheckpoint(
  input: RootExecutionInput,
  work: PrivateReacquiredRootExecutionWork,
  checkpoint: PrivateRootExecutionCheckpointName,
  value: JsonValue,
): Promise<PrivateReacquiredRootExecutionWork> {
  const lifecycle = await recordCheckpoint(input, work.run.runId, checkpoint, value);
  if (lifecycle.runId !== work.run.runId) {
    throw new Error("committed root execution lifecycle belongs to another Run");
  }
  return Object.freeze({ ...work, lifecycle });
}

async function reacquire(input: RootExecutionInput): Promise<PrivateReacquiredRootExecutionWork> {
  return await reacquirePrivateRootExecutionWork({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    packageStoreRoot: input.packageStoreRoot,
    runId: input.runId,
  });
}

async function protectedWorkRoots(projectRoot: string): Promise<{
  readonly materializations: string;
  readonly owners: string;
}> {
  const state = await realpath(join(projectRoot, ".jig"));
  const materializations = join(state, "private-root-materializations");
  const owners = join(state, "private-root-linux-owners");
  await Promise.all([ensureProtectedDirectory(materializations), ensureProtectedDirectory(owners)]);
  return Object.freeze({ materializations, owners });
}

async function ensureProtectedDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700 }).catch((error) => {
    if (!hasCode(error, "EEXIST")) throw error;
  });
  const information = await lstat(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (!information.isDirectory() || information.isSymbolicLink() ||
      information.uid !== uid || (information.mode & 0o077) !== 0 || await realpath(path) !== path) {
    throw new Error("private root execution work directory is not protected");
  }
}

function parsePlan(value: JsonValue): PrivateDirectRootPlanRecord {
  const record = exactRecord(value, [
    "activationStartedUnixMs", "cancellationGraceMs", "effectiveDeadlineUnixMs", "kind",
    "observationDigest", "ownerAllocation", "packageAllocation", "recipeDigest", "requestDigest",
  ], "direct root plan");
  if (record.kind !== PLAN_KIND || !Number.isSafeInteger(record.activationStartedUnixMs) ||
      !Number.isSafeInteger(record.effectiveDeadlineUnixMs) ||
      !Number.isSafeInteger(record.cancellationGraceMs)) {
    throw new TypeError("direct root plan is invalid");
  }
  return Object.freeze({
    kind: PLAN_KIND,
    requestDigest: digest(record.requestDigest, "direct root request"),
    recipeDigest: digest(record.recipeDigest, "direct root recipe"),
    observationDigest: digest(record.observationDigest, "direct root observation"),
    activationStartedUnixMs: record.activationStartedUnixMs as number,
    effectiveDeadlineUnixMs: record.effectiveDeadlineUnixMs as number,
    cancellationGraceMs: record.cancellationGraceMs as number,
    packageAllocation: record.packageAllocation as unknown as PrivatePackageMaterializationAllocationIdentity,
    ownerAllocation: normalizePrivateLinuxOwnerStateAllocationIdentity(record.ownerAllocation),
  });
}

function parseBacking(value: JsonValue): PrivateDirectRootBackingRecord {
  const record = exactRecord(value, ["kind", "lease"], "direct root backing");
  if (record.kind !== BACKING_KIND) throw new TypeError("direct root backing is invalid");
  return Object.freeze({
    kind: BACKING_KIND,
    lease: record.lease as unknown as PrivatePackageMaterializationLeaseIdentity,
  });
}

function parseSandbox(value: JsonValue): PrivateDirectRootSandboxRecord {
  const record = exactRecord(value, ["kind", "owner"], "direct root sandbox");
  if (record.kind !== SANDBOX_KIND) throw new TypeError("direct root sandbox is invalid");
  return Object.freeze({ kind: SANDBOX_KIND, owner: normalizePrivateLinuxSealedOwnerIdentity(record.owner) });
}

function parseFence(value: JsonValue): PrivateDirectRootFenceRecord {
  const record = exactRecord(value, ["kind", "receipt"], "direct root fence");
  if (record.kind !== FENCE_KIND) throw new TypeError("direct root fence is invalid");
  return Object.freeze({
    kind: FENCE_KIND,
    receipt: record.receipt as unknown as PrivateLinuxConfirmedEnforcementReceipt,
  });
}

async function requirePlanMatches(
  projectRoot: string,
  plan: PrivateDirectRootPlanRecord,
  work: PrivateReacquiredRootExecutionWork,
  recipe: PrivateDirectRunRecipe,
  expectedMaterializationDigest: string,
): Promise<void> {
  const roots = await protectedWorkRoots(projectRoot);
  const hexadecimal = runHex(work.run.runId);
  if (plan.requestDigest !== work.intent.requestDigest ||
      plan.recipeDigest !== recipe.digest || plan.recipeDigest !== work.intent.recipeDigest ||
      plan.observationDigest !== recipe.observation.digest ||
      plan.observationDigest !== work.intent.observationDigest ||
      plan.cancellationGraceMs !== CANCELLATION_GRACE_MS ||
      plan.packageAllocation.parent.path !== roots.materializations ||
      plan.packageAllocation.name !== `root-${hexadecimal}` ||
      plan.packageAllocation.packageDigest !== expectedMaterializationDigest ||
      plan.packageAllocation.ownerToken !== work.lifecycle.allocation.digest ||
      plan.ownerAllocation.parent !== roots.owners ||
      plan.ownerAllocation.name !== `r-${hexadecimal.slice(0, 62)}` ||
      plan.effectiveDeadlineUnixMs !== Math.min(
        work.intent.deadlineUnixMs,
        plan.activationStartedUnixMs + recipe.wallClockCeilingMs,
      )) {
    throw new Error("durable direct root plan differs from its admitted recipe");
  }
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${label} digest is invalid`);
  }
  return value;
}

class FirstStop {
  terminal?: RunHostTerminal;
  deadlineUnixMs: number;
  private readonly enforcement = new AbortController();
  private startupEnforcement = true;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly abort = (): void => {
    this.terminal ??= failedPrivateRootTerminal("CANCELLED", "root Run was cancelled before dispatch");
    if (this.startupEnforcement && !this.enforcement.signal.aborted) {
      this.enforcement.abort(this.signal?.reason);
    }
  };

  constructor(private readonly signal: AbortSignal | undefined, deadlineUnixMs: number) {
    this.deadlineUnixMs = deadlineUnixMs;
    signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) this.abort();
    this.arm();
  }

  get enforcementSignal(): AbortSignal {
    return this.enforcement.signal;
  }

  releaseStartupEnforcement(): void {
    this.startupEnforcement = false;
  }

  narrow(deadlineUnixMs: number): void {
    if (!Number.isSafeInteger(deadlineUnixMs) || deadlineUnixMs < 0 || deadlineUnixMs > this.deadlineUnixMs) {
      throw new TypeError("effective root Run deadline is invalid");
    }
    this.deadlineUnixMs = deadlineUnixMs;
    this.arm();
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.signal?.removeEventListener("abort", this.abort);
  }

  private arm(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    const remaining = this.deadlineUnixMs - Date.now();
    if (remaining <= 0) {
      this.terminal ??= failedPrivateRootTerminal("DEADLINE_EXCEEDED", "root Run deadline elapsed before dispatch");
      if (this.startupEnforcement && !this.enforcement.signal.aborted) {
        this.enforcement.abort(this.terminal);
      }
      return;
    }
    this.timer = setTimeout(() => {
      this.terminal ??= failedPrivateRootTerminal("DEADLINE_EXCEEDED", "root Run deadline elapsed before dispatch");
      if (this.startupEnforcement && !this.enforcement.signal.aborted) {
        this.enforcement.abort(this.terminal);
      }
    }, remaining);
  }
}

type RootExecutionInput = Parameters<typeof executePrivateRootRunLaunch>[0];

function terminal(run: PrivateRootRunSnapshot): PrivateRootExecutionDisposition {
  return Object.freeze({ state: "terminal" as const, run });
}

function executionFailed(_error: unknown): RunHostTerminal {
  return failedPrivateRootTerminal("EXECUTION_FAILED", "root Run execution failed");
}

function isAdmissionStateBusy(error: unknown): error is CheckError {
  return error instanceof CheckError && error.code === "ADMISSION_STATE_BUSY";
}

function deadlineExceededTerminal(): RunHostTerminal {
  return failedPrivateRootTerminal(
    "DEADLINE_EXCEEDED",
    "root Run hard deadline elapsed before a terminal response",
  );
}

function terminalAfterConfirmedFence(
  error: unknown,
  fence: PrivateLinuxConfirmedEnforcementReceipt,
): RunHostTerminal {
  return fence.stopReason === "deadline" ? deadlineExceededTerminal() : executionFailed(error);
}

function terminalAfterRecoveredFence(
  fence: PrivateLinuxConfirmedEnforcementReceipt | undefined,
  fallbackError?: unknown,
): RunHostTerminal {
  // A receipt alone proves why the tree was fenced, not whether a response
  // had committed before that fence. Only this invocation's pre-response
  // error supplies enough ordering evidence for the typed deadline fallback.
  return fallbackError === undefined
    ? failedPrivateRootTerminal(
      "UNCERTAIN",
      "execution ownership was fenced after its in-memory result was lost",
    )
    : terminalAfterConfirmedFence(fallbackError, fence!);
}

function backendRunLabel(runId: string): string {
  return `root-${runHex(runId).slice(0, 43)}`;
}

function runHex(runId: string): string {
  const hexadecimal = runId.startsWith("sha256:") ? runId.slice(7) : "";
  if (!/^[0-9a-f]{64}$/.test(hexadecimal)) throw new TypeError("durable root Run ID is invalid");
  return hexadecimal;
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && (error as NodeJS.ErrnoException).code === code;
}
