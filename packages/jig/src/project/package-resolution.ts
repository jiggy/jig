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
import {
  normalizePackageArtifactRef,
  type PackageArtifactRef,
} from "../internal/package-artifact-store.js";
import {
  canonicalJson,
  decodeJson1,
  type JsonObject,
  type JsonValue,
} from "../json.js";
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
import { normalizeProjectPath } from "./paths.js";

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
 * Rebuild an authenticated request from a protected persisted snapshot. The
 * caller remains responsible for proving that storage provenance; this
 * function proves only the closed request shape and its self-identity.
 */
export function restorePrivateActivationRequest(value: unknown): PrivateActivationRequest {
  const root = exactObject(value, [
    "kind",
    "digest",
    "target",
    "mode",
    "packagePath",
    "package",
    "entrypoint",
    "settings",
    "attachments",
    "slots",
  ], "activation request");
  if (root.kind !== "activation-request/1") {
    throw new TypeError("activation request kind must be activation-request/1");
  }
  const targetValue = exactRecord(root.target, "activation target");
  const target = targetValue.kind === "flow"
    ? Object.freeze({
        kind: "flow" as const,
        path: normalizeProjectPath(
          exactObject(targetValue, ["kind", "path"], "Flow activation target").path,
          "Flow activation target",
        ),
      })
    : Object.freeze({
        kind: "binding" as const,
        id: requireLocalName(
          exactObject(targetValue, ["kind", "id"], "Binding activation target").id,
          "Binding activation target",
        ),
      });
  if (root.mode !== "run" && root.mode !== "service") {
    throw new TypeError("activation request mode must be run or service");
  }
  const packagePath = normalizeProjectPath(root.packagePath, "activation package path");
  const entrypointValue = exactObject(
    root.entrypoint,
    root.entrypoint !== null && typeof root.entrypoint === "object" &&
      Object.prototype.hasOwnProperty.call(root.entrypoint, "selector")
      ? ["path", "suffix", "selector"]
      : ["path", "suffix"],
    "activation entrypoint",
  );
  if (typeof entrypointValue.path !== "string" ||
      typeof entrypointValue.suffix !== "string" ||
      !/^flow\.[a-z0-9]{1,16}$/.test(entrypointValue.path) ||
      entrypointValue.path !== `flow.${entrypointValue.suffix}`) {
    throw new TypeError("activation entrypoint must be one canonical flow.<suffix>");
  }
  if (entrypointValue.selector !== undefined &&
      (typeof entrypointValue.selector !== "string" ||
       !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(entrypointValue.selector))) {
    throw new TypeError("activation entrypoint selector is invalid");
  }
  const request = createRequest({
    target,
    mode: root.mode,
    packagePath,
    package: normalizePackageArtifactRef(root.package),
    entrypoint: Object.freeze({
      path: entrypointValue.path,
      suffix: entrypointValue.suffix,
      ...(entrypointValue.selector === undefined ? {} : { selector: entrypointValue.selector }),
    }),
    settings: snapshotJsonObject(root.settings, "activation settings"),
    attachments: snapshotJsonObject(
      root.attachments,
      "activation attachments",
    ) as LinkedPackageBinding["attachments"],
    slots: snapshotJsonObject(root.slots, "activation slots") as LinkedPackageBinding["slots"],
  });
  if (root.digest !== request.digest) {
    throw new TypeError("activation request digest does not match its canonical content");
  }
  return request;
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
        // Canonical host publishers are admitted generation dependencies, not
        // executable Service targets whose runtime availability propagates.
        if (!bindingById.has(value.provider.binding)) continue;
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
    journalPublishers: project.journalPublishers.map((publisher) => ({
      kind: publisher.kind,
      id: publisher.id,
      source: publisher.source,
      contract: publisher.contract,
      eventTypes: publisher.eventTypes,
    })),
    hooks: project.hooks.map((hook) => ({
      kind: hook.kind,
      id: hook.id,
      declarationPath: hook.declarationPath,
      source: hook.source,
      publisherBinding: hook.publisherBinding,
      type: hook.type,
      target: hook.target,
      definitionDigest: hook.definitionDigest,
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

function exactRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  const record = exactRecord(value, label);
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly ${expected.join(", ")}`);
  }
  return record;
}

function requireLocalName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 64 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new TypeError(`${label} must be a LocalName`);
  }
  return value;
}

function snapshotJsonObject(value: unknown, label: string): JsonObject {
  const bytes = canonicalJson(value as JsonValue);
  const snapshot = freezeJson(decodeJson1(bytes));
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError(`${label} must be an object`);
  }
  return snapshot as JsonObject;
}

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => freezeJson(item)));
  if (value !== null && typeof value === "object") {
    const source = value as Readonly<Record<string, JsonValue>>;
    const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(source)) output[key] = freezeJson(source[key]!);
    return Object.freeze(output);
  }
  return value;
}
