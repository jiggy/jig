import type { JsonValue, RunContext, RunResult } from '@jigging/flow'
import responseSchema from './proposal.schema.json'

export async function draft(run: Pick<RunContext, 'input' | 'callEffect'>): Promise<RunResult> {
  const result = await run.callEffect({
    operationId: 'draft-proposal',
    slot: 'agent',
    method: 'run',
    input: {
      instructions:
        'Draft or revise the proposal described in the following JSON data. Follow the grounded-drafting Skill. Return the requested structured proposal.\n\n' +
        JSON.stringify(run.input),
      skills: ['grounded-drafting'],
      responseSchema,
    },
  })
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('The Agent returned an invalid result.')
  }
  const agent = result as Record<string, JsonValue>
  if (agent.outcome === 'blocked' || agent.outcome === 'limit') {
    if (typeof agent.text !== 'string') throw new TypeError('The Agent omitted its reason.')
    return { outcome: agent.outcome, output: { reason: agent.text } }
  }
  if (agent.outcome !== 'completed' || agent.structured === undefined) {
    throw new TypeError('The Agent omitted a completed structured proposal.')
  }
  return { outcome: 'done', output: agent.structured }
}
