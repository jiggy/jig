import { types as utilTypes } from 'node:util'
import { snapshotJsonObject } from '../project/author-value.js'
import {
  DEFAULT_PROJECT_DEPENDENCY_LIMITS,
  DEPENDENCY_PREPARATION_LIMIT_POLICY,
  type JigLimits,
  normalizeJigLimits,
  normalizeProjectDependencyLimits,
  type ProjectDependencyLimits,
  requireDependencyPreparationLimit,
} from '../project/limits.js'

type LimitOrigin = 'environment' | 'project' | 'default'
export interface PrivateDependencyPreparationLimitEnvironment {
  readonly maxPreparedBytes?: number
  readonly maxPreparedFiles?: number
}

export interface PrivateResolvedDependencyPreparationLimits {
  readonly limits: ProjectDependencyLimits
  readonly origins: Readonly<Record<keyof ProjectDependencyLimits, LimitOrigin>>
}

/** Snapshot only supported operator choices before evaluating project source. */
export function capturePrivateDependencyPreparationLimitEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): PrivateDependencyPreparationLimitEnvironment {
  if (utilTypes.isProxy(environment))
    throw new TypeError('dependency preparation environment must contain ordinary data')
  const output: Partial<ProjectDependencyLimits> = {}
  for (const field of ['maxPreparedBytes', 'maxPreparedFiles'] as const) {
    const name = DEPENDENCY_PREPARATION_LIMIT_POLICY.environment[field]
    const descriptor = Object.getOwnPropertyDescriptor(environment, name)
    if (descriptor === undefined) continue
    if (!('value' in descriptor) || !descriptor.enumerable)
      throw new TypeError(`${name} must be an ordinary environment value`)
    const text: unknown = descriptor.value
    if (text === undefined) continue
    if (typeof text !== 'string' || !/^[1-9][0-9]*$/.test(text))
      throw new TypeError(`${name} must be a positive decimal integer`)
    Object.defineProperty(output, field, {
      value: requireDependencyPreparationLimit(Number(text), field, name),
      enumerable: true,
    })
  }
  return Object.freeze(output)
}

/** Operational review budgets: operator environment, then project, then defaults. */
export function resolvePrivateDependencyPreparationLimits(
  projectLimits?: JigLimits,
  environment: PrivateDependencyPreparationLimitEnvironment = {},
): PrivateResolvedDependencyPreparationLimits {
  if (utilTypes.isProxy(environment))
    throw new TypeError('dependency preparation environment must contain ordinary data')
  const overrides = snapshotJsonObject(environment, 'dependency preparation environment')
  for (const key of Object.keys(overrides))
    if (key !== 'maxPreparedBytes' && key !== 'maxPreparedFiles')
      throw new TypeError('dependency preparation environment contains an unsupported field')
  if (projectLimits !== undefined) {
    if (utilTypes.isProxy(projectLimits))
      throw new TypeError('project limits must contain ordinary data')
    const dependencies = Object.getOwnPropertyDescriptor(projectLimits, 'dependencies')
    if (dependencies && 'value' in dependencies && utilTypes.isProxy(dependencies.value))
      throw new TypeError('project dependency limits must contain ordinary data')
  }
  const project =
    projectLimits === undefined ? {} : (normalizeJigLimits(projectLimits).dependencies ?? {})
  const values = { ...DEFAULT_PROJECT_DEPENDENCY_LIMITS }
  const origins: Record<keyof ProjectDependencyLimits, LimitOrigin> = {
    maxPreparedBytes: 'default',
    maxPreparedFiles: 'default',
  }
  for (const field of ['maxPreparedBytes', 'maxPreparedFiles'] as const) {
    if (project[field] !== undefined) {
      values[field] = project[field]
      origins[field] = 'project'
    }
    if (Object.hasOwn(overrides, field)) {
      values[field] = requireDependencyPreparationLimit(
        overrides[field],
        field,
        DEPENDENCY_PREPARATION_LIMIT_POLICY.environment[field],
      )
      origins[field] = 'environment'
    }
  }
  return Object.freeze({
    limits: normalizeProjectDependencyLimits(values),
    origins: Object.freeze(origins),
  })
}
