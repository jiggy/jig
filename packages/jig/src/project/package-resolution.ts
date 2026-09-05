import { types as utilTypes } from "node:util";

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
  AGENT_RUN_CONTRACT_DIGEST,
  AGENT_RUN_CONTRACT_ID,
  AGENT_RUN_CONTRACT_VERSION,
} from "../internal/private-agent-run.js";
import {
  canonicalJson,
  decodeJson1,
  type JsonObject,
  type JsonValue,
} from "../json.js";
import type { PackageEntrypoint } from "../package/inspect.js";
import {
  requirePackageProjectValue,
  type PackageProjectValue,
  type LinkedCapabilityUse,
  type RunTargetIdentity,
} from "./package-project.js";
import {
  requirePrivateRetainedPackageProject,
  type PrivateRetainedPackageProject,
} from "./retained-project.js";
import {
  normalizeProjectPath,
} from "./paths.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const authenticRetainedObservations = new WeakSet<object>();
const authenticActivationRequests = new WeakSet<object>();

export interface PrivateActivationRequest {
  readonly kind: "activation-request/4";
  readonly digest: string;
  readonly target: RunTargetIdentity;
  readonly mode: "run";
  readonly packagePath: string;
  readonly package: PackageArtifactRef;
  readonly entrypoint: PackageEntrypoint;
  readonly settings: JsonObject;
  readonly capabilities: Readonly<Record<string, LinkedCapabilityUse>>;
  readonly flowSlots: Readonly<Record<string, RunTargetIdentity>>;
  readonly attachments: Readonly<Record<string, {
    readonly source: string;
    readonly access: "read" | "read-write";
  }>>;
}

