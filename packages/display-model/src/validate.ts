import { validateReportingMessage } from '@jigging/reporting/validation'
import {
  DISPLAY_INCOMPLETE_LIMIT,
  DISPLAY_SNAPSHOT_LIMIT,
  type DisplaySnapshotEnvelope,
} from './types.js'

const fail = (): never => {
  throw new TypeError('Display snapshot is malformed or exceeds its allowance')
}
type Data = Record<string, unknown>
const record = (value: unknown, fields: readonly string[]): Data => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const data = value as Data
  if (Object.keys(data).some((field) => !fields.includes(field))) return fail()
  return data
}
const text = (value: unknown, maximum: number, minimum = 0): string => {
  if (typeof value !== 'string' || value.length > maximum * 2) return fail()
  let count = 0
  for (const scalar of value) {
    const point = scalar.codePointAt(0)!
    if ((point >= 0xd800 && point <= 0xdfff) || ++count > maximum) return fail()
  }
  return count >= minimum ? value : fail()
}
const identity = (value: unknown) => text(value, 256, 1)
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail()
// Unavailable observation clocks remain observations, rather than invalidating
// their material. Interval/date consumers decide whether a clock is usable.
const number = (value: unknown): number => (typeof value === 'number' ? value : fail())
const flag = (value: unknown) => (typeof value === 'boolean' ? value : fail())
const choice = (value: unknown, values: readonly string[]) =>
  typeof value === 'string' && values.includes(value) ? value : fail()
const optional = (value: unknown, check: (value: unknown) => unknown) => {
  if (value !== undefined) check(value)
}
const list = (value: unknown, maximum: number): unknown[] =>
  Array.isArray(value) && value.length <= maximum ? value : fail()

/** Copy inert data before inspecting it; getters, cycles and ambient objects are refused. */
function copy(value: unknown): { value: unknown; bytes: number } {
  let nodes = 0
  let bytes = 0
  const ancestors = new Set<object>()
  const charge = (size: number) => {
    bytes += size
    if (bytes > DISPLAY_SNAPSHOT_LIMIT) fail()
  }
  const string = (value: string) => {
    charge(2)
    for (let index = 0; index < value.length; index++) {
      const point = value.charCodeAt(index)
      if (point === 0x22 || point === 0x5c) charge(2)
      else if (point === 8 || point === 9 || point === 10 || point === 12 || point === 13) charge(2)
      else if (point < 32) charge(6)
      else if (point < 128) charge(1)
      else if (point < 2048) charge(2)
      else if (point >= 0xd800 && point <= 0xdbff) {
        const next = value.charCodeAt(++index)
        if (!(next >= 0xdc00 && next <= 0xdfff)) fail()
        charge(4)
      } else if (point >= 0xdc00 && point <= 0xdfff) fail()
      else charge(3)
    }
    return value
  }
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 1000000 || depth > 64) return fail()
    if (value === null) {
      charge(4)
      return value
    }
    if (typeof value === 'string') return string(value)
    if (typeof value === 'boolean') {
      charge(value ? 4 : 5)
      return value
    }
    if (typeof value === 'number') {
      charge(JSON.stringify(value).length)
      return value
    }
    if (!value || typeof value !== 'object' || ancestors.has(value)) return fail()
    const array = Array.isArray(value)
    if (!array && ![null, Object.prototype].includes(Object.getPrototypeOf(value))) return fail()
    ancestors.add(value)
    charge(2)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    const result: unknown[] | Data = array ? [] : {}
    if (array && keys.length !== value.length + 1) return fail()
    let items = 0
    for (const key of keys) {
      if (array && key === 'length') continue
      const property = descriptors[key as string]
      if (typeof key !== 'string' || !property?.enumerable || !('value' in property)) return fail()
      if (items++) charge(1)
      if (array) {
        if (key !== String((result as unknown[]).length)) return fail()
        ;(result as unknown[]).push(visit(property.value, depth + 1))
      } else {
        string(key)
        charge(1)
        Object.defineProperty(result, key, {
          value: visit(property.value, depth + 1),
          enumerable: true,
        })
      }
    }
    ancestors.delete(value)
    return Object.freeze(result)
  }
  return { value: visit(value, 0), bytes }
}
function fact(value: unknown): void {
  const data = record(value, ['value', 'provenance', 'clipped'])
  text(data.value, 1024)
  choice(data.provenance, ['host-observed', 'application-reported', 'recorded-claim'])
  optional(data.clipped, flag)
}
function attribution(value: unknown): void {
  const data = record(value, [
    'provenance',
    'sourceLabel',
    'sourceId',
    'callId',
    'relationshipIncomplete',
    'relation',
    'ancestryIncomplete',
  ])
  text(data.sourceLabel, 256)
  const provenance = choice(data.provenance, ['host-observed', 'accepted-source', 'recorded-claim'])
  optional(data.sourceId, identity)
  optional(data.callId, identity)
  if (provenance === 'accepted-source') {
    identity(data.sourceId)
    choice(data.relation, ['root', 'observed-call', 'unavailable'])
    flag(data.ancestryIncomplete)
    if (data.relationshipIncomplete !== undefined) fail()
  } else if (provenance === 'host-observed') {
    optional(data.relationshipIncomplete, flag)
    if (data.relation !== undefined || data.ancestryIncomplete !== undefined) fail()
  } else if (Object.keys(data).some((key) => !['provenance', 'sourceLabel'].includes(key))) fail()
}
function journal(value: unknown, diagnostic = false): void {
  const data = record(value, [
    'id',
    'kind',
    'attribution',
    'sequence',
    'importance',
    'text',
    'operationsPath',
    'pathClipped',
    'clipped',
  ])
  identity(data.id)
  choice(data.kind, diagnostic ? ['diagnostic'] : ['flow', 'host', 'diagnostic'])
  attribution(data.attribution)
  count(data.sequence)
  choice(data.importance, ['info', 'warning', 'error', 'unknown'])
  text(data.text, 524288)
  optional(data.operationsPath, (value) => {
    for (const part of list(value, 32)) text(part, 128)
  })
  optional(data.pathClipped, flag)
  optional(data.clipped, flag)
}
function unique(values: unknown[], check: (value: unknown) => void, field = 'id'): void {
  const identities = new Set<unknown>()
  for (const value of values) {
    check(value)
    const id = (value as Data)[field]
    if (identities.has(id)) fail()
    identities.add(id)
  }
}

