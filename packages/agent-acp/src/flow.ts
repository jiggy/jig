import {
  type AgentInput,
  AgentMethodError,
  type AgentSessionReceipt,
  finishAgent,
  prepareAgent,
  type SkillText,
} from '@jigging/agent-method'
import {
  type ChannelPair,
  type ChannelReceiver,
  type ChannelSender,
  handle,
  type JsonObject,
  OperationError,
  type RunContext,
  type RunResult,
} from '@jigging/flow'
import { converse } from './conversation.js'
import {
  FiniteAcpFrames,
  FiniteAcpTransportError,
  fragmentFiniteAcpFrame,
  readFiniteAcpReady,
} from './transport.js'
import { OptionalUpdates } from './updates.js'

const encoder = new TextEncoder()
const REQUESTS = './contracts/finite-acp/requests.json'
const RESPONSES = './contracts/finite-acp/responses.json'
const MAX_TEXT_BYTES = 8_388_608

type Settlement = { result: RunResult } | { error: unknown }
type NativeRequestMethod =
  | 'initialize'
  | 'session/new'
  | 'session/resume'
  | 'session/set_config_option'
  | 'session/prompt'
  | 'session/close'

/** Static, reviewed invocation selection. Never use an LLM-generated slot. */
export interface AgentAcpNativeSelection {
  readonly slot: string
  readonly operationId: string
  readonly requireV2?: true
}

export type AgentAcpSelectionInput = AgentAcpNativeSelection | readonly AgentAcpNativeSelection[]

const DEFAULT_CANDIDATES: readonly AgentAcpNativeSelection[] = Object.freeze([
  { slot: 'native', operationId: 'native' },
  { slot: 'backup1', operationId: 'backup1' },
  { slot: 'backup2', operationId: 'backup2' },
  { slot: 'backup3', operationId: 'backup3' },
])

