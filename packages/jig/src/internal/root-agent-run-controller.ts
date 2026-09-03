import { lstat, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { CheckError } from "../diagnostics.js";
import { canonicalJson, type JsonObject, type JsonValue } from "../json.js";
import { inspectCapturedPackage } from "../package/inspect.js";
import { SchemaDiagnostic } from "../schema/index.js";
import {
  type RunHostEffectCall,
  type RunHostEffectOperationTerminal,
  type WireFailureCode,
} from "../run/session.js";
import {
  allocatePrivateRootChildOwner,
  closePrivateRootChildOwner,
  listPrivateRootChildOwners,
  recordPrivateRootChildCleanup,
  recordPrivateRootChildFence,
  recordPrivateRootChildSandbox,
  type PrivateProjectCoordinator,
  type PrivateReacquiredRootExecutionWork,
  type PrivateRootChildOwnerLifecycle,
} from "./activation-admission-store.js";
import { findPrivateActivationCandidateTargetV5 } from "./activation-admission.js";
import {
  planPrivateDirectRun,
  type PrivateDirectRunInstalledSupport,
  type PrivateDirectRunRecipe,
} from "./direct-run.js";
import { privateDomainDigest } from "./identity.js";
import { revalidatePrivateInstalledBunSupport } from "./installed-bun-support.js";
import {
  PrivateLinuxFenceUnconfirmedError,
  cancelPrivateLinuxOwnerStateAllocation,
  normalizePrivateLinuxConfirmedEnforcementReceipt,
  normalizePrivateLinuxOwnerStateAllocationIdentity,
  normalizePrivateLinuxOwnerStateReleaseReceipt,
  normalizePrivateLinuxSealedOwnerIdentity,
  planPrivateLinuxOwnerStateAllocation,
  releasePrivateLinuxOwnerState,
  type PrivateLinuxCgroupBackend,
  type PrivateLinuxComponentProcess,
  type PrivateLinuxConfirmedEnforcementReceipt,
  type PrivateLinuxLaunchPlan,
  type PrivateLinuxOwnerStateAllocationIdentity,
  type PrivateLinuxOwnerStateReleaseReceipt,
  type PrivateLinuxSealedOwnerIdentity,
} from "./linux-rootless-backend.js";
import {
  privateOpenRouterAgentCredential,
  requirePrivateOpenRouterAgentProvider,
  type PrivateOpenRouterAgentProvider,
} from "./openrouter-agent-provider.js";
import {
  assertPrivateOpenRouterResponseSchema,
} from "./openrouter-responses-client.js";
import {
  decodePrivateOpenRouterResponsesResponse,
  encodePrivateOpenRouterResponsesRequest,
  PRIVATE_OPENROUTER_RESPONSES_PROTOCOL,
  PRIVATE_OPENROUTER_RESPONSES_RESPONSE_BYTES,
  type PrivateOpenRouterResponsesErrorCode,
  type PrivateOpenRouterResponsesRequest,
  type PrivateOpenRouterResponsesWorkerResponse,
} from "./openrouter-responses-protocol.js";
import { captureStoredPackage } from "./package-artifact-store.js";
import {
  AGENT_RUN_CONTRACT_DIGEST,
  AGENT_RUN_CONTRACT_ID,
  AGENT_RUN_CONTRACT_VERSION,
  AgentRunValidationError,
  assertAgentRunContract,
  parseAgentRunInput,
  parseAgentRunResult,
  projectAgentRunSkills,
  type AgentRunSkillManifest,
  type PreparedAgentRunInput,
} from "./private-agent-run.js";

const ALLOCATION_KIND = "private-root-agent-owner-allocation/1";
const SANDBOX_KIND = "private-root-agent-sandbox/1";
const CLEANUP_KIND = "private-root-agent-cleanup/1";
const CANCELLATION_GRACE_MS = 1_000;
const PROVIDER_STDERR_BYTES = 64 * 1024;
const PROVIDER_INSTRUCTION_BYTES = 1_048_576;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

interface AgentAllocation {
  readonly kind: typeof ALLOCATION_KIND;
  readonly parentRunId: string;
  readonly coordinatorEpoch: number;
  readonly operationId: string;
  readonly parentRequestDigest: string;
  /** Digest of the transient provider request; its bytes are never retained. */
  readonly requestDigest: string;
  readonly providerDigest: string;
  readonly effectiveDeadlineUnixMs: number;
  readonly ownerAllocation: PrivateLinuxOwnerStateAllocationIdentity;
}

interface AgentSandbox {
  readonly kind: typeof SANDBOX_KIND;
  readonly owner: PrivateLinuxSealedOwnerIdentity;
}

interface AgentCleanup {
  readonly kind: typeof CLEANUP_KIND;
  readonly ownerRelease: PrivateLinuxOwnerStateReleaseReceipt;
}

interface AgentRecoveryInput {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly parent: PrivateReacquiredRootExecutionWork;
  readonly coordinator: PrivateProjectCoordinator;
  readonly installedSupport: PrivateDirectRunInstalledSupport;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly agentProvider?: PrivateOpenRouterAgentProvider | undefined;
}

interface AgentInput extends AgentRecoveryInput {
  readonly agentProvider: PrivateOpenRouterAgentProvider;
}

interface PreparedCall {
  readonly input: PreparedAgentRunInput;
  readonly contract: Parameters<typeof parseAgentRunResult>[0];
  readonly request: Omit<PrivateOpenRouterResponsesRequest, "apiKey">;
  readonly digest: string;
}

/** Execute one exact admitted Agent Run effect in its own contained process. */
export async function executePrivateRootAgentRun(
  input: AgentInput & {
    readonly call: RunHostEffectCall;
    readonly parentDeadlineUnixMs: number;
    readonly signal: AbortSignal;
  },
): Promise<RunHostEffectOperationTerminal> {
  const selected = selectAgentCapability(input.parent, input.call);
  if (selected === undefined) {
    return failed("UNAVAILABLE", "the requested slot has no admitted Agent Run capability");
  }
  if (input.call.method !== "run") {
    return failed("UNAVAILABLE", "the Agent Run capability has no requested method");
  }
  if (input.signal.aborted) return failed("CANCELLED", "the Agent Run was cancelled");

  let provider: PrivateOpenRouterAgentProvider;
  let recipe: PrivateDirectRunRecipe;
  try {
    provider = requirePrivateOpenRouterAgentProvider(input.agentProvider);
    if (provider.contractDigest !== selected.digest ||
        provider.workerDigest !== input.installedSupport.agentWorkerDigest) {
      throw new Error("Agent provider identity differs from admitted host support");
    }
    recipe = await reproduceParentRecipe(input);
  } catch {
    return failed("UNAVAILABLE", "the admitted Agent provider cannot be reproduced");
  }

  let prepared: PreparedCall;
  try {
    prepared = await prepareCall(input, provider);
  } catch (error) {
    if (error instanceof AgentInstructionLimitError ||
        error instanceof SchemaDiagnostic && error.code === "SCHEMA_LIMIT_EXCEEDED" ||
        error instanceof AgentRunValidationError &&
          error.code === "AGENT_RUN_SKILL_PROJECTION_LIMIT") {
      return failed("RESOURCE_EXHAUSTED", "the Agent Run input exceeds its fixed provider bound");
    }
    if (error instanceof AgentRunValidationError || error instanceof CheckError ||
        error instanceof SchemaDiagnostic || error instanceof TypeError) {
      return failed("INVALID_INPUT", "the Agent Run input or skill selection is invalid");
    }
    throw error;
  }

  const effectiveDeadlineUnixMs = Math.min(
    input.parentDeadlineUnixMs,
    Date.now() + recipe.wallClockCeilingMs,
  );
  if (Date.now() >= effectiveDeadlineUnixMs) {
    return failed("DEADLINE_EXCEEDED", "the Agent Run deadline elapsed before dispatch");
  }
  if (input.signal.aborted) return failed("CANCELLED", "the Agent Run was cancelled");

  const owners = await listPrivateRootChildOwners({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  });
  const existing = owners.find(({ operationId }) => operationId === input.call.operationId);
  if (existing !== undefined) {
    if (!isPrivateRootAgentRunOwner(existing)) {
      throw new Error("one operation identity names a different durable child owner");
    }
    await recoverPrivateRootAgentRunOwner(input, existing);
    return failed("UNCERTAIN", "a prior Agent dispatch was fenced without a proved result");
  }
  if (owners.length !== 0) {
    return failed("RESOURCE_EXHAUSTED", "the parent Run already has an active child operation");
  }

  const ownerParent = await protectedOwnerRoot(input.projectRoot);
  const identity = agentIdentity(input.parent.run.runId, input.call.operationId);
  const ownerAllocation = await planPrivateLinuxOwnerStateAllocation({
    parent: ownerParent,
    name: `a-${identity.slice(0, 62)}`,
  });
  const allocation: AgentAllocation = Object.freeze({
    kind: ALLOCATION_KIND,
    parentRunId: input.parent.run.runId,
    coordinatorEpoch: input.parent.run.coordinatorEpoch,
    operationId: input.call.operationId,
    parentRequestDigest: input.parent.intent.requestDigest,
    requestDigest: prepared.digest,
    providerDigest: provider.digest,
    effectiveDeadlineUnixMs,
    ownerAllocation,
  });
  let lifecycle: PrivateRootChildOwnerLifecycle;
  try {
    lifecycle = await allocatePrivateRootChildOwner({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      parentRunId: input.parent.run.runId,
      operationId: input.call.operationId,
      allocation: allocation as unknown as JsonValue,
    });
  } catch (error) {
    try {
      await cancelUnusedAllocation(ownerAllocation);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Agent owner allocation failed and its unused owner could not be released",
      );
    }
    if (error instanceof CheckError && error.code === "RUN_CHILD_CAPACITY") {
      return failed("RESOURCE_EXHAUSTED", "the parent Run already has an active child operation");
    }
    throw error;
  }

  let attemptedDispatch = false;
  let execution: ProviderExecution;
  try {
    await revalidateProviderSupport(recipe, provider);
    const sealed = await input.backend.seal(
      backendPlan(recipe, effectiveDeadlineUnixMs, identity),
      ownerAllocation,
    );
    const sandbox: AgentSandbox = Object.freeze({ kind: SANDBOX_KIND, owner: sealed.identity });
    lifecycle = await recordPrivateRootChildSandbox({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      parentRunId: input.parent.run.runId,
      operationId: input.call.operationId,
      allocationDigest: lifecycle.allocation.digest,
      sandbox: sandbox as unknown as JsonValue,
    });

    attemptedDispatch = true;
    const component = await sealed.admit(input.signal);
    execution = await interactWithProvider(
      component,
      encodePrivateOpenRouterResponsesRequest({
        ...prepared.request,
        apiKey: privateOpenRouterAgentCredential(provider),
      }),
    );
    await releaseKnownAgent(input, lifecycle, execution.fence);
  } catch (error) {
    try {
      const active = await findLifecycle(input, input.call.operationId);
      if (active !== undefined) await recoverPrivateRootAgentRunOwner(input, active);
    } catch (cleanupError) {
      if (attemptedDispatch && cleanupError instanceof PrivateLinuxFenceUnconfirmedError) {
        return failed("UNCERTAIN", "Agent dispatch may have occurred but its fence is not yet confirmed");
      }
      throw new AggregateError([error, cleanupError], "Agent Run execution and cleanup failed");
    }
    if (input.signal.aborted) return failed("CANCELLED", "the Agent Run was cancelled");
    if (Date.now() >= effectiveDeadlineUnixMs) {
      return failed("DEADLINE_EXCEEDED", "the Agent Run deadline elapsed");
    }
    return attemptedDispatch
      ? failed("UNCERTAIN", "Agent dispatch may have occurred but no result was proved")
      : failed("EXECUTION_FAILED", "Agent Run execution failed before dispatch");
  }

  if (execution.fence.stopReason === "cancelled" || input.signal.aborted) {
    return failed("CANCELLED", "the Agent Run was cancelled");
  }
  if (execution.fence.stopReason === "deadline" || Date.now() >= effectiveDeadlineUnixMs) {
    return failed("DEADLINE_EXCEEDED", "the Agent Run deadline elapsed");
  }
  if (execution.fence.exitCode !== 0 || execution.fence.signal !== null) {
    return failed("EXECUTION_FAILED", "the Agent provider process failed");
  }

  let response: PrivateOpenRouterResponsesWorkerResponse;
  try {
    response = decodePrivateOpenRouterResponsesResponse(execution.output);
  } catch {
    return failed("INVALID_RESULT", "the Agent provider returned an invalid result");
  }
  if (response.status === "error") return providerFailure(response.code);
  try {
    const value = parseAgentRunResult(prepared.contract, prepared.input, response.value);
    return Object.freeze({
      status: "succeeded" as const,
      result: Object.freeze({ value: value as unknown as JsonValue }),
    });
  } catch {
    return failed("INVALID_RESULT", "the Agent provider result does not satisfy Agent Run/1");
  }
}

