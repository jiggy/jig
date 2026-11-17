import { expect, test } from 'bun:test'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  privateAcpAgentRuntime,
  revalidatePrivateAcpAgentProvider,
} from '../../src/internal/acp-agent-provider.js'
import { openPrivateClaudeAgentProvider } from '../../src/internal/claude-agent-provider.js'
import { openPrivateCodexAgentProvider } from '../../src/internal/codex-agent-provider.js'
import {
  privateExecutionFileProjections,
  privateExecutionPath,
} from '../../src/internal/execution-intent.js'
import { privateMacosExecutionPlan } from '../../src/internal/execution-plan.js'
import { openPrivateInstalledBunSupport } from '../../src/internal/installed-bun-support.js'
import {
  privateLinuxHostToolCandidates,
  resolvePrivateLinuxHostPath,
} from '../../src/internal/linux-host-paths.js'
import { PrivateMacosBackend } from '../../src/internal/macos-native-backend.js'
import { installedBunLocation } from '.././fixtures/installed-bun-location.js'

type NativeRequest = (
  id: number,
  method: string,
  params: unknown,
) => Promise<Record<string, unknown>>

async function withMacosNativeClient(
  runtime: ReturnType<typeof privateAcpAgentRuntime>,
  support: Awaited<ReturnType<typeof openPrivateInstalledBunSupport>>,
  exercise: (request: NativeRequest, cwd: string) => Promise<void>,
): Promise<void> {
  if (support.launcherPath === null) throw new Error('native macOS launcher is missing')
  const backend = new PrivateMacosBackend({
    bunPath: support.executablePath,
    supervisorPath: support.supervisorPath,
    launcherPath: support.launcherPath,
  })
  let cwd = ''
  const component = await backend.launch((allocation) => {
    const plan = privateMacosExecutionPlan(
      {
        runId: 'native-agent-startup',
        limits: {
          memoryBytes: 512 * 1024 * 1024,
          pids: 64,
          cpuQuotaMicros: 100_000,
          cpuPeriodMicros: 100_000,
          deadlineUnixMs: Date.now() + 45_000,
          cancellationGraceMs: 1000,
          cleanupTimeoutMs: 5_000,
        },
        command: [
          privateExecutionPath(support.sandboxExecutablePath),
          '--no-env-file',
          '--no-install',
          privateExecutionPath(runtime.sandboxAdapterPath),
        ],
        projections: privateExecutionFileProjections([
          ...support.runtimeMounts,
          { source: support.executablePath, destination: support.sandboxExecutablePath },
          { source: runtime.adapterPath, destination: runtime.sandboxAdapterPath },
          { source: runtime.executablePath, destination: runtime.sandboxExecutablePath },
          ...runtime.readOnlyMounts,
        ]),
        environment: runtime.environment,
        relocateEnvironment: true,
        relocatedEnvironment: {
          JIG_AGENT_HOME: '/tmp',
          JIG_AGENT_WORK: '/work',
        },
        network: 'isolated',
        ...(runtime.macosCodexPreferenceNotifications
          ? { macosCodexPreferenceNotifications: true as const }
          : {}),

        maxOutputBytes: 1024 * 1024,
        storageBytes: 512 * 1024 * 1024,
      },
      allocation,
    )
    cwd = plan.cwd
    return plan
  })
  const stderr = (async () => {
    let text = ''
    for await (const bytes of component.stderr) text += new TextDecoder().decode(bytes)
    return text
  })()
  const iterator = component.stdout[Symbol.asyncIterator]()
  let buffer = ''
  const decoder = new TextDecoder()
  const request = async (id: number, method: string, params: unknown) => {
    await component.write(
      new TextEncoder().encode(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`),
    )
    for (;;) {
      const split = buffer.indexOf('\n')
      if (split >= 0) {
        const frame = JSON.parse(buffer.slice(0, split))
        buffer = buffer.slice(split + 1)
        if (frame.method) {
          if (frame.id !== undefined)
            await component.write(
              new TextEncoder().encode(
                `${JSON.stringify({
                  jsonrpc: '2.0',
                  id: frame.id,
                  error: { code: -32601, message: 'unsupported' },
                })}\n`,
              ),
            )
          continue
        }
        expect(frame.id).toBe(id)
        expect(frame.error, JSON.stringify(frame.error)).toBeUndefined()
        return frame.result
      }
      const part = await iterator.next()
      if (part.done) throw new Error(`native ACP ended: ${await stderr}`)
      buffer += decoder.decode(part.value, { stream: true })
      if (buffer.length > 1024 * 1024) throw new Error('native ACP response is too large')
    }
  }
  try {
    const startup = runtime.startupInput?.()
    if (startup) {
      await component.write(startup)
      startup.fill(0)
    }
    const initialized = await request(1, 'initialize', {
      protocolVersion: 2,
      capabilities: runtime.authentication?.clientAuthCapabilities
        ? { auth: runtime.authentication.clientAuthCapabilities }
        : {},
      info: { name: 'jig-native-startup-test', version: '2' },
    })
    expect(initialized.protocolVersion).toBe(2)
    if (runtime.authentication) await request(2, 'auth/login', runtime.authentication.request)
    await exercise(request, cwd)
  } finally {
    await component.terminate()
    expect((await component.enforcement).fenced).toBe(true)
    await iterator.return?.()
    await stderr
  }
}

async function qualifyMacosStartup(
  runtime: ReturnType<typeof privateAcpAgentRuntime>,
  support: Awaited<ReturnType<typeof openPrivateInstalledBunSupport>>,
): Promise<void> {
  await withMacosNativeClient(runtime, support, async (request, cwd) => {
    const session = await request(3, 'session/new', {
      cwd,
      mcpServers: [],
      ...(runtime.sessionMeta ? { _meta: runtime.sessionMeta } : {}),
    })
    expect(session.sessionId).toBeString()
    expect((session.sessionId as string).length).toBeGreaterThan(0)
  })
}

async function writeSyntheticSubscription(root: string, expiresAt = Date.now() + 3_600_000) {
  const token = [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(
      JSON.stringify({
        email: 'offline@example.test',
        exp: Math.floor(expiresAt / 1_000),
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'offline-account',
          chatgpt_plan_type: 'pro',
        },
      }),
    ).toString('base64url'),
    'offline-signature',
  ].join('.')
  const source = JSON.stringify({
    OPENAI_API_KEY: null,
    auth_mode: 'chatgpt',
    last_refresh: new Date().toISOString(),
    tokens: {
      access_token: token,
      id_token: token,
      account_id: 'offline-account',
      refresh_token: 'offline-refresh-never-projected',
    },
  })
  await writeFile(join(root, 'auth.json'), source, { mode: 0o600 })
  return source
}

if (process.platform === 'darwin') {
  test('codex: synthetic subscription reaches native offline login without creating a session', async () => {
    const selected = process.env.JIG_CODEX_STARTUP_PATH
    if (!selected) throw new Error('JIG_CODEX_STARTUP_PATH is required')
    const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-codex-subscription-')))
    try {
      const source = await writeSyntheticSubscription(root)
      const provider = await openPrivateCodexAgentProvider(
        installedBunLocation.releaseRoot,
        { CODEX_PATH: selected, CODEX_HOME: root },
        root,
      )
      expect(provider.credentialMode).toBe('openai-subscription')
      await revalidatePrivateAcpAgentProvider(provider)
      const runtime = privateAcpAgentRuntime(provider)
      expect(runtime.environment.JIG_CODEX_STARTUP_INPUT).toBe('subscription')
      expect(runtime.startupInput).toBeFunction()
      const support = await openPrivateInstalledBunSupport(installedBunLocation)
      // initialize consumes the credential frame and performs native account/login/start.
      // Synthetic tokens cannot establish real authentication or subscription session routing.
      await withMacosNativeClient(runtime, support, async () => {})
      expect(await readFile(join(root, 'auth.json'), 'utf8')).toBe(source)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)

  test('codex: expired synthetic subscription refuses selection without API-key fallback', async () => {
    const selected = process.env.JIG_CODEX_STARTUP_PATH
    if (!selected) throw new Error('JIG_CODEX_STARTUP_PATH is required')
    const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-codex-expired-')))
    try {
      const source = await writeSyntheticSubscription(root, Date.now() - 60_000)
      await expect(
        openPrivateCodexAgentProvider(
          installedBunLocation.releaseRoot,
          { CODEX_PATH: selected, CODEX_HOME: root },
          root,
        ),
      ).rejects.toThrow('Codex file-backed login is unavailable')
      expect(await readFile(join(root, 'auth.json'), 'utf8')).toBe(source)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)
}

for (const client of ['codex', 'claude'] as const) {
  test(`${client}: native ACP startup and new session without network`, async () => {
    const selected = process.env[`JIG_${client.toUpperCase()}_STARTUP_PATH`]
    if (!selected) throw new Error(`JIG_${client.toUpperCase()}_STARTUP_PATH is required`)
    const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-native-startup-')))
    try {
      const factory =
        client === 'codex' ? openPrivateCodexAgentProvider : openPrivateClaudeAgentProvider
      // Placeholder keys establish local startup/session behavior only.
      // They supply no authentication, subscription or inference evidence.
      const open = () =>
        factory(
          installedBunLocation.releaseRoot,
          {
            [`${client.toUpperCase()}_PATH`]: selected,
            ...(client === 'codex'
              ? { OPENAI_API_KEY: 'offline-placeholder', OPENAI_MODEL: 'gpt-5.3-codex' }
              : {
                  ANTHROPIC_API_KEY: 'offline-placeholder',
                  ANTHROPIC_MODEL: 'claude-haiku-4-5',
                }),
          },
          root,
        )
      const provider = await open()
      if (client === 'codex')
        console.info(`codex selected native executable identity: ${provider.executableDigest}`)
      await revalidatePrivateAcpAgentProvider(provider)
      const runtime = privateAcpAgentRuntime(provider)
      const support = await openPrivateInstalledBunSupport(installedBunLocation)
      if (process.platform === 'darwin') {
        await qualifyMacosStartup(runtime, support)
        return
      }
      const bwrap =
        process.env.JIG_BWRAP_PATH ??
        (await resolvePrivateLinuxHostPath(privateLinuxHostToolCandidates('bwrap')))
      const args = [
        bwrap,
        '--unshare-all',
        '--die-with-parent',
        '--new-session',
        '--clearenv',
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--tmpfs',
        '/tmp',
        '--dir',
        '/work',
        '--chdir',
        '/work',
        '--setenv',
        'LD_LIBRARY_PATH',
        '/jig-runtime/lib',
        '--setenv',
        'HOME',
        '/tmp',
        '--ro-bind',
        runtime.executablePath,
        runtime.sandboxExecutablePath,
        '--ro-bind',
        runtime.adapterPath,
        runtime.sandboxAdapterPath,
      ]
      const mounts = new Map(support.runtimeMounts.map((mount) => [mount.destination, mount]))
      for (const mount of runtime.readOnlyMounts) {
        const existing = mounts.get(mount.destination)
        if (existing && existing.source !== mount.source)
          throw new Error('conflicting runtime mount')
        mounts.set(mount.destination, mount)
      }
      for (const mount of mounts.values()) args.push('--ro-bind', mount.source, mount.destination)
      for (const [key, value] of Object.entries(runtime.environment))
        args.push('--setenv', key, value)
      const version = Bun.spawn(
        [
          ...args,
          '--unsetenv',
          'LD_LIBRARY_PATH',
          '--',
          runtime.sandboxExecutablePath,
          '--version',
        ],
        {
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const versionTimer = setTimeout(() => version.kill(), 10_000)
      try {
        const [stdout, stderr, code] = await Promise.all([
          new Response(version.stdout).text(),
          new Response(version.stderr).text(),
          version.exited,
        ])
        expect(code, stderr).toBe(0)
        expect(stdout.trim()).toMatch(/\d+\.\d+\.\d+/)
        console.info(`${client} native version: ${stdout.trim()}`)
      } finally {
        clearTimeout(versionTimer)
        if (version.exitCode === null) version.kill()
        await version.exited
      }
      const child = Bun.spawn(
        [...args, '--', support.sandboxExecutablePath, '--no-env-file', runtime.sandboxAdapterPath],
        { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      )
      const timer = setTimeout(() => child.kill(), 25_000)
      const errors = new Response(child.stderr).text()
      const reader = child.stdout.getReader()
      let buffer = ''
      const decoder = new TextDecoder()
      try {
        const startup = runtime.startupInput?.()
        if (startup) {
          child.stdin.write(startup)
          startup.fill(0)
        }
        async function request(
          id: number,
          method: string,
          params: unknown,
        ): Promise<Record<string, unknown>> {
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
          child.stdin.flush()
          for (;;) {
            const newline = buffer.indexOf('\n')
            if (newline < 0) {
              const chunk = await reader.read()
              if (chunk.done) throw new Error(`native ACP ended: ${await errors}`)
              buffer += decoder.decode(chunk.value, { stream: true })
              if (buffer.length > 1024 * 1024) throw new Error('native ACP response is too large')
              continue
            }
            const frame = JSON.parse(buffer.slice(0, newline))
            buffer = buffer.slice(newline + 1)
            if (frame.method) {
              if (frame.id !== undefined) {
                // This consumer grants no filesystem, terminal, MCP, or tools.
                child.stdin.write(
                  `${JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'unsupported' } })}\n`,
                )
                child.stdin.flush()
              }
              continue
            }
            expect(frame.id).toBe(id)
            expect(frame.error).toBeUndefined()
            expect(frame.result).toBeObject()
            return frame.result
          }
        }
        const initialized = await request(1, 'initialize', {
          protocolVersion: 2,
          capabilities: {
            ...(runtime.authentication?.clientAuthCapabilities
              ? { auth: runtime.authentication.clientAuthCapabilities }
              : {}),
          },
          info: { name: 'jig-native-startup-test', version: '2' },
        })
        expect(initialized.protocolVersion).toBe(2)
        if (runtime.authentication) await request(2, 'auth/login', runtime.authentication.request)
        const session = await request(3, 'session/new', {
          cwd: '/work',
          mcpServers: [],
          ...(runtime.sessionMeta ? { _meta: runtime.sessionMeta } : {}),
        })
        expect(session.sessionId).toBeString()
        expect((session.sessionId as string).length).toBeGreaterThan(0)
      } finally {
        clearTimeout(timer)
        child.kill()
        await child.exited
        reader.releaseLock()
        await errors
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)
}

if (process.env.JIG_NATIVE_AGENT_STARTUP !== '1')
  throw Error('This suite requires qualified offline native clients')
