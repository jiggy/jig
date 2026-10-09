import type {
  Block,
  Collection,
  NoticeSeverity,
  Reference,
  UserUpdate,
  ViewItem,
} from '@jigging/user-updates'
import {
  attentionImportance,
  displayDestinations,
  displayViewKey,
  recordReferences,
  validateDisplaySnapshot,
  type DisplayAttribution,
  type DisplayCallState,
  type DisplayFact,
  type DisplaySnapshot,
  type DisplaySnapshotEnvelope,
  type RecordedViewRole,
} from '@jigging/display-model'
import type { PreviewService, TuiOptions, TuiTheme } from './types.js'

export { attentionImportance, recordReferences }
export const rowRecordKey = (collection: string, row?: string): string =>
  JSON.stringify(['collection', collection, row ?? null])
export const callRecordKey = (id: string): string => JSON.stringify(['call', id])
export function viewerFactText(label: string, fact: DisplayFact): string {
  const attributed =
    fact.provenance === 'recorded-claim'
      ? `Recorded ${label.toLowerCase()}`
      : fact.provenance === 'application-reported'
        ? `Reported ${label.toLowerCase()}`
        : label
  return `${attributed}${label === 'Application' ? ' (literal outcome)' : ''}${fact.clipped ? ' [clipped]' : ''}${label === 'Application' ? ':' : ''} ${fact.value}`
}
export function viewerFactTone(
  field: 'execution' | 'cleanup' | 'delivery',
  fact: DisplayFact,
): 'success' | 'warning' | 'error' | undefined {
  if (fact.provenance !== 'host-observed' || fact.clipped) return
  if (field === 'execution')
    return fact.value === 'succeeded'
      ? 'success'
      : fact.value === 'failed'
        ? 'error'
        : fact.value === 'lost'
          ? 'warning'
          : undefined
  if (field === 'cleanup')
    return fact.value === 'complete'
      ? 'success'
      : fact.value === 'unconfirmed'
        ? 'error'
        : undefined
  return fact.value === 'written' ? 'success' : fact.value === 'failed' ? 'error' : undefined
}
const bound = (value: string, maximum: number): string => [...value].slice(0, maximum).join('')
export function observedTime(value: number): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'Time unavailable'
}

type ViewerPreview = { text: string; bytes: number; clipped: boolean }
export type ViewerCall = {
  id: string
  key: string
  publisher: string
  sourceLabel: string
  operationId: string
  slot: string
  state: DisplayCallState
  time: number
  firstObservedAt: number
  parent?: string
  parentId?: string
  childPublisher?: string
  intent?: string
  cause?: string
}
export type ViewerView = {
  id: string
  key: string
  publisher: string
  sourceLabel: string
  value: ViewItem
  updated: number
  ended?: string
  role?: RecordedViewRole
}
export type ViewerAttention = {
  id: string
  source: string
  text: string
  priority: number
  committed: boolean
}
export type ViewerJournalEntry = {
  key: string
  kind: 'host' | 'flow' | 'diagnostic'
  source: string
  publisher?: string
  attribution: DisplayAttribution
  importance: NoticeSeverity | 'unknown'
  text: string
  sequence: number
  operationsPath?: readonly string[]
  pathClipped?: boolean
  clipped?: boolean
}
export type LocalSurfaceState = {
  teaserWidth?: number
  teaserBytes?: number
  record?: string | undefined
  filters: Map<string, string>
  sorts: Map<string, { key: string; descending: boolean }>
  expanded: Map<string, string>
  scroll: number
  anchor?: { key: string; offset: number } | undefined
}
type CaptureFile = {
  id: string
  path: string
  bytes: number
  state: 'text' | 'empty' | 'non-text' | 'unavailable'
  clipped: boolean
}
export type ViewerRecord = {
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
    | 'setup'
    | 'call'
    | 'file'
  signature: string
  publisher?: string | undefined
  text?: string
  section?: string
  block?: Exclude<Block, Collection>
  collection?: Collection
  row?: Collection['rows'][number]
  activity?: Extract<UserUpdate, { kind: 'activity' }>
  journal?: ViewerJournalEntry
  journalGroup?: readonly ViewerJournalEntry[]
  call?: ViewerCall
  file?: CaptureFile
  depth?: number
  hidden?: number
  issues?: number
}

