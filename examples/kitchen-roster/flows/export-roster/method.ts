import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import { type RosterRow, rosterCsv } from './csv.ts'

export async function runMethod(
  run: Pick<RunContext, 'input' | 'attachments' | 'signal'>,
  updates?: Reporter,
): Promise<RunResult> {
  const files = run.attachments.files
  if (files?.access !== 'read-write') {
    throw new TypeError('Supply a writable files attachment.')
  }
  run.signal.throwIfAborted()
  const { rows } = run.input as { rows: RosterRow[] }
  const csv = rosterCsv(rows)
  updates?.activity('export-roster', 'Writing the checked roster CSV')
  await writeFile(join(files.path, 'roster.csv'), csv, { flag: 'wx' })
  run.signal.throwIfAborted()
  updates?.view('export', { title: 'Roster export', landing: true }).update({
    summary: 'Eight rows prepared; the final host result confirms delivery.',
    sections: [
      {
        blocks: [
          {
            kind: 'report',
            text: 'Open the CSV to inspect the shifts.',
            references: [{ kind: 'artifact', attachment: 'files', path: 'roster.csv' }],
          },
          {
            kind: 'content',
            title: 'Checked roster CSV',
            reference: { kind: 'artifact', attachment: 'files', path: 'roster.csv' },
          },
        ],
      },
    ],
  })
  return { outcome: 'done', output: { count: rows.length, file: 'roster.csv' } }
}
