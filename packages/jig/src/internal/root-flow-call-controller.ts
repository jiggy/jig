import { lstat, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { CheckError } from "../diagnostics.js";
import type { JsonValue } from "../json.js";
import { inspectCapturedPackage } from "../package/inspect.js";
import { SchemaDiagnostic } from "../schema/index.js";
import {
  RunHostSession,
  type RunHostFlowCall,
  type RunHostOperationTerminal,
  type RunHostTerminal,
} from "../run/session.js";
import {
  allocatePrivateRootFlowCall,
  closePrivateRootFlowCall,
  loadPrivateRootFlowCall,
  recordPrivateRootFlowCallCheckpoint,
  type PrivateProjectCoordinator,
  type PrivateReacquiredRootExecutionWork,
} from "./activation-admission-store.js";
import { findPrivateActivationCandidateTarget } from "./activation-admission.js";
import type { PrivateBunDirectRecipe } from "./bun-direct-run.js";
import {
  planPrivateDirectRun,
  type PrivateDirectRunRecipe,
  type PrivateDirectRunRuntimeSupport,
} from "./direct-run.js";
import { privateFileDigest } from "./identity.js";
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
} from "./linux-cgroup-backend.js";
import { captureStoredPackage } from "./package-artifact-store.js";
import {
  allocatePrivatePackageMaterialization,
  disposePrivatePackageMaterializationLease,
  materializePrivatePackageLease,
  reacquirePrivatePackageMaterializationLease,
  recoverPrivatePackageMaterializationAllocation,
  type PrivatePackageMaterializationAllocationIdentity,
  type PrivatePackageMaterializationLease,
  type PrivatePackageMaterializationLeaseIdentity,
} from "./package-materialization.js";
import { admitPrivatePackageResult } from "./package-result-admission.js";
import {
  normalizePrivateRootFlowCallAllocation,
  type PrivateRootFlowCallCheckpointName,
  type PrivateRootFlowCallLifecycle,
} from "./root-flow-call-state.js";
import { failedPrivateRootTerminal, normalizePrivateRootTerminal } from "./root-run-state.js";

const PLAN_KIND = "private-root-flow-call-plan/1";
const BACKING_KIND = "private-root-flow-call-backing/1";
const SANDBOX_KIND = "private-root-flow-call-sandbox/1";
const PREPARED_KIND = "private-root-flow-call-prepared/1";
const FENCE_KIND = "private-root-flow-call-fence/1";
const RELEASE_KIND = "private-root-flow-call-release/1";
const CANCELLATION_GRACE_MS = 1_000;
const BUN_POLICY = Object.freeze(["--no-env-file", "--no-install", "--config=/dev/null"] as const);

interface ChildPlan {
  readonly kind: typeof PLAN_KIND;
  readonly requestDigest: string;
  readonly recipeDigest: string;
  readonly observationDigest: string;
  readonly effectiveDeadlineUnixMs: number;
  readonly cancellationGraceMs: number;
  readonly packageAllocation: PrivatePackageMaterializationAllocationIdentity;
  readonly ownerAllocation: PrivateLinuxOwnerStateAllocationIdentity;
}

interface ChildBacking {
  readonly kind: typeof BACKING_KIND;
  readonly lease: PrivatePackageMaterializationLeaseIdentity;
}

interface ChildSandbox {
  readonly kind: typeof SANDBOX_KIND;
  readonly owner: PrivateLinuxSealedOwnerIdentity;
}

interface ChildFence {
  readonly kind: typeof FENCE_KIND;
  readonly receipt: PrivateLinuxConfirmedEnforcementReceipt;
}

interface ChildInput {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly parent: PrivateReacquiredRootExecutionWork;
  readonly coordinator: PrivateProjectCoordinator;
  readonly runtimeSupport: PrivateDirectRunRuntimeSupport;
  readonly backend: PrivateLinuxCgroupBackend;
}

