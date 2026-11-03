import { closeSync, constants, fstatSync, readFileSync } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { CheckError } from '../diagnostics.js'
import { fullCaseFold15_1, validateLogicalPath } from '../package/paths.js'
import { isProtectedProjectPath, validateProjectPath } from '../project/paths.js'
import { requirePrivateProjectRoot, type PrivateProjectRoot } from '../project/root.js'
import {
  duplicatePrivateDirectory,
  duplicatePrivateDirectoryDescriptor,
  openPrivateSourceChild,
} from './descriptor-files.js'
import { privateOpenFileRoot } from './file-input.js'
import { PrivateFileInputError } from './file-input-policy.js'
import { privateMacosFilesystem } from './macos-descriptor-files.js'

/** Fixed bounds on explicitly selected roots for one review. */
export const PRIVATE_WORKSPACE_SOURCE_ROOT_LIMIT = 32
export const PRIVATE_WORKSPACE_SOURCE_ROOT_PATH_BYTES = 4096

/** Closed workspace failures already carry a project-relative display location. */
export class PrivateBunWorkspaceError extends CheckError {
  readonly projectRelative = true
}

/** Only closed source-open causes and a caller-established location reach review. */
export function throwPrivateWorkspaceSourceError(
  error: unknown,
  projectRelativePath: string,
): never {
  if (error instanceof CheckError) throw error
  const path = workspaceDisplayPath(projectRelativePath)
  const code =
    error !== null && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : undefined
  if (code === 'EXDEV')
    throw new PrivateBunWorkspaceError(
      'invalid',
      'PACKAGE_BUN_WORKSPACE_MOUNT',
      'workspace source crosses a mount boundary that is not selected as a source root',
      path,
    )
  if (code === 'ENOENT')
    throw new PrivateBunWorkspaceError(
      'invalid',
      'PACKAGE_BUN_WORKSPACE_SOURCE_MISSING',
      'workspace source is missing. Check the declared workspace paths',
      path,
    )
  if (code === 'ELOOP')
    throw new PrivateBunWorkspaceError(
      'invalid',
      'PACKAGE_BUN_WORKSPACE_SOURCE_SYMLINK',
      'workspace source paths must not traverse symbolic links',
      path,
    )
  if (code === 'ENOTDIR')
    throw new PrivateBunWorkspaceError(
      'invalid',
      'PACKAGE_BUN_WORKSPACE_SOURCE_INVALID',
      'workspace source path must be an ordinary directory without symbolic links',
      path,
    )
  if (code === 'EACCES' || code === 'EPERM')
    throw new PrivateBunWorkspaceError(
      'unavailable',
      'PACKAGE_BUN_WORKSPACE_SOURCE_ACCESS',
      'workspace source cannot be read. Check its file and directory permissions',
      path,
    )
  throw new PrivateBunWorkspaceError(
    'unavailable',
    'PACKAGE_BUN_WORKSPACE_SOURCE_UNAVAILABLE',
    'workspace source could not be opened safely. Check the source and supported-host requirements',
    path,
  )
}

const DIRECTORY_FLAGS =
  constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK
const PATH_CONTROLS = /[\p{Cc}\u2028\u2029]/u

interface RootIdentity {
  readonly device: bigint
  readonly inode: bigint
  readonly mount: string
}

interface SelectedRoot {
  readonly requestedPath: string
  readonly logicalPath: string
  readonly diagnosticPath: string
  readonly handle: FileHandle
  readonly identity: RootIdentity
}

/** Invocation-local source authority. Borrowed directories belong to their caller. */
export interface PrivateWorkspaceSourceRoots {
  openDirectory(logicalPath: string): Promise<FileHandle>
  openChild(parent: FileHandle, logicalParentPath: string, name: string): Promise<FileHandle>
  validateMembers(members: readonly string[]): void
  verify(): Promise<void>
  dispose(): Promise<void>
}

