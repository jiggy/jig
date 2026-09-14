import { AgentMethodError, prepareAgent, type AgentInput } from '@jigging/agent-method'
import {
  OperationError,
  type ChannelReceiver,
  type ChannelSender,
  type JsonObject,
  type RunResult,
} from '@jigging/flow'

export interface ConversationPeer {
  prompt(input: ReturnType<typeof prepareAgent>, turn?: number): Promise<RunResult>
  interrupt(): Promise<boolean>
}

/** Application dialogue only. Native dispatch and settlement are enforced by the resource. */
export async function converse(
  peer: ConversationPeer,
  initial: ReturnType<typeof prepareAgent>,
  commands: ChannelReceiver,
  replies: ChannelSender,
  maxTurns: number,
  signal: AbortSignal,
): Promise<RunResult> {
  const reads = new AbortController()
  const readSignal = AbortSignal.any([signal, reads.signal])
  const read = () =>
    commands.next({ signal: readSignal }).then(
      (item) => ({ kind: 'command' as const, item }),
      (error) => ({ kind: 'read-error' as const, error }),
    )
  const reply = async (value: JsonObject) => {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 65_536)
      throw new OperationError(
        'RESOURCE_EXHAUSTED',
        'A conversation reply exceeds 64 KiB; request a smaller answer',
      )
    const timeout = AbortSignal.timeout(5_000)
    try {
      await replies.send(value, { signal: AbortSignal.any([signal, timeout]) })
    } catch (error) {
      signal.throwIfAborted()
      if (timeout.aborted)
        throw new OperationError(
          'DEADLINE_EXCEEDED',
          'Conversation reply delivery did not settle within five seconds',
        )
      throw error
    }
  }
  let turn = 0
  let settledTurns = 0
  let interrupted = false
  let receivedCommands = 0
  const start = (input: ReturnType<typeof prepareAgent>) =>
    peer.prompt(input, turn).then(
      (result) => ({ kind: 'turn' as const, result }),
      (error) => ({ kind: 'turn-error' as const, error }),
    )
  let active: ReturnType<typeof start> | undefined = start(initial)
  let command = read()
  try {
    for (;;) {
      const next = await Promise.race(active ? [active, command] : [command])
      signal.throwIfAborted()
      if (next.kind === 'read-error') throw next.error
      if (next.kind === 'turn' || next.kind === 'turn-error') {
        active = undefined
        settledTurns += 1
        if (next.kind === 'turn') {
          await reply({ type: 'result', turn, result: next.result as unknown as JsonObject })
        } else if (next.error instanceof OperationError && next.error.code === 'CANCELLED') {
          await reply({ type: 'cancelled', turn })
        } else if (next.error instanceof AgentMethodError && next.error.code === 'INVALID_RESULT') {
          await reply({
            type: 'error',
            turn,
            code: 'INVALID_RESULT',
            message: 'The settled Agent answer does not match the requested result',
          })
        } else throw next.error
        continue
      }
      if (next.item.done)
        throw new OperationError(
          'DISCONNECTED',
          'Conversation commands ended without an accepted close',
        )
      if (++receivedCommands > 64)
        throw new OperationError('RESOURCE_EXHAUSTED', 'Conversation control limit is 64 commands')
      command = read()
      const received = next.item.value
      if (received === null || typeof received !== 'object' || Array.isArray(received))
        throw new OperationError('INVALID_INPUT', 'Expected a conversation command')
      const value = received as JsonObject
      const type = value.type
      if (
        !['prompt', 'interrupt', 'close'].includes(type as string) ||
        typeof value.turn !== 'number' ||
        !Number.isSafeInteger(value.turn) ||
        value.turn < 0 ||
        Object.keys(value).some(
          (key) => !['type', 'turn', ...(type === 'prompt' ? ['input'] : [])].includes(key),
        )
      )
        throw new OperationError('INVALID_INPUT', 'Invalid conversation command')
      const reject = (code: string) =>
        reply({ type: 'rejected', command: type!, turn: value.turn!, code })
      if (type === 'prompt') {
        if (active) {
          await reject('BUSY')
          continue
        }
        if (value.turn !== turn + 1) {
          await reject('STALE_TURN')
          continue
        }
        if (settledTurns >= maxTurns) {
          await reject('TURN_LIMIT')
          continue
        }
        let prepared: ReturnType<typeof prepareAgent>
        try {
          // Initial context remains in the native conversation; these are new turn instructions.
          prepared = prepareAgent(value.input as unknown as AgentInput)
        } catch (error) {
          if (!(error instanceof AgentMethodError)) throw error
          await reject('INVALID_INPUT')
          continue
        }
        turn += 1
        interrupted = false
        active = start(prepared)
      } else if (type === 'interrupt') {
        if (value.turn !== turn) {
          await reject('STALE_TURN')
          continue
        }
        if (!active || interrupted) {
          await reject('NOT_RUNNING')
          continue
        }
        if (!(await peer.interrupt())) {
          await reject('NOT_RUNNING')
          continue
        }
        interrupted = true
      } else {
        if (active) {
          await reject('BUSY')
          continue
        }
        if (value.turn !== turn) {
          await reject('STALE_TURN')
          continue
        }
        await reply({ type: 'accepted', command: 'close', turn })
        // Let the caller seal its writer before releasing this receiver. Merely
        // cancelling our pending read would make a racing clean writer close fail.
        const timeout = setTimeout(() => reads.abort(), 5_000)
        try {
          const end = await command
          signal.throwIfAborted()
          if (reads.signal.aborted)
            throw new OperationError(
              'DEADLINE_EXCEEDED',
              'Conversation command closure did not settle within five seconds',
            )
          if (end.kind === 'read-error') throw end.error
          if (!end.item.done)
            throw new OperationError(
              'INVALID_INPUT',
              'Conversation commands continued after accepted close',
            )
        } finally {
          clearTimeout(timeout)
        }
        return { outcome: 'done', output: { turns: settledTurns } }
      }
      await reply({ type: 'accepted', command: type!, turn })
    }
  } finally {
    reads.abort()
    await command
    // Every native prompt promise has a rejection handler. The enclosing owner
    // cancels and settles the resource before disposing its endpoints on error.
  }
}
