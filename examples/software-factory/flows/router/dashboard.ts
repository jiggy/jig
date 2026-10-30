import { createHash } from 'node:crypto'
import type { RunResult } from '@jigging/flow'
import { previewCollection, type ViewOptions, type ViewSnapshot } from '@jigging/reporting'
import type { RoutingInput } from './decision.ts'

export function selectionViewOptions(input: RoutingInput): ViewOptions {
  const instanceKey = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  return {
    title: 'Selection',
    landing: true,
    target: { definitionId: 'candidate-selection', instanceKey },
  }
}

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
          previewCollection(
            {
              kind: 'collection',
              id: 'candidates',
              title: 'Eligible candidates',
              columns: [
                { key: 'id', label: 'Candidate', type: 'text' },
                { key: 'description', label: 'Description', type: 'text' },
                { key: 'selected', label: 'Selected', type: 'boolean' },
              ],
              rows: input.candidates.map((candidate) => ({
                id: candidate.id,
                cells: {
                  id: candidate.id,
                  description: candidate.description,
                  selected:
                    result?.outcome === 'done' ? output?.candidateId === candidate.id : null,
                },
                details: [{ kind: 'report', text: candidate.description, format: 'plain' }],
              })),
              total: input.candidates.length,
            },
            { limit: 8 },
          ).collection,
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
