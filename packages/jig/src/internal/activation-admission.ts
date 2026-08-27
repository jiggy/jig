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
  requirePrivatePythonDirectRecipe,
  type PrivatePythonDirectRecipe,
} from "./python-direct-run.js";
import {
  canonicalJson,
  decodeJson1,
  JSON_1_LIMITS,
  type JsonValue,
} from "../json.js";
import type { RunTargetIdentity } from "../project/package-project.js";
import {
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

const KIND = "private-activation-candidate/1";
const PLAN_KIND = "private-activation-plan/1";
const ADMISSION_KIND = "private-activation-admission/1";
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UNSIGNED_64 = /^(?:0|[1-9][0-9]{0,19})$/;
const MAX_UNSIGNED_64 = (1n << 64n) - 1n;
const MAX_EVIDENCE = 64;
const createdCandidates = new WeakSet<object>();

export interface PrivateActivationCandidate {
  readonly kind: typeof KIND;
  readonly projectRoot: {
    readonly device: string;
    readonly inode: string;
  };
  readonly captureDigest: string;
  readonly semanticDigest: string;
  readonly resolutionInputDigest: string;
  readonly planningObservationDigest: string;
  readonly lockDigest: string;
  readonly declarationArtifact: {
    readonly kind: "author-closure/1";
    readonly closureDigest: string;
    readonly package: PackageArtifactRef;
  };
  readonly target: {
    readonly identity: RunTargetIdentity;
    readonly requestDigest: string;
    readonly disposition:
      | {
          readonly state: "ready";
          readonly recipeDigest: string;
          readonly observationDigest: string;
        }
      | {
          readonly state: "unavailable";
          readonly code: PrivateResolutionUnavailableCode;
          readonly evidenceDigests: readonly string[];
        };
  };
}

/** One inert admission candidate and the exact portable lock it commits. */
export interface PrivateActivationCandidateArtifact {
  readonly candidate: PrivateActivationCandidate;
  readonly lock: PrivateProjectLocalLock;
}

export interface PrivateActivationCandidateEncoding {
  readonly candidate: Uint8Array;
  readonly lock: Uint8Array;
}

export type PrivateObservedLock =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly digest: string };

