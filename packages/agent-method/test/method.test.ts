import { describe, expect, test } from 'bun:test'

import {
  AgentMethodError,
  assertResponseSchema,
  finishAgent,
  type JsonObject,
  prepareAgent,
  projectResponseSchema,
} from '../src/index.js'

const closedObject = (properties: JsonObject): JsonObject => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const schema = (properties: JsonObject): JsonObject => ({
  $schema: 'https://flow.jig.md/schemas/schema-0.json',
  ...closedObject(properties),
})
const answerSchema = schema({ answer: { type: 'string', enum: ['READY'] } })
const exchange = (text: string, stop = 'end-turn') => ({ outcome: 'done', output: { text, stop } })

describe('shared Agent method', () => {
  test('validates session intent as frozen metadata without changing the model prompt', () => {
    const reference = '013579ab-cdef-4567-89ab-0123456789ab'
    const ordinary = prepareAgent({ instructions: 'Answer.' })
    for (const session of [
      { retain: true } as const,
      { retain: true, lifetime: 'run' } as const,
      { restore: reference },
    ]) {
      const prepared = prepareAgent({ instructions: 'Answer.', session })
      expect(prepared.request).toEqual(ordinary.request)
      expect(prepared.session).toEqual(session)
      expect(prepared.session).not.toBe(session)
      expect(Object.isFrozen(prepared.session)).toBe(true)
      expect(finishAgent(prepared, exchange('answer'))).toEqual({
        outcome: 'done',
        output: { text: 'answer' },
      })
    }
    expect(ordinary).not.toHaveProperty('session')
    for (const session of [
      null,
      {},
      { retain: false },
      { retain: true, lifetime: 'forever' },
      { restore: reference, lifetime: 'run' },
      { restore: '' },
      { restore: reference.toUpperCase() },
      { restore: `${reference}\n` },
      { retain: true, restore: reference },
      { restore: reference, extra: true },
      { reference },
    ]) {
      expect(() => prepareAgent({ instructions: 'Answer.', session } as never)).toThrow(
        AgentMethodError,
      )
      expect(() => finishAgent({ ...ordinary, session } as never, exchange('answer'))).toThrow(
        AgentMethodError,
      )
    }
  })

  test('renders canonically sorted Skills and explicitly ordered separate guidance', () => {
    const makeSkill = (name: string) => ({
      name,
      files: [
        { path: 'z.txt', text: 'z' },
        { path: 'SKILL.md', text: 'guide' },
      ],
    })
    const input = {
      instructions: 'Answer.',
      guidance: [
        { label: 'z', text: 'first' },
        { label: 'a', text: 'second' },
      ],
    }
    const first = prepareAgent(input, [makeSkill('z'), makeSkill('a')])
    const second = prepareAgent(input, [makeSkill('a'), makeSkill('z')])
    expect(first.request.prompt).toBe(second.request.prompt)
    const payload = JSON.parse(first.request.prompt.split('\n').at(-1)!)
    expect(payload.skills.map((skill: { name: string }) => skill.name)).toEqual(['a', 'z'])
    expect(payload.skills[0].files.map((file: { path: string }) => file.path)).toEqual([
      'SKILL.md',
      'z.txt',
    ])
    expect(payload.guidance.map((item: { label: string }) => item.label)).toEqual(['z', 'a'])
  })

  test('takes immutable snapshots while keeping preparation clonable and inspectable', () => {
    const mutable = JSON.parse(JSON.stringify(answerSchema))
    const prepared = prepareAgent({ instructions: 'Answer.', responseSchema: mutable })
    mutable.properties.answer.enum = ['WRONG']
    expect(Object.isFrozen(prepared.request.responseSchema)).toBe(true)
    const result = finishAgent(prepared, exchange('{"answer":"READY"}'))
    expect(result).toEqual({
      outcome: 'done',
      output: { text: '{"answer":"READY"}', structured: { answer: 'READY' } },
    })
    expect(Object.isFrozen(result.output)).toBe(true)
    const cloned = JSON.parse(JSON.stringify(prepared))
    cloned.request.prompt += '\nCheck once more.'
    expect(finishAgent(cloned, exchange('{"answer":"READY"}'))).toEqual(result)
    expect(finishAgent({ ...prepared }, exchange('{"answer":"READY"}'))).toEqual(result)
    expect(() => finishAgent({ request: { prompt: '' } }, exchange('anything'))).toThrow(
      AgentMethodError,
    )
  })

  test('projects schema without mutating or sharing nested values', () => {
    const projected = projectResponseSchema(answerSchema)
    expect(projected.$schema).toBeUndefined()
    expect(answerSchema.$schema).toBe('https://flow.jig.md/schemas/schema-0.json')
    expect(projected.properties).not.toBe(answerSchema.properties)
  })

  test('maps complete transport outcomes and preserves partial text', () => {
    const prepared = prepareAgent({ instructions: 'Answer.' })
    expect(finishAgent(prepared, exchange('yes')).outcome).toBe('done')
    expect(finishAgent(prepared, exchange('no', 'refusal'))).toEqual({
      outcome: 'blocked',
      output: { text: 'no' },
    })
    expect(finishAgent(prepared, exchange('partial', 'limit'))).toEqual({
      outcome: 'limit',
      output: { text: 'partial' },
    })
    const structured = prepareAgent({ instructions: 'Answer.', responseSchema: answerSchema })
    expect(finishAgent(structured, exchange('partial', 'limit')).output).toEqual({
      text: 'partial',
    })
    expect(
      finishAgent(structured, exchange('{"answer":"READY"}', 'refusal')).output.structured,
    ).toEqual({ answer: 'READY' })
    expect(() => finishAgent(structured, exchange('{"answer":"WRONG"}', 'limit'))).toThrow()
  })

  test('accepts raw JSON and one complete JSON fence; rejects prose and duplicate members', () => {
    const prepared = prepareAgent({ instructions: 'Answer.', responseSchema: answerSchema })
    for (const text of ['{"answer":"READY"}', '\n```json\r\n{"answer":"READY"}\r\n```\n']) {
      expect(finishAgent(prepared, exchange(text)).output.structured).toEqual({ answer: 'READY' })
    }
    for (const text of [
      'Here: {"answer":"READY"}',
      '```\n{"answer":"READY"}\n```',
      '{"answer":"READY","answer":"READY"}',
      '```json\n{"answer":"READY"}\n```\ntrailer',
    ]) {
      expect(() => finishAgent(prepared, exchange(text))).toThrow(AgentMethodError)
    }
  })

  test('rejects invalid shape, schema mismatch and malformed Exchange facts', () => {
    const prepared = prepareAgent({ instructions: 'Answer.', responseSchema: answerSchema })
    for (const text of ['{}', '{"answer":"WRONG"}', '{"answer":"READY","extra":1}', '[]', 'null']) {
      expect(() => finishAgent(prepared, exchange(text))).toThrow()
    }
    for (const result of [
      { outcome: 'blocked', output: { text: 'no', stop: 'refusal' } },
      exchange('yes', 'output-limit'),
      { outcome: 'done', output: { text: 'yes', stop: ['end-turn'] } },
      { ...exchange('yes'), extra: true },
      { outcome: 'done', output: { text: 'yes', stop: 'end-turn', structured: {} } },
    ]) {
      expect(() => finishAgent(prepared, result)).toThrow(AgentMethodError)
    }
  })

  test('rejects duplicate names/paths/labels, escapes and non-JSON inputs', () => {
    const skill = { name: 'answer', files: [{ path: 'SKILL.md', text: 'check' }] }
    expect(() => prepareAgent({ instructions: 'a' }, [skill, skill])).toThrow()
    expect(() =>
      prepareAgent({ instructions: 'a' }, [{ ...skill, files: [...skill.files, ...skill.files] }]),
    ).toThrow()
    expect(() =>
      prepareAgent({ instructions: 'a' }, [
        { ...skill, files: [{ path: '../SKILL.md', text: '' }] },
      ]),
    ).toThrow()
    expect(() =>
      prepareAgent({
        instructions: 'a',
        guidance: [
          { label: 'same', text: '1' },
          { label: 'same', text: '2' },
        ],
      }),
    ).toThrow()
    expect(() => prepareAgent({ instructions: '\ud800' })).toThrow()
    let getterCalled = false
    expect(() =>
      prepareAgent({
        get instructions() {
          getterCalled = true
          return 'a'
        },
      }),
    ).toThrow()
    expect(getterCalled).toBe(false)
  })

  test('enforces combined group, item, content and rendered prompt limits', () => {
    const guidance = Array.from({ length: 64 }, (_, i) => ({ label: `label-${i}`, text: '' }))
    expect(() =>
      prepareAgent({ instructions: 'a', guidance }, [
        { name: 's', files: [{ path: 'SKILL.md', text: '' }] },
      ]),
    ).toThrow()
    const files = Array.from({ length: 1024 }, (_, i) => ({
      path: i === 0 ? 'SKILL.md' : `file-${i}`,
      text: '',
    }))
    expect(() =>
      prepareAgent({ instructions: 'a', guidance: [{ label: 'g', text: '' }] }, [
        { name: 's', files },
      ]),
    ).toThrow()
    expect(() => prepareAgent({ instructions: 'é'.repeat(524_289) })).toThrow()
    expect(() => prepareAgent({ instructions: 'a'.repeat(1_048_500) })).toThrow('after rendering')
    expect(() => prepareAgent({ instructions: 'a'.repeat(1_040_000) })).not.toThrow()
  })
})

