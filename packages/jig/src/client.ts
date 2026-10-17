import { spawn } from 'node:child_process'
import {
  ATTEMPT_FRAME_BYTES,
  ATTEMPT_REQUEST_BYTES,
  ATTEMPT_STDERR_BYTES,
  AttemptContractError,
  type AttemptErrorCode,
  type AttemptFrame,
  type AttemptObservation,
  type AttemptReceipt,
  type AttemptRequests,
  type AttemptResults,
  type AttemptVerb,
  decodeAttemptLine,
  type Prepared,
  type PrepareRequest,
  parseAttemptFrame,
  parseAttemptRequest,
} from './attempt-contract.js'

export * from './attempt-contract.js'

export type AttemptClientErrorCode =
  | AttemptErrorCode
  | 'TRANSPORT_UNCERTAIN'
  | 'PROTOCOL_ERROR'
  | 'ABORTED'
export class AttemptClientError extends Error {
  constructor(
    readonly code: AttemptClientErrorCode,
    readonly operation: AttemptVerb,
    readonly uncertain: boolean,
  ) {
    // Never expose subprocess stderr, native errors, server messages, or tickets.
    super(`Jig attempt ${operation}: ${code}`)
    this.name = 'AttemptClientError'
  }
}
export interface AttemptClientOptions {
  /** Exact installed executable; no shell interpretation or additional arguments. */
  executable: string
  cwd: string
  /** Omission inherits the caller's environment, including operator authentication. */
  env?: NodeJS.ProcessEnv
  /** Bounds a stuck installed process, not the Run's requested duration. Default: 25 hours. */
  timeoutMs?: number
}
export interface AttemptCallOptions {
  signal?: AbortSignal
}
export interface AttemptRunOptions extends AttemptCallOptions {
  /** Awaited before submit. Omission is a one-shot call, not crash-durable recovery. */
  persist?: (prepared: Prepared) => Promise<void>
}
export interface AttemptSubmission {
  role: 'owner' | 'observer'
  receipt: AttemptReceipt
  /** Observer completion is undefined: observing never acquires an execution lifetime. */
  completion: Promise<AttemptObservation | undefined>
  /** Close only this connection. Owner closure revokes its Run; observer closure does not. */
  close(): void
}