/** One replaceable method; process, credentials and reviewed policy stay outside. */
export async function agentAcpFlow(
  run: RunContext,
  native: AgentAcpSelectionInput = { slot: 'native', operationId: 'native' },
): Promise<RunResult> {
  if (
    run.input === null ||
    typeof run.input !== 'object' ||
    Array.isArray(run.input) ||
    Object.keys(run.input).some(
      (key) =>
        ![
          'instructions',
          'guidance',
          'skills',
          'responseSchema',
          'conversation',
          'session',
        ].includes(key),
    )
  )
    throw new OperationError(
      'INVALID_INPUT',
      'Supply Agent instructions and optional explicit guidance, Skills or responseSchema',
    )
  const input = run.input as JsonObject
  if (Object.hasOwn(input, 'conversation') && input.conversation !== true)
    throw new OperationError('INVALID_INPUT', 'conversation must be true when supplied')
  const conversational = input.conversation === true
  const commands = run.channels.commands
  const replies = run.channels.replies
  if (
    conversational
      ? commands?.direction !== 'receive' ||
        commands.delivery !== 'direct' ||
        replies?.direction !== 'send' ||
        replies.delivery !== 'direct'
      : commands !== undefined || replies !== undefined
  )
    throw new OperationError(
      'INVALID_INPUT',
      'Conversational calls require paired direct commands and replies channels',
    )
  if (
    Object.keys(run.attachments).length ||
    Object.keys(run.channels).some((key) => !['events', 'commands', 'replies'].includes(key))
  )
    throw new OperationError(
      'INVALID_INPUT',
      'The ACP Agent accepts no attachments or undeclared channels',
    )

  const settings = run.settings as JsonObject
  if (Object.keys(settings).some((key) => key !== 'recovery'))
    throw new OperationError(
      'INVALID_INPUT',
      'The ACP Agent accepts no settings other than optional recovery policy',
    )
  const recovery = settings.recovery as JsonObject | undefined
  if (recovery !== undefined) {
    if (typeof recovery !== 'object' || recovery === null || Array.isArray(recovery))
      throw new OperationError('INVALID_INPUT', 'recovery settings must be an object')
    for (const [key, val] of Object.entries(recovery)) {
      if (key === 'beforePrompt') {
        if (val !== 'next' && val !== 'stop')
          throw new OperationError('INVALID_INPUT', 'beforePrompt must be next or stop')
      } else if (key === 'afterRejectedPrompt') {
        if (
          val !== 'stop' &&
          val !== 'next-on-limit-or-service' &&
          val !== 'next-on-auth-limit-or-service'
        )
          throw new OperationError(
            'INVALID_INPUT',
            'afterRejectedPrompt must be stop, next-on-limit-or-service, or next-on-auth-limit-or-service',
          )
      } else if (key === 'sameClientSession') {
        if (val !== 'resume-if-qualified' && val !== 'fresh')
          throw new OperationError(
            'INVALID_INPUT',
            'sameClientSession must be resume-if-qualified or fresh',
          )
      } else {
        throw new OperationError('INVALID_INPUT', `unexpected recovery setting: ${key}`)
      }
    }
  }

  const beforePrompt = (recovery?.beforePrompt as 'next' | 'stop' | undefined) ?? 'next'
  const afterRejectedPrompt =
    (recovery?.afterRejectedPrompt as
      | 'stop'
      | 'next-on-limit-or-service'
      | 'next-on-auth-limit-or-service'
      | undefined) ?? 'stop'
  const sameClientSession =
    (recovery?.sameClientSession as 'resume-if-qualified' | 'fresh' | undefined) ??
    'resume-if-qualified'

  const events = run.channels.events
  if (events !== undefined && events.direction !== 'send')
    throw new OperationError('INVALID_INPUT', 'Agent events require a send endpoint')

  const { skills, conversation: _, ...methodInput } = input
  const prepared = prepareAgent(
    methodInput as unknown as AgentInput,
    (skills === undefined ? [] : skills) as unknown as readonly SkillText[],
  )

  const candidates: readonly AgentAcpNativeSelection[] = Array.isArray(native)
    ? (native as readonly AgentAcpNativeSelection[])
    : (native as AgentAcpNativeSelection).slot === 'native'
      ? DEFAULT_CANDIDATES
      : [native as AgentAcpNativeSelection]

  const updates = new OptionalUpdates(events as ChannelSender | undefined, run.signal)
  try {
    let previousFailoverError: unknown
    for (const [candidateIndex, candidate] of candidates.entries()) {
      let sessionInput =
        prepared.session === undefined
          ? undefined
          : candidateIndex > 0 && sameClientSession === 'fresh' && 'restore' in prepared.session
            ? undefined
            : { ...prepared.session }

      let activeCandidate = candidate
      for (;;) {
        try {
          return await executeCandidate(
            run,
            activeCandidate,
            sessionInput,
            prepared,
            conversational,
            updates,
            commands,
            replies,
          )
        } catch (error) {
          if (
            candidateIndex > 0 &&
            error instanceof OperationError &&
            error.code === 'UNAVAILABLE'
          ) {
            if (sessionInput !== undefined && isUnsupportedSessionError(error)) {
              if ('retain' in sessionInput) {
                sessionInput = undefined
                // This is a changed Run request; a previously consumed operation ID
                // cannot be reused even when its original dispatch was refused.
                activeCandidate = {
                  ...candidate,
                  operationId: `${candidate.operationId}:fresh`,
                }
                continue
              }
              break
            }
            if (isUnboundSlotError(error)) {
              break
            }
            throw previousFailoverError
          }
          if (
            candidateIndex + 1 < candidates.length &&
            canRecover(error, beforePrompt, afterRejectedPrompt)
          ) {
            previousFailoverError = error
            break
          }
          throw error
        }
      }
    }
    throw previousFailoverError
  } finally {
    await updates.finish()
  }
}

