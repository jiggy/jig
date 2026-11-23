import type {
  Collection,
  DetailBlock,
  NoticeSeverity,
  ReportingMessage,
  ViewItem,
} from '@jigging/reporting'

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
export type DisplayCompositionResourceKind =
  | 'http-request'
  | 'project-command'
  | 'project-evaluation'
  | 'finite-acp'
  | 'run-checkpoint'
  | 'child-checkpoint'
export type DisplayCompositionNode = Readonly<
  { id: string; label: string } & (
    | { kind: 'flow' | 'binding' }
    | { kind: 'resource'; resourceKind: DisplayCompositionResourceKind }
  )
>
export type DisplayCompositionEdge = Readonly<{
  id: string
  source: string
  target: string
  slot: string
}>
/** Representative source paths through a component's admitted implementation. */
export type DisplaySourceBehavior = Readonly<{
  nodeId: string
  cases: readonly Readonly<{
    result: string
    calls: readonly string[]
    effects: readonly string[]
    checks: readonly string[]
  }>[]
  gaps: readonly string[]
  omitted: number
}>
/** Complete admitted configuration for a selected target, without execution guarantees. */
export type DisplayComposition = Immutable<
  | {
      state: 'available'
      provenance: 'admitted'
      rootId: string
      nodes: DisplayCompositionNode[]
      edges: DisplayCompositionEdge[]
      sourceBehavior?: DisplaySourceBehavior[]
    }
  | { state: 'unavailable'; reason: 'limit' | 'unavailable' }
>
/** Inert JSON supplied for contract assistance or an explicit Run request. */
export type DisplayJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly DisplayJsonValue[]
  | { readonly [key: string]: DisplayJsonValue }

export type DisplayProjectInput =
  | Readonly<{ state: 'unconstrained' }>
  | Readonly<{
      state: 'schema'
      schema: boolean | { readonly [key: string]: DisplayJsonValue }
      /** Root invocation-contract definitions retain their original $ref scope. */
      definitions?: { readonly [key: string]: DisplayJsonValue }
    }>
export type DisplayProjectTarget = Readonly<{
  id: string
  label: string
  kind: 'flow' | 'binding'
  description?: string
  availability: 'ready' | 'unavailable'
  reason?: string
}>
export type DisplayProjectSelection = Readonly<{
  targetId: string
  composition: DisplayComposition
  input: DisplayProjectInput
  attachments: readonly Readonly<{
    name: string
    mode: 'read' | 'read-write'
    bound: boolean
  }>[]
  /** Outgoing channels the local host can receive for the selected root. */
  receives: readonly Readonly<{ name: string; required: boolean }>[]
  launch: Readonly<{ state: 'available' }> | Readonly<{ state: 'unavailable'; reason: string }>
}>
/** Approved project meaning before execution, never a fabricated Run snapshot. */
export type DisplayProjectSnapshot = Readonly<{
  kind: 'project'
  revision: string
  state: 'unreviewed' | 'approved'
  targets: readonly DisplayProjectTarget[]
  selected?: DisplayProjectSelection
}>
/** Intent sent to a separately authorized local host; these values grant no powers. */
export type DisplayProjectRunRequest = Readonly<{
  requestId: string
  revision: string
  targetId: string
  input: DisplayJsonValue
}>
export type DisplayProjectRunEvidence = Readonly<{
  execution: string
  outcome: string
  progress?: Readonly<{ completed: number; total?: number }>
  calls: readonly Readonly<{
    /** One-based index of the retained parent call, when present. */
    parent?: number
    caller?: string
    slot: string
    target?: string
    state: DisplayCallState
    outcome?: string
  }>[]
  callCoverage: 'complete' | 'incomplete' | 'unavailable'
  /** Known observations lost in recording or settlement. */
  callsOmitted: number
  /** All placeable paths withheld when the retained tree exceeded the settlement allowance. */
  callPathsOmitted?: number
  delivery: string
  files?: Readonly<{ total: number; paths: readonly string[] }>
}>
export type DisplayProjectRunComparison = Readonly<{
  revision: string
  inputId: string
  label: string
  root: string
  evidence: DisplayProjectRunEvidence
}>
export type DisplayProjectRun =
  | Readonly<{ state: 'idle' }>
  | Readonly<{ state: 'starting'; requestId: string; targetId: string }>
  | Readonly<{
      state: 'running' | 'settled'
      requestId: string
      targetId: string
      viewerUrl?: string
      comparison?: DisplayProjectRunComparison
    }>
  | Readonly<{
      state: 'refused' | 'uncertain'
      requestId: string
      targetId: string
      reason: string
    }>