describe('bounded structured profile', () => {
  test('checks nested objects, bounded arrays, required properties and nullable enums', () => {
    const responseSchema = schema({
      rows: {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        items: closedObject({
          count: { type: ['null', 'integer'] },
          label: { type: ['string', 'null'], enum: ['known', null] },
        }),
      },
    })
    const prepared = prepareAgent({ instructions: 'Answer.', responseSchema })
    expect(finishAgent(prepared, exchange('{"rows":[{"count":2,"label":null}]}')).outcome).toBe(
      'done',
    )
    for (const value of [
      { rows: [] },
      { rows: [{ count: 1.2, label: null }] },
      { rows: [{ count: null, label: 'unknown' }] },
      { rows: [{ count: 1 }] },
    ]) {
      expect(() => finishAgent(prepared, exchange(JSON.stringify(value)))).toThrow()
    }
  })

  test('rejects every unsupported shape instead of widening the profile', () => {
    for (const node of [
      { type: 'boolean' },
      { type: 'number' },
      { type: 'array', items: { type: 'string' } },
      { type: 'array', items: { type: 'string' }, maxItems: 257 },
      { type: 'string', minLength: 1 },
      { type: ['string', 'null'], enum: ['known'] },
      { type: ['string', 'null'], enum: [null] },
      { type: 'string', enum: ['duplicate', 'duplicate'] },
    ]) {
      expect(() => assertResponseSchema(schema({ value: node }))).toThrow()
    }
    expect(() => assertResponseSchema({ ...answerSchema, required: [] })).toThrow()
    expect(() => assertResponseSchema({ ...answerSchema, additionalProperties: true })).toThrow()
    expect(() =>
      assertResponseSchema({
        ...answerSchema,
        $schema: 'https://json-schema.org/draft/2020-12/schema',
      }),
    ).toThrow()
  })

  test('enforces depth, object property, aggregate property, enum and schema byte limits', () => {
    let deep: JsonObject = { type: 'integer' }
    for (let depth = 0; depth < 8; depth += 1) deep = closedObject({ value: deep })
    expect(() => assertResponseSchema({ $schema: answerSchema.$schema!, ...deep })).toThrow()
    const many = Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [`field${i}`, { type: 'integer' }]),
    )
    expect(() => assertResponseSchema(schema(many))).toThrow()
    const groups = Object.fromEntries(
      Array.from({ length: 32 }, (_, i) => [
        `group${i}`,
        closedObject({
          a: { type: 'integer' },
          b: { type: 'integer' },
          c: { type: 'integer' },
          d: { type: 'integer' },
        }),
      ]),
    )
    expect(() => assertResponseSchema(schema(groups))).toThrow()
    const enums = Array.from({ length: 129 }, (_, i) => String(i))
    expect(() =>
      assertResponseSchema(
        schema({ a: { type: 'string', enum: enums }, b: { type: 'string', enum: enums } }),
      ),
    ).toThrow()
    expect(() =>
      assertResponseSchema({ ...answerSchema, description: 'x'.repeat(262_144) }),
    ).toThrow('256 KiB')
  })
})
