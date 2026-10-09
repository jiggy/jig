import {
  type Collection,
  type NoticeSeverity,
  type Reference,
  type UserUpdate,
  VIEW_LIMITS,
  type ViewItem,
} from '@jigging/user-updates'
import { attentionImportance as privateAttentionImportance } from '@jigging/display-model'
import { privateCliHeading } from './cli-presentation.js'
import { privatePresentationNow } from './internal/root-run-timeout-policy.js'
import { escapeTerminalText as privateUpdateText } from '@jigging/display-tui/text'

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
export type PrivateCallNode = PrivateCallEvent & {
  key: string
  parent?: string
  firstObservedAt: number
  clipped?: true
}
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
export type PrivateAdmission =
  | { provenance: 'accepted-source'; publisher: string; operationId?: string }
  | { provenance: 'host-observed'; emitter?: string; publisher?: string; operationId?: string }
  | { provenance: 'recorded-claim' }
export type PrivateArtifactFile = Readonly<{
  path: string
  bytes: number
  state: 'text' | 'empty' | 'non-text' | 'unavailable'
  clipped: boolean
}>
export type PrivateArtifactCapture = Readonly<{
  generation: string
  sourcePublisher: string
  provenance: 'verified-delivery' | 'recorded-capture'
  phase: 'pending' | 'ready' | 'unavailable'
  files: readonly PrivateArtifactFile[]
}>
export type PrivateAttention = {
  readonly admissionId: number
  readonly admission: PrivateAdmission
  source: string
  text: string
  priority: number
  committed: boolean
  readonly bytes: number
  readonly color: boolean
}
export type PrivatePreview = { text: string; bytes: number; clipped: boolean }
const key = (publisher: string, id: string) => JSON.stringify([publisher, id])
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
  settledAt?: number | undefined
  recorded?: boolean | undefined
}
export type PrivateJournalEntry = {
  kind: 'flow' | 'host' | 'diagnostic'
  key: string
  source: string
  publisher?: string | undefined
  importance: NoticeSeverity | 'unknown'
  admission: PrivateAdmission
  text: string
  bytes: number
  sequence: number
  operationsPath?: readonly string[]
  clipped?: boolean
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

/** Host-owned admission, observation budgets and immutable capture correspondence. */
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
  #semanticGeneration = 0
  #semanticDepth = 0
  #semanticDirty = false
  #semanticListeners = new Set<(generation: number) => void>()
  #attentionSequence = 0
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
  #captureSequence = 0
  #capture: PrivateArtifactCapture = {
    generation: 'pending',
    sourcePublisher: 'root',
    provenance: 'verified-delivery',
    phase: 'pending',
    files: [],
  }
  #closed = false
  omissions = 0
  incomplete: string | undefined
  context = 'Running; application reports are provisional'
  onChange: () => void = () => {}

  get semanticGeneration(): number {
    return this.#semanticGeneration
  }
  subscribeSemantic(listener: (generation: number) => void): () => void {
    if (this.#closed) return () => {}
    this.#semanticListeners.add(listener)
    return () => {
      this.#semanticListeners.delete(listener)
    }
  }
  transaction<T>(mutation: () => T): T {
    this.#semanticDepth++
    try {
      return mutation()
    } finally {
      this.#semanticDepth--
      if (!this.#semanticDepth && this.#semanticDirty) {
        this.#semanticDirty = false
        const generation = ++this.#semanticGeneration
        for (const listener of this.#semanticListeners) listener(generation)
      }
    }
  }
  #semantic(): void {
    this.#semanticDirty = true
    if (!this.#semanticDepth) this.transaction(() => {})
  }
  setContext(text: string): void {
    if (text === this.context) return
    this.context = text
    this.#semantic()
    this.onChange()
  }
  setIncomplete(text: string | undefined): void {
    if (text === this.incomplete) return
    this.incomplete = text
    this.#semantic()
    this.onChange()
  }
  get artifactCapture(): PrivateArtifactCapture {
    return this.#capture
  }
  sourceParent(publisher: string): string | undefined {
    return this.#parents.get(publisher)
  }
  peekSourceLabel(publisher: string): string {
    if (this.workspace.recorded) return 'Recorded'
    if (publisher === 'root') return 'Flow'
    const parent = this.#parents.get(publisher),
      label = this.#publisherLabels.get(publisher)
    return parent === undefined
      ? `Flow (separate invocation${label ? ` ${label}` : ''})`
      : `Flow / ${this.calls.get(parent)?.slot ?? 'separate invocation'}${label ? ` (${label})` : ''}`
  }
  get stopped(): boolean {
    return this.#stopped
  }
  get attentionBytes(): number {
    return this.#attentionBytes
  }
  configureWorkspace(options: {
    target: string
    limitMs?: number
    startedAt?: number
    recorded?: boolean
  }): void {
    this.workspace = {
      ...this.workspace,
      ...options,
      startedAt: options.startedAt ?? privatePresentationNow(),
    }
    this.#semantic()
    this.onChange()
  }
  setWorkspaceFacts(facts: PrivateWorkspaceFacts): void {
    this.workspace.facts = facts
    this.#semantic()
    this.onChange()
  }
  setWorkspacePhase(phase: 'live' | 'settled'): void {
    if (phase === 'settled' && this.workspace.phase !== 'settled')
      this.workspace.settledAt = this.workspace.now ?? privatePresentationNow()
    this.workspace.phase = phase
    this.#semantic()
    this.onChange()
  }
  setHostStage(text: string, id = 'stage'): void {
    this.workspace.hostStage = text
    this.workspace.stageStartedAt = this.workspace.now ?? privatePresentationNow()
    this.addHostEntry(id, text)
  }
  addHostEntry(id: string, text: string, importance: NoticeSeverity = 'info'): boolean {
    return this.#journal(
      {
        kind: 'host',
        key: `host:${id}`,
        source: 'Jig',
        text,
        importance,
        admission: { provenance: this.workspace.recorded ? 'recorded-claim' : 'host-observed' },
      },
      Buffer.byteLength(privateUpdateText(text)),
      64,
      131072,
    )
  }
  addDiagnostic(
    text: string,
    operationsPath: readonly string[] = [],
    clipped = false,
    admission: PrivateAdmission = { provenance: 'host-observed' },
  ): boolean {
    const identity = JSON.stringify([admission, operationsPath])
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
        importance: 'unknown',
        admission,
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
        admission: { provenance: 'accepted-source', publisher },
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
      this.#semantic()
      this.onChange()
      return false
    }
    this.#journalBytes[entry.kind] += bytes - (old?.bytes ?? 0)
    const value = { ...entry, sequence: old?.sequence ?? ++this.#journalSequence, bytes }
    if (old) this.journal[this.journal.indexOf(old)] = value
    else this.journal.push(value)
    this.#semantic()
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
    if (this.workspace.recorded) return 'Recorded'
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
    this.transaction(() => this.#observeCall(event))
  }
  #observeCall(event: PrivateCallEvent): void {
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
    const intent = event.intent === undefined ? old?.intent : bound(event.intent, 1024)
    const cause = event.cause === undefined ? undefined : bound(event.cause, 4096)
    if (cause && (event.state === 'failed' || event.state === 'uncertain'))
      this.addAttention(this.sourceLabel(event.publisher), cause, 4, false, false, {
        provenance: 'host-observed',
        publisher: event.publisher,
        operationId: event.operationId,
      })
    const node: PrivateCallNode = {
      key: identity,
      publisher: event.publisher,
      operationId: event.operationId,
      slot: bound(event.slot, 128),
      state: event.state,
      time: event.time,
      firstObservedAt: old?.firstObservedAt ?? event.time,
      ...(parent === undefined ? {} : { parent }),
      ...(event.childPublisher === undefined && old?.childPublisher === undefined
        ? {}
        : { childPublisher: (event.childPublisher ?? old?.childPublisher)! }),
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
      this.#semantic()
      this.onChange()
      return
    }
    this.#callBytes += bytes - prior
    this.calls.set(identity, node)
    if (event.childPublisher !== undefined && this.#parents.size < 256)
      this.#parents.set(event.childPublisher, identity)
    this.#semantic()
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
      }
      this.#semantic()
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
    this.#semantic()
    this.onChange()
  }
  freeze(publisher: string, reason = 'Observation ended'): void {
    for (const [identity, activity] of this.activities)
      if (activity.publisher === publisher) this.activities.delete(identity)
    const source = this.#sources.get(publisher)
    if (!source || source.ended) {
      this.#semantic()
      this.onChange()
      return
    }
    source.ended = reason
    for (const view of source.views.values()) view.ended = reason
    this.#semantic()
    this.onChange()
  }
  stop(reason = 'Observation ended'): void {
    this.transaction(() => this.#stop(reason))
  }
  #stop(reason: string): void {
    if (this.#stopped) return
    for (const publisher of this.#sources.keys()) this.freeze(publisher, reason)
    this.activities.clear()
    this.#stopped = true
    this.#semantic()
    this.onChange()
  }
  activity(publisher: string, value: Extract<UserUpdate, { kind: 'activity' | 'clear' }>): void {
    if (this.#stopped) return
    if (value.kind === 'clear') this.activities.delete(key(publisher, value.id))
    else if (this.activities.has(key(publisher, value.id)) || this.activities.size < 16)
      this.activities.set(key(publisher, value.id), { publisher, value })
    this.#semantic()
    this.onChange()
  }
  addAttention(
    source: string,
    text: string,
    priority: number,
    committed = false,
    color = false,
    admission: PrivateAdmission = { provenance: 'host-observed' },
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
      this.#semantic()
      this.onChange()
      return false
    }
    if (removals.length) this.incomplete = 'Additional Flow reports unavailable'
    for (const index of removals) this.attention.splice(index, 1)
    this.#attentionBytes = retained + bytes
    this.attention.push({
      admissionId: ++this.#attentionSequence,
      admission,
      source,
      text,
      priority,
      committed,
      bytes,
      color,
    })
    this.#semantic()
    this.onChange()
    return true
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
    this.#semantic()
    this.onChange()
  }
  setArtifactCapture(capture: PrivateArtifactCapture): void {
    if (capture.files.length > 64 || !capture.generation || capture.generation.length > 256)
      throw new TypeError('Invalid immutable capture inventory')
    let bytes = 0
    const paths = new Set<string>()
    for (const file of capture.files) {
      const parts = file.path.split('/')
      if (
        !file.path ||
        Buffer.byteLength(file.path) > 512 ||
        parts.length > 16 ||
        parts.some((part) => !part || part === '.' || part === '..' || part === '.jig') ||
        /[\\\p{Cc}]/u.test(file.path) ||
        paths.has(file.path) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 0 ||
        !['text', 'empty', 'non-text', 'unavailable'].includes(file.state)
      )
        throw new TypeError('Invalid immutable capture inventory')
      paths.add(file.path)
      bytes += file.bytes
    }
    if (bytes > 16 * 1024 * 1024) throw new TypeError('Invalid immutable capture inventory')
    this.#capture = Object.freeze({
      ...capture,
      generation: `${++this.#captureSequence}:${capture.generation}`,
      files: Object.freeze(capture.files.map((file) => Object.freeze({ ...file }))),
    })
    this.#semantic()
    this.onChange()
  }
  /** Supplier access is confined to this immutable manifest generation. */
  async capturePreview(path: string, generation: string): Promise<PrivatePreview | undefined> {
    const capture = this.#capture
    if (
      this.#closed ||
      capture.generation !== generation ||
      capture.phase !== 'ready' ||
      !capture.files.some((file) => file.path === path && ['text', 'empty'].includes(file.state))
    )
      return undefined
    const preview = await this.#preview?.(path)
    return !this.#closed && this.#capture === capture ? preview : undefined
  }
  /** Called only by the explicit terminal inspector; web navigation is independent. */
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
      ? {
          available: true,
          label: `${this.workspace.recorded ? 'Captured recorded file' : 'Delivered file'}: ${ref.path}`,
          target: path,
        }
      : {
          available: false,
          label: this.workspace.recorded
            ? 'Artifact unavailable; not present in captured recorded files'
            : 'Artifact unavailable; not present in verified delivered files',
        }
  }
  commitAttention(reports: readonly PrivateAttention[]): void {
    let changed = false
    for (const report of reports) {
      if (!report.committed && this.attention.includes(report)) {
        report.committed = true
        changed = true
      }
    }
    if (changed) {
      this.#semantic()
      this.onChange()
    }
  }
  close(): void {
    this.#closed = true
    this.stop()
    this.#artifact = undefined
    this.#preview = undefined
    this.#semanticListeners.clear()
    this.onChange = () => {}
  }
}
