import { describe, expect, test } from 'bun:test'
import type { PrivateExecutionProcess } from '../../src/internal/execution-process.js'
import { assertPrivateFiniteAcpPublicOutput } from '../../src/internal/finite-acp-resource.js'
import { ChannelBroker } from '../../src/run/channels.js'
import {
  type RunHostCall,
  RunHostFatalOperationError,
  type RunHostInvocation,
  RunHostSession,
} from '../../src/run/session.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'

// Reaping these finite, descendant-free peers is NOT native fencing evidence.
function launch(mode: string) {
  const child = Bun.spawn(
    [
      installedBunLocation.executablePath,
      `${import.meta.dir}/../run-session-peer.fixture.ts`,
      mode,
    ],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  )
  const observed: Uint8Array[] = []
  let expired = false
  const watchdog = setTimeout(() => {
    expired = true
    child.kill('SIGKILL')
  }, 4_000)
  const completion = child.exited.then((exitCode) => {
    clearTimeout(watchdog)
    return { exitCode, signal: child.signalCode, fenced: false }
  })
  const process: PrivateExecutionProcess = {
    stdout: (async function* () {
      for await (const chunk of child.stdout) {
        observed.push(chunk.slice())
        yield chunk
      }
    })(),
    stderr: child.stderr,
    completion,
    async write(bytes) {
      child.stdin.write(bytes)
      await child.stdin.flush()
    },
    async closeInput() {
      await child.stdin.end()
    },
    async terminate() {
      child.kill('SIGKILL')
      await child.exited
    },
  }
  return {
    process,
    child,
    async dispose() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await child.exited
      clearTimeout(watchdog)
      expect(expired).toBe(false)
    },
    frames() {
      const text = Buffer.concat(observed).toString('utf8').trim()
      return text === '' ? [] : text.split('\n').map((line) => JSON.parse(line))
    },
  }
}
function invocation(deadlineUnixMs = Date.now() + 2_000): RunHostInvocation {
  return { input: {}, settings: {}, attachments: {}, scratch: '/scratch', deadlineUnixMs }
}
const unfenced = {
  status: 'failed',
  code: 'EXECUTION_FAILED',
  message: 'component cleanup or fencing failed',
}
async function exchange(mode: string, input = invocation(), limits = {}) {
  const peer = launch(mode)
  try {
    const terminal = await new RunHostSession(peer.process, input, {
      cancellationGraceMs: 40,
      ...limits,
    }).run()
    return {
      terminal,
      frames: peer.frames(),
      exitCode: peer.child.exitCode,
      signal: peer.child.signalCode,
    }
  } finally {
    await peer.dispose()
  }
}
describe('RunHostSession with actual bounded protocol subprocesses', () => {
  for (const nested of [false, true]) {
    test(`credential matching stops ${nested ? 'nested and root' : 'root'} peers before they can return a guess`, async () => {
      const root = launch(nested ? 'sdk-catch-child' : 'sdk-credential-oracle')
      const child = nested ? launch('sdk-credential-oracle') : undefined
      const patterns = [new TextEncoder().encode('guessable-token')]
      const checked: unknown[] = []
      let session: RunHostSession
      const check = async (call: RunHostCall) => {
        checked.push(call.input)
        try {
          assertPrivateFiniteAcpPublicOutput(call.input, patterns)
        } catch (error) {
          expect(error).toBeInstanceOf(RunHostFatalOperationError)
          session.failOperation(error as RunHostFatalOperationError)
          throw error
        }
        return { status: 'succeeded' as const, result: { outcome: 'done', output: null } }
      }
      try {
        session = new RunHostSession(
          root.process,
          invocation(),
          {},
          {
            call:
              child === undefined
                ? check
                : async (_call, signal) => {
                    const result = await new RunHostSession(
                      child.process,
                      { ...invocation(), signal },
                      {},
                      {
                        call: check,
                      },
                    ).run()
                    expect(result.status).toBe('failed')
                    return { status: 'failed', code: 'UNCERTAIN', message: 'child failed' }
                  },
          },
        )
        const terminal = await session.run()
        expect(terminal).toMatchObject(unfenced)
        expect(checked).toEqual(['ordinary answer', 'guessable-token'])
        for (const peer of [root, ...(child === undefined ? [] : [child])]) {
          expect(peer.frames().some((frame) => frame.id === 'host:1')).toBe(false)
          expect(peer.child.signalCode).toBe('SIGKILL')
        }
      } finally {
        patterns[0]!.fill(0)
        await root.dispose()
        await child?.dispose()
      }
    })
  }
  test('SDK root result and diagnostics do not confer native fencing', async () => {
    const run = await exchange('sdk')
    expect(run.exitCode).toBe(0)
    expect(run.signal).toBeNull()
    expect(run.frames).toEqual([
      { jsonrpc: '2.0', id: 'host:1', result: { outcome: 'done', output: { greeting: 'hello' } } },
    ])
    expect(run.terminal).toMatchObject({
      ...unfenced,
      diagnostics: { stderr: 'ordinary diagnostic\n', stderrTruncated: false },
    })
  })
  test('SDK full-duplex calls catch real absent-dispatch UNAVAILABLE replies', async () => {
    const run = await exchange('sdk-calls')
    expect(run.exitCode).toBe(0)
    expect(run.frames.filter((frame) => frame.method === 'flow/call')).toHaveLength(2)
    expect(run.frames.at(-1).result.output).toEqual(['UNAVAILABLE', 'UNAVAILABLE'])
    expect(run.terminal).toMatchObject(unfenced)
  })
  for (const delivery of ['direct', 'broadcast'] as const) {
    test(`actual SDK ${delivery} channels use the production broker over stdio`, async () => {
      const peer = launch(`sdk-channel-${delivery}`)
      const broker = new ChannelBroker()
      const root = broker.participant('root')
      try {
        const terminal = await new RunHostSession(
          peer.process,
          invocation(),
          {},
          {
            channels: root,
          },
        ).run()
        expect(peer.child.exitCode).toBe(0)
        expect(peer.child.signalCode).toBeNull()
        const frames = peer.frames()
        // Run/0 requires the correlated root response to be the final frame.
        // An unfenced adapter refusal alone cannot distinguish SDK success
        // from a root error, even when the runtime exits zero.
        const rootFrames = frames.filter((frame) => frame.id === 'host:1')
        const last = frames.at(-1)
        const runCodes = new Set([
          'CANCELLED',
          'DEADLINE_EXCEEDED',
          'OWNER_CLOSED',
          'OPERATION_CONFLICT',
          'UNAVAILABLE',
          'PERMISSION_DENIED',
          'RESOURCE_EXHAUSTED',
          'INVALID_INPUT',
          'INVALID_RESULT',
          'UNCERTAIN',
          'EXECUTION_FAILED',
          'LAGGED',
          'DISCONNECTED',
        ])
        const diagnostic = JSON.stringify({
          frameCount: frames.length,
          frames: frames.slice(0, 32).map((frame) => ({
            rootId: frame.id === 'host:1',
            kind:
              frame.method !== undefined
                ? 'method'
                : frame.error !== undefined
                  ? 'error'
                  : frame.result !== undefined
                    ? 'result'
                    : 'other',
            errorCode: Number.isSafeInteger(frame.error?.code) ? frame.error.code : null,
            runCode: runCodes.has(frame.error?.data?.code) ? frame.error.data.code : null,
          })),
          hostCode: terminal.status === 'failed' ? terminal.code : null,
          exitCode: peer.child.exitCode,
          signal: peer.child.signalCode,
        })
        expect(
          {
            rootCount: rootFrames.length,
            lastIsRoot: last?.id === 'host:1',
            lastIsResult: last !== undefined && Object.hasOwn(last, 'result'),
            lastHasError: last !== undefined && Object.hasOwn(last, 'error'),
          },
          diagnostic,
        ).toEqual({
          rootCount: 1,
          lastIsRoot: true,
          lastIsResult: true,
          lastHasError: false,
        })
        expect(last, diagnostic).toEqual({
          jsonrpc: '2.0',
          id: 'host:1',
          result: { outcome: 'done', output: { text: 'live' } },
        })
        expect(terminal).toMatchObject(unfenced)
      } finally {
        broker.abort('OWNER_CLOSED')
        await peer.dispose()
      }
    })
  }
  for (const mode of [
    'duplicate-operation',
    'operation-conflict',
    'cross-method-conflict',
    'attachment-inputs',
    'channel-reference-limit',
    'artifact-release',
    'unknown-method',
    'forged-review',
  ] as const) {
    test(`finite peer verifies real host replies: ${mode}`, async () => {
      const run = await exchange(mode, {
        ...invocation(),
        attachments: { source: { path: '/input/source', access: 'read', artifact: 'initial-1' } },
      })
      // Peer assertions read actual stdin, not substituted dispatcher behavior.
      expect(run.exitCode).toBe(0)
      expect(run.signal).toBeNull()
      expect(run.terminal).toMatchObject(unfenced)
      expect(run.frames.at(-1).result.output).toBe(mode)
    })
  }
  test('read artifact metadata and final selection retain distinct envelopes', async () => {
    const run = await exchange('artifact-result', {
      ...invocation(),
      attachments: { source: { path: '/input/source', access: 'read', artifact: 'initial-1' } },
    })
    expect(run.exitCode).toBe(0)
    expect(run.frames.at(-1).result).toEqual({
      outcome: 'done',
      output: null,
      artifactResults: { final: 'initial-1' },
    })
    expect(run.terminal).toMatchObject(unfenced)
  })
  for (const mode of [
    'malformed-json',
    'invalid-utf8',
    'scalar-params',
    'duplicate-root',
    'trailing-frame',
    'request-id-reuse',
    'invalid-result',
    'forged-host-failure',
    'late-call',
    'premature-root',
  ] as const) {
    test(`rejects actual stdout protocol violation: ${mode}`, async () => {
      const peer = launch(mode)
      try {
        expect(
          await new RunHostSession(peer.process, invocation(), {
            cancellationGraceMs: 40,
          }).run(),
        ).toMatchObject({ status: 'failed', code: 'PROTOCOL_ERROR' })
        await peer.child.exited
      } finally {
        await peer.dispose()
      }
    })
  }
  test('actual pre-response EOF loses the channel and reaps the child', async () => {
    const run = await exchange('eof')
    expect(run.terminal).toMatchObject({ status: 'failed', code: 'CHANNEL_LOST' })
    expect(run.exitCode).toBe(0)
  })
  for (const mode of ['nonzero', 'signal'] as const) {
    test(`actual ${mode} after a valid result cannot produce success`, async () => {
      const run = await exchange(mode)
      if (mode === 'nonzero') expect(run.exitCode).toBe(7)
      else expect(run.signal).toBe('SIGTERM')
      expect(run.frames.at(-1).result.outcome).toBe('done')
      expect(run.terminal).toMatchObject(unfenced)
    })
  }
  test('captures actual stderr with bounded prefix and no protocol contamination', async () => {
    const run = await exchange('diagnostic', invocation(), { capturedStderrBytes: 8 })
    expect(run.exitCode).toBe(0)
    expect(run.terminal.diagnostics).toEqual({
      stderr: 'diagnost',
      stderrBytes: 32,
      stderrTruncated: true,
    })
    expect(run.frames).toHaveLength(1)
  })
  for (const mode of [
    'cancel-cooperative',
    'cancel-held',
    'deadline-cooperative',
    'deadline-held',
  ] as const) {
    test(`actual cancellation notification and process settlement: ${mode}`, async () => {
      const controller = new AbortController()
      const peer = launch(mode)
      const deadline = mode.startsWith('deadline') ? Date.now() + 250 : Date.now() + 2_000
      const timer = mode.startsWith('cancel')
        ? setTimeout(() => controller.abort(), 250)
        : undefined
      const start = performance.now()
      try {
        const terminal = await new RunHostSession(
          peer.process,
          {
            ...invocation(deadline),
            signal: controller.signal,
          },
          { cancellationGraceMs: 100 },
        ).run()
        expect(terminal).toMatchObject(unfenced)
        expect(terminal.diagnostics.stderr).toBe('request/cancel:host:1\n')
        expect(peer.child.signalCode).toBe(mode.endsWith('held') ? 'SIGKILL' : null)
        if (mode.endsWith('cooperative')) expect(peer.child.exitCode).toBe(0)
        expect(performance.now() - start).toBeLessThan(1_500)
      } finally {
        clearTimeout(timer)
        await peer.dispose()
      }
    })
  }
  test('rejects scalar invocation settings before writing to a real child', async () => {
    const peer = launch('eof')
    try {
      expect(
        () =>
          new RunHostSession(peer.process, {
            ...invocation(),
            settings: 1,
          } as unknown as RunHostInvocation),
      ).toThrow('settings must be an object')
    } finally {
      await peer.dispose()
    }
  })
  test('rejects unknown attachment members before writing to a real child', async () => {
    const peer = launch('eof')
    try {
      expect(
        () =>
          new RunHostSession(peer.process, {
            ...invocation(),
            attachments: { source: { path: '/source', access: 'read', extra: true } },
          } as unknown as RunHostInvocation),
      ).toThrow('path, access and optional read artifact')
    } finally {
      await peer.dispose()
    }
  })
})