/** Identify Agent rows without interpreting Flow-child allocation formats. */
export function isPrivateRootAgentRunOwner(
  lifecycle: PrivateRootChildOwnerLifecycle,
): boolean {
  const value = lifecycle.allocation.value;
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (value as Record<string, unknown>).kind === ALLOCATION_KIND;
}

/** Fence and release every active Agent provider owned by one parent Run. */
export async function recoverPrivateRootAgentRunOwners(input: AgentRecoveryInput): Promise<void> {
  const owners = await listPrivateRootChildOwners({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  });
  for (const owner of owners) {
    if (isPrivateRootAgentRunOwner(owner)) {
      await recoverPrivateRootAgentRunOwner(input, owner);
    }
  }
}

/** Fence and release one already classified Agent provider owner. */
export async function recoverPrivateRootAgentRunOwner(
  input: AgentRecoveryInput,
  lifecycleValue: PrivateRootChildOwnerLifecycle,
): Promise<void> {
  let lifecycle = lifecycleValue;
  const allocation = parseAllocation(lifecycle);
  await requireAllocationMatchesParent(input, lifecycle, allocation);
  if (lifecycle.sandbox === undefined) {
    const cancelled = await cancelPrivateLinuxOwnerStateAllocation(allocation.ownerAllocation);
    await releasePrivateLinuxOwnerState(allocation.ownerAllocation, cancelled);
  } else {
    const sandbox = parseSandbox(lifecycle);
    let fence: PrivateLinuxConfirmedEnforcementReceipt;
    if (lifecycle.fence === undefined) {
      fence = await input.backend.recoverFence(sandbox.owner);
      lifecycle = await recordPrivateRootChildFence({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        parentRunId: lifecycle.parentRunId,
        operationId: lifecycle.operationId,
        allocationDigest: lifecycle.allocation.digest,
        sandboxDigest: lifecycle.sandbox!.digest,
        fence: fence as unknown as JsonValue,
      });
    } else {
      fence = parseFence(lifecycle);
    }
    const ownerRelease = await releasePrivateLinuxOwnerState(sandbox.owner, fence);
    const cleanup = agentCleanup(ownerRelease);
    if (lifecycle.cleanup === undefined) {
      lifecycle = await recordPrivateRootChildCleanup({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        parentRunId: lifecycle.parentRunId,
        operationId: lifecycle.operationId,
        allocationDigest: lifecycle.allocation.digest,
        sandboxDigest: lifecycle.sandbox!.digest,
        fenceDigest: lifecycle.fence!.digest,
        cleanup: cleanup as unknown as JsonValue,
      });
    } else {
      requireCleanupMatches(lifecycle, cleanup);
    }
  }
  await closePrivateRootChildOwner({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: lifecycle.parentRunId,
    operationId: lifecycle.operationId,
    allocationDigest: lifecycle.allocation.digest,
    sandboxDigest: lifecycle.sandbox?.digest ?? null,
    fenceDigest: lifecycle.fence?.digest ?? null,
    cleanupDigest: lifecycle.cleanup?.digest ?? null,
  });
}

