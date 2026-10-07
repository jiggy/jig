import {
  type Collection,
  type Reference,
  type UserUpdate,
  VIEW_LIMITS,
  type ViewItem,
} from '@jigging/user-updates'

export type PrivateCallState =
  | 'requested'
  | 'active'
  | 'cancel-requested'
  | 'returned'
  | 'failed'
  | 'uncertain'
export type PrivateCallEvent = Readonly<{
  publisher: string
  operationId: string
  slot: string
  intent?: string
  state: PrivateCallState
  time: number
  cause?: string
  childPublisher?: string
}>
export type PrivateCallNode = PrivateCallEvent & { key: string; parent?: string; clipped?: true }
export type PrivateView = {
  key: string
  publisher: string
  value: ViewItem
  bytes: number
  updated: number
  ended?: string
}
type Source = {
  claims: Set<string>
  retired: Set<string>
  views: Map<string, PrivateView>
  bytes: number
  landing?: string
  ended?: string
}
export type PrivateAttention = {
  source: string
  text: string
  priority: number
  committed: boolean
}
export type PrivatePreview = { text: string; bytes: number; clipped: boolean }
const key = (publisher: string, id: string) => JSON.stringify([publisher, id])
function bound(value: string, maximum: number): string {
  const scalars = [...value]
  return scalars.length <= maximum
    ? value
    : scalars.slice(0, Math.max(0, maximum - 10)).join('') + ' [clipped]'
}

/** One bounded renderer-neutral projection. No execution or file authority lives here. */
export class PrivateRunModel {
  readonly calls = new Map<string, PrivateCallNode>()
  readonly views = new Map<string, PrivateView>()
  readonly activities = new Map<
    string,
    { publisher: string; value: Extract<UserUpdate, { kind: 'activity' }> }
  >()
  readonly attention: PrivateAttention[] = []
  #sources = new Map<string, Source>()
  #parents = new Map<string, string>()
  #claims = 0
  #bytes = 0
  #callBytes = 0
  #attentionBytes = 0
  #stopped = false
  #selected: string | undefined
  #chosen = false
  #collection: string | undefined
  #row: string | undefined
  #filter = ''
  #sort: string | undefined
  #descending = false
  #artifact:
    | ((publisher: string, ref: Extract<Reference, { kind: 'artifact' }>) => string | undefined)
    | undefined
  #preview: ((path: string) => Promise<PrivatePreview | undefined>) | undefined
  #previewBusy = false
  #closed = false
  #generation = 0
  omissions = 0
  incomplete: string | undefined
  context = 'Running; application reports are provisional'
  feedback = ''
  preview: PrivatePreview | undefined
  previewTitle: string | undefined
  focusedCall: string | undefined
  selectionVersion = 0
  onChange: () => void = () => {}

