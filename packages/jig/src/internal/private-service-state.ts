import { types as utilTypes } from "node:util";

import {
  isCapabilityContractId,
  isCapabilityContractVersion,
} from "../capability/index.js";
import {
  JSON_1_LIMITS,
  canonicalJson,
  decodeJson1,
  type JsonValue,
} from "../json.js";
import type { ContractIdentity } from "../project/package-project.js";
import type {
  ServiceHostTerminal,
  ServiceInvocationTerminalSource,
  ServiceInvocationTerminal,
} from "../service/session.js";
import { privateDomainDigest } from "./identity.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WIRE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const textEncoder = new TextEncoder();
const FAILURE_CODES = new Set([
  "CANCELLED",
  "DEADLINE_EXCEEDED",
  "OWNER_CLOSED",
  "OPERATION_CONFLICT",
  "UNAVAILABLE",
  "PERMISSION_DENIED",
  "RESOURCE_EXHAUSTED",
  "INVALID_INPUT",
  "INVALID_RESULT",
  "UNCERTAIN",
  "EXECUTION_FAILED",
  "PROTOCOL_ERROR",
  "CHANNEL_LOST",
]);

export type PrivateServiceMountCheckpointName =
  | "generation"
  | "acknowledged"
  | "provisional";

export interface PrivateServiceMountAllocation {
  readonly kind: "private-service-mount-allocation/1";
  readonly mountId: string;
  readonly coordinatorEpoch: number;
  readonly admissionDigest: string;
  readonly candidateRevision: number;
  readonly bindingId: string;
  readonly requestDigest: string;
  readonly recipeDigest: string;
  readonly observationDigest: string;
  readonly expectedExports: readonly string[];
  readonly effectiveDeadlineUnixMs: number;
}

export interface PrivateServiceMountCheckpoint {
  readonly kind: `private-service-mount-${PrivateServiceMountCheckpointName}/1`;
  readonly mountId: string;
  readonly allocationDigest: string;
  readonly value: JsonValue;
}

export interface PrivateServiceGenerationCheckpointValue {
  readonly generationId: string;
  readonly exports: readonly string[];
}

export interface PrivateServiceAcknowledgedCheckpointValue {
  readonly generationDigest: string;
}

export type PrivateServiceMountClassification =
  | "startup-cancelled"
  | "readiness-timeout"
  | "host-lifetime"
  | "voluntary-exit"
  | "provider-loss"
  | "coordinator-loss";

export interface PrivateServiceProvisionalCheckpointValue {
  readonly classification: PrivateServiceMountClassification;
  readonly terminal: ServiceHostTerminal;
}

export interface PrivateServiceLeaseAllocation {
  readonly kind: "private-service-lease-allocation/1";
  readonly ownerRunId: string;
  readonly coordinatorEpoch: number;
  readonly slot: string;
  readonly mountId: string;
  readonly mountAllocationDigest: string;
  readonly generationId: string;
  readonly generationDigest: string;
  readonly acknowledgedDigest: string;
  readonly providerBinding: string;
  readonly providerExport: string;
  readonly contract: ContractIdentity;
}

export interface PrivateServiceLeaseRelease {
  readonly kind: "private-service-lease-release/1";
  readonly ownerRunId: string;
  readonly slot: string;
  readonly allocationDigest: string;
  readonly reason: "owner-closed" | "provider-lost" | "mount-closed";
  readonly mountFenceDigest: string | null;
  readonly invocations: readonly {
    readonly operationId: string;
    readonly closureDigest: string;
  }[];
}

export interface PrivateServiceInvocationCall {
  readonly operationId: string;
  readonly slot: string;
  readonly method: string;
  readonly input: JsonValue;
}

export interface PrivateServiceInvocationAllocation {
  readonly kind: "private-service-invocation-allocation/1";
  readonly ownerRunId: string;
  readonly coordinatorEpoch: number;
  readonly call: PrivateServiceInvocationCall;
  readonly requestDigest: string;
  readonly leaseDigest: string;
  readonly mountId: string;
  readonly generationId: string;
  readonly exportName: string;
  readonly deadlineUnixMs: number;
}

export interface PrivateServiceInvocationDispatch {
  readonly kind: "private-service-invocation-dispatch/1";
  readonly ownerRunId: string;
  readonly operationId: string;
  readonly allocationDigest: string;
}

export interface PrivateServiceInvocationTerminal {
  readonly kind: "private-service-invocation-terminal/1";
  readonly ownerRunId: string;
  readonly operationId: string;
  readonly allocationDigest: string;
  readonly dispatchDigest: string | null;
  readonly observation: PrivateServiceInvocationObservation;
}

export type PrivateServiceInvocationTerminalSource =
  | ServiceInvocationTerminalSource
  | "coordinator-loss";

