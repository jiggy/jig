import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { type ViewItem, validateUserUpdate } from '@jigging/user-updates'
import { PrivateDashboardInput, privateDashboardFrame } from '../src/cli-dashboard.js'
import { PrivateCliProgress } from '../src/cli-progress.js'
import { PrivateRunModel } from '../src/cli-run-model.js'
import { parseProjectEntrypoint, resolveProjectEntrypoint } from '../src/project/entrypoint.js'
import { ChannelBroker } from '../src/run/channels.js'
import { parseRun } from '../src/run-arguments.js'

const v = (id = 'jobs', rows = ['a', 'b', 'c']): ViewItem =>
  validateUserUpdate({
    kind: 'view',
    id,
    title: 'Jobs',
    landing: true,
    summary: 'Check supplied matters',
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'list',
            title: 'Matters',
            columns: [{ key: 'name', label: 'Matter', type: 'text' }],
            rows: rows.map((id, index) => ({
              id,
              cells: { name: id },
              details: index < 30 ? [{ kind: 'report', text: 'Review supplied documents' }] : [],
            })),
          },
        ],
      },
    ],
  }) as ViewItem
const event = (id: string, state: 'active' | 'returned' | 'failed' = 'active') => ({
  publisher: 'root',
  operationId: id,
  slot: 'worker',
  state,
  time: 1,
})
class Input extends EventEmitter {
  isRaw = false
  paused = true
  setRawMode(raw: boolean) {
    this.isRaw = raw
    return this
  }
  isPaused() {
    return this.paused
  }
  pause() {
    this.paused = true
    return this
  }
  resume() {
    this.paused = false
    return this
  }
}
test('atomic view acceptance, bounded lifetime claims and frozen incomplete evidence', () => {
  const model = new PrivateRunModel()
  model.acceptView('root', v())
  const original = model.selected
  expect(() => model.acceptView('root', { ...v(), operationId: 'new' })).toThrow('association')
  expect(model.selected).toBe(original)
  model.acceptView('root', { kind: 'retire-view', id: 'missing' })
  expect(() => model.acceptView('root', { ...v('missing'), landing: undefined } as any)).toThrow(
    'reused',
  )
  model.freeze('root', 'Incomplete: lost observation')
  expect(model.selected?.ended).toContain('Incomplete')
  expect(() => model.acceptView('root', v())).toThrow('ended')
  model.stop()
  model.observeCall(event('late'))
  expect(model.calls.size).toBe(0)
})
test('selection survives unselected retirement and follows preceding surviving visible row', () => {
  const model = new PrivateRunModel()
  model.acceptView('root', v())
  model.moveRow(1)
  expect(model.row?.id).toBe('b')
  model.acceptView('root', v('jobs', ['a', 'c']))
  expect(model.row?.id).toBe('a')
  model.acceptView('root', { ...v('other'), landing: undefined } as any)
  model.acceptView('root', { kind: 'retire-view', id: 'other' })
  expect(model.selected?.value.id).toBe('jobs')
  model.acceptView('root', v('jobs', ['b', 'c']))
  expect(model.row?.id).toBe('b')
  model.filterRows('c')
  expect(model.row?.id).toBe('c')
  model.acceptView('root', { kind: 'retire-view', id: 'jobs' })
  expect(model.selected).toBeUndefined()
})
test('provenance separates identical local IDs and late dynamic references resolve without re-offer', () => {
  const model = new PrivateRunModel()
  const ref = { kind: 'call' as const, operationId: 'patch-1' }
  expect(model.resolve('root', ref).available).toBe(false)
  model.observeCall(event('patch-1'))
  model.observeCall({ ...event('patch-1'), publisher: 'child', slot: 'different' })
  expect(model.resolve('root', ref).label).toContain('worker')
  expect(model.resolve('child', ref).label).toContain('different')
  model.observeCall({ ...event('patch-1'), state: 'returned' })
  model.observeCall({ ...event('patch-1'), state: 'active' })
  expect(model.resolve('root', ref).label).toContain('returned')
  model.acceptView('root', v())
  expect(
    model.resolve('child', { kind: 'record', viewId: 'jobs', collectionId: 'list', rowId: 'a' })
      .available,
  ).toBe(false)
})
test('accepted-send participant survives backpressure and remains private sideband', async () => {
  const broker = new ChannelBroker(),
    owner = broker.participant('creator'),
    writer = broker.participant('writer')
  const pair = await owner.create()
  const grants = owner.transfer(
    writer,
    { progress: pair.send.endpoint },
    { progress: { direction: 'send' } },
  )
  for (let i = 0; i < 16; i++) await writer.send(grants.progress!.endpoint, String(i))
  const pending = writer.send(grants.progress!.endpoint, 'pending')
  for (let i = 0; i < 17; i++) {
    const response = await owner.next(pair.receive.endpoint)
    expect(broker.publisherOf(response)).toBe('writer')
    expect(Object.keys(response as object)).toEqual(['item'])
    expect(JSON.stringify(response)).not.toContain('publisher')
  }
  await pending
  broker.abort()
})
test('bounded frame escapes application titles, reserves failure context and discloses overflow', () => {
  const model = new PrivateRunModel()
  model.acceptView('root', { ...v(), title: '\u001b]52;c;secret\u0007' })
  model.addAttention('Flow', 'Blocking cause', 2)
  expect(privateDashboardFrame(model, 20, 3).lines.join('\n')).toContain('Blocking cause')
  model.incomplete = 'Additional Flow reports unavailable'
  expect(privateDashboardFrame(model, 80, 24).lines.join('\n')).toContain(
    'Additional Flow reports unavailable',
  )
  const rendered = privateDashboardFrame(model, 80, 24).lines.join('\n')
  expect(rendered).not.toContain('\u001b]52')
  for (let i = 0; i < 300; i++) model.observeCall({ ...event(String(i)), intent: 'x'.repeat(1024) })
  model.observeCall({ ...event('overflow', 'failed'), cause: 'Known host cause' })
  expect(model.calls.size).toBeLessThanOrEqual(256)
  expect(model.omissions).toBeGreaterThan(0)
  expect(model.sticky?.text).toBe('Known host cause')
  expect(
    Buffer.byteLength(privateDashboardFrame(model, 2000, 100).lines.join('\n')),
  ).toBeLessThanOrEqual(32768)
})
test('streaming keyboard input handles batched cancel, arrows and split UTF-8; restores stdin', async () => {
  const model = new PrivateRunModel()
  model.acceptView('root', v())
  const input = new Input()
  let cancelled = 0
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {
      cancelled++
    },
    input as any,
  )
  keys.start()
  expect(input.isRaw).toBe(true)
  input.emit('data', Buffer.from('jj'))
  expect(model.row?.id).toBe('c')
  input.emit('data', Buffer.from('\u001b['))
  input.emit('data', Buffer.from('Ak'))
  expect(model.row?.id).toBe('a')
  input.emit('data', Buffer.from('/'))
  const utf = Buffer.from('é')
  input.emit('data', utf.subarray(0, 1))
  input.emit('data', utf.subarray(1))
  expect(model.filter).toBe('é')
  input.emit('data', Buffer.from('\u0003q'))
  expect(cancelled).toBe(1)
  expect(keys.active).toBe(false)
  expect(input.isRaw).toBe(false)
  expect(input.paused).toBe(true)
  const settled = new PrivateDashboardInput(
    model,
    () => {},
    () => {
      cancelled++
    },
    input as any,
  )
  settled.start()
  settled.markSettled()
  input.emit('data', Buffer.from('\u0003'))
  expect(cancelled).toBe(1)
})
test('late or rejected previews cannot outlive presentation ownership', async () => {
  const model = new PrivateRunModel()
  let release!: (v: any) => void
  model.setArtifacts(
    () => 'file',
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const pending = model.activate('root', { kind: 'artifact', attachment: 'output', path: 'file' })
  model.close()
  release({ text: 'late', bytes: 4, clipped: false })
  await pending
  expect(model.preview).toBeUndefined()
  const failed = new PrivateRunModel()
  failed.setArtifacts(
    () => 'file',
    async () => {
      throw new Error('private cause')
    },
  )
  await failed.activate('root', { kind: 'artifact', attachment: 'output', path: 'file' })
  expect(failed.feedback).toContain('unavailable')
  expect(failed.feedback).not.toContain('private cause')
})
test('display is operator-only, exact JSON/receive precedence remains in the grammar', () => {
  expect(parseRun(['run', 'binding:factory', '--display', 'dashboard']).display).toBe('dashboard')
  expect(() => parseRun(['run', 'binding:factory', '--display', 'wrong'])).toThrow()
  expect(() => parseProjectEntrypoint('binding:factory --display dashboard')).toThrow('entrypoint')
  expect(
    resolveProjectEntrypoint(
      'binding:factory --receive progress',
      ['--display', 'dashboard'],
      process.cwd(),
    ),
  ).toContain('--receive')
})
test('attention reserves host causes atomically within the aggregate byte ceiling', () => {
  const model = new PrivateRunModel()
  for (let i = 0; i < 120; i++) model.addAttention('Flow', 'x'.repeat(4096), 2)
  for (let i = 0; i < 3; i++) expect(model.addAttention('Jig', '🔥'.repeat(4096), 4)).toBe(true)
  expect(model.attention.reduce((n, a) => n + Buffer.byteLength(a.text), 0)).toBeLessThanOrEqual(
    524288,
  )
  expect(model.attention.length).toBeLessThanOrEqual(128)
  expect(model.incomplete).toBeDefined()
})
test('final summaries settle all 32 retained views without overflowing an async writer', async () => {
  let output = '',
    failure = false
  const progress = new PrivateCliProgress(
    false,
    async (text) => {
      output += text
    },
    undefined,
    false,
  )
  progress.onOutputFailure(() => {
    failure = true
  })
  for (let source = 0; source < 4; source++)
    for (let id = 0; id < 8; id++)
      progress.model.acceptView(`source:${source}`, { ...v(String(id)), landing: undefined } as any)
  await progress.settleDashboard({ status: 'succeeded', outcome: 'done', output: null })
  expect(failure).toBe(false)
  expect(output.match(/observation ended/gi)).toHaveLength(32)
  progress.close()
  await progress.flush()
})
test('a plain call burst degrades observation without inventing output failure or cancelling', async () => {
  let output = '',
    failure = false
  const progress = new PrivateCliProgress(
    false,
    async (text) => {
      output += text
    },
    undefined,
    false,
  )
  progress.onOutputFailure(() => {
    failure = true
  })
  for (let i = 0; i < 32; i++) progress.observeCall(event(String(i)))
  await progress.flush()
  expect(failure).toBe(false)
  expect(output).toContain('Live call reports incomplete')
  expect(progress.model.calls.size).toBe(32)
  progress.observeCall({ ...event('late', 'failed'), cause: 'KNOWN HOST CAUSE AFTER DRAIN' })
  await progress.flush()
  expect(output).toContain('KNOWN HOST CAUSE AFTER DRAIN')
  progress.close()
  await progress.flush()
})
test('view and activity associations resolve dynamically while row focus and scroll anchors survive replacements', () => {
  const model = new PrivateRunModel()
  const rows = Array.from({ length: 30 }, (_, i) => `r${i}`)
  model.acceptView('root', { ...v('jobs', rows), operationId: 'repair' })
  expect(privateDashboardFrame(model, 80, 12, false, true).lines.join('\n')).toContain(
    'Call unavailable',
  )
  model.observeCall({ ...event('repair', 'returned'), slot: 'Checked repair' })
  expect(privateDashboardFrame(model, 80, 12, false, true).lines.join('\n')).toContain(
    'Checked repair: returned',
  )
  const before = privateDashboardFrame(model, 80, 12, false, true, 12)
  model.acceptView('root', {
    ...v('jobs', ['x0', 'x1', 'x2', 'x3', 'x4', ...rows]),
    operationId: 'repair',
  })
  const after = privateDashboardFrame(model, 80, 12, false, true, before.scroll, before.anchor)
  expect(after.anchor?.key).toBe(before.anchor?.key)
  model.moveRow(25)
  expect(privateDashboardFrame(model, 80, 12, false, true).lines.join('\n')).toContain(
    '> Matter: r25',
  )
  model.select(undefined)
  model.activity('root', { kind: 'activity', id: 'work', label: 'Checking', operationId: 'repair' })
  expect(privateDashboardFrame(model, 80, 24).lines.join('\n')).toContain(
    'Associated call: Checked repair: returned',
  )
  model.stop()
  expect(model.activities.size).toBe(0)
})
test('reference choice follows identity across inserted and removed references', async () => {
  const model = new PrivateRunModel()
  model.acceptView('root', v())
  const input = new Input()
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {},
    input as any,
  )
  const a = { kind: 'call' as const, operationId: 'a' },
    b = { kind: 'call' as const, operationId: 'b' },
    x = { kind: 'call' as const, operationId: 'x' }
  model.observeCall(event('a'))
  model.observeCall(event('b'))
  model.observeCall(event('x'))
  keys.start()
  keys.frame([a, b])
  input.emit('data', Buffer.from('r'))
  keys.frame([x, a, b])
  input.emit('data', Buffer.from('\r'))
  expect(model.focusedCall).toBe(JSON.stringify(['root', 'b']))
  model.select(JSON.stringify(['root', 'jobs']))
  keys.frame([a, b])
  input.emit('data', Buffer.from('r'))
  keys.frame([a])
  input.emit('data', Buffer.from('\r'))
  expect(model.selected?.value.id).toBe('jobs')
  expect(model.feedback).toContain('unavailable')
  keys.leave()
})

