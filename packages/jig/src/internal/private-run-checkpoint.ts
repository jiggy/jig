import { type ParsedInvocationContract, parseInvocationContract } from '../invocation-contract.js'
import { canonicalJson, type JsonValue } from '../json.js'
import { bindingAttachmentLocalName } from '../project/attachment-routes.js'
import { privateFilePath } from './file-input.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'

export const RUN_CHECKPOINT_CONTRACT_ID = 'https://jig.md/contracts/run-checkpoint'
export const RUN_CHECKPOINT_CONTRACT_VERSION = '0.1.0'
export const RUN_CHECKPOINT_CONTRACT_DIGEST =
  'sha256:5e9304b91930242a6c09d3ea96376dfa64950abb39a083ec26eb39cff799b0b2'
export const RUN_CHECKPOINT_LIMITS = Object.freeze({
  bytes: 2 * 1024 * 1024,
  fileBytes: 1024 * 1024,
  files: 64,
  saves: 16,
})

export function isRunCheckpointContract(value: {
  readonly id?: unknown
  readonly version?: unknown
  readonly digest?: unknown
}): boolean {
  return (
    value.id === RUN_CHECKPOINT_CONTRACT_ID &&
    value.version === RUN_CHECKPOINT_CONTRACT_VERSION &&
    value.digest === RUN_CHECKPOINT_CONTRACT_DIGEST
  )
}
export function assertRunCheckpointContract(contract: ParsedInvocationContract): void {
  const parsed = parseInvocationContract(canonicalJson(contract.descriptor as unknown as JsonValue))
  if (
    !isRunCheckpointContract({
      id: parsed.descriptor.id,
      version: parsed.descriptor.version,
      digest: parsed.digest,
    }) ||
    contract.digest !== parsed.digest
  )
    throw new TypeError('expected the exact supported Run Checkpoint contract')
}

export interface RunCheckpointInput {
  readonly sequence: number
  readonly evidence: JsonValue
  readonly files: Readonly<Record<string, string>>
  /** Explicit Jig host-control identity data, never portable file authority. */
  readonly artifacts?: Readonly<Record<string, string>>
}
export interface RunCheckpointIdentity {
  readonly runId: string
  readonly method: JsonValue
  readonly input: JsonValue
}
export interface RunCheckpointReceipt {
  readonly sequence: number
  readonly digest: string
}
/** A definite negative acknowledgement, distinct from losing the control channel. */
export class PrivateCheckpointRejected extends Error {}
export interface RetainedRunCheckpoint extends RunCheckpointInput, RunCheckpointReceipt {
  readonly identity: RunCheckpointIdentity
  readonly associations?: Readonly<Record<string, JsonValue>>
  readonly manifest?: readonly {
    readonly path: string
    readonly bytes: number
    readonly digest: string
  }[]
}

export function parseRunCheckpointInput(value: unknown): RunCheckpointInput {
  const input = snapshotPrivateOrdinaryJson(
    value,
    'checkpoint',
    (message) => new TypeError(message),
  ) as unknown as RunCheckpointInput
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !['evidence,files,sequence', 'artifacts,evidence,files,sequence'].includes(
      Object.keys(input).sort().join(','),
    ) ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 1 ||
    input.sequence > RUN_CHECKPOINT_LIMITS.saves
  )
    throw new TypeError('checkpoint requires sequence 1–16, evidence, and files')
  if (!input.files || typeof input.files !== 'object' || Array.isArray(input.files))
    throw new TypeError('checkpoint files must be text values')
  if (input.artifacts !== undefined) {
    if (!input.artifacts || typeof input.artifacts !== 'object' || Array.isArray(input.artifacts))
      throw new TypeError('checkpoint artifacts must be held references')
    const names = Object.keys(input.artifacts)
    if (names.length > 8) throw new TypeError('checkpoint exceeds eight artifact associations')
    for (const name of names) {
      bindingAttachmentLocalName(name)
      const reference = input.artifacts[name]
      if (typeof reference !== 'string' || reference.length === 0 || reference.length > 1024)
        throw new TypeError('checkpoint artifacts must be held references')
    }
  }
  const paths = Object.keys(input.files)
  if (paths.length > RUN_CHECKPOINT_LIMITS.files) throw new TypeError('checkpoint exceeds 64 files')
  let bytes = 0
  for (const path of paths) {
    privateFilePath(path)
    if (
      input.artifacts !== undefined &&
      Object.keys(input.artifacts).length !== 0 &&
      (path === 'artifacts' || path.startsWith('artifacts/'))
    )
      throw new TypeError('checkpoint text collides with associated artifact namespace')
    if (paths.some((other) => other !== path && path.startsWith(`${other}/`)))
      throw new TypeError('checkpoint has a file/directory collision')
    const content = input.files[path]
    if (typeof content !== 'string') throw new TypeError('checkpoint files must be UTF-8 text')
    bytes += Buffer.byteLength(content)
  }
  if (
    bytes > RUN_CHECKPOINT_LIMITS.fileBytes ||
    canonicalJson(input as unknown as JsonValue).byteLength > RUN_CHECKPOINT_LIMITS.bytes
  )
    throw new TypeError('checkpoint exceeds its byte budget')
  return input
}

export function parseRunCheckpointIdentity(value: unknown): RunCheckpointIdentity {
  const identity = snapshotPrivateOrdinaryJson(
    value,
    'checkpoint identity',
    (m) => new TypeError(m),
  ) as unknown as RunCheckpointIdentity
  if (
    !identity ||
    typeof identity !== 'object' ||
    Array.isArray(identity) ||
    Object.keys(identity).sort().join(',') !== 'input,method,runId' ||
    !/^sha256:[a-f0-9]{64}$/.test(identity.runId)
  )
    throw new TypeError('invalid checkpoint Run identity')
  return identity
}