function isUnsupportedSessionError(error: OperationError): boolean {
  return (
    error.message === 'finite ACP session retention requires a reviewed grant' ||
    error.message === 'this native client does not support retained sessions'
  )
}

function isUnboundSlotError(error: OperationError): boolean {
  return error.message === 'invocation slot is not admitted'
}

async function executeCandidate(
  run: RunContext,
  candidate: AgentAcpNativeSelection,
  sessionInput: ReturnType<typeof prepareAgent>['session'],
  prepared: ReturnType<typeof prepareAgent>,
  conversational: boolean,
  updates: OptionalUpdates,
  commands: RunContext['channels'][string] | undefined,
  replies: RunContext['channels'][string] | undefined,
): Promise<RunResult> {
  let requests: ChannelPair | undefined
  let responses: ChannelPair | undefined
  let work: Promise<Settlement> | undefined
  let closedChannels = false
  const owned = new AbortController()
  const signal = AbortSignal.any([run.signal, owned.signal])

  async function closeChannels(strict: boolean): Promise<void> {
    if (closedChannels) return
    closedChannels = true
    const closures: Promise<void>[] = []
    if (responses) closures.push(responses.receive.close())
    if (requests) closures.push(requests.send.close())
    if (!work) {
      if (responses) closures.push(responses.send.close())
      if (requests) closures.push(requests.receive.close())
    }
    const settled = await Promise.allSettled(closures)
    if (strict) {
      for (const item of settled) if (item.status === 'rejected') throw item.reason
      run.signal.throwIfAborted()
    }
  }

  try {
    requests = await run.channel({ contract: REQUESTS }, { signal })
    responses = await run.channel({ contract: RESPONSES }, { signal })
    work = run
      .call(
        {
          operationId: candidate.operationId,
          slot: candidate.slot,
          input: sessionInput === undefined ? null : { session: { ...sessionInput } },
          channels: { requests: requests.receive, responses: responses.send },
        },
        { signal },
      )
      .then(
        (result): Settlement => ({ result }),
        (error): Settlement => {
          owned.abort()
          return { error }
        },
      )
    const first = await essential(responses.receive.next({ signal }))
    if (first.done)
      throw new EssentialTransportFailure(
        new OperationError('CHANNEL_LOST', 'Native ACP transport omitted its ready record'),
      )
    const ready = readFiniteAcpReady(first.value)
    if (ready.protocolVersion !== 2) failure('ACP recovery requires a qualified v2 native client')
    const restoreId = ready.restoreSessionId
    const restoring = sessionInput !== undefined && 'restore' in sessionInput
    if (restoring !== (restoreId !== undefined))
      failure('Native ACP ready record does not match the session request')
    const peer = new FinitePeer(requests.send, responses.receive, signal, updates)
    const initialized = await peer.request('initialize', {
      protocolVersion: 2,
      capabilities: {},
      info: { name: 'flow-agent-acp', version: '2' },
    })
    if (initialized.protocolVersion !== 2)
      failure('Native ACP transport selected an unsupported version')
    if (restoreId !== undefined) {
      peer.sessionId = restoreId
      const resumed = await peer.request('session/resume', {
        sessionId: peer.sessionId,
        cwd: ready.cwd,
        mcpServers: [],
      })
      keys(resumed, [], ['configOptions', 'availableCommands'])
    } else {
      const created = await peer.request('session/new', { cwd: ready.cwd, mcpServers: [] })
      keys(created, ['sessionId'], ['configOptions', 'availableCommands'])
      peer.sessionId = identifier(created.sessionId)
    }
    for (const configuration of ready.configuration) {
      const result = await peer.request('session/set_config_option', {
        sessionId: peer.sessionId,
        ...configuration,
        type: 'type' in configuration && configuration.type === 'boolean' ? 'boolean' : 'id',
      })
      const options = result.configOptions
      if (!Array.isArray(options)) failure('Native ACP transport omitted reviewed configuration')
      const matching = options.filter((item) => object(item).configId === configuration.configId)
      if (matching.length !== 1 || object(matching[0]).currentValue !== configuration.value)
        failure('Native ACP transport did not confirm reviewed configuration')
    }
    if (ready.modeId !== undefined) {
      const result = await peer.request('session/set_config_option', {
        sessionId: peer.sessionId,
        configId: 'mode',
        type: 'id',
        value: ready.modeId,
      })
      if (
        !Array.isArray(result.configOptions) ||
        !result.configOptions.some(
          (item) => object(item).configId === 'mode' && object(item).currentValue === ready.modeId,
        )
      )
        failure('Native ACP v2 did not confirm the reviewed session mode')
    }
    const answer = conversational
      ? await converse(
          peer,
          prepared,
          commands as ChannelReceiver,
          replies as ChannelSender,
          ready.maxTurns,
          signal,
        )
      : await peer.prompt(prepared)
    await peer.request('session/close', { sessionId: peer.sessionId })
    await essential(requests.send.close())
    await peer.end()
    const settled = await work
    if ('error' in settled) throw settled.error
    const checkedSession = checkSettlement(settled.result, sessionInput !== undefined)
    const session =
      checkedSession === undefined && prepared.session !== undefined
        ? ({ status: 'unavailable', reason: 'unsupported-history' } as const)
        : checkedSession
    signal.throwIfAborted()
    if (conversational) await (replies as ChannelSender).close()
    await closeChannels(true)
    return session === undefined
      ? answer
      : {
          ...answer,
          output: { ...object(answer.output), session: { ...session } },
        }
  } catch (error) {
    const resourceFailed = owned.signal.aborted
    const transportFailed = error instanceof EssentialTransportFailure
    // A sanitized, pre-prompt native RPC rejection is not itself recovery
    // authority. Close the request side and allow the host to fence the client
    // and return its own prompt-forwarding/cleanup evidence instead.
    if (!resourceFailed && !transportFailed && isPrePromptNativeRejection(error) && work) {
      await requests?.send.close().catch(() => undefined)
      const hostSettlement = await work
      run.signal.throwIfAborted()
      if ('error' in hostSettlement) throw preserveRequestDiagnostic(error, hostSettlement.error)
      throw error
    }
    if (!transportFailed) owned.abort()
    const settled = await work
    run.signal.throwIfAborted()
    if (settled && 'error' in settled && (resourceFailed || transportFailed))
      throw preserveRequestDiagnostic(error, settled.error)
    if (transportFailed) throw error.cause
    if (error instanceof AgentMethodError) throw new OperationError(error.code, error.message)
    if (error instanceof FiniteAcpTransportError)
      throw new OperationError('INVALID_RESULT', error.message)
    throw error
  } finally {
    await closeChannels(false)
  }
}

