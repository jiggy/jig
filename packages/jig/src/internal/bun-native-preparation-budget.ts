import { CheckError } from '../diagnostics.js'
import {
  DEFAULT_PROJECT_DEPENDENCY_LIMITS,
  requireDependencyPreparationLimit,
} from '../project/limits.js'

const MIB = 1024 * 1024

export const PRIVATE_BUN_PROJECT_PREPARATION_LIMITS = Object.freeze({
  preparedBytes: 256 * MIB,
  wallClockMs: 180_000,
})

export interface PrivateBunPreparationBudget {
  readonly deadlineUnixMs: number
  readonly signal: AbortSignal
  reserve(packageDigest: string, projectPath: string, maxPreparations?: number): void
  retain(
    files: readonly { readonly size: number }[],
    projectPath: string,
    metadataBytes?: number,
  ): void
  dispose(): void
}

/** One review's count, byte and time accounting, with no renewable deadline. */
export function createPrivateBunPreparationBudget(
  parentSignal: AbortSignal,
): PrivateBunPreparationBudget {
  const deadlineUnixMs = Date.now() + PRIVATE_BUN_PROJECT_PREPARATION_LIMITS.wallClockMs
  const deadline = new AbortController()
  const timer = setTimeout(
    () =>
      deadline.abort(
        new CheckError(
          'unavailable',
          'PACKAGE_BUN_PROJECT_DEADLINE',
          'project dependency planning exceeded the fixed preparation deadline',
        ),
      ),
    PRIVATE_BUN_PROJECT_PREPARATION_LIMITS.wallClockMs,
  )
  timer.unref()
  const signal = AbortSignal.any([parentSignal, deadline.signal])
  const packages = new Set<string>()
  let preparedBytes = 0
  let disposed = false

  return Object.freeze({
    deadlineUnixMs,
    signal,
    reserve(
      packageDigest: string,
      projectPath: string,
      maxPreparations = DEFAULT_PROJECT_DEPENDENCY_LIMITS.maxPreparations,
    ): void {
      requireOpen()
      signal.throwIfAborted()
      const maximum = requireDependencyPreparationLimit(maxPreparations, 'maxPreparations')
      if (packages.has(packageDigest)) return
      if (packages.size >= maximum) {
        const observed = packages.size + 1
        throw new CheckError(
          'invalid',
          'PACKAGE_BUN_PROJECT_COUNT_LIMIT',
          `project requires at least ${observed} distinct dependency preparations, exceeding the configured limit of ${maximum}`,
          projectPath,
          undefined,
          undefined,
          undefined,
          { dimension: 'preparations', observed, maximum },
        )
      }
      packages.add(packageDigest)
    },
    retain(
      files: readonly { readonly size: number }[],
      projectPath: string,
      metadataBytes = 0,
    ): void {
      requireOpen()
      signal.throwIfAborted()
      if (!Number.isSafeInteger(metadataBytes) || metadataBytes < 0)
        throw new TypeError('prepared metadata size is invalid')
      let bytes = metadataBytes
      for (const file of files) {
        if (!Number.isSafeInteger(file.size) || file.size < 0) {
          throw new TypeError('prepared package file size is invalid')
        }
        bytes += file.size
        if (!Number.isSafeInteger(bytes)) throw new TypeError('prepared package size is invalid')
      }
      if (preparedBytes + bytes > PRIVATE_BUN_PROJECT_PREPARATION_LIMITS.preparedBytes) {
        throw limit(
          'PACKAGE_BUN_PROJECT_OUTPUT_LIMIT',
          `project dependency preparation exceeds ${PRIVATE_BUN_PROJECT_PREPARATION_LIMITS.preparedBytes} bytes`,
          projectPath,
        )
      }
      preparedBytes += bytes
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      clearTimeout(timer)
    },
  })

  function requireOpen(): void {
    if (disposed) throw new TypeError('Bun preparation budget is closed')
  }
}

function limit(code: string, message: string, path: string): CheckError {
  return new CheckError('invalid', code, message, path)
}