/** Execute the one exact child selected by the parent Binding's pinned slot. */
export async function executePrivateRootFlowCall(
  input: ChildInput & {
    readonly call: RunHostFlowCall;
    readonly parentDeadlineUnixMs: number;
    readonly signal: AbortSignal;
  },
): Promise<RunHostOperationTerminal> {
  let allocated = false;
  try {
    const selected = selectChild(input.parent, input.call);
    const recipe = await planPrivateDirectRun({
      request: selected.request,
      runtimeSupport: input.runtimeSupport,
      backend: input.backend,
    });
    if (recipe.digest !== selected.recipeDigest ||
        recipe.observation.digest !== selected.observationDigest) {
      throw new Error("current host mechanisms do not reproduce the admitted child recipe");
    }
    const effectiveDeadlineUnixMs = Math.min(
      input.parentDeadlineUnixMs,
      Date.now() + recipe.wallClockCeilingMs,
    );
    const lifecycle = await allocatePrivateRootFlowCall({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      allocation: normalizePrivateRootFlowCallAllocation({
        kind: "private-root-flow-call-allocation/1",
        parentRunId: input.parent.run.runId,
        coordinatorEpoch: input.parent.run.coordinatorEpoch,
        call: input.call,
        target: selected.request.target,
        requestDigest: selected.request.digest,
        recipeDigest: recipe.digest,
        observationDigest: recipe.observation.digest,
        effectiveDeadlineUnixMs,
      }),
    });
    allocated = true;
    if (lifecycle.closureDigest !== undefined) return operationTerminal(lifecycle);
    if (hasExecutionWork(lifecycle)) {
      return operationTerminal(await recoverPrivateRootFlowCall(input));
    }
    const invalidInput = await validateChildInput(input.packageStoreRoot, recipe, input.call.input);
    if (invalidInput !== undefined) {
      return operationTerminal(await settleWithoutPlan(input, invalidInput));
    }
    if (input.signal.aborted) {
      return operationTerminal(await settleWithoutPlan(
        input,
        failedPrivateRootTerminal("CANCELLED", "child Flow call was cancelled before activation"),
      ));
    }
    if (Date.now() >= effectiveDeadlineUnixMs) {
      return operationTerminal(await settleWithoutPlan(
        input,
        failedPrivateRootTerminal("DEADLINE_EXCEEDED", "child Flow deadline elapsed before activation"),
      ));
    }
    return operationTerminal(await runChild(input, recipe));
  } catch (error) {
    if (error instanceof PrivateLinuxFenceUnconfirmedError) throw error;
    if (!allocated) return preallocationFailure(error);
    const terminal = executionFailure(error);
    return operationTerminal(await recoverPrivateRootFlowCall(input, terminal));
  }
}

/**
 * Fence and close any allocated child before the parent can publish or release
 * its own terminal. No child package code is ever replayed here.
 */
export async function recoverPrivateRootFlowCall(
  input: ChildInput,
  knownTerminal?: RunHostTerminal,
): Promise<PrivateRootFlowCallLifecycle> {
  let lifecycle = await load(input);
  if (lifecycle === undefined) {
    if (knownTerminal !== undefined) throw new Error("child terminal exists without a durable allocation");
    throw new Error("root Run has no allocated child Flow call");
  }
  if (lifecycle.closureDigest !== undefined) return lifecycle;

  let fence = lifecycle.fence === undefined ? undefined : parseFence(lifecycle.fence.value).receipt;
  if (lifecycle.sandbox !== undefined && fence === undefined) {
    fence = await input.backend.recoverFence(parseSandbox(lifecycle.sandbox.value).owner);
    lifecycle = await record(input, "fence", {
      kind: FENCE_KIND,
      receipt: fence,
    } as unknown as JsonValue);
  }
  if (lifecycle.provisional === undefined) {
    lifecycle = await record(input, "provisional", (
      knownTerminal ?? failedPrivateRootTerminal(
        "UNCERTAIN",
        "the child Flow coordinator disappeared before an independently proved result",
      )
    ) as unknown as JsonValue);
  }
  lifecycle = await releaseChild(input, lifecycle);
  if (lifecycle.admitted === undefined) {
    const provisional = requireTerminal(lifecycle.provisional!.value);
    const admitted = provisional.status === "succeeded"
      ? await admitChildResult(input, lifecycle, provisional)
      : provisional;
    lifecycle = await record(input, "admitted", admitted as unknown as JsonValue);
  }
  return await closePrivateRootFlowCall({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  });
}

/** Close a child if present; absence is a valid parent with no Flow call. */
export async function closePrivateRootFlowCallBeforeParent(
  input: ChildInput,
): Promise<string | null> {
  const lifecycle = await load(input);
  if (lifecycle === undefined) return null;
  const closed = lifecycle.closureDigest === undefined
    ? await recoverPrivateRootFlowCall(input)
    : lifecycle;
  return closed.closureDigest!;
}

