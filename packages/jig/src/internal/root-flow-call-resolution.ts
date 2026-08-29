import { CheckError } from "../diagnostics.js";
import { inspectCapturedPackage, type InspectedPackage } from "../package/inspect.js";
import { SchemaDiagnostic } from "../schema/index.js";
import type { RunTargetIdentity } from "../project/package-project.js";
import { isDirectRunEligible } from "../project/flow-source.js";
import type { PrivateResolutionUnavailableCode } from "../project/package-resolution.js";
import type { RunHostFlowCall } from "../run/session.js";
import {
  requirePrivateStoredActivationCandidate,
  type PrivateReacquiredRootExecutionWork,
} from "./activation-admission-store.js";
import {
  type PrivateActivationCandidateTarget,
} from "./activation-admission.js";
import { privateActivationTargetKey } from "./activation-planning.js";
import {
  captureStoredPackage,
  type PackageArtifactRef,
} from "./package-artifact-store.js";

export type PrivateRootFlowCallSource = "exact" | "candidates" | "project-run-targets";

type PrivateReadyActivationCandidateTarget = PrivateActivationCandidateTarget & {
  readonly disposition: Extract<
    PrivateActivationCandidateTarget["disposition"],
    { readonly state: "ready" }
  >;
};

export type PrivateRootFlowCallRejection =
  | {
      readonly target: RunTargetIdentity;
      readonly code: "ACTIVE_OWNER";
    }
  | {
      readonly target: RunTargetIdentity;
      readonly code: "TARGET_UNAVAILABLE";
      readonly unavailableCode: PrivateResolutionUnavailableCode;
      readonly evidenceDigests: readonly string[];
    }
  | {
      readonly target: RunTargetIdentity;
      readonly code: "TARGET_KIND_UNSUPPORTED";
    }
  | {
      readonly target: RunTargetIdentity;
      readonly code: "INPUT_INCOMPATIBLE";
      readonly diagnostic: Readonly<{
        readonly code: string;
        readonly instancePointer: string;
        readonly schemaPointer: string;
        readonly path: string;
        readonly keyword?: string;
      }>;
    };

export type PrivateRootFlowCallResolution =
  | {
      readonly state: "selected";
      readonly source: PrivateRootFlowCallSource;
      readonly selected: PrivateReadyActivationCandidateTarget;
      readonly rejected: readonly PrivateRootFlowCallRejection[];
    }
  | {
      readonly state: "missing";
      readonly source?: PrivateRootFlowCallSource;
      readonly rejected: readonly PrivateRootFlowCallRejection[];
    }
  | {
      readonly state: "ambiguous";
      readonly source: Exclude<PrivateRootFlowCallSource, "exact">;
      readonly survivors: readonly PrivateReadyActivationCandidateTarget[];
      readonly rejected: readonly PrivateRootFlowCallRejection[];
    };

export class PrivateRootFlowCallResolutionError extends Error {
  readonly code = "ROOT_FLOW_CALL_RESOLUTION_CORRUPT";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PrivateRootFlowCallResolutionError";
  }
}

interface PackageInspectionCache {
  readonly inspections: Map<string, InspectedPackage>;
}

/**
 * Pure invocation-local filtering over one pinned admitted Flow-call slot.
 *
 * This function allocates no child, consults no live catalogue, ranks no
 * candidate, and persists nothing. Exact input compatibility deliberately
 * remains the controller's durable post-allocation check; broad sources use
 * it only to filter candidates before choosing one.
 */
export async function resolvePrivateRootFlowCall(input: {
  readonly parent: PrivateReacquiredRootExecutionWork;
  readonly call: RunHostFlowCall;
  readonly packageStoreRoot: string;
}): Promise<PrivateRootFlowCallResolution> {
  const cache: PackageInspectionCache = {
    inspections: new Map(),
  };
  try {
    return await resolveWithCache(input, cache);
  } catch (error) {
    throw resolutionFailure(error);
  }
}

