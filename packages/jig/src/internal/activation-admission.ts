import { types as utilTypes } from "node:util";

import {
  privateActivationTargetKey,
} from "./activation-planning.js";
import { privateDomainDigest } from "./identity.js";
import {
  normalizePackageArtifactRef,
  type PackageArtifactRef,
} from "./package-artifact-store.js";
import {
  createPrivateProjectLocalLock,
  decodePrivateProjectLocalLock,
  encodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
  type PrivateProjectLocalLock,
} from "./project-local-lock.js";
import {
  requirePrivateDirectRunRecipe,
  type PrivateDirectRunRecipe,
} from "./direct-run.js";
import {
  canonicalJson,
  decodeJson1,
  JSON_1_LIMITS,
  type JsonValue,
} from "../json.js";
import type { RunTargetIdentity } from "../project/package-project.js";
import {
  restorePrivateActivationRequest,
  type PrivateActivationRequest,
  requirePrivateRetainedResolutionObservation,
  type PrivateResolutionUnavailableCode,
} from "../project/package-resolution.js";
import {
  isProtectedProjectPath,
  normalizeProjectPath,
} from "../project/paths.js";
import {
  requirePrivateRetainedPackageProject,
  type PrivateRetainedPackageProject,
} from "../project/retained-project.js";

const KIND_V5 = "private-activation-candidate/5";
const PLAN_V2_KIND = "private-activation-plan/2";
const ADMISSION_KIND = "private-activation-admission/2";
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UNSIGNED_64 = /^(?:0|[1-9][0-9]{0,19})$/;
const MAX_UNSIGNED_64 = (1n << 64n) - 1n;
const MAX_EVIDENCE = 64;
const createdCandidatesV5 = new WeakSet<object>();
const inertCandidatesV5 = new WeakSet<object>();
const inertPlansV2 = new WeakSet<object>();

type PrivateActivationRecipe = PrivateDirectRunRecipe;

export interface PrivateActivationCandidateTarget {
  readonly request: PrivateActivationRequest;
  readonly disposition:
    | {
        readonly state: "ready";
        readonly recipeDigest: string;
        readonly observationDigest: string;
        readonly executionPackage: PackageArtifactRef;
      }
    | {
        readonly state: "unavailable";
        readonly code: PrivateResolutionUnavailableCode;
        readonly evidenceDigests: readonly string[];
      };
}

/** Candidate/5 separates observed planning semantics from final activation meaning. */
export interface PrivateActivationCandidateV5 {
  readonly kind: typeof KIND_V5;
  readonly projectRoot: {
    readonly device: string;
    readonly inode: string;
  };
  readonly captureDigest: string;
  readonly observedSemanticDigest: string;
  readonly activationMeaningDigest: string;
  readonly resolutionInputDigest: string;
  readonly planningObservationDigest: string;
  readonly lockDigest: string;
  readonly declarationArtifact: {
    readonly kind: "author-closure/1";
    readonly closureDigest: string;
    readonly package: PackageArtifactRef;
  };
  readonly targets: readonly PrivateActivationCandidateTarget[];
}

export interface PrivateActivationCandidateArtifactV5 {
  readonly candidate: PrivateActivationCandidateV5;
  readonly lock: PrivateProjectLocalLock;
}

export interface PrivateActivationCandidateEncodingV5 {
  readonly candidate: Uint8Array;
  readonly lock: Uint8Array;
}

export type PrivateObservedLockV2 =
  | { readonly state: "absent" }
  | {
      readonly state: "present";
      readonly digest: string;
      readonly lock: PrivateProjectLocalLock;
    };

export interface PrivateActivationPlanV2 {
  readonly kind: typeof PLAN_V2_KIND;
  readonly baseGeneration: string | null;
  readonly candidateRevision: number;
  readonly candidateDigest: string;
  readonly captureDigest: string;
  readonly resolutionInputDigest: string;
  readonly planningObservationDigest: string;
  readonly observedSemanticDigest: string;
  readonly activationMeaningDigest: string;
  readonly lockMode: "update" | "locked";
  readonly observedLock: PrivateObservedLockV2;
  readonly operation: "admission" | "lock-repair";
  readonly proposed: {
    readonly lockDigest: string;
    readonly lock: PrivateProjectLocalLock;
    readonly targets: readonly PrivateActivationCandidateTarget[];
  };
}

/**
 * One locally admitted project-policy generation. The stored record is also
 * the idempotent apply receipt.
 */
