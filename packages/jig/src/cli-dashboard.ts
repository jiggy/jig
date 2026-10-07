import { StringDecoder } from 'node:string_decoder'
import type { Block, DetailBlock, Reference, Value } from '@jigging/user-updates'
import { privateCliHeading } from './cli-presentation.js'
import type { PrivateRunModel } from './cli-run-model.js'
import {
  privateTerminalWidth,
  privateTruncateUpdate,
  privateUpdateText,
} from './cli-user-updates.js'

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
export function privateDashboardFrame(
  model: PrivateRunModel,
  width: number,
  height: number,
  color = false,
  inspecting = false,
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
          const selected = inspecting && model.collection?.id === b.id
          const rows = selected ? model.visibleRows() : b.rows
          if (selected && model.filter) add(`Filter supplied records: ${model.filter}`)
          if (!rows.length) add('No supplied records in this view')
          for (const row of rows.slice(0, inspecting ? 128 : 4)) {
            anchors.push({
              key: JSON.stringify([model.selected?.key, b.id, row.id]),
              line: lines.length,
            })
            if (selected && model.row?.id === row.id) anchor = lines.length
            add(
              `${selected && model.row?.id === row.id ? '> ' : '  '}${b.columns.map((c) => `${c.label}: ${value(publisher, row.cells[c.key] ?? null)}`).join(' | ')}`,
            )
            if (!inspecting || (selected && model.row?.id === row.id))
              blocks(publisher, row.details ?? [])
          }
          if (!inspecting && rows.length > 4)
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
  if (inspecting) {
    add(
      [
        'Overview',
        ...[...model.views.values()].map(
          (v) => `${model.sourceLabel(v.publisher)}: ${v.value.title}`,
        ),
      ].join('  |  '),
    )
  }
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
      `Immutable delivered-file preview: ${model.previewTitle ?? 'verified capture'}${model.preview.clipped ? ' — clipped at 64 KiB' : ''}`,
    )
    add(model.preview.text)
  }
  if (model.feedback) add(model.feedback)
  const footer = inspecting
    ? 'Tab views · c collections · j/k rows · / filter · s sort · r reference · Enter open · [/] scroll · q leave'
    : 'Read-only observations · --display dashboard opens the inspector'
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

