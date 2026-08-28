import { fileURLToPath } from "node:url";

import {
  createPrivateActivationRecipeObservation,
  type PrivateActivationRecipeObservation,
} from "./activation-planning.js";
import {
  requirePrivateRuntimeSupportObservation,
  type PrivateRuntimeSupportObservation,
} from "./agent-sandbox-runtime-support.js";
import { privateDomainDigest, privateFileDigest } from "./identity.js";
import {
  requirePrivateLinuxCgroupBackend,
  type PrivateLinuxBackendMechanismObservation,
  type PrivateLinuxCgroupBackend,
} from "./linux-cgroup-backend.js";
import { captureStoredPackage } from "./package-artifact-store.js";
import { type JsonValue } from "../json.js";
import { inspectCapturedPackage } from "../package/inspect.js";
import {
  requirePrivateActivationRequest,
  type PrivateActivationRequest,
} from "../project/package-resolution.js";
import type { ContractIdentity } from "../project/package-project.js";

const ADAPTER_REVISION = "private-bun-service/1";
const DEFAULT_SELECTOR = "bun";
const ADAPTER_SELECTOR = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const PACKAGE_DESTINATION = "/package";
const SCRATCH = "/work";
const MAX_MOUNT_LIFETIME_MS = 30_000;
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

const authenticPackageObservations = new WeakSet<object>();
const authenticRecipes = new WeakSet<object>();

export interface PrivateBunServiceExportIdentity {
  readonly name: string;
  readonly contract: ContractIdentity;
}

/**
 * Exact inert projection reacquired from the retained Package/1 artifact.
 * It contains no compiled validators, source paths, callbacks, or process
 * handles. The Service owner reacquires validators from the same Package/1
 * bytes at its later preparation boundary.
 */
export interface PrivateBunServicePackageObservation {
  readonly kind: "private-bun-service-package-observation/1";
  readonly digest: string;
  readonly requestDigest: string;
  readonly packageDigest: string;
  readonly selector: string;
  readonly exports: readonly PrivateBunServiceExportIdentity[];
}

/** One closed Bun Service recipe; this is not a Runtime Adapter registry. */
export interface PrivateBunServiceRecipe {
  readonly kind: "private-bun-service-recipe/1";
  readonly digest: string;
  readonly request: PrivateActivationRequest;
  readonly packageObservation: PrivateBunServicePackageObservation;
  readonly expectedExports: readonly string[];
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly mechanismDigest: string;
  readonly observation: PrivateActivationRecipeObservation;
  readonly executablePath: string;
  readonly packageDestination: "/package";
  readonly scratch: "/work";
  readonly mountLifetimeCeilingMs: number;
  readonly cancellationGraceMs: number;
  readonly resourceCeilings: typeof RESOURCE_CEILINGS;
  readonly bunPolicy: typeof BUN_POLICY;
  readonly runtimePredicates: typeof RUNTIME_PREDICATES;
}

/**
 * Reacquire the exact retained Service package and derive its fixed export set
 * from inspected Capability Contract/1 descriptors. Merely passing names from
 * author or controller input is intentionally insufficient.
 */