/** Durable recovery evidence; coordinator-loss is never emitted by ServiceHostSession. */
export interface PrivateServiceInvocationObservation {
  readonly terminal: ServiceInvocationTerminal;
  readonly source: PrivateServiceInvocationTerminalSource;
}

export interface PrivateServiceInvocationClosure {
  readonly kind: "private-service-invocation-closure/1";
  readonly ownerRunId: string;
  readonly operationId: string;
  readonly allocationDigest: string;
  readonly dispatchDigest: string | null;
  readonly terminalDigest: string;
}

export function normalizePrivateServiceMountAllocation(
  value: unknown,
): PrivateServiceMountAllocation {
  const root = exactObject(value, [
    "admissionDigest",
    "bindingId",
    "candidateRevision",
    "coordinatorEpoch",
    "effectiveDeadlineUnixMs",
    "expectedExports",
    "kind",
    "mountId",
    "observationDigest",
    "recipeDigest",
    "requestDigest",
  ], "Service Mount allocation");
  if (root.kind !== "private-service-mount-allocation/1") {
    throw new TypeError("Service Mount allocation kind is invalid");
  }
  return Object.freeze({
    kind: "private-service-mount-allocation/1",
    mountId: digest(root.mountId, "Service Mount"),
    coordinatorEpoch: positiveSafeInteger(root.coordinatorEpoch, "Service Mount coordinator epoch"),
    admissionDigest: digest(root.admissionDigest, "Service Mount admission"),
    candidateRevision: positiveSafeInteger(root.candidateRevision, "Service Mount candidate revision"),
    bindingId: localName(root.bindingId, "Service Mount Binding"),
    requestDigest: digest(root.requestDigest, "Service Mount request"),
    recipeDigest: digest(root.recipeDigest, "Service Mount recipe"),
    observationDigest: digest(root.observationDigest, "Service Mount observation"),
    expectedExports: sortedLocalNames(root.expectedExports, 256, "Service Mount expected exports"),
    effectiveDeadlineUnixMs: nonnegativeSafeInteger(
      root.effectiveDeadlineUnixMs,
      "Service Mount effective deadline",
    ),
  });
}

export function encodePrivateServiceMountAllocation(value: unknown): Uint8Array {
  return canonicalJson(normalizePrivateServiceMountAllocation(value) as unknown as JsonValue);
}

export function decodePrivateServiceMountAllocation(bytes: Uint8Array): PrivateServiceMountAllocation {
  return decodeCanonical(
    bytes,
    normalizePrivateServiceMountAllocation,
    "Service Mount allocation",
  );
}

export function privateServiceMountAllocationDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Service-Mount-Allocation/1",
    normalizePrivateServiceMountAllocation(value) as unknown as JsonValue,
  );
}

export function normalizePrivateServiceMountCheckpoint(
  value: unknown,
  checkpoint: PrivateServiceMountCheckpointName,
): PrivateServiceMountCheckpoint {
  requireMountCheckpointName(checkpoint);
  const root = exactObject(
    value,
    ["allocationDigest", "kind", "mountId", "value"],
    `Service Mount ${checkpoint} checkpoint`,
  );
  const kind = `private-service-mount-${checkpoint}/1` as const;
  if (root.kind !== kind) throw new TypeError(`Service Mount ${checkpoint} kind is invalid`);
  return Object.freeze({
    kind,
    mountId: digest(root.mountId, `Service Mount ${checkpoint}`),
    allocationDigest: digest(root.allocationDigest, `Service Mount ${checkpoint} allocation`),
    value: normalizeMountCheckpointValue(root.value, checkpoint),
  });
}

export function encodePrivateServiceMountCheckpoint(
  value: unknown,
  checkpoint: PrivateServiceMountCheckpointName,
): Uint8Array {
  return canonicalJson(
    normalizePrivateServiceMountCheckpoint(value, checkpoint) as unknown as JsonValue,
  );
}

export function decodePrivateServiceMountCheckpoint(
  bytes: Uint8Array,
  checkpoint: PrivateServiceMountCheckpointName,
): PrivateServiceMountCheckpoint {
  return decodeCanonical(
    bytes,
    (value) => normalizePrivateServiceMountCheckpoint(value, checkpoint),
    `Service Mount ${checkpoint} checkpoint`,
  );
}

export function privateServiceMountCheckpointDigest(
  checkpoint: PrivateServiceMountCheckpointName,
  value: unknown,
): string {
  const normalized = normalizePrivateServiceMountCheckpoint(value, checkpoint);
  return privateDomainDigest(
    `JIG-Private-Service-Mount-${domainPart(checkpoint)}/1`,
    normalized as unknown as JsonValue,
  );
}

export function normalizePrivateServiceGenerationCheckpointValue(
  value: unknown,
): PrivateServiceGenerationCheckpointValue {
  const root = exactObject(value, ["exports", "generationId"], "Service generation checkpoint value");
  return Object.freeze({
    generationId: digest(root.generationId, "Service generation"),
    exports: sortedLocalNames(root.exports, 256, "Service generation exports"),
  });
}

