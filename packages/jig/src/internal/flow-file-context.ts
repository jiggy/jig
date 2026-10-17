import { randomUUID } from 'node:crypto'
import {
  bindingAttachmentLocalName,
  validateBindingAttachmentMapForInterfaces,
} from '../project/attachment-routes.js'
import type { BindingAttachmentMap } from '../project/author.js'
import { ChannelOperationError } from '../run/channels.js'
import type { RunHostCall } from '../run/session.js'
import {
  capturePrivateInputViewOutput,
  capturePrivateOutput,
  type PrivateCapturedOutput,
} from './captured-output.js'
import type { PrivateExecutionIntent } from './execution-intent.js'
import type { PrivateExecutionOutput } from './execution-output.js'
import {
  type PrivateCapturedAttachment,
  type PrivateCapturedFile,
  privateFilePath,
} from './file-input.js'
import { capturePrivateArtifactInput, requirePrivateCapturedInput } from './input-capture.js'

type Declarations = Readonly<Record<string, 'read' | 'read-write'>>
type ReadView = readonly PrivateCapturedFile[]
interface Artifact {
  readonly root: RootLifetime
  readonly reads?: ReadView
  snapshot?: PrivateCapturedOutput
  projection?: ReadView
  retained?: boolean
}
interface RootLifetime {
  ended: boolean
  readonly artifacts: Set<Artifact>
  bytes: number
  references: number
  pendingCaptures: number
}
interface HeldContext {
  readonly declarations: Declarations
  readonly reads: ReadonlyMap<string, ReadView>
  readonly readArtifacts: ReadonlyMap<string, string>
  readonly rights: Map<string, Artifact>
  readonly root: RootLifetime
  readonly parent?: HeldContext
  closed: boolean
}
/** Participant-local authority; references alone never authenticate a tree. */
export interface PrivateFlowFileContext {
  close(): void
}
const contexts = new WeakMap<PrivateFlowFileContext, HeldContext>()
const uncertainArtifacts = new Set<Artifact>()
export class PrivateArtifactPermissionError extends ChannelOperationError {
  constructor() {
    super('PERMISSION_DENIED', 'participant does not hold this artifact')
  }
}
interface HeldChildPlan {
  readonly caller: PrivateFlowFileContext
  readonly declarations: Declarations
  readonly reads: ReadonlyMap<string, ReadView>
  readonly artifacts: ReadonlyMap<string, Artifact>
}
/** Opaque, participant-authenticated plan, consumed once at native admission. */
export type PrivateChildFlowFilePlan = {}
const childPlans = new WeakMap<PrivateChildFlowFilePlan, HeldChildPlan>()

export function createPrivateRootFlowFileContext(input: {
  readonly declarations: Declarations
  readonly captured: readonly Pick<PrivateCapturedAttachment, 'name' | 'files'>[]
}): PrivateFlowFileContext {
  const declarations = requireDeclarations(input.declarations)
  const root: RootLifetime = {
    ended: false,
    artifacts: new Set(),
    bytes: 0,
    references: 0,
    pendingCaptures: 0,
  }
  const held: HeldContext = {
    declarations,
    root,
    reads: new Map(),
    readArtifacts: new Map(),
    rights: new Map(),
    closed: false,
  }
  const reads = held.reads as Map<string, ReadView>
  const refs = held.readArtifacts as Map<string, string>
  for (const capture of input.captured) {
    if (declarations[capture.name] !== 'read' || reads.has(capture.name))
      throw new TypeError('captured input does not match its root declaration')
    const view = retainReadView(capture.files)
    reads.set(capture.name, view)
    const artifact: Artifact = { root, reads: view }
    refs.set(capture.name, grant(held, artifact))
  }
  if (Object.entries(declarations).some(([name, access]) => access === 'read' && !reads.has(name)))
    throw new TypeError('root immutable input view is missing')
  return retain(held, true)
}

