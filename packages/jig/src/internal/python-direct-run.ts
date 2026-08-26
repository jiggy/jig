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
  type PrivateLinuxCgroupLimits,
} from "./linux-cgroup-backend.js";
import { captureStoredPackage } from "./package-artifact-store.js";
import { materializeCapturedPackage } from "./package-materialization.js";
import { canonicalJson, type JsonValue } from "../json.js";
import {
  requirePrivateActivationRequest,
  type PrivateActivationRequest,
} from "../project/package-resolution.js";
import {
  RunHostSession,
  type RunHostInvocation,
  type RunHostTerminal,
} from "../run/session.js";

const ADAPTER_REVISION = "private-python-direct/1";
const DEFAULT_SELECTOR = "python";
const PACKAGE_DESTINATION = "/package";
const SCRATCH = "/work";
const MAX_WALL_CLOCK_MS = 30_000;
const authenticRecipes = new WeakSet<object>();

const RESOURCE_CEILINGS = Object.freeze({
  memoryBytes: 128 * 1024 * 1024,
  pids: 32,
  cpuQuotaMicros: 50_000,
  cpuPeriodMicros: 100_000,
  cleanupTimeoutMs: 5_000,
});

export interface PrivatePythonDirectRecipe {
  readonly kind: "private-python-direct-recipe/1";
  readonly digest: string;
  readonly request: PrivateActivationRequest;
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly mechanismDigest: string;
  readonly observation: PrivateActivationRecipeObservation;
  readonly executablePath: string;
  readonly packageDestination: "/package";
  readonly scratch: "/work";
  readonly resourceCeilings: typeof RESOURCE_CEILINGS;
}

export interface PrivatePythonDirectRunResult {
  readonly terminal: RunHostTerminal;
  readonly envelopeDigest: string;
  readonly enforcement: {
    readonly terminationReason: string;
    readonly evidence: {
      readonly cpuStat: Readonly<Record<string, number>>;
      readonly memoryEvents: Readonly<Record<string, number>>;
      readonly pidsEvents: Readonly<Record<string, number>>;
    };
  };
}

/**
 * Plan the first exact Python recipe. This is deliberately narrower than a
 * Runtime Adapter: no dependency preparation, registry, or public extension
 * contract is implied.
 */
export async function planPrivatePythonDirectRun(input: {
  readonly request: PrivateActivationRequest;
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly selector?: string;
}): Promise<PrivatePythonDirectRecipe> {
  const request = requirePrivateActivationRequest(input.request);
  const runtimeSupport = requirePrivateRuntimeSupportObservation(input.runtimeSupport);
  const backend = requirePrivateLinuxCgroupBackend(input.backend);
  const selector = input.selector ?? DEFAULT_SELECTOR;
  if (request.mode !== "run" || request.target.kind !== "flow" ||
      request.entrypoint.path !== "flow.py" || request.entrypoint.suffix !== "py" ||
      (request.entrypoint.selector !== undefined && request.entrypoint.selector !== selector)) {
    throw new TypeError("private Python recipe requires one matching direct flow.py activation");
  }
  if (Object.keys(request.settings).length !== 0 || Object.keys(request.attachments).length !== 0 ||
      Object.keys(request.slots).length !== 0) {
    throw new TypeError("private Python recipe supports only a zero-configuration direct Run");
  }

  const [adapterDigest, mechanism] = await Promise.all([
    privateFileDigest(fileURLToPath(import.meta.url)),
    backend.observeMechanism(),
  ]);
  const adapter = Object.freeze({ artifactDigest: adapterDigest, revision: ADAPTER_REVISION });
  const backendIdentity = Object.freeze({
    artifactDigest: mechanism.trustedBackendDigest,
    revision: mechanism.kind,
  });
  const inspectionDigest = privateDomainDigest("JIG-Private-Python-Inspection/1", {
    package: request.package,
    entrypoint: request.entrypoint,
    selector,
  } as unknown as JsonValue);
  const authorityDigest = privateDomainDigest("JIG-Private-Python-Authority/1", {
    attachments: request.attachments,
    slots: request.slots,
  } as unknown as JsonValue);
  const launchEnvelopeDigest = logicalLaunchDigest(request, runtimeSupport, mechanism);
  const observation = createPrivateActivationRecipeObservation({
    requestDigest: request.digest,
    adapter,
    toolchainDigest: runtimeSupport.digest,
    inspectionDigest,
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
    kind: "private-python-direct-recipe/1" as const,
    requestDigest: request.digest,
    runtimeSupportDigest: runtimeSupport.digest,
    mechanismDigest: mechanism.digest,
    observationDigest: observation.digest,
  });
  const recipe = Object.freeze({
    kind: identity.kind,
    digest: privateDomainDigest(
      "JIG-Private-Python-Direct-Recipe/1",
      identity as unknown as JsonValue,
    ),
    request,
    runtimeSupport,
    backend,
    mechanismDigest: mechanism.digest,
    observation,
    executablePath: runtimeSupport.executablePath,
    packageDestination: PACKAGE_DESTINATION,
    scratch: SCRATCH,
    resourceCeilings: RESOURCE_CEILINGS,
  });
  authenticRecipes.add(recipe);
  return recipe;
}

