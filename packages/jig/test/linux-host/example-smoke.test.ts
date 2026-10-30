import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { exampleInventory } from '../../../../scripts/example-inventory.mjs'
import { EXAMPLE_SMOKE_CASES } from '../fixtures/example-smoke-cases.js'
import { qualifyFoundationHost } from '../fixtures/host-foundation/materialize.js'
import {
  requireExampleSmokePrerequisites,
  runInstalledExampleSmoke,
} from '../fixtures/installed-example-smoke.js'

const repository = resolve(import.meta.dir, '../../../..')
const discovered = exampleInventory(repository).map(({ name }: { name: string }) => name)
const implementations = new Map(EXAMPLE_SMOKE_CASES.map((example) => [example.name, example]))
assert.equal(
  implementations.size,
  EXAMPLE_SMOKE_CASES.length,
  'Repeated example e2e implementation',
)
assert.deepEqual(
  [...implementations.keys()].sort(),
  discovered,
  'Every discovered example requires a complete public first-run e2e implementation',
)
const prerequisites = await requireExampleSmokePrerequisites()
const qualification = await qualifyFoundationHost()

for (const name of discovered) {
  const example = implementations.get(name)
  assert.ok(example)
  test(
    `example ${name}: unchanged setup, review and default Run produce the documented result`,
    () => runInstalledExampleSmoke({ example, prerequisites, qualification }),
    example.timeoutMs + 600_000,
  )
}
