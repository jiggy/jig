import { PassThrough, Writable } from 'node:stream'
import type { Reference } from '@jigging/user-updates'
import type {
  BoxRenderable,
  CapturedLine,
  CliRenderer,
  ScrollBoxRenderable,
  StyledText,
} from '@opentui/core'
import {
  type ViewerDetailPart,
  type ViewerState,
  viewerAligned,
  viewerDetailParts,
  viewerFrame,
  viewerHasContext,
  viewerPreviewState,
  viewerReferences,
  viewerTableColumns,
} from './projection.js'
import { callObservationSpans, displayDuration } from '@jigging/display-model'
import { syntaxHex } from './style.js'
import {
  type ViewerModel,
  type ViewerRecord,
  attentionImportance,
  observedTime,
  viewerFactText,
  viewerFactTone,
} from './viewer-model.js'
import {
  terminalWidth,
  truncateTerminalText,
  escapeTerminalText,
  wrapTerminalText,
} from './text.js'

type Core = typeof import('@opentui/core')
const palettes = {
  dark: {
    bg: '#15171c',
    panel: '#1b1e25',
    fg: '#e3e7ef',
    muted: '#939dad',
    edge: '#343d4b',
    accent: '#9bb8ff',
    label: '#8bd5ca',
    select: '#293750',
    warning: '#efc581',
    error: '#fb9c96',
    success: '#afd6a3',
  },
  light: {
    bg: '#fafafa',
    panel: '#f0f2f6',
    fg: '#202633',
    muted: '#59677d',
    edge: '#bac2d0',
    accent: '#2452a0',
    label: '#006f7b',
    select: '#dbe7ff',
    warning: '#8a520c',
    error: '#a82b29',
    success: '#32652d',
  },
}
const safe = (text: string) => escapeTerminalText(text)
const one = (text: string) => safe(text).replaceAll('\n', ' · ')

/** Native layout and cell rendering, with Jig retaining the single bounded
 * writer, raw input, signal, execution and restoration owners. The inert streams
 * prevent Core terminal queries or native output from reaching the user. */
