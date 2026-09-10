import {
  assertResponseSchema,
  type ExchangeInput,
  type ExchangeResult,
} from '@jigging/agent-method'
import type { ParsedInvocationContract } from '../invocation-contract.js'
import { canonicalJson, JSON_1_LIMITS, type JsonObject, type JsonValue } from '../json.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'

export const AGENT_EXCHANGE_CONTRACT_ID = 'https://jig.md/contracts/agent-exchange'
export const AGENT_EXCHANGE_CONTRACT_VERSION = '1.0.0'
export const AGENT_EXCHANGE_CONTRACT_DIGEST =
  'sha256:060d0a43f18fbcd35da13a416a60ec0ece611d63b6dcf64939024af0bb569cbb'

const encoder = new TextEncoder()
const PROMPT_BYTES = 1_048_576
const SCHEMA_BYTES = 256 * 1024

export class AgentExchangeValidationError extends TypeError {
  constructor(
    readonly code: 'INVALID_INPUT' | 'RESOURCE_EXHAUSTED' | 'INVALID_RESULT',
    message: string,
  ) {
    super(message)
    this.name = 'AgentExchangeValidationError'
  }
}

/** Inspection supplies a parsed captured descriptor, never an input-supplied grant. */
export function assertAgentExchangeContract(contract: ParsedInvocationContract): void {
  if (
    contract.profile !== 'single' ||
    contract.descriptor.id !== AGENT_EXCHANGE_CONTRACT_ID ||
    contract.descriptor.version !== AGENT_EXCHANGE_CONTRACT_VERSION ||
    contract.digest !== AGENT_EXCHANGE_CONTRACT_DIGEST
  ) {
    throw new AgentExchangeValidationError(
      'INVALID_INPUT',
      'Agent Exchange requires its exact current descriptor',
    )
  }
}

/** Native ACP clients parse leading slash text as control commands, not a prompt. */
export function assertAgentProviderPrompt(client: string | undefined, prompt: string): void {
  if (client !== undefined && prompt.trimStart().startsWith('/'))
    throw new AgentExchangeValidationError(
      'INVALID_INPUT',
      'Native Agent clients interpret leading-slash text as commands; send a prose prompt instead.',
    )
}

/** Enforce the lower grant even when an ordinary Flow bypasses the method library. */
export function parseAgentExchangeInput(value: unknown): ExchangeInput {
  const input = snapshotPrivateOrdinaryJson(
    value,
    'Agent Exchange input',
    (message) => new AgentExchangeValidationError('INVALID_INPUT', message),
  )
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalidInput()
  const object = input as JsonObject
  if (
    typeof object.prompt !== 'string' ||
    object.prompt.length === 0 ||
    Object.keys(object).some((key) => key !== 'prompt' && key !== 'responseSchema')
  )
    invalidInput()
  if (encoder.encode(object.prompt).byteLength > PROMPT_BYTES)
    throw new AgentExchangeValidationError(
      'RESOURCE_EXHAUSTED',
      'Agent Exchange prompt exceeds 1 MiB',
    )
  if (Object.hasOwn(object, 'responseSchema')) {
    const schema = object.responseSchema
    if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) invalidInput()
    if (canonicalJson(schema!).byteLength > SCHEMA_BYTES)
      throw new AgentExchangeValidationError(
        'RESOURCE_EXHAUSTED',
        'Agent Exchange schema exceeds 256 KiB',
      )
    assertResponseSchema(schema as JsonObject)
    return Object.freeze({ prompt: object.prompt, responseSchema: schema as JsonObject })
  }
  return Object.freeze({ prompt: object.prompt })
}

/** Only bounded provider facts leave the owned worker after confirmed settlement. */
export function projectAgentExchangeResult(value: unknown): ExchangeResult {
  const result = snapshotPrivateOrdinaryJson(
    value,
    'Agent Exchange result',
    (message) => new AgentExchangeValidationError('INVALID_RESULT', message),
  )
  if (result === null || typeof result !== 'object' || Array.isArray(result)) invalidResult()
  const object = result as JsonObject
  if (
    Object.keys(object).length !== 2 ||
    typeof object.text !== 'string' ||
    (object.stop !== 'end-turn' && object.stop !== 'refusal' && object.stop !== 'limit')
  )
    invalidResult()
  if (encoder.encode(object.text).byteLength > JSON_1_LIMITS.stringBytes) invalidResult()
  const complete: ExchangeResult = {
    outcome: 'done',
    output: { text: object.text, stop: object.stop },
  }
  // Escaping can make otherwise bounded text exceed the complete JSON/1 frame.
  canonicalJson(complete as unknown as JsonValue)
  return Object.freeze({ ...complete, output: Object.freeze(complete.output) })
}

function invalidInput(): never {
  throw new AgentExchangeValidationError(
    'INVALID_INPUT',
    'Agent Exchange accepts only a prompt and optional responseSchema',
  )
}

function invalidResult(): never {
  throw new AgentExchangeValidationError(
    'INVALID_RESULT',
    'Agent Exchange requires bounded text and a supported stop reason',
  )
}