export function normalizePrivateServiceAcknowledgedCheckpointValue(
  value: unknown,
): PrivateServiceAcknowledgedCheckpointValue {
  const root = exactObject(value, ["generationDigest"], "Service acknowledged checkpoint value");
  return Object.freeze({
    generationDigest: digest(root.generationDigest, "Service acknowledged generation"),
  });
}

export function normalizePrivateServiceProvisionalCheckpointValue(
  value: unknown,
): PrivateServiceProvisionalCheckpointValue {
  const root = exactObject(value, ["classification", "terminal"], "Service provisional checkpoint value");
  const classification = mountClassification(root.classification);
  const terminal = normalizeServiceHostTerminal(root.terminal);
  if ((classification === "startup-cancelled" || classification === "readiness-timeout" ||
      classification === "provider-loss" || classification === "coordinator-loss") &&
      terminal.status !== "failed") {
    throw new TypeError(`Service Mount ${classification} classification requires a failed terminal`);
  }
  if ((classification === "host-lifetime" || classification === "voluntary-exit") &&
      terminal.status !== "succeeded") {
    throw new TypeError(`Service Mount ${classification} classification requires a succeeded terminal`);
  }
  return Object.freeze({ classification, terminal });
}

export function normalizePrivateServiceLeaseAllocation(
  value: unknown,
): PrivateServiceLeaseAllocation {
  const root = exactObject(value, [
    "acknowledgedDigest",
    "contract",
    "coordinatorEpoch",
    "generationDigest",
    "generationId",
    "kind",
    "mountAllocationDigest",
    "mountId",
    "ownerRunId",
    "providerBinding",
    "providerExport",
    "slot",
  ], "Service lease allocation");
  if (root.kind !== "private-service-lease-allocation/1") {
    throw new TypeError("Service lease allocation kind is invalid");
  }
  return Object.freeze({
    kind: "private-service-lease-allocation/1",
    ownerRunId: digest(root.ownerRunId, "Service lease owner Run"),
    coordinatorEpoch: positiveSafeInteger(root.coordinatorEpoch, "Service lease coordinator epoch"),
    slot: localName(root.slot, "Service lease slot"),
    mountId: digest(root.mountId, "Service lease Mount"),
    mountAllocationDigest: digest(root.mountAllocationDigest, "Service lease Mount allocation"),
    generationId: digest(root.generationId, "Service lease generation"),
    generationDigest: digest(root.generationDigest, "Service lease generation checkpoint"),
    acknowledgedDigest: digest(root.acknowledgedDigest, "Service lease acknowledgement"),
    providerBinding: localName(root.providerBinding, "Service lease provider Binding"),
    providerExport: localName(root.providerExport, "Service lease provider export"),
    contract: normalizeContractIdentity(root.contract),
  });
}

export function encodePrivateServiceLeaseAllocation(value: unknown): Uint8Array {
  return canonicalJson(normalizePrivateServiceLeaseAllocation(value) as unknown as JsonValue);
}

export function decodePrivateServiceLeaseAllocation(bytes: Uint8Array): PrivateServiceLeaseAllocation {
  return decodeCanonical(bytes, normalizePrivateServiceLeaseAllocation, "Service lease allocation");
}

export function privateServiceLeaseAllocationDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Service-Lease-Allocation/1",
    normalizePrivateServiceLeaseAllocation(value) as unknown as JsonValue,
  );
}

export function normalizePrivateServiceLeaseRelease(value: unknown): PrivateServiceLeaseRelease {
  const root = exactObject(value, [
    "allocationDigest",
    "invocations",
    "kind",
    "mountFenceDigest",
    "ownerRunId",
    "reason",
    "slot",
  ], "Service lease release");
  if (root.kind !== "private-service-lease-release/1") {
    throw new TypeError("Service lease release kind is invalid");
  }
  const reason = leaseReleaseReason(root.reason);
  const mountFenceDigest = root.mountFenceDigest === null
    ? null
    : digest(root.mountFenceDigest, "Service lease release Mount fence");
  if ((reason === "provider-lost" || reason === "mount-closed") && mountFenceDigest === null) {
    throw new TypeError(`Service lease ${reason} release requires Mount fence evidence`);
  }
  if (reason === "owner-closed" && mountFenceDigest !== null) {
    throw new TypeError("owner-closed Service lease release cannot carry Mount fence evidence");
  }
  const invocations = ordinaryArray(
    root.invocations,
    JSON_1_LIMITS.containerEntries,
    "Service lease release invocations",
  ).map((value) => {
    const item = exactObject(value, ["closureDigest", "operationId"], "Service lease release invocation");
    return Object.freeze({
      operationId: wireId(item.operationId, "Service lease release operation ID"),
      closureDigest: digest(item.closureDigest, "Service lease release invocation closure"),
    });
  });
  for (let index = 1; index < invocations.length; index += 1) {
    if (invocations[index - 1]!.operationId >= invocations[index]!.operationId) {
      throw new TypeError("Service lease release invocations must have unique, sorted operation IDs");
    }
  }
  return Object.freeze({
    kind: "private-service-lease-release/1",
    ownerRunId: digest(root.ownerRunId, "Service lease release owner Run"),
    slot: localName(root.slot, "Service lease release slot"),
    allocationDigest: digest(root.allocationDigest, "Service lease release allocation"),
    reason,
    mountFenceDigest,
    invocations: Object.freeze(invocations),
  });
}

