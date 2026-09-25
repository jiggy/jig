import { unavailable } from '../diagnostics.js'
import type { JsonValue } from '../json.js'
import { nativeSlotRoutes } from '../project/invocation-slots.js'
import {
  type PrivateActivationRequest,
  requirePrivateActivationRequest,
} from '../project/package-resolution.js'
import { CHANNEL_LIMITS } from '../run/channels.js'
import type { PrivateAcpAgentProvider } from './acp-agent-provider.js'
import {
  createPrivateActivationRecipeObservation,
  type PrivateActivationRecipeObservation,
} from './activation-planning.js'
import {
  normalizePrivateBunExecutionArtifact,
  type PrivateBunExecutionArtifact,
  privateBunExecutionArtifact,
} from './bun-execution-layout.js'
import { type HttpGrant, type PrivateHttpGrants, selectHttpGrants } from './http-grants.js'
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
import {
  type PrivateAcpResources,
  PrivateAcpResourceUnavailableError,
  selectPrivateAcpResources,
} from './private-acp-resources.js'
import { PROJECT_COMMAND_LIMITS } from './private-project-command.js'
import { RUN_CHECKPOINT_LIMITS } from './private-run-checkpoint.js'
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
  readonly execution: PrivateBunExecutionArtifact
  readonly command: readonly [string, ...string[]]
  readonly runtimeMounts: PrivateInstalledBunSupport['runtimeMounts']
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
  readonly http: Readonly<Record<string, HttpGrant>>
  readonly acp: Readonly<Record<string, PrivateAcpAgentProvider>>
}

/** Plan one exact, dependency-closed Bun FLOW.ts Run. */
export async function planPrivateBunDirectRun(input: {
  readonly request: PrivateActivationRequest
  readonly installedSupport: PrivateInstalledBunSupport
  readonly backend: PrivateLinuxCgroupBackend
  readonly execution?: PrivateBunExecutionArtifact
  readonly selector?: string
  readonly httpGrants?: PrivateHttpGrants | undefined
  readonly acpResources?: PrivateAcpResources | undefined
}): Promise<PrivateBunDirectRecipe> {
  const backend = requirePrivateLinuxCgroupBackend(input.backend)
  const fields = await describePrivateBunDirectRun(
    input,
    async () => (await backend.observeMechanism()).support,
  )
  const recipe = Object.freeze({ ...fields, backend })
  authenticRecipes.add(recipe)
  return recipe
}

/** Same recipe identity as planning, without manufacturing an executable recipe. */
export async function inspectPrivateBunDirectIdentity(
  input: Omit<Parameters<typeof planPrivateBunDirectRun>[0], 'backend'>,
  support: PrivateLinuxBackendMechanismSupport,
): Promise<{ readonly digest: string; readonly observationDigest: string }> {
  const fields = await describePrivateBunDirectRun(input, async () => support)
  return { digest: fields.digest, observationDigest: fields.observation.digest }
}

