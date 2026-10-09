import { constants } from 'node:fs'
import { open, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunContext, RunResult } from '@jigging/flow'
import type { UserUpdates } from '@jigging/user-updates'
import { parse } from 'csv-parse/sync'
import { contactsView, mappingView } from './dashboard.ts'

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
  updates?: UserUpdates,
): Promise<RunResult> {
  const mappingReport = updates?.view('mapping', { title: 'Mapping', landing: true })
  const acceptedReport = updates?.view('contacts', { title: 'Contacts' })
  const rejectedReport = updates?.view('rejected', { title: 'Rejected rows' })
  updates?.activity('import', 'Reading source/contacts.csv')
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
  mappingReport?.update(mappingView(headers, rows.length))
  acceptedReport?.update(contactsView(undefined, true))
  rejectedReport?.update(contactsView(undefined, false))
  updates?.activity('import', 'Choosing contact columns from the captured headings')
  run.signal.throwIfAborted()
  const proposal = await run.call({
    operationId: 'map-columns',
    slot: 'mapper',
    intent: 'Choose name, email and organization columns',
    input: { headers },
  })
  run.signal.throwIfAborted()
  if (proposal.outcome === 'blocked' || proposal.outcome === 'limit') {
    updates?.notice(
      'Column mapping could not complete. No preview is ready; the result retains the reported cause.',
      'error',
    )
    mappingReport?.update(mappingView(headers, rows.length, proposal))
    acceptedReport?.update(contactsView(proposal, true))
    rejectedReport?.update(contactsView(proposal, false))
    return proposal
  }
  if (proposal.outcome !== 'done') throw new TypeError('Unexpected mapping outcome.')
  const { mapping } = proposal.output as {
    mapping: null | { name: number; email: number; organization: number }
  }
  updates?.activity('import', 'Checking selected columns and contact rows')
  const result = await run.call({
    operationId: 'convert-rows',
    slot: 'converter',
    intent: 'Validate column selection and contact rows',
    input: { headers, rows, mapping },
  })
  run.signal.throwIfAborted()
  if (result.outcome !== 'done') {
    updates?.notice(
      'Contact conversion could not complete. No preview is ready; inspect the retained result.',
      'error',
    )
    mappingReport?.update(mappingView(headers, rows.length, result))
    acceptedReport?.update(contactsView(result, true))
    rejectedReport?.update(contactsView(result, false))
    return result
  }
  await writeFile(
    join(preview.path, 'preview.json'),
    JSON.stringify(result.output, null, 2) + '\n',
    { flag: 'wx' },
  )
  const output = result.output as { status: string; rejected: unknown[] }
  if (output.status === 'needs_mapping')
    updates?.notice(
      'Choose three distinct existing columns before a contact preview can be prepared.',
      'warning',
    )
  else if (output.rejected.length)
    updates?.notice(
      `${output.rejected.length} records were excluded by the row checks. Review Rejected rows.`,
      'warning',
    )
  mappingReport?.update(mappingView(headers, rows.length, result))
  acceptedReport?.update(contactsView(result, true))
  rejectedReport?.update(contactsView(result, false))
  return result
}
