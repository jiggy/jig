import { type BigIntStats, constants } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CheckError, invalid, unavailable } from '../diagnostics.js'
import { appendJson1ObjectEntry } from '../json.js'
import { captureOpenedPackageDirectory } from '../package/capture.js'
import { packageEntrypointSuffix } from '../package/inspect.js'
import { isLocalName, parseFlowMetadataSidecar } from '../package/metadata.js'
import { normalizeNfc15_1 } from '../package/normalization-15.1.js'
import { fullCaseFold15_1, validateLogicalPath } from '../package/paths.js'
import { normalizeProjectPath } from '../project/paths.js'
import { openPrivateProjectRoot } from '../project/root.js'
import {
  captureContractBundle,
  removeContractStage,
  writeContractBundle,
} from './contract-import.js'
import {
  mkdirPrivateFile,
  openPrivateFile,
  openPrivateSourceChild,
  type PrivateChildLocation,
  privateChildLocation,
  privateDirectoryEntries,
  renamePrivateFile,
  rmdirPrivateFile,
  statPrivateFile,
} from './descriptor-files.js'
import { privatePublishDirectory } from './file-input.js'

const STAGE = '.jig-add-use-stage'
const METADATA = 'FLOW.meta.json'
const CONTRACTS = 'contracts'
const DIRECTORY = constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK
const METADATA_BYTES = 262_144
const DIRECTORY_ENTRIES = 262_144

