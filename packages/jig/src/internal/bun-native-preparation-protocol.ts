import { types as utilTypes } from 'node:util'
import { PACKAGE_1_MAX_PATH_BYTES } from '../package/paths.js'
import {
  DEFAULT_PROJECT_DEPENDENCY_LIMITS,
  normalizeProjectDependencyLimits,
  type ProjectDependencyLimits,
} from '../project/limits.js'
import { PRIVATE_BUN_EXECUTION_LAYOUT_LIMITS } from './bun-execution-layout.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'

const MIB = 1024 * 1024
const MAX_JSON_BYTES_PER_PATH_BYTE = 6

export const PRIVATE_BUN_PREPARATION_LIMITS = Object.freeze({
  sourceFiles: 4_096,
  sourceBytes: 16 * MIB,
  preparedFiles: DEFAULT_PROJECT_DEPENDENCY_LIMITS.maxPreparedFiles,
  preparedBytes: DEFAULT_PROJECT_DEPENDENCY_LIMITS.maxPreparedBytes,
})

/** Review-only developer closure; never changes FLOW production selection. */
export const PRIVATE_BUN_EVALUATION_PREPARATION_LIMITS = Object.freeze({
  sourceFiles: 32,
  sourceBytes: 4 * MIB,
  preparedFiles: 8192,
  preparedBytes: 128 * MIB,
})
export type PrivateBunPreparationMode = 'production' | 'evaluation'
export function privateBunPreparationLimits(
  mode: PrivateBunPreparationMode,
  dependencyLimits?: ProjectDependencyLimits,
) {
  if (dependencyLimits === undefined)
    return mode === 'evaluation'
      ? PRIVATE_BUN_EVALUATION_PREPARATION_LIMITS
      : PRIVATE_BUN_PREPARATION_LIMITS
  if (mode !== 'production') throw new TypeError('evaluation preparation limits are fixed')
  const selected = normalizeProjectDependencyLimits(
    snapshotPrivateOrdinaryJson(
      dependencyLimits,
      'dependency preparation limits',
      (message) => new TypeError(message),
    ),
  )
  return Object.freeze({
    ...PRIVATE_BUN_PREPARATION_LIMITS,
    preparedFiles: selected.maxPreparedFiles,
    preparedBytes: selected.maxPreparedBytes,
  })
}

/** Closed numeric evidence only; worker text never determines a public limit diagnosis. */
export interface PrivateBunPreparationLimitFailure {
  readonly dimension: 'files' | 'bytes'
  readonly observed: number
  readonly maximum: number
}

export function privateBunPreparationLimitFailure(
  value: unknown,
  limits: { readonly preparedFiles: number; readonly preparedBytes: number },
): PrivateBunPreparationLimitFailure {
  if (
    value === null ||
    typeof value !== 'object' ||
    utilTypes.isProxy(value) ||
    Array.isArray(value)
  )
    throw new TypeError('invalid Bun preparation limit failure')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError('invalid Bun preparation limit failure')
  const keys = Reflect.ownKeys(value)
  if (keys.length !== 3 || keys.some((key) => typeof key !== 'string'))
    throw new TypeError('invalid Bun preparation limit failure')
  const record: Record<string, unknown> = Object.create(null)
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable)
      throw new TypeError('invalid Bun preparation limit failure')
    record[key] = descriptor.value
  }
  if (
    Object.keys(record).sort().join(',') !== 'dimension,maximum,observed' ||
    (record.dimension !== 'files' && record.dimension !== 'bytes') ||
    !Number.isSafeInteger(record.observed) ||
    (record.observed as number) < 0 ||
    record.maximum !==
      (record.dimension === 'files' ? limits.preparedFiles : limits.preparedBytes) ||
    (record.observed as number) <= (record.maximum as number)
  )
    throw new TypeError('invalid Bun preparation limit failure')
  return Object.freeze({
    dimension: record.dimension,
    observed: record.observed as number,
    maximum: record.maximum as number,
  })
}

/**
 * A conservative bound for one JSON line containing canonical file records.
 *
 * JSON escaping expands one UTF-8 path byte by at most six bytes. Split
 * base64 values add at most one four-byte quantum per file beyond the usual
 * encoding of their aggregate content. Fixed syntax is deliberately
 * over-counted so every value admitted by the raw limits fits the line bound.
 */
export function maximumPrivateBunFileMessageBytes(
  type: 'source',
  maximumFiles: number,
  maximumContentBytes: number,
): number {
  requireNonnegativeInteger(maximumFiles, 'file count')
  requireNonnegativeInteger(maximumContentBytes, 'content bytes')
  const emptyMessageBytes = Buffer.byteLength(JSON.stringify({ type, files: [] }))
  const emptyFileBytes = Buffer.byteLength(JSON.stringify({ path: '', content: '' }))
  const pathBytes = maximumFiles * PACKAGE_1_MAX_PATH_BYTES * MAX_JSON_BYTES_PER_PATH_BYTE
  const contentBytes = 4 * (Math.ceil(maximumContentBytes / 3) + maximumFiles)
  const separators = Math.max(0, maximumFiles - 1)
  const result =
    emptyMessageBytes + maximumFiles * emptyFileBytes + pathBytes + contentBytes + separators
  if (!Number.isSafeInteger(result))
    throw new RangeError('Bun preparation message bound is too large')
  return result
}

export const PRIVATE_BUN_SOURCE_MESSAGE_BYTES = maximumPrivateBunFileMessageBytes(
  'source',
  PRIVATE_BUN_PREPARATION_LIMITS.sourceFiles,
  PRIVATE_BUN_PREPARATION_LIMITS.sourceBytes,
)

/** Success carries bounded layout/identity only. File bytes use native directory custody. */
export const PRIVATE_BUN_PREPARED_MESSAGE_BYTES = PRIVATE_BUN_EXECUTION_LAYOUT_LIMITS.bytes + 1024

export function privateBunMessageFits(bytes: number, maximum: number): boolean {
  return Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= maximum
}

/** Encode exactly one newline-delimited worker message. */
export function encodePrivateBunMessage(value: unknown): Uint8Array {
  const json = JSON.stringify(value)
  if (json === undefined) throw new TypeError('Bun preparation message is not JSON-serializable')
  return new TextEncoder().encode(`${json}\n`)
}

function requireNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`)
  }
}
