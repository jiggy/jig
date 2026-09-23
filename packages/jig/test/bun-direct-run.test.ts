import { describe, expect, test } from 'bun:test'
import {
  inspectPrivateBunDirectIdentity,
  planPrivateBunDirectRun,
  requirePrivateBunDirectRecipe,
} from '../src/internal/bun-direct-run.js'
import { createPrivateAcpAgentProvider } from '../src/internal/acp-agent-provider.js'
import {
  EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
  privateBunExecutionArtifact,
} from '../src/internal/bun-execution-layout.js'
import { privateDomainDigest } from '../src/internal/identity.js'
import { openPrivateInstalledBunHost } from '../src/internal/installed-bun-host.js'
import { openPrivateInstalledBunSupport } from '../src/internal/installed-bun-support.js'
import { openPrivateAcpResources } from '../src/internal/private-acp-resources.js'
import {
  type PrivateLinuxBackendMechanismObservation,
  PrivateLinuxCgroupBackend,
} from '../src/internal/linux-rootless-backend.js'
import {
  FINITE_ACP_CONTRACT_DIGEST,
  FINITE_ACP_CONTRACT_ID,
  FINITE_ACP_CONTRACT_VERSION,
} from '../src/internal/private-finite-acp-contract.js'
import type { JsonValue } from '../src/json.js'
import {
  type PrivateActivationRequest,
  restorePrivateActivationRequest,
} from '../src/project/package-resolution.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