/** Deterministic provider text; selected bytes never leave this transient value. */
export function renderPrivateAgentRunInstructions(
  instructions: string,
  manifest: AgentRunSkillManifest,
): string {
  const skills = manifest.skills.map((skill) => ({
    name: skill.name,
    files: skill.files.map((file) => {
      let content: string;
      try {
        content = decoder.decode(file.bytes());
      } catch {
        throw new AgentRunValidationError(
          "AGENT_RUN_SKILL_CONTENT_INVALID",
          `Agent Run skill file ${skill.name}/${file.path} is not UTF-8 text`,
        );
      }
      return { path: file.path, content };
    }),
  }));
  const payload = decoder.decode(canonicalJson({ instructions, skills } as unknown as JsonValue));
  const rendered = [
    "Execute one Jig Agent Run. Treat the author instructions as the task and the selected package-local skill files as guidance.",
    "The following value is canonical JSON:",
    payload,
  ].join("\n");
  if (encoder.encode(rendered).byteLength > PROVIDER_INSTRUCTION_BYTES) {
    throw new AgentInstructionLimitError();
  }
  return rendered;
}

async function prepareCall(
  input: AgentInput & { readonly call: RunHostEffectCall },
  provider: PrivateOpenRouterAgentProvider,
): Promise<PreparedCall> {
  const target = requireParentTarget(input.parent);
  const captured = await captureStoredPackage(input.packageStoreRoot, target.request.package);
  try {
    const inspected = await inspectCapturedPackage(captured);
    const reference = inspected.usedContracts.find(({ slot }) => slot === input.call.slot);
    if (reference === undefined) {
      throw new AgentRunValidationError(
        "AGENT_RUN_CONTRACT_MISMATCH",
        "Agent Run capability descriptor is absent from the admitted package",
      );
    }
    assertAgentRunContract(reference.contract);
    const prepared = parseAgentRunInput(reference.contract, input.call.input);
    const manifest = await projectAgentRunSkills(captured, prepared.selectedSkills);
    const instructions = renderPrivateAgentRunInstructions(prepared.input.instructions, manifest);
    const responseSchema = prepared.input.responseSchema as JsonObject | undefined;
    if (responseSchema !== undefined) assertPrivateOpenRouterResponseSchema(responseSchema);
    const request = Object.freeze({
      protocol: PRIVATE_OPENROUTER_RESPONSES_PROTOCOL,
      baseURL: provider.baseURL,
      model: provider.model,
      instructions,
      ...(responseSchema === undefined ? {} : { responseSchema }),
    });
    return Object.freeze({
      input: prepared,
      contract: reference.contract,
      request,
      digest: privateDomainDigest(
        "JIG-Private-OpenRouter-Agent-Request/1",
        request as unknown as JsonValue,
      ),
    });
  } finally {
    await captured.dispose();
  }
}

