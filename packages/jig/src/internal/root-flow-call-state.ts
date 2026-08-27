import { canonicalJson, decodeJson1, type JsonValue } from "../json.js";
import type { RunTargetIdentity } from "../project/package-project.js";
import { normalizeProjectPath } from "../project/paths.js";
import type { RunHostFlowCall, RunHostTerminal } from "../run/session.js";
import { privateDomainDigest } from "./identity.js";
import { normalizePrivateRootTerminal } from "./root-run-state.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const WIRE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type PrivateRootFlowCallCheckpointName =
  | "plan"
  | "backing"
  | "sandbox"
  | "prepared"
  | "provisional"
  | "fence"
  | "release"
  | "admitted";

export interface PrivateRootFlowCallAllocation {
  readonly kind: "private-root-flow-call-allocation/1";
  readonly parentRunId: string;
  readonly coordinatorEpoch: number;
  readonly call: RunHostFlowCall;
  readonly target: RunTargetIdentity;
  readonly requestDigest: string;
  readonly recipeDigest: string;
  readonly observationDigest: string;
  readonly effectiveDeadlineUnixMs: number;
}

export interface PrivateRootFlowCallFact {
  readonly digest: string;
  readonly value: JsonValue;
}

export interface PrivateRootFlowCallLifecycle {
  readonly allocation: PrivateRootFlowCallAllocation;
  readonly allocationDigest: string;
  readonly plan?: PrivateRootFlowCallFact;
  readonly backing?: PrivateRootFlowCallFact;
  readonly sandbox?: PrivateRootFlowCallFact;
  readonly prepared?: PrivateRootFlowCallFact;
  readonly provisional?: PrivateRootFlowCallFact;
  readonly fence?: PrivateRootFlowCallFact;
  readonly release?: PrivateRootFlowCallFact;
  readonly admitted?: PrivateRootFlowCallFact;
  readonly closureDigest?: string;
}

export function normalizePrivateRootFlowCallAllocation(
  value: unknown,
): PrivateRootFlowCallAllocation {
  const root = exactRecord(value, [
    "kind",
    "parentRunId",
    "coordinatorEpoch",
    "call",
    "target",
    "requestDigest",
    "recipeDigest",
    "observationDigest",
    "effectiveDeadlineUnixMs",
  ], "root Flow call allocation");
  if (root.kind !== "private-root-flow-call-allocation/1") {
    throw new TypeError("root Flow call allocation kind is invalid");
  }
  const coordinatorEpoch = positiveSafeInteger(root.coordinatorEpoch, "root Flow call coordinator epoch");
  const effectiveDeadlineUnixMs = nonnegativeSafeInteger(
    root.effectiveDeadlineUnixMs,
    "root Flow call deadline",
  );
  return Object.freeze({
    kind: "private-root-flow-call-allocation/1",
    parentRunId: digest(root.parentRunId, "root Flow call parent Run"),
    coordinatorEpoch,
    call: normalizeCall(root.call),
    target: normalizeTarget(root.target),
    requestDigest: digest(root.requestDigest, "root Flow call request"),
    recipeDigest: digest(root.recipeDigest, "root Flow call recipe"),
    observationDigest: digest(root.observationDigest, "root Flow call observation"),
    effectiveDeadlineUnixMs,
  });
}

export function privateRootFlowCallAllocationDigest(
  allocation: PrivateRootFlowCallAllocation,
): string {
  return privateDomainDigest(
    "JIG-Private-Root-Flow-Call-Allocation/1",
    normalizePrivateRootFlowCallAllocation(allocation) as unknown as JsonValue,
  );
}

export function encodePrivateRootFlowCallAllocation(
  allocation: PrivateRootFlowCallAllocation,
): Uint8Array {
  return canonicalJson(normalizePrivateRootFlowCallAllocation(allocation) as unknown as JsonValue);
}

export function decodePrivateRootFlowCallAllocation(
  bytes: Uint8Array,
): PrivateRootFlowCallAllocation {
  const allocation = normalizePrivateRootFlowCallAllocation(decodeJson1(bytes));
  if (!sameBytes(bytes, encodePrivateRootFlowCallAllocation(allocation))) {
    throw new TypeError("root Flow call allocation is not canonical JSON/1");
  }
  return allocation;
}

export function normalizePrivateRootFlowCallCheckpoint(
  value: unknown,
  checkpoint: PrivateRootFlowCallCheckpointName,
): Readonly<{
  readonly kind: string;
  readonly parentRunId: string;
  readonly allocationDigest: string;
  readonly value: JsonValue;
}> {
  const root = exactRecord(
    value,
    ["kind", "parentRunId", "allocationDigest", "value"],
    `root Flow call ${checkpoint}`,
  );
  const kind = `private-root-flow-call-${checkpoint}/1`;
  if (root.kind !== kind) throw new TypeError(`root Flow call ${checkpoint} kind is invalid`);
  const normalizedValue = checkpoint === "provisional" || checkpoint === "admitted"
    ? normalizeRunHostTerminal(root.value) as unknown as JsonValue
    : decodeJson1(canonicalJson(root.value as JsonValue));
  return Object.freeze({
    kind,
    parentRunId: digest(root.parentRunId, `root Flow call ${checkpoint} parent Run`),
    allocationDigest: digest(root.allocationDigest, `root Flow call ${checkpoint} allocation`),
    value: normalizedValue,
  });
}

