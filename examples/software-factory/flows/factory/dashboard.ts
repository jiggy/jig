import type { JsonValue } from '@jigging/flow'
import type { Collection, DetailBlock, Report, ViewSnapshot } from '@jigging/user-updates'
import type { RepairInput } from 'factory-repair-flow/policy'
import { jobLabel } from './presentation.ts'

export type DashboardJob = { id: string; label?: string; directory: string; method?: string }
export type FactoryStage = { phase: string; attempt: number; maximum: number; detail?: string }
export type PreparedJob = { job: DashboardJob; input: RepairInput }
// Budget the encoded text, including controls, rather than only its length.
// Two rows with all optional details must still fit one 32 KiB update.
function clip(
  text: string,
  max = 512,
  bytes = 1024,
  marker = ' [excerpt; full evidence in result.json]',
): string {
  if ([...text].length <= max && Buffer.byteLength(JSON.stringify(text)) <= bytes) return text
  let prefix = ''
  const reservedScalars = [...marker].length
  const reservedBytes = Buffer.byteLength(JSON.stringify(marker)) - 2
  let used = 2
  let count = 0
  for (const scalar of text) {
    const size = Buffer.byteLength(JSON.stringify(scalar)) - 2
    if (count + reservedScalars >= max || used + size + reservedBytes > bytes) break
    prefix += scalar
    used += size
    count++
  }
  return prefix + marker
}
const object = (value: JsonValue | undefined): Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}

function goalReport(job: DashboardJob, input: RepairInput): Report {
  return {
    kind: 'report',
    text: clip(
      `Requested goal: ${input.issue}`,
      4096,
      4096,
      ` [excerpt; complete goal in supplied job input and files/${job.id}/goal.txt after packet delivery]`,
    ),
    references: [{ kind: 'artifact', attachment: 'deliverables', path: `${job.id}/goal.txt` }],
  }
}