export function encodePrivateServiceLeaseRelease(value: unknown): Uint8Array {
  return canonicalJson(normalizePrivateServiceLeaseRelease(value) as unknown as JsonValue);
}

export function decodePrivateServiceLeaseRelease(bytes: Uint8Array): PrivateServiceLeaseRelease {
  return decodeCanonical(bytes, normalizePrivateServiceLeaseRelease, "Service lease release");
}

export function privateServiceLeaseReleaseDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Service-Lease-Release/1",
    normalizePrivateServiceLeaseRelease(value) as unknown as JsonValue,
  );
}

export function normalizePrivateServiceInvocationAllocation(
  value: unknown,
): PrivateServiceInvocationAllocation {
  const root = exactObject(value, [
    "call",
    "coordinatorEpoch",
    "deadlineUnixMs",
    "exportName",
    "generationId",
    "kind",
    "leaseDigest",
    "mountId",
    "ownerRunId",
    "requestDigest",
  ], "Service invocation allocation");
  if (root.kind !== "private-service-invocation-allocation/1") {
    throw new TypeError("Service invocation allocation kind is invalid");
  }
  const call = normalizeInvocationCall(root.call);
  const requestDigest = digest(root.requestDigest, "Service invocation request");
  if (requestDigest !== privateServiceInvocationRequestDigest({
    slot: call.slot,
    method: call.method,
    input: call.input,
  })) {
    throw new TypeError("Service invocation request digest does not match slot, method, and input");
  }
  return Object.freeze({
    kind: "private-service-invocation-allocation/1",
    ownerRunId: digest(root.ownerRunId, "Service invocation owner Run"),
    coordinatorEpoch: positiveSafeInteger(root.coordinatorEpoch, "Service invocation coordinator epoch"),
    call,
    requestDigest,
    leaseDigest: digest(root.leaseDigest, "Service invocation lease"),
    mountId: digest(root.mountId, "Service invocation Mount"),
    generationId: digest(root.generationId, "Service invocation generation"),
    exportName: localName(root.exportName, "Service invocation export"),
    deadlineUnixMs: nonnegativeSafeInteger(root.deadlineUnixMs, "Service invocation deadline"),
  });
}

export function privateServiceInvocationRequestDigest(
  value: Pick<PrivateServiceInvocationCall, "slot" | "method" | "input">,
): string {
  const call = normalizeInvocationRequest(value);
  return privateDomainDigest(
    "JIG-Private-Service-Invocation-Request/1",
    call as unknown as JsonValue,
  );
}

export function encodePrivateServiceInvocationAllocation(value: unknown): Uint8Array {
  return canonicalJson(normalizePrivateServiceInvocationAllocation(value) as unknown as JsonValue);
}

export function decodePrivateServiceInvocationAllocation(
  bytes: Uint8Array,
): PrivateServiceInvocationAllocation {
  return decodeCanonical(
    bytes,
    normalizePrivateServiceInvocationAllocation,
    "Service invocation allocation",
  );
}

export function privateServiceInvocationAllocationDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Service-Invocation-Allocation/1",
    normalizePrivateServiceInvocationAllocation(value) as unknown as JsonValue,
  );
}

export function normalizePrivateServiceInvocationDispatch(
  value: unknown,
): PrivateServiceInvocationDispatch {
  const root = exactObject(
    value,
    ["allocationDigest", "kind", "operationId", "ownerRunId"],
    "Service invocation dispatch",
  );
  if (root.kind !== "private-service-invocation-dispatch/1") {
    throw new TypeError("Service invocation dispatch kind is invalid");
  }
  return Object.freeze({
    kind: "private-service-invocation-dispatch/1",
    ownerRunId: digest(root.ownerRunId, "Service invocation dispatch owner Run"),
    operationId: wireId(root.operationId, "Service invocation dispatch operation ID"),
    allocationDigest: digest(root.allocationDigest, "Service invocation dispatch allocation"),
  });
}

export function encodePrivateServiceInvocationDispatch(value: unknown): Uint8Array {
  return canonicalJson(normalizePrivateServiceInvocationDispatch(value) as unknown as JsonValue);
}

