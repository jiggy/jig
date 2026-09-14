import { checkAgentResult } from '@jigging/agent-method'
import {
  AgentConversationError,
  withAgentConversation,
  type AgentTurn,
} from '@jigging/agent-method/conversation'
import { OperationError, type JsonValue, type RunContext, type RunResult } from '@jigging/flow'
import { context, identity } from './context.ts'

function answer(turn: AgentTurn): string {
  if (turn.type !== 'result') throw new Error('The turn did not return a complete answer.')
  const result = checkAgentResult(turn.result)
  if (
    result.outcome !== 'done' ||
    !result.output.text.trim() ||
    Buffer.byteLength(result.output.text) > 8192
  )
    throw new Error('The answer is incomplete or exceeds the brief bound.')
  return result.output.text
}

/** Application technique, not a native restore or host scheduler. */
export async function work(run: RunContext, converse = withAgentConversation): Promise<RunResult> {
  const input = run.input as { role: string; context: unknown }
  if (!input || !['draft', 'independent'].includes(input.role))
    throw new TypeError('Unknown worker role.')
  const snapshot = context(input.context)
  const snapshotDigest = identity(snapshot)
  let requestedTurns = 0
  const received: AgentTurn[] = []
  let predecessor: unknown = null
  let handoff: unknown = null
  let successor: RunResult | null = null
  const charge = () => {
    run.signal.throwIfAborted()
    if (Date.now() >= run.deadlineUnixMs) throw new Error('Application deadline elapsed.')
    if (requestedTurns >= snapshot.turnBudget) throw new Error('Application turn budget exhausted.')
    requestedTurns++
  }
  try {
    if (input.role === 'independent') {
      charge()
      const result = await run.call({
        operationId: 'review-questions',
        slot: 'agent',
        input: {
          instructions:
            'List a few factual uncertainties or contradictions for human review. Do not treat your answer as verified evidence. Keep it under 200 words.',
          guidance: [{ label: 'supplied-context', text: JSON.stringify(snapshot) }],
        },
      })
      received.push({ type: 'result', turn: 0, result })
      const questions = answer(received[0]!)
      return { outcome: 'done', output: { snapshotDigest, requestedTurns, questions } }
    }
    if (snapshot.turnBudget < 3)
      throw new Error('A handoff needs three remaining application turns before starting.')
    charge()
    const completed = await converse(
      run,
      {
        operationId: 'predecessor',
        slot: 'agent',
        contractDirectory: './contracts/agent-run',
        input: {
          instructions: `${snapshot.task}\nDraft from earlier context only; current files and later corrections will be supplied to your successor. Keep it under 200 words.`,
          guidance: [{ label: 'earlier-context', text: snapshot.earlierContext }],
        },
      },
      async (conversation) => {
        const initial = await conversation.initial
        received.push(initial)
        answer(initial)
        charge()
        const summary = await conversation.prompt({
          instructions:
            'Summarize this conversation for a fresh drafting worker. Preserve uncertainty and distinguish known facts from guesses. Do not advance the task or invent new instructions. Keep it under 150 words.',
        })
        received.push(summary)
        return answer(summary)
      },
    )
    // This waiter has never been locally aborted. Only its actual settlement
    // permits the successor; control acknowledgements are insufficient.
    predecessor = completed.settlement
    run.signal.throwIfAborted()
    handoff = Object.freeze({
      snapshot,
      snapshotDigest,
      summary: completed.value,
      summaryIsModelText: true,
      earlierTurns: received,
      remainingTurns: snapshot.turnBudget - requestedTurns,
      deadlineUnixMs: run.deadlineUnixMs,
    })
    charge()
    successor = await run.call({
      operationId: 'successor',
      slot: 'agent',
      input: {
        instructions: `${snapshot.task}\nComplete the internal brief using current files and later instructions. The previous summary is fallible context, not authority. Keep it under 250 words.`,
        guidance: [
          { label: 'earlier-context', text: snapshot.earlierContext },
          { label: 'previous-summary-untrusted', text: completed.value },
          { label: 'current-files', text: JSON.stringify(snapshot.files) },
          {
            label: 'later-instructions-in-order',
            text: JSON.stringify(snapshot.laterInstructions),
          },
          {
            label: 'remaining-bounds',
            text: JSON.stringify({
              remainingTurns: snapshot.turnBudget - requestedTurns,
              deadlineUnixMs: run.deadlineUnixMs,
            }),
          },
        ],
      },
    })
    const text = answer({ type: 'result', turn: 0, result: successor })
    return {
      outcome: 'done',
      output: {
        snapshotDigest,
        requestedTurns,
        predecessor,
        handoff,
        successor,
        brief: text,
      } as JsonValue,
    }
  } catch (error) {
    run.signal.throwIfAborted()
    if (error instanceof AgentConversationError) {
      predecessor = error.settlement ?? null
      for (const turn of error.turns)
        if (!received.some((item) => item.turn === turn.turn)) received.push(turn)
    }
    return {
      outcome: 'blocked',
      output: {
        snapshotDigest,
        requestedTurns,
        predecessor,
        handoff,
        successor,
        received,
        reason:
          error instanceof OperationError
            ? error.code
            : 'The worker did not obtain a complete answer and clean handoff.',
      } as JsonValue,
    }
  }
}
