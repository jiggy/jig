import { CheckError } from "../diagnostics.js";
import type { JsonValue } from "../json.js";
import { inspectCapturedPackage, type InspectedPackage } from "../package/inspect.js";
import type { ContractIdentity } from "../project/package-project.js";
import type { PrivateActivationRequest } from "../project/package-resolution.js";
import {
  type RunHostEffectCall,
  type RunHostEffectOperationTerminal,
} from "../run/session.js";
import { SchemaDiagnostic, type CompiledSchema } from "../schema/index.js";
import {
  allocatePrivateServiceInvocation,
  allocatePrivateServiceLease,
  completePrivateServiceInvocation,
  listPrivateServiceInvocations,
  listPrivateServiceLeases,
  listPrivateServiceMountRecoveryWork,
  recordPrivateServiceInvocationDispatch,
  recordPrivateServiceLeaseRelease,
  recoverPrivateServiceInvocation,
  type PrivateProjectCoordinator,
  type PrivateReacquiredRootExecutionWork,
  type PrivateServiceInvocationSnapshot,
  type PrivateServiceMountSnapshot,
} from "./activation-admission-store.js";
import { findPrivateActivationCandidateTargetV5 } from "./activation-admission.js";
import { captureStoredPackage } from "./package-artifact-store.js";
import type { PrivateBunServiceMount } from "./private-service-controller.js";
import {
  normalizePrivateServiceOwnerClosure,
  type PrivateServiceInvocationObservation,
  type PrivateServiceOwnerClosure,
} from "./private-service-state.js";
import type { PrivateProjectLocalLock } from "./project-local-lock.js";

interface ServiceEffectContext {
  readonly providerBinding: string;
  readonly providerExport: string;
  readonly contract: ContractIdentity;
  readonly inputSchema: CompiledSchema;
  readonly outputSchema: CompiledSchema;
  readonly errorSchemas: ReadonlyMap<string, CompiledSchema>;
}

export interface PrivateRootServiceEffectInput {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly parent: PrivateReacquiredRootExecutionWork;
  readonly coordinator: PrivateProjectCoordinator;
  /** One already acknowledged exact Mount. Absence keeps Journal-only roots unchanged. */
  readonly serviceMount?: PrivateBunServiceMount;
}

/** Execute one exact capability-backed Service effect selected by a pinned root. */
export async function executePrivateRootServiceEffect(
  input: PrivateRootServiceEffectInput & {
    readonly call: RunHostEffectCall;
    readonly signal: AbortSignal;
  },
): Promise<RunHostEffectOperationTerminal> {
  try {
    if (input.signal.aborted) return failed("CANCELLED", "Service invocation was cancelled before admission");
    const context = await inspectServiceEffectContext(input, input.call);
    const inputFailure = schemaFailure(context.inputSchema, input.call.input, "INVALID_INPUT");
    if (inputFailure !== undefined) return inputFailure;
    if (input.signal.aborted) return failed("CANCELLED", "Service invocation was cancelled before admission");

    const mount = input.serviceMount;
    if (mount === undefined || mount.bindingId !== context.providerBinding) {
      return failed("UNAVAILABLE", "the pinned Service provider has no live acknowledged Mount");
    }

    const lease = await allocatePrivateServiceLease({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      packageStoreRoot: input.packageStoreRoot,
      ownerRunId: input.parent.run.runId,
      slot: input.call.slot,
    });
    if (lease.release !== undefined || lease.allocation.providerBinding !== context.providerBinding ||
        lease.allocation.providerExport !== context.providerExport ||
        !sameContract(lease.allocation.contract, context.contract) ||
        lease.allocation.mountId !== mount.mountId ||
        lease.allocation.generationId !== mount.generationId) {
      throw new CheckError(
        "unavailable",
        "UNAVAILABLE",
        "the live Service Mount differs from the root's pinned generation lease",
      );
    }

    const allocation = await allocatePrivateServiceInvocation({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      ownerRunId: input.parent.run.runId,
      operationId: input.call.operationId,
      slot: input.call.slot,
      method: input.call.method,
      input: input.call.input,
    });
    if (allocation.snapshot.terminal !== undefined) {
      return projectStoredTerminal(context, allocation.snapshot);
    }

    if (!allocation.created) {
      if (allocation.snapshot.dispatch !== undefined) {
        return failed(
          "UNCERTAIN",
          "Service invocation may already have been dispatched; it will not be sent again",
        );
      }
      const closed = await completePrivateServiceInvocation({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        ownerRunId: input.parent.run.runId,
        operationId: input.call.operationId,
        observation: {
          source: "host-prewrite",
          terminal: {
            status: "failed",
            code: "UNAVAILABLE",
            message: "Service invocation lost its dispatch owner before dispatch admission",
          },
        },
      });
      return projectStoredTerminal(context, closed);
    }
    return await invokeAndClose(input, context, mount, allocation);
  } catch (error) {
    return operationFailure(error);
  }
}

