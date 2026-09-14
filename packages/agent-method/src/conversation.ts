import type { ChannelPair, ChannelSender, JsonValue, RunContext, RunResult } from '@jigging/flow'
import type { AgentCallInput, AgentInput } from './index.js'

export type AgentTurn =
  | { readonly type: 'result'; readonly turn: number; readonly result: RunResult }
  | { readonly type: 'cancelled'; readonly turn: number }
  | {
      readonly type: 'error'
      readonly turn: number
      readonly code: 'INVALID_RESULT'
      readonly message: string
    }

export interface AgentConversation {
  readonly initial: Promise<AgentTurn>
  prompt(input: AgentInput): Promise<AgentTurn>
  /** Acknowledges control, not cancellation. Await the turn for its actual outcome. */
  interrupt(): Promise<'accepted' | 'not-running'>
}

export interface ConversationOptions {
  readonly operationId: string
  readonly slot: string
  readonly input: AgentCallInput
  /** Directory containing the unchanged public Agent Run contract bundle. */
  readonly contractDirectory: string
  /** Optional caller-created public update writer; observation stays application-owned. */
  readonly events?: ChannelSender
}

export interface ConversationResult<T> {
  readonly value: T
  readonly turns: readonly AgentTurn[]
  readonly settlement: RunResult
}

