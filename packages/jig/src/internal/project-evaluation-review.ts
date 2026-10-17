import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import type { JsonValue } from '../json.js'
import type { CapturedPackage } from '../package/capture.js'
import { validateLogicalPath } from '../package/paths.js'
import { normalizeProjectEvaluation, type ProjectEvaluation } from '../project/evaluation.js'
import type { PrivateBunExecutionLayout } from './bun-execution-layout.js'
import { preparePrivateBunPackage } from './bun-native-preparation.js'
import { privateDomainDigest } from './identity.js'
import {
  normalizePrivateProjectEvaluationCompiler,
  normalizePrivateProjectEvaluationRecipe,
  PROJECT_EVALUATION_LIMITS,
  type PrivateProjectEvaluationRecipe,
} from './project-evaluation-policy.js'

export interface PrivateReviewedProjectEvaluation {
  readonly grant: ProjectEvaluation
  readonly recipe: PrivateProjectEvaluationRecipe
  readonly compiler: Readonly<Record<string, unknown>>
  readonly recipeDigest: string
  readonly dependencyDigest: string
  readonly captured: CapturedPackage
  readonly prepared: CapturedPackage
  readonly layout: PrivateBunExecutionLayout
}

/** Reuses the existing native preparer and its durable cleanup owner. No candidate executes here. */
export async function reviewPrivateProjectEvaluation(
  input: Omit<
    Parameters<typeof preparePrivateBunPackage>[0],
    'mode' | 'workspace' | 'allowResolutionNetwork'
  > & {
    readonly grant: ProjectEvaluation
  },
): Promise<PrivateReviewedProjectEvaluation> {
  const grant = normalizeProjectEvaluation(input.grant)
  const captured = input.captured
  if (
    captured.files.length > PROJECT_EVALUATION_LIMITS.recipeFiles ||
    captured.files.reduce((sum, file) => sum + file.size, 0) > PROJECT_EVALUATION_LIMITS.recipeBytes
  )
    throw new TypeError('evaluation recipe capture exceeds its finite profile')
  for (const required of ['evaluation.json', 'package.json', 'bun.lock', 'tsconfig.json'])
    if (!captured.files.some(({ path }) => path === required))
      throw new TypeError(
        'evaluation requires captured recipe, manifest, lock and compiler configuration',
      )
  const json = async (source: CapturedPackage, path: string) =>
    JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        await source.read(path, PROJECT_EVALUATION_LIMITS.recipeBytes),
      ),
    ) as Record<string, unknown>
  const recipe = normalizePrivateProjectEvaluationRecipe(await json(captured, 'evaluation.json'))
  const prepared = await preparePrivateBunPackage({ ...input, mode: 'evaluation' })
  try {
    const visited = new Set<string>()
    const configuration = async (path: string, depth: number): Promise<Record<string, unknown>> => {
      if (depth > 4 || visited.has(path))
        throw new TypeError('evaluation compiler inheritance is cyclic or exceeds four parents')
      visited.add(path)
      const source = path.startsWith('node_modules/') ? prepared.captured : captured
      const authored = await json(source, path)
      if (Object.keys(authored).some((key) => !['extends', 'compilerOptions'].includes(key)))
        throw new TypeError('unsupported evaluation compiler configuration')
      let inherited: Record<string, unknown> = {}
      if (authored.extends !== undefined) {
        const parent = authored.extends
        if (typeof parent !== 'string' || !parent.endsWith('.json'))
          throw new TypeError('evaluation compiler parent must name an exact captured JSON file')
        const resolved = parent.startsWith('./')
          ? posix.normalize(posix.join(posix.dirname(path), parent))
          : parent.startsWith('node_modules/')
            ? parent
            : `node_modules/${parent}`
        validateLogicalPath(resolved)
        if (
          Buffer.byteLength(resolved) > 256 ||
          resolved.split('/').length > 16 ||
          !/^[A-Za-z0-9_@./-]+$/.test(resolved)
        )
          throw new TypeError('evaluation compiler parent path exceeds its closed profile')
        inherited = await configuration(resolved, depth + 1)
      }
      const own = authored.compilerOptions ?? {}
      if (own === null || typeof own !== 'object' || Array.isArray(own))
        throw new TypeError('evaluation compiler options must be an object')
      return { ...inherited, ...(own as Record<string, unknown>) }
    }
    const manifest = await json(captured, 'package.json')
    const types = new Set<string>()
    for (const field of ['dependencies', 'devDependencies'])
      for (const name of Object.keys((manifest[field] ?? {}) as object)) {
        types.add(name)
        if (name.startsWith('@types/')) types.add(name.slice('@types/'.length))
      }
    const compiler = normalizePrivateProjectEvaluationCompiler(
      { compilerOptions: await configuration('tsconfig.json', 0) },
      types,
    )
    if (
      captured.files.some(
        ({ path }) =>
          !['evaluation.json', 'package.json', 'bun.lock'].includes(path) && !visited.has(path),
      )
    )
      throw new TypeError('evaluation recipe capture contains unselected configuration or source')
    const files = []
    for (const file of prepared.captured.files) {
      const hash = createHash('sha256')
      for await (const bytes of prepared.captured.stream(file.path)) hash.update(bytes)
      files.push({ path: file.path, bytes: file.size, digest: `sha256:${hash.digest('hex')}` })
    }
    return Object.freeze({
      grant,
      recipe,
      compiler,
      captured,
      prepared: prepared.captured,
      layout: prepared.layout,
      recipeDigest: privateDomainDigest('JIG-Project-Evaluation-Recipe/1', {
        captureDigest: captured.digest,
        grant,
        recipe,
        compiler,
        limits: PROJECT_EVALUATION_LIMITS,
      } as unknown as JsonValue),
      dependencyDigest: privateDomainDigest('JIG-Project-Evaluation-Dependencies/1', {
        files,
        layout: prepared.layout,
        classification: 'development-inclusive',
      } as unknown as JsonValue),
    })
  } catch (error) {
    await prepared.captured.dispose()
    throw error
  }
}
