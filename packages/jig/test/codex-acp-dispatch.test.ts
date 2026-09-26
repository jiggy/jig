import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

for (const scenario of [
  'completed',
  'rejected',
  'shutdown-fail',
  'shutdown-signal',
  'forced-clean',
  'missing-executable',
]) {
  test(
    `Codex ACP accounts for requested turns and native shutdown: ${scenario}`,
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'jig-codex-acp-dispatch-'))
      const fixture = join(root, 'codex')
      const recording = join(root, 'requests.ndjson')
      await writeFile(
        fixture,
        `#!${process.execPath}\n${await readFile(new URL('./fixtures/codex-app-server-recording.ts', import.meta.url), 'utf8')}`,
        { mode: 0o700 },
      )
      const child = Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          '--no-install',
          '--config=/dev/null',
          fileURLToPath(import.meta.resolve('@agentclientprotocol/codex-acp')),
        ],
        {
          cwd: root,
          env: {
            HOME: root,
            PATH: root,
            CODEX_PATH: scenario === 'missing-executable' ? join(root, 'missing-codex') : fixture,
            RECORD_PATH: recording,
            RECORD_SCENARIO: scenario,
          },
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const deadline = setTimeout(
        () => child.kill(),
        process.platform === 'darwin' ? 20_000 : 8_000,
      )
      const diagnostics = (async () => {
        let text = ''
        for await (const chunk of child.stderr) {
          if (text.length + chunk.byteLength > 64 * 1024) {
            child.kill()
            return 'ACP fixture diagnostics exceeded capacity'
          }
          text += new TextDecoder().decode(chunk)
        }
        return text
      })()
      const lines = child.stdout.getReader()
      let buffer = ''
      let bytes = 0
      const decoder = new TextDecoder()
      const request = async (id: number, method: string, params: unknown) => {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
        await child.stdin.flush()
        for (;;) {
          const split = buffer.indexOf('\n')
          if (split >= 0) {
            const frame = JSON.parse(buffer.slice(0, split))
            buffer = buffer.slice(split + 1)
            if (frame.id === id) return frame
          } else {
            const part = await lines.read()
            if (part.done) throw new Error(`ACP ended: ${await diagnostics}`)
            bytes += part.value.byteLength
            if (bytes > 256 * 1024) throw new Error('ACP fixture output overflow')
            buffer += decoder.decode(part.value, { stream: true })
          }
        }
      }
      try {
        if (scenario === 'missing-executable') {
          const initialized = await request(1, 'initialize', {
            protocolVersion: 1,
            clientCapabilities: {},
          })
          expect(initialized.error).toBeDefined()
          await child.stdin.end()
          expect(await child.exited, await diagnostics).not.toBe(0)
          return
        }
        expect(
          (await request(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} })).error,
        ).toBeUndefined()
        const opened = await request(2, 'session/new', { cwd: root, mcpServers: [] })
        expect(opened.error).toBeUndefined()
        const sessionId = opened.result.sessionId
        expect(
          (await request(3, 'session/set_mode', { sessionId, modeId: 'read-only' })).error,
        ).toBeUndefined()
        const answer = await request(4, 'session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: 'Only this requested work' }],
        })
        if (scenario === 'rejected') expect(answer.error).toBeDefined()
        else expect(answer.result?.stopReason).toBe('end_turn')
        expect((await request(5, 'session/close', { sessionId })).error).toBeUndefined()
        await child.stdin.end()
        const exit = await child.exited
        if (scenario === 'completed' || scenario === 'rejected')
          expect(exit, await diagnostics).toBe(0)
        else expect(exit, await diagnostics).not.toBe(0)
        const recorded = (await readFile(recording, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        const nativeEnd = recorded.find((record) => record.event === 'native-stdin-end')
        expect(nativeEnd).toBeDefined()
        if (scenario === 'completed' || scenario === 'rejected')
          expect(Date.now() - nativeEnd.time).toBeLessThan(1800)
        if (scenario === 'forced-clean')
          expect(recorded.some((record) => record.event === 'native-forced-exit-zero')).toBe(true)
        const started = recorded.filter((record) => record.method === 'turn/start')
        expect(started).toHaveLength(1)
        expect(started[0].params.model).toBe('fixture')
        expect(recorded.filter((record) => record.method === 'thread/start')).toHaveLength(1)
        expect(
          recorded.some((record) =>
            ['thread/fork', 'review/start', 'thread/compact/start', 'thread/goal/set'].includes(
              record.method,
            ),
          ),
        ).toBe(false)
      } finally {
        try {
          await child.stdin.end()
        } catch {
          /* already exited */
        }
        await child.exited
        clearTimeout(deadline)
        await lines.cancel()
        await diagnostics
        await rm(root, { recursive: true, force: true })
      }
    },
    process.platform === 'darwin' ? 25_000 : 12_000,
  )
}

