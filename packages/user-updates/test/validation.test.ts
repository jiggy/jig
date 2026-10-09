import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { validateUserUpdate as mainValidator } from '../src/index.js'
import { validateUserUpdate } from '../src/validation.js'

const view = (path: string) => ({
  kind: 'view',
  id: 'evidence',
  title: 'Evidence',
  summary: 'Inspect supplied artifact',
  sections: [
    {
      blocks: [
        {
          kind: 'report',
          text: 'Captured output',
          references: [{ kind: 'artifact', attachment: 'output', path }],
        },
      ],
    },
  ],
})

test('portable validation entry is the same validator and preserves exact Unicode path bytes without Buffer', () => {
  expect(validateUserUpdate).toBe(mainValidator)
  const buffer = Object.getOwnPropertyDescriptor(globalThis, 'Buffer')
  let accepted: unknown
  let rejected = false
  try {
    Object.defineProperty(globalThis, 'Buffer', { value: undefined, configurable: true })
    accepted = validateUserUpdate(view(`${'é'.repeat(254)}.txt`))
    try {
      validateUserUpdate(view(`${'é'.repeat(255)}.txt`))
    } catch (error) {
      rejected = error instanceof TypeError
    }
  } finally {
    if (buffer) Object.defineProperty(globalThis, 'Buffer', buffer)
    else Reflect.deleteProperty(globalThis, 'Buffer')
  }
  expect(accepted).toEqual(view(`${'é'.repeat(254)}.txt`))
  expect(rejected).toBeTrue()
})

test('portable validation bundles for a browser without Node, FLOW or publisher support', async () => {
  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, '../src/validation.ts')],
    target: 'browser',
    format: 'esm',
    minify: true,
    sourcemap: 'none',
  })
  expect(result.success).toBeTrue()
  expect(result.outputs).toHaveLength(1)
  expect(await result.outputs[0]!.text()).not.toMatch(
    /node:|\bBuffer\b|@jigging\/flow|withUserUpdates/,
  )
})
