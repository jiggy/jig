import { PassThrough, Writable } from 'node:stream'
import type { Reference } from '@jigging/user-updates'
import type { BoxRenderable, CapturedLine, CliRenderer, ScrollBoxRenderable } from '@opentui/core'
import {
  type PrivateDashboardState,
  privateDashboardDetailLines,
  privateDashboardFrame,
  privateDashboardReferences,
} from './cli-dashboard.js'
import {
  type PrivateRunModel,
  type PrivateWorkspaceRecord,
  privateAttentionImportance,
} from './cli-run-model.js'
import { CliDiagnostic } from './cli-usage.js'
import {
  privateTerminalWidth,
  privateTruncateUpdate,
  privateUpdateText,
} from './private-terminal-text.js'

type Core = typeof import('@opentui/core')
const palettes = {
  dark: {
    bg: '#15171c',
    panel: '#1b1e25',
    fg: '#e3e7ef',
    muted: '#939dad',
    edge: '#343d4b',
    accent: '#9bb8ff',
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
    select: '#dbe7ff',
    warning: '#8a520c',
    error: '#a82b29',
    success: '#32652d',
  },
}
const safe = (text: string) => privateUpdateText(text)
const one = (text: string) => safe(text).replaceAll('\n', ' · ')

/** Required only by an eligible explicit dashboard; import and native allocation
 * happen before execution. Neither this check nor the renderer owns real IO. */
export async function privatePrepareOpenTui(): Promise<Core> {
  try {
    const core = await import('@opentui/core')
    const buffer = core.OptimizedBuffer.create(1, 1, 'unicode')
    buffer.destroy()
    return core
  } catch {
    throw new CliDiagnostic(
      'JIG_DASHBOARD_UNAVAILABLE',
      'The dashboard renderer is missing or cannot load its native support. Restore the complete Jig installation, or run with --display plain. No Flow was started.',
      1,
    )
  }
}

/** Native layout and cell rendering, with Jig retaining the single bounded
 * writer, raw input, signal, execution and restoration owners. The inert streams
 * prevent Core terminal queries or native output from reaching the user. */
