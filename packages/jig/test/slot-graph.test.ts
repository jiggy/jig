import { expect, test } from 'bun:test'
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
  expect(() => validateChildGraph(graph)).not.toThrow()
  graph.set('agent', node('flows/shared', 'application'))
  expect(() => validateChildGraph(graph)).toThrow()
  graph.set('agent', node('flows/shared', 'resource-flow'))
  graph.set('resource-flow', node('flows/resource'))
  expect(() => validateChildGraph(graph)).toThrow('two child levels')
})

test('shared targets are checked without an unbounded path expansion', () => {
  const graph = new Map([['agent', node('flows/agent')]])
  for (let i = 0; i < 100; i++) graph.set(`consumer-${i}`, node(`flows/${i}`, 'agent'))
  let work = 0
  validateChildGraph(graph, (units) => {
    work += units
  })
  expect(work).toBeLessThanOrEqual(201)
})
