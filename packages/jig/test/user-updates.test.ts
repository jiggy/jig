import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { USER_UPDATES_CONTRACT } from '@jigging/user-updates'
import { parseChannelContract } from '../src/channel-contract.js'
import { PrivateCliProgress } from '../src/cli-progress.js'
import { privateTerminalWidth } from '../src/cli-user-updates.js'
import { type PrivateRunChannelOutput, PrivateRunChannels } from '../src/internal/run-channels.js'
import type { JsonValue } from '../src/json.js'
import type { CapturedPackage } from '../src/package/capture.js'
import type { InspectedPackage } from '../src/package/inspect.js'
import { parseProjectEntrypoint, resolveProjectEntrypoint } from '../src/project/entrypoint.js'
import { ChannelBroker, type ResolvedChannelContract } from '../src/run/channels.js'
import { parseRun } from '../src/run-arguments.js'

const bytes = readFileSync(new URL('../../user-updates/src/user-updates.json', import.meta.url))
const parsed = parseChannelContract(bytes)
const contract: ResolvedChannelContract = {
  identity: USER_UPDATES_CONTRACT,
  schema: parsed.descriptor.item,
  validate(value) {
    parsed.itemSchema.validate(value)
  },
}
const ports = { updates: { direction: 'send' as const, required: false, contract } }
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function screen(text: string) {
  let output = ''
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Model only the presenter's exact SGR and line-clear sequences.
  for (const part of text.replace(/\u001b\[[0-9;]*m/g, '').split(/(\r\u001b\[2K)/))
    output = part === '\r\u001b[2K' ? output.slice(0, output.lastIndexOf('\n') + 1) : output + part
  return output
}

test('CLI-only presentation preserves sixteen application allocations and cannot replenish rights', async () => {
  for (const automatic of [false, true]) {
    const broker = new ChannelBroker()
    const command = broker.participant('command')
    const root = broker.participant('root')
    if (automatic) {
      const presentation = broker.createPresentation(command, ports)
      command.release(presentation.receive.endpoint)
      expect(() => broker.createPresentation(command, ports)).toThrow('allocation limit')
      expect(() => broker.createPresentation(root, ports)).toThrow('only the command')
    }
    for (let i = 0; i < 16; i++) await root.create()
    await expect(root.create()).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' })
    broker.abort()
  }
  const broker = new ChannelBroker()
  const command = broker.participant('command')
  expect(() =>
    broker.createPresentation(command, { updates: { ...ports.updates, required: true } }),
  ).toThrow('one exact optional')
  expect(() =>
    broker.createPresentation(command, {
      updates: {
        ...ports.updates,
        contract: { ...contract, identity: { ...contract.identity, digest: 'changed' } },
      },
    }),
  ).toThrow('one exact optional')
  expect(() =>
    command.request('channel/create', { delivery: 'direct', presentation: true }),
  ).toThrow('invalid channel params')
})

test('presentation pending send has a separate pool from sixteen ordinary pending sends', async () => {
  const broker = new ChannelBroker()
  const command = broker.participant('command')
  const root = broker.participant('root')
  const observed = broker.createPresentation(command, ports)
  const grants = command.transfer(root, { updates: observed.send.endpoint }, ports)
  for (let i = 0; i < 16; i++)
    await root.send(grants.updates!.endpoint, { kind: 'notice', text: 'queued' })
  const pendingObservation = root
    .send(grants.updates!.endpoint, { kind: 'notice', text: 'pending' })
    .catch((error) => error)
  await expect(
    root.send(grants.updates!.endpoint, { kind: 'notice', text: 'excess' }),
  ).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' })
  const application = await root.create()
  for (let i = 0; i < 16; i++) await root.send(application.send.endpoint, 'queued')
  const pending = Array.from({ length: 16 }, () =>
    root.send(application.send.endpoint, 'pending').catch((error) => error),
  )
  await expect(root.send(application.send.endpoint, 'excess')).rejects.toMatchObject({
    code: 'RESOURCE_EXHAUSTED',
  })
  root.close(grants.updates!.endpoint, 'LAGGED')
  expect(await pendingObservation).toMatchObject({ code: 'LAGGED' })
  root.close(application.send.endpoint, 'LAGGED')
  for (const outcome of await Promise.all(pending))
    expect(outcome).toMatchObject({ code: 'LAGGED' })
  broker.abort()
})

test('pending accepted notice survives EOF behind a host diagnostic without restoring retired activity', async () => {
  const blocked = deferred()
  const chunks: string[] = []
  const presenter = new PrivateCliProgress(
    true,
    (text) => {
      chunks.push(text)
      return text.includes('diagnostic') ? blocked.promise : undefined
    },
    undefined,
    true,
    () => 100,
  )
  presenter.stage('Waiting for the Flow result')
  const source = presenter.observe('updates')
  source.accept({ kind: 'activity', id: 'a', label: 'Old activity' })
  presenter.diagnostic('host diagnostic\n')
  expect(source.accept({ kind: 'notice', text: 'Accepted before EOF' })).toBe(true)
  source.retire()
  expect(source.accept({ kind: 'activity', id: 'a', label: 'late callback' })).toBe(false)
  blocked.resolve()
  await sleep(220)
  await presenter.flush()
  const visible = screen(chunks.join(''))
  expect(visible).toContain('host diagnostic\n  Flow update [updates]: Accepted before EOF\n')
  expect(visible).toContain('Old activity\n')
  expect(visible.slice(visible.indexOf('host diagnostic'))).not.toContain('Old activity')
  expect(visible).not.toContain('late callback')
  expect(visible).toContain('Waiting for the Flow result')
  presenter.close()
})

test('retiring one source preserves sibling replacements, relative order and fresh visible projection', async () => {
  const blocked = deferred()
  let text = ''
  const presenter = new PrivateCliProgress(
    true,
    (chunk) => {
      text += chunk
      return chunk.includes('pause here') ? blocked.promise : undefined
    },
    undefined,
    true,
    () => 120,
  )
  presenter.stage('Waiting')
  const left = presenter.observe('left'),
    right = presenter.observe('right')
  left.accept({ kind: 'activity', id: '__proto__', label: 'Left' })
  right.accept({
    kind: 'activity',
    id: '__proto__',
    label: 'Right old',
    progress: { completed: 1, total: 3 },
  })
  left.accept({ kind: 'notice', text: 'pause here' })
  right.accept({
    kind: 'activity',
    id: '__proto__',
    label: 'Right current',
    progress: { completed: 0, total: 0, unit: 'files' },
  })
  left.retire()
  right.accept({ kind: 'activity', id: 'next', label: 'Second' })
  blocked.resolve()
  await sleep(220)
  await presenter.flush()
  const visible = screen(text).slice(screen(text).indexOf('pause here'))
  expect(visible).toContain('Right current (0/0 files)')
  expect(visible).not.toContain('Left')
  expect(visible.indexOf('Right current')).toBeLessThan(visible.indexOf('Second'))
  presenter.stopUpdates()
  right.accept({ kind: 'activity', id: 'next', label: 'late after terminal' })
  await sleep(220)
  await presenter.flush()
  expect(screen(text).split('\n').at(-1)).not.toContain('Flow')
  presenter.close()
})

test('plain output bounds count-only updates and attributes complete notice blocks with indented escaped continuation lines', async () => {
  let text = ''
  const presenter = new PrivateCliProgress(
    true,
    (chunk) => {
      text += chunk
    },
    undefined,
    false,
  )
  presenter.stage('Waiting')
  const source = presenter.observe('updates')
  for (let n = 0; n < 100; n++)
    source.accept({ kind: 'activity', id: 'a', label: 'Counting', progress: { completed: n } })
  source.accept({ kind: 'notice', text: 'Execution completed\n\u001b[32mspoof\u202e' })
  source.accept({ kind: 'clear', id: 'missing' })
  source.accept({ kind: 'clear', id: 'a' })
  source.accept({ kind: 'activity', id: 'a', label: 'Reused' })
  source.accept({ kind: 'activity', id: 'a', label: 'bad\nlabel' })
  await presenter.flush()
  expect(text.split('Counting')).toHaveLength(2)
  expect(text).toContain(
    'Flow update [updates]: Execution completed\n    \\u001b[32mspoof\\u202e\n',
  )
  expect(text).not.toContain('Activity ended')
  expect(text).toContain('contract violation')
  expect(text).not.toContain('\u001b')
  presenter.close()
})

test('wide Unicode is bounded by terminal cells and notices never acquire trusted success colors', async () => {
  let text = ''
  const presenter = new PrivateCliProgress(
    true,
    (chunk) => {
      text += chunk
    },
    undefined,
    true,
    () => 40,
    (host) => (host.includes('Execution completed') ? '\u001b[32m' + host : host),
  )
  presenter.stage('Waiting for the Flow result')
  const source = presenter.observe('updates')
  source.accept({ kind: 'activity', id: 'a', label: '界🧪'.repeat(60) })
  await sleep(220)
  const line = screen(text).split('\n').at(-1)!
  expect(privateTerminalWidth(line)).toBeLessThanOrEqual(40)
  source.accept({ kind: 'notice', text: 'Execution completed' })
  expect(text).not.toContain('\u001b[32m')
  source.retire()
  presenter.close()
})

test.each([false, true])(
  'queued activity clear/reuse keeps only current appearances and sibling state (animated=%s)',
  async (animated) => {
    const blocked = deferred()
    let text = ''
    const presenter = new PrivateCliProgress(
      true,
      (chunk) => {
        text += chunk
        return chunk.includes('hold\n') ? blocked.promise : undefined
      },
      undefined,
      animated,
    )
    presenter.stage('Waiting')
    presenter.diagnostic('hold\n')
    const source = presenter.observe('updates')
    const sibling = presenter.observe('sibling')
    sibling.accept({ kind: 'activity', id: 'a', label: 'Sibling' })
    source.accept({ kind: 'activity', id: 'a', label: 'Same' })
    source.accept({ kind: 'clear', id: 'a' })
    source.accept({ kind: 'activity', id: 'a', label: 'Same', progress: { completed: 2 } })
    source.accept({ kind: 'notice', text: 'complete emission' })
    blocked.resolve()
    await presenter.flush()
    const visible = screen(text)
    expect(visible.match(/Flow updates: Same/g)).toHaveLength(1)
    expect(visible).toContain('Same (2)')
    expect(visible).toContain('Flow sibling: Sibling')
    expect(visible).not.toContain('Activity ended')
    presenter.stopUpdates()
    presenter.stage('Stopping remaining work and cleaning up')
    expect(source.accept({ kind: 'activity', id: 'a', label: 'late' })).toBe(false)
    presenter.close()
    await presenter.flush()
    expect(text).not.toContain('late')
  },
)

test.each([false, true])(
  'two cleared jobs retain phase history and show blocking notices without anonymous endings (animated=%s)',
  async (animated) => {
    let text = ''
    const presenter = new PrivateCliProgress(
      true,
      (chunk) => {
        text += chunk
      },
      undefined,
      animated,
    )
    presenter.stage('Waiting for the result')
    const source = presenter.observe('progress', true)
    source.accept({
      kind: 'activity',
      id: 'logs',
      label: 'HTTP log report: Asking for a proposed fix',
    })
    source.accept({
      kind: 'activity',
      id: 'timesheet',
      label: 'Timesheet totals: Asking for a proposed fix',
    })
    await presenter.flush()
    source.accept({ kind: 'clear', id: 'logs' })
    source.accept({ kind: 'clear', id: 'timesheet' })
    source.accept({
      kind: 'notice',
      severity: 'error',
      text: 'HTTP log report: Session creation failed.',
    })
    source.accept({
      kind: 'notice',
      severity: 'error',
      text: 'Timesheet totals: Session creation failed.',
    })
    source.retire()
    await sleep(220)
    await presenter.flush()
    const visible = screen(text)
    expect(visible).toContain('HTTP log report: Asking for a proposed fix')
    expect(visible).toContain('Timesheet totals: Asking for a proposed fix')
    expect(visible).toContain(
      'Flow-reported error:\n  Flow: HTTP log report: Session creation failed.',
    )
    expect(visible).toContain(
      'Flow-reported error:\n  Flow: Timesheet totals: Session creation failed.',
    )
    expect(visible).not.toContain('Activity ended')
    expect(visible.split('\n').at(-1)).not.toContain('Flow:')
    presenter.close()
  },
)

test('slow presentation retires optional observation once without cancelling work or discarding notices', async () => {
  const blocked = deferred()
  let text = '',
    failures = 0
  const presenter = new PrivateCliProgress(
    true,
    (chunk) => {
      text += chunk
      return chunk.includes('hold\n') ? blocked.promise : undefined
    },
    undefined,
    true,
  )
  presenter.onOutputFailure(() => {
    failures++
  })
  presenter.stage('Waiting')
  presenter.diagnostic('hold\n')
  const source = presenter.observe('updates')
  let accepted = 0
  while (source.accept({ kind: 'notice', text: `notice ${accepted}` })) accepted++
  expect(accepted).toBeLessThan(16)
  expect(source.accept({ kind: 'notice', text: 'after quota' })).toBe(false)
  blocked.resolve()
  await sleep(220)
  await presenter.flush()
  expect(failures).toBe(0)
  expect(text.match(/presentation limit reached/g)).toHaveLength(1)
  for (let n = 0; n < accepted; n++) expect(text).toContain(`notice ${n}\n`)
  presenter.close()
})

test('stderr disconnection requests root cancellation and prevents a successful flush', async () => {
  const root = new AbortController()
  const presenter = new PrivateCliProgress(
    true,
    () => Promise.reject(new Error('stderr disconnected')),
    undefined,
    false,
  )
  presenter.onOutputFailure((error) => root.abort(error))
  presenter.stage('Waiting')
  await expect(presenter.flush()).rejects.toThrow('stderr disconnected')
  expect(root.signal.aborted).toBe(true)
  presenter.close()
})

test('operator off is independent of effective receive defaults, and prohibited in entrypoints', () => {
  const effective = resolveProjectEntrypoint(
    'flow:flows/work --receive updates',
    ['--updates', 'off'],
    '/tmp/project',
  )
  expect(parseRun(effective)).toMatchObject({ receive: ['updates'], updates: 'off' })
  expect(() => parseProjectEntrypoint('flow:flows/work --updates off')).toThrow(
    'entrypoint accepts only',
  )
  for (const args of [
    ['--updates', 'auto'],
    ['--updates', 'off', '--updates', 'off'],
    ['--updates'],
  ])
    expect(() => parseRun(['run', 'flow:flows/work', ...args])).toThrow()
})

test('host refresh and resize stay bounded while concurrent phases have separate lines', async () => {
  let text = '',
    width = 80
  const paints: number[] = []
  const presenter = new PrivateCliProgress(
    true,
    (chunk) => {
      text += chunk
      if (chunk.startsWith('\r\u001b[2K') && !chunk.endsWith('\n')) paints.push(performance.now())
    },
    undefined,
    true,
    () => width,
  )
  presenter.stage('Waiting')
  const source = presenter.observe('updates')
  for (let n = 0; n < 6; n++)
    source.accept({
      kind: 'activity',
      id: String(n),
      label: `Activity ${n}`,
      progress: { completed: 0 },
    })
  expect(screen(text)).toContain('  Flow updates: Activity 0 (0)\n  Flow updates: Activity 1 (0)\n')
  for (let n = 0; n < 30; n++) {
    source.accept({ kind: 'activity', id: '0', label: 'Activity 0', progress: { completed: n } })
    process.stderr.emit('resize')
    await sleep(10)
  }
  await sleep(220)
  for (let n = 1; n < paints.length; n++)
    expect(paints[n]! - paints[n - 1]!).toBeGreaterThanOrEqual(180)
  for (const columns of [1, 4, 10, 30, 80]) {
    width = columns
    process.stderr.emit('resize')
    await sleep(220)
    const visible = screen(text).split('\n').at(-1)!
    expect(privateTerminalWidth(visible)).toBeLessThanOrEqual(columns)
    expect(visible).not.toContain('Flow')
  }
  presenter.close()
})

test('captured recognition is exact, ambiguous selection is bounded, and explicit receive retains records', async () => {
  for (const [count, delivery, explicit, supported] of [
    [0, 'direct', false, true],
    [1, 'direct', false, true],
    [1, 'broadcast', false, true],
    [2, 'direct', false, true],
    [1, 'direct', true, true],
    [1, 'direct', false, false],
  ] as const) {
    const descriptor = supported
      ? bytes
      : Buffer.from(JSON.stringify({ ...parsed.descriptor, version: '0.2.0' }))
    const captured = {
      digest: 'captured',
      read: async () => descriptor,
    } as unknown as CapturedPackage
    const declarations = Object.fromEntries(
      Array.from({ length: count }, (_, n) => [
        `updates${n}`,
        { direction: 'send', required: false, delivery, contract: './user-updates.json' },
      ]),
    )
    const inspected = { invocation: { channels: declarations } } as unknown as InspectedPackage
    let opened = 0,
      hints = 0
    const records: JsonValue[] = []
    const context = await PrivateRunChannels.open(captured, inspected, {
      receive: explicit ? ['updates0'] : [],
      record: async (value) => {
        records.push(value)
      },
      diagnostic() {},
      updates: {
        open() {
          opened++
          return { accept: () => true, retire() {} }
        },
        ambiguous(names) {
          hints++
          expect(names).toEqual(['updates0', 'updates1'])
        },
      },
    })
    expect(opened).toBe(Number(count === 1 && !explicit && supported))
    expect(hints).toBe(Number(count === 2 && !explicit && supported))
    if (context.grants.updates0) context.root.close(context.grants.updates0.endpoint)
    context.root.finalize(true)
    await context.settle()
    expect(records.map((value) => (value as any).type)).toEqual(explicit ? ['begin', 'end'] : [])
  }
})

test('implicit recognized port is distinct from explicit records and permits sixteen application channels', async () => {
  const records: JsonValue[] = []
  const offers: JsonValue[] = []
  const output: PrivateRunChannelOutput = {
    receive: [],
    record: async (value) => {
      records.push(value)
    },
    diagnostic() {},
    updates: {
      open: () => ({
        accept: (value) => {
          offers.push(value)
          return true
        },
        retire() {},
      }),
      ambiguous() {
        throw new Error('not ambiguous')
      },
    },
  }
  const captured = { digest: 'captured', read: async () => bytes } as unknown as CapturedPackage
  const inspected = {
    invocation: {
      channels: {
        updates: { direction: 'send', required: false, contract: './user-updates.json' },
      },
    },
  } as unknown as InspectedPackage
  const context = await PrivateRunChannels.open(captured, inspected, output)
  for (let i = 0; i < 16; i++) await context.root.create()
  await context.root.send(context.grants.updates!.endpoint, { kind: 'notice', text: 'hello' })
  context.root.close(context.grants.updates!.endpoint)
  context.root.finalize(true)
  await context.settle()
  expect(offers).toEqual([{ kind: 'notice', text: 'hello' }])
  expect(records).toEqual([])
})

test('reported errors retain attribution and ordering through blocked output and retirement', async () => {
  for (const animated of [false, true]) {
    const blocked = deferred()
    let text = ''
    const presenter = new PrivateCliProgress(
      true,
      (chunk) => {
        text += chunk
        return chunk.includes('hold output') ? blocked.promise : undefined
      },
      undefined,
      animated,
    )
    presenter.stage('Waiting')
    presenter.diagnostic('hold output\n')
    const source = presenter.observe('updates', true)
    source.accept({ kind: 'notice', text: 'First' })
    source.accept({
      kind: 'notice',
      severity: 'error',
      text: 'Execution completed\n\u001b[32m$ jig run',
    })
    source.retire()
    blocked.resolve()
    await presenter.flush()
    const visible = screen(text)
    expect(visible).toContain('Flow-reported error:')
    expect(visible).toContain('  Flow: Execution completed\n    \\u001b[32m$ jig run\n')
    expect(visible.indexOf('Flow: First')).toBeLessThan(visible.indexOf('Flow-reported error:'))
    expect(text).not.toContain('\u001b[32m')
    expect(text.includes('\u001b[1;31m')).toBe(animated)
    presenter.close()
  }
})

test('automatic channel observer freezes accepted views after declared loss and receiver overflow', async () => {
  for (const mode of ['producer', 'receiver'] as const) {
    let transcript = ''
    const presenter = new PrivateCliProgress(
      true,
      (chunk) => {
        transcript += chunk
      },
      undefined,
      false,
    )
    const records: JsonValue[] = []
    const prefixAccepted = deferred()
    let acceptedViews = 0
    const captured = { digest: 'captured', read: async () => bytes } as unknown as CapturedPackage
    const inspected = {
      invocation: {
        channels: {
          updates: {
            direction: 'send',
            required: false,
            delivery: 'broadcast',
            contract: './user-updates.json',
          },
        },
      },
    } as unknown as InspectedPackage
    const context = await PrivateRunChannels.open(captured, inspected, {
      receive: [],
      record: async (value) => {
        records.push(value)
      },
      diagnostic() {},
      updates: {
        open: (port) => {
          const source = presenter.observe(port, true)
          return {
            accept(value, publisher) {
              const accepted = source.accept(value, publisher)
              if (
                accepted &&
                (value as Record<string, JsonValue>).kind === 'view' &&
                ++acceptedViews === 3
              )
                prefixAccepted.resolve()
              return accepted
            },
            retire(reason) {
              source.retire(reason)
            },
          }
        },
        ambiguous() {
          throw new Error('one exact source is not ambiguous')
        },
      },
    })
    try {
      const writer = context.grants.updates!.endpoint
      for (const id of ['jobs', 'checks', 'patches']) {
        await context.root.send(writer, {
          kind: 'view',
          id,
          title: id,
          summary: `Last accepted ${id}`,
          sections: [],
        })
      }
      await prefixAccepted.promise
      expect(presenter.model.views.size).toBe(3)
      if (mode === 'producer') context.root.close(writer, 'LAGGED')
      else {
        // Dispatch one bounded burst without giving the receiver a drain turn.
        // The writer remains healthy when this broadcast receiver loses capacity.
        const burst = Array.from({ length: 17 }, (_, index) =>
          context.root.send(writer, { kind: 'notice', text: `Burst ${index}` }),
        )
        await Promise.all(burst)
        context.root.close(writer)
      }
      const application = await context.root.create()
      await context.root.send(application.send.endpoint, 'Independent work result')
      context.root.close(application.send.endpoint)
      expect((await context.root.next(application.receive.endpoint)) as JsonValue).toMatchObject({
        item: { value: 'Independent work result' },
      })
      expect((await context.root.next(application.receive.endpoint)) as JsonValue).toMatchObject({
        end: { lastSequence: 1 },
      })
      context.root.release(application.receive.endpoint)
      context.root.finalize(true)
      await context.settle()
      expect(records).toEqual([])
      expect(presenter.model.views.size).toBe(3)
      for (const view of presenter.model.views.values()) {
        expect(view.publisher).toBe(context.root.id)
        expect(view.value.summary).toBe(`Last accepted ${view.value.id}`)
        expect(view.ended).toBe(
          "Live progress stopped before all updates were delivered. Check the final result for the work's outcome. (LAGGED)",
        )
      }
      await presenter.settleDashboard({
        status: 'succeeded',
        outcome: 'done',
        delivery: { status: 'written' },
      })
      expect(transcript).toContain('Jig — observation incomplete:')
      expect(transcript).toContain("Check the final result for the work's outcome. (LAGGED)")
      expect(transcript).not.toContain('Observation ended')
      expect(presenter.model.workspace.facts?.execution).toBe('succeeded')
      expect(presenter.model.workspace.facts?.application).toBe('"done"')
      for (const id of ['jobs', 'checks', 'patches'])
        expect(transcript).toContain(`Last accepted ${id}`)
    } finally {
      context.broker.abort()
      presenter.close()
    }
  }
})

test('frozen views retain the newest accepted snapshot while warning delivery suppresses live printing', async () => {
  const warningWriting = deferred()
  const releaseWarning = deferred()
  let transcript = ''
  const presenter = new PrivateCliProgress(
    true,
    (text) => {
      transcript += text
      if (text.includes('A warning is being written')) {
        warningWriting.resolve()
        return releaseWarning.promise
      }
    },
    undefined,
    false,
  )
  const source = presenter.observe('progress', true)
  const loss =
    "Live progress stopped before all updates were delivered. Check the final result for the work's outcome. (LAGGED)"
  try {
    expect(
      source.accept({
        kind: 'view',
        id: 'jobs',
        title: 'Jobs',
        summary: 'Initial accepted snapshot',
        sections: [],
      }),
    ).toBe(true)
    await presenter.flush()
    expect(transcript).toContain('  Flow: Jobs\n    Initial accepted snapshot\n')
    expect(
      source.accept({ kind: 'notice', severity: 'warning', text: 'A warning is being written' }),
    ).toBe(true)
    await warningWriting.promise
    expect(
      source.accept({
        kind: 'view',
        id: 'jobs',
        title: 'Jobs',
        summary: 'Newest accepted snapshot',
        sections: [],
      }),
    ).toBe(true)
    expect(transcript).not.toContain('Newest accepted snapshot')
    expect([...presenter.model.views.values()].map((view) => view.value.summary)).toEqual([
      'Newest accepted snapshot',
    ])
    source.retire(loss)
    expect([...presenter.model.views.values()].map((view) => view.ended)).toEqual([loss])
    releaseWarning.resolve()
    await presenter.settleDashboard({ status: 'succeeded', outcome: 'done' })
    expect(transcript).not.toContain('  Flow: Jobs\n    Newest accepted snapshot\n')
    expect(transcript).toContain(`  Flow / Jobs (${loss}):\n    Newest accepted snapshot\n`)
    expect(transcript).not.toContain(`  Flow / Jobs (${loss}):\n    Initial accepted snapshot\n`)
    expect(presenter.model.workspace.facts?.execution).toBe('succeeded')
    expect(presenter.model.workspace.facts?.application).toBe('"done"')
  } finally {
    releaseWarning.resolve()
    await presenter.flush()
    presenter.close()
  }
}, 5_000)
