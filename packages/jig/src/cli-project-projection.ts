import { createHmac, randomBytes } from 'node:crypto'
import {
  DISPLAY_COMPOSITION_BYTE_LIMIT,
  DISPLAY_COMPOSITION_EDGE_LIMIT,
  DISPLAY_COMPOSITION_NODE_LIMIT,
  type DisplayComposition,
  type DisplayCompositionNode,
  type DisplayProjectInput,
  type DisplayProjectSelection,
  type DisplayProjectSnapshot,
  type DisplayProjectTarget,
  validateDisplayProjectSnapshot,
} from '@jigging/display-model'
import { projectPrivateRunComposition, type PrivateCompositionSource } from './cli-composition.js'
import { CheckError } from './diagnostics.js'
import type { PrivateActivationCandidateArtifactV5 } from './internal/activation-admission.js'
import { inspectPrivateApprovedProject } from './internal/activation-admission-store.js'
import type { JsonValue } from './json.js'
import { parseProjectEntrypoint } from './project/entrypoint.js'
import type { RunTargetIdentity } from './project/package-project.js'
import { flowSelector } from './project/package-selector.js'
import { parseTarget } from './run-arguments.js'
import { compileEmbeddedSchema, SchemaDiagnostic } from './schema/index.js'
import { schemaTypeMismatchText } from './schema/types.js'

type RecordValue = Record<string, JsonValue>
function record(value: JsonValue | undefined): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : {}
}
function clipped(value: string, maximum: number): string {
  const characters = [...value]
  return characters.length <= maximum
    ? value
    : characters.slice(0, maximum - 10).join('') + ' [clipped]'
}
const targetKey = (target: RunTargetIdentity): string =>
  JSON.stringify([target.kind, target.kind === 'flow' ? target.path : target.id])
const selectorFor = (target: RunTargetIdentity): string =>
  target.kind === 'flow' ? flowSelector(target.path) : `binding:${target.id}`
const labelFor = (target: RunTargetIdentity): string =>
  clipped(target.kind === 'binding' ? target.id : target.path.split('/').at(-1)!, 256)

export class PrivateProjectProjectionError extends Error {
  constructor(
    readonly code:
      'PROJECT_CHANGED' | 'TARGET_UNAVAILABLE' | 'TARGET_MISSING' | 'PROJECT_UNREVIEWED' | 'INPUT_INVALID',
    message: string,
  ) {
    super(message)
    this.name = 'PrivateProjectProjectionError'
  }
}

export type PrivateProjectProjectionSource = Readonly<{
  catalogue: JsonValue
  selected: JsonValue
  composition: PrivateCompositionSource
}>
export type PrivateProjectSelection = Readonly<{
  target: RunTargetIdentity
  approval: string
}>

type ProjectIdentity = (kind: string, ...parts: string[]) => string

function inputContract(value: RecordValue): DisplayProjectInput {
  if (!Object.hasOwn(value, 'input')) return { state: 'unconstrained' }
  return {
    state: 'schema',
    schema: value.input as Extract<DisplayProjectInput, { state: 'schema' }>['schema'],
    ...(value.$defs === undefined
      ? {}
      : {
          definitions: value.$defs as NonNullable<
            Extract<DisplayProjectInput, { state: 'schema' }>['definitions']
          >,
        }),
  }
}

function interfaceProjection(
  selected: RecordValue,
  targetId: string,
  composition: DisplayComposition,
): DisplayProjectSelection {
  const contract = record(selected.contract)
  const bound = new Set(
    Array.isArray(selected.boundReadAttachments)
      ? selected.boundReadAttachments.filter((name): name is string => typeof name === 'string')
      : [],
  )
  const attachments = Object.entries(record(selected.attachments)).map(([name, mode]) => ({
    name,
    mode: mode as 'read' | 'read-write',
    bound: bound.has(name),
  }))
  const channels = Object.entries(record(contract.channels)).map(([name, value]) => {
    const channel = record(value)
    return { name, direction: channel.direction, required: channel.required !== false }
  })
  const receives = channels
    .filter((channel) => channel.direction === 'send')
    .map((channel) => ({ name: channel.name, required: channel.required }))
  let reason: string | undefined
  if (record(selected.availability).state === 'unavailable')
    reason = 'This workflow was reviewed as unavailable. Correct its setup, then run jig review.'
  else if (contract.input === false)
    reason = 'This workflow declares that no input value is accepted.'
  else if (attachments.some((attachment) => attachment.mode === 'read' && !attachment.bound))
    reason =
      'This workflow needs local input files. Run it with jig run --attach, or review a Binding that supplies those files.'
  else if (channels.some((channel) => channel.direction === 'receive' && channel.required))
    reason =
      'This workflow needs an incoming channel. Invoke it from a Flow that connects that channel.'
  else if (receives.some((channel) => channel.required))
    reason =
      'This workflow needs an explicit channel receiver. Run it with jig run --receive or invoke it from a Flow.'
  return {
    targetId,
    composition,
    input: inputContract(contract),
    attachments,
    receives,
    launch: reason === undefined ? { state: 'available' } : { state: 'unavailable', reason },
  }
}

