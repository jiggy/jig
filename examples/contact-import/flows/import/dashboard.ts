import { createHash } from 'node:crypto'
import {
  previewCollection,
  type Section,
  type ViewOptions,
  type ViewSnapshot,
} from '@jigging/reporting'

export type ContactPreview = {
  status: 'ready' | 'needs_mapping'
  reason: string
  mapping: { name: number; email: number; organization: number } | null
  accepted: { record: number; contact: { name: string; email: string; organization: string } }[]
  rejected: { record: number; reason: string }[]
}
export type ImportState = {
  phase:
    | 'reading'
    | 'mapping'
    | 'checking'
    | 'exporting'
    | 'ready'
    | 'blocked'
    | 'limit'
    | 'failed'
    | 'cancelled'
  headers?: string[]
  records?: number
  preview?: ContactPreview
  file?: string
  reason?: string
}
const stages = {
  reading: ['Reading the contact CSV', 0],
  mapping: ['Choosing contact columns', 1],
  checking: ['Checking selected columns and rows', 2],
  exporting: ['Writing the complete preview', 3],
  ready: ['Preview prepared', 4],
  blocked: ['Column interpretation needs attention', 0],
  limit: ['Column interpretation limit reached', 0],
  failed: ['Contact preview stopped', 0],
  cancelled: ['Contact preview cancelled', 0],
} as const

function excerpt(text: string, maximum = 64): string {
  const characters = [...text]
  if (characters.length <= maximum) return text
  return characters.slice(0, maximum).join('') + '… [excerpt]'
}

function mappingSection(state: ImportState): Section {
  const mapping = state.preview?.mapping
  return {
    title: 'Source → contact fields',
    blocks: [
      {
        kind: 'collection',
        id: 'mapping',
        title: 'Selected columns',
        columns: [
          { key: 'field', label: 'Contact field', type: 'text' },
          { key: 'heading', label: 'Source heading', type: 'text' },
          { key: 'index', label: 'CSV index', type: 'number' },
        ],
        rows: (['name', 'email', 'organization'] as const).map((field) => ({
          id: field,
          cells: {
            field,
            heading: mapping ? (state.headers?.[mapping[field]] ?? null) : null,
            index: mapping?.[field] ?? null,
          },
        })),
        total: 3,
      },
    ],
  }
}

function acceptedSection(preview: ContactPreview): Section {
  const { collection } = previewCollection(
    {
      kind: 'collection',
      id: 'accepted',
      title: 'Accepted records',
      columns: [
        { key: 'record', label: 'CSV record', type: 'number' },
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'email', label: 'Email', type: 'text' },
        { key: 'organization', label: 'Organization', type: 'text' },
      ],
      rows: preview.accepted.map((row) => ({
        id: `record-${row.record}`,
        cells: { record: row.record, ...row.contact },
      })),
    },
    { limit: 12 },
  )
  return { title: 'Accepted contact preview', blocks: [collection] }
}

function rejectedSection(preview: ContactPreview): Section {
  const { collection } = previewCollection(
    {
      kind: 'collection',
      id: 'rejected',
      title: 'Excluded records',
      columns: [
        { key: 'record', label: 'CSV record', type: 'number' },
        { key: 'reason', label: 'Correction needed', type: 'text' },
      ],
      rows: preview.rejected.map((row) => ({
        id: `record-${row.record}`,
        cells: { record: row.record, reason: row.reason },
      })),
    },
    { limit: 12 },
  )
  return { title: 'Records needing correction', blocks: [collection] }
}

/** The captured CSV identifies this preview independently of the current Run. */
export function contactPreviewOptions(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): ViewOptions {
  const sourceKey = createHash('sha256')
    .update(JSON.stringify([headers, rows]))
    .digest('hex')
  return {
    title: 'Contact preview',
    landing: true,
    target: { definitionId: 'contact-preview', instanceKey: sourceKey, subjectKey: sourceKey },
  }
}

export function contactPreviewView(state: ImportState): ViewSnapshot {
  const [label, completed] = stages[state.phase]
  const preview = state.preview
  const sections: Section[] = [
    {
      title: 'Contact preview status',
      blocks: [
        { kind: 'progress', label, completed, total: 4, unit: 'stages' },
        {
          kind: 'facts',
          items: [
            { label: 'Source records', value: state.records ?? 'Reading' },
            { label: 'Accepted', value: preview?.accepted.length ?? 'Awaiting row checks' },
            { label: 'Needs correction', value: preview?.rejected.length ?? 'Awaiting row checks' },
            {
              label: 'Column mapping',
              value:
                preview?.status === 'needs_mapping'
                  ? 'Needs clarification'
                  : preview
                    ? 'Checked; review its meaning'
                    : 'Awaiting checks',
            },
          ],
        },
        {
          kind: 'report',
          text: excerpt(
            state.reason ??
              preview?.reason ??
              'Prepare contacts from one CSV. Only headings reach the Agent; no database is modified.',
            1000,
          ),
        },
      ],
    },
  ]
  if (state.headers) sections.push(mappingSection(state))
  if (preview?.status === 'ready') sections.push(acceptedSection(preview), rejectedSection(preview))
  if (state.file)
    sections.push({
      title: 'Your complete preview',
      blocks: [
        {
          kind: 'report',
          text: 'Review the column meanings and all records before importing. The complete preview preserves every value; Jig confirms file delivery separately.',
          references: [{ kind: 'artifact', attachment: 'preview', path: state.file }],
        },
      ],
    })
  return {
    summary:
      'Turn a customer CSV into a contact preview with explicit column mapping and reasons for excluded records.',
    sections,
  }
}