export class PrivateOpenTuiDashboard {
  readonly renderer: CliRenderer
  readonly #input: PassThrough
  readonly #output: Writable
  readonly #shell: BoxRenderable
  readonly #list: ScrollBoxRenderable
  readonly #detail: ScrollBoxRenderable
  readonly #header: InstanceType<Core['TextRenderable']>
  readonly #status: InstanceType<Core['TextRenderable']>
  readonly #tabs: InstanceType<Core['TextRenderable']>
  readonly #attention: InstanceType<Core['TextRenderable']>
  readonly #footer: InstanceType<Core['TextRenderable']>
  readonly #body: BoxRenderable
  readonly #compact: InstanceType<Core['TextRenderable']>
  #signature = ''
  #lastFrame = ''
  #selection = ''
  #reveal: string | undefined
  #closed = false
  readonly #layout = () => {
    if (this.#reveal && !this.#closed) {
      const reveal = this.#reveal
      this.#reveal = undefined
      this.#list.scrollChildIntoView(reveal)
    }
  }
  private constructor(
    readonly core: Core,
    renderer: CliRenderer,
    input: PassThrough,
    output: Writable,
    readonly model: PrivateRunModel,
  ) {
    this.renderer = renderer
    this.#input = input
    this.#output = output
    const p = process.env.JIG_THEME === 'one-light' ? palettes.light : palettes.dark
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
    this.#status = new core.TextRenderable(renderer, { height: 2, fg: p.muted, truncate: true })
    this.#tabs = new core.TextRenderable(renderer, {
      height: 2,
      paddingTop: 1,
      fg: p.accent,
      attributes: core.TextAttributes.BOLD,
      truncate: true,
    })
    this.#attention = new core.TextRenderable(renderer, { height: 1, fg: p.muted, truncate: true })
    for (const item of [this.#header, this.#status, this.#tabs, this.#attention])
      this.#shell.add(item)
    this.#body = new core.BoxRenderable(renderer, {
      width: '100%',
      flexGrow: 1,
      minHeight: 1,
      flexDirection: 'row',
      gap: 2,
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
      paddingY: 1,
    }
    this.#list = new core.ScrollBoxRenderable(renderer, { ...options, width: '44%' })
    this.#detail = new core.ScrollBoxRenderable(renderer, { ...options, width: '54%' })
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
    model: PrivateRunModel,
    width: number,
    height: number,
  ): Promise<PrivateOpenTuiDashboard> {
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
      return new PrivateOpenTuiDashboard(core, renderer, input, output, model)
    } catch (error) {
      renderer?.destroy()
      input.destroy()
      output.destroy()
      throw error
    }
  }
  #text(
    parent: BoxRenderable,
    content: string,
    role: 'normal' | 'muted' | 'accent' | 'warning' | 'error' = 'normal',
    strong = false,
  ) {
    const p = process.env.JIG_THEME === 'one-light' ? palettes.light : palettes.dark
    const node = new this.core.TextRenderable(this.renderer, {
      content: safe(content),
      fg: role === 'normal' ? p.fg : role === 'muted' ? p.muted : p[role],
      attributes: strong ? this.core.TextAttributes.BOLD : 0,
      wrapMode: 'word',
      width: '100%',
      flexShrink: 0,
    })
    parent.add(node)
  }
  #record(record: PrivateWorkspaceRecord): string {
    if (record.row && record.collection) {
      const values = record.collection.columns.map((c) => {
        const v = record.row!.cells[c.key] ?? null
        return `${c.label}: ${v !== null && typeof v === 'object' ? this.model.resolve(record.publisher ?? 'root', v).label : String(v)}`
      })
      return values.join('\n')
    }
    if (record.call)
      return `${'  '.repeat(Math.min(record.depth ?? 0, 12))}${this.model.descendants(record.call.key).length ? (this.model.treeExpanded(record.call.key) ? '▾' : '▸') : '·'} ${record.call.intent ?? record.call.slot}\n${record.call.state}${record.hidden ? ` · ${record.hidden} calls collapsed${record.issues ? ` · ${record.issues} issues` : ''}` : ''}`
    if (record.activity)
      return `${record.activity.label}${record.activity.detail ? `\n${record.activity.detail}` : ''}`
    if (record.journal)
      return `${record.journal.source}${record.journal.kind === 'diagnostic' ? ' · importance unspecified' : record.journal.importance !== 'info' ? ` · reported ${record.journal.importance}` : ''}\n${record.journal.text.split('\n')[0]}`
    if (record.block?.kind === 'progress') {
      const b = record.block
      const size = 16,
        filled = b.total ? Math.min(size, Math.floor((b.completed / b.total) * size)) : 0
      return `${b.label}\n${b.total ? `${'━'.repeat(filled)}${'─'.repeat(size - filled)}  ` : ''}${b.completed}${b.total === undefined ? '' : ` / ${b.total}`}${b.unit ? ` ${b.unit}` : ''}`
    }
    if (record.block?.kind === 'facts')
      return record.block.items
        .map(
          (f) =>
            `${f.label}: ${typeof f.value === 'object' && f.value !== null ? this.model.resolve(record.publisher ?? 'root', f.value).label : String(f.value)}`,
        )
        .join('\n')
    return record.block?.kind === 'report' ? record.block.text.split('\n')[0]! : (record.text ?? '')
  }
  #capture(color: boolean): string {
    const text = privateOpenTuiCells(this.renderer.currentRenderBuffer.getSpanLines(), color)
    if (text === this.#lastFrame) return ''
    this.#lastFrame = text
    return text
  }
  async frame(
    width: number,
    height: number,
    state: PrivateDashboardState,
    scroll: number,
    color: boolean,
  ): Promise<{ text: string; references: readonly Reference[]; scroll: number }> {
    if (this.#closed) return { text: '', references: [], scroll: 0 }
    const model = this.model,
      panel = state.panels.at(-1),
      p = process.env.JIG_THEME === 'one-light' ? palettes.light : palettes.dark
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
      const frame = privateDashboardFrame(
        model,
        width,
        height,
        false,
        true,
        scroll,
        undefined,
        state,
      )
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
    const elapsed = Math.max(
      0,
      Math.floor(
        ((model.workspace.settledAt ?? model.workspace.now ?? model.workspace.startedAt) -
          model.workspace.startedAt) /
          1000,
      ),
    )
    const phase = settled
      ? model.workspace.recorded
        ? 'Saved result · read-only'
        : `Settled · ${elapsed}s · read-only`
      : one(model.workspace.hostStage)
    const target = privateTruncateUpdate(
      one(model.workspace.target),
      Math.max(1, width - 4 - privateTerminalWidth(`Jig  ·    ·  ${phase}`)),
    )
    this.#header.content = `Jig  ·  ${target}  ·  ${phase}`
    this.#status.content = facts
      ? this.core
          .t`${model.workspace.recorded ? 'Recorded ' : ''}${this.core.fg(model.workspace.recorded ? p.muted : facts.execution === 'succeeded' ? p.success : facts.execution === 'failed' ? p.error : p.warning)(`Execution ${one(facts.execution)}`)}  ·  Application ${one(facts.application)}\n${this.core.fg(model.workspace.recorded ? p.muted : facts.cleanup === 'complete' ? p.success : p.error)(`Cleanup ${one(facts.cleanup)}`)}  ·  ${this.core.fg(model.workspace.recorded ? p.muted : facts.delivery === 'written' ? p.success : facts.delivery === 'failed' ? p.error : p.muted)(`Delivery ${one(facts.delivery)}`)}`
      : `elapsed ${elapsed}s  ·  execution limit ${model.workspace.limitMs === undefined ? 'unspecified' : `${Math.floor(model.workspace.limitMs / 1000)}s`}\nFlow reports are provisional`
    const views = [
      ...(model.workspace.recorded
        ? []
        : [
            { key: 'activity', title: 'Activity' },
            { key: 'overview', title: 'Overview' },
          ]),
      ...[...model.views.values()].map((v) => ({
        key: v.key,
        title: `${model.workspace.recorded ? '' : `${model.sourceLabel(v.publisher)}: `}${v.value.title}`,
      })),
    ]
    const allTabs = views
      .map((v) => (v.key === model.surface ? `[${one(v.title)}]` : one(v.title)))
      .join('   ')
    const selectedTab = views.findIndex((v) => v.key === model.surface)
    this.#tabs.content =
      privateTerminalWidth(allTabs) <= width - 4
        ? allTabs
        : `${selectedTab + 1}/${views.length} [${one(views[selectedTab]?.title ?? 'Activity')}] · Tab views`
    const sticky = model.sticky
    const omissions = Object.entries(model.journalOmitted)
      .filter(([, n]) => n)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ')
    const observation = model.workspace.recorded
      ? 'Recorded local claims · no live observation'
      : model.selected
        ? `${model.selected.ended ? one(model.selected.ended) : 'Live observations'} · last update ${new Date(model.selected.updated).toISOString()}`
        : (facts?.completeness ?? 'Read-only observations')
    this.#attention.content = sticky
      ? `! ${one(sticky.source)} · ${privateAttentionImportance(sticky.priority)} · ${one(sticky.text)} · ! full cause`
      : (model.incomplete ??
        (omissions
          ? `History incomplete: ${omissions} omitted · d diagnostics`
          : model.journal.some((e) => e.kind === 'diagnostic')
            ? `d diagnostics · importance was not supplied · ${observation}`
            : observation))
    this.#attention.fg = sticky
      ? sticky.priority === 2 || sticky.priority >= 4
        ? p.error
        : p.warning
      : p.muted
    const wide = width >= 110 && height >= 20
    this.#list.visible = !panel
    this.#list.width = wide ? Math.floor((width - 6) * 0.43) : width - (width < 50 ? 0 : 4)
    this.#detail.visible = Boolean(panel || wide)
    this.#detail.width =
      panel || !wide
        ? width - (width < 50 ? 0 : 4)
        : Math.max(1, width - 6 - Math.floor((width - 6) * 0.43))
    this.#list.title = ` ${one(model.selected?.value.title ?? (model.surface === 'overview' ? 'Execution graph' : 'Activity'))} `
    this.#detail.title = ` ${panel ? (panel.kind === 'preview' ? 'Immutable captured preview' : panel.kind) : 'Selected detail'} `
    const records = model.records(),
      labels = records.map((record) => this.#record(record)),
      detail = model.record
        ? [
            ...privateDashboardDetailLines(
              model,
              model.record,
              Math.max(1, width - Number(this.#list.width) - 12),
              true,
            ),
          ].join('\n')
        : model.context
    const signature = JSON.stringify([
      model.surface,
      records,
      labels,
      detail,
      model.record?.key,
      panel,
      model.preview,
      model.feedback,
      width,
      height,
    ])
    if (signature !== this.#signature) {
      this.#signature = signature
      for (const parent of [this.#list, this.#detail])
        for (const child of parent.getChildren()) child.destroyRecursively()
      if (panel) {
        // The bounded literal projection also serves compact accessible text and
        // all navigation overlays. OpenTUI owns the pane geometry and scrolling.
        const projection = privateDashboardFrame(
          model,
          Math.max(18, width - 8),
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
      } else {
        let section = '',
          collection = ''
        for (const [index, record] of records.entries()) {
          if (record.section && record.section !== section) {
            section = record.section
            this.#text(this.#list, section, 'muted', true)
          }
          if (record.collection && collection !== record.collection.id) {
            collection = record.collection.id
            this.#text(
              this.#list,
              `${record.collection.title} · ${model.visibleRows(record.collection).length} supplied${record.collection.total === undefined ? '' : ` / ${record.collection.total} reported`}`,
              'muted',
              true,
            )
          }
          const selected = model.record?.key === record.key
          const card = new this.core.BoxRenderable(this.renderer, {
            id: `record-${index}`,
            width: '100%',
            paddingX: 1,
            paddingY: record.row ? 1 : 0,
            marginBottom: 1,
            flexShrink: 0,
            flexDirection: 'column',
            border: ['left'],
            borderColor: selected ? p.accent : p.edge,
            backgroundColor: selected ? p.select : p.panel,
          })
          this.#list.add(card)
          this.#text(
            card,
            labels[index]!,
            record.call?.state === 'failed' || record.journal?.importance === 'error'
              ? 'error'
              : record.call?.state === 'uncertain' || record.journal?.importance === 'warning'
                ? 'warning'
                : selected
                  ? 'accent'
                  : 'normal',
            selected,
          )
          if (selected && this.#selection !== `${model.surface}:${record.key}`)
            this.#reveal = `record-${index}`
        }
        this.#selection = `${model.surface}:${model.record?.key}`
        this.#text(this.#detail, detail)
        if (model.feedback) this.#text(this.#detail, model.feedback, 'muted')
      }
    }
    const exit = `q ${settled ? 'close' : 'inline'} · Ctrl-C ${settled ? 'close' : 'stop'}`
    this.#footer.content =
      panel?.kind === 'filter'
        ? `Enter apply · Esc cancel · Ctrl-D leave · Ctrl-C ${settled ? 'close' : 'stop'}`
        : panel
          ? `${exit} · Esc back · ${panel.kind === 'references' ? 'Enter open · ' : ''}↑↓ scroll`
          : width < 90
            ? `${exit} · ! cause · Tab · ↑↓ · Enter · r refs · d diag · ? help`
            : `${exit} · ! cause · Tab views · ↑↓ select · Enter detail · r references · d diagnostics · ? help`
    // Overlay scrolling remains in the bounded input owner; list scrolling uses
    // native layout, with selected records revealed only after actual layout.
    if (!panel && this.#list.visible) this.#list.scrollTop = scroll
    await this.renderer.idle()
    if (this.#closed) return { text: '', references: [], scroll: 0 }
    return {
      text: this.#capture(color),
      references: privateDashboardReferences(model.record),
      scroll: panel ? scroll : Math.floor(this.#list.scrollTop),
    }
  }
  close(): void {
    if (this.#closed) return
    this.#closed = true
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
export function privateOpenTuiCells(lines: readonly CapturedLine[], color: boolean): string {
  let text = '\u001b[H\u001b[2J',
    bytes = Buffer.byteLength(text)
  let clipped = false
  for (const [index, line] of lines.entries()) {
    const prefix = `\u001b[${index + 1};1H`
    if (bytes + prefix.length + 384 > 32768) {
      clipped = true
      break
    }
    text += prefix
    bytes += prefix.length
    for (const span of line.spans) {
      const fg = span.fg.toInts(),
        bg = span.bg.toInts()
      const style = color
        ? `\u001b[0;${span.attributes & 1 ? '1;' : ''}38;2;${fg.slice(0, 3).join(';')};48;2;${bg.slice(0, 3).join(';')}m`
        : ''
      const remaining = 32768 - bytes - style.length - (color ? 4 : 0) - 384
      if (remaining <= 0) {
        clipped = true
        break
      }
      const content = privateTruncateUpdate(span.text, 4096, remaining)
      if (Buffer.byteLength(content) < Buffer.byteLength(span.text)) clipped = true
      text += style + content + (color ? '\u001b[0m' : '')
      bytes += style.length + Buffer.byteLength(content) + (color ? 4 : 0)
    }
  }
  if (clipped)
    text += `\u001b[${Math.max(1, lines.length)};1H\u001b[2K${color ? '\u001b[0m' : ''}[Frame clipped · ! full cause · Enter detail · q leave]`
  return text
}
