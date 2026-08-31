import { canonicalJson, decodeJson1, type JsonValue } from "../json.js";
import {
  decodePrivateBunNativePreparedCandidateBytes,
} from "./bun-native-prepared-candidate.js";
import {
  normalizePrivateBunNativePreparedTreeRef,
  type PrivateBunNativePreparedTreeRef,
} from "./bun-native-prepared-tree-store.js";
import { privateDomainDigest } from "./identity.js";
import {
  normalizePrivateLinuxConfirmedEnforcementReceipt,
  normalizePrivateLinuxOwnerStateAllocationIdentity,
  normalizePrivateLinuxOwnerStateCancellation,
  normalizePrivateLinuxOwnerStateReleaseReceipt,
  normalizePrivateLinuxPreparedOwnerIdentity,
  normalizePrivateLinuxSealedOwnerIdentity,
  type PrivateLinuxConfirmedEnforcementReceipt,
  type PrivateLinuxOwnerStateAllocationIdentity,
  type PrivateLinuxOwnerStateCancellation,
  type PrivateLinuxOwnerStateReleaseReceipt,
  type PrivateLinuxPreparedOwnerIdentity,
  type PrivateLinuxSealedOwnerIdentity,
} from "./linux-rootless-backend.js";
import {
  normalizePrivatePackageMaterializationAllocationIdentity,
  normalizePrivatePackageMaterializationLeaseIdentity,
  type PrivatePackageMaterializationAllocationIdentity,
  type PrivatePackageMaterializationLeaseIdentity,
} from "./package-materialization.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export const PRIVATE_ROOT_BUN_NATIVE_PREPARATION_FACT_NAMES = Object.freeze([
  "plan",
  "backing",
  "sandbox",
  "dispatch",
  "prepared",
  "fence",
  "outcome",
  "artifact",
  "release",
] as const);

export type PrivateRootBunNativePreparationFactName =
  typeof PRIVATE_ROOT_BUN_NATIVE_PREPARATION_FACT_NAMES[number];

export interface PrivateRootBunNativePreparationAllocation {
  readonly kind: "private-root-bun-native-preparation-allocation/1";
  readonly parentRunId: string;
  readonly coordinatorEpoch: number;
  readonly requestDigest: string;
  readonly packageDigest: string;
  readonly recipeObservationDigest: string;
  readonly preparationObservationDigest: string;
  readonly dependencyDigest: string;
  readonly workerDigest: string;
  readonly runtimeObservationDigest: string;
  readonly backendMechanismDigest: string;
  readonly deadlineUnixMs: number;
}

export interface PrivateRootBunNativePreparationFact {
  readonly kind: string;
  readonly parentRunId: string;
  readonly allocationDigest: string;
  readonly value: JsonValue;
}

export interface PrivateRootBunNativePreparationPlan {
  readonly kind: "private-root-bun-native-preparation-plan/1";
  readonly backendRunId: string;
  readonly cancellationGraceMs: number;
  readonly packageAllocation: PrivatePackageMaterializationAllocationIdentity;
  readonly ownerAllocation: PrivateLinuxOwnerStateAllocationIdentity;
}

export interface PrivateRootBunNativePreparationBacking {
  readonly kind: "private-root-bun-native-preparation-backing/1";
  readonly planDigest: string;
  readonly lease: PrivatePackageMaterializationLeaseIdentity;
}

export interface PrivateRootBunNativePreparationSandbox {
  readonly kind: "private-root-bun-native-preparation-sandbox/1";
  readonly backingDigest: string;
  readonly owner: PrivateLinuxSealedOwnerIdentity;
}

export interface PrivateRootBunNativePreparationDispatch {
  readonly kind: "private-root-bun-native-preparation-dispatch/1";
  readonly sandboxDigest: string;
}

export interface PrivateRootBunNativePreparationPrepared {
  readonly kind: "private-root-bun-native-preparation-prepared/1";
  readonly dispatchDigest: string;
  readonly prepared: PrivateLinuxPreparedOwnerIdentity;
}

