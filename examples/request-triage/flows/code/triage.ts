import type { RunContext, RunResult } from '@jigging/flow'

export async function triage(run: Pick<RunContext, 'input'>): Promise<RunResult> {
  // FLOW.contract.json input is checked by the host before this method starts.
  const { message } = run.input as { message: string }
  return { outcome: 'done', output: { queue: explicitQueue(message) ?? 'manual' } }
}

function explicitQueue(message: string): 'billing' | 'technical' | undefined {
  const label = message.trim().toLowerCase()
  if (label.startsWith('[billing]')) return 'billing'
  if (label.startsWith('[technical]')) return 'technical'
}
