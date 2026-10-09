import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import type {
  DisplaySnapshot,
  DisplaySnapshotEnvelope,
  RecordedViewRole,
} from '@jigging/display-model'
import { recordReferences } from '@jigging/display-model'
import type { Reference, ViewItem, UserUpdate, NoticeSeverity } from '@jigging/user-updates'
import { validateUserUpdate } from '@jigging/user-updates'
import { ViewerModel } from '../src/viewer-model.js'
import { ViewerInput } from '../src/input.js'
import { NativeRenderer } from '../src/native.js'
import type { TuiTheme } from '../src/types.js'

type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T
export function snapshot(): Mutable<DisplaySnapshot> {
  return {
    kind: 'snapshot',
    revision: 1,
    mode: 'live-run',
    rootSourceId: 'root',
    workspace: { target: 'Run', phase: 'live', hostStage: 'Waiting', elapsedMs: 0 },
    context: 'Running; application reports are provisional',
    omissions: { calls: 0, journal: { flow: 0, host: 0, diagnostic: 0 } },
    views: [],
    calls: [],
    activities: [],
    journal: [],
    attention: [],
    artifacts: {
      generation: 'fixture-capture',
      sourceId: 'root',
      provenance: 'verified-delivery',
      phase: 'ready',
      files: [],
      permittedAttachments: [],
    },
  }
}
const key = (source: string, id: string): string => JSON.stringify([source, id])
const artifactId = (generation: string, path: string): string =>
  createHash('sha256')
    .update(JSON.stringify([generation, path]))
    .digest('hex')

/** Wait for an observable fixture result rather than assuming one promise turn. */
export async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('The fixture operation did not settle within 100 bounded turns')
}

