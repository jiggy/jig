import { randomBytes } from 'node:crypto'
import { type BigIntStats, constants } from 'node:fs'
import { type FileHandle, lstat } from 'node:fs/promises'
import { canonicalJson, decodeJson1, type JsonValue } from '../json.js'
import { type AcpGrant, grantName, normalizeGrant } from '../project/grants.js'
import { isProtectedProjectPath, normalizeProjectPath } from '../project/paths.js'
import { openPrivateProjectRoot, type PrivateProjectRoot } from '../project/root.js'
import {
  openPrivateChild,
  privateChildLocation,
  renamePrivateFile,
  statPrivateChild,
  unlinkPrivateFile,
} from './descriptor-files.js'

const MAXIMUM_BYTES = 32_768

/** One consented review correction; source provenance is captured before the prompt. */
export interface PrivateReviewGrantEdit {
  readonly path: string
  readonly expectedBytes: Uint8Array
  readonly projectIdentity: { readonly device: string; readonly inode: string }
  readonly previous: AcpGrant
  readonly proposed: AcpGrant
}

export type PrivateReviewGrantEditCode =
  | 'REVIEW_GRANT_INVALID'
  | 'REVIEW_GRANT_UNSAFE'
  | 'REVIEW_GRANT_CHANGED'
  | 'REVIEW_GRANT_CANCELLED'
  | 'REVIEW_GRANT_UNAVAILABLE'
  | 'REVIEW_GRANT_CLEANUP_FAILED'
  | 'REVIEW_GRANT_PUBLISHED_UNCERTAIN'

export class PrivateReviewGrantEditError extends Error {
  constructor(
    readonly code: PrivateReviewGrantEditCode,
    message: string,
    readonly published = false,
  ) {
    super(message)
    this.name = 'PrivateReviewGrantEditError'
  }
}

interface OpenedEntry {
  readonly parent: FileHandle
  readonly name: string
  readonly handle: FileHandle
  readonly information: BigIntStats
}

/** @internal Narrow deterministic fault injection; never a package export. */
export interface PrivateReviewGrantEditTestHooks {
  readonly checkpoint?: (
    phase: 'opened' | 'staged' | 'before-publish' | 'published' | 'cleanup',
    state: { readonly path: string; readonly stageName?: string },
  ) => Promise<void>
  readonly write?: (handle: FileHandle, bytes: Uint8Array) => Promise<void>
  readonly rename?: typeof renamePrivateFile
  readonly syncParent?: (parent: FileHandle) => Promise<void>
  readonly unlink?: typeof unlinkPrivateFile
}

