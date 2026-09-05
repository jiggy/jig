import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { privateAcpAgentRuntime } from '../src/internal/acp-agent-provider.js'
import { projectPrivateClaudeCredential } from '../src/internal/claude-agent-launcher.js'
import {
  createPrivateClaudeAnthropicApiAgentProvider,
  createPrivateClaudeSubscriptionAgentProvider,
  openPrivateClaudeAgentProvider,
  PRIVATE_CLAUDE_DEFAULT_ANTHROPIC_BASE_URL,
} from '../src/internal/claude-agent-provider.js'

const temporary = new Set<string>()
afterEach(async () => {
  await Promise.all([...temporary].map((path) => rm(path, { recursive: true, force: true })))
  temporary.clear()
})

describe('private native Claude Code Agent provider', () => {
  test('selects subscription by default and an explicit Anthropic-compatible API', async () => {
    const fixture = await files()
    const subscription = await openPrivateClaudeAgentProvider(fixture.releaseRoot, {
      CLAUDE_PATH: fixture.executablePath,
      CLAUDE_CODE_OAUTH_TOKEN: 'subscription-secret',
    })
    const pinnedSubscription = await openPrivateClaudeAgentProvider(fixture.releaseRoot, {
      CLAUDE_PATH: fixture.executablePath,
      CLAUDE_CODE_OAUTH_TOKEN: 'subscription-secret',
      CLAUDE_MODEL: 'subscription/model',
    })
    const apiKey = await openPrivateClaudeAgentProvider(fixture.releaseRoot, {
      CLAUDE_PATH: fixture.executablePath,
      ANTHROPIC_API_KEY: 'api-key-secret',
      ANTHROPIC_BASE_URL: 'https://gateway.example/anthropic',
      ANTHROPIC_MODEL: 'provider/test-model',
    })
    const authToken = await openPrivateClaudeAgentProvider(fixture.releaseRoot, {
      CLAUDE_PATH: fixture.executablePath,
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: 'auth-token-secret',
      ANTHROPIC_BASE_URL: 'https://gateway.example/anthropic',
      ANTHROPIC_MODEL: 'provider/test-model',
    })

    expect(subscription).toMatchObject({
      client: 'anthropic-claude-code',
      credentialMode: 'claude-subscription',
      model: 'default',
    })
    expect(pinnedSubscription.model).toBe('subscription/model')
    expect(apiKey).toMatchObject({
      client: 'anthropic-claude-code',
      credentialMode: 'anthropic-api-key',
      model: 'provider/test-model',
    })
    expect(authToken).toMatchObject({
      client: 'anthropic-claude-code',
      credentialMode: 'anthropic-auth-token',
      model: 'provider/test-model',
    })
    expect(authToken.digest).not.toBe(apiKey.digest)
    await expect(
      openPrivateClaudeAgentProvider(fixture.releaseRoot, {
        CLAUDE_PATH: fixture.executablePath,
        ANTHROPIC_API_KEY: 'api-key-secret',
        ANTHROPIC_AUTH_TOKEN: 'auth-token-secret',
        ANTHROPIC_MODEL: 'provider/test-model',
      }),
    ).rejects.toThrow('authentication is ambiguous')
    await expect(
      openPrivateClaudeAgentProvider(fixture.releaseRoot, {
        CLAUDE_PATH: fixture.executablePath,
        ANTHROPIC_MODEL: 'provider/test-model',
      }),
    ).rejects.toThrow('API configuration is unavailable')
    await expect(
      openPrivateClaudeAgentProvider(fixture.releaseRoot, {
        CLAUDE_PATH: fixture.executablePath,
      }),
    ).rejects.toThrow('subscription credential is unavailable')
  })

  test('projects a subscription token only through bounded startup input', async () => {
    const support = await files()
    const first = await createPrivateClaudeSubscriptionAgentProvider({
      ...support,
      token: 'first-subscription-secret',
      model: 'subscription/model',
    })
    const rotated = await createPrivateClaudeSubscriptionAgentProvider({
      ...support,
      token: 'rotated-subscription-secret',
      model: 'subscription/model',
    })
    const runtime = privateAcpAgentRuntime(first)

    expect(first.digest).toBe(rotated.digest)
    expect(first).toMatchObject({
      client: 'anthropic-claude-code',
      credentialMode: 'claude-subscription',
      model: 'subscription/model',
    })
    expect(runtime.environment).toEqual(environment('subscription/model', 'subscription'))
    expect(runtime.configuration).toEqual([])
    expect(runtime.modeId).toBe('default')
    expect(runtime.sessionMeta).toEqual(sessionMeta('subscription/model'))
    expect(runtime.authentication).toBeUndefined()
    expect(runtime.nestedUserNamespaces).toBe(false)
    expect(runtime.readOnlyMounts).toEqual([
      { source: support.adapterPath, destination: '/agent/claude-agent-acp.js' },
      { source: support.certificatesPath, destination: '/etc/ssl/certs/ca-certificates.crt' },
      { source: support.runtimeLibraryPath, destination: '/jig-runtime/lib/librt.so.1' },
    ])
    const startup = runtime.startupInput!()
    expect(new DataView(startup.buffer, startup.byteOffset, 4).getUint32(0, false)).toBe(
      'first-subscription-secret'.length,
    )
    expect(new TextDecoder().decode(startup.slice(4))).toBe('first-subscription-secret')
    startup.fill(0)
    expect(new TextDecoder().decode(runtime.startupInput!().slice(4))).toBe(
      'first-subscription-secret',
    )
    expect(JSON.stringify(first)).not.toContain('secret')
    expect(JSON.stringify(runtime.environment)).not.toContain('secret')
    expect(Object.keys(runtime.environment)).not.toContain('CLAUDE_CODE_OAUTH_TOKEN')
    expect(Object.keys(runtime.environment)).not.toContain('ANTHROPIC_AUTH_TOKEN')
  })

  test('uses one exact Anthropic-compatible endpoint without naming its operator', async () => {
    const support = await files()
    const first = await createPrivateClaudeAnthropicApiAgentProvider({
      ...support,
      authentication: 'api-key',
      credential: 'first-secret',
      baseURL: 'https://gateway.example/anthropic',
      model: 'provider/test-model',
    })
    const rotated = await createPrivateClaudeAnthropicApiAgentProvider({
      ...support,
      authentication: 'api-key',
      credential: 'rotated-secret',
      baseURL: 'https://gateway.example/anthropic',
      model: 'provider/test-model',
    })
    const otherModel = await createPrivateClaudeAnthropicApiAgentProvider({
      ...support,
      authentication: 'api-key',
      credential: 'first-secret',
      baseURL: 'https://gateway.example/anthropic',
      model: 'provider/other-model',
    })
    const otherEndpoint = await createPrivateClaudeAnthropicApiAgentProvider({
      ...support,
      authentication: 'api-key',
      credential: 'first-secret',
      baseURL: 'https://other.example/anthropic',
      model: 'provider/test-model',
    })
    const runtime = privateAcpAgentRuntime(first)

    expect(first.digest).toBe(rotated.digest)
    expect(first.digest).not.toBe(otherModel.digest)
    expect(first.digest).not.toBe(otherEndpoint.digest)
    expect(first).toMatchObject({
      client: 'anthropic-claude-code',
      credentialMode: 'anthropic-api-key',
      model: 'provider/test-model',
    })
    expect(runtime.environment).toEqual(
      environment('provider/test-model', 'api-key', 'https://gateway.example/anthropic'),
    )
    expect(runtime.configuration).toEqual([])
    expect(runtime.modeId).toBe('default')
    expect(runtime.sessionMeta).toEqual(sessionMeta('provider/test-model'))
    expect(runtime.authentication).toBeUndefined()
    expect(new TextDecoder().decode(runtime.startupInput!().slice(4))).toBe('first-secret')
    expect(JSON.stringify(first)).not.toContain('first-secret')
    expect(JSON.stringify(runtime.environment)).not.toContain('first-secret')
  })

  test('makes bearer-token authentication exact without retaining its secret', async () => {
    const support = await files()
    const first = await createPrivateClaudeAnthropicApiAgentProvider({
      ...support,
      authentication: 'auth-token',
      credential: 'first-bearer-secret',
      baseURL: 'https://gateway.example/anthropic',
      model: 'provider/test-model',
    })
    const rotated = await createPrivateClaudeAnthropicApiAgentProvider({
      ...support,
      authentication: 'auth-token',
      credential: 'rotated-bearer-secret',
      baseURL: 'https://gateway.example/anthropic',
      model: 'provider/test-model',
    })
    const runtime = privateAcpAgentRuntime(first)

    expect(first.digest).toBe(rotated.digest)
    expect(first).toMatchObject({
      credentialMode: 'anthropic-auth-token',
      model: 'provider/test-model',
    })
    expect(runtime.environment).toEqual(
      environment('provider/test-model', 'auth-token', 'https://gateway.example/anthropic'),
    )
    expect(new TextDecoder().decode(runtime.startupInput!().slice(4))).toBe('first-bearer-secret')
    expect(JSON.stringify(first)).not.toContain('bearer-secret')
    expect(JSON.stringify(runtime.environment)).not.toContain('bearer-secret')
  })

  test('projects only the selected client credential and blanks a conflicting API key', () => {
    const subscription: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: 'ambient-api-key',
      ANTHROPIC_AUTH_TOKEN: 'ambient-auth-token',
    }
    projectPrivateClaudeCredential(subscription, 'subscription', 'subscription-secret')
    expect(subscription).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'subscription-secret' })

    const apiKey: Record<string, string | undefined> = {
      ANTHROPIC_AUTH_TOKEN: 'ambient-auth-token',
      CLAUDE_CODE_OAUTH_TOKEN: 'ambient-subscription-token',
    }
    projectPrivateClaudeCredential(apiKey, 'api-key', 'api-key-secret')
    expect(apiKey).toEqual({ ANTHROPIC_API_KEY: 'api-key-secret' })

    const authToken: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: 'ambient-api-key',
      CLAUDE_CODE_OAUTH_TOKEN: 'ambient-subscription-token',
    }
    projectPrivateClaudeCredential(authToken, 'auth-token', 'auth-token-secret')
    expect(authToken).toEqual({
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: 'auth-token-secret',
    })
  })

  test('rejects malformed credentials and models', async () => {
    const support = await files()
    for (const token of ['', ' padded ', 'bad\0token', 'x'.repeat(16 * 1024 + 1)]) {
      await expect(
        createPrivateClaudeSubscriptionAgentProvider({
          ...support,
          token,
        }),
      ).rejects.toThrow('subscription credential is invalid')
    }
    await expect(
      createPrivateClaudeAnthropicApiAgentProvider({
        ...support,
        authentication: 'api-key',
        credential: ' ',
        model: 'provider/test-model',
      }),
    ).rejects.toThrow('API credential is invalid')
    await expect(
      createPrivateClaudeAnthropicApiAgentProvider({
        ...support,
        authentication: 'api-key',
        credential: 'secret',
        model: 'invalid model',
      }),
    ).rejects.toThrow('model is invalid')
    await expect(
      createPrivateClaudeAnthropicApiAgentProvider({
        ...support,
        authentication: 'api-key',
        credential: 'secret',
        baseURL: 'http://gateway.example/anthropic',
        model: 'provider/test-model',
      }),
    ).rejects.toThrow('base URL is invalid')
    await expect(
      createPrivateClaudeAnthropicApiAgentProvider({
        ...support,
        authentication: 'invented' as 'api-key',
        credential: 'secret',
        model: 'provider/test-model',
      }),
    ).rejects.toThrow('authentication is invalid')
  })
})

