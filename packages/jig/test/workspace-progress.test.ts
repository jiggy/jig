import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { PrivateCliProgress } from '../src/cli-progress.js'
import { privateAttentionReceipt } from '../src/cli-run-model.js'
import {
  PRIVATE_MAX_SETTLED_INSPECTION_MS,
  PRIVATE_PRESENTATION_CLOSE_RESERVE_MS,
  PRIVATE_PRESENTATION_DEADLINE_ENV,
  PRIVATE_SETTLED_INSPECTION_MS,
  privateConstrainPresentationDeadline,
  privateInspectionHardDeadline,
  privatePresentationDeadline,
  privatePresentationNow,
  privateRefreshInspectionDeadline,
  privateRootlessCommandLifetime,
  privateSettledInspectionDeadline,
} from '../src/internal/root-run-timeout-policy.js'

class Input extends EventEmitter {
  isRaw = false
  readableFlowing: boolean | null = null
  rawChanges: boolean[] = []
  paused = false
  throwRaw = false
  isPaused() {
    return this.paused
  }
  setRawMode(value: boolean) {
    this.rawChanges.push(value)
    this.isRaw = value
    if (this.throwRaw && value) throw new Error('raw setup failed')
    return this
  }
  resume() {
    this.paused = false
    this.readableFlowing = true
    return this
  }
  pause() {
    this.paused = true
    this.readableFlowing = false
    return this
  }
}
const entered = '\u001b[?1049h'
const restored = '\u001b[?1049l'
const pause = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
const priorTerm = process.env.TERM
beforeAll(() => {
  process.env.TERM = 'xterm-256color'
})
afterAll(() => {
  if (priorTerm === undefined) delete process.env.TERM
  else process.env.TERM = priorTerm
})
function workspace(
  write: (text: string) => void | Promise<void>,
  options: {
    signal?: AbortSignal
    deadline?: number
    now?: () => number
    platform?: NodeJS.Platform
    columns?: () => number
    rows?: () => number
  } = {},
) {
  const progress = new PrivateCliProgress(
    true,
    write,
    options.signal,
    false,
    options.columns ?? (() => 80),
    (text) => text,
    {
      presentationDeadline: options.deadline,
      clock: options.now,
      platform: options.platform ?? 'darwin',
      rows: options.rows ?? (() => 24),
    },
  )
  progress.model.configureWorkspace({
    target: 'binding:actual',
    limitMs: 123_000,
    startedAt: options.now?.() ?? 100,
  })
  return progress
}

describe('private presentation deadline', () => {
  test('accepted navigation refreshes only unexpired idle time inside immutable inspection bounds', () => {
    expect(PRIVATE_MAX_SETTLED_INSPECTION_MS).toBe(300_000)
    expect(privateInspectionHardDeadline(undefined, 'linux', 100, true)).toBe(300_100)
    expect(privateInspectionHardDeadline(undefined, 'linux', 100)).toBe(100)
    expect(privateRefreshInspectionDeadline(60_100, 300_100, 60_099)).toBe(120_099)
    expect(privateRefreshInspectionDeadline(60_100, 300_100, 60_100)).toBeUndefined()
    expect(privateRefreshInspectionDeadline(300_100, 300_100, 300_100)).toBeUndefined()
    expect(privateRefreshInspectionDeadline(60_100, 60_100, 59_999)).toBe(60_100)
  })
  test('enclosing timers seed the earliest close bound once and preserve inherited time', () => {
    expect(PRIVATE_PRESENTATION_CLOSE_RESERVE_MS).toBe(45_000)
    const first = privateConstrainPresentationDeadline({}, 330_000, 1_000)
    expect(first).toBe(286_000)
    const environment = { [PRIVATE_PRESENTATION_DEADLINE_ENV]: String(first) }
    expect(privateConstrainPresentationDeadline(environment, 330_000, 90_000)).toBe(first)
    expect(privateConstrainPresentationDeadline(environment, 60_000, 100_000)).toBe(115_000)
    expect(privateConstrainPresentationDeadline(environment, 30_000, 100_000)).toBe(85_000)
    expect(privateRootlessCommandLifetime(30_000)).toBe(330_000)
  })
  test('invalid or missing private values confer no presentation allowance', () => {
    for (const text of ['', '-1', '1.5', 'NaN', 'Infinity', '01', '9007199254740992', ' 1'])
      expect(
        privatePresentationDeadline({ [PRIVATE_PRESENTATION_DEADLINE_ENV]: text }),
      ).toBeUndefined()
    expect(privateSettledInspectionDeadline(undefined, 'linux', 100)).toBe(100)
    expect(privateSettledInspectionDeadline(undefined, 'darwin', 100)).toBe(
      100 + PRIVATE_SETTLED_INSPECTION_MS,
    )
    expect(privateSettledInspectionDeadline(200, 'darwin', 100)).toBe(200)
    expect(privateSettledInspectionDeadline(50, 'linux', 100)).toBe(50)
  })
  test('the host clock is monotonic and a shorter file-owner deadline dominates delegation', () => {
    const before = privatePresentationNow(),
      after = privatePresentationNow()
    expect(after).toBeGreaterThanOrEqual(before)
    const file = privateConstrainPresentationDeadline({}, 120_000, 100_000)
    expect(file).toBe(175_000)
    const delegated = privateConstrainPresentationDeadline(
      { [PRIVATE_PRESENTATION_DEADLINE_ENV]: String(file) },
      330_000,
      130_000,
    )
    expect(delegated).toBe(file)
    const settled = privateSettledInspectionDeadline(delegated, 'linux', 170_000)
    expect(settled).toBe(175_000)
  })
})

