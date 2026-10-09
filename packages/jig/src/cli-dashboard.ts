import { StringDecoder } from 'node:string_decoder'
import type { Block, DetailBlock, Reference, Value } from '@jigging/user-updates'
import { privateCliHeading, privateCliSecondary, privateCliSelection } from './cli-presentation.js'
import {
  type PrivateRunModel,
  type PrivateWorkspaceRecord,
  privateAttentionImportance,
  privateRecordReferences,
} from './cli-run-model.js'
import { privatePresentationNow } from './internal/root-run-timeout-policy.js'
import {
  privateTerminalWidth,
  privateTruncateUpdate,
  privateUpdateText,
  privateWrappedUpdate,
} from './private-terminal-text.js'

type ScrollAnchor = { key: string; offset: number }
export interface PrivateDashboardFrame {
  readonly lines: readonly string[]
  readonly references: readonly Reference[]
  readonly scroll?: number
  readonly anchor?: ScrollAnchor
}
const scalar = (value: Value): string =>
  value === null
    ? 'Unknown'
    : typeof value === 'object'
      ? 'Reference'
      : privateUpdateText(String(value))
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
function wrap(text: string, width: number): string[] {
  const result: string[] = []
  for (const line of privateUpdateText(text).split('\n')) {
    let current = '',
      cells = 0
    for (const { segment } of segmenter.segment(line)) {
      const size = privateTerminalWidth(segment)
      if (current && cells + size > width) {
        result.push(current)
        current = ''
        cells = 0
      }
      if (size > width) {
        result.push(privateTruncateUpdate(segment, width))
        continue
      }
      current += segment
      cells += size
    }
    result.push(current)
  }
  return result
}

