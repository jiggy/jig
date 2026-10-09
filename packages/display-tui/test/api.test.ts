import { expect, test } from 'bun:test'
import type { DisplaySnapshotEnvelope } from '@jigging/display-model'
import { createTui, prepareTui, TuiSupportError, type TuiSupport } from '../src/index.js'
import { createInlineDisplay } from '../src/inline.js'
import { ViewerModel } from '../src/viewer-model.js'
import { snapshot } from './fixtures.js'

function supplied() {
  const value = snapshot()
  value.rootSourceId = 'source-with-no-host-name'
  value.artifacts.sourceId = value.rootSourceId
  value.views = [
    {
      id: 'view-opaque',
      sourceId: value.rootSourceId,
      sourceLabel: 'Supplied source',
      updatedAt: 10,
      value: {
        kind: 'view',
        id: 'findings',
        title: 'Literal findings',
        landing: true,
        summary: 'Retained observation',
        sections: [{ blocks: [{ kind: 'report', text: 'Review this evidence' }] }],
      },
    },
  ]
  return value
}

test('inline owns immutable observations, bounds frames and visibly rejects malformed replacements', () => {
  const value = supplied()
  const display = createInlineDisplay({ snapshot: value })
  value.views[0]!.value.summary = 'Mutated after construction'
  let frame = display.frame({ columns: 80, rows: 24, color: false }).lines.join('\n')
  expect(frame).toContain('Retained observation')
  expect(frame).not.toContain('Mutated after construction')
  expect(frame).toContain('open terminal inspection')
  display.update({ ...value, revision: 2, views: [{}] } as unknown as DisplaySnapshotEnvelope)
  frame = display.frame({ columns: 80, rows: 24, color: false }).lines.join('\n')
  expect(frame).toContain('malformed')
  expect(frame).toContain('Retained observation')
  expect(
    Buffer.byteLength(display.frame({ columns: 1e9, rows: 1e9, color: true }).lines.join('\n')),
  ).toBeLessThanOrEqual(32768)
  display.dispose()
  display.update(value)
  expect(display.frame({ columns: 80, rows: 24, color: false })).toEqual({ lines: [] })
  display.dispose()
})

test('equal revision refresh updates the captured clock without stealing local state or requesting repaint', () => {
  const value = supplied()
  let changes = 0
  const model = new ViewerModel(value, { onChange: () => changes++ })
  model.selectRecord('block:0:0')
  model.local.scroll = 3
  const count = changes
  model.update({ ...value, workspace: { ...value.workspace, elapsedMs: 1200 } })
  expect(model.workspace.elapsedMs).toBe(1200)
  expect(model.record?.key).toBe('block:0:0')
  expect(model.local.scroll).toBe(3)
  expect(changes).toBe(count)
  model.close()
})

test('an unavailable observation clock is displayed without throwing during projection', () => {
  const value = supplied()
  value.views[0]!.updatedAt = Number.POSITIVE_INFINITY
  value.views[0]!.ended = 'Observation ended'
  const display = createInlineDisplay({ snapshot: value })
  expect(display.frame({ columns: 80, rows: 24, color: false }).lines.join('\n')).toContain(
    'Time unavailable',
  )
  display.dispose()
})

test('opaque support rejects fabricated values before constructing a native viewer', async () => {
  await expect(createTui({} as TuiSupport, { snapshot: supplied() })).rejects.toBeInstanceOf(
    TuiSupportError,
  )
})

test('replacement collection identities release old filters while stable identities retain their draft', () => {
  const value = supplied()
  const collection = (id: string) => ({
    kind: 'collection' as const,
    id,
    title: 'Supplied records',
    columns: [{ key: 'name', label: 'Name', type: 'text' as const }],
    rows: [{ id: 'one', cells: { name: 'kept' } }],
  })
  value.views[0]!.value.sections = [{ blocks: [collection('first')] }]
  const model = new ViewerModel(value)
  model.cycleCollection()
  model.filterRows('kept')
  model.update({ ...value, revision: 2 })
  expect(model.filter).toBe('kept')
  for (let index = 0; index < 64; index++) {
    value.views[0]!.value.sections = [{ blocks: [collection(`replacement-${index}`)] }]
    model.update({ ...value, revision: index + 3 })
    model.cycleCollection()
    expect(model.filter).toBe('')
    model.filterRows('kept')
    expect(model.local.filters.size).toBe(1)
  }
  model.close()
})