  get stopped(): boolean {
    return this.#stopped
  }
  get selected(): PrivateView | undefined {
    return this.#selected === undefined ? undefined : this.views.get(this.#selected)
  }
  get collection(): Collection | undefined {
    return this.collections().find((c) => c.id === this.#collection) ?? this.collections()[0]
  }
  get row(): Collection['rows'][number] | undefined {
    return this.visibleRows().find((r) => r.id === this.#row)
  }
  get filter(): string {
    return this.#filter
  }
  get sticky(): PrivateAttention | undefined {
    return this.attention.reduce<PrivateAttention | undefined>(
      (best, a) => (!best || a.priority > best.priority ? a : best),
      undefined,
    )
  }
  sourceLabel(publisher: string): string {
    if (publisher === 'root') return 'Flow'
    const parent = this.#parents.get(publisher)
    return parent === undefined
      ? 'Flow (separate invocation)'
      : `Flow / ${this.calls.get(parent)?.slot ?? 'separate invocation'}`
  }
  observeCall(event: PrivateCallEvent): void {
    if (this.#stopped) return
    const identity = key(event.publisher, event.operationId)
    const old = this.calls.get(identity)
    if (old && ['returned', 'failed', 'uncertain'].includes(old.state)) return
    const parent = this.#parents.get(event.publisher)
    let depth = 0,
      ancestor = parent
    while (ancestor && depth <= 32) {
      ancestor = this.calls.get(ancestor)?.parent
      depth++
    }
    const intent = event.intent === undefined ? undefined : bound(event.intent, 1024)
    const cause = event.cause === undefined ? undefined : bound(event.cause, 4096)
    if (cause && (event.state === 'failed' || event.state === 'uncertain'))
      this.addAttention(this.sourceLabel(event.publisher), cause, 4, false)
    const node: PrivateCallNode = {
      key: identity,
      publisher: event.publisher,
      operationId: event.operationId,
      slot: bound(event.slot, 128),
      state: event.state,
      time: event.time,
      ...(parent === undefined ? {} : { parent }),
      ...(intent === undefined ? {} : { intent }),
      ...(cause === undefined ? {} : { cause }),
    }
    const bytes = Buffer.byteLength(JSON.stringify(node)),
      prior = old ? Buffer.byteLength(JSON.stringify(old)) : 0
    if (
      (!old && this.calls.size >= 256) ||
      depth > 32 ||
      this.#callBytes - prior + bytes > 262144
    ) {
      this.omissions = Math.min(Number.MAX_SAFE_INTEGER, this.omissions + 1)
      this.incomplete = 'Call tree incomplete: observation capacity reached'
      this.onChange()
      return
    }
    this.#callBytes += bytes - prior
    this.calls.set(identity, node)
    if (event.childPublisher !== undefined && this.#parents.size < 256)
      this.#parents.set(event.childPublisher, identity)
    this.onChange()
  }
  #source(publisher: string): Source {
    let source = this.#sources.get(publisher)
    if (!source) {
      if (this.#sources.size >= 64) throw new Error('Publisher capacity reached')
      source = { claims: new Set(), retired: new Set(), views: new Map(), bytes: 0 }
      this.#sources.set(publisher, source)
    }
    return source
  }
  acceptView(
    publisher: string,
    value: Extract<UserUpdate, { kind: 'view' | 'retire-view' }>,
  ): void {
    if (this.#stopped) throw new Error('Observation ended')
    const source = this.#source(publisher)
    if (source.ended) throw new Error('Publisher observation ended')
    const claimed = source.claims.has(value.id)
    if (
      !claimed &&
      (source.claims.size >= VIEW_LIMITS.claimsPerSource ||
        this.#claims >= VIEW_LIMITS.claimsPerCommand)
    )
      throw new Error('View claim limit reached')
    if (value.kind === 'retire-view') {
      if (!claimed) {
        source.claims.add(value.id)
        this.#claims++
      }
      source.retired.add(value.id)
      const old = source.views.get(value.id)
      if (old) {
        source.bytes -= old.bytes
        this.#bytes -= old.bytes
        source.views.delete(value.id)
        this.views.delete(old.key)
        if (this.#selected === old.key) this.select(undefined)
      }
      this.onChange()
      return
    }
    if (source.retired.has(value.id)) throw new Error('Retired view ID reused')
    const old = source.views.get(value.id)
    if (old && (old.value.operationId !== value.operationId || old.value.landing !== value.landing))
      throw new Error('View association changed')
    if (value.landing && source.landing !== undefined && source.landing !== value.id)
      throw new Error('Multiple landing hints in one publisher')
    const bytes = Buffer.byteLength(JSON.stringify(value)),
      prior = old?.bytes ?? 0
    if (
      (!old && (source.views.size >= 8 || this.views.size >= 32)) ||
      source.bytes - prior + bytes > 131072 ||
      this.#bytes - prior + bytes > 524288
    )
      throw new Error('Retained view capacity reached')
    // All identity and capacity checks precede mutation of the last complete snapshot.
    const previousRows = this.visibleRows().map((r) => r.id)
    if (!claimed) {
      source.claims.add(value.id)
      this.#claims++
    }
    if (value.landing) source.landing = value.id
    const view: PrivateView = {
      key: key(publisher, value.id),
      publisher,
      value,
      bytes,
      updated: Date.now(),
    }
    source.bytes += bytes - prior
    this.#bytes += bytes - prior
    source.views.set(value.id, view)
    this.views.set(view.key, view)
    if (publisher === 'root' && value.landing && !this.#chosen && this.#selected === undefined) {
      this.#selected = view.key
      this.#repairSelection([])
    } else if (this.#selected === view.key) this.#repairSelection(previousRows)
    this.onChange()
  }
  freeze(publisher: string, reason = 'Observation ended'): void {
    for (const [identity, activity] of this.activities)
      if (activity.publisher === publisher) this.activities.delete(identity)
    const source = this.#sources.get(publisher)
    if (!source || source.ended) return
    source.ended = reason
    for (const view of source.views.values()) view.ended = reason
    this.onChange()
  }
  stop(reason = 'Observation ended'): void {
    if (this.#stopped) return
    for (const publisher of this.#sources.keys()) this.freeze(publisher, reason)
    this.activities.clear()
    this.#stopped = true
    this.onChange()
  }
  activity(publisher: string, value: Extract<UserUpdate, { kind: 'activity' | 'clear' }>): void {
    if (this.#stopped) return
    if (value.kind === 'clear') this.activities.delete(key(publisher, value.id))
    else this.activities.set(key(publisher, value.id), { publisher, value })
    this.onChange()
  }
  addAttention(source: string, text: string, priority: number, committed = true): boolean {
    const bytes = Buffer.byteLength(text)
    const limit = priority <= 2 ? 127 : 128,
      byteLimit = priority <= 2 ? 491520 : 524288
    if (this.attention.length >= limit || this.#attentionBytes + bytes > byteLimit) {
      this.incomplete = 'Additional Flow reports unavailable'
      if (priority <= 2) {
        this.onChange()
        return false
      }
      const removals: number[] = []
      let count = this.attention.length,
        retained = this.#attentionBytes
      for (
        let i = this.attention.length - 1;
        i >= 0 && (count >= limit || retained + bytes > byteLimit);
        i--
      ) {
        if (this.attention[i]!.priority >= priority) continue
        removals.push(i)
        count--
        retained -= Buffer.byteLength(this.attention[i]!.text)
      }
      if (count >= limit || retained + bytes > byteLimit) {
        this.onChange()
        return false
      }
      for (const i of removals) this.attention.splice(i, 1)
      this.#attentionBytes = retained
    }
    this.attention.push({ source, text, priority, committed })
    this.#attentionBytes += bytes
    this.onChange()
    return true
  }
  select(identity: string | undefined): void {
    this.#generation++
    this.selectionVersion++
    this.#chosen = true
    this.#selected = identity
    this.#collection = undefined
    this.#row = undefined
    this.#filter = ''
    this.#sort = undefined
    this.preview = undefined
    this.feedback = ''
    this.focusedCall = undefined
    this.#repairSelection([])
    this.onChange()
  }
  cycleView(delta: number): void {
    const keys = [undefined, ...this.views.keys()],
      index = keys.indexOf(this.#selected)
    this.select(keys[(index + delta + keys.length) % keys.length])
  }
  collections(): Collection[] {
    return (
      this.selected?.value.sections.flatMap((s) =>
        s.blocks.filter((b): b is Collection => b.kind === 'collection'),
      ) ?? []
    )
  }
  visibleRows(): Collection['rows'] {
    const c = this.collection
    if (!c) return []
    const rows = c.rows.filter(
      (r) =>
        !this.#filter ||
        Object.values(r.cells).some((v) =>
          JSON.stringify(v)?.toLocaleLowerCase().includes(this.#filter.toLocaleLowerCase()),
        ),
    )
    if (this.#sort) {
      const field = this.#sort
      rows.sort((a, b) => {
        const av = a.cells[field],
          bv = b.cells[field]
        const comparison =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av ?? '').localeCompare(String(bv ?? ''))
        return (
          (this.#descending ? -comparison : comparison) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        )
      })
    }
    return rows
  }
  #repairSelection(previous: string[]): void {
    if (!this.collections().some((c) => c.id === this.#collection))
      this.#collection = this.collections()[0]?.id
    const rows = this.visibleRows()
    if (rows.some((r) => r.id === this.#row)) return
    const index = previous.indexOf(this.#row ?? '')
    const prior = previous
      .slice(0, Math.max(0, index))
      .reverse()
      .find((id) => rows.some((r) => r.id === id))
    this.#generation++
    this.#row = prior ?? rows[0]?.id
    this.preview = undefined
    this.feedback = ''
  }
  moveRow(delta: number): void {
    this.#generation++
    const rows = this.visibleRows(),
      index = rows.findIndex((r) => r.id === this.#row)
    this.#row = rows[Math.max(0, Math.min(rows.length - 1, index + delta))]?.id
    this.preview = undefined
    this.feedback = ''
    this.onChange()
  }
  cycleCollection(): void {
    this.#generation++
    this.feedback = ''
    const cs = this.collections()
    this.#collection = cs[(cs.findIndex((c) => c.id === this.#collection) + 1) % cs.length]?.id
    this.#row = undefined
    this.#repairSelection([])
    this.onChange()
  }
  filterRows(value: string): void {
    this.#generation++
    this.preview = undefined
    this.feedback = ''
    const old = this.visibleRows().map((r) => r.id)
    this.#filter = bound(value, 128)
    this.#repairSelection(old)
    this.onChange()
  }
  sortRows(): void {
    this.#generation++
    this.preview = undefined
    this.feedback = ''
    const cs = this.collection?.columns ?? []
    const index = cs.findIndex((c) => c.key === this.#sort)
    if (index === cs.length - 1) {
      this.#sort = undefined
      this.#descending = !this.#descending
    } else this.#sort = cs[index + 1]?.key
    this.#repairSelection([])
    this.onChange()
  }
  setArtifacts(
    resolve: (
      publisher: string,
      ref: Extract<Reference, { kind: 'artifact' }>,
    ) => string | undefined,
    preview: (path: string) => Promise<PrivatePreview | undefined>,
  ): void {
    this.#artifact = resolve
    this.#preview = preview
    this.onChange()
  }
  resolve(
    publisher: string,
    ref: Reference,
  ): { available: boolean; label: string; target?: string } {
    if (ref.kind === 'call') {
      const node = this.calls.get(key(publisher, ref.operationId))
      return node
        ? { available: true, label: `${node.slot}: ${node.state}`, target: node.key }
        : { available: false, label: 'Call unavailable' }
    }
    if (ref.kind === 'record') {
      const view = this.views.get(key(publisher, ref.viewId))
      const c = view?.value.sections
        .flatMap((s) => s.blocks)
        .find((b): b is Collection => b.kind === 'collection' && b.id === ref.collectionId)
      return c?.rows.some((r) => r.id === ref.rowId)
        ? { available: true, label: `${view!.value.title} / ${ref.rowId}`, target: view!.key }
        : { available: false, label: 'Record unavailable' }
    }
    const path = this.#artifact?.(publisher, ref)
    return path
      ? { available: true, label: `Delivered file: ${ref.path}`, target: path }
      : { available: false, label: 'Artifact unavailable; not present in verified delivered files' }
  }
  async activate(publisher: string, ref: Reference): Promise<void> {
    if (this.#closed) return
    const resolved = this.resolve(publisher, ref)
    if (ref.kind === 'artifact' && this.#previewBusy) {
      this.feedback = 'A preview is loading; wait before opening another artifact'
      this.onChange()
      return
    }
    this.feedback = resolved.label
    if (!resolved.available) {
      this.onChange()
      return
    }
    if (ref.kind === 'record') {
      this.select(resolved.target)
      this.#collection = ref.collectionId
      this.#row = ref.rowId
      this.feedback = resolved.label
    } else if (ref.kind === 'call') {
      this.select(undefined)
      this.focusedCall = resolved.target
      this.feedback = resolved.label
    } else if (!this.#previewBusy) {
      this.#previewBusy = true
      this.preview = undefined
      this.previewTitle = `${ref.attachment}:${ref.path}`
      this.feedback = `${resolved.label} — loading preview`
      const generation = this.#generation
      try {
        const preview = await this.#preview?.(resolved.target!)
        if (!this.#closed && generation === this.#generation) {
          this.preview = preview
          this.feedback = resolved.label
          if (!preview)
            this.feedback = 'Immutable preview unavailable; inspect the delivered location'
        }
      } catch {
        if (!this.#closed && generation === this.#generation)
          this.feedback = 'Immutable preview unavailable; inspect the delivered location'
      } finally {
        this.#previewBusy = false
      }
    }
    this.onChange()
  }
  close(): void {
    this.#closed = true
    this.#generation++
    this.stop()
    this.preview = undefined
    this.#artifact = undefined
    this.#preview = undefined
    this.onChange = () => {}
  }
}
