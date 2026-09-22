import { constants } from 'node:fs'
import { open, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'csv-parse/sync'
import type { RunContext, RunResult } from '@jigging/flow'

export function parseContacts(bytes: Uint8Array): { headers: string[]; rows: string[][] } {
  if (bytes.length > 65536) throw new TypeError('CSV must fit within 64 KiB.')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (text.includes('\0')) throw new TypeError('CSV cannot contain NUL characters.')
  const records: string[][] = parse(text, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    max_record_size: 32768,
  })
  const [headers, ...rows] = records
  if (
    !headers?.length ||
    headers.length > 16 ||
    headers.some((h) => !h.trim() || h.length > 80) ||
    new Set(headers.map((h) => h.trim().toLowerCase())).size !== headers.length
  )
    throw new TypeError('Use 1–16 distinct, nonempty headings of at most 80 characters.')
  if (
    !rows.length ||
    rows.length > 100 ||
    rows.some((row) => row.length > 16 || row.some((cell) => cell.length > 2048))
  )
    throw new TypeError('Use 1–100 data records, at most 16 columns and 2048 characters per cell.')
  return { headers, rows }
}

export async function runMethod(
  run: Pick<RunContext, 'input' | 'attachments' | 'signal' | 'call'>,
): Promise<RunResult> {
  const { source, preview } = run.attachments
  if (source?.access !== 'read' || preview?.access !== 'read-write')
    throw new TypeError('Supply source and preview attachments.')
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
  } finally {
    await file.close()
  }
  const { headers, rows } = parseContacts(bytes)
  run.signal.throwIfAborted()
  const proposal = await run.call({
    operationId: 'map-columns',
    slot: 'mapper',
    input: { headers },
  })
  run.signal.throwIfAborted()
  if (proposal.outcome === 'blocked' || proposal.outcome === 'limit') return proposal
  if (proposal.outcome !== 'done') throw new TypeError('Unexpected mapping outcome.')
  const { mapping } = proposal.output as {
    mapping: null | { name: number; email: number; organization: number }
  }
  const result = await run.call({
    operationId: 'convert-rows',
    slot: 'converter',
    input: { headers, rows, mapping },
  })
  run.signal.throwIfAborted()
  if (result.outcome !== 'done') return result
  await writeFile(
    join(preview.path, 'preview.json'),
    JSON.stringify(result.output, null, 2) + '\n',
    { flag: 'wx' },
  )
  return result
}