describe('private Bun direct Run', () => {
  test('read-only identity matches Run planning, tracks environment changes, and cannot authorize execution', async () => {
    const installedSupport = await openPrivateInstalledBunSupport(installedBunLocation)
    const backend = new StaticMechanismBackend({
      bunPath: '/test/bun',
      bunHostLibraryPath: '/test/lib',
    })
    const resources = (model: string, key: string) =>
      openPrivateAcpResources(installedSupport, {}, process.cwd(), async () =>
        createPrivateAcpAgentProvider({
          client: 'openai-codex',
          model,
          modeId: 'default',
          credentialMode: 'subscription',
          adapterPath: installedSupport.installedCliPath,
          sandboxAdapterPath: '/agent/adapter.js',
          executablePath: installedSupport.executablePath,
          sandboxExecutablePath: '/agent/client',
          environment: {},
          startupInput: new TextEncoder().encode(key),
        }),
      )
    const input = {
      request: activationRequest(true),
      installedSupport,
      acpResources: resources('test-model-a', 'test-key-a'),
    }
    const planned = await planPrivateBunDirectRun({ ...input, backend })
    const inspected = await inspectPrivateBunDirectIdentity(input, MECHANISM.support)
    expect(inspected).toEqual({
      digest: planned.digest,
      observationDigest: planned.observation.digest,
    })
    expect(() => requirePrivateBunDirectRecipe(inspected)).toThrow()
    expect(
      await inspectPrivateBunDirectIdentity(
        { ...input, acpResources: resources('test-model-a', 'test-key-b') },
        MECHANISM.support,
      ),
    ).toEqual(inspected)
    expect(
      await inspectPrivateBunDirectIdentity(
        { ...input, acpResources: resources('test-model-b', 'test-key-a') },
        MECHANISM.support,
      ),
    ).not.toEqual(inspected)
    expect(
      await inspectPrivateBunDirectIdentity(input, {
        ...MECHANISM.support,
        digest: digest('changed-support'),
      }),
    ).not.toEqual(inspected)
    await expect(
      inspectPrivateBunDirectIdentity({ ...input, acpResources: undefined }, MECHANISM.support),
    ).rejects.toBeDefined()
  })

  test('fixes the recipe envelope to the complete root Run timeout range', async () => {
    const installedSupport = await openPrivateInstalledBunSupport(installedBunLocation)
    const backend = new StaticMechanismBackend({
      bunPath: '/test/bun',
      bunHostLibraryPath: '/test/lib',
    })

    const recipe = await planPrivateBunDirectRun({
      request: activationRequest(),
      installedSupport,
      backend,
    })

    expect(recipe.wallClockCeilingMs).toBe(86_400_000)
    expect(recipe.execution.layout).toEqual(EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT)
    expect(recipe.resourceCeilings).toEqual({
      memoryBytes: 256 * 1024 * 1024,
      pids: 64,
      cpuQuotaMicros: 50_000,
      cpuPeriodMicros: 100_000,
      cleanupTimeoutMs: 5_000,
    })
  })

  test('binds the selected Flow root and workspace aliases independently of retained bytes', async () => {
    const installedSupport = await openPrivateInstalledBunSupport(installedBunLocation)
    const backend = new StaticMechanismBackend({
      bunPath: '/test/bun',
      bunHostLibraryPath: '/test/lib',
    })
    const request = activationRequest()
    const executionPackage = { kind: 'flow-package/0' as const, digest: digest('prepared') }
    const executionLayout = {
      flowRoot: 'flows/first',
      members: ['flows/first', 'flows/second', 'libs/first', 'libs/second'],
      aliases: [{ path: 'node_modules/helper', target: 'libs/first' }],
    }
    const plan = (layout: typeof executionLayout, preparationInputDigest?: string) =>
      planPrivateBunDirectRun({
        request,
        execution: privateBunExecutionArtifact(executionPackage, layout, preparationInputDigest),
        installedSupport,
        backend,
      })
    const withInputs = await plan(executionLayout, digest('workspace-inputs'))
    const original = await plan(executionLayout)
    const repeated = await plan(JSON.parse(JSON.stringify(executionLayout)))
    const differentRoot = await plan({ ...executionLayout, flowRoot: 'flows/second' })
    const differentAlias = await plan({
      ...executionLayout,
      aliases: [{ path: 'node_modules/helper', target: 'libs/second' }],
    })

    expect(repeated.digest).toBe(original.digest)
    expect(repeated.observation.digest).toBe(original.observation.digest)
    for (const changed of [differentRoot, differentAlias, withInputs]) {
      expect(changed.request).toEqual(original.request)
      expect(changed.execution.package).toEqual(original.execution.package)
      expect(changed.digest).not.toBe(original.digest)
      expect(changed.observation.digest).not.toBe(original.observation.digest)
    }
    expect(original.execution.layout).toEqual(executionLayout)
    expect(original.command).toEqual([
      original.sandboxExecutablePath,
      ...original.bunPolicy,
      '/package/flows/first/FLOW.ts',
    ])
    expect(differentRoot.command.at(-1)).toBe('/package/flows/second/FLOW.ts')
    executionLayout.aliases[0]!.target = 'libs/second'
    expect(original.execution.layout.aliases[0]!.target).toBe('libs/first')
  })

  test('keeps the ordinary layout equivalent whether explicit or omitted', async () => {
    const installedSupport = await openPrivateInstalledBunSupport(installedBunLocation)
    const backend = new StaticMechanismBackend({
      bunPath: '/test/bun',
      bunHostLibraryPath: '/test/lib',
    })
    const input = { request: activationRequest(), installedSupport, backend }
    const implicit = await planPrivateBunDirectRun(input)
    const explicit = await planPrivateBunDirectRun({
      ...input,
      execution: privateBunExecutionArtifact(input.request.package),
    })
    expect(explicit.digest).toBe(implicit.digest)
    expect(explicit.observation.digest).toBe(implicit.observation.digest)
  })

  test('rejects unsafe execution layout before producing a recipe', async () => {
    const installedSupport = await openPrivateInstalledBunSupport(installedBunLocation)
    const backend = new StaticMechanismBackend({
      bunPath: '/test/bun',
      bunHostLibraryPath: '/test/lib',
    })
    for (const executionLayout of [
      { flowRoot: '../outside', members: ['flows/one'], aliases: [] },
      { flowRoot: 'flows/one', members: ['flows/other'], aliases: [] },
      {
        flowRoot: 'flows/one',
        members: ['flows/one'],
        aliases: [{ path: 'node_modules/helper', target: 'libs/unselected' }],
      },
    ]) {
      await expect(
        planPrivateBunDirectRun({
          request: activationRequest(),
          installedSupport,
          backend,
          execution: { package: activationRequest().package, layout: executionLayout },
        }),
      ).rejects.toThrow()
    }
  })

  test('requires authenticated ACP resources and pins runtime policy without identifying credentials', async () => {
    const installedSupport = await openPrivateInstalledBunSupport(installedBunLocation)
    const backend = new StaticMechanismBackend({
      bunPath: '/test/bun',
      bunHostLibraryPath: '/test/lib',
    })
    const request = activationRequest(true)

    await expect(
      planPrivateBunDirectRun({
        request,
        installedSupport,
        backend,
      }),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'PROJECT_ACP_UNAVAILABLE',
      path: `${request.packagePath}/FLOW.ts`,
    })

    // Planning-only authenticated ACP fixtures: none of these files execute.
    const provider = (secret: string, model = 'provider/test-model', modeId = 'default') =>
      createPrivateAcpAgentProvider({
        client: 'openai-codex',
        model,
        modeId,
        credentialMode: 'subscription',
        adapterPath: installedSupport.installedCliPath,
        sandboxAdapterPath: '/agent/adapter.js',
        executablePath: installedSupport.executablePath,
        sandboxExecutablePath: '/agent/client',
        environment: {},
        startupInput: new TextEncoder().encode(secret),
      })
    const firstProvider = await provider('first-secret')
    const rotatedProvider = await provider('rotated-secret')
    const differentModelProvider = await provider('first-secret', 'provider/other-model')
    const differentModeProvider = await provider('first-secret', 'provider/test-model', 'review')
    const first = await planPrivateBunDirectRun({
      request,
      installedSupport,
      backend,
      acpResources: openPrivateAcpResources(
        installedSupport,
        {},
        process.cwd(),
        async () => firstProvider,
      ),
    })
    const rotated = await planPrivateBunDirectRun({
      request,
      installedSupport,
      backend,
      acpResources: openPrivateAcpResources(
        installedSupport,
        {},
        process.cwd(),
        async () => rotatedProvider,
      ),
    })
    const differentModel = await planPrivateBunDirectRun({
      request,
      installedSupport,
      backend,
      acpResources: openPrivateAcpResources(
        installedSupport,
        {},
        process.cwd(),
        async () => differentModelProvider,
      ),
    })
    const differentMode = await planPrivateBunDirectRun({
      request,
      installedSupport,
      backend,
      acpResources: openPrivateAcpResources(
        installedSupport,
        {},
        process.cwd(),
        async () => differentModeProvider,
      ),
    })

    expect(first.digest).toBe(rotated.digest)
    expect(first.observation.digest).toBe(rotated.observation.digest)
    expect(first.digest).not.toBe(differentModel.digest)
    expect(first.observation.digest).not.toBe(differentModel.observation.digest)
    expect(first.digest).not.toBe(differentMode.digest)
    expect(first.observation.digest).not.toBe(differentMode.observation.digest)
    expect(first.acp.session).toBe(firstProvider)
    expect(JSON.stringify(first.observation)).not.toContain('secret')
  })

  test('keeps unavailable native runtime configuration scoped to matching ACP grants', async () => {
    const backend = new StaticMechanismBackend({
      bunPath: '/test/bun',
      bunHostLibraryPath: '/test/lib',
    })
    const environments = [
      { PATH: '', CODEX_PATH: '/missing/codex' },
      { PATH: '', CLAUDE_PATH: '/missing/claude' },
      { PATH: '' },
    ] as const

    for (const environment of environments) {
      const host = await openPrivateInstalledBunHost(installedBunLocation, environment)
      await expect(
        planPrivateBunDirectRun({
          request: activationRequest(),
          installedSupport: host.installedBunSupport,
          backend,
          acpResources: host.acpResources,
        }),
      ).resolves.toMatchObject({ request: { slots: {} } })
      await expect(
        planPrivateBunDirectRun({
          request: activationRequest(true),
          installedSupport: host.installedBunSupport,
          backend,
          acpResources: host.acpResources,
        }),
      ).rejects.toMatchObject({ code: 'PROJECT_ACP_CODEX_EXECUTABLE' })
    }
  })
})

