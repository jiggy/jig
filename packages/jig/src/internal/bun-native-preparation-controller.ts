import { lstat, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { JsonValue } from "../json.js";

import { findPrivateActivationCandidateTargetV5 } from "./activation-admission.js";
import {
  allocatePrivateRootBunNativePreparation,
  claimPrivateRootBunNativePreparationLaunchAdmission,
  closePrivateRootBunNativePreparation,
  loadPrivateRootBunNativePreparation,
  reacquirePrivateRootExecutionWork,
  recordPrivateRootBunNativePreparationDispatch,
  recordPrivateRootBunNativePreparationFact,
  type PrivateProjectCoordinator,
  type PrivateRootBunNativePreparationAllocationResult,
  type PrivateRootBunNativePreparationSnapshot,
} from "./activation-admission-store.js";
import {
  requirePrivateRuntimeSupportObservation,
  type PrivateRuntimeSupportObservation,
} from "./agent-sandbox-runtime-support.js";
import {
  normalizePrivateBunNativePreparedCandidate,
} from "./bun-native-prepared-candidate.js";
import {
  publishPrivateBunNativePreparedTree,
} from "./bun-native-prepared-tree-store.js";
import {
  observePrivateBunNativePreparation,
  type PrivateBunNativePreparationObservation,
} from "./bun-native-preparation.js";
import {
  normalizePrivateRootBunNativePreparationAllocation,
  type PrivateRootBunNativePreparationOutcome,
} from "./bun-native-preparation-state.js";
import { privateDomainDigest, privateFileDigest } from "./identity.js";
import {
  PrivateLinuxFenceUnconfirmedError,
  cancelPrivateLinuxOwnerStateAllocation,
  planPrivateLinuxOwnerStateAllocation,
  releasePrivateLinuxOwnerState,
  requirePrivateLinuxCgroupBackend,
  type PrivateLinuxCgroupBackend,
  type PrivateLinuxComponentProcess,
  type PrivateLinuxConfirmedEnforcementReceipt,
} from "./linux-cgroup-backend.js";
import {
  captureStoredPackage,
  normalizePackageArtifactRef,
} from "./package-artifact-store.js";
import {
  allocatePrivatePackageMaterialization,
  disposePrivatePackageMaterializationLease,
  materializePrivatePackageLease,
  recoverPrivatePackageMaterializationAllocation,
} from "./package-materialization.js";

const WORKER_DESTINATION = "/jig-bun-native-preparation-worker.js";
const PACKAGE_DESTINATION = "/package";
const BUN_POLICY = Object.freeze([
  "--no-env-file",
  "--no-install",
  "--config=/dev/null",
] as const);
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const CANCELLATION_GRACE_MS = 1_000;
const RESOURCE_LIMITS = Object.freeze({
  memoryBytes: 512 * 1024 * 1024,
  pids: 64,
  cpuQuotaMicros: 50_000,
  cpuPeriodMicros: 100_000,
  cancellationGraceMs: CANCELLATION_GRACE_MS,
  cleanupTimeoutMs: 5_000,
});
const CONTROLLER_REVISION = "private-bun-native-preparation-controller/1";
const RUNTIME_PREDICATES = Object.freeze([
  "private-process-filesystem/1",
  "private-runtime-devices/1",
] as const);
const authenticControllerObservations = new WeakSet<object>();

export interface PrivateBunNativePreparationControllerObservation {
  readonly kind: "private-bun-native-preparation-controller-observation/1";
  readonly digest: string;
  readonly artifactDigest: string;
  readonly revision: typeof CONTROLLER_REVISION;
  readonly workerDestination: typeof WORKER_DESTINATION;
  readonly packageDestination: typeof PACKAGE_DESTINATION;
  readonly bunPolicy: typeof BUN_POLICY;
  readonly maxStdoutBytes: typeof MAX_STDOUT_BYTES;
  readonly maxStderrBytes: typeof MAX_STDERR_BYTES;
  readonly resourceLimits: typeof RESOURCE_LIMITS;
  readonly runtimePredicates: typeof RUNTIME_PREDICATES;
}

/** Pin the controller implementation and every fixed preparation policy input. */
export async function observePrivateBunNativePreparationController(
): Promise<PrivateBunNativePreparationControllerObservation> {
  const identity = Object.freeze({
    kind: "private-bun-native-preparation-controller-observation/1" as const,
    artifactDigest: await privateFileDigest(fileURLToPath(import.meta.url)),
    revision: CONTROLLER_REVISION,
    workerDestination: WORKER_DESTINATION,
    packageDestination: PACKAGE_DESTINATION,
    bunPolicy: BUN_POLICY,
    maxStdoutBytes: MAX_STDOUT_BYTES,
    maxStderrBytes: MAX_STDERR_BYTES,
    resourceLimits: RESOURCE_LIMITS,
    runtimePredicates: RUNTIME_PREDICATES,
  });
  const observation = Object.freeze({
    ...identity,
    digest: privateDomainDigest(
      "JIG-Private-Bun-Native-Preparation-Controller/1",
      identity as unknown as JsonValue,
    ),
  });
  authenticControllerObservations.add(observation);
  return observation;
}

export function requirePrivateBunNativePreparationControllerObservation(
  value: unknown,
): PrivateBunNativePreparationControllerObservation {
  if (value === null || typeof value !== "object" ||
      !authenticControllerObservations.has(value)) {
    throw new TypeError("Bun native preparation controller observation is not authentic");
  }
  return value as PrivateBunNativePreparationControllerObservation;
}

export type PrivateRootBunNativePreparationDisposition =
  | { readonly state: "terminal"; readonly snapshot: PrivateRootBunNativePreparationSnapshot }
  | { readonly state: "pending"; readonly reason: "fence-unconfirmed" | "in-progress" };

/**
 * Drive one exact root-owned Bun preparation. This is a concrete private
 * controller for the current proof host, not a runtime, installer, or Backend
 * extension point.
 */
export async function executePrivateRootBunNativePreparation(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly parentRunId: string;
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly workerBundlePath: string;
  readonly workerBundleDigest: string;
  readonly signal?: AbortSignal;
}): Promise<PrivateRootBunNativePreparationDisposition> {
  await input.coordinator.verify();
  const backend = requirePrivateLinuxCgroupBackend(input.backend);
  const existing = await loadOptional(input);
  if (existing !== undefined) return await recoverExisting(input, backend, existing);

  const work = await reacquireWork(input);
  const target = findPrivateActivationCandidateTargetV5(work.candidate, work.run.target);
  if (target === undefined || target.disposition.state !== "ready" ||
      target.request.digest !== work.intent.requestDigest) {
    throw new Error("root Bun native preparation parent differs from its pinned activation");
  }
  const request = target.request;
  const runtimeSupport = requirePrivateRuntimeSupportObservation(input.runtimeSupport);
  const roots = await protectedPreparationRoots(input.projectRoot);
  const [observation, mechanism, workerBundlePath, executableDigest] = await Promise.all([
    observePrivateBunNativePreparation({ request, packageStoreRoot: input.packageStoreRoot }),
    backend.observeMechanism(),
    realpath(input.workerBundlePath),
    privateFileDigest(runtimeSupport.executablePath),
  ]);
  const workerDigest = await privateFileDigest(workerBundlePath);
  if (workerDigest !== input.workerBundleDigest) {
    throw new Error("Bun native preparation worker no longer matches its host selection");
  }
  if (executableDigest !== runtimeSupport.executableDigest) {
    throw new Error("Bun native preparation runtime no longer matches retained host support");
  }
  // Root Administration already bounds this immutable deadline. Deriving a
  // second wall-clock value here would make exact allocation replay unstable.
  const deadlineUnixMs = work.intent.deadlineUnixMs;
  const allocation = normalizePrivateRootBunNativePreparationAllocation({
    kind: "private-root-bun-native-preparation-allocation/1",
    parentRunId: work.run.runId,
    coordinatorEpoch: input.coordinator.epoch,
    requestDigest: request.digest,
    packageDigest: request.package.digest,
    recipeObservationDigest: work.intent.observationDigest,
    preparationObservationDigest: observation.digest,
    dependencyDigest: observation.dependency.memberDigest,
    workerDigest,
    runtimeObservationDigest: runtimeSupport.digest,
    backendMechanismDigest: mechanism.digest,
    deadlineUnixMs,
  });
  const allocated = await exactRetry(async () => await allocatePrivateRootBunNativePreparation({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    allocation,
  }));
  if (!allocated.created) return await recoverExisting(input, backend, allocated.snapshot);
  if (input.signal?.aborted || deadlineUnixMs <= Date.now()) {
    return terminal(await settleWithoutPlan(
      input,
      allocated.snapshot,
      input.signal?.aborted ? "CANCELLED" : "DEADLINE_EXCEEDED",
      input.signal?.aborted
        ? "Bun native preparation was cancelled before planning"
        : "Bun native preparation deadline elapsed before planning",
    ));
  }
  return await executeCreated({
    ...input,
    backend,
    allocated,
    observation,
    runtimeSupport,
    workerBundlePath,
    workerBundleDigest: input.workerBundleDigest,
    roots,
  });
}