function capture(value: unknown, input: boolean): void {
  const data = record(value, [
    'generation',
    'sourceId',
    'permittedAttachments',
    'provenance',
    'phase',
    'files',
  ])
  identity(data.generation)
  identity(data.sourceId)
  const attachments = list(data.permittedAttachments, 65536)
  for (const attachment of attachments) text(attachment, 64, 1)
  if (new Set(attachments).size !== attachments.length) fail()
  choice(data.provenance, input ? ['captured-input'] : ['verified-delivery', 'recorded-capture'])
  choice(data.phase, ['pending', 'ready', 'unavailable'])
  const joins = new Set<string>()
  const paths = new Map<string, Set<unknown>>()
  unique(list(data.files, 64), (value) => {
    const file = record(value, [
      'id',
      'path',
      'bytes',
      'state',
      'clipped',
      'sourceId',
      'attachment',
      'downloadable',
      'bindings',
    ])
    identity(file.id)
    text(file.path, 512, 1)
    count(file.bytes)
    choice(file.state, ['text', 'empty', 'image', 'non-text', 'unavailable'])
    flag(file.clipped)
    optional(file.sourceId, identity)
    optional(file.attachment, (value) => text(value, 64, 1))
    optional(file.downloadable, flag)
    if (file.bindings !== undefined) {
      if (input) fail()
      for (const value of list(file.bindings, 1024)) {
        const binding = record(value, ['sourceId', 'attachment', 'path'])
        identity(binding.sourceId)
        text(binding.attachment, 64, 1)
        text(binding.path, 512, 1)
        if (!attachments.includes(binding.attachment)) fail()
        const key = JSON.stringify([binding.sourceId, binding.attachment, binding.path])
        if (joins.has(key)) fail()
        joins.add(key)
      }
    }
    if (file.attachment !== undefined && !attachments.includes(file.attachment)) fail()
    const path = JSON.stringify([file.sourceId ?? data.sourceId, file.path])
    const bindings = paths.get(path) ?? new Set<unknown>()
    if ((file.attachment === undefined && bindings.size) || bindings.has(undefined)) fail()
    bindings.add(file.attachment)
    paths.set(path, bindings)
    const join = JSON.stringify([
      file.sourceId ?? data.sourceId,
      file.attachment ?? null,
      file.path,
    ])
    if (file.bindings === undefined) {
      if (joins.has(join)) fail()
      joins.add(join)
    }
  })
}