function selectAgentCapability(
  parent: PrivateReacquiredRootExecutionWork,
  call: RunHostEffectCall,
) {
  const target = requireParentTarget(parent);
  const selected = target.request.capabilities[call.slot];
  if (selected === undefined) return undefined;
  if (selected.id !== AGENT_RUN_CONTRACT_ID ||
      selected.version !== AGENT_RUN_CONTRACT_VERSION ||
      selected.digest !== AGENT_RUN_CONTRACT_DIGEST) {
    throw new Error("admitted Agent Run capability identity is invalid");
  }
  return selected;
}

function requireParentTarget(parent: PrivateReacquiredRootExecutionWork) {
  const target = findPrivateActivationCandidateTargetV5(parent.candidate, parent.run.target);
  if (target === undefined || target.request.digest !== parent.intent.requestDigest ||
      target.disposition.state !== "ready") {
    throw new Error("parent Run differs from its admitted target");
  }
  return target;
}

async function reproduceParentRecipe(input: AgentInput): Promise<PrivateDirectRunRecipe> {
  const target = requireParentTarget(input.parent);
  if (target.disposition.state !== "ready") {
    throw new Error("parent Run target is unavailable");
  }
  const recipe = await planPrivateDirectRun({
    request: target.request,
    executionPackage: target.disposition.executionPackage,
    installedSupport: input.installedSupport,
    backend: input.backend,
    agentProvider: input.agentProvider,
  });
  if (recipe.digest !== target.disposition.recipeDigest ||
      recipe.observation.digest !== target.disposition.observationDigest ||
      recipe.agentProvider?.digest !== input.agentProvider.digest) {
    throw new Error("parent Agent recipe differs from its admission");
  }
  return recipe;
}

