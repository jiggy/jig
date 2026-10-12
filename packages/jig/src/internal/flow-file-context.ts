import {
  bindingAttachmentLocalName,
  validateBindingAttachmentMapForInterfaces,
} from '../project/attachment-routes.js'
import type { BindingAttachmentMap } from '../project/author.js'
import {
  type PrivateFileImportTarget,
  requirePrivateFileImportTarget,
} from './execution-file-import.js'
import type { PrivateExecutionIntent } from './execution-intent.js'
import {
  type PrivateCapturedAttachment,
  type PrivateCapturedFile,
  privateFilePath,
} from './file-input.js'
import { requirePrivateCapturedInput } from './input-capture.js'

type Declarations = Readonly<Record<string, 'read' | 'read-write'>>
type ReadView = readonly PrivateCapturedFile[]
interface RootLifetime {
  ended: boolean
}
interface HeldContext {
  readonly declarations: Declarations
  readonly reads: ReadonlyMap<string, ReadView>
  readonly prefix: string
  readonly root: RootLifetime
  readonly parent?: HeldContext
  outputImport?: PrivateFileImportTarget
  closed: boolean
}

/** Invocation-scoped file authority. It owns no input bytes or native storage;
 * those remain with the root owner until every descendant and delivery settles. */
export interface PrivateFlowFileContext {
  close(): void
}
const contexts = new WeakMap<PrivateFlowFileContext, HeldContext>()

interface HeldChildPlan {
  readonly caller: PrivateFlowFileContext
  readonly declarations: Declarations
  readonly reads: ReadonlyMap<string, ReadView>
  readonly write: {
    readonly into: string
    readonly directory: string
    readonly prefix: string
  } | null
}
export interface PrivateChildFlowFilePlan {
  readonly write: {
    readonly into: string
    readonly directory: string
    readonly prefix: string
  } | null
}
const childPlans = new WeakMap<PrivateChildFlowFilePlan, HeldChildPlan>()

/** The root output owner reads only an authenticated plan for this live caller.
 * A copied plan, another caller or an ended ancestor cannot reserve storage. */
export function requirePrivateChildFlowFilePlanWrite(
  plan: PrivateChildFlowFilePlan,
  caller: PrivateFlowFileContext,
): PrivateChildFlowFilePlan['write'] {
  const held = childPlans.get(plan)
  if (held === undefined || held.caller !== caller)
    throw new TypeError('child file plan does not belong to this caller')
  requireContext(caller)
  return held.write
}

export function createPrivateRootFlowFileContext(input: {
  readonly declarations: Declarations
  readonly captured: readonly Pick<PrivateCapturedAttachment, 'name' | 'files'>[]
}): PrivateFlowFileContext {
  const declarations = requireDeclarations(input.declarations)
  const reads = new Map<string, ReadView>()
  for (const capture of input.captured) {
    if (declarations[capture.name] !== 'read' || reads.has(capture.name))
      throw new TypeError('captured input does not match its root declaration')
    reads.set(capture.name, retainReadView(capture.files))
  }
  if (Object.entries(declarations).some(([name, access]) => access === 'read' && !reads.has(name)))
    throw new TypeError('root immutable input view is missing')
  return retain(
    {
      declarations,
      reads,
      prefix: '',
      root: { ended: false },
      closed: false,
    },
    true,
  )
}

/** Validate the complete retained map before allocating any child stage. A read
 * receives the immediate caller's whole original view, never a captured copy. */
export function planPrivateChildFlowFiles(input: {
  readonly caller: PrivateFlowFileContext
  readonly declarations: Declarations
  readonly mapping: BindingAttachmentMap | null
}): PrivateChildFlowFilePlan {
  const caller = requireContext(input.caller)
  const declarations = requireDeclarations(input.declarations)
  const mapping =
    input.mapping === null
      ? null
      : validateBindingAttachmentMapForInterfaces({
          attachments: input.mapping,
          caller: caller.declarations,
          child: declarations,
        })
  if (
    Object.keys(declarations).sort().join() !==
    Object.keys(mapping ?? {})
      .sort()
      .join()
  )
    throw new TypeError('child attachment map does not supply every declared port')
  const reads = new Map<string, ReadView>()
  let write: HeldChildPlan['write'] = null
  for (const [name, item] of Object.entries(mapping ?? {})) {
    if ('from' in item) {
      if (declarations[name] !== 'read' || caller.declarations[item.from] !== 'read')
        throw new TypeError('child read must borrow an immediate caller read port')
      const view = caller.reads.get(item.from)
      if (view === undefined) throw new TypeError('immediate caller immutable input is unavailable')
      reads.set(name, view)
    } else {
      if (
        declarations[name] !== 'read-write' ||
        caller.declarations[item.into] !== 'read-write' ||
        write !== null
      )
        throw new TypeError('child output must use one immediate caller write port')
      const prefix = [caller.prefix, item.directory].filter(Boolean).join('/')
      privateFilePath(prefix)
      write = Object.freeze({ into: item.into, directory: item.directory, prefix })
    }
  }
  const plan = Object.freeze({ write })
  childPlans.set(plan, { caller: input.caller, declarations, reads, write })
  return plan
}

