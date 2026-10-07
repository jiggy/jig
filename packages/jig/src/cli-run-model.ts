import {
  type Block,
  type Collection,
  type NoticeSeverity,
  type Reference,
  type UserUpdate,
  VIEW_LIMITS,
  type ViewItem,
} from '@jigging/user-updates'
import { privateCliHeading } from './cli-presentation.js'
import { privatePresentationNow } from './internal/root-run-timeout-policy.js'
import { privateUpdateText } from './private-terminal-text.js'

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
  readonly bytes: number
  readonly color: boolean
}
export type PrivatePreview = { text: string; bytes: number; clipped: boolean }
const key = (publisher: string, id: string) => JSON.stringify([publisher, id])
export const privateRowRecordKey = (collection: string, row?: string) =>
  JSON.stringify(['collection', collection, row ?? null])
function bound(value: string, maximum: number): string {
  const scalars = [...value]
  return scalars.length <= maximum
    ? value
    : scalars.slice(0, Math.max(0, maximum - 10)).join('') + ' [clipped]'
}

export type PrivateWorkspaceFacts = {
  readonly execution: string
  readonly application: string
  readonly cleanup: string
  readonly delivery: string
  readonly completeness?: string
}
export type PrivateWorkspace = {
  target: string
  limitMs?: number
  startedAt: number
  now?: number
  stageStartedAt?: number
  hostStage: string
  facts?: PrivateWorkspaceFacts
  phase: 'live' | 'settled'
  inspectionDeadline?: number | undefined
}
export type PrivateJournalEntry = {
  kind: 'flow' | 'host' | 'diagnostic'
  key: string
  source: string
  publisher?: string | undefined
  importance: NoticeSeverity
  text: string
  bytes: number
  sequence: number
  operationsPath?: readonly string[]
  clipped?: boolean
}
export type PrivateSurfaceState = {
  record?: string | undefined
  filters: Map<string, string>
  sorts: Map<string, { key: string; descending: boolean }>
  expanded: Map<string, string>
  scroll: number
  anchor?: { key: string; offset: number } | undefined
}
export type PrivateWorkspaceRecord = {
  key: string
  kind:
    | 'summary'
    | 'report'
    | 'facts'
    | 'progress'
    | 'row'
    | 'empty'
    | 'host'
    | 'activity'
    | 'journal'
    | 'call'
  signature: string
  publisher?: string | undefined
  text?: string
  section?: string | undefined
  block?: Exclude<Block, Collection>
  collection?: Collection
  row?: Collection['rows'][number]
  activity?: Extract<UserUpdate, { kind: 'activity' }>
  journal?: PrivateJournalEntry
  call?: PrivateCallNode
  depth?: number
  hidden?: number
  issues?: number
}
export function privateAttentionImportance(priority: number): string {
  return priority >= 4
    ? 'host failure / unconfirmed cleanup'
    : priority === 3
      ? 'observation incomplete'
      : priority === 2
        ? 'Flow-reported error'
        : 'Flow-reported warning'
}
export function privateAttentionReceipt(
  report: Pick<PrivateAttention, 'source' | 'text' | 'priority'> & { readonly color?: boolean },
): string {
  const source = privateUpdateText(report.source).replaceAll('\n', '\\n')
  if (report.priority <= 2) {
    const severity = report.priority === 2 ? 'error' : 'warning'
    const heading = privateCliHeading(
      `${source}-reported ${severity}:`,
      severity,
      report.color ?? false,
    )
    const attribution = privateCliHeading(`${source}:`, 'info', report.color ?? false)
    return `  ${heading}\n${privateUpdateText(report.text)
      .split('\n')
      .map((line, index) => (index === 0 ? `  ${attribution} ${line}` : `    ${line}`))
      .join('\n')}\n`
  }
  return (
    `  ${source} — ${privateAttentionImportance(report.priority)}:\n` +
    privateUpdateText(report.text)
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n') +
    '\n'
  )
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
  #publisherLabels = new Map<string, number>()
  #claims = 0
  #bytes = 0
  #callBytes = 0
  #attentionBytes = 0
  #stopped = false
  #surface = 'activity'
  #chosen = false
  #locals = new Map<string, PrivateSurfaceState>()
  #treeExpanded = new Set<string>()
  #journalSequence = 0
  #journalBytes = { flow: 0, host: 0, diagnostic: 0 }
  readonly journal: PrivateJournalEntry[] = []
  readonly journalOmitted = { flow: 0, host: 0, diagnostic: 0 }
  workspace: PrivateWorkspace = {
    target: 'Run',
    startedAt: privatePresentationNow(),
    hostStage: 'Waiting',
    phase: 'live',
  }
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
  get surface(): string {
    return this.#surface
  }
  get selected(): PrivateView | undefined {
    return this.views.get(this.#surface)
  }
  get local(): PrivateSurfaceState {
    let state = this.#locals.get(this.#surface)
    if (!state) {
      state = { filters: new Map(), sorts: new Map(), expanded: new Map(), scroll: 0 }
      this.#locals.set(this.#surface, state)
    }
    return state
  }
  get record(): PrivateWorkspaceRecord | undefined {
    const records = this.records()
    return records.find((r) => r.key === this.local.record) ?? records[0]
  }
  get collection(): Collection | undefined {
    return this.record?.collection
  }
  get row(): Collection['rows'][number] | undefined {
    return this.record?.row
  }
  get filter(): string {
    return this.collection ? (this.local.filters.get(this.collection.id) ?? '') : ''
  }
  get attentionBytes(): number {
    return this.#attentionBytes
  }
  configureWorkspace(options: { target: string; limitMs?: number; startedAt?: number }): void {
    this.workspace = {
      ...this.workspace,
      ...options,
      startedAt: options.startedAt ?? privatePresentationNow(),
    }
    this.onChange()
  }
  get hostFactsText(): string {
    const facts = this.workspace.facts
    return facts
      ? `Execution: ${facts.execution}\nApplication (literal outcome): ${facts.application}\nCleanup: ${facts.cleanup}\nDelivery: ${facts.delivery}\n${facts.completeness ?? ''}\n${this.context}`
      : this.context
  }
  setWorkspaceFacts(facts: PrivateWorkspaceFacts): void {
    this.workspace.facts = facts
    this.onChange()
  }
  setWorkspacePhase(phase: 'live' | 'settled', inspectionDeadline?: number | undefined): void {
    this.workspace.phase = phase
    this.workspace.inspectionDeadline = inspectionDeadline
    this.onChange()
  }
  setHostStage(text: string, id = 'stage'): void {
    this.workspace.hostStage = text
    this.workspace.stageStartedAt = this.workspace.now ?? privatePresentationNow()
    this.addHostEntry(id, text)
  }
  addHostEntry(id: string, text: string, importance: NoticeSeverity = 'info'): boolean {
    return this.#journal(
      { kind: 'host', key: `host:${id}`, source: 'Jig', text, importance },
      Buffer.byteLength(privateUpdateText(text)),
      64,
      131072,
    )
  }
  addDiagnostic(text: string, operationsPath: readonly string[] = [], clipped = false): boolean {
    const identity = JSON.stringify(operationsPath)
    const old = this.journal.find(
      (e) => e.kind === 'diagnostic' && e.key === `diagnostic:${identity}`,
    )
    const next = (old?.text ?? '') + text
    return this.#journal(
      {
        kind: 'diagnostic',
        key: `diagnostic:${identity}`,
        source: 'Diagnostic',
        text: next,
        importance: 'info',
        operationsPath: [...operationsPath],
        clipped: clipped || old?.clipped || false,
      },
      Buffer.byteLength(privateUpdateText(next)),
      32,
      65536,
    )
  }
  acceptNotice(
    publisher: string,
    severity: NoticeSeverity,
    text: string,
    payloadBytes: number,
  ): boolean {
    if (this.#stopped) return false
    return this.#journal(
      {
        kind: 'flow',
        key: `notice:${this.#journalSequence + 1}`,
        source: this.sourceLabel(publisher),
        publisher,
        text,
        importance: severity,
      },
      payloadBytes,
      128,
      524288,
    )
  }
  #journal(
    entry: Omit<PrivateJournalEntry, 'sequence' | 'bytes'>,
    bytes: number,
    countLimit: number,
    byteLimit: number,
  ): boolean {
    if (this.#closed) return false
    const old = this.journal.find((e) => e.key === entry.key)
    if (
      (!old && this.journal.filter((e) => e.kind === entry.kind).length >= countLimit) ||
      this.#journalBytes[entry.kind] - (old?.bytes ?? 0) + bytes > byteLimit
    ) {
      this.journalOmitted[entry.kind] = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.journalOmitted[entry.kind] + 1,
      )
      this.onChange()
      return false
    }
    this.#journalBytes[entry.kind] += bytes - (old?.bytes ?? 0)
    const value = { ...entry, sequence: old?.sequence ?? ++this.#journalSequence, bytes }
    if (old) this.journal[this.journal.indexOf(old)] = value
    else this.journal.push(value)
    this.onChange()
    return true
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
    if (!this.#publisherLabels.has(publisher) && this.#publisherLabels.size < 256)
      this.#publisherLabels.set(publisher, this.#publisherLabels.size + 1)
    const label = this.#publisherLabels.get(publisher)
    return parent === undefined
      ? `Flow (separate invocation${label ? ` ${label}` : ''})`
      : `Flow / ${this.calls.get(parent)?.slot ?? 'separate invocation'}${label ? ` (${label})` : ''}`
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
    if (!old && parent === undefined) this.#treeExpanded.add(identity)
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
        this.#locals.delete(old.key)
        if (this.#surface === old.key) this.select(undefined)
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
    const previousRecords = this.records().map((r) => r.key)
    const previousSelected = this.record
    const previousSemantic = previousSelected && JSON.stringify(previousSelected)
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
    if (publisher === 'root' && value.landing && !this.#chosen && this.#surface === 'activity') {
      this.#surface = view.key
      this.#repairSelection([])
    } else if (this.#surface === view.key) {
      this.#repairSelection(previousRecords)
      if (previousSemantic !== JSON.stringify(this.record)) {
        this.dismissPreview()
        if (this.record?.kind === 'summary' || this.record?.kind === 'report') {
          this.local.scroll = 0
          this.local.anchor = undefined
        }
      }
    }
    this.onChange()
  }
  freeze(publisher: string, reason = 'Observation ended'): void {
    for (const [identity, activity] of this.activities)
      if (activity.publisher === publisher) this.activities.delete(identity)
    const source = this.#sources.get(publisher)
    if (!source || source.ended) {
      this.onChange()
      return
    }
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
    else if (this.activities.has(key(publisher, value.id)) || this.activities.size < 16)
      this.activities.set(key(publisher, value.id), { publisher, value })
    this.onChange()
  }
  addAttention(
    source: string,
    text: string,
    priority: number,
    committed = false,
    color = false,
  ): boolean {
    const receipt = privateAttentionReceipt({ source, text, priority, color })
    const bytes = Buffer.byteLength(receipt)
    const limit = priority <= 2 ? 127 : 128,
      byteLimit = priority <= 2 ? 491520 : 524288
    const removals: number[] = []
    let count = this.attention.length,
      retained = this.#attentionBytes
    if (priority > 2) {
      for (
        let i = this.attention.length - 1;
        i >= 0 && (count >= limit || retained + bytes > byteLimit);
        i--
      ) {
        if (this.attention[i]!.priority >= priority) continue
        removals.push(i)
        count--
        retained -= this.attention[i]!.bytes
      }
    }
    if (count >= limit || retained + bytes > byteLimit) {
      this.incomplete = 'Additional reports unavailable: attention capacity reached'
      this.onChange()
      return false
    }
    if (removals.length) this.incomplete = 'Additional Flow reports unavailable'
    for (const index of removals) this.attention.splice(index, 1)
    this.#attentionBytes = retained + bytes
    this.attention.push({ source, text, priority, committed, bytes, color })
    this.onChange()
    return true
  }
  select(identity: string | undefined): void {
    this.#invalidate()
    this.#chosen = true
    this.#surface = identity ?? 'overview'
    this.focusedCall = undefined
    this.#repairSelection([])
    this.onChange()
  }
  cycleView(delta: number): void {
    const keys = ['activity', 'overview', ...this.views.keys()]
    const index = keys.indexOf(this.#surface)
    this.select(keys[(index + delta + keys.length) % keys.length])
  }
  collections(): Collection[] {
    return (
      this.selected?.value.sections.flatMap((s) =>
        s.blocks.filter((b): b is Collection => b.kind === 'collection'),
      ) ?? []
    )
  }
  visibleRows(collection = this.collection): Collection['rows'] {
    if (!collection) return []
    const filter = this.local.filters.get(collection.id) ?? ''
    const rows = collection.rows.filter(
      (r) =>
        !filter ||
        Object.values(r.cells).some((v) =>
          JSON.stringify(v)?.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
        ),
    )
    const sort = this.local.sorts.get(collection.id)
    if (sort)
      rows.sort((a, b) => {
        const av = a.cells[sort.key],
          bv = b.cells[sort.key]
        const comparison =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv))
        return (
          (sort.descending ? -comparison : comparison) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        )
      })
    return rows
  }
  records(): PrivateWorkspaceRecord[] {
    const selected = this.selected
    if (selected) {
      const result: PrivateWorkspaceRecord[] = [
        {
          key: 'summary',
          kind: 'summary',
          publisher: selected.publisher,
          text: selected.value.summary,
          signature: JSON.stringify(selected.value.summary),
        },
      ]
      selected.value.sections.forEach((section, si) => {
        section.blocks.forEach((block, bi) => {
          const position = `${si}:${bi}`
          if (block.kind === 'collection') {
            const rows = this.visibleRows(block)
            if (!rows.length)
              result.push({
                key: privateRowRecordKey(block.id),
                kind: 'empty',
                publisher: selected.publisher,
                collection: block,
                section: section.title,
                signature: '',
              })
            for (const row of rows)
              result.push({
                key: privateRowRecordKey(block.id, row.id),
                kind: 'row',
                publisher: selected.publisher,
                collection: block,
                row,
                section: section.title,
                signature: '',
              })
          } else
            result.push({
              key: `block:${position}`,
              kind: block.kind,
              publisher: selected.publisher,
              block,
              section: section.title,
              signature: JSON.stringify(block),
            })
        })
      })
      return result
    }
    if (this.#surface === 'activity') {
      const result: PrivateWorkspaceRecord[] = [
        {
          key: 'current-host',
          kind: 'host',
          text: this.workspace.facts ? this.hostFactsText : this.workspace.hostStage,
          signature: '',
        },
      ]
      for (const [identity, activity] of this.activities)
        result.push({
          key: `activity:${identity}`,
          kind: 'activity',
          publisher: activity.publisher,
          activity: activity.value,
          signature: '',
        })
      for (const entry of this.journal)
        result.push({
          key: entry.key,
          kind: 'journal',
          journal: entry,
          publisher: entry.publisher,
          signature: '',
        })
      return result
    }
    const result: PrivateWorkspaceRecord[] = [
      { key: 'host-facts', kind: 'host', text: this.hostFactsText, signature: '' },
    ]
    const visit = (parent: string | undefined, depth: number) => {
      for (const node of this.calls.values()) {
        if (node.parent !== parent) continue
        const descendants = this.descendants(node.key)
        result.push({
          key: node.key,
          kind: 'call',
          call: node,
          depth,
          hidden: this.#treeExpanded.has(node.key) ? 0 : descendants.length,
          issues: descendants.filter((n) => n.state === 'failed' || n.state === 'uncertain').length,
          signature: '',
        })
        if (this.#treeExpanded.has(node.key) && depth < 32) visit(node.key, depth + 1)
      }
    }
    visit(undefined, 0)
    return result
  }
  descendants(identity: string): PrivateCallNode[] {
    const result: PrivateCallNode[] = [],
      pending = [identity]
    while (pending.length && result.length < 256) {
      const parent = pending.shift()
      for (const n of this.calls.values())
        if (n.parent === parent && !result.includes(n)) {
          result.push(n)
          pending.push(n.key)
        }
    }
    return result
  }
  treeExpanded(identity: string): boolean {
    return this.#treeExpanded.has(identity)
  }
  expandTree(expand: boolean): void {
    const node = this.record?.call
    if (!node) return
    if (expand) this.#treeExpanded.add(node.key)
    else if (this.#treeExpanded.has(node.key)) this.#treeExpanded.delete(node.key)
    else if (node.parent) this.local.record = node.parent
    this.#invalidate()
    this.onChange()
  }
  dismissPreview(): void {
    this.#generation++
    this.preview = undefined
    this.previewTitle = undefined
  }
  #invalidate(): void {
    this.#generation++
    this.selectionVersion++
    this.preview = undefined
    this.feedback = ''
  }
  #repairSelection(previous: string[]): void {
    const records = this.records()
    for (const [identity, signature] of this.local.expanded) {
      if (!records.some((r) => r.key === identity && r.signature === signature))
        this.local.expanded.delete(identity)
    }
    if (records.some((r) => r.key === this.local.record)) return
    const identity = this.local.record
    const index = previous.indexOf(identity ?? '')
    let candidates = records
    if (identity?.startsWith('["collection",')) {
      const collection = (JSON.parse(identity) as string[])[1]
      candidates = records.filter((r) => r.collection?.id === collection)
    }
    const prior = previous
      .slice(0, Math.max(0, index))
      .reverse()
      .find((id) => candidates.some((r) => r.key === id))
    this.#invalidate()
    this.local.record = prior ?? candidates[0]?.key ?? records[0]?.key
  }
  markNavigation(): void {
    this.#chosen = true
  }
  selectRecord(identity: string): void {
    this.#chosen = true
    if (!this.records().some((r) => r.key === identity)) return
    this.local.record = identity
    this.local.scroll = 0
    this.local.anchor = undefined
    this.#invalidate()
    this.onChange()
  }
  moveRecord(delta: number): void {
    const records = this.records(),
      index = records.findIndex((r) => r.key === this.record?.key)
    const record = records[Math.max(0, Math.min(records.length - 1, index + delta))]
    if (record) this.selectRecord(record.key)
  }
  moveRow(delta: number): void {
    this.moveRecord(delta)
  }
  cycleCollection(): void {
    const records = this.records(),
      collections = this.collections(),
      current = this.record
    if (!collections.length) {
      this.feedback = 'No collections in this view'
      this.onChange()
      return
    }
    if (collections.length === 1 && current?.collection) return
    const currentIndex = current?.collection
      ? collections.findIndex((c) => c.id === current.collection!.id)
      : -1
    const next =
      currentIndex >= 0
        ? collections[(currentIndex + 1) % collections.length]
        : (records
            .slice(records.findIndex((r) => r.key === current?.key) + 1)
            .find((r) => r.collection)?.collection ?? collections[0])
    const record = records.find((r) => r.collection?.id === next?.id)
    if (record) this.selectRecord(record.key)
  }
  requireCollection(): boolean {
    if (this.collection) return true
    this.feedback = 'Select a collection; c moves to one'
    this.onChange()
    return false
  }
  filterRows(value: string): void {
    if (!this.requireCollection()) return
    const previous = this.records().map((r) => r.key)
    this.local.filters.set(this.collection!.id, bound(value, 128))
    this.#invalidate()
    this.#repairSelection(previous)
    this.onChange()
  }
  sortRows(): void {
    if (!this.requireCollection()) return
    const collection = this.collection!,
      old = this.local.sorts.get(collection.id)
    const index = collection.columns.findIndex((c) => c.key === old?.key)
    if (index === collection.columns.length - 1) this.local.sorts.delete(collection.id)
    else
      this.local.sorts.set(collection.id, {
        key: collection.columns[index + 1]!.key,
        descending: false,
      })
    this.#invalidate()
    this.onChange()
  }
  disclosure(record = this.record): boolean {
    return !!record && this.local.expanded.get(record.key) === record.signature
  }
  toggleDisclosure(): void {
    const record = this.record
    if (!record) return
    if (this.disclosure(record)) this.local.expanded.delete(record.key)
    else this.local.expanded.set(record.key, record.signature)
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
      const collection = this.collections().find((c) => c.id === ref.collectionId)
      const hidden = !this.visibleRows(collection).some((r) => r.id === ref.rowId)
      if (hidden) this.local.filters.delete(ref.collectionId)
      this.local.record = privateRowRecordKey(ref.collectionId, ref.rowId)
      this.local.scroll = 0
      this.local.anchor = undefined
      this.feedback =
        resolved.label + (hidden ? ' (local filter cleared to show referenced record)' : '')
    } else if (ref.kind === 'call') {
      this.select(undefined)
      this.focusedCall = resolved.target
      this.local.record = resolved.target
      let ancestor = this.calls.get(resolved.target!)?.parent
      while (ancestor) {
        this.#treeExpanded.add(ancestor)
        ancestor = this.calls.get(ancestor)?.parent
      }
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
    this.#locals.clear()
    this.#artifact = undefined
    this.#preview = undefined
    this.onChange = () => {}
  }
}
