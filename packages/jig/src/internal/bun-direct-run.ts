import { fileURLToPath } from "node:url";

import {
  createPrivateActivationRecipeObservation,
  type PrivateActivationRecipeObservation,
} from "./activation-planning.js";
import {
  requirePrivateRuntimeSupportObservation,
  type PrivateRuntimeSupportObservation,
} from "./runtime-support.js";
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

const ADAPTER_REVISION = "private-bun-direct/1";
const DEFAULT_SELECTOR = "bun";
const PACKAGE_DESTINATION = "/package";
const SCRATCH = "/work";
const MAX_WALL_CLOCK_MS = 30_000;
const BUN_POLICY = Object.freeze([
  "--no-env-file",
  "--no-install",
  "--config=/dev/null",
] as const);
const RUNTIME_PREDICATES = Object.freeze([
  "private-process-filesystem/1",
  "private-runtime-devices/1",
] as const);
const authenticRecipes = new WeakSet<object>();

const RESOURCE_CEILINGS = Object.freeze({
  memoryBytes: 256 * 1024 * 1024,
  pids: 48,
  cpuQuotaMicros: 50_000,
  cpuPeriodMicros: 100_000,
  cleanupTimeoutMs: 5_000,
});

export interface PrivateBunDirectRecipe {
  readonly kind: "private-bun-direct-recipe/1";
  readonly digest: string;
  readonly request: PrivateActivationRequest;
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly mechanismDigest: string;
  readonly observation: PrivateActivationRecipeObservation;
  readonly executablePath: string;
  readonly packageDestination: "/package";
  readonly scratch: "/work";
  readonly wallClockCeilingMs: number;
  readonly resourceCeilings: typeof RESOURCE_CEILINGS;
  readonly bunPolicy: typeof BUN_POLICY;
  readonly privateProcessFilesystem: true;
  readonly privateRuntimeDevices: true;
}

/** Plan one exact, dependency-closed Bun flow.ts Run. */
export async function planPrivateBunDirectRun(input: {
  readonly request: PrivateActivationRequest;
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly selector?: string;
}): Promise<PrivateBunDirectRecipe> {
  const request = requirePrivateActivationRequest(input.request);
  const runtimeSupport = requirePrivateRuntimeSupportObservation(input.runtimeSupport);
  const backend = requirePrivateLinuxCgroupBackend(input.backend);
  const selector = input.selector ?? DEFAULT_SELECTOR;
  if (request.mode !== "run" ||
      request.entrypoint.path !== "flow.ts" || request.entrypoint.suffix !== "ts" ||
      (request.entrypoint.selector !== undefined && request.entrypoint.selector !== selector)) {
    throw new TypeError("private Bun recipe requires one matching flow.ts activation");
  }
  if (Object.keys(request.attachments).length !== 0) {
    throw new TypeError("private Bun recipe does not yet project attachments");
  }
  if (request.target.kind === "flow") {
    if (Object.keys(request.settings).length !== 0) {
      throw new TypeError("private Bun direct Flow recipe requires zero configuration");
    }
  }

  const [adapterDigest, mechanism] = await Promise.all([
    privateFileDigest(fileURLToPath(import.meta.url)),
    backend.observeMechanism(),
  ]);
  const adapter = Object.freeze({ artifactDigest: adapterDigest, revision: ADAPTER_REVISION });
  const backendIdentity = Object.freeze({
    artifactDigest: mechanism.trustedSupervisorDigest,
    revision: mechanism.kind,
  });
  const inspectionDigest = privateDomainDigest("JIG-Private-Bun-Inspection/1", {
    package: request.package,
    entrypoint: request.entrypoint,
    selector,
  } as unknown as JsonValue);
  const authorityDigest = privateDomainDigest("JIG-Private-Bun-Authority/1", {
    attachments: request.attachments,
  } as unknown as JsonValue);
  const launchEnvelopeDigest = logicalLaunchDigest(request, runtimeSupport, mechanism);
  const observation = createPrivateActivationRecipeObservation({
    requestDigest: request.digest,
    adapter,
    toolchainDigest: runtimeSupport.digest,
    inspectionDigest,
    launchPlanner: adapter,
    backend: backendIdentity,
    launchEnvelopeDigest,
    runtimeSupportClosureDigest: runtimeSupport.digest,
    runtimePredicates: [],
    requestedAuthorityDigest: authorityDigest,
    wouldGrantAuthorityDigest: authorityDigest,
    plannedAuthorityDigest: authorityDigest,
  });
  const identity = Object.freeze({
    kind: "private-bun-direct-recipe/1" as const,
    requestDigest: request.digest,
    runtimeSupportDigest: runtimeSupport.digest,
    mechanismDigest: mechanism.digest,
    observationDigest: observation.digest,
  });
  const recipe = Object.freeze({
    kind: identity.kind,
    digest: privateDomainDigest("JIG-Private-Bun-Direct-Recipe/1", identity as unknown as JsonValue),
    request,
    runtimeSupport,
    backend,
    mechanismDigest: mechanism.digest,
    observation,
    executablePath: runtimeSupport.executablePath,
    packageDestination: PACKAGE_DESTINATION,
    scratch: SCRATCH,
    wallClockCeilingMs: MAX_WALL_CLOCK_MS,
    resourceCeilings: RESOURCE_CEILINGS,
    bunPolicy: BUN_POLICY,
    privateProcessFilesystem: true,
    privateRuntimeDevices: true,
  });
  authenticRecipes.add(recipe);
  return recipe;
}

export function requirePrivateBunDirectRecipe(value: unknown): PrivateBunDirectRecipe {
  if (value === null || typeof value !== "object" || !authenticRecipes.has(value)) {
    throw new TypeError("Bun recipe was not produced by the private planner");
  }
  return value as PrivateBunDirectRecipe;
}

function logicalLaunchDigest(
  request: PrivateActivationRequest,
  runtimeSupport: PrivateRuntimeSupportObservation,
  mechanism: PrivateLinuxBackendMechanismObservation,
): string {
  return privateDomainDigest("JIG-Private-Bun-Logical-Launch/1", {
    requestDigest: request.digest,
    package: request.package,
    entrypoint: request.entrypoint,
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
