import { randomBytes } from 'node:crypto'
import { type BigIntStats, constants } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import {
  openPrivateChild,
  privateChildLocation,
  renamePrivateFile,
  statPrivateChild,
  unlinkPrivateFile,
} from './internal/descriptor-files.js'
import { canonicalJson, decodeJson1, type JsonValue } from './json.js'
import { type AcpGrant, grantName, normalizeGrant } from './project/grants.js'
import { isProtectedProjectPath, normalizeProjectPath } from './project/paths.js'
import { openPrivateProjectRoot, type PrivateProjectRoot } from './project/root.js'

const MAXIMUM_BYTES = 32_768

export interface ProjectAgentSelection {
  readonly client: AcpGrant['client']
  readonly model?: string
  /** Remove the grant pin; effective defaults remain operator-owned. */
  readonly defaultModel?: boolean
}

export type ProjectAgentErrorCode =
  | 'JIG_AGENT_INVALID'
  | 'JIG_AGENT_MISSING'
  | 'JIG_AGENT_UNSAFE'
  | 'JIG_AGENT_MODEL_REQUIRED'
  | 'JIG_AGENT_RETENTION'
  | 'JIG_AGENT_CHANGED'
  | 'JIG_AGENT_CANCELLED'
  | 'JIG_AGENT_UNAVAILABLE'
  | 'JIG_AGENT_CLEANUP_FAILED'
  | 'JIG_AGENT_PUBLISHED_UNCERTAIN'

export class ProjectAgentError extends Error {
  constructor(
    readonly kind: 'invalid' | 'unavailable',
    readonly code: ProjectAgentErrorCode,
    message: string,
    readonly published = false,
  ) {
    super(message)
    this.name = 'ProjectAgentError'
  }
}

export interface ProjectAgentResult {
  readonly path: string
  readonly previous: AcpGrant
  readonly next: AcpGrant
  readonly changed: boolean
}

interface OpenedEntry {
  readonly parent: FileHandle
  readonly name: string
  readonly handle: FileHandle
  readonly information: BigIntStats
}

/** @internal Narrow deterministic fault injection; never a package export. */
export interface ProjectAgentTestHooks {
  readonly checkpoint?: (
    phase: 'opened' | 'staged' | 'before-publish' | 'published' | 'cleanup',
    state: { readonly path: string; readonly stageName?: string },
  ) => Promise<void>
  readonly write?: (handle: FileHandle, bytes: Uint8Array) => Promise<void>
  readonly rename?: typeof renamePrivateFile
  readonly syncParent?: (parent: FileHandle) => Promise<void>
  readonly unlink?: typeof unlinkPrivateFile
}

/** Edit one explicit inert grant. No project evaluation, runtime selection or admission. */
export async function selectProjectAgent(
  project: string,
  selectedPath: string,
  selection: ProjectAgentSelection,
  signal?: AbortSignal,
  testing: ProjectAgentTestHooks = {},
): Promise<ProjectAgentResult> {
  const path = selectionPath(selectedPath)
  validateSelection(selection)
  let root: PrivateProjectRoot | undefined
  const ancestors: OpenedEntry[] = []
  let original: OpenedEntry | undefined
  let staged: OpenedEntry | undefined
  let stageHandle: FileHandle | undefined
  let stageName: string | undefined
  let publicationAttempted = false
  let result: ProjectAgentResult | undefined
  let failure: ProjectAgentError | undefined
  try {
    checkCancellation(signal)
    root = await openPrivateProjectRoot(project)
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
      invalid('JIG_AGENT_INVALID', 'Select an existing ACP JSON grant.')
    original = await openEntry(parent, originalName, false)
    const baseline = await readBounded(original)
    const previous = parsePolicy(baseline)
    const next = proposedPolicy(previous, selection)
    const proposed = Buffer.from(`${JSON.stringify(next, null, 2)}\n`)
    if (proposed.byteLength > MAXIMUM_BYTES)
      invalid('JIG_AGENT_INVALID', 'The proposed grant exceeds 32 KiB.')
    const changed = !Buffer.from(canonicalJson(previous as unknown as JsonValue)).equals(
      Buffer.from(canonicalJson(next as unknown as JsonValue)),
    )
    await testing.checkpoint?.('opened', { path })
    checkCancellation(signal)
    if (!changed) {
      await verifySource(root, ancestors, original, baseline)
      checkCancellation(signal)
      result = Object.freeze({ path, previous, next, changed: false })
    } else {
      for (let attempt = 0; attempt < 8; attempt++) {
        const name = `.jig-agent-${randomBytes(16).toString('hex')}.tmp`
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
      result = Object.freeze({ path, previous, next, changed: true })
    }
  } catch (error) {
    failure = publicationAttempted
      ? new ProjectAgentError(
          'unavailable',
          'JIG_AGENT_PUBLISHED_UNCERTAIN',
          'The grant may already have changed. Inspect the selected source file before retrying; review is still required.',
          true,
        )
      : error instanceof ProjectAgentError
        ? error
        : new ProjectAgentError(
            'unavailable',
            'JIG_AGENT_UNAVAILABLE',
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
      failure = new ProjectAgentError(
        'unavailable',
        'JIG_AGENT_CLEANUP_FAILED',
        `Grant editing cleanup did not complete. Inspect the selected directory before retrying.${publicationAttempted ? ' The grant may already have changed; review is still required.' : ' Source publication was not attempted.'}`,
        publicationAttempted,
      )
    }
  }
  if (failure !== undefined) throw failure
  if (result === undefined)
    throw new ProjectAgentError(
      'unavailable',
      'JIG_AGENT_UNAVAILABLE',
      'The grant edit could not be confirmed.',
    )
  return result
}

async function cleanupStage(
  handle: FileHandle,
  parent: FileHandle,
  path: string,
  stageName: string,
  testing: ProjectAgentTestHooks,
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
      'JIG_AGENT_INVALID',
      'Select a project-relative <LocalName>.json grant outside protected .jig state, without traversal.',
    )
  }
}