export interface PrivateActivationAdmission {
  readonly kind: typeof ADMISSION_KIND;
  readonly baseGeneration: string | null;
  readonly planDigest: string;
  readonly candidateRevision: number;
  readonly candidateDigest: string;
  readonly lockDigest: string;
}

/**
 * Build one closed activation generation containing every admitted Run target.
 */
export function createPrivateActivationCandidateV5(
  project: PrivateRetainedPackageProject,
  resolutionValue: unknown,
  recipeValue?: PrivateActivationRecipe | readonly PrivateActivationRecipe[],
): PrivateActivationCandidateArtifactV5 {
  const retained = requirePrivateRetainedPackageProject(project);
  const resolution = requirePrivateRetainedResolutionObservation(resolutionValue);
  if (resolution.captureDigest !== retained.captureDigest) {
    throw new TypeError("resolution observation belongs to a different retained project capture");
  }
  const recipeValues = readPrivateActivationRecipeValues(
    recipeValue,
    resolution.targets.length,
  );
  const recipes = recipeValues.map(requirePrivateActivationRecipe);
  const recipeByRequest = new Map<string, PrivateActivationRecipe>();
  for (const recipe of recipes) {
    if (recipe.request.mode !== "run") throw new TypeError("activation recipe must target a Run");
    if (recipeByRequest.has(recipe.request.digest)) {
      throw new TypeError("activation candidate contains duplicate recipes for one request");
    }
    recipeByRequest.set(recipe.request.digest, recipe);
  }
  const targets = resolution.targets.map((target) => {
    let disposition: PrivateActivationCandidateTarget["disposition"];
    if (target.disposition.state === "planned") {
      const recipe = recipeByRequest.get(target.request.digest);
      if (recipe === undefined ||
          recipe.observation.digest !== target.disposition.observation.digest) {
        throw new TypeError("ready recipe does not match the retained planned target");
      }
      recipeByRequest.delete(target.request.digest);
      disposition = Object.freeze({
        state: "ready" as const,
        recipeDigest: recipe.digest,
        observationDigest: recipe.observation.digest,
        executionPackage: recipe.executionPackage,
      });
    } else {
      disposition = target.disposition;
    }
    return Object.freeze({ request: target.request, disposition });
  });
  if (recipeByRequest.size !== 0) {
    throw new TypeError("activation candidate contains a recipe for an unplanned target");
  }

  const lock = createPrivateProjectLocalLock(retained.linked);
  const observedSemanticDigest = resolution.semanticDigest;
  const activationMeaningDigest = computeActivationMeaningDigest(
    observedSemanticDigest,
    targets,
  );
  const candidate = normalizeCandidateV5({
    kind: KIND_V5,
    projectRoot: retained.root,
    captureDigest: retained.captureDigest,
    observedSemanticDigest,
    activationMeaningDigest,
    resolutionInputDigest: resolution.resolutionInputDigest,
    planningObservationDigest: resolution.planningObservationDigest,
    lockDigest: privateProjectLocalLockDigest(lock),
    declarationArtifact: retained.declarationArtifact,
    targets,
  }, lock);
  encodeCandidateV5(candidate);
  return markCreatedV5(candidate, lock);
}

function requirePrivateActivationRecipe(value: unknown): PrivateActivationRecipe {
  try {
    return requirePrivateDirectRunRecipe(value);
  } catch {
    throw new TypeError("activation recipe was not produced by the direct Run planner");
  }
}

function readPrivateActivationRecipeValues(
  value: PrivateActivationRecipe | readonly PrivateActivationRecipe[] | undefined,
  maximum: number,
): readonly unknown[] {
  if (value === undefined) return [];
  if (value !== null && typeof value === "object" && utilTypes.isProxy(value)) {
    throw new TypeError("activation recipes must not be a Proxy");
  }
  if (!Array.isArray(value)) return [value];
  if (Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    throw new TypeError("activation recipes must be a bounded ordinary array");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) =>
    typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key)))) {
    throw new TypeError("activation recipes must be a dense array without extra properties");
  }
  const recipes: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("activation recipes must contain enumerable data properties");
    }
    recipes.push(descriptor.value);
  }
  return recipes;
}

/** Strictly decode inert Candidate/5 bytes; decoding never mints provenance. */
export function decodePrivateActivationCandidateV5(
  input: unknown,
): PrivateActivationCandidateArtifactV5 {
  const encoded = exactObject(input, ["candidate", "lock"], "candidate/5 encoding");
  const lockBytes = copiedBytes(encoded.lock, "candidate/5 lock bytes");
  const candidateBytes = copiedBytes(encoded.candidate, "candidate/5 bytes");
  const lock = decodePrivateProjectLocalLock(lockBytes);
  const candidate = normalizeCandidateV5(decodeJson1(candidateBytes), lock);
  if (!sameBytes(candidateBytes, encodeCandidateV5(candidate))) {
    throw new TypeError("private activation candidate/5 is not in canonical JSON/1 + LF form");
  }
  return markInertCandidateV5(candidate, lock);
}

