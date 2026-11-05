import { expect, test } from 'bun:test'
import {
  DISPLAY_COMPOSITION_BYTE_LIMIT,
  DISPLAY_COMPOSITION_EDGE_LIMIT,
  DISPLAY_COMPOSITION_NODE_LIMIT,
} from '@jigging/display-model'
import {
  type PrivateCompositionSource,
  observePrivateRunComposition,
  projectPrivateRunComposition,
} from '../../src/cli-composition.js'
import type { InvocationSlot, NativeInvocation } from '../../src/project/invocation-slots.js'

const limits = {
  nodes: DISPLAY_COMPOSITION_NODE_LIMIT,
  edges: DISPLAY_COMPOSITION_EDGE_LIMIT,
  bytes: DISPLAY_COMPOSITION_BYTE_LIMIT,
}
const root = { kind: 'flow', path: 'flows/root' } as const
const binding = (id: string) => ({ kind: 'binding', id }) as const
const native = (kind: NativeInvocation): InvocationSlot => ({
  kind: 'native',
  native: kind,
  contract: {
    id: 'https://example.org/contract',
    version: '1.0.0',
    digest: `sha256:${'0'.repeat(64)}`,
  },
})
const request = (
  target: PrivateCompositionSource['root'],
  slots: Readonly<Record<string, InvocationSlot>> = {},
) => ({ request: { target, slots } })

test('composition keeps selected Binding identities and repeated routes without reading policy', () => {
  const grant = native('http-request')
  Object.defineProperty(grant, 'grant', {
    get: () => {
      throw new Error('private policy read')
    },
  })
  const worker = request(binding('worker'), { request: grant })
  Object.defineProperty(worker.request, 'settings', {
    get: () => {
      throw new Error('private settings read')
    },
  })
  const source = {
    root,
    targets: [
      request(root, {
        first: { kind: 'flow', target: binding('worker') },
        repeat: { kind: 'flow', target: binding('worker') },
        other: { kind: 'flow', target: binding('other') },
      }),
      worker,
      request(binding('other'), { request: native('http-request') }),
      request({ kind: 'flow', path: 'flows/unreachable' }),
    ],
  }
  const value = projectPrivateRunComposition(source, limits)
  expect(value.state).toBe('available')
  if (value.state !== 'available') throw new Error('expected selected composition')
  expect(value.nodes).toHaveLength(5)
  expect(value.edges).toHaveLength(5)
  const first = value.edges.find((edge) => edge.slot === 'first')!
  const repeat = value.edges.find((edge) => edge.slot === 'repeat')!
  expect(first.target).toBe(repeat.target)
  expect(first.id).not.toBe(repeat.id)
  expect(
    value.nodes
      .filter((node) => node.kind === 'binding')
      .map((node) => node.label)
      .sort(),
  ).toEqual(['other', 'worker'])
  expect(value.nodes.filter((node) => node.kind === 'resource')).toHaveLength(2)
  expect(value.nodes.some((node) => node.label === 'unreachable')).toBe(false)
  expect(Object.isFrozen(value)).toBe(true)
  expect(Object.isFrozen(value.nodes)).toBe(true)
  expect(value.nodes.every(Object.isFrozen)).toBe(true)
  expect(JSON.stringify(value)).not.toContain('settings')
  expect(JSON.stringify(value)).not.toContain('grant')
})

test('composition retains every native invocation kind as a separate caller slot', () => {
  const kinds = [
    'http-request',
    'project-command',
    'project-evaluation',
    'finite-acp',
    'run-checkpoint',
    'child-checkpoint',
  ] as const
  const source = {
    root,
    targets: [request(root, Object.fromEntries(kinds.map((kind) => [kind, native(kind)])))],
  }
  const value = projectPrivateRunComposition(source, limits)
  if (value.state !== 'available') throw new Error('expected native composition')
  expect(
    value.nodes
      .filter((node) => node.kind === 'resource')
      .map((node) => node.resourceKind)
      .sort(),
  ).toEqual([...kinds].sort())
  expect(new Set(value.nodes.map((node) => node.id)).size).toBe(7)
  expect(value.edges).toHaveLength(6)
})

test('composition bounds fail the whole map and never return partial routes', () => {
  const source = { root, targets: [request(root, { save: native('run-checkpoint') })] }
  const complete = projectPrivateRunComposition(source, limits)
  const bytes = new TextEncoder().encode(JSON.stringify(complete)).byteLength
  expect(projectPrivateRunComposition(source, { nodes: 2, edges: 1, bytes })).toEqual(complete)
  for (const bound of [
    { ...limits, nodes: 1 },
    { ...limits, edges: 0 },
    { ...limits, bytes: bytes - 1 },
  ])
    expect(projectPrivateRunComposition(source, bound)).toEqual({
      state: 'unavailable',
      reason: 'limit',
    })
})

test('composition does not invent missing targets or collapse equal Flow labels', () => {
  const a = { kind: 'flow', path: 'flows/first/worker' } as const
  const b = { kind: 'flow', path: 'flows/second/worker' } as const
  const source = {
    root,
    targets: [
      request(root, { a: { kind: 'flow', target: a }, b: { kind: 'flow', target: b } }),
      request(a),
      request(b),
    ],
  }
  const value = projectPrivateRunComposition(source, limits)
  if (value.state !== 'available') throw new Error('expected selected composition')
  const workers = value.nodes.filter((node) => node.label === 'worker')
  expect(workers).toHaveLength(2)
  expect(workers[0]!.id).not.toBe(workers[1]!.id)
  expect(
    projectPrivateRunComposition({ root, targets: source.targets.slice(0, 2) }, limits),
  ).toEqual({ state: 'unavailable', reason: 'unavailable' })
  expect(projectPrivateRunComposition({ root, targets: [] }, limits)).toEqual({
    state: 'unavailable',
    reason: 'unavailable',
  })
})

test('Flow labels preserve whole Unicode scalars within the display text allowance', () => {
  const target = { kind: 'flow', path: `flows/${'😀'.repeat(300)}` } as const
  const value = projectPrivateRunComposition({ root: target, targets: [request(target)] }, limits)
  if (value.state !== 'available') throw new Error('expected bounded label')
  expect(value.nodes[0]!.label).toBe('😀'.repeat(246) + ' [clipped]')
  expect([...value.nodes[0]!.label]).toHaveLength(256)
})

test('composition observers cannot turn projection or presentation failure into execution failure', () => {
  const source = { root, targets: [request(root)] }
  expect(() =>
    observePrivateRunComposition(source, limits, () => {
      throw new Error('observer failure')
    }),
  ).not.toThrow()
  let received: unknown
  const broken = Object.defineProperty({ root, targets: source.targets }, 'targets', {
    get: () => {
      throw new Error('projection failure')
    },
  })
  observePrivateRunComposition(broken, limits, (value) => {
    received = value
  })
  expect(received).toEqual({ state: 'unavailable', reason: 'unavailable' })
})