/** Portable blocks have no terminal-specific callbacks, styling or executable content. */
function privateInlineFrame(
  model: PrivateRunModel,
  width: number,
  height: number,
  color = false,
  scroll = 0,
  retainedAnchor?: ScrollAnchor,
): PrivateDashboardFrame {
  width = Math.max(1, Math.min(4096, width - 1))
  height = Math.max(3, Math.min(100, height))
  const lines: string[] = [],
    references: Reference[] = []
  let anchor: number | undefined
  const anchors: { key: string; line: number }[] = []
  const add = (text: string) => lines.push(...wrap(text, width))
  const ref = (publisher: string, r: Reference) => {
    const resolved = model.resolve(publisher, r)
    references.push(r)
    return `[${references.length}] ${resolved.label}`
  }
  const value = (publisher: string, v: Value) =>
    v !== null && typeof v === 'object' ? ref(publisher, v) : scalar(v)
  const blocks = (publisher: string, bs: readonly (Block | DetailBlock)[]) => {
    for (const b of bs)
      switch (b.kind) {
        case 'report':
          add(b.text)
          for (const r of b.references ?? []) add(ref(publisher, r))
          break
        case 'facts':
          for (const f of b.items) add(`${f.label}: ${value(publisher, f.value)}`)
          break
        case 'progress': {
          const counts = `${b.completed}${b.total === undefined ? '' : ` / ${b.total}`}${b.unit === undefined ? '' : ` ${b.unit}`}`
          if (b.total && width >= 35) {
            const cells = Math.max(4, Math.min(20, width - 25)),
              filled = Math.floor((b.completed / b.total) * cells)
            add(`${b.label}: [${'='.repeat(filled)}${' '.repeat(cells - filled)}] ${counts}`)
          } else add(`${b.label}: ${counts}`)
          break
        }
        case 'collection': {
          add(
            `${b.title} — ${b.rows.length} supplied${b.total === undefined ? '' : ` / ${b.total} reported`} records`,
          )
          const rows = b.rows
          if (!rows.length) add('No supplied records in this view')
          for (const row of rows.slice(0, 4)) {
            anchors.push({
              key: JSON.stringify([model.selected?.key, b.id, row.id]),
              line: lines.length,
            })
            add(
              `  ${b.columns.map((c) => `${c.label}: ${value(publisher, row.cells[c.key] ?? null)}`).join(' | ')}`,
            )
            blocks(publisher, row.details ?? [])
          }
          if (rows.length > 4)
            add(`${rows.length - 4} more supplied records; use --display dashboard to inspect`)
          break
        }
      }
  }
  const selected = model.selected
  const title = selected
    ? `${model.sourceLabel(selected.publisher)} / ${selected.value.title}`
    : 'Run overview'
  lines.push(privateCliHeading(privateUpdateText(title), 'info', color))
  if (model.incomplete) add(model.incomplete)
  add(model.context)
  const sticky = model.sticky
  if (sticky && height <= 6) {
    const cause = wrap(sticky.text, width)
    const content = [
      privateTruncateUpdate(
        model.incomplete ?? `Attention (${privateUpdateText(sticky.source)})`,
        width,
      ),
      ...cause.slice(0, height - 2),
      privateTruncateUpdate(
        sticky.committed
          ? '[Full report in transcript]'
          : '[Transcript incomplete; retained cause shown here]',
        width,
      ),
    ]
    return { lines: content, references: [] }
  }
  if (sticky) {
    const cause = wrap(`Attention (${sticky.source}): ${sticky.text}`, width)
    const room = Math.max(1, Math.min(5, Math.floor(height / 3)))
    lines.push(...cause.slice(0, room))
    if (cause.length > room)
      add(
        sticky.committed
          ? '[Cause clipped; full report in transcript]'
          : '[Cause clipped; transcript incomplete]',
      )
    if (model.attention.length > 1)
      add(
        `${model.attention.length - 1} additional reports${model.attention.some((a) => !a.committed) ? '; transcript incomplete' : ' in the transcript'}`,
      )
  }
  const shellLength = lines.length
  if (selected) {
    if (selected.value.operationId)
      add(
        `Associated call: ${model.resolve(selected.publisher, { kind: 'call', operationId: selected.value.operationId }).label}`,
      )
    add(selected.value.summary)
    if (selected.ended)
      add(`${selected.ended}; last update ${new Date(selected.updated).toISOString()}`)
    for (const section of selected.value.sections) {
      if (section.title) add(section.title)
      blocks(selected.publisher, section.blocks)
    }
  } else {
    const nodes = [...model.calls.values()]
    const children = new Map<string | undefined, typeof nodes>()
    for (const node of nodes) {
      const list = children.get(node.parent) ?? []
      list.push(node)
      children.set(node.parent, list)
    }
    const draw = (parent: string | undefined, depth: number) => {
      for (const n of children.get(parent) ?? []) {
        anchors.push({ key: n.key, line: lines.length })
        const status = {
          requested: 'requested; not started',
          active: 'running',
          'cancel-requested': 'cancellation requested',
          returned: 'returned',
          failed: 'failed / refused',
          uncertain: 'uncertain',
        }[n.state]
        if (model.focusedCall === n.key) anchor = lines.length
        add(
          `${model.focusedCall === n.key ? '> ' : ''}${'  '.repeat(depth)}${depth ? '└─ ' : '• '}${n.slot} — ${status}${n.intent ? `: ${n.intent}` : ''}`,
        )
        if (n.cause) add(`${'  '.repeat(depth + 1)}Cause: ${n.cause}`)
        if (depth < 32) draw(n.key, depth + 1)
      }
    }
    if (!nodes.length) add('Waiting for observed calls or application views')
    draw(undefined, 0)
    if (model.omissions) add(`${model.omissions} call observations omitted`)
    for (const { publisher, value: activity } of model.activities.values()) {
      add(`${model.sourceLabel(publisher)}: ${activity.label}`)
      if (activity.operationId)
        add(
          `Associated call: ${model.resolve(publisher, { kind: 'call', operationId: activity.operationId }).label}`,
        )
      if (activity.detail) add(activity.detail)
    }
  }
  if (model.preview) {
    add(
      `Immutable ${model.workspace.recorded ? 'recorded-file' : 'delivered-file'} preview: ${model.previewTitle ?? 'verified capture'}${model.preview.clipped ? ' — clipped at 64 KiB' : ''}`,
    )
    add(model.preview.text)
  }
  if (model.feedback) add(model.feedback)
  const footer = 'Read-only observations · --display dashboard opens the inspector'
  const footerLines = wrap(footer, width).slice(0, Math.max(1, Math.min(2, height - 2)))
  const available = Math.max(1, height - footerLines.length)
  let projection = lines
  let offset = 0,
    viewportAnchor: ScrollAnchor | undefined
  if (lines.length > available) {
    const shell = lines.slice(0, Math.min(shellLength, Math.max(1, available - 2)))
    const body = lines.slice(shellLength)
    const bodyRoom = Math.max(1, available - shell.length - 1)
    const follow =
      anchor === undefined || anchor - shellLength < bodyRoom
        ? 0
        : Math.max(0, anchor - shellLength - Math.floor(bodyRoom / 3))
    const retained =
      retainedAnchor === undefined ? undefined : anchors.find((a) => a.key === retainedAnchor.key)
    offset = Math.max(
      0,
      Math.min(
        retained ? retained.line - shellLength + retainedAnchor!.offset : scroll || follow,
        Math.max(0, body.length - bodyRoom),
      ),
    )
    const first =
      anchors.filter((a) => a.line <= offset + shellLength).at(-1) ??
      anchors.find((a) => a.line >= offset + shellLength)
    if (first) viewportAnchor = { key: first.key, offset: offset + shellLength - first.line }
    projection = [
      ...shell,
      ...body.slice(offset, offset + Math.max(0, available - shell.length - 1)),
      '[More content; full summaries and reports remain in the transcript]',
    ]
  }
  const rendered = [...projection.slice(0, available), ...footerLines].slice(0, height)
  let bytes = 0
  const bounded: string[] = []
  for (const line of rendered) {
    const n = Buffer.byteLength(line) + 1
    if (bytes + n > 32000) {
      bounded.push('[Projection clipped; use the transcript]')
      break
    }
    bounded.push(line)
    bytes += n
  }
  return {
    lines: bounded.map((line) => privateTruncateStyled(line, width)),
    references,
    scroll: offset,
    ...(viewportAnchor ? { anchor: viewportAnchor } : {}),
  }
}
function privateTruncateStyled(text: string, width: number): string {
  // Styled headings are host-owned and short. Width measurements ignore escapes.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip host ANSI styling for terminal cell measurement.
  const plain = text.replace(/\u001b\[[0-9;]*m/g, '')
  return privateTerminalWidth(plain) <= width ? text : privateTruncateUpdate(plain, width)
}

export type PrivateDashboardPanel =
  | { kind: 'detail'; key: string; signature: string; scroll: number }
  | { kind: 'preview'; scroll: number; query?: string; matchOffset?: number }
  | { kind: 'preview-search'; draft: string; signature: string }
  | { kind: 'attention'; index: number; scroll: number }
  | { kind: 'diagnostics'; index: number; scroll: number }
  | { kind: 'references'; selected?: string | undefined; origin: string }
  | { kind: 'filter'; draft: string; collection: string }
  | { kind: 'help'; scroll: number }
export type PrivateDashboardState = { readonly panels: readonly PrivateDashboardPanel[] }
const referenceKey = (ref: Reference): string =>
  JSON.stringify(
    ref.kind === 'call'
      ? ['call', ref.operationId]
      : ref.kind === 'record'
        ? ['record', ref.viewId, ref.collectionId, ref.rowId]
        : ['artifact', ref.attachment, ref.path],
  )
const cell = (value: Value): string =>
  value === null
    ? 'null'
    : typeof value === 'object'
      ? 'Reference'
      : privateUpdateText(String(value))
const displayCell = (model: PrivateRunModel, publisher: string, value: Value): string =>
  value !== null && typeof value === 'object'
    ? privateUpdateText(model.resolve(publisher, value).label)
    : cell(value)
export function privateDashboardReferences(
  record: PrivateWorkspaceRecord | undefined,
): Reference[] {
  return privateRecordReferences(record)
}

function progressText(block: Extract<DetailBlock, { kind: 'progress' }>, width: number): string {
  const count = `${block.completed}${block.total === undefined ? '' : ` / ${block.total}`}${block.unit ? ` ${privateUpdateText(block.unit)}` : ''}`
  if (block.total && width >= 40) {
    const size = Math.max(4, Math.min(12, width - 30)),
      filled = Math.floor((block.completed / block.total) * size)
    return `${privateUpdateText(block.label)} [${'='.repeat(filled)}${' '.repeat(size - filled)}] ${count}`
  }
  return `${privateUpdateText(block.label)} ${count}`
}
/** The list owns identity and a short observation; details add context or evidence.
 * Typed parts are private presentation data, not a new author-facing contract. */
export function privateDashboardPreviewState(model: PrivateRunModel): string {
  return model.previewState === 'empty'
    ? 'This captured text file is empty.'
    : model.previewState === 'non-text'
      ? 'This captured file is not available as a UTF-8 text preview.'
      : model.previewState === 'unavailable'
        ? 'Immutable content is unavailable.'
        : model.previewState === 'pending'
          ? 'Delivery is pending; no captured bytes are available yet.'
          : 'Loading immutable captured content…'
}
export type PrivateDashboardDetailPart =
  | { kind: 'heading' | 'text' | 'note' | 'value'; text: string }
  | { kind: 'field'; label: string; value: Value }

export function privateDashboardDetailParts(
  model: PrivateRunModel,
  record: PrivateWorkspaceRecord,
  preview = false,
  includeArtifactContent = true,
): PrivateDashboardDetailPart[] {
  const parts: PrivateDashboardDetailPart[] = []
  const text = (value: string, kind: 'text' | 'note' | 'value' = 'text') => {
    if (value) parts.push({ kind, text: value })
  }
  const heading = (value: string) => parts.push({ kind: 'heading', text: value })
  const field = (label: string, value: Value) => parts.push({ kind: 'field', label, value })
  const block = (b: DetailBlock) => {
    if (b.kind === 'report') {
      text(
        b.text,
        model.workspace.recorded && record.collection?.id === 'recorded-fields' ? 'value' : 'text',
      )
      for (const ref of b.references ?? []) field('Evidence', ref)
    } else if (b.kind === 'facts') {
      for (const item of b.items) field(item.label, item.value)
    } else {
      field(
        b.label,
        `${b.completed}${b.total === undefined ? '' : ` / ${b.total}`}${b.unit ? ` ${b.unit}` : ''}`,
      )
    }
  }
  const remainder = (value: string) => {
    const first = value.split('\n')[0] ?? ''
    // A shortened teaser must never discard its full literal source.
    text(
      privateTruncateUpdate(first, 120) !== privateUpdateText(first)
        ? value
        : value.slice(first.length).replace(/^\n/, ''),
    )
  }
  const artifact = privateDashboardReferences(record)
  if (
    includeArtifactContent &&
    model.previewState &&
    record.key === model.record?.key &&
    (record.file || (artifact.length === 1 && artifact[0]?.kind === 'artifact'))
  ) {
    heading(model.previewTitle ?? 'Immutable captured content')
    text(model.preview?.text ?? privateDashboardPreviewState(model))
    text(
      `${model.artifactCapture.provenance === 'recorded-capture' ? 'Recorded capture' : 'Verified delivery'}${model.preview ? ` · ${model.preview.bytes} bytes${model.preview.clipped ? ' · excerpt clipped at 64 KiB' : ''}` : ''}`,
      'note',
    )
  }
  if (record.file) {
    heading(record.file.path)
    field(
      'Capture',
      model.artifactCapture.provenance === 'recorded-capture'
        ? 'Recorded capture'
        : 'Verified delivery',
    )
    field('Bytes', record.file.bytes)
    field('Content', record.file.state)
    if (record.file.clipped) text('The retained excerpt is clipped.', 'note')
    if (!model.previewState) text('Enter previews this immutable captured file.', 'note')
  }
  if (record.text !== undefined && !record.journalGroup && !record.file) remainder(record.text)
  if (record.journalGroup) {
    heading('Stage history')
    for (const entry of record.journalGroup) text(entry.text)
  }
  if (record.block?.kind === 'report') {
    remainder(record.block.text)
    for (const ref of record.block.references ?? []) field('Evidence', ref)
  } else if (record.block?.kind === 'facts') block(record.block)
  else if (record.block?.kind === 'progress')
    text(
      'These are publisher-reported counts. Reaching the total does not establish the application outcome.',
      'note',
    )
  if (record.collection && record.row) {
    for (const b of record.row.details ?? []) block(b)
    const columns = preview ? record.collection.columns.slice(3) : record.collection.columns
    if (columns.length) {
      heading(preview ? 'Additional fields' : 'Record fields')
      for (const column of columns) field(column.label, record.row.cells[column.key] ?? null)
    }
  } else if (record.collection)
    text(
      record.collection.rows.length
        ? 'No matching supplied records; / edits the filter'
        : 'No supplied records',
      'note',
    )
  if (record.activity) {
    if (record.activity.detail) text(record.activity.detail)
    if (record.activity.progress)
      block({ kind: 'progress', label: 'Reported count', ...record.activity.progress })
    if (record.activity.operationId)
      field('Associated call', { kind: 'call', operationId: record.activity.operationId })
  }
  if (record.journal) {
    remainder(record.journal.text)
    if (record.journal.operationsPath)
      field('Invocation path', record.journal.operationsPath.join(' / ') || '(root)')
    if (record.journal.kind === 'diagnostic')
      text('Diagnostic importance was not supplied.', 'note')
    if (record.journal.clipped) text('Diagnostic capture was truncated.', 'note')
  }
  if (record.call) {
    const n = record.call
    heading('Call observation')
    text(
      {
        requested: 'The caller requested this invocation. Execution has not been observed yet.',
        active: 'This invocation is running. Its result has not returned to the caller.',
        'cancel-requested': 'Cancellation was requested. Settlement and cleanup are still pending.',
        returned:
          'The invocation returned to its caller. This observation does not establish whether the application checks passed.',
        failed:
          'The host observed an invocation failure. The known cause is shown below when available.',
        uncertain:
          'The invocation could not be confirmed. Inspect its cause and effects before starting new work.',
      }[n.state],
    )
    if (n.cause) {
      heading('Reported cause')
      text(n.cause)
    }
    const observed = new Date(n.time)
    field(
      'Last observed',
      Number.isFinite(observed.getTime())
        ? observed
            .toISOString()
            .replace('T', ' ')
            .replace(/\.\d{3}Z$/, ' UTC')
        : 'Time unavailable',
    )
    const descendants = model.descendants(n.key)
    if (descendants.length)
      field(
        'Child calls',
        `${descendants.length} observed; ${descendants.filter((c) => c.state === 'failed' || c.state === 'uncertain').length} failed or uncertain`,
      )
    if (!preview) {
      heading('Invocation identity')
      if (n.intent !== undefined) field('Caller intent', n.intent)
      field('Reviewed slot', n.slot)
      field('Original operation', n.operationId)
      field('Host lifecycle', n.state)
    }
  }
  return parts
}

export function* privateDashboardDetailLines(
  model: PrivateRunModel,
  record: PrivateWorkspaceRecord,
  width: number,
  preview = false,
): Generator<string> {
  if (!preview)
    yield `${record.publisher ? model.sourceLabel(record.publisher) : (record.journal?.source ?? 'Jig')} · detail`
  const parts = privateDashboardDetailParts(model, record, preview)
  if (!parts.length) {
    yield 'No additional detail was supplied. This entry is shown in full in the list.'
    return
  }
  for (const part of parts) {
    const text =
      part.kind === 'field'
        ? `${part.label}: ${typeof part.value === 'object' && part.value !== null ? model.resolve(record.publisher ?? 'root', part.value).label : String(part.value)}`
        : part.text
    yield* privateWrappedUpdate(text, width, true)
  }
}

function tableColumns(
  model: PrivateRunModel,
  publisher: string,
  collection: NonNullable<PrivateWorkspaceRecord['collection']>,
  rows: NonNullable<PrivateWorkspaceRecord['collection']>['rows'],
  width: number,
) {
  const columns: { key: string; label: string; size: number; natural: number; numeric: boolean }[] =
    []
  let remaining = Math.max(0, width - 2)
  for (const column of collection.columns) {
    const natural = Math.max(
      privateTerminalWidth(privateUpdateText(column.label)),
      ...rows.map((row) =>
        privateTerminalWidth(displayCell(model, publisher, row.cells[column.key] ?? null)),
      ),
      4,
    )
    const minimum = Math.min(12, Math.max(4, privateTerminalWidth(column.label)))
    if (remaining < minimum + (columns.length ? 3 : 0)) break
    const size = minimum
    columns.push({
      key: column.key,
      label: privateUpdateText(column.label),
      size,
      natural: Math.min(width, natural),
      numeric: column.type === 'number',
    })
    remaining -= size + (columns.length > 1 ? 3 : 0)
  }
  // Reserve every visible column before sharing spare cells. Long early values
  // must not starve later columns, and wide terminals should use their width.
  while (remaining > 0) {
    let grown = false
    for (const column of columns) {
      if (!remaining) break
      if (column.size >= column.natural) continue
      column.size++
      remaining--
      grown = true
    }
    if (!grown) break
  }
  const hidden = collection.columns.length - columns.length
  return { columns, hidden }
}
const aligned = (text: string, size: number, right = false) => {
  const bounded = privateTruncateUpdate(text, size, 1024),
    padding = ' '.repeat(Math.max(0, size - privateTerminalWidth(bounded)))
  return right ? padding + bounded : bounded + padding
}
function tabs(model: PrivateRunModel, width: number): string {
  const entries = [
    ...(model.workspace.recorded
      ? []
      : [
          { key: 'activity', label: 'Activity' },
          { key: 'overview', label: 'Overview' },
          { key: 'files', label: 'Delivered files' },
        ]),
    ...[...model.views.values()].map((v) => ({
      key: v.key,
      label: model.workspace.recorded
        ? privateUpdateText(v.value.title)
        : `${model.sourceLabel(v.publisher)}: ${privateUpdateText(v.value.title)}`,
    })),
  ]
  const current = entries.findIndex((e) => e.key === model.surface)
  const all = entries
    .map((entry, index) => (index === current ? `[${entry.label}]` : entry.label))
    .join(' | ')
  if (privateTerminalWidth(all) <= width) return all
  return privateTruncateUpdate(
    `${current + 1}/${entries.length} [${entries[current]?.label ?? 'Activity'}]  Tab views`,
    width,
  )
}
const duration = (ms: number) => `${Math.max(0, Math.floor(ms / 1000))}s`
type WorkspaceTone = 'heading' | 'secondary' | 'warning' | 'error' | 'success' | 'selection'
const attentionTone = (priority: number): WorkspaceTone =>
  priority === 2 || priority >= 4 ? 'error' : 'warning'
/** Bounded textual projection for inline output, compact native surfaces and
 * navigation overlays. This projection owns no terminal or renderer lifetime. */
export function privateDashboardFrame(
  model: PrivateRunModel,
  width: number,
  height: number,
  color = false,
  inspecting = false,
  scroll = 0,
  retainedAnchor?: ScrollAnchor,
  state?: PrivateDashboardState,
): PrivateDashboardFrame {
  if (width < 1 || height < 1) return { lines: [], references: [] }
  if (!inspecting) return privateInlineFrame(model, width, height, color, scroll, retainedAnchor)
  model.peekSelectedArtifact()
  width = Math.max(1, Math.min(4096, Math.floor(width)))
  height = Math.max(1, Math.min(100, Math.floor(height)))
  const panels = state?.panels ?? [],
    panel = panels.at(-1),
    compact = width < 40 || height < 10
  const lines: string[] = [],
    references = privateDashboardReferences(model.record)
  let frameBytes = 0,
    clipped = false
  const commit = (rendered: string) => {
    const bytes = Buffer.byteLength(rendered) + 1
    if (lines.length >= height || frameBytes + bytes > 32000) {
      clipped = true
      return false
    }
    lines.push(rendered)
    frameBytes += bytes
    return true
  }
  const paint = (plain: string, tone?: WorkspaceTone, secondaryPrefix?: string) => {
    // Only host-owned roles add SGR, after payload escaping and cell/byte truncation.
    const prefixLength = secondaryPrefix
      ? privateUpdateText(secondaryPrefix).replaceAll('\n', '\\n').length
      : 0
    return tone === 'secondary'
      ? privateCliSecondary(plain, color)
      : tone === 'selection'
        ? privateCliSelection(plain, color)
        : tone
          ? privateCliHeading(plain, tone === 'heading' ? 'info' : tone, color)
          : prefixLength
            ? privateCliSecondary(plain.slice(0, prefixLength), color) + plain.slice(prefixLength)
            : plain
  }
  const add = (text: string, tone?: WorkspaceTone, secondaryPrefix?: string) => {
    if (lines.length >= height) return false
    const plain = privateTruncateUpdate(
      privateUpdateText(text).replaceAll('\n', '\\n'),
      width,
      Math.max(3, Math.min(4096, 32000 - frameBytes - 64)),
    )
    return commit(paint(plain, tone, secondaryPrefix))
  }
  const target = `Jig · ${privateUpdateText(model.workspace.target)}`
  const phase =
    model.workspace.phase === 'settled'
      ? model.workspace.recorded
        ? 'Saved result · read-only'
        : 'Settled · read-only'
      : privateUpdateText(model.workspace.hostStage)
  const time = `elapsed ${duration((model.workspace.settledAt ?? model.workspace.now ?? privatePresentationNow()) - model.workspace.startedAt)} · execution limit ${model.workspace.limitMs === undefined ? 'unspecified' : duration(model.workspace.limitMs)}`
  const sticky = model.sticky
  const diagnostics = model.journal.filter((entry) => entry.kind === 'diagnostic')
  const omittedDiagnostics = model.journalOmitted.diagnostic
  const diagnosticLoss = omittedDiagnostics
    ? `Diagnostic history incomplete: ${omittedDiagnostics} report updates omitted.`
    : ''
  const facts = model.workspace.facts
  const compactLoss = omittedDiagnostics
    ? width < 28
      ? `d: omitted (${omittedDiagnostics})`
      : `${omittedDiagnostics} diagnostic updates omitted · d reports`
    : facts?.completeness &&
        facts.completeness !== 'observation ended' &&
        facts.completeness !== 'files match the recorded manifest'
      ? `Evidence: ${facts.completeness}`
      : ''
  const attentionPrefix = sticky
    ? `! full cause${model.attention.length > 1 ? ` (+${model.attention.length - 1})` : ''} · ${privateUpdateText(sticky.source)} · ${privateAttentionImportance(sticky.priority)}`
    : ''
  const attention = sticky
    ? `${privateTruncateUpdate(attentionPrefix, Math.max(1, width - Math.min(20, Math.floor(width / 3)) - 2))}: ${privateUpdateText(sticky.text).split('\n')[0]}`
    : model.incomplete
      ? `! ${privateUpdateText(model.incomplete)} · ! attention`
      : ''
  if (compact) {
    add(
      `${privateTruncateUpdate(target, Math.max(1, width - 15))} · ${privateTruncateUpdate(phase, 12)}`,
      'heading',
    )
    if (height >= 4 && !panel && !(attention && compactLoss && height === 4))
      add(model.workspace.recorded ? 'Recorded local data' : time, 'secondary')
    if (attention && lines.length < height - 1) add(attention, attentionTone(sticky?.priority ?? 3))
    if (compactLoss && lines.length < height - 1) add(`! ${compactLoss}`, 'warning')
  } else {
    const stage = privateTruncateUpdate(phase, Math.max(12, Math.floor(width / 3)))
    add(
      `${privateTruncateUpdate(target, Math.max(1, width - privateTerminalWidth(stage) - 3))} · ${stage}`,
      'heading',
    )
    add(model.workspace.recorded ? 'Recorded local data' : time, 'secondary')
    add(tabs(model, width), 'heading')
    if (attention) add(attention, attentionTone(sticky?.priority ?? 3))
    if (diagnostics.length || omittedDiagnostics)
      add(
        `d diagnostics · ${diagnostics.length} invocation ${diagnostics.length === 1 ? 'report' : 'reports'}${omittedDiagnostics ? ` · ${omittedDiagnostics} updates omitted` : ''} · severity not supplied`,
        'secondary',
      )
  }
  if (!compact && model.workspace.phase === 'settled' && facts) {
    const left = Math.max(1, Math.floor((width - 3) / 2)),
      right = Math.max(1, width - left - 3)
    const fact = (
      label: string,
      value: string,
      size: number,
      tone?: 'success' | 'warning' | 'error',
    ) => {
      const text = privateTruncateUpdate(
        `${label} ${privateUpdateText(value).replaceAll('\n', '\\n')}`,
        size,
        4096,
      )
      return tone ? privateCliHeading(text, tone, color) : text
    }
    const recorded = model.workspace.recorded
    commit(
      `${fact(recorded ? 'Recorded execution' : 'Execution', facts.execution, left, recorded ? undefined : facts.execution === 'succeeded' ? 'success' : facts.execution === 'failed' ? 'error' : facts.execution === 'lost' ? 'warning' : undefined)} · ${fact(recorded ? 'Recorded application' : 'Application', facts.application, right)}`,
    )
    commit(
      `${fact(recorded ? 'Recorded cleanup' : 'Cleanup', facts.cleanup, left, recorded ? undefined : facts.cleanup === 'complete' ? 'success' : facts.cleanup === 'unconfirmed' ? 'error' : undefined)} · ${fact(recorded ? 'Recorded delivery' : 'Delivery', facts.delivery, right, !recorded && facts.delivery === 'written' ? 'success' : undefined)}`,
    )
    if (facts.completeness && facts.completeness !== 'observation ended')
      add(`${recorded ? 'Recorded evidence' : 'Observation'} · ${facts.completeness}`, 'secondary')
  }
  if (!compact && lines.length < height - 2) add('─'.repeat(Math.min(width, 4096)), 'secondary')
  const footer = (
    panel?.kind === 'filter' || panel?.kind === 'preview-search'
      ? compact
        ? 'Enter set Esc undo'
        : 'Filter draft: Enter apply · Esc discard · Ctrl-C stop'
      : compact
        ? 'q inline ^C stop !'
        : panel?.kind === 'references'
          ? 'q continues inline · j/k choose · Enter activate · Esc back'
          : panel?.kind === 'attention'
            ? 'q continues inline · ←/→ causes · ↑/↓ scroll · Esc back'
            : panel?.kind === 'diagnostics'
              ? 'q continues inline · ←/→ reports · ↑/↓ scroll · Esc back'
              : panel?.kind === 'help'
                ? 'Esc back · q continues inline · Ctrl-C stop (live)'
                : panel?.kind === 'detail' || panel?.kind === 'preview'
                  ? 'q continues inline · ↑/↓ scroll · / excerpt search · r references · Esc back'
                  : compact
                    ? '! full cause · q continues inline · Ctrl-C stop'
                    : 'q continues inline · Tab · ↑↓ · Enter detail · r refs · ! cause · ? help'
  )
    .replaceAll(
      'q continues inline',
      model.workspace.phase === 'settled' ? 'q closes inspection' : 'q continues inline',
    )
    .replaceAll('q inline', model.workspace.phase === 'settled' ? 'q close' : 'q inline')
    .replaceAll('^C stop', model.workspace.phase === 'settled' ? '^C close' : '^C stop')
    .replaceAll(
      'Ctrl-C stop (live)',
      model.workspace.phase === 'settled' ? 'Ctrl-C closes' : 'Ctrl-C stops',
    )
    .replaceAll('Ctrl-C stop', model.workspace.phase === 'settled' ? 'Ctrl-C close' : 'Ctrl-C stop')
  const bodyRoom = Math.max(0, height - lines.length - 1)
  let offset = 0,
    anchor: ScrollAnchor | undefined
  if (bodyRoom) {
    if (panel) {
      let content: Iterable<string>
      const panelHeadingTone =
          panel.kind === 'references'
            ? undefined
            : panel.kind === 'attention'
              ? attentionTone((model.attention[panel.index] ?? sticky)?.priority ?? 3)
              : 'heading',
        selectedReference =
          panel.kind === 'references'
            ? references.findIndex((ref) => referenceKey(ref) === panel.selected)
            : -1
      if (panel.kind === 'preview-search')
        content = privateWrappedUpdate(
          `Search retained excerpt\nDraft: ${panel.draft}\nLiteral text only; no files or earlier content are fetched.\nEnter searches; Escape discards.`,
          width,
        )
      else if (panel.kind === 'filter')
        content = privateWrappedUpdate(
          `Filter supplied records\nDraft: ${panel.draft}\nApplied: ${model.filter || '(none)'}\nRows change only after Enter. Empty Enter clears.`,
          width,
        )
      else if (panel.kind === 'help')
        content = privateWrappedUpdate(
          panels.at(-2)?.kind === 'filter'
            ? 'Filter editing\nPrintable text is literal, including q j k s r ! ?.\nEnter applies; Escape discards; Backspace/Delete removes the last scalar.\nTab and arrow controls do nothing. Ctrl-C stops live work; Ctrl-D leaves.'
            : 'Workspace help\nTab / Shift-Tab: Activity, Overview, Delivered files and supplied views.\nArrows / j k: select each summary, report, facts, progress or collection row.\nEnter: full detail or captured file; Escape returns one level. Wide screens show selected detail alongside the list.\nc: next collection; /: edit a collection filter; s: sort supplied rows.\nr: choose a reference; Enter activates only in that chooser.\nLeft / Right: collapse or expand the actual tree; in attention or diagnostics choose reports.\nBrackets / PageUp / PageDown: body scroll; Home / End: list ends.\n!: full retained cause; d: attributed diagnostic reports; ?: this help.\nq: live continues inline; settled closes inspection. Ctrl-C: stop live work, close settled inspection.\nHost returns, application claims, cleanup and delivery remain separate.\nReports are literal; no application readiness is inferred.\nHistory and capture are bounded; omitted content is disclosed.',
          width,
        )
      else if (panel.kind === 'attention') {
        const report = model.attention[panel.index] ?? sticky
        content = report
          ? privateWrappedUpdate(
              `${report.source} — ${privateAttentionImportance(report.priority)} (${panel.index + 1}/${model.attention.length})\n${report.text}`,
              width,
            )
          : privateWrappedUpdate(model.incomplete ?? 'No retained causes', width)
      } else if (panel.kind === 'diagnostics') {
        const report = diagnostics[panel.index]
        content = report
          ? privateWrappedUpdate(
              `Diagnostic report ${panel.index + 1}/${diagnostics.length}\nInvocation: ${report.operationsPath?.join(' / ') || '(root)'}\nSeverity was not supplied by the producer.${diagnosticLoss ? `\n${diagnosticLoss}` : ''}\n\n${report.text}${report.clipped ? '\n[Diagnostic capture truncated]' : ''}`,
              width,
            )
          : [diagnosticLoss || 'No captured diagnostic reports']
      } else if (panel.kind === 'preview')
        content = privateWrappedUpdate(
          `Immutable ${model.workspace.recorded ? 'recorded-file' : 'delivered-file'} preview: ${model.previewTitle ?? 'verified capture'}${model.preview?.clipped ? ' [capture clipped at 64 KiB]' : ''}\n${model.preview?.text ?? privateDashboardPreviewState(model)}`,
          width,
        )
      else if (panel.kind === 'references')
        content = references.length
          ? (function* () {
              for (const ref of references)
                yield `${referenceKey(ref) === panel.selected ? '> ' : '  '}${model.resolve(model.record?.publisher ?? 'root', ref).label}`
            })()
          : ['No references in the selected record']
      else {
        const record = model.records().find((record) => record.key === panel.key)
        content = record
          ? privateDashboardDetailLines(model, record, width)
          : ['Selected record unavailable']
      }
      const requested =
        panel.kind === 'preview' && panel.matchOffset !== undefined
          ? [...privateWrappedUpdate(model.preview?.text.slice(0, panel.matchOffset) ?? '', width)]
              .length
          : 'scroll' in panel
            ? panel.scroll
            : 0
      // Retain only the visible page. Counting remaining lines is bounded by the
      // admitted text, while the frame buffer never grows with document length.
      let index = 0,
        count = 0,
        last = '',
        lastTone: WorkspaceTone | undefined
      for (const line of content) {
        last = line
        lastTone =
          index === selectedReference ? 'heading' : index === 0 ? panelHeadingTone : undefined
        if (index++ < requested) continue
        if (count++ >= bodyRoom) {
          clipped = true
          break
        }
        if (!add(line, lastTone)) break
      }
      offset = requested
      if (count === 0 && index > 0) {
        add(last, lastTone)
        offset = index - 1
      }
    } else if (compact) {
      if (bodyRoom) add('Compact viewport · Enter detail · ! full cause', 'secondary')
    } else {
      const records = model.records(),
        body: {
          key?: string
          text: () => string
          tone?: WorkspaceTone
          secondaryPrefix?: string
        }[] = [],
        tables = new Map<string, ReturnType<typeof tableColumns>>()
      const sideBySide = width >= 112 && bodyRoom >= 10 && !!model.record,
        listWidth = sideBySide ? Math.max(58, Math.floor((width - 3) * 0.55)) : width,
        detailWidth = width - listWidth - 3
      // Every collapsed record is one physical line; table headers occur once.
      let priorCollection: string | undefined,
        priorSection: string | undefined,
        priorKind = ''
      for (const record of records) {
        if (record.section && record.section !== priorSection) {
          body.push({ text: () => privateUpdateText(record.section!), tone: 'heading' })
          priorSection = record.section
        }
        if (model.surface === 'activity') {
          const current = record.kind === 'host' || record.kind === 'activity'
          if ((current ? 'current' : 'recent') !== priorKind) {
            priorKind = current ? 'current' : 'recent'
            body.push({
              text: () => (current ? 'Current work' : 'Recent activity'),
              tone: 'heading',
            })
          }
        }
        const selected = model.record?.key === record.key,
          prefix = selected ? '> ' : '  '
        let text: () => string = () => ''
        if (record.collection) {
          const collection = record.collection,
            rows = model.visibleRows(collection),
            table =
              tables.get(collection.id) ??
              tableColumns(model, record.publisher ?? 'root', collection, rows, listWidth)
          tables.set(collection.id, table)
          if (priorCollection !== collection.id) {
            const filter = model.local.filters.get(collection.id),
              sort = model.local.sorts.get(collection.id)
            body.push({
              tone: 'heading',
              text: () =>
                `${table.hidden ? `+${table.hidden} columns (Enter detail) · ` : ''}${privateUpdateText(collection.title)} · ${filter ? `${rows.length} of ${collection.rows.length}` : collection.rows.length} records${collection.total === undefined || collection.total === collection.rows.length ? '' : ` / ${collection.total} reported`}${filter ? ` · filter ${privateUpdateText(filter)}` : ''}${sort ? ` · sort ${privateUpdateText(sort.key)}` : ''}`,
            })
            body.push({
              tone: 'heading',
              text: () =>
                '  ' +
                table.columns
                  .map((column) => aligned(column.label, column.size, column.numeric))
                  .join(' | '),
            })
            priorCollection = collection.id
          }
          text = () =>
            record.row
              ? table.columns
                  .map((column) =>
                    aligned(
                      displayCell(
                        model,
                        record.publisher ?? 'root',
                        record.row!.cells[column.key] ?? null,
                      ),
                      column.size,
                      column.numeric,
                    ),
                  )
                  .join(' | ')
              : collection.rows.length
                ? 'No matching supplied records · / recovers filter'
                : 'No supplied records'
        } else if (record.kind === 'summary')
          text = () => `Summary ▸ ${privateUpdateText(record.text!).split('\n')[0]}`
        else if (record.block?.kind === 'report') {
          const report = record.block
          text = () => `Report ▸ ${privateUpdateText(report.text).split('\n')[0]}`
        } else if (record.block?.kind === 'facts') {
          const facts = record.block
          text = () =>
            `Facts ▸ ${facts.items
              .slice(0, 2)
              .map(
                (f) =>
                  `${privateTruncateUpdate(privateUpdateText(f.label), 24, 1024)} ${privateTruncateUpdate(cell(f.value), 24, 1024)}`,
              )
              .join(' · ')}${facts.items.length > 2 ? ` · +${facts.items.length - 2} facts` : ''}`
        } else if (record.block?.kind === 'progress')
          text = () =>
            progressText(record.block as Extract<DetailBlock, { kind: 'progress' }>, listWidth - 2)
        else if (record.activity)
          text = () =>
            `${model.sourceLabel(record.publisher!)} · ${privateUpdateText(record.activity!.label)}${record.activity!.progress ? ` · ${record.activity!.progress.completed}${record.activity!.progress.total === undefined ? '' : `/${record.activity!.progress.total}`}` : ''}`
        else if (record.journal)
          text = () =>
            `${record.journal!.kind === 'diagnostic' ? `Diagnostic (${privateUpdateText(record.journal!.operationsPath?.join(' / ') || 'root')})` : record.journal!.source}${record.journal!.importance === 'info' ? '' : ` · reported ${record.journal!.importance}`} · ${privateUpdateText(record.journal!.text).split('\n')[0]}${record.journal!.clipped ? ' [capture truncated]' : ''}`
        else if (record.call)
          text = () =>
            `${'  '.repeat(Math.min(record.depth ?? 0, 12))}${model.descendants(record.call!.key).length ? (model.treeExpanded(record.call!.key) ? '▾' : '▸') : '·'} ${privateUpdateText(record.call!.intent ?? record.call!.slot)} · ${record.call!.state}${record.hidden ? ` (${record.hidden} calls${record.issues ? `; ${record.issues} issues` : ''})` : ''}`
        else text = () => privateUpdateText(record.text ?? '').split('\n')[0] ?? ''
        body.push({
          key: record.key,
          text: () => privateTruncateUpdate(prefix + text(), listWidth, 4096),
          ...(selected
            ? { tone: 'selection' as const }
            : record.journal?.importance === 'error' || record.call?.state === 'failed'
              ? { tone: 'error' as const }
              : record.journal?.importance === 'warning' || record.call?.state === 'uncertain'
                ? { tone: 'warning' as const }
                : {}),
          ...(record.journal
            ? {
                secondaryPrefix: `${prefix}${record.journal.source} · `,
              }
            : {}),
        })
      }
      if (model.surface === 'activity') {
        const omitted = Object.entries(model.journalOmitted)
          .filter(([, count]) => count)
          .map(([kind, count]) => `${count} ${kind}`)
        if (omitted.length)
          body.push({ text: () => `[History omitted: ${omitted.join(', ')}]`, tone: 'secondary' })
      }
      if (model.surface === 'overview') {
        if (!model.calls.size) body.push({ text: () => 'Waiting for actual observed invocations' })
        if (model.omissions)
          body.push({
            text: () => `${model.omissions} call observations omitted`,
            tone: 'secondary',
          })
      }
      const selectedView = model.selected,
        operationId = selectedView?.value.operationId
      if (selectedView && operationId)
        body.unshift({
          tone: 'secondary',
          text: () =>
            `Associated own call: ${model.resolve(selectedView.publisher, { kind: 'call', operationId }).label}`,
        })
      if (model.selected?.ended && model.workspace.phase !== 'settled')
        body.unshift({
          tone: 'secondary',
          text: () => `${model.selected!.ended}; showing the last reported snapshot`,
        })
      if (model.feedback) body.push({ text: () => privateUpdateText(model.feedback) })
      const selectedIndex = body.findIndex((line) => line.key === model.record?.key)
      const retained = retainedAnchor && body.findIndex((line) => line.key === retainedAnchor.key)
      const desired =
        retained !== undefined && retained >= 0
          ? retained + retainedAnchor!.offset
          : scroll || model.local.scroll || Math.max(0, selectedIndex - Math.floor(bodyRoom / 2))
      offset = Math.max(0, Math.min(desired, Math.max(0, body.length - bodyRoom)))
      if (sideBySide) {
        const detail: string[] = ['Selected detail · Enter expand · r references', '']
        for (const line of privateDashboardDetailLines(model, model.record!, detailWidth, true)) {
          if (detail.length >= bodyRoom) {
            clipped = true
            break
          }
          detail.push(line)
        }
        if (clipped && detail.length)
          detail[detail.length - 1] = 'More detail · Enter to read and scroll'
        const visible = body.slice(offset, offset + bodyRoom)
        for (let i = 0; i < Math.max(visible.length, detail.length); i++) {
          const line = visible[i]
          const left = aligned(
            privateUpdateText(line?.text() ?? '').replaceAll('\n', '\\n'),
            listWidth,
          )
          const right = privateTruncateUpdate(
            privateUpdateText(detail[i] ?? '').replaceAll('\n', '\\n'),
            detailWidth,
          )
          if (
            !commit(
              paint(left, line?.tone, line?.secondaryPrefix) +
                privateCliSecondary(' │ ', color) +
                paint(right, i === 0 ? 'heading' : undefined),
            )
          )
            break
        }
      } else {
        for (const line of body.slice(offset, offset + bodyRoom))
          if (!add(line.text(), line.tone, line.secondaryPrefix)) break
      }
      if (offset + bodyRoom < body.length) clipped = true
      const anchored =
        body
          .slice(0, offset + 1)
          .reverse()
          .find((line) => line.key) ?? body.slice(offset).find((line) => line.key)
      if (anchored?.key) anchor = { key: anchored.key, offset: offset - body.indexOf(anchored) }
    }
  }
  // Blank body lines keep the footer fixed at the physical bottom.
  while (lines.length < height - 1 && frameBytes < 31900) add('')
  const hasNewActivity =
    model.surface === 'activity' &&
    model.record?.journal &&
    model.journal.filter((entry) => entry.kind !== 'host').at(-1)?.key !== model.record.key
  add(
    compact && clipped
      ? model.workspace.phase === 'settled'
        ? 'q close ^C close ↓'
        : 'q inline ^C stop ↓'
      : clipped
        ? `↓ more · ${footer}`
        : hasNewActivity
          ? `+ new activity · ${footer}`
          : footer,
    'secondary',
  )
  return { lines, references, scroll: offset, ...(anchor ? { anchor } : {}) }
}

/** One borrowed input owner with three bounded local overlay levels. */
export class PrivateDashboardInput {
  #active = false
  #raw = false
  #paused = true
  #settled = false
  #captured = false
  #resolve: (() => void) | undefined
  #ended = false
  #pending = ''
  #escapeTimer: ReturnType<typeof setTimeout> | undefined
  #panels: PrivateDashboardPanel[] = []
  #references: readonly Reference[] = []
  #surface = ''
  readonly #decoder = new StringDecoder('utf8')
  readonly #data = (bytes: Buffer) => {
    if (bytes.includes(3)) {
      this.#read('\u0003')
      return
    }
    this.#pending = [...(this.#pending + this.#decoder.write(bytes))].slice(0, 4096).join('')
    this.#drainKeys()
  }
  readonly #end = () => this.leave()
  constructor(
    readonly model: PrivateRunModel,
    readonly change: () => void,
    readonly cancel: () => void,
    readonly input = process.stdin,
    readonly onLeave: () => void = () => {},
    readonly onInteraction: () => boolean = () => true,
  ) {}
  get active(): boolean {
    return this.#active
  }
  get state(): PrivateDashboardState {
    this.#reconcile()
    return { panels: this.#panels }
  }
  get scroll(): number {
    this.#reconcile()
    const panel = this.#panels.at(-1)
    return panel && 'scroll' in panel ? panel.scroll : this.model.local.scroll
  }
  get anchor(): ScrollAnchor | undefined {
    this.#reconcile()
    return this.#panels.length ? undefined : this.model.local.anchor
  }
  capture(): void {
    if (this.#captured) return
    this.#captured = true
    this.#raw = this.input.isRaw
    this.#paused = this.input.isPaused() || this.input.readableFlowing !== true
  }
  start(): void {
    if (this.#active || this.#ended) return
    this.capture()
    this.#surface = this.model.surface
    try {
      this.input.setRawMode(true)
      this.input.on('data', this.#data)
      this.input.once('end', this.#end)
      this.input.resume()
      this.#active = true
    } catch (error) {
      this.input.removeListener('data', this.#data)
      this.input.removeListener('end', this.#end)
      try {
        this.input.setRawMode(this.#raw)
      } finally {
        if (this.#paused) this.input.pause()
      }
      throw error
    }
  }
  frame(references: readonly Reference[], scroll?: number, anchor?: ScrollAnchor): void {
    this.#reconcile()
    this.#references = references
    const panel = this.#panels.at(-1)
    if (panel && 'scroll' in panel) {
      if (scroll !== undefined) panel.scroll = scroll
    } else {
      if (scroll !== undefined) this.model.local.scroll = scroll
      this.model.local.anchor = anchor
    }
  }
  #reconcile(): void {
    // Reconcile before projection as well as after it: record keys are local to each surface.
    if (this.#surface !== this.model.surface) {
      this.#panels = []
      this.#references = []
      this.#surface = this.model.surface
    }
    const search = this.#panels.find((p) => p.kind === 'preview-search')
    if (
      search?.kind === 'preview-search' &&
      search.signature !==
        JSON.stringify([
          this.model.previewTitle,
          this.model.preview?.text,
          this.model.artifactCapture.generation,
        ])
    )
      this.#panels = this.#panels.filter((p) => p.kind !== 'preview-search')
    const detail = this.#panels.find((p) => p.kind === 'detail')
    if (detail?.kind === 'detail') {
      const record = this.model.record
      if (record?.key !== detail.key || record.signature !== detail.signature) {
        this.#panels = []
        this.#references = []
      }
    }
  }
  async settled(): Promise<void> {
    this.#settled = true
    if (this.#active)
      await new Promise<void>((resolve) => {
        this.#resolve = resolve
      })
  }
  markSettled(): void {
    this.#settled = true
  }
  leave(): void {
    if (this.#ended) return
    this.#ended = true
    clearTimeout(this.#escapeTimer)
    this.#escapeTimer = undefined
    this.#pending = ''
    if (this.#active) {
      this.input.removeListener('data', this.#data)
      this.input.removeListener('end', this.#end)
      try {
        this.input.setRawMode(this.#raw)
      } catch {
        this.model.feedback = 'Terminal input restoration unavailable'
      } finally {
        try {
          if (this.#paused) this.input.pause()
        } catch {
          this.model.feedback = 'Terminal input restoration unavailable'
        }
        this.#active = false
      }
    }
    this.#resolve?.()
    this.#resolve = undefined
    this.model.dismissPreview()
    this.#panels = []
    this.onLeave()
    this.change()
  }
  #push(panel: PrivateDashboardPanel): void {
    if (this.#panels.length >= 3) this.#panels.pop()
    this.#panels.push(panel)
  }
  #drainKeys(): void {
    clearTimeout(this.#escapeTimer)
    this.#escapeTimer = undefined
    while (this.#active && this.#pending) {
      if (this.#pending.startsWith('\u001b')) {
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Decode owned terminal controls.
        const sequence = /^\u001b(?:\[[0-?]*[ -/]*[@-~]|O[@-~])/.exec(this.#pending)
        if (sequence) {
          this.#pending = this.#pending.slice(sequence[0].length)
          this.#read(sequence[0])
          continue
        }
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Preserve split terminal sequences.
        const incomplete = /^\u001b(?:\[[0-?]*[ -/]*|O)?$/.test(this.#pending)
        if (this.#pending.length === 1 || incomplete) {
          this.#escapeTimer = setTimeout(() => {
            this.#escapeTimer = undefined
            this.#pending = ''
            this.#read('\u001b')
          }, 30)
          return
        }
        this.#pending = this.#pending.slice(1)
        this.#read('\u001b')
        continue
      }
      const scalar = String.fromCodePoint(this.#pending.codePointAt(0)!)
      this.#pending = this.#pending.slice(scalar.length)
      this.#read(scalar)
    }
  }
  #read(text: string): void {
    this.#reconcile()
    if (text === '\u0003') {
      if (!this.#settled) this.cancel()
      this.leave()
      return
    }
    if (text === '\u0004') {
      this.leave()
      return
    }
    const panel = this.#panels.at(-1)
    if (panel?.kind === 'filter' || panel?.kind === 'preview-search') {
      const accepted =
        ['\r', '\n', '\u001b', '\u007f', '\b', '\u001b[3~'].includes(text) ||
        ![...text].some((scalar) => /[\p{Cc}\p{Cf}]/u.test(scalar))
      if (accepted && !this.onInteraction()) {
        this.leave()
        return
      }
      if (accepted) this.model.markNavigation()
      if (text === '\r' || text === '\n') {
        if (panel.kind === 'filter') {
          this.model.filterRows(panel.draft)
          this.#panels.pop()
        } else {
          this.#panels.pop()
          const preview = this.#panels.at(-1)
          if (preview?.kind === 'preview') {
            preview.query = panel.draft
            const offset = panel.draft ? (this.model.preview?.text.indexOf(panel.draft) ?? -1) : -1
            if (offset >= 0) {
              preview.matchOffset = offset
              this.model.feedback = 'Literal match in retained excerpt'
            } else {
              delete preview.matchOffset
              this.model.feedback = panel.draft
                ? 'No literal match in the retained excerpt'
                : 'Excerpt search cleared'
            }
          }
        }
      } else if (text === '\u001b') this.#panels.pop()
      else if (text === '\u007f' || text === '\b' || text === '\u001b[3~')
        panel.draft = [...panel.draft].slice(0, -1).join('')
      else if (![...text].some((scalar) => /[\p{Cc}\p{Cf}]/u.test(scalar)))
        panel.draft = [...(panel.draft + text)].slice(0, 128).join('')
      this.change()
      return
    }
    if (text === 'q') {
      this.leave()
      return
    }
    if (text === '\u001b') {
      if (this.#panels.length) {
        if (!this.onInteraction()) {
          this.leave()
          return
        }
        this.model.markNavigation()
        const dismissed = this.#panels.pop()
        if (dismissed?.kind === 'preview') this.model.dismissPreview()
        this.change()
      } else this.leave()
      return
    }
    if (
      [
        '\t',
        '\u001b[Z',
        '?',
        '!',
        'd',
        'r',
        'c',
        's',
        '/',
        'j',
        'k',
        '[',
        ']',
        '\r',
        '\n',
        '\u001b[A',
        '\u001b[B',
        '\u001b[C',
        '\u001b[D',
        '\u001b[6~',
        '\u001b[5~',
        '\u001b[H',
        '\u001b[1~',
        '\u001b[F',
        '\u001b[4~',
      ].includes(text)
    ) {
      if (!this.onInteraction()) {
        this.leave()
        return
      }
      this.model.markNavigation()
    }
    if (text === '\t' || text === '\u001b[Z') {
      this.#panels = []
      this.model.cycleView(text === '\t' ? 1 : -1)
      this.#surface = this.model.surface
      this.change()
      return
    }
    if (text === '?') {
      this.#push({ kind: 'help', scroll: 0 })
      this.change()
      return
    }
    if (text === '!') {
      this.#push({
        kind: 'attention',
        index: Math.max(0, this.model.attention.indexOf(this.model.sticky!)),
        scroll: 0,
      })
      this.change()
      return
    }
    if (text === 'd') {
      this.#push({ kind: 'diagnostics', index: 0, scroll: 0 })
      this.change()
      return
    }
    const delta =
      text === 'j' || text === '\u001b[B' ? 1 : text === 'k' || text === '\u001b[A' ? -1 : 0
    const page =
      text === ']' || text === '\u001b[6~' ? 3 : text === '[' || text === '\u001b[5~' ? -3 : 0
    if (
      text === '/' &&
      (panel?.kind === 'preview' || (panel?.kind === 'detail' && this.model.preview))
    ) {
      if (panel.kind === 'detail') this.#push({ kind: 'preview', scroll: 0 })
      this.#push({
        kind: 'preview-search',
        draft: '',
        signature: JSON.stringify([
          this.model.previewTitle,
          this.model.preview?.text,
          this.model.artifactCapture.generation,
        ]),
      })
      this.change()
      return
    }
    if (panel?.kind === 'references') {
      const refs = this.#references.length
        ? this.#references
        : privateDashboardReferences(this.model.record)
      if (delta) {
        const index = refs.findIndex((r) => referenceKey(r) === panel.selected)
        panel.selected =
          refs[Math.max(0, Math.min(refs.length - 1, index + delta))] &&
          referenceKey(refs[Math.max(0, Math.min(refs.length - 1, index + delta))]!)
      }
      if (text === '\r' || text === '\n') {
        const reference = refs.find((r) => referenceKey(r) === panel.selected)
        if (!reference)
          this.model.feedback = 'Selected reference unavailable; press r to choose another'
        else {
          const publisher = this.model.record?.publisher ?? 'root'
          const available = this.model.resolve(publisher, reference).available
          this.#panels.pop()
          if (reference.kind === 'artifact' && available) this.#push({ kind: 'preview', scroll: 0 })
          else if (available) this.#panels = []
          void this.model.activate(publisher, reference)
        }
      }
    } else if (panel && 'scroll' in panel) {
      if (
        (panel.kind === 'attention' || panel.kind === 'diagnostics') &&
        (text === '\u001b[C' || text === '\u001b[D')
      ) {
        const count =
          panel.kind === 'attention'
            ? this.model.attention.length
            : this.model.journal.filter((entry) => entry.kind === 'diagnostic').length
        panel.index =
          (panel.index + (text === '\u001b[C' ? 1 : -1) + Math.max(1, count)) % Math.max(1, count)
        panel.scroll = 0
      } else if (delta || page) {
        if (panel.kind === 'preview') delete panel.matchOffset
        panel.scroll = Math.max(0, Math.min(524288, panel.scroll + (page || delta)))
      } else if (text === '\u001b[H' || text === '\u001b[1~') panel.scroll = 0
      if ((text === '\r' || text === '\n') && panel.kind === 'detail') {
        if (this.model.disclosure()) this.model.toggleDisclosure()
        this.#panels.pop()
      } else if (text === 'r' && (panel.kind === 'detail' || panel.kind === 'preview'))
        this.#chooseReference()
    } else if (delta) {
      this.model.moveRecord(delta)
      this.model.local.anchor = undefined
    } else if (page) {
      this.model.local.scroll = Math.max(0, Math.min(8192, this.model.local.scroll + page))
      this.model.local.anchor = undefined
    } else if (text === '\u001b[H' || text === '\u001b[1~') {
      this.model.moveRecord(-1000)
      this.model.local.anchor = undefined
    } else if (text === '\u001b[F' || text === '\u001b[4~') {
      this.model.moveRecord(1000)
      this.model.local.anchor = undefined
    } else if (text === '\u001b[C' || text === '\u001b[D')
      this.model.expandTree(text === '\u001b[C')
    else if (text === 'c') this.model.cycleCollection()
    else if (text === 's') this.model.sortRows()
    else if (text === '/') {
      if (this.model.requireCollection())
        this.#push({
          kind: 'filter',
          draft: this.model.filter,
          collection: this.model.collection!.id,
        })
    } else if (text === 'r') this.#chooseReference()
    else if (text === '\r' || text === '\n') {
      const record = this.model.record
      if (record?.file) {
        this.#push({ kind: 'preview', scroll: 0 })
        void this.model.activateFile(record.file.path)
      } else if (record && privateDashboardDetailParts(this.model, record, true).length === 0) {
        this.model.feedback = 'No additional detail was supplied for this entry.'
      } else if (record) {
        if (!this.model.disclosure()) this.model.toggleDisclosure()
        this.#push({ kind: 'detail', key: record.key, signature: record.signature, scroll: 0 })
      }
    }
    this.change()
  }
  #chooseReference(): void {
    const refs = privateDashboardReferences(this.model.record)
    this.#references = refs
    this.#push({
      kind: 'references',
      selected: refs[0] && referenceKey(refs[0]),
      origin: this.model.record?.key ?? '',
    })
  }
}