export function decodePrivateServiceInvocationDispatch(bytes: Uint8Array): PrivateServiceInvocationDispatch {
  return decodeCanonical(bytes, normalizePrivateServiceInvocationDispatch, "Service invocation dispatch");
}

export function privateServiceInvocationDispatchDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Service-Invocation-Dispatch/1",
    normalizePrivateServiceInvocationDispatch(value) as unknown as JsonValue,
  );
}

export function normalizePrivateServiceInvocationTerminal(
  value: unknown,
): PrivateServiceInvocationTerminal {
  const root = exactObject(value, [
    "allocationDigest",
    "dispatchDigest",
    "kind",
    "observation",
    "operationId",
    "ownerRunId",
  ], "Service invocation terminal");
  if (root.kind !== "private-service-invocation-terminal/1") {
    throw new TypeError("Service invocation terminal kind is invalid");
  }
  const observation = normalizePrivateServiceInvocationObservation(root.observation);
  const dispatchDigest = root.dispatchDigest === null
    ? null
    : digest(root.dispatchDigest, "Service invocation dispatch");
  if (observation.source !== "host-prewrite" && dispatchDigest === null) {
    throw new TypeError(`Service invocation ${observation.source} terminal requires dispatch evidence`);
  }
  return Object.freeze({
    kind: "private-service-invocation-terminal/1",
    ownerRunId: digest(root.ownerRunId, "Service invocation terminal owner Run"),
    operationId: wireId(root.operationId, "Service invocation terminal operation ID"),
    allocationDigest: digest(root.allocationDigest, "Service invocation terminal allocation"),
    dispatchDigest,
    observation,
  });
}

export function encodePrivateServiceInvocationTerminal(value: unknown): Uint8Array {
  return canonicalJson(normalizePrivateServiceInvocationTerminal(value) as unknown as JsonValue);
}

export function decodePrivateServiceInvocationTerminal(bytes: Uint8Array): PrivateServiceInvocationTerminal {
  return decodeCanonical(bytes, normalizePrivateServiceInvocationTerminal, "Service invocation terminal");
}

export function privateServiceInvocationTerminalDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Service-Invocation-Terminal/1",
    normalizePrivateServiceInvocationTerminal(value) as unknown as JsonValue,
  );
}

export function normalizePrivateServiceInvocationClosure(
  value: unknown,
): PrivateServiceInvocationClosure {
  const root = exactObject(value, [
    "allocationDigest",
    "dispatchDigest",
    "kind",
    "operationId",
    "ownerRunId",
    "terminalDigest",
  ], "Service invocation closure");
  if (root.kind !== "private-service-invocation-closure/1") {
    throw new TypeError("Service invocation closure kind is invalid");
  }
  return Object.freeze({
    kind: "private-service-invocation-closure/1",
    ownerRunId: digest(root.ownerRunId, "Service invocation closure owner Run"),
    operationId: wireId(root.operationId, "Service invocation closure operation ID"),
    allocationDigest: digest(root.allocationDigest, "Service invocation closure allocation"),
    dispatchDigest: root.dispatchDigest === null
      ? null
      : digest(root.dispatchDigest, "Service invocation closure dispatch"),
    terminalDigest: digest(root.terminalDigest, "Service invocation closure terminal"),
  });
}

export function encodePrivateServiceInvocationClosure(value: unknown): Uint8Array {
  return canonicalJson(normalizePrivateServiceInvocationClosure(value) as unknown as JsonValue);
}

export function decodePrivateServiceInvocationClosure(bytes: Uint8Array): PrivateServiceInvocationClosure {
  return decodeCanonical(bytes, normalizePrivateServiceInvocationClosure, "Service invocation closure");
}

export function privateServiceInvocationClosureDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Service-Invocation-Closure/1",
    normalizePrivateServiceInvocationClosure(value) as unknown as JsonValue,
  );
}

export function normalizePrivateServiceInvocationObservation(
  value: unknown,
): PrivateServiceInvocationObservation {
  const root = exactObject(value, ["source", "terminal"], "Service invocation observation");
  const source = invocationTerminalSource(root.source);
  const terminal = normalizeServiceInvocationTerminalValue(root.terminal);
  if (source === "host-prewrite" && terminal.status !== "failed") {
    throw new TypeError("host-prewrite Service observation requires a failed terminal");
  }
  if (source === "provider-loss" && terminal.status !== "failed") {
    throw new TypeError("provider-loss Service observation requires a failed terminal");
  }
  if (source === "cooperative-cancellation" &&
      (terminal.status !== "failed" ||
       (terminal.code !== "CANCELLED" && terminal.code !== "DEADLINE_EXCEEDED"))) {
    throw new TypeError("cooperative-cancellation Service observation requires a cancellation failure");
  }
  if (source === "coordinator-loss" &&
      (terminal.status !== "failed" || terminal.code !== "UNCERTAIN")) {
    throw new TypeError("coordinator-loss Service observation requires an UNCERTAIN failure");
  }
  return Object.freeze({ source, terminal });
}