async function revalidateProviderSupport(
  recipe: PrivateDirectRunRecipe,
  provider: PrivateOpenRouterAgentProvider,
): Promise<void> {
  const [mechanism] = await Promise.all([
    recipe.backend.observeMechanism(),
    revalidatePrivateInstalledBunSupport(recipe.installedSupport),
  ]);
  if (mechanism.support.digest !== recipe.mechanismDigest ||
      recipe.installedSupport.agentWorkerDigest !== provider.workerDigest ||
      recipe.agentProvider?.digest !== provider.digest) {
    throw new Error("Agent provider support changed after admission");
  }
}

function backendPlan(
  recipe: PrivateDirectRunRecipe,
  deadlineUnixMs: number,
  identity: string,
): PrivateLinuxLaunchPlan {
  return Object.freeze({
    runId: `agent-${identity.slice(0, 42)}`,
    limits: Object.freeze({
      ...recipe.resourceCeilings,
      deadlineUnixMs,
      cancellationGraceMs: CANCELLATION_GRACE_MS,
    }),
    readOnlyMounts: Object.freeze([
      ...recipe.installedSupport.runtimeMounts,
      { source: "/etc/resolv.conf", destination: "/etc/resolv.conf" },
      {
        source: recipe.installedSupport.agentWorkerPath,
        destination: recipe.installedSupport.sandboxAgentWorkerPath,
      },
    ]),
    command: Object.freeze([
      recipe.sandboxExecutablePath,
      ...recipe.bunPolicy,
      recipe.installedSupport.sandboxAgentWorkerPath,
    ]) as readonly [string, ...string[]],
    network: "inherited",
  });
}

