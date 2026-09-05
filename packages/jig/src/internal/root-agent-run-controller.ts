import { lstat, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { CheckError } from "../diagnostics.js";
import { canonicalJson, decodeJson1, type JsonObject, type JsonValue } from "../json.js";
import { inspectCapturedPackage } from "../package/inspect.js";
import type { RunTargetIdentity } from "../project/package-project.js";
import { validateProjectPath } from "../project/paths.js";
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
  privateAcpAgentRuntime,
  revalidatePrivateAcpAgentProvider,
} from "./acp-agent-provider.js";
import {
  PrivateAcpProtocolError,
  privateAcpComponentStream,
  runPrivateAcpTurn,
  type PrivateAcpTurnResult,
} from "./acp-agent-client.js";
import {
  requirePrivateAgentProvider,
  type PrivateAgentProvider,
} from "./agent-provider.js";
import {
  privateOpenAIAgentCredential,
  type PrivateOpenAIAgentProvider,
} from "./openai-agent-provider.js";
import {
  assertPrivateAgentResponseSchema,
  projectPrivateAgentResponseSchema,
} from "./openai-agent-client.js";
import {
  decodePrivateOpenAIAgentResponse,
  encodePrivateOpenAIAgentRequest,
  PRIVATE_OPENAI_AGENT_PROTOCOL,
  PRIVATE_OPENAI_AGENT_RESPONSE_BYTES,
  type PrivateOpenAIAgentErrorCode,
  type PrivateOpenAIAgentWorkerResponse,
} from "./openai-agent-protocol.js";
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
const AGENT_PROVIDER_MINIMUM_PIDS = 128;
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
  readonly parentFlow: PrivateAgentParentFlow | null;
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
  readonly parentFlow?: PrivateAgentParentFlow;
  readonly coordinator: PrivateProjectCoordinator;
  readonly installedSupport: PrivateDirectRunInstalledSupport;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly agentProvider?: PrivateAgentProvider | undefined;
}

interface AgentInput extends AgentRecoveryInput {
  readonly agentProvider: PrivateAgentProvider;
}

/** Exact admitted direct child Flow whose invocation owns this Agent call. */
export interface PrivateAgentParentFlow {
  readonly operationId: string;
  readonly target: RunTargetIdentity;
  readonly requestDigest: string;
}

interface PreparedCall {
  readonly input: PreparedAgentRunInput;
  readonly contract: Parameters<typeof parseAgentRunResult>[0];
  readonly instructions: string;
  readonly responseSchema?: JsonObject;
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
  const selected = selectAgentCapability(input, input.call);
  if (selected === undefined) {
    return failed("UNAVAILABLE", "the requested slot has no admitted Agent Run capability");
  }
  if (input.call.method !== "run") {
    return failed("UNAVAILABLE", "the Agent Run capability has no requested method");
  }
  if (input.signal.aborted) return failed("CANCELLED", "the Agent Run was cancelled");