/** Recover an already allocated preparation without requiring launch machinery to remain installed. */
export async function recoverPrivateRootBunNativePreparation(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly parentRunId: string;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly signal?: AbortSignal;
}): Promise<PrivateRootBunNativePreparationDisposition | null> {
  await input.coordinator.verify();
  const backend = requirePrivateLinuxCgroupBackend(input.backend);
  const existing = await loadOptional({ ...input, backend });
  if (existing === undefined) return null;
  return await recoverExisting({ ...input, backend }, backend, existing);
}

async function executeCreated(input: ControllerInput & {
  readonly allocated: PrivateRootBunNativePreparationAllocationResult;
  readonly observation: PrivateBunNativePreparationObservation;
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly workerBundlePath: string;
  readonly workerBundleDigest: string;
  readonly roots: PreparationRoots;
}): Promise<PrivateRootBunNativePreparationDisposition> {
  let snapshot = input.allocated.snapshot;
  const hexadecimal = input.parentRunId.slice("sha256:".length);
  try {
    const [packageAllocation, ownerAllocation] = await Promise.all([
      allocatePrivatePackageMaterialization({
        protectedParent: input.roots.materializations,
        name: `bun-${hexadecimal}`,
        packageDigest: snapshot.allocation.packageDigest,
        ownerToken: snapshot.allocationDigest,
      }),
      planPrivateLinuxOwnerStateAllocation({
        parent: input.roots.owners,
        name: `b-${hexadecimal.slice(0, 62)}`,
      }),
    ]);
    snapshot = await fact(input, "plan", {
      kind: "private-root-bun-native-preparation-plan/1",
      backendRunId: `bun-${hexadecimal.slice(0, 40)}`,
      cancellationGraceMs: CANCELLATION_GRACE_MS,
      packageAllocation,
      ownerAllocation,
    });
    if (input.signal?.aborted || snapshot.allocation.deadlineUnixMs <= Date.now()) {
      snapshot = await cancelBeforeDispatch(
        input,
        snapshot,
        input.signal?.aborted ? "cancelled" : "deadline",
      );
      return terminal(await releaseAndClose(input, snapshot));
    }

    const captured = await captureStoredPackage(input.packageStoreRoot, normalizePackageArtifactRef({
      kind: "flow-package/1",
      digest: snapshot.allocation.packageDigest,
    }));
    let lease;
    try {
      lease = await materializePrivatePackageLease(captured, packageAllocation);
    } finally {
      await captured.dispose();
    }
    snapshot = await fact(input, "backing", {
      kind: "private-root-bun-native-preparation-backing/1",
      planDigest: snapshot.plan!.digest,
      lease: lease.identity,
    });

    const afterBackingStop = preDispatchStop(input, snapshot);
    if (afterBackingStop !== undefined) {
      snapshot = await cancelBeforeDispatch(input, snapshot, afterBackingStop);
      return terminal(await releaseAndClose(input, snapshot));
    }

    await revalidateEvidence(input, snapshot);
    const sealed = await input.backend.seal({
      runId: snapshot.plan!.value.backendRunId,
      limits: { ...RESOURCE_LIMITS, deadlineUnixMs: snapshot.allocation.deadlineUnixMs },
      readOnlyMounts: [
        ...input.runtimeSupport.closureSources.map((source) => ({ source, destination: source })),
        { source: lease.root, destination: PACKAGE_DESTINATION },
        { source: input.workerBundlePath, destination: WORKER_DESTINATION },
      ],
      privateProcessFilesystem: true,
      privateRuntimeDevices: true,
      command: [
        input.runtimeSupport.executablePath,
        ...BUN_POLICY,
        WORKER_DESTINATION,
        "--archive",
        `${PACKAGE_DESTINATION}/${input.observation.dependency.memberPath}`,
      ],
      environment: {},
    }, ownerAllocation);
    snapshot = await fact(input, "sandbox", {
      kind: "private-root-bun-native-preparation-sandbox/1",
      backingDigest: snapshot.backing!.digest,
      owner: sealed.identity,
    });
    const afterSealingStop = preDispatchStop(input, snapshot);
    if (afterSealingStop !== undefined) {
      snapshot = await cancelBeforeDispatch(input, snapshot, afterSealingStop);
      return terminal(await releaseAndClose(input, snapshot));
    }
    const dispatched = await recordDispatch(input, input.allocated);
    if (!dispatched.created || dispatched.launchAdmission === undefined) {
      return await recoverExisting(input, input.backend, dispatched.snapshot, undefined, true);
    }
    snapshot = dispatched.snapshot;
    let componentPromise: Promise<PrivateLinuxComponentProcess> | undefined;
    let claimFailure: unknown;
    for (let attempt = 1; attempt <= 3 && componentPromise === undefined; attempt += 1) {
      try {
        await claimPrivateRootBunNativePreparationLaunchAdmission({
          launchAdmission: dispatched.launchAdmission,
          begin: () => {
            componentPromise = sealed.admit(input.signal, async (prepared) => {
              await fact(input, "prepared", {
                kind: "private-root-bun-native-preparation-prepared/1",
                dispatchDigest: dispatched.snapshot.dispatch!.digest,
                prepared,
              });
            });
          },
        });
      } catch (error) {
        claimFailure ??= error;
        // Once begin ran, even a later acknowledgement failure is a possible
        // dispatch. Never invoke the one-shot token again.
        if (componentPromise !== undefined) throw error;
        if (attempt < 3) await new Promise<void>((resolve) => setTimeout(resolve, attempt * 10));
      }
    }
    if (componentPromise === undefined && claimFailure !== undefined) throw claimFailure;
    if (componentPromise === undefined) throw new Error("preparation launch did not begin");
    return await observeComponent(input, snapshot, input.observation, componentPromise);
  } catch (error) {
    const current = await loadRequired(input);
    if (error instanceof PrivateLinuxFenceUnconfirmedError) return pending();
    return await recoverExisting(input, input.backend, current, error, true);
  }
}

