import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, link, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { privateAcpAgentRuntime } from '../../src/internal/acp-agent-provider.js'
import {
  isExpectedAcpRefusal,
  PrivateAcpSetupError,
} from '../../src/internal/acp-setup-diagnostics.js'
import {
  createPrivateCodexOpenAIApiAgentProvider,
  createPrivateCodexSubscriptionAgentProvider,
  openPrivateCodexAgentProvider,
  PRIVATE_CODEX_DEFAULT_OPENAI_BASE_URL,
  projectPrivateCodexSubscriptionCredential,
} from '../../src/internal/codex-agent-provider.js'
import { assertPrivateFiniteAcpPublicOutput } from '../../src/internal/finite-acp-resource.js'
import {
  credentialBytes,
  credentialValue,
  encoder,
  files,
  temporary,
} from '.././codex-agent-provider.fixture.js'
import { rejectsCredentialOutput } from '../finite-acp-resource.fixture.js'

const subscriptionMetadata = {
  oauth_provenance: {
    issuer: 'https://metadata-issuer-canary.example',
    client_id: 'metadata-client-canary',
  },
  login_owner_id: 'metadata-owner-canary',
}
const sourceMetadataCases = [
  ['without metadata', {}],
  ['with OAuth provenance only', { oauth_provenance: subscriptionMetadata.oauth_provenance }],
  ['with login-owner metadata only', { login_owner_id: subscriptionMetadata.login_owner_id }],
  ['with Codex metadata', subscriptionMetadata],
  ['with null metadata', { oauth_provenance: null, login_owner_id: null }],
  [
    'with synthetic string metadata',
    {
      oauth_provenance: 'synthetic-provenance-canary',
      login_owner_id: 'synthetic-owner-canary',
    },
  ],
] as const

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
  for (const [description, metadata] of sourceMetadataCases) {
    test(`projects subscription state ${description} into the same bounded bearer`, async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-codex-metadata-')))
      temporary.add(root)
      const path = join(root, 'auth.json')
      const canonical = credentialValue('account-one', 'access-token-canary', {
        authMode: 'chatgpt',
        refreshToken: 'canonical-refresh-secret',
      })
      const source = {
        ...canonical,
        tokens: { ...canonical.tokens, id_token: 'canonical-id-secret', ...metadata },
      }
      const sourceText = JSON.stringify(source)
      await writeFile(path, sourceText, { mode: 0o600 })

      const projectedText = new TextDecoder().decode(
        await projectPrivateCodexSubscriptionCredential(path),
      )
      const projected = JSON.parse(projectedText)
      expect(projected).toEqual({
        OPENAI_API_KEY: null,
        auth_mode: 'chatgptAuthTokens',
        last_refresh: expect.any(String),
        tokens: {
          access_token: canonical.tokens.access_token,
          account_id: canonical.tokens.account_id,
          id_token: canonical.tokens.access_token,
          refresh_token: '',
        },
      })
      expect(Number.isFinite(Date.parse(projected.last_refresh))).toBe(true)
      for (const privateValue of [
        'canonical-refresh-secret',
        'canonical-id-secret',
        'metadata-issuer-canary',
        'metadata-client-canary',
        'metadata-owner-canary',
        'synthetic-provenance-canary',
        'synthetic-owner-canary',
      ]) {
        expect(projectedText).not.toContain(privateValue)
      }
      expect(await readFile(path, 'utf8')).toBe(sourceText)
    })
  }
  for (const location of ['source', 'tokens'] as const) {
    test(`rejects an unknown ${location} field with a private layout diagnostic`, async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-codex-layout-')))
      temporary.add(root)
      const path = join(root, 'auth.json')
      const canonical = credentialValue('account-one', 'access-token-canary', {
        authMode: 'chatgpt',
        refreshToken: 'canonical-refresh-secret',
      })
      const source = {
        ...canonical,
        tokens: { ...canonical.tokens, ...subscriptionMetadata },
      }
      const unsupported = { 'private-field-canary': 'private-value-canary' }
      const sourceText = JSON.stringify(
        location === 'source'
          ? { ...source, ...unsupported }
          : { ...source, tokens: { ...source.tokens, ...unsupported } },
      )
      await writeFile(path, sourceText, { mode: 0o600 })

      const failure = await projectPrivateCodexSubscriptionCredential(path).then(
        () => {
          throw new Error('An unsupported credential layout was accepted')
        },
        (error: unknown) => error,
      )
      expect(failure).toBeInstanceOf(PrivateAcpSetupError)
      expect(failure).toMatchObject({ stage: 'login-layout' })
      expect(isExpectedAcpRefusal(failure)).toBe(false)
      for (const privateValue of [
        path,
        canonical.tokens.access_token,
        'canonical-refresh-secret',
        'private-field-canary',
        'private-value-canary',
      ]) {
        expect(String(failure)).not.toContain(privateValue)
        expect(JSON.stringify(failure)).not.toContain(privateValue)
      }
      expect(await readFile(path, 'utf8')).toBe(sourceText)
    })
  }
  for (const invalid of ['expired', 'near-expiry', 'account-mismatch'] as const) {
    test(`rejects ${invalid} subscription state despite recognized metadata`, async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-codex-invalid-')))
      temporary.add(root)
      const path = join(root, 'auth.json')
      const canonical = credentialValue('account-one', 'access-token-canary', {
        authMode: 'chatgpt',
        refreshToken: 'canonical-refresh-secret',
        ...(invalid === 'expired' ? { expiresAt: Date.now() - 60_000 } : {}),
        ...(invalid === 'near-expiry' ? { expiresAt: Date.now() + 60_000 } : {}),
        ...(invalid === 'account-mismatch' ? { claimAccountId: 'other-account' } : {}),
      })
      await writeFile(
        path,
        JSON.stringify({
          ...canonical,
          tokens: { ...canonical.tokens, ...subscriptionMetadata },
        }),
        { mode: 0o600 },
      )

      await expect(projectPrivateCodexSubscriptionCredential(path)).rejects.toThrow(
        'Codex subscription credential is invalid',
      )
    })
  }
  for (const field of ['access_token', 'account_id', 'id_token', 'refresh_token'] as const) {
    test(`requires ${field} even when subscription metadata is present`, async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-codex-required-')))
      temporary.add(root)
      const path = join(root, 'auth.json')
      const source = credentialValue('account-one', 'access-token-canary', {
        authMode: 'chatgpt',
      })
      const tokens: Record<string, unknown> = { ...source.tokens, ...subscriptionMetadata }
      delete tokens[field]
      await writeFile(path, JSON.stringify({ ...source, tokens }), { mode: 0o600 })

      await expect(projectPrivateCodexSubscriptionCredential(path)).rejects.toThrow(
        'Codex subscription credential is invalid',
      )
    })
  }
  for (const invalid of [
    'group-readable',
    'world-readable',
    'symbolic-link',
    'hard-link',
    'oversized',
  ] as const) {
    test(`rejects a ${invalid} subscription file with recognized metadata`, async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-codex-private-')))
      temporary.add(root)
      const path = join(root, 'auth.json')
      const source = credentialValue('account-one', 'access-token-canary', {
        authMode: 'chatgpt',
      })
      const sourceText = JSON.stringify({
        ...source,
        tokens: { ...source.tokens, ...subscriptionMetadata },
      })
      await writeFile(path, sourceText, { mode: 0o600 })
      let selectedPath = path
      if (invalid === 'group-readable') await chmod(path, 0o640)
      if (invalid === 'world-readable') await chmod(path, 0o604)
      if (invalid === 'symbolic-link') {
        selectedPath = join(root, 'linked-auth.json')
        await symlink(path, selectedPath)
      }
      if (invalid === 'hard-link') await link(path, join(root, 'hardlinked-auth.json'))
      if (invalid === 'oversized') await writeFile(path, sourceText.padEnd(64 * 1024))

      await expect(projectPrivateCodexSubscriptionCredential(selectedPath)).rejects.toThrow(
        'Codex subscription credential is invalid',
      )
    })
  }
  for (const [description, metadata] of sourceMetadataCases.slice(1)) {
    test(`rejects an in-memory subscription projection ${description}`, async () => {
      const support = await files()
      const credential = credentialValue('account-one', 'access-token-canary')
      await expect(
        createPrivateCodexSubscriptionAgentProvider({
          ...support,
          credential: encoder.encode(
            JSON.stringify({
              ...credential,
              tokens: { ...credential.tokens, ...metadata },
            }),
          ),
        }),
      ).rejects.toThrow('Codex subscription credential is invalid')
    })
  }
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
    await rejectsCredentialOutput(
      runtime,
      JSON.parse(new TextDecoder().decode(originalCredential)).tokens.access_token,
    )
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
  test('matches only nonempty subscription tokens without rejecting account IDs', async () => {
    const support = await files()
    const credential = credentialValue('a', 'secret-one')
    const selected = await createPrivateCodexSubscriptionAgentProvider({
      ...support,
      credential: encoder.encode(JSON.stringify(credential)),
    })
    const patterns = privateAcpAgentRuntime(selected).secretBytes()
    try {
      const values = patterns.map((bytes) => new TextDecoder().decode(bytes))
      expect(values).toContain(credential.tokens.access_token)
      expect(values).toContain(credential.tokens.id_token)
      expect(values).not.toContain(credential.tokens.account_id)
      expect(values).not.toContain('')
      expect(() =>
        assertPrivateFiniteAcpPublicOutput({ text: 'ordinary answer', accountId: 'a' }, patterns),
      ).not.toThrow()
      expect(() =>
        assertPrivateFiniteAcpPublicOutput({ text: credential.tokens.access_token }, patterns),
      ).toThrow('Native ACP output contained a private credential')
    } finally {
      for (const pattern of patterns) pattern.fill(0)
    }
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
    await rejectsCredentialOutput(runtime, 'first-secret')
    const nativeConfiguration = JSON.parse(runtime.environment.CODEX_CONFIG ?? '{}')
    expect(nativeConfiguration.model_provider).toBe('custom-gateway')
    expect(nativeConfiguration.model_providers).toEqual({
      'custom-gateway': {
        name: 'OpenAI Responses-compatible endpoint',
        base_url: 'https://gateway.example/v1',
        wire_api: 'responses',
      },
    })

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
  test('rejects short raw API credentials and accepts the eight-byte boundary', async () => {
    const support = await files()
    for (const apiKey of ['a', 'aa', 'aaa', 'aaaa', 'aaaaa', 'aaaaaa', 'aaaaaaa', 'ééé']) {
      await expect(
        createPrivateCodexOpenAIApiAgentProvider({
          ...support,
          apiKey,
          model: 'provider/test-model',
        }),
      ).rejects.toThrow('ACP Agent output credential is invalid')
    }
    for (const apiKey of ['12345678', 'éééé']) {
      const selected = await createPrivateCodexOpenAIApiAgentProvider({
        ...support,
        apiKey,
        model: 'provider/test-model',
      })
      const runtime = privateAcpAgentRuntime(selected)
      rejectsCredentialOutput(runtime, apiKey)
    }
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