async function resolveWithCache(
  input: {
    readonly parent: PrivateReacquiredRootExecutionWork;
    readonly call: RunHostFlowCall;
    readonly packageStoreRoot: string;
  },
  cache: PackageInspectionCache,
): Promise<PrivateRootFlowCallResolution> {
  const candidate = requirePrivateStoredActivationCandidate(input.parent.candidate);
  const targetByKey = candidateTargetMap(candidate.candidate.targets);
  const parent = targetByKey.get(privateActivationTargetKey(input.parent.run.target));
  if (parent === undefined || parent.request.mode !== "run" ||
      parent.disposition.state !== "ready") {
    throw corrupt("root Flow-call parent is absent or not READY in its pinned candidate");
  }
  const slot = parent.request.slots[input.call.slot];
  if (slot === undefined || slot.kind !== "flow-call") {
    return Object.freeze({ state: "missing", rejected: Object.freeze([]) });
  }

  const source = slot.source;
  const parentKey = privateActivationTargetKey(parent.request.target);
  const rejected: PrivateRootFlowCallRejection[] = [];
  const survivors: PrivateReadyActivationCandidateTarget[] = [];
  const targets = [...slot.targets].sort((left, right) =>
    compareOrdinal(privateActivationTargetKey(left), privateActivationTargetKey(right))
  );

  for (const identity of targets) {
    const target = targetByKey.get(privateActivationTargetKey(identity));
    if (target === undefined) {
      throw corrupt(
        `Flow-call target ${JSON.stringify(privateActivationTargetKey(identity))} is absent from its pinned candidate`,
      );
    }
    if (privateActivationTargetKey(identity) === parentKey) {
      rejected.push(Object.freeze({ target: identity, code: "ACTIVE_OWNER" as const }));
      continue;
    }
    if (target.disposition.state === "unavailable") {
      rejected.push(Object.freeze({
        target: identity,
        code: "TARGET_UNAVAILABLE" as const,
        unavailableCode: target.disposition.code,
        evidenceDigests: target.disposition.evidenceDigests,
      }));
      continue;
    }
    const ready = target as PrivateReadyActivationCandidateTarget;
    if (identity.kind === "binding") {
      rejected.push(Object.freeze({
        target: identity,
        code: "TARGET_KIND_UNSUPPORTED" as const,
      }));
      continue;
    }

    const inspected = await inspectionFor(
      input.packageStoreRoot,
      target.request.package,
      cache,
    );
    requireDirectFlowProjection(ready, inspected);
    if (source !== "exact") {
      try {
        inspected.schemas.input?.validate(input.call.input, "INVALID_INPUT");
      } catch (error) {
        if (!(error instanceof SchemaDiagnostic)) throw error;
        if (error.code !== "INVALID_INPUT") throw error;
        rejected.push(Object.freeze({
          target: identity,
          code: "INPUT_INCOMPATIBLE" as const,
          diagnostic: schemaDiagnostic(error),
        }));
        continue;
      }
    }
    survivors.push(ready);
  }

  rejected.sort((left, right) =>
    compareOrdinal(privateActivationTargetKey(left.target), privateActivationTargetKey(right.target))
  );
  survivors.sort((left, right) =>
    compareOrdinal(
      privateActivationTargetKey(left.request.target),
      privateActivationTargetKey(right.request.target),
    )
  );
  const frozenRejected = Object.freeze(rejected);
  const frozenSurvivors = Object.freeze(survivors);
  if (survivors.length === 0) {
    return Object.freeze({ state: "missing", source, rejected: frozenRejected });
  }
  if (survivors.length === 1) {
    return Object.freeze({
      state: "selected",
      source,
      selected: survivors[0]!,
      rejected: frozenRejected,
    });
  }
  if (source === "exact") {
    throw corrupt("an exact Flow-call slot resolved to several candidates");
  }
  return Object.freeze({
    state: "ambiguous",
    source,
    survivors: frozenSurvivors,
    rejected: frozenRejected,
  });
}

async function inspectionFor(
  packageStoreRoot: string,
  reference: PackageArtifactRef,
  cache: PackageInspectionCache,
): Promise<InspectedPackage> {
  const prior = cache.inspections.get(reference.digest);
  if (prior !== undefined) return prior;
  const captured = await captureStoredPackage(packageStoreRoot, reference);
  let inspected: InspectedPackage | undefined;
  let operationFailure: unknown;
  try {
    inspected = await inspectCapturedPackage(captured);
  } catch (error) {
    operationFailure = error;
  }
  let cleanupFailure: unknown;
  try { await captured.dispose(); }
  catch (error) { cleanupFailure = error; }
  if (cleanupFailure !== undefined) {
    if (operationFailure !== undefined) {
      throw corrupt(
        "Package/1 inspection and capture cleanup did not both complete",
        new AggregateError([operationFailure, cleanupFailure]),
      );
    }
    throw corrupt("Package/1 capture cleanup did not complete", cleanupFailure);
  }
  if (operationFailure !== undefined) throw operationFailure;
  if (inspected === undefined) throw corrupt("Package/1 inspection produced no result");
  cache.inspections.set(reference.digest, inspected);
  return inspected;
}

