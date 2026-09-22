import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { parseApiResult, prepareApiRequest } from '../src/api.js'
import { finishAgent, prepareAgent } from '../src/index.js'

const prepared = prepareAgent({ instructions: 'Answer.' })
const chatResult = (value: unknown) => parseApiResult(value, 'chat-completions')
const response = (content: unknown = 'Answer.', reason: unknown = 'stop', extra = {}) => ({
  outcome: 'done',
  output: {
    status: 200,
    body: {
      object: 'chat.completion',
      choices: [
        { index: 0, finish_reason: reason, message: { role: 'assistant', content, ...extra } },
      ],
    },
  },
})

test('request uses reviewed settings, has a token cap and no endpoint, key or tools', () => {
  const { api, body } = prepareApiRequest(prepared, {
    model: 'chosen-model',
    maxCompletionTokens: 32,
  })
  expect(api).toBe('chat-completions')
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
    { model: 'x', api: 'automatic' },
    { model: 'x', api: null },
    { model: 'x', structuredOutput: 'automatic' },
    { model: 'x', structuredOutput: null },
    { model: 'x', max_tokens: 32 },
    { model: 'x', tools: [] },
  ])
    expect(() => prepareApiRequest(prepared, settings)).toThrow()
  expect(() =>
    prepareApiRequest(prepareAgent({ instructions: 'é'.repeat(150000) }), { model: 'x' }),
  ).not.toThrow()
})

test('Responses requests select the exact wire format without changing endpoint authority', () => {
  expect(prepareApiRequest(prepared, { api: 'responses', model: 'chosen-model' })).toEqual({
    api: 'responses',
    body: {
      model: 'chosen-model',
      input: prepared.request.prompt,
      max_output_tokens: 4096,
      stream: false,
      store: false,
    },
  })
})

const schema = {
  $schema: 'https://flow.jig.md/schemas/schema-1.json',
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
}