/** A child borrows only reviewed immutable views. Its ordinary native execution
 * owns its separate output storage; no parent filesystem is borrowed. */
export function createPrivateChildFlowFileContext(
  plan: PrivateChildFlowFilePlan,
): PrivateFlowFileContext {
  const held = childPlans.get(plan)
  if (held === undefined) throw new TypeError('child file plan is unavailable')
  const caller = requireContext(held.caller)
  // One operation owns one context. Identical transport waiters join the
  // controller's operation, rather than creating another native writer.
  childPlans.delete(plan)
  return retain(
    {
      declarations: held.declarations,
      reads: held.reads,
      prefix: held.write?.prefix ?? '',
      root: caller.root,
      parent: caller,
      closed: false,
    },
    false,
  )
}

export function privateFlowFileExecutionProjection(context: PrivateFlowFileContext): {
  readonly plan: Pick<PrivateExecutionIntent, 'capturedInputs' | 'inputDirectories' | 'output'>
  readonly attachments: Readonly<Record<string, { readonly access: 'read' | 'read-write' }>>
} {
  const held = requireContext(context)
  return {
    plan: {
      capturedInputs: [...held.reads].flatMap(([name, files]) =>
        files.map((file) => ({
          input: file.input,
          destination: `/jig-input/${name}/${file.path}`,
        })),
      ),
      inputDirectories: [...held.reads.keys()].map((name) => `/jig-input/${name}`),
      output: Object.values(held.declarations).includes('read-write'),
    },
    attachments: Object.freeze(
      Object.fromEntries(
        Object.entries(held.declarations).map(([name, access]) => [
          name,
          Object.freeze({ access }),
        ]),
      ),
    ),
  }
}

/** Native authority is issued by the admitted caller; an attachment map cannot mint it. */
export function bindPrivateFlowFileImportTarget(
  context: PrivateFlowFileContext,
  target: PrivateFileImportTarget,
): void {
  const held = requireContext(context)
  if (!Object.values(held.declarations).includes('read-write'))
    throw new TypeError('file import requires a declared writable caller port')
  requirePrivateFileImportTarget(target)
  if (held.outputImport !== undefined && held.outputImport !== target)
    throw new TypeError('caller file import target is already bound')
  held.outputImport = target
}

export function privateFlowFileImportTarget(
  context: PrivateFlowFileContext,
): PrivateFileImportTarget {
  const held = requireContext(context)
  if (held.outputImport === undefined)
    throw new TypeError('caller native file import target is unavailable')
  return requirePrivateFileImportTarget(held.outputImport)
}

function requireContext(context: PrivateFlowFileContext): HeldContext {
  const held = contexts.get(context)
  if (held === undefined || held.closed || held.root.ended)
    throw new TypeError('Flow file context is unavailable')
  for (let parent = held.parent; parent !== undefined; parent = parent.parent) {
    if (parent.closed) throw new TypeError('ancestor Flow file context is unavailable')
  }
  for (const files of held.reads.values())
    for (const file of files) requirePrivateCapturedInput(file.input)
  return held
}

function retain(held: HeldContext, root: boolean): PrivateFlowFileContext {
  const context: PrivateFlowFileContext = Object.freeze({
    close() {
      held.closed = true
      if (root) held.root.ended = true
    },
  })
  contexts.set(context, held)
  return context
}

function requireDeclarations(value: Declarations): Declarations {
  const entries = Object.entries(value)
  if (entries.length > 8) throw new TypeError('too many Flow attachment ports')
  for (const [name, access] of entries) {
    bindingAttachmentLocalName(name)
    if (access !== 'read' && access !== 'read-write')
      throw new TypeError('invalid Flow attachment access')
  }
  return Object.freeze(Object.fromEntries(entries))
}

function retainReadView(files: readonly PrivateCapturedFile[]): ReadView {
  const view = files.map((file) => {
    privateFilePath(file.path)
    requirePrivateCapturedInput(file.input)
    return Object.freeze({ path: file.path, input: file.input })
  })
  if (new Set(view.map((file) => file.path)).size !== view.length)
    throw new TypeError('immutable input contains duplicate paths')
  return Object.freeze(view)
}
