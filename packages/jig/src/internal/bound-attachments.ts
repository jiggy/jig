import { closeSync, fstatSync, readFileSync } from 'node:fs'
import { invalid } from '../diagnostics.js'
import { type CapturedPackage, createCapturedPackage } from '../package/capture.js'
import { packageDigest } from '../package/digest.js'
import { normalizeBindingAttachments } from '../project/author.js'
import type { PrivateProjectRoot } from '../project/root.js'
import type { PrivateFileLocation } from './descriptor-files.js'
import {
  type PrivateCapturedAttachment,
  PrivateFileInputError,
  privateCaptureAttachments,
  privateOpenFileRoot,
  privateSealedBytes,
  sha256,
} from './linux-file-input.js'
import {
  captureStoredPackage,
  normalizePackageArtifactRef,
  publishCapturedPackage,
} from './package-artifact-store.js'
import { normalizePrivateRunFileIdentity } from './root-run-files.js'

export interface BoundAttachment {
  readonly source: string
  readonly digest: string
  readonly files: readonly {
    readonly path: string
    readonly bytes: number
    readonly digest: string
  }[]
}
export type BoundAttachments = Readonly<Record<string, BoundAttachment>>

export function normalizeBoundAttachments(value: unknown): BoundAttachments {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length > 8
  )
    throw new TypeError('invalid retained Binding attachments')
  const output: Record<string, BoundAttachment> = Object.create(null)
  for (const name of Object.keys(value).sort()) {
    const item = (value as Record<string, BoundAttachment>)[name]!
    if (
      item === null ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      Object.keys(item).sort().join(',') !== 'digest,files,source'
    )
      throw new TypeError('invalid retained Binding attachment')
    const source = normalizeBindingAttachments({ [name]: item.source })[name]!
    const { digest } = normalizePackageArtifactRef({ kind: 'flow-package/0', digest: item.digest })
    const identity = normalizePrivateRunFileIdentity({
      attachments: [{ name, files: item.files }],
      output: null,
    })
    output[name] = Object.freeze({ source, digest, files: identity.attachments[0]!.files })
  }
  normalizePrivateRunFileIdentity({
    attachments: Object.entries(output).map(([name, item]) => ({ name, files: item.files })),
    output: null,
  })
  return Object.freeze(output)
}

/** Same bounded, no-link file capture as --attach, anchored to the reviewed project. */
export async function captureBoundAttachments(
  root: PrivateProjectRoot,
  selections: Readonly<Record<string, string>>,
  storeRoot: PrivateFileLocation,
): Promise<BoundAttachments> {
  const sources = normalizeBindingAttachments(selections)
  let parent: number | undefined
  try {
    parent = privateOpenFileRoot(root.requestedPath)
    const info = fstatSync(parent, { bigint: true })
    if (info.dev !== root.information.dev || info.ino !== root.information.ino)
      throw new TypeError('project identity changed before attachment capture')
    const capture = privateCaptureAttachments(
      Object.entries(sources).map(([name, directory]) => ({ name, directory, select: [] })),
      parent,
    )
    try {
      const output: Record<string, BoundAttachment> = Object.create(null)
      for (const item of capture.attachments) {
        const byPath = new Map(item.files.map((file) => [file.path, file]))
        const files = item.files.map(({ path, bytes }) => ({ path, size: bytes }))
        const backing = {
          async *stream(path: string, maximumBytes = Infinity) {
            const file = byPath.get(path)!
            yield readFileSync(`/proc/self/fd/${file.fd}`).subarray(0, maximumBytes)
          },
          async dispose() {},
        }
        const digest = await packageDigest(files, (file) => backing.stream(file.path))
        const captured = createCapturedPackage(`attachment ${item.name}`, files, digest, backing)
        const stored = await publishCapturedPackage(storeRoot, captured)
        output[item.name] = {
          source: sources[item.name]!,
          digest: stored.digest,
          files: item.files.map(({ path, bytes, digest }) => ({ path, bytes, digest })),
        }
      }
      await root.verify()
      return normalizeBoundAttachments(output)
    } finally {
      capture.close()
    }
  } catch (error) {
    return invalid(
      'PROJECT_BINDING_ATTACHMENTS_INVALID',
      error instanceof PrivateFileInputError
        ? error.message
        : 'cannot capture the selected Binding files; use stable, bounded project directories without links or protected state',
    )
  } finally {
    if (parent !== undefined) closeSync(parent)
  }
}

export async function verifyBoundAttachment(
  captured: CapturedPackage,
  expected: BoundAttachment,
): Promise<void> {
  if (captured.digest !== expected.digest || captured.files.length !== expected.files.length)
    throw new TypeError('retained attachment identity mismatch')
  for (const file of expected.files) {
    if (
      !captured.files.some(({ path, size }) => path === file.path && size === file.bytes) ||
      sha256(await captured.read(file.path, file.bytes)) !== file.digest
    )
      throw new TypeError('retained attachment contents mismatch')
  }
}

/** Reopen admitted bytes only. The original paths are never consulted by execution. */
export async function openBoundAttachments(
  storeRoot: PrivateFileLocation,
  value: BoundAttachments = {},
): Promise<{
  readonly attachments: readonly Omit<PrivateCapturedAttachment, 'rootFd'>[]
  close(): void
}> {
  const bindings = normalizeBoundAttachments(value)
  const attachments: Omit<PrivateCapturedAttachment, 'rootFd'>[] = []
  const opened: number[] = []
  const close = () => {
    for (const fd of opened.splice(0)) closeSync(fd)
  }
  try {
    for (const [name, item] of Object.entries(bindings)) {
      const captured = await captureStoredPackage(
        storeRoot,
        normalizePackageArtifactRef({ kind: 'flow-package/0', digest: item.digest }),
      )
      try {
        await verifyBoundAttachment(captured, item)
        const files = []
        for (const file of item.files) {
          const fd = privateSealedBytes(await captured.read(file.path, file.bytes))
          opened.push(fd)
          files.push({ ...file, fd })
        }
        attachments.push({ name, files })
      } finally {
        await captured.dispose()
      }
    }
    return { attachments, close }
  } catch (error) {
    close()
    invalid(
      'RUN_BOUND_ATTACHMENTS_UNAVAILABLE',
      'reviewed attachment bytes are missing or invalid; review the project again',
    )
  }
}