function normalizeMountCheckpointValue(
  value: unknown,
  checkpoint: PrivateServiceMountCheckpointName,
): JsonValue {
  if (checkpoint === "generation") {
    return normalizePrivateServiceGenerationCheckpointValue(value) as unknown as JsonValue;
  }
  if (checkpoint === "acknowledged") {
    return normalizePrivateServiceAcknowledgedCheckpointValue(value) as unknown as JsonValue;
  }
  if (checkpoint === "provisional") {
    return normalizePrivateServiceProvisionalCheckpointValue(value) as unknown as JsonValue;
  }
  throw new TypeError("Service Mount checkpoint name is invalid");
}

function normalizeInvocationCall(value: unknown): PrivateServiceInvocationCall {
  const root = exactObject(value, ["input", "method", "operationId", "slot"], "Service invocation call");
  return Object.freeze({
    operationId: wireId(root.operationId, "Service invocation operation ID"),
    slot: localName(root.slot, "Service invocation slot"),
    method: localName(root.method, "Service invocation method"),
    input: normalizeJson(root.input),
  });
}

function normalizeInvocationRequest(
  value: Pick<PrivateServiceInvocationCall, "slot" | "method" | "input">,
): Readonly<{ readonly slot: string; readonly method: string; readonly input: JsonValue }> {
  const root = exactObject(value, ["input", "method", "slot"], "Service invocation request");
  return Object.freeze({
    slot: localName(root.slot, "Service invocation request slot"),
    method: localName(root.method, "Service invocation request method"),
    input: normalizeJson(root.input),
  });
}

function normalizeContractIdentity(value: unknown): ContractIdentity {
  const root = exactObject(value, ["digest", "id", "version"], "Service lease Capability Contract");
  if (typeof root.id !== "string" || !isCapabilityContractId(root.id)) {
    throw new TypeError("Service lease Capability Contract ID is invalid");
  }
  if (typeof root.version !== "string" || !isCapabilityContractVersion(root.version)) {
    throw new TypeError("Service lease Capability Contract version is invalid");
  }
  return Object.freeze({
    id: root.id,
    version: root.version,
    digest: digest(root.digest, "Service lease Capability Contract"),
  });
}

function normalizeServiceHostTerminal(value: unknown): ServiceHostTerminal {
  const status = objectField(value, "status", "Service Host terminal");
  if (status === "succeeded") {
    const root = exactObject(value, ["diagnostics", "status"], "successful Service Host terminal");
    return Object.freeze({ status: "succeeded", diagnostics: normalizeDiagnostics(root.diagnostics) });
  }
  if (status === "failed") {
    const hasDetails = objectHas(value, "details", "failed Service Host terminal");
    const root = exactObject(
      value,
      hasDetails
        ? ["code", "details", "diagnostics", "message", "status"]
        : ["code", "diagnostics", "message", "status"],
      "failed Service Host terminal",
    );
    const terminal = {
      status: "failed" as const,
      code: failureCode(root.code, "Service Host terminal"),
      message: boundedString(root.message, 0, JSON_1_LIMITS.stringBytes, "Service Host terminal message"),
      ...(hasDetails ? { details: normalizeJson(root.details) } : {}),
      diagnostics: normalizeDiagnostics(root.diagnostics),
    };
    return Object.freeze(terminal);
  }
  throw new TypeError("Service Host terminal status is invalid");
}

function normalizeServiceInvocationTerminalValue(value: unknown): ServiceInvocationTerminal {
  const status = objectField(value, "status", "Service invocation result");
  if (status === "succeeded") {
    const root = exactObject(value, ["status", "value"], "successful Service invocation result");
    return Object.freeze({ status: "succeeded", value: normalizeJson(root.value) });
  }
  if (status === "application-error") {
    const root = exactObject(value, ["data", "name", "status"], "Service application error result");
    return Object.freeze({
      status: "application-error",
      name: localName(root.name, "Service application error name"),
      data: normalizeJson(root.data),
    });
  }
  if (status === "failed") {
    const hasDetails = objectHas(value, "details", "failed Service invocation result");
    const root = exactObject(
      value,
      hasDetails ? ["code", "details", "message", "status"] : ["code", "message", "status"],
      "failed Service invocation result",
    );
    return Object.freeze({
      status: "failed",
      code: failureCode(root.code, "Service invocation result"),
      message: boundedString(root.message, 0, JSON_1_LIMITS.stringBytes, "Service invocation message"),
      ...(hasDetails ? { details: normalizeJson(root.details) } : {}),
    });
  }
  throw new TypeError("Service invocation result status is invalid");
}