export function encodePrivateActivationCandidateV5(
  value: unknown,
): PrivateActivationCandidateEncodingV5 {
  const artifact = requirePrivateInertActivationCandidateV5(value);
  return Object.freeze({
    candidate: encodeCandidateV5(artifact.candidate),
    lock: encodePrivateProjectLocalLock(artifact.lock),
  });
}

export function privateActivationCandidateDigestV5(value: unknown): string {
  const artifact = requirePrivateInertActivationCandidateV5(value);
  return privateDomainDigest(
    "JIG-Private-Activation-Candidate/5",
    artifact.candidate as unknown as JsonValue,
  );
}

/** Require only the invocation-local Candidate/5 factory result. */
export function requirePrivateCreatedActivationCandidateV5(
  value: unknown,
): PrivateActivationCandidateArtifactV5 {
  if (value === null || typeof value !== "object" || !createdCandidatesV5.has(value)) {
    throw new TypeError("activation candidate/5 was not built from a retained project and resolution");
  }
  return value as PrivateActivationCandidateArtifactV5;
}

/** Require a factory- or strict-decoder-minted descriptor-inert Candidate/5. */
export function requirePrivateInertActivationCandidateV5(
  value: unknown,
): PrivateActivationCandidateArtifactV5 {
  if (value === null || typeof value !== "object" || !inertCandidatesV5.has(value)) {
    throw new TypeError("activation candidate/5 was not built or strictly decoded");
  }
  return value as PrivateActivationCandidateArtifactV5;
}

/** Resolve one target only inside an already closed candidate generation. */
export function findPrivateActivationCandidateTargetV5(
  value: PrivateActivationCandidateArtifactV5,
  identity: RunTargetIdentity,
): PrivateActivationCandidateTarget | undefined {
  const artifact = requirePrivateInertActivationCandidateV5(value);
  const key = privateActivationTargetKey(normalizeIdentity(identity));
  return artifact.candidate.targets.find(
    (target) => privateActivationTargetKey(target.request.target) === key,
  );
}

/**
 * Build Plan/2 from one exact Candidate/5. The duplicated proposal and
 * evidence fields are always derived here rather than accepted from callers.
 * The caller must first authenticate the candidate revision, digest, bytes,
 * and head through protected storage; this value codec does not own that
 * persistence authority and deliberately remains usable after restart.
 */
export function createPrivateActivationPlanV2(input: {
  readonly candidate: PrivateActivationCandidateArtifactV5;
  readonly candidateRevision: number;
  readonly baseGeneration: string | null;
  readonly lockMode: "update" | "locked";
  readonly observedLock:
    | { readonly state: "absent" }
    | { readonly state: "present"; readonly lock: PrivateProjectLocalLock };
  readonly operation: "admission" | "lock-repair";
}): PrivateActivationPlanV2 {
  const source = exactObject(input, [
    "candidate",
    "candidateRevision",
    "baseGeneration",
    "lockMode",
    "observedLock",
    "operation",
  ], "activation plan/2 factory input");
  const artifact = requirePrivateInertActivationCandidateV5(source.candidate);
  const observedInput = plainObject(source.observedLock, "activation plan/2 observed input");
  const observedState = dataField(observedInput, "state", "activation plan/2 observed input");
  let observedLock: PrivateObservedLockV2;
  if (observedState === "absent") {
    exactObject(observedInput, ["state"], "activation plan/2 observed input");
    observedLock = Object.freeze({ state: "absent" as const });
  } else if (observedState === "present") {
    const present = exactObject(
      observedInput,
      ["state", "lock"],
      "activation plan/2 observed input",
    );
    const lock = decodePrivateProjectLocalLock(encodePrivateProjectLocalLock(
      present.lock as PrivateProjectLocalLock,
    ));
    observedLock = Object.freeze({
      state: "present" as const,
      digest: privateProjectLocalLockDigest(lock),
      lock,
    });
  } else {
    throw new TypeError("activation plan/2 observed input state must be absent or present");
  }
  const plan = normalizePlanV2({
    kind: PLAN_V2_KIND,
    baseGeneration: source.baseGeneration,
    candidateRevision: source.candidateRevision,
    candidateDigest: privateActivationCandidateDigestV5(artifact),
    captureDigest: artifact.candidate.captureDigest,
    resolutionInputDigest: artifact.candidate.resolutionInputDigest,
    planningObservationDigest: artifact.candidate.planningObservationDigest,
    observedSemanticDigest: artifact.candidate.observedSemanticDigest,
    activationMeaningDigest: artifact.candidate.activationMeaningDigest,
    lockMode: source.lockMode,
    observedLock,
    operation: source.operation,
    proposed: {
      lockDigest: artifact.candidate.lockDigest,
      lock: artifact.lock,
      targets: artifact.candidate.targets,
    },
  });
  // Independently valid embedded values may exceed the aggregate JSON/1
  // budget. Factory success therefore proves the complete Plan encoding too.
  encodeRecord(plan, "private activation plan/2");
  return markInertPlanV2(plan);
}

