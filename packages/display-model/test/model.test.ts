import { expect, test } from 'bun:test'
import {
  attentionImportance,
  callObservationSpans,
  displayDestinations,
  displayViewKey,
  recordReferences,
  referenceKey,
  validateDisplaySnapshot,
} from '@jigging/display-model'
import { fixture } from './fixture.js'

test('public model owns immutable supplied observations without changing claims or opaque identities', () => {
  const input = fixture()
  const snapshot = validateDisplaySnapshot(input)
  expect(snapshot).toEqual(input)
  expect(snapshot).not.toBe(input)
  expect(Object.isFrozen(snapshot)).toBeTrue()
  expect(Object.isFrozen(snapshot.workspace)).toBeTrue()
  expect(snapshot.rootSourceId).toBe('source-root')
  if (snapshot.kind !== 'snapshot') throw new Error('Expected complete fixture')
  expect(Object.isFrozen(snapshot.views[0]!.value.sections)).toBeTrue()
  expect(snapshot.workspace.facts?.application.provenance).toBe('application-reported')
  expect(snapshot.calls[0]!.state).toBe('uncertain')
  expect(snapshot.attention[0]!.transcriptCommitted).toBeFalse()
})

test('typed references include hidden/detail evidence and deduplicate exact identities', () => {
  const snapshot = fixture()
  const block = snapshot.views[0]!.value.sections[0]!.blocks[0]!
  if (block.kind !== 'collection') throw new Error('Expected collection fixture')
  const row = block.rows[0]!
  const evidence = row.cells.evidence
  if (!evidence || typeof evidence !== 'object') throw new Error('Expected reference fixture')
  const references = recordReferences({
    row: {
      ...row,
      details: [{ kind: 'report', text: 'Same evidence', references: [evidence] }],
    },
  })
  expect(references).toHaveLength(1)
  expect(referenceKey(references[0]!)).toBe('["artifact","output","notes.txt"]')
  expect(
    recordReferences({
      activity: { kind: 'activity', id: 'a', label: 'Checking', operationId: 'worker' },
    }),
  ).toEqual([{ kind: 'call', operationId: 'worker' }])
})

test('only explicit roles select recorded destinations; intervals remain observed and uncertainty explicit', () => {
  expect(
    displayDestinations(true, [
      { key: 'authored', title: 'Recorded result', source: 'Author' },
    ]).map((item) => item.key),
  ).toEqual(['files', displayViewKey('authored')])
  expect(
    displayDestinations(true, [
      { key: 'host', title: 'Anything', source: 'Host', role: 'recorded-report' },
    ])[0]!.title,
  ).toBe('Recorded result')
  expect(
    callObservationSpans([{ id: 'invalid', firstObservedAt: 10, observedAt: 1 }]).spans.size,
  ).toBe(0)
  expect(callObservationSpans(fixture().calls).spans.get('call-root')?.milliseconds).toBe(9)
  expect(attentionImportance(4)).toBe('host failure / unconfirmed cleanup')
})

test('malformed replacements, non-data values and cyclic call ancestry fail without modifying prior data', () => {
  const prior = validateDisplaySnapshot(fixture())
  const bad = [
    { ...fixture(), rootSourceId: undefined },
    {
      ...fixture(),
      attention: [{ ...fixture().attention[0]!, transcriptCommitted: undefined }],
    },
    { ...fixture(), calls: [{ ...fixture().calls[0]!, sourceLabel: undefined }] },
    { ...fixture(), calls: [{ ...fixture().calls[0]!, parentId: 'call-root' }] },
    {
      ...fixture(),
      views: [
        {
          ...fixture().views[0]!,
          value: { ...fixture().views[0]!.value, kind: 'notice' },
        },
      ],
    },
    { ...fixture(), unknown: true },
  ]
  for (const value of bad) expect(() => validateDisplaySnapshot(value)).toThrow(TypeError)
  let read = false
  const accessor = Object.defineProperty({}, 'kind', {
    enumerable: true,
    get() {
      read = true
      return 'snapshot'
    },
  })
  expect(() => validateDisplaySnapshot(accessor)).toThrow(TypeError)
  expect(read).toBeFalse()
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  expect(() => validateDisplaySnapshot(cycle)).toThrow(TypeError)
  expect(prior).toEqual(fixture())
})