test(
  'Codex subscription startup stays in memory and selects ephemeral credential storage',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-codex-acp-bootstrap-'))
    const state = join(root, 'state')
    const fixture = join(root, 'codex')
    const recording = join(root, 'requests.ndjson')
    const launcher = join(root, 'codex-agent-launcher.ts')
    const adapter = join(root, 'codex-acp.js')
    await mkdir(state)
    await Promise.all([
      writeFile(
        fixture,
        `#!${process.execPath}\n${await readFile(new URL('./fixtures/codex-app-server-recording.ts', import.meta.url), 'utf8')}`,
        { mode: 0o700 },
      ),
      writeFile(
        launcher,
        await readFile(new URL('../src/internal/codex-agent-launcher.ts', import.meta.url)),
      ),
      writeFile(
        adapter,
        await readFile(fileURLToPath(import.meta.resolve('@agentclientprotocol/codex-acp'))),
      ),
    ])
    const child = Bun.spawn(
      [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', launcher],
      {
        cwd: root,
        env: {
          HOME: root,
          PATH: root,
          CODEX_CONFIG: JSON.stringify({ features: { code_mode: false } }),
          CODEX_PATH: fixture,
          JIG_CODEX_STARTUP_INPUT: 'subscription',
          JIG_MACOS_AGENT_HOME: state,
          RECORD_PATH: recording,
          RECORD_SCENARIO: 'completed',
        },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const deadline = setTimeout(() => child.kill(), process.platform === 'darwin' ? 20_000 : 8_000)
    const diagnostics = new Response(child.stderr).text()
    const lines = child.stdout.getReader()
    let buffer = ''
    const decoder = new TextDecoder()
    const credential = new TextEncoder().encode(
      JSON.stringify({
        auth_mode: 'chatgptAuthTokens',
        tokens: { access_token: 'in-memory-access', account_id: 'account-one' },
      }),
    )
    const header = new Uint8Array(4)
    new DataView(header.buffer).setUint32(0, credential.byteLength, false)
    child.stdin.write(header)
    child.stdin.write(credential)
    const request = async (id: number, method: string, params: unknown) => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      await child.stdin.flush()
      for (;;) {
        const split = buffer.indexOf('\n')
        if (split >= 0) {
          const frame = JSON.parse(buffer.slice(0, split))
          buffer = buffer.slice(split + 1)
          if (frame.id === id) return frame
        } else {
          const part = await lines.read()
          if (part.done) throw new Error(`ACP ended: ${await diagnostics}`)
          buffer += decoder.decode(part.value, { stream: true })
        }
      }
    }
    try {
      expect(
        (await request(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} })).error,
      ).toBeUndefined()
      await child.stdin.end()
      expect(await child.exited, await diagnostics).toBe(0)
      expect(await Bun.file(join(state, 'codex-home', 'auth.json')).exists()).toBe(false)
      expect(await readFile(join(state, 'codex-home', 'config.toml'), 'utf8')).toBe(
        'cli_auth_credentials_store = "ephemeral"\n\n[features]\ncode_mode = false\n',
      )
      const login = (await readFile(recording, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .find((record) => record.method === 'account/login/start')
      expect(login?.params).toEqual({
        type: 'chatgptAuthTokens',
        accessToken: 'in-memory-access',
        chatgptAccountId: 'account-one',
        chatgptPlanType: null,
      })
    } finally {
      try {
        await child.stdin.end()
      } catch {
        /* already exited */
      }
      await child.exited
      clearTimeout(deadline)
      await lines.cancel()
      await diagnostics
      await rm(root, { recursive: true, force: true })
    }
  },
  process.platform === 'darwin' ? 25_000 : 12_000,
)
