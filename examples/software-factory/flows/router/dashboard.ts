import type { RunResult } from '@jigging/flow'
import type { ViewSnapshot } from '@jigging/user-updates'
import type { RoutingInput } from './decision.ts'

function excerpt(text: string, limit: number): string {
  const chars = [...text]
  return (
    chars.slice(0, limit).join('') +
    (chars.length > limit
      ? '\n[Excerpt; complete value remains in the supplied input or final result.]'
      : '')
  )
}
export function selectionView(input: RoutingInput, result?: RunResult): ViewSnapshot {
  const output = result?.output as { candidateId?: string | null; reason?: string } | undefined
  return {
    summary: !result
      ? 'Judge applicability among the supplied eligible candidates. Selection does not execute a candidate or grant authority.'
      : result.outcome !== 'done'
        ? `Selection ${result.outcome}; no candidate has been dispatched.`
        : output?.candidateId === null
          ? 'No applicable candidate was selected. No fallback or dispatch was requested.'
          : `Proposed candidate: ${output?.candidateId}. The caller still validates membership and decides whether to dispatch.`,
    sections: [
      {
        blocks: [
          { kind: 'report', text: excerpt(input.task, 512) },
          {
            kind: 'collection',
            id: 'candidates',
            title: 'Eligible candidates (first 8)',
            columns: [
              { key: 'id', label: 'Candidate', type: 'text' },
              { key: 'description', label: 'Description excerpt', type: 'text' },
              { key: 'selected', label: 'Selected', type: 'boolean' },
            ],
            rows: input.candidates.slice(0, 8).map((candidate) => ({
              id: candidate.id,
              cells: {
                id: candidate.id,
                description: excerpt(candidate.description, 80),
                selected: result?.outcome === 'done' ? output?.candidateId === candidate.id : null,
              },
              details: [{ kind: 'report', text: excerpt(candidate.description, 192) }],
            })),
            total: input.candidates.length,
          },
          {
            kind: 'report',
            text: output?.reason
              ? `Reported reason: ${excerpt(output.reason, 512)}`
              : 'An empty eligible set abstains without an Agent call. Otherwise one Agent judges applicability; a sole candidate is not selected automatically.',
          },
        ],
      },
    ],
  }
}
