import { lstat, opendir, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertPrivateBunExecutionLayoutFiles,
  EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
  normalizePrivateBunExecutionLayout,
  privateBunAliasPackageName,
  type PrivateBunExecutionAlias,
  type PrivateBunExecutionLayout,
} from './bun-execution-layout.js'
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

/** Keep Bun's lookup topology; workspace aliases never duplicate their targets. */
export async function capturePrivateBunPreparedTree(
  packageRoot: string,
  workspace?: Workspace,
): Promise<{ readonly files: readonly SourceFile[]; readonly layout: PrivateBunExecutionLayout }> {
  const files: SourceFile[] = []
  const aliases: PrivateBunExecutionAlias[] = []
  let total = 0
  const memberNames = new Map<string, string>()
  for (const member of workspace?.members ?? []) {
    const manifest = JSON.parse(await readFile(join(packageRoot, member, 'package.json'), 'utf8'))
    if (typeof manifest.name !== 'string') unsupported('workspace member name is missing')
    memberNames.set(member, manifest.name)
  }
  const reserveRecord = (): void => {
    if (files.length + aliases.length >= PRIVATE_BUN_PREPARATION_LIMITS.preparedFiles)
      throw new WorkerFailure(
        'PACKAGE_BUN_OUTPUT_LIMIT',
        'prepared dependency tree has too many records',
      )
  }
  const selectedSource = (path: string): boolean =>
    workspace === undefined ||
    workspace.selected.some((member) => path === member || path.startsWith(`${member}/`))
  const ancestor = (path: string): boolean =>
    workspace?.selected.some((member) => member.startsWith(`${path}/`)) ?? false
  const visit = async (root: string, prefix: string, installed = false): Promise<void> => {
    const names: string[] = []
    for await (const entry of await opendir(root)) names.push(entry.name)
    names.sort(compare)
    for (const name of names) {
      const path = prefix === '' ? name : `${prefix}/${name}`
      if (name === '.bin' && prefix.split('/').at(-1) === 'node_modules') continue
      requirePath(path)
      const physical = join(root, name)
      const information = await lstat(physical)
      const dependencyTree = installed || name === 'node_modules'
      const retained =
        dependencyTree ||
        selectedSource(path) ||
        ancestor(path) ||
        (prefix === '' && (name === 'package.json' || name === 'bun.lock'))
      if (!retained) continue
      if (information.isSymbolicLink()) {
        if (workspace === undefined || !dependencyTree)
          unsupported('prepared source contains an unauthorized link')
        const packageName = privateBunAliasPackageName(path)
        const resolved = await realpath(physical)
        const member = workspace.members.find((value) => join(packageRoot, value) === resolved)
        if (
          member === undefined ||
          packageName === undefined ||
          memberNames.get(member) !== packageName
        )
          unsupported('prepared dependencies contain an unauthorized link')
        // Bun may link every declared member, even when filtering installation.
        // Such a link does not authorize capturing an unselected member's source.
        if (!workspace.selected.includes(member)) continue
        reserveRecord()
        aliases.push(Object.freeze({ path, target: member }))
        continue
      }
      if (information.isDirectory()) {
        await visit(physical, path, dependencyTree)
        continue
      }
      if (!information.isFile() || information.nlink !== 1)
        unsupported('prepared dependencies contain a link or special file')
      // Intermediate directories locate members, but their unrelated authored
      // files are not part of the selected source or installation inputs.
      if (!dependencyTree && !selectedSource(path) && prefix !== '') continue
      reserveRecord()
      if (information.size > PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes - total)
        throw new WorkerFailure('PACKAGE_BUN_OUTPUT_LIMIT', 'prepared dependency tree is too large')
      const bytes = await readFile(physical)
      total += bytes.byteLength
      if (total > PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes)
        throw new WorkerFailure('PACKAGE_BUN_OUTPUT_LIMIT', 'prepared dependency tree is too large')
      files.push(Object.freeze({ path, content: bytes.toString('base64') }))
    }
  }
  await visit(packageRoot, '')
  files.sort((left, right) => compare(left.path, right.path))
  aliases.sort((left, right) => compare(left.path, right.path))
  let layout = EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT
  try {
    if (workspace !== undefined)
      layout = normalizePrivateBunExecutionLayout({
        flowRoot: workspace.target,
        members: [...workspace.selected].sort(compare),
        aliases,
      })
    assertPrivateBunExecutionLayoutFiles(layout, files)
  } catch {
    unsupported('prepared workspace layout is invalid')
  }
  if (
    total + Buffer.byteLength(JSON.stringify(layout)) >
    PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes
  )
    throw new WorkerFailure(
      'PACKAGE_BUN_OUTPUT_LIMIT',
      'prepared dependency tree and layout are too large',
    )
  return Object.freeze({ files: Object.freeze(files), layout })
}

export function requirePath(path: string): void {
  if (!PATH.test(path) || Buffer.byteLength(path) > 1_024)
    throw new WorkerFailure('PACKAGE_BUN_PROTOCOL', 'preparation source path is invalid')
}

function compare(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right))
}

function unsupported(message: string): never {
  throw new WorkerFailure('PACKAGE_BUN_OUTPUT_UNSUPPORTED', message)
}