export interface PrivateActivationPlan {
  readonly kind: typeof PLAN_KIND;
  readonly candidateDigest: string;
  readonly candidateRevision: number;
  readonly baseGeneration: string | null;
  readonly lockMode: "update" | "locked";
  readonly observedLock: PrivateObservedLock;
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
 * Build the one-target activation record supported by this checkpoint.
 */
export function createPrivateActivationCandidate(
  project: PrivateRetainedPackageProject,
  resolutionValue: unknown,
  recipeValue?: PrivatePythonDirectRecipe,
): PrivateActivationCandidateArtifact {
  const retained = requirePrivateRetainedPackageProject(project);
  const resolution = requirePrivateRetainedResolutionObservation(resolutionValue);
  if (resolution.captureDigest !== retained.captureDigest) {
    throw new TypeError("resolution observation belongs to a different retained project capture");
  }
  if (resolution.targets.length !== 1) {
    throw new TypeError("private activation admission requires exactly one target");
  }
  const target = resolution.targets[0]!;
  let disposition: PrivateActivationCandidate["target"]["disposition"];
  if (target.disposition.state === "planned") {
    const recipe = requirePrivatePythonDirectRecipe(recipeValue);
    if (recipe.request.digest !== target.request.digest ||
        recipe.observation.digest !== target.disposition.observation.digest) {
      throw new TypeError("ready recipe does not match the retained planned target");
    }
    disposition = Object.freeze({
      state: "ready" as const,
      recipeDigest: recipe.digest,
      observationDigest: recipe.observation.digest,
    });
  } else {
    if (recipeValue !== undefined) throw new TypeError("unavailable target cannot carry a ready recipe");
    disposition = target.disposition;
  }

  const lock = createPrivateProjectLocalLock(retained.linked);
  const candidate = normalizeCandidate({
    kind: KIND,
    projectRoot: retained.root,
    captureDigest: retained.captureDigest,
    semanticDigest: resolution.semanticDigest,
    resolutionInputDigest: resolution.resolutionInputDigest,
    planningObservationDigest: resolution.planningObservationDigest,
    lockDigest: privateProjectLocalLockDigest(lock),
    declarationArtifact: retained.declarationArtifact,
    target: {
      identity: target.request.target,
      requestDigest: target.request.digest,
      disposition,
    },
  }, lock);
  encodeCandidate(candidate);
  return markCreated(candidate, lock);
}

/**
 * Strictly decode and cross-check inert persisted bytes after restart. This
 * does not authenticate their storage provenance or make them admissible.
 */
export function decodePrivateActivationCandidate(
  input: unknown,
): PrivateActivationCandidateArtifact {
  const encoded = exactObject(input, ["candidate", "lock"], "candidate encoding");
  const lockBytes = copiedBytes(encoded.lock, "candidate lock bytes");
  const candidateBytes = copiedBytes(encoded.candidate, "candidate bytes");
  const lock = decodePrivateProjectLocalLock(lockBytes);
  const candidate = normalizeCandidate(decodeJson1(candidateBytes), lock);
  if (!sameBytes(candidateBytes, encodeCandidate(candidate))) {
    throw new TypeError("private activation candidate is not in canonical JSON/1 + LF form");
  }
  return Object.freeze({ candidate, lock });
}

export function encodePrivateActivationCandidate(
  value: unknown,
): PrivateActivationCandidateEncoding {
  const artifact = normalizeArtifact(value);
  return Object.freeze({
    candidate: encodeCandidate(artifact.candidate),
    lock: encodePrivateProjectLocalLock(artifact.lock),
  });
}

export function privateActivationCandidateDigest(
  value: unknown,
): string {
  const artifact = normalizeArtifact(value);
  return privateDomainDigest(
    "JIG-Private-Activation-Candidate/1",
    artifact.candidate as unknown as JsonValue,
  );
}

/** Require the invocation-local factory result; strict decoding alone cannot mint it. */
export function requirePrivateCreatedActivationCandidate(
  value: unknown,
): PrivateActivationCandidateArtifact {
  if (value === null || typeof value !== "object" || !createdCandidates.has(value)) {
    throw new TypeError("activation candidate was not built from a retained project and resolution");
  }
  return value as PrivateActivationCandidateArtifact;
}

/** Build an inert review plan from facts already observed by protected storage. */
export function createPrivateActivationPlan(input: {
  readonly candidateDigest: string;
  readonly candidateRevision: number;
  readonly baseGeneration: string | null;
  readonly lockMode: "update" | "locked";
  readonly observedLock: PrivateObservedLock;
}): PrivateActivationPlan {
  return normalizePlan({ kind: PLAN_KIND, ...input });
}

export function decodePrivateActivationPlan(bytesValue: unknown): PrivateActivationPlan {
  const bytes = copiedBytes(bytesValue, "activation plan bytes");
  const plan = normalizePlan(decodeJson1(bytes));
  if (!sameBytes(bytes, encodePrivateActivationPlan(plan))) {
    throw new TypeError("private activation plan is not in canonical JSON/1 + LF form");
  }
  return plan;
}

export function encodePrivateActivationPlan(value: unknown): Uint8Array {
  return encodeRecord(normalizePlan(value), "private activation plan");
}

export function privateActivationPlanDigest(value: unknown): string {
  return privateDomainDigest(
    "JIG-Private-Activation-Plan/1",
    normalizePlan(value) as unknown as JsonValue,
  );
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
    "JIG-Private-Activation-Admission/1",
    normalizeAdmission(value) as unknown as JsonValue,
  );
}

function normalizeCandidate(
  input: unknown,
  lock: PrivateProjectLocalLock,
): PrivateActivationCandidate {
  const root = exactObject(input, [
    "kind",
    "projectRoot",
    "captureDigest",
    "semanticDigest",
    "resolutionInputDigest",
    "planningObservationDigest",
    "lockDigest",
    "declarationArtifact",
    "target",
  ], "activation candidate");
  if (root.kind !== KIND) throw new TypeError(`activation candidate kind must be ${KIND}`);

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
    throw new TypeError("activation candidate lock digest does not match lock bytes");
  }

  const declaration = exactObject(
    root.declarationArtifact,
    ["kind", "closureDigest", "package"],
    "declaration artifact",
  );
  if (declaration.kind !== "author-closure/1") {
    throw new TypeError("declaration artifact kind must be author-closure/1");
  }

  const target = normalizeTarget(root.target);
  requireExactTargetSet(target.identity, lock);
  if (target.disposition.state === "unavailable" &&
      target.disposition.code === "DEPENDENCY_UNAVAILABLE") {
    throw new TypeError("single-target activation admission cannot represent dependency unavailability");
  }
  return Object.freeze({
    kind: KIND,
    projectRoot: Object.freeze({
      device: requireUnsigned64(projectRoot.device, "project root device"),
      inode: requireUnsigned64(projectRoot.inode, "project root inode"),
    }),
    captureDigest,
    semanticDigest: requireDigest(root.semanticDigest, "semantic"),
    resolutionInputDigest,
    planningObservationDigest,
    lockDigest,
    declarationArtifact: Object.freeze({
      kind: "author-closure/1" as const,
      closureDigest: requireDigest(declaration.closureDigest, "declaration closure"),
      package: normalizePackageArtifactRef(declaration.package),
    }),
    target,
  });
}

