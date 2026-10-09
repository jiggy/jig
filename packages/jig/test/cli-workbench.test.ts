import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import {
  type Block,
  type Reference,
  type ViewItem,
  validateUserUpdate,
} from '@jigging/user-updates'
import {
  PrivateDashboardInput,
  privateDashboardDetailParts,
  privateDashboardFrame,
  privateDashboardHasContext,
} from '../src/cli-dashboard.js'
import { privateRecordedViewRole } from '../src/cli-display-semantics.js'
import { PrivateRunModel, privateRowRecordKey } from '../src/cli-run-model.js'

const view = (blocks: Block[], id = 'work', landing = true): ViewItem =>
  validateUserUpdate({
    kind: 'view',
    id,
    title: 'Documents',
    summary: 'Review supplied documents',
    ...(landing ? { landing: true } : {}),
    sections: [{ blocks }],
  }) as ViewItem
const collection = (ids = ['a', 'b', 'c'], reference?: Reference): Block => ({
  kind: 'collection',
  id: 'records',
  title: 'Documents',
  columns: [{ key: 'name', label: 'Document', type: 'text' }],
  rows: ids.map((id) => ({
    id,
    cells: { name: id },
    ...(reference
      ? { details: [{ kind: 'report' as const, text: 'Related work', references: [reference] }] }
      : {}),
  })),
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
function keyboard(model: PrivateRunModel) {
  const input = new Input()
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {},
    input as unknown as NodeJS.ReadStream,
  )
  keys.start()
  return { input, keys }
}

test('navigation shares host/application groups, every retained view and exclusive saved roles', () => {
  const model = new PrivateRunModel()
  for (let source = 0; source < 4; source++)
    for (let id = 0; id < 8; id++)
      model.acceptView(`source-${source}`, view([], `view-${id}`, false))
  expect(model.destinations()).toHaveLength(35)
  expect(
    model
      .destinations()
      .slice(0, 3)
      .map((entry) => entry.title),
  ).toEqual(['Execution', 'Activity', 'Delivered files'])
  expect(
    model
      .destinations()
      .slice(3)
      .every((entry) => entry.group === 'application'),
  ).toBeTrue()
  expect(new Set(model.surfaceKeys()).size).toBe(35)
  for (const name of ['recorded-result', 'files', 'diagnostics', 'constructor', 'toString'])
    expect(privateRecordedViewRole(true, 'root', name)).toBeUndefined()
  expect(privateRecordedViewRole(false, 'saved-result', 'files')).toBeUndefined()
  expect(privateRecordedViewRole(true, 'saved-result', 'constructor')).toBeUndefined()
  const saved = new PrivateRunModel()
  saved.configureWorkspace({ target: 'packet', recorded: true })
  for (const id of ['recorded-result', 'files', 'diagnostics'])
    saved.acceptView('saved-result', view([], id, false))
  expect(saved.destinations().map((entry) => entry.title)).toEqual([
    'Recorded result',
    'Captured files',
    'Diagnostics',
  ])
})

test('view chooser reaches the last of all views, and printable v remains literal in filter drafts', () => {
  const model = new PrivateRunModel()
  for (let i = 0; i < 8; i++) model.acceptView('root', view([collection()], `view-${i}`, i === 0))
  const { input, keys } = keyboard(model)
  input.emit('data', Buffer.from('v\u001b[F'))
  const frame = privateDashboardFrame(model, 80, 14, false, true, 0, undefined, keys.state)
  expect(frame.lines.join('\n')).toContain('Documents')
  input.emit('data', Buffer.from('\r'))
  expect(model.surface).toBe(JSON.stringify(['root', 'view-7']))
  model.cycleCollection()
  input.emit('data', Buffer.from('/v\r'))
  expect(model.filter).toBe('v')
  expect(keys.state.panels).toHaveLength(0)
  keys.leave()
})

test('actual clipped teasers remain expandable while empty context does not allocate a detail pane', () => {
  const model = new PrivateRunModel()
  const literal = 'START ' + 'A'.repeat(90) + ' END'
  model.acceptView('root', view([{ kind: 'report', text: literal }]))
  model.selectRecord('block:0:0')
  privateDashboardFrame(model, 49, 20, false, true)
  expect(privateDashboardDetailParts(model, model.record!, true)).toContainEqual({
    kind: 'text',
    text: literal,
  })
  const { input, keys } = keyboard(model)
  input.emit('data', Buffer.from('\r'))
  expect(keys.state.panels.at(-1)?.kind).toBe('detail')
  expect(privateDashboardDetailParts(model, model.record!, false)).toContainEqual({
    kind: 'text',
    text: literal,
  })
  keys.leave()
  model.acceptView('root', view([{ kind: 'report', text: 'Brief' }]))
  model.selectRecord('block:0:0')
  expect(privateDashboardHasContext(model, model.record)).toBeFalse()
  model.observeCall({
    publisher: 'root',
    operationId: 'test',
    slot: 'review',
    state: 'returned',
    time: 1000,
  })
  model.select('overview')
  expect(privateDashboardHasContext(model, model.record)).toBeFalse()
})

test('replaced reference chooser cannot activate a cached old target before repaint', async () => {
  const model = new PrivateRunModel()
  const ref = (rowId: string): Reference => ({
    kind: 'record',
    viewId: 'work',
    collectionId: 'records',
    rowId,
  })
  model.acceptView(
    'root',
    view([{ kind: 'report', text: 'Evidence', references: [ref('a')] }, collection()]),
  )
  model.selectRecord('block:0:0')
  const { input, keys } = keyboard(model)
  input.emit('data', Buffer.from('r'))
  model.acceptView(
    'root',
    view([{ kind: 'report', text: 'Evidence', references: [ref('b')] }, collection()]),
  )
  input.emit('data', Buffer.from('\r'))
  expect(model.record?.key).toBe('block:0:0')
  expect(model.feedback).toContain('Selected reference unavailable')
  input.emit('data', Buffer.from('j\r'))
  expect(model.row?.id).toBe('b')
  input.emit('data', Buffer.from('\u001b'))
  await new Promise((resolve) => setTimeout(resolve, 40))
  expect(model.record?.key).toBe('block:0:0')
  expect(keys.active).toBeTrue()
  keys.leave()
})

test('reference return restores preceding surviving row, local filters and scroll after away-view replacement', async () => {
  const model = new PrivateRunModel()
  model.observeCall({
    publisher: 'root',
    operationId: 'review',
    slot: 'worker',
    state: 'active',
    time: 1000,
  })
  model.acceptView(
    'root',
    view([collection(['a', 'b', 'c'], { kind: 'call', operationId: 'review' })]),
  )
  model.cycleCollection()
  model.moveRecord(2)
  model.local.scroll = 2
  const { input, keys } = keyboard(model)
  input.emit('data', Buffer.from('r\r'))
  expect(model.surface).toBe('overview')
  model.acceptView('root', view([collection(['a', 'b'], { kind: 'call', operationId: 'review' })]))
  input.emit('data', Buffer.from('\u001b'))
  await new Promise((resolve) => setTimeout(resolve, 40))
  expect(model.surface).toBe(JSON.stringify(['root', 'work']))
  expect(model.record?.key).toBe(privateRowRecordKey('records', 'b'))
  expect(model.local.scroll).toBe(2)
  expect(keys.active).toBeTrue()
  keys.leave()
})

test('a removed sort column cannot reorder supplied rows or leave a misleading sort label', () => {
  const model = new PrivateRunModel()
  const block = collection(['z', 'a']) as Extract<Block, { kind: 'collection' }>
  const ranked = {
    ...block,
    columns: [...block.columns, { key: 'rank', label: 'Rank', type: 'number' as const }],
    rows: block.rows.map((row, index) => ({ ...row, cells: { ...row.cells, rank: index } })),
  }
  model.acceptView('root', view([ranked]))
  model.cycleCollection()
  model.sortRows()
  model.sortRows()
  expect(model.local.sorts.get('records')?.key).toBe('rank')
  model.acceptView('root', view([block]))
  expect(model.visibleRows().map((row) => row.id)).toEqual(['z', 'a'])
  expect(model.local.sorts.has('records')).toBeFalse()
})

test('return skips retired intermediates and explains an entirely retired history without exiting', async () => {
  const model = new PrivateRunModel()
  const next = (id: string): Reference => ({
    kind: 'record',
    viewId: id,
    collectionId: 'records',
    rowId: 'a',
  })
  model.acceptView('root', view([collection(['a'], next('two'))], 'one'))
  model.acceptView('root', view([collection(['a'], next('three'))], 'two', false))
  model.acceptView('root', view([collection(['a'])], 'three', false))
  model.cycleCollection()
  const { input, keys } = keyboard(model)
  input.emit('data', Buffer.from('r\rr\r'))
  model.acceptView('root', { kind: 'retire-view', id: 'two' })
  input.emit('data', Buffer.from('\u001b'))
  await new Promise((resolve) => setTimeout(resolve, 40))
  expect(model.surface).toBe(JSON.stringify(['root', 'one']))
  expect(model.feedback).toContain('intermediate view was retired')
  model.acceptView('root', view([collection(['a'], next('three'))], 'one'))
  input.emit('data', Buffer.from('r\r'))
  model.acceptView('root', { kind: 'retire-view', id: 'one' })
  input.emit('data', Buffer.from('\u001b'))
  await new Promise((resolve) => setTimeout(resolve, 40))
  expect(model.surface).toBe(JSON.stringify(['root', 'three']))
  expect(model.feedback).toContain('return views were retired')
  expect(keys.active).toBeTrue()
  input.emit('data', Buffer.from('q'))
  expect(keys.active).toBeFalse()
})

test('reference return checks enclosing lifetime before navigating', async () => {
  const model = new PrivateRunModel()
  model.acceptView(
    'root',
    view([
      collection(['a'], { kind: 'record', viewId: 'two', collectionId: 'records', rowId: 'a' }),
    ]),
  )
  model.acceptView('root', view([collection(['a'])], 'two', false))
  model.cycleCollection()
  const input = new Input()
  let within = true,
    checks = 0
  const keys = new PrivateDashboardInput(
    model,
    () => {},
    () => {},
    input as unknown as NodeJS.ReadStream,
    () => {},
    () => {
      checks++
      return within
    },
  )
  keys.start()
  input.emit('data', Buffer.from('r\r'))
  const before = checks
  within = false
  input.emit('data', Buffer.from('\u001b'))
  await new Promise((resolve) => setTimeout(resolve, 40))
  expect(checks).toBe(before + 1)
  expect(keys.active).toBeFalse()
  expect(model.surface).toBe(JSON.stringify(['root', 'two']))
})

test('actual textual report prefix clipping never makes the literal tail unreachable', () => {
  const model = new PrivateRunModel()
  const text = 'A'.repeat(68) + ' END'
  model.acceptView('root', view([{ kind: 'report', text }]))
  model.selectRecord('block:0:0')
  expect(privateDashboardFrame(model, 80, 24, false, true).lines.join('\n')).not.toContain(' END')
  const { input, keys } = keyboard(model)
  input.emit('data', Buffer.from('\r'))
  expect(keys.state.panels.at(-1)?.kind).toBe('detail')
  expect(
    privateDashboardFrame(model, 80, 24, false, true, 0, undefined, keys.state).lines.join('\n'),
  ).toContain(' END')
  keys.leave()
})

test('prefix bytes at the combining-mark limit preserve explicit literal report expansion', () => {
  const model = new PrivateRunModel()
  const text = 'A' + '\u0301'.repeat(2044) + 'END'
  model.acceptView('root', view([{ kind: 'report', text }]))
  model.selectRecord('block:0:0')
  expect(privateDashboardFrame(model, 49, 24, false, true).lines.join('\n')).not.toContain('END')
  const { input, keys } = keyboard(model)
  input.emit('data', Buffer.from('\r'))
  expect(keys.state.panels.at(-1)?.kind).toBe('detail')
  expect(privateDashboardDetailParts(model, model.record!)).toContainEqual({ kind: 'text', text })
  keys.leave()
})
