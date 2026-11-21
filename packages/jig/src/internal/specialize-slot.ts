import { type BigIntStats, constants } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { posix } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { CheckError, invalid, unavailable } from '../diagnostics.js'
import {
  appendBindingMemberLiteral,
  replaceBindingSlotLiteral,
} from '../project/agent-source-location.js'
import {
  type BindingDefinition,
  type JigDefinition,
  normalizeJigDefinition,
  parseRunTargetSelector,
} from '../project/author.js'
import type { PrivateAuthorEvaluatorOptions } from '../project/author-evaluator.js'
import {
  type CapturedAuthorClosure,
  captureOpenedAuthorClosure,
  checkStandaloneAuthorAddition,
} from '../project/author-module.js'
import { openDeclarationDirectory } from '../project/declaration-source.js'
import { flowSelector } from '../project/package-selector.js'
import { assertNoProjectPathCollisions } from '../project/paths.js'
import type { PrivateProjectRoot } from '../project/root.js'
import {
  mkdirPrivateFile,
  openPrivateFile,
  privateChildLocation,
  renamePrivateFile,
  rmdirPrivateFile,
  statPrivateFile,
  unlinkPrivateFile,
} from './descriptor-files.js'
import { privatePublishDirectory } from './file-input.js'
import { captureWorkingProject } from './working-flow-inspection.js'

export interface SlotSpecialization {
  readonly caller: string
  readonly slot: string
  readonly name: string
  readonly childSlot: string
  readonly target: string
}

const STAGE = '.jig-specialize-slot-stage'
const PROJECT_ENTRY = 'jig.ts'