describe('one bounded workspace lease', () => {
  test('actual accepted keys extend settled idle inspection but never its five-minute or inherited bound', async () => {
    for (const inherited of [undefined, 90_000]) {
      let now = 100
      const input = new Input()
      const progress = workspace(async () => {}, { now: () => now, deadline: inherited })
      try {
        await progress.configureDisplay('dashboard', true, input as any)
        const settling = progress.settleDashboard({
          status: 'succeeded',
          outcome: 'literal',
          output: null,
        })
        await pause()
        expect(progress.model.workspace.inspectionDeadline).toBe(60_100)
        const hard = inherited ?? 300_100
        expect(progress.model.workspace.inspectionHardDeadline).toBe(hard)
        now = 59_100
        input.emit('data', Buffer.from('?'))
        expect(progress.model.workspace.inspectionDeadline).toBe(Math.min(119_100, hard))
        now = 61_000
        input.emit('data', Buffer.from('\u001b'))
        await pause(40)
        expect(input.isRaw).toBeTrue()
        let last = progress.model.workspace.inspectionDeadline!
        input.emit('data', Buffer.from('\u001b[999A'))
        expect(progress.model.workspace.inspectionDeadline).toBe(last)
        while (now + 30_000 < hard) {
          now += 30_000
          input.emit('data', Buffer.from('\t'))
          last = Math.min(now + 60_000, hard)
          expect(progress.model.workspace.inspectionDeadline).toBe(last)
        }
        now = hard
        input.emit('data', Buffer.from('\t'))
        await settling
        expect(input.isRaw).toBeFalse()
        expect(progress.model.workspace.inspectionDeadline).toBe(last)
      } finally {
        progress.close()
        await progress.flush()
      }
    }
  })
  test('a queued key at idle expiry cannot resurrect the screen before the timer callback runs', async () => {
    let now = 100
    const input = new Input()
    const progress = workspace(async () => {}, { now: () => now })
    try {
      await progress.configureDisplay('dashboard', true, input as any)
      const settling = progress.settleDashboard({
        status: 'succeeded',
        outcome: 'literal',
        output: null,
      })
      await pause()
      now = 60_100
      input.emit('data', Buffer.from('?'))
      await settling
      expect(input.isRaw).toBeFalse()
      expect(progress.model.workspace.inspectionDeadline).toBe(60_100)
      expect(progress.model.workspace.facts?.application).toBe('"literal"')
    } finally {
      progress.close()
      await progress.flush()
    }
  })
  test('standalone Linux inspection owns recorded data only and closes keyboard Ctrl-C without a cancellation signal', async () => {
    const input = new Input()
    let signals = 0
    const interrupted = () => {
      signals++
    }
    process.on('SIGINT', interrupted)
    const progress = workspace(async () => {}, { platform: 'linux', now: () => 100 })
    const packet = {
      directory: '/selected/packet',
      record: { status: 'failed', code: 'recorded', message: 'recorded cause' },
      files: [],
      complete: true,
      reportPreview: () => ({ text: '{"status":"failed"}', bytes: 19, clipped: false }),
      preview: () => undefined,
      close: () => {},
    }
    try {
      const inspecting = progress.inspectSavedResult(packet, true, input as any)
      await pause()
      expect(input.isRaw).toBeTrue()
      expect(progress.model.workspace.inspectionDeadline).toBe(60_100)
      expect(progress.model.workspace.inspectionHardDeadline).toBe(300_100)
      expect(progress.model.workspace.recorded).toBeTrue()
      expect(progress.model.calls.size).toBe(0)
      input.emit('data', Buffer.from([3]))
      await inspecting
      expect(signals).toBe(0)
      expect(input.isRaw).toBeFalse()
    } finally {
      process.removeListener('SIGINT', interrupted)
      progress.close()
      await progress.flush()
    }
  })
  test('a physical zero-column terminal is not replaced with an eighty-column workspace', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stderr, 'columns')
    let text = ''
    const input = new Input()
    Object.defineProperty(process.stderr, 'columns', { configurable: true, value: 0 })
    const progress = new PrivateCliProgress(
      true,
      (chunk) => {
        text += chunk
      },
      undefined,
      false,
    )
    try {
      await progress.configureDisplay('dashboard', true, input as any)
      await progress.closeWorkspace()
      await progress.flush()
      expect(progress.workspaceActive).toBeFalse()
      expect(input.isRaw).toBeFalse()
      expect(text).toContain('terminal size')
      expect(text).toContain(restored)
      expect(text).not.toContain('Jig · Run')
    } finally {
      progress.close()
      await progress.flush()
      if (descriptor) Object.defineProperty(process.stderr, 'columns', descriptor)
      else delete (process.stderr as any).columns
    }
  })
  test('an already expired private lease skips entry and cannot restart at settlement', async () => {
    let text = ''
    const input = new Input()
    const progress = workspace(
      (chunk) => {
        text += chunk
      },
      { deadline: 99, now: () => 100 },
    )
    await progress.configureDisplay('dashboard', true, input as any)
    await progress.settleDashboard({ status: 'succeeded', outcome: 'done', output: null })
    expect(text).not.toContain(entered)
    expect(input.rawChanges).toEqual([])
    expect(progress.workspaceUsed).toBeFalse()
    expect(text).toContain('Command lifetime limits')
    progress.close()
    await progress.flush()
  })
  test('interruption racing entry awaits restoration and never acquires stranded input', async () => {
    const chunks: string[] = [],
      input = new Input(),
      stop = new AbortController()
    let release!: () => void,
      first = true
    const progress = workspace(
      async (text) => {
        chunks.push(text)
        if (first) {
          first = false
          await new Promise<void>((resolve) => {
            release = resolve
          })
        }
      },
      { signal: stop.signal },
    )
    const opening = progress.configureDisplay('dashboard', true, input as any)
    await pause()
    stop.abort()
    expect(input.isRaw).toBeFalse()
    release()
    await opening
    await progress.flush()
    expect(chunks.join('')).toContain(restored)
    expect(input.listenerCount('data')).toBe(0)
    expect(chunks.join('').match(/work continues/g)).toBeNull()
    progress.close()
    await progress.flush()
  })
  test('live batched Ctrl-C requests cancellation once and EOF only leaves', async () => {
    for (const eof of [false, true]) {
      const input = new Input(),
        stop = new AbortController()
      let signals = 0
      const progress = workspace(async () => {}, { signal: stop.signal })
      const interrupted = () => {
        signals++
        stop.abort()
      }
      process.on('SIGINT', interrupted)
      try {
        await progress.configureDisplay('dashboard', true, input as any)
        if (eof) input.emit('end')
        else input.emit('data', Buffer.from([3, 3, 3]))
        await progress.flush()
        expect(signals).toBe(eof ? 0 : 1)
        expect(stop.signal.aborted).toBe(!eof)
        expect(input.isRaw).toBeFalse()
        expect(input.listenerCount('data')).toBe(0)
      } finally {
        process.removeListener('SIGINT', interrupted)
        progress.close()
        await progress.flush()
      }
    }
  })
  test('awaits screen entry before input ownership and restores before complete receipts', async () => {
    const chunks: string[] = []
    let release!: () => void
    let first = true
    const input = new Input()
    const progress = workspace(async (text) => {
      chunks.push(text)
      if (first) {
        first = false
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
    })
    const opening = progress.configureDisplay('dashboard', true, input as any)
    await pause()
    expect(chunks.join('')).toContain(entered)
    expect(input.isRaw).toBeFalse()
    expect(input.listenerCount('data')).toBe(0)
    release()
    await opening
    expect(input.isRaw).toBeTrue()
    progress.stage('Preparing actual target')
    progress.notice('Host note in workspace\n')
    progress.diagnostic('literal diagnostic\n', ['real-operation'])
    const source = progress.observe('updates', true)
    source.accept({ kind: 'notice', text: 'routine Flow notice' })
    source.accept({
      kind: 'notice',
      severity: 'error',
      text: 'essential\u001b[31m cause\ncomplete tail',
    })
    await progress.flush()
    const receipt = progress.model.attention.find((cause) => cause.text.startsWith('essential'))!
    expect(receipt.committed).toBeFalse()
    expect(
      progress.model.journal.some((entry) => entry.operationsPath?.[0] === 'real-operation'),
    ).toBeTrue()
    input.emit('data', Buffer.from('q'))
    expect(input.isRaw).toBeFalse()
    expect(input.isPaused()).toBeTrue()
    expect(input.listenerCount('data')).toBe(0)
    await progress.flush()
    const output = chunks.join('')
    expect(output.indexOf(restored)).toBeLessThan(output.indexOf(privateAttentionReceipt(receipt)))
    expect(receipt.committed).toBeTrue()
    expect(output).toContain('work continues')
    expect(output.split(restored)).toHaveLength(2)
    expect(output.slice(output.indexOf(restored))).not.toContain('routine Flow notice')
    await progress.settleDashboard({ status: 'succeeded', outcome: 'done', output: null })
    expect(chunks.join('').split(entered)).toHaveLength(2)
    progress.close()
    await progress.flush()
  })
  test('raw setup failure restores mutated input and uses ordinary fallback', async () => {
    let text = ''
    const input = new Input()
    input.throwRaw = true
    const progress = workspace((chunk) => {
      text += chunk
    })
    await progress.configureDisplay('dashboard', true, input as any)
    await progress.flush()
    expect(input.isRaw).toBeFalse()
    expect(input.isPaused()).toBeTrue()
    expect(input.listenerCount('data')).toBe(0)
    expect(text).toContain(restored)
    expect(text).toContain('input unavailable')
    progress.close()
    await progress.flush()
  })
  test('input snapshot failure explains fallback before any screen or raw acquisition', async () => {
    let text = ''
    const input = new Input()
    input.isPaused = () => {
      throw new Error('input state unavailable')
    }
    const progress = workspace((chunk) => {
      text += chunk
    })
    await progress.configureDisplay('dashboard', true, input as any)
    await progress.flush()
    expect(input.rawChanges).toEqual([])
    expect(input.listenerCount('data')).toBe(0)
    expect(text).not.toContain(entered)
    expect(text.split('input unavailable')).toHaveLength(2)
    progress.close()
    await progress.flush()
  })
  test('live lifetime expiry leaves input and continues work without cancellation or reentry', async () => {
    let now = 100,
      text = ''
    const stop = new AbortController(),
      input = new Input()
    const progress = workspace(
      (chunk) => {
        text += chunk
      },
      { signal: stop.signal, now: () => now, deadline: 105 },
    )
    await progress.configureDisplay('dashboard', true, input as any)
    progress.stage('Work still owned by execution')
    now = 106
    await pause(10)
    await progress.flush()
    expect(stop.signal.aborted).toBeFalse()
    expect(input.isRaw).toBeFalse()
    expect(text).toContain('work continues')
    await progress.settleDashboard({ status: 'succeeded', outcome: 'done', output: null })
    expect(text.split(entered)).toHaveLength(2)
    progress.close()
    await progress.flush()
  })
  test('Linux without reliable enclosing lifetime immediately releases settled presentation', async () => {
    let text = ''
    const input = new Input(),
      stop = new AbortController()
    const progress = workspace(
      (chunk) => {
        text += chunk
      },
      { signal: stop.signal, platform: 'linux', now: () => 100 },
    )
    await progress.configureDisplay('dashboard', true, input as any)
    await progress.settleDashboard({ status: 'succeeded', outcome: 'done', output: null })
    expect(input.isRaw).toBeFalse()
    expect(stop.signal.aborted).toBeFalse()
    expect(text).toContain('Results settled; command lifetime limits dashboard inspection')
    expect(text).not.toContain('Cancellation requested')
    progress.close()
    await progress.flush()
  })
  test('settled keyboard Ctrl-C leaves without cancellation; external abort preserves frozen facts', async () => {
    for (const external of [false, true]) {
      let text = '',
        signals = 0
      const input = new Input(),
        stop = new AbortController()
      const progress = workspace(
        (chunk) => {
          text += chunk
        },
        { signal: stop.signal, now: () => 100 },
      )
      const interrupted = () => {
        signals++
        stop.abort()
      }
      process.on('SIGINT', interrupted)
      try {
        await progress.configureDisplay('dashboard', true, input as any)
        const record = { status: 'succeeded', outcome: 'frozen', output: null }
        const settling = progress.settleDashboard(record)
        await pause()
        if (external) stop.abort()
        else input.emit('data', Buffer.from([3, 3]))
        await settling
        expect(input.isRaw).toBeFalse()
        expect(text).not.toContain('Cancellation requested')
        expect(record).toEqual({ status: 'succeeded', outcome: 'frozen', output: null })
        expect(signals).toBe(0)
      } finally {
        process.removeListener('SIGINT', interrupted)
        progress.close()
        await progress.flush()
      }
    }
  })
  test('output loss synchronously releases input and cannot commit undelivered receipts', async () => {
    let fail = false
    const cause = new Error('output gone'),
      input = new Input()
    const progress = workspace(async () => {
      if (fail) throw cause
    })
    await progress.configureDisplay('dashboard', true, input as any)
    progress.model.addAttention('Jig', 'required failure cause', 4, false)
    fail = true
    input.emit('data', Buffer.from('q'))
    await expect(progress.flush()).rejects.toBe(cause)
    expect(input.isRaw).toBeFalse()
    expect(input.listenerCount('data')).toBe(0)
    expect(progress.model.attention[0]!.committed).toBeFalse()
    progress.close()
    await expect(progress.flush()).rejects.toBe(cause)
  })
  test('complete maximum escaped causes drain in awaited 32KiB batches', async () => {
    const chunks: string[] = []
    let inFlight = 0,
      maximum = 0
    let now = 100_000
    const hardExpiry = now + 330_000
    const deadline = privateConstrainPresentationDeadline({}, 330_000, now)
    const input = new Input()
    const progress = workspace(
      async (text) => {
        inFlight++
        maximum = Math.max(maximum, inFlight)
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(32_768)
        await pause(1)
        // A successful installed write may consume almost its one-second timeout.
        // Advance the injected host clock without waiting for a native transport.
        now += 999
        chunks.push(text)
        inFlight--
      },
      { deadline, now: () => now },
    )
    await progress.configureDisplay('dashboard', true, input as any)
    for (let i = 0; i < 120; i++)
      progress.model.addAttention(`Flow ${i}`, '\u0001'.repeat(650) + ` tail ${i}`, 2, false)
    const hostPrefixBytes = Buffer.byteLength(
      privateAttentionReceipt({ source: 'Jig', text: '', priority: 4 }),
    )
    const remaining = 524_288 - progress.model.attentionBytes - hostPrefixBytes
    expect(progress.model.addAttention('Jig', 'x'.repeat(remaining), 4, false)).toBeTrue()
    const receipts = progress.model.attention
      .map((cause) => privateAttentionReceipt(cause))
      .join('')
    expect(Buffer.byteLength(receipts)).toBe(524_288)
    now = deadline - 1
    input.emit('data', Buffer.from('q'))
    await progress.flush()
    expect(chunks.join('')).toContain(receipts)
    expect(progress.model.attention.every((cause) => cause.committed)).toBeTrue()
    expect(maximum).toBe(1)
    const restoreIndex = chunks.findIndex((chunk) => chunk.includes(restored))
    expect(
      chunks.slice(restoreIndex + 1).filter((chunk) => !chunk.includes('work continues')),
    ).toHaveLength(16)
    expect(hardExpiry - now).toBeGreaterThan(10_000)
    expect(
      chunks.filter((chunk) => chunk.includes('Flow') || chunk.includes('tail')).length,
    ).toBeLessThanOrEqual(16)
    progress.close()
    await progress.flush()
  })
  test('resize below minimum releases the lease once without drawing imaginary rows', async () => {
    let columns = 80,
      rows = 24,
      text = ''
    const input = new Input()
    const progress = workspace(
      (chunk) => {
        text += chunk
      },
      { columns: () => columns, rows: () => rows },
    )
    await progress.configureDisplay('dashboard', true, input as any)
    columns = 10
    rows = 1
    process.stderr.emit('resize')
    await pause(210)
    await progress.flush()
    expect(input.isRaw).toBeFalse()
    expect(text).toContain('terminal size')
    columns = 80
    rows = 24
    process.stderr.emit('resize')
    await progress.flush()
    expect(text.split(entered)).toHaveLength(2)
    progress.close()
    await progress.flush()
  })
})

