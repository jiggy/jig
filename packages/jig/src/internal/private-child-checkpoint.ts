import { type ParsedInvocationContract, parseInvocationContract } from '../invocation-contract.js'
import { canonicalJson, Json1Error, type JsonValue } from '../json.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'
import { parseRunCheckpointInput, type RetainedRunCheckpoint } from './private-run-checkpoint.js'

export const CHILD_CHECKPOINT_CONTRACT_ID = 'https://jig.md/contracts/child-checkpoint'
export const CHILD_CHECKPOINT_CONTRACT_VERSION = '0.1.0'
export const CHILD_CHECKPOINT_CONTRACT_DIGEST =
  'sha256:efc27e2d4ec6a16656d25ec0493c5d981a3e47a30c334e380a65c920d3e531fc'

export function isChildCheckpointContract(value: {
  readonly id?: unknown
  readonly version?: unknown
  readonly digest?: unknown
}): boolean {
  return (
    value.id === CHILD_CHECKPOINT_CONTRACT_ID &&
    value.version === CHILD_CHECKPOINT_CONTRACT_VERSION &&
    value.digest === CHILD_CHECKPOINT_CONTRACT_DIGEST
  )
}

export function assertChildCheckpointContract(contract: ParsedInvocationContract): void {
  const parsed = parseInvocationContract(canonicalJson(contract.descriptor as unknown as JsonValue))
  if (
    !isChildCheckpointContract({
      id: parsed.descriptor.id,
      version: parsed.descriptor.version,
      digest: parsed.digest,
    }) ||
    contract.digest !== parsed.digest
  )
    throw new TypeError('expected the exact supported Child Checkpoint contract')
}

export interface ChildCheckpointInput {
  readonly operationId: string
}

export interface ChildCheckpointOutput {
  readonly checkpoint: {
    readonly sequence: number
    readonly digest: string
    readonly evidence: JsonValue
    readonly files: Readonly<Record<string, string>>
  } | null
}

/** Parsing identifies a caller-local operation; it supplies no child or file authority. */
export function parseChildCheckpointInput(value: unknown): ChildCheckpointInput {
  const input = snapshotPrivateOrdinaryJson(
    value,
    'child checkpoint',
    (message) => new TypeError(message),
  ) as unknown as ChildCheckpointInput
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).join(',') !== 'operationId' ||
    typeof input.operationId !== 'string' ||
    input.operationId.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*(?![\s\S])/.test(input.operationId)
  )
    throw new TypeError('child checkpoint requires a caller-local operationId')
  return input
}

/** A saved input can fit JSON/0 while its more deeply nested retrieval reply does not. */
export class PrivateChildCheckpointResultLimitError extends Error {}

/** Check both retained terminal and largest legal wire reply before issuing artifact custody. */
export function assertChildCheckpointResultFits(output: ChildCheckpointOutput): void {
  const result = {
    outcome: 'done',
    output: output as unknown as JsonValue,
    ...(output.checkpoint === null ? {} : { artifacts: { checkpoint: 'a'.repeat(128) } }),
  }
  try {
    canonicalJson({ status: 'succeeded', result })
    canonicalJson({ jsonrpc: '2.0', id: 'r'.repeat(128), result })
  } catch (error) {
    if (error instanceof Json1Error)
      throw new PrivateChildCheckpointResultLimitError(
        'child checkpoint exceeds Run/0 result limits',
      )
    throw error
  }
}

/** Project inert accepted data without exposing private identities or producer artifact references. */
export function projectChildCheckpoint(
  record: RetainedRunCheckpoint | undefined,
): ChildCheckpointOutput {
  if (record === undefined) return Object.freeze({ checkpoint: null })
  const parsed = parseRunCheckpointInput({
    sequence: record.sequence,
    evidence: record.evidence,
    files: record.files,
  })
  if (!/^sha256:[a-f0-9]{64}(?![\s\S])/.test(record.digest))
    throw new TypeError('invalid retained checkpoint digest')
  const output = Object.freeze({
    checkpoint: Object.freeze({
      sequence: parsed.sequence,
      digest: record.digest,
      evidence: parsed.evidence,
      files: parsed.files,
    }),
  })
  assertChildCheckpointResultFits(output)
  return output
}
