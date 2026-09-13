import { describe, expect, test } from 'bun:test'
import { checkAgentResult } from '../src/index.js'

const schema = {
  $schema: 'https://flow.jig.md/schemas/schema-1.json',
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
}

describe('consumer-side Agent result checking', () => {
  test('takes an immutable snapshot independent of the selected implementation', () => {
    const input = { outcome: 'done', output: { text: 'answer', structured: { answer: 'yes' } } }
    const result = checkAgentResult(input, schema)
    input.output.structured.answer = 'changed'
    expect(result.output.structured).toEqual({ answer: 'yes' })
    expect(Object.isFrozen(result.output.structured)).toBe(true)
    expect(Object.isFrozen(result.output)).toBe(true)
    expect(Object.isFrozen(result)).toBe(true)
  })

  test('requires structured completion, but permits an honest blocked or limited answer', () => {
    expect(() =>
      checkAgentResult({ outcome: 'done', output: { text: 'no data' } }, schema),
    ).toThrow('requires a structured result')
    for (const outcome of ['blocked', 'limit']) {
      expect(
        checkAgentResult({ outcome, output: { text: 'Could not finish.' } }, schema).outcome,
      ).toBe(outcome)
      expect(() =>
        checkAgentResult(
          { outcome, output: { text: 'Invalid data', structured: { answer: 3 } } },
          schema,
        ),
      ).toThrow('does not match responseSchema')
    }
  })

  test('rejects malformed or embellished envelopes and mismatched dynamic data', () => {
    for (const result of [
      null,
      [],
      {},
      { outcome: 'invented', output: { text: '' } },
      { outcome: 'done', output: { text: 3 } },
      { outcome: 'done', output: { text: '', extra: true } },
      { outcome: 'done', output: { text: '' }, trusted: true },
    ])
      expect(() => checkAgentResult(result)).toThrow()
    expect(() =>
      checkAgentResult(
        { outcome: 'done', output: { text: '', structured: { answer: 3 } } },
        schema,
      ),
    ).toThrow('does not match responseSchema')
    expect(() =>
      checkAgentResult({ outcome: 'done', output: { text: '', structured: 9007199254740992 } }),
    ).toThrow()
    expect(() => checkAgentResult({ outcome: 'done', output: { text: '\ud800' } })).toThrow()
  })

  test('never invokes a supplied result getter', () => {
    let reads = 0
    const value = {
      outcome: 'done',
      get output() {
        reads++
        return { text: 'hidden' }
      },
    }
    expect(() => checkAgentResult(value)).toThrow()
    expect(reads).toBe(0)
  })
})
