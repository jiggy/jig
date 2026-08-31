import {
  planPrivateBunDirectRun,
  requirePrivateBunDirectRecipe,
  type PrivateBunDirectRecipe,
} from "./bun-direct-run.js";
import {
  requirePrivateRuntimeSupportObservation,
  type PrivateRuntimeSupportObservation,
} from "./runtime-support.js";
import type { PrivateLinuxCgroupBackend } from "./linux-rootless-backend.js";
import {
  requirePrivateActivationRequest,
  type PrivateActivationRequest,
} from "../project/package-resolution.js";

export type PrivateDirectRunRecipe = PrivateBunDirectRecipe;
export type PrivateDirectRunRuntimeSupport = PrivateRuntimeSupportObservation;

/** Plan the one exact Bun recipe fixed by the alpha host. */
export async function planPrivateDirectRun(input: {
  readonly request: PrivateActivationRequest;
  readonly runtimeSupport: PrivateDirectRunRuntimeSupport;
  readonly backend: PrivateLinuxCgroupBackend;
}): Promise<PrivateDirectRunRecipe> {
  const request = requirePrivateActivationRequest(input.request);
  if (request.entrypoint.path !== "flow.ts") {
    throw new TypeError(`no exact Bun direct recipe for ${request.entrypoint.path}`);
  }
  return await planPrivateBunDirectRun({
    ...input,
    request,
    runtimeSupport: requirePrivateRuntimeSupportObservation(input.runtimeSupport),
  });
}

export function requirePrivateDirectRunRecipe(value: unknown): PrivateDirectRunRecipe {
  return requirePrivateBunDirectRecipe(value);
}