/** Test data authoring only. It neither checks admission nor copies host budgets. */
export class FixtureModel extends ViewerModel {
  fixture: Mutable<DisplaySnapshot>
  #clockStart = 0
  #preview:
    | ((path: string) => Promise<{ text: string; bytes: number; clipped: boolean } | undefined>)
    | undefined
  #resolve:
    | ((publisher: string, ref: Extract<Reference, { kind: 'artifact' }>) => string | undefined)
    | undefined
  #previewPaths = new Map<string, string>()
  constructor(theme: TuiTheme = 'one-dark') {
    const value = snapshot()
    super(value, {
      theme,
      preview: async ({ artifactId: id, captureGeneration }) => {
        const file = this.fixture.artifacts.files.find((file) => file.id === id)
        const content =
          file && (await this.#preview?.(this.#previewPaths.get(file.id) ?? file.path))
        return content
          ? {
              artifactId: id,
              captureGeneration,
              provenance: this.fixture.artifacts.provenance,
              state: content.text ? 'text' : 'empty',
              ...content,
            }
          : undefined
      },
    })
    this.fixture = value
  }
  #commit(): void {
    this.fixture.revision++
    super.update(this.fixture)
  }
  acceptView(
    sourceId: string,
    value: ViewItem | Extract<UserUpdate, { kind: 'retire-view' }>,
  ): void {
    const id = key(sourceId, value.id)
    const old = this.fixture.views.findIndex((view) => view.id === id)
    if (value.kind === 'retire-view') {
      if (old >= 0) this.fixture.views.splice(old, 1)
    } else {
      const role =
        this.fixture.mode === 'recorded-packet' && sourceId === 'saved-result'
          ? (
              {
                'recorded-result': 'recorded-report',
                files: 'recorded-files',
                diagnostics: 'recorded-diagnostics',
              } as Record<string, RecordedViewRole>
            )[value.id]
          : undefined
      const next = {
        id,
        sourceId,
        sourceLabel: this.#label(sourceId),
        updatedAt: 100,
        value: validateUserUpdate(JSON.parse(JSON.stringify(value))) as ViewItem,
        ...(role === undefined ? {} : { hostRole: role }),
      }
      if (old >= 0) this.fixture.views[old] = next
      else this.fixture.views.push(next)
    }
    this.#references()
    this.#commit()
  }
  #label(sourceId: string): string {
    if (this.fixture.mode === 'recorded-packet') return 'Recorded'
    if (sourceId === 'root') return 'Flow'
    const parent = this.fixture.calls.find((call) => call.childSourceId === sourceId)
    return parent ? `Flow / ${parent.slot}` : `Flow (separate invocation ${sourceId})`
  }
  observeCall(event: {
    publisher: string
    operationId: string
    slot: string
    state: DisplaySnapshot['calls'][number]['state']
    time: number
    childPublisher?: string
    intent?: string
    cause?: string
  }): void {
    const id = key(event.publisher, event.operationId)
    const old = this.fixture.calls.find((call) => call.id === id)
    const parent = this.fixture.calls.find((call) => call.childSourceId === event.publisher)
    const index = this.fixture.calls.findIndex((call) => call.id === id)
    const next = {
      id,
      sourceId: event.publisher,
      sourceLabel: this.#label(event.publisher),
      operationId: event.operationId,
      slot: event.slot,
      state: event.state,
      firstObservedAt: old?.firstObservedAt ?? event.time,
      observedAt: event.time,
      ...(parent ? { parentId: parent.id } : {}),
      ...((event.childPublisher ?? old?.childSourceId)
        ? { childSourceId: event.childPublisher ?? old?.childSourceId }
        : {}),
      ...((event.intent ?? old?.intent) === undefined
        ? {}
        : { intent: event.intent ?? old?.intent }),
      ...((event.cause ?? old?.cause) === undefined ? {} : { cause: event.cause ?? old?.cause }),
    }
    if (index >= 0) this.fixture.calls[index] = next
    else this.fixture.calls.push(next)
    if (event.cause) this.addAttention(this.#label(event.publisher), event.cause, 4)
    this.#commit()
  }
  configureWorkspace(options: {
    target?: string
    limitMs?: number
    startedAt?: number
    recorded?: boolean
  }): void {
    if (options.startedAt !== undefined) this.#clockStart = options.startedAt
    if (options.target !== undefined) this.fixture.workspace.target = options.target
    if (options.limitMs !== undefined) this.fixture.workspace.limitMs = options.limitMs
    if (options.recorded) {
      this.fixture.mode = 'recorded-packet'
      this.fixture.rootSourceId = 'saved-result'
      this.fixture.artifacts.sourceId = 'saved-result'
      this.fixture.artifacts.provenance = 'recorded-capture'
    }
    this.#commit()
  }
  setNow(now: number): void {
    if (this.fixture.workspace.phase !== 'settled')
      this.fixture.workspace.elapsedMs = now - this.#clockStart
    this.#commit()
  }
  setWorkspaceFacts(facts: {
    execution: string
    application: string
    cleanup: string
    delivery: string
    completeness?: string
  }): void {
    const provenance =
      this.fixture.mode === 'recorded-packet'
        ? ('recorded-claim' as const)
        : ('host-observed' as const)
    this.fixture.workspace.facts = {
      execution: { value: facts.execution, provenance },
      application: {
        value: facts.application,
        provenance: provenance === 'recorded-claim' ? provenance : 'application-reported',
      },
      cleanup: { value: facts.cleanup, provenance },
      delivery: { value: facts.delivery, provenance },
      ...(facts.completeness === undefined
        ? {}
        : { completeness: { value: facts.completeness, provenance } }),
    }
    this.#commit()
  }
  setWorkspacePhase(phase: 'live' | 'settled'): void {
    this.fixture.workspace.phase = phase
    this.#commit()
  }
  setHostStage(text: string): void {
    this.fixture.workspace.hostStage = text
    this.addHostEntry('stage', text)
  }
  setContext(text: string): void {
    this.fixture.context = text
    this.#commit()
  }
  setIncomplete(text: string): void {
    this.fixture.incomplete = text
    this.#commit()
  }
  freeze(sourceId: string, reason = 'Observation ended'): void {
    for (const view of this.fixture.views) if (view.sourceId === sourceId) view.ended = reason
    this.fixture.activities = this.fixture.activities.filter(
      (activity) => activity.sourceId !== sourceId,
    )
    this.#commit()
  }
  stop(reason = 'Observation ended'): void {
    for (const view of this.fixture.views) view.ended = reason
    this.fixture.activities = []
    this.#commit()
  }
  addHostEntry(id: string, text: string, importance: NoticeSeverity = 'info'): void {
    this.fixture.journal.push({
      id: `host:${id}`,
      kind: 'host',
      attribution: { provenance: 'host-observed', sourceLabel: 'Jig' },
      importance,
      text,
      sequence: this.fixture.journal.length + 1,
    })
    this.#commit()
  }
  acceptNotice(
    sourceId: string,
    importance: NoticeSeverity,
    text: string,
    _payloadBytes?: number,
  ): void {
    this.fixture.journal.push({
      id: `notice:${this.fixture.journal.length}`,
      kind: 'flow',
      attribution: {
        provenance: 'accepted-source',
        sourceId,
        sourceLabel: this.#label(sourceId),
        relation: 'root',
        ancestryIncomplete: false,
      },
      importance,
      text,
      sequence: this.fixture.journal.length + 1,
    })
    this.#commit()
  }
  addDiagnostic(text: string, operationsPath: readonly string[] = [], clipped = false): void {
    this.fixture.journal.push({
      id: `diagnostic:${this.fixture.journal.length}`,
      kind: 'diagnostic',
      attribution: { provenance: 'host-observed', sourceLabel: 'Diagnostic' },
      importance: 'unknown',
      text,
      operationsPath: [...operationsPath],
      clipped,
      sequence: this.fixture.journal.length + 1,
    })
    this.#commit()
  }
  omitCalls(count: number): void {
    this.fixture.omissions.calls = count
    this.#commit()
  }
  omitDiagnostics(count: number): void {
    this.fixture.omissions.journal.diagnostic = count
    this.#commit()
  }
  addAttention(source: string, text: string, priority: number, committed = false): true {
    this.fixture.attention.push({
      id: `attention:${this.fixture.attention.length}`,
      attribution: { provenance: 'host-observed', sourceLabel: source },
      text,
      priority,
      transcriptCommitted: committed,
    })
    this.#commit()
    return true
  }
  activity(sourceId: string, value: Extract<UserUpdate, { kind: 'activity' | 'clear' }>): void {
    this.fixture.activities = this.fixture.activities.filter(
      (activity) => activity.id !== key(sourceId, value.id),
    )
    if (value.kind === 'activity')
      this.fixture.activities.push({
        id: key(sourceId, value.id),
        sourceId,
        sourceLabel: this.#label(sourceId),
        value,
      })
    this.#commit()
  }
  setArtifacts(
    resolve: (
      publisher: string,
      ref: Extract<Reference, { kind: 'artifact' }>,
    ) => string | undefined,
    preview: (
      path: string,
    ) => Promise<{ text: string; bytes: number; clipped: boolean } | undefined>,
  ): void {
    this.#resolve = resolve
    this.#preview = preview
    this.#references()
    this.#commit()
  }
  #references(): void {
    if (!this.#resolve) return
    for (const view of this.fixture.views)
      for (const section of view.value.sections)
        for (const block of section.blocks) {
          const records =
            block.kind === 'collection' ? block.rows.map((row) => ({ row })) : [{ block }]
          for (const record of records)
            for (const ref of recordReferences(record))
              if (ref.kind === 'artifact') this.#fileForReference(view.sourceId, ref)
        }
  }
  #fileForReference(publisher: string, ref: Extract<Reference, { kind: 'artifact' }>): void {
    const resolved = this.#resolve?.(publisher, ref)
    if (!resolved) return
    this.fixture.artifacts.sourceId = publisher
    if (!this.fixture.artifacts.permittedAttachments.includes(ref.attachment))
      this.fixture.artifacts.permittedAttachments.push(ref.attachment)
    const id = artifactId(this.fixture.artifacts.generation, ref.path)
    // One capture inventory identity always names the same retained bytes.
    if (!this.#previewPaths.has(id)) this.#previewPaths.set(id, resolved)
    if (!this.fixture.artifacts.files.some((file) => file.path === ref.path))
      this.fixture.artifacts.files.push({
        id,
        path: ref.path,
        bytes: 0,
        state: 'text',
        clipped: false,
      })
  }
  provideArtifact(publisher: string, ref: Extract<Reference, { kind: 'artifact' }>): void {
    this.#fileForReference(publisher, ref)
    this.#commit()
  }
  setArtifactCapture(capture: {
    generation: string
    sourcePublisher: string
    provenance: 'verified-delivery' | 'recorded-capture'
    phase: 'pending' | 'ready' | 'unavailable'
    files: {
      path: string
      bytes: number
      state: 'text' | 'empty' | 'non-text' | 'unavailable'
      clipped: boolean
    }[]
  }): void {
    this.fixture.artifacts = {
      ...this.fixture.artifacts,
      generation: capture.generation,
      sourceId: capture.sourcePublisher,
      provenance: capture.provenance,
      phase: capture.phase,
      files: capture.files.map((file) => ({
        id: artifactId(capture.generation, file.path),
        ...file,
      })),
    }
    this.#references()
    this.#commit()
  }
}

/** Fake test stream only feeds owned bytes; production input never sees a stream. */
export class FixtureKeyboard extends ViewerInput {
  readonly #data = (bytes: Uint8Array) => this.input(bytes)
  readonly #end = () => this.leave()
  constructor(
    model: FixtureModel,
    change: () => void,
    cancel: () => void,
    readonly stream: EventEmitter,
    onLeave: () => void = () => {},
    allowed: () => boolean = () => true,
  ) {
    super(
      model,
      change,
      (action) => {
        if (action === 'interrupt') cancel()
        onLeave()
      },
      allowed,
    )
  }
  start(): void {
    this.stream.on('data', this.#data)
    this.stream.on('end', this.#end)
  }
  markSettled(): void {
    ;(this.model as FixtureModel).setWorkspacePhase('settled')
  }
  override dispose(): void {
    this.stream.off('data', this.#data)
    this.stream.off('end', this.#end)
    super.dispose()
  }
}
export async function prepareNative() {
  const core = await import('@opentui/core')
  const buffer = core.OptimizedBuffer.create(1, 1, 'unicode')
  buffer.destroy()
  return core
}
export { NativeRenderer }