export type PrivateRootBunNativePreparationFenceProof =
  | {
      readonly kind: "allocation-cancelled";
      readonly reason: "cancelled" | "deadline" | "setup_failed";
      readonly cancellation: PrivateLinuxOwnerStateCancellation;
    }
  | {
      readonly kind: "enforcement-confirmed";
      readonly sandboxDigest: string;
      readonly receipt: PrivateLinuxConfirmedEnforcementReceipt;
    };

export interface PrivateRootBunNativePreparationFence {
  readonly kind: "private-root-bun-native-preparation-fence/1";
  readonly planDigest: string;
  readonly proof: PrivateRootBunNativePreparationFenceProof;
}

export type PrivateRootBunNativePreparationOutcome =
  | {
      readonly status: "succeeded";
      readonly preparedDigest: string;
      readonly fenceDigest: string;
      readonly candidateDigest: string;
      readonly candidateBytesBase64: string;
    }
  | {
      readonly status: "failed";
      readonly code: "CANCELLED" | "DEADLINE_EXCEEDED" | "EXECUTION_FAILED" |
        "INVALID_RESULT" | "UNCERTAIN";
      readonly message: string;
      readonly dispatchDigest: string | null;
      readonly fenceDigest: string | null;
    };

export interface PrivateRootBunNativePreparationArtifact {
  readonly kind: "private-root-bun-native-preparation-artifact/1";
  readonly outcomeDigest: string;
  readonly reference: PrivateBunNativePreparedTreeRef;
}

export interface PrivateRootBunNativePreparationRelease {
  readonly kind: "private-root-bun-native-preparation-release/1";
  readonly outcomeDigest: string;
  readonly planDigest: string | null;
  readonly backingDigest: string | null;
  readonly fenceDigest: string | null;
  readonly artifactDigest: string | null;
  readonly packageReleased: true;
  readonly ownerRelease: PrivateLinuxOwnerStateReleaseReceipt | null;
}

export interface PrivateRootBunNativePreparationFactValueMap {
  readonly plan: PrivateRootBunNativePreparationPlan;
  readonly backing: PrivateRootBunNativePreparationBacking;
  readonly sandbox: PrivateRootBunNativePreparationSandbox;
  readonly dispatch: PrivateRootBunNativePreparationDispatch;
  readonly prepared: PrivateRootBunNativePreparationPrepared;
  readonly fence: PrivateRootBunNativePreparationFence;
  readonly outcome: PrivateRootBunNativePreparationOutcome;
  readonly artifact: PrivateRootBunNativePreparationArtifact;
  readonly release: PrivateRootBunNativePreparationRelease;
}

export interface PrivateRootBunNativePreparationFactDigests {
  readonly plan: string | null;
  readonly backing: string | null;
  readonly sandbox: string | null;
  readonly dispatch: string | null;
  readonly prepared: string | null;
  readonly fence: string | null;
  readonly outcome: string | null;
  readonly artifact: string | null;
  readonly release: string;
}

export interface PrivateRootBunNativePreparationClosure {
  readonly kind: "private-root-bun-native-preparation-closure/1";
  readonly parentRunId: string;
  readonly allocationDigest: string;
  readonly facts: PrivateRootBunNativePreparationFactDigests;
}

export function normalizePrivateRootBunNativePreparationAllocation(
  value: unknown,
): PrivateRootBunNativePreparationAllocation {
  const root = exactRecord(value, [
    "backendMechanismDigest",
    "coordinatorEpoch",
    "deadlineUnixMs",
    "dependencyDigest",
    "kind",
    "packageDigest",
    "parentRunId",
    "preparationObservationDigest",
    "recipeObservationDigest",
    "requestDigest",
    "runtimeObservationDigest",
    "workerDigest",
  ], "root Bun native preparation allocation");
  if (root.kind !== "private-root-bun-native-preparation-allocation/1") {
    throw new TypeError("root Bun native preparation allocation kind is invalid");
  }
  return Object.freeze({
    kind: "private-root-bun-native-preparation-allocation/1",
    parentRunId: digest(root.parentRunId, "root Bun native preparation parent Run"),
    coordinatorEpoch: positiveSafeInteger(
      root.coordinatorEpoch,
      "root Bun native preparation coordinator epoch",
    ),
    requestDigest: digest(root.requestDigest, "root Bun native preparation request"),
    packageDigest: digest(root.packageDigest, "root Bun native preparation package"),
    recipeObservationDigest: digest(
      root.recipeObservationDigest,
      "root Bun native preparation recipe observation",
    ),
    preparationObservationDigest: digest(
      root.preparationObservationDigest,
      "root Bun native preparation observation",
    ),
    dependencyDigest: digest(root.dependencyDigest, "root Bun native preparation dependency"),
    workerDigest: digest(root.workerDigest, "root Bun native preparation worker"),
    runtimeObservationDigest: digest(
      root.runtimeObservationDigest,
      "root Bun native preparation runtime observation",
    ),
    backendMechanismDigest: digest(
      root.backendMechanismDigest,
      "root Bun native preparation Backend mechanism",
    ),
    deadlineUnixMs: nonnegativeSafeInteger(
      root.deadlineUnixMs,
      "root Bun native preparation deadline",
    ),
  });
}