export type PrivateResolutionUnavailableCode = PrivateActivationUnavailableCode;

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
      capabilities: flow.uses,
      flowSlots: emptyRecord(),
      attachments: emptyRecord(),
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
      capabilities: flow.uses,
      flowSlots: binding.slots,
      attachments: emptyRecord(),
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
    "capabilities",
    "flowSlots",
    "attachments",
  ], "activation request");
  if (root.kind !== "activation-request/4") {
    throw new TypeError("activation request kind must be activation-request/4");
  }
  const targetValue = exactRecord(root.target, "activation target");
  let target: RunTargetIdentity;
  if (targetValue.kind === "flow") {
    target = Object.freeze({
      kind: "flow" as const,
      path: normalizeProjectPath(
        exactObject(targetValue, ["kind", "path"], "Flow activation target").path,
        "Flow activation target",
      ),
    });
  } else if (targetValue.kind === "binding") {
    target = Object.freeze({
      kind: "binding" as const,
      id: requireLocalName(
        exactObject(targetValue, ["kind", "id"], "Binding activation target").id,
        "Binding activation target",
      ),
    });
  } else {
    throw new TypeError("activation target kind must be flow or binding");
  }
  if (root.mode !== "run") throw new TypeError("activation request mode must be run");
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
    capabilities: normalizeRequestCapabilities(root.capabilities),
    flowSlots: normalizeRequestFlowSlots(root.flowSlots),
    attachments: normalizeRequestAttachments(root.attachments),
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

  const targets = requests.map((request) => {
    const target = intrinsic.get(privateActivationTargetKey(request.target));
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
    kind: "activation-request/4" as const,
    target: input.target,
    mode: input.mode,
    packagePath: input.packagePath,
    package: input.package,
    entrypoint: input.entrypoint,
    settings: input.settings,
    capabilities: input.capabilities,
    flowSlots: input.flowSlots,
    attachments: input.attachments,
  });
  const request = Object.freeze({
    ...valueWithoutDigest,
    digest: privateDomainDigest(
      "JIG-Activation-Request/4",
      valueWithoutDigest as unknown as JsonValue,
    ),
  });
  authenticActivationRequests.add(request);
  return request;
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
    })),
    bindings: project.bindings.map((binding) => ({
      kind: binding.kind,
      id: binding.id,
      packagePath: binding.packagePath,
      settings: binding.settings,
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

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} digest must be sha256: followed by 64 lowercase hexadecimal digits`);
  }
  return value;
}

function exactRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be an ordinary object`);
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(`${label} must not contain symbol keys`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${key} must be an enumerable data property`);
    }
    result[key] = descriptor.value;
  }
  return result;
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

function normalizeRequestAttachments(value: unknown): PrivateActivationRequest["attachments"] {
  const input = snapshotJsonObject(value, "activation attachments");
  if (Object.keys(input).length !== 0) {
    throw new TypeError("activation attachments are unsupported by the direct alpha");
  }
  return emptyRecord();
}

function normalizeRequestCapabilities(value: unknown): PrivateActivationRequest["capabilities"] {
  const input = snapshotJsonObject(value, "activation capability uses");
  if (Object.keys(input).length > 1) {
    throw new TypeError("activation capability uses exceed 1 entry");
  }
  const output: Record<string, LinkedCapabilityUse> = Object.create(null) as
    Record<string, LinkedCapabilityUse>;
  for (const name of Object.keys(input).sort()) {
    requireLocalName(name, "activation capability slot");
    const item = exactObject(
      input[name],
      ["id", "version", "digest"],
      `activation capability slot ${name}`,
    );
    if (item.id !== AGENT_RUN_CONTRACT_ID ||
        item.version !== AGENT_RUN_CONTRACT_VERSION ||
        item.digest !== AGENT_RUN_CONTRACT_DIGEST) {
      throw new TypeError(`activation capability slot ${name} must select the exact Agent Run contract`);
    }
    output[name] = Object.freeze({
      id: AGENT_RUN_CONTRACT_ID,
      version: AGENT_RUN_CONTRACT_VERSION,
      digest: AGENT_RUN_CONTRACT_DIGEST,
    });
  }
  return Object.freeze(output);
}

function normalizeRequestFlowSlots(value: unknown): PrivateActivationRequest["flowSlots"] {
  const input = snapshotJsonObject(value, "activation Flow slots");
  if (Object.keys(input).length > 256) {
    throw new TypeError("activation Flow slots exceed 256 entries");
  }
  const output: Record<string, RunTargetIdentity> = Object.create(null);
  for (const name of Object.keys(input).sort()) {
    requireLocalName(name, "activation Flow slot");
    const target = exactRecord(input[name], `activation Flow slot ${name}`);
    if (target.kind === "flow") {
      output[name] = Object.freeze({
        kind: "flow",
        path: normalizeProjectPath(
          exactObject(target, ["kind", "path"], `activation Flow slot ${name}`).path,
          `activation Flow slot ${name}`,
        ),
      });
    } else if (target.kind === "binding") {
      output[name] = Object.freeze({
        kind: "binding",
        id: requireLocalName(
          exactObject(target, ["kind", "id"], `activation Binding slot ${name}`).id,
          `activation Binding slot ${name}`,
        ),
      });
    } else {
      throw new TypeError(`activation Flow slot ${name} must select a Flow or Binding target`);
    }
  }
  return Object.freeze(output);
}

function snapshotJsonObject(value: unknown, label: string): JsonObject {
  const bytes = canonicalJson(captureJsonValue(value, label, new WeakSet<object>()) as JsonValue);
  const snapshot = freezeJson(decodeJson1(bytes));
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError(`${label} must be an object`);
  }
  return snapshot as JsonObject;
}

function captureJsonValue(
  value: unknown,
  label: string,
  active: WeakSet<object>,
): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number") {
    return value as JsonValue;
  }
  if (typeof value !== "object" || utilTypes.isProxy(value)) {
    throw new TypeError(`${label} must contain only non-proxied JSON values`);
  }
  if (active.has(value)) throw new TypeError(`${label} must not contain cycles`);
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError(`${label} arrays must be ordinary arrays`);
      }
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1 || keys.some((key) =>
        typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/.test(key)))) {
        throw new TypeError(`${label} arrays must be dense without extra properties`);
      }
      const output: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError(`${label}[${index}] must be an enumerable data property`);
        }
        output.push(captureJsonValue(descriptor.value, `${label}[${index}]`, active));
      }
      return output;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} objects must be ordinary objects`);
    }
    const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError(`${label} must not contain symbol keys`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`${label}.${key} must be an enumerable data property`);
      }
      output[key] = captureJsonValue(descriptor.value, `${label}.${key}`, active);
    }
    return output;
  } finally {
    active.delete(value);
  }
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
