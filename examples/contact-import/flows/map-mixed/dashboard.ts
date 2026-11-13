import type { RunResult } from '@jigging/flow'
import type { ViewSnapshot } from '@jigging/reporting'

export function columnsView(
  headers: string[],
  approach: string,
  result?: RunResult,
  decision?: 'known-format-code' | 'agent-proposal',
): ViewSnapshot {
  const output = result?.output as
    | { mapping?: Record<string, number> | null; reason?: string }
    | undefined
  const mapping = output?.mapping
  return {
    summary: !result
      ? 'Propose three contact columns using headings only; no contact rows are sent to the mapper.'
      : result.outcome !== 'done'
        ? `Column proposal ${result.outcome}; no mapping is available.`
        : mapping
          ? 'Column proposal returned. The converter still needs to check indices and rows.'
          : 'No unambiguous column proposal; a person needs to choose the mapping.',
    sections: [
      {
        blocks: [
          { kind: 'report', text: approach },
          ...(decision === undefined
            ? []
            : [{
                kind: 'facts' as const,
                items: [
                  { label: 'Condition evaluated', value: 'Exactly Customer, Email address and Company, in any order' },
                  { label: 'Condition matched', value: decision === 'known-format-code' ? 'yes' : 'no' },
                  {
                    label: 'Reported choice',
                    value: decision === 'known-format-code'
                      ? 'Use code to select known columns'
                      : 'Select the Agent-proposal branch',
                  },
                  {
                    label: 'Invocation evidence',
                    value: decision === 'known-format-code'
                      ? 'No Agent invocation belongs to this selected branch'
                      : 'Inspect observed calls to establish whether the Agent request started and returned',
                  },
                ],
              }]),
          {
            kind: 'collection',
            id: 'headings',
            title: 'Supplied headings',
            columns: [
              { key: 'index', label: 'Index (zero-based)', type: 'number' },
              { key: 'heading', label: 'Heading', type: 'text' },
            ],
            rows: headers.map((heading, index) => ({
              id: `column-${index}`,
              cells: { index, heading },
            })),
            total: headers.length,
          },
          {
            kind: 'facts',
            items: ['name', 'email', 'organization'].map((field) => ({
              label: `Proposed ${field} index`,
              value: mapping?.[field] ?? null,
            })),
          },
          {
            kind: 'report',
            text: output?.reason
              ? [...output.reason].slice(0, 512).join('') +
                '\n[Complete cause remains in the result.]'
              : 'No database is changed. A structurally valid proposal does not establish correct column meaning.',
          },
        ],
      },
    ],
  }
}
