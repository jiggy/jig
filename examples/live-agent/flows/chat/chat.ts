import { OperationError, type JsonValue, type RunContext, type RunResult } from '@jigging/flow'

export async function chat(run: RunContext): Promise<RunResult> {
  const input = parseInput(run.input)
  const events = await run.channel({ contract: './contracts/acp-public-updates.json' })
  const output = run.channels.progress
  if (output && output.direction !== 'send') throw new TypeError('progress must be a send channel')
  const progress = { complete: true, suppressed: input.suppress, displayed: 0 }

  const work = (async () => {
    try {
      return await run.callCapability({
        operationId: 'answer',
        slot: 'agent',
        method: 'run',
        input: { instructions: input.instructions },
        channels: { events: events.send },
      })
    } catch (error) {
      // Rejected admission may leave no producer. Dispose our retained reader
      // instead of waiting forever; preserve the execution error independently.
      try {
        await events.receive.close()
      } catch {
        progress.complete = false
      }
      throw error
    }
  })()

  const observation = (async () => {
    let destinationAvailable = true
    try {
      for await (const value of events.receive) {
        const text = publicText(value)
        if (text === undefined || input.suppress || !destinationAvailable) continue
        try {
          if (output) await output.send(text)
          else console.log(text)
          progress.displayed += 1
        } catch (error) {
          if (!deliveryFailure(error)) throw error
          progress.complete = false
          destinationAvailable = false
        }
      }
    } catch (error) {
      if (!deliveryFailure(error) && !(error instanceof TypeError)) throw error
      progress.complete = false
    }
  })()

  const [execution, observed] = await Promise.allSettled([work, observation])
  if (execution.status === 'rejected') throw execution.reason
  if (observed.status === 'rejected') throw observed.reason
  const result = execution.value
  if (
    result === null ||
    Array.isArray(result) ||
    typeof result !== 'object' ||
    typeof result.outcome !== 'string' ||
    !['completed', 'blocked', 'limit'].includes(result.outcome) ||
    typeof result.text !== 'string'
  ) {
    throw new TypeError('Agent returned an invalid result')
  }
  return {
    outcome: result.outcome === 'completed' ? 'done' : result.outcome,
    output: { result, progress },
  }
}

function deliveryFailure(error: unknown): boolean {
  return (
    error instanceof OperationError &&
    ['LAGGED', 'DISCONNECTED', 'RESOURCE_EXHAUSTED', 'INVALID_INPUT', 'INVALID_RESULT'].includes(
      error.code,
    )
  )
}

function publicText(value: JsonValue): string | undefined {
  if (value !== null && !Array.isArray(value) && typeof value === 'object') {
    if (value.sessionUpdate === 'plan') return undefined
    const content = value.content
    if (
      value.sessionUpdate === 'agent_message_chunk' &&
      content !== null &&
      !Array.isArray(content) &&
      typeof content === 'object' &&
      content?.type === 'text' &&
      typeof content.text === 'string'
    )
      return content.text
  }
  throw new TypeError('Agent progress did not match its public-update contract')
}

function parseInput(value: JsonValue): { instructions: string; suppress: boolean } {
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    typeof value.instructions !== 'string' ||
    value.instructions.length === 0 ||
    Array.from(value.instructions).length > 16384 ||
    (value.suppress !== undefined && typeof value.suppress !== 'boolean') ||
    Object.keys(value).some((key) => key !== 'instructions' && key !== 'suppress')
  ) {
    throw new TypeError('Supply instructions and optional suppress: true or false')
  }
  return { instructions: value.instructions, suppress: value.suppress === true }
}