export function privateRootFlowCallCheckpointDigest(
  checkpoint: PrivateRootFlowCallCheckpointName,
  envelope: ReturnType<typeof normalizePrivateRootFlowCallCheckpoint>,
): string {
  return privateDomainDigest(
    `JIG-Private-Root-Flow-Call-${checkpoint}/1`,
    envelope as unknown as JsonValue,
  );
}

export function normalizePrivateRootFlowCallClosure(value: unknown): Readonly<{
  readonly kind: "private-root-flow-call-closure/1";
  readonly parentRunId: string;
  readonly allocationDigest: string;
  readonly provisionalDigest: string;
  readonly fenceDigest: string | null;
  readonly releaseDigest: string;
  readonly admittedDigest: string;
}> {
  const root = exactRecord(value, [
    "kind",
    "parentRunId",
    "allocationDigest",
    "provisionalDigest",
    "fenceDigest",
    "releaseDigest",
    "admittedDigest",
  ], "root Flow call closure");
  if (root.kind !== "private-root-flow-call-closure/1") {
    throw new TypeError("root Flow call closure kind is invalid");
  }
  return Object.freeze({
    kind: "private-root-flow-call-closure/1",
    parentRunId: digest(root.parentRunId, "root Flow call closure parent Run"),
    allocationDigest: digest(root.allocationDigest, "root Flow call closure allocation"),
    provisionalDigest: digest(root.provisionalDigest, "root Flow call closure provisional"),
    fenceDigest: root.fenceDigest === null
      ? null
      : digest(root.fenceDigest, "root Flow call closure fence"),
    releaseDigest: digest(root.releaseDigest, "root Flow call closure release"),
    admittedDigest: digest(root.admittedDigest, "root Flow call closure admitted"),
  });
}

export function privateRootFlowCallClosureDigest(
  closure: ReturnType<typeof normalizePrivateRootFlowCallClosure>,
): string {
  return privateDomainDigest(
    "JIG-Private-Root-Flow-Call-Closure/1",
    closure as unknown as JsonValue,
  );
}

export function requirePrivateRootFlowCallCheckpointName(
  value: unknown,
): PrivateRootFlowCallCheckpointName {
  if (value === "plan" || value === "backing" || value === "sandbox" || value === "prepared" ||
      value === "provisional" || value === "fence" || value === "release" || value === "admitted") {
    return value;
  }
  throw new TypeError("root Flow call checkpoint name is invalid");
}

function normalizeRunHostTerminal(value: unknown): RunHostTerminal {
  const terminal = normalizePrivateRootTerminal(value);
  if (terminal.status === "lost") throw new TypeError("root Flow call terminal cannot be lost");
  return terminal;
}

function normalizeCall(value: unknown): RunHostFlowCall {
  const hasIntent = value !== null && typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, "intent");
  const root = exactRecord(
    value,
    hasIntent ? ["operationId", "slot", "intent", "input"] : ["operationId", "slot", "input"],
    "root Flow call",
  );
  if (typeof root.operationId !== "string" || root.operationId.length > 128 ||
      !WIRE_ID.test(root.operationId) || new TextEncoder().encode(root.operationId).byteLength > 128) {
    throw new TypeError("root Flow call operation ID is invalid");
  }
  if (typeof root.slot !== "string" || root.slot.length > 64 || !LOCAL_NAME.test(root.slot)) {
    throw new TypeError("root Flow call slot is invalid");
  }
  if (hasIntent && (typeof root.intent !== "string" || Array.from(root.intent).length < 1 ||
      Array.from(root.intent).length > 16_384)) {
    throw new TypeError("root Flow call intent is invalid");
  }
  return Object.freeze({
    operationId: root.operationId,
    slot: root.slot,
    ...(hasIntent ? { intent: root.intent as string } : {}),
    input: decodeJson1(canonicalJson(root.input as JsonValue)),
  });
}

function normalizeTarget(value: unknown): RunTargetIdentity {
  const root = exactRecord(
    value,
    value !== null && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "path")
      ? ["kind", "path"] : ["kind", "id"],
    "root Flow call target",
  );
  if (root.kind === "flow" && typeof root.path === "string") {
    return Object.freeze({ kind: "flow", path: normalizeProjectPath(root.path, "root Flow call target") });
  }
  if (root.kind === "binding" && typeof root.id === "string" && root.id.length <= 64 && LOCAL_NAME.test(root.id)) {
    return Object.freeze({ kind: "binding", id: root.id });
  }
  throw new TypeError("root Flow call target is invalid");
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
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
  if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`${label} digest is invalid`);
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

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