function normalizePlan(input: unknown): PrivateActivationPlan {
  const root = exactObject(input, [
    "kind",
    "candidateDigest",
    "candidateRevision",
    "baseGeneration",
    "lockMode",
    "observedLock",
  ], "activation plan");
  if (root.kind !== PLAN_KIND) throw new TypeError(`activation plan kind must be ${PLAN_KIND}`);
  const candidateRevision = requirePositiveSafeInteger(
    root.candidateRevision,
    "activation plan candidate revision",
  );
  if (root.lockMode !== "update" && root.lockMode !== "locked") {
    throw new TypeError("activation plan lock mode must be update or locked");
  }
  const observed = plainObject(root.observedLock, "observed lock");
  const state = dataField(observed, "state", "observed lock");
  let observedLock: PrivateObservedLock;
  if (state === "absent") {
    exactObject(observed, ["state"], "observed lock");
    observedLock = Object.freeze({ state: "absent" as const });
  } else if (state === "present") {
    const present = exactObject(observed, ["state", "digest"], "observed lock");
    observedLock = Object.freeze({
      state: "present" as const,
      digest: requireDigest(present.digest, "observed lock"),
    });
  } else {
    throw new TypeError("observed lock state must be absent or present");
  }
  return Object.freeze({
    kind: PLAN_KIND,
    candidateDigest: requireDigest(root.candidateDigest, "plan candidate"),
    candidateRevision,
    baseGeneration: root.baseGeneration === null
      ? null
      : requireDigest(root.baseGeneration, "base generation"),
    lockMode: root.lockMode,
    observedLock,
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

function normalizeTarget(input: unknown): PrivateActivationCandidate["target"] {
  const value = exactObject(input, ["identity", "requestDigest", "disposition"], "target");
  const identity = normalizeIdentity(value.identity);
  const state = dataField(
    plainObject(value.disposition, "target disposition"),
    "state",
    "target disposition",
  );
  if (state === "ready") {
    const ready = exactObject(
      value.disposition,
      ["state", "recipeDigest", "observationDigest"],
      "target disposition",
    );
    return Object.freeze({
      identity,
      requestDigest: requireDigest(value.requestDigest, "target request"),
      disposition: Object.freeze({
        state: "ready" as const,
        recipeDigest: requireDigest(ready.recipeDigest, "target recipe"),
        observationDigest: requireDigest(ready.observationDigest, "target observation"),
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
    identity,
    requestDigest: requireDigest(value.requestDigest, "target request"),
    disposition: Object.freeze({
      state: "unavailable" as const,
      code: disposition.code,
      evidenceDigests: Object.freeze(evidence),
    }),
  });
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
  target: RunTargetIdentity,
  lock: PrivateProjectLocalLock,
): void {
  const keys = [
    ...Object.entries(lock.packages)
      .filter(([, packageValue]) => packageValue.mode === "run" && packageValue.directRun)
      .map(([path]) => privateActivationTargetKey({ kind: "flow", path })),
    ...Object.keys(lock.bindings)
      .map((id) => privateActivationTargetKey({ kind: "binding", id })),
  ].sort();
  const expected = privateActivationTargetKey(target);
  if (keys.length !== 1 || keys[0] !== expected) {
    throw new TypeError("activation candidate and lock must contain the same single activation target");
  }
}

function markCreated(
  candidate: PrivateActivationCandidate,
  lock: PrivateProjectLocalLock,
): PrivateActivationCandidateArtifact {
  const artifact = Object.freeze({ candidate, lock });
  createdCandidates.add(artifact);
  return artifact;
}

function normalizeArtifact(value: unknown): PrivateActivationCandidateArtifact {
  const root = exactObject(value, ["candidate", "lock"], "activation candidate artifact");
  if (root.lock === null || typeof root.lock !== "object") {
    throw new TypeError("activation candidate lock must be an object");
  }
  const lock = decodePrivateProjectLocalLock(encodePrivateProjectLocalLock(
    root.lock as PrivateProjectLocalLock,
  ));
  return Object.freeze({ candidate: normalizeCandidate(root.candidate, lock), lock });
}

function encodeCandidate(value: PrivateActivationCandidate): Uint8Array {
  return encodeRecord(value, "private activation candidate");
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
    "RUNTIME_AMBIGUOUS",
    "PREPARATION_AUTHORITY_REQUIRED",
    "SANDBOX_UNAVAILABLE",
    "SANDBOX_AMBIGUOUS",
    "PERMISSION_UNENFORCEABLE",
    "DEPENDENCY_UNAVAILABLE",
  ].includes(value as string);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
