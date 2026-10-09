import { StringDecoder } from 'node:string_decoder'
import type { Reference } from '@jigging/user-updates'
import { referenceKey } from '@jigging/display-model'
import { ViewerModel } from './viewer-model.js'
import {
  viewerDetailParts,
  viewerReferences,
  type ViewerPanel,
  type ViewerState,
} from './projection.js'
type ScrollAnchor = { key: string; offset: number }
/** Byte decoding and three bounded viewer-local overlays; owns no real stream. */
export class ViewerInput {
  #active = true
  #ended = false
  #pending = ''
  #escapeTimer: ReturnType<typeof setTimeout> | undefined
  #panels: ViewerPanel[] = []
  #references: readonly Reference[] = []
  #surface = ''
  #returns: {
    surface: string
    record?: string | undefined
    scroll: number
    anchor?: ScrollAnchor | undefined
  }[] = []
  readonly #decoder = new StringDecoder('utf8')
  constructor(
    readonly model: ViewerModel,
    public change: () => void,
    public action: (action: 'close' | 'interrupt') => void,
    public onInteraction: () => boolean = () => true,
  ) {
    this.#surface = model.surface
  }
  input(bytes: Uint8Array): void {
    if (!this.#active || this.model.closed) return
    if (bytes.includes(3)) {
      this.#read('\u0003')
      return
    }
    this.#pending = [
      ...(this.#pending +
        this.#decoder.write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))),
    ]
      .slice(0, 4096)
      .join('')
    this.#drainKeys()
  }
  get active(): boolean {
    return this.#active
  }
  get state(): ViewerState {
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
    const references = this.#panels.find((item) => item.kind === 'references')
    if (references?.kind === 'references') {
      this.#references =
        this.model.record?.key === references.origin ? viewerReferences(this.model.record) : []
      if (!this.#references.some((ref) => referenceKey(ref) === references.selected))
        references.selected = undefined
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
  leave(action: 'close' | 'interrupt' = 'close'): void {
    if (this.#ended || this.model.closed) return
    const notify = this.action
    this.dispose()
    notify(action)
  }
  dispose(): void {
    this.#ended = true
    this.#active = false
    clearTimeout(this.#escapeTimer)
    this.#escapeTimer = undefined
    this.#pending = ''
    this.model.dismissPreview()
    this.#panels = []
    this.#returns = []
    this.#references = []
    this.change = () => {}
    this.action = () => {}
    this.onInteraction = () => false
  }
  #push(panel: ViewerPanel): void {
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
            if (!this.#active || this.model.closed) return
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
      this.leave(this.model.workspace.phase === 'settled' ? 'close' : 'interrupt')
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
      } else if (this.#returns.length) {
        if (!this.onInteraction()) {
          this.leave()
          return
        }
        this.model.markNavigation()
        let skipped = 0
        let origin = this.#returns.pop()!
        while (!this.model.surfaceKeys().includes(origin.surface) && this.#returns.length) {
          skipped++
          origin = this.#returns.pop()!
        }
        if (this.model.surfaceKeys().includes(origin.surface)) {
          this.model.select(origin.surface)
          if (origin.record && this.model.records().some((record) => record.key === origin.record))
            this.model.selectRecord(origin.record)
          this.model.local.scroll = origin.scroll
          this.model.local.anchor = origin.anchor
          if (skipped)
            this.model.feedback =
              'Returned to the preceding available view; an intermediate view was retired.'
        } else
          this.model.feedback =
            'The return views were retired. Choose another view with v, or q to leave.'
        this.change()
      } else this.leave()
      return
    }
    if (
      [
        '\t',
        'v',
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
      this.#returns = []
      this.model.cycleView(text === '\t' ? 1 : -1)
      this.#surface = this.model.surface
      this.change()
      return
    }
    if (text === 'v') {
      this.#push({ kind: 'views', selected: this.model.surface })
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
    if (panel?.kind === 'views') {
      const keys = this.model.surfaceKeys()
      const index = keys.indexOf(panel.selected)
      if (delta) panel.selected = keys[Math.max(0, Math.min(keys.length - 1, index + delta))]!
      if (text === '\u001b[H' || text === '\u001b[1~') panel.selected = keys[0]!
      if (text === '\u001b[F' || text === '\u001b[4~') panel.selected = keys.at(-1)!
      if (text === '\r' || text === '\n') {
        if (keys.includes(panel.selected)) {
          this.#panels = []
          this.#returns = []
          this.model.select(panel.selected)
        } else this.model.feedback = 'Selected view unavailable; choose another view'
      }
    } else if (panel?.kind === 'references') {
      const refs = this.#references
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
          const publisher = this.model.record?.publisher ?? this.model.rootSourceId
          const available = this.model.resolve(publisher, reference).available
          this.#panels.pop()
          if (reference.kind === 'artifact' && available) this.#push({ kind: 'preview', scroll: 0 })
          else if (available) {
            if (this.#returns.length === 16) this.#returns.shift()
            this.#returns.push({
              surface: this.model.surface,
              record: this.model.record?.key,
              scroll: this.model.local.scroll,
              anchor: this.model.local.anchor,
            })
            this.#panels = []
          }
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
        if (this.model.previewTitle !== record.file.path || !this.model.previewState)
          void this.model.activateFile(record.file.id)
      } else if (
        record &&
        !record.row &&
        viewerDetailParts(this.model, record, true).length === 0
      ) {
        this.model.feedback = 'No additional detail was supplied for this entry.'
      } else if (record) {
        if (!this.model.disclosure()) this.model.toggleDisclosure()
        this.#push({ kind: 'detail', key: record.key, signature: record.signature, scroll: 0 })
      }
    }
    this.change()
  }
  #chooseReference(): void {
    const refs = viewerReferences(this.model.record)
    this.#references = refs
    this.#push({
      kind: 'references',
      selected: refs[0] && referenceKey(refs[0]),
      origin: this.model.record?.key ?? '',
    })
  }
}