/**
 * Additional roots are trusted review operands, never workspace declarations.
 * Each exact logical prefix switches to a held root; ordinary descendants retain
 * the shared no-link/no-mount source operation. Package-byte capture stays separate.
 */
export async function openPrivateWorkspaceSourceRoots(input: {
  workspaceRoot: PrivateProjectRoot
  projectRoot: PrivateProjectRoot
  sourceRoots?: readonly string[]
}): Promise<PrivateWorkspaceSourceRoots> {
  const workspace = requirePrivateProjectRoot(input.workspaceRoot)
  const project = requirePrivateProjectRoot(input.projectRoot)
  const displayPath = (path: string): string =>
    workspaceDisplayPath(
      relative(project.requestedPath, resolve(workspace.requestedPath, path)) || '.',
    )
  const selections = snapshotSelections(input.sourceRoots)
  const applicationPath = relative(workspace.requestedPath, project.requestedPath)
  const application = isDescendant(applicationPath) ? applicationPath : undefined
  const paths = new Map<string, string>()
  const spellings = new Map<string, string>()
  if (application !== undefined) recordSpelling(application, spellings, displayPath(application))
  for (const requestedPath of selections) {
    const logicalPath = relative(workspace.requestedPath, requestedPath)
    if (!isDescendant(logicalPath))
      invalidRoot('source roots must be directories below the selected workspace root')
    requireRootPath(logicalPath)
    if (logicalPath === application)
      invalidRoot(
        'the application directory is already a selected source root',
        displayPath(logicalPath),
      )
    if (paths.has(logicalPath))
      invalidRoot('source roots must be distinct', displayPath(logicalPath))
    recordSpelling(logicalPath, spellings, displayPath(logicalPath))
    paths.set(logicalPath, requestedPath)
  }

  const held = new Map<string, SelectedRoot>()
  const directoryPaths = new WeakMap<FileHandle, string>([[workspace.handle, '']])
  let implicitAcquisition: Promise<SelectedRoot> | undefined
  let disposal: Promise<void> | undefined
  const requireOpen = () => {
    if (disposal !== undefined)
      throw new PrivateBunWorkspaceError(
        'unavailable',
        'PACKAGE_BUN_SOURCE_ROOT_UNAVAILABLE',
        'workspace source-root capture has been closed',
      )
  }
  const retainRoot = (root: SelectedRoot): SelectedRoot => {
    const duplicate =
      (root.identity.device === workspace.information.dev &&
        root.identity.inode === workspace.information.ino) ||
      (root.logicalPath !== application &&
        root.identity.device === project.information.dev &&
        root.identity.inode === project.information.ino) ||
      [...held.values()].some(
        ({ identity }) =>
          identity.device === root.identity.device && identity.inode === root.identity.inode,
      )
    // Record ownership before a possible refusal so cleanup includes this root.
    held.set(root.logicalPath, root)
    if (duplicate)
      invalidRoot('source roots must not alias another selected directory', root.diagnosticPath)
    return root
  }
  try {
    for (const [logicalPath, requestedPath] of paths)
      retainRoot(await acquireRoot(requestedPath, logicalPath, displayPath(logicalPath)))
  } catch (error) {
    await closeAfterFailure(
      [...held.values()].map(({ handle }) => handle),
      error,
    )
  }

  const openChild = async (
    parent: FileHandle,
    logicalParentPath: string,
    name: string,
  ): Promise<FileHandle> => {
    requireOpen()
    if (directoryPaths.get(parent) !== logicalParentPath || parent.fd < 0)
      throw new TypeError('workspace directory was not opened by this capture')
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0'))
      throw new TypeError('workspace source child requires one leaf name')
    const logicalPath = logicalParentPath === '' ? name : `${logicalParentPath}/${name}`
    validateLogicalPath(logicalPath)
    const selected = held.get(logicalPath)
    let child: FileHandle
    if (selected !== undefined) child = await duplicatePrivateDirectory(selected.handle)
    else {
      try {
        child = await openPrivateSourceChild(parent, name, DIRECTORY_FLAGS)
      } catch (error) {
        // Only the exact application root already selected by the operator can
        // acquire this extra anchor. No discovered child receives weaker flags.
        if (
          logicalPath !== application ||
          (error as NodeJS.ErrnoException | null)?.code !== 'EXDEV'
        )
          throwPrivateWorkspaceSourceError(error, displayPath(logicalPath))
        implicitAcquisition ??= acquireRoot(
          project.requestedPath,
          logicalPath,
          displayPath(logicalPath),
          project,
        ).then(retainRoot)
        const root = await implicitAcquisition
        requireOpen()
        child = await duplicatePrivateDirectory(root.handle)
      }
    }
    if (disposal !== undefined)
      await closeAfterFailure(
        [child],
        new PrivateBunWorkspaceError(
          'unavailable',
          'PACKAGE_BUN_SOURCE_ROOT_UNAVAILABLE',
          'workspace source-root capture has been closed',
        ),
      )
    directoryPaths.set(child, logicalPath)
    return child
  }

  return Object.freeze({
    openChild,
    validateMembers(members: readonly string[]): void {
      requireOpen()
      for (const path of paths.keys()) {
        if (!members.some((member) => member === path || member.startsWith(`${path}/`)))
          invalidRoot(
            'source roots must select a declared workspace member or a directory containing members',
            displayPath(path),
          )
      }
    },
    async openDirectory(logicalPath: string): Promise<FileHandle> {
      requireOpen()
      if (logicalPath === '') {
        const directory = await duplicatePrivateDirectory(workspace.handle)
        if (disposal !== undefined)
          await closeAfterFailure(
            [directory],
            new PrivateBunWorkspaceError(
              'unavailable',
              'PACKAGE_BUN_SOURCE_ROOT_UNAVAILABLE',
              'workspace source-root capture has been closed',
            ),
          )
        directoryPaths.set(directory, '')
        return directory
      }
      validateLogicalPath(logicalPath)
      const opened: FileHandle[] = []
      let current = workspace.handle
      let parentPath = ''
      try {
        for (const part of logicalPath.split('/')) {
          current = await openChild(current, parentPath, part)
          opened.push(current)
          parentPath = parentPath === '' ? part : `${parentPath}/${part}`
        }
        const result = opened.pop()!
        try {
          await closeDirectories(opened)
        } catch (error) {
          await closeAfterFailure([result], error)
        }
        return result
      } catch (error) {
        return closeAfterFailure(opened, error)
      }
    },
    async verify(): Promise<void> {
      requireOpen()
      if (implicitAcquisition !== undefined) await implicitAcquisition
      requireOpen()
      for (const root of held.values()) {
        let fd: number | undefined
        let failure: unknown
        let failed = false
        try {
          // This reacquisition only verifies identity. Source reads continue to
          // use the original held descriptor, even if a visible path changes.
          fd = privateOpenFileRoot(root.requestedPath)
          if (!sameIdentity(root.identity, identifyRoot(fd))) changed(root.diagnosticPath)
        } catch {
          failed = true
          failure = changedError(root.diagnosticPath)
        }
        if (fd !== undefined) {
          try {
            closeSync(fd)
          } catch (error) {
            throw new AggregateError(
              failed ? [failure, error] : [error],
              'workspace source-root verification cleanup failed',
            )
          }
        }
        if (failed) throw failure
      }
    },
    dispose(): Promise<void> {
      disposal ??= (async () => {
        const failures: unknown[] = []
        if (implicitAcquisition !== undefined)
          await implicitAcquisition.catch((error) => {
            // Ordinary acquisition refusal already closed its allocations.
            // Preserve uncertainty if that cleanup itself failed.
            if (error instanceof AggregateError) failures.push(error)
          })
        const handles = [...held.values()].map(({ handle }) => handle)
        held.clear()
        try {
          await closeDirectories(handles)
        } catch (error) {
          failures.push(error)
        }
        if (failures.length)
          throw new AggregateError(failures, 'workspace source-root cleanup failed')
      })()
      return disposal
    },
  })
}