function validateSelection(value: ProjectAgentSelection): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.keys(value).some((key) => !['client', 'model', 'defaultModel'].includes(key)) ||
    !['codex', 'claude', 'pi'].includes(value.client) ||
    (value.defaultModel !== undefined && typeof value.defaultModel !== 'boolean') ||
    (value.model !== undefined && value.defaultModel === true)
  )
    invalid(
      'JIG_AGENT_INVALID',
      'Select codex, claude or pi and at most one model pin or default-model reset.',
    )
  try {
    normalizeGrant({
      kind: 'acp',
      client: value.client,
      ...(value.model === undefined ? {} : { model: value.model }),
    })
  } catch {
    invalid('JIG_AGENT_INVALID', 'Supply a valid ACP model identifier.')
  }
}

function parsePolicy(bytes: Uint8Array): AcpGrant {
  try {
    const policy = normalizeGrant(decodeJson1(bytes))
    if (policy.kind !== 'acp') throw new Error('not ACP')
    return policy
  } catch {
    return invalid(
      'JIG_AGENT_INVALID',
      'The selected file must contain a valid, closed ACP JSON grant. Malformed or duplicate members are refused.',
    )
  }
}

function proposedPolicy(previous: AcpGrant, selection: ProjectAgentSelection): AcpGrant {
  if (previous.retainSessions === true && selection.client !== 'codex')
    invalid(
      'JIG_AGENT_RETENTION',
      'This grant retains Codex sessions. Change that policy explicitly before selecting another client; retention was not removed.',
    )
  if (
    previous.client !== selection.client &&
    previous.model !== undefined &&
    selection.model === undefined &&
    selection.defaultModel !== true
  )
    invalid(
      'JIG_AGENT_MODEL_REQUIRED',
      'Switching clients with a pinned model requires an explicit replacement model or --default-model reset.',
    )
  const { model: previousModel, ...policy } = previous
  const model = selection.defaultModel === true ? undefined : (selection.model ?? previousModel)
  return normalizeGrant({
    ...policy,
    client: selection.client,
    ...(model === undefined ? {} : { model }),
  }) as AcpGrant
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
        'JIG_AGENT_MISSING',
        'The selected grant or one of its parent directories is missing.',
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
      'JIG_AGENT_UNSAFE',
      'Grant paths must use real directories and a singly linked regular file; links and special files are refused.',
    )
}

async function readBounded(entry: OpenedEntry): Promise<Buffer> {
  const before = await entry.handle.stat({ bigint: true })
  requireEntry(before, false)
  if (before.size > BigInt(MAXIMUM_BYTES))
    invalid('JIG_AGENT_INVALID', 'The selected grant exceeds 32 KiB.')
  const bytes = Buffer.alloc(MAXIMUM_BYTES + 1)
  let length = 0
  while (length < bytes.length) {
    const result = await entry.handle.read(bytes, length, bytes.length - length, length)
    if (result.bytesRead === 0) break
    length += result.bytesRead
  }
  if (length > MAXIMUM_BYTES) invalid('JIG_AGENT_INVALID', 'The selected grant exceeds 32 KiB.')
  if (signature(before) !== signature(await entry.handle.stat({ bigint: true }))) changed()
  return bytes.subarray(0, length)
}

async function verifyDirectories(
  root: PrivateProjectRoot,
  ancestors: readonly OpenedEntry[],
): Promise<void> {
  try {
    await root.verify()
  } catch {
    changed()
  }
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
  const leaf = await currentEntry(staged.parent, name)
  const owned = await staged.handle.stat({ bigint: true })
  requireEntry(leaf, false)
  requireEntry(owned, false)
  if (
    !sameIdentity(leaf, staged.information) ||
    !sameIdentity(owned, staged.information) ||
    signature(leaf) !== signature(owned) ||
    (owned.mode & 0o7777n) !== (originalMode & 0o7777n) ||
    !proposed.equals(await readBounded(staged))
  )
    changed()
  if (signature(await currentEntry(staged.parent, name)) !== signature(owned)) changed()
}

async function currentEntry(parent: FileHandle, name: string): Promise<BigIntStats> {
  try {
    return await statPrivateChild(parent, name)
  } catch (error) {
    if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(errorCode(error) ?? '')) changed()
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
    throw new ProjectAgentError(
      'unavailable',
      'JIG_AGENT_CANCELLED',
      'Grant editing was cancelled before source publication.',
    )
}

function changed(): never {
  return invalid(
    'JIG_AGENT_CHANGED',
    'The selected source, parent directory or staged file changed during editing. Inspect it before retrying.',
  )
}

function invalid(code: ProjectAgentErrorCode, message: string): never {
  throw new ProjectAgentError('invalid', code, message)
}

function errorCode(error: unknown): string | undefined {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined
}
