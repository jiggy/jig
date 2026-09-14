import { AgentMethodError } from './errors.js'
import type { AgentTransportResult, PreparedAgent } from './index.js'
import { canonicalJson, type JsonObject } from './json.js'
import { projectResponseSchema } from './schema.js'
import { ordinaryRecord, snapshot } from './values.js'

type Api = 'chat-completions' | 'responses'

/** One finite text request. API settings choose syntax, never endpoint authority. */
export function prepareApiRequest(
  prepared: PreparedAgent,
  settings: unknown,
): { readonly api: Api; readonly body: JsonObject } {
  const value = ordinaryRecord(snapshot(settings, 'INVALID_INPUT'))
  if (
    value === undefined ||
    Object.keys(value).some(
      (key) => !['model', 'maxCompletionTokens', 'api', 'structuredOutput'].includes(key),
    ) ||
    typeof value.model !== 'string' ||
    value.model.trim().length === 0 ||
    value.model.length > 256
  ) {
    throw new AgentMethodError('INVALID_INPUT', 'Configure the Agent model in Binding settings')
  }
  const tokens = Object.hasOwn(value, 'maxCompletionTokens') ? value.maxCompletionTokens : 4096
  if (!Number.isSafeInteger(tokens) || typeof tokens !== 'number' || tokens < 1 || tokens > 65536)
    throw new AgentMethodError('INVALID_INPUT', 'maxCompletionTokens must be between 1 and 65536')
  const api = Object.hasOwn(value, 'api') ? value.api : 'chat-completions'
  if (api !== 'chat-completions' && api !== 'responses')
    throw new AgentMethodError('INVALID_INPUT', 'api must be chat-completions or responses')
  const structuredOutput = Object.hasOwn(value, 'structuredOutput')
    ? value.structuredOutput
    : 'prompt'
  if (structuredOutput !== 'prompt' && structuredOutput !== 'json-schema')
    throw new AgentMethodError('INVALID_INPUT', 'structuredOutput must be prompt or json-schema')
  const format =
    structuredOutput === 'json-schema' && prepared.request.responseSchema !== undefined
      ? {
          type: 'json_schema',
          name: 'flow_agent_result',
          schema: projectResponseSchema(prepared.request.responseSchema),
          strict: true,
        }
      : undefined
  const body: JsonObject =
    api === 'responses'
      ? {
          model: value.model,
          input: prepared.request.prompt,
          max_output_tokens: tokens,
          stream: false,
          store: false,
          ...(format === undefined ? {} : { text: { format } }),
        }
      : {
          model: value.model,
          messages: [{ role: 'user', content: prepared.request.prompt }],
          max_completion_tokens: tokens,
          n: 1,
          stream: false,
          store: false,
          ...(format === undefined
            ? {}
            : {
                response_format: {
                  type: format.type,
                  json_schema: { name: format.name, schema: format.schema, strict: format.strict },
                },
              }),
        }
  if (canonicalJson(body).byteLength > 8_388_608)
    throw new AgentMethodError(
      'RESOURCE_EXHAUSTED',
      'Rendered request exceeds the 8 MiB HTTP body ceiling',
    )
  return { api, body }
}

/** Interpret only complete HTTP evidence. Never echo an arbitrary provider error body. */
export function parseApiResult(result: unknown, api: Api): AgentTransportResult {
  const record = ordinaryRecord(snapshot(result, 'INVALID_RESULT'))
  const http = record === undefined ? undefined : ordinaryRecord(record.output)
  if (
    record?.outcome !== 'done' ||
    http === undefined ||
    typeof http.status !== 'number' ||
    !Number.isInteger(http.status) ||
    http.status < 200 ||
    http.status > 599 ||
    !Object.hasOwn(http, 'body')
  )
    return invalid('HTTP slot returned invalid response evidence')
  if (http.status !== 200)
    return invalid(`Agent endpoint returned HTTP ${http.status}; no automatic retry was attempted`)
  if (canonicalJson(http.body as JsonObject).byteLength > 12_582_912)
    throw new AgentMethodError('RESOURCE_EXHAUSTED', 'Agent HTTP response exceeds 12 MiB')
  const body = ordinaryRecord(http.body)
  if (api === 'responses') return responsesResult(body)
  return chatResult(body)
}

