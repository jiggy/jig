/** Host-observed expiry before a payload is ready, after confirmed settlement. */
export class PrivateExecutionPreparationDeadlineError extends Error {
  readonly code = 'EXECUTION_PREPARATION_DEADLINE'

  constructor(cause: unknown) {
    super('execution preparation reached its enforced deadline', { cause })
    this.name = 'PrivateExecutionPreparationDeadlineError'
  }
}

export interface PrivateExecutionExit {
  readonly exitCode: number | null
  readonly signal: string | null
  readonly fenced: boolean
  readonly stopReason?:
    | 'cancelled'
    | 'coordinator_lost'
    | 'deadline'
    | 'payload_exit'
    | 'core_dump'
    | 'setup_failed'
    | 'recovered'
  readonly cleanupError?: unknown
}

/** Process evidence and streams, independent of any invocation protocol. */
export interface PrivateExecutionProcess {
  readonly stdout: AsyncIterable<Uint8Array>
  readonly stderr: AsyncIterable<Uint8Array>
  readonly completion: Promise<PrivateExecutionExit>
  write(bytes: Uint8Array): Promise<void>
  closeInput(): Promise<void>
  terminate(): Promise<void>
}
