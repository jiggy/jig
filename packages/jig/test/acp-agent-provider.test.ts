import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  createPrivateAcpAgentProvider,
  privateAcpAgentRuntime,
  requirePrivateAcpAgentProvider,
  revalidatePrivateAcpAgentProvider,
} from '../src/internal/acp-agent-provider.js'

const temporary = new Set<string>()
afterEach(async () => {
  await Promise.all([...temporary].map((path) => rm(path, { recursive: true, force: true })))
  temporary.clear()
})

describe('private ACP Agent provider', () => {
  test('keeps authentication outside stable provider identity and launch environment', async () => {
    const support = await files()
    const first = await provider(support, 'first-secret')
    const rotated = await provider(support, 'rotated-secret')

    expect(first.digest).toBe(rotated.digest)
    expect(JSON.stringify(first)).not.toContain('secret')
    expect(privateAcpAgentRuntime(first).authentication?.request).toEqual({
      methodId: 'gateway',
      _meta: {
        gateway: {
          baseUrl: 'https://gateway.example/v1',
          headers: { Authorization: 'Bearer first-secret' },
        },
      },
    })
    expect(privateAcpAgentRuntime(first).environment).toEqual({ CLIENT_PATH: '/agent/client' })
    expect(() => requirePrivateAcpAgentProvider(Object.freeze({ ...first }))).toThrow(
      'not produced by an ACP client factory',
    )
    await expect(revalidatePrivateAcpAgentProvider(first)).resolves.toBeUndefined()

    await writeFile(support.adapter, 'changed adapter\n')
    await expect(revalidatePrivateAcpAgentProvider(first)).rejects.toThrow(
      'support changed after selection',
    )
  })

  test('rejects credential-bearing process environments', async () => {
    const support = await files()
    await expect(
      createPrivateAcpAgentProvider({
        client: 'test',
        model: 'provider/model',
        credentialMode: 'gateway',
        adapterPath: support.adapter,
        sandboxAdapterPath: '/agent/adapter.js',
        executablePath: support.executable,
        sandboxExecutablePath: '/agent/client',
        environment: { PROVIDER_API_KEY: 'must-not-enter-the-process' },
      }),
    ).rejects.toThrow('launch environment is invalid')
  })

  test('binds non-secret authentication and support behavior into identity', async () => {
    const support = await files()
    const first = await provider(support, 'first-secret')
    const differentEndpoint = await provider(support, 'first-secret', 'https://other.example/v1')
    expect(first.digest).not.toBe(differentEndpoint.digest)

    const supportFile = join(support.root, 'requirements.toml')
    await writeFile(supportFile, 'first\n')
    const mounted = await provider(support, 'first-secret', 'https://gateway.example/v1', [
      {
        source: supportFile,
        destination: '/etc/client/requirements.toml',
        role: 'support',
      },
    ])
    await writeFile(supportFile, 'changed\n')
    await expect(revalidatePrivateAcpAgentProvider(mounted)).rejects.toThrow(
      'support changed after selection',
    )
  })

  test('keeps bounded startup credentials out of provider identity', async () => {
    const support = await files()
    let valid = true
    const base = {
      client: 'test-client',
      model: 'provider/model',
      credentialMode: 'subscription',
      adapterPath: support.adapter,
      sandboxAdapterPath: '/agent/adapter.js',
      executablePath: support.executable,
      sandboxExecutablePath: '/agent/client',
      environment: { CLIENT_PATH: '/agent/client' },
    } as const
    const first = await createPrivateAcpAgentProvider({
      ...base,
      startupInput: new TextEncoder().encode('first-secret'),
      revalidateStartupInput: () => {
        if (!valid) throw new Error('startup authority expired')
      },
    })
    const rotated = await createPrivateAcpAgentProvider({
      ...base,
      startupInput: new TextEncoder().encode('rotated-secret'),
    })
    expect(first.digest).toBe(rotated.digest)
    expect(new TextDecoder().decode(privateAcpAgentRuntime(first).startupInput!())).toBe(
      'first-secret',
    )
    expect(JSON.stringify(first)).not.toContain('secret')
    valid = false
    expect(() => privateAcpAgentRuntime(first).startupInput!()).toThrow('startup authority expired')
    await expect(
      createPrivateAcpAgentProvider({
        ...base,
        startupInput: new Uint8Array(65_537),
      }),
    ).rejects.toThrow('startup input is invalid')
    await expect(
      createPrivateAcpAgentProvider({
        ...base,
        revalidateStartupInput: () => undefined,
      }),
    ).rejects.toThrow('startup-input validation has no input')
  })

  test('binds nested native sandbox authority into provider identity', async () => {
    const support = await files()
    const base = {
      client: 'test-client',
      model: 'provider/model',
      credentialMode: 'subscription',
      adapterPath: support.adapter,
      sandboxAdapterPath: '/agent/adapter.js',
      executablePath: support.executable,
      sandboxExecutablePath: '/agent/client',
      environment: { CLIENT_PATH: '/agent/client' },
    } as const
    const ordinary = await createPrivateAcpAgentProvider(base)
    const nested = await createPrivateAcpAgentProvider({
      ...base,
      nestedUserNamespaces: true,
    })

    expect(privateAcpAgentRuntime(ordinary).nestedUserNamespaces).toBe(false)
    expect(privateAcpAgentRuntime(nested).nestedUserNamespaces).toBe(true)
    expect(ordinary.digest).not.toBe(nested.digest)
  })

  test('binds and revalidates an executable ACP adapter requirement', async () => {
    const support = await files()
    await chmod(support.adapter, 0o700)
    const provider = await createPrivateAcpAgentProvider({
      client: 'test-client',
      model: 'provider/model',
      credentialMode: 'gateway',
      adapterPath: support.adapter,
      sandboxAdapterPath: '/agent/adapter.js',
      adapterExecutable: true,
      executablePath: support.executable,
      sandboxExecutablePath: '/agent/client',
      environment: { CLIENT_PATH: '/agent/client' },
    })
    await chmod(support.adapter, 0o600)
    await expect(revalidatePrivateAcpAgentProvider(provider)).rejects.toThrow(
      'ACP adapter is unavailable',
    )
  })
})