function preserveRequestDiagnostic(error: unknown, failure: unknown): unknown {
  if (
    !isPrePromptNativeRejection(error) ||
    !(failure instanceof OperationError) ||
    failure.code !== 'EXECUTION_FAILED'
  )
    return failure
  const details = failure.details
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return failure
  const prompt = (details as JsonObject).nativePrompt
  if (
    prompt === null ||
    typeof prompt !== 'object' ||
    Array.isArray(prompt) ||
    (prompt as JsonObject).forwarding !== 'not-forwarded' ||
    (prompt as JsonObject).cleanup !== 'confirmed'
  )
    return failure
  // Host code and evidence remain authoritative. The request diagnostic has
  // already been validated independently and grants no recovery authority.
  return new OperationError(failure.code, error.message, {
    nativeRequest: object(error.details).nativeRequest!,
    ...object(details),
  })
}

function isPrePromptNativeRejection(error: unknown): error is OperationError {
  if (!(error instanceof OperationError) || error.code !== 'EXECUTION_FAILED') return false
  const details = error.details
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return false
  const request = (details as JsonObject).nativeRequest
  if (request === null || typeof request !== 'object' || Array.isArray(request)) return false
  return ['initialize', 'session/new', 'session/resume', 'session/set_config_option'].includes(
    (request as JsonObject).method as string,
  )
}

