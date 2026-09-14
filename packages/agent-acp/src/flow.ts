import {
  AgentMethodError,
  finishAgent,
  prepareAgent,
  type AgentInput,
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
        (key) => !['instructions', 'guidance', 'skills', 'responseSchema'].includes(key),
      )
    )
      throw new OperationError(
        'INVALID_INPUT',
        'Supply Agent instructions and optional explicit guidance, Skills or responseSchema',
      )
    const input = run.input as JsonObject
    if (
      Object.keys(run.settings).length ||
      Object.keys(run.attachments).length ||
      Object.keys(run.channels).some((key) => key !== 'events')
    )
      throw new OperationError(
        'INVALID_INPUT',
        'The finite ACP Agent accepts no settings, attachments, or channels other than events',
      )
    const events = run.channels.events
    if (events !== undefined && events.direction !== 'send')
      throw new OperationError('INVALID_INPUT', 'Agent events require a send endpoint')
    const { skills, ...methodInput } = input
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
          input: null,
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
    const peer = new FinitePeer(requests.send, responses.receive, signal, updates)
    const initialized = await peer.request('initialize', {
      protocolVersion: ready.protocolVersion,
      clientCapabilities: {},
      clientInfo: { name: 'flow-agent-acp', version: '1' },
    })
    if (initialized.protocolVersion !== 1)
      failure('Native ACP transport selected an unsupported version')
    const created = await peer.request('session/new', { cwd: ready.cwd, mcpServers: [] })
    keys(created, ['sessionId'])
    peer.sessionId = identifier(created.sessionId)
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
    const completed = await peer.request('session/prompt', {
      sessionId: peer.sessionId,
      prompt: [{ type: 'text', text: prepared.request.prompt }],
    })
    keys(completed, ['stopReason'])
    const stop =
      completed.stopReason === 'end_turn'
        ? 'end-turn'
        : completed.stopReason === 'refusal'
          ? 'refusal'
          : completed.stopReason === 'max_tokens' || completed.stopReason === 'max_turn_requests'
            ? 'limit'
            : undefined
    if (stop === undefined)
      throw new OperationError(
        completed.stopReason === 'cancelled' ? 'CANCELLED' : 'INVALID_RESULT',
        'Native ACP turn did not produce a completed response',
      )
    // Prompt settlement plus request EOF delegates bounded process closure to
    // its owner. An optional ACP close response must not hold up that cleanup.
    await essential(requests.send.close())
    await peer.end()
    const settled = await work
    if ('error' in settled) throw settled.error
    checkSettlement(settled.result)
    signal.throwIfAborted()
    const result = finishAgent(prepared, { outcome: 'done', output: { text: peer.text, stop } })
    return { outcome: result.outcome, output: { ...result.output } }
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
  private readonly frames = new FiniteAcpFrames('responses')

  constructor(
    private readonly send: ChannelSender,
    private readonly receive: ChannelReceiver,
    private readonly signal: AbortSignal,
    private readonly updates: OptionalUpdates,
  ) {}

  async request(method: string, params: JsonObject): Promise<JsonObject> {
    const id = ++this.operation
    for (const fragment of fragmentFiniteAcpFrame(
      JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    ))
      await essential(this.send.send({ ...fragment }, { signal: this.signal }))
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
    this.updates.offer(update)
  }
}

function checkSettlement(result: RunResult): void {
  const value = object(result)
  keys(value, ['outcome', 'output'])
  const output = object(value.output)
  keys(output, ['stopReason', 'exitCode', 'signal', 'cleanup'])
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