export function encodePrivateRootBunNativePreparationAllocation(
  value: unknown,
): Uint8Array {
  return canonicalJson(
    normalizePrivateRootBunNativePreparationAllocation(value) as unknown as JsonValue,
  );
}

export function decodePrivateRootBunNativePreparationAllocation(
  bytes: Uint8Array,
): PrivateRootBunNativePreparationAllocation {
  return decodeCanonical(
    bytes,
    normalizePrivateRootBunNativePreparationAllocation,
    encodePrivateRootBunNativePreparationAllocation,
    "root Bun native preparation allocation",
  );
}

export function privateRootBunNativePreparationAllocationDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Root-Bun-Native-Preparation-Allocation/1",
    normalizePrivateRootBunNativePreparationAllocation(value) as unknown as JsonValue,
  );
}

export function normalizePrivateRootBunNativePreparationFact(
  value: unknown,
  factNameValue: unknown,
): PrivateRootBunNativePreparationFact {
  const factName = requirePrivateRootBunNativePreparationFactName(factNameValue);
  const root = exactRecord(
    value,
    ["allocationDigest", "kind", "parentRunId", "value"],
    `root Bun native preparation ${factName}`,
  );
  const kind = `private-root-bun-native-preparation-${factName}/1`;
  if (root.kind !== kind) {
    throw new TypeError(`root Bun native preparation ${factName} kind is invalid`);
  }
  const factValue = normalizePrivateRootBunNativePreparationFactValue(
    factName,
    root.value,
  ) as unknown as JsonValue;
  return Object.freeze({
    kind,
    parentRunId: digest(root.parentRunId, `root Bun native preparation ${factName} parent Run`),
    allocationDigest: digest(
      root.allocationDigest,
      `root Bun native preparation ${factName} allocation`,
    ),
    value: factValue,
  });
}

export function normalizePrivateRootBunNativePreparationFactValue<
  Name extends PrivateRootBunNativePreparationFactName,
>(
  factName: Name,
  value: unknown,
): PrivateRootBunNativePreparationFactValueMap[Name] {
  const normalized = factName === "plan"
    ? normalizePrivateRootBunNativePreparationPlan(value)
    : factName === "backing"
      ? normalizePrivateRootBunNativePreparationBacking(value)
      : factName === "sandbox"
        ? normalizePrivateRootBunNativePreparationSandbox(value)
        : factName === "dispatch"
          ? normalizePrivateRootBunNativePreparationDispatch(value)
          : factName === "prepared"
            ? normalizePrivateRootBunNativePreparationPrepared(value)
            : factName === "fence"
              ? normalizePrivateRootBunNativePreparationFence(value)
              : factName === "outcome"
                ? normalizePrivateRootBunNativePreparationOutcome(value)
                : factName === "artifact"
                  ? normalizePrivateRootBunNativePreparationArtifact(value)
                  : normalizePrivateRootBunNativePreparationRelease(value);
  return normalized as PrivateRootBunNativePreparationFactValueMap[Name];
}

