import type {
  Collection,
  DetailBlock,
  NoticeSeverity,
  UserUpdate,
  ViewItem,
} from '@jigging/user-updates'

type Immutable<T> = T extends readonly (infer Item)[]
  ? readonly Immutable<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: Immutable<T[Key]> }
    : T

export type DisplayCallState =
  | 'requested'
  | 'active'
  | 'cancel-requested'
  | 'returned'
  | 'failed'
  | 'uncertain'
export type RecordedViewRole = 'recorded-report' | 'recorded-files' | 'recorded-diagnostics'
export type DisplayFact = Readonly<{
  value: string
  provenance: 'host-observed' | 'application-reported' | 'recorded-claim'
  clipped?: boolean
}>
export type DisplayAttribution =
  | Readonly<{
      provenance: 'host-observed'
      sourceLabel: string
      sourceId?: string
      callId?: string
      relationshipIncomplete?: boolean
    }>
  | Readonly<{
      provenance: 'accepted-source'
      sourceId: string
      sourceLabel: string
      relation: 'root' | 'observed-call' | 'unavailable'
      callId?: string
      ancestryIncomplete: boolean
    }>
  | Readonly<{ provenance: 'recorded-claim'; sourceLabel: string }>
export type DisplayPreviewReply = Readonly<{
  artifactId: string
  captureGeneration: string
  provenance: 'verified-delivery' | 'recorded-capture'
  state: 'text' | 'empty' | 'non-text' | 'unavailable'
  text?: string
  bytes: number
  clipped: boolean
}>

/** Supplied observations and claims, without execution authority or viewer state. */
export type DisplaySnapshot = Immutable<{
  kind: 'snapshot'
  revision: number
  mode: 'live-run' | 'recorded-packet'
  rootSourceId: string
  workspace: {
    target: string
    phase: 'live' | 'settled'
    hostStage: string
    elapsedMs: number
    limitMs?: number
    facts?: {
      execution: DisplayFact
      application: DisplayFact
      cleanup: DisplayFact
      delivery: DisplayFact
      completeness?: DisplayFact
    }
  }
  context: string
  incomplete?: string
  omissions: { calls: number; journal: { flow: number; host: number; diagnostic: number } }
  views: {
    id: string
    hostRole?: RecordedViewRole
    sourceId: string
    sourceLabel: string
    updatedAt: number
    ended?: string
    value: ViewItem
  }[]
  calls: {
    id: string
    sourceId: string
    sourceLabel: string
    childSourceId?: string
    parentId?: string
    operationId: string
    slot: string
    intent?: string
    state: DisplayCallState
    firstObservedAt: number
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
    attribution: DisplayAttribution
    sequence: number
    importance: NoticeSeverity | 'unknown'
    text: string
    operationsPath?: string[]
    pathClipped?: boolean
    clipped?: boolean
  }[]
  attention: {
    id: string
    attribution: DisplayAttribution
    priority: number
    text: string
    transcriptCommitted: boolean
  }[]
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
      state: DisplayPreviewReply['state']
      clipped: boolean
    }[]
  }
}>
export type DisplayIncompleteSnapshot = Readonly<{
  kind: 'incomplete'
  revision: number
  lastCompleteRevision?: number
  mode: DisplaySnapshot['mode']
  rootSourceId: string
  reason: string
  workspace: DisplaySnapshot['workspace']
  context: string
  omissions: DisplaySnapshot['omissions']
  attention: DisplaySnapshot['attention']
  diagnostics: readonly (DisplaySnapshot['journal'][number] & { readonly kind: 'diagnostic' })[]
}>
export type DisplaySnapshotEnvelope = DisplaySnapshot | DisplayIncompleteSnapshot
export type WebAssets = Readonly<Record<string, Readonly<{ body: string; contentType: string }>>>

export const DISPLAY_SNAPSHOT_LIMIT = 8 * 1024 * 1024
export const DISPLAY_INCOMPLETE_LIMIT = 2 * 1024 * 1024

/** Portable selected content accepted by reference inspection, without viewer state. */
export type DisplayReferenceRecord = Immutable<{
  block?: DetailBlock | undefined
  row?: Collection['rows'][number] | undefined
  activity?: Extract<UserUpdate, { kind: 'activity' }> | undefined
}>
