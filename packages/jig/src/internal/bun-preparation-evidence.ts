import { createHash } from 'node:crypto'
import { CheckError } from '../diagnostics.js'
import {
  type CapturedFile,
  type CapturedPackage,
  createCapturedPackage,
} from '../package/capture.js'
import { packageDigest } from '../package/digest.js'
import { assertNoPathCollisions, comparePathBytes } from '../package/paths.js'
import {
  assertPrivateBunExecutionLayoutFiles,
  type PrivateBunExecutionLayout,
} from './bun-execution-layout.js'
import { privateBunNativeInputs } from './bun-native-inputs.js'
import { PRIVATE_BUN_PREPARATION_LIMITS } from './bun-native-preparation-protocol.js'
import { privateDomainDigest } from './identity.js'

export interface PrivateBunPreparationWorkspace {
  readonly target: string
  readonly members: readonly string[]
  readonly selected: readonly string[]
}

/** Match the worker's native staging inputs; source is restored only after installation. */
export async function privateBunPreparationInputs(input: {
  readonly captured: CapturedPackage
  readonly workspace?: PrivateBunPreparationWorkspace
  readonly supportDigest: string
}): Promise<{ readonly digest: string; readonly sourcePaths: ReadonlySet<string> }> {
  const { captured, workspace } = input
  if (
    captured.files.length > PRIVATE_BUN_PREPARATION_LIMITS.sourceFiles ||
    captured.files.reduce((sum, file) => sum + file.size, 0) >
      PRIVATE_BUN_PREPARATION_LIMITS.sourceBytes
  )
    throw failure(
      'PACKAGE_BUN_INPUT_LIMIT',
      'Bun preparation source exceeds its bounded input limits',
    )
  let paths: ReadonlySet<string>
  try {
    paths = (
      await privateBunNativeInputs({
        paths: captured.files.map(({ path }) => path),
        ...(workspace === undefined ? {} : { members: workspace.members }),
        read: (path) => captured.read(path, 1024 * 1024),
      })
    ).paths
  } catch {
    throw failure(
      'PACKAGE_BUN_SOURCE_UNSUPPORTED',
      'native manifests or declared patch inputs are unsupported or incomplete',
    )
  }
  const nativeFiles = []
  for (const path of [...paths].sort(comparePathBytes)) {
    const hash = createHash('sha256')
    for await (const bytes of captured.stream(path)) hash.update(bytes)
    nativeFiles.push({ path, digest: `sha256:${hash.digest('hex')}` })
  }
  const sourcePaths = new Set(
    captured.files
      .filter(
        ({ path }) =>
          workspace === undefined ||
          paths.has(path) ||
          workspace.selected.some((member) => path.startsWith(`${member}/`)),
      )
      .map(({ path }) => path),
  )
  // Unselected member manifests participate in resolution but are not Run source.
  if (workspace !== undefined)
    for (const member of workspace.members)
      if (!workspace.selected.includes(member)) sourcePaths.delete(`${member}/package.json`)
  return Object.freeze({
    digest: privateDomainDigest('JIG-Bun-Preparation-Inputs/1', {
      supportDigest: input.supportDigest,
      workspace:
        workspace === undefined
          ? null
          : {
              target: workspace.target,
              members: [...workspace.members],
              selected: [...workspace.selected],
            },
      nativeFiles,
    }),
    sourcePaths,
  })
}

/** Only installer-owned files survive. Removed authored files cannot become dependency evidence. */
export async function capturePrivateBunDependencies(
  prepared: CapturedPackage,
  sourcePaths: ReadonlySet<string>,
): Promise<CapturedPackage> {
  const files = prepared.files.filter(({ path }) => !sourcePaths.has(path))
  requireDependencyFiles(files)
  return captureView('retained Bun dependencies', files, () => prepared)
}

/** Assemble a new immutable image, never an execution-time overlay onto mutable source. */
export async function assemblePrivateBunExecution(input: {
  readonly source: CapturedPackage
  readonly sourcePaths: ReadonlySet<string>
  readonly dependencies: CapturedPackage
  readonly layout: PrivateBunExecutionLayout
}): Promise<CapturedPackage> {
  requireDependencyFiles(input.dependencies.files)
  const source = input.source.files.filter(({ path }) => input.sourcePaths.has(path))
  const sourcePaths = new Set(source.map(({ path }) => path))
  const files = [...source, ...input.dependencies.files].sort((a, b) =>
    comparePathBytes(a.path, b.path),
  )
  try {
    assertNoPathCollisions(files.map(({ path }) => path))
    const regularPaths = new Set(files.map(({ path }) => path))
    for (const file of files) {
      const parts = file.path.split('/')
      for (let length = 1; length < parts.length; length++)
        if (regularPaths.has(parts.slice(0, length).join('/')))
          throw new TypeError('file parent collision')
    }
    assertPrivateBunExecutionLayoutFiles(input.layout, files)
  } catch {
    throw failure(
      'PACKAGE_BUN_SOURCE_UNSUPPORTED',
      'fresh source conflicts with the retained dependency layout',
    )
  }
  if (
    files.length + input.layout.aliases.length > PRIVATE_BUN_PREPARATION_LIMITS.preparedFiles ||
    files.reduce((sum, file) => sum + file.size, Buffer.byteLength(JSON.stringify(input.layout))) >
      PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes
  )
    throw failure(
      'PACKAGE_BUN_OUTPUT_LIMIT',
      'assembled Bun execution exceeds its bounded output limits',
    )
  return captureView('fresh Bun execution image', files, (path) =>
    sourcePaths.has(path) ? input.source : input.dependencies,
  )
}

function requireDependencyFiles(files: readonly CapturedFile[]): void {
  if (files.some(({ path }) => path !== 'bun.lock' && !path.split('/').includes('node_modules')))
    throw failure(
      'PACKAGE_BUN_PROTOCOL',
      'retained Bun dependency evidence contains authored source',
    )
}

/** The view borrows verified captures. Its owner keeps them open until publication completes. */
async function captureView(
  label: string,
  files: readonly CapturedFile[],
  owner: (path: string) => CapturedPackage,
): Promise<CapturedPackage> {
  const frozenFiles = Object.freeze([...files])
  const backing = {
    stream: (path: string) => owner(path).stream(path),
    async dispose(): Promise<void> {},
  }
  return createCapturedPackage(
    label,
    frozenFiles,
    await packageDigest(frozenFiles, (file) => backing.stream(file.path)),
    backing,
  )
}

function failure(code: string, message: string): CheckError {
  return new CheckError('invalid', code, message)
}
