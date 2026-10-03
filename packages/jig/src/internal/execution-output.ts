import type { FileHandle } from 'node:fs/promises'
import type { PrivateCapturedOutput } from './captured-output.js'

/** Closed native storage lifetimes. Read only after execution enforcement settles. */
export type PrivateExecutionOutput =
  | { readonly kind: 'linux-directory'; readonly directory: FileHandle }
  | { readonly kind: 'snapshot'; readonly ready: Promise<PrivateCapturedOutput> }

export function privateSnapshotExecutionOutput(
  ready: Promise<PrivateCapturedOutput>,
): Extract<PrivateExecutionOutput, { kind: 'snapshot' }> {
  // Capture can fail before a terminal reaches its consumer. Preserve the
  // rejection for collection without reporting an unhandled promise meanwhile.
  void ready.catch(() => {})
  return Object.freeze({ kind: 'snapshot', ready })
}

export async function resolvePrivateExecutionOutput(
  output: PrivateExecutionOutput,
): Promise<FileHandle | PrivateCapturedOutput> {
  return output.kind === 'linux-directory' ? output.directory : output.ready
}

export async function closePrivateExecutionOutput(output?: PrivateExecutionOutput): Promise<void> {
  if (output === undefined) return
  if (output.kind === 'linux-directory') return output.directory.close()
  // A rejected capture owns no snapshot. Its collection failure is separate
  // from cleanup; the backend must independently settle storage before completion.
  const capture = await output.ready.catch(() => undefined)
  capture?.close()
}