export function decodePrivateActivationPlanV2(bytesValue: unknown): PrivateActivationPlanV2 {
  const bytes = copiedBytes(bytesValue, "activation plan/2 bytes");
  const plan = normalizePlanV2(decodeJson1(bytes), true);
  if (!sameBytes(bytes, encodeRecord(plan, "private activation plan/2"))) {
    throw new TypeError("private activation plan/2 is not in canonical JSON/1 + LF form");
  }
  return markInertPlanV2(plan);
}

export function encodePrivateActivationPlanV2(value: unknown): Uint8Array {
  return encodeRecord(requirePrivateInertPlanV2(value), "private activation plan/2");
}

export function privateActivationPlanDigestV2(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Activation-Plan/2",
    requirePrivateInertPlanV2(value) as unknown as JsonValue,
  );
}

/** Build the minimal receipt for one committed lock-only repair. */
/** Require a factory- or strict-decoder-minted descriptor-inert Plan/2. */
export function requirePrivateInertPlanV2(value: unknown): PrivateActivationPlanV2 {
  if (value === null || typeof value !== "object" || !inertPlansV2.has(value)) {
    throw new TypeError("activation plan/2 was not built or strictly decoded");
  }
  return value as PrivateActivationPlanV2;
}

/** Build the closed admission record after protected storage wins its CAS. */
export function createPrivateActivationAdmission(input: {
  readonly baseGeneration: string | null;
  readonly planDigest: string;
  readonly candidateRevision: number;
  readonly candidateDigest: string;
  readonly lockDigest: string;
}): PrivateActivationAdmission {
  return normalizeAdmission({ kind: ADMISSION_KIND, ...input });
}

export function decodePrivateActivationAdmission(bytesValue: unknown): PrivateActivationAdmission {
  const bytes = copiedBytes(bytesValue, "activation admission bytes");
  const admission = normalizeAdmission(decodeJson1(bytes));
  if (!sameBytes(bytes, encodePrivateActivationAdmission(admission))) {
    throw new TypeError("private activation admission is not in canonical JSON/1 + LF form");
  }
  return admission;
}

export function encodePrivateActivationAdmission(value: unknown): Uint8Array {
  return encodeRecord(normalizeAdmission(value), "private activation admission");
}

export function privateActivationAdmissionDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Activation-Admission/2",
    normalizeAdmission(value) as unknown as JsonValue,
  );
}