function canRecover(
  error: unknown,
  beforePrompt: 'next' | 'stop',
  afterRejectedPrompt: 'stop' | 'next-on-limit-or-service' | 'next-on-auth-limit-or-service',
): boolean {
  if (!(error instanceof OperationError)) return false
  const details = error.details
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return false
  const nativePrompt = (details as JsonObject).nativePrompt
  if (nativePrompt === null || typeof nativePrompt !== 'object' || Array.isArray(nativePrompt))
    return false
  const prompt = nativePrompt as JsonObject
  if (prompt.cleanup !== 'confirmed') return false

  // Case 1: Pre-prompt failure (turn 0 only; never replay settled multi-turn conversations)
  if (prompt.forwarding === 'not-forwarded') {
    return error.code === 'EXECUTION_FAILED' && beforePrompt === 'next' && prompt.turnsSettled === 0
  }

  // Case 2: Rejected first-turn prompt without output
  if (prompt.forwarding === 'rejected-without-output') {
    if (error.code !== 'UNCERTAIN' || prompt.turnsSettled !== 0) return false
    if (afterRejectedPrompt === 'stop') return false
    const nativeSession = (details as JsonObject).nativeSession
    const category =
      nativeSession && typeof nativeSession === 'object' && !Array.isArray(nativeSession)
        ? (nativeSession as JsonObject).category
        : undefined
    const httpStatusCode =
      nativeSession && typeof nativeSession === 'object' && !Array.isArray(nativeSession)
        ? (nativeSession as JsonObject).httpStatusCode
        : undefined
    const isLimitOrService =
      category === 'limit' ||
      category === 'service' ||
      httpStatusCode === 429 ||
      httpStatusCode === 502 ||
      httpStatusCode === 503 ||
      httpStatusCode === 504
    if (afterRejectedPrompt === 'next-on-limit-or-service') return isLimitOrService
    if (afterRejectedPrompt === 'next-on-auth-limit-or-service')
      return (
        isLimitOrService ||
        category === 'access' ||
        httpStatusCode === 401 ||
        httpStatusCode === 403
      )
    return false
  }

  return false
}

class EssentialTransportFailure extends Error {
  constructor(override readonly cause: OperationError) {
    super('Essential ACP channel terminated')
  }
}

/** Only actual terminal channel operations select resource-first arbitration. */
async function essential<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation
  } catch (error) {
    if (
      error instanceof OperationError &&
      ['DISCONNECTED', 'LAGGED', 'CHANNEL_LOST', 'PROTOCOL_ERROR', 'OWNER_CLOSED'].includes(
        error.code,
      )
    )
      throw new EssentialTransportFailure(error)
    throw error
  }
}

class FinitePeer {
  sessionId = ''
  text = ''
  private textBytes = 0
  private operation = 0
  private running = false
  private turn: number | undefined
  private writes: Promise<void> = Promise.resolve()
  private readonly frames = new FiniteAcpFrames('responses')
  private v2Running = false
  private v2Stop: string | undefined
  private readonly v2Users = new Set<string>()
  private readonly v2Messages = new Map<string, string>()

  constructor(
    private readonly send: ChannelSender,
    private readonly receive: ChannelReceiver,
    private readonly signal: AbortSignal,
    private readonly updates: OptionalUpdates,
  ) {}

