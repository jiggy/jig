import { projectCommandPath } from '../project/commands.js'

export const PROJECT_EVALUATION_LIMITS = Object.freeze({
  candidateFiles: 64,
  candidateBytes: 8 * 1024 * 1024,
  recipeFiles: 32,
  recipeBytes: 4 * 1024 * 1024,
  dependencyFiles: 8192,
  dependencyBytes: 128 * 1024 * 1024,
  outputFiles: 64,
  outputBytes: 8 * 1024 * 1024,
  outputFileBytes: 2 * 1024 * 1024,
  memoryBytes: 512 * 1024 * 1024,
  pids: 64,
  cpuQuotaMicros: 50_000,
  cpuPeriodMicros: 100_000,
  scratchBytes: 512 * 1024 * 1024,
  timeoutMs: 60_000,
  generateMs: 15_000,
  compileMs: 30_000,
  testMs: 15_000,
  drainBytes: 16 * 1024 * 1024,
  retainedStreamBytes: 64 * 1024,
  cancellationGraceMs: 1000,
  cleanupTimeoutMs: 5000,
})
export type EvaluationOutputRoot = 'generated' | 'dist' | 'reports'
export interface PrivateProjectEvaluationRecipe {
  readonly family: 'bun-typescript'
  readonly generate?: string
  readonly test: readonly string[]
  readonly collect: readonly EvaluationOutputRoot[]
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('evaluation policy must be an object')
  return value as Record<string, unknown>
}

/** Closed family configuration, deliberately not a step or shell language. */
export function normalizePrivateProjectEvaluationRecipe(
  value: unknown,
): PrivateProjectEvaluationRecipe {
  const item = record(value)
  if (
    Object.keys(item).some((key) => !['family', 'generate', 'test', 'collect'].includes(key)) ||
    item.family !== 'bun-typescript' ||
    !Array.isArray(item.test) ||
    item.test.length < 1 ||
    item.test.length > 16
  )
    throw new TypeError('unsupported evaluation recipe')
  const test = item.test.map(projectCommandPath)
  if (new Set(test).size !== test.length || test.some((path) => !/\.test\.(ts|js)$/.test(path)))
    throw new TypeError('evaluation requires exact distinct test paths')
  const generate = item.generate === undefined ? undefined : projectCommandPath(item.generate)
  if (generate !== undefined && !/\.(ts|js)$/.test(generate))
    throw new TypeError('evaluation generator must be JavaScript or TypeScript')
  const roots = item.collect ?? ['generated', 'dist', 'reports']
  if (
    !Array.isArray(roots) ||
    roots.length > 3 ||
    roots.some((root) => !['generated', 'dist', 'reports'].includes(root)) ||
    new Set(roots).size !== roots.length
  )
    throw new TypeError('evaluation collection selects fixed output roots')
  return Object.freeze({
    family: 'bun-typescript',
    ...(generate === undefined ? {} : { generate }),
    test: Object.freeze(test),
    collect: Object.freeze([...roots]) as readonly EvaluationOutputRoot[],
  })
}

const BOOLEAN_OPTIONS = [
  'strict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'skipLibCheck',
  'declaration',
  'sourceMap',
] as const

/** Input is the already captured and flattened configuration, not candidate config. */
export function normalizePrivateProjectEvaluationCompiler(
  value: unknown,
  reviewedTypes: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  const config = record(value)
  if (Object.keys(config).some((key) => key !== 'compilerOptions'))
    throw new TypeError('unsupported evaluation compiler configuration')
  const options = record(config.compilerOptions ?? {})
  if (
    Object.keys(options).some(
      (key) =>
        ![...BOOLEAN_OPTIONS, 'target', 'module', 'moduleResolution', 'lib', 'types'].includes(key),
    )
  )
    throw new TypeError('unsupported evaluation compiler option')
  for (const key of BOOLEAN_OPTIONS)
    if (options[key] !== undefined && typeof options[key] !== 'boolean')
      throw new TypeError('evaluation compiler flag must be boolean')
  if (
    (options.target !== undefined && !['ES2022', 'ESNext'].includes(options.target as string)) ||
    (options.module !== undefined && options.module !== 'ESNext') ||
    (options.moduleResolution !== undefined && options.moduleResolution !== 'Bundler')
  )
    throw new TypeError('unsupported evaluation compiler mode')
  const list = (key: 'lib' | 'types', allowed: ReadonlySet<string>) => {
    if (options[key] === undefined) return
    const value = options[key]
    if (
      !Array.isArray(value) ||
      value.some((entry) => typeof entry !== 'string' || !allowed.has(entry)) ||
      new Set(value).size !== value.length
    )
      throw new TypeError('unsupported evaluation compiler package or library')
  }
  list('lib', new Set(['ES2022', 'ESNext', 'DOM']))
  list('types', reviewedTypes)
  return Object.freeze({
    compilerOptions: Object.freeze({
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      ...options,
      ...(options.lib === undefined ? {} : { lib: Object.freeze([...(options.lib as string[])]) }),
      ...(options.types === undefined
        ? {}
        : { types: Object.freeze([...(options.types as string[])]) }),
      rootDir: '.',
      outDir: 'dist',
      noEmitOnError: true,
      incremental: false,
    }),
    include: Object.freeze(['src/**/*.ts', 'tools/**/*.ts', 'test/**/*.ts', 'generated/**/*.ts']),
    exclude: Object.freeze(['node_modules', 'scratch', 'dist']),
  })
}

/** Only domain input is accepted here; attachment authority belongs to the common host owner. */
export function requirePrivateProjectEvaluationInput(value: unknown): void {
  if (Object.keys(record(value)).length !== 0)
    throw new TypeError('evaluation input must be exactly an empty object')
}
