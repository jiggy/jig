import {
  maximumPackageArtifactBytes,
  PACKAGE_1_LIMITS,
  PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS,
} from '../package/capacity.js'
import { snapshotJsonObject } from './author-value.js'

export interface ProjectDependencyLimits {
  readonly maxPreparedBytes: number
  readonly maxPreparedFiles: number
}

export interface JigLimitsInput {
  readonly dependencies?: Partial<ProjectDependencyLimits>
}

export interface JigLimits {
  readonly dependencies?: Readonly<Partial<ProjectDependencyLimits>>
}

export const DEFAULT_PROJECT_DEPENDENCY_LIMITS: ProjectDependencyLimits = Object.freeze({
  maxPreparedBytes: 32 * 1024 * 1024,
  maxPreparedFiles: 4096,
})

/** Preparation choices remain bounded by Package/0 and retained archive capacity. */
export const DEPENDENCY_PREPARATION_LIMIT_POLICY = Object.freeze({
  default: DEFAULT_PROJECT_DEPENDENCY_LIMITS,
  minimum: 1,
  maximum: Object.freeze({
    maxPreparedBytes: 128 * 1024 * 1024,
    maxPreparedFiles: PACKAGE_1_LIMITS.files,
  }),
  environment: Object.freeze({
    maxPreparedBytes: 'JIG_LIMITS_DEPENDENCIES_MAX_PREPARED_BYTES',
    maxPreparedFiles: 'JIG_LIMITS_DEPENDENCIES_MAX_PREPARED_FILES',
  }),
})

const fields = ['maxPreparedBytes', 'maxPreparedFiles'] as const

/** Preserve explicit project choices without copying defaults into authored policy. */
export function normalizeJigLimits(value: unknown): JigLimits {
  const input = snapshotJsonObject(value, 'limits')
  closed(input, ['dependencies'], 'limits')
  if (!Object.hasOwn(input, 'dependencies')) return Object.freeze({})
  const dependencies = snapshotJsonObject(input.dependencies, 'limits.dependencies')
  closed(dependencies, fields, 'limits.dependencies')
  const output: Partial<ProjectDependencyLimits> = {}
  for (const field of fields) {
    if (!Object.hasOwn(dependencies, field)) continue
    Object.defineProperty(output, field, {
      value: requireDependencyPreparationLimit(
        dependencies[field],
        field,
        `limits.dependencies.${field}`,
      ),
      enumerable: true,
    })
  }
  normalizeProjectDependencyLimits({ ...DEFAULT_PROJECT_DEPENDENCY_LIMITS, ...output })
  return Object.freeze({ dependencies: Object.freeze(output) })
}

/** Validate complete limits crossing a private preparation/worker boundary. */
export function normalizeProjectDependencyLimits(value: unknown): ProjectDependencyLimits {
  const input = snapshotJsonObject(value, 'dependency preparation limits')
  closed(input, fields, 'dependency preparation limits')
  const limits = Object.freeze({
    maxPreparedBytes: requireDependencyPreparationLimit(input.maxPreparedBytes, 'maxPreparedBytes'),
    maxPreparedFiles: requireDependencyPreparationLimit(input.maxPreparedFiles, 'maxPreparedFiles'),
  })
  if (
    maximumPackageArtifactBytes(limits.maxPreparedBytes, limits.maxPreparedFiles) >
    PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS.artifactBytes
  )
    throw new TypeError(
      `dependency preparation limits exceed the ${PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS.artifactBytes / (1024 * 1024)} MiB canonical artifact capacity when combined with maximum-length paths; reduce maxPreparedBytes or maxPreparedFiles`,
    )
  return limits
}

export function requireDependencyPreparationLimit(
  value: unknown,
  field: keyof ProjectDependencyLimits,
  label = `limits.dependencies.${field}`,
): number {
  const maximum = DEPENDENCY_PREPARATION_LIMIT_POLICY.maximum[field]
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < DEPENDENCY_PREPARATION_LIMIT_POLICY.minimum ||
    value > maximum
  )
    throw new TypeError(`${label} must be an integer between 1 and ${maximum}`)
  return value
}

function closed(value: object, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new TypeError(`${label} has unknown field ${key}`)
}