  async request(method: NativeRequestMethod, params: JsonObject): Promise<JsonObject> {
    const id = ++this.operation
    await this.write({ jsonrpc: '2.0', id, method, params })
    for (;;) {
      const frame = await this.next()
      if (frame === undefined) failure('Native ACP response stream ended before its reply')
      if (frame.method !== undefined) {
        this.update(frame)
        continue
      }
      keys(frame, ['jsonrpc', 'id'], ['result', 'error'])
      if (frame.id !== id || Object.hasOwn(frame, 'result') === Object.hasOwn(frame, 'error'))
        failure('Native ACP response does not match its request')
      if (frame.error !== undefined) {
        const error = object(frame.error)
        keys(error, ['code', 'message'], ['data'])
        if (
          typeof error.code !== 'number' ||
          !Number.isSafeInteger(error.code) ||
          typeof error.message !== 'string'
        )
          failure('Native ACP error response is invalid')
        const operation = {
          initialize: 'initialize the AI client',
          'session/new': 'start an AI session',
          'session/resume': 'restore an AI session',
          'session/set_config_option': 'configure the AI session',
          'session/prompt': 'get an AI response',
          'session/close': 'close the AI session',
        }[method]
        const reason =
          method === 'session/new' &&
          error.code === -32603 &&
          error.data !== null &&
          typeof error.data === 'object' &&
          !Array.isArray(error.data) &&
          Object.keys(error.data).length === 1 &&
          Object.hasOwn(error.data, 'reason') &&
          (error.data as JsonObject).reason === 'managed-preferences-unavailable'
            ? 'managed-preferences-unavailable'
            : undefined
        const explanation =
          reason === undefined
            ? 'Detailed client cause is unavailable.'
            : 'The native client reported a configuration failure: macOS managed preferences could not be synchronized. Have the operator responsible for this Codex installation check its managed-preference configuration and availability.'
        throw new OperationError(
          'EXECUTION_FAILED',
          `Could not ${operation} (native code ${error.code}; ${method}). ${explanation}`,
          {
            nativeRequest: {
              method,
              code: error.code,
              ...(reason === undefined ? {} : { reason }),
            },
          },
        )
      }
      return object(frame.result)
    }
  }