function normalizeCandidateV5(
  input: unknown,
  lock: PrivateProjectLocalLock,
): PrivateActivationCandidateV5 {
  const root = exactObject(input, [
    "kind",
    "projectRoot",
    "captureDigest",
    "observedSemanticDigest",
    "activationMeaningDigest",
    "resolutionInputDigest",
    "planningObservationDigest",
    "lockDigest",
    "declarationArtifact",
    "targets",
  ], "activation candidate/5");
  if (root.kind !== KIND_V5) {
    throw new TypeError(`activation candidate/5 kind must be ${KIND_V5}`);
  }

  const projectRoot = exactObject(root.projectRoot, ["device", "inode"], "project root");
  const captureDigest = requireDigest(root.captureDigest, "capture");
  const planningObservationDigest = requireDigest(
    root.planningObservationDigest,
    "planning observation",
  );
  const resolutionInputDigest = requireDigest(root.resolutionInputDigest, "resolution input");
  const expectedResolutionInput = privateDomainDigest(
    "JIG-Package-Project-Resolution-Input/1",
    { captureDigest, planningObservationDigest },
  );
  if (resolutionInputDigest !== expectedResolutionInput) {
    throw new TypeError("resolution input digest does not match capture and planning observation");
  }

  const lockDigest = requireDigest(root.lockDigest, "lock");
  if (lockDigest !== privateProjectLocalLockDigest(lock)) {
    throw new TypeError("activation candidate/5 lock digest does not match lock bytes");
  }

  const declaration = exactObject(
    root.declarationArtifact,
    ["kind", "closureDigest", "package"],
    "declaration artifact",
  );
  if (declaration.kind !== "author-closure/1") {
    throw new TypeError("declaration artifact kind must be author-closure/1");
  }

  const targets = normalizeCandidateTargets(root.targets, lock, "activation candidate/5");
  const observedSemanticDigest = requireDigest(root.observedSemanticDigest, "observed semantic");
  const activationMeaningDigest = requireDigest(root.activationMeaningDigest, "activation meaning");
  const expectedActivationMeaning = computeActivationMeaningDigest(observedSemanticDigest, targets);
  if (activationMeaningDigest !== expectedActivationMeaning) {
    throw new TypeError(
      "activation meaning digest does not match observed semantics and final target meanings",
    );
  }

  return Object.freeze({
    kind: KIND_V5,
    projectRoot: Object.freeze({
      device: requireUnsigned64(projectRoot.device, "project root device"),
      inode: requireUnsigned64(projectRoot.inode, "project root inode"),
    }),
    captureDigest,
    observedSemanticDigest,
    activationMeaningDigest,
    resolutionInputDigest,
    planningObservationDigest,
    lockDigest,
    declarationArtifact: Object.freeze({
      kind: "author-closure/1" as const,
      closureDigest: requireDigest(declaration.closureDigest, "declaration closure"),
      package: normalizePackageArtifactRef(declaration.package),
    }),
    targets,
  });
}

function normalizeCandidateTargets(
  value: unknown,
  lock: PrivateProjectLocalLock,
  label: string,
): readonly PrivateActivationCandidateTarget[] {
  const targets = ordinaryArray(value, JSON_1_LIMITS.containerEntries, `${label} targets`)
    .map((target) => normalizeTarget(target))
    .sort((left, right) => compareOrdinal(
      privateActivationTargetKey(left.request.target),
      privateActivationTargetKey(right.request.target),
    ));
  if (targets.length === 0) throw new TypeError(`${label} requires at least one target`);
  for (let index = 1; index < targets.length; index += 1) {
    if (privateActivationTargetKey(targets[index - 1]!.request.target) ===
        privateActivationTargetKey(targets[index]!.request.target)) {
      throw new TypeError(`${label} contains duplicate targets`);
    }
  }
  requireExactTargetSet(targets.map((target) => target.request.target), lock);
  for (const target of targets) requireRequestLockProjection(target.request, lock);
  return Object.freeze(targets);
}

function computeActivationMeaningDigest(
  observedSemanticDigest: string,
  targets: readonly PrivateActivationCandidateTarget[],
): string {
  return privateDomainDigest(
    "JIG-Private-Activation-Meaning/1",
    {
      observedSemanticDigest,
      targets,
    } as unknown as JsonValue,
  );
}

