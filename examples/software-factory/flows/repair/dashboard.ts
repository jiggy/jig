import { createHash } from 'node:crypto'
import type { RunResult } from '@jigging/flow'
import type { ViewOptions, ViewSnapshot } from '@jigging/reporting'

type Request = {
  issue: string
  editPaths: string[]
  files?: Record<string, string>
  cases?: { id: string }[]
}
export function repairViewOptions(
  input: Request & { files: Record<string, string> },
): Readonly<Record<'repair' | 'checks', ViewOptions>> {
  const label = `${input.editPaths.length} editable ${input.editPaths.length === 1 ? 'file' : 'files'}`
  const instanceKey = createHash('sha256')
    .update(
      JSON.stringify({
        issue: input.issue,
        editPaths: input.editPaths,
        files: Object.keys(input.files)
          .sort()
          .map((path) => [path, input.files[path]]),
      }),
    )
    .digest('hex')
  return {
    repair: {
      title: 'Repair',
      landing: true,
      target: {
        definitionId: 'repair',
        instanceKey,
        subjectKey: instanceKey,
        label,
        scopeLabel: 'Repair',
      },
    },
    checks: {
      title: 'Checks',
      target: {
        definitionId: 'repair-checks',
        instanceKey,
        subjectKey: instanceKey,
        label,
        scopeLabel: 'Repair',
      },
    },
  }
}

type Check = {
  repositoryTestsPassed: boolean
  accepted: boolean
  acceptance: { id: string; passed: boolean }[]
}
type Evidence = {
  reason?: string
  baseline?: Check
  attempts?: {
    invalidProposal?: string
    evaluation?: Check
    proposal?: { replacements: { path: string; content: string }[] }
  }[]
}
function excerpt(text: string, maximum = 512): string {
  const chars = [...text]
  return (
    chars.slice(0, maximum).join('') +
    (chars.length > maximum
      ? '\n[Excerpt; complete value in the supplied input or returned evidence.]'
      : '')
  )
}
/** Display complete-file hunks from this method's captured originals and proposals. */
function proposalDiff(input: Request, replacements: { path: string; content: string }[]): string {
  const chunks = replacements
    .map(({ path, content }) => {
      const original = input.files?.[path]
      if (original === undefined || original === content) return ''
      const lines = (value: string) =>
        value === '' ? [] : value.split('\n').slice(0, value.endsWith('\n') ? -1 : undefined)
      const before = lines(original)
      const after = lines(content)
      const body = (value: string, rows: string[], prefix: string) =>
        rows.map((line) => prefix + line + '\n').join('') +
        (rows.length && !value.endsWith('\n') ? '\\ No newline at end of file\n' : '')
      return (
        `--- a/${path}\n+++ b/${path}\n@@ -${before.length ? 1 : 0},${before.length} +${after.length ? 1 : 0},${after.length} @@\n` +
        body(original, before, '-') +
        body(content, after, '+')
      )
    })
    .join('\n')
  const marker =
    '\n[Excerpt; complete original files and proposal replacements remain in the returned evidence.]'
  if ([...chunks].length <= 2048 && Buffer.byteLength(JSON.stringify(chunks)) <= 4096) return chunks
  let prefix = ''
  let scalars = 0
  let bytes = Buffer.byteLength(JSON.stringify(marker))
  for (const character of chunks) {
    const addedBytes = Buffer.byteLength(JSON.stringify(character)) - 2
    if (scalars >= 2048 - [...marker].length || bytes + addedBytes > 4096) break
    prefix += character
    scalars++
    bytes += addedBytes
  }
  return prefix + marker
}