test('incomplete envelope retains current causes and rejects oversized encoded data', () => {
  const body = fixture()
  const envelope = {
    kind: 'incomplete',
    revision: 2,
    lastCompleteRevision: 1,
    mode: body.mode,
    rootSourceId: body.rootSourceId,
    workspace: body.workspace,
    context: body.context,
    omissions: body.omissions,
    attention: body.attention,
    diagnostics: [],
    reason: 'Observation unavailable',
  }
  expect(validateDisplaySnapshot(envelope).kind).toBe('incomplete')
  expect(() =>
    validateDisplaySnapshot({ ...body, context: '\u0000'.repeat(2 * 1024 * 1024) }),
  ).toThrow(TypeError)
  expect(() => validateDisplaySnapshot({ ...envelope, views: body.views })).toThrow(TypeError)
})

test('public destination keys keep opaque view identities disjoint from built-in surfaces', () => {
  const ids = ['files', 'overview', 'activity', displayViewKey('files'), 'view with spaces']
  const input = fixture()
  const snapshot = validateDisplaySnapshot({
    ...input,
    views: ids.map((id, index) => ({
      ...input.views[0]!,
      id,
      value: { ...input.views[0]!.value, id: `semantic-${index}` },
    })),
  })
  if (snapshot.kind !== 'snapshot') throw new Error('Expected complete fixture')
  const views = snapshot.views.map((view) => ({
    key: view.id,
    title: view.value.title,
    source: view.sourceLabel,
  }))
  const live = displayDestinations(false, views)
  expect(live.slice(0, 3).map((destination) => destination.key)).toEqual([
    'overview',
    'activity',
    'files',
  ])
  expect(live.slice(3).map((destination) => destination.key)).toEqual(ids.map(displayViewKey))
  expect(new Set(live.map((destination) => destination.key)).size).toBe(live.length)
  expect(snapshot.views.map((view) => view.id)).toEqual(ids)
  const recorded = displayDestinations(true, [
    { ...views[0]!, role: 'recorded-report' },
    { ...views[1]!, role: 'recorded-diagnostics' },
    ...views.slice(2),
  ])
  expect(recorded.slice(0, 3).map((destination) => destination.key)).toEqual([
    displayViewKey('files'),
    'files',
    displayViewKey('overview'),
  ])
  expect(new Set(recorded.map((destination) => destination.key)).size).toBe(recorded.length)
})

test('ambiguous source-scoped reference joins fail atomically while other sources keep raw identities', () => {
  const input = fixture()
  const prior = validateDisplaySnapshot(input)
  const view = input.views[0]!
  const call = input.calls[0]!
  expect(() =>
    validateDisplaySnapshot({
      ...input,
      views: [
        view,
        { ...view, id: 'another-opaque-view', value: { ...view.value, title: 'Ambiguous target' } },
      ],
    }),
  ).toThrow(TypeError)
  expect(() =>
    validateDisplaySnapshot({
      ...input,
      calls: [call, { ...call, id: 'another-opaque-call', slot: 'Ambiguous invocation' }],
    }),
  ).toThrow(TypeError)
  expect(prior).toEqual(input)
  expect(input.views[0]!.id).toBe('view-root')
  expect(input.calls[0]!.id).toBe('call-root')
  const separate = validateDisplaySnapshot({
    ...input,
    views: [view, { ...view, id: 'another-opaque-view', sourceId: 'another-source' }],
    calls: [call, { ...call, id: 'another-opaque-call', sourceId: 'another-source' }],
  })
  if (separate.kind !== 'snapshot') throw new Error('Expected complete fixture')
  expect(separate.views.map((item) => item.id)).toEqual(['view-root', 'another-opaque-view'])
  expect(separate.calls.map((item) => item.id)).toEqual(['call-root', 'another-opaque-call'])
  expect(separate.views.map((item) => item.value.id)).toEqual([view.value.id, view.value.id])
  expect(separate.calls.map((item) => item.operationId)).toEqual([
    call.operationId,
    call.operationId,
  ])
})