function snapshotSelections(sourceRoots: readonly string[] | undefined): readonly string[] {
  if (sourceRoots === undefined) return []
  if (!Array.isArray(sourceRoots) || sourceRoots.length > PRIVATE_WORKSPACE_SOURCE_ROOT_LIMIT)
    invalidRoot(`select at most ${PRIVATE_WORKSPACE_SOURCE_ROOT_LIMIT} source-root directories`)
  return Object.freeze(
    sourceRoots.map((path) => {
      if (
        typeof path !== 'string' ||
        !isAbsolute(path) ||
        PATH_CONTROLS.test(path) ||
        Buffer.byteLength(path, 'utf8') > PRIVATE_WORKSPACE_SOURCE_ROOT_PATH_BYTES ||
        Buffer.from(path, 'utf8').toString('utf8') !== path
      )
        invalidRoot('source roots require bounded absolute paths without control characters')
      return resolve(path)
    }),
  )
}

function isDescendant(path: string): boolean {
  return path !== '' && path !== '..' && !path.startsWith('../') && !isAbsolute(path)
}

function requireRootPath(path: string): void {
  try {
    validateLogicalPath(path)
  } catch {
    invalidRoot('source roots must use canonical relative workspace locations')
  }
  if (
    path
      .split('/')
      .some((part) => ['.git', 'node_modules'].includes(part) || isProtectedProjectPath(part))
  )
    invalidRoot('source roots cannot select installation, repository metadata, or Jig state')
}

