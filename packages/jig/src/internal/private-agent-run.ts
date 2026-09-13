import { types as utilTypes } from 'node:util'
import { type AgentCallInput, type AgentResult, prepareAgent } from '@jigging/agent-method'

import { type ParsedInvocationContract, parseInvocationContract } from '../invocation-contract.js'
import { canonicalJson, type JsonValue } from '../json.js'
import { type CompiledSchema, compileSchemaFile } from '../schema/index.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'

export const AGENT_RUN_CONTRACT_ID = 'https://jig.md/contracts/agent-run'
export const AGENT_RUN_CONTRACT_VERSION = '1.0.0'
export const AGENT_RUN_CONTRACT_DIGEST =
  'sha256:f03ba919ddd9036b342ab03e438bb2dc65eca284829383268cb74d655a0ffba1'

export interface PreparedAgentRunInput {
  /** The immutable, ordinary JSON/1 value accepted by the exact contract. */
  readonly input: AgentCallInput
}

export type AgentRunValidationCode =
  | 'AGENT_RUN_CONTRACT_MISMATCH'
  | 'AGENT_RUN_RESULT_INVALID'
  | 'AGENT_RUN_JSON_INVALID'
  | 'AGENT_RUN_INPUT_UNPREPARED'
  | 'AGENT_RUN_STRUCTURED_REQUIRED'

export class AgentRunValidationError extends Error {
  constructor(
    readonly code: AgentRunValidationCode,
    message: string,
  ) {
    super(message)
    this.name = 'AgentRunValidationError'
  }
}

interface AgentRunSchemas {
  readonly input: CompiledSchema
  readonly result: CompiledSchema
}

interface PreparedInputState {
  readonly responseSchema?: CompiledSchema
}

const preparedInputs = new WeakMap<PreparedAgentRunInput, PreparedInputState>()

/** Reject every descriptor except the exact current Jig Agent Run contract. */
export function assertAgentRunContract(contract: ParsedInvocationContract): void {
  requireAgentRunSchemas(contract)
}

/** Snapshot and validate one method input before any Agent provider work. */
export function parseAgentRunInput(
  contract: ParsedInvocationContract,
  value: unknown,
): PreparedAgentRunInput {
  const schemas = requireAgentRunSchemas(contract)
  const inputValue = snapshotAgentJson(value, 'Agent Run input')
  schemas.input.validate(inputValue, 'AGENT_RUN_INPUT_INVALID')
  const input = inputValue as unknown as AgentCallInput
  const { skills, ...methodInput } = input
  prepareAgent(methodInput, skills ?? [])
  const responseSchema = Object.hasOwn(input, 'responseSchema')
    ? compileSchemaFile(
        canonicalJson(input.responseSchema as JsonValue),
        'Agent Run responseSchema',
      )
    : undefined

  const prepared = Object.freeze({ input })
  preparedInputs.set(
    prepared,
    Object.freeze({
      ...(responseSchema === undefined ? {} : { responseSchema }),
    }),
  )
  return prepared
}

/** Snapshot and validate one method result against its prepared input. */
export function parseAgentRunResult(
  contract: ParsedInvocationContract,
  input: PreparedAgentRunInput,
  value: unknown,
): AgentResult {
  const schemas = requireAgentRunSchemas(contract)
  const prepared = preparedInputs.get(input)
  if (prepared === undefined) {
    throw new AgentRunValidationError(
      'AGENT_RUN_INPUT_UNPREPARED',
      'Agent Run result validation requires an input returned by parseAgentRunInput',
    )
  }
  const resultValue = snapshotAgentJson(value, 'Agent Run result')
  schemas.result.validate(resultValue, 'AGENT_RUN_RESULT_INVALID')
  const result = resultValue as unknown as AgentResult
  if (prepared.responseSchema !== undefined) {
    if (result.outcome === 'done' && !Object.hasOwn(result.output, 'structured')) {
      throw new AgentRunValidationError(
        'AGENT_RUN_STRUCTURED_REQUIRED',
        'a completed Agent Run with responseSchema requires a structured result',
      )
    }
    if (Object.hasOwn(result.output, 'structured')) {
      prepared.responseSchema.validate(result.output.structured, 'AGENT_RUN_STRUCTURED_INVALID')
    }
  }
  return result
}

function requireAgentRunSchemas(contract: ParsedInvocationContract): AgentRunSchemas {
  if (
    contract === null ||
    typeof contract !== 'object' ||
    utilTypes.isProxy(contract) ||
    (Object.getPrototypeOf(contract) !== Object.prototype &&
      Object.getPrototypeOf(contract) !== null)
  ) {
    return contractMismatch('Agent Run contract must be an ordinary parsed descriptor')
  }
  const descriptorField = Object.getOwnPropertyDescriptor(contract, 'descriptor')
  const digestField = Object.getOwnPropertyDescriptor(contract, 'digest')
  if (
    descriptorField === undefined ||
    !('value' in descriptorField) ||
    !descriptorField.enumerable ||
    digestField === undefined ||
    !('value' in digestField) ||
    !digestField.enumerable
  ) {
    return contractMismatch('Agent Run contract fields must be ordinary data')
  }

  let parsed: ParsedInvocationContract
  try {
    const descriptor = snapshotPrivateOrdinaryJson(
      descriptorField.value,
      'Agent Run contract descriptor',
      (message) => new AgentRunValidationError('AGENT_RUN_CONTRACT_MISMATCH', message),
    )
    const channelsField = Object.getOwnPropertyDescriptor(contract, 'channelContracts')
    if (channelsField === undefined || !('value' in channelsField))
      return contractMismatch('Agent Run channel closure is absent')
    const channelDocuments = new Map<string, Uint8Array>()
    for (const [path, channel] of Map.prototype.entries.call(channelsField.value)) {
      const field = Object.getOwnPropertyDescriptor(channel, 'descriptor')
      if (field === undefined || !('value' in field))
        return contractMismatch('Agent Run channel descriptor is invalid')
      channelDocuments.set(
        path,
        canonicalJson(
          snapshotPrivateOrdinaryJson(
            field.value,
            'Agent channel contract',
            (message) => new TypeError(message),
          ),
        ),
      )
    }
    parsed = parseInvocationContract(
      canonicalJson(descriptor),
      'Agent Run contract',
      channelDocuments,
    )
  } catch (error) {
    if (error instanceof AgentRunValidationError) throw error
    const message = error instanceof Error ? error.message : String(error)
    return contractMismatch(`Agent Run contract descriptor is invalid: ${message}`)
  }

  if (
    parsed.descriptor.id !== AGENT_RUN_CONTRACT_ID ||
    parsed.descriptor.version !== AGENT_RUN_CONTRACT_VERSION ||
    parsed.digest !== AGENT_RUN_CONTRACT_DIGEST ||
    digestField.value !== parsed.digest ||
    parsed.profile !== 'single'
  ) {
    return contractMismatch('Agent Run requires the exact current 1.0.0 contract descriptor')
  }

  const input = parsed.schemas.get('/input')
  const result = parsed.schemas.get('/result')
  if (input === undefined || result === undefined) {
    return contractMismatch('Agent Run contract is missing its invocation schemas')
  }
  return Object.freeze({ input, result })
}

function snapshotAgentJson(value: unknown, label: string): JsonValue {
  return snapshotPrivateOrdinaryJson(
    value,
    label,
    (message) => new AgentRunValidationError('AGENT_RUN_JSON_INVALID', message),
  )
}

function contractMismatch(message: string): never {
  throw new AgentRunValidationError('AGENT_RUN_CONTRACT_MISMATCH', message)
}
