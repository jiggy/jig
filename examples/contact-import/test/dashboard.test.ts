import { expect, test } from 'bun:test'
import { type ViewSnapshot, validateUserUpdate } from '@jigging/user-updates'

function checked(view: ViewSnapshot, id = 'test') {
  const item = validateUserUpdate({ kind: 'view', id, title: 'Domain view', ...view })
  expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(32768)
  return item as any
}

import {
  contactsView as suppliedContacts,
  mappingView as suppliedMapping,
} from '../flows/convert/dashboard.ts'
import { contactsView, mappingView } from '../flows/import/dashboard.ts'
import { columnsView as agent } from '../flows/map-agent/dashboard.ts'
import { columnsView as code } from '../flows/map-code/dashboard.ts'
import { columnsView as mixed } from '../flows/map-mixed/dashboard.ts'

test('column methods show bounded proposals rather than import receipts', () => {
  const headers = Array.from({ length: 16 }, (_, index) => String(index) + '\u0001'.repeat(78))
  for (const view of [code, agent, mixed]) {
    for (const mapping of [null, { name: 0, email: 1, organization: 2 }]) {
      const item = checked(
        view(headers, 'Headings only; code validates the proposal.', {
          outcome: 'done',
          output: { mapping },
        }),
      )
      expect(JSON.stringify(item)).toContain('No database is changed')
    }
  }
})

test('contact lists disclose omitted rows and values while preserving typed delivered-file references', () => {
  const result = {
    outcome: 'done',
    output: {
      status: 'ready',
      mapping: { name: 0, email: 1, organization: 2 },
      accepted: Array.from({ length: 100 }, (_, index) => ({
        record: index + 2,
        contact: {
          name: '\u0001'.repeat(2048),
          email: 'a@b.test',
          organization: '😀'.repeat(1024),
        },
      })),
      rejected: Array.from({ length: 100 }, (_, index) => ({
        record: index + 2,
        reason: '\u0001'.repeat(2048),
      })),
    },
  }
  const headers = ['Name', 'Email', 'Organization']
  checked(mappingView(headers, 100, result))
  checked(suppliedMapping(headers, 100, result))
  for (const accepted of [true, false]) {
    const item = checked(contactsView(result, accepted))
    const collection = item.sections[0].blocks[0]
    expect(collection.rows).toHaveLength(12)
    expect(collection.total).toBe(100)
    expect(JSON.stringify(collection.rows[0])).toContain('[excerpt]')
    expect(item.sections[0].blocks[1].references).toEqual([
      { kind: 'artifact', attachment: 'preview', path: 'preview.json' },
    ])
    expect(JSON.stringify(checked(suppliedContacts(result, accepted, false)))).not.toContain(
      '"kind":"artifact"',
    )
  }
  expect(result.output.accepted[0]!.contact.name.length).toBe(2048)
  for (const state of [
    undefined,
    { outcome: 'blocked', output: { reason: 'No mapper available.' } },
  ]) {
    const item = checked(contactsView(state, true))
    expect(JSON.stringify(item)).not.toContain('"kind":"artifact"')
  }
})
