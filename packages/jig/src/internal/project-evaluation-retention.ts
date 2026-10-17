import { createHash } from 'node:crypto'
import { types as utilTypes } from 'node:util'
import { canonicalJson, type JsonValue } from '../json.js'
import type { CapturedPackage } from '../package/capture.js'
import { normalizeProjectEvaluation, type ProjectEvaluation } from '../project/evaluation.js'
import type { GrantedSlot } from '../project/grants.js'
import {
  assertPrivateBunExecutionLayoutFiles,
  normalizePrivateBunExecutionLayout,
  type PrivateBunExecutionLayout,
} from './bun-execution-layout.js'
import type { PrivateFileLocation } from './descriptor-files.js'
import { privateDomainDigest } from './identity.js'
import {
  captureStoredPackage,
  normalizePackageArtifactRef,
  type PackageArtifactRef,
} from './package-artifact-store.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'
import {
  normalizePrivateProjectEvaluationCompiler,
  normalizePrivateProjectEvaluationRecipe,
  PROJECT_EVALUATION_LIMITS,
  type PrivateProjectEvaluationRecipe,
} from './project-evaluation-policy.js'

export interface PrivateRetainedProjectEvaluation {
  readonly recipe: PackageArtifactRef
  readonly dependencies: PackageArtifactRef
  readonly recipeDigest: string
  readonly dependencyDigest: string
  readonly layout: PrivateBunExecutionLayout
  readonly configuration: {
    readonly recipe: PrivateProjectEvaluationRecipe
    readonly compiler: Readonly<Record<string, unknown>>
  }
}

/** Host-linked grants retain reviewed operands without changing authoring policy. */
export interface PrivateRetainedGrantedSlot extends GrantedSlot {
  readonly evaluation?: PrivateRetainedProjectEvaluation
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    utilTypes.isProxy(value) ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    throw new TypeError('invalid retained evaluation metadata')
  const result: Record<string, unknown> = Object.create(null)
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key)
    if (!field || !Object.hasOwn(field, 'value') || !field.enumerable)
      throw new TypeError('invalid retained evaluation metadata')
    result[key] = field.value
  }
  return result
}

/** Decode effective policy, never a pathname or an executable capability. */
export function normalizePrivateRetainedProjectEvaluation(
  value: unknown,
): PrivateRetainedProjectEvaluation {
  const snapshot = snapshotPrivateOrdinaryJson(
    value,
    'retained evaluation',
    (message) => new TypeError(message),
  )
  const item = exact(snapshot, [
    'recipe',
    'dependencies',
    'recipeDigest',
    'dependencyDigest',
    'layout',
    'configuration',
  ])
  const configuration = exact(item.configuration, ['recipe', 'compiler'])
  const compiler = exact(configuration.compiler, ['compilerOptions', 'include', 'exclude'])
  const options = { ...exactCompilerOptions(compiler.compilerOptions) }
  const types = options.types
  delete options.rootDir
  delete options.outDir
  delete options.noEmitOnError
  delete options.incremental
  const normalized = normalizePrivateProjectEvaluationCompiler(
    { compilerOptions: options },
    new Set(Array.isArray(types) ? (types as string[]) : []),
  )
  if (
    Buffer.compare(
      canonicalJson(normalized as JsonValue),
      canonicalJson(configuration.compiler as JsonValue),
    ) !== 0
  )
    throw new TypeError('retained evaluation compiler is not canonical')
  for (const key of ['recipeDigest', 'dependencyDigest'])
    if (typeof item[key] !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(item[key] as string))
      throw new TypeError('invalid retained evaluation digest')
  return Object.freeze({
    recipe: normalizePackageArtifactRef(exact(item.recipe, ['kind', 'digest'])),
    dependencies: normalizePackageArtifactRef(exact(item.dependencies, ['kind', 'digest'])),
    recipeDigest: item.recipeDigest as string,
    dependencyDigest: item.dependencyDigest as string,
    layout: normalizePrivateBunExecutionLayout(item.layout),
    configuration: Object.freeze({
      recipe: normalizePrivateProjectEvaluationRecipe(configuration.recipe),
      compiler: normalized,
    }),
  })
}

