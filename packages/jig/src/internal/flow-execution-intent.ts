import type { PrivateDirectRunRecipe } from './direct-run.js'
import {
  type PrivateExecutionIntent,
  privateExecutionFileProjections,
  privateExecutionPath,
} from './execution-intent.js'

export function privateFlowExecutionIntent(
  recipe: PrivateDirectRunRecipe,
  packageRoot: string,
  runId: string,
  deadlineUnixMs: number,
  cancellationGraceMs: number,
  maxOutputBytes: number,
  files?: Pick<PrivateExecutionIntent, 'capturedInputs' | 'inputDirectories' | 'output'>,
): PrivateExecutionIntent {
  return {
    runId,
    limits: { ...recipe.resourceCeilings, deadlineUnixMs, cancellationGraceMs },
    command: [
      privateExecutionPath(recipe.command[0]),
      ...recipe.command
        .slice(1)
        .map((value) =>
          value === recipe.sandboxExecutablePath ||
          value === recipe.installedSupport.sandboxMarkdownRuntimePath ||
          value === recipe.packageDestination ||
          value.startsWith(`${recipe.packageDestination}/`)
            ? privateExecutionPath(value)
            : value,
        ),
    ],
    projections: [
      ...privateExecutionFileProjections(recipe.runtimeMounts),
      ...(recipe.request.entrypoint.suffix === 'md' &&
      recipe.installedSupport.descriptorBridgePath !== null
        ? [
            {
              source: recipe.installedSupport.descriptorBridgePath,
              destination: recipe.installedSupport.descriptorBridgePath,
              kind: 'file' as const,
            },
          ]
        : []),
      { source: packageRoot, destination: recipe.packageDestination, kind: 'tree' },
    ],
    ...files,
    storageBytes: 512 * 1024 * 1024,
    maxOutputBytes,
  }
}
