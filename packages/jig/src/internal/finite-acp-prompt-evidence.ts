/**
 * A host-local statement about a *task prompt*, not about all native side
 * effects. Never infer this from ACP error text or provider HTTP status.
 *
 * The map is deliberately not derived from serialized error fields. Only the
 * contained native writer can establish that it never attempted to forward a
 * session/prompt, or that a prompt failed before any output was emitted on turn 1.
 */
export type PrivateFiniteAcpPromptForwarding = 'not-forwarded' | 'rejected-without-output'

export interface PrivateFiniteAcpPromptEvidenceRecord {
  readonly forwarding: PrivateFiniteAcpPromptForwarding
  readonly turnsSettled: number
}

const evidenceRecords = new WeakMap<object, PrivateFiniteAcpPromptEvidenceRecord>()

export class PrivateFiniteAcpTaskPromptEvidence {
  private attempted = false
  private accepted = false
  private rejectedPreInsertion = false
  private outputEmitted = false
  private settledTurns = 0

  /** Call immediately before queuing the first native task-prompt write. */
  beforeNativeWrite(method: unknown): void {
    if (method === 'session/prompt') {
      this.attempted = true
      this.rejectedPreInsertion = false
    }
  }

  /** Call when the native client accepts, inserts, or starts executing the prompt. */
  recordPromptAccepted(): void {
    this.accepted = true
    this.rejectedPreInsertion = false
  }

  /** Call only when the native client explicitly rejects the prompt before insertion. */
  recordPreInsertionRejection(): void {
    if (this.attempted && !this.accepted && !this.outputEmitted && this.settledTurns === 0) {
      this.rejectedPreInsertion = true
    }
  }

  /** Call whenever assistant text or plan is emitted during an active turn. */
  recordOutput(): void {
    this.outputEmitted = true
    this.accepted = true
    this.rejectedPreInsertion = false
  }

  /** Call when an active turn settles successfully. */
  recordTurnSettled(): void {
    this.settledTurns += 1
    this.accepted = false
    this.rejectedPreInsertion = false
    this.outputEmitted = false
  }

  /** Record only the original, local error object after owned cleanup begins. */
  noteFailure(error: unknown, isSessionFailure: boolean = false): void {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return
    if (!this.attempted && this.settledTurns === 0) {
      evidenceRecords.set(error, { forwarding: 'not-forwarded', turnsSettled: 0 })
    } else if (
      this.attempted &&
      this.rejectedPreInsertion &&
      !this.accepted &&
      !this.outputEmitted &&
      this.settledTurns === 0 &&
      isSessionFailure
    ) {
      evidenceRecords.set(error, { forwarding: 'rejected-without-output', turnsSettled: 0 })
    }
  }
}

export function privateFiniteAcpTaskPromptEvidence(
  error: unknown,
): PrivateFiniteAcpPromptEvidenceRecord | undefined {
  return error !== null && (typeof error === 'object' || typeof error === 'function')
    ? evidenceRecords.get(error)
    : undefined
}

/**
 * This attests only that Jig did not attempt to forward the task prompt.
 * A separate, successfully completed native cleanup is necessary before an
 * application may consider another candidate.
 */
export function privateFiniteAcpTaskPromptNotForwarded(error: unknown): boolean {
  return privateFiniteAcpTaskPromptEvidence(error)?.forwarding === 'not-forwarded'
}

/** A second candidate is possible only after all host-owned preconditions. */
export function privateFiniteAcpMaySelectNextCandidate(input: {
  readonly error: unknown
  readonly recovered: boolean
  readonly cancelled: boolean
  readonly deadlineExceeded: boolean
}): boolean {
  return (
    input.recovered &&
    !input.cancelled &&
    !input.deadlineExceeded &&
    privateFiniteAcpTaskPromptNotForwarded(input.error)
  )
}