/** Declare one expected collaborator in ordinary source without loading project code. */
export async function addFlowUse(
  project: string,
  operand: string,
  slot: string,
  source: string | undefined,
  optional: boolean,
  signal?: AbortSignal,
  standardDirectory?: string,
): Promise<string | undefined> {
  if (optional && source === undefined)
    invalid(
      'ADD_USE_SLOT',
      'Use --optional with slot=source and an identified invocation agreement.',
    )
  let path: string
  try {
    path = normalizeProjectPath(operand, 'Flow package path')
  } catch {
    invalid('ADD_USE_PATH', 'Specify an exact project-relative Flow package directory.', operand)
  }
  if (path.split('/').some(protectedSegment))
    invalid('ADD_USE_PATH', 'Select a local Flow package outside protected paths.', path)
  if (
    !isLocalName(slot) ||
    (source !== undefined && (!source || source.length > 2048 || source.includes('\0')))
  )
    invalid('ADD_USE_SLOT', 'Specify a LocalName as slot or slot=source.')

  signal?.throwIfAborted()
  const metadataPath = `${path}/${METADATA}`
  const bundlePath = `${path}/contracts/${slot}`
  const root = await openPrivateProjectRoot(project)
  const allocation = privateChildLocation(root.handle, STAGE)
  let directory: FileHandle | undefined
  let contracts: FileHandle | undefined
  let stage: FileHandle | undefined
  let ownsStage = false
  let published = false
  let committed = false
  try {
    if (!(await exactEntry(root.handle, 'jig.ts', '.')))
      invalid('ADD_USE_PATH', 'Run this command from a Jig project root with a regular jig.ts.')
    await requireRegularFile(root.handle, 'jig.ts')
    directory = await openExactDirectory(root.handle, path)
    const entrypoint = await requireCodeEntrypoint(directory, path)
    const original = await readSidecar(directory, metadataPath)
    const metadata = parseSidecar(original.bytes, metadataPath)
    if (metadata.uses && Object.hasOwn(metadata.uses, slot))
      invalid('ADD_USE_EXISTS', 'Choose an unused slot. The slot already exists.', metadataPath)
    let bundle: Awaited<ReturnType<typeof captureContractBundle>> | undefined
    if (source !== undefined) {
      if (
        Object.values(metadata.uses ?? {}).some(
          ({ contract }) =>
            contract && fullCaseFold15_1(contract).startsWith(`./contracts/${slot}/`),
        )
      )
        invalid(
          'ADD_USE_EXISTS',
          'An existing slot already refers to this contract directory.',
          metadataPath,
        )

      if (await exactEntry(directory, CONTRACTS, path)) {
        contracts = await openPrivateSourceChild(directory, CONTRACTS, DIRECTORY)
        if (await exactEntry(contracts, slot, `${path}/contracts`)) destinationExists(bundlePath)
      }
      bundle = await captureContractBundle(
        /^(jig:|npm:)/.test(source) ? source : resolve(project, source),
        resolve(project, path, CONTRACTS),
        signal,
        standardDirectory,
        { excludeProtectedState: true },
      )
      if (bundle.agreement.kind !== 'invocation' || bundle.agreement.contract.profile !== 'single')
        invalid(
          'ADD_USE_CONTRACT',
          'Select an identified single-operation invocation agreement.',
          source,
        )
      if (bundle.agreement.contract.descriptor.id === undefined)
        invalid(
          'ADD_USE_CONTRACT',
          optional
            ? 'This invocation agreement has no portable identity. Select an identified agreement for --optional.'
            : 'This invocation agreement has no portable identity. Omit =<source> to declare an uncontracted slot.',
          source,
        )
      for (const file of bundle.documents.keys()) {
        validateLogicalPath(`contracts/${slot}/${file}`)
        if (file.split('/').some(protectedSegment))
          invalid('ADD_USE_CONTRACT', 'The agreement references a protected package path.', source)
      }
    }
    const descriptor = bundle && `./contracts/${slot}/${bundle.descriptor}`
    const sourceText = Buffer.from(original.bytes).toString('utf8')
    const entry =
      descriptor === undefined
        ? {}
        : { contract: descriptor, ...(optional ? { optional: true } : {}) }
    const edited =
      metadata.uses === undefined
        ? appendJson1ObjectEntry(sourceText, 'root', 'uses', { [slot]: entry })
        : appendJson1ObjectEntry(sourceText, { member: 'uses' }, slot, entry)
    parseSidecar(Buffer.from(edited), metadataPath)

    if (await exactEntry(root.handle, STAGE, '.')) stageExists()
    try {
      await mkdirPrivateFile(allocation)
      ownsStage = true
    } catch (error) {
      if (errorCode(error) === 'EEXIST') stageExists()
      throw error
    }
    stage = await openPrivateSourceChild(root.handle, STAGE, DIRECTORY)
    const stageIdentity = await stage.stat({ bigint: true })
    await writeStageFile(
      stage,
      'intent.json',
      `${JSON.stringify({ metadata: metadataPath, bundle: bundle && bundlePath })}\n`,
    )
    const stagedMetadata = await writeStageFile(
      stage,
      METADATA,
      edited,
      Number(original.info.mode & 0o777n),
    )

    if (bundle) {
      // Publish an absent contracts directory and its first bundle together.
      await mkdirPrivateFile(privateChildLocation(stage, CONTRACTS))
      const container = await openPrivateSourceChild(stage, CONTRACTS, DIRECTORY)
      try {
        await mkdirPrivateFile(privateChildLocation(container, slot))
        const stagedBundle = await openPrivateSourceChild(container, slot, DIRECTORY)
        try {
          await writeContractBundle(stagedBundle, bundle, signal)
          await root.verify()
          await verifyVisiblePackage(root.handle, path, directory)
          await verifySidecar(directory, original.info, metadataPath)
          await verifyIdentity(allocation, stageIdentity, STAGE)
          if (contracts) {
            await verifyIdentity(
              privateChildLocation(directory, CONTRACTS),
              await contracts.stat({ bigint: true }),
              path,
            )
            if (await exactEntry(contracts, slot, `${path}/contracts`))
              destinationExists(bundlePath)
          } else if (await exactEntry(directory, CONTRACTS, path)) {
            destinationExists(bundlePath)
          }
          signal?.throwIfAborted()
          try {
            if (contracts) privatePublishDirectory(contracts.fd, slot, slot, container.fd)
            else privatePublishDirectory(directory.fd, CONTRACTS, CONTRACTS, stage.fd)
            published = true
          } catch (error) {
            if (errorCode(error) === 'EEXIST') destinationExists(bundlePath)
            throw error
          }

          await exactEntry(directory, CONTRACTS, path)
          const visibleContracts = await openPrivateSourceChild(directory, CONTRACTS, DIRECTORY)
          try {
            await exactEntry(visibleContracts, slot, `${path}/contracts`)
            await verifyIdentity(
              privateChildLocation(visibleContracts, slot),
              await stagedBundle.stat({ bigint: true }),
              bundlePath,
            )
          } finally {
            await visibleContracts.close()
          }
          const copied = await captureOpenedPackageDirectory(bundlePath, stagedBundle, {
            includes: () => true,
            maximumFiles: bundle.documents.size,
            maximumBytes: 1_048_576,
          })
          try {
            if (copied.files.length !== bundle.documents.size) sourceChanged(bundlePath)
            for (const file of copied.files) {
              const expected = bundle.documents.get(file.path)
              if (
                expected === undefined ||
                expected.length !== file.size ||
                !Buffer.from(expected).equals(await copied.read(file.path, expected.length))
              )
                sourceChanged(bundlePath)
            }
          } finally {
            await copied.dispose()
          }
        } finally {
          await stagedBundle.close()
        }
      } finally {
        await container.close()
      }
    }
    await root.verify()
    await verifyVisiblePackage(root.handle, path, directory)
    await verifyIdentity(allocation, stageIdentity, STAGE)
    if ((await requireCodeEntrypoint(directory, path)) !== entrypoint) sourceChanged(path)
    await verifyFile(stage, stagedMetadata, metadataPath)
    await verifySidecar(directory, original.info, metadataPath)
    signal?.throwIfAborted()
    await renamePrivateFile(
      privateChildLocation(stage, METADATA),
      privateChildLocation(directory, METADATA),
    )
    committed = true
    return descriptor
  } catch (error) {
    if (published) recoveryRequired(committed, bundlePath)
    if (error instanceof CheckError || signal?.aborted) throw error
    return unavailable(
      'ADD_USE_IO',
      'The source edit could not finish. Check the project paths and permissions.',
      metadataPath,
    )
  } finally {
    try {
      if (ownsStage && (!published || committed)) {
        if (stage) {
          await verifyIdentity(allocation, await stage.stat({ bigint: true }), STAGE)
          await removeContractStage(allocation)
        } else {
          await rmdirPrivateFile(allocation)
        }
      }
    } catch {
      if (published) recoveryRequired(committed, bundlePath)
      unavailable(
        'ADD_USE_RECOVERY',
        'Inspect FLOW.meta.json and .jig-add-use-stage before retrying the edit.',
        metadataPath,
      )
    } finally {
      await Promise.all([stage?.close(), contracts?.close(), directory?.close(), root.dispose()])
    }
  }
}