function verificationDetails(outcome: {
  verification?: { proposal: number; changedPaths: string[]; acceptanceCases: string[] }
}): DetailBlock[] {
  if (!outcome.verification) return []
  const verified = outcome.verification
  return [
    {
      kind: 'facts',
      items: [
        { label: 'Checked proposal', value: verified.proposal },
        { label: 'Repository tests', value: 'Passed; independently verified' },
        {
          label: 'Acceptance cases',
          value: `${verified.acceptanceCases.length} passed; independently verified`,
        },
        {
          label: 'Changed files',
          value: clip(
            verified.changedPaths.join(', ') || 'None',
            4096,
            3072,
            ' [excerpt; complete paths in retained job evidence]',
          ),
        },
      ],
    },
  ]
}

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
    title: 'Repairs',
    columns: [
      { key: 'job', label: 'Job', type: 'text' },
      { key: 'action', label: 'Outcome', type: 'text' },
      { key: 'checks', label: 'Checks', type: 'text' },
      { key: 'patch', label: 'Review patch', type: 'reference' },
    ],
    rows: prepared.map(({ job, input }) => {
      const stage = stages.get(job.id),
        outcome = object(outcomes[job.id])
      const action = outcome.status
        ? outcome.ready
          ? 'Ready for review'
          : outcome.status === 'unrouted'
            ? 'No repair started'
            : outcome.status === 'failed'
              ? outcome.code === 'UNCERTAIN'
                ? 'Settlement unknown'
                : 'Repair failed'
              : 'No checked patch'
        : 'In progress'
      const operationId = stage?.phase === 'selecting' ? `route:${job.id}` : `repair:${job.id}`
      return {
        id: job.id,
        cells: {
          job: jobLabel(job),
          action,
          checks: outcome.verification
            ? `Tests + ${outcome.verification.acceptanceCases.length}/${input.cases.length} cases passed`
            : outcome.status
              ? 'No accepted patch'
              : 'Verification pending',
          patch: outcome.ready
            ? { kind: 'artifact', attachment: 'deliverables', path: `${job.id}/review.patch` }
            : null,
        },
        details: [
          goalReport(job, input),
          {
            kind: 'facts',
            items: [
              { label: 'Source', value: job.directory },
              {
                label: 'Editable files',
                value: clip(
                  input.editPaths.join(', '),
                  4096,
                  3072,
                  ' [excerpt; complete paths in supplied job input and retained job evidence]',
                ),
              },
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
                label: 'Saved evidence',
                value: saved.has(job.id) ? 'Checkpoint confirmed' : 'Checkpoint not confirmed',
              },
            ],
          },
          ...verificationDetails(outcome),
          ...(!outcome.verification
            ? [
                {
                  kind: 'report' as const,
                  text: clip(
                    `Required checks: repository tests plus ${input.cases.length} independent CLI cases: ${input.cases.map((c) => c.id).join(', ')}.`,
                    1024,
                    1536,
                  ),
                },
              ]
            : []),
          ...(!outcome.status && stage?.detail
            ? [{ kind: 'report' as const, text: clip(stage.detail, 1024, 2048) }]
            : []),
          ...(!outcome.ready && outcome.message
            ? [{ kind: 'report' as const, text: clip(`Reported cause: ${outcome.message}`) }]
            : []),
          {
            kind: 'report',
            text: outcome.ready
              ? 'Review the patch before applying it. Original sources are unchanged. Each patch was checked separately; combined changes need their own checks. Patch preview is available after verified packet delivery.'
              : outcome.status
                ? 'No independently checked patch is available for this repair. Inspect its call and retained evidence for the observed cause.'
                : 'Follow Activity for current work. This repair has not produced an independently checked patch yet.',
            references: [{ kind: 'call', operationId }],
          },
        ],
      }
    }),
    total: prepared.length,
  }
  return {
    summary:
      settled === prepared.length
        ? ready === 0
          ? 'No checked patches. Inspect each repair for its cause; original sources are unchanged.'
          : `${ready} independently checked ${ready === 1 ? 'patch' : 'patches'} ready for review.${ready < prepared.length ? ` ${prepared.length - ready} repair has no checked patch.` : ''} Original sources are unchanged.`
        : `${prepared.length} requested repairs; ${settled} finished, ${ready} checked patches. Inspect a repair for its goal and scope; follow Activity for current work.`,
    sections: [
      {
        blocks: [
          {
            kind: 'progress',
            label: 'Repairs finished',
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
          ? 'Verified pass'
          : outcome.status === 'failed'
            ? 'Unavailable'
            : outcome.status
              ? 'No checked patch'
              : 'Verification pending',
        cases: verified
          ? `${verified.acceptanceCases.length}/${input.cases.length} verified`
          : outcome.status
            ? 'No accepted patch'
            : `${input.cases.length} supplied cases`,
      },
      details: [
        ...verificationDetails(outcome),
        {
          kind: 'report' as const,
          text: clip(`Acceptance cases: ${input.cases.map((c) => c.id).join(', ')}`),
        },
        {
          kind: 'report' as const,
          text: clip(
            reports.has(job.id)
              ? `Worker-reported checks (provisional; independent acceptance is shown separately):\n${reports.get(job.id)}`
              : 'No worker check report received. Optional live reports are provisional; final acceptance uses returned evidence.',
            4096,
            8192,
          ),
        },
      ],
    }
  })
  return {
    summary:
      Object.keys(outcomes).length === prepared.length
        ? 'Finished checks: verified results are shown separately from provisional worker reports. Each patch is checked separately.'
        : 'Repository tests and independent CLI cases check each proposed patch. Worker reports remain provisional until independently verified.',
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
    .map(({ job, input }) => {
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
          goalReport(job, input),
          ...verificationDetails(outcome),
          {
            kind: 'report' as const,
            text: conflicting
              ? 'Patches overlap with conflicting replacements. Resolve the overlap before applying either patch.'
              : 'Review this patch before applying it. Original sources are unchanged. Each patch was checked separately; combined changes need their own checks. Preview requires verified packet delivery.',
          },
        ],
      }
    })
  return {
    summary: conflicting
      ? 'The proposed patches conflict. Resolve the overlap before applying either patch.'
      : `${rows.length} independently checked ${rows.length === 1 ? 'candidate' : 'candidates'} for human review. Changes have not been applied. Preview requires verified packet delivery.`,
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
            text: 'Detailed job evidence is retained in the final result. The summary file is available only if Jig confirms its delivery.',
            references: [{ kind: 'artifact', attachment: 'deliverables', path: 'summary.txt' }],
          },
        ],
      },
    ],
  }
}