interface ProviderExecution {
  readonly output: Uint8Array;
  readonly fence: PrivateLinuxConfirmedEnforcementReceipt;
}

async function interactWithProvider(
  component: PrivateLinuxComponentProcess,
  request: Uint8Array,
): Promise<ProviderExecution> {
  const output = collectBounded(component.stdout, PRIVATE_OPENROUTER_RESPONSES_RESPONSE_BYTES);
  const stderr = discardBounded(component.stderr, PROVIDER_STDERR_BYTES);
  try {
    await component.write(request);
    await component.closeInput();
    const [bytes, fence] = await Promise.all([output, component.enforcement, stderr])
      .then(([bytes, fence]) => [bytes, fence] as const);
    return Object.freeze({ output: bytes, fence });
  } catch (error) {
    await component.terminate().catch(() => undefined);
    await Promise.allSettled([output, stderr, component.enforcement]);
    throw error;
  }
}

async function releaseKnownAgent(
  input: AgentRecoveryInput,
  lifecycleValue: PrivateRootChildOwnerLifecycle,
  fence: PrivateLinuxConfirmedEnforcementReceipt,
): Promise<void> {
  let lifecycle = lifecycleValue;
  const sandbox = parseSandbox(lifecycle);
  lifecycle = await recordPrivateRootChildFence({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: lifecycle.parentRunId,
    operationId: lifecycle.operationId,
    allocationDigest: lifecycle.allocation.digest,
    sandboxDigest: lifecycle.sandbox!.digest,
    fence: fence as unknown as JsonValue,
  });
  const ownerRelease = await releasePrivateLinuxOwnerState(sandbox.owner, fence);
  const cleanup = agentCleanup(ownerRelease);
  lifecycle = await recordPrivateRootChildCleanup({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: lifecycle.parentRunId,
    operationId: lifecycle.operationId,
    allocationDigest: lifecycle.allocation.digest,
    sandboxDigest: lifecycle.sandbox!.digest,
    fenceDigest: lifecycle.fence!.digest,
    cleanup: cleanup as unknown as JsonValue,
  });
  await closePrivateRootChildOwner({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: lifecycle.parentRunId,
    operationId: lifecycle.operationId,
    allocationDigest: lifecycle.allocation.digest,
    sandboxDigest: lifecycle.sandbox!.digest,
    fenceDigest: lifecycle.fence!.digest,
    cleanupDigest: lifecycle.cleanup!.digest,
  });
}

