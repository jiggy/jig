/** Closed native projection recipe, not an application-controlled workspace API. */
export interface PrivateProjectEvaluationWorkspace {
  readonly phase: 'generate' | 'compile' | 'test'
  readonly emptyDirectories: readonly string[]
}

export function normalizePrivateProjectEvaluationWorkspace(
  value: unknown,
): PrivateProjectEvaluationWorkspace | undefined {
  if (value === undefined || value === null) return undefined
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== 'emptyDirectories,phase' ||
    !('phase' in value) ||
    !['generate', 'compile', 'test'].includes(value.phase as string) ||
    !('emptyDirectories' in value) ||
    !Array.isArray(value.emptyDirectories) ||
    value.emptyDirectories.length > 256
  )
    throw new TypeError('invalid closed evaluation workspace')
  const phase = value.phase as PrivateProjectEvaluationWorkspace['phase']
  const fresh = privateEvaluationWritableRoots({ phase, emptyDirectories: [] })
  let prior: string | undefined
  for (const path of value.emptyDirectories) {
    if (
      typeof path !== 'string' ||
      Buffer.byteLength(path) > 256 ||
      !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) ||
      path.split('/').length > 16 ||
      path.split('/').some((part) => part === '.' || part === '..') ||
      ['.git', '.jig', 'node_modules', 'scratch', '.jig-evaluation.json', ...fresh].includes(
        path.split('/')[0]!,
      ) ||
      (prior !== undefined && Buffer.compare(Buffer.from(prior), Buffer.from(path)) >= 0)
    )
      throw new TypeError('invalid evaluation empty directory metadata')
    prior = path
  }
  return Object.freeze({ phase, emptyDirectories: Object.freeze([...value.emptyDirectories]) })
}

export const PRIVATE_EVALUATION_WORKSPACE_PATH = '/jig-evaluation'

export function privateEvaluationWritableRoots(
  workspace: PrivateProjectEvaluationWorkspace,
): readonly ('generated' | 'dist' | 'reports')[] {
  return workspace.phase === 'generate'
    ? ['generated', 'reports']
    : workspace.phase === 'compile'
      ? ['dist']
      : ['reports']
}
