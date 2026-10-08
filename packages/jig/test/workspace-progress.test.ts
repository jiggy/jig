import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RootAdministrationError } from '../src/administration/root.js'
import { main, privateCliCommandLifetimeMs } from '../src/cli.js'
import { PrivateCliProgress } from '../src/cli-progress.js'
import { privateAttentionReceipt } from '../src/cli-run-model.js'
import {
  PRIVATE_PRESENTATION_CLOSE_RESERVE_MS,
  PRIVATE_PRESENTATION_DEADLINE_ENV,
  privateConstrainPresentationDeadline,
  privatePresentationDeadline,
  privatePresentationNow,
  privateRootlessCommandLifetime,
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

test('only effective interactive dashboard selection omits the default command envelope', () => {
  const dashboard = ['run', 'flow:flows/work', '--display', 'dashboard']
  expect(privateCliCommandLifetimeMs(dashboard, true)).toBeNull()
  expect(privateCliCommandLifetimeMs([...dashboard, '--timeout', '1ms'], true)).toBeNull()
  expect(privateCliCommandLifetimeMs(dashboard, false)).toBe(330_000)
  for (const machine of [['--json'], ['--receive', 'events']])
    expect(privateCliCommandLifetimeMs([...dashboard, ...machine], true)).toBe(330_000)
  for (const display of ['auto', 'plain'])
    expect(
      privateCliCommandLifetimeMs(['run', 'flow:flows/work', '--display', display], true),
    ).toBe(330_000)
  expect(privateCliCommandLifetimeMs(['review'], true)).toBe(300_000)
})

test('initial refusal never borrows stdin or writes alternate-screen controls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-workspace-prerequisites-'))
  try {
    await mkdir(join(root, 'occupied'))
    await writeFile(join(root, 'input.json'), '{invalid JSON')
    const cases = [
      { name: 'unreviewed project', failure: 'acquire' },
      { name: 'missing runtime prerequisite', failure: 'acquire' },
      { name: 'review required', failure: 'start' },
      { name: 'invalid approved input', failure: 'terminal' },
      { name: 'invalid input file', args: ['--input', '@input.json'] },
      { name: 'invalid selected files', args: ['--attach', 'source=missing'] },
      { name: 'occupied output destination', args: ['--out', 'occupied'] },
    ]
    for (const scenario of cases) {
      const input = new Input()
      let stderr = '',
        closed = 0
      const code = await main(
        ['run', 'flow:flows/work', '--display', 'dashboard', ...(scenario.args ?? [])],
        {
          currentDirectory: root,
          interactive: true,
          terminalError: true,
          terminalOutput: false,
          dashboardInputStream: input as any,
          host: {
            async acquire() {
              if (scenario.failure === 'acquire') throw new Error(scenario.name)
              return {
                rootAdministration: {
                  async startRun() {
                    if (scenario.failure === 'start')
                      throw new RootAdministrationError('UNAVAILABLE', 'Review is required', {
                        code: 'ADMISSION_MISSING',
                      })
                    return { runId: 'sha256:' + 'a'.repeat(64) }
                  },
                  async runStatus() {
                    return {
                      runId: 'sha256:' + 'a'.repeat(64),
                      state: 'terminal',
                      terminal: {
                        status: 'failed',
                        code: 'INVALID_INPUT',
                        message: 'Input was refused before execution',
                        diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
                      },
                    }
                  },
                },
                async close() {
                  closed++
                },
              }
            },
          } as any,
          writeStderr: async (text) => {
            stderr += text
          },
          writeError: (text) => {
            stderr += text
          },
          writeRecord: async () => {},
          writeOutput: () => {},
        },
      )
      expect(code).not.toBe(0)
      expect(stderr).not.toContain(entered)
      expect(stderr).not.toContain(restored)
      expect(input.rawChanges).toEqual([])
      expect(input.listenerCount('data')).toBe(0)
      expect(closed).toBe(scenario.failure === 'start' || scenario.failure === 'terminal' ? 1 : 0)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('trusted root dispatch opens short no-view Runs and updates-off; machine modes stay plain', async () => {
  for (const mode of [[], ['--updates', 'off'], ['--json'], ['--receive', 'events']]) {
    const input = new Input()
    const machine = mode.includes('--json') || mode.includes('--receive')
    let stderr = '',
      stdout = '',
      closed = 0,
      settled = false
    const timeline: string[] = []
    const code = await main(['run', 'flow:flows/work', '--display', 'dashboard', ...mode], {
      currentDirectory: '/project',
      interactive: true,
      terminalError: true,
      terminalOutput: false,
      dashboardInputStream: input as any,
      host: {
        async acquire(_project: string, options: any) {
          expect(stderr).not.toContain(entered)
          expect(input.isRaw).toBeFalse()
          return {
            rootAdministration: {
              async startRun() {
                timeline.push('DISPATCH')
                expect(Boolean(options.channelOutput.dispatched)).toBe(!machine)
                options.channelOutput.dispatched?.()
                return { runId: 'sha256:' + 'a'.repeat(64) }
              },
              async runStatus() {
                return {
                  runId: 'sha256:' + 'a'.repeat(64),
                  state: 'terminal',
                  terminal: {
                    status: 'failed',
                    code: 'EXECUTION_FAILED',
                    message: 'Failure after actual dispatch',
                    diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
                  },
                }
              },
            },
            async close() {
              closed++
              timeline.push('OWNER_CLOSED')
            },
          }
        },
      } as any,
      writeStderr: async (text) => {
        stderr += text
        timeline.push(text)
        if (!settled && text.includes('Settled')) {
          settled = true
          expect(closed).toBe(1)
          expect(stdout).toBe('')
          queueMicrotask(() => input.emit('data', Buffer.from('q')))
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
      writeError: (text) => {
        stderr += text
      },
    })
    expect(code).toBe(1)
    expect(input.isRaw).toBeFalse()
    expect(closed).toBe(1)
    if (machine) {
      expect(settled).toBeFalse()
      expect(stderr).not.toContain(entered)
      expect(input.rawChanges).toEqual([])
    } else {
      expect(settled).toBeTrue()
      expect(timeline.findIndex((text) => text.includes(entered))).toBeGreaterThan(
        timeline.indexOf('DISPATCH'),
      )
      expect(timeline.indexOf('STDOUT')).toBeGreaterThan(
        timeline.findIndex((text) => text.includes(restored)),
      )
    }
    const value = JSON.parse(stdout)
    const result = machine && mode.includes('--receive') ? value.result : value
    expect(result.status).toBe('failed')
    expect(result.code).toBe('EXECUTION_FAILED')
  }
})

test('post-dispatch observation failure keeps read-only evidence and cleanup uncertainty until exit', async () => {
  for (const closeFails of [false, true]) {
    const input = new Input()
    let stderr = '',
      stdout = '',
      closed = 0,
      settled = false
    const code = await main(['run', 'flow:flows/work', '--display', 'dashboard'], {
      currentDirectory: '/project',
      interactive: true,
      terminalError: true,
      terminalOutput: false,
      dashboardInputStream: input as any,
      host: {
        async acquire(_project: string, options: any) {
          options.channelOutput.diagnostic(Buffer.from('EARLY_RETAINED_DIAGNOSTIC\n'), [])
          expect(stderr).not.toContain(entered)
          return {
            rootAdministration: {
              async startRun() {
                options.channelOutput.dispatched()
                return { runId: 'sha256:' + 'a'.repeat(64) }
              },
              async runStatus() {
                throw new RootAdministrationError('UNAVAILABLE', 'private observation failure')
              },
            },
            async close() {
              closed++
              if (closeFails) throw new Error('private close failure')
            },
          }
        },
      } as any,
      writeStderr: async (text) => {
        stderr += text
        if (!settled && text.includes('Settled')) {
          settled = true
          expect(closed).toBe(1)
          expect(text).toContain('execution: unknown')
          expect(text).toContain(closeFails ? 'cleanup: unconfirmed' : 'cleanup: complete')
          expect(stdout).toBe('')
          queueMicrotask(() => input.emit('data', Buffer.from('q')))
        }
      },
      writeError: (text) => {
        stderr += text
      },
      writeOutput: (text) => {
        stdout += text
      },
      writeRecord: async (text) => {
        stdout += text
      },
    })
    expect(code).toBe(2)
    expect(settled).toBeTrue()
    expect(stdout).toBe('')
    expect(stderr.slice(stderr.indexOf(entered), stderr.indexOf(restored))).toContain(
      'EARLY_RETAINED_DIAGNOSTIC',
    )
    expect(stderr).not.toContain('private observation failure')
    expect(stderr).not.toContain('private close failure')
    expect(input.isRaw).toBeFalse()
    expect(input.listenerCount('data')).toBe(0)
  }
})

test('immutable inspection is enabled before delivery preparation and delayed screen entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-workspace-delivery-'))
  try {
    const input = new Input()
    let inspection = false,
      stderr = '',
      stdout = '',
      settled = false
    const code = await main(
      ['run', 'flow:flows/work', '--display', 'dashboard', '--out', 'result'],
      {
        currentDirectory: root,
        interactive: true,
        terminalError: true,
        terminalOutput: false,
        dashboardInputStream: input as any,
        host: {
          delivery: {
            enableInspection() {
              inspection = true
              expect(stderr).not.toContain(entered)
            },
            async prepare() {
              expect(inspection).toBeTrue()
              expect(stderr).not.toContain(entered)
            },
            async publish() {
              expect(inspection).toBeTrue()
              return { status: 'written', destination: join(root, 'result'), files: [] }
            },
          },
          async acquire(_project: string, options: any) {
            return {
              rootAdministration: {
                async startRun() {
                  options.channelOutput.dispatched()
                  return { runId: 'sha256:' + 'a'.repeat(64) }
                },
                async runStatus() {
                  return {
                    runId: 'sha256:' + 'a'.repeat(64),
                    state: 'terminal',
                    terminal: {
                      status: 'succeeded',
                      outcome: 'done',
                      output: null,
                      diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
                    },
                  }
                },
              },
              async close() {},
            }
          },
        } as any,
        writeStderr: async (text) => {
          stderr += text
          if (!settled && text.includes('Settled')) {
            settled = true
            expect(text).toContain('Delivery written')
            queueMicrotask(() => input.emit('data', Buffer.from('q')))
          }
        },
        writeError: (text) => {
          stderr += text
        },
        writeOutput: (text) => {
          stdout += text
        },
        writeRecord: async (text) => {
          stdout += text
        },
      },
    )
    expect(code).toBe(0)
    expect(settled).toBeTrue()
    expect(JSON.parse(stdout).delivery.status).toBe('written')
    expect(input.isRaw).toBeFalse()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an expanded-report failure keeps its known terminal open until the operator leaves', async () => {
  const input = new Input()
  const terminal = {
    status: 'succeeded',
    outcome: 'done',
    output: ['x'.repeat(8 * 1024 * 1024), 'y'.repeat(8 * 1024 * 1024 - 1024)],
    diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
  }
  let stderr = '',
    stdout = '',
    settled = false,
    closed = 0
  const code = await main(['run', 'flow:flows/work', '--display', 'dashboard'], {
    currentDirectory: '/project',
    interactive: true,
    terminalError: true,
    terminalOutput: false,
    dashboardInputStream: input as any,
    host: {
      async acquire(_project: string, options: any) {
        return {
          rootAdministration: {
            async startRun() {
              options.channelOutput.dispatched()
              options.channelOutput.diagnostic(Buffer.from('d'.repeat(4096)), [])
              return { runId: 'sha256:' + 'a'.repeat(64) }
            },
            async runStatus() {
              return { runId: 'sha256:' + 'a'.repeat(64), state: 'terminal', terminal }
            },
          },
          async close() {
            closed++
          },
        }
      },
    } as any,
    writeStderr: async (text) => {
      stderr += text
      if (!settled && text.includes('Settled')) {
        settled = true
        expect(closed).toBe(1)
        expect(text).toContain('Execution succeeded')
        expect(stdout).toBe('')
        queueMicrotask(() => input.emit('data', Buffer.from('q')))
      }
    },
    writeError: (text) => {
      stderr += text
    },
    writeOutput: (text) => {
      stdout += text
    },
    writeRecord: async (text) => {
      stdout += text
    },
  })
  expect(code).toBe(2)
  expect(settled).toBeTrue()
  expect(JSON.parse(stdout).output).toEqual(terminal.output)
  expect(stderr).toContain('JIG_REPORT_LIMIT')
  expect(input.isRaw).toBeFalse()
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
  test('an expired constraint retains its meaning across owned Bun reexecution', async () => {
    const deadline = privateConstrainPresentationDeadline(
      {},
      PRIVATE_PRESENTATION_CLOSE_RESERVE_MS + 75,
    )
    await pause(150)
    const moduleUrl = new URL('../src/internal/root-run-timeout-policy.ts', import.meta.url).href
    const child = Bun.spawn(
      [
        process.execPath,
        '--eval',
        `import { privatePresentationNow, privatePresentationDeadline, privateConstrainPresentationDeadline } from ${JSON.stringify(moduleUrl)};
console.log(JSON.stringify({ now: privatePresentationNow(), inherited: privatePresentationDeadline(process.env), constrained: privateConstrainPresentationDeadline(process.env, 60_000) }));`,
      ],
      {
        env: { ...process.env, [PRIVATE_PRESENTATION_DEADLINE_ENV]: String(deadline) },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    try {
      const [output, error, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(code).toBe(0)
      expect(error).toBe('')
      const observation = JSON.parse(output)
      expect(observation.inherited).toBe(deadline)
      expect(observation.constrained).toBe(deadline)
      expect(observation.now).toBeGreaterThan(deadline)
    } finally {
      clearTimeout(timer)
      if (child.exitCode === null) child.kill('SIGKILL')
      await child.exited
    }
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
  })
})

describe('one command-owned workspace', () => {
  test('settled inspection has no idle or absolute cap; an explicit command deadline remains fixed', async () => {
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
        now = inherited === undefined ? 21_600_100 : 89_999
        input.emit('data', Buffer.from('?'))
        input.emit('data', Buffer.from('\u001b'))
        await pause(40)
        expect(input.isRaw).toBeTrue()
        expect(progress.model.workspace.phase).toBe('settled')
        if (inherited === undefined) input.emit('data', Buffer.from('q'))
        else {
          now = inherited
          input.emit('data', Buffer.from('\t'))
        }
        await settling
        expect(input.isRaw).toBeFalse()
      } finally {
        progress.close()
        await progress.flush()
      }
    }
  })
  test('a queued key cannot evade an expired explicit enclosing deadline', async () => {
    let now = 100
    const input = new Input()
    const progress = workspace(async () => {}, { now: () => now, deadline: 60_100 })
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
    const progress = workspace(async () => {}, { now: () => 100 })
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
  test('an already expired enclosing command deadline skips entry and cannot restart at settlement', async () => {
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
  test('without an enclosing deadline, settled results wait for operator exit', async () => {
    let text = ''
    const input = new Input(),
      stop = new AbortController()
    const progress = workspace(
      (chunk) => {
        text += chunk
      },
      { signal: stop.signal, now: () => 100 },
    )
    await progress.configureDisplay('dashboard', true, input as any)
    const settling = progress.settleDashboard({
      status: 'succeeded',
      outcome: 'done',
      output: null,
    })
    await pause()
    expect(input.isRaw).toBeTrue()
    input.emit('data', Buffer.from('q'))
    await settling
    expect(input.isRaw).toBeFalse()
    expect(stop.signal.aborted).toBeFalse()
    expect(text).not.toContain('command lifetime limits dashboard inspection')
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
  test('resize below minimum restores the terminal once without drawing imaginary rows', async () => {
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
          return {
            rootAdministration: {
              async startRun() {
                options.channelOutput.dispatched()
                options.channelOutput.diagnostic(Buffer.from(diagnostic), [])
                const source = options.channelOutput.updates.open('updates')
                source.accept({
                  kind: 'view',
                  id: 'view',
                  title: 'Application view',
                  summary: 'SUMMARY_SHOULD_NOT_REPLAY',
                  sections: [],
                })
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
