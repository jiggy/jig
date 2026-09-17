import {
  AgentMethodError,
  finishAgent,
  prepareAgent,
  type AgentInput,
  type AgentSessionReceipt,
  type SkillText,
} from '@jigging/agent-method'
import {
  handle,
  OperationError,
  type ChannelPair,
  type ChannelReceiver,
  type ChannelSender,
  type JsonObject,
  type JsonValue,
  type RunContext,
  type RunResult,
} from '@jigging/flow'
import {
  FiniteAcpFrames,
  FiniteAcpTransportError,
  fragmentFiniteAcpFrame,
  readFiniteAcpReady,
} from './transport.js'
import { OptionalUpdates } from './updates.js'
import { converse } from './conversation.js'

const encoder = new TextEncoder()
const REQUESTS = './contracts/finite-acp/requests.json'
const RESPONSES = './contracts/finite-acp/responses.json'
const MAX_TEXT_BYTES = 8_388_608

type Settlement = { result: RunResult } | { error: unknown }

/** One replaceable method; process, credentials and reviewed policy stay outside. */
export async function agentAcpFlow(run: RunContext): Promise<RunResult> {
  let requests: ChannelPair | undefined
  let responses: ChannelPair | undefined
  let work: Promise<Settlement> | undefined
  let updates: OptionalUpdates | undefined
  let failed = false
  const owned = new AbortController()
  const signal = AbortSignal.any([run.signal, owned.signal])
  try {
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
        ? !commands ||
          commands.direction !== 'receive' ||
          commands.delivery !== 'direct' ||
          !replies ||
          replies.direction !== 'send' ||
          replies.delivery !== 'direct'
        : commands !== undefined || replies !== undefined
    )
      throw new OperationError(
        'INVALID_INPUT',
        'Conversational calls require paired direct commands and replies channels',
      )
    if (
      Object.keys(run.settings).length ||
      Object.keys(run.attachments).length ||
      Object.keys(run.channels).some((key) => !['events', 'commands', 'replies'].includes(key))
    )
      throw new OperationError(
        'INVALID_INPUT',
        'The ACP Agent accepts no settings, attachments, or undeclared channels',
      )
    const events = run.channels.events
    if (events !== undefined && events.direction !== 'send')
      throw new OperationError('INVALID_INPUT', 'Agent events require a send endpoint')
    const { skills, conversation: _, ...methodInput } = input
    const prepared = prepareAgent(
      methodInput as unknown as AgentInput,
      (skills === undefined ? [] : skills) as unknown as readonly SkillText[],
    )
    requests = await run.channel({ contract: REQUESTS }, { signal })
    responses = await run.channel({ contract: RESPONSES }, { signal })
    updates = new OptionalUpdates(events as ChannelSender | undefined, run.signal)
    work = run
      .call(
        {
          operationId: 'native',
          slot: 'native',
          input: prepared.session === undefined ? null : { session: { ...prepared.session } },
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
    if (first.done) failure('Native ACP transport omitted its ready record')
    const ready = readFiniteAcpReady(first.value)
    const restoring = prepared.session !== undefined && 'restore' in prepared.session
    if (restoring !== (ready.restoreSessionId !== undefined))
      failure('Native ACP ready record does not match the session request')
    const peer = new FinitePeer(requests.send, responses.receive, signal, updates)
    const initialized = await peer.request('initialize', {
      protocolVersion: ready.protocolVersion,
      clientCapabilities: {},
      clientInfo: { name: 'flow-agent-acp', version: '1' },
    })
    if (initialized.protocolVersion !== 1)
      failure('Native ACP transport selected an unsupported version')
    if (restoring) {
      const capabilities = object(object(initialized.agentCapabilities).sessionCapabilities)
      if (!Object.hasOwn(capabilities, 'resume'))
        failure('Native ACP transport does not advertise session resume')
      object(capabilities.resume)
      peer.sessionId = ready.restoreSessionId!
      const resumed = await peer.request('session/resume', {
        sessionId: peer.sessionId,
        cwd: ready.cwd,
        mcpServers: [],
      })
      keys(resumed, [])
    } else {
      const created = await peer.request('session/new', { cwd: ready.cwd, mcpServers: [] })
      keys(created, ['sessionId'])
      peer.sessionId = identifier(created.sessionId)
    }
    for (const configuration of ready.configuration) {
      const result = await peer.request('session/set_config_option', {
        sessionId: peer.sessionId,
        ...configuration,
      })
      const options = result.configOptions
      if (!Array.isArray(options)) failure('Native ACP transport omitted reviewed configuration')
      const matching = options.filter((item) => object(item).id === configuration.configId)
      if (matching.length !== 1 || object(matching[0]).currentValue !== configuration.value)
        failure('Native ACP transport did not confirm reviewed configuration')
    }
    if (ready.modeId !== undefined)
      await peer.request('session/set_mode', { sessionId: peer.sessionId, modeId: ready.modeId })
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
    // Prompt settlement plus request EOF delegates bounded process closure to
    // its owner. An optional ACP close response must not hold up that cleanup.
    await essential(requests.send.close())
    await peer.end()
    const settled = await work
    if ('error' in settled) throw settled.error
    const session = checkSettlement(settled.result, prepared.session !== undefined)
    signal.throwIfAborted()
    if (conversational) await (replies as ChannelSender).close()
    return session === undefined
      ? answer
      : {
          ...answer,
          output: { ...object(answer.output), session: { ...session } },
        }
  } catch (error) {
    failed = true
    const resourceFailed = owned.signal.aborted
    const transportFailed = error instanceof EssentialTransportFailure
    // The owner can close its failed transport before returning its independently
    // settled execution error. Cancelling that call now would replace UNCERTAIN
    // with a cancelled SDK wait. Root cancellation/deadline still bounds the call.
    if (!transportFailed) owned.abort()
    const settled = await work
    if (settled && 'error' in settled && (resourceFailed || transportFailed)) throw settled.error
    if (transportFailed) throw error.cause
    if (error instanceof AgentMethodError) throw new OperationError(error.code, error.message)
    if (error instanceof FiniteAcpTransportError)
      throw new OperationError('INVALID_RESULT', error.message)
    throw error
  } finally {
    // Transferred endpoints belong to the resource; dispose only our own halves.
    // If allocation failed before the call, all four halves remain local.
    await updates?.finish()
    const closures: Promise<void>[] = []
    if (responses) closures.push(responses.receive.close())
    if (requests) closures.push(requests.send.close())
    if (!work) {
      if (responses) closures.push(responses.send.close())
      if (requests) closures.push(requests.receive.close())
    }
    const settled = await Promise.allSettled(closures)
    // Ordinary channel disposal can expose a late essential transport failure.
    for (const item of settled) if (!failed && item.status === 'rejected') throw item.reason
    run.signal.throwIfAborted()
  }
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

  constructor(
    private readonly send: ChannelSender,
    private readonly receive: ChannelReceiver,
    private readonly signal: AbortSignal,
    private readonly updates: OptionalUpdates,
  ) {}

  async request(method: string, params: JsonObject): Promise<JsonObject> {
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
      if (frame.error !== undefined)
        throw new OperationError('EXECUTION_FAILED', 'Native ACP request failed')
      return object(frame.result)
    }
  }

  async prompt(prepared: ReturnType<typeof prepareAgent>, turn?: number): Promise<RunResult> {
    if (this.running) failure('A native turn is already running')
    this.running = true
    this.text = ''
    this.turn = turn
    let completed: JsonObject
    try {
      completed = await this.request('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: prepared.request.prompt }],
      })
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
        completed.stopReason === 'cancelled' ? 'CANCELLED' : 'INVALID_RESULT',
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
    // No late update may change the text already completed by session/prompt.
    if ((await this.next()) !== undefined)
      failure('Native ACP transport continued after completion')
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
    if (update.sessionUpdate === 'agent_message_chunk') {
      keys(update, ['sessionUpdate', 'content'], ['messageId'])
      const content = object(update.content)
      keys(content, ['type', 'text'])
      if (content.type !== 'text' || typeof content.text !== 'string')
        failure('Native ACP update is not public text')
      if (update.messageId !== undefined) identifier(update.messageId)
      this.textBytes += encoder.encode(content.text).byteLength
      if (this.textBytes > MAX_TEXT_BYTES)
        throw new OperationError('RESOURCE_EXHAUSTED', 'Native ACP text exceeds 8 MiB')
      this.text += content.text
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
    keys(session, ['status'])
    return { status: 'unavailable' }
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