async function describePrivateBunDirectRun(
  input: Omit<Parameters<typeof planPrivateBunDirectRun>[0], 'backend'>,
  observeSupport: () => Promise<PrivateLinuxBackendMechanismSupport>,
): Promise<Omit<PrivateBunDirectRecipe, 'backend'>> {
  const request = requirePrivateActivationRequest(input.request)
  const installedSupport = requirePrivateInstalledBunSupport(input.installedSupport)
  const execution = normalizePrivateBunExecutionArtifact(
    input.execution ?? privateBunExecutionArtifact(request.package),
  )
  const selector = input.selector ?? DEFAULT_SELECTOR
  if (
    request.mode !== 'run' ||
    !['FLOW.ts', 'FLOW.md'].includes(request.entrypoint.path) ||
    !['ts', 'md'].includes(request.entrypoint.suffix) ||
    (request.entrypoint.selector !== undefined && request.entrypoint.selector !== selector)
  ) {
    throw new TypeError('private Bun recipe requires one matching FLOW.ts or FLOW.md activation')
  }
  if (
    request.entrypoint.suffix === 'md' &&
    (execution.package.digest !== request.package.digest ||
      execution.layout.flowRoot !== '' ||
      execution.layout.aliases.length !== 0)
  )
    throw new TypeError(
      'Markdown runs use only their captured package, without dependency preparation',
    )
  if (request.target.kind === 'flow') {
    if (Object.keys(request.settings).length !== 0) {
      throw new TypeError('private Bun direct Flow recipe requires zero configuration')
    }
  }
  const nativeRoutes = nativeSlotRoutes(request.slots)
  if (
    nativeRoutes.some(({ native }) => native === 'run-checkpoint') &&
    !Object.values(request.attachments).includes('read-write')
  )
    throw new TypeError('Run Checkpoint requires a root writable attachment')
  let acp: Readonly<Record<string, PrivateAcpAgentProvider>>
  try {
    acp = await selectPrivateAcpResources(input.acpResources, request.slots, installedSupport)
  } catch (error) {
    unavailable(
      error instanceof PrivateAcpResourceUnavailableError ? error.code : 'PROJECT_ACP_UNAVAILABLE',
      error instanceof PrivateAcpResourceUnavailableError
        ? error.message
        : 'the target requires private operator resources for its selected ACP grants',
      `${request.packagePath}/${request.entrypoint.path}`,
      error instanceof PrivateAcpResourceUnavailableError
        ? `/slots/${error.slot.replace(/~/g, '~0').replace(/\//g, '~1')}`
        : undefined,
    )
  }
  let http: Readonly<Record<string, HttpGrant>>
  const usesHttp = nativeRoutes.some(({ native }) => native === 'http-request')
  try {
    http = selectHttpGrants(input.httpGrants, request.slots)
    if (usesHttp && Object.keys(http).length === 0) throw new Error('missing resource')
    if (!usesHttp && Object.keys(http).length !== 0) throw new Error('undeclared resource')
  } catch {
    unavailable(
      'PROJECT_HTTP_UNAVAILABLE',
      'configure matching slot grants and selected bearer environment variables before review',
      `${request.packagePath}/${request.entrypoint.path}`,
    )
  }
  const adapterDigest = privateDomainDigest('JIG-Private-Bun-Direct-Adapter/1', {
    revision: ADAPTER_REVISION,
    installedSupportDigest: installedSupport.digest,
  })
  const support = await observeSupport()
  const adapter = Object.freeze({ artifactDigest: adapterDigest, revision: ADAPTER_REVISION })
  const backendIdentity = Object.freeze({
    artifactDigest: support.trustedSupervisorDigest,
    revision: support.kind,
  })
  const inspectionDigest = privateDomainDigest('JIG-Private-Bun-Inspection/1', {
    package: request.package,
    execution,
    entrypoint: request.entrypoint,
    selector,
  } as unknown as JsonValue)
  const authorityDigest = privateDomainDigest('JIG-Private-Bun-Authority/1', {
    attachments: request.attachments,
    ...(request.boundAttachments === undefined
      ? {}
      : { boundAttachments: request.boundAttachments }),
    slots: request.slots,
    http,
  } as unknown as JsonValue)
  const launchEnvelopeDigest = logicalLaunchDigest(
    request,
    execution,
    installedSupport,
    support,
    http,
    acp,
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
  })
  const recipe = Object.freeze({
    kind: identity.kind,
    digest: privateDomainDigest(
      'JIG-Private-Bun-Direct-Recipe/1',
      identity as unknown as JsonValue,
    ),
    request,
    execution,
    http,
    acp,
    installedSupport,
    runtimeMounts: Object.freeze([
      ...installedSupport.runtimeMounts,
      ...(request.entrypoint.suffix === 'md'
        ? [
            {
              source: installedSupport.markdownRuntimePath,
              destination: installedSupport.sandboxMarkdownRuntimePath,
            },
          ]
        : []),
    ]),
    mechanismDigest: support.digest,
    observation,
    sandboxExecutablePath: installedSupport.sandboxExecutablePath,
    packageDestination: PACKAGE_DESTINATION,
    command: Object.freeze([
      installedSupport.sandboxExecutablePath,
      ...BUN_POLICY,
      ...(request.entrypoint.suffix === 'md' ? [installedSupport.sandboxMarkdownRuntimePath] : []),
      `${PACKAGE_DESTINATION}/${execution.layout.flowRoot ? `${execution.layout.flowRoot}/` : ''}${request.entrypoint.path}`,
    ]) as readonly [string, ...string[]],
    scratch: SCRATCH,
    wallClockCeilingMs: PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS,
    resourceCeilings: RESOURCE_CEILINGS,
    bunPolicy: BUN_POLICY,
    privateProcessFilesystem: true,
    privateRuntimeDevices: true,
  })
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
  execution: PrivateBunExecutionArtifact,
  installedSupport: PrivateInstalledBunSupport,
  mechanism: PrivateLinuxBackendMechanismSupport,
  http: Readonly<Record<string, HttpGrant>>,
  acp: Readonly<Record<string, PrivateAcpAgentProvider>>,
): string {
  return privateDomainDigest('JIG-Private-Bun-Logical-Launch/1', {
    requestDigest: request.digest,
    package: request.package,
    execution,
    entrypoint: request.entrypoint,
    installedSupportDigest: installedSupport.digest,
    executableDigest: installedSupport.executableDigest,
    backendMechanismDigest: mechanism.digest,
    packageDestination: PACKAGE_DESTINATION,
    scratch: SCRATCH,
    resourceCeilings: RESOURCE_CEILINGS,
    wallClockCeilingMs: PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS,
    rootResourcePolicy: PRIVATE_ROOT_RESOURCE_POLICY,
    channelLimits: CHANNEL_LIMITS,
    http,
    acp: Object.fromEntries(Object.entries(acp).map(([slot, provider]) => [slot, provider.digest])),
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
    slots: request.slots,
    ...(nativeSlotRoutes(request.slots).some((route) => route.native === 'project-command')
      ? { commandLimits: PROJECT_COMMAND_LIMITS }
      : {}),
    ...(nativeSlotRoutes(request.slots).some((route) => route.native === 'run-checkpoint')
      ? { checkpointLimits: RUN_CHECKPOINT_LIMITS }
      : {}),
  } as unknown as JsonValue)
}
