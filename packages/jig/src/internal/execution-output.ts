import type { FileHandle } from 'node:fs/promises'
import type { PrivateCapturedOutput } from './captured-output.js'

/** Original output custody could not be retired; callers must preserve uncertainty. */
export class PrivateOutputRetirementUnconfirmedError extends Error {
  constructor(cause: unknown) {
    super('native output retirement could not be confirmed', { cause })
  }
}

const closingDirectories = new WeakMap<FileHandle, Promise<void>>()
const retainedDirectories = new Set<FileHandle>()
const closingCaptures = new WeakMap<PrivateCapturedOutput, Promise<void>>()
const retainedCaptures = new Set<PrivateCapturedOutput>()

function closeDirectory(directory: FileHandle): Promise<void> {
  const existing = closingDirectories.get(directory)
  if (existing !== undefined) return existing
  retainedDirectories.add(directory)
  const closing = (async () => {
    try {
      await directory.close()
    } catch (cause) {
      throw new PrivateOutputRetirementUnconfirmedError(cause)
    }
    retainedDirectories.delete(directory)
  })()
  closingDirectories.set(directory, closing)
  return closing
}

function closeCapture(capture: PrivateCapturedOutput): Promise<void> {
  const existing = closingCaptures.get(capture)
  if (existing !== undefined) return existing
  retainedCaptures.add(capture)
  const closing = (async () => {
    try {
      capture.close()
    } catch (cause) {
      throw new PrivateOutputRetirementUnconfirmedError(cause)
    }
    retainedCaptures.delete(capture)
  })()
  closingCaptures.set(capture, closing)
  return closing
}

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

export function closePrivateExecutionOutput(output?: PrivateExecutionOutput): Promise<void> {
  if (output === undefined) return Promise.resolve()
  if (output.kind === 'linux-directory') return closeDirectory(output.directory)
  // A rejected capture owns no snapshot. Its collection failure is separate
  // from cleanup; the backend must independently settle storage before completion.
  return output.ready
    .catch(() => undefined)
    .then((capture) => (capture === undefined ? undefined : closeCapture(capture)))
}