async function runChild(
  input: ChildInput & { readonly signal: AbortSignal },
  recipe: PrivateDirectRunRecipe,
): Promise<PrivateRootFlowCallLifecycle> {
  let lifecycle = (await load(input))!;
  const roots = await protectedWorkRoots(input.projectRoot);
  const hexadecimal = lifecycle.allocationDigest.slice("sha256:".length);
  const packageAllocation = await allocatePrivatePackageMaterialization({
    protectedParent: roots.materializations,
    name: `child-${hexadecimal}`,
    packageDigest: recipe.request.package.digest,
    ownerToken: lifecycle.allocationDigest,
  });
  const ownerAllocation = await planPrivateLinuxOwnerStateAllocation({
    parent: roots.owners,
    name: `c-${hexadecimal.slice(0, 62)}`,
  });
  const plan: ChildPlan = Object.freeze({
    kind: PLAN_KIND,
    requestDigest: recipe.request.digest,
    recipeDigest: recipe.digest,
    observationDigest: recipe.observation.digest,
    effectiveDeadlineUnixMs: lifecycle.allocation.effectiveDeadlineUnixMs,
    cancellationGraceMs: CANCELLATION_GRACE_MS,
    packageAllocation,
    ownerAllocation,
  });
  lifecycle = await record(input, "plan", plan as unknown as JsonValue);

  let lease: PrivatePackageMaterializationLease;
  const captured = await captureStoredPackage(input.packageStoreRoot, recipe.request.package);
  try { lease = await materializePrivatePackageLease(captured, packageAllocation); }
  finally { await captured.dispose(); }
  lifecycle = await record(input, "backing", {
    kind: BACKING_KIND,
    lease: lease.identity,
  } as unknown as JsonValue);

  if (input.signal.aborted) {
    return await recoverPrivateRootFlowCall(
      input,
      failedPrivateRootTerminal("CANCELLED", "child Flow call was cancelled during startup"),
    );
  }
  await revalidateRecipe(recipe);
  const sealed = await input.backend.seal(
    backendPlan(recipe, lease.root, lifecycle.allocationDigest, plan),
    ownerAllocation,
  );
  lifecycle = await record(input, "sandbox", {
    kind: SANDBOX_KIND,
    owner: sealed.identity,
  } as unknown as JsonValue);

  let provisional: RunHostTerminal | undefined;
  let fence: PrivateLinuxConfirmedEnforcementReceipt;
  try {
    const startup = startupSignal(input.signal);
    let component: Awaited<ReturnType<typeof sealed.admit>>;
    try {
      component = await sealed.admit(startup.signal, async (prepared) => {
        await record(input, "prepared", { kind: PREPARED_KIND, prepared } as unknown as JsonValue);
      });
    } finally {
      startup.release();
    }
    // Backend admission observes cancellation only while starting. Once the
    // process is ready, RunHost owns cooperative cancellation and the helper's
    // absolute deadline remains the independent hard fence.
    provisional = await new RunHostSession(component, {
      input: lifecycle.allocation.call.input,
      settings: recipe.request.settings,
      attachments: Object.freeze({}),
      scratch: recipe.scratch,
      deadlineUnixMs: plan.effectiveDeadlineUnixMs,
      signal: input.signal,
    }, { cancellationGraceMs: plan.cancellationGraceMs }).run();
    lifecycle = await record(input, "provisional", provisional as unknown as JsonValue);
    fence = await component.enforcement;
  } catch (error) {
    if (provisional !== undefined) {
      lifecycle = await record(input, "provisional", provisional as unknown as JsonValue);
    }
    try { fence = await input.backend.recoverFence(sealed.identity); }
    catch (fenceError) {
      if (fenceError instanceof PrivateLinuxFenceUnconfirmedError) throw fenceError;
      throw fenceError;
    }
    if (lifecycle.provisional === undefined) {
      lifecycle = await record(input, "provisional", terminalAfterFence(error, fence) as unknown as JsonValue);
    }
  }
  lifecycle = await record(input, "fence", { kind: FENCE_KIND, receipt: fence } as unknown as JsonValue);
  lifecycle = await releaseChild(input, lifecycle);
  const observed = requireTerminal(lifecycle.provisional!.value);
  const admitted = observed.status === "succeeded"
    ? await admitChildResult(input, lifecycle, observed)
    : observed;
  lifecycle = await record(input, "admitted", admitted as unknown as JsonValue);
  return await closePrivateRootFlowCall({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  });
}

