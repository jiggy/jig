import { handle, type JsonValue } from '@jigging/flow'
import { withAgentConversation, AgentConversationError } from '../src/conversation.js'

await handle(async (run) => {
  const displayed: string[] = []
  try {
    const result = await withAgentConversation(
      run,
      {
        operationId: 'dialogue',
        slot: 'agent',
        ...(String(run.input).startsWith('observer')
          ? {
              onEvent(event: import('../src/conversation.js').AgentUpdate) {
                if (run.input === 'observer-throws') throw new Error('display failed')
                if (run.input === 'observer-async')
                  return Promise.reject(new Error('async display failed'))
                if (event.sessionUpdate === 'agent_message_chunk')
                  displayed.push(event.content.text)
              },
            }
          : {}),
        input: {
          instructions: 'Draft from these facts',
          ...(['retained', 'missing-session', 'invalid-session'].includes(run.input as string)
            ? { session: { retain: true as const } }
            : {}),
        },
      },
      async (conversation) => {
        if (run.input === 'abandoned') return null
        const first = await conversation.initial
        if (run.input === 'callback-error') throw new Error('application rejected draft')
        const second = conversation.prompt({ instructions: 'Apply this correction' })
        if (run.input === 'interrupt' || run.input === 'completion-race')
          await conversation.interrupt()
        return { first, second: await second }
      },
    )
    return {
      outcome: 'done',
      output: {
        ...result,
        displayed,
        ...(result.observation?.status === 'incomplete'
          ? {
              observation: {
                status: 'incomplete',
                errors: result.observation.errors.map((e) =>
                  e instanceof Error ? e.message : String(e),
                ),
              },
            }
          : {}),
      } as unknown as JsonValue,
    }
  } catch (error) {
    if (!(error instanceof AgentConversationError)) throw error
    return {
      outcome: 'done',
      output: {
        errors: Array.from(error.errors, (value) =>
          value instanceof Error ? value.message : String(value),
        ),
        turns: error.turns as unknown as JsonValue,
        settlement: (error.settlement as unknown as JsonValue) ?? null,
      },
    }
  }
})