export function normalizePrivateRootBunNativePreparationPlan(
  value: unknown,
): PrivateRootBunNativePreparationPlan {
  const root = exactRecord(value, [
    "backendRunId", "cancellationGraceMs", "kind", "ownerAllocation", "packageAllocation",
  ], "root Bun native preparation plan");
  if (root.kind !== "private-root-bun-native-preparation-plan/1") {
    throw new TypeError("root Bun native preparation plan kind is invalid");
  }
  return Object.freeze({
    kind: "private-root-bun-native-preparation-plan/1",
    backendRunId: backendRunId(root.backendRunId),
    cancellationGraceMs: positiveSafeInteger(
      root.cancellationGraceMs,
      "root Bun native preparation cancellation grace",
    ),
    packageAllocation: normalizePrivatePackageMaterializationAllocationIdentity(
      root.packageAllocation,
    ),
    ownerAllocation: normalizePrivateLinuxOwnerStateAllocationIdentity(root.ownerAllocation),
  });
}

export function normalizePrivateRootBunNativePreparationBacking(
  value: unknown,
): PrivateRootBunNativePreparationBacking {
  const root = exactRecord(
    value,
    ["kind", "lease", "planDigest"],
    "root Bun native preparation backing",
  );
  if (root.kind !== "private-root-bun-native-preparation-backing/1") {
    throw new TypeError("root Bun native preparation backing kind is invalid");
  }
  return Object.freeze({
    kind: "private-root-bun-native-preparation-backing/1",
    planDigest: digest(root.planDigest, "root Bun native preparation backing plan"),
    lease: normalizePrivatePackageMaterializationLeaseIdentity(root.lease),
  });
}

export function normalizePrivateRootBunNativePreparationSandbox(
  value: unknown,
): PrivateRootBunNativePreparationSandbox {
  const root = exactRecord(
    value,
    ["backingDigest", "kind", "owner"],
    "root Bun native preparation sandbox",
  );
  if (root.kind !== "private-root-bun-native-preparation-sandbox/1") {
    throw new TypeError("root Bun native preparation sandbox kind is invalid");
  }
  return Object.freeze({
    kind: "private-root-bun-native-preparation-sandbox/1",
    backingDigest: digest(root.backingDigest, "root Bun native preparation sandbox backing"),
    owner: normalizePrivateLinuxSealedOwnerIdentity(root.owner),
  });
}

export function normalizePrivateRootBunNativePreparationDispatch(
  value: unknown,
): PrivateRootBunNativePreparationDispatch {
  const root = exactRecord(
    value,
    ["kind", "sandboxDigest"],
    "root Bun native preparation dispatch",
  );
  if (root.kind !== "private-root-bun-native-preparation-dispatch/1") {
    throw new TypeError("root Bun native preparation dispatch kind is invalid");
  }
  return Object.freeze({
    kind: "private-root-bun-native-preparation-dispatch/1",
    sandboxDigest: digest(root.sandboxDigest, "root Bun native preparation dispatch sandbox"),
  });
}

export function normalizePrivateRootBunNativePreparationPrepared(
  value: unknown,
): PrivateRootBunNativePreparationPrepared {
  const root = exactRecord(
    value,
    ["dispatchDigest", "kind", "prepared"],
    "root Bun native preparation prepared fact",
  );
  if (root.kind !== "private-root-bun-native-preparation-prepared/1") {
    throw new TypeError("root Bun native preparation prepared fact kind is invalid");
  }
  return Object.freeze({
    kind: "private-root-bun-native-preparation-prepared/1",
    dispatchDigest: digest(root.dispatchDigest, "root Bun native preparation prepared dispatch"),
    prepared: normalizePrivateLinuxPreparedOwnerIdentity(root.prepared),
  });
}

export function normalizePrivateRootBunNativePreparationFence(
  value: unknown,
): PrivateRootBunNativePreparationFence {
  const root = exactRecord(
    value,
    ["kind", "planDigest", "proof"],
    "root Bun native preparation fence",
  );
  if (root.kind !== "private-root-bun-native-preparation-fence/1") {
    throw new TypeError("root Bun native preparation fence kind is invalid");
  }
  return Object.freeze({
    kind: "private-root-bun-native-preparation-fence/1",
    planDigest: digest(root.planDigest, "root Bun native preparation fence plan"),
    proof: normalizePrivateRootBunNativePreparationFenceProof(root.proof),
  });
}