function startupSignal(source: AbortSignal): Readonly<{
  readonly signal: AbortSignal;
  release(): void;
}> {
  const controller = new AbortController();
  const abort = (): void => controller.abort(source.reason);
  if (source.aborted) abort();
  else source.addEventListener("abort", abort, { once: true });
  let released = false;
  return Object.freeze({
    signal: controller.signal,
    release(): void {
      if (released) return;
      released = true;
      source.removeEventListener("abort", abort);
    },
  });
}

async function settleWithoutPlan(
  input: ChildInput,
  terminal: RunHostTerminal,
): Promise<PrivateRootFlowCallLifecycle> {
  let lifecycle = await record(input, "provisional", terminal as unknown as JsonValue);
  lifecycle = await record(input, "release", {
    kind: RELEASE_KIND,
    planDigest: null,
    backingDigest: null,
    fenceDigest: null,
    packageReleased: true,
    ownerRelease: null,
  } as unknown as JsonValue);
  lifecycle = await record(input, "admitted", terminal as unknown as JsonValue);
  return await closePrivateRootFlowCall({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  });
}

async function releaseChild(
  input: ChildInput,
  initial: PrivateRootFlowCallLifecycle,
): Promise<PrivateRootFlowCallLifecycle> {
  if (initial.release !== undefined) return initial;
  const plan = initial.plan === undefined ? undefined : parsePlan(initial.plan.value);
  let ownerRelease: PrivateLinuxOwnerStateReleaseReceipt | null = null;
  if (plan !== undefined) {
    if (initial.sandbox !== undefined && initial.fence === undefined) {
      throw new PrivateLinuxFenceUnconfirmedError(new Error("child sandbox cannot release before fencing"));
    }
    if (initial.backing !== undefined) {
      await disposePrivatePackageMaterializationLease(
        plan.packageAllocation.parent.path,
        parseBacking(initial.backing.value).lease,
      );
    } else {
      const recovered = await recoverPrivatePackageMaterializationAllocation(
        plan.packageAllocation.parent.path,
        plan.packageAllocation,
      );
      if (recovered.state === "complete") await recovered.lease.dispose();
    }
    if (initial.sandbox !== undefined) {
      ownerRelease = await releasePrivateLinuxOwnerState(
        parseSandbox(initial.sandbox.value).owner,
        parseFence(initial.fence!.value).receipt,
      );
    } else {
      const cancelled = await cancelPrivateLinuxOwnerStateAllocation(plan.ownerAllocation);
      ownerRelease = await releasePrivateLinuxOwnerState(plan.ownerAllocation, cancelled);
    }
  }
  return await record(input, "release", {
    kind: RELEASE_KIND,
    planDigest: initial.plan?.digest ?? null,
    backingDigest: initial.backing?.digest ?? null,
    fenceDigest: initial.fence?.digest ?? null,
    packageReleased: true,
    ownerRelease,
  } as unknown as JsonValue);
}

async function admitChildResult(
  input: ChildInput,
  lifecycle: PrivateRootFlowCallLifecycle,
  provisional: Extract<RunHostTerminal, { readonly status: "succeeded" }>,
): Promise<RunHostTerminal> {
  const selected = findPrivateActivationCandidateTarget(
    input.parent.candidate,
    lifecycle.allocation.target,
  );
  if (selected === undefined) throw new Error("child target disappeared from its pinned candidate");
  const captured = await captureStoredPackage(input.packageStoreRoot, selected.request.package);
  try { return admitPrivatePackageResult(await inspectCapturedPackage(captured), provisional); }
  finally { await captured.dispose(); }
}

async function validateChildInput(
  packageStoreRoot: string,
  recipe: PrivateDirectRunRecipe,
  value: JsonValue,
): Promise<RunHostTerminal | undefined> {
  const captured = await captureStoredPackage(packageStoreRoot, recipe.request.package);
  try {
    try { (await inspectCapturedPackage(captured)).schemas.input?.validate(value, "INVALID_INPUT"); }
    catch (error) {
      if (!(error instanceof SchemaDiagnostic)) throw error;
      return failedPrivateRootTerminal("INVALID_INPUT", error.message, {
        code: error.code,
        instancePointer: error.instancePointer,
        schemaPointer: error.schemaPointer,
        path: error.path,
        ...(error.keyword === undefined ? {} : { keyword: error.keyword }),
      });
    }
  } finally { await captured.dispose(); }
  return undefined;
}

