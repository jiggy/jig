const suiteTestUrl = new URL('../' + import.meta.url.split('/').at(-1), import.meta.url).href

import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PrivateFiniteAcpPolicy,
  PrivateFiniteAcpPolicyError,
} from '../../src/internal/finite-acp-policy.js'

for (const scenario of [
  'completed',
  'rejected',
  'shutdown-fail',
  'shutdown-signal',
  'forced-clean',
  'missing-executable',
  'immediate-follow-up',
  'immediate-follow-up-start-before-reply',
  'immediate-follow-up-start-after-reply',
  'completion-before-reply',
  'completion-before-reply-cancel',
  'http-status-503',
  'http-status-429',
  'http-status-invalid',
  'http-status-600',
]) {
  test(`Codex ACP accounts for requested turns and native shutdown: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-codex-acp-dispatch-'))
    const fixture = join(root, 'codex')
    const recording = join(root, 'requests.ndjson')
    await writeFile(
      fixture,
      `#!${process.execPath}\n${await readFile(new URL('./fixtures/codex-app-server-recording.ts', suiteTestUrl), 'utf8')}`,
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
    const deadline = setTimeout(() => child.kill(), 8_000)
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
    const notifications: any[] = []
    const readFrame = async () => {
      for (;;) {
        const split = buffer.indexOf('\n')
        if (split >= 0) {
          const frame = JSON.parse(buffer.slice(0, split))
          buffer = buffer.slice(split + 1)
          return frame
        } else {
          const part = await lines.read()
          if (part.done) throw new Error(`ACP ended: ${await diagnostics}`)
          bytes += part.value.byteLength
          if (bytes > 256 * 1024) throw new Error('ACP fixture output overflow')
          buffer += decoder.decode(part.value, { stream: true })
        }
      }
    }
    const request = async (id: number, method: string, params: unknown, interrupt?: string) => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      if (interrupt !== undefined)
        child.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/cancel',
            params: { sessionId: interrupt },
          }) + '\n',
        )
      await child.stdin.flush()
      for (;;) {
        const frame = await readFrame()
        if (frame.id === id) return frame
        if (frame.method) notifications.push(frame)
      }
    }
    const drainUntilIdle = async (startIdx: number = 0) => {
      while (
        !notifications
          .slice(startIdx)
          .some(
            (n) =>
              n.params?.update?.sessionUpdate === 'state_update' &&
              n.params?.update?.state === 'idle',
          )
      ) {
        const frame = await readFrame()
        if (frame.method) notifications.push(frame)
      }
      const idle = [...notifications.slice(startIdx)]
        .reverse()
        .find(
          (n) =>
            n.params?.update?.sessionUpdate === 'state_update' &&
            n.params?.update?.state === 'idle',
        )
      return idle?.params?.update?.stopReason
    }
    try {
      if (scenario === 'missing-executable') {
        const initialized = await request(1, 'initialize', {
          protocolVersion: 2,
          capabilities: {},
        })
        expect(initialized.error).toBeDefined()
        await child.stdin.end()
        expect(await child.exited, await diagnostics).not.toBe(0)
        return
      }
      expect(
        (
          await request(1, 'initialize', {
            protocolVersion: 2,
            capabilities: scenario.startsWith('http-status-')
              ? { _meta: { jetbrains: { air: { version: 1, capabilities: ['sessionFailure'] } } } }
              : {},
          })
        ).error,
      ).toBeUndefined()
      const opened = await request(2, 'session/new', { cwd: root, mcpServers: [] })
      expect(opened.error).toBeUndefined()
      const sessionId = opened.result.sessionId
      expect(
        (
          await request(3, 'session/set_config_option', {
            sessionId,
            configId: 'mode',
            type: 'id',
            value: 'read-only',
          })
        ).error,
      ).toBeUndefined()
      const prompt1StartIdx = notifications.length
      const answering = request(4, 'session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: 'Only this requested work' }],
      })
      if (scenario === 'completion-before-reply-cancel') {
        while (!(await readFile(recording, 'utf8')).includes('completed-before-reply'))
          await Bun.sleep(5)
        child.stdin.write(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/cancel',
            params: { sessionId },
          }) + '\n',
        )
        await child.stdin.flush()
      }
      const answer = await answering
      if (scenario === 'rejected') {
        expect(answer.error).toBeDefined()
      } else {
        expect(typeof answer.result?.messageId).toBe('string')
        const stopReason = await drainUntilIdle(prompt1StartIdx)
        if (scenario.startsWith('http-status-')) {
          expect(stopReason).toBe('error')
          const failureUpdate = notifications.find(
            (n) => n.params?.update?._meta?.jetbrains?.air?.sessionFailure,
          )
          const failure = failureUpdate?.params?.update?._meta?.jetbrains?.air?.sessionFailure
          expect(failure?.severity).toBe('error')
          expect(failure?.httpStatusCode).toBe(
            ['http-status-503', 'http-status-429'].includes(scenario)
              ? Number(scenario.slice('http-status-'.length))
              : undefined,
          )
        } else {
          expect(stopReason).toBe('end_turn')
        }
      }
      if (scenario.startsWith('immediate-follow-up')) {
        const prompt2StartIdx = notifications.length
        const followup = await request(
          5,
          'session/prompt',
          {
            sessionId,
            prompt: [{ type: 'text', text: 'Only this follow-up' }],
          },
          sessionId,
        )
        expect(typeof followup.result?.messageId).toBe('string')
        const followupStopReason = await drainUntilIdle(prompt2StartIdx)
        expect(followupStopReason).toBe('cancelled')
      }
      expect((await request(6, 'session/close', { sessionId })).error).toBeUndefined()
      await child.stdin.end()
      const exit = await child.exited
      if (
        scenario === 'completed' ||
        scenario.startsWith('completion-before-reply') ||
        scenario === 'rejected' ||
        scenario.startsWith('http-status-') ||
        scenario.startsWith('immediate-follow-up')
      )
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
      expect(started).toHaveLength(scenario.startsWith('immediate-follow-up') ? 2 : 1)
      if (scenario.startsWith('immediate-follow-up')) {
        const interrupted = recorded.filter((record) => record.method === 'turn/interrupt')
        expect(interrupted).toHaveLength(1)
        expect(interrupted[0].params.turnId).toBe('turn-2')
      }
      if (scenario === 'completion-before-reply-cancel')
        expect(recorded.filter((record) => record.method === 'turn/interrupt')).toHaveLength(0)
      expect(started[0].params.model).toBe('fixture')
      expect(recorded.filter((record) => record.method === 'thread/start')).toHaveLength(1)
      expect(
        recorded.some((record) =>
          ['thread/fork', 'review/start', 'thread/compact/start', 'thread/goal/set'].includes(
            record.method,
          ),
        ),
      ).toBe(false)
    } catch (error) {
      if (scenario.startsWith('immediate-follow-up')) {
        const records = (await readFile(recording, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        console.info(
          'Immediate-interruption native methods:',
          records.map((record) => record.method ?? record.event),
        )
      }
      throw error
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
  }, 12_000)
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
        `#!${process.execPath}\n${await readFile(new URL('./fixtures/codex-app-server-recording.ts', suiteTestUrl), 'utf8')}`,
        { mode: 0o700 },
      ),
      writeFile(
        launcher,
        await readFile(new URL('../src/internal/codex-agent-launcher.ts', suiteTestUrl)),
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
          JIG_AGENT_HOME: state,
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
        (await request(1, 'initialize', { protocolVersion: 2, capabilities: {} })).error,
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

for (const scenario of [
  'completed',
  'completion-before-reply',
  'http-status-503',
  'rejected',
] as const) {
  test(`Codex ACP configuration and fast-turn frames satisfy PrivateFiniteAcpPolicy: ${scenario}`, async () => {
    const encoder = new TextEncoder()
    const policy = new PrivateFiniteAcpPolicy(
      { configuration: [], modeId: 'read-only' },
      'openai-codex',
    )
    const root = await mkdtemp(join(tmpdir(), 'jig-codex-acp-policy-'))
    const fixture = join(root, 'codex')
    const recording = join(root, 'requests.ndjson')
    await writeFile(
      fixture,
      `#!${process.execPath}\n${await readFile(new URL('./fixtures/codex-app-server-recording.ts', suiteTestUrl), 'utf8')}`,
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
          CODEX_PATH: fixture,
          RECORD_PATH: recording,
          RECORD_SCENARIO: scenario,
        },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const deadline = setTimeout(() => child.kill(), 8_000)
    const lines = child.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let policyError: unknown
    const readRawFrame = async (): Promise<{ raw: string; parsed: any }> => {
      for (;;) {
        const split = buffer.indexOf('\n')
        if (split >= 0) {
          const raw = buffer.slice(0, split)
          buffer = buffer.slice(split + 1)
          return { raw, parsed: JSON.parse(raw) }
        }
        const part = await lines.read()
        if (part.done) throw new Error('Codex ACP exited unexpectedly')
        buffer += decoder.decode(part.value, { stream: true })
      }
    }
    const callThroughPolicy = async (
      frame: unknown,
      wireOverride?: (accepted: any) => unknown,
    ): Promise<any> => {
      const accepted = policy.fromAdapter(encoder.encode(JSON.stringify(frame)))
      const wire = wireOverride ? wireOverride(accepted) : accepted
      child.stdin.write(`${JSON.stringify(wire)}\n`)
      await child.stdin.flush()
      for (;;) {
        const { raw, parsed } = await readRawFrame()
        const delivery = policy.fromClient(encoder.encode(raw))
        if (parsed.id === (frame as { id: number }).id) return delivery.toAdapter
      }
    }
    try {
      const initReply = await callThroughPolicy(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: 2,
            capabilities: {},
            info: { name: 'jig-v2-client', version: '2' },
          },
        },
        (accepted) =>
          scenario === 'http-status-503'
            ? {
                ...accepted,
                params: {
                  ...accepted.params,
                  capabilities: {
                    _meta: { jetbrains: { air: { version: 1, capabilities: ['sessionFailure'] } } },
                  },
                },
              }
            : accepted,
      )
      expect(initReply.result.protocolVersion).toBe(2)

      const newReply = await callThroughPolicy(
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'session/new',
          params: { cwd: '/work', mcpServers: [] },
        },
        (accepted) => ({ ...accepted, params: { ...accepted.params, cwd: root } }),
      )
      const sessionId = newReply.result.sessionId as string
      expect(typeof sessionId).toBe('string')

      const configReply = await callThroughPolicy({
        jsonrpc: '2.0',
        id: 3,
        method: 'session/set_config_option',
        params: { sessionId, configId: 'mode', type: 'id', value: 'read-only' },
      })
      expect(configReply.result).toEqual({
        configOptions: [
          {
            configId: 'mode',
            name: 'mode',
            type: 'select',
            currentValue: 'read-only',
            options: [{ value: 'read-only', name: 'read-only' }],
          },
        ],
      })

      const acceptedPrompt = policy.fromAdapter(
        encoder.encode(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 4,
            method: 'session/prompt',
            params: { sessionId, prompt: [{ type: 'text', text: 'Answer through policy.' }] },
          }),
        ),
      )
      child.stdin.write(`${JSON.stringify(acceptedPrompt)}\n`)
      await child.stdin.flush()

      if (scenario === 'rejected') {
        for (;;) {
          const { raw, parsed } = await readRawFrame()
          policy.fromClient(encoder.encode(raw))
          if (parsed.id === 4) break
        }
        expect(policy.hasExplicitPromptRejection).toBeTrue()
        expect(policy.hasAcceptedOrInsertedPrompt).toBeFalse()
      } else {
        while (policy.turnActive) {
          const { raw } = await readRawFrame()
          try {
            policy.fromClient(encoder.encode(raw))
          } catch (error) {
            policyError = error
            break
          }
        }
        if (scenario === 'http-status-503') {
          expect(policyError).toBeInstanceOf(PrivateFiniteAcpPolicyError)
          expect((policyError as PrivateFiniteAcpPolicyError).nativeHttpStatusCode).toBe(503)
          expect(policy.hasAcceptedOrInsertedPrompt).toBeTrue()
          expect(policy.hasExplicitPromptRejection).toBeFalse()
          return
        }
        expect(policyError).toBeUndefined()
      }
      const closeReply = await callThroughPolicy({
        jsonrpc: '2.0',
        id: 5,
        method: 'session/close',
        params: { sessionId },
      })
      expect(closeReply.result).toEqual({})
      if (scenario !== 'rejected') expect(policy.settledSessionId).toBe(sessionId)
    } finally {
      try {
        await child.stdin.end()
      } catch {
        /* already exited */
      }
      await child.exited
      clearTimeout(deadline)
      await lines.cancel()
      await rm(root, { recursive: true, force: true })
    }
  })
}