/** Publish only the source correction consented during review, after its session closes. */
export async function publishReviewGrantEdit(
  project: string,
  correction: PrivateReviewGrantEdit,
  signal?: AbortSignal,
  testing: PrivateReviewGrantEditTestHooks = {},
): Promise<{ readonly path: string; readonly changed: boolean }> {
  const path = selectionPath(correction.path)
  const {
    previous,
    proposed: next,
    expectedBytes,
    projectIdentity,
  } = validateCorrection(correction)
  let root: PrivateProjectRoot | undefined
  const ancestors: OpenedEntry[] = []
  let original: OpenedEntry | undefined
  let staged: OpenedEntry | undefined
  let stageHandle: FileHandle | undefined
  let stageName: string | undefined
  let publicationAttempted = false
  let result: { readonly path: string; readonly changed: boolean } | undefined
  let failure: PrivateReviewGrantEditError | undefined
  try {
    checkCancellation(signal)
    root = await openPrivateProjectRoot(project)
    if (
      String(root.information.dev) !== projectIdentity.device ||
      String(root.information.ino) !== projectIdentity.inode
    )
      changed()
    let parent = root.handle
    const names = path.split('/')
    for (const name of names.slice(0, -1)) {
      checkCancellation(signal)
      const ancestor = await openEntry(parent, name, true)
      ancestors.push(ancestor)
      parent = ancestor.handle
    }
    const originalName = names.at(-1)
    if (originalName === undefined)
      invalid('REVIEW_GRANT_INVALID', 'Select an existing ACP JSON grant.')
    original = await openEntry(parent, originalName, false)
    const baseline = await readBounded(original)
    if (
      !baseline.equals(expectedBytes) ||
      !Buffer.from(canonicalJson(parsePolicy(baseline) as unknown as JsonValue)).equals(
        Buffer.from(canonicalJson(previous as unknown as JsonValue)),
      )
    )
      changed()
    const proposed = Buffer.from(`${JSON.stringify(next, null, 2)}\n`)
    if (proposed.byteLength > MAXIMUM_BYTES)
      invalid('REVIEW_GRANT_INVALID', 'The proposed grant exceeds 32 KiB.')
    const sourceDiffers = !Buffer.from(canonicalJson(previous as unknown as JsonValue)).equals(
      Buffer.from(canonicalJson(next as unknown as JsonValue)),
    )
    await testing.checkpoint?.('opened', { path })
    checkCancellation(signal)
    if (!sourceDiffers) {
      await verifySource(root, ancestors, original, baseline)
      checkCancellation(signal)
      result = Object.freeze({ path, changed: false })
    } else {
      for (let attempt = 0; attempt < 8; attempt++) {
        const name = `.jig-review-grant-${randomBytes(16).toString('hex')}.tmp`
        try {
          const handle = await openPrivateChild(
            parent,
            name,
            constants.O_RDWR |
              constants.O_CREAT |
              constants.O_EXCL |
              constants.O_NOFOLLOW |
              constants.O_NONBLOCK,
            0o600,
          )
          stageName = name
          stageHandle = handle
          staged = { parent, name, handle, information: await handle.stat({ bigint: true }) }
          break
        } catch (error) {
          if (errorCode(error) !== 'EEXIST') throw error
        }
      }
      if (staged === undefined || stageName === undefined) throw new Error('staging unavailable')
      checkCancellation(signal)
      if (testing.write) await testing.write(staged.handle, proposed)
      else await staged.handle.writeFile(proposed)
      await staged.handle.chmod(Number(original.information.mode & 0o7777n))
      await staged.handle.sync()
      await testing.checkpoint?.('staged', { path, stageName })
      checkCancellation(signal)
      await testing.checkpoint?.('before-publish', { path, stageName })
      checkCancellation(signal)
      await verifySource(root, ancestors, original, baseline)
      await verifyStaged(staged, stageName, proposed, original.information.mode)
      checkCancellation(signal)
      // Atomic rename is not filesystem CAS. A noncooperating writer can race
      // the final checks; an attempted rename is consequently an uncertain write.
      publicationAttempted = true
      await (testing.rename ?? renamePrivateFile)(
        privateChildLocation(parent, stageName),
        privateChildLocation(parent, original.name),
      )
      stageName = undefined
      await testing.checkpoint?.('published', { path })
      await (testing.syncParent ?? ((directory) => directory.sync()))(parent)
      await verifyDirectories(root, ancestors)
      await verifyStaged(staged, original.name, proposed, original.information.mode)
      result = Object.freeze({ path, changed: true })
    }
  } catch (error) {
    failure = publicationAttempted
      ? new PrivateReviewGrantEditError(
          'REVIEW_GRANT_PUBLISHED_UNCERTAIN',
          'The grant may already have changed. Inspect the selected source file before retrying; review is still required.',
          true,
        )
      : error instanceof PrivateReviewGrantEditError
        ? error
        : new PrivateReviewGrantEditError(
            'REVIEW_GRANT_UNAVAILABLE',
            'The grant could not be edited. Check the selected file and directory access; source publication was not attempted.',
          )
  } finally {
    let cleanupFailed = false
    if (stageHandle !== undefined && original !== undefined && stageName !== undefined) {
      try {
        await cleanupStage(stageHandle, original.parent, path, stageName, testing)
      } catch {
        cleanupFailed = true
      }
    }
    for (const handle of [
      stageHandle,
      original?.handle,
      ...ancestors.reverse().map((entry) => entry.handle),
    ]) {
      if (handle === undefined) continue
      try {
        await handle.close()
      } catch {
        cleanupFailed = true
      }
    }
    if (root !== undefined) {
      try {
        await root.dispose()
      } catch {
        cleanupFailed = true
      }
    }
    if (cleanupFailed) {
      failure = new PrivateReviewGrantEditError(
        'REVIEW_GRANT_CLEANUP_FAILED',
        `Grant editing cleanup did not complete. Inspect the selected directory before retrying.${publicationAttempted ? ' The grant may already have changed; review is still required.' : ' Source publication was not attempted.'}`,
        publicationAttempted,
      )
    }
  }
  if (failure !== undefined) throw failure
  if (result === undefined)
    throw new PrivateReviewGrantEditError(
      'REVIEW_GRANT_UNAVAILABLE',
      'The grant edit could not be confirmed.',
    )
  return result
}