function selectChild(parent: PrivateReacquiredRootExecutionWork, call: RunHostFlowCall): Readonly<{
  readonly request: NonNullable<ReturnType<typeof findPrivateActivationCandidateTarget>>["request"];
  readonly recipeDigest: string;
  readonly observationDigest: string;
}> {
  const parentTarget = findPrivateActivationCandidateTarget(parent.candidate, parent.run.target);
  const slot = parentTarget?.request.slots[call.slot];
  if (slot?.kind !== "flow-call" || slot.targets.length !== 1 || slot.targets[0]!.kind !== "flow") {
    throw new CheckError("unavailable", "UNAVAILABLE", "the requested slot has no exact admitted child Flow");
  }
  const child = findPrivateActivationCandidateTarget(parent.candidate, slot.targets[0]!);
  if (child === undefined || child.disposition.state !== "ready") {
    throw new CheckError("unavailable", "UNAVAILABLE", "the exact child Flow is not READY in this generation");
  }
  return Object.freeze({
    request: child.request,
    recipeDigest: child.disposition.recipeDigest,
    observationDigest: child.disposition.observationDigest,
  });
}

async function load(input: ChildInput): Promise<PrivateRootFlowCallLifecycle | undefined> {
  return await loadPrivateRootFlowCall({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  });
}

async function record(
  input: ChildInput,
  checkpoint: PrivateRootFlowCallCheckpointName,
  value: JsonValue,
): Promise<PrivateRootFlowCallLifecycle> {
  return await recordPrivateRootFlowCallCheckpoint({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
    checkpoint,
    value,
  });
}

function hasExecutionWork(lifecycle: PrivateRootFlowCallLifecycle): boolean {
  return lifecycle.plan !== undefined || lifecycle.provisional !== undefined ||
    lifecycle.release !== undefined || lifecycle.admitted !== undefined;
}

function operationTerminal(lifecycle: PrivateRootFlowCallLifecycle): RunHostOperationTerminal {
  const terminal = requireTerminal(lifecycle.admitted!.value);
  if (terminal.status === "succeeded") {
    return Object.freeze({ status: "succeeded", result: terminal.result });
  }
  const code = terminal.code === "PROTOCOL_ERROR" || terminal.code === "CHANNEL_LOST"
    ? "EXECUTION_FAILED"
    : terminal.code;
  return Object.freeze({
    status: "failed",
    code,
    message: terminal.message,
    ...(terminal.details === undefined ? {} : { details: terminal.details }),
  });
}

function preallocationFailure(error: unknown): RunHostOperationTerminal {
  if (error instanceof CheckError && (
    error.code === "UNAVAILABLE" || error.code === "RESOURCE_EXHAUSTED" ||
    error.code === "INVALID_INPUT" || error.code === "PERMISSION_DENIED"
  )) {
    return Object.freeze({ status: "failed", code: error.code, message: error.message });
  }
  return Object.freeze({ status: "failed", code: "EXECUTION_FAILED", message: errorText(error) });
}

function executionFailure(error: unknown): RunHostTerminal {
  if (error instanceof CheckError && error.code === "RESOURCE_EXHAUSTED") {
    return failedPrivateRootTerminal("RESOURCE_EXHAUSTED", error.message);
  }
  return failedPrivateRootTerminal("EXECUTION_FAILED", errorText(error));
}

function terminalAfterFence(
  error: unknown,
  fence: PrivateLinuxConfirmedEnforcementReceipt,
): RunHostTerminal {
  if (fence.stopReason === "deadline") {
    return failedPrivateRootTerminal("DEADLINE_EXCEEDED", "child Flow hard deadline elapsed");
  }
  return executionFailure(error);
}

function requireTerminal(value: JsonValue): RunHostTerminal {
  const terminal = normalizePrivateRootTerminal(value);
  if (terminal.status === "lost") throw new TypeError("child Flow terminal cannot be lost");
  return terminal;
}

async function revalidateRecipe(recipe: PrivateDirectRunRecipe): Promise<void> {
  const [mechanism, executableDigest] = await Promise.all([
    recipe.backend.observeMechanism(),
    privateFileDigest(recipe.executablePath),
  ]);
  if (mechanism.digest !== recipe.mechanismDigest ||
      executableDigest !== recipe.runtimeSupport.executableDigest) {
    throw new Error("child Flow recipe no longer matches retained host support");
  }
}