test('provider-enforced schemas require explicit selection and never replace local checking', () => {
  const structured = prepareAgent({ instructions: 'Answer.', responseSchema: schema })
  const { $schema: _removed, ...projected } = schema
  for (const api of ['chat-completions', 'responses'] as const) {
    const ordinary = prepareApiRequest(structured, { api, model: 'x' }).body
    expect(ordinary.response_format).toBeUndefined()
    expect(ordinary.text).toBeUndefined()
    expect(
      prepareApiRequest(structured, { api, model: 'x', structuredOutput: 'prompt' }).body,
    ).toEqual(ordinary)
    const body = prepareApiRequest(structured, {
      api,
      model: 'x',
      structuredOutput: 'json-schema',
    }).body
    const definition = { name: 'flow_agent_result', schema: projected, strict: true }
    if (api === 'responses')
      expect(body.text).toEqual({ format: { type: 'json_schema', ...definition } })
    else expect(body.response_format).toEqual({ type: 'json_schema', json_schema: definition })
    expect(
      prepareApiRequest(prepared, { api, model: 'x', structuredOutput: 'json-schema' }).body,
    ).toEqual(prepareApiRequest(prepared, { api, model: 'x' }).body)
  }
  expect(structured.request.responseSchema?.$schema).toBe(schema.$schema)
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

test('ordinary Agent declares its packaged HTTP descriptor', async () => {
  const contract = JSON.parse(
    await readFile(new URL('../contracts/http-request/contract.json', import.meta.url), 'utf8'),
  )
  expect(contract.id).toBe('https://jig.md/contracts/http-request')
  const meta = JSON.parse(await readFile(new URL('../FLOW.meta.json', import.meta.url), 'utf8'))
  expect(meta.uses).toEqual({ http: { contract: './contracts/http-request/contract.json' } })
})

const responsesResult = (value: unknown) => parseApiResult(value, 'responses')
const responses = (output: unknown, status: unknown = 'completed', extra = {}) => ({
  outcome: 'done',
  output: {
    status: 200,
    body: { object: 'response', status, output, ...extra },
  },
})
const message = (content: unknown, status = 'completed', role = 'assistant') => ({
  type: 'message',
  role,
  status,
  content,
})
const text = (value: unknown) => ({ type: 'output_text', text: value })

test('Responses separates completed text, explicit refusal and actual token exhaustion', () => {
  expect(
    finishAgent(
      prepared,
      responsesResult(
        responses([
          { type: 'reasoning', summary: [{ type: 'summary_text', text: 'not public output' }] },
          message([text('First '), text('answer.')]),
          message([text(' Second answer.')]),
        ]),
      ),
    ),
  ).toEqual({ outcome: 'done', output: { text: 'First answer. Second answer.' } })
  expect(
    finishAgent(
      prepared,
      responsesResult(responses([message([{ type: 'refusal', refusal: 'Cannot comply.' }])])),
    ),
  ).toEqual({ outcome: 'blocked', output: { text: 'Cannot comply.' } })
  expect(
    finishAgent(
      prepared,
      responsesResult(
        responses([message([text('Partial')], 'incomplete')], 'incomplete', {
          incomplete_details: { reason: 'max_output_tokens' },
        }),
      ),
    ),
  ).toEqual({
    outcome: 'limit',
    output: { text: 'Partial' },
  })
  expect(
    finishAgent(
      prepared,
      responsesResult(
        responses([], 'incomplete', {
          incomplete_details: { reason: 'max_output_tokens' },
        }),
      ),
    ),
  ).toEqual({ outcome: 'limit', output: { text: '' } })
  expect(
    finishAgent(
      prepared,
      responsesResult(
        responses([], 'incomplete', {
          incomplete_details: { reason: 'content_filter' },
        }),
      ),
    ),
  ).toEqual({ outcome: 'blocked', output: { text: 'The Agent response was filtered.' } })
})

test('Responses rejects unsettled, failed, tool-bearing, malformed and inconsistent results', () => {
  for (const value of [
    responses([], 'queued'),
    responses([], 'in_progress'),
    responses([], 'failed', { error: { message: 'private-provider-error' } }),
    responses([], 'cancelled'),
    responses([message([text('Answer.')])], 'completed', {
      error: { message: 'private-provider-error' },
    }),
    responses([], 'incomplete'),
    responses([], 'incomplete', { incomplete_details: { reason: 'steered' } }),
    responses([message([text('Answer.')])], 'completed', {
      incomplete_details: { reason: 'max_output_tokens' },
    }),
    responses([message([text('Partial')], 'incomplete')]),
    responses([message([text('Answer.')], 'in_progress')]),
    responses([message([text('Answer.')], 'completed', 'user')]),
    responses([message([text('Answer.')]), { type: 'function_call', name: 'run' }]),
    responses([message([{ type: 'audio', data: 'secret' }])]),
    responses([message([text(42)])]),
    responses([null]),
    responses([]),
    responses([{ type: 'reasoning' }]),
    response(),
  ]) {
    let error: unknown
    try {
      responsesResult(value)
    } catch (failure) {
      error = failure
    }
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain('private-provider-error')
  }
  expect(() => chatResult(responses([message([text('Answer.')])]))).toThrow()
})

test('Responses structured results are independently checked even after a completed response', () => {
  const request = prepareAgent({ instructions: 'Answer.', responseSchema: schema })
  expect(
    finishAgent(request, responsesResult(responses([message([text('{"answer":"yes"}')])]))).output
      .structured,
  ).toEqual({ answer: 'yes' })
  for (const body of ['{"answer":42}', 'not JSON', '{"answer":"one","answer":"two"}'])
    expect(() =>
      finishAgent(request, responsesResult(responses([message([text(body)])]))),
    ).toThrow()
})

test('both APIs preserve the complete HTTP byte bounds and JSON/1 failure behavior', () => {
  for (const api of ['chat-completions', 'responses'] as const) {
    expect(() =>
      prepareApiRequest(prepareAgent({ instructions: 'x'.repeat(262144) }), { api, model: 'x' }),
    ).not.toThrow()
    expect(() =>
      parseApiResult({ outcome: 'done', output: { status: 200, body: 'x'.repeat(1048577) } }, api),
    ).toThrow()
    for (const body of [
      '{"object":"response","object":"response"}',
      '{"unsafe":9007199254740992}',
      '{"bad":"\\ud800"}',
      'not json',
    ])
      expect(() =>
        parseApiResult({ outcome: 'done', output: { status: 200, body } }, api),
      ).toThrow()
    for (const status of [400, 401, 429, 500])
      expect(() =>
        parseApiResult(
          { outcome: 'done', output: { status, body: 'private-provider-error' } },
          api,
        ),
      ).toThrow(`HTTP ${status}`)
  }
})

test('decoded HTTP data preserves the full 8 MiB Agent text bound without JSON-string wrapping', () => {
  const maximum = 'x'.repeat(8_388_608)
  const replies = [
    ['chat-completions', response(maximum)],
    ['responses', responses([message([text(maximum)])])],
  ] as const
  for (const [api, reply] of replies) {
    expect(finishAgent(prepared, parseApiResult(reply, api)).output.text.length).toBe(
      maximum.length,
    )
  }
  expect(() => chatResult(response(`${maximum}x`))).toThrow('JSON/1')
})
