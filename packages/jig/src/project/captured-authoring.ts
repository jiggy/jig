import { invalid } from '../diagnostics.js'
import { privateProfileSpan } from '../internal/private-profile.js'
import type { JigDefinition } from './author.js'
import {
  type EvaluatedAuthorDeclaration,
  evaluateAuthorClosure,
  evaluateAuthorClosureBatch,
  type PrivateAuthorEvaluatorOptions,
} from './author-evaluator.js'
import { type CapturedAuthorClosure, captureOpenedAuthorClosure } from './author-module.js'
import { captureDeclarationSource } from './declaration-source.js'
import type { PrivateProjectRoot } from './root.js'

/** Shared captured declaration evaluation. Owns no approval, preparation or project state. */
export async function captureProjectAuthoring(
  root: PrivateProjectRoot,
  evaluator: PrivateAuthorEvaluatorOptions,
  signal?: AbortSignal,
) {
  const entry = 'jig.ts'
  let bootstrap: CapturedAuthorClosure | undefined
  let closure: CapturedAuthorClosure | undefined
  try {
    const bootstrapClosure = await captureOpenedAuthorClosure(root, [entry])
    bootstrap = bootstrapClosure
    const bootstrapProject = (await privateProfileSpan('author-configuration-evaluation', () =>
      evaluateAuthorClosure(evaluator, bootstrapClosure, entry, 'project', signal),
    )) as EvaluatedAuthorDeclaration<JigDefinition>

    const bindingSource = await captureDeclarationSource(root, bootstrapProject.value.bindings)
    const capturedClosure = await captureOpenedAuthorClosure(root, [
      entry,
      ...bindingSource.members.map(({ projectPath }) => projectPath),
    ])
    closure = capturedClosure
    assertBootstrapPreserved(bootstrapClosure, capturedClosure)
    const evaluations = await privateProfileSpan('author-configuration-evaluation', () =>
      evaluateAuthorClosureBatch(
        evaluator,
        capturedClosure,
        [
          { entryProjectPath: entry, expected: 'project' },
          ...bindingSource.members.map(({ projectPath }) => ({
            entryProjectPath: projectPath,
            expected: 'binding' as const,
          })),
        ],
        signal,
      ),
    )
    const project = evaluations[0] as EvaluatedAuthorDeclaration<JigDefinition>
    if (project.outputDigest !== bootstrapProject.outputDigest) {
      invalid(
        'PROJECT_SOURCE_CHANGED',
        'project definition changed while its complete declaration closure was captured',
        entry,
      )
    }

    await bindingSource.verify()
    await root.verify()
    return {
      bootstrap: bootstrapClosure,
      closure: capturedClosure,
      bindingSource,
      project,
      evaluations,
    }
  } catch (error) {
    bootstrap?.dispose()
    closure?.dispose()
    throw error
  }
}

function assertBootstrapPreserved(
  bootstrap: CapturedAuthorClosure,
  complete: CapturedAuthorClosure,
): void {
  const completeByPath = new Map(complete.modules.map((module) => [module.projectPath, module]))
  for (const module of bootstrap.modules) {
    const current = completeByPath.get(module.projectPath)
    const mismatch =
      current === undefined
        ? 'missing module'
        : current.sourceBytes !== module.sourceBytes
          ? 'byte count'
          : current.sourceDigest !== module.sourceDigest
            ? 'content digest'
            : !sameImports(current.imports, module.imports)
              ? 'import edges'
              : undefined
    if (mismatch !== undefined) {
      invalid(
        'PROJECT_SOURCE_CHANGED',
        `project declaration closure changed during source expansion (${mismatch})`,
        module.projectPath,
      )
    }
  }
}

function sameImports(
  left: readonly { readonly specifier: string; readonly projectPath: string }[],
  right: readonly { readonly specifier: string; readonly projectPath: string }[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (edge, index) =>
        edge.specifier === right[index]!.specifier &&
        edge.projectPath === right[index]!.projectPath,
    )
  )
}
