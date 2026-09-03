import {
  planPrivateBunDirectRun,
  requirePrivateBunDirectRecipe,
  type PrivateBunDirectRecipe,
} from "./bun-direct-run.js";
import {
  requirePrivateInstalledBunSupport,
  type PrivateInstalledBunSupport,
} from "./installed-bun-support.js";
import type { PrivateLinuxCgroupBackend } from "./linux-rootless-backend.js";
import type { PackageArtifactRef } from "./package-artifact-store.js";
import {
  requirePrivateActivationRequest,
  type PrivateActivationRequest,
} from "../project/package-resolution.js";
import type { PrivateOpenAIAgentProvider } from "./openai-agent-provider.js";

export type PrivateDirectRunRecipe = PrivateBunDirectRecipe;
export type PrivateDirectRunInstalledSupport = PrivateInstalledBunSupport;

/** Plan the one exact Bun recipe fixed by the alpha host. */
export async function planPrivateDirectRun(input: {
  readonly request: PrivateActivationRequest;
  readonly installedSupport: PrivateDirectRunInstalledSupport;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly executionPackage?: PackageArtifactRef;
  readonly agentProvider?: PrivateOpenAIAgentProvider | undefined;
}): Promise<PrivateDirectRunRecipe> {
  const request = requirePrivateActivationRequest(input.request);
  if (request.entrypoint.path !== "flow.ts") {
    throw new TypeError(`no exact Bun direct recipe for ${request.entrypoint.path}`);
  }
  return await planPrivateBunDirectRun({
    ...input,
    request,
    installedSupport: requirePrivateInstalledBunSupport(input.installedSupport),
  });
}

export function requirePrivateDirectRunRecipe(value: unknown): PrivateDirectRunRecipe {
  return requirePrivateBunDirectRecipe(value);
}