/** Pure safe projection; its input is inert retained inspection, never execution authority. */
export function projectPrivateProjectSnapshot(
  source: PrivateProjectProjectionSource,
  identity: ProjectIdentity,
): DisplayProjectSnapshot {
  const catalogue = record(source.catalogue)
  const selected = record(source.selected)
  const approval = catalogue.approval
  if (typeof approval !== 'string' || selected.approval !== approval)
    throw new PrivateProjectProjectionError(
      'PROJECT_CHANGED',
      'The project approval changed. Refresh the project and choose a workflow again.',
    )
  if (selected.target !== selectorFor(source.composition.root))
    throw new TypeError('The selected interface does not belong to the configured root')
  const summaries = new Map(
    (Array.isArray(catalogue.targets) ? catalogue.targets : []).map((value) => {
      const item = record(value)
      return [item.target, item] as const
    }),
  )
  const nodeId = (key: string): string => identity('target', approval, key)
  const targets: DisplayProjectTarget[] = source.composition.targets.map(({ request }) => {
    const summary = summaries.get(selectorFor(request.target))
    if (summary === undefined) throw new TypeError('Approved target summary is missing')
    const available = record(summary.availability).state !== 'unavailable'
    return {
      id: nodeId(targetKey(request.target)),
      label: labelFor(request.target),
      kind: request.target.kind,
      ...(typeof summary.description === 'string' && summary.description.length
        ? { description: clipped(summary.description, 2048) }
        : {}),
      availability: available ? 'ready' : 'unavailable',
      ...(available
        ? {}
        : {
            reason:
              'The reviewed configuration is unavailable. Correct its setup and review again.',
          }),
    }
  })
  const privateComposition = projectPrivateRunComposition(source.composition, {
    nodes: DISPLAY_COMPOSITION_NODE_LIMIT,
    edges: DISPLAY_COMPOSITION_EDGE_LIMIT,
    bytes: DISPLAY_COMPOSITION_BYTE_LIMIT,
  })
  const projected: DisplayComposition =
    privateComposition.state === 'unavailable'
      ? privateComposition
      : {
          state: 'available',
          provenance: 'admitted',
          rootId: nodeId(privateComposition.rootId),
          nodes: privateComposition.nodes.map((node): DisplayCompositionNode =>
            node.kind === 'resource'
              ? {
                  id: nodeId(node.id),
                  kind: 'resource',
                  resourceKind: node.resourceKind,
                  label: node.label,
                }
              : { id: nodeId(node.id), kind: node.kind, label: node.label },
          ),
          edges: privateComposition.edges.map((edge) => ({
            id: identity('connection', approval, edge.id),
            source: nodeId(edge.source),
            target: nodeId(edge.target),
            slot: edge.slot,
          })),
        }
  const composition: DisplayComposition =
    Buffer.byteLength(JSON.stringify(projected)) > DISPLAY_COMPOSITION_BYTE_LIMIT
      ? { state: 'unavailable', reason: 'limit' }
      : projected
  return validateDisplayProjectSnapshot({
    kind: 'project',
    revision: identity('approval', approval),
    state: 'approved',
    targets,
    selected: interfaceProjection(
      selected,
      nodeId(targetKey(source.composition.root)),
      composition,
    ),
  })
}

/** Command-local browsing over approval. No coordinator or filesystem authority is retained. */
export class PrivateProjectProjection {
  readonly #key: Buffer

  constructor(
    readonly projectRoot: string,
    identityKey: Uint8Array = randomBytes(32),
  ) {
    if (identityKey.byteLength !== 32)
      throw new TypeError('A 32-byte project display identity key is required')
    this.#key = Buffer.from(identityKey)
  }