export async function observePrivateBunServicePackage(input: {
  readonly request: PrivateActivationRequest;
  readonly packageStoreRoot: string;
  readonly selector?: string;
}): Promise<PrivateBunServicePackageObservation> {
  const request = requirePrivateActivationRequest(input.request);
  const selector = input.selector ?? DEFAULT_SELECTOR;
  if (!ADAPTER_SELECTOR.test(selector)) {
    throw new TypeError("private Bun Service selector is invalid");
  }
  requirePrivateBunServiceRequest(request, selector);

  const captured = await captureStoredPackage(input.packageStoreRoot, request.package);
  try {
    const inspected = await inspectCapturedPackage(captured);
    if (inspected.digest !== request.package.digest || inspected.mode !== "service" ||
        inspected.entrypoint?.path !== request.entrypoint.path ||
        inspected.entrypoint.suffix !== request.entrypoint.suffix ||
        inspected.entrypoint.selector !== request.entrypoint.selector) {
      throw new Error("retained Package/1 no longer matches the Bun Service activation request");
    }
    if (Object.keys(inspected.metadata.uses ?? {}).length !== 0) {
      throw new TypeError("private Bun Service recipe requires Package/1 uses to be empty");
    }

    const exports = Object.freeze(inspected.providedContracts
      .map((provided) => Object.freeze({
        name: provided.slot,
        contract: Object.freeze({
          id: provided.contract.descriptor.id,
          version: provided.contract.descriptor.version,
          digest: provided.contract.digest,
        }),
      }))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    const identity = Object.freeze({
      kind: "private-bun-service-package-observation/1" as const,
      requestDigest: request.digest,
      packageDigest: request.package.digest,
      selector,
      exports,
    });
    const observation = Object.freeze({
      ...identity,
      digest: privateDomainDigest(
        "JIG-Private-Bun-Service-Package-Observation/1",
        identity as unknown as JsonValue,
      ),
    });
    authenticPackageObservations.add(observation);
    return observation;
  } finally {
    await captured.dispose();
  }
}

export function requirePrivateBunServicePackageObservation(
  value: unknown,
): PrivateBunServicePackageObservation {
  if (value === null || typeof value !== "object" || !authenticPackageObservations.has(value)) {
    throw new TypeError("Bun Service package observation was not produced by private inspection");
  }
  return value as PrivateBunServicePackageObservation;
}

/** Plan one exact dependency-free Bun Service Binding. */
export async function planPrivateBunService(input: {
  readonly request: PrivateActivationRequest;
  readonly packageObservation: PrivateBunServicePackageObservation;
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly backend: PrivateLinuxCgroupBackend;
}): Promise<PrivateBunServiceRecipe> {
  const request = requirePrivateActivationRequest(input.request);
  const packageObservation = requirePrivateBunServicePackageObservation(input.packageObservation);
  requirePrivateBunServiceRequest(request, packageObservation.selector);
  if (packageObservation.requestDigest !== request.digest ||
      packageObservation.packageDigest !== request.package.digest) {
    throw new TypeError("Bun Service package observation belongs to another activation request");
  }
  const runtimeSupport = requirePrivateRuntimeSupportObservation(input.runtimeSupport);
  const backend = requirePrivateLinuxCgroupBackend(input.backend);

  const [adapterDigest, mechanism] = await Promise.all([
    privateFileDigest(fileURLToPath(import.meta.url)),
    backend.observeMechanism(),
  ]);
  const adapter = Object.freeze({ artifactDigest: adapterDigest, revision: ADAPTER_REVISION });
  const backendIdentity = Object.freeze({
    artifactDigest: mechanism.trustedBackendDigest,
    revision: mechanism.kind,
  });
  const authorityDigest = privateDomainDigest("JIG-Private-Bun-Service-Authority/1", {
    attachments: request.attachments,
    slots: request.slots,
  } as unknown as JsonValue);
  const launchEnvelopeDigest = logicalLaunchDigest(
    request,
    packageObservation,
    runtimeSupport,
    mechanism,
  );
  const observation = createPrivateActivationRecipeObservation({
    requestDigest: request.digest,
    adapter,
    toolchainDigest: runtimeSupport.digest,
    inspectionDigest: packageObservation.digest,
    preparationPlanDigest: null,
    launchPlanner: adapter,
    backend: backendIdentity,
    preparationEnvelopeDigest: null,
    launchEnvelopeDigest,
    runtimeSupportClosureDigest: runtimeSupport.digest,
    runtimePredicates: [],
    requestedAuthorityDigest: authorityDigest,
    wouldGrantAuthorityDigest: authorityDigest,
    plannedAuthorityDigest: authorityDigest,
  });
  const identity = Object.freeze({
    kind: "private-bun-service-recipe/1" as const,
    requestDigest: request.digest,
    packageObservationDigest: packageObservation.digest,
    runtimeSupportDigest: runtimeSupport.digest,
    mechanismDigest: mechanism.digest,
    observationDigest: observation.digest,
  });
  const recipe = Object.freeze({
    kind: identity.kind,
    digest: privateDomainDigest(
      "JIG-Private-Bun-Service-Recipe/1",
      identity as unknown as JsonValue,
    ),
    request,
    packageObservation,
    expectedExports: Object.freeze(packageObservation.exports.map((item) => item.name)),
    runtimeSupport,
    backend,
    mechanismDigest: mechanism.digest,
    observation,
    executablePath: runtimeSupport.executablePath,
    packageDestination: PACKAGE_DESTINATION,
    scratch: SCRATCH,
    mountLifetimeCeilingMs: MAX_MOUNT_LIFETIME_MS,
    cancellationGraceMs: CANCELLATION_GRACE_MS,
    resourceCeilings: RESOURCE_CEILINGS,
    bunPolicy: BUN_POLICY,
    runtimePredicates: RUNTIME_PREDICATES,
  });
  authenticRecipes.add(recipe);
  return recipe;
}

export function requirePrivateBunServiceRecipe(value: unknown): PrivateBunServiceRecipe {
  if (value === null || typeof value !== "object" || !authenticRecipes.has(value)) {
    throw new TypeError("Bun Service recipe was not produced by the private planner");
  }
  return value as PrivateBunServiceRecipe;
}

function requirePrivateBunServiceRequest(
  request: PrivateActivationRequest,
  selector: string,
): void {
  if (request.mode !== "service" || request.target.kind !== "binding" ||
      request.entrypoint.path !== "flow.ts" || request.entrypoint.suffix !== "ts" ||
      (request.entrypoint.selector !== undefined && request.entrypoint.selector !== selector)) {
    throw new TypeError("private Bun Service recipe requires one matching flow.ts Binding activation");
  }
  if (Object.keys(request.settings).length !== 0 ||
      Object.keys(request.attachments).length !== 0 ||
      Object.keys(request.slots).length !== 0) {
    throw new TypeError("private Bun Service recipe supports one dependency-free zero-configuration Binding");
  }
}

function logicalLaunchDigest(
  request: PrivateActivationRequest,
  packageObservation: PrivateBunServicePackageObservation,
  runtimeSupport: PrivateRuntimeSupportObservation,
  mechanism: PrivateLinuxBackendMechanismObservation,
): string {
  return privateDomainDigest("JIG-Private-Bun-Service-Logical-Launch/1", {
    requestDigest: request.digest,
    package: request.package,
    entrypoint: request.entrypoint,
    packageObservationDigest: packageObservation.digest,
    expectedExports: packageObservation.exports,
    runtimeSupportDigest: runtimeSupport.digest,
    executableDigest: runtimeSupport.executableDigest,
    backendMechanismDigest: mechanism.digest,
    packageDestination: PACKAGE_DESTINATION,
    scratch: SCRATCH,
    resourceCeilings: RESOURCE_CEILINGS,
    mountLifetimeCeilingMs: MAX_MOUNT_LIFETIME_MS,
    cancellationGraceMs: CANCELLATION_GRACE_MS,
    environment: {},
    bunPolicy: BUN_POLICY,
    runtimePredicates: RUNTIME_PREDICATES,
  } as unknown as JsonValue);
}
