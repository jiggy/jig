import { handle, OperationError, type RunContext, type RunResult } from '@jigging/flow'

import { type AgentInput, AgentMethodError, finishAgent, prepareAgent } from './index.js'
import { readPackageSkills } from './skills.js'
import { ordinaryRecord, snapshot } from './values.js'

export async function agentFlow(run: RunContext, packageRoot: URL): Promise<RunResult> {
  try {
    const input = ordinaryRecord(snapshot(run.input, 'INVALID_INPUT'))
    if (
      input === undefined ||
      Object.keys(input).some(
        (name) => !['instructions', 'guidance', 'responseSchema', 'methodSkills'].includes(name),
      )
    ) {
      throw new AgentMethodError('INVALID_INPUT', 'Supply Agent input with optional methodSkills')
    }
    if (
      Object.keys(run.settings).length > 0 ||
      Object.keys(run.attachments).length > 0 ||
      Object.keys(run.channels).some((name) => name !== 'events')
    ) {
      throw new AgentMethodError(
        'INVALID_INPUT',
        'This Agent method accepts only its declared input and optional events endpoint',
      )
    }
    const selected = await readPackageSkills(
      packageRoot,
      (Object.hasOwn(input, 'methodSkills') ? input.methodSkills : []) as readonly string[],
    )
    const { methodSkills: _selection, ...methodInput } = input
    const prepared = prepareAgent(methodInput as unknown as AgentInput, selected)
    const events = run.channels.events
    const result = await run.call(
      {
        operationId: 'exchange',
        slot: 'exchange',
        input: { ...prepared.request },
        ...(events === undefined ? {} : { channels: { events } }),
      },
      { signal: run.signal },
    )
    const resultValue = finishAgent(prepared, result)
    return { outcome: resultValue.outcome, output: { ...resultValue.output } }
  } catch (error) {
    if (error instanceof AgentMethodError) throw new OperationError(error.code, error.message)
    throw error
  }
}

export async function runAgentFlow(packageRoot: URL): Promise<void> {
  await handle((run) => agentFlow(run, packageRoot))
}
