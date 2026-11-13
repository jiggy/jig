import { expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import {
  type PrivateProjectProjectionSource,
  projectPrivateProjectSnapshot,
} from '../../src/cli-project-projection.js'
import type { JsonValue } from '../../src/json.js'

const approval = `sha256:${'a'.repeat(64)}`
const identity = (kind: string, ...parts: string[]) =>
  createHmac('sha256', 'test-project-projection')
    .update(JSON.stringify([kind, ...parts]))
    .digest('hex')

function source(selected: Record<string, JsonValue> = {}): PrivateProjectProjectionSource {
  const root = { kind: 'binding', id: 'review' } as const
  const worker = { kind: 'flow', path: 'private-project-directory/worker' } as const
  return {
    catalogue: {
      approval,
      targets: [
        {
          target: 'binding:review',
          description: 'Review supplied evidence.',
          availability: { state: 'ready' },
        },
        { target: 'flow:private-project-directory/worker', availability: { state: 'ready' } },
      ],
      entrypoint: 'binding:review --input @private-job.json',
    },
    selected: {
      approval,
      target: 'binding:review',
      availability: { state: 'ready' },
      contract: {
        input: { $ref: '#/$defs/job' },
        $defs: {
          job: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
        },
      },
      attachments: {},
      settings: { secret: 'private-setting' },
      slots: { worker: { path: '/private/operator/path' } },
      ...selected,
    },
    composition: {
      root,
      targets: [
        { request: { target: root, slots: { worker: { kind: 'flow', target: worker } } } },
        { request: { target: worker, slots: {} } },
      ],
    },
  }
}

test('approved project projection preserves exact configuration and contract without Run facts or private records', () => {
  const result = projectPrivateProjectSnapshot(source(), identity)
  expect(result.state).toBe('approved')
  expect(result.selected!.input).toMatchObject({
    state: 'schema',
    schema: { $ref: '#/$defs/job' },
    definitions: { job: { type: 'object' } },
  })
  expect(result.selected!.launch.state).toBe('available')
  if (result.selected!.composition.state !== 'available') throw new Error('Expected complete map')
  const map = result.selected!.composition
  expect(map.rootId).toBe(result.selected!.targetId)
  expect(map.edges).toHaveLength(1)
  expect(new Set(result.targets.map((target) => target.id))).toEqual(
    new Set(map.nodes.map((node) => node.id)),
  )
  expect(result.targets[0]!.description).toBe('Review supplied evidence.')
  const encoded = JSON.stringify(result)
  for (const forbidden of [
    approval,
    'private-setting',
    '/private/operator/path',
    'private-project-directory',
    'private-job.json',
    'settings',
    'workspace',
    'elapsedMs',
    '"calls"',
  ])
    expect(encoded).not.toContain(forbidden)
})

test('browser launch limitations follow the retained interface without hiding the map', () => {
  const cases: readonly [Record<string, JsonValue>, string][] = [
    [{ availability: { state: 'unavailable' } }, 'reviewed as unavailable'],
    [{ contract: { input: false } }, 'no input value'],
    [{ attachments: Object.fromEntries(Array.from({ length: 9 }, (_, index) => ['input-' + index, 'read'])) }, 'more than eight unbound read attachments'],
    [
      { contract: { channels: { requests: { direction: 'receive', required: true } } } },
      'incoming channel',
    ],
    [
      { contract: { channels: { results: { direction: 'send', required: true } } } },
      'explicit channel receiver',
    ],
  ]
  for (const [selected, cause] of cases) {
    const result = projectPrivateProjectSnapshot(source(selected), identity)
    expect(result.selected!.composition.state).toBe('available')
    expect(result.selected!.launch).toMatchObject({ state: 'unavailable' })
    if (result.selected!.launch.state !== 'unavailable') throw new Error('Expected launch refusal')
    expect(result.selected!.launch.reason).toContain(cause)
  }
  const fileReady = projectPrivateProjectSnapshot(source({
    attachments: { evidence: 'read' },
  }), identity)
  expect(fileReady.selected!.launch.state).toBe('available')
  expect(fileReady.selected!.attachments).toEqual([
    { name: 'evidence', mode: 'read', bound: false },
  ])
  const supported = projectPrivateProjectSnapshot(
    source({
      contract: { channels: { progress: { direction: 'send', required: false } } },
      attachments: { evidence: 'read', result: 'read-write' },
      boundReadAttachments: ['evidence'],
      artifactResults: ['archive'],
    }),
    identity,
  )
  expect(supported.selected!.launch.state).toBe('available')
  expect(supported.selected!.input).toEqual({ state: 'unconstrained' })
  expect(supported.selected!.attachments).toEqual([
    { name: 'evidence', mode: 'read', bound: true },
    { name: 'result', mode: 'read-write', bound: false },
  ])
})

test('projection refuses a catalogue/schema admission mismatch and does not guess across revisions', () => {
  expect(() =>
    projectPrivateProjectSnapshot(source({ approval: 'changed-approval' }), identity),
  ).toThrow('The project approval changed')
  expect(() =>
    projectPrivateProjectSnapshot(source({ target: 'binding:another' }), identity),
  ).toThrow('The selected interface does not belong to the configured root')
  const original = projectPrivateProjectSnapshot(source(), identity)
  const changed = source({ approval: 'next-approval' })
  const next = projectPrivateProjectSnapshot(
    {
      ...changed,
      catalogue: { ...(changed.catalogue as Record<string, JsonValue>), approval: 'next-approval' },
    },
    identity,
  )
  expect(next.revision).not.toBe(original.revision)
  expect(next.selected!.targetId).not.toBe(original.selected!.targetId)
})

test('configured maps fail completely at the existing bounds while the workflow catalogue remains usable', () => {
  const input = source()
  const root = input.composition.root
  const targets = Array.from(
    { length: 256 },
    (_, index) => ({ kind: 'binding', id: `child-${index}` }) as const,
  )
  const slots = Object.fromEntries(
    targets.map((target, index) => [`slot-${index}`, { kind: 'flow', target } as const]),
  )
  const catalogue = input.catalogue as Record<string, JsonValue>
  const result = projectPrivateProjectSnapshot(
    {
      ...input,
      catalogue: {
        ...catalogue,
        targets: [
          { target: 'binding:review', availability: { state: 'ready' } },
          ...targets.map((target) => ({
            target: `binding:${target.id}`,
            availability: { state: 'ready' },
          })),
        ],
      },
      composition: {
        root,
        targets: [
          { request: { target: root, slots } },
          ...targets.map((target) => ({ request: { target, slots: {} } })),
        ],
      },
    },
    identity,
  )
  expect(result.targets).toHaveLength(257)
  expect(result.selected!.composition).toEqual({ state: 'unavailable', reason: 'limit' })
  expect(result.selected!.launch.state).toBe('available')
})