/** Scope a Binding selection using one captured configuration and the ordinary linker. */
export async function specializeWorkingSlot(
  project: string,
  evaluator: PrivateAuthorEvaluatorOptions,
  request: SlotSpecialization,
  signal?: AbortSignal,
) {
  return captureWorkingProject(
    project,
    evaluator,
    async ({ root, authoring, bindings, linked, link }) => {
      const { bindingSource, closure } = authoring
      const { caller, slot, name, childSlot, target } = request
      const members = new Map(bindingSource.members.map((member) => [member.id, member]))
      const existing = members.get(name)
      if (existing)
        invalid(
          'SPECIALIZE_SLOT_EXISTS',
          'The new Binding name already exists. Choose an unused name.',
          existing.projectPath,
        )
      const callerMember = members.get(caller)
      if (!callerMember)
        invalid(
          'SPECIALIZE_SLOT_CALLER',
          'The caller Binding is absent. Find its exact name with jig inspect --flow.',
        )
      const callerDefinition = bindings.find(
        (binding) => binding.sourcePath === callerMember.projectPath,
      )!.definition
      const childSelector = authoredSelection(callerDefinition, slot)
      const childMember = childSelector?.startsWith('binding:')
        ? members.get(childSelector.slice(8))
        : undefined
      if (childSelector === undefined || childMember === undefined)
        invalid(
          'SPECIALIZE_SLOT_CHILD',
          'The caller slot must explicitly select a Binding.',
          callerMember.projectPath,
          '/slots/' + slot,
        )
      const childDefinition = bindings.find(
        (binding) => binding.sourcePath === childMember.projectPath,
      )!.definition
      const previous = authoredSelection(childDefinition, childSlot)
      if (previous === undefined || previous.startsWith('grant:'))
        invalid(
          'SPECIALIZE_SLOT_SELECTION',
          'The child slot must explicitly select a Flow or Binding.',
          childMember.projectPath,
          '/slots/' + childSlot,
        )
      if (previous === target)
        invalid(
          'SPECIALIZE_SLOT_SELECTION',
          'Choose a different target for the child slot.',
          childMember.projectPath,
          '/slots/' + childSlot,
        )

      const callerPath = callerMember.projectPath
      const childPath = childMember.projectPath
      const callerParent = posix.dirname(callerPath)
      const childParent = posix.dirname(childPath)
      const newPath = posix.join(childParent, name + '.ts')
      const newSelector = 'binding:' + name
      try {
        assertNoProjectPathCollisions(
          [...closure.modules.map((module) => module.projectPath), newPath],
          'author closure',
        )
      } catch {
        invalid(
          'SPECIALIZE_SLOT_EXISTS',
          'The new path is invalid or collides with an author module. Choose another name.',
          newPath,
        )
      }
      const config = explicitMembershipEdit(closure, authoring.project.value, newPath)
      for (const module of closure.modules) {
        const shared = module.imports.find(
          (edge) =>
            edge.projectPath === callerPath ||
            (config !== undefined && edge.projectPath === PROJECT_ENTRY),
        )
        if (shared)
          invalid(
            'SPECIALIZE_SLOT_SHAPE',
            'Another author module imports this declaration. Make the scoped edit in source.',
            shared.projectPath,
          )
      }
      const callerBytes = closure.read(callerPath)
      const edited = editLiteral(callerPath, callerBytes, slot, childSelector, newSelector)
      const copied = editLiteral(childPath, closure.read(childPath), childSlot, previous, target)
      checkStandaloneAuthorAddition(
        closure,
        Math.max(0, Buffer.byteLength(edited) - callerBytes.length) +
          Buffer.byteLength(copied) +
          (config ? Buffer.byteLength(config.after) - config.before.length : 0),
      )

      const added = {
        sourcePath: newPath,
        definition: withSelection(childDefinition, childSlot, target),
      }
      // The old configuration still links while an exact member is unselected.
      // Once selected, the new child must leave every existing route intact.
      const expanded = link([...bindings, added])
      const proposed = link([
        ...bindings.map((binding) =>
          binding.sourcePath === callerPath
            ? { ...binding, definition: withSelection(callerDefinition, slot, newSelector) }
            : binding,
        ),
        added,
      ])
      const proposedById = new Map(proposed.bindings.map((binding) => [binding.id, binding]))
      // Adding a provider can change implicit routes or direct targets. Require the
      // same linked facts everywhere except the two explicitly replaced targets.
      if (
        !isDeepStrictEqual(expanded.flows, linked.flows) ||
        !isDeepStrictEqual(
          expanded.bindings.filter((binding) => binding.id !== name),
          linked.bindings,
        ) ||
        !isDeepStrictEqual(
          expanded.bindings.find((binding) => binding.id === name),
          proposedById.get(name),
        ) ||
        !isDeepStrictEqual(proposed.flows, linked.flows) ||
        linked.bindings.some((binding) => {
          const current = proposedById.get(binding.id)
          if (binding.id !== caller || current === undefined)
            return !isDeepStrictEqual(binding, current)
          return (
            !isDeepStrictEqual(binding, { ...current, slots: binding.slots }) ||
            !sameOtherSlots(binding.slots, current.slots, slot)
          )
        }) ||
        !sameOtherSlots(
          linked.bindings.find((binding) => binding.id === childMember.id)!.slots,
          proposedById.get(name)!.slots,
          childSlot,
        )
      )
        invalid(
          'SPECIALIZE_SLOT_SCOPE',
          'The new Binding would change another configured route. Make the scoped edit in source.',
          newPath,
        )

      const stageLocation = privateChildLocation(root.handle, STAGE)
      let stage: FileHandle | undefined
      let callerDirectory: FileHandle | undefined
      let childDirectory: FileHandle | undefined
      let ownsStage = false
      let committed = false
      try {
        await mkdirPrivateFile(stageLocation)
        ownsStage = true
        stage = await openPrivateFile(stageLocation, constants.O_DIRECTORY | constants.O_NOFOLLOW)
        if (callerParent !== '.')
          callerDirectory = await openDeclarationDirectory(root, callerParent)
        if (childParent !== '.') childDirectory = await openDeclarationDirectory(root, childParent)
        const callerFile = privateChildLocation(
          callerDirectory ?? root.handle,
          posix.basename(callerPath),
        )
        const childFile = privateChildLocation(
          childDirectory ?? root.handle,
          posix.basename(childPath),
        )
        const destination = privateChildLocation(childFile.parent, name + '.ts')
        const configFile = privateChildLocation(root.handle, PROJECT_ENTRY)
        const configStat = config && (await statPrivateFile(configFile))
        const callerStat = await statPrivateFile(callerFile)
        await writeStage(stage, 'caller', edited, callerStat)
        const clone = await writeStage(stage, 'child', copied, await statPrivateFile(childFile))
        const stagedConfig =
          config && configStat && (await writeStage(stage, 'membership', config.after, configStat))
        if (config && configStat)
          await writeStage(stage, 'original-membership', config.before, configStat)

        await verifyClosure(root, closure)
        await bindingSource.verify()
        signal?.throwIfAborted()
        try {
          privatePublishDirectory(destination.parent.fd, 'child', destination.name, stage.fd)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST')
            invalid(
              'SPECIALIZE_SLOT_EXISTS',
              'The destination already exists. Choose an unused name.',
              newPath,
            )
          throw error
        }
        let membershipPublished = false
        let publishedConfig: BigIntStats | undefined
        let publishedChild: BigIntStats | undefined
        try {
          publishedChild = await verifyUnchanged(destination, clone, newPath, false)
          if (configStat && stagedConfig) {
            signal?.throwIfAborted()
            await verifyUnchanged(configFile, configStat, PROJECT_ENTRY)
            await renamePrivateFile(privateChildLocation(stage, 'membership'), configFile)
            membershipPublished = true
            publishedConfig = await verifyUnchanged(configFile, stagedConfig, PROJECT_ENTRY, false)
          }
          signal?.throwIfAborted()
          await verifyUnchanged(destination, publishedChild, newPath)
          if (publishedConfig) await verifyUnchanged(configFile, publishedConfig, PROJECT_ENTRY)
          await verifyUnchanged(callerFile, callerStat, callerPath)
          await renamePrivateFile(privateChildLocation(stage, 'caller'), callerFile)
          committed = true
        } catch (error) {
          try {
            if (config) {
              // A concurrent source edit may already use the copy. Preserve it
              // for inspection if the expected rollback state cannot be proved.
              await verifyClosure(root, closure, membershipPublished ? config.after : undefined)
              await bindingSource.verify()
              await verifyUnchanged(callerFile, callerStat, callerPath)
            }
            if (!publishedChild) throw error
            await verifyUnchanged(destination, publishedChild, newPath)
            if (membershipPublished) {
              if (!publishedConfig) throw error
              await verifyUnchanged(configFile, publishedConfig, PROJECT_ENTRY)
              // Remove selection before removing its referenced declaration.
              await renamePrivateFile(
                privateChildLocation(stage, 'original-membership'),
                configFile,
              )
              await verifyUnchanged(destination, publishedChild, newPath)
            }
            await unlinkPrivateFile(destination)
          } catch {
            unavailable(
              'SPECIALIZE_SLOT_CLEANUP',
              'The edit could not roll back. Inspect jig.ts, the caller, and the new Binding before retrying.',
              newPath,
            )
          }
          throw error
        }
      } catch (error) {
        if (error instanceof CheckError) throw error
        if (!ownsStage && (error as NodeJS.ErrnoException).code === 'EEXIST')
          unavailable(
            'SPECIALIZE_SLOT_BUSY',
            'Another edit is active or its staging directory remains. Check the directory before retrying.',
            STAGE,
          )
        unavailable(
          'SPECIALIZE_SLOT_IO',
          'The source edit could not finish. Check permissions on the affected source directories.',
          callerPath,
        )
      } finally {
        try {
          if (stage !== undefined) {
            try {
              for (const name of ['caller', 'child', 'membership', 'original-membership'])
                await removeStageFile(stage, name)
            } finally {
              await stage.close()
            }
          }
          if (ownsStage) await rmdirPrivateFile(stageLocation)
        } catch {
          // biome-ignore lint/correctness/noUnsafeFinally: A staging cleanup failure needs explicit operator recovery.
          unavailable(
            'SPECIALIZE_SLOT_CLEANUP',
            committed
              ? 'The source edits were published. Check the staging directory before another edit.'
              : 'The edit did not complete. Inspect jig.ts, the declarations, and the staging directory before retrying.',
            STAGE,
          )
        } finally {
          await Promise.all([callerDirectory?.close(), childDirectory?.close()])
        }
      }
      return {
        callerPath,
        childPath,
        newPath,
        previous,
        childSelector,
        membershipPath: config && PROJECT_ENTRY,
      }
    },
    signal,
  )
}