/** An explicit inspector borrows stdin until it exits; Jig retains cancellation ownership. */
export class PrivateDashboardInput {
  #active = false
  #raw = false
  #paused = true
  #search: string | undefined
  #reference: Reference | undefined
  #referenceView: string | undefined
  #referenceVersion = -1
  #referenceMissing = false
  #scroll = 0
  #scrollView: string | undefined
  #scrollAnchor: ScrollAnchor | undefined
  #references: readonly Reference[] = []
  #settled = false
  #resolve: (() => void) | undefined
  #ended = false
  #pending = ''
  #escapeTimer: ReturnType<typeof setTimeout> | undefined
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
  ) {}
  get active(): boolean {
    return this.#active
  }
  get scroll(): number {
    return this.#scrollView === this.model.selected?.key ? this.#scroll : 0
  }
  get anchor(): ScrollAnchor | undefined {
    return this.#scrollView === this.model.selected?.key ? this.#scrollAnchor : undefined
  }
  start(): void {
    if (this.#active || this.#ended) return
    this.#raw = this.input.isRaw
    // A fresh idle stream has readableFlowing=null and isPaused()=false.
    // Resuming it is our ownership; pause it again so inspection cannot keep
    // the finite command alive after its input listener is removed.
    this.#paused = this.input.isPaused() || this.input.readableFlowing !== true
    this.input.setRawMode(true)
    this.input.on('data', this.#data)
    this.input.once('end', this.#end)
    this.input.resume()
    this.#active = true
  }
  frame(references: readonly Reference[], scroll?: number, anchor?: ScrollAnchor): void {
    this.#scrollView = this.model.selected?.key
    if (scroll !== undefined) this.#scroll = scroll
    this.#scrollAnchor = anchor
    this.#references = references
    const view = this.model.selected?.key
    if (view !== this.#referenceView || this.#referenceVersion !== this.model.selectionVersion) {
      this.#referenceView = view
      this.#referenceVersion = this.model.selectionVersion
      this.#reference = references[0]
      this.#referenceMissing = false
    } else if (this.#reference !== undefined) {
      this.#referenceMissing = !references.some(
        (ref) => referenceKey(ref) === referenceKey(this.#reference!),
      )
      if (this.#referenceMissing)
        this.model.feedback = 'Selected reference unavailable; press r to choose another'
    } else if (!this.#referenceMissing) this.#reference = references[0]
  }
  async settled(): Promise<void> {
    this.#settled = true
    if (!this.#active) return
    await new Promise<void>((resolve) => {
      this.#resolve = resolve
    })
  }
  markSettled(): void {
    this.#settled = true
  }
  leave(): void {
    this.#ended = true
    clearTimeout(this.#escapeTimer)
    this.#escapeTimer = undefined
    this.#pending = ''
    if (this.#active) {
      this.input.removeListener('data', this.#data)
      this.input.removeListener('end', this.#end)
      this.input.setRawMode(this.#raw)
      if (this.#paused) this.input.pause()
      this.#active = false
    }
    this.#resolve?.()
    this.#resolve = undefined
    this.change()
  }
  #drainKeys(): void {
    clearTimeout(this.#escapeTimer)
    this.#escapeTimer = undefined
    while (this.#active && this.#pending) {
      if (this.#pending.startsWith('\u001b')) {
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Decode bounded terminal escape sequences.
        const sequence = /^\u001b\[[0-9;]*[A-Za-z~]/.exec(this.#pending)
        if (sequence) {
          this.#pending = this.#pending.slice(sequence[0].length)
          this.#read(sequence[0])
          continue
        }
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Retain an incomplete terminal escape sequence until its owned timeout.
        const incomplete = /^\u001b\[[0-9;]*$/.test(this.#pending)
        if (this.#pending.length === 1 || incomplete) {
          this.#escapeTimer = setTimeout(() => {
            this.#escapeTimer = undefined
            this.#pending = ''
            this.#read('\u001b')
          }, 30)
          return
        }
        this.#pending = ''
        this.#read('\u001b')
        return
      }
      const scalar = String.fromCodePoint(this.#pending.codePointAt(0)!)
      this.#pending = this.#pending.slice(scalar.length)
      this.#read(scalar)
    }
  }
  #read(text: string): void {
    if (text === '\u0003') {
      if (this.#settled) this.leave()
      else {
        this.cancel()
        this.leave()
      }
      return
    }
    if (text === '\u001b' || text === '\u0004') {
      this.leave()
      return
    }
    if (text === '\u001b[A') text = 'k'
    if (text === '\u001b[B') text = 'j'
    if (this.#search !== undefined) {
      if (text === '\r' || text === '\n') {
        this.#search = undefined
        return
      }
      if (text === '\u007f') this.#search = [...this.#search].slice(0, -1).join('')
      else if (!/[\p{Cc}\p{Cf}]/u.test(text))
        this.#search = [...(this.#search + text)].slice(0, 128).join('')
      this.model.filterRows(this.#search)
      return
    }
    if (text === 'q' || text === '\u001b' || text === '\u0004') {
      this.leave()
      return
    }
    if (text === '\t') {
      this.model.cycleView(1)
      this.#scroll = 0
      this.#scrollAnchor = undefined
    } else if (text === '\u001b[Z') {
      this.model.cycleView(-1)
      this.#scroll = 0
      this.#scrollAnchor = undefined
    } else if (text === 'j') {
      this.model.moveRow(1)
      this.#scroll = 0
      this.#scrollAnchor = undefined
    } else if (text === 'k') {
      this.model.moveRow(-1)
      this.#scroll = 0
      this.#scrollAnchor = undefined
    } else if (text === 'c') {
      this.model.cycleCollection()
      this.#scroll = 0
      this.#scrollAnchor = undefined
    } else if (text === 's') {
      this.model.sortRows()
      this.#scroll = 0
      this.#scrollAnchor = undefined
    } else if (text === '/') {
      this.#search = ''
      this.#scroll = 0
      this.#scrollAnchor = undefined
      this.model.filterRows('')
    } else if (text === ']') {
      this.#scroll = Math.min(8192, this.#scroll + 3)
      this.#scrollAnchor = undefined
    } else if (text === '[') {
      this.#scroll = Math.max(0, this.#scroll - 3)
      this.#scrollAnchor = undefined
    } else if (text === 'r') {
      const prior = this.#references.findIndex(
        (ref) =>
          this.#reference !== undefined && referenceKey(ref) === referenceKey(this.#reference),
      )
      const next = (prior + 1) % Math.max(1, this.#references.length)
      this.#reference = this.#references[next]
      this.#referenceMissing = false
      this.model.feedback = this.#reference
        ? `Selected reference ${next + 1}; Enter to open`
        : 'No references in this view'
    } else if (text === '\r' || text === '\n') {
      if (this.#referenceMissing)
        this.model.feedback = 'Selected reference unavailable; press r to choose another'
      else if (
        this.#reference &&
        this.model.selected &&
        this.model.selected.key === this.#referenceView
      )
        void this.model.activate(this.model.selected.publisher, this.#reference)
    }
    this.change()
  }
}
function referenceKey(ref: Reference): string {
  return JSON.stringify(
    ref.kind === 'call'
      ? ['call', ref.operationId]
      : ref.kind === 'record'
        ? ['record', ref.viewId, ref.collectionId, ref.rowId]
        : ['artifact', ref.attachment, ref.path],
  )
}