/** Inert, bounded claims from two explicitly selected saved result packets. */
export type DisplayRecordedRun = Readonly<{
  runId?: string
  revision?: string
  root?: string
  status: 'succeeded' | 'failed' | 'lost'
  outcome?: string
  filesComplete: boolean
  invalidCalls: boolean
  callCoverage: DisplayProjectRunEvidence['callCoverage']
  callsOmitted: number
  callsRecorded: number
  callsUnplaced: number
}>
type DisplayComparedCallVariant = Readonly<{
  target: string
  state: DisplayCallState
  outcome?: string
  count: number
}>
export type DisplayCallPathComparison = Readonly<{
  root: string
  caller: string
  slot: string
  ancestors: readonly Readonly<{ slot: string; target: string }>[]
  earlier: readonly DisplayComparedCallVariant[]
  later: readonly DisplayComparedCallVariant[]
  matches: boolean
}>
export type DisplayRecordedComparison = Readonly<{
  earlier: DisplayRecordedRun
  later: DisplayRecordedRun
  submittedIdentity: 'same' | 'different' | 'unknown'
  rows: readonly DisplayCallPathComparison[]
  rowsOmitted: number
  nonmatchingOmitted: number
}>
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
export type DisplayImagePreview = Readonly<{
  mime: 'image/png' | 'image/jpeg'
  width: number
  height: number
  base64: string
}>
export type DisplayPreviewReply = Readonly<{
  artifactId: string
  captureGeneration: string
  provenance: 'verified-delivery' | 'recorded-capture' | 'captured-input'
  state: 'text' | 'empty' | 'image' | 'non-text' | 'unavailable'
  text?: string
  image?: DisplayImagePreview
  bytes: number
  clipped: boolean
}>

/** Supplied observations and claims, without execution authority or viewer state. */
export type DisplaySnapshot = Immutable<{
  kind: 'snapshot'
  revision: number
  mode: 'live-run' | 'recorded-packet' | 'retained-views'
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
  recordedComparison?: DisplayRecordedComparison
  incomplete?: string
  omissions: { calls: number; journal: { flow: number; host: number; diagnostic: number } }
  composition?: DisplayComposition
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
    /** Admitted application outcome carried by a returned call. */
    outcome?: string
  }[]
  activities: {
    id: string
    sourceId: string
    sourceLabel: string
    value: Extract<ReportingMessage, { kind: 'activity' }>
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
  inputs?: DisplayInputCapture
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
      sourceId?: string
      attachment?: string
      downloadable?: boolean
      bindings?: { sourceId: string; attachment: string; path: string }[]
    }[]
  }
}>
export type DisplayInputCapture = Readonly<{
  generation: string
  sourceId: string
  permittedAttachments: readonly string[]
  provenance: 'captured-input'
  phase: 'pending' | 'ready' | 'unavailable'
  files: DisplaySnapshot['artifacts']['files']
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

export const DISPLAY_EXPLORER_CALL_BYTES = 5 * 1024
export const DISPLAY_COMPARISON_CALL_ROWS = 8
export const DISPLAY_COMPARISON_CALL_BYTES = 5 * 1024
export const DISPLAY_COMPARISON_CALL_ANCESTORS = 7
export const DISPLAY_SNAPSHOT_LIMIT = 16 * 1024 * 1024
export const DISPLAY_INCOMPLETE_LIMIT = 2 * 1024 * 1024
export const DISPLAY_COMPOSITION_NODE_LIMIT = 256
export const DISPLAY_COMPOSITION_EDGE_LIMIT = 1024
export const DISPLAY_COMPOSITION_BYTE_LIMIT = 256 * 1024
export const DISPLAY_PROJECT_BYTE_LIMIT = DISPLAY_SNAPSHOT_LIMIT
export const DISPLAY_PROJECT_TARGET_LIMIT = 4096
export const DISPLAY_PROJECT_SCHEMA_BYTE_LIMIT = 256 * 1024
export const DISPLAY_PROJECT_RUN_REQUEST_BYTE_LIMIT = 16 * 1024 * 1024

/** Portable selected content accepted by reference inspection, without viewer state. */
export type DisplayReferenceRecord = Immutable<{
  block?: DetailBlock | undefined
  row?: Collection['rows'][number] | undefined
  activity?: Extract<ReportingMessage, { kind: 'activity' }> | undefined
}>