/** Keep refusals intact when a source location cannot enter the public diagnostic. */
function workspaceDisplayPath(path: string): string {
  if (path === '.') return path
  const parts = path.split('/')
  let ancestors = 0
  while (parts[ancestors] === '..') ancestors++
  if (ancestors > 32 || parts.length > 64 || Buffer.byteLength(path, 'utf8') > 1024)
    return '--source-root'
  const local = parts.slice(ancestors).join('/')
  if (local === '') return ancestors === parts.length ? path : '--source-root'
  try {
    validateProjectPath(local, 'workspace source diagnostic path')
    if (local.split('/').some(isProtectedProjectPath)) return '--source-root'
  } catch {
    return '--source-root'
  }
  return path
}

function recordSpelling(
  path: string,
  spellings: Map<string, string>,
  diagnosticPath: string,
): void {
  requireRootPath(path)
  let prefix = ''
  for (const part of path.split('/')) {
    prefix = prefix === '' ? part : `${prefix}/${part}`
    const key = fullCaseFold15_1(prefix)
    const prior = spellings.get(key)
    if (prior !== undefined && prior !== prefix)
      invalidRoot('source-root locations must not conflict under case folding', diagnosticPath)
    spellings.set(key, prefix)
  }
}

async function acquireRoot(
  requestedPath: string,
  logicalPath: string,
  diagnosticPath: string,
  application?: PrivateProjectRoot,
): Promise<SelectedRoot> {
  let fd: number | undefined
  let handle: FileHandle | undefined
  let identity: RootIdentity | undefined
  const failures: unknown[] = []
  try {
    fd = privateOpenFileRoot(requestedPath)
    identity = identifyRoot(fd)
    if (application !== undefined && !sameIdentity(identity, identifyRoot(application.handle.fd)))
      changed(diagnosticPath)
    handle = await duplicatePrivateDirectoryDescriptor(application?.handle.fd ?? fd)
    if (!sameIdentity(identity, identifyRoot(handle.fd))) changed(diagnosticPath)
  } catch (error) {
    failures.push(rootError(error, diagnosticPath))
  }
  if (fd !== undefined) {
    try {
      closeSync(fd)
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) {
    if (handle !== undefined) {
      try {
        await handle.close()
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 1)
      throw new AggregateError(failures, 'workspace source-root acquisition cleanup failed')
    throw failures[0]
  }
  return Object.freeze({
    requestedPath,
    logicalPath,
    diagnosticPath,
    handle: handle!,
    identity: identity!,
  })
}

function identifyRoot(fd: number): RootIdentity {
  const info = fstatSync(fd, { bigint: true })
  if (!info.isDirectory()) throw new PrivateFileInputError('regular')
  let mount: string
  if (process.platform === 'linux') {
    const id = /^mnt_id:\s+(\d+)$/m.exec(readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8'))?.[1]
    if (id === undefined) throw new PrivateFileInputError('mount')
    mount = id
  } else if (process.platform === 'darwin') {
    const filesystem = privateMacosFilesystem(fd)
    mount = JSON.stringify([filesystem.device, filesystem.mountpoint])
  } else throw new PrivateFileInputError('native')
  return { device: info.dev, inode: info.ino, mount }
}

function sameIdentity(left: RootIdentity, right: RootIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.mount === right.mount
}

function rootError(error: unknown, path: string): PrivateBunWorkspaceError {
  if (error instanceof PrivateBunWorkspaceError) return error
  const reason = error instanceof PrivateFileInputError ? error.reason : undefined
  if (reason === 'missing')
    return new PrivateBunWorkspaceError(
      'invalid',
      'PACKAGE_BUN_SOURCE_ROOT_MISSING',
      'selected source-root directory is missing',
      path,
    )
  if (reason === 'access')
    return new PrivateBunWorkspaceError(
      'unavailable',
      'PACKAGE_BUN_SOURCE_ROOT_UNREADABLE',
      'selected source-root directory cannot be read. Check its permissions',
      path,
    )
  if (reason === 'symlink' || reason === 'protected')
    return new PrivateBunWorkspaceError(
      'invalid',
      'PACKAGE_BUN_SOURCE_ROOT_INVALID',
      reason === 'symlink'
        ? 'source-root paths must not traverse symbolic links'
        : 'source roots cannot select protected host state or its mounted aliases',
      path,
    )
  if (reason === 'filesystem' || reason === 'native' || reason === 'kernel' || reason === 'mount')
    return new PrivateBunWorkspaceError(
      'unavailable',
      'PACKAGE_BUN_SOURCE_ROOT_UNAVAILABLE',
      'selected source root requires a supported local filesystem and qualified host file controls',
      path,
    )
  if (
    reason === 'regular' ||
    (error !== null &&
      typeof error === 'object' &&
      (error as NodeJS.ErrnoException).code === 'ENOTDIR')
  )
    return new PrivateBunWorkspaceError(
      'invalid',
      'PACKAGE_BUN_SOURCE_ROOT_INVALID',
      'selected source root must be an ordinary directory',
      path,
    )
  return new PrivateBunWorkspaceError(
    'unavailable',
    'PACKAGE_BUN_SOURCE_ROOT_UNAVAILABLE',
    'selected source-root directory could not be acquired safely',
    path,
  )
}

function invalidRoot(message: string, path = '--source-root'): never {
  throw new PrivateBunWorkspaceError('invalid', 'PACKAGE_BUN_SOURCE_ROOT_INVALID', message, path)
}

function changedError(path: string): PrivateBunWorkspaceError {
  return new PrivateBunWorkspaceError(
    'invalid',
    'PACKAGE_BUN_WORKSPACE_CHANGED',
    'selected workspace source root changed during capture. Review again',
    path,
  )
}

function changed(path: string): never {
  throw changedError(path)
}

async function closeDirectories(handles: FileHandle[]): Promise<void> {
  const failures: unknown[] = []
  for (const handle of handles.splice(0)) {
    try {
      await handle.close()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length) throw new AggregateError(failures, 'workspace directory cleanup failed')
}

async function closeAfterFailure(handles: FileHandle[], error: unknown): Promise<never> {
  try {
    await closeDirectories(handles)
  } catch (cleanup) {
    throw new AggregateError([error, cleanup], 'workspace source-root cleanup failed')
  }
  throw error
}