function normalizePrivateRootBunNativePreparationFenceProof(
  value: unknown,
): PrivateRootBunNativePreparationFenceProof {
  if (value !== null && typeof value === "object" &&
      Object.prototype.hasOwnProperty.call(value, "cancellation")) {
    const root = exactRecord(
      value,
      ["cancellation", "kind", "reason"],
      "root Bun native preparation allocation-cancellation proof",
    );
    if (root.kind !== "allocation-cancelled" ||
        (root.reason !== "cancelled" && root.reason !== "deadline" &&
         root.reason !== "setup_failed")) {
      throw new TypeError("root Bun native preparation cancellation proof kind is invalid");
    }
    return Object.freeze({
      kind: "allocation-cancelled",
      reason: root.reason,
      cancellation: normalizePrivateLinuxOwnerStateCancellation(root.cancellation),
    });
  }
  const root = exactRecord(
    value,
    ["kind", "receipt", "sandboxDigest"],
    "root Bun native preparation enforcement proof",
  );
  if (root.kind !== "enforcement-confirmed") {
    throw new TypeError("root Bun native preparation enforcement proof kind is invalid");
  }
  return Object.freeze({
    kind: "enforcement-confirmed",
    sandboxDigest: digest(root.sandboxDigest, "root Bun native preparation fence sandbox"),
    receipt: normalizePrivateLinuxConfirmedEnforcementReceipt(root.receipt),
  });
}

export function normalizePrivateRootBunNativePreparationOutcome(
  value: unknown,
): PrivateRootBunNativePreparationOutcome {
  if (value !== null && typeof value === "object" &&
      Object.prototype.hasOwnProperty.call(value, "candidateBytesBase64")) {
    const root = exactRecord(
      value,
      ["candidateBytesBase64", "candidateDigest", "fenceDigest", "preparedDigest", "status"],
      "root Bun native preparation successful outcome",
    );
    if (root.status !== "succeeded" || typeof root.candidateBytesBase64 !== "string") {
      throw new TypeError("root Bun native preparation successful outcome status is invalid");
    }
    decodePrivateRootBunNativePreparationCandidateBytes(root.candidateBytesBase64);
    return Object.freeze({
      status: "succeeded",
      preparedDigest: digest(
        root.preparedDigest,
        "root Bun native preparation successful outcome prepared fact",
      ),
      fenceDigest: digest(
        root.fenceDigest,
        "root Bun native preparation successful outcome fence",
      ),
      candidateDigest: digest(
        root.candidateDigest,
        "root Bun native preparation successful outcome candidate",
      ),
      candidateBytesBase64: root.candidateBytesBase64,
    });
  }
  const root = exactRecord(
    value,
    ["code", "dispatchDigest", "fenceDigest", "message", "status"],
    "root Bun native preparation failed outcome",
  );
  if (root.status !== "failed" ||
      (root.code !== "CANCELLED" && root.code !== "DEADLINE_EXCEEDED" &&
       root.code !== "EXECUTION_FAILED" && root.code !== "INVALID_RESULT" &&
       root.code !== "UNCERTAIN") ||
      typeof root.message !== "string" || Array.from(root.message).length > 4_096) {
    throw new TypeError("root Bun native preparation failed outcome is invalid");
  }
  return Object.freeze({
    status: "failed",
    code: root.code,
    message: root.message,
    dispatchDigest: optionalDigest(
      root.dispatchDigest,
      "root Bun native preparation failed outcome dispatch",
    ),
    fenceDigest: optionalDigest(
      root.fenceDigest,
      "root Bun native preparation failed outcome fence",
    ),
  });
}

