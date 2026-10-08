import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { type Reference, type ViewItem, validateUserUpdate } from '@jigging/user-updates'
import { PrivateDashboardInput, privateDashboardFrame } from '../src/cli-dashboard.js'
import { privateCliStyleEnabled } from '../src/cli-presentation.js'
import { PrivateCliProgress } from '../src/cli-progress.js'
import {
  PrivateRunModel,
  privateAttentionReceipt,
  privateRowRecordKey,
} from '../src/cli-run-model.js'
import {
  privateTerminalWidth,
  privateUpdateText,
  privateWrappedUpdate,
} from '../src/private-terminal-text.js'
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
  model.cycleCollection()
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
  model.cycleCollection()
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
  expect(model.filter).toBe('')
  input.emit('data', Buffer.from('\r'))
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
  expect(model.attention.reduce((n, a) => n + a.bytes, 0)).toBeLessThanOrEqual(524288)
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
  model.selectRecord(privateRowRecordKey('list', 'r25'))
  expect(privateDashboardFrame(model, 80, 12, false, true).lines.join('\n')).toContain('> r25')
  model.select(undefined)
  model.activity('root', { kind: 'activity', id: 'work', label: 'Checking', operationId: 'repair' })
  expect(privateDashboardFrame(model, 80, 24).lines.join('\n')).toContain(
    'Associated call: Checked repair: returned',
  )
  model.stop()
  expect(model.activities.size).toBe(0)
})
test('explicit reference choice follows identity across inserted and removed row references', async () => {
  const model = new PrivateRunModel(),
    input = new Input()
  const a = { kind: 'call' as const, operationId: 'a' },
    b = { ...a, operationId: 'b' },
    x = { ...a, operationId: 'x' }
  const offer = (references: any[]) =>
    model.acceptView(
      'root',
      validateUserUpdate({
        ...v(),
        sections: [
          {
            blocks: [
              {
                ...v().sections[0]!.blocks[0],
                rows: [
                  {
                    id: 'a',
                    cells: { name: 'a' },
                    details: [{ kind: 'report', text: 'References', references }],
                  },
                ],
              },
            ],
          },
        ],
      }) as ViewItem,
    )
  offer([a, b])
  model.cycleCollection()
  for (const operationId of ['a', 'b', 'x']) model.observeCall(event(operationId))
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  keys.frame([a, b])
  input.emit('data', Buffer.from('rj'))
  offer([x, a, b])
  keys.frame([x, a, b])
  input.emit('data', Buffer.from('\r'))
  expect(model.focusedCall).toBe(JSON.stringify(['root', 'b']))
  model.select(JSON.stringify(['root', 'jobs']))
  model.cycleCollection()
  keys.frame([x, a, b])
  input.emit('data', Buffer.from('rjj'))
  offer([a])
  keys.frame([a])
  input.emit('data', Buffer.from('\r'))
  expect(model.selected?.value.id).toBe('jobs')
  expect(model.feedback).toContain('unavailable')
  keys.leave()
})