function normalizeDiagnostics(value: unknown): ServiceHostTerminal["diagnostics"] {
  const root = exactObject(value, ["stderr", "stderrBytes", "stderrTruncated"], "Service diagnostics");
  return Object.freeze({
    stderr: boundedString(root.stderr, 0, JSON_1_LIMITS.stringBytes, "Service diagnostics stderr"),
    stderrBytes: nonnegativeSafeInteger(root.stderrBytes, "Service diagnostics byte count"),
    stderrTruncated: booleanValue(root.stderrTruncated, "Service diagnostics truncation"),
  });
}

function normalizeJson(value: unknown): JsonValue {
  measureJson(value, 1, {
    nodes: 0,
    encodedBytes: 0,
    active: new WeakSet<object>(),
  });
  return cloneMeasuredJson(value);
}

interface JsonMeasure {
  nodes: number;
  encodedBytes: number;
  readonly active: WeakSet<object>;
}

function measureJson(value: unknown, depth: number, state: JsonMeasure): void {
  if (depth > JSON_1_LIMITS.depth) throw new TypeError("JSON/1 maximum value depth exceeded");
  state.nodes += 1;
  if (state.nodes > JSON_1_LIMITS.nodes) throw new TypeError("JSON/1 maximum value nodes exceeded");
  if (value === null) {
    chargeJsonBytes(state, 4);
    return;
  }
  if (typeof value === "boolean") {
    chargeJsonBytes(state, value ? 4 : 5);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError("number is not JSON/1");
    }
    chargeJsonBytes(state, (Object.is(value, -0) ? "0" : JSON.stringify(value)).length);
    return;
  }
  if (typeof value === "string") {
    chargeJsonBytes(state, inspectJsonString(value, JSON_1_LIMITS.stringBytes, "JSON/1 string").encodedBytes);
    return;
  }
  if (typeof value !== "object" || utilTypes.isProxy(value)) {
    throw new TypeError("value must be ordinary JSON/1");
  }
  if (state.active.has(value)) throw new TypeError("JSON/1 value is cyclic");
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      assertOrdinaryArray(value, JSON_1_LIMITS.containerEntries, "JSON/1 array");
      chargeJsonBytes(state, 2 + Math.max(0, value.length - 1));
      for (let index = 0; index < value.length; index += 1) {
        measureJson(arrayItem(value, index, "JSON/1 array"), depth + 1, state);
      }
      return;
    }
    const names = ordinaryObjectNames(value, "JSON/1 object");
    if (names.length > JSON_1_LIMITS.containerEntries) {
      throw new TypeError("JSON/1 object exceeds its member bound");
    }
    chargeJsonBytes(state, 2 + names.length + Math.max(0, names.length - 1));
    for (const key of names) {
      chargeJsonBytes(
        state,
        inspectJsonString(key, JSON_1_LIMITS.memberNameBytes, "JSON/1 member name").encodedBytes,
      );
      measureJson(dataProperty(value, key, "JSON/1 object"), depth + 1, state);
    }
  } finally {
    state.active.delete(value);
  }
}

function cloneMeasuredJson(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) {
    const result = new Array<JsonValue>(value.length);
    for (let index = 0; index < value.length; index += 1) {
      result[index] = cloneMeasuredJson(arrayItem(value, index, "JSON/1 array"));
    }
    return Object.freeze(result);
  }
  const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const key of ordinaryObjectNames(value, "JSON/1 object")) {
    result[key] = cloneMeasuredJson(dataProperty(value as object, key, "JSON/1 object"));
  }
  return Object.freeze(result);
}

function chargeJsonBytes(state: JsonMeasure, bytes: number): void {
  if (bytes > JSON_1_LIMITS.bytes - state.encodedBytes) {
    throw new TypeError("JSON/1 maximum encoded bytes exceeded");
  }
  state.encodedBytes += bytes;
}

function inspectJsonString(
  value: string,
  rawByteLimit: number,
  label: string,
): Readonly<{ readonly encodedBytes: number; readonly rawBytes: number; readonly scalars: number }> {
  let encodedBytes = 2;
  let rawBytes = 0;
  let scalars = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    scalars += 1;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) throw new TypeError(`${label} contains a lone surrogate`);
      rawBytes += 4;
      encodedBytes += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${label} contains a lone surrogate`);
    } else if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 ||
        code === 0x0a || code === 0x0c || code === 0x0d) {
      rawBytes += 1;
      encodedBytes += 2;
    } else if (code <= 0x1f) {
      rawBytes += 1;
      encodedBytes += 6;
    } else if (code <= 0x7f) {
      rawBytes += 1;
      encodedBytes += 1;
    } else if (code <= 0x7ff) {
      rawBytes += 2;
      encodedBytes += 2;
    } else {
      rawBytes += 3;
      encodedBytes += 3;
    }
    if (rawBytes > rawByteLimit) throw new TypeError(`${label} exceeds its byte bound`);
  }
  return Object.freeze({ encodedBytes, rawBytes, scalars });
}

function exactObject(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  const actual = ordinaryObjectNames(value, label).sort(compareStrings);
  const expected = [...keys].sort(compareStrings);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual) result[key] = dataProperty(value as object, key, label);
  return result;
}

function ordinaryObjectNames(value: unknown, label: string): string[] {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value) || Array.isArray(value)) {
    throw new TypeError(`${label} must be an ordinary object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be an ordinary object`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} has unexpected members`);
  }
  const names = Object.getOwnPropertyNames(value);
  for (const key of names) dataProperty(value, key, label);
  return names;
}

