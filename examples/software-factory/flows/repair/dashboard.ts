import type { RunResult } from '@jigging/flow'
import type { ViewSnapshot } from '@jigging/user-updates'

type Request = {
  issue: string
  editPaths: string[]
  files?: Record<string, string>
  cases?: { id: string }[]
}
type Check = {
  repositoryTestsPassed: boolean
  accepted: boolean
  acceptance: { id: string; passed: boolean }[]
}
type Evidence = {
  reason?: string
  baseline?: Check
  attempts?: { invalidProposal?: string; evaluation?: Check }[]
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
export function evidenceView(names: string[] = []): ViewSnapshot {
  return {
    summary: names.length
      ? 'Evidence has been authored; file references become available after verified packet delivery. Review patches before applying them.'
      : 'No final evidence packet has been authored yet. Source files remain unchanged.',
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'evidence',
            title: 'Review evidence',
            columns: [
              { key: 'file', label: 'File', type: 'text' },
              { key: 'purpose', label: 'Purpose', type: 'text' },
              { key: 'content', label: 'Content', type: 'reference' },
            ],
            rows: names.map((name, index) => ({
              id: `evidence-${index}`,
              cells: {
                file: name,
                purpose:
                  name === 'review.patch'
                    ? 'Independently checked patch; human review required'
                    : name === 'goal.txt'
                      ? 'Complete requested goal'
                      : name === 'summary.txt'
                        ? 'Repair outcome and evidence directions'
                        : 'Retained proposal; acceptance is described in Checks',
                content: { kind: 'artifact' as const, attachment: 'deliverables', path: name },
              },
            })),
            total: names.length,
          },
        ],
      },
    ],
  }
}