class StaticMechanismBackend extends PrivateLinuxCgroupBackend {
  override async observeMechanism(): Promise<PrivateLinuxBackendMechanismObservation> {
    return MECHANISM
  }
}

const MECHANISM: PrivateLinuxBackendMechanismObservation = Object.freeze({
  support: Object.freeze({
    kind: 'linux-rootless-cgroup-v2-bubblewrap-mechanism/1',
    digest: digest('mechanism'),
    trustedBubblewrapPath: '/test/bwrap',
    trustedBubblewrapDigest: digest('bubblewrap'),
    bubblewrapVersion: 'test',
    trustedCoordinatorBunPath: '/test/bun',
    trustedCoordinatorBunDigest: digest('coordinator-bun'),
    trustedCoordinatorLibraryPath: '/test/lib',
    trustedSupervisorPath: '/test/supervisor',
    trustedSupervisorDigest: digest('supervisor'),
    cgroupVersion: 2,
    controllers: Object.freeze(['cpu', 'memory', 'pids']),
    payloadUid: 1_000,
    payloadGid: 1_000,
    startupTimeoutMs: 1_000,
  }),
  authority: Object.freeze({
    bootId: '00000000-0000-0000-0000-000000000000',
    delegatedCgroup: '/test/cgroup',
    delegatedCgroupDevice: '1',
    delegatedCgroupInode: '2',
  }),
})

function activationRequest(acp = false): PrivateActivationRequest {
  const fields = Object.freeze({
    kind: 'activation-request/4' as const,
    target: Object.freeze({ kind: 'flow' as const, path: 'flows/example' }),
    mode: 'run' as const,
    packagePath: 'flows/example',
    package: Object.freeze({
      kind: 'flow-package/0' as const,
      digest: digest('package'),
    }),
    entrypoint: Object.freeze({ path: 'FLOW.ts', suffix: 'ts', selector: 'bun' }),
    settings: Object.freeze({}),
    slots: acp
      ? Object.freeze({
          session: Object.freeze({
            kind: 'native' as const,
            native: 'finite-acp' as const,
            grant: Object.freeze({ kind: 'acp' as const, client: 'codex' as const }),
            contract: Object.freeze({
              id: FINITE_ACP_CONTRACT_ID,
              version: FINITE_ACP_CONTRACT_VERSION,
              digest: FINITE_ACP_CONTRACT_DIGEST,
            }),
          }),
        })
      : Object.freeze({}),
    attachments: Object.freeze({}),
  })
  return restorePrivateActivationRequest(
    Object.freeze({
      ...fields,
      digest: privateDomainDigest('JIG-Activation-Request/4', fields as unknown as JsonValue),
    }),
  )
}

function digest(label: string): string {
  return privateDomainDigest('JIG-Test-Bun-Direct/1', { label })
}