function environment(
  model: string,
  credential: 'subscription' | 'api-key' | 'auth-token',
  baseURL?: string,
) {
  return {
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ...(credential === 'subscription'
      ? {}
      : {
          ANTHROPIC_BASE_URL: baseURL ?? PRIVATE_CLAUDE_DEFAULT_ANTHROPIC_BASE_URL,
        }),
    ANTHROPIC_MODEL: model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
    CLAUDE_CODE_DISABLE_THINKING: '1',
    CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
    CLAUDE_CODE_EXECUTABLE: '/agent/claude',
    CLAUDE_CODE_MAX_RETRIES: '0',
    CLAUDE_CODE_SUBAGENT_MODEL: model,
    CLAUDE_CONFIG_DIR: '/tmp/claude-config',
    CLAUDE_MODEL_CONFIG: JSON.stringify({ availableModels: [model] }),
    HOME: '/tmp/claude-home',
    JIG_CLAUDE_STARTUP_INPUT: credential,
    NO_BROWSER: '1',
    SSL_CERT_FILE: '/etc/ssl/certs/ca-certificates.crt',
  }
}

function sessionMeta(model: string) {
  return {
    claudeCode: {
      options: {
        model,
        persistSession: false,
        settingSources: [],
        skills: [],
        tools: [],
      },
    },
  }
}

