import type { Block, ViewItem } from '@jigging/user-updates'
import { privateCliValueFields } from './cli-value-presentation.js'
import type { PrivateSavedResult } from './internal/saved-result.js'
import type { JsonValue } from './json.js'
import { privateUpdateText } from './private-terminal-text.js'

function object(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function recordedFields(packet: PrivateSavedResult): { text: string; omitted: boolean } {
  const fields: Record<string, JsonValue> = {}
  let omitted = false
  for (const key of [
    'status',
    'outcome',
    'code',
    'message',
    'output',
    'details',
    'cleanup',
    'command',
  ]) {
    const value = packet.record[key]
    if (value === undefined) continue
    if (JSON.stringify(value).length <= 8192) fields[key] = value
    else if (object(value)) {
      const brief: Record<string, JsonValue> = {}
      for (const [name, item] of Object.entries(value)) {
        if (item !== null && typeof item === 'object') continue
        if (Object.keys(brief).length === 8) break
        if (JSON.stringify({ ...brief, [name]: item }).length <= 8192) brief[name] = item
      }
      if (Object.keys(brief).length) fields[key] = brief
      omitted = true
    } else omitted = true
  }
  return { text: privateCliValueFields(fields, 0), omitted }
}
function recordedDiagnostics(packet: PrivateSavedResult): string {
  const aggregate = packet.record.runDiagnostics
  const entries = object(aggregate) && Array.isArray(aggregate.entries) ? aggregate.entries : []
  const lines: string[] = []
  const root = packet.record.diagnostics
  const kept = entries.slice(0, 32)
  if (object(aggregate) && aggregate.truncated === true)
    lines.push('The recorded diagnostic capture was incomplete.')
  if (entries.length > kept.length)
    lines.push('Recorded diagnostic entries are omitted from this human view; see result.json.')
  // Only a rendered exact root duplicate replaces the separate root envelope.
  if (
    object(root) &&
    typeof root.stderr === 'string' &&
    !kept.some(
      (entry) =>
        object(entry) &&
        typeof entry.stderr === 'string' &&
        Array.isArray(entry.operations) &&
        entry.operations.length === 0 &&
        ['stderr', 'stderrBytes', 'stderrTruncated'].every((key) => entry[key] === root[key]),
    )
  )
    lines.push(
      `Recorded root diagnostic:\n${root.stderrTruncated === true ? 'Recorded root capture was truncated.\n' : ''}${root.stderr}`,
    )
  for (const entry of kept) {
    if (!object(entry) || typeof entry.stderr !== 'string') continue
    const path = Array.isArray(entry.operations)
      ? entry.operations.filter((part) => typeof part === 'string').join(' / ')
      : 'unattributed'
    lines.push(
      `Recorded path: ${path || 'root'}\n${entry.stderrTruncated === true ? 'Recorded capture was truncated.\n' : ''}${entry.stderr}`,
    )
  }
  return lines.join('\n\n') || 'No diagnostic text was recorded.'
}

function excerpt(text: string, bytes: number): { text: string; clipped: boolean } {
  const encoded = Buffer.from(text)
  const value = new TextDecoder().decode(encoded.subarray(0, bytes), { stream: true })
  return { text: value, clipped: encoded.length > bytes }
}
function reports(text: string, maximum = 16_384): Block[] {
  // Retained view capacity counts serialized JSON, including escaped controls.
  const scalars: string[] = []
  let bytes = 0,
    clipped = false
  for (const scalar of text) {
    const size = Buffer.byteLength(JSON.stringify(scalar)) - 2
    if (bytes + size > maximum) {
      clipped = true
      break
    }
    scalars.push(scalar)
    bytes += size
  }
  const result: Block[] = []
  for (let offset = 0; offset < scalars.length; offset += 4096)
    result.push({ kind: 'report', text: scalars.slice(offset, offset + 4096).join('') })
  if (clipped)
    result.push({
      kind: 'report',
      text: 'This human excerpt is clipped. Inspect result.json or use jig inspect --result DIRECTORY --json for the complete recorded value.',
    })
  return result.length ? result : [{ kind: 'report', text: 'No recorded content.' }]
}
export function privateSavedResultViews(packet: PrivateSavedResult): ViewItem[] {
  const report = recordedFields(packet)
  const reportBlocks = reports(report.text)
  if (report.omitted)
    reportBlocks.push({
      kind: 'report',
      text: 'Large or nested recorded fields are omitted from this human excerpt. Its complete exact JSON is available in result.json or JSON inspection.',
    })
  const result: ViewItem[] = [
    {
      kind: 'view',
      id: 'recorded-result',
      title: 'Recorded result',
      summary:
        'Local recorded claims. Nothing is running; live views and history were not retained.',
      sections: [{ title: 'Recorded report', blocks: reportBlocks }],
    },
    {
      kind: 'view',
      id: 'files',
      title: 'Files',
      summary: packet.complete
        ? 'Captured files match this recorded manifest. Long table names are clipped; preview references retain each full path. File consistency does not authenticate the report.'
        : packet.finding!,
      sections: [
        {
          blocks: [
            {
              kind: 'collection',
              id: 'packet-files',
              title: 'Recorded files',
              columns: [
                { key: 'path', label: 'File', type: 'text' },
                { key: 'bytes', label: 'Bytes', type: 'number' },
                { key: 'captured', label: 'Capture', type: 'text' },
                { key: 'preview', label: 'Preview', type: 'reference' },
              ],
              rows: packet.files.map((file, index) => {
                const name = excerpt(file.path, 80)
                return {
                  id: `file-${index}`,
                  cells: {
                    path: name.clipped ? `${name.text} [clipped]` : name.text,
                    bytes: file.bytes,
                    captured: file.available ? 'Matches manifest' : 'Unavailable',
                    preview: file.available
                      ? { kind: 'artifact', attachment: 'packet', path: file.path }
                      : null,
                  },
                }
              }),
              total: packet.files.length,
            },
          ],
        },
      ],
    },
    {
      kind: 'view',
      id: 'diagnostics',
      title: 'Diagnostics',
      summary:
        'Recorded diagnostic text and attribution are local claims, not current host observations.',
      sections: [{ blocks: reports(recordedDiagnostics(packet), 8192) }],
    },
  ]
  return result
}

/** Literal data path: this text never goes through trusted command recognition. */
export function privateSavedResultPlain(packet: PrivateSavedResult): string {
  const report = recordedFields(packet)
  const source = privateUpdateText(JSON.stringify(packet.directory))
  let text = `Recorded result\n\n  Selected packet: ${source}\n  Local recorded claims; consistency does not authenticate the report.\n  No work was started. Live views and history were not retained.\n  File verification: ${packet.complete ? 'consistent' : 'incomplete'}.\n\n`
  let remaining = 24_000 - Buffer.byteLength(text)
  // Charge escaped bytes, preserving scalar boundaries and a bounded final write.
  for (const scalar of report.text) {
    const escaped = privateUpdateText(scalar)
    const bytes = Buffer.byteLength(escaped)
    if (bytes > remaining) {
      remaining = -1
      break
    }
    text += escaped
    remaining -= bytes
  }
  if (remaining < 0 || report.omitted)
    text +=
      '\n\n  Recorded content clipped in this human view. Read result.json or use --json for its complete recorded value.'
  const diagnostics = excerpt(privateUpdateText(recordedDiagnostics(packet)), 4096)
  text += '\n\nRecorded diagnostics\n\n' + diagnostics.text
  if (diagnostics.clipped) text += '\n[Diagnostic excerpt clipped; see result.json.]'
  return text + '\n'
}