function explicitMembershipEdit(
  closure: CapturedAuthorClosure,
  project: JigDefinition,
  path: string,
) {
  const bindings = project.bindings
  if (bindings?.kind !== 'members') return undefined
  const before = closure.read(PROJECT_ENTRY)
  const after = appendBindingMemberLiteral(before, bindings.paths, path)
  if (after === undefined)
    invalid(
      'SPECIALIZE_SLOT_SHAPE',
      'Make the scoped edit in source and add the new Binding path to the bindings array in jig.ts.',
      PROJECT_ENTRY,
      '/bindings',
    )
  try {
    normalizeJigDefinition({
      ...project,
      bindings: { ...bindings, paths: [...bindings.paths, path] },
    })
  } catch {
    invalid(
      'SPECIALIZE_SLOT_SCOPE',
      'The added path would exceed project declaration limits.',
      path,
    )
  }
  return { before, after }
}

async function verifyClosure(
  root: PrivateProjectRoot,
  original: CapturedAuthorClosure,
  editedProject?: string,
): Promise<void> {
  const current = await captureOpenedAuthorClosure(root, original.entries)
  try {
    const matches =
      editedProject === undefined
        ? current.closureDigest === original.closureDigest
        : Buffer.from(current.read(PROJECT_ENTRY)).equals(Buffer.from(editedProject)) &&
          isDeepStrictEqual(
            current.modules.filter((module) => module.projectPath !== PROJECT_ENTRY),
            original.modules.filter((module) => module.projectPath !== PROJECT_ENTRY),
          )
    if (!matches)
      invalid(
        'PROJECT_SOURCE_CHANGED',
        'Author declarations changed during the edit. Inspect the source and retry.',
      )
  } finally {
    current.dispose()
  }
}

