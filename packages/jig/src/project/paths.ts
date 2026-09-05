import { validateJson1 } from '../json.js'
import { fullCaseFold15_1, isNfc15_1 } from '../package/paths.js'

const encoder = new TextEncoder()
const MAX_PROJECT_PATH_BYTES = 1_024
const MAX_PROJECT_PATH_SEGMENTS = 64
const MAX_PROJECT_PATH_SEGMENT_BYTES = 255

export function normalizeProjectPath(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`)
  const path = value.startsWith('./') ? value.slice(2) : value
  validateProjectPath(path, label)
  return path
}

export function validateProjectPath(path: unknown, label: string): asserts path is string {
  if (typeof path !== 'string') throw new TypeError(`${label} must be a string`)
  validateJson1(path)
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw new TypeError(`${label} must be a project-relative slash path`)
  }
  assertUnicodeScalarString(path, label)
  if (!isNfc15_1(path)) throw new TypeError(`${label} must be Unicode 15.1 NFC`)
  const segments = path.split('/')
  if (segments.length > MAX_PROJECT_PATH_SEGMENTS) {
    throw new TypeError(`${label} exceeds ${MAX_PROJECT_PATH_SEGMENTS} segments`)
  }
  if (encoder.encode(path).byteLength > MAX_PROJECT_PATH_BYTES) {
    throw new TypeError(`${label} exceeds ${MAX_PROJECT_PATH_BYTES} UTF-8 bytes`)
  }
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.' || segment === '..') {
      throw new TypeError(`${label} contains an invalid path segment`)
    }
    if (encoder.encode(segment).byteLength > MAX_PROJECT_PATH_SEGMENT_BYTES) {
      throw new TypeError(
        `${label} has a segment exceeding ${MAX_PROJECT_PATH_SEGMENT_BYTES} UTF-8 bytes`,
      )
    }
  }
}

function assertUnicodeScalarString(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${label} contains a lone Unicode surrogate`)
      }
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${label} contains a lone Unicode surrogate`)
    }
  }
}

export function assertNoProjectPathCollisions(paths: readonly string[], label: string): void {
  const folded = new Map<string, string>()
  for (const path of paths) {
    validateProjectPath(path, label)
    const key = fullCaseFold15_1(path)
    const prior = folded.get(key)
    if (prior !== undefined) throw new TypeError(`${label} paths collide: ${prior} and ${path}`)
    folded.set(key, path)
  }
}

/** Protected host state is excluded under Unicode 15.1 case folding. */
export function isProtectedProjectPath(path: string): boolean {
  return fullCaseFold15_1(path.split('/', 1)[0]!) === '.jig'
}

export function compareProjectPaths(left: string, right: string): number {
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  const length = Math.min(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!
    if (difference !== 0) return difference
  }
  return leftBytes.length - rightBytes.length
}
