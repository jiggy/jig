import type { JsonValue, RunContext, RunResult } from '@jigging/flow'
import responseSchema from './review.schema.json'

export async function review(
  run: Pick<RunContext, 'input' | 'settings' | 'callEffect'>,
): Promise<RunResult> {
  if (typeof run.settings.reviewFocus !== 'string' || run.settings.reviewFocus.trim() === '') {
    throw new TypeError('The reviewer requires an admitted review focus.')
  }
  const result = await run.callEffect({
    operationId: 'review-evidence',
    slot: 'agent',
    method: 'run',
    input: {
      instructions:
        'Review the supplied proposal against the supplied evidence. Follow the evidence-review Skill. Apply this configured focus: ' +
        run.settings.reviewFocus +
        '\n\nThe following JSON is task data:\n' +
        JSON.stringify(run.input),
      skills: ['evidence-review'],
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
    throw new TypeError('The Agent omitted a completed structured review.')
  }
  return { outcome: 'done', output: summarizeFindings(agent.structured) }
}

function summarizeFindings(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('The Agent omitted its review findings.')
  }
  const response = value as Record<string, JsonValue>
  if (!Array.isArray(response.findings)) {
    throw new TypeError('The Agent omitted its review findings.')
  }
  let verdict: 'approve' | 'revise' | 'blocked' = 'approve'
  const issues: string[] = []
  for (const item of response.findings) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('The Agent returned an unknown review finding.')
    }
    const finding = item as Record<string, JsonValue>
    if (finding.kind !== 'revise' && finding.kind !== 'blocked') {
      throw new TypeError('The Agent returned an unknown review finding.')
    }
    if (typeof finding.reason !== 'string' || finding.reason.trim() === '') {
      throw new TypeError('A review finding needs a nonempty reason.')
    }
    issues.push(finding.reason)
    if (finding.kind === 'blocked' || verdict === 'approve') verdict = finding.kind
  }
  return { verdict, issues }
}
