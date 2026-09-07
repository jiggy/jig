import { type ParsedCapabilityContract, parseCapabilityContract } from '../capability/index.js'
import { canonicalJson, type JsonValue } from '../json.js'
import { privateFilePath, sha256 } from './linux-file-input.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'

export const RUN_CHECKPOINT_CONTRACT_ID = 'https://jig.md/contracts/run-checkpoint'
export const RUN_CHECKPOINT_CONTRACT_VERSION = '1.0.0'
export const RUN_CHECKPOINT_CONTRACT_DIGEST =
  'sha256:e7961d96842dc07bf2932f2979b2145301e4071093435e0e4e842a057896c201'
export const RUN_CHECKPOINT_LIMITS = Object.freeze({
  bytes: 2 * 1024 * 1024,
  fileBytes: 1024 * 1024,
  files: 64,
  saves: 16,
})

export function isRunCheckpointContract(value: {
  readonly id: unknown
  readonly version: unknown
  readonly digest: unknown
}): boolean {
  return (
    value.id === RUN_CHECKPOINT_CONTRACT_ID &&
    value.version === RUN_CHECKPOINT_CONTRACT_VERSION &&
    value.digest === RUN_CHECKPOINT_CONTRACT_DIGEST
  )
}
export function assertRunCheckpointContract(contract: ParsedCapabilityContract): void {
  const parsed = parseCapabilityContract(canonicalJson(contract.descriptor as unknown as JsonValue))
  if (
    !isRunCheckpointContract({ ...parsed.descriptor, digest: parsed.digest }) ||
    contract.digest !== parsed.digest
  )
    throw new TypeError('expected the exact supported Run Checkpoint contract')
}

export interface RunCheckpointInput {
  readonly sequence: number
  readonly evidence: JsonValue
  readonly files: Readonly<Record<string, string>>
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
    Object.keys(input).sort().join(',') !== 'evidence,files,sequence' ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 1 ||
    input.sequence > RUN_CHECKPOINT_LIMITS.saves
  )
    throw new TypeError('checkpoint requires sequence 1–16, evidence, and files')
  if (!input.files || typeof input.files !== 'object' || Array.isArray(input.files))
    throw new TypeError('checkpoint files must be text values')
  const paths = Object.keys(input.files)
  if (paths.length > RUN_CHECKPOINT_LIMITS.files) throw new TypeError('checkpoint exceeds 64 files')
  let bytes = 0
  for (const path of paths) {
    privateFilePath(path)
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

/** Lives only in the independent command owner; no file descriptor or scratch capture. */
export class PrivateRunCheckpoints {
  readonly #identity: RunCheckpointIdentity
  #latest: RetainedRunCheckpoint | undefined
  #closed = false
  constructor(identity: RunCheckpointIdentity) {
    this.#identity = snapshotPrivateOrdinaryJson(
      identity,
      'checkpoint identity',
      (m) => new TypeError(m),
    ) as unknown as RunCheckpointIdentity
    if (!/^sha256:[a-f0-9]{64}$/.test(this.#identity.runId))
      throw new TypeError('invalid checkpoint Run identity')
  }
  accept(value: unknown): RunCheckpointReceipt {
    if (this.#closed) throw new TypeError('checkpoint owner closed')
    const input = parseRunCheckpointInput(value)
    if (input.sequence !== (this.#latest?.sequence ?? 0) + 1)
      throw new TypeError('checkpoint sequence must advance by one')
    const record = { identity: this.#identity, ...input }
    const digest = sha256(canonicalJson(record as unknown as JsonValue))
    // Validation and bounded copying finish before replacement. No asynchronous
    // gap can publish a partial aggregate or destroy the previous accepted one.
    this.#latest = Object.freeze({ ...record, digest })
    return Object.freeze({ sequence: input.sequence, digest })
  }
  get latest(): RetainedRunCheckpoint | undefined {
    return this.#latest
  }
  get identity(): RunCheckpointIdentity {
    return this.#identity
  }
  close(): void {
    this.#closed = true
    this.#latest = undefined
  }
}
