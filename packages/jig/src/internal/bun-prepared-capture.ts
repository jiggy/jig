import { lstat, opendir, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { PRIVATE_BUN_PREPARATION_LIMITS } from './bun-native-preparation-protocol.js'

const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)[^\0]+$/

export interface SourceFile {
  readonly path: string
  readonly content: string
}

export interface Workspace {
  readonly target: string
  readonly members: readonly string[]
  readonly selected: readonly string[]
}

export class WorkerFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export async function capturePrivateBunPreparedTree(
  packageRoot: string,
  workspace?: Workspace,
): Promise<readonly SourceFile[]> {
  if (workspace !== undefined) {
    const ancestors = new Set<string>()
    for (const member of workspace.selected) {
      const parts = member.split('/')
      while (parts.length > 1) {
        parts.pop()
        ancestors.add(parts.join('/'))
      }
    }
    // The retained package has one hoisted root. Dropping an intermediate
    // node_modules scope would change imports even without a target collision.
    for (const ancestor of ancestors) {
      const modules = join(packageRoot, ancestor, 'node_modules')
      const information = await lstat(modules).catch((error) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      if (information === undefined) continue
      if (!information.isDirectory() || information.isSymbolicLink()) unsupportedLayout()
      for await (const entry of await opendir(modules))
        if (entry.name !== '.bin') unsupportedLayout()
    }
  }
  const files: SourceFile[] = []
  let total = 0
  const active = new Set<string>()
  const overrides = new Set<string>()
  const visit = async (root: string, prefix: string, shared = false): Promise<void> => {
    if (active.has(root))
      throw new WorkerFailure(
        'PACKAGE_BUN_OUTPUT_UNSUPPORTED',
        'workspace dependency links form a recursive tree',
      )
    active.add(root)
    const directory = await opendir(root)
    const names: string[] = []
    for await (const entry of directory) names.push(entry.name)
    names.sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
    for (const name of names) {
      const path = prefix === '' ? name : `${prefix}/${name}`
      if (
        path
          .split('/')
          .some((part, index, parts) => part === '.bin' && parts[index - 1] === 'node_modules')
      )
        continue
      requirePath(path)
      let physical = join(root, name)
      let information = await lstat(physical)
      if (information.isSymbolicLink() && workspace !== undefined) {
        const resolved = await realpath(physical)
        const member = workspace.members.find((member) => join(packageRoot, member) === resolved)
        if (member === undefined)
          throw new WorkerFailure(
            'PACKAGE_BUN_OUTPUT_UNSUPPORTED',
            'prepared dependencies contain an unauthorized link',
          )
        if (!workspace.selected.includes(member)) continue
        physical = resolved
        information = await lstat(physical)
      }
      if (shared && overrides.has(path)) {
        // Flattening would let an unrelated hoisted dependency resolve the
        // Flow's local version instead of its own locked version. Until the
        // complete lookup topology can be retained, never admit that rewrite.
        unsupportedLayout()
      }
      if (information.isDirectory() && !information.isSymbolicLink()) {
        if (
          !shared &&
          /^node_modules\/(?:@[^/]+\/)?[^/]+$/.test(path) &&
          !/^node_modules\/@[^/]+$/.test(path)
        )
          overrides.add(path)
        await visit(physical, path, shared)
        continue
      }
      if (!information.isFile() || information.isSymbolicLink() || information.nlink !== 1) {
        throw new WorkerFailure(
          'PACKAGE_BUN_OUTPUT_UNSUPPORTED',
          'prepared dependencies contain a link or special file',
        )
      }
      if (files.length >= PRIVATE_BUN_PREPARATION_LIMITS.preparedFiles) {
        throw new WorkerFailure(
          'PACKAGE_BUN_OUTPUT_LIMIT',
          'prepared dependency tree has too many files',
        )
      }
      if (information.size > PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes - total)
        throw new WorkerFailure('PACKAGE_BUN_OUTPUT_LIMIT', 'prepared dependency tree is too large')
      const bytes = new Uint8Array(await readFile(physical))
      total += bytes.byteLength
      if (total > PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes) {
        throw new WorkerFailure('PACKAGE_BUN_OUTPUT_LIMIT', 'prepared dependency tree is too large')
      }
      files.push(Object.freeze({ path, content: Buffer.from(bytes).toString('base64') }))
    }
    active.delete(root)
  }
  await visit(workspace === undefined ? packageRoot : join(packageRoot, workspace.target), '')
  if (workspace !== undefined) {
    const modules = join(packageRoot, 'node_modules')
    if (
      await lstat(modules).then(
        () => true,
        (error) => {
          if (error.code === 'ENOENT') return false
          throw error
        },
      )
    )
      await visit(modules, 'node_modules', true)
    const lock = await readFile(join(packageRoot, 'bun.lock'))
    total += lock.byteLength
    if (
      total > PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes ||
      files.length >= PRIVATE_BUN_PREPARATION_LIMITS.preparedFiles
    )
      throw new WorkerFailure(
        'PACKAGE_BUN_OUTPUT_LIMIT',
        'prepared workspace exceeds its output budget',
      )
    files.push({ path: 'bun.lock', content: lock.toString('base64') })
  }
  files.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)))
  return Object.freeze(files)
}

export function requirePath(path: string): void {
  if (!PATH.test(path) || Buffer.byteLength(path) > 1_024) {
    throw new WorkerFailure('PACKAGE_BUN_PROTOCOL', 'preparation source path is invalid')
  }
}

function unsupportedLayout(): never {
  throw new WorkerFailure(
    'PACKAGE_BUN_WORKSPACE_LAYOUT_UNSUPPORTED',
    'workspace dependency scopes cannot be flattened without changing module resolution',
  )
}
