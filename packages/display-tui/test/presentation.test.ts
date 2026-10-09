import { displayViewKey } from '@jigging/display-model'
import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { type Reference, type ViewItem, validateUserUpdate } from '@jigging/user-updates'
import { viewerDetailParts, viewerFrame } from '../src/projection.js'
import { FixtureModel, FixtureKeyboard, waitFor } from './fixtures.js'
import { rowRecordKey, callRecordKey } from '../src/viewer-model.js'
import { terminalWidth, escapeTerminalText, wrapTerminalText } from '../src/text.js'

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

test('selection survives unselected retirement and follows preceding surviving visible row', () => {
  const model = new FixtureModel()
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

test('bounded frame escapes application titles, reserves failure context and discloses overflow', () => {
  const model = new FixtureModel()
  model.acceptView('root', { ...v(), title: '\u001b]52;c;secret\u0007' })
  model.addAttention('Flow', 'Blocking cause', 2)
  expect(viewerFrame(model, 20, 3).lines.join('\n')).toContain('Blocking cause')
  model.incomplete = 'Additional Flow reports unavailable'
  expect(viewerFrame(model, 80, 24).lines.join('\n')).toContain(
    'Additional Flow reports unavailable',
  )
  const rendered = viewerFrame(model, 80, 24).lines.join('\n')
  expect(rendered).not.toContain('\u001b]52')
  for (let i = 0; i < 255; i++) model.observeCall({ ...event(String(i)), intent: 'x'.repeat(1024) })
  model.omitCalls(45)
  model.observeCall({ ...event('overflow', 'failed'), cause: 'Known host cause' })
  expect(model.calls.size).toBeLessThanOrEqual(256)
  expect(model.omissions).toBeGreaterThan(0)
  expect(model.sticky?.text).toBe('Known host cause')
  expect(Buffer.byteLength(viewerFrame(model, 2000, 100).lines.join('\n'))).toBeLessThanOrEqual(
    32768,
  )
})
test('owned keyboard bytes handle batched cancel, arrows and split UTF-8', async () => {
  const model = new FixtureModel()
  model.acceptView('root', v())
  model.cycleCollection()
  const input = new Input()
  let cancelled = 0
  const keys = new FixtureKeyboard(
    model,
    () => {},
    () => {
      cancelled++
    },
    input as any,
  )
  keys.start()
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
  const settled = new FixtureKeyboard(
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
  const model = new FixtureModel()
  let release!: (v: any) => void
  model.setArtifacts(
    () => 'file',
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const ref = { kind: 'artifact' as const, attachment: 'output', path: 'file' }
  model.provideArtifact('root', ref)
  const pending = model.activate('root', ref)
  model.close()
  release({ text: 'late', bytes: 4, clipped: false })
  await pending
  expect(model.preview).toBeUndefined()
  const failed = new FixtureModel()
  failed.setArtifacts(
    () => 'file',
    async () => {
      throw new Error('private cause')
    },
  )
  failed.provideArtifact('root', ref)
  await failed.activate('root', ref)
  expect(failed.feedback).toContain('unavailable')
  expect(failed.feedback).not.toContain('private cause')
})

test('view and activity associations resolve dynamically while row focus and scroll anchors survive replacements', () => {
  const model = new FixtureModel()
  const rows = Array.from({ length: 30 }, (_, i) => `r${i}`)
  model.acceptView('root', { ...v('jobs', rows), operationId: 'repair' })
  expect(viewerFrame(model, 80, 12, false, true).lines.join('\n')).toContain('Call unavailable')
  model.observeCall({ ...event('repair', 'returned'), slot: 'Checked repair' })
  expect(viewerFrame(model, 80, 12, false, true).lines.join('\n')).toContain(
    'Checked repair: returned',
  )
  const before = viewerFrame(model, 80, 12, false, true, 12)
  model.acceptView('root', {
    ...v('jobs', ['x0', 'x1', 'x2', 'x3', 'x4', ...rows]),
    operationId: 'repair',
  })
  const after = viewerFrame(model, 80, 12, false, true, before.scroll, before.anchor)
  expect(after.anchor?.key).toBe(before.anchor?.key)
  model.selectRecord(rowRecordKey('list', 'r25'))
  expect(viewerFrame(model, 80, 12, false, true).lines.join('\n')).toContain('> r25')
  model.select(undefined)
  model.activity('root', { kind: 'activity', id: 'work', label: 'Checking', operationId: 'repair' })
  expect(viewerFrame(model, 80, 24).lines.join('\n')).toContain(
    'Associated call: Checked repair: returned',
  )
  model.stop()
  expect(model.activities.size).toBe(0)
})
test('explicit reference choice follows identity across inserted and removed row references', async () => {
  const model = new FixtureModel(),
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
  const keys = new FixtureKeyboard(
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
  expect(model.focusedCall).toBe(callRecordKey(JSON.stringify(['root', 'b'])))
  model.select(displayViewKey(JSON.stringify(['root', 'jobs'])))
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
  const model = new FixtureModel(),
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
    (_, ref) => ref.path,
    async (path) => {
      previewed.push(path)
      return { text: path, bytes: Buffer.byteLength(path), clipped: false }
    },
  )
  model.select(displayViewKey(JSON.stringify(['root', 'references'])))
  model.cycleCollection()
  const keys = new FixtureKeyboard(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  const paint = () => {
    const frame = viewerFrame(model, 80, 24, false, true, keys.scroll, keys.anchor, keys.state)
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
    expect(literal.match(/first-call: active/g)).toHaveLength(2)
    expect(model.record?.row?.details?.[0]).toMatchObject({ references: authored.slice(0, 8) })
    expect(model.record?.row?.details?.[1]).toMatchObject({ references: authored.slice(8) })
    input.emit('data', Buffer.from('r'))
    let frame = paint()
    expect(frame.references).toEqual(unique)
    expect(frame.references[0]).toEqual(unique[0])
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
      expect(model.focusedCall).toBe(callRecordKey(JSON.stringify(['root', reference.operationId])))
    else if (reference.kind === 'record') {
      expect(model.selected?.value.id).toBe(reference.viewId)
      expect(model.collection?.id).toBe(reference.collectionId)
      expect(model.row?.id).toBe(reference.rowId)
    } else {
      await waitFor(() => model.previewState !== 'loading')
      expect(previewed).toEqual([reference.path])
      expect(model.previewTitle).toBe(`${reference.attachment}:${reference.path}`)
      expect(model.preview?.text).toBe(reference.path)
      expect(model.preview?.bytes).toBe(Buffer.byteLength(reference.path))
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
  expect(model.focusedCall).toBe(callRecordKey(JSON.stringify(['root', 'b'])))
  keys.leave()
})

test('competing preview activation cannot mix target labels and bytes', async () => {
  const model = new FixtureModel()
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
  model.provideArtifact('root', a)
  model.provideArtifact('root', b)
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
  const model = new FixtureModel()
  model.configureWorkspace({ target: 'binding:factory', limitMs: 300000, startedAt: 1000 })
  model.setNow(31000)
  model.setHostStage('Waiting for the result')
  model.acceptNotice(
    'root',
    'info',
    'Review two independently checked goals\nFull literal purpose',
    80,
  )
  model.acceptView('root', { ...v(), landing: undefined } as any)
  model.addAttention('Flow', 'The document cannot be read\nSpecific document cause', 2)
  const frame = viewerFrame(model, 80, 24, false, true)
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
    const compact = viewerFrame(model, width!, height!, false, true)
    expect(compact.lines.length).toBeLessThanOrEqual(height!)
    for (const line of compact.lines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width!)
  }
})

test('workspace styling preserves exact plain text while exposing typed visual hierarchy', () => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Remove only generated SGR for plain comparison.
  const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')
  const model = new FixtureModel()
  model.configureWorkspace({ target: 'flow:review\u001b[41m', limitMs: 60000, startedAt: 1000 })
  model.setNow(2000)
  model.addHostEntry('history', 'Retained host context')
  model.acceptNotice('root', 'info', 'ready success failed \u001b[42m literal application text', 80)
  model.addAttention('Flow', 'Supplied warning\nFull literal cause', 1)
  const colored = viewerFrame(model, 80, 24, true, true),
    uncolored = viewerFrame(model, 80, 24, false, true)
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
  const noColor = viewerFrame(model, 80, 24, false, true)
  expect(noColor.lines).toEqual(uncolored.lines)
  expect(noColor.lines.join('\n')).not.toContain('\u001b')

  model.acceptView('root', {
    ...v(),
    landing: undefined,
    sections: [{ title: 'Supplied records', blocks: v().sections[0]!.blocks }],
  } as ViewItem)
  model.select(displayViewKey(JSON.stringify(['root', 'jobs'])))
  model.cycleCollection()
  const table = viewerFrame(model, 80, 24, true, true)
  expect(table.lines.map(plain)).toEqual(viewerFrame(model, 80, 24, false, true).lines)
  expect(table.lines).toContain('\u001b[1mSupplied records\u001b[0m')
  expect(table.lines.find((line) => plain(line).startsWith('Matters ·'))).toStartWith('\u001b[1m')
  expect(table.lines.find((line) => plain(line).trim() === 'Matter')).toStartWith('\u001b[1m')
  expect(table.lines.find((line) => plain(line).startsWith('> a'))).toStartWith('\u001b[1;')
  expect(table.lines.find((line) => plain(line).trim() === 'b')).not.toContain('\u001b')
})

test('attention emphasis follows explicit priority and leaves literal cause text unstyled', () => {
  for (const priority of [1, 2, 3, 4]) {
    const model = new FixtureModel()
    model.addAttention('Literal source', 'Complete cause\nSecond literal line', priority)
    const tone = priority === 2 || priority === 4 ? '\u001b[1;31m' : '\u001b[1;33m'
    const frame = viewerFrame(model, 80, 24, true, true, 0, undefined, {
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
  const model = new FixtureModel()
  expect(model.addAttention('Flow', 'a' + '\u0301'.repeat(60000), 2)).toBe(true)
  const frame = viewerFrame(model, 80, 100, true, true, 0, undefined, {
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
  const model = new FixtureModel()
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
  model.select(displayViewKey(JSON.stringify(['root', 'mixed'])))
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
  const model = new FixtureModel()
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
  model.select(displayViewKey(JSON.stringify(['root', 'table'])))
  model.cycleCollection()
  const text = viewerFrame(model, 60, 18, false, true).lines.join('\n')
  expect(text.match(/Goal\s+\|/g)).toHaveLength(1)
  expect(text).toContain('+')
  expect(text).toContain('columns (Enter detail)')
  expect(text).toContain('null')
  expect(text).toContain('false')
  expect(text).not.toContain('Goal: Patch')
  expect(text).not.toContain('Only appears after Enter')
})

test('filter draft preserves applied rows and treats all printable shortcuts literally', async () => {
  const model = new FixtureModel(),
    input = new Input()
  model.acceptView('root', v())
  model.cycleCollection()
  const keys = new FixtureKeyboard(
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
  expect(viewerFrame(model, 80, 24, false, true).lines.join('\n')).toContain(
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
  const model = new FixtureModel(),
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
  model.select(displayViewKey(JSON.stringify(['root', 'reports'])))
  model.moveRecord(1)
  model.observeCall(event('check'))
  const keys = new FixtureKeyboard(
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
  expect(model.focusedCall).toBe(callRecordKey(JSON.stringify(['root', 'check'])))
  keys.frame([], 0)
  expect(keys.state.panels).toHaveLength(0)
  keys.leave()
})

test('full attention is one action from every surface and preserves source priority', () => {
  const model = new FixtureModel(),
    input = new Input()
  model.acceptView('root', v())
  model.cycleCollection()
  model.addAttention('Flow', 'Flow error\nLiteral second line', 2)
  model.addAttention('Jig', 'Host failure\nFull known safe cause', 4)
  const keys = new FixtureKeyboard(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  input.emit('data', Buffer.from('!'))
  let frame = viewerFrame(model, 80, 24, false, true, keys.scroll, keys.anchor, keys.state)
  expect(frame.lines.join('\n')).toContain('Full known safe cause')
  input.emit('data', Buffer.from('\u001b[D'))
  frame = viewerFrame(model, 80, 24, false, true, keys.scroll, keys.anchor, keys.state)
  expect(frame.lines.join('\n')).toContain('Literal second line')
  expect(model.row?.id).toBe('a')
  keys.leave()
})

test('local collection state survives tabs and exact disclosure semantics include references', () => {
  const model = new FixtureModel()
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
  const model = new FixtureModel()
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
  model.selectRecord(callRecordKey(JSON.stringify(['worker-instance', 'child'])))
  model.expandTree(false)
  expect(model.records().filter((r) => r.kind === 'call')).toHaveLength(2)
  model.selectRecord(callRecordKey(JSON.stringify(['worker-instance', 'child'])))
  expect(model.record).toMatchObject({ hidden: 1, issues: 1 })
  model.expandTree(true)
  expect(model.records().filter((r) => r.kind === 'call')).toHaveLength(3)
  model.expandTree(false)
  expect(model.records().filter((r) => r.kind === 'call')).toHaveLength(2)
  expect(viewerFrame(model, 80, 24, false, true).lines.join('\n')).toContain('Repair logging')
  expect(model.resolve('root', { kind: 'call', operationId: 'child' }).available).toBe(false)
})

test('pathological zero-width text keeps frame bytes bounded and remains vertically reachable', () => {
  const model = new FixtureModel()
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
  model.select(displayViewKey(JSON.stringify(['root', 'unicode'])))
  model.moveRecord(1)
  const input = new Input(),
    keys = new FixtureKeyboard(
      model,
      () => {},
      () => {},
      input as any,
    )
  keys.start()
  input.emit('data', Buffer.from('\r'))
  const frame = viewerFrame(model, 80, 24, false, true, 0, undefined, keys.state)
  expect(Buffer.byteLength(frame.lines.join('\n'))).toBeLessThanOrEqual(32000)
  expect(frame.lines.filter((line) => line.includes('\u0301')).length).toBeGreaterThan(1)
  keys.leave()
})

test('zero physical dimensions draw nothing and settled facts/footer remain phase-aware on every tab', () => {
  const model = new FixtureModel()
  expect(viewerFrame(model, 0, 24, false, true).lines).toHaveLength(0)
  expect(viewerFrame(model, 80, 0, false, true).lines).toHaveLength(0)
  model.acceptView('root', v())
  model.setWorkspaceFacts({
    execution: 'returned',
    application: '"blocked"',
    cleanup: 'confirmed',
    delivery: 'written',
    completeness: 'Observation ended',
  })
  model.setWorkspacePhase('settled')
  model.setNow(1000)
  for (const surface of [displayViewKey(JSON.stringify(['root', 'jobs'])), undefined]) {
    model.select(surface)
    const text = viewerFrame(model, 120, 18, false, true).lines.join('\n')
    expect(text).toContain('Execution returned')
    expect(text).toContain('Reported application (literal outcome): "blocked"')
    expect(text).toContain('Cleanup confirmed')
    expect(text).toContain('Delivery written')
    expect(text).toContain('q closes inspection')
    expect(text).not.toContain('q continues inline')
  }
  const compact = viewerFrame(model, 18, 4, false, true).lines.join('\n')
  expect(compact).toContain('q close')
  expect(compact).toContain('^C close')
  expect(model.hostFactsText).toContain('Reported application (literal outcome): "blocked"')
})

test('human activity navigation fences later landing hints and unsupported editing sequences are no-ops', () => {
  const model = new FixtureModel(),
    input = new Input()
  const keys = new FixtureKeyboard(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  input.emit('data', Buffer.from('?'))
  model.acceptView('root', v())
  expect(model.surface).toBe('activity')
  model.select(displayViewKey(JSON.stringify(['root', 'jobs'])))
  model.cycleCollection()
  keys.frame([])
  input.emit('data', Buffer.from('/a\u001bOA\u001b[?25h'))
  expect(keys.state.panels.at(-1)).toMatchObject({ kind: 'filter', draft: 'a' })
  expect(model.filter).toBe('')
  keys.leave()
})

test('an explicit same-publisher record reference exposes its exact row through a local filter', async () => {
  const model = new FixtureModel()
  model.acceptView('root', v())
  model.cycleCollection()
  model.filterRows('b')
  await model.activate('root', { kind: 'record', viewId: 'jobs', collectionId: 'list', rowId: 'a' })
  expect(model.row?.id).toBe('a')
  expect(model.feedback).toContain('local filter cleared')
})

test('batched record-reference jumps clear originating detail before the first target frame', () => {
  for (const sameView of [false, true]) {
    const model = new FixtureModel(),
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
    model.select(displayViewKey(JSON.stringify(['root', sameView ? 'records' : 'evidence'])))
    model.moveRecord(1)
    const frames: string[] = []
    const paint = () => {
      // Read in the progress owner's order, before its post-projection frame() callback.
      frames.push(
        viewerFrame(model, 80, 24, false, true, keys.scroll, keys.anchor, keys.state).lines.join(
          '\n',
        ),
      )
    }
    const keys = new FixtureKeyboard(model, paint, () => {}, input as any)
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
    expect(frames.at(-1)).toContain('Application › [Records]')
    expect(frames.at(-1)).toMatch(/\n> beta *\n/)
    input.emit('data', Buffer.from('\r'))
    expect(frames.at(-1)).toContain('Flow · detail')
    expect(frames.at(-1)).toContain('Matter: beta')
    keys.leave()
  }
})

test('external surface and record changes reconcile detail scroll before projection', () => {
  const model = new FixtureModel(),
    input = new Input()
  model.acceptView('root', v('first'))
  model.acceptView('root', { ...v('second'), landing: undefined } as ViewItem)
  model.select(displayViewKey(JSON.stringify(['root', 'first'])))
  model.cycleCollection()
  const keys = new FixtureKeyboard(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  input.emit('data', Buffer.from('\r]'))
  expect(keys.scroll).toBe(3)
  model.select(displayViewKey(JSON.stringify(['root', 'second'])))
  const frame = viewerFrame(model, 80, 24, false, true, keys.scroll, keys.anchor, keys.state)
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
  const model = new FixtureModel()
  model.acceptView('root', {
    ...v(),
    sections: [{ blocks: [{ kind: 'report', text: 'First literal line\nLast literal line' }] }],
  })
  model.select(displayViewKey(JSON.stringify(['root', 'jobs'])))
  model.moveRecord(1)
  const record = model.record!
  const frame = viewerFrame(model, 80, 12, false, true, 999, undefined, {
    panels: [{ kind: 'detail', key: record.key, signature: record.signature, scroll: 999 }],
  })
  expect(frame.lines.join('\n')).toContain('Last literal line')
  expect(frame.scroll).toBe(2)
})

test('Enter toggles the literal detail panel and keeps the same record', () => {
  const model = new FixtureModel(),
    input = new Input()
  model.acceptView('root', v())
  model.cycleCollection()
  const keys = new FixtureKeyboard(
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
  const model = new FixtureModel()
  model.configureWorkspace({ target: 'binding:factory', startedAt: 1000 })
  model.setNow(31000)
  model.acceptView('root', v())
  model.stop()
  model.setWorkspaceFacts({
    execution: 'succeeded',
    application: '"done"',
    cleanup: 'complete',
    delivery: 'written',
  })
  model.setWorkspacePhase('settled')
  expect(model.row?.id).toBe('a')
  model.setNow(65000)
  expect(viewerFrame(model, 120, 45, false, true).lines[1]).toContain('elapsed 30s')
  for (const surface of ['activity', 'overview']) {
    model.select(surface)
    const text = viewerFrame(model, 120, 45, false, true).lines.join('\n')
    expect(text).not.toContain('Current work')
    expect(text).not.toContain('\\nApplication')
    expect(text.match(/Execution succeeded/g)).toHaveLength(1)
  }
  const browsing = new FixtureModel()
  browsing.acceptView('root', v())
  browsing.select('activity')
  browsing.setWorkspacePhase('settled')
  expect(browsing.surface).toBe('activity')
  const noHint = new FixtureModel()
  noHint.acceptView('root', { ...v('first-result'), landing: undefined } as ViewItem)
  expect(noHint.surface).toBe('activity')
  noHint.setWorkspacePhase('settled')
  expect(noHint.surface).toBe(displayViewKey(JSON.stringify(['root', 'first-result'])))
  expect(noHint.row?.id).toBe('a')
})

test('wide collections use spare width and peek a sole selected artifact with literal context', () => {
  const model = new FixtureModel()
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
  const wide = viewerFrame(model, 160, 45, false, true).lines.join('\n')
  expect(wide).toContain('Checked patch ready for human review')
  expect(wide).toContain('Goal: reject fractional HTTP status codes.')
  expect(wide).toContain('Independent cases: 4/4 passed')
  expect(wide).toContain('Delivered file: a/review.patch')
  expect(wide).toContain('Selected detail')
  expect(wide).not.toContain('Outcome: Checked patch')
  expect(wide).not.toContain('1/1 supplied / 1 reported')
  expect(activated).toBe(1)
  expect(model.preview).toBeUndefined()
  const narrow = viewerFrame(model, 80, 24, false, true).lines.join('\n')
  expect(narrow).not.toContain('Goal: reject')
  expect(narrow).toContain('Enter detail')
  for (const [width, height] of [
    [60, 18],
    [80, 24],
    [112, 32],
    [160, 60],
    [200, 90],
  ]) {
    const frame = viewerFrame(model, width!, height!, true, true)
    expect(Buffer.byteLength(frame.lines.join('\n'))).toBeLessThanOrEqual(32000)
    expect(frame.lines).toHaveLength(height!)
    for (const line of frame.lines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(width!)
  }
})

test('authored detail wraps at word boundaries while preserving escaped text and bounded long words', () => {
  const prose =
    'Requested goal: Count client errors separately from server errors. Review the patch before applying it.'
  const lines = [...wrapTerminalText(prose, 45, true)]
  expect(lines.join('')).toBe(prose)
  expect(lines.every((line) => terminalWidth(line) <= 45)).toBeTrue()
  expect(lines.some((line) => line.includes('Count client errors'))).toBeTrue()
  expect([...wrapTerminalText('a \u0301bc', 3, true)]).toEqual(['a \u0301', 'bc'])
  const accentedSpace = 'Requested goal: inspect \u0301each document carefully.'
  const accentLines = [...wrapTerminalText(accentedSpace, 26, true)]
  expect(accentLines.join('')).toBe(accentedSpace)
  expect(accentLines.every((line) => !line.startsWith('\u0301'))).toBeTrue()
  const hostile = 'Goal: \u001b[31m ' + 'x'.repeat(100) + ' ' + '\u0300'.repeat(3000) + ' 結果 🙂'
  const bounded = [...wrapTerminalText(hostile, 20, true)]
  expect(bounded.join('')).toBe(escapeTerminalText(hostile))
  for (const line of bounded) {
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(4096)
    expect(terminalWidth(line)).toBeLessThanOrEqual(20)
  }
})

test('Activity prioritizes recent domain history and retains setup and host warnings through disclosure', () => {
  const model = new FixtureModel(),
    input = new Input()
  for (let i = 0; i < 20; i++) model.addHostEntry(`setup:${i}`, `Setup step ${i}`)
  model.acceptNotice('root', 'info', 'Starting the document review', 30)
  model.addHostEntry('warning', 'Cleanup could not be confirmed', 'warning')
  model.acceptNotice('root', 'info', 'Draft ready for professional review', 40)
  model.setWorkspacePhase('settled')
  let text = viewerFrame(model, 80, 24, false, true).lines.join('\n')
  expect(text.indexOf('Draft ready')).toBeLessThan(text.indexOf('Starting the document'))
  expect(text).toContain('Cleanup could not be confirmed')
  expect(text).toContain('Jig stages · 20 reports')
  expect(text).not.toContain('Setup step 0')
  const keys = new FixtureKeyboard(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  model.selectRecord(JSON.stringify(['host', 'setup']))
  input.emit('data', Buffer.from('\r'))
  text = viewerFrame(model, 80, 45, false, true, keys.scroll, keys.anchor, keys.state).lines.join(
    '\n',
  )
  expect(text).toContain('Setup step 0')
  expect(text).toContain('Setup step 19')
  keys.leave()
})

test('diagnostics are attributed and one action away on every view without inferred severity', () => {
  const model = new FixtureModel(),
    input = new Input()
  model.acceptView('root', v())
  model.addDiagnostic('Warning title\nComplete safe explanation\u001b[31m', [
    'repair:logs',
    'patch-1',
  ])
  model.addDiagnostic('Different report', ['repair:timesheet', 'patch-1'])
  const keys = new FixtureKeyboard(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  for (const surface of [
    'activity',
    'overview',
    displayViewKey(JSON.stringify(['root', 'jobs'])),
  ]) {
    model.select(surface)
    input.emit('data', Buffer.from('d'))
    let text = viewerFrame(model, 80, 24, false, true, 0, undefined, keys.state).lines.join('\n')
    expect(text).toContain('Invocation: repair:logs / patch-1')
    expect(text).toContain('Severity was not supplied')
    expect(text).toContain('Complete safe explanation\\u001b[31m')
    expect(text).not.toContain('\u001b[31m')
    input.emit('data', Buffer.from('\u001b[C'))
    text = viewerFrame(model, 80, 24, false, true, 0, undefined, keys.state).lines.join('\n')
    expect(text).toContain('Invocation: repair:timesheet / patch-1')
    expect(text).toContain('Different report')
  }
  expect(model.attention).toHaveLength(0)
  keys.leave()
})

test('completed trees start collapsed while explicit expansion and failed descendants remain visible', () => {
  const model = new FixtureModel()
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
  const text = viewerFrame(model, 120, 45, false, true).lines.join('\n')
  expect(text).toContain('returned')
  expect(text).not.toContain('tests passed')
  const failed = new FixtureModel()
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
  const model = new FixtureModel()
  model.configureWorkspace({ target: 'saved packet', startedAt: 1000, recorded: true })
  for (const [id, title] of [
    ['recorded-result', 'Recorded result'],
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
  model.setNow(31000)
  model.setWorkspaceFacts({
    execution: 'succeeded',
    application: '"done"',
    cleanup: 'complete',
    delivery: 'written',
  })
  model.setWorkspacePhase('settled')
  const frame = viewerFrame(model, 120, 45, true, true)
  const text = frame.lines.join('\n')
  expect(text).toContain('Saved result · read-only')
  expect(text).toContain('[Recorded result] | Captured files | Diagnostics')
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
  expect(viewerFrame(model, 120, 45, false, true).lines[1]).toBe('Recorded local data')
  model.setArtifacts(
    (_publisher, ref) => (ref.path === 'review.patch' ? 'captured-patch' : undefined),
    async () => ({ text: 'captured bytes', bytes: 14, clipped: false }),
  )
  const ref = { kind: 'artifact' as const, attachment: 'packet', path: 'review.patch' }
  model.provideArtifact('saved-result', ref)
  expect(model.resolve('saved-result', ref).label).toBe('Captured recorded file: review.patch')
  expect(model.resolve('saved-result', { ...ref, path: 'missing' }).label).toContain(
    'captured recorded files',
  )
  await model.activate('saved-result', ref)
  const preview = viewerFrame(model, 120, 45, false, true, 0, undefined, {
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
  const model = new FixtureModel(),
    input = new Input()
  model.acceptView('root', v())
  for (let i = 0; i < 32; i++) model.addDiagnostic(`Report ${i}`, [`worker:${i}`])
  model.omitDiagnostics(1)
  model.setWorkspaceFacts({
    execution: 'succeeded',
    application: '"done"',
    cleanup: 'complete',
    delivery: 'written',
    completeness: 'Activity history omitted',
  })
  model.setWorkspacePhase('settled')
  const keys = new FixtureKeyboard(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  for (const surface of [
    'activity',
    'overview',
    displayViewKey(JSON.stringify(['root', 'jobs'])),
  ]) {
    model.select(surface)
    let text = viewerFrame(model, 120, 32, false, true).lines.join('\n')
    expect(text).toContain('1 updates omitted')
    expect(text).toContain('Observation Activity history omitted')
    input.emit('data', Buffer.from('d'))
    text = viewerFrame(model, 120, 32, false, true, 0, undefined, keys.state).lines.join('\n')
    expect(text).toContain('Diagnostic history incomplete: 1 report updates omitted.')
  }
  keys.leave()
  for (const [width, height] of [
    [35, 12],
    [18, 4],
  ]) {
    for (const surface of [
      'activity',
      'overview',
      displayViewKey(JSON.stringify(['root', 'jobs'])),
    ]) {
      model.select(surface)
      const frame = viewerFrame(model, width!, height!, false, true)
      expect(frame.lines.join('\n')).toContain('omitted')
      expect(frame.lines.join('\n')).toContain(width! < 28 ? 'd: omitted (1)' : '1 diagnostic')
      expect(frame.lines).toHaveLength(height!)
    }
  }
})

test('automatic details add context; exact call identity is reserved for expansion', () => {
  const model = new FixtureModel()
  model.observeCall({
    publisher: 'root',
    operationId: 'baseline-1',
    slot: 'cli',
    intent: 'Check acceptance case',
    state: 'returned',
    time: Date.parse('2026-10-08T10:15:20Z'),
  })
  model.select('overview')
  const record = model.record!
  const preview = viewerDetailParts(model, record, true)
  const full = viewerDetailParts(model, record)
  expect(preview).not.toContainEqual({ kind: 'text', text: 'Check acceptance case' })
  expect(preview).toContainEqual({
    kind: 'field',
    label: 'Last observed',
    value: '2026-10-08 10:15:20 UTC',
  })
  expect(preview.some((p) => p.kind === 'field' && p.label === 'Original operation')).toBeFalse()
  expect(full).toContainEqual({ kind: 'field', label: 'Original operation', value: 'baseline-1' })
  expect(
    preview.some(
      (p) =>
        p.kind === 'text' &&
        p.text.includes('does not establish whether the application checks passed'),
    ),
  ).toBeTrue()
  model.close()
})

test('entries with no extra detail explain that fact without opening a duplicate pane', () => {
  const model = new FixtureModel(),
    input = new Input()
  model.acceptView('root', v())
  const keys = new FixtureKeyboard(
    model,
    () => {},
    () => {},
    input as any,
  )
  keys.start()
  expect(model.record?.kind).toBe('summary')
  input.emit('data', Buffer.from('\r'))
  expect(keys.state.panels).toHaveLength(0)
  expect(model.feedback).toBe('No additional detail was supplied for this entry.')
  keys.leave()
  model.close()
})

test('sole distinct artifact peeking includes hidden/detail references and never activates ambiguous targets', async () => {
  const model = new FixtureModel()
  let requested = 0
  const artifact: Reference = { kind: 'artifact', attachment: 'evidence', path: 'report.txt' }
  const document = validateUserUpdate({
    kind: 'view',
    id: 'documents',
    title: 'Documents',
    summary: 'Supplied documents',
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'records',
            title: 'Documents',
            columns: [
              { key: 'name', label: 'Document', type: 'text' },
              { key: 'one', label: 'One', type: 'text' },
              { key: 'two', label: 'Two', type: 'text' },
              { key: 'file', label: 'Evidence', type: 'reference' },
            ],
            rows: [
              {
                id: 'a',
                cells: { name: 'Agreement', one: 'Literal', two: 'Literal', file: artifact },
                details: [
                  { kind: 'report', text: 'Context remains reachable', references: [artifact] },
                ],
              },
              {
                id: 'b',
                cells: { name: 'Ambiguous', one: '', two: '', file: artifact },
                details: [
                  {
                    kind: 'facts',
                    items: [{ label: 'Call', value: { kind: 'call', operationId: 'own' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }) as ViewItem
  model.acceptView('root', document)
  model.setArtifacts(
    (_publisher, ref) => ref.path,
    async () => {
      requested++
      return { text: 'Primary immutable content', bytes: 25, clipped: false }
    },
  )
  model.setArtifactCapture({
    generation: 'capture',
    sourcePublisher: 'root',
    provenance: 'verified-delivery',
    phase: 'ready',
    files: [{ path: 'report.txt', bytes: 25, state: 'text', clipped: false }],
  })
  model.select(displayViewKey(JSON.stringify(['root', 'documents'])))
  model.selectRecord(rowRecordKey('records', 'a'))
  model.peekSelectedArtifact()
  await waitFor(() => model.previewState !== 'loading')
  expect(requested).toBe(1)
  expect(model.preview?.text).toBe('Primary immutable content')
  const parts = viewerDetailParts(model, model.record!, true)
  expect(parts[0]).toEqual({ kind: 'heading', text: 'report.txt' })
  expect(parts[1]).toEqual({ kind: 'text', text: 'Primary immutable content' })
  expect(parts).toContainEqual({ kind: 'text', text: 'Context remains reachable' })
  model.acceptView('root', {
    ...document,
    sections: [
      {
        blocks: [
          {
            ...(document.sections[0]!.blocks[0] as import('@jigging/user-updates').Collection),
            rows: [
              document.sections[0]!.blocks[0].kind === 'collection'
                ? document.sections[0]!.blocks[0].rows[0]!
                : undefined!,
              {
                id: 'b',
                cells: { name: 'Different unselected record', one: '', two: '', file: artifact },
                details: [],
              },
            ],
          },
        ],
      },
    ],
  })
  model.peekSelectedArtifact()
  await waitFor(() => model.previewState !== 'loading')
  expect(requested).toBe(1)
  model.selectRecord(rowRecordKey('records', 'b'))
  model.acceptView('root', document)
  model.peekSelectedArtifact()
  await waitFor(() => model.previewState !== 'loading')
  expect(requested).toBe(1)
  expect(model.preview).toBeUndefined()
})

test('auto artifact peeks fence A to B to A and capture replacement without stale labels or bytes', async () => {
  const model = new FixtureModel(),
    pending: ((value: { text: string; bytes: number; clipped: boolean }) => void)[] = []
  const document = validateUserUpdate({
    kind: 'view',
    id: 'reports',
    title: 'Reports',
    summary: 'Reports',
    sections: [
      {
        blocks: ['a', 'b'].map((path) => ({
          kind: 'report',
          text: path,
          references: [{ kind: 'artifact', attachment: 'evidence', path }],
        })),
      },
    ],
  }) as ViewItem
  model.acceptView('root', document)
  model.setArtifacts(
    (_publisher, ref) => ref.path,
    () => new Promise((resolve) => pending.push(resolve)),
  )
  const capture = {
    generation: 'one',
    sourcePublisher: 'root',
    provenance: 'verified-delivery' as const,
    phase: 'ready' as const,
    files: ['a', 'b'].map((path) => ({ path, bytes: 1, state: 'text' as const, clipped: false })),
  }
  model.setArtifactCapture(capture)
  model.select(displayViewKey(JSON.stringify(['root', 'reports'])))
  model.selectRecord('block:0:0')
  model.peekSelectedArtifact()
  model.selectRecord('block:0:1')
  model.peekSelectedArtifact()
  model.selectRecord('block:0:0')
  model.peekSelectedArtifact()
  expect(pending).toHaveLength(1)
  pending[0]!({ text: 'Old A', bytes: 5, clipped: false })
  await waitFor(() => pending.length === 2)
  expect(model.preview).toBeUndefined()
  expect(model.previewTitle).toBe('a')
  expect(pending).toHaveLength(2)
  model.setArtifactCapture({ ...capture, generation: 'two' })
  pending[1]!({ text: 'Still old A', bytes: 11, clipped: false })
  await waitFor(() => pending.length === 3)
  expect(model.preview).toBeUndefined()
  expect(pending).toHaveLength(3)
  pending[2]!({ text: 'Current A', bytes: 9, clipped: false })
  await waitFor(() => model.previewState !== 'loading')
  expect(model.preview?.text).toBe('Current A')
})

test('host Delivered files is independent of views and selection previews captured bytes', async () => {
  const model = new FixtureModel(),
    input = new Input()
  let previews = 0
  model.setArtifacts(
    () => undefined,
    async () => {
      previews++
      return { text: '', bytes: 0, clipped: false }
    },
  )
  model.setArtifactCapture({
    generation: 'inventory',
    sourcePublisher: 'root',
    provenance: 'verified-delivery',
    phase: 'ready',
    files: [
      { path: 'empty.txt', bytes: 0, state: 'empty', clipped: false },
      { path: 'binary', bytes: 5, state: 'non-text', clipped: false },
    ],
  })
  model.select('files')
  expect(model.views.size).toBe(0)
  expect(model.records().map((record) => record.file?.path)).toEqual(['empty.txt', 'binary'])
  model.peekSelectedArtifact()
  expect(previews).toBe(1)
  const keyboard = new FixtureKeyboard(
    model,
    () => {},
    () => {},
    input as unknown as NodeJS.ReadStream,
  )
  keyboard.start()
  input.emit('data', Buffer.from('\r'))
  await waitFor(() => model.previewState !== 'loading')
  expect(previews).toBe(1)
  expect(model.previewState).toBe('empty')
  expect(keyboard.state.panels.at(-1)?.kind).toBe('preview')
  input.emit('data', Buffer.from('\u001b'))
  await new Promise((resolve) => setTimeout(resolve, 40))
  expect(keyboard.active).toBe(true)
  expect(model.surface).toBe('files')
  keyboard.leave()
})

test('expanded captured content has literal retained-excerpt search without another supplier operation', async () => {
  const model = new FixtureModel(),
    input = new Input()
  let previews = 0
  model.setArtifacts(
    () => undefined,
    async () => {
      previews++
      return { text: 'First line\nLiteral ../file?q=!\nLast line', bytes: 38, clipped: false }
    },
  )
  model.setArtifactCapture({
    generation: 'search',
    sourcePublisher: 'root',
    provenance: 'verified-delivery',
    phase: 'ready',
    files: [{ path: 'report.txt', bytes: 38, state: 'text', clipped: false }],
  })
  model.select('files')
  const keyboard = new FixtureKeyboard(
    model,
    () => {},
    () => {},
    input as unknown as NodeJS.ReadStream,
  )
  keyboard.start()
  input.emit('data', Buffer.from('\r'))
  await waitFor(() => model.previewState !== 'loading')
  input.emit('data', Buffer.from('/../file?q=!\r'))
  expect(previews).toBe(1)
  expect(keyboard.state.panels.at(-1)).toMatchObject({
    kind: 'preview',
    query: '../file?q=!',
    matchOffset: 19,
  })
  expect(model.feedback).toBe('Literal match in retained excerpt')
  const frame = viewerFrame(model, 80, 24, false, true, 0, undefined, keyboard.state)
  expect(frame.lines.join('\n')).toContain('Literal ../file?q=!')
  input.emit('data', Buffer.from('/absent\r'))
  expect(model.feedback).toBe('No literal match in the retained excerpt')
  expect(previews).toBe(1)
  keyboard.leave()
})
