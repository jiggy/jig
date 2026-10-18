import { createReadStream } from 'node:fs'
import { lstat, mkdir, opendir, readFile, realpath, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { packageDigest } from '../package/digest.js'
import {
  assertPrivateBunExecutionLayoutFiles,
  EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
  normalizePrivateBunExecutionLayout,
  type PrivateBunExecutionLayout,
  privateBunAliasPackageName,
} from './bun-execution-layout.js'
import {
  type PrivateBunPreparationMode,
  privateBunPreparationLimits,
} from './bun-native-preparation-protocol.js'
import type { PrivatePackageAlias } from './package-aliases.js'

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
    readonly location?: { readonly path: string; readonly pointer: string },
  ) {
    super(message)
  }
}

/** Keep Bun's lookup topology; workspace aliases never duplicate their targets. */
export async function capturePrivateBunPreparedTree(
  packageRoot: string,
  workspace?: Workspace,
  patchPaths: readonly string[] = [],
  mode: PrivateBunPreparationMode = 'production',
): Promise<{
  readonly files: readonly { readonly path: string; readonly size: number }[]
  readonly layout: PrivateBunExecutionLayout
  readonly digest: string
  readonly bytes: number
}> {
  const limits = privateBunPreparationLimits(mode)
  const files: { readonly path: string; readonly size: number }[] = []
  const aliases: PrivatePackageAlias[] = []
  let total = 0
  const memberNames = new Map<string, string>()
  for (const member of workspace?.members ?? []) {
    const manifest = JSON.parse(await readFile(join(packageRoot, member, 'package.json'), 'utf8'))
    if (typeof manifest.name !== 'string') unsupported('workspace member name is missing')
    memberNames.set(member, manifest.name)
  }
  const reserveRecord = (): void => {
    if (files.length + aliases.length >= limits.preparedFiles)
      throw new WorkerFailure(
        'PACKAGE_BUN_OUTPUT_LIMIT',
        'prepared dependency tree has too many records',
      )
  }
  const selectedSource = (path: string): boolean =>
    workspace === undefined ||
    workspace.selected.some((member) => path === member || path.startsWith(`${member}/`))
  const ancestor = (path: string): boolean =>
    (workspace?.selected.some((member) => member.startsWith(`${path}/`)) ?? false) ||
    patchPaths.some((patch) => patch.startsWith(`${path}/`))
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
        patchPaths.includes(path) ||
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
      if (
        mode === 'evaluation' &&
        dependencyTree &&
        (path.endsWith('.node') || path.endsWith('/binding.gyp'))
      )
        unsupported('evaluation dependencies cannot require native addons or install builds')
      // Intermediate directories locate members, but their unrelated authored
      // files are not part of the selected source or installation inputs.
      if (!dependencyTree && !selectedSource(path) && prefix !== '' && !patchPaths.includes(path))
        continue
      reserveRecord()
      if (information.size > limits.preparedBytes - total)
        throw new WorkerFailure('PACKAGE_BUN_OUTPUT_LIMIT', 'prepared dependency tree is too large')
      const bytes = await readFile(physical)
      if (mode === 'evaluation' && dependencyTree && path.endsWith('/package.json')) {
        let manifest: Record<string, unknown>
        try {
          manifest = JSON.parse(bytes.toString('utf8'))
        } catch {
          unsupported('evaluation dependency manifest is invalid')
        }
        if (manifest!.gypfile === true || manifest!.binary !== undefined)
          unsupported('evaluation dependencies cannot require native addons or install builds')
      }
      total += bytes.byteLength
      if (total > limits.preparedBytes)
        throw new WorkerFailure('PACKAGE_BUN_OUTPUT_LIMIT', 'prepared dependency tree is too large')
      files.push(Object.freeze({ path, size: bytes.byteLength }))
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
  if (total + Buffer.byteLength(JSON.stringify(layout)) > limits.preparedBytes)
    throw new WorkerFailure(
      'PACKAGE_BUN_OUTPUT_LIMIT',
      'prepared dependency tree and layout are too large',
    )
  const digest = await packageDigest(files, (file) =>
    createReadStream(join(packageRoot, file.path)),
  )
  return Object.freeze({ files: Object.freeze(files), layout, digest, bytes: total })
}

/** Move selected bytes without duplicating the installed closure or retaining aliases. */
export async function stagePrivateBunPreparedTree(
  packageRoot: string,
  prepared: Awaited<ReturnType<typeof capturePrivateBunPreparedTree>>,
): Promise<void> {
  const destination = join(dirname(packageRoot), 'prepared')
  await mkdir(destination, { mode: 0o700 })
  for (const file of prepared.files) {
    const target = join(destination, file.path)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await rename(join(packageRoot, file.path), target)
  }
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
