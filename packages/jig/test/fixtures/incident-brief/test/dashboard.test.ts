import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ViewSnapshot, validateReportingMessage } from '@jigging/reporting'

function checked(view: ViewSnapshot, id = 'test') {
  const item = validateReportingMessage({ kind: 'view', id, title: 'Domain view', ...view })
  expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(32768)
  return item as any
}

import { answerView, workView } from '../flows/project/dashboard.ts'
import { workerView } from '../flows/worker/dashboard.ts'
import input from '../input.json'

test('both handoff Flows carry the exact licensed public reporting contract', async () => {
  const descriptor = await readFile(new URL(import.meta.resolve('@jigging/reporting/reporting.json')))
  const license = await readFile(new URL(import.meta.resolve('@jigging/reporting/LICENSE')))

  for (const flow of ['project', 'worker']) {
    const contractFolder = join(import.meta.dir, '..', 'flows', flow, 'contracts', 'reporting')
    expect(await readFile(join(contractFolder, 'reporting.json'))).toEqual(descriptor)
    expect(await readFile(join(contractFolder, 'LICENSE'))).toEqual(license)
  }
})

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
  const branches = waiting.sections[0].blocks.find((block: any) => block.kind === 'collection')
  expect(branches.rows.map((row: any) => row.cells.call)).toEqual([
    { kind: 'call', operationId: 'draft' },
    { kind: 'call', operationId: 'independent' },
  ])
  expect(branches.rows.every((row: any) => row.cells.state === 'No settled result yet')).toBeTrue()
  const failed = checked(
    workView(input, [
      { role: 'draft', failure: 'UNCERTAIN', message: 'Dispatch cannot be confirmed.' },
    ]),
  )
  expect(JSON.stringify(failed)).toContain('Dispatch cannot be confirmed.')
})