async function observeComponent(
  input: ExecutionControllerInput,
  initial: PrivateRootBunNativePreparationSnapshot,
  observation: PrivateBunNativePreparationObservation,
  componentPromise: Promise<PrivateLinuxComponentProcess>,
): Promise<PrivateRootBunNativePreparationDisposition> {
  let component: PrivateLinuxComponentProcess;
  try {
    component = await componentPromise;
  } catch (error) {
    return await recoverExisting(input, input.backend, await loadRequired(input), error, true);
  }
  const terminate = async (): Promise<void> => await component.terminate();
  const stdout = collectBounded(component.stdout, MAX_STDOUT_BYTES, "stdout", terminate);
  const stderr = collectBounded(component.stderr, MAX_STDERR_BYTES, "stderr", terminate);
  void stdout.catch(() => undefined);
  void stderr.catch(() => undefined);
  let receipt: PrivateLinuxConfirmedEnforcementReceipt;
  try {
    await component.closeInput();
    receipt = await component.enforcement;
  } catch (error) {
    await component.terminate().catch(() => undefined);
    try { receipt = await input.backend.recoverFence(initial.sandbox!.value.owner); }
    catch (fenceError) {
      await Promise.allSettled([stdout, stderr]);
      if (fenceError instanceof PrivateLinuxFenceUnconfirmedError) return pending();
      throw new AggregateError([error, fenceError], "preparation fence recovery failed");
    }
  }
  let snapshot = await recordEnforcementFence(input, await loadRequired(input), receipt);
  const outputs = await Promise.allSettled([stdout, stderr]);
  let outcome: PrivateRootBunNativePreparationOutcome;
  const stderrBytes = outputs[1].status === "fulfilled" ? outputs[1].value : new Uint8Array();
  const outputError = outputs[0].status === "rejected"
    ? outputs[0].reason
    : outputs[1].status === "rejected" ? outputs[1].reason : undefined;
  if (input.signal?.aborted && receipt.stopReason === "cancelled") {
    outcome = failedOutcome(snapshot, "CANCELLED", "Bun native preparation was cancelled");
  } else if (receipt.stopReason === "deadline") {
    outcome = failedOutcome(snapshot, "DEADLINE_EXCEEDED", "Bun native preparation deadline elapsed");
  } else if (outputError instanceof PrivatePreparationOutputLimitError) {
    outcome = failedOutcome(snapshot, "INVALID_RESULT", outputError.message);
  } else if (receipt.stopReason !== "payload_exit" || receipt.exitCode !== 0 || receipt.signal !== null) {
    outcome = failedOutcome(snapshot, receiptOutcomeCode(receipt),
      `Bun native preparation did not succeed: ${diagnostic(stderrBytes)}`);
  } else if (outputs[0].status === "rejected" || outputs[1].status === "rejected") {
    outcome = failedOutcome(
      snapshot,
      "INVALID_RESULT",
      boundedMessage(outputError ?? new Error("output collection failed")),
    );
  } else {
    try {
      await revalidateObservedExecution(input, snapshot, observation);
      const candidate = normalizePrivateBunNativePreparedCandidate(observation, outputs[0].value);
      outcome = {
        status: "succeeded",
        preparedDigest: snapshot.prepared!.digest,
        fenceDigest: snapshot.fence!.digest,
        candidateDigest: candidate.digest,
        candidateBytesBase64: Buffer.from(outputs[0].value).toString("base64"),
      };
    } catch (error) {
      outcome = failedOutcome(snapshot, "INVALID_RESULT", boundedMessage(error));
    }
  }
  snapshot = await fact(input, "outcome", outcome);
  if (outcome.status === "succeeded") {
    snapshot = await publishArtifact(input, snapshot, observation);
  }
  return terminal(await releaseAndClose(input, snapshot));
}

