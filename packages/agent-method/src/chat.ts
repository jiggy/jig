import { AgentMethodError } from './errors.js'
import type { ExchangeResult, PreparedAgent } from './index.js'
import { canonicalJson, decodeJson1, type JsonObject } from './json.js'
import { ordinaryRecord, snapshot } from './values.js'

const encoder = new TextEncoder()

/** One text-only Chat Completions request; all endpoint authority lives in the HTTP slot. */
export function chatRequest(prepared: PreparedAgent, settings: unknown): JsonObject {
  const value = ordinaryRecord(snapshot(settings, 'INVALID_INPUT'))
  if (
    value === undefined ||
    Object.keys(value).some((key) => !['model', 'maxCompletionTokens'].includes(key)) ||
    typeof value.model !== 'string' ||
    value.model.trim().length === 0 ||
    value.model.length > 256
  ) {
    throw new AgentMethodError('INVALID_INPUT', 'Configure the Agent model in Binding settings')
  }
  const tokens = Object.hasOwn(value, 'maxCompletionTokens') ? value.maxCompletionTokens : 4096
  if (!Number.isSafeInteger(tokens) || typeof tokens !== 'number' || tokens < 1 || tokens > 65536)
    throw new AgentMethodError('INVALID_INPUT', 'maxCompletionTokens must be between 1 and 65536')
  const body: JsonObject = {
    model: value.model,
    messages: [{ role: 'user', content: prepared.request.prompt }],
    max_completion_tokens: tokens,
    n: 1,
    stream: false,
    store: false,
  }
  // Structured answers are requested in the prompt and independently checked by
  // finishAgent. Do not pretend every compatible endpoint supports strict schemas.
  if (canonicalJson(body).byteLength > 262144)
    throw new AgentMethodError(
      'RESOURCE_EXHAUSTED',
      'Rendered request exceeds the 256 KiB HTTP body limit',
    )
  return body
}

/** Interpret only complete HTTP evidence. Never echo an arbitrary provider error body. */
export function chatResult(result: unknown): ExchangeResult {
  const record = ordinaryRecord(snapshot(result, 'INVALID_RESULT'))
  const http = record === undefined ? undefined : ordinaryRecord(record.output)
  if (
    record?.outcome !== 'done' ||
    http === undefined ||
    typeof http.status !== 'number' ||
    !Number.isInteger(http.status) ||
    http.status < 200 ||
    http.status > 599 ||
    typeof http.body !== 'string'
  )
    return invalid('HTTP slot returned invalid response evidence')
  if (http.status !== 200)
    return invalid(`Agent endpoint returned HTTP ${http.status}; no automatic retry was attempted`)
  if (encoder.encode(http.body).byteLength > 1048576)
    throw new AgentMethodError('RESOURCE_EXHAUSTED', 'Agent HTTP response exceeds 1 MiB')
  let decoded: unknown
  try {
    decoded = decodeJson1(encoder.encode(http.body))
  } catch {
    return invalid('Agent endpoint returned invalid JSON/1')
  }
  const body = ordinaryRecord(decoded)
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

function invalid(message: string): never {
  throw new AgentMethodError('INVALID_RESULT', message)
}
