import { expect, test } from 'bun:test'

import { reachableAuthorModules } from '../src/internal/project-evaluator-modules.js'

test('each declaration receives only its reachable captured modules in capture order', () => {
  const modules = [
    { projectPath: 'bindings/a.ts', source: 'a', imports: [{ projectPath: 'lib/shared.ts' }] },
    { projectPath: 'bindings/b.ts', source: 'b', imports: [{ projectPath: 'lib/b.ts' }] },
    { projectPath: 'jig.ts', source: 'project', imports: [] },
    { projectPath: 'lib/b.ts', source: 'b dependency', imports: [{ projectPath: 'lib/shared.ts' }] },
    { projectPath: 'lib/shared.ts', source: 'shared', imports: [] },
  ]

  expect(reachableAuthorModules(modules, 'bindings/a.ts')).toEqual([
    modules[0],
    modules[4],
  ])
  expect(reachableAuthorModules(modules, 'bindings/b.ts')).toEqual([
    modules[1],
    modules[3],
    modules[4],
  ])
  expect(reachableAuthorModules(modules, 'jig.ts')).toEqual([modules[2]])
  expect(modules).toHaveLength(5)
})