/** Static borrowing and explicit call rights combine only at disjoint reviewed ports. */
export function planPrivateChildFlowFiles(input: {
  readonly caller: PrivateFlowFileContext
  readonly declarations: Declarations
  readonly mapping: BindingAttachmentMap | null
  readonly attachments?: RunHostCall['attachments']
}): PrivateChildFlowFilePlan {
  const caller = requireContext(input.caller)
  const declarations = requireDeclarations(input.declarations)
  const mapping =
    input.mapping === null
      ? {}
      : validateBindingAttachmentMapForInterfaces({
          attachments: input.mapping,
          caller: caller.declarations,
          child: declarations,
        })
  if (Object.keys(declarations).sort().join() !== Object.keys(mapping).sort().join())
    throw new TypeError('child attachment map does not supply every declared port')
  const supplied = input.attachments ?? {}
  if (Object.keys(supplied).some((name) => !Object.hasOwn(mapping, name)))
    throw new TypeError('call supplies an undeclared attachment')
  const reads = new Map<string, ReadView>()
  const artifacts = new Map<string, Artifact>()
  for (const [name, item] of Object.entries(mapping)) {
    if ('from' in item) {
      if (Object.hasOwn(supplied, name)) throw new TypeError('call cannot override a static read')
      const reference = caller.readArtifacts.get(item.from)
      const artifact = reference === undefined ? undefined : caller.rights.get(reference)
      const view = caller.reads.get(item.from)
      if (view === undefined || artifact === undefined)
        throw new TypeError('caller read is unavailable')
      reads.set(name, view)
      artifacts.set(name, artifact)
    } else if ('supplied' in item) {
      const value = supplied[name]
      if (value === undefined || !('read' in value))
        throw new TypeError('call must supply a held read artifact')
      const artifact = requireRight(caller, value.read)
      reads.set(name, projection(artifact))
      artifacts.set(name, artifact)
    } else {
      const value = supplied[name]
      if (
        !('create' in item) ||
        value === undefined ||
        !('create' in value) ||
        value.create !== true
      )
        throw new TypeError('call must request its reviewed operation-owned output')
    }
  }
  const plan = Object.freeze({})
  childPlans.set(plan, { caller: input.caller, declarations, reads, artifacts })
  return plan
}

export function createPrivateChildFlowFileContext(
  plan: PrivateChildFlowFilePlan,
): PrivateFlowFileContext {
  const held = childPlans.get(plan)
  if (held === undefined) throw new TypeError('child file plan is unavailable')
  const caller = requireContext(held.caller)
  if (caller.root.references + held.artifacts.size > 256)
    throw new ChannelOperationError('RESOURCE_EXHAUSTED', 'root artifact reference limit exceeded')
  childPlans.delete(plan)
  const context: HeldContext = {
    declarations: held.declarations,
    reads: held.reads,
    readArtifacts: new Map(),
    rights: new Map(),
    root: caller.root,
    parent: caller,
    closed: false,
  }
  for (const [name, artifact] of held.artifacts)
    (context.readArtifacts as Map<string, string>).set(name, grant(context, artifact))
  return retain(context, false)
}

export function privateFlowFileExecutionProjection(context: PrivateFlowFileContext): {
  readonly plan: Pick<
    PrivateExecutionIntent,
    'capturedInputs' | 'inputDirectories' | 'inputEmptyDirectories' | 'output'
  >
  readonly attachments: Readonly<
    Record<string, { readonly access: 'read' | 'read-write'; readonly artifact?: string }>
  >
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
      ...([...held.readArtifacts].some(
        ([, reference]) => (held.rights.get(reference)?.snapshot?.directories.length ?? 0) > 0,
      )
        ? {
            inputEmptyDirectories: [...held.readArtifacts].flatMap(([name, reference]) =>
              (held.rights.get(reference)?.snapshot?.directories ?? []).map(
                (directory) => `/jig-input/${name}/${directory}`,
              ),
            ),
          }
        : {}),
      output: Object.values(held.declarations).includes('read-write'),
    },
    attachments: Object.freeze(
      Object.fromEntries(
        Object.entries(held.declarations).map(([name, access]) => [
          name,
          Object.freeze({
            access,
            ...(access === 'read' ? { artifact: held.readArtifacts.get(name)! } : {}),
          }),
        ]),
      ),
    ),
  }
}

