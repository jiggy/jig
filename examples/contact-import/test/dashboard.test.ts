import { expect, test } from 'bun:test'
import { REPORTING_LIMITS, type ViewSnapshot, validateReportingMessage } from '@jigging/reporting'
import { contactsView, mappingView } from '../flows/convert/dashboard.ts'
import {
  type ContactPreview,
  contactPreviewOptions,
  contactPreviewView,
} from '../flows/import/dashboard.ts'
import { columnsView as agent } from '../flows/map-agent/dashboard.ts'
import { columnsView as code } from '../flows/map-code/dashboard.ts'
import { columnsView as mixed } from '../flows/map-mixed/dashboard.ts'

function checked(view: ViewSnapshot) {
  const item = validateReportingMessage({ kind: 'view', id: 'test', title: 'Domain view', ...view })
  expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(REPORTING_LIMITS.itemBytes)
  return item as any
}

test('column methods show bounded proposals rather than import receipts', () => {
  const headers = Array.from({ length: 16 }, (_, index) => String(index) + '\u0001'.repeat(78))
  for (const view of [code, agent, mixed]) {
    for (const mapping of [null, { name: 0, email: 1, organization: 2 }]) {
      expect(
        JSON.stringify(
          checked(
            view(headers, 'Headings only; code validates the proposal.', {
              outcome: 'done',
              output: { mapping },
            }),
          ),
        ),
      ).toContain('No database is changed')
    }
  }
})

test('the complete contact page previews whole records and discloses omitted records', () => {
  const preview: ContactPreview = {
    status: 'ready',
    reason: 'Review the mapping.',
    mapping: { name: 0, email: 1, organization: 2 },
    accepted: Array.from({ length: 100 }, (_, index) => ({
      record: index + 2,
      contact: { name: '\u0001'.repeat(2048), email: 'a@b.test', organization: '😀'.repeat(1024) },
    })),
    rejected: Array.from({ length: 100 }, (_, index) => ({
      record: index + 2,
      reason: '\u0001'.repeat(2048),
    })),
  }
  const item = checked(
    contactPreviewView({
      phase: 'ready',
      headers: ['\u0001'.repeat(80), 'Email', 'Organization'],
      records: 100,
      preview,
      file: 'preview.json',
    }),
  )
  const accepted = item.sections[0].blocks[0]
  const rejected = item.sections[1].blocks[0]
  expect(accepted.rows).toHaveLength(12)
  expect(rejected.rows).toHaveLength(12)
  expect(accepted.total).toBe(100)
  expect(rejected.total).toBe(100)
  expect(accepted.rows[0].cells.name).toBe(preview.accepted[0]!.contact.name)
  expect(accepted.rows[0].cells.organization).toBe(preview.accepted[0]!.contact.organization)
  expect(rejected.rows[0].cells.reason).toBe(preview.rejected[0]!.reason)
  expect(item.sections[4].blocks[0].references).toEqual([
    { kind: 'artifact', attachment: 'preview', path: 'preview.json' },
  ])
  expect(preview.accepted[0]!.contact.name.length).toBe(2048)
  checked(mappingView(['Name', 'Email', 'Organization'], 100, { outcome: 'done', output: preview }))
  for (const accepted of [true, false])
    checked(contactsView({ outcome: 'done', output: preview }, accepted, false))
})

test('stopped and clarification pages preserve their meaning without delivered-file claims', () => {
  const pending = checked(contactPreviewView({ phase: 'reading' }))
  expect(pending.sections[0].blocks[1].items[1].value).toBe('Awaiting row checks')
  const stopped = checked(contactPreviewView({ phase: 'blocked', reason: 'No mapper available.' }))
  expect(JSON.stringify(stopped)).toContain('No mapper available.')
  expect(JSON.stringify(stopped)).not.toContain('"kind":"artifact"')
  const clarification = checked(
    contactPreviewView({
      phase: 'ready',
      preview: {
        status: 'needs_mapping',
        reason: 'Choose columns.',
        mapping: null,
        accepted: [],
        rejected: [],
      },
    }),
  )
  expect(JSON.stringify(clarification)).toContain('Needs clarification')
  expect(clarification.sections).toHaveLength(1)
})

test('captured CSV values identify a fixed application target independently of Run IDs', () => {
  const headers = ['Name', 'Email', 'Organization']
  const rows = [['Ada', 'ada@example.test', 'Example']]
  const options = contactPreviewOptions(headers, rows)
  expect(options.landing).toBe(true)
  expect(options.target?.definitionId).toBe('contact-preview')
  expect(options.target?.instanceKey).toMatch(/^[0-9a-f]{64}$/)
  expect(options).toEqual(
    contactPreviewOptions(
      [...headers],
      rows.map((row) => [...row]),
    ),
  )
  expect(options.target?.instanceKey).not.toBe(
    contactPreviewOptions(headers, [['Bea', 'bea@example.test', 'Example']]).target?.instanceKey,
  )
  validateReportingMessage({
    kind: 'view',
    id: 'contacts',
    ...options,
    ...contactPreviewView({ phase: 'mapping', headers, records: 1 }),
  })
})
