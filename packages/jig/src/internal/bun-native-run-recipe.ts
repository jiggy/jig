import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  createPrivateActivationRecipeObservation,
  type PrivateActivationRecipeObservation,
} from "./activation-planning.js";
import {
  requirePrivateRuntimeSupportObservation,
  type PrivateRuntimeSupportObservation,
} from "./runtime-support.js";
import {
  requirePrivateBunNativePreparationObservation,
  type PrivateBunNativePreparationObservation,
} from "./bun-native-preparation.js";
import {
  observePrivateBunNativePreparationController,
  requirePrivateBunNativePreparationControllerObservation,
  type PrivateBunNativePreparationControllerObservation,
} from "./bun-native-preparation-controller.js";
import { privateDomainDigest, privateFileDigest } from "./identity.js";
import {
  requirePrivateLinuxCgroupBackend,
  type PrivateLinuxBackendMechanismObservation,
  type PrivateLinuxCgroupBackend,
} from "./linux-rootless-backend.js";
import type { JsonValue } from "../json.js";
import {
  requirePrivateActivationRequest,
  type PrivateActivationRequest,
} from "../project/package-resolution.js";

const ADAPTER_REVISION = "private-bun-native-run/1";
const PACKAGE_DESTINATION = "/package";
const SCRATCH = "/work";
const PREPARED_TREE_KIND = "private-bun-native-prepared-tree/1";
const MAX_WALL_CLOCK_MS = 30_000;
const CANCELLATION_GRACE_MS = 1_000;
const BUN_POLICY = Object.freeze([
  "--no-env-file",
  "--no-install",
  "--config=/dev/null",
] as const);
const RUNTIME_PREDICATES = Object.freeze([
  "private-process-filesystem/1",
  "private-runtime-devices/1",
] as const);
const RESOURCE_CEILINGS = Object.freeze({
  memoryBytes: 256 * 1024 * 1024,
  pids: 48,
  cpuQuotaMicros: 50_000,
  cpuPeriodMicros: 100_000,
  cleanupTimeoutMs: 5_000,
});
const authenticRecipes = new WeakSet<object>();

/**
 * Planning-only identity for one Bun Run which must first produce the exact
 * private prepared tree. It is deliberately not executable by direct Run yet.
 */
export interface PrivateBunNativeRunRecipe {
  readonly kind: "private-bun-native-run-recipe/1";
  readonly digest: string;
  readonly request: PrivateActivationRequest;
  readonly preparationObservation: PrivateBunNativePreparationObservation;
  readonly preparationController: PrivateBunNativePreparationControllerObservation;
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly mechanismDigest: string;
  readonly workerBundlePath: string;
  readonly workerBundleDigest: string;
  readonly observation: PrivateActivationRecipeObservation;
  readonly executablePath: string;
  readonly packageDestination: "/package";
  readonly scratch: "/work";
  readonly wallClockCeilingMs: number;
  readonly resourceCeilings: typeof RESOURCE_CEILINGS;
  readonly bunPolicy: typeof BUN_POLICY;
  readonly privateProcessFilesystem: true;
  readonly privateRuntimeDevices: true;
  readonly preparationResourceCeilings:
    PrivateBunNativePreparationControllerObservation["resourceLimits"];
}

