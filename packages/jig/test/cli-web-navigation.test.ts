import { expect, test } from 'bun:test'
import type { Collection, Reference } from '@jigging/user-updates'
import type { PrivateWebSnapshot } from '../src/cli-web-snapshot.js'
import {
  PrivateBrowserClock,
  privateBrowserLiteral,
  privateBrowserLocal,
  privateBrowserPeek,
  privateBrowserRecords,
  privateBrowserReferences,
  privateBrowserResolve,
  privateBrowserRowKey,
  privateBrowserRows,
  privateBrowserSurvivingSelection,
  privateBrowserTabs,
  privateBrowserValue,
} from '../src/web/navigation.js'

const ref: Reference = { kind: 'artifact', attachment: 'output', path: 'notes.txt' }
const collection: Collection = {
  kind: 'collection',
  id: 'items',
  title: 'Supplied items',
  columns: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'count', label: 'Count', type: 'number' },
    { key: 'present', label: 'Present', type: 'boolean' },
    { key: 'file', label: 'Evidence', type: 'reference' },
  ],
  rows: [
    {
      id: 'a',
      cells: { name: 'Alpha', count: 10, present: false, file: ref },
      details: [
        {
          kind: 'report',
          text: 'Context',
          references: [{ path: 'notes.txt', attachment: 'output', kind: 'artifact' }],
        },
      ],
    },
    { id: 'b', cells: { name: 'Beta', count: 2, present: true, file: null } },
  ],
}
const view: PrivateWebSnapshot['views'][number] = {
  id: 'opaque-view',
  sourceId: 'root',
  sourceLabel: 'Root publisher',
  updatedAt: 0,
  value: {
    kind: 'view',
    id: 'authored-view',
    title: 'Results',
    summary: 'Supplied summary',
    sections: [
      {
        title: 'Context',
        blocks: [
          { kind: 'report', text: 'First report' },
          { kind: 'facts', items: [{ label: 'False is data', value: false }] },
          { kind: 'progress', label: 'Count', completed: 0, total: 0 },
          collection,
        ],
      },
    ],
  },
}
function snapshot(): PrivateWebSnapshot {
  return {
    kind: 'snapshot',
    revision: 1,
    mode: 'live-run',
    workspace: { target: 'Task', phase: 'settled', hostStage: 'Done', elapsedMs: 0 },
    context: '',
    omissions: { calls: 0, journal: { flow: 0, host: 0, diagnostic: 0 } },
    views: [view],
    calls: [
      {
        id: 'call-1',
        sourceId: 'root',
        operationId: 'operation',
        slot: 'slot',
        state: 'returned',
        firstObservedAt: 0,
        observedAt: 0,
      },
    ],
    activities: [],
    journal: [],
    attention: [],
    artifacts: {
      generation: 'capture',
      sourceId: 'root',
      permittedAttachments: ['output'],
      provenance: 'verified-delivery',
      phase: 'ready',
      files: [{ id: 'f'.repeat(64), path: 'notes.txt', bytes: 12, state: 'text', clipped: false }],
    },
  }
}

test('all supplied block kinds and rows remain reachable in order', () => {
  const entries = privateBrowserRecords(view, privateBrowserLocal())
  expect(entries.map((entry) => entry.title)).toEqual([
    'View summary',
    'Report',
    'Facts',
    'Count',
    'Alpha',
    'Beta',
  ])
  expect(entries[4]!.section).toBe('Context')
  expect(privateBrowserValue(false)).toBe('false')
  expect(privateBrowserValue(null)).toBe('null')
  expect(privateBrowserValue('')).toBe('')
})

test('saved navigation exposes one report, file inventory and diagnostics without synthetic history', () => {
  expect(privateBrowserTabs(undefined, 'recorded-packet').map((tab) => tab.id)).toEqual(['files'])
  const data = snapshot()
  data.views = [
    { ...view, id: 'report', hostRole: 'recorded-report' },
    { ...view, id: 'manifest', hostRole: 'recorded-files' },
    { ...view, id: 'diagnostics', hostRole: 'recorded-diagnostics' },
  ]
  data.mode = 'recorded-packet'
  expect(privateBrowserTabs(data).map((tab) => tab.id)).toEqual(['report', 'files', 'diagnostics'])
  data.mode = 'live-run'
  data.views = [{ ...view, value: { ...view.value, id: 'files', title: 'Files' } }]
  expect(privateBrowserTabs(data).map((tab) => tab.id)).toEqual([
    'overview',
    'activity',
    'files',
    view.id,
  ])
  expect(privateBrowserTabs(data).at(-1)?.application).toBe(true)
})