  async prompt(prepared: ReturnType<typeof prepareAgent>, turn?: number): Promise<RunResult> {
    if (this.running) failure('A native turn is already running')
    this.running = true
    this.text = ''
    this.turn = turn
    this.v2Running = false
    this.v2Stop = undefined
    this.v2Users.clear()
    this.v2Messages.clear()
    let completed: JsonObject
    try {
      completed = await this.request('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: prepared.request.prompt }],
      })
      keys(completed, ['messageId'])
      const accepted = identifier(completed.messageId)
      while (!this.v2Users.has(accepted) || this.v2Stop === undefined) {
        const next = await this.next()
        if (next === undefined) failure('Native ACP v2 ended without a settled turn')
        if (next.method === undefined)
          failure('Unexpected native ACP response while waiting for foreground completion')
        this.update(next)
      }
      completed = { stopReason: this.v2Stop }
    } finally {
      this.running = false
    }
    keys(completed, ['stopReason'])
    const stop =
      completed.stopReason === 'end_turn'
        ? 'end-turn'
        : completed.stopReason === 'refusal'
          ? 'refusal'
          : ['max_tokens', 'max_turn_requests'].includes(completed.stopReason as string)
            ? 'limit'
            : undefined
    if (stop === undefined)
      throw new OperationError(
        completed.stopReason === 'cancelled'
          ? 'CANCELLED'
          : completed.stopReason === 'error'
            ? 'EXECUTION_FAILED'
            : 'INVALID_RESULT',
        'Native ACP turn did not produce a completed response',
      )
    const result = finishAgent(prepared, { outcome: 'done', output: { text: this.text, stop } })
    return { outcome: result.outcome, output: { ...result.output } }
  }

  async interrupt(): Promise<boolean> {
    if (!this.running) return false
    await this.write({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: this.sessionId },
    })
    return true
  }

  private write(frame: JsonObject): Promise<void> {
    const work = this.writes.then(async () => {
      for (const fragment of fragmentFiniteAcpFrame(JSON.stringify(frame)))
        await essential(this.send.send({ ...fragment }, { signal: this.signal }))
    })
    this.writes = work.catch(() => undefined)
    return work
  }

  async end(): Promise<void> {
    for (;;) {
      const frame = await this.next()
      if (frame === undefined) return
      this.update(frame)
    }
  }

  private async next(): Promise<JsonObject | undefined> {
    for (;;) {
      const item = await essential(this.receive.next({ signal: this.signal }))
      if (item.done) {
        this.frames.finish()
        return undefined
      }
      const text = this.frames.accept(item.value)
      if (text === undefined) continue
      let frame: JsonObject
      try {
        frame = object(JSON.parse(text))
      } catch {
        failure('Native ACP transport returned malformed JSON')
      }
      if (frame.jsonrpc !== '2.0') failure('Native ACP transport returned a non-ACP frame')
      return frame
    }
  }

  private update(frame: JsonObject): void {
    keys(frame, ['jsonrpc', 'method', 'params'])
    if (frame.method !== 'session/update' || !this.sessionId)
      failure('Unexpected native ACP notification')
    const params = object(frame.params)
    keys(params, ['sessionId', 'update'])
    if (params.sessionId !== this.sessionId) failure('Native ACP update belongs to another session')
    const update = object(params.update)
    if (update.sessionUpdate === 'user_message' || update.sessionUpdate === 'user_message_chunk') {
      if (!this.running) return
      this.v2Users.add(identifier(update.messageId))
      return
    }
    if (update.sessionUpdate === 'state_update') {
      if (!this.running) return
      if (update.state === 'running') {
        this.v2Running = true
      } else if (update.state === 'requires_action') {
        // The finite caller grants no approval or elicitation authority.
      } else if (update.state === 'idle') {
        if (this.v2Running && this.v2Stop === undefined) {
          if (typeof update.stopReason !== 'string')
            failure('ACP v2 turn ended without an attributable stop reason')
          this.v2Stop = update.stopReason
        }
      } else failure('Unknown native ACP v2 foreground state')
      return
    }
    if (update.sessionUpdate === 'agent_message') {
      if (!this.running) failure('Native ACP v2 text arrived outside a turn')
      const id = identifier(update.messageId)
      if (update.content !== undefined) {
        if (update.content !== null && !Array.isArray(update.content))
          failure('Native ACP v2 message patch is invalid')
        const blocks = update.content === null ? [] : update.content
        if (!Array.isArray(blocks)) failure('Native ACP v2 message patch is invalid')
        let text = ''
        for (const value of blocks) {
          const block = object(value)
          if (block.type !== 'text' || typeof block.text !== 'string')
            failure('Native ACP v2 message patch contains non-text data')
          this.textBytes += encoder.encode(block.text).byteLength
          text += block.text
        }
        this.v2Messages.set(id, text)
      } else if (!this.v2Messages.has(id)) this.v2Messages.set(id, '')
      if (this.textBytes > MAX_TEXT_BYTES)
        throw new OperationError('RESOURCE_EXHAUSTED', 'Native ACP text exceeds 8 MiB')
      this.text = [...this.v2Messages.values()].join('')
      return
    }
    if (
      update.sessionUpdate === 'plan_update' ||
      update.sessionUpdate === 'tool_call_update' ||
      update.sessionUpdate === 'usage_update'
    )
      return
    if (update.sessionUpdate === 'session_info_update') {
      keys(update, ['sessionUpdate', '_meta'])
      const metadata = object(update._meta)
      keys(metadata, ['notice'])
      const notice = object(metadata.notice)
      keys(notice, ['code'])
      if (notice.code !== 'NATIVE_WARNING') failure('Unknown native ACP diagnostic')
      console.warn(
        'Native Agent reported a warning. Private details were withheld; check the operator’s native-client configuration if behavior is unexpected.',
      )
      return
    } else if (update.sessionUpdate === 'agent_message_chunk') {
      keys(update, ['sessionUpdate', 'content'], ['messageId'])
      const content = object(update.content)
      keys(content, ['type', 'text'])
      if (content.type !== 'text' || typeof content.text !== 'string')
        failure('Native ACP update is not public text')
      const id = update.messageId !== undefined ? identifier(update.messageId) : ''
      this.v2Messages.set(id, (this.v2Messages.get(id) ?? '') + content.text)
      this.textBytes += encoder.encode(content.text).byteLength
      if (this.textBytes > MAX_TEXT_BYTES)
        throw new OperationError('RESOURCE_EXHAUSTED', 'Native ACP text exceeds 8 MiB')
      this.text = [...this.v2Messages.values()].join('')
    } else if (update.sessionUpdate === 'plan') {
      keys(update, ['sessionUpdate', 'entries'])
      if (!Array.isArray(update.entries)) failure('Native ACP plan is invalid')
      for (const entry of update.entries) {
        const item = object(entry)
        keys(item, ['content', 'priority', 'status'])
        if (
          typeof item.content !== 'string' ||
          !['high', 'medium', 'low'].includes(item.priority as string) ||
          !['pending', 'in_progress', 'completed'].includes(item.status as string)
        )
          failure('Native ACP plan is invalid')
      }
    } else failure('Native ACP transport returned a private update')
    if (!this.running) failure('Public ACP update arrived outside a turn')
    this.updates.offer(this.turn === undefined ? update : { ...update, turn: this.turn })
  }
}

