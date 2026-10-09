import type { JsonValue } from '@jigging/flow'
import type { ViewSnapshot } from '@jigging/user-updates'

export type Branch =
  | {
      role: string
      result: { outcome: string; output?: JsonValue }
      failure?: never
      message?: never
    }
  | { role: string; result?: never; failure: string; message: string }
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function excerpt(value: unknown, limit = 2048): string {
  const chars = [...(typeof value === 'string' ? value : '')]
  return (
    chars.slice(0, limit).join('') +
    (chars.length > limit ? '\n[Excerpt; complete text remains in the final result.]' : '')
  )
}
export function workView(
  input: Record<string, unknown>,
  branches: readonly Branch[] = [],
): ViewSnapshot {
  return {
    summary:
      'Draft an internal incident brief and prepare independent review questions. These are model suggestions for human review, not verified incident facts.',
    sections: [
      {
        title: 'Requested work',
        blocks: [
          {
            kind: 'report',
            text: excerpt(input.task, 512) || 'The workers validate the supplied task and context.',
          },
          {
            kind: 'facts',
            items: [
              {
                label: 'Supplied files',
                value: Array.isArray(input.files) ? input.files.length : null,
              },
              { label: 'Replacement supplied', value: input.replacement !== undefined },
              { label: 'Publication permission', value: 'None; a person reviews the output.' },
            ],
          },
          {
            kind: 'collection',
            id: 'workers',
            title: 'Independent branches',
            columns: [
              { key: 'work', label: 'Work', type: 'text' },
              { key: 'state', label: 'Reported outcome', type: 'text' },
              { key: 'call', label: 'Execution', type: 'reference' },
            ],
            rows: ['draft', 'independent'].map((role) => {
              const branch = branches.find((item) => item.role === role)
              return {
                id: role,
                cells: {
                  work: role === 'draft' ? 'Internal brief' : 'Independent review questions',
                  state: branch?.result?.outcome ?? branch?.failure ?? 'No settled result yet',
                  call: branch ? { kind: 'call' as const, operationId: role } : null,
                },
                details: [
                  {
                    kind: 'report',
                    text: branch?.failure
                      ? `${branch.failure}: ${excerpt(branch.message, 512)}`
                      : role === 'draft'
                        ? 'A supplied context replacement can require one summary handoff. A successor starts only after the predecessor actually settles.'
                        : 'Preliminary notes inform drafting while this branch continues to prepare questions. Notes are unverified model text.',
                  },
                ],
              }
            }),
            total: 2,
          },
        ],
      },
    ],
  }
}
export function answerView(branch: Branch | undefined, draft: boolean): ViewSnapshot {
  const output = object(branch?.result?.output)
  const text = excerpt(draft ? output.brief : output.questions)
  const causes = Array.isArray(output.failureDetails)
    ? output.failureDetails
        .slice(0, 4)
        .map((item) => {
          const record = object(item)
          return `${excerpt(record.code, 64)}: ${excerpt(record.message, 256)}`
        })
        .join('\n')
    : ''
  return {
    summary: !branch
      ? `${draft ? 'Draft' : 'Review questions'} not yet returned. The other branch advances independently.`
      : branch.failure || branch.result?.outcome !== 'done'
        ? 'This branch did not complete. Any retained suggestions remain provisional; inspect the reported cause.'
        : 'Internal suggestions returned for a person to inspect. They are not verified facts or permission to publish.',
    sections: [
      {
        blocks: [
          { kind: 'report', text: text || 'No complete suggestion is available.' },
          {
            kind: 'facts',
            items: [
              {
                label: 'Requested model turns',
                value: typeof output.requestedTurns === 'number' ? output.requestedTurns : null,
              },
              {
                label: 'Accepted context revision',
                value: draft && typeof output.revision === 'number' ? output.revision : null,
              },
              { label: 'Summary handoff recorded', value: output.handoff != null },
            ],
          },
          {
            kind: 'report',
            text:
              causes ||
              (branch?.failure
                ? `${branch.failure}: ${excerpt(branch.message, 512)}`
                : 'Full context, earlier received answers and actual settlement records remain separate in the final result.'),
          },
        ],
      },
    ],
  }
}