function authoredSelection(definition: BindingDefinition, slot: string): string | undefined {
  const value = definition.slots[slot]
  return typeof value === 'string' ? value : value && 'target' in value ? value.target : undefined
}

function withSelection(
  definition: BindingDefinition,
  slot: string,
  target: string,
): BindingDefinition {
  const value = definition.slots[slot]
  return {
    ...definition,
    slots: {
      ...definition.slots,
      [slot]: typeof value === 'object' && 'target' in value ? { ...value, target } : target,
    },
  }
}

function editLiteral(
  path: string,
  source: Uint8Array,
  slot: string,
  before: string,
  after: string,
): string {
  const edited = replaceBindingSlotLiteral(
    source,
    slot,
    (value) => {
      const selected = parseRunTargetSelector(value, 'slot target')
      return (
        (selected.kind === 'binding' ? 'binding:' + selected.id : flowSelector(selected.path)) ===
        before
      )
    },
    after,
  )
  if (edited === undefined)
    invalid(
      'SPECIALIZE_SLOT_SHAPE',
      'Use a standalone defineBinding declaration with literal values, or make the scoped edit in source.',
      path,
      '/slots/' + slot,
    )
  return edited
}

function sameOtherSlots(before: object, after: object, slot: string): boolean {
  const rest = (value: object) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== slot))
  return isDeepStrictEqual(rest(before), rest(after))
}

async function writeStage(
  parent: FileHandle,
  name: string,
  source: string | Uint8Array,
  original: BigIntStats,
): Promise<BigIntStats> {
  const file = await openPrivateFile(
    privateChildLocation(parent, name),
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
  )
  try {
    await file.writeFile(source)
    await file.chmod(Number(original.mode & 0o777n))
    await file.sync()
    return await file.stat({ bigint: true })
  } finally {
    await file.close()
  }
}

async function removeStageFile(parent: FileHandle, name: string): Promise<void> {
  try {
    await unlinkPrivateFile(privateChildLocation(parent, name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function verifyUnchanged(
  location: ReturnType<typeof privateChildLocation>,
  before: BigIntStats,
  path: string,
  checkCtime = true,
): Promise<BigIntStats> {
  const after = await statPrivateFile(location)
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.mode !== after.mode ||
    before.nlink !== after.nlink ||
    (checkCtime && before.ctimeNs !== after.ctimeNs)
  )
    invalid(
      'PROJECT_SOURCE_CHANGED',
      'The declaration changed during the edit. Inspect it and retry.',
      path,
    )
  return after
}
