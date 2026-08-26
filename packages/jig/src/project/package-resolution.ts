import {
  PRIVATE_ACTIVATION_TARGET_LIMIT,
  privateActivationTargetKey,
  requirePrivateActivationPlanningObservation,
  type PrivateActivationPlanningDisposition,
  type PrivateActivationPlanningObservation,
  type PrivateActivationRecipeObservation,
  type PrivateActivationUnavailableCode,
} from "../internal/activation-planning.js";
import { privateDomainDigest } from "../internal/identity.js";
import type { PackageArtifactRef } from "../internal/package-artifact-store.js";
import type { JsonObject, JsonValue } from "../json.js";
import type { PackageEntrypoint } from "../package/inspect.js";
import {
  requirePackageProjectValue,
  type LinkedPackageBinding,
  type PackageProjectValue,
  type RunTargetIdentity,
} from "./package-project.js";
import {
  requirePrivateRetainedPackageProject,
  type PrivateRetainedPackageProject,
} from "./retained-project.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const authenticRetainedObservations = new WeakSet<object>();
const authenticActivationRequests = new WeakSet<object>();

export interface PrivateActivationRequest {
  readonly kind: "activation-request/1";
  readonly digest: string;
  readonly target: RunTargetIdentity;
  readonly mode: "run" | "service";
  readonly packagePath: string;
  readonly package: PackageArtifactRef;
  readonly entrypoint: PackageEntrypoint;
  readonly settings: JsonObject;
  readonly attachments: LinkedPackageBinding["attachments"];
  readonly slots: LinkedPackageBinding["slots"];
}

export type PrivateResolutionUnavailableCode =
  | PrivateActivationUnavailableCode
  | "DEPENDENCY_UNAVAILABLE";

export type PrivateResolutionObservedDisposition =
  | {
      readonly state: "planned";
      readonly observation: PrivateActivationRecipeObservation;
    }
  | {
      readonly state: "unavailable";
      readonly code: PrivateResolutionUnavailableCode;
      readonly evidenceDigests: readonly string[];
    };

export interface PrivateResolvedTargetObservation {
  readonly request: PrivateActivationRequest;
  readonly disposition: PrivateResolutionObservedDisposition;
}

/**
 * Deterministic resolution observation. Even when tied to an authentic
 * retained aggregate, its digest-only activation observations are not
 * executable recipes and this value cannot be admitted.
 */
export interface PrivatePackageResolutionObservation {
  readonly kind: "package-project-resolution-observation/1";
  readonly admissible: false;
  readonly captureDigest: string;
  readonly semanticDigest: string;
  readonly resolutionInputDigest: string;
  readonly planningObservationDigest: string;
  readonly targets: readonly PrivateResolvedTargetObservation[];
}

/** Build the exact requests which trusted runtime planning must answer. */
export function buildPrivateActivationRequests(
  project: PackageProjectValue,
): readonly PrivateActivationRequest[] {
  const linked = requirePackageProjectValue(project);
  const flowByPath = new Map(linked.flows.map((flow) => [flow.provenance.projectPath, flow]));
  const requests: PrivateActivationRequest[] = [];

  for (const flow of linked.flows) {
    if (!flow.directRun) continue;
    if (flow.mode !== "run" || flow.entrypoint === undefined) {
      throw new Error("direct Run invariant violated");
    }
    requests.push(createRequest({
      target: Object.freeze({ kind: "flow" as const, path: flow.provenance.projectPath }),
      mode: flow.mode,
      packagePath: flow.provenance.projectPath,
      package: flow.package,
      entrypoint: flow.entrypoint,
      settings: emptyRecord(),
      attachments: emptyRecord(),
      slots: emptyRecord(),
    }));
  }

  for (const binding of linked.bindings) {
    const flow = flowByPath.get(binding.packagePath);
    if (flow === undefined || flow.entrypoint === undefined) {
      throw new Error(`Binding ${binding.id} has no linked exact implementation`);
    }
    requests.push(createRequest({
      target: Object.freeze({ kind: "binding" as const, id: binding.id }),
      mode: flow.mode,
      packagePath: binding.packagePath,
      package: flow.package,
      entrypoint: flow.entrypoint,
      settings: binding.settings,
      attachments: binding.attachments,
      slots: binding.slots,
    }));
  }

  if (requests.length > PRIVATE_ACTIVATION_TARGET_LIMIT) {
    throw new TypeError(
      `activation requests exceed ${PRIVATE_ACTIVATION_TARGET_LIMIT} targets`,
    );
  }

  requests.sort((left, right) => compareTargets(left.target, right.target));
  return Object.freeze(requests);
}