/** Capture before native cleanup; this does not issue any participant right. */
export async function capturePrivateFlowArtifact(
  context: PrivateFlowFileContext,
  output: PrivateExecutionOutput,
  signal?: AbortSignal,
): Promise<PrivateCapturedOutput> {
  const held = requireContext(context)
  if (
    held.root.artifacts.size + held.root.pendingCaptures >= 16 ||
    held.root.bytes + (held.root.pendingCaptures + 1) * 16 * 1024 * 1024 > 256 * 1024 * 1024
  )
    throw new TypeError('root artifact retention limit exceeded')
  held.root.pendingCaptures++
  try {
    const snapshot =
      output.kind === 'linux-directory'
        ? capturePrivateOutput(output.directory.fd, signal)
        : await output.ready
    try {
      requireContext(context)
    } catch (error) {
      if (output.kind === 'linux-directory') snapshot.close()
      throw error
    }
    held.root.artifacts.add({ root: held.root, snapshot })
    held.root.bytes += snapshot.bytes
    return snapshot
  } finally {
    held.root.pendingCaptures--
  }
}

/** Only the controller calls this after result admission, fencing and confirmed cleanup. */
export function commitPrivateFlowArtifact(
  context: PrivateFlowFileContext,
  snapshot: PrivateCapturedOutput,
): string {
  const held = requireContext(context)
  const artifact = [...held.root.artifacts].find((item) => item.snapshot === snapshot)
  if (artifact === undefined) throw new TypeError('artifact capture does not belong to this root')
  return grant(held, artifact)
}

/** Atomically expose a complete accepted result's grants to its caller. */
export function commitPrivateFlowArtifacts(
  context: PrivateFlowFileContext,
  snapshots: Readonly<Record<string, PrivateCapturedOutput>>,
): Readonly<Record<string, string>> {
  const held = requireContext(context)
  if (held.root.references + Object.keys(snapshots).length > 256)
    throw new ChannelOperationError('RESOURCE_EXHAUSTED', 'root artifact reference limit exceeded')
  const values = Object.entries(snapshots).map(([name, snapshot]) => {
    bindingAttachmentLocalName(name)
    const artifact = [...held.root.artifacts].find((item) => item.snapshot === snapshot)
    if (artifact === undefined) throw new TypeError('artifact capture does not belong to this root')
    return [name, artifact] as const
  })
  const references: Record<string, string> = Object.create(null)
  try {
    for (const [name, artifact] of values) references[name] = grant(held, artifact)
    return Object.freeze(references)
  } catch (error) {
    for (const reference of Object.values(references)) {
      held.rights.delete(reference)
      held.root.references--
    }
    throw error
  }
}

export function releasePrivateFlowArtifact(
  context: PrivateFlowFileContext,
  reference: string,
): void {
  const held = requireContext(context)
  requireRight(held, reference)
  held.rights.delete(reference)
  held.root.references--
}

/** Borrowed immutable snapshot for an admitted native reader; the root keeps its lifetime. */
export function resolvePrivateFlowArtifact(
  context: PrivateFlowFileContext,
  reference: string,
): PrivateCapturedOutput {
  return selectedPrivateFlowArtifacts(context, ['artifact'], { artifact: reference }).artifact!
}

/** Transfer final snapshot retirement to the command/ticket owner, without copying bytes. */
export function retainPrivateFlowArtifactResults(
  context: PrivateFlowFileContext,
  snapshots: Readonly<Record<string, PrivateCapturedOutput>>,
): void {
  const held = requireContext(context)
  for (const snapshot of Object.values(snapshots)) {
    const artifact = [...held.root.artifacts].find((item) => item.snapshot === snapshot)
    if (artifact === undefined) throw new TypeError('snapshot does not belong to this root')
    artifact.retained = true
  }
}