export function requirePrivatePythonDirectRecipe(value: unknown): PrivatePythonDirectRecipe {
  if (value === null || typeof value !== "object" || !authenticRecipes.has(value)) {
    throw new TypeError("Python recipe was not produced by the private planner");
  }
  return value as PrivatePythonDirectRecipe;
}

/** Acquire exact Package/1 bytes, revalidate host support, launch, and clean up. */
export async function runPrivatePythonDirectRecipe(input: {
  readonly recipe: PrivatePythonDirectRecipe;
  readonly packageStoreRoot: string;
  readonly runId: string;
  readonly invocation: Omit<RunHostInvocation, "scratch">;
}): Promise<PrivatePythonDirectRunResult> {
  const recipe = requirePrivatePythonDirectRecipe(input.recipe);
  canonicalJson(input.invocation.input);
  const invocationConfiguration = privateDomainDigest("JIG-Private-Python-Invocation-Configuration/1", {
    settings: input.invocation.settings,
    attachments: input.invocation.attachments,
  } as unknown as JsonValue);
  const plannedConfiguration = privateDomainDigest("JIG-Private-Python-Invocation-Configuration/1", {
    settings: recipe.request.settings,
    attachments: recipe.request.attachments,
  } as unknown as JsonValue);
  if (invocationConfiguration !== plannedConfiguration) {
    throw new TypeError("Python Run invocation differs from its admitted settings or attachments");
  }
  const remaining = input.invocation.deadlineUnixMs - Date.now();
  if (!Number.isSafeInteger(remaining) || remaining <= 0) {
    throw new RangeError("Python Run deadline elapsed before activation");
  }
  const [mechanism, executableDigest] = await Promise.all([
    recipe.backend.observeMechanism(),
    privateFileDigest(recipe.executablePath),
  ]);
  if (mechanism.digest !== recipe.mechanismDigest ||
      executableDigest !== recipe.runtimeSupport.executableDigest) {
    throw new Error("Python Run recipe no longer matches retained host support");
  }
  const captured = await captureStoredPackage(input.packageStoreRoot, recipe.request.package);

  let materialized: Awaited<ReturnType<typeof materializeCapturedPackage>> | undefined;
  try {
    materialized = await materializeCapturedPackage(captured);
  } finally {
    await captured.dispose();
  }
  try {
    const limits: PrivateLinuxCgroupLimits = Object.freeze({
      ...recipe.resourceCeilings,
      wallClockMs: Math.min(remaining, MAX_WALL_CLOCK_MS),
    });
    const component = await recipe.backend.launch({
      runId: input.runId,
      limits,
      readOnlyMounts: [
        ...recipe.runtimeSupport.closureSources.map((source) => ({ source, destination: source })),
        { source: materialized.root, destination: recipe.packageDestination },
      ],
      command: [recipe.executablePath, `${recipe.packageDestination}/${recipe.request.entrypoint.path}`],
    }, input.invocation.signal);
    const terminal = await new RunHostSession(component, {
      ...input.invocation,
      scratch: recipe.scratch,
    }).run();
    return Object.freeze({
      terminal,
      envelopeDigest: component.envelope.sealedPlanDigest,
      enforcement: Object.freeze({
        terminationReason: await component.terminationReason,
        evidence: await component.evidence,
      }),
    });
  } finally {
    await materialized.dispose();
  }
}

function logicalLaunchDigest(
  request: PrivateActivationRequest,
  runtimeSupport: PrivateRuntimeSupportObservation,
  mechanism: PrivateLinuxBackendMechanismObservation,
): string {
  return privateDomainDigest("JIG-Private-Python-Logical-Launch/1", {
    requestDigest: request.digest,
    package: request.package,
    entrypoint: request.entrypoint,
    runtimeSupportDigest: runtimeSupport.digest,
    executableDigest: runtimeSupport.executableDigest,
    backendMechanismDigest: mechanism.digest,
    packageDestination: PACKAGE_DESTINATION,
    scratch: SCRATCH,
    resourceCeilings: RESOURCE_CEILINGS,
    environment: {},
    runtimePredicates: [],
  } as unknown as JsonValue);
}