function chatResult(body: Record<string, unknown> | undefined): AgentTransportResult {
  const choices = body?.choices
  if (body?.object !== 'chat.completion' || !Array.isArray(choices) || choices.length !== 1)
    return invalid('Expected one complete Chat Completions choice')
  const choice = ordinaryRecord(choices[0])
  const message = ordinaryRecord(choice?.message)
  if (
    choice?.index !== 0 ||
    message?.role !== 'assistant' ||
    (message.tool_calls !== undefined &&
      message.tool_calls !== null &&
      !(Array.isArray(message.tool_calls) && message.tool_calls.length === 0)) ||
    (message.function_call !== undefined && message.function_call !== null)
  )
    return invalid('Agent returned an unsupported message or tool request')
  const content = message.content
  const refusal = message.refusal
  if (
    (content !== null && typeof content !== 'string') ||
    (refusal !== undefined && refusal !== null && typeof refusal !== 'string')
  )
    return invalid('Agent response must contain text or an explicit refusal')
  const reason = choice.finish_reason
  if (reason !== 'stop' && reason !== 'length' && reason !== 'content_filter')
    return invalid('Agent response has no supported terminal stop reason')
  const refused = reason === 'content_filter' || (typeof refusal === 'string' && refusal.length > 0)
  if (content === null && !refused && reason !== 'length')
    return invalid('Completed Agent response omitted text')
  return {
    outcome: 'done',
    output: {
      text: refused ? refusal || content || 'The Agent response was filtered.' : (content ?? ''),
      stop: refused ? 'refusal' : reason === 'length' ? 'limit' : 'end-turn',
    },
  }
}

function responsesResult(body: Record<string, unknown> | undefined): AgentTransportResult {
  if (
    body?.object !== 'response' ||
    (body.status !== 'completed' && body.status !== 'incomplete') ||
    (body.error !== undefined && body.error !== null) ||
    !Array.isArray(body.output)
  )
    return invalid('Agent endpoint returned no completed or limited Responses result')
  const reason = ordinaryRecord(body.incomplete_details)?.reason
  if (body.status === 'incomplete' && reason !== 'max_output_tokens' && reason !== 'content_filter')
    return invalid('Agent response has no supported incomplete reason')
  if (body.status === 'completed' && body.incomplete_details != null)
    return invalid('Completed Agent response includes incomplete details')

  const texts: string[] = []
  const refusals: string[] = []
  for (const raw of body.output) {
    const item = ordinaryRecord(raw)
    if (item?.type === 'reasoning') continue
    if (
      item?.type !== 'message' ||
      item.role !== 'assistant' ||
      !Array.isArray(item.content) ||
      (item.status !== 'completed' && item.status !== 'incomplete') ||
      (body.status === 'completed' && item.status !== 'completed')
    )
      return invalid('Agent returned an unsupported Responses output or tool request')
    for (const rawPart of item.content) {
      const part = ordinaryRecord(rawPart)
      if (part?.type === 'output_text' && typeof part.text === 'string') texts.push(part.text)
      else if (part?.type === 'refusal' && typeof part.refusal === 'string')
        refusals.push(part.refusal)
      else return invalid('Agent response must contain text or an explicit refusal')
    }
  }
  if (body.status === 'completed' && texts.length === 0 && refusals.length === 0)
    return invalid('Completed Agent response omitted text')
  const refused = refusals.length > 0 || reason === 'content_filter'
  return {
    outcome: 'done',
    output: {
      text: refused
        ? refusals.join('\n') || texts.join('') || 'The Agent response was filtered.'
        : texts.join(''),
      stop: refused ? 'refusal' : body.status === 'incomplete' ? 'limit' : 'end-turn',
    },
  }
}

function invalid(message: string): never {
  throw new AgentMethodError('INVALID_RESULT', message)
}