  #id = (kind: string, ...parts: string[]): string =>
    createHmac('sha256', this.#key)
      .update(JSON.stringify(['jig-private-project-display/1', kind, ...parts]))
      .digest('hex')

  async project(targetId?: string): Promise<DisplayProjectSnapshot> {
    return (await this.#read(targetId)).snapshot
  }

  async projectForTarget(selector?: string): Promise<DisplayProjectSnapshot> {
    return (await this.#read(undefined, selector)).snapshot
  }

  async selection(
    revision: string,
    targetId: string,
    input: JsonValue,
  ): Promise<PrivateProjectSelection> {
    const result = await this.#read(targetId, undefined, revision)
    if (result.snapshot.state !== 'approved' || !result.selection)
      throw new PrivateProjectProjectionError(
        'PROJECT_UNREVIEWED',
        'Review this project with jig review before starting a workflow.',
      )
    const launch = result.snapshot.selected!.launch
    if (launch.state !== 'available')
      throw new PrivateProjectProjectionError('TARGET_UNAVAILABLE', launch.reason)
    const contract = result.snapshot.selected!.input
    const schema = compileEmbeddedSchema(contract.state === 'schema' ? contract.schema : true, {
      path: 'FLOW.contract.json',
      pointer: '/input',
      ...(contract.state === 'schema' && contract.definitions !== undefined
        ? { rootDefs: contract.definitions }
        : {}),
    })
    try {
      schema.validate(input, 'INVALID_INPUT')
    } catch (error) {
      if (!(error instanceof SchemaDiagnostic)) throw error
      const mismatch = schemaTypeMismatchText(error.typeMismatch)
      const location = JSON.stringify(clipped(error.schemaPointer || '/input', 256))
      throw new PrivateProjectProjectionError(
        'INPUT_INVALID',
        mismatch === undefined
          ? `Input does not match the reviewed schema at ${location}. Correct the input and try again.`
          : `Input does not match the reviewed schema. ${mismatch} Correct the input and try again.`,
      )
    }
    return result.selection
  }

  async #read(
    targetId?: string,
    initialSelector?: string,
    expectedRevision?: string,
  ): Promise<Readonly<{ snapshot: DisplayProjectSnapshot; selection?: PrivateProjectSelection }>> {
    let candidate: PrivateActivationCandidateArtifactV5 | undefined
    const catalogueValue = await inspectPrivateApprovedProject(
      this.projectRoot,
      undefined,
      undefined,
      true,
      undefined,
      (value) => {
        candidate = value
      },
    )
    const catalogue = record(catalogueValue)
    if (catalogue.state === 'unreviewed' || candidate === undefined) {
      if (expectedRevision !== undefined || targetId !== undefined || initialSelector !== undefined)
        throw new PrivateProjectProjectionError(
          'PROJECT_UNREVIEWED',
          'Review this project with jig review before choosing a workflow.',
        )
      return {
        snapshot: validateDisplayProjectSnapshot({
          kind: 'project',
          revision: this.#id('approval', 'unreviewed'),
          state: 'unreviewed',
          targets: [],
        }),
      }
    }
    const approval = catalogue.approval
    if (typeof approval !== 'string') throw new TypeError('Approved project identity is missing')
    const revision = this.#id('approval', approval)
    if (expectedRevision !== undefined && expectedRevision !== revision)
      throw new PrivateProjectProjectionError(
        'PROJECT_CHANGED',
        'The project approval changed. Refresh the project and review the selected workflow before running it.',
      )
    const targets = candidate.candidate.targets
    if (targets.length === 0) {
      if (targetId !== undefined || initialSelector !== undefined)
        throw new PrivateProjectProjectionError(
          'TARGET_MISSING',
          'No workflows are approved in this project.',
        )
      return {
        snapshot: validateDisplayProjectSnapshot({
          kind: 'project',
          revision,
          state: 'approved',
          targets: [],
        }),
      }
    }
    const defaultSelector =
      initialSelector !== undefined
        ? selectorFor(parseTarget(initialSelector))
        : typeof catalogue.entrypoint === 'string'
          ? selectorFor(parseProjectEntrypoint(catalogue.entrypoint).target)
          : undefined
    const chosen =
      targetId !== undefined
        ? targets.find(
            ({ request }) => this.#id('target', approval, targetKey(request.target)) === targetId,
          )
        : defaultSelector !== undefined
          ? targets.find(({ request }) => selectorFor(request.target) === defaultSelector)
          : (targets.find(({ disposition }) => disposition.state === 'ready') ?? targets[0])
    if (!chosen)
      throw new PrivateProjectProjectionError(
        'TARGET_MISSING',
        'This workflow is not in the approved project. Refresh the project and choose a workflow again.',
      )
    let selected: JsonValue
    try {
      selected = await inspectPrivateApprovedProject(
        this.projectRoot,
        selectorFor(chosen.request.target),
      )
    } catch (error) {
      if (error instanceof CheckError && error.code === 'INSPECTION_TARGET_MISSING')
        throw new PrivateProjectProjectionError(
          'PROJECT_CHANGED',
          'The project approval changed. Refresh the project and choose a workflow again.',
        )
      throw error
    }
    if (record(selected).approval !== approval)
      throw new PrivateProjectProjectionError(
        'PROJECT_CHANGED',
        'The project approval changed. Refresh the project and choose a workflow again.',
      )
    return {
      snapshot: projectPrivateProjectSnapshot(
        {
          catalogue: catalogueValue,
          selected,
          composition: { root: chosen.request.target, targets },
        },
        this.#id,
      ),
      selection: Object.freeze({ target: chosen.request.target, approval }),
    }
  }
}
