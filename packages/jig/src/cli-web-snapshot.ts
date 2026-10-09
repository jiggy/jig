import { createHmac, randomBytes } from 'node:crypto'
import type { NoticeSeverity, UserUpdate, ViewItem } from '@jigging/user-updates'
import {
  type PrivateAdmission,
  type PrivateCallState,
  type PrivateRunModel,
  privateRecordReferences,
} from './cli-run-model.js'
import { privatePresentationNow } from './internal/root-run-timeout-policy.js'

/** Private display DTO. No execution authority or terminal navigation is exported. */
export type PrivateWebFact = {
  value: string
  provenance: 'host-observed' | 'application-reported' | 'recorded-claim'
  clipped?: boolean
}
export type PrivateWebAttribution =
  | {
      provenance: 'host-observed'
      sourceLabel: string
      sourceId?: string
      callId?: string
      relationshipIncomplete?: boolean
    }
  | {
      provenance: 'accepted-source'
      sourceId: string
      sourceLabel: string
      relation: 'root' | 'observed-call' | 'unavailable'
      callId?: string
      ancestryIncomplete: boolean
    }
  | { provenance: 'recorded-claim'; sourceLabel: string }
export type PrivateWebPreviewReply = {
  artifactId: string
  captureGeneration: string
  provenance: 'verified-delivery' | 'recorded-capture'
  state: 'text' | 'empty' | 'non-text' | 'unavailable'
  text?: string
  bytes: number
  clipped: boolean
}
export type PrivateWebSnapshot = {
  kind: 'snapshot'
  revision: number
  mode: 'live-run' | 'recorded-packet'
  workspace: {
    target: string
    phase: 'live' | 'settled'
    hostStage: string
    elapsedMs: number
    limitMs?: number
    facts?: {
      execution: PrivateWebFact
      application: PrivateWebFact
      cleanup: PrivateWebFact
      delivery: PrivateWebFact
    }
  }
  context: string
  incomplete?: string
  omissions: { calls: number; journal: { flow: number; host: number; diagnostic: number } }
  views: {
    id: string
    sourceId: string
    sourceLabel: string
    updatedAt: number
    ended?: string
    value: ViewItem
  }[]
  calls: {
    id: string
    sourceId: string
    childSourceId?: string
    parentId?: string
    operationId: string
    slot: string
    intent?: string
    state: PrivateCallState
    observedAt: number
    cause?: string
  }[]
  activities: {
    id: string
    sourceId: string
    sourceLabel: string
    value: Extract<UserUpdate, { kind: 'activity' }>
  }[]
  journal: {
    id: string
    kind: 'flow' | 'host' | 'diagnostic'
    attribution: PrivateWebAttribution
    sequence: number
    importance: NoticeSeverity | 'unknown'
    text: string
    operationsPath?: string[]
    pathClipped?: boolean
    clipped?: boolean
  }[]
  attention: { id: string; attribution: PrivateWebAttribution; priority: number; text: string }[]
  artifacts: {
    generation: string
    sourceId: string
    permittedAttachments: string[]
    provenance: 'verified-delivery' | 'recorded-capture'
    phase: 'pending' | 'ready' | 'unavailable'
    files: {
      id: string
      path: string
      bytes: number
      state: PrivateWebPreviewReply['state']
      clipped: boolean
    }[]
  }
}
export type PrivateWebIncompleteSnapshot = {
  kind: 'incomplete'
  revision: number
  lastCompleteRevision?: number
  mode: PrivateWebSnapshot['mode']
  reason: string
  workspace: PrivateWebSnapshot['workspace']
  context: string
  omissions: PrivateWebSnapshot['omissions']
  attention: PrivateWebSnapshot['attention']
  diagnostics: (PrivateWebSnapshot['journal'][number] & { kind: 'diagnostic' })[]
}
export type PrivateWebSnapshotEnvelope = PrivateWebSnapshot | PrivateWebIncompleteSnapshot