test('fullscreen final reporting preserves full bounded diagnostics and frozen signal outcomes', async () => {
  const { main } = await import('../src/cli.js')
  for (const human of [false, true])
    for (const external of [false, true]) {
      const input = new Input(),
        stop = new AbortController()
      let stderr = '',
        stdout = '',
        closed = 0,
        sent = false
      const timeline: string[] = []
      const diagnostic = '\u0001'.repeat(4096) + ' COMPLETE_FINAL_DIAGNOSTIC\n'
      const terminal = {
        status: 'succeeded',
        outcome: 'frozen-domain-claim',
        output: null,
        diagnostics: {
          stderr: diagnostic,
          stderrBytes: Buffer.byteLength(diagnostic),
          stderrTruncated: false,
        },
      }
      const host = {
        async acquire(_project: string, options: any) {
          options.channelOutput.diagnostic(Buffer.from(diagnostic), [])
          const source = options.channelOutput.updates.open('updates')
          source.accept({
            kind: 'view',
            id: 'view',
            title: 'Application view',
            summary: 'SUMMARY_SHOULD_NOT_REPLAY',
            sections: [],
          })
          return {
            rootAdministration: {
              async startRun() {
                return { runId: 'sha256:' + 'a'.repeat(64) }
              },
              async runStatus() {
                return {
                  runId: 'sha256:' + 'a'.repeat(64),
                  submissionId: 'private',
                  target: { kind: 'flow', path: 'flows/work' },
                  state: 'terminal',
                  terminal,
                }
              },
            },
            async close() {
              closed++
            },
          }
        },
      }
      const code = await main(
        ['run', 'flow:flows/work', '--display', 'dashboard', '--timeout', '123s'],
        {
          host: host as any,
          currentDirectory: '/project',
          interactive: true,
          terminalError: true,
          terminalOutput: human,
          dashboardInputStream: input as any,
          signal: stop.signal,
          writeStderr: async (text) => {
            stderr += text
            timeline.push(text)
            if (!sent && text.includes('Settled')) {
              sent = true
              queueMicrotask(() => {
                if (external) stop.abort()
                else input.emit('data', Buffer.from([3]))
              })
            }
          },
          writeRecord: async (text) => {
            stdout += text
            timeline.push('STDOUT')
          },
          writeOutput: (text) => {
            stdout += text
            timeline.push('STDOUT')
          },
        },
      )
      expect(sent).toBeTrue()
      expect(code).toBe(external ? 2 : 0)
      expect(input.isRaw).toBeFalse()
      expect(input.listenerCount('data')).toBe(0)
      expect(closed).toBe(1)
      expect(stderr).not.toContain('Cancellation requested')
      const restoreAt = timeline.findIndex((item) => item.includes(restored))
      const stdoutAt = timeline.indexOf('STDOUT')
      expect(restoreAt).toBeGreaterThanOrEqual(0)
      expect(stdoutAt).toBeGreaterThan(restoreAt)
      expect(stderr.slice(stderr.indexOf(restored))).not.toContain('SUMMARY_SHOULD_NOT_REPLAY')
      expect(stdout).toContain('COMPLETE_FINAL_DIAGNOSTIC')
      if (human) {
        expect(stdout).toContain('\\u0001'.repeat(4096))
        expect(stdout).not.toContain('already shown live')
      } else {
        const record = JSON.parse(stdout)
        expect(record.status).toBe('succeeded')
        expect(record.outcome).toBe('frozen-domain-claim')
        expect(record.command).toBeUndefined()
        expect(record.runDiagnostics.entries[0].stderr).toBe(diagnostic)
      }
    }
})
