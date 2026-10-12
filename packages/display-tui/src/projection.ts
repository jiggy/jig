import type { DisplayFact } from '@jigging/display-model'
import type { Block, DetailBlock, Reference, Value } from '@jigging/reporting'
import { heading, secondary, selection } from './style.js'
import {
  escapeTerminalText,
  terminalWidth,
  truncateTerminalText,
  wrapTerminalText,
} from './text.js'
import {
  attentionImportance,
  observedTime,
  recordReferences,
  type ViewerCall,
  type ViewerJournalEntry,
  type ViewerModel,
  type ViewerRecord,
  viewerFactText,
  viewerFactTone,
} from './viewer-model.js'

type ScrollAnchor = { key: string; offset: number }
const diagnosticPath = (entry: ViewerJournalEntry): string => {
  const path = entry.operationsPath?.join(' / ')
  return path
    ? `${path}${entry.pathClipped ? ' [path truncated]' : ''}`
    : entry.pathClipped
      ? 'Invocation path unavailable (clipped)'
      : '(root)'
}
export interface ViewerFrame {
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
      : escapeTerminalText(String(value))
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
function wrap(text: string, width: number): string[] {
  const result: string[] = []
  for (const line of escapeTerminalText(text).split('\n')) {
    let current = '',
      cells = 0
    for (const { segment } of segmenter.segment(line)) {
      const size = terminalWidth(segment)
      if (current && cells + size > width) {
        result.push(current)
        current = ''
        cells = 0
      }
      if (size > width) {
        result.push(truncateTerminalText(segment, width))
        continue
      }
      current += segment
      cells += size
    }
    result.push(current)
  }
  return result
}

/** A small observation surface, not an interactive view compressed into scrollback. */
function privateInlineFrame(
  model: ViewerModel,
  width: number,
  height: number,
  color = false,
  _scroll = 0,
  _retainedAnchor?: ScrollAnchor,
): ViewerFrame {
  width = Math.max(1, Math.min(4096, width - 1))
  height = Math.max(1, Math.min(100, Math.floor(height)))
  type Group = { lines: string[]; call?: boolean; activityOffsets?: number[]; progress?: boolean }
  const groups: Group[] = []
  const line = (text: string) =>
    truncateTerminalText(escapeTerminalText(text).replaceAll('\n', '\\n'), width)
  const excerpt = (text: string, maximum = 2): string[] => {
    if (maximum < 1) return []
    const lines = wrap(text, width)
    if (lines.length <= maximum) return lines
    const kept = lines.slice(0, maximum)
    const marker = width >= 12 ? ' [excerpt]' : '…'
    kept[maximum - 1] =
      truncateTerminalText(kept[maximum - 1]!, Math.max(0, width - terminalWidth(marker))) + marker
    return kept
  }
  const add = (text: string, maximum = 1) => groups.push({ lines: excerpt(text, maximum) })
  const critical: string[] = []
  const sticky = model.sticky
  const cause = sticky
    ? width < 45 && height >= 3 && terminalWidth(`! ${sticky.source}: ${sticky.text}`) > width
      ? [line(`Attention: ${sticky.source}`), ...wrap(sticky.text, width)]
      : wrap(
          `${width < 45 ? `! ${sticky.source}:` : `Attention (${sticky.source}):`} ${sticky.text}`,
          width,
        )
    : []
  const warning = model.observationWarning ? wrap(model.observationWarning, width) : []
  const omitted = model.omissions
  const otherAttention = Math.max(0, model.attention.length - 1)
  // Reserve independent attention and stale observation markers before expanding
  // either reason. Narrow surfaces preserve their identity, not a copied report.
  if (cause[0])
    critical.push(
      heading(
        cause[0],
        sticky!.priority === 2 || sticky!.priority >= 4 ? 'error' : 'warning',
        color,
      ),
    )
  if (warning[0]) critical.push(warning[0])
  if (omitted)
    critical.push(
      line(
        width < 45
          ? `Calls omitted: ${omitted}`
          : `${omitted} call observations omitted by producer`,
      ),
    )
  if (otherAttention)
    critical.push(
      line(
        width < 45 ? `Attention +${otherAttention}` : `${otherAttention} other attention reports`,
      ),
    )
  const criticalIdentities = critical.length
  critical.push(...cause.slice(1, 3), ...warning.slice(1, 2))
  const phase = model.workspace.phase === 'settled' ? 'Settled' : 'Running'
  const elapsed = `${Math.floor(model.workspace.elapsedMs / 1000)}s`
  groups.push({
    lines: [
      heading(
        line(`${model.workspace.target} · ${phase} · ${elapsed} · ${model.workspace.hostStage}`),
        'info',
        color,
      ),
    ],
  })
  if (model.workspace.facts) {
    const facts = model.workspace.facts
    for (const [label, fact] of [
      ['Execution', facts.execution],
      ['Application', facts.application],
      ['Cleanup', facts.cleanup],
      ['Delivery', facts.delivery],
      ...(facts.completeness ? [['Observation', facts.completeness] as const] : []),
    ] as const)
      add(viewerFactText(label, fact), 2)
  } else add(model.context || model.workspace.hostStage)
  const roots = [...model.views.values()].filter((view) => view.publisher === model.rootSourceId)
  const root = roots.find((view) => view.value.landing) ?? roots[0]
  if (root) {
    add(`${model.sourceLabel(root.publisher)} / ${root.value.title}: ${root.value.summary}`, 2)
    if (root.ended) add(`${root.ended}; last update ${observedTime(root.updated)}`)
  }

  // Handoff retains focus and local choices; the inline excerpt never expands
  // every supplied row's context or starts preview effects.
  const selected = model.selected
  const record = model.record
  if (selected && (selected.key !== root?.key || record?.kind === 'row')) {
    add(`Selected ${model.sourceLabel(selected.publisher)} / ${selected.value.title}`)
    if (selected.key !== root?.key) add(selected.value.summary, 2)
    if (record?.row && record.collection) {
      const collection = record.collection
      const choices = [
        model.local.filters.has(collection.id)
          ? `local filter ${model.local.filters.get(collection.id)}`
          : '',
        model.local.sorts.has(collection.id)
          ? `local sort ${model.local.sorts.get(collection.id)!.key}`
          : '',
      ].filter(Boolean)
      if (choices.length) add(choices.join(' · '))
      add(
        collection.columns
          .slice(0, 3)
          .map((column) => {
            const value = record.row!.cells[column.key] ?? null
            return `${column.label}: ${
              value !== null && typeof value === 'object'
                ? model.resolve(selected.publisher, value).label
                : scalar(value)
            }`
          })
          .join(' · '),
        2,
      )
      const context = record.row.details?.find((block) => block.kind === 'report')
      if (context?.kind === 'report') add(context.text, 2)
    } else if (record?.block?.kind === 'report') add(record.block.text, 2)
  }

  const calls = [...model.calls.values()]
  const branches = calls.filter((call) => !call.parent || !model.calls.has(call.parent))
  // An issue below a collapsed branch remains visible without expanding a ledger.
  const issues = calls.filter(
    (call) => !branches.includes(call) && (call.state === 'failed' || call.state === 'uncertain'),
  )
  const candidates = [...branches, ...issues]
  const ranked = candidates
    .map((call, index) => ({ call, index }))
    .sort(
      (a, b) =>
        Number(a.call.state === 'returned') - Number(b.call.state === 'returned') ||
        a.index - b.index,
    )
    .map(({ call }) => call)
  const callLabel = (call: ViewerCall): string => call.intent ?? call.slot
  const state = (call: ViewerCall): string =>
    ({
      requested: 'requested; not started',
      active: 'active',
      'cancel-requested': 'cancellation requested',
      returned: 'returned',
      failed: 'failed / refused',
      uncertain: 'uncertain',
    })[call.state]
  const activities = [...model.activities.values()]
  const activityGroups = activities.slice(0, 4).map(({ publisher, value }) => {
    const call =
      value.operationId === undefined
        ? undefined
        : calls.find(
            (call) => call.publisher === publisher && call.operationId === value.operationId,
          )
    const attribution = call
      ? `${model.sourceLabel(publisher)} / ${callLabel(call)}`
      : model.sourceLabel(publisher)
    const progress = value.progress
    const count = progress
      ? ` (${progress.completed}${progress.total === undefined ? '' : ` / ${progress.total}`}${progress.unit === undefined ? '' : ` ${progress.unit}`})`
      : ''
    const lines = excerpt(`    ${attribution}: ${value.label}${count}`, 2)
    if (!call) lines.push(line('    Call relationship unavailable'))
    if (value.detail) lines.push(...excerpt(`    ${value.detail}`, 1))
    return { call, lines }
  })
  const attached = new Set<(typeof activityGroups)[number]>()
  for (const call of ranked.slice(0, 4)) {
    const row = line(`  ${callLabel(call)} — ${state(call)}`)
    const lines = [
      call.state === 'failed'
        ? heading(row, 'error', color)
        : call.state === 'uncertain' || call.state === 'cancel-requested'
          ? heading(row, 'warning', color)
          : call.state === 'returned'
            ? secondary(row, color)
            : heading(row, 'info', color),
    ]
    const activityOffsets: number[] = []
    for (const activity of activityGroups) {
      if (!activity.call || attached.has(activity)) continue
      let ancestor: ViewerCall | undefined = activity.call
      let hops = 0
      while (ancestor && ancestor.key !== call.key && hops++ < 32)
        ancestor = ancestor.parent ? model.calls.get(ancestor.parent) : undefined
      if (!ancestor || ancestor.key !== call.key) continue
      attached.add(activity)
      activityOffsets.push(lines.length)
      lines.push(...activity.lines)
    }
    if (call.cause) lines.push(...excerpt(`    Cause: ${call.cause}`, 2))
    if (call.parent && !model.calls.has(call.parent))
      lines.push(line('    Enclosing invocation unavailable; relationship incomplete'))
    groups.push({ lines, call: true, activityOffsets })
  }
  for (const activity of activityGroups)
    if (!attached.has(activity) && !activity.call)
      groups.push({ lines: activity.lines, activityOffsets: [0] })
  const progress =
    root?.value.sections.flatMap((section) =>
      section.blocks.filter((block) => block.kind === 'progress'),
    ) ?? []
  for (const block of progress.slice(0, 2))
    if (block.kind === 'progress')
      groups.push({
        lines: excerpt(
          `${block.label}: ${block.completed}${block.total === undefined ? '' : ` / ${block.total}`}${block.unit === undefined ? '' : ` ${block.unit}`}`,
          1,
        ),
        progress: true,
      })
  if (!root && !calls.length && !activities.length)
    add(model.workspace.hostStage || 'Waiting for observed calls or application reports')
  if (model.feedback) add(model.feedback)

  const intrinsicallyHiddenCalls = Math.max(0, candidates.length - 4)
  const intrinsicallyHiddenActivities = Math.max(0, activities.length - 4)
  const nested = calls.length - candidates.length
  const required = critical.length + groups.reduce((sum, group) => sum + group.lines.length, 0)
  const criticalClipped = cause.length > 3 || warning.length > 2
  const hasOverflow =
    required > height ||
    intrinsicallyHiddenCalls > 0 ||
    intrinsicallyHiddenActivities > 0 ||
    nested > 0 ||
    omitted > 0 ||
    progress.length > 2 ||
    model.attention.length > 1 ||
    criticalClipped
  const footerRows = hasOverflow
    ? Math.min(
        Math.max(0, height - Math.max(1, criticalIdentities)),
        width < 45 && candidates.length && activities.length ? 2 : 1,
      )
    : 0
  const available = Math.max(0, height - footerRows)
  const rendered = critical.slice(0, available)
  let shownCalls = 0,
    shownActivities = 0,
    shownProgress = 0
  for (const group of groups) {
    if (rendered.length >= available) break
    const room = available - rendered.length
    rendered.push(...group.lines.slice(0, room))
    if (group.call) shownCalls++
    if (group.progress) shownProgress++
    shownActivities += group.activityOffsets?.filter((offset) => offset < room).length ?? 0
  }
  if (hasOverflow) {
    const hiddenCalls = candidates.length - shownCalls
    const hiddenActivities = activities.length - shownActivities
    const hiddenProgress = progress.length - shownProgress
    const disclosure = [
      ...(hiddenCalls ? [`${hiddenCalls} branches/issues hidden`] : []),
      ...(hiddenActivities ? [`${hiddenActivities} activities hidden`] : []),
      ...(nested ? [`${nested} nested call observations`] : []),
      ...(hiddenProgress ? [`${hiddenProgress} measured counts hidden`] : []),
      ...(criticalClipped ? ['Attention/observation excerpt'] : []),
      ...(required > height ? ['Live display excerpt'] : []),
    ].join(' · ')
    const narrow = [
      ...(hiddenCalls ? [`${hiddenCalls} calls hidden`] : []),
      ...(hiddenActivities ? [`${hiddenActivities} activities hidden`] : []),
      ...(nested ? [`${nested} nested calls`] : []),
      ...(hiddenProgress ? [`${hiddenProgress} counts hidden`] : []),
      'Live excerpt',
    ]
    rendered.push(
      ...(width < 45 ? narrow.slice(0, footerRows).map(line) : excerpt(disclosure, footerRows)),
    )
    if (rendered.length && (footerRows === 0 || (width < 45 && narrow.length > footerRows))) {
      const last = rendered.length - 1
      // A missing local footer is an excerpt, not producer loss. Retain the
      // critical category/count and mark clipping within the same physical row.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip only renderer-owned SGR before reserving the excerpt marker.
      const plain = rendered[last]!.replaceAll(/\u001b\[[0-9;]*m/g, '')
      rendered[last] = truncateTerminalText(plain, Math.max(0, width - 1)) + '…'
    }
  }
  let bytes = 0
  const bounded: string[] = []
  for (const text of rendered) {
    const n = Buffer.byteLength(text) + 1
    if (bytes + n > 32000) {
      const marker = line('[Live display excerpt clipped]')
      const markerBytes = Buffer.byteLength(marker) + 1
      while (bounded.length && bytes + markerBytes > 32000)
        bytes -= Buffer.byteLength(bounded.pop()!) + 1
      bounded.push(marker)
      break
    }
    bounded.push(text)
    bytes += n
  }
  return { lines: bounded, references: [] }
}
function privateTruncateStyled(text: string, width: number): string {
  // Styled headings are host-owned and short. Width measurements ignore escapes.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip host ANSI styling for terminal cell measurement.
  const plain = text.replace(/\u001b\[[0-9;]*m/g, '')
  return terminalWidth(plain) <= width ? text : truncateTerminalText(plain, width)
}

export type ViewerPanel =
  | { kind: 'exit'; leave: boolean }
  | { kind: 'views'; selected: string }
  | { kind: 'detail'; key: string; signature: string; scroll: number }
  | { kind: 'preview'; scroll: number; query?: string; matchOffset?: number }
  | { kind: 'preview-search'; draft: string; signature: string }
  | { kind: 'attention'; index: number; scroll: number }
  | { kind: 'diagnostics'; index: number; scroll: number }
  | { kind: 'references'; selected?: string | undefined; origin: string }
  | { kind: 'filter'; draft: string; collection: string }
  | { kind: 'help'; scroll: number }
export type ViewerState = { readonly panels: readonly ViewerPanel[] }
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
      : escapeTerminalText(String(value))
const displayCell = (model: ViewerModel, publisher: string, value: Value): string =>
  value !== null && typeof value === 'object'
    ? escapeTerminalText(model.resolve(publisher, value).label)
    : cell(value)
export function viewerReferences(record: ViewerRecord | undefined): Reference[] {
  return recordReferences(record)
}

function progressText(block: Extract<DetailBlock, { kind: 'progress' }>, width: number): string {
  const count = `${block.completed}${block.total === undefined ? '' : ` / ${block.total}`}${block.unit ? ` ${escapeTerminalText(block.unit)}` : ''}`
  if (block.total && width >= 40) {
    const size = Math.max(4, Math.min(12, width - 30)),
      filled = Math.floor((block.completed / block.total) * size)
    return `${escapeTerminalText(block.label)} [${'='.repeat(filled)}${' '.repeat(size - filled)}] ${count}`
  }
  return `${escapeTerminalText(block.label)} ${count}`
}
/** The list owns identity and a short observation; details add context or evidence.
 * Typed parts are private presentation data, not a new author-facing contract. */
export function viewerPreviewState(model: ViewerModel): string {
  if (model.preview?.image)
    return `Image preview: ${model.preview.image.width} × ${model.preview.image.height}`
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
export type ViewerDetailPart =
  | { kind: 'heading' | 'text' | 'note' | 'value'; text: string }
  | { kind: 'field'; label: string; value: Value }

export function viewerDetailParts(
  model: ViewerModel,
  record: ViewerRecord,
  preview = false,
  includeArtifactContent = true,
): ViewerDetailPart[] {
  const parts: ViewerDetailPart[] = []
  const text = (value: string, kind: 'text' | 'note' | 'value' = 'text') => {
    if (value) parts.push({ kind, text: value })
  }
  const heading = (value: string) => parts.push({ kind: 'heading', text: value })
  const field = (label: string, value: Value) => parts.push({ kind: 'field', label, value })
  const block = (b: DetailBlock) => {
    if (b.kind === 'report') {
      text(
        b.text,
        model.workspace.recorded && model.selected?.role === 'recorded-report' ? 'value' : 'text',
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
      !preview ||
        truncateTerminalText(
          first,
          model.local.teaserWidth ?? 120,
          model.local.teaserBytes ?? 4096,
        ) !== escapeTerminalText(first)
        ? value
        : value.slice(first.length).replace(/^\n/, ''),
    )
  }
  const artifact = viewerReferences(record)
  if (
    includeArtifactContent &&
    model.previewState &&
    record.key === model.record?.key &&
    (record.file || (artifact.length === 1 && artifact[0]?.kind === 'artifact'))
  ) {
    heading(model.previewTitle ?? 'Immutable captured content')
    text(
      model.preview?.image
        ? viewerPreviewState(model)
        : (model.preview?.text ?? viewerPreviewState(model)),
    )
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
    if (record.journal.operationsPath || record.journal.pathClipped)
      field('Invocation path', diagnosticPath(record.journal))
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
    if (n.parent && !model.calls.has(n.parent))
      text('Enclosing invocation unavailable; relationship incomplete.', 'note')
    const related = viewerRelatedReports(model, record)
    if (related.length) {
      heading('Related reports')
      for (const entry of related) {
        field('Source', entry.source)
        text(entry.text)
        if (entry.clipped) text('This retained report was clipped.', 'note')
      }
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

export function viewerRelatedReports(model: ViewerModel, record: ViewerRecord) {
  const node = record.call
  return node
    ? model.journal.filter((entry) => {
        const attribution = entry.attribution
        return attribution.provenance !== 'recorded-claim' && attribution.callId === node.id
      })
    : []
}

/** Context must add evidence/context, rather than generic lifecycle boilerplate. */
export function viewerHasContext(model: ViewerModel, record: ViewerRecord | undefined): boolean {
  if (!record) return false
  if (record.file || model.previewState) return true
  if (record.call) return Boolean(record.call.cause || viewerRelatedReports(model, record).length)
  return viewerDetailParts(model, record, true, false).some(
    (part) => part.kind !== 'note' && part.kind !== 'heading',
  )
}

export function* viewerDetailLines(
  model: ViewerModel,
  record: ViewerRecord,
  width: number,
  preview = false,
): Generator<string> {
  if (!preview)
    yield `${record.publisher ? model.sourceLabel(record.publisher) : (record.journal?.source ?? 'Jig')} · detail`
  const parts = viewerDetailParts(model, record, preview)
  if (!parts.length) {
    yield 'No additional detail was supplied. This entry is shown in full in the list.'
    return
  }
  for (const part of parts) {
    const text =
      part.kind === 'field'
        ? `${part.label}: ${typeof part.value === 'object' && part.value !== null ? model.resolve(record.publisher ?? model.rootSourceId, part.value).label : String(part.value)}`
        : part.text
    yield* wrapTerminalText(text, width, true)
  }
}

export function viewerTableColumns(
  model: ViewerModel,
  publisher: string,
  collection: NonNullable<ViewerRecord['collection']>,
  rows: NonNullable<ViewerRecord['collection']>['rows'],
  width: number,
  maximum = collection.columns.length,
) {
  const columns: { key: string; label: string; size: number; natural: number; numeric: boolean }[] =
    []
  let remaining = Math.max(0, width - 2)
  for (const column of collection.columns.slice(0, maximum)) {
    const natural = Math.max(
      terminalWidth(escapeTerminalText(column.label)),
      ...rows.map((row) =>
        terminalWidth(displayCell(model, publisher, row.cells[column.key] ?? null)),
      ),
      4,
    )
    const minimum = Math.min(12, Math.max(4, terminalWidth(column.label)))
    if (remaining < minimum + (columns.length ? 3 : 0)) break
    const size = minimum
    columns.push({
      key: column.key,
      label: escapeTerminalText(column.label),
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
export const viewerAligned = (text: string, size: number, right = false) => {
  const bounded = truncateTerminalText(text, size, 1024),
    padding = ' '.repeat(Math.max(0, size - terminalWidth(bounded)))
  return right ? padding + bounded : bounded + padding
}
function tabs(model: ViewerModel, width: number): string {
  const entries = model
    .destinations()
    .map((entry) => ({ ...entry, label: escapeTerminalText(entry.title) }))
  const current = entries.findIndex((e) => e.key === model.surface)
  const all = entries
    .map((entry, index) => (index === current ? `[${entry.label}]` : entry.label))
    .map(
      (label, index) =>
        `${index && entries[index]!.group !== entries[index - 1]!.group ? 'Application › ' : ''}${label}`,
    )
    .join(' | ')
  if (terminalWidth(all) <= width) return all
  return truncateTerminalText(
    `${current + 1}/${entries.length} [${entries[current]?.label ?? 'Activity'}]  v all views · Tab next`,
    width,
  )
}
const duration = (ms: number) => `${Math.max(0, Math.floor(ms / 1000))}s`
type WorkspaceTone = 'heading' | 'secondary' | 'warning' | 'error' | 'success' | 'selection'
const attentionTone = (priority: number): WorkspaceTone =>
  priority === 2 || priority >= 4 ? 'error' : 'warning'
/** Bounded textual projection for inline output, compact native surfaces and
 * navigation overlays. This projection owns no terminal or renderer lifetime. */
export function viewerFrame(
  model: ViewerModel,
  width: number,
  height: number,
  color = false,
  inspecting = false,
  scroll = 0,
  retainedAnchor?: ScrollAnchor,
  state?: ViewerState,
): ViewerFrame {
  if (width < 1 || height < 1) return { lines: [], references: [] }
  if (!inspecting) return privateInlineFrame(model, width, height, color, scroll, retainedAnchor)
  model.peekSelectedArtifact()
  width = Math.max(1, Math.min(4096, Math.floor(width)))
  const teaserWidth = (cells: number) => {
    const record = model.record
    const prefix =
      record?.kind === 'summary'
        ? 'Summary ▸ '
        : record?.block?.kind === 'report'
          ? 'Report ▸ '
          : record?.journal
            ? `${record.journal.kind === 'diagnostic' ? `Diagnostic (${diagnosticPath(record.journal)})` : record.journal.source}${record.journal.importance === 'info' ? '' : ` · reported ${record.journal.importance}`} · `
            : ''
    model.local.teaserBytes = Math.max(
      3,
      4096 -
        Buffer.byteLength(escapeTerminalText(prefix)) -
        2 -
        (record?.journal?.clipped ? 20 : 0),
    )
    return Math.max(
      1,
      cells - 2 - terminalWidth(escapeTerminalText(prefix)) - (record?.journal?.clipped ? 20 : 0),
    )
  }
  model.local.teaserWidth = teaserWidth(width)
  height = Math.max(1, Math.min(100, Math.floor(height)))
  const panels = state?.panels ?? [],
    panel = panels.at(-1),
    compact = width < 40 || height < 10
  const lines: string[] = [],
    references = viewerReferences(model.record)
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
      ? escapeTerminalText(secondaryPrefix).replaceAll('\n', '\\n').length
      : 0
    return tone === 'secondary'
      ? secondary(plain, color)
      : tone === 'selection'
        ? selection(plain, color, model.theme)
        : tone
          ? heading(plain, tone === 'heading' ? 'info' : tone, color)
          : prefixLength
            ? secondary(plain.slice(0, prefixLength), color) + plain.slice(prefixLength)
            : plain
  }
  const add = (text: string, tone?: WorkspaceTone, secondaryPrefix?: string) => {
    if (lines.length >= height) return false
    const plain = truncateTerminalText(
      escapeTerminalText(text).replaceAll('\n', '\\n'),
      width,
      Math.max(3, Math.min(4096, 32000 - frameBytes - 64)),
    )
    return commit(paint(plain, tone, secondaryPrefix))
  }
  if (compact && panel?.kind === 'exit') {
    add('Leave the TUI?', 'heading')
    if (height >= 4)
      add(model.workspace.phase === 'settled' ? 'Close inspection' : 'Run continues', 'secondary')
    add(panel.leave ? ' Stay  [Leave]' : '[Stay]  Leave')
    add('←/→ Enter Esc stay', 'secondary')
    return { lines, references: [], scroll: 0 }
  }
  const target = `Jig · ${escapeTerminalText(model.workspace.target)}`
  const phase =
    model.workspace.phase === 'settled'
      ? model.workspace.recorded
        ? 'Saved result · read-only'
        : 'Settled · read-only'
      : escapeTerminalText(model.workspace.hostStage)
  const time = `elapsed ${duration(model.workspace.elapsedMs)} · execution limit ${model.workspace.limitMs === undefined ? 'unspecified' : duration(model.workspace.limitMs)}`
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
        (facts.completeness.clipped ||
          (facts.completeness.value !== 'observation ended' &&
            facts.completeness.value !== 'files match the recorded manifest'))
      ? viewerFactText('Evidence', facts.completeness)
      : ''
  const attentionPrefix = sticky
    ? `! full cause${model.attention.length > 1 ? ` (+${model.attention.length - 1})` : ''} · ${escapeTerminalText(sticky.source)} · ${attentionImportance(sticky.priority)}`
    : ''
  const attention = sticky
    ? `${truncateTerminalText(attentionPrefix, Math.max(1, width - Math.min(20, Math.floor(width / 3)) - 2))}: ${escapeTerminalText(sticky.text).split('\n')[0]}`
    : ''
  const observationWarning = model.observationWarning
  if (compact) {
    add(
      `${truncateTerminalText(target, Math.max(1, width - 15))} · ${truncateTerminalText(phase, 12)}`,
      'heading',
    )
    if (observationWarning && lines.length < height - 1) add(observationWarning, 'warning')
    if (height >= 4 && !panel && !observationWarning && !(attention && compactLoss && height === 4))
      add(model.workspace.recorded ? 'Recorded local data' : time, 'secondary')
    if (attention && !panel && lines.length < height - 1)
      add(attention, attentionTone(sticky?.priority ?? 3))
    if (compactLoss && lines.length < height - 1) add(`! ${compactLoss}`, 'warning')
  } else {
    const stage = truncateTerminalText(phase, Math.max(12, Math.floor(width / 3)))
    add(
      `${truncateTerminalText(target, Math.max(1, width - terminalWidth(stage) - 3))} · ${stage}`,
      'heading',
    )
    add(model.workspace.recorded ? 'Recorded local data' : time, 'secondary')
    add(tabs(model, width), 'heading')
    if (observationWarning) add(observationWarning, 'warning')
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
      value: DisplayFact,
      size: number,
      tone?: 'success' | 'warning' | 'error',
    ) => {
      const text = truncateTerminalText(
        escapeTerminalText(viewerFactText(label, value)).replaceAll('\n', '\\n'),
        size,
        4096,
      )
      return tone ? heading(text, tone, color) : text
    }
    commit(
      `${fact('Execution', facts.execution, left, viewerFactTone('execution', facts.execution))} · ${fact('Application', facts.application, right)}`,
    )
    commit(
      `${fact('Cleanup', facts.cleanup, left, viewerFactTone('cleanup', facts.cleanup))} · ${fact('Delivery', facts.delivery, right, viewerFactTone('delivery', facts.delivery))}`,
    )
    if (
      facts.completeness &&
      (facts.completeness.clipped || facts.completeness.value !== 'observation ended')
    )
      add(viewerFactText('Observation', facts.completeness), 'secondary')
  }
  if (!compact && lines.length < height - 2) add('─'.repeat(Math.min(width, 4096)), 'secondary')
  const footer = (
    panel?.kind === 'exit'
      ? '←/→ choose · Enter confirm · Esc stay'
      : panel?.kind === 'filter' || panel?.kind === 'preview-search'
        ? compact
          ? 'Enter set Esc undo'
          : 'Filter draft: Enter apply · Esc discard · Ctrl-C stop'
        : compact
          ? 'q leave ^C stop !'
          : panel?.kind === 'views'
            ? 'q leave · ↑↓ choose · Enter open · Esc back'
            : panel?.kind === 'references'
              ? 'q leave · j/k choose · Enter activate · Esc back'
              : panel?.kind === 'attention'
                ? 'q leave · ←/→ causes · ↑/↓ scroll · Esc back'
                : panel?.kind === 'diagnostics'
                  ? 'q leave · ←/→ reports · ↑/↓ scroll · Esc back'
                  : panel?.kind === 'help'
                    ? 'Esc back · q leave · Ctrl-C stop (live)'
                    : panel?.kind === 'detail' || panel?.kind === 'preview'
                      ? 'q leave · ↑/↓ scroll · / excerpt search · r references · Esc back'
                      : compact
                        ? '! full cause · q leave · Ctrl-C stop'
                        : 'q leave · Tab · ↑↓ · Enter detail · r refs · ! cause · ? help'
  )
    .replaceAll('^C stop', model.workspace.phase === 'settled' ? '^C leave' : '^C stop')
    .replaceAll(
      'Ctrl-C stop (live)',
      model.workspace.phase === 'settled' ? 'Ctrl-C leave' : 'Ctrl-C stops',
    )
    .replaceAll('Ctrl-C stop', model.workspace.phase === 'settled' ? 'Ctrl-C leave' : 'Ctrl-C stop')
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
      if (panel.kind === 'exit')
        content = wrapTerminalText(
          `Leave the TUI?\n${model.workspace.phase === 'settled' ? 'Close this read-only inspection.' : 'Work will continue in the terminal. This does not cancel the run.'}\n\n${panel.leave ? '  Stay    [Leave]' : '[Stay]    Leave'}`,
          width,
        )
      else if (panel.kind === 'views')
        content = (function* () {
          yield 'Views · choose a destination'
          let group = ''
          for (const entry of model.destinations()) {
            if (entry.group !== group) {
              group = entry.group
              yield group === 'application'
                ? 'APPLICATION'
                : group === 'recorded'
                  ? 'RECORDED'
                  : 'RUN'
            }
            yield `${entry.key === panel.selected ? '> ' : '  '}${escapeTerminalText(entry.title)}${entry.source ? ` · ${escapeTerminalText(entry.source)}` : ''}`
          }
        })()
      else if (panel.kind === 'preview-search')
        content = wrapTerminalText(
          `Search retained excerpt\nDraft: ${panel.draft}\nLiteral text only; no files or earlier content are fetched.\nEnter searches; Escape discards.`,
          width,
        )
      else if (panel.kind === 'filter')
        content = wrapTerminalText(
          `Filter supplied records\nDraft: ${panel.draft}\nApplied: ${model.filter || '(none)'}\nRows change only after Enter. Empty Enter clears.`,
          width,
        )
      else if (panel.kind === 'help')
        content = wrapTerminalText(
          panels.at(-2)?.kind === 'filter'
            ? 'Filter editing\nPrintable text is literal, including q j k s r ! ?.\nEnter applies; Escape discards; Backspace/Delete removes the last scalar.\nTab and arrow controls do nothing. Ctrl-C stops live work; Ctrl-D asks before leaving.'
            : 'Workspace help\nv: all grouped views. Tab / Shift-Tab: Execution, Activity, Delivered files and application views.\nArrows / j k: select each summary, report, facts, progress or collection row.\nEnter: expand full detail or retained file content; Escape returns from an overlay or reference jump, and stays at the top level. Wide screens show useful selected context.\nc: next collection; /: edit a collection filter; s: sort supplied rows.\nr: choose a typed reference; Enter activates only in that chooser.\nLeft / Right: collapse or expand the actual tree; in attention or diagnostics choose reports.\nBrackets / PageUp / PageDown: body scroll; Home / End: list ends.\n!: full retained cause and workspace facts; d: attributed diagnostic reports; ?: this help.\nq: confirm leaving; live work continues inline, settled inspection closes. Stay is selected first; arrows or Tab choose, Enter confirms, Escape stays. Ctrl-C: stop live work, confirm closing settled inspection.\nHost returns, application claims, cleanup and delivery remain separate.\nReports are literal; no application readiness is inferred.\nHistory and capture are bounded; omitted content is disclosed.',
          width,
        )
      else if (panel.kind === 'attention') {
        const report = model.attention[panel.index] ?? sticky
        content = report
          ? wrapTerminalText(
              `${report.source} — ${attentionImportance(report.priority)} (${panel.index + 1}/${model.attention.length})\n${report.text}${facts ? `\n\nWorkspace facts\n${model.hostFactsText}` : ''}`,
              width,
            )
          : wrapTerminalText(
              `${model.incomplete ?? 'No retained causes'}${facts ? `\n\nWorkspace facts\n${model.hostFactsText}` : ''}`,
              width,
            )
      } else if (panel.kind === 'diagnostics') {
        const report = diagnostics[panel.index]
        content = report
          ? wrapTerminalText(
              `Diagnostic report ${panel.index + 1}/${diagnostics.length}\nInvocation: ${diagnosticPath(report)}\nSeverity was not supplied by the producer.${diagnosticLoss ? `\n${diagnosticLoss}` : ''}\n\n${report.text}${report.clipped ? '\n[Diagnostic capture truncated]' : ''}`,
              width,
            )
          : [diagnosticLoss || 'No captured diagnostic reports']
      } else if (panel.kind === 'preview')
        content = wrapTerminalText(
          `Immutable ${model.workspace.recorded ? 'recorded-file' : 'delivered-file'} preview: ${model.previewTitle ?? 'verified capture'}${model.preview?.clipped ? ' [capture clipped at 64 KiB]' : ''}\n${model.preview?.image ? viewerPreviewState(model) : (model.preview?.text ?? viewerPreviewState(model))}`,
          width,
        )
      else if (panel.kind === 'references')
        content = references.length
          ? (function* () {
              for (const ref of references)
                yield `${referenceKey(ref) === panel.selected ? '> ' : '  '}${model.resolve(model.record?.publisher ?? model.rootSourceId, ref).label}`
            })()
          : ['No references in the selected record']
      else {
        const record = model.records().find((record) => record.key === panel.key)
        content = record ? viewerDetailLines(model, record, width) : ['Selected record unavailable']
      }
      const requested =
        panel.kind === 'views'
          ? Math.max(
              0,
              model.destinations().findIndex((entry) => entry.key === panel.selected) +
                3 -
                Math.floor(bodyRoom / 2),
            )
          : panel.kind === 'preview' && panel.matchOffset !== undefined
            ? [...wrapTerminalText(model.preview?.text.slice(0, panel.matchOffset) ?? '', width)]
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
        tables = new Map<string, ReturnType<typeof viewerTableColumns>>()
      const sideBySide = width >= 118 && bodyRoom >= 10 && viewerHasContext(model, model.record),
        listWidth = sideBySide ? Math.max(58, Math.floor((width - 3) * 0.55)) : width,
        detailWidth = width - listWidth - 3
      model.local.teaserWidth = teaserWidth(listWidth)
      // Every collapsed record is one physical line; table headers occur once.
      let priorCollection: string | undefined,
        priorSection: string | undefined,
        priorKind = ''
      for (const record of records) {
        if (record.section && record.section !== priorSection) {
          body.push({ text: () => escapeTerminalText(record.section!), tone: 'heading' })
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
              viewerTableColumns(
                model,
                record.publisher ?? model.rootSourceId,
                collection,
                rows,
                listWidth,
                3,
              )
          tables.set(collection.id, table)
          if (priorCollection !== collection.id) {
            const filter = model.local.filters.get(collection.id),
              sort = model.local.sorts.get(collection.id)
            body.push({
              tone: 'heading',
              text: () =>
                `${table.hidden ? `+${table.hidden} columns (Enter detail) · ` : ''}${escapeTerminalText(collection.title)} · ${filter ? `${rows.length} of ${collection.rows.length}` : collection.rows.length} records${collection.total === undefined || collection.total === collection.rows.length ? '' : ` / ${collection.total} reported`}${filter ? ` · filter ${escapeTerminalText(filter)}` : ''}${sort ? ` · sort ${escapeTerminalText(sort.key)}` : ''}`,
            })
            body.push({
              tone: 'heading',
              text: () =>
                '  ' +
                table.columns
                  .map((column) => viewerAligned(column.label, column.size, column.numeric))
                  .join(' | '),
            })
            priorCollection = collection.id
          }
          text = () =>
            record.row
              ? table.columns
                  .map((column) =>
                    viewerAligned(
                      displayCell(
                        model,
                        record.publisher ?? model.rootSourceId,
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
          text = () => `Summary ▸ ${escapeTerminalText(record.text!).split('\n')[0]}`
        else if (record.block?.kind === 'report') {
          const report = record.block
          text = () => `Report ▸ ${escapeTerminalText(report.text).split('\n')[0]}`
        } else if (record.block?.kind === 'facts') {
          const facts = record.block
          text = () =>
            `Facts ▸ ${facts.items
              .slice(0, 2)
              .map(
                (f) =>
                  `${truncateTerminalText(escapeTerminalText(f.label), 24, 1024)} ${truncateTerminalText(cell(f.value), 24, 1024)}`,
              )
              .join(' · ')}${facts.items.length > 2 ? ` · +${facts.items.length - 2} facts` : ''}`
        } else if (record.block?.kind === 'progress')
          text = () =>
            progressText(record.block as Extract<DetailBlock, { kind: 'progress' }>, listWidth - 2)
        else if (record.activity)
          text = () =>
            `${model.sourceLabel(record.publisher!)} · ${escapeTerminalText(record.activity!.label)}${record.activity!.progress ? ` · ${record.activity!.progress.completed}${record.activity!.progress.total === undefined ? '' : `/${record.activity!.progress.total}`}` : ''}`
        else if (record.journal)
          text = () =>
            `${record.journal!.kind === 'diagnostic' ? `Diagnostic (${escapeTerminalText(diagnosticPath(record.journal!))})` : record.journal!.source}${record.journal!.importance === 'info' ? '' : ` · reported ${record.journal!.importance}`} · ${escapeTerminalText(record.journal!.text).split('\n')[0]}${record.journal!.clipped ? ' [capture truncated]' : ''}`
        else if (record.call)
          text = () =>
            `${'  '.repeat(Math.min(record.depth ?? 0, 12))}${model.descendants(record.call!.key).length ? (model.treeExpanded(record.call!.key) ? '▾' : '▸') : '·'} ${escapeTerminalText(record.call!.intent ?? record.call!.slot)} · ${record.call!.state}${record.hidden ? ` (${record.hidden} calls${record.issues ? `; ${record.issues} issues` : ''})` : ''}`
        else text = () => escapeTerminalText(record.text ?? '').split('\n')[0] ?? ''
        body.push({
          key: record.key,
          text: () => truncateTerminalText(prefix + text(), listWidth, 4096),
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
      if (model.feedback) body.push({ text: () => escapeTerminalText(model.feedback) })
      const selectedIndex = body.findIndex((line) => line.key === model.record?.key)
      const retained = retainedAnchor && body.findIndex((line) => line.key === retainedAnchor.key)
      const desired =
        retained !== undefined && retained >= 0
          ? retained + retainedAnchor!.offset
          : scroll || model.local.scroll || Math.max(0, selectedIndex - Math.floor(bodyRoom / 2))
      offset = Math.max(0, Math.min(desired, Math.max(0, body.length - bodyRoom)))
      if (sideBySide) {
        const detail: string[] = ['Selected detail · Enter expand · r references', '']
        for (const line of viewerDetailLines(model, model.record!, detailWidth, true)) {
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
          const left = viewerAligned(
            escapeTerminalText(line?.text() ?? '').replaceAll('\n', '\\n'),
            listWidth,
          )
          const right = truncateTerminalText(
            escapeTerminalText(detail[i] ?? '').replaceAll('\n', '\\n'),
            detailWidth,
          )
          if (
            !commit(
              paint(left, line?.tone, line?.secondaryPrefix) +
                secondary(' │ ', color) +
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
        ? 'q leave ^C leave ↓'
        : 'q leave ^C stop ↓'
      : clipped
        ? `↓ more · ${footer}`
        : hasNewActivity
          ? `+ new activity · ${footer}`
          : footer,
    'secondary',
  )
  return { lines, references, scroll: offset, ...(anchor ? { anchor } : {}) }
}
