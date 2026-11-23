import { expect, test } from 'bun:test'
import {
  DISPLAY_PROJECT_SCHEMA_BYTE_LIMIT,
  DISPLAY_PROJECT_TARGET_LIMIT,
  type DisplayJsonValue,
  type DisplayProjectRunEvidence,
  type DisplayProjectSnapshot,
  validateDisplayProjectRun,
  validateDisplayProjectRunEvidence,
  validateDisplayProjectRunRequest,
  validateDisplayProjectSnapshot,
} from '@jigging/display-model'

function project(): DisplayProjectSnapshot {
  return {
    kind: 'project',
    revision: 'approved-revision',
    state: 'approved',
    targets: [
      { id: 'workflow', label: 'Review', kind: 'binding', availability: 'ready' },
      { id: 'checker', label: 'Check', kind: 'flow', availability: 'ready' },
    ],
    selected: {
      targetId: 'workflow',
      composition: {
        state: 'available',
        provenance: 'admitted',
        rootId: 'workflow',
        nodes: [
          { id: 'workflow', label: 'Review', kind: 'binding' },
          { id: 'checker', label: 'Check', kind: 'flow' },
        ],
        edges: [{ id: 'check-route', source: 'workflow', target: 'checker', slot: 'check' }],
      },
      input: {
        state: 'schema',
        schema: { $ref: '#/$defs/job' },
        definitions: {
          job: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
        },
      },
      attachments: [{ name: 'evidence', mode: 'read', bound: true }],
      receives: [{ name: 'progress', required: false }],
      launch: { state: 'available' },
    },
  }
}

test('project exploration owns inert approved meaning without manufacturing Run observations', () => {
  const input = project()
  const actual = validateDisplayProjectSnapshot(input)
  expect(actual).toEqual(input)
  expect(actual).not.toBe(input)
  expect(Object.isFrozen(actual.selected)).toBeTrue()
  expect(Object.isFrozen(actual.selected!.input)).toBeTrue()
  expect(actual).not.toHaveProperty('workspace')
  expect(actual).not.toHaveProperty('calls')
  expect(actual.selected!.input).toEqual({
    state: 'schema',
    schema: { $ref: '#/$defs/job' },
    definitions: {
      job: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
    },
  })
  expect(
    validateDisplayProjectSnapshot({
      kind: 'project',
      revision: 'none',
      state: 'unreviewed',
      targets: [],
    }).state,
  ).toBe('unreviewed')
})

test('settled Run comparison preserves bounded exact paths and explicit recording gaps', () => {
  const root = 'binding:workflow'
  const child = 'binding:review'
  const evidence: DisplayProjectRunEvidence = {
    execution: 'succeeded',
    outcome: 'done',
    delivery: 'none',
    callCoverage: 'complete',
    callsOmitted: 0,
    calls: [
      { caller: root, target: child, slot: 'review', state: 'returned', outcome: 'done' },
      { parent: 1, caller: child, target: 'flow:flows/check', slot: 'check', state: 'failed' },
    ],
  }
  const comparison = {
    revision: 'earlier',
    inputId: 'a'.repeat(64),
    label: 'Workflow',
    root,
    evidence,
  }
  const run = { state: 'settled', requestId: 'run-1', targetId: 'workflow', comparison }
  expect(validateDisplayProjectRun(run)).toEqual(run)
  expect(Object.isFrozen(validateDisplayProjectRunEvidence(evidence).calls[1])).toBeTrue()
  for (const invalid of [
    { ...evidence, callsOmitted: 1 },
    { ...evidence, callCoverage: 'unavailable' },
    { ...evidence, calls: [{ ...evidence.calls[0], parent: 1 }] },
    { ...evidence, calls: [...evidence.calls, { ...evidence.calls[1], caller: root }] },
    { ...evidence, calls: [{ ...evidence.calls[0], outcome: undefined }] },
    { ...evidence, calls: Array(256).fill(evidence.calls[0]) },
    { ...evidence, callPathsOmitted: 1 },
    { ...evidence, calls: [], callCoverage: 'incomplete', callsOmitted: 1, callPathsOmitted: 2 },
  ])
    expect(() => validateDisplayProjectRunEvidence(invalid)).toThrow(TypeError)
  expect(() =>
    validateDisplayProjectRun({ ...run, comparison: { ...comparison, root: child } }),
  ).toThrow(TypeError)
  const incomplete = {
    ...evidence,
    callCoverage: 'incomplete',
    callsOmitted: 2,
    calls: [...evidence.calls, { slot: 'unplaced', state: 'active' }],
  }
  expect(validateDisplayProjectRunEvidence(incomplete)).toEqual(incomplete)
  const whole = { ...evidence, calls: [...Array(13).fill(evidence.calls[0]), ...evidence.calls] }
  const tree = { ...run, comparison: { ...comparison, evidence: whole } }
  // Preserve the nested occurrence under the final root call.
  whole.calls[14] = { ...evidence.calls[1], parent: 14 }
  expect(validateDisplayProjectRun(tree)).toEqual(tree)
  const withheld = { ...incomplete, calls: [], callPathsOmitted: 1 }
  expect(validateDisplayProjectRunEvidence(withheld)).toEqual(withheld)
})