function dataProperty(value: object, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
    throw new TypeError(`${label} members must be enumerable data properties`);
  }
  return descriptor.value;
}

function objectField(value: unknown, key: string, label: string): unknown {
  ordinaryObjectNames(value, label);
  return dataProperty(value as object, key, label);
}

function objectHas(value: unknown, key: string, label: string): boolean {
  const names = ordinaryObjectNames(value, label);
  return names.includes(key);
}

function ordinaryArray(value: unknown, maximum: number, label: string): readonly unknown[] {
  assertOrdinaryArray(value, maximum, label);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    result.push(arrayItem(value, index, label));
  }
  return result;
}

function assertOrdinaryArray(
  value: unknown,
  maximum: number,
  label: string,
): asserts value is unknown[] {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value) || !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be an ordinary array`);
  }
  if (value.length > maximum) throw new TypeError(`${label} exceed their bound`);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${label} have unexpected members`);
  const names = Object.getOwnPropertyNames(value).filter((name) => name !== "length");
  if (names.length !== value.length) throw new TypeError(`${label} must be dense`);
  for (let index = 0; index < value.length; index += 1) arrayItem(value, index, label);
}

function arrayItem(value: readonly unknown[], index: number, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
  if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
    throw new TypeError(`${label} must contain only enumerable data items`);
  }
  return descriptor.value;
}

function sortedLocalNames(value: unknown, maximum: number, label: string): readonly string[] {
  const names = ordinaryArray(value, maximum, label).map((item) => localName(item, label));
  for (let index = 1; index < names.length; index += 1) {
    if (names[index - 1]! >= names[index]!) throw new TypeError(`${label} must be unique and sorted`);
  }
  return Object.freeze(names);
}

function decodeCanonical<T>(
  bytes: Uint8Array,
  normalize: (value: unknown) => T,
  label: string,
): T {
  if (bytes === null || typeof bytes !== "object" || utilTypes.isProxy(bytes) ||
      !(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype) {
    throw new TypeError(`${label} bytes must be an ordinary Uint8Array`);
  }
  const normalized = normalize(decodeJson1(bytes));
  if (!sameBytes(bytes, canonicalJson(normalized as unknown as JsonValue))) {
    throw new TypeError(`${label} is not canonical JSON/1`);
  }
  return normalized;
}

function requireMountCheckpointName(value: unknown): asserts value is PrivateServiceMountCheckpointName {
  if (value === "generation" || value === "acknowledged" || value === "provisional") return;
  throw new TypeError("Service Mount checkpoint name is invalid");
}

function mountClassification(value: unknown): PrivateServiceMountClassification {
  if (value === "startup-cancelled" || value === "readiness-timeout" || value === "host-lifetime" ||
      value === "voluntary-exit" || value === "provider-loss" || value === "coordinator-loss") return value;
  throw new TypeError("Service Mount provisional classification is invalid");
}

function leaseReleaseReason(value: unknown): PrivateServiceLeaseRelease["reason"] {
  if (value === "owner-closed" || value === "provider-lost" || value === "mount-closed") return value;
  throw new TypeError("Service lease release reason is invalid");
}

function invocationTerminalSource(value: unknown): PrivateServiceInvocationTerminalSource {
  if (value === "host-prewrite" || value === "provider-response" || value === "provider-loss" ||
      value === "cooperative-cancellation" || value === "coordinator-loss") return value;
  throw new TypeError("Service invocation terminal source is invalid");
}

function failureCode(value: unknown, label: string): Extract<ServiceInvocationTerminal, { status: "failed" }>["code"] {
  if (typeof value !== "string" || !FAILURE_CODES.has(value)) throw new TypeError(`${label} code is invalid`);
  return value as Extract<ServiceInvocationTerminal, { status: "failed" }>["code"];
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`${label} digest is invalid`);
  return value;
}

function localName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 64 || !LOCAL_NAME.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function wireId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 ||
      textEncoder.encode(value).byteLength > 128 || !WIRE_ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function boundedString(value: unknown, minimum: number, maximumBytes: number, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid`);
  const inspected = inspectJsonString(value, maximumBytes, label);
  if (inspected.scalars < minimum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} is invalid`);
  return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError(`${label} is invalid`);
  return value as number;
}

function nonnegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} is invalid`);
  return value as number;
}

function domainPart(value: string): string {
  return value.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join("-");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}