/** Plan, but do not execute, the first exact package-local Bun preparation. */
export async function planPrivateBunNativeRun(input: {
  readonly request: PrivateActivationRequest;
  readonly preparationObservation: PrivateBunNativePreparationObservation;
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly workerBundlePath: string;
  readonly workerBundleDigest: string;
}): Promise<PrivateBunNativeRunRecipe> {
  const request = requirePrivateActivationRequest(input.request);
  const preparationObservation = requirePrivateBunNativePreparationObservation(
    input.preparationObservation,
  );
  if (request.mode !== "run" || request.target.kind !== "binding" ||
      request.entrypoint.path !== "flow.ts" || request.entrypoint.suffix !== "ts" ||
      (request.entrypoint.selector !== undefined && request.entrypoint.selector !== "bun")) {
    throw new TypeError("private Bun native Run recipe requires one matching flow.ts Run Binding");
  }
  if (preparationObservation.requestDigest !== request.digest ||
      preparationObservation.packageDigest !== request.package.digest) {
    throw new TypeError("Bun native preparation observation belongs to another activation request");
  }
  if (Object.keys(request.attachments).length !== 0) {
    throw new TypeError("private Bun native Run recipe does not yet project attachments");
  }

  const runtimeSupport = requirePrivateRuntimeSupportObservation(input.runtimeSupport);
  const backend = requirePrivateLinuxCgroupBackend(input.backend);
  const workerBundlePath = await realpath(input.workerBundlePath);
  const [adapterDigest, mechanism, workerBundleDigest, executableDigest,
    preparationController] = await Promise.all([
    privateFileDigest(fileURLToPath(import.meta.url)),
    backend.observeMechanism(),
    privateFileDigest(workerBundlePath),
    privateFileDigest(runtimeSupport.executablePath),
    observePrivateBunNativePreparationController(),
  ]);
  if (workerBundleDigest !== input.workerBundleDigest) {
    throw new Error("Bun native preparation worker no longer matches its host selection");
  }
  if (executableDigest !== runtimeSupport.executableDigest) {
    throw new Error("Bun native preparation runtime no longer matches retained host support");
  }

  const adapter = Object.freeze({ artifactDigest: adapterDigest, revision: ADAPTER_REVISION });
  const backendIdentity = Object.freeze({
    artifactDigest: mechanism.trustedSupervisorDigest,
    revision: mechanism.kind,
  });
  const preparationPlanDigest = logicalPreparationPlanDigest(
    request,
    preparationObservation,
    runtimeSupport,
    mechanism,
    workerBundleDigest,
    preparationController,
  );
  const preparationEnvelopeDigest = logicalPreparationEnvelopeDigest(
    preparationObservation,
    runtimeSupport,
    mechanism,
    workerBundleDigest,
    preparationPlanDigest,
    preparationController,
  );
  const launchEnvelopeDigest = logicalPreparedLaunchDigest(
    request,
    preparationObservation,
    runtimeSupport,
    mechanism,
    preparationPlanDigest,
    preparationEnvelopeDigest,
  );
  const authorityDigest = privateDomainDigest("JIG-Private-Bun-Native-Run-Authority/1", {
    attachments: request.attachments,
    slots: request.slots,
  } as unknown as JsonValue);
  const observation = createPrivateActivationRecipeObservation({
    requestDigest: request.digest,
    adapter,
    toolchainDigest: runtimeSupport.digest,
    inspectionDigest: preparationObservation.digest,
    preparationPlanDigest,
    launchPlanner: adapter,
    backend: backendIdentity,
    preparationEnvelopeDigest,
    launchEnvelopeDigest,
    runtimeSupportClosureDigest: runtimeSupport.digest,
    runtimePredicates: [],
    requestedAuthorityDigest: authorityDigest,
    wouldGrantAuthorityDigest: authorityDigest,
    plannedAuthorityDigest: authorityDigest,
  });
  const identity = Object.freeze({
    kind: "private-bun-native-run-recipe/1" as const,
    requestDigest: request.digest,
    preparationObservationDigest: preparationObservation.digest,
    preparationControllerDigest: preparationController.digest,
    preparationPlanDigest,
    preparationEnvelopeDigest,
    workerBundleDigest,
    runtimeSupportDigest: runtimeSupport.digest,
    mechanismDigest: mechanism.digest,
    observationDigest: observation.digest,
  });
  const recipe = Object.freeze({
    kind: identity.kind,
    digest: privateDomainDigest(
      "JIG-Private-Bun-Native-Run-Recipe/1",
      identity as unknown as JsonValue,
    ),
    request,
    preparationObservation,
    preparationController,
    runtimeSupport,
    backend,
    mechanismDigest: mechanism.digest,
    workerBundlePath,
    workerBundleDigest,
    observation,
    executablePath: runtimeSupport.executablePath,
    packageDestination: PACKAGE_DESTINATION,
    scratch: SCRATCH,
    wallClockCeilingMs: MAX_WALL_CLOCK_MS,
    resourceCeilings: RESOURCE_CEILINGS,
    bunPolicy: BUN_POLICY,
    privateProcessFilesystem: true,
    privateRuntimeDevices: true,
    preparationResourceCeilings: preparationController.resourceLimits,
  });
  authenticRecipes.add(recipe);
  return recipe;
}

export function requirePrivateBunNativeRunRecipe(value: unknown): PrivateBunNativeRunRecipe {
  if (value === null || typeof value !== "object" || !authenticRecipes.has(value)) {
    throw new TypeError("Bun native Run recipe was not produced by the private planner");
  }
  return value as PrivateBunNativeRunRecipe;
}

