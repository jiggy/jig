import { parse } from 'csv-parse/sync'

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
    headers.some((heading) => !heading.trim() || heading.length > 80) ||
    new Set(headers.map((heading) => heading.trim().toLowerCase())).size !== headers.length
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