async function findLifecycle(
  input: AgentInput,
  operationId: string,
): Promise<PrivateRootChildOwnerLifecycle | undefined> {
  return (await listPrivateRootChildOwners({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  })).find((item) => item.operationId === operationId);
}

function parseAllocation(lifecycle: PrivateRootChildOwnerLifecycle): AgentAllocation {
  const value = exactObject(lifecycle.allocation.value, [
    "kind", "parentRunId", "coordinatorEpoch", "operationId", "parentRequestDigest",
    "requestDigest", "providerDigest", "effectiveDeadlineUnixMs", "ownerAllocation",
  ], "Agent allocation");
  if (value.kind !== ALLOCATION_KIND || value.parentRunId !== lifecycle.parentRunId ||
      value.operationId !== lifecycle.operationId ||
      typeof value.coordinatorEpoch !== "number" || !Number.isSafeInteger(value.coordinatorEpoch) ||
      value.coordinatorEpoch < 1 || !isDigest(value.parentRequestDigest) ||
      !isDigest(value.requestDigest) || !isDigest(value.providerDigest) ||
      typeof value.effectiveDeadlineUnixMs !== "number" ||
      !Number.isSafeInteger(value.effectiveDeadlineUnixMs) || value.effectiveDeadlineUnixMs < 0) {
    throw new TypeError("Agent allocation is invalid");
  }
  return Object.freeze({
    kind: ALLOCATION_KIND,
    parentRunId: value.parentRunId as string,
    coordinatorEpoch: value.coordinatorEpoch,
    operationId: value.operationId as string,
    parentRequestDigest: value.parentRequestDigest,
    requestDigest: value.requestDigest,
    providerDigest: value.providerDigest,
    effectiveDeadlineUnixMs: value.effectiveDeadlineUnixMs,
    ownerAllocation: normalizePrivateLinuxOwnerStateAllocationIdentity(value.ownerAllocation),
  });
}

function parseSandbox(lifecycle: PrivateRootChildOwnerLifecycle): AgentSandbox {
  if (lifecycle.sandbox === undefined) throw new TypeError("Agent sandbox owner is absent");
  const value = exactObject(lifecycle.sandbox.value, ["kind", "owner"], "Agent sandbox");
  if (value.kind !== SANDBOX_KIND) throw new TypeError("Agent sandbox kind is invalid");
  return Object.freeze({
    kind: SANDBOX_KIND,
    owner: normalizePrivateLinuxSealedOwnerIdentity(value.owner),
  });
}

function parseFence(lifecycle: PrivateRootChildOwnerLifecycle): PrivateLinuxConfirmedEnforcementReceipt {
  if (lifecycle.fence === undefined) throw new TypeError("Agent fence is absent");
  return normalizePrivateLinuxConfirmedEnforcementReceipt(lifecycle.fence.value);
}

function agentCleanup(ownerRelease: PrivateLinuxOwnerStateReleaseReceipt): AgentCleanup {
  return Object.freeze({ kind: CLEANUP_KIND, ownerRelease });
}

function parseCleanup(lifecycle: PrivateRootChildOwnerLifecycle): AgentCleanup {
  if (lifecycle.cleanup === undefined) throw new TypeError("Agent cleanup is absent");
  const value = exactObject(lifecycle.cleanup.value, ["kind", "ownerRelease"], "Agent cleanup");
  if (value.kind !== CLEANUP_KIND) throw new TypeError("Agent cleanup kind is invalid");
  return agentCleanup(normalizePrivateLinuxOwnerStateReleaseReceipt(value.ownerRelease));
}

function requireCleanupMatches(
  lifecycle: PrivateRootChildOwnerLifecycle,
  expected: AgentCleanup,
): void {
  const actual = parseCleanup(lifecycle);
  if (actual.ownerRelease.digest !== expected.ownerRelease.digest) {
    throw new Error("durable Agent cleanup differs from the released owner");
  }
}