/** Reacquire every host/controller artifact which gives this planning identity meaning. */
export async function revalidatePrivateBunNativeRunRecipe(
  value: unknown,
): Promise<PrivateBunNativeRunRecipe> {
  const recipe = requirePrivateBunNativeRunRecipe(value);
  const pinnedController = requirePrivateBunNativePreparationControllerObservation(
    recipe.preparationController,
  );
  const [mechanism, executableDigest, workerBundleDigest, controller] = await Promise.all([
    recipe.backend.observeMechanism(),
    privateFileDigest(recipe.executablePath),
    privateFileDigest(recipe.workerBundlePath),
    observePrivateBunNativePreparationController(),
  ]);
  if (mechanism.digest !== recipe.mechanismDigest ||
      executableDigest !== recipe.runtimeSupport.executableDigest ||
      workerBundleDigest !== recipe.workerBundleDigest ||
      controller.digest !== pinnedController.digest) {
    throw new Error("Bun native Run recipe no longer matches retained host preparation support");
  }
  return recipe;
}

function logicalPreparationPlanDigest(
  request: PrivateActivationRequest,
  observation: PrivateBunNativePreparationObservation,
  runtimeSupport: PrivateRuntimeSupportObservation,
  mechanism: PrivateLinuxBackendMechanismObservation,
  workerBundleDigest: string,
  controller: PrivateBunNativePreparationControllerObservation,
): string {
  return privateDomainDigest("JIG-Private-Bun-Native-Preparation-Plan/1", {
    requestDigest: request.digest,
    packageDigest: request.package.digest,
    preparationObservationDigest: observation.digest,
    dependency: observation.dependency,
    workerBundleDigest,
    preparationControllerDigest: controller.digest,
    preparationControllerArtifactDigest: controller.artifactDigest,
    runtimeSupportDigest: runtimeSupport.digest,
    executableDigest: runtimeSupport.executableDigest,
    backendMechanismDigest: mechanism.digest,
    deadlinePolicy: "root-intent",
    resourceCeilings: controller.resourceLimits,
    outputBounds: {
      stdoutBytes: controller.maxStdoutBytes,
      stderrBytes: controller.maxStderrBytes,
    },
  } as unknown as JsonValue);
}

function logicalPreparationEnvelopeDigest(
  observation: PrivateBunNativePreparationObservation,
  runtimeSupport: PrivateRuntimeSupportObservation,
  mechanism: PrivateLinuxBackendMechanismObservation,
  workerBundleDigest: string,
  preparationPlanDigest: string,
  controller: PrivateBunNativePreparationControllerObservation,
): string {
  return privateDomainDigest("JIG-Private-Bun-Native-Preparation-Logical-Envelope/1", {
    preparationPlanDigest,
    preparationObservationDigest: observation.digest,
    packageDigest: observation.packageDigest,
    dependency: observation.dependency,
    workerBundleDigest,
    preparationControllerDigest: controller.digest,
    workerDestination: controller.workerDestination,
    runtimeSupportDigest: runtimeSupport.digest,
    executableDigest: runtimeSupport.executableDigest,
    backendMechanismDigest: mechanism.digest,
    packageDestination: controller.packageDestination,
    environment: {},
    bunPolicy: controller.bunPolicy,
    command: [
      "runtime-executable",
      ...controller.bunPolicy,
      controller.workerDestination,
      "--archive",
      `${controller.packageDestination}/${observation.dependency.memberPath}`,
    ],
    runtimePredicates: controller.runtimePredicates,
    outputBounds: {
      stdoutBytes: controller.maxStdoutBytes,
      stderrBytes: controller.maxStderrBytes,
    },
  } as unknown as JsonValue);
}

function logicalPreparedLaunchDigest(
  request: PrivateActivationRequest,
  observation: PrivateBunNativePreparationObservation,
  runtimeSupport: PrivateRuntimeSupportObservation,
  mechanism: PrivateLinuxBackendMechanismObservation,
  preparationPlanDigest: string,
  preparationEnvelopeDigest: string,
): string {
  return privateDomainDigest("JIG-Private-Bun-Native-Prepared-Logical-Launch/1", {
    requestDigest: request.digest,
    sourcePackageDigest: request.package.digest,
    entrypoint: request.entrypoint,
    preparationObservationDigest: observation.digest,
    preparationPlanDigest,
    preparationEnvelopeDigest,
    preparedTreeKind: PREPARED_TREE_KIND,
    runtimeSupportDigest: runtimeSupport.digest,
    executableDigest: runtimeSupport.executableDigest,
    backendMechanismDigest: mechanism.digest,
    packageDestination: PACKAGE_DESTINATION,
    scratch: SCRATCH,
    resourceCeilings: RESOURCE_CEILINGS,
    wallClockCeilingMs: MAX_WALL_CLOCK_MS,
    environment: {},
    bunPolicy: BUN_POLICY,
    runtimePredicates: RUNTIME_PREDICATES,
  } as unknown as JsonValue);
}
