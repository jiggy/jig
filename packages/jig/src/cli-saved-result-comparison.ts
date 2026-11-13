import { sha256 } from './internal/file-input.js'
import type { PrivateSavedResult, PrivateSavedResultFile } from './internal/saved-result.js'
import { canonicalJson, type JsonValue } from './json.js'
import { asciiJsonString } from './cli-usage.js'

const MAX_CHANGES = 128
const MAX_PATH_BYTES = 512
const MAX_EXCERPT_BYTES = 192
const MAX_DEPTH = 24

const FIELDS = [
  'method',
  'input',
  'status',
  'outcome',
  'code',
  'message',
  'output',
  'details',
  'cleanup',
  'command',
] as const

type Excerpt = Readonly<{
  type: string
  bytes: number
  digest: string
  text: string
  clipped: boolean
}>
type FieldChange = Readonly<{
  pointer: string
  change: 'added' | 'removed' | 'changed'
  before?: Excerpt
  after?: Excerpt
}>
type FileSide = Readonly<{ bytes: number; digest: string; verified: boolean }>
type FileChange = Readonly<{
  path: string
  state: 'added-recorded' | 'removed-recorded' | 'changed-recorded' | 'unchanged-verified' | 'unverified'
  before?: FileSide
  after?: FileSide
}>

/** Two independent, locally recorded packets. No authenticated run lineage is inferred. */
export type PrivateSavedComparison = Readonly<{
  kind: 'recorded-result-comparison/v1'
  before: Readonly<{ complete: boolean; finding?: string }>
  after: Readonly<{ complete: boolean; finding?: string }>
  fields: Readonly<{ changes: readonly FieldChange[]; limit: number; truncated: boolean }>
  files: Readonly<{ entries: readonly FileChange[]; unchanged: number; changed: number; unverified: number }>
}>

