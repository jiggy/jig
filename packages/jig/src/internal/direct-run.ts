import {
  planPrivateBunDirectRun,
  requirePrivateBunDirectRecipe,
  runPrivateBunDirectRecipe,
  type PrivateBunDirectRecipe,
  type PrivateBunDirectRunResult,
} from "./bun-direct-run.js";
import type { PrivateRuntimeSupportObservation } from "./agent-sandbox-runtime-support.js";
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

export type PrivateDirectRunRecipe = PrivateBunDirectRecipe | PrivatePythonDirectRecipe;
export type PrivateDirectRunResult = PrivateBunDirectRunResult | PrivatePythonDirectRunResult;

/** Select only between exact recipes already implemented by the trusted host. */
export async function planPrivateDirectRun(input: {
  readonly request: PrivateActivationRequest;
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly backend: PrivateLinuxCgroupBackend;
}): Promise<PrivateDirectRunRecipe> {
  const request = requirePrivateActivationRequest(input.request);
  const normalized = { ...input, request };
  if (request.entrypoint.path === "flow.py") {
    return await planPrivatePythonDirectRun(normalized);
  }
  if (request.entrypoint.path === "flow.ts") {
    return await planPrivateBunDirectRun(normalized);
  }
  throw new TypeError(`no exact private direct recipe for ${request.entrypoint.path}`);
}

export function requirePrivateDirectRunRecipe(value: unknown): PrivateDirectRunRecipe {
  try {
    return requirePrivateBunDirectRecipe(value);
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
  return await runPrivatePythonDirectRecipe({ ...input, recipe });
}