/** Retains received answers and every primary/cleanup failure; never manufactures success. */
export class AgentConversationError extends AggregateError {
  constructor(
    errors: readonly unknown[],
    readonly turns: readonly AgentTurn[],
    readonly settlement?: RunResult,
  ) {
    super(errors, 'Agent conversation did not complete cleanly', { cause: errors[0] })
    this.name = 'AgentConversationError'
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  // A caller may inspect another part of a turn first. Rejections are still
  // returned to every waiter; this is not a global failure acknowledgement ledger.
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}

function invalid(message: string): Error {
  return new Error(message)
}

/** Ordinary Agent Run caller logic: no ACP implementation, host imports, or provider access. */
export async function withAgentConversation<T>(
  run: RunContext,
  options: ConversationOptions,
  use: (conversation: AgentConversation) => Promise<T>,
): Promise<ConversationResult<T>> {
  if (!options.contractDirectory || options.contractDirectory.endsWith('/'))
    throw new TypeError(
      'contractDirectory must name the public Agent Run bundle without a trailing slash',
    )
  const turns: AgentTurn[] = []
  const errors: unknown[] = []
  const record = (error: unknown) => {
    if (!errors.includes(error)) errors.push(error)
  }
  const reads = new AbortController()
  const pending = new Set<ReturnType<typeof deferred<unknown>>>()
  const tracked = <V>() => {
    const value = deferred<V>()
    pending.add(value as ReturnType<typeof deferred<unknown>>)
    void value.promise.then(
      () => pending.delete(value as ReturnType<typeof deferred<unknown>>),
      () => pending.delete(value as ReturnType<typeof deferred<unknown>>),
    )
    return value
  }
  const fail = (error: unknown) => {
    record(error)
    reads.abort(error)
    for (const value of pending) value.reject(error)
  }
  let commands: ChannelPair | undefined
  let replies: ChannelPair | undefined
  let offered = false
  let work: Promise<{ result: RunResult } | { error: unknown }> | undefined
  let pump: Promise<void> | undefined
  let settlement: RunResult | undefined
  let writerClosed = false
  let value!: T
  let active = true
  let current = { turn: 0, result: tracked<AgentTurn>() }
  let promptControl:
    | { accepted: ReturnType<typeof deferred<void>>; previous: typeof current }
    | undefined
  let interruptControl: ReturnType<typeof deferred<'accepted' | 'not-running'>> | undefined
  let closeControl: ReturnType<typeof deferred<void>> | undefined
  let controls = 0
  let finished = false
  const send = async (message: JsonValue) => {
    if (++controls > 64) throw invalid('Conversation control limit is 64 commands')
    await commands!.send.send(message, { signal: run.signal })
  }
  try {
    commands = await run.channel({
      contract: `${options.contractDirectory}/contracts/agent-commands.json`,
    })
    replies = await run.channel({
      contract: `${options.contractDirectory}/contracts/agent-replies.json`,
    })
    offered = true
    // Do not cancel this local waiter to stop a conversation. Its real terminal
    // is the evidence that lets a healthy parent subsequently use the capacity.
    work = run
      .call({
        operationId: options.operationId,
        slot: options.slot,
        input: { ...options.input, conversation: true } as unknown as JsonValue,
        channels: {
          commands: commands.receive,
          replies: replies.send,
          ...(options.events ? { events: options.events } : {}),
        },
      })
      .then(
        (result) => ({ result }),
        (error) => {
          fail(error)
          return { error }
        },
      )
    pump = (async () => {
      try {
        for (;;) {
          const item = await replies!.receive.next({
            signal: AbortSignal.any([run.signal, reads.signal]),
          })
          if (item.done) throw invalid('Agent replies ended before accepted conversation close')
          const message = item.value as Record<string, JsonValue>
          if (
            !message ||
            Array.isArray(message) ||
            typeof message !== 'object' ||
            message.turn !== current.turn
          )
            throw invalid('Agent reply has an unexpected turn')
          if (message.type === 'accepted' || message.type === 'rejected') {
            if (message.command === 'prompt' && promptControl) {
              const control = promptControl
              promptControl = undefined
              if (message.type === 'accepted') control.accepted.resolve()
              else {
                const error = invalid(`Agent rejected prompt: ${String(message.code)}`)
                current.result.reject(error)
                current = control.previous
                active = false
                control.accepted.reject(error)
              }
            } else if (message.command === 'interrupt' && interruptControl) {
              const control = interruptControl
              interruptControl = undefined
              if (message.type === 'accepted') control.resolve('accepted')
              else if (message.code === 'NOT_RUNNING') control.resolve('not-running')
              else control.reject(invalid(`Agent rejected interruption: ${String(message.code)}`))
            } else if (message.command === 'close' && closeControl) {
              if (message.type !== 'accepted') throw invalid('Agent rejected conversation close')
              closeControl.resolve()
              return
            } else throw invalid('Agent sent an unexpected control reply')
          } else {
            if (!active || promptControl) throw invalid('Agent sent an out-of-order turn result')
            if (message.type === 'result') {
              const result = message.result as unknown as RunResult
              if (!result || typeof result.outcome !== 'string' || !Object.hasOwn(result, 'output'))
                throw invalid('Agent omitted its complete turn result')
            } else if (
              message.type !== 'cancelled' &&
              !(
                message.type === 'error' &&
                message.code === 'INVALID_RESULT' &&
                typeof message.message === 'string'
              )
            )
              throw invalid('Agent sent an invalid turn terminal')
            const turn = item.value as unknown as AgentTurn
            if (turns.length >= 8) throw invalid('Agent exceeded the eight-turn conversation limit')
            turns.push(turn)
            active = false
            current.result.resolve(turn)
          }
        }
      } catch (error) {
        if (!reads.signal.aborted) fail(error)
      }
    })()
    const conversation: AgentConversation = {
      initial: current.result.promise,
      prompt(input) {
        if (finished || active || interruptControl || errors.length)
          return Promise.reject(invalid('Conversation is not ready for another prompt'))
        if (current.turn >= 7) return Promise.reject(invalid('Conversation turn limit reached'))
        const previous = current
        current = { turn: previous.turn + 1, result: tracked<AgentTurn>() }
        const result = current.result.promise
        active = true
        promptControl = { accepted: tracked<void>(), previous }
        void send({
          type: 'prompt',
          turn: current.turn,
          input: input as unknown as JsonValue,
        }).catch(fail)
        return result
      },
      async interrupt() {
        if (finished || errors.length) throw invalid('Conversation is closing or failed')
        if (promptControl) await promptControl.accepted.promise
        if (!active) return 'not-running'
        if (interruptControl) return interruptControl.promise
        const control = tracked<'accepted' | 'not-running'>()
        interruptControl = control
        void send({ type: 'interrupt', turn: current.turn }).catch(fail)
        return control.promise
      },
    }
    try {
      value = await use(conversation)
    } catch (error) {
      record(error)
    }
    finished = true
    if (active) record(invalid('Application left a live Agent turn unfinished'))
    if (!active && !reads.signal.aborted && !run.signal.aborted) {
      if (interruptControl) await interruptControl.promise
      closeControl = tracked<void>()
      await send({ type: 'close', turn: current.turn })
      await commands.send.close({ signal: run.signal })
      writerClosed = true
      await closeControl.promise
    }
  } catch (error) {
    record(error)
  } finally {
    finished = true
    // A failed callback/transport stops delivery to the Agent through ordinary
    // channel closure, while preserving the non-cancelled invocation waiter.
    if (commands && !writerClosed) {
      try {
        await commands.send.close({ error: 'LAGGED', signal: run.signal })
      } catch (error) {
        record(error)
      }
    }
    reads.abort()
    await pump
    if (work) {
      const terminal = await work
      if ('error' in terminal) record(terminal.error)
      else settlement = terminal.result
    }
    if (replies) {
      try {
        await replies.receive.close()
      } catch (error) {
        record(error)
      }
    }
    // An allocated receiver that was never offered is still ours.
    if (commands && !offered) {
      try {
        await commands.receive.close()
      } catch (error) {
        record(error)
      }
    }
  }
  if (run.signal.aborted) record(run.signal.reason ?? invalid('Run cancelled'))
  if (
    !settlement ||
    settlement.outcome !== 'done' ||
    (settlement.output as { turns?: unknown } | null)?.turns !== turns.length
  )
    record(invalid('Agent omitted matching conversation settlement'))
  if (errors.length) throw new AgentConversationError(errors, Object.freeze(turns), settlement)
  return { value, turns: Object.freeze(turns), settlement: settlement! }
}
