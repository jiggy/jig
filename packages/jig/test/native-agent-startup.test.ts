import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  privateAcpAgentRuntime,
  revalidatePrivateAcpAgentProvider,
} from '../src/internal/acp-agent-provider.js'
import { openPrivateClaudeAgentProvider } from '../src/internal/claude-agent-provider.js'
import { openPrivateCodexAgentProvider } from '../src/internal/codex-agent-provider.js'
import { openPrivateInstalledBunSupport } from '../src/internal/installed-bun-support.js'
import {
  privateLinuxHostToolCandidates,
  resolvePrivateLinuxHostPath,
} from '../src/internal/linux-host-paths.js'
import { openPrivatePiAgentProvider } from '../src/internal/pi-agent-provider.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

// Genuine operator installations only. No downloads, credentials, model calls,
// or fixture executables. This proves startup, not the hostile-host contract.
const nativeTest = process.env.JIG_NATIVE_AGENT_STARTUP === '1' ? test : test.skip
for (const client of ['codex', 'claude', 'pi'] as const) {
  nativeTest(
    `${client}: native version and ACP session initialize without network`,
    async () => {
      const selected = process.env[`JIG_${client.toUpperCase()}_STARTUP_PATH`]
      if (!selected) throw new Error(`JIG_${client.toUpperCase()}_STARTUP_PATH is required`)
      const root = await mkdtemp(join(tmpdir(), 'jig-native-startup-'))
      try {
        const provider = await (client === 'codex'
          ? openPrivateCodexAgentProvider
          : client === 'claude'
            ? openPrivateClaudeAgentProvider
            : openPrivatePiAgentProvider)(
          installedBunLocation.releaseRoot,
          {
            [`${client.toUpperCase()}_PATH`]: selected,
            ...(client === 'codex'
              ? { OPENAI_API_KEY: 'offline-placeholder', OPENAI_MODEL: 'gpt-5.3-codex' }
              : client === 'claude'
                ? { ANTHROPIC_API_KEY: 'offline-placeholder', ANTHROPIC_MODEL: 'claude-haiku-4-5' }
                : {
                    PI_API_KEY: 'offline-placeholder',
                    PI_PROVIDER: 'mistral',
                    PI_MODEL: 'ministral-8b-2512',
                  }),
          },
          root,
        )
        await revalidatePrivateAcpAgentProvider(provider)
        const runtime = privateAcpAgentRuntime(provider)
        const support = await openPrivateInstalledBunSupport(installedBunLocation)
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
          [
            ...args,
            '--',
            support.sandboxExecutablePath,
            '--no-env-file',
            runtime.sandboxAdapterPath,
          ],
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
            protocolVersion: 1,
            clientCapabilities: {
              ...(runtime.authentication?.clientAuthCapabilities
                ? { auth: runtime.authentication.clientAuthCapabilities }
                : {}),
            },
            clientInfo: { name: 'jig-native-startup-test', version: '1' },
          })
          expect(initialized.protocolVersion).toBe(1)
          if (runtime.authentication)
            await request(2, 'authenticate', runtime.authentication.request)
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
    },
    60_000,
  )
}
