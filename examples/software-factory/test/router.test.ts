import { expect, test } from 'bun:test'
import { OperationError, type RunResult } from '@jigging/flow'
import { checkRoutingResult } from 'semantic-router-flow/decision'
import { route } from 'semantic-router-flow/route'

const candidates = [
  { id: 'a', description: 'Translate supplied prose to French.' },
  { id: 'b', description: 'Summarize supplied prose in its original language.' },
]
const input = { task: 'Give me the main points in the original language.', candidates }
const selected = { candidateId: 'b', reason: 'The task asks for a summary.' }
function invoke(
  value: unknown,
  reply: unknown = { outcome: 'done', output: { text: '', structured: selected } },
) {
  let calls = 0
  const promise = route({
    input: value as any,
    signal: new AbortController().signal,
    call: async (call) => {
      calls++
      expect(call.slot).toBe('agent')
      expect(call.operationId).toBe('select')
      expect((call.input as any).instructions).toContain(JSON.stringify(value))
      expect((call.input as any).responseSchema.properties.candidateId.enum).toEqual([
        ...(value as any).candidates.map((c: any) => c.id),
        null,
      ])
      return reply as RunResult
    },
  })
  return { promise, calls: () => calls }
}
test('invalid candidate data cannot start Agent work', async () => {
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
  ]) {
    const call = invoke(value)
    await expect(call.promise).rejects.toThrow()
    expect(call.calls()).toBe(0)
  }
})
test('empty set abstains without a call; singleton can be inapplicable', async () => {
  const empty = invoke({ ...input, candidates: [] })
  expect(await empty.promise).toMatchObject({ outcome: 'done', output: { candidateId: null } })
  expect(empty.calls()).toBe(0)
  const only = invoke(
    { ...input, candidates: [candidates[0]] },
    {
      outcome: 'done',
      output: { text: '', structured: { candidateId: null, reason: 'Translation does not fit.' } },
    },
  )
  expect(await only.promise).toMatchObject({ outcome: 'done', output: { candidateId: null } })
  expect(only.calls()).toBe(1)
})
test('selection is data driven across renamed, reordered and extended unrelated sets', async () => {
  expect(await invoke(input).promise).toEqual({ outcome: 'done', output: selected })
  const other = {
    task: 'Find the failed sensor.',
    candidates: [
      { id: 'z9', description: 'Diagnose a sensor from its recorded readings.' },
      { id: 'm3', description: 'Schedule a maintenance visit.' },
      { id: 'q7', description: 'Summarize a parts inventory.' },
    ],
  }
  for (const list of [other.candidates, [...other.candidates].reverse()]) {
    const result = await invoke(
      { ...other, candidates: list },
      {
        outcome: 'done',
        output: { text: '', structured: { candidateId: 'z9', reason: 'Diagnosis requested.' } },
      },
    ).promise
    expect(result).toMatchObject({ output: { candidateId: 'z9' } })
  }
})
test('complete Agent and replacement-router envelopes, shape and membership are checked', async () => {
  for (const output of [
    {},
    { candidateId: 'flow:evil', reason: 'Do this.' },
    { candidateId: 'a', reason: '' },
    { candidateId: null, reason: 'x', slot: 'evil' },
    { candidateId: 'b', reason: 'x'.repeat(2001) },
  ]) {
    await expect(
      invoke(input, { outcome: 'done', output: { text: '', structured: output } }).promise,
    ).rejects.toThrow()
    expect(() => checkRoutingResult({ outcome: 'done', output }, candidates)).toThrow()
  }
  for (const result of [
    { outcome: 'unknown', output: { text: '' } },
    { outcome: 'blocked', output: {} },
    { outcome: 'done', output: { structured: selected } },
    { outcome: 'done', output: { text: '', structured: selected, extra: 1 } },
    { outcome: 'done', output: { text: '', structured: selected }, extra: 1 },
  ])
    await expect(invoke(input, result).promise).rejects.toThrow()
  for (const outcome of ['blocked', 'limit']) {
    expect(await invoke(input, { outcome, output: { text: 'No capacity.' } }).promise).toEqual({
      outcome,
      output: { reason: 'No capacity.' },
    })
    expect(() =>
      checkRoutingResult(
        { outcome, output: { candidateId: 'b', reason: 'No capacity.' } },
        candidates,
      ),
    ).toThrow()
  }
})
test('operational failure and cancellation propagate without retries', async () => {
  for (const code of ['CANCELLED', 'UNCERTAIN', 'DEADLINE_EXCEEDED', 'UNAVAILABLE']) {
    let calls = 0
    const failure = new OperationError(code, 'Stopped.')
    await expect(
      route({
        input,
        signal: new AbortController().signal,
        call: async () => {
          calls++
          throw failure
        },
      }),
    ).rejects.toBe(failure)
    expect(calls).toBe(1)
  }
  const abort = new AbortController()
  abort.abort(new Error('root stop'))
  let calls = 0
  await expect(
    route({
      input,
      signal: abort.signal,
      call: async () => {
        calls++
        return { outcome: 'done', output: null }
      },
    }),
  ).rejects.toThrow('root stop')
  expect(calls).toBe(0)
})

test('bounded Agent refusal reasons preserve blocked and limit outcomes', async () => {
  for (const outcome of ['blocked', 'limit']) {
    for (const text of ['', '🙂'.repeat(1000)]) {
      const result = await invoke(input, { outcome, output: { text } }).promise
      expect(result.outcome).toBe(outcome)
      expect(Buffer.byteLength((result.output as { reason: string }).reason)).toBeLessThanOrEqual(
        2000,
      )
    }
  }
})