/**
 * Verify every invocation closure, then release each owner-slot lease. The
 * returned aggregate is evidence for the parent closure, not a new store row.
 */
export async function closePrivateRootServiceEffectsBeforeParent(
  input: Omit<PrivateRootServiceEffectInput, "packageStoreRoot" | "serviceMount">,
): Promise<PrivateServiceOwnerClosure | null> {
  let invocations = await listPrivateServiceInvocations({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    ownerRunId: input.parent.run.runId,
  });
  const leases = await listPrivateServiceLeases({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    ownerRunId: input.parent.run.runId,
  });
  if (invocations.length === 0 && leases.length === 0) return null;

  let mounts: ReadonlyMap<string, PrivateServiceMountSnapshot> | undefined;
  for (const invocation of invocations) {
    if (invocation.terminal === undefined || invocation.closure === undefined) {
      mounts ??= await recoveryMounts(input);
      const mount = mounts.get(invocation.allocation.mountId);
      if (mount?.fence === undefined) {
        throw new CheckError(
          "unavailable",
          "SERVICE_INVOCATION_UNCLOSED",
          "root Service invocation cannot close before its exact Provider Mount is fenced",
        );
      }
      await recoverPrivateServiceInvocation({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        ownerRunId: input.parent.run.runId,
        operationId: invocation.allocation.call.operationId,
        mountFenceDigest: mount.fence.digest,
      });
    }
  }
  invocations = await listPrivateServiceInvocations({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    ownerRunId: input.parent.run.runId,
  });
  for (const invocation of invocations) {
    if (invocation.terminal === undefined || invocation.closure === undefined) {
      throw new CheckError(
        "unavailable",
        "SERVICE_INVOCATION_UNCLOSED",
        "root Service invocation has no durable terminal closure",
      );
    }
  }

  const releases = [];
  for (const lease of leases) {
    const mount = lease.release === undefined
      ? (mounts ??= await recoveryMounts(input)).get(lease.allocation.mountId)
      : undefined;
    if (lease.release === undefined && mount === undefined) {
      throw new Error("live Service lease has no authenticated Provider Mount");
    }
    const release = mount?.provisional === undefined && mount?.fence === undefined
      ? { reason: "owner-closed" as const }
      : releaseAfterFence(mount!);
    const closed = lease.release === undefined
      ? await recordPrivateServiceLeaseRelease({
          coordinator: input.coordinator,
          projectRoot: input.projectRoot,
          ownerRunId: input.parent.run.runId,
          slot: lease.allocation.slot,
          reason: release.reason,
          ...(!("mountFenceDigest" in release)
            ? {}
            : { mountFenceDigest: release.mountFenceDigest }),
        })
      : lease;
    if (closed.release === undefined) throw new Error("Service lease release was not retained");
    releases.push(Object.freeze({
      slot: closed.allocation.slot,
      releaseDigest: closed.release.digest,
    }));
  }
  return normalizePrivateServiceOwnerClosure({
    kind: "private-service-owner-closure/1",
    ownerRunId: input.parent.run.runId,
    leases: releases,
  });
}

/** Pure private resolver kept separate so schema and authority checks need no Provider. */
export function requirePrivateServiceEffectContext(input: {
  readonly request: PrivateActivationRequest;
  readonly lock: PrivateProjectLocalLock;
  readonly inspected: InspectedPackage;
  readonly call: RunHostEffectCall;
}): ServiceEffectContext {
  const slot = input.request.slots[input.call.slot];
  const packageLock = input.lock.packages[input.request.packagePath];
  const use = packageLock?.uses[input.call.slot];
  if (slot?.kind !== "capability" || use?.kind !== "contract" ||
      !sameContract(slot.contract, use)) {
    throw new CheckError("unavailable", "UNAVAILABLE", "the requested slot has no Service provider");
  }
  if (input.inspected.digest !== input.request.package.digest) {
    throw new Error("inspected Service consumer differs from its pinned package");
  }
  const reference = input.inspected.usedContracts.find((candidate) => candidate.slot === input.call.slot);
  const contract = reference === undefined ? undefined : {
    id: reference.contract.descriptor.id,
    version: reference.contract.descriptor.version,
    digest: reference.contract.digest,
  };
  if (reference === undefined || contract === undefined || !sameContract(contract, slot.contract)) {
    throw new CheckError(
      "unavailable",
      "UNAVAILABLE",
      "the protected package has no exact contract for the requested Service slot",
    );
  }
  const method = reference.contract.descriptor.methods[input.call.method];
  const inputSchema = reference.contract.schemas.get(`/methods/${input.call.method}/input`);
  const outputSchema = reference.contract.schemas.get(`/methods/${input.call.method}/output`);
  if (method === undefined || inputSchema === undefined || outputSchema === undefined) {
    throw new CheckError("unavailable", "UNAVAILABLE", "the selected capability has no requested method");
  }
  const errorSchemas = new Map<string, CompiledSchema>();
  for (const name of Object.keys(method.errors)) {
    const schema = reference.contract.schemas.get(`/methods/${input.call.method}/errors/${name}`);
    if (schema === undefined) throw new Error("capability contract lacks its declared error schema");
    errorSchemas.set(name, schema);
  }
  return Object.freeze({
    providerBinding: slot.provider.binding,
    providerExport: slot.provider.export,
    contract: slot.contract,
    inputSchema,
    outputSchema,
    errorSchemas,
  });
}

