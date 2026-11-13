/**
 * ACP v2 foreground accounting for a single admitted session. This deliberately
 * does not assume that the session/prompt response finishes a turn: it only
 * acknowledges insertion of an Agent-owned user message ID.
 *
 * A state_update is a session-wide snapshot, not an operation receipt. The
 * finite Jig caller issues one prompt at a time and must observe the matching
 * user-message update, a running foreground state and a fresh terminal idle
 * state. In particular, no timeout, EOF, idle snapshot or rejected RPC is
 * silently converted into success or permission to replay remote work.
 */
const MAX_TEXT_BYTES = 8_388_608
const MAX_MESSAGE_ID_BYTES = 1_024
const encoder = new TextEncoder()

export type PrivateAcpV2StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled'
  | 'error'

export class PrivateAcpV2ForegroundError extends Error {
  constructor(
    message: string,
    readonly kind: 'protocol' | 'unsettled' | 'stopped',
    readonly inserted: boolean,
  ) {
    super(message)
    this.name = 'PrivateAcpV2ForegroundError'
  }
}

export interface PrivateAcpV2TurnReceipt {
  readonly userMessageId: string
  readonly stopReason: PrivateAcpV2StopReason
  readonly text: string
}

/** Stateful accounting only; channel ownership and sandbox disposition stay with Jig. */
export class PrivateAcpV2Foreground {
  private pending = false
  private accepted: string | undefined
  private rejected = false
  private reported = new Set<string>()
  private pastUsers = new Set<string>()
  private sawRunning = false
  private state: 'idle' | 'running' | 'requires_action' = 'idle'
  private terminal: PrivateAcpV2StopReason | undefined
  private readonly messages = new Map<string, string>()
  private cumulativeBytes = 0
  private turnBytes = 0

  begin(): void {
    if (this.pending) this.protocol('ACP v2 turn is already active')
    this.pending = true
    this.accepted = undefined
    this.rejected = false
    this.reported = new Set()
    this.sawRunning = false
    this.state = 'idle'
    this.terminal = undefined
    this.messages.clear()
    // Preserve the conversation-wide budget while resetting only turn evidence.
    this.turnBytes = 0
  }

  /** An RPC success is acceptance, never terminal evidence. */
  accept(result: unknown): void {
    if (!this.pending || this.accepted !== undefined) this.protocol('Unexpected ACP v2 acceptance')
    const value = record(result)
    const id = identifier(value.messageId)
    if (this.pastUsers.has(id)) this.protocol('ACP v2 reused an accepted user ID')
    this.accepted = id
  }

  /**
   * An RPC error means no insertion. Only this explicitly rejected path may be
   * identified as pre-insertion; channel failure remains uncertain.
   */
  reject(error: unknown): void {
    if (
      !this.pending ||
      this.accepted !== undefined ||
      this.reported.size !== 0 ||
      this.sawRunning ||
      this.hasOutput
    )
      this.protocol('ACP v2 rejection conflicts with message insertion')
    const response = record(error)
    if (!Number.isSafeInteger(response.code) || typeof response.message !== 'string')
      this.protocol('Invalid ACP v2 rejection')
    this.rejected = true
    this.pending = false
    this.terminal = undefined
  }

