import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  privateAcpAgentRuntime,
  revalidatePrivateAcpAgentProvider,
} from '../src/internal/acp-agent-provider.js'
import {
  createPrivateCodexOpenAIApiAgentProvider,
  createPrivateCodexSubscriptionAgentProvider,
  openPrivateCodexAgentProvider,
  PRIVATE_CODEX_DEFAULT_OPENAI_BASE_URL,
  PRIVATE_CODEX_REQUIREMENTS,
  PrivateCodexExecutableUnavailableError,
  PrivateCodexLoginUnavailableError,
  PrivateCodexSandboxUnavailableError,
  projectPrivateCodexSubscriptionCredential,
} from '../src/internal/codex-agent-provider.js'
import { openPrivateInstalledBunHost } from '../src/internal/installed-bun-host.js'
import { selectPrivateAcpResources } from '../src/internal/private-acp-resources.js'
import {
  FINITE_ACP_CONTRACT_DIGEST,
  FINITE_ACP_CONTRACT_ID,
  FINITE_ACP_CONTRACT_VERSION,
} from '../src/internal/private-finite-acp-contract.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

import { nativeElf } from './fixtures/native-elf.js'

const temporary = new Set<string>()
const encoder = new TextEncoder()
const linuxTest = process.platform === 'linux' ? test : test.skip
afterEach(async () => {
  await Promise.all([...temporary].map((path) => rm(path, { recursive: true, force: true })))
  temporary.clear()
})