function normalizePlanV2(input: unknown, decodedLocks = false): PrivateActivationPlanV2 {
  const root = exactObject(input, [
    "kind",
    "baseGeneration",
    "candidateRevision",
    "candidateDigest",
    "captureDigest",
    "resolutionInputDigest",
    "planningObservationDigest",
    "observedSemanticDigest",
    "activationMeaningDigest",
    "lockMode",
    "observedLock",
    "operation",
    "proposed",
  ], "activation plan/2");
  if (root.kind !== PLAN_V2_KIND) {
    throw new TypeError(`activation plan/2 kind must be ${PLAN_V2_KIND}`);
  }
  if (root.lockMode !== "update" && root.lockMode !== "locked") {
    throw new TypeError("activation plan/2 lock mode must be update or locked");
  }
  if (root.operation !== "admission" && root.operation !== "lock-repair") {
    throw new TypeError("activation plan/2 operation must be admission or lock-repair");
  }
  if (root.operation === "lock-repair" && root.lockMode !== "update") {
    throw new TypeError("activation plan/2 lock repair requires update lock mode");
  }

  const proposedInput = exactObject(
    root.proposed,
    ["lockDigest", "lock", "targets"],
    "activation plan/2 proposed state",
  );
  const proposedLock = normalizeEmbeddedLock(
    proposedInput.lock,
    "activation plan/2 proposed lock",
    decodedLocks,
  );
  const proposedLockDigest = requireDigest(proposedInput.lockDigest, "proposed lock");
  if (proposedLockDigest !== privateProjectLocalLockDigest(proposedLock)) {
    throw new TypeError("activation plan/2 proposed lock digest does not match its lock");
  }
  const targets = normalizeCandidateTargets(
    proposedInput.targets,
    proposedLock,
    "activation plan/2 proposed state",
  );

  const observedSemanticDigest = requireDigest(root.observedSemanticDigest, "observed semantic");
  const activationMeaningDigest = requireDigest(root.activationMeaningDigest, "activation meaning");
  if (activationMeaningDigest !== computeActivationMeaningDigest(observedSemanticDigest, targets)) {
    throw new TypeError(
      "activation plan/2 meaning digest does not match observed semantics and proposed targets",
    );
  }

  const captureDigest = requireDigest(root.captureDigest, "capture");
  const planningObservationDigest = requireDigest(
    root.planningObservationDigest,
    "planning observation",
  );
  const resolutionInputDigest = requireDigest(root.resolutionInputDigest, "resolution input");
  if (resolutionInputDigest !== privateDomainDigest(
    "JIG-Package-Project-Resolution-Input/1",
    { captureDigest, planningObservationDigest },
  )) {
    throw new TypeError(
      "activation plan/2 resolution input does not match capture and planning observation",
    );
  }

  const observedInput = plainObject(root.observedLock, "activation plan/2 observed lock");
  const observedState = dataField(observedInput, "state", "activation plan/2 observed lock");
  let observedLock: PrivateObservedLockV2;
  if (observedState === "absent") {
    exactObject(observedInput, ["state"], "activation plan/2 observed lock");
    observedLock = Object.freeze({ state: "absent" as const });
  } else if (observedState === "present") {
    const present = exactObject(
      observedInput,
      ["state", "digest", "lock"],
      "activation plan/2 observed lock",
    );
    const lock = normalizeEmbeddedLock(
      present.lock,
      "activation plan/2 observed lock value",
      decodedLocks,
    );
    const digest = requireDigest(present.digest, "observed lock");
    if (digest !== privateProjectLocalLockDigest(lock)) {
      throw new TypeError("activation plan/2 observed lock digest does not match its lock");
    }
    observedLock = Object.freeze({ state: "present" as const, digest, lock });
  } else {
    throw new TypeError("activation plan/2 observed lock state must be absent or present");
  }
  if (root.lockMode === "locked" && (
    observedLock.state !== "present" || !samePrivateLocks(observedLock.lock, proposedLock)
  )) {
    throw new TypeError("locked activation plan/2 requires the exact proposed lock observation");
  }
  const baseGeneration = root.baseGeneration === null
    ? null
    : requireDigest(root.baseGeneration, "base generation");
  if (root.operation === "lock-repair") {
    if (baseGeneration === null) {
      throw new TypeError("activation plan/2 lock repair requires an active base generation");
    }
    if (observedLock.state === "present" && samePrivateLocks(observedLock.lock, proposedLock)) {
      throw new TypeError("activation plan/2 lock repair requires an absent or drifted visible lock");
    }
  }

  return Object.freeze({
    kind: PLAN_V2_KIND,
    baseGeneration,
    candidateRevision: requirePositiveSafeInteger(
      root.candidateRevision,
      "activation plan/2 candidate revision",
    ),
    candidateDigest: requireDigest(root.candidateDigest, "plan candidate"),
    captureDigest,
    resolutionInputDigest,
    planningObservationDigest,
    observedSemanticDigest,
    activationMeaningDigest,
    lockMode: root.lockMode,
    observedLock,
    operation: root.operation,
    proposed: Object.freeze({
      lockDigest: proposedLockDigest,
      lock: proposedLock,
      targets,
    }),
  });
}

function normalizeAdmission(input: unknown): PrivateActivationAdmission {
  const root = exactObject(input, [
    "kind",
    "baseGeneration",
    "planDigest",
    "candidateRevision",
    "candidateDigest",
    "lockDigest",
  ], "activation admission");
  if (root.kind !== ADMISSION_KIND) {
    throw new TypeError(`activation admission kind must be ${ADMISSION_KIND}`);
  }
  const baseGeneration = root.baseGeneration === null
    ? null
    : requireDigest(root.baseGeneration, "base generation");
  return Object.freeze({
    kind: ADMISSION_KIND,
    baseGeneration,
    planDigest: requireDigest(root.planDigest, "plan"),
    candidateRevision: requirePositiveSafeInteger(
      root.candidateRevision,
      "activation admission candidate revision",
    ),
    candidateDigest: requireDigest(root.candidateDigest, "admission candidate"),
    lockDigest: requireDigest(root.lockDigest, "admission lock"),
  });
}

