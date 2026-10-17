import { expect, test } from 'bun:test'
import projectContract from '../flows/project/contracts/revisions.json'
import { context, identity } from '../flows/worker/context.ts'
import workerContract from '../flows/worker/contracts/revisions.json'
import rootInput from '../input.json'

const { replacement: _replacement, ...input } = rootInput

test('the sibling channel uses identical offline contracts', () =>
  expect(projectContract).toEqual(workerContract))

test('context rejects duplicate instruction revisions and has stable snapshot identity', () => {
  expect(() =>
    context({
      ...input,
      laterInstructions: [...input.laterInstructions, ...input.laterInstructions],
    }),
  ).toThrow('unique increasing revisions')
  expect(identity(context(input))).toBe(identity(context(structuredClone(input))))
})

test('context retains a frozen independent snapshot in canonical property order', () => {
  const supplied = structuredClone(input)
  const snapshot = context(supplied)
  const digest = identity(snapshot)
  const file = supplied.files[0]
  const instruction = supplied.laterInstructions[0]
  if (!file || !instruction) throw Error('Fixture must supply a file and an instruction.')
  file.text = 'Caller changed its copy.'
  instruction.text = 'Caller changed its instructions.'
  expect(snapshot.files).toEqual(input.files)
  expect(snapshot.laterInstructions).toEqual(input.laterInstructions)
  expect(identity(snapshot)).toBe(digest)
  expect(Object.isFrozen(snapshot)).toBeTrue()
  expect(Object.isFrozen(snapshot.files)).toBeTrue()
  expect(Object.isFrozen(snapshot.files[0])).toBeTrue()
  expect(Object.isFrozen(snapshot.laterInstructions[0])).toBeTrue()
  expect(identity(context(Object.fromEntries(Object.entries(input).reverse())))).toBe(digest)
})

for (const turnBudget of [0, 4, 1.5]) {
  test(`context refuses turn budget ${turnBudget}`, () => {
    expect(() => context({ ...input, turnBudget })).toThrow('turnBudget')
  })
}