function protectedSegment(segment: string): boolean {
  return ['.jig', '.git', 'node_modules', STAGE].includes(fullCaseFold15_1(segment))
}

async function openExactDirectory(root: FileHandle, path: string): Promise<FileHandle> {
  let owned: FileHandle | undefined
  try {
    for (const segment of path.split('/')) {
      const parent = owned ?? root
      if (!(await exactEntry(parent, segment, path)))
        invalid('ADD_USE_PATH', 'The exact Flow package directory does not exist.', path)
      const next = await openPrivateSourceChild(parent, segment, DIRECTORY)
      await owned?.close()
      owned = next
      if (await exactEntry(owned, 'jig.ts', path))
        invalid('ADD_USE_PATH', 'Run this command from the selected Flow’s Jig project root.', path)
    }
    if (!owned) throw new Error('expected a nonempty package path')
    const directory = owned
    owned = undefined
    return directory
  } finally {
    await owned?.close()
  }
}

async function exactEntry(parent: FileHandle, name: string, path: string): Promise<boolean> {
  const folded = fullCaseFold15_1(name)
  let count = 0
  let found = false
  for await (const entry of privateDirectoryEntries(parent)) {
    if (++count > DIRECTORY_ENTRIES)
      invalid('ADD_USE_LIMIT', 'The source directory exceeds the entry limit.', path)
    if (entry.name === name) found = true
    else if (fullCaseFold15_1(normalizeNfc15_1(entry.name)) === folded)
      invalid('ADD_USE_PATH', 'A differently spelled path collides with the selected path.', path)
  }
  return found
}

async function requireRegularFile(parent: FileHandle, name: string): Promise<BigIntStats> {
  const file = await openPrivateSourceChild(
    parent,
    name,
    constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const info = await file.stat({ bigint: true })
    if (!info.isFile() || info.nlink !== 1n)
      invalid('ADD_USE_PATH', 'Select regular, singly linked source files.', name)
    return info
  } finally {
    await file.close()
  }
}