test('peek counts hidden cells and detail references and deduplicates complete typed identities', () => {
  const record = privateBrowserRecords(view, privateBrowserLocal())[4]!
  expect(privateBrowserReferences(record)).toEqual([ref])
  expect(privateBrowserPeek(record)).toEqual(ref)
  const changed = {
    ...record,
    row: {
      ...record.row!,
      details: [
        {
          kind: 'facts' as const,
          items: [
            { label: 'Another intent', value: { kind: 'call' as const, operationId: 'operation' } },
          ],
        },
      ],
    },
  }
  expect(privateBrowserReferences(changed)).toHaveLength(2)
  expect(privateBrowserPeek(changed)).toBeUndefined()
  expect(
    privateBrowserPeek({
      ...record,
      row: { ...record.row!, cells: { name: 'notes.txt' }, details: [] },
    }),
  ).toBeUndefined()
})

test('artifact access requires matching publisher, attachment and manifest path before opaque host ID', () => {
  const body = snapshot()
  expect(privateBrowserResolve(body, 'root', ref)).toEqual({
    kind: 'artifact',
    label: 'notes.txt',
    artifactId: 'f'.repeat(64),
    captureGeneration: 'capture',
  })
  for (const [source, reference] of [
    ['child', ref],
    ['root', { ...ref, attachment: 'elsewhere' }],
    ['root', { ...ref, path: 'other.txt' }],
  ] as const)
    expect(privateBrowserResolve(body, source, reference).kind).toBe('unavailable')
  body.artifacts.phase = 'pending'
  expect(privateBrowserResolve(body, 'root', ref)).toEqual({
    kind: 'unavailable',
    label: 'Artifact pending verified delivery',
  })
  body.artifacts.phase = 'unavailable'
  expect(privateBrowserResolve(body, 'root', ref).kind).toBe('unavailable')
})

test('record and call references remain local to their accepted publisher', () => {
  const body = snapshot()
  const record: Reference = {
    kind: 'record',
    viewId: 'authored-view',
    collectionId: 'items',
    rowId: 'a',
  }
  expect(privateBrowserResolve(body, 'root', record)).toEqual({
    kind: 'record',
    label: 'Results / a',
    viewId: 'opaque-view',
    collectionId: 'items',
    rowKey: privateBrowserRowKey('items', 'a'),
  })
  expect(privateBrowserResolve(body, 'root', { kind: 'call', operationId: 'operation' }).kind).toBe(
    'call',
  )
  expect(privateBrowserResolve(body, 'child', record).kind).toBe('unavailable')
  expect(
    privateBrowserResolve(body, 'child', { kind: 'call', operationId: 'operation' }).kind,
  ).toBe('unavailable')
})

test('local filtering and stable typed sorts leave authored data untouched', () => {
  const state = privateBrowserLocal()
  state.sorts.set('items', { key: 'count', descending: false })
  expect(privateBrowserRows(collection, state).map((row) => row.id)).toEqual(['b', 'a'])
  state.filters.set('items', 'notes.txt')
  expect(privateBrowserRows(collection, state).map((row) => row.id)).toEqual(['a'])
  expect(collection.rows.map((row) => row.id)).toEqual(['a', 'b'])
  state.filters.set('items', 'absent')
  expect(privateBrowserRecords(view, state).at(-1)?.text).toBe('No matching supplied records.')
})

test('deleted selection chooses preceding survivor and changed evidence changes its signature', () => {
  expect(privateBrowserSurvivingSelection(['a', 'b', 'c'], 'c', ['a', 'b'])).toBe('b')
  expect(privateBrowserSurvivingSelection(['a', 'b'], 'a', ['b'])).toBe('b')
  expect(privateBrowserSurvivingSelection(['a'], 'a', [])).toBeUndefined()
  const before = privateBrowserRecords(view, privateBrowserLocal())[4]!
  const updated = {
    ...view,
    value: {
      ...view.value,
      sections: [
        {
          blocks: [
            {
              ...collection,
              rows: [
                {
                  ...collection.rows[0]!,
                  details: [{ kind: 'report' as const, text: 'Changed retained meaning' }],
                },
              ],
            },
          ],
        },
      ],
    },
  }
  const after = privateBrowserRecords(updated, privateBrowserLocal()).find(
    (record) => record.key === before.key,
  )!
  expect(after.key).toBe(before.key)
  expect(after.signature).not.toBe(before.signature)
})

test('literal text exposes invisible controls while preserving whitespace and inert markup', () => {
  expect(privateBrowserLiteral('  <img src=x onerror=alert(1)>\n\t\u202e\u0000')).toBe(
    '  <img src=x onerror=alert(1)>\n\t\\u202e\\u0000',
  )
})

test('elapsed freezes while stale and equal revision resumes without inventing disconnected time', () => {
  const clock = new PrivateBrowserClock()
  clock.observe(1, 1000, true, true, 10)
  expect(clock.read(1010)).toBe(2000)
  clock.observe(1, 1000, true, false, 1010)
  expect(clock.read(5010)).toBe(2000)
  clock.observe(1, 1000, true, true, 5010)
  expect(clock.read(6010)).toBe(3000)
  clock.observe(2, 9000, false, true, 6010)
  expect(clock.read(9000)).toBe(9000)
})