describe('private native Codex Agent provider', () => {
  linuxTest(
    'an unsupported wrapper retains its actionable stage without exposing wrapper contents',
    async () => {
      const fixture = await files('/var/tmp')
      await writeFile(
        fixture.executablePath,
        nativeElf({
          wrapper: `makeCWrapper '/unavailable/native' --set 'PRIVATE_TOKEN' 'secret-canary'\n\n`,
        }),
        { mode: 0o700 },
      )
      const host = await openPrivateInstalledBunHost(installedBunLocation, {
        CODEX_PATH: fixture.executablePath,
        OPENAI_API_KEY: 'test-secret',
        OPENAI_MODEL: 'test-model',
      })
      try {
        await selectCodex(host)
        throw new Error('Unsupported wrapper unexpectedly qualified')
      } catch (error) {
        expect(error).toMatchObject({ code: 'PROJECT_ACP_CODEX_WRAPPER' })
        expect(String(error)).not.toContain('secret-canary')
        expect(String(error)).not.toContain('test-secret')
      }
    },
  )

  linuxTest(
    'uses operator Bubblewrap without a bundled directory and rejects later replacement',
    async () => {
      const fixture = await files()
      const project = join(fixture.root, 'project')
      const tools = join(fixture.root, 'tools')
      await mkdir(project)
      await mkdir(tools)
      const helper = join(tools, 'bwrap')
      await writeFile(helper, nativeElf(), { mode: 0o700 })
      await writeFile(join(project, 'bwrap'), nativeElf(), { mode: 0o700 })
      await rm(fixture.nativeBubblewrapPath)
      const provider = await openPrivateCodexAgentProvider(
        installedBunLocation.releaseRoot,
        {
          CODEX_PATH: fixture.executablePath,
          PATH: `${project}:${tools}`,
          JIG_BWRAP_PATH: '/unrelated-outer-helper',
          OPENAI_API_KEY: 'test-key',
          OPENAI_MODEL: 'test-model',
        },
        project,
      )
      const runtime = privateAcpAgentRuntime(provider)
      expect(runtime.environment.PATH).toBe(tools)
      expect(runtime.readOnlyMounts).toContainEqual({ source: helper, destination: helper })
      expect(
        runtime.readOnlyMounts.some((mount) => mount.destination.includes('codex-resources')),
      ).toBe(false)
      await revalidatePrivateAcpAgentProvider(provider)
      await writeFile(helper, nativeElf({ search: '' }))
      await expect(revalidatePrivateAcpAgentProvider(provider)).rejects.toThrow('support changed')
    },
  )

  linuxTest(
    'retains the wrapped executable and libraries, selecting the wrapper helper before operator PATH',
    async () => {
      const fixture = await files()
      const wrapped = join(dirname(fixture.executablePath), '.codex-wrapped')
      const library = join(fixture.root, 'runtime.so')
      const tools = join(fixture.root, 'tools')
      await mkdir(tools)
      const helper = join(tools, 'bwrap')
      await writeFile(helper, nativeElf(), { mode: 0o700 })
      await writeFile(library, nativeElf())
      await writeFile(wrapped, nativeElf({ needed: [library] }), { mode: 0o700 })
      await writeFile(
        fixture.executablePath,
        nativeElf({
          wrapper: `makeCWrapper '${wrapped}' \\\n    --inherit-argv0 \\\n    --prefix 'PATH' ':' '${tools}'\n\n`,
        }),
      )
      const environment = {
        CODEX_PATH: fixture.executablePath,
        PATH: dirname(fixture.nativeBubblewrapPath),
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'test-model',
      }
      const provider = await openPrivateCodexAgentProvider(
        installedBunLocation.releaseRoot,
        environment,
      )
      const runtime = privateAcpAgentRuntime(provider)
      expect(runtime.environment.PATH).toBe(tools)
      for (const path of [wrapped, library, helper]) {
        expect(runtime.readOnlyMounts).toContainEqual({ source: path, destination: path })
      }
      await revalidatePrivateAcpAgentProvider(provider)
      await writeFile(library, nativeElf({ search: '' }))
      await expect(revalidatePrivateAcpAgentProvider(provider)).rejects.toThrow('support changed')
      const replacement = await openPrivateCodexAgentProvider(
        installedBunLocation.releaseRoot,
        environment,
      )
      expect(replacement.digest).not.toBe(provider.digest)
      await writeFile(wrapped, nativeElf({ search: '' }))
      await expect(revalidatePrivateAcpAgentProvider(replacement)).rejects.toThrow(
        'support changed',
      )
    },
  )

  linuxTest(
    'opens a PATH-selected client and retains its identity across PATH changes',
    async () => {
      // Resource admission rejects /tmp: that destination belongs to the payload.
      // Use a normal Linux host installation location for this successful selection.
      const fixture = await files('/var/tmp')
      const environment = {
        PATH: dirname(fixture.executablePath),
        OPENAI_API_KEY: 'test-secret',
        OPENAI_MODEL: 'test-model',
      }
      const pending = openPrivateInstalledBunHost(installedBunLocation, environment)
      environment.PATH = '/missing-after-snapshot'
      const host = await pending
      const provider = await selectCodex(host)
      expect(privateAcpAgentRuntime(provider).executablePath).toBe(fixture.executablePath)
      await revalidatePrivateAcpAgentProvider(provider)
      await writeFile(fixture.executablePath, 'replacement executable', { mode: 0o700 })
      await expect(revalidatePrivateAcpAgentProvider(provider)).rejects.toThrow()
      const rejected = await openPrivateInstalledBunHost(
        installedBunLocation,
        {
          ...environment,
          PATH: dirname(fixture.executablePath),
        },
        fixture.root,
      )
      await expect(selectCodex(rejected)).rejects.toThrow('selected codex runtime')
    },
  )

  linuxTest('a PATH-selected installation with missing support does not fall back', async () => {
    const first = await files()
    const second = await files()
    await rm(first.nativeBubblewrapPath)
    await expect(
      openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
        PATH: `${dirname(first.executablePath)}:${dirname(second.executablePath)}`,
        OPENAI_API_KEY: 'test-secret',
        OPENAI_MODEL: 'test-model',
      }),
    ).rejects.toThrow(PrivateCodexSandboxUnavailableError)
  })

  linuxTest('selects the Codex subscription by default and an explicit Responses API', async () => {
    const fixture = await files()
    const codexHome = join(fixture.root, 'canonical-home')
    await mkdir(codexHome)
    await writeFile(
      join(codexHome, 'auth.json'),
      JSON.stringify(
        credentialValue('account-one', 'subscription-secret', {
          authMode: 'chatgpt',
          refreshToken: 'canonical-refresh-secret',
        }),
      ),
      { mode: 0o600 },
    )

    const subscription = await openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
      CODEX_HOME: codexHome,
      CODEX_PATH: fixture.executablePath,
    })
    const pinnedSubscription = await openPrivateCodexAgentProvider(
      installedBunLocation.releaseRoot,
      {
        CODEX_HOME: codexHome,
        CODEX_PATH: fixture.executablePath,
        CODEX_MODEL: 'gpt-5.3-codex-spark',
      },
    )
    const gateway = await openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
      CODEX_HOME: join(fixture.root, 'missing-home'),
      CODEX_PATH: fixture.executablePath,
      OPENAI_API: 'responses',
      OPENAI_API_KEY: 'gateway-secret',
      OPENAI_BASE_URL: 'https://gateway.example/v1',
      OPENAI_MODEL: 'provider/test-model',
    })

    expect(subscription).toMatchObject({
      client: 'openai-codex',
      credentialMode: 'openai-subscription',
      model: 'client-default',
    })
    expect(pinnedSubscription.model).toBe('gpt-5.3-codex-spark')
    const selectedSubscription = await openPrivateCodexAgentProvider(
      installedBunLocation.releaseRoot,
      {
        CODEX_HOME: codexHome,
        CODEX_PATH: fixture.executablePath,
        CODEX_MODEL: 'ambient',
      },
      undefined,
      'binding-model',
    )
    expect(selectedSubscription).toMatchObject({
      model: 'binding-model',
      credentialMode: 'openai-subscription',
    })
    const selectedApi = await openPrivateCodexAgentProvider(
      installedBunLocation.releaseRoot,
      {
        CODEX_PATH: fixture.executablePath,
        OPENAI_API_KEY: 'gateway-secret',
      },
      undefined,
      'binding-model',
    )
    expect(selectedApi).toMatchObject({
      model: 'binding-model',
      credentialMode: 'openai-responses-api-key',
    })
    for (const model of ['bad model', 'model\n']) {
      await expect(
        openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
          CODEX_HOME: codexHome,
          CODEX_PATH: fixture.executablePath,
          CODEX_MODEL: model,
        }),
      ).rejects.toMatchObject({ stage: 'model' })
      await expect(
        openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
          CODEX_PATH: fixture.executablePath,
          OPENAI_API_KEY: 'api-secret',
          OPENAI_MODEL: model,
        }),
      ).rejects.toMatchObject({ stage: 'model' })
    }
    expect(gateway).toMatchObject({
      client: 'openai-codex',
      credentialMode: 'openai-responses-api-key',
      model: 'provider/test-model',
    })
    await expect(
      openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
        CODEX_PATH: fixture.executablePath,
        OPENAI_MODEL: 'provider/test-model',
      }),
    ).rejects.toMatchObject({ stage: 'api' })
    await expect(
      openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
        CODEX_PATH: fixture.executablePath,
        OPENAI_API: 'chat-completions',
        OPENAI_API_KEY: 'gateway-secret',
        OPENAI_MODEL: 'provider/test-model',
      }),
    ).rejects.toMatchObject({ stage: 'api' })
    await expect(
      openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
        CODEX_HOME: join(fixture.root, 'missing-home'),
        CODEX_PATH: fixture.executablePath,
      }),
    ).rejects.toBeInstanceOf(PrivateCodexLoginUnavailableError)
    const unavailable = await openPrivateInstalledBunHost(installedBunLocation, {
      CODEX_HOME: join(fixture.root, 'missing-home'),
      CODEX_PATH: fixture.executablePath,
    })
    await expect(selectCodex(unavailable)).rejects.toThrow('selected codex runtime')
    await expect(
      openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
        CODEX_PATH: join(fixture.root, 'missing-codex'),
      }),
    ).rejects.toBeInstanceOf(PrivateCodexExecutableUnavailableError)
    const missingExecutable = await openPrivateInstalledBunHost(installedBunLocation, {
      CODEX_PATH: join(fixture.root, 'missing-codex'),
    })
    await expect(selectCodex(missingExecutable)).rejects.toThrow('selected codex runtime')
    await rename(fixture.nativeBubblewrapPath, join(fixture.root, 'outer-bwrap'))
    const missingSandbox = await openPrivateInstalledBunHost(installedBunLocation, {
      CODEX_HOME: codexHome,
      CODEX_PATH: fixture.executablePath,
      JIG_BWRAP_PATH: join(fixture.root, 'outer-bwrap'),
    })
    await expect(selectCodex(missingSandbox)).rejects.toThrow('selected codex runtime')
  })

  linuxTest(
    'resolves a Codex link and preserves its bundled helper despite outer overrides',
    async () => {
      const fixture = await files()
      const codexHome = join(fixture.root, 'linked-home')
      const codexLink = join(fixture.root, 'codex')
      await mkdir(codexHome)
      await symlink(fixture.executablePath, codexLink)
      await writeFile(
        join(codexHome, 'auth.json'),
        JSON.stringify(
          credentialValue('account-one', 'subscription-secret', {
            authMode: 'chatgpt',
            refreshToken: 'canonical-refresh-secret',
          }),
        ),
        { mode: 0o600 },
      )

      const environment = {
        CODEX_HOME: codexHome,
        CODEX_PATH: codexLink,
      }
      const provider = await openPrivateCodexAgentProvider(
        installedBunLocation.releaseRoot,
        environment,
      )
      const outerBubblewrap = join(fixture.root, 'outer-bwrap')
      await writeFile(outerBubblewrap, 'unrelated outer helper\n', { mode: 0o700 })
      const misleadingResources = join(fixture.root, 'native', 'bin', 'codex-resources')
      await mkdir(misleadingResources)
      await writeFile(join(misleadingResources, 'bwrap'), 'not the package helper\n', {
        mode: 0o700,
      })
      for (const override of [outerBubblewrap, join(fixture.root, 'missing-bwrap'), 'relative']) {
        const selected = await openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
          ...environment,
          JIG_BWRAP_PATH: override,
        })
        expect(selected.digest).toBe(provider.digest)
      }
      const runtime = privateAcpAgentRuntime(provider)
      expect(provider).toMatchObject({
        client: 'openai-codex',
        credentialMode: 'openai-subscription',
      })
      expect(runtime.executablePath).toBe(fixture.executablePath)
      expect(runtime.readOnlyMounts).toContainEqual({
        source: fixture.nativeBubblewrapPath,
        destination: fixture.nativeBubblewrapPath,
      })
      await revalidatePrivateAcpAgentProvider(provider)
      await writeFile(fixture.nativeBubblewrapPath, nativeElf({ search: '' }))
      await expect(revalidatePrivateAcpAgentProvider(provider)).rejects.toThrow(
        'ACP Agent support changed after selection',
      )
      const changed = await openPrivateCodexAgentProvider(
        installedBunLocation.releaseRoot,
        environment,
      )
      expect(changed.digest).not.toBe(provider.digest)
    },
  )

  linuxTest('supports the bundled resource beside a standalone Codex executable', async () => {
    const fixture = await files()
    const executablePath = join(fixture.root, 'native', 'codex')
    await rename(fixture.executablePath, executablePath)
    const provider = await openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
      CODEX_PATH: executablePath,
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'test-model',
    })
    expect(privateAcpAgentRuntime(provider).readOnlyMounts).toContainEqual({
      source: fixture.nativeBubblewrapPath,
      destination: fixture.nativeBubblewrapPath,
    })
    expect(privateAcpAgentRuntime(provider).environment.PATH).toBe('/agent')
  })

  linuxTest.each(['missing', 'symlink', 'directory', 'non-executable'])(
    'rejects a %s bundled helper without using the outer Bubblewrap override',
    async (kind) => {
      const fixture = await files()
      const outerBubblewrap = join(fixture.root, 'outer-bwrap')
      await rename(fixture.nativeBubblewrapPath, outerBubblewrap)
      if (kind === 'symlink') await symlink(outerBubblewrap, fixture.nativeBubblewrapPath)
      else if (kind === 'directory') await mkdir(fixture.nativeBubblewrapPath)
      else if (kind !== 'missing') {
        await writeFile(fixture.nativeBubblewrapPath, 'bundled helper\n')
        await chmod(fixture.nativeBubblewrapPath, 0o600)
      }
      await expect(
        openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
          CODEX_PATH: fixture.executablePath,
          JIG_BWRAP_PATH: outerBubblewrap,
          OPENAI_API_KEY: 'test-key',
          OPENAI_MODEL: 'test-model',
        }),
      ).rejects.toBeInstanceOf(PrivateCodexSandboxUnavailableError)
    },
  )

  linuxTest('does not fall back when the preferred bundled resource is malformed', async () => {
    const fixture = await files()
    await chmod(fixture.nativeBubblewrapPath, 0o600)
    const alternative = join(fixture.root, 'native', 'bin', 'codex-resources')
    await mkdir(alternative)
    await writeFile(join(alternative, 'bwrap'), 'alternate helper\n', { mode: 0o700 })
    await expect(
      openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
        CODEX_PATH: fixture.executablePath,
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'test-model',
      }),
    ).rejects.toBeInstanceOf(PrivateCodexSandboxUnavailableError)
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
    const now = Date.now()
    const provider = await createPrivateCodexSubscriptionAgentProvider({
      ...support,
      credential: encoder.encode(
        JSON.stringify(
          credentialValue('account', 'secret', {
            expiresAt: now + 6 * 60_000,
          }),
        ),
      ),
    })
    const runtime = privateAcpAgentRuntime(provider)
    const originalNow = Date.now
    try {
      Date.now = () => now + 2 * 60_000
      expect(() => runtime.startupInput!()).toThrow('subscription credential is invalid')
    } finally {
      Date.now = originalNow
    }
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