test('public native display emits local intents, owns one pending frame and becomes inert after disposal', async () => {
  const raw = process.stdin.isRaw
  const listeners = process.stdin.listenerCount('data')
  const value = supplied()
  let changes = 0
  const actions: string[] = []
  const display = await createTui(await prepareTui(), {
    snapshot: value,
    theme: 'one-light',
    onChange: () => changes++,
    onAction: (action) => actions.push(action),
  })
  const viewport = { columns: 100, rows: 28, color: false }
  try {
    display.update({ ...value, workspace: { ...value.workspace, elapsedMs: 15 } })
    expect(changes).toBe(0)
    const first = display.frame(viewport)
    expect(display.frame({ ...viewport, columns: 120 })).toBe(first)
    expect((await first).text).toContain('Review this evidence')
    const replacing = display.frame({ ...viewport, color: true })
    display.update({ ...value, workspace: { ...value.workspace, elapsedMs: 20 } })
    expect((await replacing).text).toBe('')
    expect((await display.frame({ ...viewport, color: true })).text).toContain('Literal findings')
    display.input(Buffer.from('?'))
    expect(changes).toBeGreaterThan(0)
    expect((await display.frame(viewport)).text).toContain('Workspace help')
    const pending = display.frame({ ...viewport, color: true })
    display.dispose()
    expect((await pending).text).toBe('')
    const prior = changes
    display.input(Buffer.from('\u001b'))
    display.input(Buffer.from('\u0003'))
    display.update(value)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(changes).toBe(prior)
    expect(actions).toEqual([])
    expect(await display.frame(viewport)).toEqual({ text: '' })
    expect(process.stdin.isRaw).toBe(raw)
    expect(process.stdin.listenerCount('data')).toBe(listeners)
  } finally {
    display.dispose()
  }
})

test('phase-aware interrupt remains an intent; interaction lifetime prevents navigation', async () => {
  for (const phase of ['live', 'settled'] as const) {
    const value = supplied()
    value.workspace.phase = phase
    const actions: string[] = []
    const display = await createTui(await prepareTui(), {
      snapshot: value,
      onAction: (action) => actions.push(action),
    })
    display.input(Buffer.from('\u0003q'))
    expect(actions).toEqual([phase === 'live' ? 'interrupt' : 'close'])
    expect(value.workspace.phase).toBe(phase)
    display.dispose()
  }
  let changes = 0
  const actions: string[] = []
  const display = await createTui(await prepareTui(), {
    snapshot: supplied(),
    interactionAllowed: () => false,
    onChange: () => changes++,
    onAction: (action) => actions.push(action),
  })
  display.input(Buffer.from('j'))
  expect(actions).toEqual(['close'])
  expect(changes).toBe(0)
  display.dispose()
})

test('preview replies are fenced by supplied capture identity and disposal releases callbacks', async () => {
  const value = supplied()
  value.artifacts.files = [
    { id: 'artifact-opaque', path: 'evidence.txt', bytes: 4, state: 'text', clipped: false },
  ]
  value.artifacts.permittedAttachments = ['output']
  let reply!: (value: any) => void
  let reads = 0,
    changes = 0
  const model = new ViewerModel(value, {
    onChange: () => changes++,
    preview: (intent) => {
      expect(intent.artifactId).toBe('artifact-opaque')
      expect(intent.captureGeneration).toBe(reads === 0 ? 'fixture-capture' : 'replacement')
      reads++
      return new Promise((resolve) => {
        reply = resolve
      })
    },
  })
  const ref = { kind: 'artifact' as const, attachment: 'output', path: 'evidence.txt' }
  const first = model.activate(value.rootSourceId, ref)
  await model.activate(value.rootSourceId, ref)
  expect(reads).toBe(1)
  model.update({
    ...value,
    revision: 2,
    artifacts: { ...value.artifacts, generation: 'replacement' },
  })
  reply({
    artifactId: 'artifact-opaque',
    captureGeneration: 'fixture-capture',
    provenance: 'verified-delivery',
    state: 'text',
    text: 'late',
    bytes: 4,
    clipped: false,
  })
  await first
  expect(model.preview).toBeUndefined()
  const next = model.activate(value.rootSourceId, ref)
  expect(reads).toBe(2)
  const count = changes
  model.close()
  reply({
    artifactId: 'artifact-opaque',
    captureGeneration: 'replacement',
    provenance: 'verified-delivery',
    state: 'text',
    text: 'late',
    bytes: 4,
    clipped: false,
  })
  await next
  expect(model.preview).toBeUndefined()
  expect(changes).toBe(count)
})