/** Private renderer adapter. Hydration replaces observations; no admission is replayed. */
export class ViewerModel {
  readonly calls = new Map<string, ViewerCall>()
  readonly views = new Map<string, ViewerView>()
  readonly activities = new Map<
    string,
    { publisher: string; value: Extract<UserUpdate, { kind: 'activity' }> }
  >()
  readonly attention: ViewerAttention[] = []
  readonly journal: ViewerJournalEntry[] = []
  readonly journalOmitted = { flow: 0, host: 0, diagnostic: 0 }
  workspace: {
    target: string
    phase: 'live' | 'settled'
    hostStage: string
    elapsedMs: number
    limitMs?: number
    recorded: boolean
    facts?: DisplaySnapshot['workspace']['facts']
  } = { target: 'Run', phase: 'live', hostStage: 'Waiting', elapsedMs: 0, recorded: false }
  readonly theme: TuiTheme
  rootSourceId = ''
  omissions = 0
  incomplete: string | undefined
  context = ''
  feedback = ''
  focusedCall: string | undefined
  selectionVersion = 0
  preview: ViewerPreview | undefined
  previewTitle: string | undefined
  previewState: CaptureFile['state'] | 'pending' | 'loading' | undefined
  onChange: () => void
  #surface = 'activity'
  #chosen = false
  #locals = new Map<string, LocalSurfaceState>()
  #treeExpanded = new Set<string>()
  #treeChoices = new Set<string>()
  #labels = new Map<string, string>()
  #capture = {
    generation: '',
    sourcePublisher: '',
    provenance: 'verified-delivery' as 'verified-delivery' | 'recorded-capture',
    phase: 'pending' as 'pending' | 'ready' | 'unavailable',
    files: [] as CaptureFile[],
    permittedAttachments: [] as string[],
  }
  #previewService: PreviewService | undefined
  #previewEnabled = true
  #previewBusy = false
  #generation = 0
  #peekSignature = ''
  #closed = false
  #complete = false
  #hadComplete = false
  #bodyStale = false
  #revision = -1
  constructor(
    snapshot: DisplaySnapshotEnvelope,
    options: Pick<TuiOptions, 'theme' | 'preview' | 'onChange'> = {},
  ) {
    this.theme = options.theme ?? 'one-dark'
    this.#previewService = options.preview
    this.onChange = options.onChange ?? (() => {})
    this.update(snapshot)
  }
  get closed(): boolean {
    return this.#closed
  }
  get observationWarning(): string | undefined {
    return this.incomplete
      ? `${this.#bodyStale ? 'Stale' : 'Incomplete'} observations · ${this.incomplete}`
      : undefined
  }
  get artifactCapture() {
    return this.#capture
  }
  get surface(): string {
    return this.#surface
  }
  get selected(): ViewerView | undefined {
    return this.views.get(this.#surface)
  }
  get local(): LocalSurfaceState {
    let state = this.#locals.get(this.#surface)
    if (!state) {
      state = { filters: new Map(), sorts: new Map(), expanded: new Map(), scroll: 0 }
      this.#locals.set(this.#surface, state)
    }
    return state
  }
  get record(): ViewerRecord | undefined {
    const records = this.records()
    return records.find((record) => record.key === this.local.record) ?? records[0]
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
  get hostFactsText(): string {
    const facts = this.workspace.facts
    return facts
      ? [
          viewerFactText('Execution', facts.execution),
          viewerFactText('Application', facts.application),
          viewerFactText('Cleanup', facts.cleanup),
          viewerFactText('Delivery', facts.delivery),
          ...(facts.completeness ? [viewerFactText('Observation', facts.completeness)] : []),
          this.context,
        ].join('\n')
      : this.context
  }
  get sticky(): ViewerAttention | undefined {
    return this.attention.reduce<ViewerAttention | undefined>(
      (best, entry) => (!best || entry.priority > best.priority ? entry : best),
      undefined,
    )
  }
  sourceLabel(sourceId: string): string {
    return this.#labels.get(sourceId) ?? 'Source unavailable'
  }
  update(value: DisplaySnapshotEnvelope): void {
    if (this.#closed) return
    let snapshot: DisplaySnapshotEnvelope
    try {
      snapshot = validateDisplaySnapshot(value)
    } catch {
      this.#complete = false
      this.#bodyStale = this.#hadComplete
      this.incomplete =
        'Current display snapshot is malformed or exceeds the display limits; previous observations are stale.'
      this.dismissPreview()
      return
    }
    if (snapshot.revision < this.#revision) return
    this.#revision = snapshot.revision
    this.rootSourceId = snapshot.rootSourceId
    const facts = snapshot.workspace.facts
    this.workspace = {
      target: snapshot.workspace.target,
      phase: snapshot.workspace.phase,
      hostStage: snapshot.workspace.hostStage,
      elapsedMs: snapshot.workspace.elapsedMs,
      ...(snapshot.workspace.limitMs === undefined ? {} : { limitMs: snapshot.workspace.limitMs }),
      recorded: snapshot.mode === 'recorded-packet',
      ...(facts ? { facts } : {}),
    }
    this.context = snapshot.context
    this.omissions = snapshot.omissions.calls
    Object.assign(this.journalOmitted, snapshot.omissions.journal)
    this.attention.splice(
      0,
      this.attention.length,
      ...snapshot.attention.map((entry) => ({
        id: entry.id,
        source: entry.attribution.sourceLabel,
        text: entry.text,
        priority: entry.priority,
        committed: entry.transcriptCommitted,
      })),
    )
    if (snapshot.kind === 'incomplete') {
      this.#complete = false
      this.#bodyStale = this.#hadComplete
      this.incomplete =
        snapshot.reason +
        (this.views.size ? ' · Previous observations are stale; references disabled.' : '')
      this.journal.splice(0, this.journal.length, ...this.#journal(snapshot.diagnostics))
      this.dismissPreview()
      return
    }
    this.#replace(snapshot)
  }
  #journal(entries: DisplaySnapshot['journal']): ViewerJournalEntry[] {
    return entries.map((entry) => ({
      key: JSON.stringify(['journal', entry.id]),
      kind: entry.kind,
      source: entry.attribution.sourceLabel,
      attribution: entry.attribution,
      importance: entry.importance,
      text: entry.text,
      sequence: entry.sequence,
      ...('sourceId' in entry.attribution && entry.attribution.sourceId
        ? { publisher: entry.attribution.sourceId }
        : {}),
      ...(entry.operationsPath ? { operationsPath: entry.operationsPath } : {}),
      ...(entry.pathClipped === undefined ? {} : { pathClipped: entry.pathClipped }),
      ...(entry.clipped === undefined ? {} : { clipped: entry.clipped }),
    }))
  }
  #replace(snapshot: DisplaySnapshot): void {
    const previous = new Map<string, string[]>()
    const retainedSurface = this.#surface
    const oldRecord = this.record
    const oldSignature = oldRecord && JSON.stringify([oldRecord.key, oldRecord.signature])
    for (const surface of this.#locals.keys()) {
      this.#surface = surface
      previous.set(
        surface,
        this.records().map((record) => record.key),
      )
    }
    this.#surface = retainedSurface
    const previousCapture = JSON.stringify(this.#capture)
    this.#complete = true
    this.#hadComplete = true
    this.#bodyStale = false
    this.incomplete = snapshot.incomplete
    this.#labels.clear()
    this.#labels.set(
      snapshot.rootSourceId,
      snapshot.mode === 'recorded-packet' ? 'Recorded' : 'Flow',
    )
    this.views.clear()
    for (const view of snapshot.views) {
      this.#labels.set(view.sourceId, view.sourceLabel)
      const key = displayViewKey(view.id)
      this.views.set(key, {
        id: view.id,
        key,
        publisher: view.sourceId,
        sourceLabel: view.sourceLabel,
        value: view.value as ViewItem,
        updated: view.updatedAt,
        ...(view.ended === undefined ? {} : { ended: view.ended }),
        ...(view.hostRole === undefined ? {} : { role: view.hostRole }),
      })
    }
    this.calls.clear()
    for (const call of snapshot.calls) {
      this.#labels.set(call.sourceId, call.sourceLabel)
      const key = callRecordKey(call.id)
      this.calls.set(key, {
        id: call.id,
        key,
        publisher: call.sourceId,
        sourceLabel: call.sourceLabel,
        operationId: call.operationId,
        slot: call.slot,
        state: call.state,
        time: call.observedAt,
        firstObservedAt: call.firstObservedAt,
        ...(call.parentId === undefined
          ? {}
          : { parentId: call.parentId, parent: callRecordKey(call.parentId) }),
        ...(call.childSourceId === undefined ? {} : { childPublisher: call.childSourceId }),
        ...(call.intent === undefined ? {} : { intent: call.intent }),
        ...(call.cause === undefined ? {} : { cause: call.cause }),
      })
    }
    for (const identity of [...this.#treeChoices])
      if (!this.calls.has(identity)) this.#treeChoices.delete(identity)
    for (const identity of [...this.#treeExpanded])
      if (!this.calls.has(identity)) this.#treeExpanded.delete(identity)
    for (const node of this.calls.values())
      if (!this.#treeChoices.has(node.key)) {
        if (
          node.state !== 'returned' ||
          this.descendants(node.key).some((child) => child.state !== 'returned')
        )
          this.#treeExpanded.add(node.key)
        else this.#treeExpanded.delete(node.key)
      }
    this.activities.clear()
    for (const activity of snapshot.activities) {
      this.#labels.set(activity.sourceId, activity.sourceLabel)
      this.activities.set(activity.id, {
        publisher: activity.sourceId,
        value: activity.value as Extract<UserUpdate, { kind: 'activity' }>,
      })
    }
    this.journal.splice(0, this.journal.length, ...this.#journal(snapshot.journal))
    this.#capture = {
      generation: snapshot.artifacts.generation,
      sourcePublisher: snapshot.artifacts.sourceId,
      provenance: snapshot.artifacts.provenance,
      phase: snapshot.artifacts.phase,
      files: snapshot.artifacts.files.map((file) => ({ ...file })),
      permittedAttachments: [...snapshot.artifacts.permittedAttachments],
    }
    const keys = this.surfaceKeys()
    for (const surface of [...this.#locals.keys()])
      if (!keys.includes(surface)) this.#locals.delete(surface)
    for (const surface of this.#locals.keys()) {
      this.#surface = surface
      // Keep local maps bounded by the current collection identities, even away.
      const collections = this.collections()
      for (const id of this.local.filters.keys()) {
        if (!collections.some((collection) => collection.id === id)) this.local.filters.delete(id)
      }
      for (const [id, sort] of this.local.sorts) {
        const collection = collections.find((collection) => collection.id === id)
        if (!collection?.columns.some((column) => column.key === sort.key))
          this.local.sorts.delete(id)
      }
      this.#repairSelection(previous.get(surface) ?? [], false)
    }
    this.#surface = keys.includes(retainedSurface)
      ? retainedSurface
      : this.workspace.recorded
        ? (keys[0] ?? 'files')
        : 'overview'
    if (!this.#chosen) {
      const roots = [...this.views.values()].filter((view) => view.publisher === this.rootSourceId)
      const landing =
        roots.find((view) => view.value.landing) ??
        (this.workspace.phase === 'settled' ? roots[0] : undefined)
      if (landing && (this.#surface === 'activity' || this.workspace.phase === 'settled')) {
        this.#surface = landing.key
        if (this.workspace.phase === 'settled')
          this.local.record =
            this.records().find((record) => record.row)?.key ?? this.records()[0]?.key
      } else if (this.workspace.recorded && !keys.includes(this.#surface))
        this.#surface = keys[0] ?? 'files'
    }
    this.#repairSelection(previous.get(this.#surface) ?? [], false)
    const selected = this.record
    if (
      previousCapture !== JSON.stringify(this.#capture) ||
      oldSignature !== (selected && JSON.stringify([selected.key, selected.signature]))
    ) {
      this.dismissPreview()
      if (selected?.kind === 'summary' || selected?.kind === 'report') {
        this.local.scroll = 0
        this.local.anchor = undefined
      }
    }
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
    const keys = this.surfaceKeys()
    const index = keys.indexOf(this.#surface)
    this.select(keys[(index + delta + keys.length) % keys.length])
  }
  surfaceKeys(): string[] {
    return this.destinations().map((entry) => entry.key)
  }
  destinations() {
    return displayDestinations(
      Boolean(this.workspace.recorded),
      [...this.views.values()].map((view) => ({
        key: view.id,
        title: view.value.title,
        source: view.sourceLabel,
        role: view.role,
      })),
    )
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
    if (sort && !collection.columns.some((column) => column.key === sort.key))
      this.local.sorts.delete(collection.id)
    if (sort && collection.columns.some((column) => column.key === sort.key))
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
  records(): ViewerRecord[] {
    const selected = this.selected
    if (selected) {
      const result: ViewerRecord[] = [
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
                key: rowRecordKey(block.id),
                kind: 'empty',
                publisher: selected.publisher,
                collection: block,
                ...(section.title === undefined ? {} : { section: section.title }),
                signature: '',
              })
            for (const row of rows)
              result.push({
                key: rowRecordKey(block.id, row.id),
                kind: 'row',
                publisher: selected.publisher,
                collection: block,
                row,
                ...(section.title === undefined ? {} : { section: section.title }),
                signature: JSON.stringify([block.columns, row]),
              })
          } else
            result.push({
              key: `block:${position}`,
              kind: block.kind,
              publisher: selected.publisher,
              block,
              ...(section.title === undefined ? {} : { section: section.title }),
              signature: JSON.stringify(block),
            })
        })
      })
      return result
    }
    if (this.#surface === 'files') {
      const capture = this.#capture
      return capture.files.length
        ? capture.files.map((file) => ({
            key: JSON.stringify(['captured-file', capture.generation, file.id]),
            kind: 'file',
            file,
            text: file.path,
            signature: JSON.stringify([capture.generation, file]),
          }))
        : [
            {
              key: 'capture-state',
              kind: 'host',
              text:
                capture.phase === 'pending'
                  ? 'Delivered files are pending'
                  : capture.phase === 'unavailable'
                    ? 'Immutable delivery capture is unavailable'
                    : 'No files were delivered',
              signature: capture.phase,
            },
          ]
    }
    if (this.#surface === 'activity') {
      const result: ViewerRecord[] =
        this.workspace.phase === 'live'
          ? [
              {
                key: JSON.stringify(['host', 'current']),
                kind: 'host',
                text: this.workspace.hostStage,
                signature: '',
              },
            ]
          : []
      for (const [identity, activity] of this.activities)
        result.push({
          key: JSON.stringify(['activity', identity]),
          kind: 'activity',
          publisher: activity.publisher,
          activity: activity.value,
          signature: '',
        })
      const setup = this.journal.filter(
        (entry) => entry.kind === 'host' && entry.importance === 'info',
      )
      for (const entry of [...this.journal].reverse()) {
        if (entry.kind === 'host' && entry.importance === 'info') continue
        result.push({
          key: entry.key,
          kind: 'journal',
          journal: entry,
          publisher: entry.publisher,
          signature: '',
        })
      }
      if (setup.length)
        result.push({
          key: JSON.stringify(['host', 'setup']),
          kind: 'setup',
          text: `Jig stages · ${setup.length} reports · Enter history`,
          journalGroup: setup,
          signature: '',
        })
      return result
    }
    const result: ViewerRecord[] = []
    const visit = (parent: string | undefined, depth: number) => {
      for (const node of this.calls.values()) {
        if (
          parent === undefined
            ? node.parent !== undefined && this.calls.has(node.parent)
            : node.parent !== parent
        )
          continue
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
  descendants(identity: string): ViewerCall[] {
    const result: ViewerCall[] = [],
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
    this.#treeChoices.add(node.key)
    if (expand) this.#treeExpanded.add(node.key)
    else if (this.#treeExpanded.has(node.key)) this.#treeExpanded.delete(node.key)
    else if (node.parent) this.local.record = node.parent
    this.#invalidate()
    this.onChange()
  }
  dismissPreview(): void {
    this.#generation++
    this.preview = undefined
    this.previewState = undefined
    this.previewTitle = undefined
    this.#peekSignature = ''
  }
  #invalidate(): void {
    this.#generation++
    this.selectionVersion++
    this.preview = undefined
    this.previewState = undefined
    this.previewTitle = undefined
    this.#peekSignature = ''
    this.feedback = ''
  }
  #repairSelection(previous: string[], invalidate = true): void {
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
    if (invalidate) this.#invalidate()
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

  /** Capture lookup accepts only supplied opaque inventory identities. */
  resolve(
    publisher: string,
    ref: Reference,
  ): { available: boolean; label: string; target?: string } {
    if (!this.#complete)
      return {
        available: false,
        label: 'Reference unavailable; current observations are incomplete',
      }
    if (ref.kind === 'call') {
      const node = [...this.calls.values()].find(
        (node) => node.publisher === publisher && node.operationId === ref.operationId,
      )
      return node
        ? { available: true, label: `${node.slot}: ${node.state}`, target: node.key }
        : { available: false, label: 'Call unavailable' }
    }
    if (ref.kind === 'record') {
      const view = [...this.views.values()].find(
        (view) => view.publisher === publisher && view.value.id === ref.viewId,
      )
      const collection = view?.value.sections
        .flatMap((section) => section.blocks)
        .find(
          (block): block is Collection =>
            block.kind === 'collection' && block.id === ref.collectionId,
        )
      return collection?.rows.some((row) => row.id === ref.rowId)
        ? { available: true, label: `${view!.value.title} / ${ref.rowId}`, target: view!.key }
        : { available: false, label: 'Record unavailable' }
    }
    const file = this.#capture.files.find((file) => file.path === ref.path)
    return this.#capture.phase === 'ready' &&
      publisher === this.#capture.sourcePublisher &&
      this.#capture.permittedAttachments.includes(ref.attachment) &&
      file &&
      file.state !== 'unavailable'
      ? {
          available: true,
          label: `${this.workspace.recorded ? 'Captured recorded file' : 'Delivered file'}: ${ref.path}`,
          target: file.path,
        }
      : {
          available: false,
          label: this.workspace.recorded
            ? 'Artifact unavailable; not present in captured recorded files'
            : 'Artifact unavailable; not present in verified delivered files',
        }
  }
  peekSelectedArtifact(): void {
    if (this.#closed || !this.#complete || !this.#previewEnabled) return
    const record = this.record,
      references = recordReferences(record)
    const ref =
      references.length === 1 && references[0]?.kind === 'artifact' ? references[0] : undefined
    const signature = JSON.stringify([
      this.surface,
      record?.key,
      record?.signature,
      references,
      this.#capture.generation,
    ])
    if (signature === this.#peekSignature) return
    this.#peekSignature = signature
    if (record?.file && this.previewTitle === record.file.path && this.previewState) return
    this.#generation++
    this.preview = undefined
    this.previewState = undefined
    this.previewTitle = undefined
    if (record?.file) {
      this.previewTitle = record.file.path
      if (this.#previewBusy) {
        this.#peekSignature = ''
        return
      }
      void this.#loadPreview(record.file.path, record.file.path, true, record.file.id)
      return
    }
    if (!ref) return
    this.previewTitle = ref.path
    const resolved = this.resolve(record?.publisher ?? this.rootSourceId, ref)
    if (!resolved.available) {
      this.previewState = this.#capture.phase === 'pending' ? 'pending' : 'unavailable'
      return
    }
    if (this.#previewBusy) {
      this.#peekSignature = ''
      return
    }
    void this.#loadPreview(resolved.target!, ref.path, true)
  }
  async activateFile(identity: string): Promise<void> {
    const file = this.#capture.files.find((file) => file.id === identity)
    if (this.#closed || !this.#complete || !this.#previewEnabled || !file) return
    if (this.surface === 'files' && this.record?.file?.id !== file.id) {
      const record = this.records().find((record) => record.file?.id === file.id)
      if (record) this.selectRecord(record.key)
    }
    if (this.record?.file?.id === file.id && this.previewTitle === file.path && this.previewState)
      return
    this.#invalidate()
    await this.#loadPreview(file.path, file.path, false, file.id)
  }
  async #loadPreview(path: string, title: string, auto: boolean, identity?: string): Promise<void> {
    if (this.#closed || !this.#complete || !this.#previewEnabled) return
    const file = this.#capture.files.find((file) =>
      identity === undefined ? file.path === path : file.id === identity,
    )
    this.preview = undefined
    this.previewTitle = title
    if (!file || this.#capture.phase !== 'ready') {
      this.previewState = this.#capture.phase === 'pending' ? 'pending' : 'unavailable'
      this.onChange()
      return
    }
    if (!['text', 'empty'].includes(file.state)) {
      this.previewState = file.state
      this.onChange()
      return
    }
    if (this.#previewBusy) return
    this.#previewBusy = true
    this.previewState = 'loading'
    this.feedback = `${title} — loading immutable preview`
    const generation = this.#generation,
      captureGeneration = this.#capture.generation
    const current = () =>
      !this.#closed &&
      this.#complete &&
      generation === this.#generation &&
      captureGeneration === this.#capture.generation
    try {
      const reply = await this.#previewService?.({ artifactId: file.id, captureGeneration })
      if (current()) {
        const valid =
          reply &&
          reply.artifactId === file.id &&
          reply.captureGeneration === captureGeneration &&
          reply.provenance === this.#capture.provenance &&
          Number.isSafeInteger(reply.bytes) &&
          reply.bytes >= 0 &&
          typeof reply.clipped === 'boolean' &&
          (reply.state === 'text' || reply.state === 'empty') &&
          typeof reply.text === 'string' &&
          Buffer.byteLength(reply.text) <= 65536
        this.preview = valid
          ? { text: reply.text!, bytes: reply.bytes, clipped: reply.clipped }
          : undefined
        this.previewState = this.preview ? (this.preview.text ? 'text' : 'empty') : 'unavailable'
        this.feedback = this.preview
          ? `Immutable captured preview: ${title}`
          : `Immutable preview unavailable; inspect ${this.workspace.recorded ? 'the selected packet' : 'the delivered location'}`
      }
    } catch {
      if (current()) {
        this.previewState = 'unavailable'
        this.feedback = `Immutable preview unavailable; inspect ${this.workspace.recorded ? 'the selected packet' : 'the delivered location'}`
      }
    } finally {
      this.#previewBusy = false
      if (auto && !this.#closed && this.#previewEnabled && generation !== this.#generation)
        this.peekSelectedArtifact()
      if (!this.#closed) this.onChange()
    }
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
      const collection = this.collections().find((collection) => collection.id === ref.collectionId)
      const hidden = !this.visibleRows(collection).some((row) => row.id === ref.rowId)
      if (hidden) this.local.filters.delete(ref.collectionId)
      this.local.record = rowRecordKey(ref.collectionId, ref.rowId)
      this.local.scroll = 0
      this.local.anchor = undefined
      this.feedback =
        resolved.label + (hidden ? ' (local filter cleared to show referenced record)' : '')
    } else if (ref.kind === 'call') {
      this.select(undefined)
      this.focusedCall = resolved.target
      this.local.record = resolved.target
      let ancestor = this.calls.get(resolved.target!)?.parent
      for (let depth = 0; ancestor && depth < 32; depth++) {
        this.#treeExpanded.add(ancestor)
        ancestor = this.calls.get(ancestor)?.parent
      }
      this.feedback = resolved.label
    } else await this.#loadPreview(resolved.target!, `${ref.attachment}:${ref.path}`, false)
    if (!this.#closed) this.onChange()
  }
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#generation++
    this.preview = undefined
    this.#previewService = undefined
    this.#previewEnabled = false
    this.#locals.clear()
    this.#treeExpanded.clear()
    this.#treeChoices.clear()
    this.#labels.clear()
    this.calls.clear()
    this.views.clear()
    this.activities.clear()
    this.journal.length = 0
    this.attention.length = 0
    this.#capture.files = []
    this.onChange = () => {}
  }
  /** Inline owns observations and local state; all interactive effects end here. */
  releaseViewerEffects(): void {
    this.dismissPreview()
    this.#previewEnabled = false
    this.#previewService = undefined
    this.feedback = ''
    this.onChange = () => {}
  }
}
