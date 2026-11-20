import { type BigIntStats, constants } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { posix } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { CheckError, invalid, unavailable } from '../diagnostics.js'
import { replaceBindingSlotLiteral } from '../project/agent-source-location.js'
import { type BindingDefinition, parseRunTargetSelector } from '../project/author.js'
import type { PrivateAuthorEvaluatorOptions } from '../project/author-evaluator.js'
import {
  captureOpenedAuthorClosure,
  checkStandaloneAuthorAddition,
} from '../project/author-module.js'
import { openDeclarationDirectory } from '../project/declaration-source.js'
import { flowSelector } from '../project/package-selector.js'
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

export interface BindingSplit {
  readonly caller: string
  readonly slot: string
  readonly name: string
  readonly childSlot: string
  readonly target: string
}

const STAGE = '.jig-split-binding-stage'

/** Edit two ordinary declarations using one captured configuration and the ordinary linker. */
export async function splitWorkingBinding(
  project: string,
  evaluator: PrivateAuthorEvaluatorOptions,
  request: BindingSplit,
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
          'BINDING_SPLIT_EXISTS',
          'The new Binding name already exists. Choose an unused name.',
          existing.projectPath,
        )
      const callerMember = members.get(caller)
      if (!callerMember)
        invalid(
          'BINDING_SPLIT_CALLER',
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
          'BINDING_SPLIT_CHILD',
          'The caller slot must explicitly select a Binding.',
          callerMember.projectPath,
          '/slots/' + slot,
        )
      if (childMember.configuredRoot === undefined || callerMember.configuredRoot === undefined)
        invalid(
          'BINDING_SPLIT_SHAPE',
          'Use discovered Binding declarations, or make the scoped edit in source.',
          childMember.projectPath,
        )
      const childDefinition = bindings.find(
        (binding) => binding.sourcePath === childMember.projectPath,
      )!.definition
      const previous = authoredSelection(childDefinition, childSlot)
      if (previous === undefined || previous.startsWith('grant:'))
        invalid(
          'BINDING_SPLIT_SELECTION',
          'The child slot must explicitly select a Flow or Binding.',
          childMember.projectPath,
          '/slots/' + childSlot,
        )
      if (previous === target)
        invalid(
          'BINDING_SPLIT_SELECTION',
          'Choose a different target for the child slot.',
          childMember.projectPath,
          '/slots/' + childSlot,
        )

      const callerPath = callerMember.projectPath
      const childPath = childMember.projectPath
      const newPath = posix.join(childMember.configuredRoot, name + '.ts')
      const newSelector = 'binding:' + name
      const callerBytes = closure.read(callerPath)
      const edited = editLiteral(callerPath, callerBytes, slot, childSelector, newSelector)
      const copied = editLiteral(childPath, closure.read(childPath), childSlot, previous, target)
      checkStandaloneAuthorAddition(
        closure,
        Math.max(0, Buffer.byteLength(edited) - callerBytes.length) + Buffer.byteLength(copied),
      )

      const added = {
        sourcePath: newPath,
        definition: withSelection(childDefinition, childSlot, target),
      }
      // Publication adds a complete child before rewiring the caller. Validate
      // that either observable state links, including after an abrupt interruption.
      link([...bindings, added])
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
          'BINDING_SPLIT_SCOPE',
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
        callerDirectory = await openDeclarationDirectory(root, callerMember.configuredRoot)
        childDirectory = await openDeclarationDirectory(root, childMember.configuredRoot)
        const callerFile = privateChildLocation(callerDirectory, posix.basename(callerPath))
        const childFile = privateChildLocation(childDirectory, posix.basename(childPath))
        const destination = privateChildLocation(childDirectory, name + '.ts')
        const callerStat = await statPrivateFile(callerFile)
        await writeStage(stage, 'caller', edited, callerStat)
        const clone = await writeStage(stage, 'child', copied, await statPrivateFile(childFile))

        // Verify captured bytes and discovery membership after staging. The caller
        // check uses the held directory and identity immediately before replacement.
        const current = await captureOpenedAuthorClosure(root, closure.entries)
        try {
          if (current.closureDigest !== closure.closureDigest)
            invalid(
              'PROJECT_SOURCE_CHANGED',
              'Author declarations changed during the edit. Inspect the caller and retry.',
              callerPath,
            )
        } finally {
          current.dispose()
        }
        await bindingSource.verify()
        signal?.throwIfAborted()
        try {
          privatePublishDirectory(childDirectory.fd, 'child', destination.name, stage.fd)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST')
            invalid(
              'BINDING_SPLIT_EXISTS',
              'The destination already exists. Choose an unused name.',
              newPath,
            )
          throw error
        }
        try {
          signal?.throwIfAborted()
          const latest = await statPrivateFile(callerFile)
          if (!sameFile(callerStat, latest) || latest.ctimeNs !== callerStat.ctimeNs)
            invalid(
              'PROJECT_SOURCE_CHANGED',
              'The caller changed during the edit. Inspect it and retry.',
              callerPath,
            )
          await renamePrivateFile(privateChildLocation(stage, 'caller'), callerFile)
          committed = true
        } catch (error) {
          try {
            if (!sameFile(clone, await statPrivateFile(destination)))
              throw new Error('the new declaration changed after publication')
            await unlinkPrivateFile(destination)
          } catch {
            unavailable(
              'BINDING_SPLIT_CLEANUP',
              'The caller edit did not complete. Inspect the new Binding before retrying.',
              newPath,
            )
          }
          throw error
        }
      } catch (error) {
        if (error instanceof CheckError) throw error
        if (!ownsStage && (error as NodeJS.ErrnoException).code === 'EEXIST')
          unavailable(
            'BINDING_SPLIT_BUSY',
            'Another edit is active or its staging directory remains. Check the directory before retrying.',
            STAGE,
          )
        unavailable(
          'BINDING_SPLIT_IO',
          'The source edit could not finish. Check directory permissions and the caller.',
          callerPath,
        )
      } finally {
        try {
          if (stage !== undefined) {
            try {
              await removeStageFile(stage, 'caller')
              await removeStageFile(stage, 'child')
            } finally {
              await stage.close()
            }
          }
          if (ownsStage) await rmdirPrivateFile(stageLocation)
        } catch {
          // biome-ignore lint/correctness/noUnsafeFinally: A staging cleanup failure needs explicit operator recovery.
          unavailable(
            'BINDING_SPLIT_CLEANUP',
            committed
              ? 'Both Binding edits were published. Check the staging directory before another edit.'
              : 'The edit did not complete. Inspect the declaration paths and staging directory before retrying.',
            STAGE,
          )
        } finally {
          await Promise.all([callerDirectory?.close(), childDirectory?.close()])
        }
      }
      return { callerPath, childPath, newPath, previous, childSelector: childSelector }
    },
    signal,
  )
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
      'BINDING_SPLIT_SHAPE',
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
  source: string,
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

function sameFile(before: BigIntStats, after: BigIntStats): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.mode === after.mode &&
    before.nlink === after.nlink
  )
}
