import { expect, test } from 'bun:test'
import { type ViewSnapshot, validateUserUpdate } from '@jigging/user-updates'

function checked(view: ViewSnapshot, id = 'test') {
  const item = validateUserUpdate({ kind: 'view', id, title: 'Domain view', ...view })
  expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(32768)
  return item as any
}

import { answerView, workView } from '../flows/project/dashboard.ts'
import { workerView } from '../flows/worker/dashboard.ts'
import input from '../input.json'

test('bounded worker suggestions and causes stay separate from source context and host verification', () => {
  const context = { ...input, task: '\u0001'.repeat(4096) }
  const result = {
    outcome: 'blocked',
    output: {
      brief: '\u0001'.repeat(16384),
      requestedTurns: 3,
      revision: 2,
      handoff: {},
      failureDetails: Array.from({ length: 4 }, () => ({
        code: 'CHANNEL_LOST',
        message: '\u0001'.repeat(1024),
      })),
    },
  }
  const branch = { role: 'draft', result }
  for (const item of [
    checked(workView(context, [branch])),
    checked(answerView(branch, true)),
    checked(workerView(context, 'draft', result)),
  ]) {
    expect(JSON.stringify(item)).not.toContain(input.files[0]!.text)
    expect(JSON.stringify(item)).not.toContain(input.earlierContext)
  }
  expect(JSON.stringify(checked(answerView(branch, true)))).toContain('CHANNEL_LOST')
  expect(
    checked(
      workerView(input, 'draft', {
        outcome: 'done',
        output: { brief: 'Possible cause remains uncertain.' },
      }),
    ).summary,
  ).toContain('no publication has been authorized')
  const waiting = checked(workView(input))
  expect(JSON.stringify(waiting)).not.toContain('"kind":"call"')
  const failed = checked(
    workView(input, [
      { role: 'draft', failure: 'UNCERTAIN', message: 'Dispatch cannot be confirmed.' },
    ]),
  )
  expect(JSON.stringify(failed)).toContain('Dispatch cannot be confirmed.')
})