export function repairView(
  input: Request,
  result?: RunResult,
  verified = false,
  artifact = false,
): ViewSnapshot {
  const output = result?.output as Evidence | undefined
  return {
    summary: !result
      ? 'Reproduce the defect, request a bounded proposal and check it against unchanged acceptance cases.'
      : result.outcome !== 'done'
        ? `Repair ${result.outcome}; no checked patch is ready for review.`
        : verified
          ? 'A patch passed independently validated checks. Review it before applying; changes have not been applied.'
          : 'Worker reports a passing patch. A consuming application must validate the returned evidence before accepting it.',
    sections: [
      {
        title: 'Requested goal',
        blocks: [
          {
            kind: 'report' as const,
            text: excerpt(input.issue, 1024),
            ...(artifact
              ? {
                  references: [
                    { kind: 'artifact' as const, attachment: 'deliverables', path: 'goal.txt' },
                  ],
                }
              : {}),
          },
        ],
      },
      {
        title: 'Editable scope',
        blocks: [
          {
            kind: 'collection',
            id: 'files',
            title: 'Permitted source files',
            columns: [{ key: 'path', label: 'Path', type: 'text' }],
            rows: input.editPaths.map((path, index) => ({
              id: `file-${index}`,
              cells: { path: excerpt(path, 256) },
            })),
            total: input.editPaths.length,
          },
          {
            kind: 'facts',
            items: [
              {
                label: 'Captured files',
                value: input.files ? Object.keys(input.files).length : null,
              },
              { label: 'Independent acceptance cases', value: input.cases?.length ?? null },
              { label: 'Changes applied', value: false },
            ],
          },
        ],
      },
      ...(output?.attempts ?? []).flatMap((attempt, index) =>
        attempt.proposal && input.files
          ? [
              {
                title: `Proposal ${index + 1}`,
                blocks: [
                  {
                    kind: 'facts' as const,
                    items: [
                      {
                        label: 'Repository tests',
                        value: attempt.evaluation?.repositoryTestsPassed ?? null,
                      },
                      {
                        label: 'Acceptance cases',
                        value: attempt.evaluation
                          ? `${attempt.evaluation.acceptance.filter((item) => item.passed).length} / ${attempt.evaluation.acceptance.length} passed`
                          : 'Not checked',
                      },
                      {
                        label: 'Caller acceptance',
                        value: verified
                          ? 'Independently validated'
                          : 'Worker report; caller validation required',
                      },
                    ],
                  },
                  {
                    kind: 'report' as const,
                    format: 'diff' as const,
                    text: proposalDiff(input, attempt.proposal.replacements),
                  },
                ],
              },
            ]
          : [],
      ),
      {
        title: 'Proposal outcome',
        blocks: [
          {
            kind: 'report' as const,
            text: output?.reason
              ? excerpt(output.reason)
              : 'No proposal has been accepted. Tests and original acceptance expectations remain unchanged.',
          },
        ],
      },
    ],
  }
}
export function checksView(result?: RunResult, verified = false, ownCalls = false): ViewSnapshot {
  const output = result?.output as Evidence | undefined
  const stages = [
    ...(output?.baseline ? [{ id: 'baseline', label: 'Baseline', check: output.baseline }] : []),
    ...(output?.attempts ?? []).flatMap((attempt, index) =>
      attempt.evaluation
        ? [
            {
              id: `attempt-${index + 1}`,
              label: `Proposal ${index + 1}`,
              check: attempt.evaluation,
            },
          ]
        : [],
    ),
  ]
  return {
    summary: verified
      ? 'The project caller checked identities and recomputed these verdicts from collected command behavior.'
      : 'Worker-reported checks are provisional until the consuming application validates the complete evidence.',
    sections: [
      {
        blocks: [
          {
            kind: 'report' as const,
            text: 'A baseline mismatch is required before proposing a repair. Returned commands and 100% progress do not establish acceptance.',
          },
          {
            kind: 'collection',
            id: 'checks',
            title: 'Repository and acceptance checks',
            columns: [
              { key: 'stage', label: 'Stage', type: 'text' },
              { key: 'check', label: 'Check', type: 'text' },
              { key: 'passed', label: 'Passed', type: 'boolean' },
              { key: 'call', label: 'Observed call', type: 'reference' },
            ],
            rows: stages.flatMap((stage) => [
              {
                id: `${stage.id}-tests`,
                cells: {
                  stage: stage.label,
                  check: 'Repository tests',
                  passed: stage.check.repositoryTestsPassed,
                  call: ownCalls ? { kind: 'call' as const, operationId: `${stage.id}-0` } : null,
                },
                details: [
                  {
                    kind: 'report' as const,
                    text: 'Repository checks require clean termination, exit 0 and complete captured output. These checks alone cannot establish the requested behavior.',
                  },
                ],
              },
              ...stage.check.acceptance.map((item, index) => ({
                id: `${stage.id}-case-${index}`,
                cells: {
                  stage: stage.label,
                  check: excerpt(item.id, 64),
                  passed: item.passed,
                  call: ownCalls
                    ? { kind: 'call' as const, operationId: `${stage.id}-${index + 1}` }
                    : null,
                },
                details: [
                  {
                    kind: 'report' as const,
                    text: 'The independent case compares captured stdout, stderr and exit against the original expected behavior. An expected rejection exit can pass; candidate code does not supply this verdict.',
                  },
                ],
              })),
            ]),
          },
          {
            kind: 'report' as const,
            text:
              (output?.attempts ?? [])
                .map((attempt, index) =>
                  attempt.invalidProposal
                    ? `Proposal ${index + 1} rejected before command execution: ${excerpt(attempt.invalidProposal, 256)}`
                    : '',
                )
                .filter(Boolean)
                .join('\n') ||
              (stages.length
                ? 'Full command identities, output and individual assertions remain in the returned evidence.'
                : 'No completed check evidence has been returned yet.'),
          },
        ],
      },
    ],
  }
}
