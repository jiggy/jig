import type { PrivateCallState } from '../cli-run-model.js'
import { type JsonValue, validateJson1 } from '../json.js'
import { parseRunTargetSelector } from '../project/author.js'
import { flowSelector } from '../project/package-selector.js'

const MAX_BYTES = 128 * 1024
const MAX_CALLS = 256
const DIGEST = /^sha256:[0-9a-f]{64}$/
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/
const STATES = ['requested', 'active', 'cancel-requested', 'returned', 'failed', 'uncertain']
const RESOURCES = [
  'http-request',
  'project-command',
  'offline-tool',
  'project-evaluation',
  'finite-acp',
  'run-checkpoint',
  'child-checkpoint',
]

type SavedCall = Readonly<{
  id: number
  parent?: number
  caller?: string
  slot: string
  target?: string
  state: PrivateCallState
  outcome?: string
}>

export type PrivateSavedCalls = Readonly<{
  provenance: 'recorded-claim'
  runId: string
  root: string
  revision?: string
  coverage: 'complete' | 'incomplete' | 'unavailable'
  omittedEvents: number
  calls: readonly SavedCall[]
}>

export function localName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && NAME.test(value)
}

function selector(value: unknown): value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1029) return false
  try {
    const target = parseRunTargetSelector(value, 'recorded selector')
    return value === (target.kind === 'flow' ? flowSelector(target.path) : `binding:${target.id}`)
  } catch {
    return false
  }
}

export function settled(state: string): boolean {
  return state === 'returned' || state === 'failed'
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Check the retained shape and identity before using any recorded field for presentation. */
export function readPrivateSavedCalls(
  value: unknown,
  runId: unknown,
): PrivateSavedCalls | undefined {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) =>
        !['provenance', 'runId', 'root', 'revision', 'coverage', 'omittedEvents', 'calls'].includes(
          key,
        ),
    ) ||
    value.provenance !== 'recorded-claim' ||
    typeof runId !== 'string' ||
    !DIGEST.test(runId) ||
    value.runId !== runId ||
    !selector(value.root) ||
    typeof value.coverage !== 'string' ||
    !['complete', 'incomplete', 'unavailable'].includes(value.coverage) ||
    !Number.isSafeInteger(value.omittedEvents) ||
    Number(value.omittedEvents) < 0 ||
    !Array.isArray(value.calls) ||
    value.calls.length > MAX_CALLS
  )
    return
  if (value.coverage === 'unavailable') {
    if (value.revision !== undefined || value.calls.length || value.omittedEvents !== 0) return
  } else if (typeof value.revision !== 'string' || !DIGEST.test(value.revision)) return
  if (value.coverage === 'complete' && value.omittedEvents !== 0) return

  for (const [index, call] of value.calls.entries()) {
    if (
      !record(call) ||
      Object.keys(call).some(
        (key) => !['id', 'parent', 'caller', 'slot', 'target', 'state', 'outcome'].includes(key),
      ) ||
      call.id !== index + 1 ||
      (call.parent !== undefined &&
        (!Number.isSafeInteger(call.parent) ||
          Number(call.parent) < 1 ||
          Number(call.parent) > index)) ||
      !localName(call.slot) ||
      typeof call.state !== 'string' ||
      !STATES.includes(call.state) ||
      (call.outcome !== undefined && (call.state !== 'returned' || !localName(call.outcome))) ||
      (call.state === 'returned' && call.outcome === undefined) ||
      (call.caller === undefined) !== (call.target === undefined) ||
      (call.caller !== undefined && !selector(call.caller)) ||
      (call.target !== undefined &&
        !selector(call.target) &&
        !(
          typeof call.target === 'string' &&
          call.target.startsWith('resource:') &&
          RESOURCES.includes(call.target.slice(9))
        )) ||
      (value.coverage === 'complete' &&
        (!settled(call.state) ||
          call.caller === undefined ||
          call.caller !==
            (call.parent === undefined ? value.root : value.calls[Number(call.parent) - 1].target)))
    )
      return
  }
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) return
  return value as PrivateSavedCalls
}

/** Optional evidence may use only spare transport and packet capacity. */
export function retainPrivateSavedCalls(
  fields: Record<string, JsonValue>,
  value: JsonValue,
): Record<string, JsonValue> {
  const extended = { ...fields, callEvidence: value }
  try {
    validateJson1(extended)
    return extended
  } catch {
    return fields
  }
}