test('a saturated optional call transcript leaves host phase changes usable', async () => {
  let failure = false
  const progress = new PrivateCliProgress(true, async () => {}, undefined, false)
  progress.onOutputFailure(() => {
    failure = true
  })
  progress.stage('Waiting')
  for (let i = 0; i < 32; i++) progress.observeCall(event(String(i)))
  progress.stage('Stopping remaining work and cleaning up')
  await progress.flush()
  expect(failure).toBe(false)
  progress.close()
  await progress.flush()
})

test.each(['stage', 'complete', 'pause'] as const)(
  'animated %s remains usable after a failed-call burst',
  async (action) => {
    let output = '',
      failure = false
    const progress = new PrivateCliProgress(
      true,
      async (text) => {
        output += text
      },
      undefined,
      true,
    )
    progress.onOutputFailure(() => {
      failure = true
    })
    progress.stage('Waiting for the result')
    for (let i = 0; i < 32; i++)
      progress.observeCall({ ...event(String(i), 'failed'), cause: `Known safe cause ${i}` })
    if (action === 'stage') progress.stage('Stopping remaining work and cleaning up')
    else if (action === 'complete') progress.complete()
    else progress.pause()
    await progress.flush()
    expect(failure).toBe(false)
    expect(output).toContain('Known safe cause 31')
    progress.close()
    await progress.flush()
  },
)
test('root critical handoff drains optional reports before settled inspection', async () => {
  const originalTerm = process.env.TERM
  process.env.TERM = 'xterm-256color'
  try {
    let output = '',
      failure = false
    const progress = new PrivateCliProgress(
      true,
      async (text) => {
        output += text
      },
      undefined,
      true,
    )
    const input = new Input()
    progress.onOutputFailure(() => {
      failure = true
    })
    progress.configureDisplay('dashboard', true, input as any)
    expect(input.isRaw).toBe(true)
    progress.stage('Waiting for the result')
    for (let i = 0; i < 32; i++)
      progress.observeCall({ ...event(String(i), 'failed'), cause: `Safe cause ${i}` })
    const settled = progress.settleDashboard({
      status: 'failed',
      message: 'Root failed',
      cleanup: { status: 'failed' },
      delivery: { status: 'unknown' },
    })
    await progress.flush()
    input.emit('data', Buffer.from('q'))
    await settled
    expect(failure).toBe(false)
    expect(progress.model.context).toContain('execution: failed')
    expect(input.isRaw).toBe(false)
    progress.close()
    await progress.flush()
  } finally {
    if (originalTerm === undefined) delete process.env.TERM
    else process.env.TERM = originalTerm
  }
})
test('a refused Flow error still gets a full owned transcript commitment', async () => {
  let output = '',
    failure = false
  const progress = new PrivateCliProgress(
    false,
    async (text) => {
      output += text
    },
    undefined,
    false,
  )
  progress.onOutputFailure(() => {
    failure = true
  })
  const source = progress.observe('progress')
  for (let i = 0; i < 15; i++) source.accept({ kind: 'notice', text: `Information ${i}` })
  source.accept({ kind: 'notice', text: 'Retained blocking cause', severity: 'error' })
  await progress.flush()
  expect(failure).toBe(false)
  expect(output).toContain('Retained blocking cause')
  expect(
    progress.model.attention.find((a) => a.text === 'Retained blocking cause')?.committed,
  ).toBe(true)
  progress.close()
  await progress.flush()
})
test('competing preview activation cannot mix target labels and bytes', async () => {
  const model = new PrivateRunModel()
  let release!: (value: any) => void,
    reads = 0
  model.setArtifacts(
    (_publisher, ref) => ref.path,
    () => {
      reads++
      return new Promise((resolve) => {
        release = resolve
      })
    },
  )
  const a = { kind: 'artifact' as const, attachment: 'output', path: 'a.txt' },
    b = { ...a, path: 'b.txt' }
  const pending = model.activate('root', a)
  await model.activate('root', b)
  expect(reads).toBe(1)
  expect(model.feedback).toContain('loading')
  release({ text: 'a.txt bytes', bytes: 11, clipped: false })
  await pending
  expect(model.previewTitle).toBe('output:a.txt')
  expect(model.feedback).toContain('a.txt')
  expect(model.feedback).not.toContain('b.txt')
  model.close()
})