  /** Caller has already checked the notification's owned session ID. */
  update(candidate: unknown): void {
    const value = record(candidate)
    const kind = value.sessionUpdate
    if (kind === 'state_update') {
      if (!['running', 'requires_action', 'idle'].includes(value.state as string))
        this.protocol('Unknown ACP v2 foreground state')
      if (value.stopReason !== undefined && !stopReason(value.stopReason))
        this.protocol('ACP v2 foreground ended without a known reason')
    }
    if (!this.pending) {
      // A repeated terminal snapshot must match, even after prompt settlement.
      if (kind === 'state_update' && this.terminal !== undefined &&
          (value.state !== 'idle' || value.stopReason !== this.terminal))
        this.protocol('Conflicting ACP v2 terminal snapshot')
      return
    }
    if (kind === 'user_message' || kind === 'user_message_chunk') {
      const id = identifier(value.messageId)
      if (this.pastUsers.has(id)) this.protocol('ACP v2 replayed a user message')
      this.reported.add(id)
      return
    }
    if (kind === 'state_update') {
      const state = value.state
      if (state === 'running') {
        if (this.terminal !== undefined) this.protocol('ACP v2 resumed after terminal state')
        this.state = 'running'
        this.sawRunning = true
      } else if (state === 'requires_action') {
        if (this.terminal !== undefined)
          this.protocol('ACP v2 requested action after terminal state')
        this.state = 'requires_action'
      } else if (state === 'idle') {
        if (!this.sawRunning) {
          // An initial idle snapshot or a stale idle cannot settle this prompt.
          return
        }
        if (this.terminal !== undefined) {
          if (value.stopReason !== this.terminal)
            this.protocol('Conflicting ACP v2 terminal snapshot')
          return // Identical terminal snapshots are idempotent.
        }
        this.state = 'idle'
        const reason = value.stopReason
        if (!stopReason(reason)) this.protocol('ACP v2 foreground ended without a known reason')
        this.terminal = reason
      } else this.protocol('Unknown ACP v2 foreground state')
      return
    }
    if (kind === 'agent_message_chunk' || kind === 'agent_message') {
      if (this.terminal !== undefined) this.protocol('ACP v2 delivered text after completion')
      const id = identifier(value.messageId)
      if (kind === 'agent_message_chunk') {
        const block = record(value.content)
        if (block.type !== 'text' || typeof block.text !== 'string')
          this.protocol('ACP v2 text chunk is invalid')
        this.charge(block.text)
        this.messages.set(id, (this.messages.get(id) ?? '') + block.text)
      } else if (value.content !== undefined) {
        if (value.content !== null && !Array.isArray(value.content))
          this.protocol('ACP v2 message patch is invalid')
        const contents = value.content === null ? [] : value.content
        if (!Array.isArray(contents)) this.protocol('ACP v2 message patch is invalid')
        const parts: string[] = []
        for (const item of contents) {
          const block = record(item)
          if (block.type !== 'text' || typeof block.text !== 'string')
            this.protocol('ACP v2 message patch contains non-text content')
          this.charge(block.text)
          parts.push(block.text)
        }
        this.messages.set(id, parts.join(''))
      } else if (!this.messages.has(id)) this.messages.set(id, '')
      return
    }
    // Unselected plans, tools, usage, background work and extensions confer no
    // authority and cannot independently establish a successful turn.
  }

  get acceptedMessageId(): string | undefined {
    return this.accepted
  }

  get hasRejected(): boolean {
    return this.rejected
  }

  get hasAcceptedOrInserted(): boolean {
    return (
      this.accepted !== undefined || this.reported.size > 0 || this.sawRunning || this.hasOutput
    )
  }

  get waitingForCompletion(): boolean {
    return this.pending
  }

  get hasOutput(): boolean {
    return this.turnBytes > 0 || this.messages.size > 0
  }

  /** Fail closed unless insertion, matching user report and completion concur. */
  settle(): PrivateAcpV2TurnReceipt {
    if (!this.pending) this.protocol('No ACP v2 turn is active')
    if (
      !this.accepted ||
      !this.reported.has(this.accepted) ||
      !this.sawRunning ||
      this.state !== 'idle' ||
      this.terminal === undefined
    )
      throw new PrivateAcpV2ForegroundError(
        'ACP v2 turn lacks complete insertion or terminal evidence',
        'unsettled',
        this.accepted !== undefined,
      )
    const reason = this.terminal
    this.pending = false
    this.pastUsers.add(this.accepted)
    if (reason === 'error' || reason === 'cancelled')
      throw new PrivateAcpV2ForegroundError(
        reason === 'error'
          ? 'Native ACP v2 work failed after insertion'
          : 'Native ACP v2 work was cancelled',
        'stopped',
        true,
      )
    return Object.freeze({
      userMessageId: this.accepted,
      stopReason: reason,
      text: [...this.messages.values()].join(''),
    })
  }

  private charge(value: string): void {
    const bytes = encoder.encode(value).byteLength
    this.cumulativeBytes += bytes
    this.turnBytes += bytes
    if (this.cumulativeBytes > MAX_TEXT_BYTES) this.protocol('ACP v2 text capacity exceeded')
  }

  private protocol(message: string): never {
    throw new PrivateAcpV2ForegroundError(message, 'protocol', this.accepted !== undefined)
  }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new PrivateAcpV2ForegroundError('Invalid ACP v2 object', 'protocol', false)
  return value as Record<string, unknown>
}

function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    encoder.encode(value).byteLength > MAX_MESSAGE_ID_BYTES
  )
    throw new PrivateAcpV2ForegroundError('Invalid ACP v2 message identity', 'protocol', false)
  return value
}

function stopReason(value: unknown): value is PrivateAcpV2StopReason {
  return (
    value === 'end_turn' ||
    value === 'max_tokens' ||
    value === 'max_turn_requests' ||
    value === 'refusal' ||
    value === 'cancelled' ||
    value === 'error'
  )
}