async function invokeAndClose(
  input: PrivateRootServiceEffectInput & {
    readonly call: RunHostEffectCall;
    readonly signal: AbortSignal;
  },
  context: ServiceEffectContext,
  mount: PrivateBunServiceMount,
  allocation: Awaited<ReturnType<typeof allocatePrivateServiceInvocation>>,
): Promise<RunHostEffectOperationTerminal> {
  const observed = await mount.invokeDetailed({
    exportName: context.providerExport,
    method: input.call.method,
    input: input.call.input,
    deadlineUnixMs: allocation.snapshot.allocation.deadlineUnixMs,
    signal: input.signal,
  }, {
    async beforeDispatch(): Promise<void> {
      await recordPrivateServiceInvocationDispatch({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        allocation,
      });
    },
  });
  const observation = validateObservation(context, observed);
  const closed = await completePrivateServiceInvocation({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    ownerRunId: input.parent.run.runId,
    operationId: input.call.operationId,
    observation,
  });
  return projectStoredTerminal(context, closed);
}

async function inspectServiceEffectContext(
  input: PrivateRootServiceEffectInput,
  call: RunHostEffectCall,
): Promise<ServiceEffectContext> {
  const request = parentRequest(input.parent);
  const captured = await captureStoredPackage(input.packageStoreRoot, request.package);
  try {
    return requirePrivateServiceEffectContext({
      request,
      lock: input.parent.candidate.lock,
      inspected: await inspectCapturedPackage(captured),
      call,
    });
  } finally { await captured.dispose(); }
}

function parentRequest(parent: PrivateReacquiredRootExecutionWork): PrivateActivationRequest {
  const selected = findPrivateActivationCandidateTargetV5(parent.candidate, parent.run.target);
  if (selected === undefined || selected.request.digest !== parent.intent.requestDigest) {
    throw new Error("durable root Run differs from its pinned Service consumer");
  }
  return selected.request;
}

function projectStoredTerminal(
  context: ServiceEffectContext,
  snapshot: PrivateServiceInvocationSnapshot,
): RunHostEffectOperationTerminal {
  const observation = snapshot.terminal?.value.observation;
  if (observation === undefined || snapshot.closure === undefined) {
    return failed("UNCERTAIN", "Service invocation has no durable terminal closure");
  }
  return projectObservation(context, observation);
}

function validateObservation(
  context: ServiceEffectContext,
  observation: PrivateServiceInvocationObservation,
): PrivateServiceInvocationObservation {
  const terminal = observation.terminal;
  if (terminal.status === "succeeded") {
    const diagnostic = schemaDiagnostic(context.outputSchema, terminal.value, "INVALID_RESULT");
    return diagnostic === undefined ? observation : invalidObservation(observation.source, diagnostic);
  }
  if (terminal.status === "application-error") {
    const schema = context.errorSchemas.get(terminal.name);
    if (schema === undefined) {
      return invalidObservation(
        observation.source,
        `Service returned undeclared application error ${terminal.name}`,
      );
    }
    const diagnostic = schemaDiagnostic(schema, terminal.data, "INVALID_RESULT");
    return diagnostic === undefined ? observation : invalidObservation(observation.source, diagnostic);
  }
  return observation;
}

function invalidObservation(
  source: PrivateServiceInvocationObservation["source"],
  message: string,
): PrivateServiceInvocationObservation {
  return Object.freeze({
    source,
    terminal: Object.freeze({ status: "failed", code: "INVALID_RESULT", message }),
  });
}