function checkSettlement(
  result: RunResult,
  requestedSession: boolean,
): AgentSessionReceipt | undefined {
  const value = object(result)
  keys(value, ['outcome', 'output'])
  const output = object(value.output)
  keys(output, [
    'stopReason',
    'exitCode',
    'signal',
    'cleanup',
    ...(requestedSession ? ['session'] : []),
  ])
  if (
    value.outcome !== 'done' ||
    output.cleanup !== 'complete' ||
    !['exited', 'closed'].includes(output.stopReason as string) ||
    (output.exitCode !== null &&
      (typeof output.exitCode !== 'number' || !Number.isSafeInteger(output.exitCode))) ||
    (output.signal !== null && typeof output.signal !== 'string')
  )
    failure('Native ACP resource did not supply complete settlement')
  if (output.stopReason === 'exited' && (output.exitCode !== 0 || output.signal !== null))
    throw new OperationError('EXECUTION_FAILED', 'Native ACP process exited unsuccessfully')
  if (!requestedSession) return undefined
  const session = object(output.session)
  if (session.status === 'unavailable') {
    keys(session, ['status', 'reason'])
    if (
      !['not-cleanly-closed', 'missing-history', 'unsupported-history', 'capacity'].includes(
        session.reason as string,
      )
    )
      failure('Native ACP resource returned an invalid retention reason')
    return session as unknown as AgentSessionReceipt
  }
  keys(session, ['status', 'reference'])
  if (
    session.status !== 'retained' ||
    typeof session.reference !== 'string' ||
    session.reference.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(session.reference) ||
    output.stopReason !== 'exited' ||
    output.exitCode !== 0 ||
    output.signal !== null
  )
    failure('Native ACP resource returned an invalid session receipt')
  return { status: 'retained', reference: session.reference }
}

function object(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    failure('Expected a native ACP data object')
  return value as JsonObject
}
function keys(
  value: JsonObject,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    failure('Unexpected native ACP fields')
}
function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    encoder.encode(value).byteLength > 1_024
  )
    failure('Invalid native ACP identity')
  return value
}
function failure(message: string): never {
  throw new OperationError('INVALID_RESULT', message)
}

export async function runAgentAcpFlow(): Promise<void> {
  await handle(agentAcpFlow)
}
