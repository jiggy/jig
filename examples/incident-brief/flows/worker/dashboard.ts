import type { RunResult } from '@jigging/flow'
import type { ViewSnapshot } from '@jigging/user-updates'
import type { Context } from './context.ts'

export function workerView(context: Context, role: string, result?: RunResult): ViewSnapshot {
  const output = result?.output as
    | {
        brief?: string
        questions?: string
        requestedTurns?: number
        revision?: number
        handoff?: unknown
        failureDetails?: { code: string; message: string }[]
      }
    | undefined
  const text = output?.brief ?? output?.questions ?? ''
  const chars = [...text]
  return {
    summary: !result
      ? role === 'draft'
        ? 'Draft using supplied context. Commentary stays in this conversation; a replacement can trigger one settled summary handoff.'
        : 'Identify uncertainties and prepare independent review questions. Preliminary notes do not verify incident facts.'
      : result.outcome === 'done'
        ? 'Internal suggestions returned for human review; no publication has been authorized.'
        : 'Worker did not complete; inspect the retained failures and any provisional answers.',
    sections: [
      {
        blocks: [
          {
            kind: 'report',
            text:
              [...context.task].slice(0, 512).join('') +
              ([...context.task].length > 512
                ? '\n[Task excerpt; complete request remains in supplied context.]'
                : ''),
          },
          {
            kind: 'facts',
            items: [
              { label: 'Role', value: role === 'draft' ? 'Drafting' : 'Independent reviewer' },
              { label: 'Supplied files', value: context.files.length },
              { label: 'Turn budget', value: context.turnBudget },
              { label: 'Requested turns', value: output?.requestedTurns ?? null },
              { label: 'Revision reported', value: output?.revision ?? null },
              { label: 'Summary handoff recorded', value: output?.handoff != null },
            ],
          },
          {
            kind: 'report',
            text: text
              ? chars.slice(0, 2048).join('') +
                (chars.length > 2048 ? '\n[Excerpt; complete answer in the result.]' : '')
              : 'No complete suggestion is available yet.',
          },
          {
            kind: 'report',
            text:
              (output?.failureDetails ?? [])
                .slice(0, 4)
                .map((entry) => `${entry.code}: ${[...entry.message].slice(0, 256).join('')}`)
                .join('\n') ||
              'Earlier answers, supplied revisions and settlement evidence remain distinct in the final result; model notes are not verified facts.',
          },
        ],
      },
    ],
  }
}
