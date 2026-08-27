import {
  claimPrivateRootRunLaunch,
  completePrivateRootRun,
  type PrivateRootRunLaunch,
  type PrivateRootRunSnapshot,
  type PrivateRootRunTerminal,
} from "./activation-admission-store.js";
import {
  planPrivatePythonDirectRun,
  runPrivatePythonDirectRecipe,
} from "./python-direct-run.js";
import type { PrivateRuntimeSupportObservation } from "./agent-sandbox-runtime-support.js";
import type { PrivateLinuxCgroupBackend } from "./linux-cgroup-backend.js";

/**
 * Execute the one admitted Python direct-Run recipe supported by this
 * checkpoint, then publish its terminal only after protected cleanup settles.
 */
export async function executePrivateRootRunLaunch(input: {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly launch: PrivateRootRunLaunch;
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly signal?: AbortSignal;
}): Promise<PrivateRootRunSnapshot> {
  await input.launch.coordinator.verify();
  const launch = claimPrivateRootRunLaunch(input.launch);
  let terminal: PrivateRootRunTerminal;
  try {
    const request = launch.candidate.candidate.target.request;
    if (request.digest !== launch.intent.requestDigest ||
        launch.candidate.candidate.target.disposition.state !== "ready") {
      throw new Error("durable root spawn intent differs from its admitted target");
    }
    const recipe = await planPrivatePythonDirectRun({
      request,
      runtimeSupport: input.runtimeSupport,
      backend: input.backend,
    });
    if (recipe.digest !== launch.intent.recipeDigest ||
        recipe.observation.digest !== launch.intent.observationDigest) {
      throw new Error("current host mechanisms do not reproduce the admitted Run recipe");
    }
    const result = await runPrivatePythonDirectRecipe({
      recipe,
      packageStoreRoot: input.packageStoreRoot,
      runId: backendRunLabel(launch.run.runId),
      invocation: {
        input: launch.run.input,
        settings: request.settings,
        attachments: Object.freeze({}),
        deadlineUnixMs: launch.run.deadlineUnixMs,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
    });
    terminal = result.terminal;
  } catch (error) {
    terminal = Object.freeze({
      status: "failed" as const,
      code: "EXECUTION_FAILED" as const,
      message: boundedErrorMessage(error),
      diagnostics: Object.freeze({ stderr: "", stderrBytes: 0, stderrTruncated: false }),
    });
  }
  return completePrivateRootRun({
    projectRoot: input.projectRoot,
    launch,
    terminal,
  });
}

function backendRunLabel(runId: string): string {
  const hexadecimal = runId.startsWith("sha256:") ? runId.slice(7) : "";
  if (!/^[0-9a-f]{64}$/.test(hexadecimal)) throw new TypeError("durable root Run ID is invalid");
  return `root-${hexadecimal.slice(0, 43)}`;
}

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 4_096 ? message : `${message.slice(0, 4_093)}...`;
}
