import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import { parseContacts } from './csv.ts'

export async function readContacts(
  run: Pick<RunContext, 'attachments' | 'signal'>,
  reporter?: Reporter,
): Promise<RunResult> {
  const source = run.attachments.source
  if (source?.access !== 'read') throw new TypeError('Supply a read-only source attachment.')
  run.signal.throwIfAborted()
  const file = await open(
    join(source.path, 'contacts.csv'),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  let bytes: Buffer
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 65536)
      throw new TypeError('contacts.csv must be a regular file of at most 64 KiB.')
    bytes = await file.readFile()
    if (bytes.length !== info.size)
      throw new TypeError('contacts.csv changed or could not be read completely.')
  } finally {
    await file.close()
  }
  run.signal.throwIfAborted()
  const contacts = parseContacts(bytes)
  reporter?.view('source', { title: 'Contact CSV', landing: true }).update({
    summary:
      'Captured contact rows remain with code. Only headings are needed for column interpretation.',
    sections: [
      {
        blocks: [
          {
            kind: 'facts',
            items: [
              { label: 'Columns', value: contacts.headers.length },
              { label: 'Records', value: contacts.rows.length },
            ],
          },
        ],
      },
    ],
  })
  return { outcome: 'done', output: contacts }
}