async function requireAllocationMatchesParent(
  input: AgentRecoveryInput,
  lifecycle: PrivateRootChildOwnerLifecycle,
  allocation: AgentAllocation,
): Promise<void> {
  const target = requireParentTarget(input.parent);
  if (allocation.parentRunId !== input.parent.run.runId ||
      allocation.coordinatorEpoch !== input.parent.run.coordinatorEpoch ||
      allocation.operationId !== lifecycle.operationId ||
      allocation.parentRequestDigest !== target.request.digest ||
      allocation.effectiveDeadlineUnixMs > input.parent.intent.deadlineUnixMs ||
      Object.values(target.request.capabilities).length !== 1 ||
      Object.values(target.request.capabilities)[0]?.digest !== AGENT_RUN_CONTRACT_DIGEST) {
    throw new Error("durable Agent allocation differs from its admitted parent or provider");
  }
  const ownerParent = await protectedOwnerRoot(input.projectRoot);
  const identity = agentIdentity(lifecycle.parentRunId, lifecycle.operationId);
  if (allocation.ownerAllocation.parent !== ownerParent ||
      allocation.ownerAllocation.name !== `a-${identity.slice(0, 62)}`) {
    throw new Error("durable Agent allocation differs from its admitted owner resource");
  }
}

function providerFailure(
  code: PrivateOpenRouterResponsesErrorCode,
): RunHostEffectOperationTerminal {
  if (code === "AGENT_PROVIDER_OUTPUT_LIMIT") {
    return failed("RESOURCE_EXHAUSTED", "the Agent provider result exceeded its fixed bound");
  }
  if (code === "AGENT_PROVIDER_RESPONSE_INVALID") {
    return failed("INVALID_RESULT", "the Agent provider returned an invalid result");
  }
  return failed("EXECUTION_FAILED", "the Agent provider request failed");
}

async function collectBounded(
  source: AsyncIterable<Uint8Array>,
  maximum: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of source) {
    total += chunk.byteLength;
    if (total > maximum) throw new Error("Agent provider output exceeds its byte bound");
    chunks.push(Uint8Array.from(chunk));
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function discardBounded(
  source: AsyncIterable<Uint8Array>,
  maximum: number,
): Promise<void> {
  let total = 0;
  for await (const chunk of source) {
    total += chunk.byteLength;
    if (total > maximum) throw new Error("Agent provider diagnostics exceed their byte bound");
  }
}

async function cancelUnusedAllocation(
  allocation: PrivateLinuxOwnerStateAllocationIdentity,
): Promise<void> {
  const cancelled = await cancelPrivateLinuxOwnerStateAllocation(allocation);
  await releasePrivateLinuxOwnerState(allocation, cancelled);
}

function exactObject(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, any> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new TypeError(`${label} must contain exactly ${expected.join(", ")}`);
  }
  return record;
}

function agentIdentity(parentRunId: string, operationId: string): string {
  return privateDomainDigest("JIG-Private-Root-Agent-Identity/1", {
    parentRunId,
    operationId,
  }).slice("sha256:".length);
}

async function protectedOwnerRoot(projectRoot: string): Promise<string> {
  const state = await realpath(join(projectRoot, ".jig"));
  const owners = join(state, "private-root-linux-owners");
  await mkdir(owners, { mode: 0o700 }).catch((error) => {
    if (!hasCode(error, "EEXIST")) throw error;
  });
  const information = await lstat(owners);
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (!information.isDirectory() || information.isSymbolicLink() ||
      information.uid !== uid || (information.mode & 0o077) !== 0 ||
      await realpath(owners) !== owners) {
    throw new Error("Agent execution owner directory is not protected");
  }
  return owners;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

function failed(
  code: WireFailureCode,
  message: string,
  details?: JsonValue,
): RunHostEffectOperationTerminal {
  return Object.freeze({
    status: "failed" as const,
    code,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" &&
    (error as NodeJS.ErrnoException).code === code;
}

class AgentInstructionLimitError extends Error {}