export class NativeRenderer {
  readonly renderer: CliRenderer
  readonly #input: PassThrough
  readonly #output: Writable
  readonly #shell: BoxRenderable
  readonly #list: ScrollBoxRenderable
  readonly #detail: ScrollBoxRenderable
  readonly #navigation: ScrollBoxRenderable
  readonly #header: InstanceType<Core['TextRenderable']>
  readonly #status: InstanceType<Core['TextRenderable']>
  readonly #tabs: InstanceType<Core['TextRenderable']>
  readonly #attention: InstanceType<Core['TextRenderable']>
  readonly #stale: InstanceType<Core['TextRenderable']>
  readonly #feedback: InstanceType<Core['TextRenderable']>
  readonly #footer: InstanceType<Core['TextRenderable']>
  readonly #body: BoxRenderable
  readonly #compact: InstanceType<Core['TextRenderable']>
  #signature = ''
  #lastFrame = ''
  #selection = ''
  #reveal: string | undefined
  #revealNavigation: string | undefined
  #revealDetail: string | undefined
  #detailScrollTarget: number | undefined
  #closed = false
  readonly #layout = () => {
    if (this.#detailScrollTarget !== undefined && !this.#closed) {
      const target = this.#detailScrollTarget
      this.#detailScrollTarget = undefined
      this.#detail.scrollTop = target
    }
    if (this.#reveal && !this.#closed) {
      const reveal = this.#reveal
      this.#reveal = undefined
      this.#list.scrollChildIntoView(reveal)
    }
    if (this.#revealNavigation && !this.#closed) {
      this.#navigation.scrollChildIntoView(this.#revealNavigation)
      this.#revealNavigation = undefined
    }
    if (this.#revealDetail && !this.#closed) {
      this.#detail.scrollChildIntoView(this.#revealDetail)
      this.#revealDetail = undefined
    }
  }
  private constructor(
    readonly core: Core,
    renderer: CliRenderer,
    input: PassThrough,
    output: Writable,
    readonly model: ViewerModel,
  ) {
    this.renderer = renderer
    this.#input = input
    this.#output = output
    const p = this.model.theme === 'one-light' ? palettes.light : palettes.dark
    this.#shell = new core.BoxRenderable(renderer, {
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      paddingX: 2,
      paddingY: 1,
      backgroundColor: p.bg,
    })
    renderer.root.add(this.#shell)
    this.#header = new core.TextRenderable(renderer, {
      height: 1,
      fg: p.fg,
      attributes: core.TextAttributes.BOLD,
      truncate: true,
    })
    this.#status = new core.TextRenderable(renderer, { height: 1, fg: p.muted, truncate: true })
    this.#tabs = new core.TextRenderable(renderer, {
      height: 1,
      fg: p.accent,
      attributes: core.TextAttributes.BOLD,
      truncate: true,
    })
    this.#attention = new core.TextRenderable(renderer, { height: 1, fg: p.muted, truncate: true })
    this.#stale = new core.TextRenderable(renderer, {
      height: 1,
      fg: p.warning,
      truncate: true,
      visible: false,
    })
    for (const item of [this.#header, this.#status, this.#tabs, this.#stale, this.#attention])
      this.#shell.add(item)
    this.#feedback = new core.TextRenderable(renderer, {
      height: 1,
      fg: p.accent,
      truncate: true,
      visible: false,
    })
    this.#shell.add(this.#feedback)
    this.#body = new core.BoxRenderable(renderer, {
      width: '100%',
      flexGrow: 1,
      minHeight: 1,
      flexDirection: 'row',
      gap: 1,
      marginTop: 1,
    })
    this.#shell.add(this.#body)
    const options = {
      height: '100%' as const,
      minWidth: 1,
      scrollY: true,
      scrollX: false,
      flexShrink: 0,
      border: true,
      borderStyle: 'rounded' as const,
      borderColor: p.edge,
      titleColor: p.muted,
      backgroundColor: p.panel,
      paddingX: 1,
      paddingY: 0,
    }
    this.#navigation = new core.ScrollBoxRenderable(renderer, {
      ...options,
      width: 22,
      visible: false,
    })
    this.#list = new core.ScrollBoxRenderable(renderer, { ...options, width: '100%' })
    this.#detail = new core.ScrollBoxRenderable(renderer, {
      ...options,
      width: '40%',
      visible: false,
    })
    this.#body.add(this.#navigation)
    this.#body.add(this.#list)
    this.#body.add(this.#detail)
    this.#footer = new core.TextRenderable(renderer, {
      height: 2,
      paddingTop: 1,
      fg: p.muted,
      truncate: true,
    })
    this.#shell.add(this.#footer)
    this.#compact = new core.TextRenderable(renderer, {
      width: '100%',
      height: '100%',
      fg: p.fg,
      bg: p.bg,
      visible: false,
    })
    renderer.root.add(this.#compact)
    renderer.on('frame', this.#layout)
  }
  static async create(
    core: Core,
    model: ViewerModel,
    width: number,
    height: number,
  ): Promise<NativeRenderer> {
    width = Math.min(4096, Math.max(18, Math.floor(width)))
    height = Math.min(100, Math.max(4, Math.floor(height)))
    const input = Object.assign(new PassThrough(), { isTTY: false, setRawMode: () => input })
    const output = Object.assign(
      new Writable({ write: (_chunk, _encoding, callback) => callback() }),
      { isTTY: false, columns: width, rows: height },
    )
    let renderer: CliRenderer | undefined
    try {
      renderer = await core.createCliRenderer({
        stdin: input as unknown as NodeJS.ReadStream,
        stdout: output as unknown as NodeJS.WriteStream,
        width,
        height,
        bufferedOutput: 'memory',
        remote: true,
        forwardEnvKeys: [],
        exitSignals: [],
        exitOnCtrlC: false,
        useMouse: false,
        useKittyKeyboard: null,
        consoleMode: 'disabled',
        openConsoleOnError: false,
        useThread: false,
        targetFps: 10,
        maxFps: 10,
      })
      return new NativeRenderer(core, renderer, input, output, model)
    } catch (error) {
      renderer?.destroy()
      input.destroy()
      output.destroy()
      throw error
    }
  }
  #text(
    parent: BoxRenderable,
    content: string | StyledText,
    role: 'normal' | 'muted' | 'accent' | 'warning' | 'error' = 'normal',
    strong = false,
  ) {
    const p = this.model.theme === 'one-light' ? palettes.light : palettes.dark
    const node = new this.core.TextRenderable(this.renderer, {
      content: typeof content === 'string' ? safe(content) : content,
      fg: role === 'normal' ? p.fg : role === 'muted' ? p.muted : p[role],
      attributes: strong ? this.core.TextAttributes.BOLD : 0,
      wrapMode: 'word',
      width: '100%',
      flexShrink: 0,
    })
    parent.add(node)
  }
  #field(label: string, value: string | number | boolean | null, reference = false): StyledText {
    const p = this.model.theme === 'one-light' ? palettes.light : palettes.dark
    const role = reference
      ? 'key'
      : value === null || typeof value === 'boolean'
        ? 'literal'
        : typeof value === 'number'
          ? 'number'
          : 'string'
    return this.core
      .t`${this.core.bold(this.core.fg(p.label)(safe(label)))}${this.core.fg(p.muted)(': ')}${this.core.fg(reference ? p.accent : typeof value === 'string' ? p.fg : `#${syntaxHex(role, this.model.theme)}`)(safe(String(value)))}`
  }
  #value(text: string): StyledText {
    // Syntax colors are lexical decoration of escaped literal data, never a verdict
    // or command recognizer. Only host-generated recorded-value parts use this.
    const result = new this.core.StyledText([])
    const value = safe(text)
    const token = /"(?:[^"\\]|\\.)*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
    let offset = 0
    for (const match of value.matchAll(token)) {
      if (match.index > offset)
        result.chunks.push(
          this.core.fg(this.model.theme === 'one-light' ? palettes.light.fg : palettes.dark.fg)(
            value.slice(offset, match.index),
          ),
        )
      const role = match[0].startsWith('"')
        ? /^\s*:/.test(value.slice(match.index + match[0].length))
          ? 'key'
          : 'string'
        : /^(true|false|null)$/.test(match[0])
          ? 'literal'
          : 'number'
      result.chunks.push(this.core.fg(`#${syntaxHex(role, this.model.theme)}`)(match[0]))
      offset = match.index + match[0].length
    }
    if (offset < value.length)
      result.chunks.push(
        this.core.fg(this.model.theme === 'one-light' ? palettes.light.fg : palettes.dark.fg)(
          value.slice(offset),
        ),
      )
    return result
  }
  #parts(parent: BoxRenderable, parts: readonly ViewerDetailPart[], publisher: string) {
    if (!parts.length)
      this.#text(
        parent,
        'No additional detail was supplied. This entry is shown in full in the list.',
        'muted',
      )
    for (const part of parts) {
      if (part.kind === 'field') {
        const reference = part.value !== null && typeof part.value === 'object'
        const value = reference
          ? this.model.resolve(publisher, part.value as Reference).label
          : (part.value as string | number | boolean | null)
        this.#text(parent, this.#field(part.label, value, reference))
      } else if (part.kind === 'heading') {
        this.#text(parent, `\n${part.text}`, 'accent', true)
      } else if (part.kind === 'value') this.#text(parent, this.#value(part.text))
      else this.#text(parent, part.text, part.kind === 'note' ? 'muted' : 'normal')
    }
  }
  #capturedContent(parent: BoxRenderable): void {
    const p = this.model.theme === 'one-light' ? palettes.light : palettes.dark
    this.#text(parent, this.model.previewTitle ?? 'Immutable captured content', 'accent', true)
    if (!this.model.preview || !this.model.preview.text)
      this.#text(parent, viewerPreviewState(this.model))
    else {
      const text = this.model.preview.text
      if (text.startsWith('diff --git ') || text.startsWith('--- ')) {
        const content = new this.core.StyledText([])
        const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? []
        for (const line of lines.slice(0, 256)) {
          const role =
            line.startsWith('+') && !line.startsWith('+++')
              ? p.success
              : line.startsWith('-') && !line.startsWith('---')
                ? p.error
                : line.startsWith('@@')
                  ? p.accent
                  : p.fg
          content.chunks.push(this.core.fg(role)(safe(line)))
        }
        if (lines.length > 256)
          content.chunks.push(this.core.fg(p.fg)(safe(lines.slice(256).join(''))))
        this.#text(parent, content)
      } else this.#text(parent, text)
    }
    this.#text(
      parent,
      `${this.model.artifactCapture.provenance === 'recorded-capture' ? 'Recorded capture' : 'Verified delivery'}${this.model.preview ? ` · ${this.model.preview.bytes} bytes${this.model.preview.clipped ? ' · excerpt clipped at 64 KiB' : ''}` : ''}`,
      'muted',
    )
  }
  #line(parent: BoxRenderable, content: string | StyledText, strong = false) {
    const p = this.model.theme === 'one-light' ? palettes.light : palettes.dark
    parent.add(
      new this.core.TextRenderable(this.renderer, {
        content: typeof content === 'string' ? safe(content) : content,
        fg: p.fg,
        attributes: strong ? this.core.TextAttributes.BOLD : 0,
        width: '100%',
        height: 1,
        truncate: true,
        flexShrink: 0,
      }),
    )
  }
  #brief(record: ViewerRecord): string {
    if (record.file) return record.file.path
    if (record.row && record.collection)
      return String(record.row.cells[record.collection.columns[0]!.key] ?? 'null')
    if (record.call) return record.call.intent ?? record.call.slot
    if (record.activity) return record.activity.label
    if (record.journal) return record.journal.text.split('\n')[0] ?? ''
    if (record.block?.kind === 'progress') return record.block.label
    if (record.block?.kind === 'facts') return 'Facts'
    return (
      (record.block?.kind === 'report' ? record.block.text : (record.text ?? '')).split('\n')[0] ??
      ''
    )
  }
  #row(
    parent: BoxRenderable,
    record: ViewerRecord,
    width: number,
    table: ReturnType<typeof viewerTableColumns> | undefined,
    spans: ReturnType<typeof callObservationSpans>['spans'],
  ) {
    const p = this.model.theme === 'one-light' ? palettes.light : palettes.dark
    const selected = this.model.record?.key === record.key
    const line = new this.core.StyledText([])
    const add = (text: string, color = p.fg, bold = false) =>
      line.chunks.push(bold ? this.core.bold(this.core.fg(color)(text)) : this.core.fg(color)(text))
    add(selected ? '› ' : '  ', selected ? p.accent : p.muted, selected)
    if (record.row && table) {
      table.columns.forEach((column, index) => {
        if (index) add(' │ ', p.edge)
        const value = record.row!.cells[column.key] ?? null
        const reference = value !== null && typeof value === 'object'
        const text = reference
          ? this.model.resolve(record.publisher ?? this.model.rootSourceId, value).label
          : String(value)
        add(
          viewerAligned(one(text), column.size, column.numeric),
          reference || index === 0 ? p.accent : p.fg,
          selected && index === 0,
        )
      })
    } else if (record.call) {
      const n = record.call
      const indent = '  '.repeat(Math.min(record.depth ?? 0, 12))
      const branch = this.model.descendants(n.key).length
        ? this.model.treeExpanded(n.key)
          ? '▾'
          : '▸'
        : '·'
      const interval = spans.get(n.key)
      const timeline = width >= 90 && interval
      const suffix = record.hidden
        ? ` +${record.hidden}${record.issues ? ` / ${record.issues} issues` : ''}`
        : ''
      const stateWidth = n.state.length + suffix.length
      const titleWidth = Math.max(8, width - 4 - indent.length - stateWidth - (timeline ? 32 : 0))
      add(indent + branch + ' ', p.muted)
      add(viewerAligned(one(n.intent ?? n.slot), titleWidth), selected ? p.accent : p.fg, selected)
      add('  ')
      const tone =
        n.state === 'failed'
          ? p.error
          : n.state === 'uncertain' || n.state === 'cancel-requested'
            ? p.warning
            : n.state === 'active' || n.state === 'requested'
              ? p.accent
              : p.muted
      add(n.state, tone)
      add(suffix, record.issues ? p.warning : p.muted)
      if (timeline) {
        const start = Math.min(15, Math.floor((interval.x * 16) / 1000))
        const size = Math.max(1, Math.min(16 - start, Math.round((interval.width * 16) / 1000)))
        add('  ' + ' '.repeat(start), p.muted)
        add((interval.milliseconds ? '━' : '·').repeat(size), tone)
        add(' '.repeat(16 - start - size) + ' ' + displayDuration(interval.milliseconds), p.muted)
      }
    } else if (record.file) {
      const pathWidth = Math.max(8, width - 26)
      add(viewerAligned(one(record.file.path), pathWidth), selected ? p.accent : p.fg, selected)
      add('  ' + record.file.state + (record.file.clipped ? ' · clipped' : ''), p.muted)
    } else if (record.block?.kind === 'progress') {
      const b = record.block
      const count = `${b.completed}${b.total === undefined ? '' : ` / ${b.total}`}${b.unit ? ` ${one(b.unit)}` : ''}`
      add(
        truncateTerminalText(one(b.label), Math.max(8, width - count.length - 20)),
        p.fg,
        selected,
      )
      if (b.total) {
        const filled = Math.min(12, Math.floor((b.completed / b.total) * 12))
        add('  ' + '━'.repeat(filled) + '─'.repeat(12 - filled), p.accent)
      }
      add('  ' + count, p.accent)
    } else {
      const prefix = record.journal
        ? `${one(record.journal.source)} · `
        : record.activity
          ? `${one(this.model.sourceLabel(record.publisher!))} · `
          : ''
      add(prefix, p.muted)
      const tone =
        record.journal?.importance === 'error'
          ? p.error
          : record.journal?.importance === 'warning'
            ? p.warning
            : selected
              ? p.accent
              : p.fg
      let text = this.#brief(record)
      if (record.block?.kind === 'facts')
        text += ` · ${record.block.items.length} fields · Enter expand`
      add(
        truncateTerminalText(one(text), Math.max(1, width - 2 - terminalWidth(prefix))),
        tone,
        selected,
      )
    }
    this.#line(parent, line)
  }
  #capture(color: boolean): string {
    const text = nativeCells(this.renderer.currentRenderBuffer.getSpanLines(), color)
    if (text === this.#lastFrame) return ''
    this.#lastFrame = text
    return text
  }
  async frame(
    width: number,
    height: number,
    state: ViewerState,
    scroll: number,
    color: boolean,
  ): Promise<{ text: string; references: readonly Reference[]; scroll: number }> {
    if (this.#closed) return { text: '', references: [], scroll: 0 }
    this.model.peekSelectedArtifact()
    const model = this.model,
      panel = state.panels.at(-1),
      p = this.model.theme === 'one-light' ? palettes.light : palettes.dark
    width = Math.min(4096, Math.max(18, Math.floor(width)))
    height = Math.min(100, Math.max(4, Math.floor(height)))
    if (this.renderer.width !== width || this.renderer.height !== height) {
      this.#selection = ''
      this.renderer.resize(width, height)
    }
    const compact = width < 50 || height < 14
    this.#shell.visible = !compact
    this.#compact.visible = compact
    if (compact) {
      const frame = viewerFrame(model, width, height, false, true, scroll, undefined, state)
      this.#compact.content = frame.lines.join('\n')
      await this.renderer.idle()
      return this.#closed
        ? { text: '', references: [], scroll: 0 }
        : {
            text: this.#capture(color),
            references: frame.references,
            scroll: frame.scroll ?? scroll,
          }
    }
    this.#shell.paddingX = width < 50 ? 0 : 2
    this.#shell.paddingY = height < 14 ? 0 : 1
    const settled = model.workspace.phase === 'settled',
      facts = model.workspace.facts
    const elapsed = Math.max(0, Math.floor(model.workspace.elapsedMs / 1000))
    const phase = settled
      ? model.workspace.recorded
        ? 'Saved result · read-only'
        : `Settled · ${elapsed}s · read-only`
      : one(model.workspace.hostStage)
    const target = truncateTerminalText(
      one(model.workspace.target),
      Math.max(1, width - 4 - terminalWidth(`Jig  ·    ·  ${phase}`)),
    )
    this.#header.content = `Jig  ·  ${target}  ·  ${phase}`
    const execution = facts ? one(viewerFactText('Execution', facts.execution)) : ''
    const application = facts ? one(viewerFactText('Application', facts.application)) : ''
    const cleanup = facts ? one(viewerFactText('Cleanup', facts.cleanup)) : ''
    const delivery = facts ? one(viewerFactText('Delivery', facts.delivery)) : ''
    const splitFacts = Boolean(
      facts &&
        terminalWidth(`${execution} · ${application} · ${cleanup} · ${delivery}`) > width - 4,
    )
    this.#status.height = splitFacts ? 2 : 1
    const factWidth = Math.max(1, Math.floor((width - 7) / 2))
    const factColor = (field: 'execution' | 'cleanup' | 'delivery') => {
      const tone = facts && viewerFactTone(field, facts[field])
      return tone ? p[tone] : p.muted
    }
    this.#status.content = facts
      ? this.core
          .t`${this.core.fg(factColor('execution'))(truncateTerminalText(execution, splitFacts ? factWidth : width))} · ${truncateTerminalText(application, splitFacts ? factWidth : width)}${splitFacts ? '\n' : ' · '}${this.core.fg(factColor('cleanup'))(truncateTerminalText(cleanup, splitFacts ? factWidth : width))} · ${this.core.fg(factColor('delivery'))(truncateTerminalText(delivery, splitFacts ? factWidth : width))}`
      : `elapsed ${elapsed}s · limit ${model.workspace.limitMs === undefined ? 'unspecified' : `${Math.floor(model.workspace.limitMs / 1000)}s`} · Application reports provisional`
    const destinations = model.destinations()
    const destination = destinations.find((entry) => entry.key === model.surface)
    const rail = width >= 150 && height >= 24
    this.#navigation.visible = rail
    this.#navigation.title = model.workspace.recorded ? ' Saved packet ' : ' Run workspace '
    this.#tabs.content = `${destination?.group === 'application' ? `Application · ${one(destination.source)} › ` : model.workspace.recorded ? 'Recorded › ' : 'Run › '}[${one(destination?.title ?? 'Activity')}] · v all views${rail ? '' : ' · Tab next'}`
    const sticky = model.sticky
    const omissions = Object.entries(model.journalOmitted)
      .filter(([, n]) => n)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ')
    const observation = model.workspace.recorded
      ? 'Recorded local claims · no live observation'
      : model.selected
        ? `${model.selected.ended ? one(model.selected.ended) : 'Live observations'} · last update ${observedTime(model.selected.updated)}`
        : facts?.completeness
          ? one(viewerFactText('Observation', facts.completeness))
          : 'Read-only observations'
    this.#attention.content = sticky
      ? `! ${one(sticky.source)} · ${attentionImportance(sticky.priority)} · ${one(sticky.text)} · ! full cause`
      : model.incomplete
        ? one(model.incomplete)
        : omissions
          ? `History incomplete: ${omissions} omitted · d diagnostics`
          : model.journal.some((e) => e.kind === 'diagnostic')
            ? `d diagnostics · importance was not supplied · ${observation}`
            : observation
    this.#attention.fg = sticky
      ? sticky.priority === 2 || sticky.priority >= 4
        ? p.error
        : p.warning
      : p.muted
    this.#stale.visible = Boolean(model.observationWarning)
    this.#stale.content = model.observationWarning ? one(model.observationWarning) : ''
    this.#feedback.visible = Boolean(model.feedback)
    this.#feedback.content = model.feedback ? `Action · ${one(model.feedback)}` : ''
    const available = width - 4 - (rail ? 23 : 0)
    model.local.teaserBytes = 4096
    const selectedPrefix = model.record?.journal
      ? `${one(model.record.journal.source)} · `
      : model.record?.activity
        ? `${one(model.sourceLabel(model.record.publisher!))} · `
        : ''
    const teaserWidth = (cells: number) => Math.max(1, cells - 6 - terminalWidth(selectedPrefix))
    model.local.teaserWidth = teaserWidth(available)
    const wide = width >= 118 && height >= 24 && viewerHasContext(model, model.record)
    const detailWidth = Math.max(40, Math.floor(available * 0.42))
    const listWidth = wide ? available - detailWidth - 1 : available
    model.local.teaserWidth = teaserWidth(listWidth)
    this.#list.visible = !panel
    this.#list.width = listWidth
    this.#detail.visible = Boolean(panel || wide)
    this.#detail.width = panel ? available : detailWidth
    this.#list.title = ` ${one(destination?.title ?? 'Activity')} `
    this.#detail.title = ` ${panel ? (panel.kind === 'preview' ? 'Captured evidence' : panel.kind) : 'Context'} `
    const records = model.records()
    const detail = model.record ? viewerDetailParts(model, model.record, true, false) : []
    const spans = callObservationSpans(
      [...model.calls.values()].map((call) => ({
        id: call.key,
        firstObservedAt: call.firstObservedAt,
        observedAt: call.time,
      })),
    )
    const signature = JSON.stringify([
      model.surface,
      records,
      destinations,
      detail,
      viewerReferences(model.record).map(
        (ref) => model.resolve(model.record?.publisher ?? model.rootSourceId, ref).label,
      ),
      model.record?.key,
      panel,
      model.preview,
      model.previewState,
      model.previewTitle,
      model.feedback,
      width,
      height,
    ])
    if (signature !== this.#signature) {
      this.#signature = signature
      this.#detailScrollTarget =
        panel?.kind === 'preview' && panel.matchOffset !== undefined
          ? [
              ...wrapTerminalText(
                model.preview?.text.slice(0, panel.matchOffset) ?? '',
                Math.max(1, Number(this.#detail.width) - 4),
              ),
            ].length
          : panel?.kind === 'detail' || panel?.kind === 'preview'
            ? panel.scroll
            : 0
      for (const parent of [this.#navigation, this.#list, this.#detail])
        for (const child of parent.getChildren()) child.destroyRecursively()
      if (rail) {
        let group = '',
          source = ''
        for (const [index, entry] of destinations.entries()) {
          if (entry.group !== group) {
            group = entry.group
            this.#text(
              this.#navigation,
              group === 'application' ? '\nAPPLICATION' : group === 'recorded' ? 'RECORDED' : 'RUN',
              'muted',
              true,
            )
          }
          if (entry.group === 'application' && entry.source !== source) {
            source = entry.source
            this.#line(this.#navigation, truncateTerminalText(one(source), 16))
          }
          const selected = entry.key === model.surface
          const row = new this.core.BoxRenderable(this.renderer, {
            id: `destination-${index}`,
            width: '100%',
            height: 1,
            flexShrink: 0,
            backgroundColor: selected ? p.select : p.panel,
          })
          this.#navigation.add(row)
          this.#line(
            row,
            this.core.t`${this.core.fg(selected ? p.accent : p.muted)(
              truncateTerminalText(`${selected ? '›' : ' '} ${entry.icon} ${one(entry.title)}`, 18),
            )}`,
          )
          if (selected) this.#revealNavigation = `destination-${index}`
        }
      }
      if (panel) {
        // The bounded literal projection also serves compact accessible text and
        // all navigation overlays. OpenTUI owns the pane geometry and scrolling.
        if (panel.kind === 'preview') {
          this.#capturedContent(this.#detail)
          if (model.record && !model.record.file)
            this.#parts(
              this.#detail,
              viewerDetailParts(model, model.record, true, false),
              model.record.publisher ?? this.model.rootSourceId,
            )
        } else if (panel.kind === 'detail' && model.record) {
          this.#parts(
            this.#detail,
            viewerDetailParts(model, model.record),
            model.record.publisher ?? this.model.rootSourceId,
          )
        } else if (panel.kind === 'views') {
          let group = ''
          for (const [index, entry] of destinations.entries()) {
            if (entry.group !== group) {
              group = entry.group
              this.#text(
                this.#detail,
                group === 'application' ? 'APPLICATION' : group === 'recorded' ? 'RECORDED' : 'RUN',
                'muted',
                true,
              )
            }
            const selected = entry.key === panel.selected
            const row = new this.core.BoxRenderable(this.renderer, {
              id: `view-choice-${index}`,
              width: '100%',
              flexShrink: 0,
              backgroundColor: selected ? p.select : p.panel,
            })
            this.#detail.add(row)
            this.#text(
              row,
              `${selected ? '›' : ' '} ${entry.title}${entry.source ? ` · ${entry.source}` : ''}`,
              selected ? 'accent' : 'normal',
              selected,
            )
            if (selected) this.#revealDetail = `view-choice-${index}`
          }
        } else {
          const projection = viewerFrame(
            model,
            Math.max(18, available - 4),
            100,
            false,
            true,
            scroll,
            undefined,
            state,
          )
          const separator = projection.lines.findIndex((l) => /^─+$/.test(l))
          const start = separator < 0 ? Math.min(3, projection.lines.length - 1) : separator + 1
          this.#text(this.#detail, projection.lines.slice(start, -1).join('\n'))
        }
      } else {
        if (model.surface === 'overview')
          this.#text(
            this.#list,
            listWidth >= 94
              ? 'Observed calls · common-scale observation spans'
              : 'Observed calls · ← collapse · → expand',
            'muted',
          )
        if (!records.length)
          this.#text(
            this.#list,
            model.surface === 'overview'
              ? 'Waiting for actual observed invocations'
              : 'No retained entries',
            'muted',
          )
        let section = '',
          collection = '',
          activityGroup = ''
        let table: ReturnType<typeof viewerTableColumns> | undefined
        for (const [index, record] of records.entries()) {
          if (model.surface === 'activity') {
            const next =
              record.kind === 'activity' || record.kind === 'host'
                ? 'Current work'
                : 'Recent activity'
            if (next !== activityGroup) {
              activityGroup = next
              this.#text(this.#list, next, 'muted', true)
            }
          }
          if (record.section && record.section !== section) {
            section = record.section
            this.#text(this.#list, '\n' + section, 'muted', true)
          }
          if (record.collection && collection !== record.collection.id) {
            collection = record.collection.id
            const rows = model.visibleRows(record.collection)
            table = viewerTableColumns(
              model,
              record.publisher ?? this.model.rootSourceId,
              record.collection,
              rows,
              listWidth - 4,
              3,
            )
            const filter = model.local.filters.get(collection)
            const sort = model.local.sorts.get(collection)
            this.#text(
              this.#list,
              `${record.collection.title} · ${rows.length}${filter ? ` / ${record.collection.rows.length} · filtered` : ''}${record.collection.total === undefined || record.collection.total === record.collection.rows.length ? '' : ` / ${record.collection.total} reported`}${table.hidden ? ` · +${table.hidden} fields in detail` : ''}${sort ? ` · sort ${one(sort.key)}` : ''}`,
              'muted',
              true,
            )
            this.#line(
              this.#list,
              this.core.t`${this.core.bold(
                this.core.fg(p.label)(
                  '  ' +
                    table.columns
                      .map((column) => viewerAligned(column.label, column.size, column.numeric))
                      .join(' │ '),
                ),
              )}`,
            )
          }
          const selected = model.record?.key === record.key
          const row = new this.core.BoxRenderable(this.renderer, {
            id: `record-${index}`,
            width: '100%',
            height: 1,
            flexShrink: 0,
            flexDirection: 'column',
            backgroundColor: selected ? p.select : p.panel,
          })
          this.#list.add(row)
          this.#row(row, record, listWidth - 4, record.collection ? table : undefined, spans.spans)
          if (selected && this.#selection !== `${model.surface}:${record.key}`)
            this.#reveal = `record-${index}`
        }
        if (model.surface === 'overview' && model.omissions)
          this.#text(this.#list, `${model.omissions} call observations omitted`, 'warning')
        const omitted = Object.entries(model.journalOmitted)
          .filter(([, count]) => count)
          .map(([kind, count]) => `${count} ${kind}`)
          .join(', ')
        if (model.surface === 'activity' && omitted)
          this.#text(this.#list, `History incomplete: ${omitted}`, 'warning')
        if (model.surface === 'files' && model.workspace.recorded) {
          const captured = [...model.views.values()].find((view) => view.role === 'recorded-files')
          if (captured?.value.summary) this.#text(this.#list, captured.value.summary, 'muted')
        }
        this.#selection = `${model.surface}:${model.record?.key}`
        const refs = viewerReferences(model.record)
        if (
          model.previewState &&
          (model.record?.file || (refs.length === 1 && refs[0]?.kind === 'artifact'))
        ) {
          this.#capturedContent(this.#detail)
          if (!model.record?.file)
            this.#parts(this.#detail, detail, model.record?.publisher ?? model.rootSourceId)
        } else this.#parts(this.#detail, detail, model.record?.publisher ?? model.rootSourceId)
      }
    }
    const exit = `q ${settled ? 'close' : 'inline'} · Ctrl-C ${settled ? 'close' : 'stop'}`
    this.#footer.content =
      panel?.kind === 'filter' || panel?.kind === 'preview-search'
        ? `Enter apply · Esc cancel · Ctrl-D leave · Ctrl-C ${settled ? 'close' : 'stop'}`
        : panel
          ? `${exit} · Esc back · ${panel.kind === 'views' || panel.kind === 'references' ? '↑↓ choose · Enter open' : panel.kind === 'preview' ? '/ excerpt search · ↑↓ scroll' : '↑↓ scroll'}`
          : width < 90
            ? `${exit} · ! cause · v views · ↑↓ · Enter · ? help`
            : `${exit} · ! cause · Tab next · v views · ↑↓ select · Enter expand · r refs · ? help`
    // Overlay scrolling remains in the bounded input owner; list scrolling uses
    // native layout, with selected records revealed only after actual layout.
    if (!panel && this.#list.visible) this.#list.scrollTop = scroll
    await this.renderer.idle()
    if (this.#closed) return { text: '', references: [], scroll: 0 }
    return {
      text: this.#capture(color),
      references: viewerReferences(model.record),
      scroll:
        panel?.kind === 'preview' || panel?.kind === 'detail'
          ? Math.floor(this.#detail.scrollTop)
          : panel
            ? scroll
            : Math.floor(this.#list.scrollTop),
    }
  }
  /** A fenced frame was never written, so the next draw must emit its cells. */
  invalidateFrame(): void {
    this.#lastFrame = ''
  }
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#signature = ''
    this.#lastFrame = ''
    this.#selection = ''
    this.#reveal = undefined
    this.#revealNavigation = undefined
    this.#revealDetail = undefined
    this.#detailScrollTarget = undefined
    this.renderer.off('frame', this.#layout)
    this.#shell.destroyRecursively()
    this.#compact.destroyRecursively()
    this.renderer.destroy()
    this.#input.destroy()
    this.#output.destroy()
  }
}

/** Core supplies laid-out cells, not terminal authority. Encode only published
 * text/color spans, with a hard ceiling including every generated SGR byte. */
export function nativeCells(lines: readonly CapturedLine[], color: boolean): string {
  let text = `${color ? '\u001b[0m' : ''}\u001b[H\u001b[2J`,
    bytes = Buffer.byteLength(text),
    lastFg = '',
    lastBg = '',
    lastBold = false
  let clipped = false
  const append = (value: string) => {
    const size = Buffer.byteLength(value)
    if (bytes + size + 384 > 32768) {
      clipped = true
      return false
    }
    text += value
    bytes += size
    return true
  }
  // Draw the last three rows first so output-budget exhaustion cannot hide exit
  // controls. Absolute positioning preserves geometry independent of write order.
  const indices = [...lines.keys()]
  const order = [...indices.slice(-3), ...indices.slice(0, -3)]
  outer: for (const index of order) {
    if (!append(`\u001b[${index + 1};1H`)) break
    const line = lines[index]!
    for (const [si, span] of line.spans.entries()) {
      const fg = span.fg.toInts(),
        bg = span.bg.toInts()
      const blank = /^ +$/.test(span.text)
      if (color) {
        const codes: string[] = []
        const nextBg = bg.slice(0, 3).join(';'),
          nextFg = fg.slice(0, 3).join(';'),
          bold = Boolean(span.attributes & 1)
        if (nextBg !== lastBg) {
          codes.push(`48;2;${nextBg}`)
          lastBg = nextBg
        }
        // Foreground and weight cannot affect blank cells. Preserve them until
        // the next visible glyph instead of changing styles across empty gutters.
        if (!blank) {
          if (nextFg !== lastFg) {
            codes.push(`38;2;${nextFg}`)
            lastFg = nextFg
          }
          if (bold !== lastBold) {
            codes.push(bold ? '1' : '22')
            lastBold = bold
          }
        }
        if (codes.length && !append(`\u001b[${codes.join(';')}m`)) break outer
      }
      if (/^ +$/.test(span.text) && span.width === span.text.length && span.width > 8) {
        // ECH uses the current background without advancing; CUF advances only
        // between spans. Empty pane area costs controls, not one byte per cell.
        if (
          !append(
            `\u001b[${span.width}X${si < line.spans.length - 1 ? `\u001b[${span.width}C` : ''}`,
          )
        )
          break outer
      } else {
        const content = truncateTerminalText(span.text, 4096, 32768 - bytes - 384)
        if (!append(content)) break outer
        if (Buffer.byteLength(content) < Buffer.byteLength(span.text)) {
          clipped = true
          break outer
        }
      }
    }
  }
  if (color) text += '\u001b[0m'
  if (clipped)
    text += `\u001b[${Math.max(1, lines.length)};1H\u001b[2K[Frame clipped · ! full cause · Enter detail · q leave]`
  return text
}