async function selectCodex(host: Awaited<ReturnType<typeof openPrivateInstalledBunHost>>) {
  const resources = await selectPrivateAcpResources(
    host.acpResources,
    {
      session: {
        kind: 'native',
        native: 'finite-acp',
        contract: {
          id: FINITE_ACP_CONTRACT_ID,
          version: FINITE_ACP_CONTRACT_VERSION,
          digest: FINITE_ACP_CONTRACT_DIGEST,
        },
        grant: { kind: 'acp', client: 'codex' },
      },
    },
    host.installedBunSupport,
  )
  const provider = resources.session
  if (!provider) throw new Error('The test did not select its ACP session resource.')
  return provider
}

async function files(parent = tmpdir()): Promise<{
  readonly root: string
  readonly launcherPath: string
  readonly adapterPath: string
  readonly executablePath: string
  readonly nativeBubblewrapPath: string
  readonly nativeBubblewrapSource: 'bundled'
  readonly runtimeMounts: readonly []
  readonly certificatesPath: string
  readonly requirementsPath: string
}> {
  const root = await realpath(await mkdtemp(join(parent, 'jig-codex-provider-')))
  temporary.add(root)
  const launcherPath = join(root, 'codex-agent-launcher.js')
  const adapterPath = join(root, 'codex-acp.js')
  const nativeRoot = join(root, 'native')
  const executablePath = join(nativeRoot, 'bin', 'codex')
  const nativeBubblewrapPath = join(nativeRoot, 'codex-resources', 'bwrap')
  const certificatesPath = join(root, 'ca-certificates.crt')
  const requirementsPath = join(root, 'requirements.toml')
  await Promise.all([
    mkdir(join(nativeRoot, 'bin'), { recursive: true }),
    mkdir(join(nativeRoot, 'codex-resources'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(launcherPath, 'launcher\n'),
    writeFile(adapterPath, 'adapter\n'),
    writeFile(executablePath, nativeElf(), { mode: 0o700 }),
    writeFile(nativeBubblewrapPath, nativeElf(), { mode: 0o700 }),
    writeFile(certificatesPath, 'certificates\n'),
    writeFile(requirementsPath, PRIVATE_CODEX_REQUIREMENTS),
  ])
  return {
    root,
    launcherPath,
    adapterPath,
    executablePath,
    nativeBubblewrapPath,
    nativeBubblewrapSource: 'bundled',
    runtimeMounts: [],
    certificatesPath,
    requirementsPath,
  }
}

function credentialBytes(accountId: string, secret: string): Uint8Array {
  return encoder.encode(JSON.stringify(credentialValue(accountId, secret)))
}

function credentialValue(
  accountId: string,
  secret: string,
  options: {
    readonly authMode?: string
    readonly refreshToken?: string
    readonly expiresAt?: number
    readonly claimAccountId?: string
  } = {},
) {
  const accessToken = jwt({
    exp: Math.floor((options.expiresAt ?? Date.now() + 60 * 60_000) / 1_000),
    'https://api.openai.com/auth': {
      chatgpt_account_id: options.claimAccountId ?? accountId,
    },
    marker: secret,
  })
  return {
    OPENAI_API_KEY: null,
    auth_mode: options.authMode ?? 'chatgptAuthTokens',
    last_refresh: new Date().toISOString(),
    tokens: {
      access_token: accessToken,
      account_id: accountId,
      id_token: accessToken,
      refresh_token: options.refreshToken ?? '',
    },
  }
}

function jwt(claims: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'signature',
  ].join('.')
}