function normalizeTarget(input: unknown): PrivateActivationCandidateTarget {
  const value = exactObject(input, ["request", "disposition"], "target");
  const request = restorePrivateActivationRequest(value.request);
  const state = dataField(
    plainObject(value.disposition, "target disposition"),
    "state",
    "target disposition",
  );
  if (state === "ready") {
    const ready = exactObject(
      value.disposition,
      ["state", "recipeDigest", "observationDigest", "executionPackage"],
      "target disposition",
    );
    return Object.freeze({
      request,
      disposition: Object.freeze({
        state: "ready" as const,
        recipeDigest: requireDigest(ready.recipeDigest, "target recipe"),
        observationDigest: requireDigest(ready.observationDigest, "target observation"),
        executionPackage: normalizePackageArtifactRef(ready.executionPackage),
      }),
    });
  }
  const disposition = exactObject(
    value.disposition,
    ["state", "code", "evidenceDigests"],
    "target disposition",
  );
  if (disposition.state !== "unavailable") {
    throw new TypeError("target disposition must be ready or unavailable");
  }
  if (!isUnavailableCode(disposition.code)) {
    throw new TypeError("target disposition has an invalid unavailable code");
  }
  const evidence = ordinaryArray(disposition.evidenceDigests, MAX_EVIDENCE, "target evidence")
    .map((digest) => requireDigest(digest, "target evidence"))
    .sort();
  if (evidence.length === 0) throw new TypeError("unavailable target requires evidence");
  for (let index = 1; index < evidence.length; index += 1) {
    if (evidence[index - 1] === evidence[index]) {
      throw new TypeError("unavailable target contains duplicate evidence");
    }
  }
  return Object.freeze({
    request,
    disposition: Object.freeze({
      state: "unavailable" as const,
      code: disposition.code,
      evidenceDigests: Object.freeze(evidence),
    }),
  });
}

function requireRequestLockProjection(
  request: PrivateActivationRequest,
  lock: PrivateProjectLocalLock,
): void {
  const expectedPath = request.target.kind === "flow"
    ? request.target.path
    : lock.bindings[request.target.id]?.packagePath;
  if (expectedPath === undefined || request.packagePath !== expectedPath) {
    throw new TypeError("activation request package path does not match its lock target");
  }
  const packageValue = lock.packages[request.packagePath];
  if (packageValue === undefined || packageValue.digest !== request.package.digest) {
    throw new TypeError("activation request package does not match its lock projection");
  }
  if (request.target.kind === "binding") {
    const binding = lock.bindings[request.target.id];
    if (binding === undefined ||
        !sameJson(binding.settings, request.settings) ||
        !sameJson(binding.attachments, request.attachments)) {
      throw new TypeError("activation request Binding configuration does not match its lock projection");
    }
    return;
  }
  if (Object.keys(request.settings).length !== 0 ||
      Object.keys(request.attachments).length !== 0) {
    throw new TypeError("direct Flow activation request must have empty configuration");
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return sameBytes(
    canonicalJson(left as JsonValue),
    canonicalJson(right as JsonValue),
  );
}

function normalizeIdentity(value: unknown): RunTargetIdentity {
  const record = plainObject(value, "target identity");
  const kind = dataField(record, "kind", "target identity");
  if (kind === "flow") {
    const flow = exactObject(record, ["kind", "path"], "Flow target identity");
    if (typeof flow.path !== "string") throw new TypeError("Flow target path must be a string");
    const path = normalizeProjectPath(flow.path, "Flow target path");
    if (isProtectedProjectPath(path)) throw new TypeError("Flow target cannot be beneath .jig");
    return Object.freeze({ kind: "flow" as const, path });
  }
  if (kind === "binding") {
    const binding = exactObject(record, ["kind", "id"], "Binding target identity");
    if (typeof binding.id !== "string" || !LOCAL_NAME.test(binding.id) || binding.id.length > 64) {
      throw new TypeError("Binding target has an invalid LocalName");
    }
    return Object.freeze({ kind: "binding" as const, id: binding.id });
  }
  throw new TypeError("target identity must be a Flow or Binding reference");
}

function requireExactTargetSet(
  targets: readonly RunTargetIdentity[],
  lock: PrivateProjectLocalLock,
): void {
  const keys = [
    ...Object.entries(lock.packages)
      .filter(([, packageValue]) => packageValue.directRun)
      .map(([path]) => privateActivationTargetKey({ kind: "flow", path })),
    ...Object.keys(lock.bindings)
      .map((id) => privateActivationTargetKey({ kind: "binding", id })),
  ].sort();
  const expected = targets.map(privateActivationTargetKey).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError("activation candidate and lock must contain the same activation targets");
  }
}