function candidateTargetMap(
  targets: readonly PrivateActivationCandidateTarget[],
): ReadonlyMap<string, PrivateActivationCandidateTarget> {
  const result = new Map<string, PrivateActivationCandidateTarget>();
  for (const target of targets) {
    const key = privateActivationTargetKey(target.request.target);
    if (result.has(key)) {
      throw corrupt(`pinned candidate repeats target ${JSON.stringify(key)}`);
    }
    result.set(key, target);
  }
  return result;
}

function requireDirectFlowProjection(
  target: PrivateActivationCandidateTarget,
  inspected: InspectedPackage,
): void {
  const request = target.request;
  if (request.target.kind !== "flow" || request.mode !== "run" ||
      inspected.digest !== request.package.digest || inspected.mode !== "run" ||
      !isDirectRunEligible(inspected) || inspected.entrypoint === undefined ||
      inspected.entrypoint.path !== request.entrypoint.path ||
      inspected.entrypoint.suffix !== request.entrypoint.suffix ||
      inspected.entrypoint.selector !== request.entrypoint.selector) {
    throw corrupt(
      `admitted Flow target ${JSON.stringify(privateActivationTargetKey(request.target))} no longer matches its Package/1 inspection`,
    );
  }
}

function schemaDiagnostic(error: SchemaDiagnostic): Readonly<{
  readonly code: string;
  readonly instancePointer: string;
  readonly schemaPointer: string;
  readonly path: string;
  readonly keyword?: string;
}> {
  return Object.freeze({
    code: error.code,
    instancePointer: error.instancePointer,
    schemaPointer: error.schemaPointer,
    path: error.path,
    ...(error.keyword === undefined ? {} : { keyword: error.keyword }),
  });
}

function resolutionFailure(error: unknown): unknown {
  if (error instanceof PrivateRootFlowCallResolutionError) {
    return error;
  }
  if (error instanceof SchemaDiagnostic) {
    if (error.code === "SCHEMA_LIMIT_EXCEEDED") {
      return operational(
        "RESOURCE_EXHAUSTED",
        "Flow-call input compatibility exceeded the protected Schema/1 work limit",
        error,
      );
    }
    return corrupt("pinned Package/1 schema processing failed", error);
  }
  if (error instanceof CheckError) {
    if (error.code === "PACKAGE_ARTIFACT_RESOURCE_EXHAUSTED") {
      return operational(
        "RESOURCE_EXHAUSTED",
        "protected Package/1 reacquisition exhausted a host resource",
        error,
      );
    }
    if (error.code === "PACKAGE_ARTIFACT_MISSING" || error.code === "PACKAGE_ARTIFACT_CORRUPT") {
      return corrupt(`pinned Package/1 could not be reacquired or inspected: ${error.code}`, error);
    }
    return error;
  }
  if (isOperationalIoFailure(error)) {
    return operational(
      "EXECUTION_FAILED",
      "protected Package/1 reacquisition or inspection could not complete",
      error,
    );
  }
  return corrupt("pinned root Flow-call state could not be resolved", error);
}

function corrupt(message: string, cause?: unknown): PrivateRootFlowCallResolutionError {
  return new PrivateRootFlowCallResolutionError(message, cause === undefined ? undefined : { cause });
}

class PrivateRootFlowCallOperationalError extends CheckError {
  override readonly cause: unknown;

  constructor(code: "RESOURCE_EXHAUSTED" | "EXECUTION_FAILED", message: string, cause: unknown) {
    super("unavailable", code, message);
    this.name = "PrivateRootFlowCallOperationalError";
    this.cause = cause;
  }
}

function operational(
  code: "RESOURCE_EXHAUSTED" | "EXECUTION_FAILED",
  message: string,
  cause: unknown,
): CheckError {
  return new PrivateRootFlowCallOperationalError(code, message, cause);
}

function isOperationalIoFailure(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" && [
    "EAGAIN", "EBUSY", "EINTR", "EIO", "EMFILE", "ENFILE", "ENOMEM", "ENOSPC",
    "ESTALE", "ETIMEDOUT",
  ].includes(code);
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