function projectObservation(
  context: ServiceEffectContext,
  observation: PrivateServiceInvocationObservation,
): RunHostEffectOperationTerminal {
  const terminal = observation.terminal;
  if (terminal.status === "succeeded") {
    const invalid = schemaFailure(context.outputSchema, terminal.value, "INVALID_RESULT");
    return invalid ?? Object.freeze({
      status: "succeeded" as const,
      result: Object.freeze({ value: terminal.value }),
    });
  }
  if (terminal.status === "application-error") {
    const schema = context.errorSchemas.get(terminal.name);
    if (schema === undefined) {
      return failed("INVALID_RESULT", `Service returned undeclared application error ${terminal.name}`);
    }
    const invalid = schemaFailure(schema, terminal.data, "INVALID_RESULT");
    return invalid ?? Object.freeze({
      status: "succeeded" as const,
      result: Object.freeze({
        error: Object.freeze({ name: terminal.name, data: terminal.data }),
      }),
    });
  }
  if (terminal.code === "PROTOCOL_ERROR" || terminal.code === "CHANNEL_LOST") {
    return failed("EXECUTION_FAILED", terminal.message, terminal.details);
  }
  return failed(terminal.code, terminal.message, terminal.details);
}

function sameContract(left: ContractIdentity, right: ContractIdentity): boolean {
  return left.id === right.id && left.version === right.version && left.digest === right.digest;
}

function schemaFailure(
  schema: CompiledSchema,
  value: unknown,
  code: "INVALID_INPUT" | "INVALID_RESULT",
): RunHostEffectOperationTerminal | undefined {
  try { schema.validate(value, code); }
  catch (error) {
    if (!(error instanceof SchemaDiagnostic)) throw error;
    return failed(code, error.message, {
      code: error.code,
      instancePointer: error.instancePointer,
      schemaPointer: error.schemaPointer,
      path: error.path,
      ...(error.keyword === undefined ? {} : { keyword: error.keyword }),
    });
  }
  return undefined;
}

function schemaDiagnostic(
  schema: CompiledSchema,
  value: unknown,
  code: "INVALID_INPUT" | "INVALID_RESULT",
): string | undefined {
  try { schema.validate(value, code); }
  catch (error) {
    if (!(error instanceof SchemaDiagnostic)) throw error;
    return error.message;
  }
  return undefined;
}

async function recoveryMounts(
  input: Omit<PrivateRootServiceEffectInput, "packageStoreRoot" | "serviceMount">,
): Promise<ReadonlyMap<string, PrivateServiceMountSnapshot>> {
  const snapshots: PrivateServiceMountSnapshot[] = [];
  for (const epoch of ["older", "current"] as const) {
    snapshots.push(...await listPrivateServiceMountRecoveryWork({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      epoch,
    }));
  }
  return new Map(snapshots.map((snapshot) => [snapshot.allocation.mountId, snapshot]));
}

function releaseAfterFence(mount: PrivateServiceMountSnapshot): {
  readonly reason: "provider-lost" | "mount-closed";
  readonly mountFenceDigest: string;
} {
  const fence = mount.fence;
  const provisional = mount.provisional;
  if (fence === undefined || provisional === undefined) {
    throw new CheckError(
      "unavailable",
      "SERVICE_LEASE_OWNER_SETTLING",
      "Service lease provider has begun settling without an exact durable fence",
    );
  }
  const classification = provisional.value.classification;
  if (classification === "provider-loss" || classification === "coordinator-loss") {
    return Object.freeze({ reason: "provider-lost", mountFenceDigest: fence.digest });
  }
  if (classification === "host-lifetime" || classification === "voluntary-exit") {
    return Object.freeze({ reason: "mount-closed", mountFenceDigest: fence.digest });
  }
  throw new Error(`acknowledged Service lease has impossible Mount classification ${classification}`);
}

function operationFailure(error: unknown): RunHostEffectOperationTerminal {
  if (error instanceof CheckError) {
    if (error.code === "OPERATION_CONFLICT") return failed("OPERATION_CONFLICT", error.message);
    if (error.code === "RUN_ALREADY_TERMINAL" || error.code === "RUN_COORDINATOR_STALE" ||
        error.code.endsWith("_OWNER_INACTIVE") || error.code.endsWith("_OWNER_SETTLING")) {
      return failed("OWNER_CLOSED", error.message);
    }
    if (error.kind === "unavailable" || error.code.startsWith("SERVICE_")) {
      return failed("UNAVAILABLE", error.message);
    }
    if ([
      "CANCELLED", "DEADLINE_EXCEEDED", "OWNER_CLOSED", "UNAVAILABLE", "PERMISSION_DENIED",
      "RESOURCE_EXHAUSTED", "INVALID_INPUT", "INVALID_RESULT", "UNCERTAIN",
    ].includes(error.code)) {
      return failed(error.code as Exclude<RunHostEffectOperationTerminal, { readonly status: "succeeded" }>["code"], error.message);
    }
  }
  return failed("EXECUTION_FAILED", error instanceof Error ? error.message : String(error));
}

function failed(
  code: Exclude<RunHostEffectOperationTerminal, { readonly status: "succeeded" }>["code"],
  message: string,
  details?: JsonValue,
): RunHostEffectOperationTerminal {
  return Object.freeze({
    status: "failed",
    code,
    message,
    ...(details === undefined ? {} : { details }),
  });
}
