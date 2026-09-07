import { unavailable } from '../diagnostics.js'
import type { JsonValue } from '../json.js'
import {
  type PrivateActivationRequest,
  requirePrivateActivationRequest,
} from '../project/package-resolution.js'
import {
  createPrivateActivationRecipeObservation,
  type PrivateActivationRecipeObservation,
} from './activation-planning.js'
import { type PrivateAgentProvider, requirePrivateAgentProvider } from './agent-provider.js'
import { privateDomainDigest } from './identity.js'
import {
  type PrivateInstalledBunSupport,
  requirePrivateInstalledBunSupport,
} from './installed-bun-support.js'
import {
  type PrivateLinuxBackendMechanismSupport,
  type PrivateLinuxCgroupBackend,
  requirePrivateLinuxCgroupBackend,
} from './linux-rootless-backend.js'
import { normalizePackageArtifactRef, type PackageArtifactRef } from './package-artifact-store.js'
import { AGENT_RUN_CONTRACT_DIGEST } from './private-agent-run.js'
import {
  PROJECT_COMMAND_CONTRACT_DIGEST,
  PROJECT_COMMAND_LIMITS,
} from './private-project-command.js'
import { RUN_CHECKPOINT_CONTRACT_DIGEST, RUN_CHECKPOINT_LIMITS } from './private-run-checkpoint.js'
import {
  PRIVATE_ROOT_RESOURCE_POLICY,
  PRIVATE_FLOW_RESOURCE_CEILINGS as RESOURCE_CEILINGS,
} from './root-operation-limits.js'
import { PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS } from './root-run-timeout-policy.js'

const ADAPTER_REVISION = 'private-bun-direct/1'
const DEFAULT_SELECTOR = 'bun'
const PACKAGE_DESTINATION = '/package'
const SCRATCH = '/work'
const BUN_POLICY = Object.freeze(['--no-env-file', '--no-install', '--config=/dev/null'] as const)
const RUNTIME_PREDICATES = Object.freeze([
  'private-process-filesystem/1',
  'private-runtime-devices/1',
] as const)
const authenticRecipes = new WeakSet<object>()

export interface PrivateBunDirectRecipe {
  readonly kind: 'private-bun-direct-recipe/1'
  readonly digest: string
  readonly request: PrivateActivationRequest
  readonly executionPackage: PackageArtifactRef
  readonly installedSupport: PrivateInstalledBunSupport
  readonly backend: PrivateLinuxCgroupBackend
  readonly mechanismDigest: string
  readonly observation: PrivateActivationRecipeObservation
  readonly sandboxExecutablePath: '/jig-runtime/bun'
  readonly packageDestination: '/package'
  readonly scratch: '/work'
  readonly wallClockCeilingMs: number
  readonly resourceCeilings: typeof RESOURCE_CEILINGS
  readonly bunPolicy: typeof BUN_POLICY
  readonly privateProcessFilesystem: true
  readonly privateRuntimeDevices: true
  readonly agentProvider?: PrivateAgentProvider | undefined
}

