import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { chatRequest, chatResult } from '../src/chat.js'
import { finishAgent, prepareAgent } from '../src/index.js'

const prepared = prepareAgent({ instructions: 'Answer.' })
const response = (content: unknown = 'Answer.', reason: unknown = 'stop', extra = {}) => ({
  outcome: 'done',
  output: {
    status: 200,
    body: JSON.stringify({
      object: 'chat.completion',
      choices: [
        { index: 0, finish_reason: reason, message: { role: 'assistant', content, ...extra } },
      ],
    }),
  },
})

test('request uses reviewed settings, has a token cap and no endpoint, key or tools', () => {
  const body = chatRequest(prepared, { model: 'chosen-model', maxCompletionTokens: 32 })
  expect(body).toEqual({
    model: 'chosen-model',
    max_completion_tokens: 32,
    n: 1,
    stream: false,
    store: false,
    messages: [{ role: 'user', content: prepared.request.prompt }],
  })
  for (const settings of [
    {},
    { model: '' },
    { model: 'x', endpoint: 'https://example.org' },
    { model: 'x', maxCompletionTokens: 0 },
    { model: 'x', maxCompletionTokens: 65537 },
    { model: 'x', maxCompletionTokens: 1.5 },
    { model: 'x', maxCompletionTokens: null },
  ])
    expect(() => chatRequest(prepared, settings)).toThrow()
  expect(() =>
    chatRequest(prepareAgent({ instructions: 'é'.repeat(150000) }), { model: 'x' }),
  ).toThrow('256 KiB')
})

test('HTTP and malformed replies remain failures, without echoing provider data', () => {
  for (const status of [301, 400, 401, 429, 500]) {
    expect(() =>
      chatResult({ outcome: 'done', output: { status, body: 'private-provider-error' } }),
    ).toThrow(`HTTP ${status}`)
  }
  for (const result of [
    response(null),
    response('x', 'tool_calls'),
    response('x', null),
    response('x', 'stop', { tool_calls: [{ id: 'call', type: 'function' }] }),
    response(['not text']),
    { outcome: 'done', output: { status: 200, body: '{"choices":[],"choices":[]}' } },
    { outcome: 'done', output: { status: 200, body: 'not json' } },
  ])
    expect(() => chatResult(result)).toThrow()
})

test('complete answers, refusals and exhausted completions retain distinct outcomes', () => {
  expect(chatResult(response('Answer.', 'stop', { tool_calls: [] })).output.text).toBe('Answer.')
  expect(finishAgent(prepared, chatResult(response()))).toEqual({
    outcome: 'done',
    output: { text: 'Answer.' },
  })
  expect(finishAgent(prepared, chatResult(response('partial', 'length')))).toEqual({
    outcome: 'limit',
    output: { text: 'partial' },
  })
  expect(
    finishAgent(prepared, chatResult(response(null, 'stop', { refusal: 'Cannot comply.' }))),
  ).toEqual({ outcome: 'blocked', output: { text: 'Cannot comply.' } })
  expect(finishAgent(prepared, chatResult(response(null, 'content_filter'))).outcome).toBe(
    'blocked',
  )
})

test('the method validates structured output independently of the provider finish reason', () => {
  const request = prepareAgent({
    instructions: 'Answer.',
    responseSchema: {
      $schema: 'https://flow.jig.md/schemas/schema-1.json',
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    },
  })
  expect(finishAgent(request, chatResult(response('{"answer":"yes"}'))).output.structured).toEqual({
    answer: 'yes',
  })
  expect(() => finishAgent(request, chatResult(response('{"answer":42}')))).toThrow(
    'responseSchema',
  )
  expect(() => finishAgent(request, chatResult(response('not JSON')))).toThrow('JSON/1')
})

test('ordinary Agent uses the unchanged HTTP descriptor, not native Agent Exchange', async () => {
  expect(
    await readFile(new URL('../contracts/http-request/contract.json', import.meta.url), 'utf8'),
  ).toBe(
    await readFile(
      new URL('../../../docs/jig/spec/contracts/http-request/contract.json', import.meta.url),
      'utf8',
    ),
  )
  const meta = JSON.parse(await readFile(new URL('../flow.meta.json', import.meta.url), 'utf8'))
  expect(meta.uses).toEqual({ http: { contract: './contracts/http-request/contract.json' } })
})