/** Validate exact declarations while the participant is live, then return original snapshots. */
export function selectedPrivateFlowArtifacts(
  context: PrivateFlowFileContext,
  names: readonly string[],
  selected: Readonly<Record<string, string>> = {},
): Readonly<Record<string, PrivateCapturedOutput>> {
  const held = requireContext(context)
  if (Object.keys(selected).some((name) => !names.includes(name)))
    throw new TypeError('artifact result name is not declared')
  const result: Record<string, PrivateCapturedOutput> = Object.create(null)
  for (const name of Object.keys(selected)) {
    bindingAttachmentLocalName(name)
    const artifact = requireRight(held, selected[name]!)
    if (artifact.snapshot === undefined) {
      if (held.root.artifacts.size + held.root.pendingCaptures >= 16)
        throw new TypeError('root artifact retention limit exceeded')
      const bytes = artifact.reads!.reduce((sum, file) => sum + file.input.bytes, 0)
      if (
        held.root.bytes + held.root.pendingCaptures * 16 * 1024 * 1024 + bytes >
        256 * 1024 * 1024
      ) {
        throw new TypeError('root artifact byte limit exceeded')
      }
      const snapshot = capturePrivateInputViewOutput(artifact.reads!)
      artifact.snapshot = snapshot
      held.root.artifacts.add(artifact)
      held.root.bytes += snapshot.bytes
    }
    result[name] = artifact.snapshot
  }
  return Object.freeze(result)
}

function requireRight(held: HeldContext, reference: string): Artifact {
  const artifact = held.rights.get(reference)
  if (artifact === undefined || artifact.root !== held.root)
    throw new PrivateArtifactPermissionError()
  return artifact
}
function grant(held: HeldContext, artifact: Artifact): string {
  if (held.root.references >= 256)
    throw new ChannelOperationError('RESOURCE_EXHAUSTED', 'root artifact reference limit exceeded')
  const reference = `a-${randomUUID()}`
  held.rights.set(reference, artifact)
  held.root.references++
  return reference
}
function projection(artifact: Artifact): ReadView {
  if (artifact.reads !== undefined) return artifact.reads
  if (artifact.projection !== undefined) return artifact.projection
  const snapshot = artifact.snapshot!
  if (
    artifact.root.bytes + artifact.root.pendingCaptures * 16 * 1024 * 1024 + snapshot.bytes >
    256 * 1024 * 1024
  )
    throw new TypeError('artifact materialization exceeds native input limits')
  const files: PrivateCapturedFile[] = []
  try {
    for (const file of snapshot.files)
      files.push(
        Object.freeze({ path: file.path, input: capturePrivateArtifactInput(snapshot, file) }),
      )
  } catch (error) {
    for (const file of files) file.input.close()
    throw error
  }
  artifact.projection = Object.freeze(files)
  artifact.root.bytes += snapshot.bytes
  return artifact.projection
}
function requireContext(context: PrivateFlowFileContext): HeldContext {
  const held = contexts.get(context)
  if (held === undefined || held.closed || held.root.ended)
    throw new TypeError('Flow file context is unavailable')
  for (let parent = held.parent; parent !== undefined; parent = parent.parent)
    if (parent.closed) throw new TypeError('ancestor Flow file context is unavailable')
  for (const files of held.reads.values())
    for (const file of files) requirePrivateCapturedInput(file.input)
  return held
}
function retain(held: HeldContext, root: boolean): PrivateFlowFileContext {
  const context = Object.freeze({
    close() {
      if (held.closed) return
      held.closed = true
      held.root.references -= held.rights.size
      held.rights.clear()
      if (root) {
        held.root.ended = true
        const errors: unknown[] = []
        for (const artifact of held.root.artifacts) {
          uncertainArtifacts.add(artifact)
          let failed = false
          for (const file of artifact.projection ?? []) {
            try {
              file.input.close()
            } catch (error) {
              errors.push(error)
              failed = true
            }
          }
          if (!artifact.retained) {
            try {
              artifact.snapshot?.close()
            } catch (error) {
              errors.push(error)
              failed = true
            }
          }
          if (!failed) uncertainArtifacts.delete(artifact)
        }
        if (errors.length !== 0)
          throw new AggregateError(errors, 'artifact retirement is unconfirmed')
      }
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