function markCreatedV5(
  candidate: PrivateActivationCandidateV5,
  lock: PrivateProjectLocalLock,
): PrivateActivationCandidateArtifactV5 {
  const artifact = markInertCandidateV5(candidate, lock);
  createdCandidatesV5.add(artifact);
  return artifact;
}

function markInertCandidateV5(
  candidate: PrivateActivationCandidateV5,
  lock: PrivateProjectLocalLock,
): PrivateActivationCandidateArtifactV5 {
  const artifact = Object.freeze({ candidate, lock });
  inertCandidatesV5.add(artifact);
  return artifact;
}

function markInertPlanV2(plan: PrivateActivationPlanV2): PrivateActivationPlanV2 {
  inertPlansV2.add(plan);
  return plan;
}

function encodeCandidateV5(value: PrivateActivationCandidateV5): Uint8Array {
  return encodeRecord(value, "private activation candidate/5");
}

function normalizeEmbeddedLock(
  value: unknown,
  label: string,
  decoded: boolean,
): PrivateProjectLocalLock {
  if (!decoded) {
    // Programmatic callers must supply a factory- or decoder-minted lock. This
    // rejects an untrusted nested Proxy/accessor tree before traversing it.
    return decodePrivateProjectLocalLock(encodePrivateProjectLocalLock(
      value as PrivateProjectLocalLock,
    ));
  }
  // decodeJson1 produced this descriptor-inert tree from bounded bytes.
  const object = plainObject(value, label);
  return decodePrivateProjectLocalLock(encodeRecord(object, label));
}

function samePrivateLocks(left: PrivateProjectLocalLock, right: PrivateProjectLocalLock): boolean {
  return sameBytes(
    encodePrivateProjectLocalLock(left),
    encodePrivateProjectLocalLock(right),
  );
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function encodeRecord(value: object, label: string): Uint8Array {
  const body = canonicalJson(value as unknown as JsonValue);
  if (body.byteLength >= JSON_1_LIMITS.bytes) {
    throw new TypeError(`${label} maximum bytes exceeded (${JSON_1_LIMITS.bytes})`);
  }
  const bytes = new Uint8Array(body.byteLength + 1);
  bytes.set(body);
  bytes[body.byteLength] = 0x0a;
  return bytes;
}

function exactObject(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  const record = plainObject(value, label);
  const keys = Reflect.ownKeys(record);
  if (
    keys.some((key) => typeof key !== "string") ||
    keys.length !== fields.length ||
    fields.some((field) => !keys.includes(field))
  ) {
    throw new TypeError(`${label} must contain exactly ${fields.join(", ")}`);
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) result[field] = dataField(record, field, label);
  return result;
}

function plainObject(value: unknown, label: string): object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  if (utilTypes.isProxy(value)) throw new TypeError(`${label} must not be a Proxy`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}

function dataField(value: object, field: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError(`${label}.${field} must be an enumerable data property`);
  }
  return descriptor.value;
}

function ordinaryArray(value: unknown, maximum: number, label: string): readonly unknown[] {
  if (value !== null && typeof value === "object" && utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must not be a Proxy`);
  }
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be an ordinary array`);
  }
  if (value.length > maximum) throw new TypeError(`${label} exceeds ${maximum} members`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) =>
    typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key)))) {
    throw new TypeError(`${label} must not contain extra, symbolic, or sparse properties`);
  }
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label} must not be sparse or accessor-backed`);
    }
    result.push(descriptor.value);
  }
  return result;
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} digest must be sha256: followed by 64 lowercase hexadecimal digits`);
  }
  return value;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireUnsigned64(value: unknown, label: string): string {
  if (typeof value !== "string" || !UNSIGNED_64.test(value) || BigInt(value) > MAX_UNSIGNED_64) {
    throw new TypeError(`${label} must be an unsigned 64-bit decimal string`);
  }
  return value;
}

function copiedBytes(value: unknown, label: string): Uint8Array {
  if (
    value === null || typeof value !== "object" || utilTypes.isProxy(value) ||
    !(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype
  ) {
    throw new TypeError(`${label} must be an ordinary Uint8Array`);
  }
  return value.slice();
}

function isUnavailableCode(value: unknown): value is PrivateResolutionUnavailableCode {
  return [
    "RUNTIME_UNAVAILABLE",
    "SANDBOX_UNAVAILABLE",
  ].includes(value as string);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