async function cleanupStage(
  handle: FileHandle,
  parent: FileHandle,
  path: string,
  stageName: string,
  testing: PrivateReviewGrantEditTestHooks,
): Promise<void> {
  await testing.checkpoint?.('cleanup', { path, stageName })
  const leaf = await statPrivateChild(parent, stageName).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  })
  const owned = await handle.stat({ bigint: true })
  if (leaf !== undefined && (!leaf.isFile() || !sameIdentity(leaf, owned)))
    throw new Error('staging identity changed')
  // This check/unlink is not CAS either. Never remove an already unfamiliar leaf.
  if (leaf !== undefined)
    await (testing.unlink ?? unlinkPrivateFile)(privateChildLocation(parent, stageName))
}

function selectionPath(value: string): string {
  try {
    const path = normalizeProjectPath(value, 'grant path')
    if (isProtectedProjectPath(path) || !path.endsWith('.json')) throw new Error('unsafe path')
    grantName(path.split('/').at(-1)?.slice(0, -5))
    return path
  } catch {
    return invalid(
      'REVIEW_GRANT_INVALID',
      'Select a project-relative <LocalName>.json grant outside protected .jig state, without traversal.',
    )
  }
}

function validateCorrection(value: PrivateReviewGrantEdit): PrivateReviewGrantEdit {
  try {
    if (
      !(value.expectedBytes instanceof Uint8Array) ||
      value.expectedBytes.byteLength > MAXIMUM_BYTES ||
      !/^[0-9]{1,30}$/.test(value.projectIdentity.device) ||
      !/^[0-9]{1,30}$/.test(value.projectIdentity.inode)
    )
      throw new Error('invalid capture')
    const previous = normalizeGrant(value.previous)
    const proposed = normalizeGrant(value.proposed)
    if (
      previous.kind !== 'acp' ||
      proposed.kind !== 'acp' ||
      previous.maxTurns !== proposed.maxTurns ||
      (previous.retainSessions !== true && proposed.retainSessions === true)
    )
      throw new Error('unsupported policy change')
    const captured = parsePolicy(value.expectedBytes)
    if (
      !Buffer.from(canonicalJson(captured as unknown as JsonValue)).equals(
        Buffer.from(canonicalJson(previous as unknown as JsonValue)),
      )
    )
      throw new Error('capture policy mismatch')
    return {
      path: value.path,
      expectedBytes: Uint8Array.from(value.expectedBytes),
      projectIdentity: { ...value.projectIdentity },
      previous,
      proposed,
    }
  } catch {
    return invalid(
      'REVIEW_GRANT_INVALID',
      'The review correction must match its bounded captured ACP source and preserve the turn policy.',
    )
  }
}

function parsePolicy(bytes: Uint8Array): AcpGrant {
  try {
    const policy = normalizeGrant(decodeJson1(bytes))
    if (policy.kind !== 'acp') throw new Error('not ACP')
    return policy
  } catch {
    return invalid(
      'REVIEW_GRANT_INVALID',
      'The selected file must contain a valid, closed ACP JSON grant. Malformed or duplicate members are refused.',
    )
  }
}

async function openEntry(
  parent: FileHandle,
  name: string,
  directory: boolean,
): Promise<OpenedEntry> {
  let observed: BigIntStats
  try {
    observed = await statPrivateChild(parent, name)
  } catch (error) {
    if (errorCode(error) === 'ENOENT')
      invalid(
        'REVIEW_GRANT_CHANGED',
        'The captured grant or one of its parent directories is no longer present. Capture a fresh review before editing.',
      )
    throw error
  }
  requireEntry(observed, directory)
  const handle = await openPrivateChild(
    parent,
    name,
    constants.O_RDONLY |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK |
      (directory ? constants.O_DIRECTORY : 0),
  )
  try {
    const information = await handle.stat({ bigint: true })
    requireEntry(information, directory)
    if (signature(observed) !== signature(information)) changed()
    return { parent, name, handle, information }
  } catch (error) {
    await handle.close()
    throw error
  }
}

function requireEntry(information: BigIntStats, directory: boolean): void {
  if (directory ? !information.isDirectory() : !information.isFile() || information.nlink !== 1n)
    invalid(
      'REVIEW_GRANT_UNSAFE',
      'Grant paths must use real directories and a singly linked regular file; links and special files are refused.',
    )
}