/** Validate one bounded replacement and return an owned immutable copy, never a partial body. */
function validate(value: unknown): DisplaySnapshotEnvelope {
  const owned = copy(value)
  const data = record(owned.value, [
    'kind',
    'revision',
    'mode',
    'rootSourceId',
    'workspace',
    'context',
    'incomplete',
    'omissions',
    'views',
    'calls',
    'activities',
    'journal',
    'attention',
    'artifacts',
    'inputs',
    'lastCompleteRevision',
    'reason',
    'diagnostics',
  ])
  const kind = choice(data.kind, ['snapshot', 'incomplete'])
  if (count(data.revision) < 1) fail()
  choice(data.mode, ['live-run', 'recorded-packet', 'retained-views'])
  identity(data.rootSourceId)
  const workspace = record(data.workspace, [
    'target',
    'phase',
    'hostStage',
    'elapsedMs',
    'limitMs',
    'facts',
  ])
  text(workspace.target, 1024)
  choice(workspace.phase, ['live', 'settled'])
  text(workspace.hostStage, 1024)
  if (!Number.isFinite(number(workspace.elapsedMs)) || (workspace.elapsedMs as number) < 0) fail()
  optional(workspace.limitMs, count)
  optional(workspace.facts, (value) => {
    const facts = record(value, ['execution', 'application', 'cleanup', 'delivery', 'completeness'])
    for (const name of ['execution', 'application', 'cleanup', 'delivery']) fact(facts[name])
    optional(facts.completeness, fact)
  })
  text(data.context, 2048)
  const omissions = record(data.omissions, ['calls', 'journal'])
  count(omissions.calls)
  const omittedJournal = record(omissions.journal, ['flow', 'host', 'diagnostic'])
  for (const name of ['flow', 'host', 'diagnostic']) count(omittedJournal[name])
  unique(list(data.attention, 128), (value) => {
    const entry = record(value, ['id', 'attribution', 'priority', 'text', 'transcriptCommitted'])
    identity(entry.id)
    attribution(entry.attribution)
    count(entry.priority)
    text(entry.text, 524288)
    flag(entry.transcriptCommitted)
  })
  if (kind === 'incomplete') {
    if (owned.bytes > DISPLAY_INCOMPLETE_LIMIT) fail()
    optional(data.lastCompleteRevision, (value) => {
      if (count(value) < 1 || (value as number) >= (data.revision as number)) fail()
    })
    text(data.reason, 1024)
    unique(list(data.diagnostics, 32), (value) => journal(value, true))
    for (const name of [
      'views',
      'calls',
      'activities',
      'journal',
      'artifacts',
      'inputs',
      'incomplete',
    ])
      if (data[name] !== undefined) fail()
  } else {
    for (const name of ['lastCompleteRevision', 'reason', 'diagnostics'])
      if (data[name] !== undefined) fail()
    optional(data.incomplete, (value) => text(value, 1024))
    const viewJoins = new Set<string>()
    unique(list(data.views, 32), (value) => {
      const view = record(value, [
        'id',
        'hostRole',
        'sourceId',
        'sourceLabel',
        'updatedAt',
        'ended',
        'value',
      ])
      identity(view.id)
      identity(view.sourceId)
      text(view.sourceLabel, 256)
      number(view.updatedAt)
      optional(view.ended, (value) => text(value, 1024))
      optional(view.hostRole, (value) =>
        choice(value, ['recorded-report', 'recorded-files', 'recorded-diagnostics']),
      )
      const document = validateReportingMessage(view.value)
      if (document.kind !== 'view') return fail()
      const join = JSON.stringify([view.sourceId, document.id])
      if (viewJoins.has(join)) fail()
      viewJoins.add(join)
    })
    const calls = list(data.calls, 256)
    const callJoins = new Set<string>()
    unique(calls, (value) => {
      const call = record(value, [
        'id',
        'sourceId',
        'sourceLabel',
        'childSourceId',
        'parentId',
        'operationId',
        'slot',
        'intent',
        'state',
        'firstObservedAt',
        'observedAt',
        'cause',
      ])
      identity(call.id)
      identity(call.sourceId)
      text(call.sourceLabel, 256)
      optional(call.childSourceId, identity)
      optional(call.parentId, identity)
      text(call.operationId, 128, 1)
      text(call.slot, 128)
      optional(call.intent, (value) => text(value, 1024))
      optional(call.cause, (value) => text(value, 4096))
      choice(call.state, [
        'requested',
        'active',
        'cancel-requested',
        'returned',
        'failed',
        'uncertain',
      ])
      number(call.firstObservedAt)
      number(call.observedAt)
      const join = JSON.stringify([call.sourceId, call.operationId])
      if (callJoins.has(join)) fail()
      callJoins.add(join)
    })
    const byId = new Map(calls.map((value) => [(value as Data).id, value as Data]))
    for (const value of calls) {
      let call = value as Data
      const seen = new Set<unknown>([call.id])
      for (let depth = 0; call.parentId !== undefined; depth++) {
        if (depth >= 32 || seen.has(call.parentId)) fail()
        seen.add(call.parentId)
        const parent = byId.get(call.parentId)
        if (!parent) break
        call = parent
      }
    }
    unique(list(data.activities, 16), (value) => {
      const activity = record(value, ['id', 'sourceId', 'sourceLabel', 'value'])
      identity(activity.id)
      identity(activity.sourceId)
      text(activity.sourceLabel, 256)
      if (validateReportingMessage(activity.value).kind !== 'activity') fail()
    })
    unique(list(data.journal, 224), (value) => journal(value))
    capture(data.artifacts, false)
    if (data.inputs !== undefined) capture(data.inputs, true)
    const captures = [data.artifacts, data.inputs].filter(Boolean) as Data[]
    const ids = new Set<unknown>()
    for (const value of captures)
      for (const file of value.files as Data[]) {
        if (ids.has(file.id)) fail()
        ids.add(file.id)
      }
    if (
      data.mode === 'retained-views' &&
      (calls.length ||
        (data.activities as unknown[]).length ||
        (data.journal as unknown[]).length ||
        workspace.phase !== 'settled')
    )
      fail()
  }
  return owned.value as DisplaySnapshotEnvelope
}

export function validateDisplaySnapshot(value: unknown): DisplaySnapshotEnvelope {
  try {
    return validate(value)
  } catch {
    return fail()
  }
}