function duplicateReferenceWorkspace() {
  const model = new PrivateRunModel(),
    input = new Input(),
    previewed: string[] = []
  const callA: Reference = { kind: 'call', operationId: 'a' },
    callB: Reference = { operationId: 'b', kind: 'call' },
    beta: Reference = { kind: 'record', viewId: 'targets', collectionId: 'list', rowId: 'beta' },
    alpha: Reference = { rowId: 'alpha', collectionId: 'list', kind: 'record', viewId: 'targets' },
    fileA: Reference = { kind: 'artifact', attachment: 'deliverables', path: 'a.txt' },
    fileB: Reference = { path: 'a.txt', kind: 'artifact', attachment: 'evidence' },
    fileC: Reference = { kind: 'artifact', attachment: 'deliverables', path: 'b.txt' },
    otherView: Reference = { ...beta, viewId: 'other' },
    otherCollection: Reference = { ...beta, collectionId: 'alternate' }
  const authored: Reference[] = [
    { operationId: 'a', kind: 'call' },
    { rowId: 'beta', collectionId: 'list', viewId: 'targets', kind: 'record' },
    callB,
    { path: 'a.txt', attachment: 'deliverables', kind: 'artifact' },
    alpha,
    callA,
    fileB,
    { kind: 'record', viewId: 'targets', rowId: 'alpha', collectionId: 'list' },
    fileC,
    otherView,
    { attachment: 'evidence', path: 'a.txt', kind: 'artifact' },
    otherCollection,
  ]
  const view: ViewItem = {
    kind: 'view',
    id: 'references',
    title: 'References',
    summary: 'Review exact targets',
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'source',
            title: 'Authored reference material',
            columns: [
              { key: 'call', label: 'Call', type: 'reference' },
              { key: 'record', label: 'Record', type: 'reference' },
              { key: 'file', label: 'File', type: 'reference' },
            ],
            rows: [
              {
                id: 'source',
                cells: { call: callA, record: beta, file: fileA },
                details: [
                  {
                    kind: 'report',
                    text: 'AUTHORED LITERAL REFERENCES',
                    references: authored.slice(0, 8),
                  },
                  {
                    kind: 'report',
                    text: 'Continued authored references',
                    references: authored.slice(8),
                  },
                  {
                    kind: 'facts',
                    items: [
                      { label: 'Repeated call', value: { operationId: 'b', kind: 'call' } },
                      { label: 'Repeated record', value: beta },
                      { label: 'Repeated file', value: fileA },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
  // Keep valid authored property orders for the private projection seam.
  validateUserUpdate(view)
  model.acceptView('root', view)
  const targets = v('targets', ['alpha', 'beta']),
    collection = targets.sections[0]!.blocks[0]!
  model.acceptView('root', {
    ...targets,
    landing: undefined,
    title: 'Targets',
    sections: [{ blocks: [collection, { ...collection, id: 'alternate' }] }],
  } as ViewItem)
  model.acceptView('root', {
    ...v('other', ['beta']),
    landing: undefined,
    title: 'Other',
  } as ViewItem)
  model.observeCall({ ...event('a'), slot: 'first-call' })
  model.observeCall({ ...event('b'), slot: 'second-call' })
  model.setArtifacts(
    (_, ref) => `${ref.attachment}/${ref.path}`,
    async (path) => {
      previewed.push(path)
      return { text: path, bytes: Buffer.byteLength(path), clipped: false }
    },
  )
  model.select(JSON.stringify(['root', 'references']))
  model.cycleCollection()
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  const paint = () => {
    const frame = privateDashboardFrame(
      model,
      80,
      24,
      false,
      true,
      keys.scroll,
      keys.anchor,
      keys.state,
    )
    keys.frame(frame.references, frame.scroll, frame.anchor)
    return frame
  }
  return {
    model,
    input,
    keys,
    paint,
    view,
    authored,
    previewed,
    unique: [callA, beta, fileA, callB, alpha, fileB, fileC, otherView, otherCollection],
  }
}

test('duplicate cell/detail references produce one marker and every distinct target activates exactly', async () => {
  for (let target = 0; target < 9; target++) {
    const { model, input, keys, paint, unique, authored, previewed } = duplicateReferenceWorkspace()
    input.emit('data', Buffer.from('\r'))
    const literal = paint().lines.join('\n')
    expect(literal).toContain('AUTHORED LITERAL REFERENCES')
    expect(literal.split('\n').filter((line) => line === 'first-call: active')).toHaveLength(2)
    expect(model.record?.row?.details?.[0]).toMatchObject({ references: authored.slice(0, 8) })
    expect(model.record?.row?.details?.[1]).toMatchObject({ references: authored.slice(8) })
    input.emit('data', Buffer.from('r'))
    let frame = paint()
    expect(frame.references).toEqual(unique)
    expect(frame.references[0]).toBe(unique[0])
    for (let index = 0; index <= target; index++) {
      if (index) {
        input.emit('data', Buffer.from('j'))
        frame = paint()
      }
      expect(frame.lines.filter((line) => line.startsWith('> '))).toEqual([
        `> ${model.resolve('root', unique[index]!).label}`,
      ])
    }
    input.emit('data', Buffer.from('\r'))
    const reference = unique[target]!
    if (reference.kind === 'call')
      expect(model.focusedCall).toBe(JSON.stringify(['root', reference.operationId]))
    else if (reference.kind === 'record') {
      expect(model.selected?.value.id).toBe(reference.viewId)
      expect(model.collection?.id).toBe(reference.collectionId)
      expect(model.row?.id).toBe(reference.rowId)
    } else {
      await Promise.resolve()
      expect(previewed).toEqual([`${reference.attachment}/${reference.path}`])
      expect(model.previewTitle).toBe(`${reference.attachment}:${reference.path}`)
      expect(model.preview?.text).toBe(`${reference.attachment}/${reference.path}`)
    }
    keys.leave()
  }
})

test('chooser selection survives reordered reference fields and duplicate interleaving', () => {
  const { model, input, keys, paint, view, unique } = duplicateReferenceWorkspace()
  input.emit('data', Buffer.from('rjjj'))
  const initial = paint()
  expect(initial.lines.filter((line) => line.startsWith('> '))).toEqual(['> second-call: active'])
  const source = view.sections[0]!.blocks[0]!
  if (source.kind !== 'collection') throw new Error('Fixture collection missing')
  const refreshed: Reference[] = [
    { operationId: 'inserted', kind: 'call' },
    unique[0]!,
    { kind: 'call', operationId: 'b' },
    unique[1]!,
    { operationId: 'b', kind: 'call' },
    ...unique.slice(4),
  ]
  const updated: ViewItem = {
    ...view,
    sections: [
      {
        blocks: [
          {
            ...source,
            rows: [
              {
                ...source.rows[0]!,
                details: [
                  {
                    kind: 'report',
                    text: 'Reordered semantic references',
                    references: refreshed.slice(0, 8),
                  },
                  { kind: 'report', text: 'Continued references', references: refreshed.slice(8) },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
  validateUserUpdate(updated)
  model.observeCall({ ...event('inserted'), slot: 'inserted-call' })
  model.acceptView('root', updated)
  const changed = paint()
  expect(changed.lines.filter((line) => line.startsWith('> '))).toEqual(['> second-call: active'])
  input.emit('data', Buffer.from('k'))
  expect(paint().lines.filter((line) => line.startsWith('> '))).toEqual(['> inserted-call: active'])
  input.emit('data', Buffer.from('j\r'))
  expect(model.focusedCall).toBe(JSON.stringify(['root', 'b']))
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
    await progress.configureDisplay('dashboard', true, input as any)
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

test('Activity opens first, fixed shell retains task, configured limit and full-cause control', () => {
  const model = new PrivateRunModel()
  model.configureWorkspace({ target: 'binding:factory', limitMs: 300000, startedAt: 1000 })
  model.workspace.now = 31000
  model.setHostStage('Waiting for the result')
  model.acceptNotice(
    'root',
    'info',
    'Review two independently checked goals\nFull literal purpose',
    80,
  )
  model.acceptView('root', { ...v(), landing: undefined } as any)
  model.addAttention('Flow', 'The document cannot be read\nSpecific document cause', 2)
  const frame = privateDashboardFrame(model, 80, 24, false, true)
  expect(model.surface).toBe('activity')
  expect(frame.lines).toHaveLength(24)
  expect(frame.lines[0]).toContain('binding:factory')
  expect(frame.lines[1]).toContain('elapsed 30s · execution limit 300s')
  expect(frame.lines[2]).toContain('[Activity]')
  expect(frame.lines[3]).toContain('! full cause')
  expect(frame.lines.at(-1)).toContain('q continues inline')
  expect(frame.lines.join('\n')).toContain('Current work')
  expect(frame.lines.join('\n')).toContain('Recent activity')
  expect(frame.lines.join('\n')).not.toContain('Full report in transcript')
  for (const [width, height] of [
    [60, 18],
    [30, 7],
    [18, 4],
    [1, 1],
  ]) {
    const compact = privateDashboardFrame(model, width!, height!, false, true)
    expect(compact.lines.length).toBeLessThanOrEqual(height!)
    for (const line of compact.lines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width!)
  }
})

test('workspace styling preserves exact plain text while exposing typed visual hierarchy', () => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Remove only generated SGR for plain comparison.
  const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')
  const model = new PrivateRunModel()
  model.configureWorkspace({ target: 'flow:review\u001b[41m', limitMs: 60000, startedAt: 1000 })
  model.workspace.now = 2000
  model.addHostEntry('history', 'Retained host context')
  model.acceptNotice('root', 'info', 'ready success failed \u001b[42m literal application text', 80)
  model.addAttention('Flow', 'Supplied warning\nFull literal cause', 1)
  const colored = privateDashboardFrame(model, 80, 24, true, true),
    uncolored = privateDashboardFrame(model, 80, 24, false, true)
  expect(colored.lines.map(plain)).toEqual(uncolored.lines)
  expect(colored.lines[0]).toStartWith('\u001b[1m')
  expect(colored.lines[1]).toStartWith('\u001b[90m')
  expect(colored.lines[2]).toStartWith('\u001b[1m')
  expect(colored.lines[3]).toStartWith('\u001b[1;33m')
  expect(colored.lines).toContain('\u001b[1mCurrent work\u001b[0m')
  expect(colored.lines).toContain('\u001b[1mRecent activity\u001b[0m')
  expect(colored.lines.find((line) => plain(line).startsWith('> '))).toStartWith('\u001b[1;')
  expect(colored.lines.find((line) => line.includes('ready success failed'))).toContain(
    '\u001b[90m  Flow · \u001b[39mready success failed',
  )
  expect(colored.lines.at(-1)).toStartWith('\u001b[90m')
  expect(colored.lines.join('\n')).not.toContain('\u001b[41m')
  expect(colored.lines.join('\n')).not.toContain('\u001b[42m')
  expect(colored.lines.join('\n')).not.toContain('\u001b[32m')
  expect(colored.lines[0]).toContain('\\u001b[41m')
  const noColor = privateDashboardFrame(
    model,
    80,
    24,
    privateCliStyleEnabled(true, { TERM: 'xterm-256color', NO_COLOR: '' }),
    true,
  )
  expect(noColor.lines).toEqual(uncolored.lines)
  expect(noColor.lines.join('\n')).not.toContain('\u001b')

  model.acceptView('root', {
    ...v(),
    landing: undefined,
    sections: [{ title: 'Supplied records', blocks: v().sections[0]!.blocks }],
  } as ViewItem)
  model.select(JSON.stringify(['root', 'jobs']))
  model.cycleCollection()
  const table = privateDashboardFrame(model, 80, 24, true, true)
  expect(table.lines.map(plain)).toEqual(privateDashboardFrame(model, 80, 24, false, true).lines)
  expect(table.lines).toContain('\u001b[1mSupplied records\u001b[0m')
  expect(table.lines.find((line) => plain(line).startsWith('Matters ·'))).toStartWith('\u001b[1m')
  expect(table.lines.find((line) => plain(line).trim() === 'Matter')).toStartWith('\u001b[1m')
  expect(table.lines.find((line) => plain(line).startsWith('> a'))).toStartWith('\u001b[1;')
  expect(table.lines.find((line) => plain(line).trim() === 'b')).not.toContain('\u001b')
})

test('attention emphasis follows explicit priority and leaves literal cause text unstyled', () => {
  for (const priority of [1, 2, 3, 4]) {
    const model = new PrivateRunModel()
    model.addAttention('Literal source', 'Complete cause\nSecond literal line', priority)
    const tone = priority === 2 || priority === 4 ? '\u001b[1;31m' : '\u001b[1;33m'
    const frame = privateDashboardFrame(model, 80, 24, true, true, 0, undefined, {
      panels: [{ kind: 'attention', index: 0, scroll: 0 }],
    })
    expect(frame.lines[3]).toStartWith(tone)
    expect(frame.lines.find((line) => line.includes('Literal source —'))).toStartWith(tone)
    expect(frame.lines).toContain('Complete cause')
    expect(frame.lines).toContain('Second literal line')
    expect(frame.lines.join('\n')).not.toContain('\u001b[32m')
  }
})

test('colored byte-heavy attention charges generated SGR within the frame ceiling', () => {
  const model = new PrivateRunModel()
  expect(model.addAttention('Flow', 'a' + '\u0301'.repeat(60000), 2)).toBe(true)
  const frame = privateDashboardFrame(model, 80, 100, true, true, 0, undefined, {
    panels: [{ kind: 'attention', index: 0, scroll: 0 }],
  })
  expect(Buffer.byteLength(frame.lines.join('\n'))).toBeLessThanOrEqual(32000)
  for (const line of frame.lines) {
    expect(Bun.stringWidth(line)).toBeLessThanOrEqual(80)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Only renderer-owned foreground SGR is admitted.
    const controls = line.match(/\u001b\[[0-9;]*m/g) ?? []
    for (const control of controls)
      expect(['\u001b[1m', '\u001b[1;31m', '\u001b[90m', '\u001b[39m', '\u001b[0m']).toContain(
        control,
      )
  }
  expect(Buffer.byteLength(frame.lines.join('\n'))).toBeGreaterThan(30000)
})

test('mixed records include summary, report, facts, progress, rows and empty collections in author order', () => {
  const model = new PrivateRunModel()
  const view = validateUserUpdate({
    kind: 'view',
    id: 'mixed',
    title: 'Mixed',
    summary: 'Literal summary',
    sections: [
      {
        blocks: [
          { kind: 'report', text: 'Literal report' },
          { kind: 'facts', items: [{ label: 'Law', value: 'Slovak law' }] },
          { kind: 'progress', label: 'Checked', completed: 1, total: 2 },
          {
            kind: 'collection',
            id: 'empty',
            title: 'Empty',
            columns: [{ key: 'value', label: 'Value', type: 'number' }],
            rows: [],
          },
          { kind: 'report', text: 'Last report' },
        ],
      },
    ],
  }) as ViewItem
  model.acceptView('root', view)
  model.select(JSON.stringify(['root', 'mixed']))
  expect(model.records().map((r) => r.kind)).toEqual([
    'summary',
    'report',
    'facts',
    'progress',
    'empty',
    'report',
  ])
  model.moveRecord(1)
  expect(model.record?.block?.kind).toBe('report')
  model.sortRows()
  expect(model.feedback).toContain('Select a collection')
  model.cycleCollection()
  expect(model.record?.kind).toBe('empty')
  model.moveRecord(1)
  expect(model.record?.block).toEqual({ kind: 'report', text: 'Last report' })
})

test('tables align typed columns, show one header, keep literal null and collapse row details', () => {
  const model = new PrivateRunModel()
  const columns = [
    { key: 'goal', label: 'Goal', type: 'text' },
    { key: 'count', label: 'Count', type: 'number' },
    { key: 'ok', label: 'Claim', type: 'boolean' },
    ...Array.from({ length: 5 }, (_, i) => ({
      key: `extra${i}`,
      label: `Extra ${i}`,
      type: 'text',
    })),
  ]
  const cells = (goal: string, count: number | null) => ({
    goal,
    count,
    ok: false,
    ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`extra${i}`, 'extra value'])),
  })
  model.acceptView(
    'root',
    validateUserUpdate({
      kind: 'view',
      id: 'table',
      title: 'Table',
      summary: 'Two goals',
      sections: [
        {
          blocks: [
            {
              kind: 'collection',
              id: 'goals',
              title: 'Goals',
              columns,
              rows: [
                {
                  id: 'a',
                  cells: cells('Patch logging', 3),
                  details: [{ kind: 'report', text: 'Only appears after Enter' }],
                },
                { id: 'b', cells: cells('Patch dates', null) },
              ],
            },
          ],
        },
      ],
    }) as ViewItem,
  )
  model.select(JSON.stringify(['root', 'table']))
  model.cycleCollection()
  const text = privateDashboardFrame(model, 60, 18, false, true).lines.join('\n')
  expect(text.match(/Goal\s+\|/g)).toHaveLength(1)
  expect(text).toContain('+')
  expect(text).toContain('columns (Enter detail)')
  expect(text).toContain('null')
  expect(text).toContain('false')
  expect(text).not.toContain('Goal: Patch')
  expect(text).not.toContain('Only appears after Enter')
})

test('filter draft preserves applied rows and treats all printable shortcuts literally', async () => {
  const model = new PrivateRunModel(),
    input = new Input()
  model.acceptView('root', v())
  model.cycleCollection()
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  input.emit('data', Buffer.from('/qjksr!?\t\u001b[A\u001b[B'))
  expect(keys.active).toBe(true)
  expect(keys.state.panels.at(-1)).toMatchObject({ kind: 'filter', draft: 'qjksr!?' })
  expect(model.filter).toBe('')
  expect(model.visibleRows()).toHaveLength(3)
  input.emit('data', Buffer.from('\r'))
  expect(model.filter).toBe('qjksr!?')
  expect(model.record?.kind).toBe('empty')
  expect(privateDashboardFrame(model, 80, 24, false, true).lines.join('\n')).toContain(
    'No matching supplied records',
  )
  input.emit('data', Buffer.from('/\u007f\u007f\u007f\u007f\u007f\u007f\u007f\r'))
  expect(model.filter).toBe('')
  expect(model.visibleRows()).toHaveLength(3)
  input.emit('data', Buffer.from('/discard\u001b'))
  await new Promise((resolve) => setTimeout(resolve, 45))
  expect(model.filter).toBe('')
  expect(keys.active).toBe(true)
  input.emit('data', Buffer.from('q'))
  expect(keys.active).toBe(false)
})

test('Enter opens detail without reference activation, nested Escape returns to stable record', async () => {
  const model = new PrivateRunModel(),
    input = new Input()
  model.acceptView(
    'root',
    validateUserUpdate({
      kind: 'view',
      id: 'reports',
      title: 'Reports',
      summary: 'Summary',
      sections: [
        {
          blocks: [
            {
              kind: 'report',
              text: 'Long literal report\n' + 'details '.repeat(300),
              references: [{ kind: 'call', operationId: 'check' }],
            },
          ],
        },
      ],
    }) as ViewItem,
  )
  model.select(JSON.stringify(['root', 'reports']))
  model.moveRecord(1)
  model.observeCall(event('check'))
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  input.emit('data', Buffer.from('\r'))
  expect(keys.state.panels.at(-1)?.kind).toBe('detail')
  expect(model.focusedCall).toBeUndefined()
  const identity = model.record?.key
  input.emit('data', Buffer.from('j?'))
  expect(model.record?.key).toBe(identity)
  expect(keys.state.panels.at(-1)?.kind).toBe('help')
  input.emit('data', Buffer.from('\u001b'))
  await new Promise((r) => setTimeout(r, 45))
  expect(keys.state.panels.at(-1)?.kind).toBe('detail')
  input.emit('data', Buffer.from('r\r'))
  expect(model.focusedCall).toBe(JSON.stringify(['root', 'check']))
  keys.frame([], 0)
  expect(keys.state.panels).toHaveLength(0)
  keys.leave()
})

test('full attention is one action from every surface and preserves source priority', () => {
  const model = new PrivateRunModel(),
    input = new Input()
  model.acceptView('root', v())
  model.cycleCollection()
  model.addAttention('Flow', 'Flow error\nLiteral second line', 2)
  model.addAttention('Jig', 'Host failure\nFull known safe cause', 4)
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  input.emit('data', Buffer.from('!'))
  let frame = privateDashboardFrame(
    model,
    80,
    24,
    false,
    true,
    keys.scroll,
    keys.anchor,
    keys.state,
  )
  expect(frame.lines.join('\n')).toContain('Full known safe cause')
  input.emit('data', Buffer.from('\u001b[D'))
  frame = privateDashboardFrame(model, 80, 24, false, true, keys.scroll, keys.anchor, keys.state)
  expect(frame.lines.join('\n')).toContain('Literal second line')
  expect(model.row?.id).toBe('a')
  keys.leave()
})

test('local collection state survives tabs and exact disclosure semantics include references', () => {
  const model = new PrivateRunModel()
  model.acceptView('root', v())
  model.cycleCollection()
  model.filterRows('b')
  model.sortRows()
  const selected = model.record?.key
  model.cycleView(1)
  model.cycleView(-1)
  expect(model.record?.key).toBe(selected)
  expect(model.filter).toBe('b')
  expect(model.visibleRows().map((r) => r.id)).toEqual(['b'])
  model.selectRecord('summary')
  model.toggleDisclosure()
  model.acceptView('root', v())
  expect(model.disclosure()).toBe(true)
  model.acceptView('root', { ...v(), summary: 'Changed summary' })
  expect(model.disclosure()).toBe(false)
  const report = (operationId: string) =>
    ({
      ...v(),
      sections: [
        {
          blocks: [
            {
              kind: 'report',
              text: 'Same literal text',
              references: [{ kind: 'call', operationId }],
            },
          ],
        },
      ],
    }) as ViewItem
  model.acceptView('root', report('a'))
  model.selectRecord('block:0:0')
  model.toggleDisclosure()
  model.acceptView('root', report('b'))
  expect(model.disclosure()).toBe(false)
})

test('actual tree collapses descendants, counts issues and follows original operations', () => {
  const model = new PrivateRunModel()
  model.observeCall({
    ...event('parent'),
    intent: 'Repair logging',
    childPublisher: 'worker-instance',
  })
  model.observeCall({
    ...event('child'),
    publisher: 'worker-instance',
    childPublisher: 'agent-instance',
  })
  model.observeCall({
    ...event('deep', 'failed'),
    publisher: 'agent-instance',
    cause: 'Specific failure',
  })
  model.select(undefined)
  expect(model.records().filter((r) => r.kind === 'call')).toHaveLength(3)
  model.selectRecord(JSON.stringify(['worker-instance', 'child']))
  model.expandTree(false)
  expect(model.records().filter((r) => r.kind === 'call')).toHaveLength(2)
  model.selectRecord(JSON.stringify(['worker-instance', 'child']))
  expect(model.record).toMatchObject({ hidden: 1, issues: 1 })
  model.expandTree(true)
  expect(model.records().filter((r) => r.kind === 'call')).toHaveLength(3)
  model.expandTree(false)
  expect(model.records().filter((r) => r.kind === 'call')).toHaveLength(2)
  expect(privateDashboardFrame(model, 80, 24, false, true).lines.join('\n')).toContain(
    'Repair logging',
  )
  expect(model.resolve('root', { kind: 'call', operationId: 'child' }).available).toBe(false)
})

test('attention charges full escaped receipt and capacity rejection is atomic', () => {
  const model = new PrivateRunModel()
  const text = '\u001b'.repeat(4096)
  for (let index = 0; index < 19; index++)
    expect(model.addAttention('Flow\u202e', text, 2)).toBe(true)
  const before = model.attention.length,
    bytes = model.attentionBytes
  expect(model.addAttention('Flow', text, 2)).toBe(false)
  expect(model.attention).toHaveLength(before)
  expect(model.attentionBytes).toBe(bytes)
  for (const report of model.attention)
    expect(report.bytes).toBe(Buffer.byteLength(privateAttentionReceipt(report)))
  expect(model.attentionBytes).toBeLessThanOrEqual(491520)
  expect(model.addAttention('Jig', 'Host safe cause', 4)).toBe(true)
})

test('pathological zero-width text keeps frame bytes bounded and remains vertically reachable', () => {
  const model = new PrivateRunModel()
  const text = 'a' + '\u0301'.repeat(4000)
  model.acceptView(
    'root',
    validateUserUpdate({
      kind: 'view',
      id: 'unicode',
      title: 'Unicode',
      summary: 'Summary',
      sections: [{ blocks: [{ kind: 'report', text }] }],
    }) as ViewItem,
  )
  model.select(JSON.stringify(['root', 'unicode']))
  model.moveRecord(1)
  const input = new Input(),
    keys = new PrivateDashboardInput(
      model,
      () => {},
      () => {},
      input as any,
    )
  keys.start()
  input.emit('data', Buffer.from('\r'))
  const frame = privateDashboardFrame(model, 80, 24, false, true, 0, undefined, keys.state)
  expect(Buffer.byteLength(frame.lines.join('\n'))).toBeLessThanOrEqual(32000)
  expect(frame.lines.filter((line) => line.includes('\u0301')).length).toBeGreaterThan(1)
  keys.leave()
})

test('input snapshots before entry, restores once and EOF leaves without cancellation', () => {
  const model = new PrivateRunModel(),
    input = new Input()
  let cancelled = 0,
    left = 0
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => cancelled++,
    input as any,
    () => left++,
  )
  keys.capture()
  keys.start()
  input.emit('end')
  keys.leave()
  expect(cancelled).toBe(0)
  expect(left).toBe(1)
  expect(input.isRaw).toBe(false)
  expect(input.paused).toBe(true)
  expect(input.listenerCount('data')).toBe(0)
})

test('zero physical dimensions draw nothing and settled facts/footer remain phase-aware on every tab', () => {
  const model = new PrivateRunModel()
  expect(privateDashboardFrame(model, 0, 24, false, true).lines).toHaveLength(0)
  expect(privateDashboardFrame(model, 80, 0, false, true).lines).toHaveLength(0)
  model.acceptView('root', v())
  model.setWorkspaceFacts({
    execution: 'returned',
    application: '"blocked"',
    cleanup: 'confirmed',
    delivery: 'written',
    completeness: 'Observation ended',
  })
  model.setWorkspacePhase('settled', 5000)
  model.workspace.now = 1000
  for (const surface of [JSON.stringify(['root', 'jobs']), undefined]) {
    model.select(surface)
    const text = privateDashboardFrame(model, 60, 18, false, true).lines.join('\n')
    expect(text).toContain('Execution returned')
    expect(text).toContain('Application "blocked"')
    expect(text).toContain('Cleanup confirmed')
    expect(text).toContain('Delivery written')
    expect(text).toContain('q closes inspection')
    expect(text).not.toContain('q continues inline')
  }
  const compact = privateDashboardFrame(model, 18, 4, false, true).lines.join('\n')
  expect(compact).toContain('q close')
  expect(compact).toContain('^C close')
  expect(model.hostFactsText).toContain('Application (literal outcome): "blocked"')
})

test('human activity navigation fences later landing hints and unsupported editing sequences are no-ops', () => {
  const model = new PrivateRunModel(),
    input = new Input()
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  input.emit('data', Buffer.from('?'))
  model.acceptView('root', v())
  expect(model.surface).toBe('activity')
  model.select(JSON.stringify(['root', 'jobs']))
  model.cycleCollection()
  keys.frame([])
  input.emit('data', Buffer.from('/a\u001bOA\u001b[?25h'))
  expect(keys.state.panels.at(-1)).toMatchObject({ kind: 'filter', draft: 'a' })
  expect(model.filter).toBe('')
  keys.leave()
})

test('an explicit same-publisher record reference exposes its exact row through a local filter', async () => {
  const model = new PrivateRunModel()
  model.acceptView('root', v())
  model.cycleCollection()
  model.filterRows('b')
  await model.activate('root', { kind: 'record', viewId: 'jobs', collectionId: 'list', rowId: 'a' })
  expect(model.row?.id).toBe('a')
  expect(model.feedback).toContain('local filter cleared')
})

test('batched record-reference jumps clear originating detail before the first target frame', () => {
  for (const sameView of [false, true]) {
    const model = new PrivateRunModel(),
      input = new Input()
    const references = [
      { kind: 'artifact', attachment: 'deliverables', path: 'first.txt' },
      { kind: 'artifact', attachment: 'deliverables', path: 'second.txt' },
      { kind: 'record', viewId: 'records', collectionId: 'list', rowId: 'beta' },
    ]
    const report = {
      kind: 'report',
      text: 'SOURCE REFERENCE REPORT\nComplete source context',
      references,
    }
    model.acceptView(
      'root',
      validateUserUpdate({
        kind: 'view',
        id: 'records',
        title: 'Records',
        summary: 'Review supplied records',
        sections: [
          {
            blocks: [
              sameView ? report : { kind: 'report', text: 'TARGET REPORT ONLY' },
              ...v('records', ['alpha', 'beta']).sections[0]!.blocks,
            ],
          },
        ],
      }) as ViewItem,
    )
    if (!sameView)
      model.acceptView(
        'root',
        validateUserUpdate({
          kind: 'view',
          id: 'evidence',
          title: 'Evidence',
          summary: 'Review references',
          sections: [{ blocks: [report] }],
        }) as ViewItem,
      )
    model.select(JSON.stringify(['root', sameView ? 'records' : 'evidence']))
    model.moveRecord(1)
    const frames: string[] = []
    const paint = () => {
      // Read in the progress owner's order, before its post-projection frame() callback.
      frames.push(
        privateDashboardFrame(
          model,
          80,
          24,
          false,
          true,
          keys.scroll,
          keys.anchor,
          keys.state,
        ).lines.join('\n'),
      )
    }
    const keys = new PrivateDashboardInput(model, paint, () => {}, input as any)
    keys.start()
    model.onChange = paint
    input.emit('data', Buffer.from('\r'))
    expect(frames.at(-1)).toContain('Flow · detail')
    expect(frames.at(-1)).toContain('Complete source context')
    frames.length = 0
    input.emit('data', Buffer.from('rjj\r'))
    expect(model.row?.id).toBe('beta')
    expect(keys.state.panels).toHaveLength(0)
    expect(frames.every((frame) => !frame.includes('Flow · detail'))).toBe(true)
    expect(frames.at(-1)).toContain('[Flow: Records]')
    expect(frames.at(-1)).toMatch(/\n> beta *\n/)
    input.emit('data', Buffer.from('\r'))
    expect(frames.at(-1)).toContain('Flow · detail')
    expect(frames.at(-1)).toContain('Matter: beta')
    keys.leave()
  }
})

test('external surface and record changes reconcile detail scroll before projection', () => {
  const model = new PrivateRunModel(),
    input = new Input()
  model.acceptView('root', v('first'))
  model.acceptView('root', { ...v('second'), landing: undefined } as ViewItem)
  model.select(JSON.stringify(['root', 'first']))
  model.cycleCollection()
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  input.emit('data', Buffer.from('\r]'))
  expect(keys.scroll).toBe(3)
  model.select(JSON.stringify(['root', 'second']))
  const frame = privateDashboardFrame(
    model,
    80,
    24,
    false,
    true,
    keys.scroll,
    keys.anchor,
    keys.state,
  )
  expect(keys.scroll).toBe(0)
  expect(keys.state.panels).toHaveLength(0)
  expect(frame.lines.join('\n')).not.toContain('Flow · detail')
  input.emit('data', Buffer.from('\r]'))
  expect(keys.scroll).toBe(3)
  model.moveRecord(1)
  expect(keys.scroll).toBe(0)
  expect(keys.state.panels).toHaveLength(0)
  keys.leave()
})

test('detail scrolling beyond the end retains the final literal line and a finite anchor', () => {
  const model = new PrivateRunModel()
  model.acceptView('root', {
    ...v(),
    sections: [{ blocks: [{ kind: 'report', text: 'First literal line\nLast literal line' }] }],
  })
  model.select(JSON.stringify(['root', 'jobs']))
  model.moveRecord(1)
  const record = model.record!
  const frame = privateDashboardFrame(model, 80, 12, false, true, 999, undefined, {
    panels: [{ kind: 'detail', key: record.key, signature: record.signature, scroll: 999 }],
  })
  expect(frame.lines.join('\n')).toContain('Last literal line')
  expect(frame.scroll).toBe(2)
})

test('Enter toggles the literal detail panel and keeps the same record', () => {
  const model = new PrivateRunModel(),
    input = new Input()
  model.acceptView('root', v())
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  input.emit('data', Buffer.from('\r'))
  const identity = model.record?.key
  expect(keys.state.panels.at(-1)?.kind).toBe('detail')
  input.emit('data', Buffer.from('\r'))
  expect(keys.state.panels).toHaveLength(0)
  expect(model.record?.key).toBe(identity)
  keys.leave()
})

test('settlement offers the landing result without moving an operator who has navigated', () => {
  const model = new PrivateRunModel()
  model.configureWorkspace({ target: 'binding:factory', startedAt: 1000 })
  model.workspace.now = 31000
  model.acceptView('root', v())
  model.stop()
  model.setWorkspaceFacts({
    execution: 'succeeded',
    application: '"done"',
    cleanup: 'complete',
    delivery: 'written',
  })
  model.setWorkspacePhase('settled', 90000)
  expect(model.row?.id).toBe('a')
  model.workspace.now = 65000
  expect(privateDashboardFrame(model, 120, 45, false, true).lines[1]).toContain('elapsed 30s')
  for (const surface of ['activity', 'overview']) {
    model.select(surface)
    const text = privateDashboardFrame(model, 120, 45, false, true).lines.join('\n')
    expect(text).not.toContain('Current work')
    expect(text).not.toContain('\\nApplication')
    expect(text.match(/Execution succeeded/g)).toHaveLength(1)
  }
  const browsing = new PrivateRunModel()
  browsing.acceptView('root', v())
  browsing.select('activity')
  browsing.setWorkspacePhase('settled')
  expect(browsing.surface).toBe('activity')
  const noHint = new PrivateRunModel()
  noHint.acceptView('root', { ...v('first-result'), landing: undefined } as ViewItem)
  expect(noHint.surface).toBe('activity')
  noHint.setWorkspacePhase('settled')
  expect(noHint.surface).toBe(JSON.stringify(['root', 'first-result']))
  expect(noHint.row?.id).toBe('a')
})

test('wide collections use spare width and show literal selected detail without activating files', () => {
  const model = new PrivateRunModel()
  let activated = 0
  model.setArtifacts(
    () => 'patch',
    async () => {
      activated++
      return { text: 'patch bytes', bytes: 11, clipped: false }
    },
  )
  model.acceptView(
    'root',
    validateUserUpdate({
      kind: 'view',
      id: 'work',
      title: 'Work',
      landing: true,
      summary: 'Two independently checked candidates; review before applying.',
      sections: [
        {
          blocks: [
            {
              kind: 'collection',
              id: 'work',
              title: 'Requested repairs',
              columns: [
                { key: 'job', label: 'Job', type: 'text' },
                { key: 'outcome', label: 'Outcome', type: 'text' },
              ],
              rows: [
                {
                  id: 'a',
                  cells: {
                    job: 'HTTP log report',
                    outcome: 'Checked patch ready for human review',
                  },
                  details: [
                    {
                      kind: 'report',
                      text: 'Goal: reject fractional HTTP status codes.\nSources have not been changed.',
                      references: [
                        { kind: 'artifact', attachment: 'deliverables', path: 'a/review.patch' },
                      ],
                    },
                    { kind: 'facts', items: [{ label: 'Independent cases', value: '4/4 passed' }] },
                  ],
                },
              ],
              total: 1,
            },
          ],
        },
      ],
    }) as ViewItem,
  )
  model.cycleCollection()
  const wide = privateDashboardFrame(model, 160, 45, false, true).lines.join('\n')
  expect(wide).toContain('Checked patch ready for human review')
  expect(wide).toContain('Goal: reject fractional HTTP status codes.')
  expect(wide).toContain('Independent cases: 4/4 passed')
  expect(wide).toContain('Delivered file: a/review.patch')
  expect(wide).toContain('Selected detail')
  expect(wide.indexOf('Goal: reject fractional')).toBeLessThan(
    wide.indexOf('Outcome: Checked patch'),
  )
  expect(wide).not.toContain('1/1 supplied / 1 reported')
  expect(activated).toBe(0)
  expect(model.preview).toBeUndefined()
  const narrow = privateDashboardFrame(model, 80, 24, false, true).lines.join('\n')
  expect(narrow).not.toContain('Goal: reject')
  expect(narrow).toContain('Enter detail')
  for (const [width, height] of [
    [60, 18],
    [80, 24],
    [112, 32],
    [160, 60],
    [200, 90],
  ]) {
    const frame = privateDashboardFrame(model, width!, height!, true, true)
    expect(Buffer.byteLength(frame.lines.join('\n'))).toBeLessThanOrEqual(32000)
    expect(frame.lines).toHaveLength(height!)
    for (const line of frame.lines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width!)
  }
})

test('authored detail wraps at word boundaries while preserving escaped text and bounded long words', () => {
  const prose =
    'Requested goal: Count client errors separately from server errors. Review the patch before applying it.'
  const lines = [...privateWrappedUpdate(prose, 45, true)]
  expect(lines.join('')).toBe(prose)
  expect(lines.every((line) => privateTerminalWidth(line) <= 45)).toBeTrue()
  expect(lines.some((line) => line.includes('Count client errors'))).toBeTrue()
  expect([...privateWrappedUpdate('a \u0301bc', 3, true)]).toEqual(['a \u0301', 'bc'])
  const accentedSpace = 'Requested goal: inspect \u0301each document carefully.'
  const accentLines = [...privateWrappedUpdate(accentedSpace, 26, true)]
  expect(accentLines.join('')).toBe(accentedSpace)
  expect(accentLines.every((line) => !line.startsWith('\u0301'))).toBeTrue()
  const hostile = 'Goal: \u001b[31m ' + 'x'.repeat(100) + ' ' + '\u0300'.repeat(3000) + ' 結果 🙂'
  const bounded = [...privateWrappedUpdate(hostile, 20, true)]
  expect(bounded.join('')).toBe(privateUpdateText(hostile))
  for (const line of bounded) {
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(4096)
    expect(privateTerminalWidth(line)).toBeLessThanOrEqual(20)
  }
})

test('Activity prioritizes recent domain history and retains setup and host warnings through disclosure', () => {
  const model = new PrivateRunModel(),
    input = new Input()
  for (let i = 0; i < 20; i++) model.addHostEntry(`setup:${i}`, `Setup step ${i}`)
  model.acceptNotice('root', 'info', 'Starting the document review', 30)
  model.addHostEntry('warning', 'Cleanup could not be confirmed', 'warning')
  model.acceptNotice('root', 'info', 'Draft ready for professional review', 40)
  model.setWorkspacePhase('settled')
  let text = privateDashboardFrame(model, 80, 24, false, true).lines.join('\n')
  expect(text.indexOf('Draft ready')).toBeLessThan(text.indexOf('Starting the document'))
  expect(text).toContain('Cleanup could not be confirmed')
  expect(text).toContain('Jig stages · 20 reports')
  expect(text).not.toContain('Setup step 0')
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  model.selectRecord('setup')
  input.emit('data', Buffer.from('\r'))
  text = privateDashboardFrame(
    model,
    80,
    45,
    false,
    true,
    keys.scroll,
    keys.anchor,
    keys.state,
  ).lines.join('\n')
  expect(text).toContain('Setup step 0')
  expect(text).toContain('Setup step 19')
  keys.leave()
})

test('diagnostics are attributed and one action away on every view without inferred severity', () => {
  const model = new PrivateRunModel(),
    input = new Input()
  model.acceptView('root', v())
  model.addDiagnostic('Warning title\nComplete safe explanation\u001b[31m', [
    'repair:logs',
    'patch-1',
  ])
  model.addDiagnostic('Different report', ['repair:timesheet', 'patch-1'])
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  for (const surface of ['activity', 'overview', JSON.stringify(['root', 'jobs'])]) {
    model.select(surface)
    input.emit('data', Buffer.from('d'))
    let text = privateDashboardFrame(
      model,
      80,
      24,
      false,
      true,
      0,
      undefined,
      keys.state,
    ).lines.join('\n')
    expect(text).toContain('Invocation: repair:logs / patch-1')
    expect(text).toContain('Severity was not supplied')
    expect(text).toContain('Complete safe explanation\\u001b[31m')
    expect(text).not.toContain('\u001b[31m')
    input.emit('data', Buffer.from('\u001b[C'))
    text = privateDashboardFrame(model, 80, 24, false, true, 0, undefined, keys.state).lines.join(
      '\n',
    )
    expect(text).toContain('Invocation: repair:timesheet / patch-1')
    expect(text).toContain('Different report')
  }
  expect(model.attention).toHaveLength(0)
  keys.leave()
})

test('completed trees start collapsed while explicit expansion and failed descendants remain visible', () => {
  const model = new PrivateRunModel()
  model.observeCall({
    ...event('repair'),
    intent: 'Repair HTTP statuses',
    childPublisher: 'worker',
  })
  model.observeCall({
    ...event('baseline'),
    publisher: 'worker',
    intent: 'Baseline · repository tests',
  })
  model.observeCall({ ...event('baseline', 'returned'), publisher: 'worker' })
  model.observeCall(event('repair', 'returned'))
  model.select(undefined)
  expect(model.records().filter((record) => record.call)).toHaveLength(1)
  model.expandTree(true)
  expect(model.records().filter((record) => record.call)).toHaveLength(2)
  const text = privateDashboardFrame(model, 120, 45, false, true).lines.join('\n')
  expect(text).toContain('returned')
  expect(text).not.toContain('tests passed')
  const failed = new PrivateRunModel()
  failed.observeCall({ ...event('parent'), childPublisher: 'child' })
  failed.observeCall({
    ...event('failure', 'failed'),
    publisher: 'child',
    cause: 'Native client could not start',
  })
  failed.observeCall(event('parent', 'returned'))
  failed.select(undefined)
  expect(failed.records().filter((record) => record.call)).toHaveLength(2)
})

test('saved inspection exposes only recorded views and never promotes saved claims to live host facts', async () => {
  const model = new PrivateRunModel()
  model.configureWorkspace({ target: 'saved packet', startedAt: 1000, recorded: true })
  for (const [id, title] of [
    ['result', 'Recorded result'],
    ['files', 'Files'],
    ['diagnostics', 'Diagnostics'],
  ]) {
    model.acceptView('saved-result', {
      ...v(id),
      title,
      landing: undefined,
      sections: [{ blocks: [{ kind: 'report', text: 'Recorded local evidence' }] }],
    } as ViewItem)
  }
  model.select(model.surfaceKeys()[0])
  model.workspace.now = 31000
  model.workspace.inspectionHardDeadline = 301000
  model.setWorkspaceFacts({
    execution: 'succeeded',
    application: '"done"',
    cleanup: 'complete',
    delivery: 'written',
  })
  model.setWorkspacePhase('settled', 91000)
  const frame = privateDashboardFrame(model, 120, 45, true, true)
  const text = frame.lines.join('\n')
  expect(text).toContain('Saved result · read-only')
  expect(text).toContain('[Recorded result] | Files | Diagnostics')
  expect(text).not.toContain('Activity | Overview')
  expect(text).not.toContain('Recorded: Recorded result')
  expect(text).not.toContain('elapsed')
  expect(text).not.toContain('execution limit')
  expect(text).toContain('Recorded execution succeeded')
  expect(text).toContain('Recorded cleanup complete')
  expect(text).not.toContain('\u001b[32m')
  expect(model.sourceLabel('saved-result')).toBe('Recorded')
  const surfaces = model.surfaceKeys()
  for (let i = 0; i < 6; i++) {
    model.cycleView(1)
    expect(surfaces).toContain(model.surface)
  }
  model.workspace.inspectionDeadline = model.workspace.inspectionHardDeadline
  expect(privateDashboardFrame(model, 120, 45, false, true).lines[1]).toContain('(limit)')
  model.setArtifacts(
    (_publisher, ref) => (ref.path === 'review.patch' ? 'captured-patch' : undefined),
    async () => ({ text: 'captured bytes', bytes: 14, clipped: false }),
  )
  const ref = { kind: 'artifact' as const, attachment: 'packet', path: 'review.patch' }
  expect(model.resolve('saved-result', ref).label).toBe('Captured recorded file: review.patch')
  expect(model.resolve('saved-result', { ...ref, path: 'missing' }).label).toContain(
    'captured recorded files',
  )
  await model.activate('saved-result', ref)
  const preview = privateDashboardFrame(model, 120, 45, false, true, 0, undefined, {
    panels: [{ kind: 'preview', scroll: 0 }],
  }).lines.join('\n')
  expect(preview).toContain('Immutable recorded-file preview')
  expect(preview).not.toContain('delivered-file preview')
  for (const failedPreview of [
    async () => undefined,
    async () => {
      throw new Error('unavailable')
    },
  ]) {
    model.setArtifacts(() => 'captured-patch', failedPreview)
    await model.activate('saved-result', ref)
    expect(model.feedback).toBe('Immutable preview unavailable; inspect the selected packet')
  }
})

test('diagnostic capacity loss and final completeness remain visible from every surface', () => {
  const model = new PrivateRunModel(),
    input = new Input()
  model.acceptView('root', v())
  for (let i = 0; i < 33; i++) model.addDiagnostic(`Report ${i}`, [`worker:${i}`])
  model.setWorkspaceFacts({
    execution: 'succeeded',
    application: '"done"',
    cleanup: 'complete',
    delivery: 'written',
    completeness: 'Activity history omitted',
  })
  model.setWorkspacePhase('settled')
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  for (const surface of ['activity', 'overview', JSON.stringify(['root', 'jobs'])]) {
    model.select(surface)
    let text = privateDashboardFrame(model, 120, 32, false, true).lines.join('\n')
    expect(text).toContain('1 updates omitted')
    expect(text).toContain('Observation · Activity history omitted')
    input.emit('data', Buffer.from('d'))
    text = privateDashboardFrame(model, 120, 32, false, true, 0, undefined, keys.state).lines.join(
      '\n',
    )
    expect(text).toContain('Diagnostic history incomplete: 1 report updates omitted.')
  }
  keys.leave()
  for (const [width, height] of [
    [35, 12],
    [18, 4],
  ]) {
    for (const surface of ['activity', 'overview', JSON.stringify(['root', 'jobs'])]) {
      model.select(surface)
      const frame = privateDashboardFrame(model, width!, height!, false, true)
      expect(frame.lines.join('\n')).toContain('omitted')
      expect(frame.lines.join('\n')).toContain(width! < 28 ? 'd: omitted (1)' : '1 diagnostic')
      expect(frame.lines).toHaveLength(height!)
    }
  }
})
