import { sha256 } from '../src/internal/file-input.js'
import {
  parseRunCheckpointIdentity,
  parseRunCheckpointInput,
  type RetainedRunCheckpoint,
  type RunCheckpointIdentity,
  type RunCheckpointReceipt,
} from '../src/internal/private-run-checkpoint.js'
import { canonicalJson, type JsonValue } from '../src/json.js'

/** Inert publisher fixture only; production acceptance lives in protected SQLite. */
export class PrivateRunCheckpoints {
  readonly identity: RunCheckpointIdentity
  #latest: RetainedRunCheckpoint | undefined
  #closed = false
  constructor(identity: RunCheckpointIdentity) {
    this.identity = parseRunCheckpointIdentity(identity)
  }
  accept(value: unknown): RunCheckpointReceipt {
    if (this.#closed) throw new TypeError('checkpoint owner closed')
    const input = parseRunCheckpointInput(value)
    if (input.sequence !== (this.#latest?.sequence ?? 0) + 1)
      throw new TypeError('checkpoint sequence must advance by one')
    const record = { identity: this.identity, ...input }
    const digest = sha256(canonicalJson(record as unknown as JsonValue))
    this.#latest = Object.freeze({ ...record, digest })
    return Object.freeze({ sequence: input.sequence, digest })
  }
  get latest(): RetainedRunCheckpoint | undefined {
    return this.#latest
  }
  close(): void {
    this.#closed = true
    this.#latest = undefined
  }
}
