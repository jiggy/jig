import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { privateAcpAgentRuntime } from '../../src/internal/acp-agent-provider.js'
import {
  createPrivateCodexOpenAIApiAgentProvider,
  createPrivateCodexSubscriptionAgentProvider,
  openPrivateCodexAgentProvider,
  PRIVATE_CODEX_DEFAULT_OPENAI_BASE_URL,
  projectPrivateCodexSubscriptionCredential,
} from '../../src/internal/codex-agent-provider.js'
import {
  credentialBytes,
  credentialValue,
  encoder,
  files,
  temporary,
} from '.././codex-agent-provider.fixture.js'

afterEach(async () => {
  await Promise.all([...temporary].map((path) => rm(path, { recursive: true, force: true })))
  temporary.clear()
})
describe('private native Codex Agent provider', () => {
  test('Codex opening preserves a recognized tool-dispatcher wrapper refusal', async () => {
    const fixture = await files()
    const shim = join(fixture.root, 'volta-shim')
    await writeFile(shim, 'dispatcher must not execute', { mode: 0o700 })
    await rm(fixture.executablePath)
    await symlink(shim, fixture.executablePath)
    await expect(
      openPrivateCodexAgentProvider(
        fixture.root,
        { CODEX_PATH: fixture.executablePath },
        fixture.root,
      ),
    ).rejects.toMatchObject({ stage: 'wrapper' })
  })
  test('projects canonical subscription state without its refresh credential', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-codex-canonical-')))
    temporary.add(root)
    const path = join(root, 'auth.json')
    const source = credentialValue('account-one', 'secret-one', {
      authMode: 'chatgpt',
      refreshToken: 'canonical-refresh-secret',
    })
    source.tokens.id_token = 'canonical-id-secret'
    await writeFile(path, JSON.stringify(source), { mode: 0o600 })

    const projected = JSON.parse(
      new TextDecoder().decode(await projectPrivateCodexSubscriptionCredential(path)),
    )
    expect(projected.auth_mode).toBe('chatgptAuthTokens')
    expect(projected.tokens.refresh_token).toBe('')
    expect(projected.tokens.id_token).toBe(projected.tokens.access_token)
    expect(JSON.stringify(projected)).not.toContain('canonical-refresh-secret')
    expect(JSON.stringify(projected)).not.toContain('canonical-id-secret')
  })
  test('preserves the client subscription default without exposing canonical credentials', async () => {
    const support = await files()
    const credential = credentialBytes('account-one', 'secret-one')
    const originalCredential = credential.slice()
    const provider = await createPrivateCodexSubscriptionAgentProvider({
      ...support,
      credential,
    })
    credential.fill(0)
    const runtime = privateAcpAgentRuntime(provider)

    expect(provider).toMatchObject({
      client: 'openai-codex',
      model: 'client-default',
      credentialMode: 'openai-subscription',
    })
    expect(runtime.configuration).toEqual([])
    expect(runtime.modeId).toBe('read-only')
    expect(runtime.authentication).toBeUndefined()
    expect(runtime.environment).toEqual({
      HOME: '/tmp',
      CODEX_CONFIG: JSON.stringify({
        analytics: { enabled: false },
        check_for_update_on_startup: false,
        features: {
          apps: false,
          code_mode: false,
          code_mode_host: false,
          plugins: false,
          remote_plugin: false,
          tool_suggest: false,
        },
        history: { persistence: 'none' },
        log_dir: '/tmp/codex-log',
        sqlite_home: '/tmp/codex-state',
      }),
      CODEX_HOME: '/tmp/codex-home',
      CODEX_PATH: support.executablePath,
      PATH: '/agent',
      CODEX_SQLITE_HOME: '/tmp/codex-state',
      INITIAL_AGENT_MODE: 'read-only',
      JIG_CODEX_STARTUP_INPUT: 'subscription',
      NO_BROWSER: '1',
      SSL_CERT_FILE: '/etc/ssl/certs/ca-certificates.crt',
    })
    expect(runtime.readOnlyMounts).toEqual([
      { source: support.requirementsPath, destination: '/etc/codex/requirements.toml' },
      { source: support.adapterPath, destination: '/agent/codex-acp.js' },
      { source: support.nativeBubblewrapPath, destination: support.nativeBubblewrapPath },
      { source: support.certificatesPath, destination: '/etc/ssl/certs/ca-certificates.crt' },
    ])
    expect(runtime.nestedUserNamespaces).toBe(true)
    const startup = runtime.startupInput!()
    expect(new DataView(startup.buffer, startup.byteOffset, 4).getUint32(0, false)).toBe(
      originalCredential.byteLength,
    )
    expect(startup.slice(4)).toEqual(originalCredential)
    startup.fill(0)
    expect(runtime.startupInput!().slice(4)).toEqual(originalCredential)
    expect(JSON.stringify(provider)).not.toContain('secret-one')
    expect(JSON.stringify(provider)).not.toContain('account-one')
    expect(JSON.stringify(runtime.environment)).not.toContain('secret-one')
    expect(
      Object.keys(runtime.environment).some((name) =>
        /(AUTH|CREDENTIAL|KEY|SECRET|TOKEN)/i.test(name),
      ),
    ).toBe(false)
  })
  test('allows bearer rotation without changing admitted provider identity', async () => {
    const support = await files()
    const first = await createPrivateCodexSubscriptionAgentProvider({
      ...support,
      credential: credentialBytes('account-one', 'secret-one'),
    })
    const second = await createPrivateCodexSubscriptionAgentProvider({
      ...support,
      credential: credentialBytes('account-two', 'secret-two'),
    })

    expect(first.digest).toBe(second.digest)
  })
  test('rechecks bearer expiry immediately before launch', async () => {
    const support = await files()
    const usableUntil = Date.now() + 2_000
    const provider = await createPrivateCodexSubscriptionAgentProvider({
      ...support,
      credential: encoder.encode(
        JSON.stringify(
          credentialValue('account', 'secret', {
            expiresAt: usableUntil + 5 * 60_000,
          }),
        ),
      ),
    })
    const runtime = privateAcpAgentRuntime(provider)
    expect(runtime.startupInput!().byteLength).toBeGreaterThan(0)
    await delay(Math.max(0, usableUntil - Date.now() + 20))
    expect(() => runtime.startupInput!()).toThrow('subscription credential is invalid')
  })
  test('rejects canonical, refreshable, expired, and mismatched subscription credentials', async () => {
    const support = await files()
    for (const value of [
      credentialValue('account', 'secret', { authMode: 'chatgpt' }),
      credentialValue('account', 'secret', { refreshToken: 'must-not-enter-jig' }),
      credentialValue('account', 'secret', { expiresAt: Date.now() + 1_000 }),
      credentialValue('account', 'secret', { claimAccountId: 'different-account' }),
    ]) {
      await expect(
        createPrivateCodexSubscriptionAgentProvider({
          ...support,
          credential: encoder.encode(JSON.stringify(value)),
        }),
      ).rejects.toThrow('subscription credential is invalid')
    }
  })
  test('rejects malformed and oversized in-memory subscription credentials', async () => {
    const support = await files()
    await expect(
      createPrivateCodexSubscriptionAgentProvider({
        ...support,
        credential: new Uint8Array([0xff]),
      }),
    ).rejects.toThrow('subscription credential is invalid')
    await expect(
      createPrivateCodexSubscriptionAgentProvider({
        ...support,
        credential: new Uint8Array(64 * 1024),
      }),
    ).rejects.toThrow('subscription credential is invalid')
  })
  test('uses an exact Responses-compatible endpoint without naming its operator', async () => {
    const support = await files()
    const first = await createPrivateCodexOpenAIApiAgentProvider({
      ...support,
      apiKey: 'first-secret',
      baseURL: 'https://gateway.example/v1',
      model: 'provider/test-model',
    })
    const rotated = await createPrivateCodexOpenAIApiAgentProvider({
      ...support,
      apiKey: 'rotated-secret',
      baseURL: 'https://gateway.example/v1',
      model: 'provider/test-model',
    })
    const otherModel = await createPrivateCodexOpenAIApiAgentProvider({
      ...support,
      apiKey: 'first-secret',
      baseURL: 'https://gateway.example/v1',
      model: 'provider/other-model',
    })
    const otherEndpoint = await createPrivateCodexOpenAIApiAgentProvider({
      ...support,
      apiKey: 'first-secret',
      baseURL: 'https://other.example/v1',
      model: 'provider/test-model',
    })
    const defaultEndpoint = await createPrivateCodexOpenAIApiAgentProvider({
      ...support,
      apiKey: 'first-secret',
      model: 'provider/test-model',
    })
    const runtime = privateAcpAgentRuntime(first)

    expect(first).toMatchObject({
      client: 'openai-codex',
      credentialMode: 'openai-responses-api-key',
      model: 'provider/test-model',
    })
    expect(first.digest).toBe(rotated.digest)
    expect(first.digest).not.toBe(otherModel.digest)
    expect(first.digest).not.toBe(otherEndpoint.digest)
    expect(privateAcpAgentRuntime(defaultEndpoint).authentication?.identity.baseURL).toBe(
      PRIVATE_CODEX_DEFAULT_OPENAI_BASE_URL,
    )
    expect(runtime.configuration).toEqual([{ configId: 'model', value: 'provider/test-model' }])
    expect(runtime.modeId).toBe('read-only')
    expect(runtime.authentication).toEqual({
      identity: {
        method: 'api-key',
        protocol: 'openai-responses',
        baseURL: 'https://gateway.example/v1',
      },
      clientAuthCapabilities: { _meta: { gateway: true } },
      request: {
        methodId: 'gateway',
        _meta: {
          gateway: {
            baseUrl: 'https://gateway.example/v1',
            headers: { Authorization: 'Bearer first-secret' },
            providerName: 'OpenAI Responses-compatible endpoint',
          },
        },
      },
    })
    expect(runtime.readOnlyMounts).toEqual([
      { source: support.requirementsPath, destination: '/etc/codex/requirements.toml' },
      { source: support.adapterPath, destination: '/agent/codex-acp.js' },
      { source: support.nativeBubblewrapPath, destination: support.nativeBubblewrapPath },
      { source: support.certificatesPath, destination: '/etc/ssl/certs/ca-certificates.crt' },
    ])
    expect(runtime.nestedUserNamespaces).toBe(true)
    expect(runtime.startupInput).toBeUndefined()
    expect(JSON.stringify(first)).not.toContain('first-secret')
    expect(JSON.stringify(runtime.environment)).not.toContain('first-secret')
  })
  test('rejects malformed Responses API configuration', async () => {
    const support = await files()
    await expect(
      createPrivateCodexOpenAIApiAgentProvider({
        ...support,
        apiKey: ' ',
        model: 'provider/test-model',
      }),
    ).rejects.toThrow('Responses API credential is invalid')
    await expect(
      createPrivateCodexOpenAIApiAgentProvider({
        ...support,
        apiKey: 'secret',
        model: 'invalid model',
      }),
    ).rejects.toThrow('model is invalid')
    await expect(
      createPrivateCodexOpenAIApiAgentProvider({
        ...support,
        apiKey: 'secret',
        baseURL: 'http://gateway.example/v1',
        model: 'provider/test-model',
      }),
    ).rejects.toThrow('base URL is invalid')
  })
  test('requires the exact managed Codex constraints', async () => {
    const support = await files()
    await writeFile(support.requirementsPath, 'allowed_sandbox_modes = []\n')
    await expect(
      createPrivateCodexOpenAIApiAgentProvider({
        ...support,
        apiKey: 'secret',
        model: 'provider/test-model',
      }),
    ).rejects.toThrow('managed requirements are invalid')
  })
})