async function recoverExisting(
  input: ControllerInput,
  backend: PrivateLinuxCgroupBackend,
  initial: PrivateRootBunNativePreparationSnapshot,
  cause?: unknown,
  mayRecoverCurrent = false,
): Promise<PrivateRootBunNativePreparationDisposition> {
  let snapshot = initial;
  if (snapshot.closure !== undefined) return terminal(snapshot);
  if (snapshot.coordinator === "current" && !mayRecoverCurrent) {
    return Object.freeze({ state: "pending", reason: "in-progress" });
  }
  if (snapshot.plan === undefined) {
    if (snapshot.outcome === undefined) {
      const deadlineElapsed = snapshot.allocation.deadlineUnixMs <= Date.now();
      snapshot = await fact(input, "outcome", failedOutcome(
        snapshot,
        input.signal?.aborted ? "CANCELLED"
          : deadlineElapsed ? "DEADLINE_EXCEEDED" : "EXECUTION_FAILED",
        input.signal?.aborted
          ? "Bun native preparation was cancelled before planning"
          : deadlineElapsed
            ? "Bun native preparation deadline elapsed before planning"
            : "Bun native preparation stopped before planning",
      ));
    }
    return terminal(await releaseAndClose(input, snapshot));
  }
  if (snapshot.fence === undefined) {
    if (snapshot.dispatch === undefined) {
      const reason = input.signal?.aborted
        ? "cancelled"
        : snapshot.allocation.deadlineUnixMs <= Date.now() ? "deadline" : "setup_failed";
      try { snapshot = await cancelBeforeDispatch(input, snapshot, reason); }
      catch (error) {
        if (error instanceof PrivateLinuxFenceUnconfirmedError) return pending();
        throw error;
      }
    } else {
      if (snapshot.sandbox === undefined) throw new Error("dispatched preparation has no sandbox");
      let receipt: PrivateLinuxConfirmedEnforcementReceipt;
      try { receipt = await backend.recoverFence(snapshot.sandbox.value.owner); }
      catch (error) {
        if (error instanceof PrivateLinuxFenceUnconfirmedError) return pending();
        throw error;
      }
      snapshot = await recordEnforcementFence(input, snapshot, receipt);
    }
  }
  if (snapshot.outcome === undefined) {
    const proof = snapshot.fence!.value.proof;
    const code = proof.kind === "allocation-cancelled"
      ? cancellationOutcomeCode(proof.reason)
      : receiptOutcomeCode(proof.receipt);
    snapshot = await fact(input, "outcome", failedOutcome(
      snapshot,
      code,
      cause === undefined
        ? snapshot.dispatch === undefined
          ? "Bun native preparation ended before dispatch"
          : "Bun native preparation result was not durably observed"
        : boundedMessage(cause),
    ));
  }
  const retainedOutcome = snapshot.outcome?.value;
  if (retainedOutcome?.status === "succeeded" && snapshot.artifact === undefined) {
    const work = await reacquireWork(input);
    const target = findPrivateActivationCandidateTargetV5(work.candidate, work.run.target);
    if (target === undefined || target.request.digest !== snapshot.allocation.requestDigest) {
      throw new Error("successful preparation lost its pinned activation request");
    }
    const observation = await observePrivateBunNativePreparation({
      request: target.request,
      packageStoreRoot: input.packageStoreRoot,
    });
    if (observation.digest !== snapshot.allocation.preparationObservationDigest) {
      throw new Error("successful preparation observation changed before publication");
    }
    snapshot = await publishArtifact(input, snapshot, observation);
  }
  return terminal(await releaseAndClose(input, snapshot));
}