function object(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function type(value: JsonValue): string {
  if (value === null) return 'null'
  return Array.isArray(value) ? 'array' : typeof value
}

function excerpt(value: JsonValue): Excerpt {
  const bytes = canonicalJson(value)
  const limit = Math.min(bytes.length, MAX_EXCERPT_BYTES)
  const text = new TextDecoder('utf-8').decode(bytes.subarray(0, limit), { stream: true })
  return {
    type: type(value),
    bytes: bytes.length,
    digest: sha256(Buffer.from(bytes)),
    text,
    clipped: bytes.length > limit,
  }
}

function childPointer(parent: string, member: string): string | undefined {
  const escaped = member.replaceAll('~', '~0').replaceAll('/', '~1')
  const next = parent + '/' + escaped
  return Buffer.byteLength(next) <= MAX_PATH_BYTES ? next : undefined
}

/** Compare exact JSON meaning without key-order noise or arbitrary application verdicts. */
export function privateCompareSavedResults(
  before: PrivateSavedResult,
  after: PrivateSavedResult,
): PrivateSavedComparison {
  const changes: FieldChange[] = []
  let truncated = false
  const add = (pointer: string, change: FieldChange['change'], left?: JsonValue, right?: JsonValue) => {
    if (changes.length >= MAX_CHANGES) {
      truncated = true
      return
    }
    changes.push({
      pointer,
      change,
      ...(left === undefined ? {} : { before: excerpt(left) }),
      ...(right === undefined ? {} : { after: excerpt(right) }),
    })
  }
  const visit = (
    pointer: string,
    left: JsonValue | undefined,
    right: JsonValue | undefined,
    hasLeft: boolean,
    hasRight: boolean,
    depth: number,
  ): void => {
    if (truncated) return
    if (!hasLeft) {
      add(pointer, 'added', undefined, right)
      return
    }
    if (!hasRight) {
      add(pointer, 'removed', left)
      return
    }
    if (left === undefined || right === undefined) throw new TypeError('invalid saved JSON')
    if (type(left) !== type(right)) {
      add(pointer, 'changed', left, right)
      return
    }
    if (Object.is(left, right)) return
    if (depth >= MAX_DEPTH) {
      if (sha256(Buffer.from(canonicalJson(left))) !== sha256(Buffer.from(canonicalJson(right))))
        add(pointer, 'changed', left, right)
      return
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      for (let i = 0; i < Math.max(left.length, right.length) && !truncated; i++) {
        const member = childPointer(pointer, String(i))
        if (member === undefined) {
          add(pointer, 'changed', left, right)
          break
        }
        visit(member, left[i], right[i], i < left.length, i < right.length, depth + 1)
      }
      return
    }
    if (object(left) && object(right)) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
      for (const key of keys) {
        if (truncated) break
        const member = childPointer(pointer, key)
        if (member === undefined) {
          add(pointer, 'changed', left, right)
          break
        }
        visit(member, left[key], right[key], Object.hasOwn(left, key), Object.hasOwn(right, key), depth + 1)
      }
      return
    }
    add(pointer, 'changed', left, right)
  }

  for (const key of FIELDS) {
    if (truncated) break
    const a = Object.hasOwn(before.record, key)
    const b = Object.hasOwn(after.record, key)
    if (a || b) visit('/' + key, before.record[key], after.record[key], a, b, 0)
  }

  const leftFiles = new Map(before.files.map((file) => [file.path, file]))
  const rightFiles = new Map(after.files.map((file) => [file.path, file]))
  const entries: FileChange[] = []
  let unchanged = 0, changed = 0, unverified = 0
  const side = (file: PrivateSavedResultFile): FileSide => ({
    bytes: file.bytes,
    digest: file.digest,
    verified: file.available,
  })
  for (const path of [...new Set([...leftFiles.keys(), ...rightFiles.keys()])].sort()) {
    const left = leftFiles.get(path)
    const right = rightFiles.get(path)
    const state: FileChange['state'] =
      !left ? 'added-recorded'
      : !right ? 'removed-recorded'
      : !left.available || !right.available ? 'unverified'
      : left.digest === right.digest && left.bytes === right.bytes ? 'unchanged-verified'
      : 'changed-recorded'
    if (state === 'unchanged-verified') unchanged++
    else if (state === 'unverified' || (left && !left.available) || (right && !right.available))
      unverified++
    else changed++
    entries.push({
      path,
      state,
      ...(left === undefined ? {} : { before: side(left) }),
      ...(right === undefined ? {} : { after: side(right) }),
    })
  }

  return {
    kind: 'recorded-result-comparison/v1',
    before: { complete: before.complete, ...(before.finding ? { finding: before.finding } : {}) },
    after: { complete: after.complete, ...(after.finding ? { finding: after.finding } : {}) },
    fields: { changes, limit: MAX_CHANGES, truncated },
    files: { entries, unchanged, changed, unverified },
  }
}

export function privateSavedComparisonPlain(result: PrivateSavedComparison): string {
  const lines: string[] = [
    'Recorded result comparison',
    '',
    'Two selected local packets, not authenticated execution evidence.',
    'No work was started. Application success, causality and execution paths are not inferred.',
    'Before capture: ' + (result.before.complete ? 'complete' : 'incomplete'),
    'After capture: ' + (result.after.complete ? 'complete' : 'incomplete'),
    ...(result.before.finding ? ['Before finding: ' + result.before.finding] : []),
    ...(result.after.finding ? ['After finding: ' + result.after.finding] : []),
    '',
    'Recorded field differences',
  ]
  if (!result.fields.changes.length) lines.push('  No differences in selected recorded fields.')
  for (const value of result.fields.changes) {
    lines.push('  ' + value.change + ' ' + asciiJsonString(value.pointer))
    if (value.before) lines.push('    - ' + value.before.text + (value.before.clipped ? ' [excerpt clipped]' : ''))
    if (value.after) lines.push('    + ' + value.after.text + (value.after.clipped ? ' [excerpt clipped]' : ''))
  }
  if (result.fields.truncated)
    lines.push('  More field changes were omitted; the comparison limit is ' + result.fields.limit + '.')
  lines.push('', 'Recorded delivered files')
  if (!result.files.entries.length) lines.push('  No files recorded in either packet.')
  for (const file of result.files.entries)
    lines.push('  ' + file.state + ' ' + asciiJsonString(file.path))
  lines.push(
    '',
    'Verified unchanged: ' + result.files.unchanged +
      '. Recorded changes: ' + result.files.changed +
      '. Unverified entries: ' + result.files.unverified + '.',
    'A recorded digest is not independently authenticated source or execution provenance.',
    '',
  )
  return lines.join('\n')
}
