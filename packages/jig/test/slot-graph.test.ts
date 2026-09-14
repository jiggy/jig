import { expect, test } from 'bun:test'
import type { RunTargetIdentity } from '../src/project/package-project.js'
import { validateChildGraph } from '../src/project/slot-graph.js'

const node = (packagePath: string, child?: string) => ({
  packagePath,
  slots: child === undefined ? {} : { next: { kind: 'binding' as const, id: child } },
})

test('bounded slot graphs distinguish target cycles from reuse of package code', () => {
  const graph = new Map([
    ['application', node('flows/shared', 'specialist')],
    ['specialist', node('flows/specialist', 'agent')],
    ['agent', node('flows/shared')],
  ])
  expect(() => validateChildGraph(graph, new Map())).not.toThrow()
  graph.set('agent', node('flows/shared', 'application'))
  expect(() => validateChildGraph(graph, new Map())).toThrow()
  graph.set('agent', node('flows/shared', 'resource-flow'))
  graph.set('resource-flow', node('flows/resource'))
  expect(() => validateChildGraph(graph, new Map())).toThrow('two child levels')
})

test('shared targets are checked without an unbounded path expansion', () => {
  const graph = new Map([['agent', node('flows/agent')]])
  for (let i = 0; i < 100; i++) graph.set(`consumer-${i}`, node(`flows/${i}`, 'agent'))
  let work = 0
  validateChildGraph(graph, new Map(), (units) => {
    work += units
  })
  expect(work).toBeLessThanOrEqual(201)
})

const routed = (packagePath: string, next?: RunTargetIdentity) => ({
  packagePath,
  slots: next === undefined ? {} : { next },
})

test('direct Flow defaults participate in cycle and depth checks', () => {
  const bindings = new Map([
    ['application', routed('flows/application', { kind: 'flow', path: 'flows/specialist' })],
    ['agent', routed('flows/agent')],
  ])
  const flows = new Map([
    ['flows/specialist', routed('flows/specialist', { kind: 'binding', id: 'agent' })],
  ])
  expect(() => validateChildGraph(bindings, flows)).not.toThrow()
  bindings.set('agent', routed('flows/agent', { kind: 'binding', id: 'application' }))
  expect(() => validateChildGraph(bindings, flows)).toThrow()
  bindings.set('agent', routed('flows/agent', { kind: 'flow', path: 'flows/resource' }))
  flows.set('flows/resource', routed('flows/resource'))
  expect(() => validateChildGraph(bindings, flows)).toThrow('two child levels')
})

test('two direct Flow defaults cannot form a hidden cycle', () => {
  const flows = new Map([
    ['flows/first', routed('flows/first', { kind: 'flow', path: 'flows/second' })],
    ['flows/second', routed('flows/second', { kind: 'flow', path: 'flows/first' })],
  ])
  expect(() => validateChildGraph(new Map(), flows)).toThrow('cycle')
})

test('a missing direct Flow is rejected instead of treated as a leaf', () => {
  const bindings = new Map([
    ['application', routed('flows/application', { kind: 'flow', path: 'flows/missing' })],
  ])
  expect(() => validateChildGraph(bindings, new Map())).toThrow()
})