async function publishArtifact(
  input: ControllerInput,
  snapshot: PrivateRootBunNativePreparationSnapshot,
  observation: PrivateBunNativePreparationObservation,
): Promise<PrivateRootBunNativePreparationSnapshot> {
  const outcome = snapshot.outcome!.value;
  if (outcome.status !== "succeeded") return snapshot;
  const candidate = normalizePrivateBunNativePreparedCandidate(
    observation,
    Buffer.from(outcome.candidateBytesBase64, "base64"),
  );
  const reference = await publishPrivateBunNativePreparedTree({
    preparedStoreRoot: input.packageStoreRoot,
    packageStoreRoot: input.packageStoreRoot,
    observation,
    candidate,
  });
  return await fact(input, "artifact", {
    kind: "private-root-bun-native-preparation-artifact/1",
    outcomeDigest: snapshot.outcome!.digest,
    reference,
  });
}

async function cancelBeforeDispatch(
  input: ControllerInput,
  snapshot: PrivateRootBunNativePreparationSnapshot,
  reason: "cancelled" | "deadline" | "setup_failed",
): Promise<PrivateRootBunNativePreparationSnapshot> {
  const cancellation = await cancelPrivateLinuxOwnerStateAllocation(snapshot.plan!.value.ownerAllocation);
  snapshot = await fact(input, "fence", {
    kind: "private-root-bun-native-preparation-fence/1",
    planDigest: snapshot.plan!.digest,
    proof: { kind: "allocation-cancelled", reason, cancellation },
  });
  snapshot = await fact(input, "outcome", failedOutcome(
    snapshot,
    cancellationOutcomeCode(reason),
    reason === "cancelled"
      ? "Bun native preparation was cancelled before dispatch"
      : reason === "deadline"
        ? "Bun native preparation deadline elapsed before dispatch"
        : "Bun native preparation setup failed before dispatch",
  ));
  return snapshot;
}

