import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  privateAcpAgentRuntime,
  revalidatePrivateAcpAgentProvider,
} from '../../src/internal/acp-agent-provider.js'
import {
  openPrivateCodexAgentProvider,
  PrivateCodexExecutableUnavailableError,
  PrivateCodexLoginUnavailableError,
  PrivateCodexSandboxUnavailableError,
} from '../../src/internal/codex-agent-provider.js'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import {
  credentialValue,
  files,
  selectCodex,
  temporary,
} from '.././codex-agent-provider.fixture.js'
import { installedBunLocation } from '.././fixtures/installed-bun-location.js'
import { nativeElf } from '.././fixtures/native-elf.js'

afterEach(async () => {
  await Promise.all([...temporary].map((path) => rm(path, { recursive: true, force: true })))
  temporary.clear()
})
describe('private native Codex Agent provider', () => {
  test('an unsupported wrapper retains its actionable stage without exposing wrapper contents', async () => {
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
  })
  test('uses operator Bubblewrap without a bundled directory and rejects later replacement', async () => {
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
  })
  test('retains the wrapped executable and libraries, selecting the wrapper helper before operator PATH', async () => {
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
    await expect(revalidatePrivateAcpAgentProvider(replacement)).rejects.toThrow('support changed')
  })
  test('opens a PATH-selected client and retains its identity across PATH changes', async () => {
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
  })
  test('a PATH-selected installation with missing support does not fall back', async () => {
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
  for (const [suiteCaseIndex, suiteCaseValue] of ['path', 'bundled'].entries()) {
    test(
      '%s helper inspection failure retains the sandbox cause' + ` (case ${suiteCaseIndex + 1})`,
      () =>
        Reflect.apply(
          async (selection) => {
            const fixture = await files('/var/tmp')
            const tools = join(fixture.root, 'tools')
            await mkdir(tools)
            const helper =
              selection === 'path' ? join(tools, 'bwrap') : fixture.nativeBubblewrapPath
            // An executable file can pass discovery while failing non-executing ELF inspection.
            await writeFile(helper, 'private-helper-canary invalid ELF', { mode: 0o700 })
            const host = await openPrivateInstalledBunHost(installedBunLocation, {
              CODEX_PATH: fixture.executablePath,
              PATH: selection === 'path' ? tools : '',
              OPENAI_API_KEY: 'private-key-canary',
              OPENAI_MODEL: 'test-model',
            })
            try {
              await selectCodex(host)
              throw new Error('Malformed helper unexpectedly qualified')
            } catch (error) {
              expect(error).toMatchObject({ code: 'PROJECT_ACP_CODEX_SANDBOX' })
              expect(String(error)).not.toContain(helper)
              expect(String(error)).not.toContain('private-helper-canary')
              expect(String(error)).not.toContain('private-key-canary')
            }
          },
          undefined,
          Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
        ),
    )
  }
  test('selects the Codex subscription by default and an explicit Responses API', async () => {
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
  test('resolves a Codex link and preserves its bundled helper despite outer overrides', async () => {
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
  })
  test('supports the bundled resource beside a standalone Codex executable', async () => {
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
  for (const [suiteCaseIndex, suiteCaseValue] of [
    'missing',
    'symlink',
    'directory',
    'non-executable',
  ].entries()) {
    test(
      'rejects a %s bundled helper without using the outer Bubblewrap override' +
        ` (case ${suiteCaseIndex + 1})`,
      () =>
        Reflect.apply(
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
          undefined,
          Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
        ),
    )
  }
  test('does not fall back when the preferred bundled resource is malformed', async () => {
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
})

if (process.platform !== 'linux') throw Error('This suite requires Linux')