async function readBounded(entry: OpenedEntry, source = true): Promise<Buffer> {
  const before = await entry.handle.stat({ bigint: true })
  requireEntry(before, false)
  if (before.size > BigInt(MAXIMUM_BYTES))
    invalid('REVIEW_GRANT_INVALID', 'The selected grant exceeds 32 KiB.')
  const bytes = Buffer.alloc(MAXIMUM_BYTES + 1)
  let length = 0
  while (length < bytes.length) {
    const result = await entry.handle.read(bytes, length, bytes.length - length, length)
    if (result.bytesRead === 0) break
    length += result.bytesRead
  }
  if (length > MAXIMUM_BYTES) invalid('REVIEW_GRANT_INVALID', 'The selected grant exceeds 32 KiB.')
  if (signature(before) !== signature(await entry.handle.stat({ bigint: true }))) {
    if (source) changed()
    invalid(
      'REVIEW_GRANT_UNSAFE',
      'The owned staging file changed; source publication cannot proceed.',
    )
  }
  return bytes.subarray(0, length)
}

async function verifyDirectories(
  root: PrivateProjectRoot,
  ancestors: readonly OpenedEntry[],
): Promise<void> {
  let pathname: BigIntStats
  try {
    pathname = await lstat(root.requestedPath, { bigint: true })
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(errorCode(error) ?? '')) changed()
    throw error
  }
  if (!pathname.isDirectory() || !sameIdentity(pathname, root.information)) changed()
  const currentRoot = await root.handle.stat({ bigint: true })
  if (
    !currentRoot.isDirectory() ||
    !sameIdentity(currentRoot, root.information) ||
    currentRoot.mode !== root.information.mode
  )
    changed()
  for (const entry of ancestors) {
    const leaf = await currentEntry(entry.parent, entry.name)
    const owned = await entry.handle.stat({ bigint: true })
    if (
      !leaf.isDirectory() ||
      !owned.isDirectory() ||
      !sameIdentity(leaf, entry.information) ||
      !sameIdentity(owned, entry.information) ||
      leaf.mode !== entry.information.mode ||
      owned.mode !== entry.information.mode
    )
      changed()
  }
}

async function verifySource(
  root: PrivateProjectRoot,
  ancestors: readonly OpenedEntry[],
  original: OpenedEntry,
  bytes: Buffer,
): Promise<void> {
  await verifyDirectories(root, ancestors)
  const leaf = await currentEntry(original.parent, original.name)
  if (
    signature(leaf) !== signature(original.information) ||
    signature(await original.handle.stat({ bigint: true })) !== signature(original.information)
  )
    changed()
  if (!bytes.equals(await readBounded(original))) changed()
  if (
    signature(await currentEntry(original.parent, original.name)) !==
    signature(original.information)
  )
    changed()
}

async function verifyStaged(
  staged: OpenedEntry,
  name: string,
  proposed: Buffer,
  originalMode: bigint,
): Promise<void> {
  const leaf = await currentEntry(staged.parent, name, false)
  const owned = await staged.handle.stat({ bigint: true })
  requireEntry(leaf, false)
  requireEntry(owned, false)
  if (
    !sameIdentity(leaf, staged.information) ||
    !sameIdentity(owned, staged.information) ||
    signature(leaf) !== signature(owned) ||
    (owned.mode & 0o7777n) !== (originalMode & 0o7777n) ||
    !proposed.equals(await readBounded(staged, false))
  )
    invalid(
      'REVIEW_GRANT_UNSAFE',
      'The owned staging file changed; source publication cannot proceed.',
    )
  if (signature(await currentEntry(staged.parent, name, false)) !== signature(owned))
    invalid(
      'REVIEW_GRANT_UNSAFE',
      'The owned staging file changed; source publication cannot proceed.',
    )
}

async function currentEntry(parent: FileHandle, name: string, source = true): Promise<BigIntStats> {
  try {
    return await statPrivateChild(parent, name)
  } catch (error) {
    if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(errorCode(error) ?? '')) {
      if (source) changed()
      invalid(
        'REVIEW_GRANT_UNSAFE',
        'The owned staging file changed; source publication cannot proceed.',
      )
    }
    throw error
  }
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function signature(value: BigIntStats): string {
  return [
    value.dev,
    value.ino,
    value.mode,
    value.nlink,
    value.size,
    value.mtimeNs,
    value.ctimeNs,
  ].join(':')
}

function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new PrivateReviewGrantEditError(
      'REVIEW_GRANT_CANCELLED',
      'Grant editing was cancelled before source publication.',
    )
}

function changed(): never {
  return invalid(
    'REVIEW_GRANT_CHANGED',
    'The selected source, parent directory or staged file changed during editing. Inspect it before retrying.',
  )
}

function invalid(code: PrivateReviewGrantEditCode, message: string): never {
  throw new PrivateReviewGrantEditError(code, message)
}

function errorCode(error: unknown): string | undefined {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined
}
