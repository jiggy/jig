import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkRoutingResult, routingInput } from '../dist/index.js'

const candidates = [
  { id: 'a', description: 'Translate supplied prose to French.' },
  { id: 'b', description: 'Summarize supplied prose in its original language.' },
]
const input = { task: 'Give me the main points in the original language.', candidates }

test('routing input rejects malformed, oversized and ambiguous candidate data', () => {
  for (const value of [
    null, {}, { ...input, extra: true }, { ...input, task: '' },
    { ...input, task: '\ud800' }, { ...input, task: 'x\0y' },
    { ...input, task: 'x'.repeat(16001) }, { ...input, task: 'é'.repeat(8001) },
    ...[
      Array(1), [...candidates, candidates[0]],
      [{ id: 'flow:evil', description: 'target' }], [{ id: 'a', description: ' ' }],
      [{ id: 'a', description: 'ok', slot: 'evil' }],
      [{ id: 'a'.repeat(65), description: 'ok' }],
      [{ id: 'a', description: 'é'.repeat(2001) }],
      Array.from({ length: 17 }, (_, n) => ({ id: `c${n}`, description: 'ok' })),
      Array.from({ length: 16 }, (_, n) => ({ id: `c${n}`, description: 'x'.repeat(4000) })),
    ].map((candidates) => ({ ...input, candidates })),
  ]) assert.throws(() => routingInput(value))
  assert.deepEqual(routingInput(input), input)
  assert.deepEqual(routingInput({ ...input, candidates: [] }).candidates, [])
})

test('text limits count UTF-8 bytes and snapshot caller data', () => {
  const original = { task: 'é'.repeat(8000), candidates: [{ id: 'a'.repeat(64), description: 'é'.repeat(2000) }] }
  const snapshot = routingInput(original)
  assert.deepEqual(snapshot, original)
  original.candidates[0].id = 'changed'
  assert.equal(snapshot.candidates[0].id, 'a'.repeat(64))
})

test('routing results require complete shape, exact membership, reasons and outcomes', () => {
  for (const output of [
    {}, { candidateId: 'flow:evil', reason: 'Do this.' }, { candidateId: 'a', reason: '' },
    { candidateId: null, reason: 'x', slot: 'evil' },
    { candidateId: 'b', reason: 'é'.repeat(1001) },
    { candidateId: 'b', reason: '\ud800' }, { candidateId: 'b', reason: 'x\0y' },
  ]) assert.throws(() => checkRoutingResult({ outcome: 'done', output }, candidates))
  for (const value of [null, {}, { outcome: 'done', output: { candidateId: 'b', reason: 'x' }, extra: true },
    { outcome: 'invented', output: { candidateId: 'b', reason: 'x' } }])
    assert.throws(() => checkRoutingResult(value, candidates))
  for (const candidateId of ['a', 'b', null]) {
    const result = { outcome: 'done', output: { candidateId, reason: 'Domain data.' } }
    assert.deepEqual(checkRoutingResult(result, candidates), result)
  }
  for (const outcome of ['blocked', 'limit']) {
    const result = { outcome, output: { reason: 'No capacity.' } }
    assert.deepEqual(checkRoutingResult(result, candidates), result)
    assert.throws(() => checkRoutingResult({ outcome, output: { candidateId: 'b', reason: 'No capacity.' } }, candidates))
  }
})