test('project replacement rejects private fields, inconsistent identity and invented launch readiness', () => {
  const fixture = project()
  const selected = fixture.selected!
  const bad = [
    { ...fixture, approval: 'host-private-approval' },
    { ...fixture, targets: [...fixture.targets, fixture.targets[0]] },
    {
      ...fixture,
      targets: [{ ...fixture.targets[0], settings: { secret: true } }, fixture.targets[1]],
    },
    { ...fixture, state: 'unreviewed' },
    { ...fixture, selected: { ...selected, targetId: 'foreign' } },
    { ...fixture, selected: { ...selected, input: { state: 'schema', schema: false } } },
    {
      ...fixture,
      selected: {
        ...selected,
        attachments: [{ name: 'evidence', mode: 'read-write', bound: true }],
      },
    },
    { ...fixture, selected: { ...selected, receives: [{ name: 'progress', required: true }] } },
    { ...fixture, selected: { ...selected, input: { state: 'unconstrained', schema: {} } } },
    {
      ...fixture,
      selected: {
        ...selected,
        composition: {
          state: 'available',
          provenance: 'admitted',
          rootId: 'workflow',
          nodes: [
            { id: 'workflow', label: 'Workflow', kind: 'binding' },
            { id: 'foreign', label: 'Foreign', kind: 'flow' },
          ],
          edges: [{ id: 'route', source: 'workflow', target: 'foreign', slot: 'check' }],
        },
      },
    },
  ]
  for (const value of bad) expect(() => validateDisplayProjectSnapshot(value)).toThrow(TypeError)
  expect(
    validateDisplayProjectSnapshot({
      ...fixture,
      selected: {
        ...selected,
        attachments: [{ name: 'evidence', mode: 'read', bound: false }],
      },
    }).selected!.launch.state,
  ).toBe('available')
})

test('project schemas and catalogue are complete bounded inert data', () => {
  const fixture = project()
  let nested: DisplayJsonValue = { type: 'string' }
  for (let index = 0; index < 40; index++)
    nested = { type: 'object', properties: { child: nested } }
  expect(
    validateDisplayProjectSnapshot({
      ...fixture,
      selected: { ...fixture.selected, input: { state: 'schema', schema: nested } },
    }).selected!.input.state,
  ).toBe('schema')
  expect(() =>
    validateDisplayProjectSnapshot({
      ...fixture,
      selected: {
        ...fixture.selected,
        input: {
          state: 'schema',
          schema: { description: 'x'.repeat(DISPLAY_PROJECT_SCHEMA_BYTE_LIMIT) },
        },
      },
    }),
  ).toThrow(TypeError)
  expect(() =>
    validateDisplayProjectSnapshot({
      ...fixture,
      targets: Array.from({ length: DISPLAY_PROJECT_TARGET_LIMIT + 1 }, (_, index) => ({
        id: String(index),
        label: 'Target',
        kind: 'flow',
        availability: 'ready',
      })),
    }),
  ).toThrow(TypeError)
  let accessed = false
  const schema = Object.defineProperty({}, 'type', {
    enumerable: true,
    get() {
      accessed = true
      return 'object'
    },
  })
  expect(() =>
    validateDisplayProjectSnapshot({
      ...fixture,
      selected: { ...fixture.selected, input: { state: 'schema', schema } },
    }),
  ).toThrow(TypeError)
  expect(accessed).toBeFalse()
  expect(() =>
    validateDisplayProjectSnapshot({
      ...fixture,
      selected: { ...fixture.selected, input: { state: 'schema', schema: { maximum: Infinity } } },
    }),
  ).toThrow(TypeError)
})

test('explicit launch intent accepts JSON values without executing or inferring an input', () => {
  const request = {
    requestId: 'run-request-1',
    revision: 'revision',
    targetId: 'workflow',
    input: { text: 'Review this' },
  }
  const value = validateDisplayProjectRunRequest(request)
  expect(value).toEqual(request)
  expect(Object.isFrozen(value.input)).toBeTrue()
  for (const input of [null, false, 0, '', [], {}])
    expect(validateDisplayProjectRunRequest({ ...request, input }).input).toEqual(input)
  for (const malformed of [
    { ...request, target: 'flow:private-path' },
    { requestId: 'run-request-1', revision: 'revision', targetId: 'workflow' },
    { ...request, input: { value: NaN } },
    { ...request, input: undefined },
    { ...request, requestId: 'request with spaces' },
  ])
    expect(() => validateDisplayProjectRunRequest(malformed)).toThrow(TypeError)
})

test('launch handoff only navigates to the exact capability-bound numeric loopback viewer', () => {
  const viewerUrl = 'http://127.0.0.1:12345/#cap=' + 'a'.repeat(43)
  const running = { state: 'running', requestId: 'request-1', targetId: 'workflow', viewerUrl }
  expect(validateDisplayProjectRun(running)).toEqual(running)
  expect(validateDisplayProjectRun({ state: 'idle' })).toEqual({ state: 'idle' })
  expect(
    validateDisplayProjectRun({
      state: 'uncertain',
      requestId: 'request-1',
      targetId: 'workflow',
      reason: 'Status is unavailable.',
    }).state,
  ).toBe('uncertain')
  for (const url of [
    'https://example.com/',
    'javascript:alert(1)',
    viewerUrl.replace('127.0.0.1', 'localhost'),
    viewerUrl.replace(':12345', ':65536'),
    viewerUrl.replace(':12345', ':0'),
    viewerUrl.replace('/#cap=', '/other#cap='),
    viewerUrl + '&redirect=elsewhere',
    viewerUrl.replace('http://', 'http://user@'),
  ])
    expect(() => validateDisplayProjectRun({ ...running, viewerUrl: url })).toThrow(TypeError)
  expect(() => validateDisplayProjectRun({ ...running, state: 'starting' })).toThrow(TypeError)
  expect(() => validateDisplayProjectRun({ ...running, state: 'idle' })).toThrow(TypeError)
  expect(() =>
    validateDisplayProjectRun({ ...running, state: 'refused', reason: 'Refused' }),
  ).toThrow(TypeError)
})