export const PRIVATE_WEB_SNAPSHOT_LIMIT = 8 * 1024 * 1024
export const PRIVATE_WEB_INCOMPLETE_LIMIT = 2 * 1024 * 1024
const encoded = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
function bounded(value: string, maximum: number): { value: string; clipped?: true } {
  let text = '',
    count = 0
  for (const scalar of value) {
    if (++count > maximum)
      return {
        value: [...text].slice(0, Math.max(0, maximum - 10)).join('') + ' [clipped]',
        clipped: true,
      }
    text += scalar
  }
  return { value: text }
}
function allowance(value: unknown, maximum: number): void {
  if (encoded(value) > maximum) throw new Error('Snapshot projection allowance exceeded')
}

/** Correspondence keys are command-private and never encode authority or raw publishers. */
export class PrivateWebProjection {
  readonly #identityKey: Buffer
  #previewBusy = false
  constructor(
    readonly model: PrivateRunModel,
    identityKey: Uint8Array = randomBytes(32),
  ) {
    if (identityKey.byteLength !== 32)
      throw new TypeError('A 32-byte display identity key is required')
    this.#identityKey = Buffer.from(identityKey)
  }
  #id(type: string, ...fields: string[]): string {
    return createHmac('sha256', this.#identityKey)
      .update(JSON.stringify(['jig-private-web-r2', type, ...fields]))
      .digest('hex')
  }
  #source(publisher: string): string {
    return this.#id('source', publisher)
  }
  #call(identity: string): string {
    return this.#id('call', identity)
  }
  #attribution(admission: PrivateAdmission, label: string): PrivateWebAttribution {
    const sourceLabel = bounded(label, 256).value
    if (admission.provenance === 'recorded-claim' || this.model.workspace.recorded)
      return { provenance: 'recorded-claim', sourceLabel }
    const own =
      admission.operationId === undefined || admission.publisher === undefined
        ? undefined
        : this.model.calls.get(JSON.stringify([admission.publisher, admission.operationId]))
    if (admission.provenance === 'host-observed')
      return {
        provenance: 'host-observed',
        sourceLabel,
        ...(admission.emitter ? { sourceId: this.#source(admission.emitter) } : {}),
        ...(own ? { callId: this.#call(own.key) } : {}),
        ...(admission.operationId !== undefined && !own ? { relationshipIncomplete: true } : {}),
      }
    const parent = this.model.sourceParent(admission.publisher)
    const call =
      admission.operationId === undefined
        ? parent === undefined
          ? undefined
          : this.model.calls.get(parent)
        : own
    let ancestryIncomplete =
      call === undefined && (admission.publisher !== 'root' || admission.operationId !== undefined)
    let ancestor = call?.parent,
      depth = 0
    while (ancestor && depth++ < 32) {
      const node = this.model.calls.get(ancestor)
      if (!node) {
        ancestryIncomplete = true
        break
      }
      ancestor = node.parent
    }
    if (ancestor) ancestryIncomplete = true
    return {
      provenance: 'accepted-source',
      sourceId: this.#source(admission.publisher),
      sourceLabel,
      relation:
        admission.publisher === 'root' && admission.operationId === undefined
          ? 'root'
          : call
            ? 'observed-call'
            : 'unavailable',
      ...(call ? { callId: this.#call(call.key) } : {}),
      ancestryIncomplete,
    }
  }
  #workspace(): PrivateWebSnapshot['workspace'] {
    const w = this.model.workspace,
      recorded = !!w.recorded
    const fact = (value: string, application = false): PrivateWebFact => ({
      ...bounded(value, 1024),
      provenance: recorded
        ? 'recorded-claim'
        : application
          ? 'application-reported'
          : 'host-observed',
    })
    const time = w.settledAt ?? w.now ?? privatePresentationNow()
    return {
      target: bounded(w.target, 1024).value,
      phase: w.phase,
      hostStage: bounded(w.hostStage, 1024).value,
      elapsedMs: Math.max(0, Number.isFinite(time - w.startedAt) ? time - w.startedAt : 0),
      ...(w.limitMs === undefined ? {} : { limitMs: w.limitMs }),
      ...(w.facts
        ? {
            facts: {
              execution: fact(w.facts.execution),
              application: fact(w.facts.application, true),
              cleanup: fact(w.facts.cleanup),
              delivery: fact(w.facts.delivery),
            },
          }
        : {}),
    }
  }
  #attention(): PrivateWebSnapshot['attention'] {
    return this.model.attention.map((report) => ({
      id: this.#id('attention', JSON.stringify(report.admission), String(report.admissionId)),
      attribution: this.#attribution(report.admission, report.source),
      priority: report.priority,
      text: report.text,
    }))
  }
  #journal(
    entries = this.model.journal,
    pathAllowance = 1024 * 1024,
  ): PrivateWebSnapshot['journal'] {
    let pathBytes = 0
    return entries.map((entry) => {
      let operationsPath: string[] | undefined,
        pathClipped = false
      if (entry.operationsPath) {
        operationsPath = []
        pathClipped = entry.operationsPath.length > 32
        for (const part of entry.operationsPath.slice(0, 32)) {
          const segment = bounded(part, 128)
          const size = encoded(segment.value) + 1
          if (pathBytes + size > pathAllowance) {
            pathClipped = true
            break
          }
          pathBytes += size
          operationsPath.push(segment.value)
          pathClipped ||= !!segment.clipped
        }
      }
      return {
        id: this.#id('journal', entry.kind, String(entry.sequence)),
        kind: entry.kind,
        attribution: this.#attribution(entry.admission, entry.source),
        sequence: entry.sequence,
        importance: entry.importance,
        text: entry.text,
        ...(operationsPath === undefined ? {} : { operationsPath }),
        ...(pathClipped ? { pathClipped: true } : {}),
        ...(entry.clipped ? { clipped: true } : {}),
      }
    })
  }
  #omissions(): PrivateWebSnapshot['omissions'] {
    return { calls: this.model.omissions, journal: { ...this.model.journalOmitted } }
  }
  #artifactId(generation: string, path: string): string {
    // A host inventory has no authored namespace. This explicit domain sentinel
    // cannot collide with source-scoped references or another capture generation.
    return this.#id('artifact-inventory', generation, 'host-inventory', path)
  }
  #artifacts(): PrivateWebSnapshot['artifacts'] {
    const capture = this.model.artifactCapture,
      attachments = new Set<string>()
    for (const view of this.model.views.values()) {
      if (view.publisher !== capture.sourcePublisher) continue
      for (const section of view.value.sections)
        for (const block of section.blocks) {
          const entries =
            block.kind === 'collection'
              ? block.rows.map((row) => ({
                  kind: 'row' as const,
                  key: row.id,
                  signature: '',
                  row,
                  collection: block,
                }))
              : [{ kind: block.kind, key: '', signature: '', block }]
          for (const entry of entries)
            for (const ref of privateRecordReferences(entry)) {
              if (ref.kind === 'artifact' && this.model.resolve(view.publisher, ref).available)
                attachments.add(ref.attachment)
            }
        }
    }
    const permittedAttachments = [...attachments]
    allowance(permittedAttachments, 512 * 1024)
    return {
      generation: this.#id('capture', capture.generation),
      sourceId: this.#source(capture.sourcePublisher),
      permittedAttachments,
      provenance: capture.provenance,
      phase: capture.phase,
      files: capture.files.map((file) => ({
        id: this.#artifactId(capture.generation, file.path),
        path: file.path,
        bytes: file.bytes,
        state: file.state,
        clipped: file.clipped,
      })),
    }
  }
  capture(revision: number): PrivateWebSnapshot {
    const model = this.model
    const views = [...model.views.values()].map((view) => ({
      id: this.#id('view', view.publisher, view.value.id),
      sourceId: this.#source(view.publisher),
      sourceLabel: bounded(model.peekSourceLabel(view.publisher), 256).value,
      updatedAt: view.updated,
      ...(view.ended === undefined ? {} : { ended: bounded(view.ended, 1024).value }),
      value: view.value,
    }))
    const calls = [...model.calls.values()].map((call) => ({
      id: this.#call(call.key),
      sourceId: this.#source(call.publisher),
      ...(call.childPublisher === undefined
        ? {}
        : { childSourceId: this.#source(call.childPublisher) }),
      ...(call.parent === undefined || !model.calls.has(call.parent)
        ? {}
        : { parentId: this.#call(call.parent) }),
      operationId: call.operationId,
      slot: call.slot,
      state: call.state,
      observedAt: call.time,
      ...(call.intent === undefined ? {} : { intent: call.intent }),
      ...(call.cause === undefined ? {} : { cause: call.cause }),
    }))
    const activities = [...model.activities.values()].map((activity) => ({
      id: this.#id('activity', activity.publisher, activity.value.id),
      sourceId: this.#source(activity.publisher),
      sourceLabel: bounded(model.peekSourceLabel(activity.publisher), 256).value,
      value: activity.value,
    }))
    const journal = this.#journal(),
      attention = this.#attention(),
      artifacts = this.#artifacts()
    allowance(
      views.map((view) => view.value),
      512 * 1024,
    )
    allowance(calls, 512 * 1024)
    allowance(activities, 768 * 1024)
    allowance(
      journal.filter((entry) => entry.kind === 'flow'),
      1024 * 1024,
    )
    allowance(
      journal
        .filter((entry) => entry.kind !== 'flow')
        .map(({ operationsPath: _path, ...entry }) => entry),
      512 * 1024,
    )
    allowance(attention, 1280 * 1024)
    const result: PrivateWebSnapshot = {
      kind: 'snapshot',
      revision,
      mode: model.workspace.recorded ? 'recorded-packet' : 'live-run',
      workspace: this.#workspace(),
      context: bounded(model.context, 2048).value,
      ...(model.incomplete === undefined
        ? {}
        : { incomplete: bounded(model.incomplete, 1024).value }),
      omissions: this.#omissions(),
      views,
      calls,
      activities,
      journal,
      attention,
      artifacts,
    }
    allowance(
      {
        workspace: result.workspace,
        artifacts: { ...artifacts, permittedAttachments: [] },
        context: result.context,
        omissions: result.omissions,
      },
      256 * 1024,
    )
    return result
  }
  /** Independent reserve path: no failed body, arbitrary exception, or stale DTO input. */
  incomplete(
    revision: number,
    reason = 'Current observation could not be fully projected',
    lastCompleteRevision?: number,
  ): PrivateWebIncompleteSnapshot {
    const attention = this.#attention()
    const diagnostics = this.#journal(
      this.model.journal.filter((entry) => entry.kind === 'diagnostic'),
      120 * 1024,
    ).map((entry) => ({ ...entry, kind: 'diagnostic' as const }))
    allowance(attention, 1280 * 1024)
    allowance(
      diagnostics.map(({ operationsPath: _path, ...entry }) => entry),
      448 * 1024,
    )
    const result: PrivateWebIncompleteSnapshot = {
      kind: 'incomplete',
      revision,
      ...(lastCompleteRevision === undefined ? {} : { lastCompleteRevision }),
      mode: this.model.workspace.recorded ? 'recorded-packet' : 'live-run',
      reason: bounded(reason, 1024).value,
      workspace: this.#workspace(),
      context: bounded(this.model.context, 2048).value,
      omissions: this.#omissions(),
      attention,
      diagnostics,
    }
    allowance(
      {
        workspace: result.workspace,
        context: result.context,
        reason: result.reason,
        omissions: result.omissions,
      },
      128 * 1024,
    )
    return result
  }
  async preview(artifactId: string): Promise<PrivateWebPreviewReply | undefined> {
    if (!/^[0-9a-f]{64}$/.test(artifactId) || this.#previewBusy) return undefined
    const capture = this.model.artifactCapture
    const file = capture.files.find(
      (file) => this.#artifactId(capture.generation, file.path) === artifactId,
    )
    if (!file) return undefined
    const base: PrivateWebPreviewReply = {
      artifactId,
      captureGeneration: this.#id('capture', capture.generation),
      provenance: capture.provenance,
      state: capture.phase === 'ready' ? file.state : 'unavailable',
      bytes: file.bytes,
      clipped: file.clipped,
    }
    if (!['text', 'empty'].includes(base.state)) return base
    this.#previewBusy = true
    try {
      const preview = await this.model.capturePreview(file.path, capture.generation)
      if (this.model.artifactCapture !== capture) return undefined
      if (!preview || Buffer.byteLength(preview.text) > 65536)
        return { ...base, state: 'unavailable' }
      return {
        ...base,
        state: preview.text ? 'text' : 'empty',
        text: preview.text,
        clipped: preview.clipped,
      }
    } catch {
      return this.model.artifactCapture === capture ? { ...base, state: 'unavailable' } : undefined
    } finally {
      this.#previewBusy = false
    }
  }
}