function backendPlan(
  recipe: PrivateDirectRunRecipe,
  packageRoot: string,
  allocationDigest: string,
  plan: ChildPlan,
): PrivateLinuxLaunchPlan {
  const readOnlyMounts = [
    ...recipe.runtimeSupport.closureSources.map((source) => ({ source, destination: source })),
    { source: packageRoot, destination: recipe.packageDestination },
  ];
  const limits = Object.freeze({
    ...recipe.resourceCeilings,
    deadlineUnixMs: plan.effectiveDeadlineUnixMs,
    cancellationGraceMs: plan.cancellationGraceMs,
  });
  const runId = `child-${allocationDigest.slice("sha256:".length, "sha256:".length + 40)}`;
  if (recipe.kind === "private-bun-direct-recipe/1") {
    const bun = recipe as PrivateBunDirectRecipe;
    return Object.freeze({
      runId,
      limits,
      readOnlyMounts,
      privateProcessFilesystem: true,
      privateRuntimeDevices: true,
      command: [
        bun.executablePath,
        ...BUN_POLICY,
        `${bun.packageDestination}/${bun.request.entrypoint.path}`,
      ] as readonly [string, ...string[]],
    });
  }
  return Object.freeze({
    runId,
    limits,
    readOnlyMounts,
    command: [recipe.executablePath, `${recipe.packageDestination}/${recipe.request.entrypoint.path}`] as const,
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
  if (!information.isDirectory() || information.isSymbolicLink() || information.uid !== uid ||
      (information.mode & 0o077) !== 0 || await realpath(path) !== path) {
    throw new Error("private child Flow work directory is not protected");
  }
}

function parsePlan(value: JsonValue): ChildPlan {
  const record = exactRecord(value, [
    "kind", "requestDigest", "recipeDigest", "observationDigest", "effectiveDeadlineUnixMs",
    "cancellationGraceMs", "packageAllocation", "ownerAllocation",
  ], "child Flow plan");
  if (record.kind !== PLAN_KIND || !Number.isSafeInteger(record.effectiveDeadlineUnixMs) ||
      !Number.isSafeInteger(record.cancellationGraceMs)) throw new TypeError("child Flow plan is invalid");
  return Object.freeze({
    kind: PLAN_KIND,
    requestDigest: digest(record.requestDigest, "child Flow request"),
    recipeDigest: digest(record.recipeDigest, "child Flow recipe"),
    observationDigest: digest(record.observationDigest, "child Flow observation"),
    effectiveDeadlineUnixMs: record.effectiveDeadlineUnixMs as number,
    cancellationGraceMs: record.cancellationGraceMs as number,
    packageAllocation: record.packageAllocation as unknown as PrivatePackageMaterializationAllocationIdentity,
    ownerAllocation: normalizePrivateLinuxOwnerStateAllocationIdentity(record.ownerAllocation),
  });
}

function parseBacking(value: JsonValue): ChildBacking {
  const record = exactRecord(value, ["kind", "lease"], "child Flow backing");
  if (record.kind !== BACKING_KIND) throw new TypeError("child Flow backing is invalid");
  return Object.freeze({ kind: BACKING_KIND, lease: record.lease as unknown as PrivatePackageMaterializationLeaseIdentity });
}

function parseSandbox(value: JsonValue): ChildSandbox {
  const record = exactRecord(value, ["kind", "owner"], "child Flow sandbox");
  if (record.kind !== SANDBOX_KIND) throw new TypeError("child Flow sandbox is invalid");
  return Object.freeze({ kind: SANDBOX_KIND, owner: normalizePrivateLinuxSealedOwnerIdentity(record.owner) });
}

function parseFence(value: JsonValue): ChildFence {
  const record = exactRecord(value, ["kind", "receipt"], "child Flow fence");
  if (record.kind !== FENCE_KIND) throw new TypeError("child Flow fence is invalid");
  return Object.freeze({
    kind: FENCE_KIND,
    receipt: record.receipt as unknown as PrivateLinuxConfirmedEnforcementReceipt,
  });
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly ${expected.join(", ")}`);
  }
  return value as Record<string, unknown>;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${label} digest is invalid`);
  }
  return value;
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error &&
    (error as { readonly code?: unknown }).code === code;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