async function requireCodeEntrypoint(directory: FileHandle, path: string): Promise<string> {
  let entrypoint: string | undefined
  let count = 0
  for await (const entry of privateDirectoryEntries(directory)) {
    if (++count > DIRECTORY_ENTRIES)
      invalid('ADD_USE_LIMIT', 'The source directory exceeds the entry limit.', path)
    const folded = fullCaseFold15_1(entry.name)
    if (
      !folded.startsWith('flow.') ||
      packageEntrypointSuffix(`FLOW.${folded.slice(5)}`) === undefined
    )
      continue
    const suffix = packageEntrypointSuffix(entry.name)
    if (entrypoint !== undefined || suffix === undefined || suffix === 'md' || !entry.isFile())
      invalid(
        'ADD_USE_PATH',
        'Select a Flow with one exact code entrypoint and a standalone FLOW.meta.json.',
        path,
      )
    entrypoint = entry.name
  }
  if (entrypoint === undefined)
    invalid('ADD_USE_PATH', 'Select a Flow with one code entrypoint.', path)
  await requireRegularFile(directory, entrypoint)
  return entrypoint
}

async function readSidecar(directory: FileHandle, path: string) {
  const info = await requireRegularFile(directory, METADATA)
  const captured = await captureOpenedPackageDirectory(path, directory, {
    includes: (name) => name === METADATA,
    maximumFiles: 1,
    maximumBytes: METADATA_BYTES,
  })
  try {
    const bytes = await captured.read(METADATA, METADATA_BYTES)
    await verifySidecar(directory, info, path)
    return { bytes, info }
  } finally {
    await captured.dispose()
  }
}

function parseSidecar(bytes: Uint8Array, path: string) {
  try {
    return parseFlowMetadataSidecar(bytes)
  } catch (error) {
    if (error instanceof CheckError)
      throw new CheckError(error.kind, error.code, error.message, path, error.pointer)
    throw error
  }
}

async function writeStageFile(parent: FileHandle, name: string, source: string, mode = 0o600) {
  const file = await openPrivateFile(
    privateChildLocation(parent, name),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
  )
  try {
    await file.writeFile(source)
    await file.chmod(mode)
    await file.sync()
    return await file.stat({ bigint: true })
  } finally {
    await file.close()
  }
}

async function verifyVisiblePackage(root: FileHandle, path: string, held: FileHandle) {
  const visible = await openExactDirectory(root, path)
  try {
    if (!sameIdentity(await visible.stat({ bigint: true }), await held.stat({ bigint: true })))
      sourceChanged(path)
  } finally {
    await visible.close()
  }
}

async function verifySidecar(directory: FileHandle, before: BigIntStats, path: string) {
  if (!(await exactEntry(directory, METADATA, path))) sourceChanged(path)
  await verifyFile(directory, before, path)
}

async function verifyFile(directory: FileHandle, before: BigIntStats, path: string) {
  const after = await requireRegularFile(directory, METADATA)
  if (
    !sameIdentity(before, after) ||
    before.size !== after.size ||
    before.mode !== after.mode ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  )
    sourceChanged(path)
}

async function verifyIdentity(location: PrivateChildLocation, before: BigIntStats, path: string) {
  if (!sameIdentity(await statPrivateFile(location), before)) sourceChanged(path)
}

function sameIdentity(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev && left.ino === right.ino
}

function sourceChanged(path: string): never {
  return invalid(
    'PROJECT_SOURCE_CHANGED',
    'The source changed during the edit. Inspect it before retrying.',
    path,
  )
}
function destinationExists(path: string): never {
  return invalid(
    'ADD_USE_EXISTS',
    'The contract destination already exists. Choose an unused slot.',
    path,
  )
}
function stageExists(): never {
  return unavailable(
    'ADD_USE_BUSY',
    'An edit is active or its staging directory remains. Inspect it before retrying.',
    STAGE,
  )
}
function recoveryRequired(committed: boolean, path: string): never {
  return unavailable(
    'ADD_USE_RECOVERY',
    committed
      ? 'The slot and its contract were published. Inspect .jig-add-use-stage before retrying.'
      : 'The edit could not finish cleanly. Inspect FLOW.meta.json, the contract directory and .jig-add-use-stage before retrying.',
    path,
  )
}
function errorCode(error: unknown): string | undefined {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
}