/** Plan one exact, dependency-closed Bun flow.ts Run. */
export async function planPrivateBunDirectRun(input: {
  readonly request: PrivateActivationRequest
  readonly installedSupport: PrivateInstalledBunSupport
  readonly backend: PrivateLinuxCgroupBackend
  readonly executionPackage?: PackageArtifactRef
  readonly selector?: string
  readonly agentProvider?: PrivateAgentProvider | undefined
}): Promise<PrivateBunDirectRecipe> {
  const request = requirePrivateActivationRequest(input.request)
  const installedSupport = requirePrivateInstalledBunSupport(input.installedSupport)
  const backend = requirePrivateLinuxCgroupBackend(input.backend)
  const executionPackage = normalizePackageArtifactRef(input.executionPackage ?? request.package)
  const selector = input.selector ?? DEFAULT_SELECTOR
  if (
    request.mode !== 'run' ||
    request.entrypoint.path !== 'flow.ts' ||
    request.entrypoint.suffix !== 'ts' ||
    (request.entrypoint.selector !== undefined && request.entrypoint.selector !== selector)
  ) {
    throw new TypeError('private Bun recipe requires one matching flow.ts activation')
  }
  if (request.target.kind === 'flow') {
    if (Object.keys(request.settings).length !== 0) {
      throw new TypeError('private Bun direct Flow recipe requires zero configuration')
    }
  }
  const capabilityUses = Object.values(request.capabilities)
  if (
    capabilityUses.some(({ digest }) => digest === RUN_CHECKPOINT_CONTRACT_DIGEST) &&
    !Object.values(request.attachments).includes('read-write')
  )
    throw new TypeError('Run Checkpoint requires a root writable attachment')
  const usesAgent = capabilityUses.some(({ digest }) => digest === AGENT_RUN_CONTRACT_DIGEST)
  const usesCommand = capabilityUses.some(
    ({ digest }) => digest === PROJECT_COMMAND_CONTRACT_DIGEST,
  )
  if (usesAgent && input.agentProvider === undefined) {
    unavailable(
      'PROJECT_AGENT_UNAVAILABLE',
      'the target requires a configured host Agent',
      `${request.packagePath}/FLOW.md`,
    )
  }
  const agentProvider = !usesAgent ? undefined : requirePrivateAgentProvider(input.agentProvider)
  if (
    capabilityUses.some(
      ({ digest }) =>
        ![
          AGENT_RUN_CONTRACT_DIGEST,
          PROJECT_COMMAND_CONTRACT_DIGEST,
          RUN_CHECKPOINT_CONTRACT_DIGEST,
        ].includes(digest),
    ) ||
    capabilityUses.length > 3 ||
    (agentProvider !== undefined && agentProvider.contractDigest !== AGENT_RUN_CONTRACT_DIGEST)
  ) {
    throw new TypeError('private Bun recipe requires exact supported capabilities')
  }
  if (usesCommand && Object.keys(request.commands ?? {}).length === 0)
    unavailable(
      'PROJECT_COMMAND_UNCONFIGURED',
      'configure commands in a Binding for this Project Command Flow',
      `${request.packagePath}/FLOW.md`,
    )
  if (!usesCommand && request.commands !== undefined)
    throw new TypeError('command policy requires the Project Command capability')

  const adapterDigest = privateDomainDigest('JIG-Private-Bun-Direct-Adapter/1', {
    revision: ADAPTER_REVISION,
    installedSupportDigest: installedSupport.digest,
  })
  const mechanism = await backend.observeMechanism()
  const support = mechanism.support
  const adapter = Object.freeze({ artifactDigest: adapterDigest, revision: ADAPTER_REVISION })
  const backendIdentity = Object.freeze({
    artifactDigest: support.trustedSupervisorDigest,
    revision: support.kind,
  })
  const inspectionDigest = privateDomainDigest('JIG-Private-Bun-Inspection/1', {
    package: request.package,
    executionPackage,
    entrypoint: request.entrypoint,
    selector,
  } as unknown as JsonValue)
  const authorityDigest = privateDomainDigest('JIG-Private-Bun-Authority/1', {
    attachments: request.attachments,
    capabilities: request.capabilities,
    ...(request.commands === undefined ? {} : { commands: request.commands }),
  } as unknown as JsonValue)
  const launchEnvelopeDigest = logicalLaunchDigest(
    request,
    executionPackage,
    installedSupport,
    support,
    agentProvider,
  )
  const observation = createPrivateActivationRecipeObservation({
    requestDigest: request.digest,
    adapter,
    toolchainDigest: installedSupport.digest,
    inspectionDigest,
    launchPlanner: adapter,
    backend: backendIdentity,
    launchEnvelopeDigest,
    installedSupportDigest: installedSupport.digest,
    runtimePredicates: [],
    requestedAuthorityDigest: authorityDigest,
    wouldGrantAuthorityDigest: authorityDigest,
    plannedAuthorityDigest: authorityDigest,
  })
  const identity = Object.freeze({
    kind: 'private-bun-direct-recipe/1' as const,
    requestDigest: request.digest,
    installedSupportDigest: installedSupport.digest,
    mechanismDigest: support.digest,
    observationDigest: observation.digest,
    ...(agentProvider === undefined ? {} : { agentProviderDigest: agentProvider.digest }),
  })
  const recipe = Object.freeze({
    kind: identity.kind,
    digest: privateDomainDigest(
      'JIG-Private-Bun-Direct-Recipe/1',
      identity as unknown as JsonValue,
    ),
    request,
    executionPackage,
    installedSupport,
    backend,
    mechanismDigest: support.digest,
    observation,
    sandboxExecutablePath: installedSupport.sandboxExecutablePath,
    packageDestination: PACKAGE_DESTINATION,
    scratch: SCRATCH,
    wallClockCeilingMs: PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS,
    resourceCeilings: RESOURCE_CEILINGS,
    bunPolicy: BUN_POLICY,
    privateProcessFilesystem: true,
    privateRuntimeDevices: true,
    ...(agentProvider === undefined ? {} : { agentProvider }),
  })
  authenticRecipes.add(recipe)
  return recipe
}

export function requirePrivateBunDirectRecipe(value: unknown): PrivateBunDirectRecipe {
  if (value === null || typeof value !== 'object' || !authenticRecipes.has(value)) {
    throw new TypeError('Bun recipe was not produced by the private planner')
  }
  return value as PrivateBunDirectRecipe
}

function logicalLaunchDigest(
  request: PrivateActivationRequest,
  executionPackage: PackageArtifactRef,
  installedSupport: PrivateInstalledBunSupport,
  mechanism: PrivateLinuxBackendMechanismSupport,
  agentProvider: PrivateAgentProvider | undefined,
): string {
  return privateDomainDigest('JIG-Private-Bun-Logical-Launch/1', {
    requestDigest: request.digest,
    package: request.package,
    executionPackage,
    entrypoint: request.entrypoint,
    installedSupportDigest: installedSupport.digest,
    executableDigest: installedSupport.executableDigest,
    backendMechanismDigest: mechanism.digest,
    packageDestination: PACKAGE_DESTINATION,
    scratch: SCRATCH,
    resourceCeilings: RESOURCE_CEILINGS,
    wallClockCeilingMs: PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS,
    rootResourcePolicy: PRIVATE_ROOT_RESOURCE_POLICY,
    environment: Object.freeze({
      LD_LIBRARY_PATH: '/jig-runtime/lib',
    }),
    bunPolicy: BUN_POLICY,
    runtimePredicates: RUNTIME_PREDICATES,
    fileProfile: {
      inputBytes: 8 * 1024 * 1024,
      inputFiles: 64,
      outputBytes: 16 * 1024 * 1024,
      rootOnly: true,
    },
    capabilities: request.capabilities,
    ...(request.commands === undefined
      ? {}
      : { commands: request.commands, commandLimits: PROJECT_COMMAND_LIMITS }),
    ...(Object.values(request.capabilities).some((c) => c.digest === RUN_CHECKPOINT_CONTRACT_DIGEST)
      ? { checkpointLimits: RUN_CHECKPOINT_LIMITS }
      : {}),
    ...(agentProvider === undefined ? {} : { agentProviderDigest: agentProvider.digest }),
  } as unknown as JsonValue)
}