/** Reject structurally similar requests which did not come from the retained linker boundary. */
export function requirePrivateActivationRequest(value: unknown): PrivateActivationRequest {
  if (value === null || typeof value !== "object" || !authenticActivationRequests.has(value)) {
    throw new TypeError("activation request was not produced from a linked package project");
  }
  return value as PrivateActivationRequest;
}

/**
 * Pure testable reducer over authentic invocation-local meaning. Its output is
 * deliberately not authenticated because capture provenance is caller data.
 */
export function resolveLinkedPackageProjectObservation(
  project: PackageProjectValue,
  captureDigest: string,
  planning: PrivateActivationPlanningObservation,
): PrivatePackageResolutionObservation {
  const linked = requirePackageProjectValue(project);
  const snapshot = requirePrivateActivationPlanningObservation(planning);
  requireDigest(captureDigest, "capture");

  const requests = buildPrivateActivationRequests(linked);
  if (requests.length !== snapshot.entries.length) {
    throw new TypeError("activation planning observation does not cover the exact target set");
  }
  const plannedByTarget = new Map(snapshot.entries.map((entry) => [
    privateActivationTargetKey(entry.target),
    entry,
  ]));
  const intrinsic = new Map<string, PrivateResolvedTargetObservation>();
  for (const request of requests) {
    const key = privateActivationTargetKey(request.target);
    const planned = plannedByTarget.get(key);
    if (planned === undefined || planned.requestDigest !== request.digest) {
      throw new TypeError(`activation planning observation does not match target ${key}`);
    }
    intrinsic.set(key, Object.freeze({
      request,
      disposition: copyDisposition(planned.disposition),
    }));
  }

  const effective = propagateServiceAvailability(linked, intrinsic);
  const targets = requests.map((request) => {
    const target = effective.get(privateActivationTargetKey(request.target));
    if (target === undefined) throw new Error("resolved target invariant violated");
    return target;
  });
  const semanticValue = Object.freeze({
    kind: "package-project-observed-semantics/1" as const,
    project: semanticProject(linked),
    targets: targets.map((target) => semanticTarget(target)),
  });
  const resolutionInputDigest = privateDomainDigest(
    "JIG-Package-Project-Resolution-Input/1",
    { captureDigest, planningObservationDigest: snapshot.digest },
  );
  return Object.freeze({
    kind: "package-project-resolution-observation/1" as const,
    admissible: false as const,
    captureDigest,
    semanticDigest: privateDomainDigest(
      "JIG-Package-Project-Observed-Semantics/1",
      semanticValue,
    ),
    resolutionInputDigest,
    planningObservationDigest: snapshot.digest,
    targets: Object.freeze(targets),
  });
}

/** The only path which authenticates capture provenance for an observation. */
export function resolveRetainedPackageProjectObservation(
  project: PrivateRetainedPackageProject,
  planning: PrivateActivationPlanningObservation,
): PrivatePackageResolutionObservation {
  const retained = requirePrivateRetainedPackageProject(project);
  const result = resolveLinkedPackageProjectObservation(
    retained.linked,
    retained.captureDigest,
    planning,
  );
  authenticRetainedObservations.add(result);
  return result;
}

export function requirePrivateRetainedResolutionObservation(
  value: unknown,
): PrivatePackageResolutionObservation {
  if (value === null || typeof value !== "object" || !authenticRetainedObservations.has(value)) {
    throw new TypeError("resolution observation was not tied to the retained aggregate boundary");
  }
  return value as PrivatePackageResolutionObservation;
}

function createRequest(input: Omit<PrivateActivationRequest, "kind" | "digest">): PrivateActivationRequest {
  const valueWithoutDigest = Object.freeze({
    kind: "activation-request/1" as const,
    target: input.target,
    mode: input.mode,
    packagePath: input.packagePath,
    package: input.package,
    entrypoint: input.entrypoint,
    settings: input.settings,
    attachments: input.attachments,
    slots: input.slots,
  });
  const request = Object.freeze({
    ...valueWithoutDigest,
    digest: privateDomainDigest(
      "JIG-Activation-Request/1",
      valueWithoutDigest as unknown as JsonValue,
    ),
  });
  authenticActivationRequests.add(request);
  return request;
}