  let provider: PrivateAgentProvider;
  let recipe: PrivateDirectRunRecipe;
  try {
    provider = requirePrivateAgentProvider(input.agentProvider);
    if (provider.contractDigest !== selected.digest ||
        provider.kind === "private-openai-agent-provider/1" &&
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
    input.parent.intent.deadlineUnixMs,
    Date.now() + recipe.wallClockCeilingMs,
  );
  if (Date.now() >= effectiveDeadlineUnixMs) {
    return failed("DEADLINE_EXCEEDED", "the Agent Run deadline elapsed before dispatch");
  }
  if (input.signal.aborted) return failed("CANCELLED", "the Agent Run was cancelled");

  if (input.parentFlow !== undefined) {
    await requireParentFlowOwner(input, input.parentFlow, effectiveDeadlineUnixMs);
  }
  const owners = (await listPrivateRootChildOwners({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  })).filter((owner) => owner.parentOperationId === input.parentFlow?.operationId);
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
  const identity = agentIdentity(input.parent.run.runId, input.call.operationId, input.parentFlow?.operationId);
  const ownerAllocation = await planPrivateLinuxOwnerStateAllocation({
    parent: ownerParent,
    name: `a-${identity.slice(0, 62)}`,
  });
  const allocation: AgentAllocation = Object.freeze({
    kind: ALLOCATION_KIND,
    parentRunId: input.parent.run.runId,
    coordinatorEpoch: input.parent.run.coordinatorEpoch,
    operationId: input.call.operationId,
    parentRequestDigest: requireParentTarget(input).request.digest,
    parentFlow: input.parentFlow ?? null,
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
      ...(input.parentFlow === undefined ? {} : { parentOperationId: input.parentFlow.operationId }),
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
      backendPlan(recipe, provider, effectiveDeadlineUnixMs, identity),
      ownerAllocation,
    );
    const sandbox: AgentSandbox = Object.freeze({ kind: SANDBOX_KIND, owner: sealed.identity });
    lifecycle = await recordPrivateRootChildSandbox({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      parentRunId: input.parent.run.runId,
      ...(input.parentFlow === undefined ? {} : { parentOperationId: input.parentFlow.operationId }),
      operationId: input.call.operationId,
      allocationDigest: lifecycle.allocation.digest,
      sandbox: sandbox as unknown as JsonValue,
    });

    attemptedDispatch = true;
    const component = await sealed.admit(input.signal);
    execution = await interactWithProvider(component, provider, prepared, input.signal);
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

  if (execution.cancelled) {
    return failed("CANCELLED", "the Agent Run was cancelled");
  }
  if (execution.failure !== undefined) return providerFailure(execution.failure);
  try {
    const value = parseAgentRunResult(prepared.contract, prepared.input, execution.value);
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
    if (isPrivateRootAgentRunOwner(owner) && (input.parentFlow === undefined ||
        owner.parentOperationId === input.parentFlow.operationId)) {
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
        ...(lifecycle.parentOperationId === undefined ? {} : { parentOperationId: lifecycle.parentOperationId }),
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
        ...(lifecycle.parentOperationId === undefined ? {} : { parentOperationId: lifecycle.parentOperationId }),
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
    ...(lifecycle.parentOperationId === undefined ? {} : { parentOperationId: lifecycle.parentOperationId }),
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

function renderPrivateAcpStructuredInstructions(
  instructions: string,
  responseSchema: JsonObject,
): string {
  const schema = decoder.decode(canonicalJson(
    projectPrivateAgentResponseSchema(responseSchema) as JsonObject,
  ));
  const rendered = [
    instructions,
    "Return only one JSON value matching this canonical FLOW Schema/1 schema:",
    "Do not wrap the JSON value in Markdown or a code fence.",
    schema,
  ].join("\n");
  if (encoder.encode(rendered).byteLength > PROVIDER_INSTRUCTION_BYTES) {
    throw new AgentInstructionLimitError();
  }
  return rendered;
}

async function prepareCall(
  input: AgentInput & { readonly call: RunHostEffectCall },
  provider: PrivateAgentProvider,
): Promise<PreparedCall> {
  const target = requireParentTarget(input);
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
    let instructions = renderPrivateAgentRunInstructions(prepared.input.instructions, manifest);
    const responseSchema = prepared.input.responseSchema as JsonObject | undefined;
    if (responseSchema !== undefined) assertPrivateAgentResponseSchema(responseSchema);
    if (provider.kind === "private-acp-agent-provider/1" && responseSchema !== undefined) {
      instructions = renderPrivateAcpStructuredInstructions(instructions, responseSchema);
    }
    const requestIdentity = Object.freeze({
      providerDigest: provider.digest,
      instructions,
      ...(responseSchema === undefined ? {} : { responseSchema }),
    });
    return Object.freeze({
      input: prepared,
      contract: reference.contract,
      instructions,
      ...(responseSchema === undefined ? {} : { responseSchema }),
      digest: privateDomainDigest(
        "JIG-Private-Agent-Request/1",
        requestIdentity as unknown as JsonValue,
      ),
    });
  } finally {
    await captured.dispose();
  }
}

function selectAgentCapability(
  input: AgentRecoveryInput,
  call: RunHostEffectCall,
) {
  const target = requireParentTarget(input);
  const selected = target.request.capabilities[call.slot];
  if (selected === undefined) return undefined;
  if (selected.id !== AGENT_RUN_CONTRACT_ID ||
      selected.version !== AGENT_RUN_CONTRACT_VERSION ||
      selected.digest !== AGENT_RUN_CONTRACT_DIGEST) {
    throw new Error("admitted Agent Run capability identity is invalid");
  }
  return selected;
}

function requireParentTarget(input: AgentRecoveryInput) {
  const { parent, parentFlow } = input;
  const root = findPrivateActivationCandidateTargetV5(parent.candidate, parent.run.target);
  if (root === undefined || root.request.digest !== parent.intent.requestDigest ||
      root.disposition.state !== "ready") {
    throw new Error("parent Run differs from its admitted target");
  }
  if (parentFlow === undefined) return root;
  const target = findPrivateActivationCandidateTargetV5(parent.candidate, parentFlow.target);
  if (target === undefined || target.request.digest !== parentFlow.requestDigest ||
      target.disposition.state !== "ready" || Object.keys(target.request.flowSlots).length !== 0 ||
      !Object.values(root.request.flowSlots).some((identity) =>
        findPrivateActivationCandidateTargetV5(parent.candidate, identity)?.request.digest === target.request.digest)) {
    throw new Error("Agent parent Flow differs from its admitted child target");
  }
  return target;
}

async function reproduceParentRecipe(input: AgentInput): Promise<PrivateDirectRunRecipe> {
  const target = requireParentTarget(input);
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
  provider: PrivateAgentProvider,
): Promise<void> {
  const [mechanism] = await Promise.all([
    recipe.backend.observeMechanism(),
    revalidatePrivateInstalledBunSupport(recipe.installedSupport),
    provider.kind === "private-acp-agent-provider/1"
      ? revalidatePrivateAcpAgentProvider(provider)
      : Promise.resolve(),
  ]);
  if (mechanism.support.digest !== recipe.mechanismDigest ||
      provider.kind === "private-openai-agent-provider/1" &&
        recipe.installedSupport.agentWorkerDigest !== provider.workerDigest ||
      recipe.agentProvider?.digest !== provider.digest) {
    throw new Error("Agent provider support changed after admission");
  }
}

function backendPlan(
  recipe: PrivateDirectRunRecipe,
  provider: PrivateAgentProvider,
  deadlineUnixMs: number,
  identity: string,
): PrivateLinuxLaunchPlan {
  const acp = provider.kind === "private-acp-agent-provider/1"
    ? privateAcpAgentRuntime(provider)
    : undefined;
  return Object.freeze({
    runId: `agent-${identity.slice(0, 42)}`,
    limits: Object.freeze({
      ...recipe.resourceCeilings,
      pids: Math.max(recipe.resourceCeilings.pids, AGENT_PROVIDER_MINIMUM_PIDS),
      deadlineUnixMs,
      cancellationGraceMs: CANCELLATION_GRACE_MS,
    }),
    readOnlyMounts: Object.freeze([
      ...recipe.installedSupport.runtimeMounts,
      { source: "/etc/resolv.conf", destination: "/etc/resolv.conf" },
      ...(acp === undefined ? [{
        source: recipe.installedSupport.agentWorkerPath,
        destination: recipe.installedSupport.sandboxAgentWorkerPath,
      }] : [
        { source: acp.adapterPath, destination: acp.sandboxAdapterPath },
        { source: acp.executablePath, destination: acp.sandboxExecutablePath },
        ...acp.readOnlyMounts,
      ]),
    ]),
    command: Object.freeze(acp === undefined
      ? [
          recipe.sandboxExecutablePath,
          ...recipe.bunPolicy,
          recipe.installedSupport.sandboxAgentWorkerPath,
        ]
      : [recipe.sandboxExecutablePath, ...recipe.bunPolicy, acp.sandboxAdapterPath]) as
        readonly [string, ...string[]],
    ...(acp === undefined ? {} : { environment: acp.environment }),
    network: "inherited",
    ...(acp?.nestedUserNamespaces === true ? { nestedUserNamespaces: true } : {}),
  });
}

interface ProviderExecution {
  readonly fence: PrivateLinuxConfirmedEnforcementReceipt;
  readonly value?: unknown;
  readonly failure?: PrivateOpenAIAgentErrorCode;
  readonly cancelled: boolean;
}

async function interactWithProvider(
  component: PrivateLinuxComponentProcess,
  provider: PrivateAgentProvider,
  prepared: PreparedCall,
  signal: AbortSignal,
): Promise<ProviderExecution> {
  if (provider.kind === "private-acp-agent-provider/1") {
    return await interactWithAcpProvider(component, provider, prepared, signal);
  }
  return await interactWithOpenAIProvider(component, provider, prepared);
}

async function interactWithOpenAIProvider(
  component: PrivateLinuxComponentProcess,
  provider: PrivateOpenAIAgentProvider,
  prepared: PreparedCall,
): Promise<ProviderExecution> {
  const output = collectBounded(component.stdout, PRIVATE_OPENAI_AGENT_RESPONSE_BYTES);
  const stderr = discardBounded(component.stderr, PROVIDER_STDERR_BYTES);
  try {
    await component.write(encodePrivateOpenAIAgentRequest({
      protocol: PRIVATE_OPENAI_AGENT_PROTOCOL,
      apiKey: privateOpenAIAgentCredential(provider),
      api: provider.api,
      baseURL: provider.baseURL,
      model: provider.model,
      instructions: prepared.instructions,
      ...(prepared.responseSchema === undefined ? {} : {
        responseSchema: prepared.responseSchema,
      }),
    }));
    await component.closeInput();
    const [bytes, fence] = await Promise.all([output, component.enforcement, stderr])
      .then(([bytes, fence]) => [bytes, fence] as const);
    let response: PrivateOpenAIAgentWorkerResponse;
    try {
      response = decodePrivateOpenAIAgentResponse(bytes);
    } catch {
      return Object.freeze({
        fence,
        failure: "AGENT_PROVIDER_RESPONSE_INVALID" as const,
        cancelled: false,
      });
    }
    return response.status === "error"
      ? Object.freeze({ fence, failure: response.code, cancelled: false })
      : Object.freeze({ fence, value: response.value, cancelled: false });
  } catch (error) {
    await component.terminate().catch(() => undefined);
    await Promise.allSettled([output, stderr, component.enforcement]);
    throw error;
  }
}

async function interactWithAcpProvider(
  component: PrivateLinuxComponentProcess,
  provider: Extract<PrivateAgentProvider, { readonly kind: "private-acp-agent-provider/1" }>,
  prepared: PreparedCall,
  signal: AbortSignal,
): Promise<ProviderExecution> {
  const runtime = privateAcpAgentRuntime(provider);
  const stderr = discardBounded(component.stderr, PROVIDER_STDERR_BYTES);
  try {
    if (runtime.startupInput !== undefined) {
      await component.write(runtime.startupInput());
    }
    const turn = await runPrivateAcpTurn(privateAcpComponentStream(component), {
      cwd: "/work",
      instructions: prepared.instructions,
      signal,
      configuration: runtime.configuration,
      ...(runtime.modeId === undefined ? {} : { modeId: runtime.modeId }),
      ...(runtime.sessionMeta === undefined ? {} : { sessionMeta: runtime.sessionMeta }),
      ...(runtime.authentication === undefined ? {} : {
        authentication: {
          request: runtime.authentication.request,
          ...(runtime.authentication.clientAuthCapabilities === undefined ? {} : {
            clientAuthCapabilities: runtime.authentication.clientAuthCapabilities,
          }),
        },
      }),
    });
    await component.closeInput();
    const [fence] = await Promise.all([component.enforcement, stderr]);
    if (turn.stopReason === "cancelled") {
      return Object.freeze({ fence, cancelled: true });
    }
    try {
      return Object.freeze({
        fence,
        value: acpResultValue(turn, prepared.responseSchema !== undefined),
        cancelled: false,
      });
    } catch {
      return Object.freeze({
        fence,
        failure: "AGENT_PROVIDER_RESPONSE_INVALID" as const,
        cancelled: false,
      });
    }
  } catch (error) {
    await component.terminate().catch(() => undefined);
    await Promise.allSettled([stderr, component.enforcement]);
    if (error instanceof PrivateAcpProtocolError) {
      throw error;
    }
    throw error;
  }
}

function acpResultValue(
  turn: PrivateAcpTurnResult,
  structuredRequested: boolean,
): Readonly<Record<string, unknown>> {
  const outcome = turn.stopReason === "end_turn"
    ? "completed"
    : turn.stopReason === "refusal"
      ? "blocked"
      : "limit";
  if (!structuredRequested || outcome !== "completed") {
    return Object.freeze({ outcome, text: turn.text });
  }
  return Object.freeze({
    outcome,
    text: turn.text,
    structured: decodePrivateAcpStructuredText(turn.text),
  });
}

/** Normalize the one JSON Markdown presentation emitted by current text-only ACP clients. */
export function decodePrivateAcpStructuredText(text: string): JsonValue {
  try {
    return decodeJson1(encoder.encode(text));
  } catch (rawError) {
    const match = /^```json\r?\n([\s\S]*)\r?\n```$/.exec(text.trim());
    if (match === null) throw rawError;
    return decodeJson1(encoder.encode(match[1]!));
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
    ...(lifecycle.parentOperationId === undefined ? {} : { parentOperationId: lifecycle.parentOperationId }),
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
    ...(lifecycle.parentOperationId === undefined ? {} : { parentOperationId: lifecycle.parentOperationId }),
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
    ...(lifecycle.parentOperationId === undefined ? {} : { parentOperationId: lifecycle.parentOperationId }),
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
  })).find((item) => item.operationId === operationId &&
    item.parentOperationId === input.parentFlow?.operationId);
}

function parseAllocation(lifecycle: PrivateRootChildOwnerLifecycle): AgentAllocation {
  const value = exactObject(lifecycle.allocation.value, [
    "kind", "parentRunId", "coordinatorEpoch", "operationId", "parentRequestDigest", "parentFlow",
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
    parentFlow: normalizeParentFlow(value.parentFlow, lifecycle.parentOperationId),
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
  const { parentFlow: requestedParentFlow, ...rootInput } = input;
  const parentFlow = allocation.parentFlow;
  if (requestedParentFlow !== undefined && (parentFlow === null ||
      requestedParentFlow.operationId !== parentFlow.operationId ||
      requestedParentFlow.requestDigest !== parentFlow.requestDigest)) {
    throw new Error("durable Agent allocation differs from the requested parent Flow");
  }
  const target = requireParentTarget({
    ...rootInput,
    ...(parentFlow === null ? {} : { parentFlow }),
  });
  if (allocation.parentRunId !== input.parent.run.runId ||
      allocation.coordinatorEpoch !== input.parent.run.coordinatorEpoch ||
      allocation.operationId !== lifecycle.operationId ||
      allocation.parentRequestDigest !== target.request.digest ||
      allocation.effectiveDeadlineUnixMs > input.parent.intent.deadlineUnixMs ||
      Object.values(target.request.capabilities).length !== 1 ||
      Object.values(target.request.capabilities)[0]?.digest !== AGENT_RUN_CONTRACT_DIGEST) {
    throw new Error("durable Agent allocation differs from its admitted parent or provider");
  }
  if (parentFlow !== null) {
    await requireParentFlowOwner(input, parentFlow, allocation.effectiveDeadlineUnixMs);
  }
  const ownerParent = await protectedOwnerRoot(input.projectRoot);
  const identity = agentIdentity(lifecycle.parentRunId, lifecycle.operationId, lifecycle.parentOperationId);
  if (allocation.ownerAllocation.parent !== ownerParent ||
      allocation.ownerAllocation.name !== `a-${identity.slice(0, 62)}`) {
    throw new Error("durable Agent allocation differs from its admitted owner resource");
  }
}

async function requireParentFlowOwner(
  input: AgentRecoveryInput,
  parentFlow: PrivateAgentParentFlow,
  deadlineUnixMs: number,
): Promise<void> {
  const owners = await listPrivateRootChildOwners({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    parentRunId: input.parent.run.runId,
  });
  const parent = owners.find((owner) => owner.parentOperationId === undefined &&
    owner.operationId === parentFlow.operationId);
  const allocation = parent?.allocation.value as JsonObject | undefined;
  if (allocation === null || typeof allocation !== "object" || Array.isArray(allocation) ||
      allocation.kind !== "private-root-child-owner-allocation/1" ||
      allocation.parentRunId !== input.parent.run.runId ||
      allocation.coordinatorEpoch !== input.parent.run.coordinatorEpoch ||
      allocation.operationId !== parentFlow.operationId ||
      allocation.requestDigest !== parentFlow.requestDigest ||
      typeof allocation.effectiveDeadlineUnixMs !== "number" ||
      !Number.isSafeInteger(allocation.effectiveDeadlineUnixMs) ||
      allocation.effectiveDeadlineUnixMs > input.parent.intent.deadlineUnixMs ||
      allocation.effectiveDeadlineUnixMs < deadlineUnixMs || parent?.sandbox === undefined) {
    throw new Error("Agent parent Flow differs from its durable execution owner");
  }
}

function normalizeParentFlow(
  value: unknown,
  parentOperationId: string | undefined,
): PrivateAgentParentFlow | null {
  if (parentOperationId === undefined) {
    if (value !== null) throw new TypeError("root Agent allocation has a nested parent");
    return null;
  }
  const parent = exactObject(value, ["operationId", "target", "requestDigest"], "Agent parent Flow");
  if (parent.operationId !== parentOperationId || !isDigest(parent.requestDigest)) {
    throw new TypeError("Agent parent Flow identity is invalid");
  }
  const target = exactObject(parent.target,
    parent.target?.kind === "flow" ? ["kind", "path"] : ["kind", "id"], "Agent parent Flow target");
  let identity: RunTargetIdentity;
  if (target.kind === "flow" && typeof target.path === "string") {
    validateProjectPath(target.path, "Agent parent Flow target");
    identity = Object.freeze({ kind: "flow", path: target.path });
  } else if (target.kind === "binding" && typeof target.id === "string" &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target.id)) {
    identity = Object.freeze({ kind: "binding", id: target.id });
  } else {
    throw new TypeError("Agent parent Flow target is invalid");
  }
  return Object.freeze({ operationId: parentOperationId, target: identity, requestDigest: parent.requestDigest });
}

function providerFailure(
  code: PrivateOpenAIAgentErrorCode,
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

function agentIdentity(parentRunId: string, operationId: string, parentOperationId?: string): string {
  return privateDomainDigest("JIG-Private-Root-Agent-Identity/1", {
    parentRunId,
    parentOperationId: parentOperationId ?? null,
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
