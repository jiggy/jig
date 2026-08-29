import {
  planPrivateBunDirectRun,
  requirePrivateBunDirectRecipe,
  runPrivateBunDirectRecipe,
  type PrivateBunDirectRecipe,
  type PrivateBunDirectRunResult,
} from "./bun-direct-run.js";
import {
  planPrivateBunNativeRun,
  requirePrivateBunNativeRunRecipe,
  type PrivateBunNativeRunRecipe,
} from "./bun-native-run-recipe.js";
import { classifyPrivateBunRetainedDependencies } from "./bun-native-preparation.js";
import {
  requirePrivateRuntimeSupportObservation,
  type PrivateRuntimeSupportObservation,
} from "./agent-sandbox-runtime-support.js";
import type { PrivateLinuxCgroupBackend } from "./linux-cgroup-backend.js";
import {
  planPrivatePythonDirectRun,
  requirePrivatePythonDirectRecipe,
  runPrivatePythonDirectRecipe,
  type PrivatePythonDirectRecipe,
  type PrivatePythonDirectRunResult,
} from "./python-direct-run.js";
import {
  requirePrivateActivationRequest,
  type PrivateActivationRequest,
} from "../project/package-resolution.js";
import type { RunHostInvocation } from "../run/session.js";

export type PrivateDirectRunRecipe =
  | PrivateBunDirectRecipe
  | PrivateBunNativeRunRecipe
  | PrivatePythonDirectRecipe;
export type PrivateDirectRunResult = PrivateBunDirectRunResult | PrivatePythonDirectRunResult;
export type PrivateDirectRunRuntimeSupport = PrivateRuntimeSupportObservation | Readonly<{
  readonly bun?: PrivateRuntimeSupportObservation;
  readonly python?: PrivateRuntimeSupportObservation;
}>;

export interface PrivateBunNativeRunPlanningInput {
  readonly workerBundlePath: string;
  readonly workerBundleDigest: string;
}

/** Select only between exact private recipes fixed by the trusted host. */
export async function planPrivateDirectRun(input: {
  readonly request: PrivateActivationRequest;
  readonly runtimeSupport: PrivateDirectRunRuntimeSupport;
  readonly backend: PrivateLinuxCgroupBackend;
  /** Retained Package/1 bytes are mandatory evidence for every Bun decision. */
  readonly packageStoreRoot: string;
  /**
   * Host-selected preparation worker. It is required only when retained bytes
   * classify as the one exact package-local dependency relation.
   */
  readonly bunNativePreparation?: PrivateBunNativeRunPlanningInput;
}): Promise<PrivateDirectRunRecipe> {
  const request = requirePrivateActivationRequest(input.request);
  const runtimeSupport = selectRuntimeSupport(request, input.runtimeSupport);
  const normalized = { ...input, request, runtimeSupport };
  if (request.entrypoint.path === "flow.py") {
    return await planPrivatePythonDirectRun(normalized);
  }
  if (request.entrypoint.path === "flow.ts") {
    const classification = await classifyPrivateBunRetainedDependencies({
      request,
      packageStoreRoot: input.packageStoreRoot,
    });
    if (classification.state === "exact-required") {
      if (input.bunNativePreparation === undefined) {
        throw new TypeError(
          "Bun native dependency preparation has no trusted host worker selection",
        );
      }
      return await planPrivateBunNativeRun({
        request,
        preparationObservation: classification.preparationObservation,
        runtimeSupport,
        backend: input.backend,
        workerBundlePath: input.bunNativePreparation.workerBundlePath,
        workerBundleDigest: input.bunNativePreparation.workerBundleDigest,
      });
    }
    return await planPrivateBunDirectRun(normalized);
  }
  throw new TypeError(`no exact private direct recipe for ${request.entrypoint.path}`);
}

function selectRuntimeSupport(
  request: PrivateActivationRequest,
  value: PrivateDirectRunRuntimeSupport,
): PrivateRuntimeSupportObservation {
  try { return requirePrivateRuntimeSupportObservation(value); }
  catch {
    // Continue to the closed multi-runtime host input.
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError("direct Run runtime support is invalid");
  }
  const actual = Object.keys(value).sort();
  if (actual.length === 0 || actual.some((key) => key !== "bun" && key !== "python")) {
    throw new TypeError("direct Run runtime support set is invalid");
  }
  const support = value as Exclude<PrivateDirectRunRuntimeSupport, PrivateRuntimeSupportObservation>;
  const selected = request.entrypoint.path === "flow.ts"
    ? support.bun
    : request.entrypoint.path === "flow.py"
      ? support.python
      : undefined;
  if (selected === undefined) {
    throw new TypeError(`no retained runtime support for ${request.entrypoint.path}`);
  }
  return requirePrivateRuntimeSupportObservation(selected);
}

export function requirePrivateDirectRunRecipe(value: unknown): PrivateDirectRunRecipe {
  try {
    return requirePrivateBunDirectRecipe(value);
  } catch {
    // Continue to the other closed recipe authority.
  }
  try {
    return requirePrivateBunNativeRunRecipe(value);
  } catch {
    // Continue to the other closed recipe authority.
  }
  try {
    return requirePrivatePythonDirectRecipe(value);
  } catch {
    // Reject below without reading attacker-controlled properties.
  }
  throw new TypeError("direct Run recipe was not produced by a private planner");
}

export async function runPrivateDirectRunRecipe(input: {
  readonly recipe: PrivateDirectRunRecipe;
  readonly packageStoreRoot: string;
  readonly runId: string;
  readonly invocation: Omit<RunHostInvocation, "scratch">;
}): Promise<PrivateDirectRunResult> {
  const recipe = requirePrivateDirectRunRecipe(input.recipe);
  if (recipe.kind === "private-bun-direct-recipe/1") {
    return await runPrivateBunDirectRecipe({ ...input, recipe });
  }
  if (recipe.kind === "private-bun-native-run-recipe/1") {
    throw new TypeError("Bun native Run recipe execution is not joined to direct Run");
  }
  return await runPrivatePythonDirectRecipe({ ...input, recipe });
}
