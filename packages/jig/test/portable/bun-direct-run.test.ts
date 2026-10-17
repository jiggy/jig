import { describe, expect, test } from 'bun:test'
import { createPrivateAcpAgentProvider } from '../../src/internal/acp-agent-provider.js'
import {
  inspectPrivateBunDirectIdentity,
  requirePrivateBunDirectRecipe,
} from '../../src/internal/bun-direct-run.js'
import { privateBunExecutionArtifact } from '../../src/internal/bun-execution-layout.js'
import { privateDomainDigest } from '../../src/internal/identity.js'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import { openPrivateInstalledBunSupport } from '../../src/internal/installed-bun-support.js'
import type { PrivateLinuxBackendMechanismSupport } from '../../src/internal/linux-rootless-backend.js'
import { openPrivateAcpResources } from '../../src/internal/private-acp-resources.js'
import {
  FINITE_ACP_CONTRACT_DIGEST,
  FINITE_ACP_CONTRACT_ID,
  FINITE_ACP_CONTRACT_VERSION,
} from '../../src/internal/private-finite-acp-contract.js'
import type { JsonValue } from '../../src/json.js'
import {
  type PrivateActivationRequest,
  restorePrivateActivationRequest,
} from '../../src/project/package-resolution.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'

// Ordinary identity input only. Never presented as observed support or launch authority.
const SUPPORT: PrivateLinuxBackendMechanismSupport = Object.freeze({
  kind: 'linux-rootless-cgroup-v2-bubblewrap-mechanism/1',
  digest: digest('mechanism'),
  trustedBubblewrapPath: '/identity/bwrap',
  trustedBubblewrapDigest: digest('bubblewrap'),
  bubblewrapVersion: 'identity-input',
  trustedCoordinatorBunPath: '/identity/bun',
  trustedCoordinatorBunDigest: digest('coordinator-bun'),
  trustedCoordinatorLibraryPath: '/identity/lib',
  trustedSupervisorPath: '/identity/supervisor',
  trustedSupervisorDigest: digest('supervisor'),
  cgroupVersion: 2,
  controllers: Object.freeze(['cpu', 'memory', 'pids']),
  payloadUid: 1_000,
  payloadGid: 1_000,
  startupTimeoutMs: 1_000,
})

function digest(label: string): string {
  return privateDomainDigest('JIG-Test-Bun-Direct/1', { label })
}

