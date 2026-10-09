import { expect, test } from 'bun:test'
import { type ViewSnapshot, validateUserUpdate } from '@jigging/user-updates'

function checked(view: ViewSnapshot, id = 'test') {
  const item = validateUserUpdate({ kind: 'view', id, title: 'Domain view', ...view })
  expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(32768)
  return item as any
}

import { triageView as agent } from '../flows/agent/dashboard.ts'
import { triageView as code } from '../flows/code/dashboard.ts'
import { triageView as intake } from '../flows/intake/dashboard.ts'
import { triageView as mixed } from '../flows/mixed/dashboard.ts'

for (const [name, view] of Object.entries({ intake, code, agent, mixed })) {
  test(`${name} exposes the request and a suggestion without claiming dispatch`, () => {
    const message = 'G' + '\u0001'.repeat(3999)
    for (const outcome of ['done', 'blocked', 'limit']) {
      const result = {
        outcome,
        output: outcome === 'done' ? { queue: 'manual' } : { reason: '\u0001'.repeat(4000) },
      }
      const item = checked(view(message, 'Interpret supplied text; no business action.', result))
      expect(item.sections[0].blocks[0].text).toBe(message)
      if (outcome === 'done')
        expect(item.summary).toContain('Manual review. No request has been dispatched')
      else expect(item.summary).toContain('no queue was selected')
    }
  })
}