async function provider(
  support: Awaited<ReturnType<typeof files>>,
  credential: string,
  endpoint = 'https://gateway.example/v1',
  readOnlyMounts: Parameters<typeof createPrivateAcpAgentProvider>[0]['readOnlyMounts'] = [],
) {
  return await createPrivateAcpAgentProvider({
    client: 'test-client',
    model: 'provider/model',
    credentialMode: 'gateway',
    adapterPath: support.adapter,
    sandboxAdapterPath: '/agent/adapter.js',
    executablePath: support.executable,
    sandboxExecutablePath: '/agent/client',
    environment: { CLIENT_PATH: '/agent/client' },
    configuration: [{ configId: 'model', value: 'provider/model' }],
    modeId: 'read-only',
    readOnlyMounts,
    authentication: {
      identity: { method: 'gateway', endpoint },
      clientAuthCapabilities: { _meta: { gateway: true } },
      request: {
        methodId: 'gateway',
        _meta: {
          gateway: {
            baseUrl: endpoint,
            headers: { Authorization: `Bearer ${credential}` },
          },
        },
      },
    },
  })
}

async function files(): Promise<{
  readonly root: string
  readonly adapter: string
  readonly executable: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'jig-acp-provider-'))
  temporary.add(root)
  const adapter = join(root, 'adapter.js')
  const executable = join(root, 'client')
  await writeFile(adapter, 'adapter\n')
  await writeFile(executable, 'client\n')
  await chmod(executable, 0o700)
  return { root, adapter, executable }
}