async function files(): Promise<{
  readonly releaseRoot: string
  readonly launcherPath: string
  readonly adapterPath: string
  readonly executablePath: string
  readonly certificatesPath: string
  readonly runtimeLibraryPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'jig-claude-provider-'))
  temporary.add(root)
  const releaseRoot = join(root, 'release')
  const agentRoot = join(releaseRoot, 'libexec', 'agent')
  const launcherPath = join(agentRoot, 'claude-agent-launcher.js')
  const adapterPath = join(agentRoot, 'claude-agent-acp.js')
  const executablePath = join(root, 'claude')
  const certificatesPath = await realHostCertificates()
  const runtimeLibraryPath = await realClaudeRuntimeLibrary()
  await mkdir(agentRoot, { recursive: true })
  await Promise.all([
    writeFile(launcherPath, 'launcher\n'),
    writeFile(adapterPath, 'adapter\n'),
    writeFile(executablePath, 'claude\n', { mode: 0o700 }),
  ])
  return {
    releaseRoot,
    launcherPath,
    adapterPath,
    executablePath,
    certificatesPath,
    runtimeLibraryPath,
  }
}

async function realHostCertificates(): Promise<string> {
  return await realpath('/etc/ssl/certs/ca-certificates.crt')
}

async function realClaudeRuntimeLibrary(): Promise<string> {
  return join(dirname(await realpath('/lib64/ld-linux-x86-64.so.2')), 'librt.so.1')
}