export function decodePrivateRootBunNativePreparationCandidateBytes(
  value: unknown,
): Readonly<{
  readonly dependencyDigest: string;
  readonly files: readonly Readonly<{ readonly path: string; readonly contentBase64: string }>[];
  readonly totalBytes: number;
}> {
  if (typeof value !== "string" || value.length === 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TypeError("root Bun native preparation candidate bytes are not canonical base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024 ||
      bytes.toString("base64") !== value) {
    throw new TypeError("root Bun native preparation candidate bytes exceed their bound");
  }
  const decoded = decodePrivateBunNativePreparedCandidateBytes(bytes);
  return Object.freeze({
    dependencyDigest: decoded.dependencyDigest,
    files: decoded.files,
    totalBytes: decoded.totalBytes,
  });
}

export function privateRootBunNativePreparationCandidateDigest(input: {
  readonly outcome: PrivateRootBunNativePreparationOutcome;
  readonly observationDigest: string;
  readonly requestDigest: string;
  readonly packageDigest: string;
  readonly dependencyDigest: string;
}): string {
  if (input.outcome.status !== "succeeded") {
    throw new TypeError("failed root Bun native preparation has no candidate digest");
  }
  const decoded = decodePrivateRootBunNativePreparationCandidateBytes(
    input.outcome.candidateBytesBase64,
  );
  if (decoded.dependencyDigest !== input.dependencyDigest) {
    throw new TypeError("root Bun native preparation candidate names another dependency");
  }
  return privateDomainDigest("JIG-Private-Bun-Native-Prepared-Candidate/1", {
    kind: "private-bun-native-prepared-candidate/1",
    observationDigest: digest(input.observationDigest, "root Bun native preparation observation"),
    requestDigest: digest(input.requestDigest, "root Bun native preparation request"),
    packageDigest: digest(input.packageDigest, "root Bun native preparation package"),
    dependencyDigest: digest(input.dependencyDigest, "root Bun native preparation dependency"),
    totalBytes: decoded.totalBytes,
    files: decoded.files,
  });
}

export function normalizePrivateRootBunNativePreparationArtifact(
  value: unknown,
): PrivateRootBunNativePreparationArtifact {
  const root = exactRecord(
    value,
    ["kind", "outcomeDigest", "reference"],
    "root Bun native preparation artifact",
  );
  if (root.kind !== "private-root-bun-native-preparation-artifact/1") {
    throw new TypeError("root Bun native preparation artifact kind is invalid");
  }
  return Object.freeze({
    kind: "private-root-bun-native-preparation-artifact/1",
    outcomeDigest: digest(root.outcomeDigest, "root Bun native preparation artifact outcome"),
    reference: normalizePrivateBunNativePreparedTreeRef(root.reference),
  });
}

export function normalizePrivateRootBunNativePreparationRelease(
  value: unknown,
): PrivateRootBunNativePreparationRelease {
  const root = exactRecord(value, [
    "artifactDigest", "backingDigest", "fenceDigest", "kind", "outcomeDigest",
    "ownerRelease", "packageReleased", "planDigest",
  ], "root Bun native preparation release");
  if (root.kind !== "private-root-bun-native-preparation-release/1" ||
      root.packageReleased !== true) {
    throw new TypeError("root Bun native preparation release is invalid");
  }
  return Object.freeze({
    kind: "private-root-bun-native-preparation-release/1",
    outcomeDigest: digest(root.outcomeDigest, "root Bun native preparation release outcome"),
    planDigest: optionalDigest(root.planDigest, "root Bun native preparation release plan"),
    backingDigest: optionalDigest(
      root.backingDigest,
      "root Bun native preparation release backing",
    ),
    fenceDigest: optionalDigest(root.fenceDigest, "root Bun native preparation release fence"),
    artifactDigest: optionalDigest(
      root.artifactDigest,
      "root Bun native preparation release artifact",
    ),
    packageReleased: true,
    ownerRelease: root.ownerRelease === null
      ? null
      : normalizePrivateLinuxOwnerStateReleaseReceipt(root.ownerRelease),
  });
}

export function encodePrivateRootBunNativePreparationFact(
  value: unknown,
  factName: PrivateRootBunNativePreparationFactName,
): Uint8Array {
  return canonicalJson(
    normalizePrivateRootBunNativePreparationFact(value, factName) as unknown as JsonValue,
  );
}

export function decodePrivateRootBunNativePreparationFact(
  bytes: Uint8Array,
  factName: PrivateRootBunNativePreparationFactName,
): PrivateRootBunNativePreparationFact {
  const fact = normalizePrivateRootBunNativePreparationFact(decodeJson1(bytes), factName);
  if (!sameBytes(bytes, encodePrivateRootBunNativePreparationFact(fact, factName))) {
    throw new TypeError(`root Bun native preparation ${factName} is not canonical JSON/1`);
  }
  return fact;
}

export function privateRootBunNativePreparationFactDigest(
  factNameValue: unknown,
  value: unknown,
): string {
  const factName = requirePrivateRootBunNativePreparationFactName(factNameValue);
  return privateDomainDigest(
    `JIG-Private-Root-Bun-Native-Preparation-${factName}/1`,
    normalizePrivateRootBunNativePreparationFact(value, factName) as unknown as JsonValue,
  );
}

export function normalizePrivateRootBunNativePreparationClosure(
  value: unknown,
): PrivateRootBunNativePreparationClosure {
  const root = exactRecord(
    value,
    ["allocationDigest", "facts", "kind", "parentRunId"],
    "root Bun native preparation closure",
  );
  if (root.kind !== "private-root-bun-native-preparation-closure/1") {
    throw new TypeError("root Bun native preparation closure kind is invalid");
  }
  const facts = exactRecord(
    root.facts,
    PRIVATE_ROOT_BUN_NATIVE_PREPARATION_FACT_NAMES,
    "root Bun native preparation closure facts",
  );
  const normalizedFacts = Object.freeze({
    plan: optionalDigest(facts.plan, "root Bun native preparation closure plan"),
    backing: optionalDigest(facts.backing, "root Bun native preparation closure backing"),
    sandbox: optionalDigest(facts.sandbox, "root Bun native preparation closure sandbox"),
    dispatch: optionalDigest(facts.dispatch, "root Bun native preparation closure dispatch"),
    prepared: optionalDigest(facts.prepared, "root Bun native preparation closure prepared"),
    fence: optionalDigest(facts.fence, "root Bun native preparation closure fence"),
    outcome: optionalDigest(facts.outcome, "root Bun native preparation closure outcome"),
    artifact: optionalDigest(facts.artifact, "root Bun native preparation closure artifact"),
    release: digest(facts.release, "root Bun native preparation closure release"),
  });
  return Object.freeze({
    kind: "private-root-bun-native-preparation-closure/1",
    parentRunId: digest(root.parentRunId, "root Bun native preparation closure parent Run"),
    allocationDigest: digest(
      root.allocationDigest,
      "root Bun native preparation closure allocation",
    ),
    facts: normalizedFacts,
  });
}

export function encodePrivateRootBunNativePreparationClosure(value: unknown): Uint8Array {
  return canonicalJson(
    normalizePrivateRootBunNativePreparationClosure(value) as unknown as JsonValue,
  );
}

export function decodePrivateRootBunNativePreparationClosure(
  bytes: Uint8Array,
): PrivateRootBunNativePreparationClosure {
  return decodeCanonical(
    bytes,
    normalizePrivateRootBunNativePreparationClosure,
    encodePrivateRootBunNativePreparationClosure,
    "root Bun native preparation closure",
  );
}

export function privateRootBunNativePreparationClosureDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Root-Bun-Native-Preparation-Closure/1",
    normalizePrivateRootBunNativePreparationClosure(value) as unknown as JsonValue,
  );
}

export function requirePrivateRootBunNativePreparationFactName(
  value: unknown,
): PrivateRootBunNativePreparationFactName {
  if (typeof value === "string" && (
    PRIVATE_ROOT_BUN_NATIVE_PREPARATION_FACT_NAMES as readonly string[]
  ).includes(value)) {
    return value as PrivateRootBunNativePreparationFactName;
  }
  throw new TypeError("root Bun native preparation fact name is invalid");
}

function decodeCanonical<T>(
  bytes: Uint8Array,
  normalize: (value: unknown) => T,
  encode: (value: unknown) => Uint8Array,
  label: string,
): T {
  const value = normalize(decodeJson1(bytes));
  if (!sameBytes(bytes, encode(value))) throw new TypeError(`${label} is not canonical JSON/1`);
  return value;
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
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} digest is invalid`);
  }
  return value;
}

function optionalDigest(value: unknown, label: string): string | null {
  return value === null ? null : digest(value, label);
}

function backendRunId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(value)) {
    throw new TypeError("root Bun native preparation Backend Run ID is invalid");
  }
  return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as number;
}

function nonnegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as number;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}
