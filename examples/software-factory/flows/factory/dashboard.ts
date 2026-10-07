import type { JsonValue } from '@jigging/flow'
import type { Collection, ViewSnapshot } from '@jigging/user-updates'
import type { RepairInput } from 'factory-repair-flow/policy'
import { jobLabel, repairActivity } from './presentation.ts'

export type DashboardJob = { id: string; label?: string; directory: string; method?: string }
export type FactoryStage = { phase: string; attempt: number; maximum: number; detail?: string }
export type PreparedJob = { job: DashboardJob; input: RepairInput }
function clip(text: string, max = 512): string {
  const scalars = [...text]
  return scalars.length <= max
    ? text
    : scalars.slice(0, max - 48).join('') + ' [clipped; full evidence in result.json]'
}
const object = (value: JsonValue | undefined): Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}

/** Ordinary author-side projection: Jig knows nothing about repair policy. */
export function jobsView(
  prepared: readonly PreparedJob[],
  stages: ReadonlyMap<string, FactoryStage>,
  outcomes: Readonly<Record<string, JsonValue>>,
  saved: ReadonlySet<string>,
): ViewSnapshot {
  const settled = Object.keys(outcomes).length,
    ready = Object.values(outcomes).filter((v) => object(v).ready === true).length
  const board: Collection = {
    kind: 'collection',
    id: 'jobs',
    title: 'Requested repairs',
    columns: [
      { key: 'job', label: 'Job', type: 'text' },
      { key: 'action', label: 'Current action', type: 'text' },
      { key: 'call', label: 'Execution', type: 'reference' },
    ],
    rows: prepared.map(({ job, input }) => {
      const stage = stages.get(job.id),
        outcome = object(outcomes[job.id])
      const action = outcome.status
        ? outcome.ready
          ? 'Checked patch ready for human review'
          : (outcome.message ?? 'No independently verified patch')
        : stage
          ? repairActivity(job, stage.phase, stage.attempt, stage.maximum, stage.detail).slice(
              jobLabel(job).length + 2,
            )
          : 'Preparing captured inputs'
      const operationId = stage?.phase === 'selecting' ? `route:${job.id}` : `repair:${job.id}`
      return {
        id: job.id,
        cells: { job: jobLabel(job), action: clip(action), call: { kind: 'call', operationId } },
        details: [
          { kind: 'report', text: clip(`Goal: ${input.issue}`) },
          {
            kind: 'facts',
            items: [
              { label: 'Source', value: job.directory },
              { label: 'Editable files', value: clip(input.editPaths.join(', ')) },
              {
                label: 'Approach',
                value:
                  job.method === 'p1'
                    ? 'One proposal'
                    : job.method === 'p2'
                      ? 'One proposal and one correction'
                      : 'Reviewed approach selection',
              },
              {
                label: 'Evidence',
                value: saved.has(job.id) ? 'Checkpoint acknowledged' : 'Final evidence pending',
              },
            ],
          },
          ...(stage?.detail ? [{ kind: 'report' as const, text: clip(stage.detail, 1024) }] : []),
          ...(outcome.message
            ? [{ kind: 'report' as const, text: clip(`Reported cause: ${outcome.message}`) }]
            : []),
        ],
      }
    }),
    total: prepared.length,
  }
  return {
    summary: `${settled} of ${prepared.length} repairs settled; ${ready} independently checked patches. Each patch is checked separately. Review patches before applying them.`,
    sections: [
      {
        blocks: [
          {
            kind: 'progress',
            label: 'Settled repairs',
            completed: settled,
            total: prepared.length,
            unit: 'jobs',
          },
          board,
        ],
      },
    ],
  }
}
export function checksView(
  prepared: readonly PreparedJob[],
  reports: ReadonlyMap<string, string>,
  outcomes: Readonly<Record<string, JsonValue>>,
): ViewSnapshot {
  const rows = prepared.map(({ job, input }) => {
    const outcome = object(outcomes[job.id]),
      verified = outcome.verification
    return {
      id: job.id,
      cells: {
        job: jobLabel(job),
        repository: verified
          ? 'Passed; independently verified'
          : outcome.status === 'failed'
            ? 'Ended; verification unavailable'
            : outcome.status
              ? 'Settled; no checked patch'
              : 'Pending independent verification',
        cases: verified
          ? `${verified.acceptanceCases.length} / ${input.cases.length} passed`
          : outcome.status
            ? 'No accepted patch; inspect retained check evidence'
            : `${input.cases.length} supplied cases`,
      },
      details: [
        {
          kind: 'report' as const,
          text: clip(`Acceptance cases: ${input.cases.map((c) => c.id).join(', ')}`),
        },
        {
          kind: 'report' as const,
          text: clip(
            reports.get(job.id) ??
              'No worker check report received. Optional live reports are provisional; final acceptance uses returned evidence.',
            2048,
          ),
        },
      ],
    }
  })
  return {
    summary:
      'Repository tests and independent CLI cases check the requested behavior. Worker reports are provisional until the factory verifies returned evidence.',
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'checks',
            title: 'Repair checks',
            columns: [
              { key: 'job', label: 'Job', type: 'text' },
              { key: 'repository', label: 'Repository tests', type: 'text' },
              { key: 'cases', label: 'Acceptance cases', type: 'text' },
            ],
            rows,
            total: rows.length,
          },
        ],
      },
    ],
  }
}
export function patchesView(
  prepared: readonly PreparedJob[],
  outcomes: Readonly<Record<string, JsonValue>>,
  conflicting = false,
): ViewSnapshot {
  const rows = prepared
    .filter(({ job }) => object(outcomes[job.id]).ready === true)
    .map(({ job }) => {
      const outcome = object(outcomes[job.id])
      return {
        id: job.id,
        cells: {
          job: jobLabel(job),
          files: clip(outcome.verification.changedPaths.join(', ')),
          patch: {
            kind: 'artifact' as const,
            attachment: 'deliverables',
            path: `${job.id}/review.patch`,
          },
        },
        details: [
          {
            kind: 'report' as const,
            text: `Proposal ${outcome.verification.proposal} passed the repository command and independent cases. Original sources have not been changed. File preview becomes available only after Jig verifies packet delivery.`,
          },
          {
            kind: 'report' as const,
            text: conflicting
              ? 'Patches overlap with conflicting replacements. Resolve the overlap before applying either patch.'
              : 'Review this patch before applying it. Separate checks do not prove that combined patches work together.',
          },
        ],
      }
    })
  return {
    summary: conflicting
      ? 'The proposed patches conflict. Resolve the overlap before applying either patch.'
      : `${rows.length} checked ${rows.length === 1 ? 'patch' : 'patches'} available for human review. Changes have not been applied.`,
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'patches',
            title: 'Checked patch packets',
            columns: [
              { key: 'job', label: 'Job', type: 'text' },
              { key: 'files', label: 'Changed files', type: 'text' },
              { key: 'patch', label: 'Review patch', type: 'reference' },
            ],
            rows,
            total: rows.length,
          },
          {
            kind: 'report',
            text: 'Full final evidence: result.json. Saved job summaries: files/summary.txt.',
            references: [{ kind: 'artifact', attachment: 'deliverables', path: 'summary.txt' }],
          },
        ],
      },
    ],
  }
}
