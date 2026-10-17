import { expect, test } from 'bun:test'
import { checkRoutingResult, routingInput } from 'semantic-router-flow/decision'

const candidates = [
  { id: 'a', description: 'Translate supplied prose to French.' },
  { id: 'b', description: 'Summarize supplied prose in its original language.' },
]
const input = { task: 'Give me the main points in the original language.', candidates }

test('routing input rejects invalid candidate data', () => {
  for (const value of [
    null,
    {},
    { ...input, extra: true },
    { ...input, task: '' },
    { ...input, task: '\ud800' },
    { ...input, task: 'x'.repeat(16001) },
    ...[
      Array(1),
      [...candidates, candidates[0]],
      [{ id: 'flow:evil', description: 'target' }],
      [{ id: 'a', description: ' ' }],
      [{ id: 'a', description: 'ok', slot: 'evil' }],
      Array.from({ length: 17 }, (_, n) => ({ id: `c${n}`, description: 'ok' })),
      Array.from({ length: 16 }, (_, n) => ({ id: `c${n}`, description: 'x'.repeat(4000) })),
    ].map((candidates) => ({ ...input, candidates })),
  ])
    expect(() => routingInput(value)).toThrow()
  expect(routingInput(input)).toEqual(input)
  expect(routingInput({ ...input, candidates: [] }).candidates).toEqual([])
})

test('routing results require exact shape, membership, reasons and outcomes', () => {
  for (const output of [
    {},
    { candidateId: 'flow:evil', reason: 'Do this.' },
    { candidateId: 'a', reason: '' },
    { candidateId: null, reason: 'x', slot: 'evil' },
    { candidateId: 'b', reason: 'x'.repeat(2001) },
  ])
    expect(() => checkRoutingResult({ outcome: 'done', output }, candidates)).toThrow()
  for (const candidateId of ['a', 'b', null]) {
    const result = { outcome: 'done', output: { candidateId, reason: 'Domain data.' } }
    expect(checkRoutingResult(result, candidates)).toEqual(result)
  }
  for (const outcome of ['blocked', 'limit']) {
    const result = { outcome, output: { reason: 'No capacity.' } }
    expect(checkRoutingResult(result, candidates)).toEqual(result)
    expect(() =>
      checkRoutingResult(
        { outcome, output: { candidateId: 'b', reason: 'No capacity.' } },
        candidates,
      ),
    ).toThrow()
  }
})
