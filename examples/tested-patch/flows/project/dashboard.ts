import { createHash } from 'node:crypto'
import type { Collection, Section, ViewOptions, ViewSnapshot } from '@jigging/reporting'

export type CapturedProject = {
  issue: string
  editPaths: string[]
  files: Record<string, string>
  cases: { id: string }[]
}
type Check = {
  repositoryTestsPassed: boolean
  accepted: boolean
  acceptance: { id: string; passed: boolean }[]
}
export type CheckedRepair = {
  ready: boolean
  reason: string
  baseline: Check
  attempts: { evaluation?: Check; invalidProposal?: string }[]
  proposals: { number: number; replacements: { path: string; content: string }[] }[]
}
export type PatchState = {
  phase: 'reading' | 'repairing' | 'checking' | 'exporting' | 'ready' | 'failed' | 'cancelled'
  request: { issue: string; editPaths: string[] }
  captured?: CapturedProject
  checked?: CheckedRepair
  files?: string[]
  reason?: string
}

export function patchReviewOptions(request: CapturedProject): ViewOptions {
  const instanceKey = createHash('sha256')
    .update(
      JSON.stringify({
        issue: request.issue,
        editPaths: request.editPaths,
        files: Object.keys(request.files)
          .sort()
          .map((path) => [path, request.files[path]]),
      }),
    )
    .digest('hex')
  return {
    title: 'Patch review',
    landing: true,
    target: { definitionId: 'patch-review', instanceKey, subjectKey: instanceKey },
  }
}
const stages = {
  reading: ['Capturing source and fixed expectations', 0],
  repairing: ['Reproducing the defect and checking proposals', 1],
  checking: ['Independently validating repair evidence', 2],
  exporting: ['Preparing patches and review evidence', 3],
  ready: ['Review packet prepared', 4],
  failed: ['Patch preparation stopped', 0],
  cancelled: ['Patch preparation cancelled', 0],
} as const

function excerpt(text: string, limit = 512): string {
  const characters = [...text]
  if (characters.length <= limit) return text
  return (
    characters.slice(0, limit).join('') +
    '\n[Excerpt; complete value in the supplied input or returned evidence.]'
  )
}

function comparisonSection(checked: CheckedRepair): Section {
  const stages = [{ key: 'baseline', label: 'Original', check: checked.baseline }]
  for (const [index, attempt] of checked.attempts.entries()) {
    if (attempt.evaluation)
      stages.push({
        key: `proposal-${index + 1}`,
        label: `Proposal ${index + 1}`,
        check: attempt.evaluation,
      })
  }
  const columns: Collection['columns'][number][] = [{ key: 'check', label: 'Check', type: 'text' }]
  for (const stage of stages) columns.push({ key: stage.key, label: stage.label, type: 'boolean' })
  const rows: Collection['rows'][number][] = []
  const repository: Record<string, string | boolean | null> = { check: 'Repository tests' }
  for (const stage of stages) repository[stage.key] = stage.check.repositoryTestsPassed
  rows.push({ id: 'repository', cells: repository })
  for (const [index, item] of checked.baseline.acceptance.entries()) {
    const cells: Record<string, string | boolean | null> = { check: excerpt(item.id, 64) }
    for (const stage of stages) cells[stage.key] = stage.check.acceptance[index]?.passed ?? null
    rows.push({ id: `case-${index}`, cells })
  }
  return {
    title: 'Original → proposed repair',
    blocks: [
      {
        kind: 'collection',
        id: 'checks',
        title: 'Independently validated checks',
        columns,
        rows,
        total: rows.length,
      },
    ],
  }
}

function filesSection(files: string[]): Section {
  return {
    title: 'Your review files',
    blocks: [
      {
        kind: 'collection',
        id: 'evidence',
        title: 'Complete patches and evidence',
        columns: [
          { key: 'file', label: 'File', type: 'text' },
          { key: 'content', label: 'Content', type: 'reference' },
        ],
        rows: files.map((path, index) => ({
          id: `file-${index}`,
          cells: { file: path, content: { kind: 'artifact', attachment: 'deliverables', path } },
        })),
        total: files.length,
      },
    ],
  }
}

export function patchReviewView(state: PatchState): ViewSnapshot {
  const [label, completed] = stages[state.phase]
  const checked = state.checked
  let verdict = 'No proposal has been accepted.'
  if (checked)
    verdict = checked.ready
      ? 'A patch passed independently validated checks. Review it before applying.'
      : 'No passing patch was produced; retained proposals explain the unsuccessful repair.'
  if (state.reason) verdict = excerpt(state.reason)
  const sections: Section[] = [
    {
      title: 'Patch status',
      blocks: [
        { kind: 'progress', label, completed, total: 4, unit: 'stages' },
        { kind: 'report', text: verdict },
        {
          kind: 'facts',
          items: [
            {
              label: 'Captured files',
              value: state.captured ? Object.keys(state.captured.files).length : 'Reading',
            },
            { label: 'Checked proposals', value: checked?.proposals.length ?? 0 },
            { label: 'Changes applied', value: false },
          ],
        },
      ],
    },
    {
      title: 'Requested repair',
      blocks: [
        { kind: 'report', text: excerpt(state.request.issue, 1000) },
        {
          kind: 'collection',
          id: 'files',
          title: 'Permitted source edits',
          columns: [{ key: 'path', label: 'Path', type: 'text' }],
          rows: state.request.editPaths.map((path, index) => ({
            id: `file-${index}`,
            cells: { path: excerpt(path, 256) },
          })),
          total: state.request.editPaths.length,
        },
      ],
    },
  ]
  if (checked) {
    sections.push(comparisonSection(checked))
    sections.push({
      title: 'Acceptance explanation',
      blocks: [{ kind: 'report', text: excerpt(checked.reason) }],
    })
  }
  if (state.files) sections.push(filesSection(state.files))
  return {
    summary:
      'Reproduce one defect, compare bounded repair proposals against fixed expectations, and prepare a patch for review.',
    sections,
  }
}