async function recordEnforcementFence(
  input: ControllerInput,
  snapshot: PrivateRootBunNativePreparationSnapshot,
  receipt: PrivateLinuxConfirmedEnforcementReceipt,
): Promise<PrivateRootBunNativePreparationSnapshot> {
  return await fact(input, "fence", {
    kind: "private-root-bun-native-preparation-fence/1",
    planDigest: snapshot.plan!.digest,
    proof: {
      kind: "enforcement-confirmed",
      sandboxDigest: snapshot.sandbox!.digest,
      receipt,
    },
  });
}

async function releaseAndClose(
  input: ControllerInput,
  initial: PrivateRootBunNativePreparationSnapshot,
): Promise<PrivateRootBunNativePreparationSnapshot> {
  let snapshot = initial;
  if (snapshot.release === undefined) {
    if (snapshot.plan !== undefined && snapshot.fence === undefined) {
      throw new PrivateLinuxFenceUnconfirmedError(
        new Error("preparation resources cannot be released before fencing"),
      );
    }
    if (snapshot.backing !== undefined) {
      await disposePrivatePackageMaterializationLease(
        snapshot.plan!.value.packageAllocation.parent.path,
        snapshot.backing.value.lease,
      );
    } else if (snapshot.plan !== undefined) {
      const recovered = await recoverPrivatePackageMaterializationAllocation(
        snapshot.plan.value.packageAllocation.parent.path,
        snapshot.plan.value.packageAllocation,
      );
      if (recovered.state === "complete") {
        await disposePrivatePackageMaterializationLease(
          snapshot.plan.value.packageAllocation.parent.path,
          recovered.lease.identity,
        );
      }
    }
    let ownerRelease = null;
    if (snapshot.plan !== undefined) {
      const proof = snapshot.fence!.value.proof;
      ownerRelease = proof.kind === "allocation-cancelled"
        ? await releasePrivateLinuxOwnerState(snapshot.plan.value.ownerAllocation, proof.cancellation)
        : await releasePrivateLinuxOwnerState(snapshot.sandbox!.value.owner, proof.receipt);
    }
    snapshot = await fact(input, "release", {
      kind: "private-root-bun-native-preparation-release/1",
      outcomeDigest: snapshot.outcome!.digest,
      planDigest: snapshot.plan?.digest ?? null,
      backingDigest: snapshot.backing?.digest ?? null,
      fenceDigest: snapshot.fence?.digest ?? null,
      artifactDigest: snapshot.artifact?.digest ?? null,
      packageReleased: true,
      ownerRelease,
    });
  }
  let first: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await closePrivateRootBunNativePreparation({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        parentRunId: input.parentRunId,
      });
    } catch (error) {
      first ??= error;
      if (attempt < 3) await new Promise<void>((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
  throw first;
}

async function settleWithoutPlan(
  input: ControllerInput,
  snapshot: PrivateRootBunNativePreparationSnapshot,
  code: "CANCELLED" | "DEADLINE_EXCEEDED" | "EXECUTION_FAILED",
  message: string,
): Promise<PrivateRootBunNativePreparationSnapshot> {
  snapshot = await fact(input, "outcome", failedOutcome(snapshot, code, message));
  return await releaseAndClose(input, snapshot);
}

async function revalidateEvidence(
  input: ControllerInput & {
    readonly runtimeSupport: PrivateRuntimeSupportObservation;
    readonly workerBundlePath: string;
  },
  snapshot: PrivateRootBunNativePreparationSnapshot,
): Promise<void> {
  const [mechanism, executableDigest, workerDigest] = await Promise.all([
    input.backend.observeMechanism(),
    privateFileDigest(input.runtimeSupport.executablePath),
    privateFileDigest(input.workerBundlePath),
  ]);
  if (mechanism.digest !== snapshot.allocation.backendMechanismDigest ||
      input.runtimeSupport.digest !== snapshot.allocation.runtimeObservationDigest ||
      executableDigest !== input.runtimeSupport.executableDigest ||
      workerDigest !== snapshot.allocation.workerDigest) {
    throw new Error("Bun native preparation host evidence changed before sealing");
  }
}

async function revalidateObservedExecution(
  input: ExecutionControllerInput,
  snapshot: PrivateRootBunNativePreparationSnapshot,
  observation: PrivateBunNativePreparationObservation,
): Promise<void> {
  const runtime = requirePrivateRuntimeSupportObservation(input.runtimeSupport);
  const [mechanism, executableDigest, workerPath] = await Promise.all([
    input.backend.observeMechanism(),
    privateFileDigest(runtime.executablePath),
    realpath(input.workerBundlePath),
  ]);
  const workerDigest = await privateFileDigest(workerPath);
  if (observation.digest !== snapshot.allocation.preparationObservationDigest ||
      mechanism.digest !== snapshot.allocation.backendMechanismDigest ||
      runtime.digest !== snapshot.allocation.runtimeObservationDigest ||
      executableDigest !== runtime.executableDigest ||
      workerDigest !== snapshot.allocation.workerDigest) {
    throw new Error("Bun native preparation evidence changed during execution");
  }
}

async function fact<Name extends Exclude<
  Parameters<typeof recordPrivateRootBunNativePreparationFact>[0]["fact"],
  "dispatch"
>>(
  input: ControllerInput,
  name: Name,
  value: Parameters<typeof recordPrivateRootBunNativePreparationFact<Name>>[0]["value"],
): Promise<PrivateRootBunNativePreparationSnapshot> {
  let first: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await recordPrivateRootBunNativePreparationFact({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        parentRunId: input.parentRunId,
        fact: name,
        value,
      });
    } catch (error) {
      first ??= error;
      if (attempt < 3) await new Promise<void>((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
  throw first;
}

async function loadRequired(input: ControllerInput): Promise<PrivateRootBunNativePreparationSnapshot> {
  const snapshot = await loadOptional(input);
  if (snapshot === undefined) throw new Error("root Bun native preparation disappeared");
  return snapshot;
}

async function loadOptional(
  input: ControllerInput,
): Promise<PrivateRootBunNativePreparationSnapshot | undefined> {
  return await exactRetry(async () => await loadPrivateRootBunNativePreparation({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parentRunId,
  }));
}

async function reacquireWork(input: ControllerInput) {
  return await exactRetry(async () => await reacquirePrivateRootExecutionWork({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    packageStoreRoot: input.packageStoreRoot,
    runId: input.parentRunId,
  }));
}

async function exactRetry<Value>(operation: () => Promise<Value>): Promise<Value> {
  let first: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      first ??= error;
      if (attempt < 3) await new Promise<void>((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
  throw first;
}

async function recordDispatch(
  input: ControllerInput,
  allocation: PrivateRootBunNativePreparationAllocationResult,
): Promise<Awaited<ReturnType<typeof recordPrivateRootBunNativePreparationDispatch>>> {
  let first: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await recordPrivateRootBunNativePreparationDispatch({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        allocation,
      });
    } catch (error) {
      first ??= error;
      if (attempt < 3) await new Promise<void>((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
  throw first;
}

function failedOutcome(
  snapshot: PrivateRootBunNativePreparationSnapshot,
  code: Extract<PrivateRootBunNativePreparationOutcome, { status: "failed" }>["code"],
  message: string,
): Extract<PrivateRootBunNativePreparationOutcome, { status: "failed" }> {
  return Object.freeze({
    status: "failed",
    code,
    message: boundedMessage(message),
    dispatchDigest: snapshot.dispatch?.digest ?? null,
    fenceDigest: snapshot.fence?.digest ?? null,
  });
}

function receiptOutcomeCode(
  receipt: PrivateLinuxConfirmedEnforcementReceipt,
): Extract<PrivateRootBunNativePreparationOutcome, { status: "failed" }>["code"] {
  return receipt.stopReason === "deadline" ? "DEADLINE_EXCEEDED"
    : receipt.stopReason === "cancelled" ? "CANCELLED"
      : receipt.stopReason === "coordinator_lost" || receipt.stopReason === "recovered" ||
          (receipt.stopReason === "payload_exit" && receipt.exitCode === 0 && receipt.signal === null)
        ? "UNCERTAIN"
        : "EXECUTION_FAILED";
}

function preDispatchStop(
  input: ControllerInput,
  snapshot: PrivateRootBunNativePreparationSnapshot,
): "cancelled" | "deadline" | undefined {
  return input.signal?.aborted ? "cancelled"
    : snapshot.allocation.deadlineUnixMs <= Date.now() ? "deadline" : undefined;
}

function cancellationOutcomeCode(
  reason: "cancelled" | "deadline" | "setup_failed",
): "CANCELLED" | "DEADLINE_EXCEEDED" | "EXECUTION_FAILED" {
  return reason === "cancelled" ? "CANCELLED"
    : reason === "deadline" ? "DEADLINE_EXCEEDED" : "EXECUTION_FAILED";
}

async function protectedPreparationRoots(projectRoot: string): Promise<PreparationRoots> {
  const state = await realpath(join(projectRoot, ".jig"));
  const roots = {
    materializations: join(state, "private-root-materializations"),
    owners: join(state, "private-root-linux-owners"),
  };
  await Promise.all(Object.values(roots).map(ensureProtectedDirectory));
  return Object.freeze(roots);
}

async function ensureProtectedDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700 }).catch((error) => {
    if (!hasCode(error, "EEXIST")) throw error;
  });
  const information = await lstat(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (!information.isDirectory() || information.isSymbolicLink() || information.uid !== uid ||
      (information.mode & 0o777) !== 0o700 || await realpath(path) !== path) {
    throw new Error("private Bun preparation work directory is not protected");
  }
}

async function collectBounded(
  source: AsyncIterable<Uint8Array>,
  maximum: number,
  label: string,
  terminate: () => Promise<void>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  try {
    for await (const value of source) {
      if (overflow) continue;
      if (value.byteLength > maximum - total) {
        overflow = true;
        await terminate();
      } else {
        total += value.byteLength;
        chunks.push(Buffer.from(value));
      }
    }
  } catch (error) {
    await terminate().catch(() => undefined);
    throw error;
  }
  if (overflow) throw new PrivatePreparationOutputLimitError(label);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

class PrivatePreparationOutputLimitError extends Error {
  constructor(label: string) {
    super(`Bun native preparation ${label} exceeds its byte bound`);
    this.name = "PrivatePreparationOutputLimitError";
  }
}

function diagnostic(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
  return text.length === 0 ? "no diagnostic" : text.replace(/[\r\n]+/g, " ").slice(0, 2_048);
}

function boundedMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return Array.from(message).slice(0, 4_096).join("");
}

function terminal(snapshot: PrivateRootBunNativePreparationSnapshot): PrivateRootBunNativePreparationDisposition {
  return Object.freeze({ state: "terminal", snapshot });
}

function pending(): PrivateRootBunNativePreparationDisposition {
  return Object.freeze({ state: "pending", reason: "fence-unconfirmed" });
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error &&
    (error as { readonly code?: unknown }).code === code;
}

type ExecutionControllerInput = Parameters<typeof executePrivateRootBunNativePreparation>[0] & {
  readonly backend: PrivateLinuxCgroupBackend;
};

type ControllerInput = Omit<
  ExecutionControllerInput,
  "runtimeSupport" | "workerBundlePath" | "workerBundleDigest"
>;

interface PreparationRoots {
  readonly materializations: string;
  readonly owners: string;
}
