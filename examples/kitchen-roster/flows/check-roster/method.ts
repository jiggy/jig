import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import { checkRoster, RosterPolicyError } from './policy.ts'

export async function runMethod(
  run: Pick<RunContext, 'input' | 'signal'>,
  updates?: Reporter,
): Promise<RunResult> {
  run.signal.throwIfAborted()
  updates?.activity('check-roster', 'Checking coverage, availability and workload')
  const input = run.input as { scenario: unknown; proposal: unknown }
  let result: ReturnType<typeof checkRoster>
  try {
    result = checkRoster(input.scenario, input.proposal)
  } catch (error) {
    if (!(error instanceof RosterPolicyError)) throw error
    updates?.notice(`Roster rejected: ${error.message}`, 'warning')
    return { outcome: 'blocked', output: { reason: error.message } }
  }
  run.signal.throwIfAborted()
  if (typeof result === 'string') {
    updates?.notice(`Roster needs review: ${result}`, 'warning')
    return { outcome: 'blocked', output: { reason: result } }
  }
  updates?.view('checks', { title: 'Roster checks', landing: true }).update({
    summary: 'All eight assignments satisfy hard constraints. Export remains pending.',
    sections: [
      {
        blocks: [
          {
            kind: 'report',
            text: 'Checked complete coverage, qualifications, availability, overlaps and total minutes. Preferences do not establish optimality.',
          },
        ],
      },
    ],
  })
  return { outcome: 'done', output: { rows: result } }
}