function exactCompilerOptions(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    utilTypes.isProxy(value) ||
    Array.isArray(value)
  )
    throw new TypeError('invalid retained evaluation compiler')
  return exact(
    value,
    Reflect.ownKeys(value).map((key) => {
      if (typeof key !== 'string') throw new TypeError('invalid retained evaluation compiler')
      return key
    }),
  )
}

/** Authenticate already-held operands without reopening or borrowing mutable paths. */
export async function verifyPrivateRetainedProjectEvaluation(
  value: PrivateRetainedProjectEvaluation,
  policy: ProjectEvaluation,
  recipe: CapturedPackage,
  dependencies: CapturedPackage,
): Promise<void> {
  const metadata = normalizePrivateRetainedProjectEvaluation(value)
  const policySnapshot = snapshotPrivateOrdinaryJson(
    policy,
    'evaluation grant',
    (message) => new TypeError(message),
  )
  const authored = exact(policySnapshot, [
    'recipe',
    'attachments',
    ...(Object.hasOwn(policySnapshot as object, 'kind') ? ['kind'] : []),
  ])
  if (Object.hasOwn(authored, 'kind') && authored.kind !== 'evaluation')
    throw new TypeError('retained evaluation requires evaluation authority')
  const grant = normalizeProjectEvaluation({
    recipe: authored.recipe,
    attachments: authored.attachments,
  })
  if (
    recipe.digest !== metadata.recipe.digest ||
    dependencies.digest !== metadata.dependencies.digest
  )
    throw new TypeError('retained evaluation operands differ from their reviewed references')
  if (
    recipe.files.length > PROJECT_EVALUATION_LIMITS.recipeFiles ||
    recipe.files.reduce((sum, file) => sum + file.size, 0) > PROJECT_EVALUATION_LIMITS.recipeBytes
  )
    throw new TypeError('retained evaluation recipe exceeds its bounds')
  const recipeDigest = privateDomainDigest('JIG-Project-Evaluation-Recipe/1', {
    captureDigest: recipe.digest,
    grant,
    ...metadata.configuration,
    limits: PROJECT_EVALUATION_LIMITS,
  } as unknown as JsonValue)
  if (recipeDigest !== metadata.recipeDigest)
    throw new TypeError('retained evaluation recipe identity mismatch')
  assertPrivateBunExecutionLayoutFiles(metadata.layout, dependencies.files)
  const files = []
  for (const file of dependencies.files) {
    const hash = createHash('sha256')
    for await (const bytes of dependencies.stream(file.path)) hash.update(bytes)
    files.push({ path: file.path, bytes: file.size, digest: `sha256:${hash.digest('hex')}` })
  }
  if (
    files.length > PROJECT_EVALUATION_LIMITS.dependencyFiles ||
    files.reduce((sum, file) => sum + file.bytes, 0) > PROJECT_EVALUATION_LIMITS.dependencyBytes ||
    privateDomainDigest('JIG-Project-Evaluation-Dependencies/1', {
      files,
      layout: metadata.layout,
      classification: 'development-inclusive',
    } as unknown as JsonValue) !== metadata.dependencyDigest
  )
    throw new TypeError('retained evaluation dependency identity mismatch')
}

/** Reacquire both immutable operands and authenticate their complete reviewed identities. */
export async function openPrivateRetainedProjectEvaluation(
  store: PrivateFileLocation,
  value: PrivateRetainedProjectEvaluation,
  policy: ProjectEvaluation,
): Promise<{ recipe: CapturedPackage; dependencies: CapturedPackage; dispose(): Promise<void> }> {
  const metadata = normalizePrivateRetainedProjectEvaluation(value)
  const recipe = await captureStoredPackage(store, metadata.recipe)
  let dependencies: CapturedPackage | undefined
  try {
    dependencies = await captureStoredPackage(store, metadata.dependencies)
    await verifyPrivateRetainedProjectEvaluation(metadata, policy, recipe, dependencies)
    const retained = dependencies
    return {
      recipe,
      dependencies: retained,
      async dispose() {
        await Promise.all([recipe.dispose(), retained.dispose()])
      },
    }
  } catch (error) {
    await Promise.all([recipe.dispose(), dependencies?.dispose()])
    throw error
  }
}