/** Inert until an operation is called; no native host imports or private state access. */
export function createAttemptClient(options: AttemptClientOptions) {
  const timeoutMs = options.timeoutMs ?? 90_000_000
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647 ||
    !options.executable ||
    !options.cwd
  )
    throw new TypeError('Invalid attempt client configuration')

  function execute(
    verb: AttemptVerb,
    request: AttemptRequests[AttemptVerb],
    call: AttemptCallOptions = {},
  ) {
    parseAttemptRequest(verb, request)
    const bytes = Buffer.from(
      JSON.stringify({ protocolVersion: 1, operation: verb, request }) + '\n',
    )
    if (bytes.length - 1 > ATTEMPT_REQUEST_BYTES) throw new AttemptContractError()
    let accept!: (value: AttemptSubmission) => void
    let rejectAccepted!: (error: Error) => void
    const accepted = new Promise<AttemptSubmission>((resolve, reject) => {
      accept = resolve
      rejectAccepted = reject
    })
    // Unary operations have no accepted event.
    void accepted.catch(() => {})
    let resolveCompletion!: (value: AttemptObservation | undefined) => void
    let rejectCompletion!: (error: Error) => void
    const completion = new Promise<AttemptObservation | undefined>((resolve, reject) => {
      resolveCompletion = resolve
      rejectCompletion = reject
    })
    void completion.catch(() => {})
    let resolveResult!: (value: AttemptResults[keyof AttemptResults]) => void
    let rejectResult!: (error: Error) => void
    const result = new Promise<AttemptResults[keyof AttemptResults]>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    void result.catch(() => {})
    if (call.signal?.aborted) {
      const error = new AttemptClientError('ABORTED', verb, false)
      rejectAccepted(error)
      rejectCompletion(error)
      rejectResult(error)
      return { accepted, result }
    }
    const child = spawn(options.executable, ['attempt', verb, '--json'], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stopped = false
    let role: 'owner' | 'observer' | undefined
    let acceptedIdentity:
      | Pick<AttemptReceipt, 'runId' | 'requestDigest' | 'acceptedAt' | 'target' | 'approval'>
      | undefined
    let finalFrame: AttemptFrame | undefined
    let pending = Buffer.alloc(0)
    let stderrBytes = 0
    let abortTimer: ReturnType<typeof setTimeout> | undefined
    const close = () => {
      child.stdin.end()
    }
    const finishError = (code: AttemptClientErrorCode) => {
      if (stopped) return
      stopped = true
      cleanup()
      child.stdin.destroy()
      child.kill('SIGKILL')
      const error = new AttemptClientError(code, verb, true)
      rejectAccepted(error)
      rejectCompletion(error)
      rejectResult(error)
    }
    // Submit EOF revokes the owning connection; unary stdin is already closed,
    // so unary cancellation requires SIGTERM. Allow bounded settlement before
    // escalation. Never forward AbortSignal.reason to the child or diagnostics.
    let aborted = false
    const abort = () => {
      if (stopped || aborted) return
      aborted = true
      if (verb === 'submit') close()
      else child.kill('SIGTERM')
      abortTimer = setTimeout(() => finishError('ABORTED'), 60_000)
    }
    const timer = setTimeout(() => finishError('TRANSPORT_UNCERTAIN'), timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      if (abortTimer !== undefined) clearTimeout(abortTimer)
      call.signal?.removeEventListener('abort', abort)
    }
    call.signal?.addEventListener('abort', abort, { once: true })
    child.on('error', () => finishError('TRANSPORT_UNCERTAIN'))
    child.stdin.on('error', () => finishError('TRANSPORT_UNCERTAIN'))
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > ATTEMPT_STDERR_BYTES) finishError('PROTOCOL_ERROR')
    })
    const frame = (line: Buffer) => {
      const value = parseAttemptFrame(verb, decodeAttemptLine(line))
      if (finalFrame || (value.event === 'accepted' && role)) throw new AttemptContractError()
      if (value.event === 'error') {
        finalFrame = value
        close()
        return
      }
      if (value.event === 'accepted') {
        const submitted = request as AttemptRequests['submit']
        if (
          value.receipt.target !== submitted.request.target ||
          value.receipt.approval !== submitted.request.expectedApproval
        )
          throw new AttemptContractError()
        role = value.role
        acceptedIdentity = {
          runId: value.receipt.runId,
          requestDigest: value.receipt.requestDigest,
          acceptedAt: value.receipt.acceptedAt,
          target: value.receipt.target,
          approval: value.receipt.approval,
        }
        accept({ role, receipt: value.receipt, completion, close })
        if (role === 'observer') close()
      } else if (value.event === 'terminal') {
        const receipt = value.observation.receipt
        if (
          role !== 'owner' ||
          !acceptedIdentity ||
          !receipt ||
          receipt.runId !== acceptedIdentity.runId ||
          receipt.requestDigest !== acceptedIdentity.requestDigest ||
          receipt.acceptedAt !== acceptedIdentity.acceptedAt ||
          receipt.target !== acceptedIdentity.target ||
          receipt.approval !== acceptedIdentity.approval
        )
          throw new AttemptContractError()
        finalFrame = value
        close()
      } else finalFrame = value
    }
    child.stdout.on('data', (chunk: Buffer) => {
      if (stopped) return
      try {
        let start = 0
        for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
          if (pending.length + end - start > ATTEMPT_FRAME_BYTES) throw new AttemptContractError()
          frame(Buffer.concat([pending, chunk.subarray(start, end)]))
          pending = Buffer.alloc(0)
          start = end + 1
        }
        if (pending.length + chunk.length - start > ATTEMPT_FRAME_BYTES)
          throw new AttemptContractError()
        pending = Buffer.concat([pending, chunk.subarray(start)])
      } catch {
        finishError('PROTOCOL_ERROR')
      }
    })
    child.on('close', (code) => {
      if (stopped) return
      if (aborted) {
        stopped = true
        cleanup()
        const error = new AttemptClientError('ABORTED', verb, true)
        rejectAccepted(error)
        rejectCompletion(error)
        rejectResult(error)
        return
      }
      if (pending.length || (!finalFrame && role !== 'observer')) {
        finishError('TRANSPORT_UNCERTAIN')
        return
      }
      if (finalFrame?.event === 'error') {
        stopped = true
        cleanup()
        const error = new AttemptClientError(
          finalFrame.code,
          verb,
          role !== undefined ||
            finalFrame.code === 'EXECUTION_UNCERTAIN' ||
            finalFrame.code === 'CLEANUP_UNRESOLVED',
        )
        rejectAccepted(error)
        rejectCompletion(error)
        rejectResult(error)
        return
      }
      if (code !== 0) {
        finishError('TRANSPORT_UNCERTAIN')
        return
      }
      stopped = true
      cleanup()
      if (finalFrame?.event === 'result') resolveResult(finalFrame.value)
      else if (finalFrame?.event === 'terminal') resolveCompletion(finalFrame.observation)
      else resolveCompletion(undefined)
    })
    if (call.signal?.aborted) abort()
    if (!aborted) child.stdin.write(bytes)
    // The owner's open stdin is its control lifetime, not an unfinished request.
    if (verb !== 'submit') child.stdin.end()
    return { accepted, result }
  }
  async function unary<V extends keyof AttemptResults>(
    verb: V,
    request: AttemptRequests[V],
    call?: AttemptCallOptions,
  ): Promise<AttemptResults[V]> {
    return (await execute(verb, request, call).result) as AttemptResults[V]
  }
  return {
    inspect: (request: AttemptRequests['inspect'] = {}, call?: AttemptCallOptions) =>
      unary('inspect', request, call),
    prepare: (request: PrepareRequest, call?: AttemptCallOptions) =>
      unary('prepare', request, call),
    submit: (request: AttemptRequests['submit'], call?: AttemptCallOptions) =>
      execute('submit', request, call).accepted,
    lookup: (request: AttemptRequests['lookup'], call?: AttemptCallOptions) =>
      unary('lookup', request, call),
    cancel: (request: AttemptRequests['cancel'], call?: AttemptCallOptions) =>
      unary('cancel', request, call),
    result: (request: AttemptRequests['result'], call?: AttemptCallOptions) =>
      unary('result', request, call),
    export: (request: AttemptRequests['export'], call?: AttemptCallOptions) =>
      unary('export', request, call),
    /** One-shot by default; durable callers persist before launch through the same lifecycle. */
    async run(request: PrepareRequest, call: AttemptRunOptions = {}) {
      const prepared = await unary('prepare', request, call)
      await call.persist?.(prepared)
      const submission = await execute(
        'submit',
        { ticket: prepared.ticket, request: prepared.canonicalRequest },
        call,
      ).accepted
      const observation = await submission.completion
      return { prepared, receipt: submission.receipt, role: submission.role, observation }
    },
  }
}
