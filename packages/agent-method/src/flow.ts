import { handle, OperationError, type RunContext, type RunResult } from '@jigging/flow'
import { parseApiResult, prepareApiRequest } from './api.js'
import {
  type AgentInput,
  AgentMethodError,
  finishAgent,
  prepareAgent,
  type SkillText,
} from './index.js'
import { ordinaryRecord, snapshot } from './values.js'

export async function agentFlow(run: RunContext): Promise<RunResult> {
  try {
    const input = ordinaryRecord(snapshot(run.input, 'INVALID_INPUT'))
    if (input && Object.hasOwn(input, 'session'))
      throw new OperationError(
        'UNAVAILABLE',
        'This HTTP Agent cannot retain or restore native sessions',
      )
    if (input?.conversation === true)
      throw new OperationError(
        'UNAVAILABLE',
        'This Agent supports one-shot calls, not continuing conversations',
      )
    if (
      input === undefined ||
      Object.keys(input).some(
        (name) => !['instructions', 'guidance', 'responseSchema', 'skills'].includes(name),
      )
    ) {
      throw new AgentMethodError(
        'INVALID_INPUT',
        'Supply instructions and optional explicit guidance, skills or responseSchema',
      )
    }
    if (Object.keys(run.attachments).length > 0 || Object.keys(run.channels).length > 0) {
      throw new OperationError(
        'UNAVAILABLE',
        'This text-only Agent method accepts no attachments or channels',
      )
    }
    const { skills, ...methodInput } = input
    const prepared = prepareAgent(
      methodInput as unknown as AgentInput,
      (skills === undefined ? [] : skills) as unknown as readonly SkillText[],
    )
    const { api, body } = prepareApiRequest(prepared, run.settings)
    const result = await run.call(
      {
        operationId: 'completion',
        slot: 'http',
        input: { body, response: 'json' },
      },
      { signal: run.signal },
    )
    const resultValue = finishAgent(prepared, parseApiResult(result, api))
    return { outcome: resultValue.outcome, output: { ...resultValue.output } }
  } catch (error) {
    if (error instanceof AgentMethodError) throw new OperationError(error.code, error.message)
    throw error
  }
}

export async function runAgentFlow(): Promise<void> {
  await handle(agentFlow)
}