function activationRequest(acp = false): PrivateActivationRequest {
  const fields = Object.freeze({
    kind: 'activation-request/4' as const,
    target: Object.freeze({ kind: 'flow' as const, path: 'flows/example' }),
    mode: 'run' as const,
    packagePath: 'flows/example',
    package: Object.freeze({ kind: 'flow-package/0' as const, digest: digest('package') }),
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

describe('private Bun direct identity inspection', () => {
  test('tracks non-secret environment inputs without authorizing execution', async () => {
    const installedSupport = await openPrivateInstalledBunSupport(installedBunLocation)
    const resources = (model: string, key: string, modeId = 'default') =>
      openPrivateAcpResources(installedSupport, {}, process.cwd(), async () =>
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
          startupInput: new TextEncoder().encode(key),
        }),
      )
    const input = {
      request: activationRequest(true),
      installedSupport,
      acpResources: resources('test-model-a', 'test-key-a'),
    }
    const inspected = await inspectPrivateBunDirectIdentity(input, SUPPORT)
    expect(() => requirePrivateBunDirectRecipe(inspected)).toThrow()
    expect(
      await inspectPrivateBunDirectIdentity(
        { ...input, acpResources: resources('test-model-a', 'test-key-b') },
        SUPPORT,
      ),
    ).toEqual(inspected)
    for (const acpResources of [
      resources('test-model-b', 'test-key-a'),
      resources('test-model-a', 'test-key-a', 'review'),
    ]) {
      const changed = await inspectPrivateBunDirectIdentity({ ...input, acpResources }, SUPPORT)
      expect(changed.digest).not.toBe(inspected.digest)
      expect(changed.observationDigest).not.toBe(inspected.observationDigest)
    }
    expect(
      await inspectPrivateBunDirectIdentity(input, {
        ...SUPPORT,
        digest: digest('changed-support'),
      }),
    ).not.toEqual(inspected)
    await expect(
      inspectPrivateBunDirectIdentity({ ...input, acpResources: undefined }, SUPPORT),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'PROJECT_ACP_UNAVAILABLE',
      path: `${input.request.packagePath}/FLOW.ts`,
    })
  })

  test('binds root, aliases and preparation inputs independently of retained package bytes', async () => {
    const installedSupport = await openPrivateInstalledBunSupport(installedBunLocation)
    const request = activationRequest()
    const executionPackage = { kind: 'flow-package/0' as const, digest: digest('prepared') }
    const alias = { path: 'node_modules/helper', target: 'libs/first' }
    const layout = {
      flowRoot: 'flows/first',
      members: ['flows/first', 'flows/second', 'libs/first', 'libs/second'],
      aliases: [alias],
    }
    const artifact = privateBunExecutionArtifact(executionPackage, layout)
    expect(artifact.package).toEqual(executionPackage)
    expect(artifact.layout).toEqual(layout)
    const inspect = (value: typeof layout, inputDigest?: string) =>
      inspectPrivateBunDirectIdentity(
        {
          request,
          installedSupport,
          execution: privateBunExecutionArtifact(
            executionPackage,
            value,
            inputDigest === undefined ? undefined : { inputDigest, package: executionPackage },
          ),
        },
        SUPPORT,
      )
    const original = await inspect(layout)
    expect(await inspect(JSON.parse(JSON.stringify(layout)))).toEqual(original)
    for (const changed of [
      await inspect({ ...layout, flowRoot: 'flows/second' }),
      await inspect({
        ...layout,
        aliases: [{ path: 'node_modules/helper', target: 'libs/second' }],
      }),
      await inspect(layout, digest('workspace-inputs')),
    ]) {
      expect(changed.digest).not.toBe(original.digest)
      expect(changed.observationDigest).not.toBe(original.observationDigest)
    }
    alias.target = 'libs/second'
    expect(artifact.layout.aliases[0]?.target).toBe('libs/first')
  })

  test('keeps omitted and explicit ordinary execution identities equivalent', async () => {
    const installedSupport = await openPrivateInstalledBunSupport(installedBunLocation)
    const input = { request: activationRequest(), installedSupport }
    expect(
      await inspectPrivateBunDirectIdentity(
        { ...input, execution: privateBunExecutionArtifact(input.request.package) },
        SUPPORT,
      ),
    ).toEqual(await inspectPrivateBunDirectIdentity(input, SUPPORT))
  })

  test('rejects unsafe layout inputs without acquiring native authority', async () => {
    const installedSupport = await openPrivateInstalledBunSupport(installedBunLocation)
    const request = activationRequest()
    for (const layout of [
      { flowRoot: '../outside', members: ['flows/one'], aliases: [] },
      { flowRoot: 'flows/one', members: ['flows/other'], aliases: [] },
      {
        flowRoot: 'flows/one',
        members: ['flows/one'],
        aliases: [{ path: 'node_modules/helper', target: 'libs/unselected' }],
      },
    ]) {
      await expect(
        inspectPrivateBunDirectIdentity(
          { request, installedSupport, execution: { package: request.package, layout } },
          SUPPORT,
        ),
      ).rejects.toThrow()
    }
  })

  test('scopes unavailable runtime configuration to matching ACP grants', async () => {
    for (const environment of [
      { PATH: '', CODEX_PATH: '/missing/codex' },
      { PATH: '', CLAUDE_PATH: '/missing/claude' },
      { PATH: '' },
    ]) {
      const host = await openPrivateInstalledBunHost(installedBunLocation, environment)
      const input = {
        installedSupport: host.installedBunSupport,
        acpResources: host.acpResources,
      }
      expect(
        (await inspectPrivateBunDirectIdentity({ ...input, request: activationRequest() }, SUPPORT))
          .digest,
      ).toBeString()
      await expect(
        inspectPrivateBunDirectIdentity({ ...input, request: activationRequest(true) }, SUPPORT),
      ).rejects.toMatchObject({ code: 'PROJECT_ACP_CODEX_EXECUTABLE', pointer: '/slots/session' })
    }
  })
})
