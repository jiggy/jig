import type { RunResult } from '@jigging/flow'
import type { ViewSnapshot } from '@jigging/user-updates'

type Preview = {
  status?: string
  reason?: string
  mapping?: Record<string, number> | null
  accepted?: { record: number; contact: { name: string; email: string; organization: string } }[]
  rejected?: { record: number; reason: string }[]
}
function excerpt(text: string, maximum = 64): string {
  const chars = [...text]
  return chars.slice(0, maximum).join('') + (chars.length > maximum ? '… [excerpt]' : '')
}
export function mappingView(headers: string[], records: number, result?: RunResult): ViewSnapshot {
  const output = result?.output as Preview | undefined
  const mapping = output?.mapping
  return {
    summary: !result
      ? `${headers.length} headings and ${records} data records supplied. Column proposals still need code checks.`
      : result.outcome !== 'done'
        ? `Import preview ${result.outcome}; no contacts have been imported.`
        : output?.status === 'needs_mapping'
          ? 'Column selection needs clarification. No contact preview is ready.'
          : 'Column selection and row checks completed. Review the preview before importing anything.',
    sections: [
      {
        blocks: [
          {
            kind: 'report',
            text: 'The mapper sees headings only. Code checks distinct existing columns and contact rows. A preview is a proposal; no database is modified.',
          },
          {
            kind: 'collection',
            id: 'headings',
            title: 'Supplied CSV headings',
            columns: [
              { key: 'column', label: 'Index (zero-based)', type: 'number' },
              { key: 'heading', label: 'Heading', type: 'text' },
            ],
            rows: headers.map((heading, index) => ({
              id: `column-${index}`,
              cells: { column: index, heading },
            })),
            total: headers.length,
          },
          {
            kind: 'collection',
            id: 'mapping',
            title: 'Selected contact columns',
            columns: [
              { key: 'field', label: 'Contact field', type: 'text' },
              { key: 'index', label: 'CSV index', type: 'number' },
              { key: 'heading', label: 'CSV heading', type: 'text' },
            ],
            rows: ['name', 'email', 'organization'].map((field) => ({
              id: field,
              cells: {
                field,
                index: mapping?.[field] ?? null,
                heading:
                  mapping && typeof mapping[field] === 'number' && Number.isInteger(mapping[field])
                    ? (headers[mapping[field]] ?? null)
                    : null,
              },
            })),
            total: 3,
          },
          {
            kind: 'report',
            text: result
              ? excerpt(output?.reason ?? 'See the returned preview and selected columns.', 512)
              : 'Waiting for the reviewed mapper and converter.',
          },
        ],
      },
    ],
  }
}
export function contactsView(
  result: RunResult | undefined,
  accepted: boolean,
  artifact = true,
): ViewSnapshot {
  const output = result?.output as Preview | undefined
  const rows = accepted ? (output?.accepted ?? []) : (output?.rejected ?? [])
  const available = result?.outcome === 'done' && output?.status === 'ready'
  return {
    summary: !result
      ? 'Row checks have not finished; no contacts have been imported.'
      : !available
        ? 'No completed contact preview is available. Review Mapping for the reported cause or required column choice.'
        : `${rows.length} ${accepted ? 'accepted' : 'rejected'} records. Lists show up to 12 records and bounded text; the complete output retains every record.`,
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'records',
            title: accepted ? 'Accepted contact preview (first 12)' : 'Rejected records (first 12)',
            columns: accepted
              ? [
                  { key: 'record', label: 'CSV record', type: 'number' },
                  { key: 'name', label: 'Name', type: 'text' },
                  { key: 'email', label: 'Email', type: 'text' },
                  { key: 'organization', label: 'Organization', type: 'text' },
                ]
              : [
                  { key: 'record', label: 'CSV record', type: 'number' },
                  { key: 'reason', label: 'Reason', type: 'text' },
                ],
            rows: rows.slice(0, 12).map((row) => ({
              id: `record-${row.record}`,
              cells:
                'contact' in row
                  ? {
                      record: row.record,
                      name: excerpt(row.contact.name),
                      email: excerpt(row.contact.email),
                      organization: excerpt(row.contact.organization),
                    }
                  : { record: row.record, reason: excerpt(row.reason, 256) },
              details: [
                {
                  kind: 'report',
                  text: `CSV record ${row.record} includes the header in its numbering. ${'contact' in row ? 'Passed this example’s name, organization, email-format and column-count rules; semantic column correspondence still needs human review.' : 'Excluded by the code-owned row rules; correct the source before a new preview.'}`,
                },
              ],
            })),
            total: rows.length,
          },
          {
            kind: 'report',
            text:
              artifact && result?.outcome === 'done'
                ? 'Complete authored preview: preview.json. Its file reference becomes available only after verified packet delivery. No contacts have been imported.'
                : 'The complete returned output retains all record values; no contacts have been imported.',
            ...(artifact && result?.outcome === 'done'
              ? {
                  references: [
                    { kind: 'artifact' as const, attachment: 'preview', path: 'preview.json' },
                  ],
                }
              : {}),
          },
        ],
      },
    ],
  }
}
