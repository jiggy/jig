import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import { checkRepair } from './evidence.ts'
import type { CapturedProject } from './types.ts'

export async function checkRepairEvidence(
  run: Pick<RunContext, 'input' | 'signal'>,
  reporter?: Reporter,
): Promise<RunResult> {
  run.signal.throwIfAborted()
  const { captured, result } = run.input as unknown as {
    captured: CapturedProject
    result: RunResult
  }
  const checked = checkRepair(captured, result)
  reporter?.view('checks', { title: 'Repair acceptance', landing: true }).update({
    summary:
      'Command identities and all verdicts were recomputed against captured source and fixed expectations.',
    sections: [
      {
        blocks: [
          {
            kind: 'facts',
            items: [
              { label: 'Review-ready patch', value: checked.ready },
              { label: 'Checked proposals', value: checked.proposals.length },
            ],
          },
          { kind: 'report', text: [...checked.reason].slice(0, 1000).join('') },
        ],
      },
    ],
  })
  return { outcome: 'done', output: checked }
}