function propagateServiceAvailability(
  project: PackageProjectValue,
  intrinsic: ReadonlyMap<string, PrivateResolvedTargetObservation>,
): ReadonlyMap<string, PrivateResolvedTargetObservation> {
  const bindingById = new Map(project.bindings.map((binding) => [binding.id, binding]));
  const effective = new Map<string, PrivateResolvedTargetObservation>();
  const visiting = new Set<string>();

  const visit = (id: string): PrivateResolvedTargetObservation => {
    const key = privateActivationTargetKey({ kind: "binding", id });
    const prior = effective.get(key);
    if (prior !== undefined) return prior;
    if (visiting.has(id)) throw new Error("linked Service dependency cycle reached resolution");
    const base = intrinsic.get(key);
    const binding = bindingById.get(id);
    if (base === undefined || binding === undefined) throw new Error(`missing linked Binding ${id}`);
    if (base.disposition.state === "unavailable") {
      effective.set(key, base);
      return base;
    }
    visiting.add(id);
    try {
      const unavailableDependencies: string[] = [];
      for (const slot of Object.keys(binding.slots).sort()) {
        const value = binding.slots[slot]!;
        if (value.kind !== "capability") continue;
        const provider = visit(value.provider.binding);
        if (provider.disposition.state === "unavailable") {
          unavailableDependencies.push(privateDomainDigest(
            "JIG-Unavailable-Service-Dependency/1",
            {
              slot,
              provider: provider.request.target,
              disposition: semanticDisposition(provider.disposition),
            },
          ));
        }
      }
      if (unavailableDependencies.length === 0) {
        effective.set(key, base);
        return base;
      }
      const result = Object.freeze({
        request: base.request,
        disposition: Object.freeze({
          state: "unavailable" as const,
          code: "DEPENDENCY_UNAVAILABLE" as const,
          evidenceDigests: Object.freeze(unavailableDependencies.sort()),
        }),
      });
      effective.set(key, result);
      return result;
    } finally {
      visiting.delete(id);
    }
  };

  for (const binding of project.bindings) visit(binding.id);
  for (const [key, value] of intrinsic) if (!effective.has(key)) effective.set(key, value);
  return effective;
}

function copyDisposition(
  disposition: PrivateActivationPlanningDisposition,
): PrivateResolutionObservedDisposition {
  if (disposition.state === "planned") {
    return Object.freeze({ state: "planned" as const, observation: disposition.observation });
  }
  return Object.freeze({
    state: "unavailable" as const,
    code: disposition.code,
    evidenceDigests: disposition.evidenceDigests,
  });
}

function semanticProject(project: PackageProjectValue): JsonValue {
  return {
    flows: project.flows.map((flow) => ({
      path: flow.provenance.projectPath,
      package: flow.package,
      mode: flow.mode,
      entrypoint: flow.entrypoint ?? null,
      directRun: flow.directRun,
      uses: flow.uses,
      provides: flow.provides,
    })),
    bindings: project.bindings.map((binding) => ({
      kind: binding.kind,
      id: binding.id,
      packagePath: binding.packagePath,
      settings: binding.settings,
      attachments: binding.attachments,
      slots: binding.slots,
    })),
  } as unknown as JsonValue;
}

function semanticTarget(target: PrivateResolvedTargetObservation): JsonValue {
  return {
    target: target.request.target,
    requestDigest: target.request.digest,
    disposition: semanticDisposition(target.disposition),
  };
}

function semanticDisposition(disposition: PrivateResolutionObservedDisposition): JsonValue {
  return disposition.state === "planned"
    ? { state: "planned", observationDigest: disposition.observation.digest }
    : {
        state: "unavailable",
        code: disposition.code,
        evidenceDigests: disposition.evidenceDigests,
      };
}

function emptyRecord<T extends object>(): T {
  return Object.freeze(Object.create(null)) as T;
}

function compareTargets(left: RunTargetIdentity, right: RunTargetIdentity): number {
  const a = privateActivationTargetKey(left);
  const b = privateActivationTargetKey(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function requireDigest(value: string, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} digest must be sha256: followed by 64 lowercase hexadecimal digits`);
  }
  return value;
}
