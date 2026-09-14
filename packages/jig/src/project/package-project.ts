import { CheckError, invalid } from '../diagnostics.js'
import { type BoundAttachments, normalizeBoundAttachments } from '../internal/bound-attachments.js'
import { MARKDOWN_AGENT_SLOT, markdownAgentContract } from '../internal/markdown-agent-contract.js'
import { RUN_CHECKPOINT_CONTRACT_DIGEST } from '../internal/private-run-checkpoint.js'
import type { JsonObject, JsonValue } from '../json.js'
import { type InspectedPackage, requireSupportedPackageProfile } from '../package/inspect.js'
import { SchemaDiagnostic } from '../schema/index.js'
import {
  type BindingDefinition,
  defineBinding,
  normalizePackageBindingDefinition,
  type PackageBindingInput,
  parseRunTargetSelector,
} from './author.js'
import { snapshotJsonObject } from './author-value.js'
import { isDirectRunEligible } from './flow-source.js'
import { type GrantedSlot, type GrantPolicy, grantName, normalizeGrant } from './grants.js'
import {
  type InvocationIdentity,
  type InvocationRequirement,
  type InvocationSlots,
  isHostOnlyInvocationId,
  resolveInvocationSlots,
  sameInvocationIdentity,
} from './invocation-slots.js'
import { flowSelector } from './package-selector.js'
import {
  assertNoProjectPathCollisions,
  compareProjectPaths,
  isProtectedProjectPath,
  normalizeProjectPath,
} from './paths.js'
import { type RetainedFlowInput, requireRetainedFlowInput } from './retained-flow.js'
import { validateChildGraph } from './slot-graph.js'

const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_MEMBERS = 65_536
const MAX_SEMANTIC_WORK = 1_000_000
const authenticPackageProjects = new WeakSet<object>()

export interface InjectedBindingDeclaration {
  readonly sourcePath: string
  readonly definition: unknown
  readonly capturedAttachments?: BoundAttachments
}

export interface PackageProjectInput {
  readonly flows: readonly RetainedFlowInput[]
  readonly bindings: readonly InjectedBindingDeclaration[]
  readonly grants?: Readonly<Record<string, GrantPolicy>>
  readonly defaultProviders?: Readonly<Record<string, string>>
}

export interface LinkedFlow {
  readonly provenance: RetainedFlowInput['provenance']
  readonly package: RetainedFlowInput['package']
  readonly mode: 'run'
  readonly metadata: InspectedPackage['metadata']
  readonly uses: Readonly<Record<string, InvocationRequirement>>
  readonly invocation: NonNullable<InspectedPackage['invocation']>
  readonly offeredContract?: InvocationIdentity
  readonly entrypoint?: InspectedPackage['entrypoint']
  readonly directRun: boolean
  /** Ordinary routes resolved from project defaults; absent when empty. */
  readonly slots?: Readonly<Record<string, RunTargetIdentity>>
}

export type RunTargetIdentity =
  | { readonly kind: 'flow'; readonly path: string }
  | { readonly kind: 'binding'; readonly id: string }

export interface LinkedPackageBinding {
  readonly kind: 'package'
  readonly id: string
  readonly declarationPath: string
  readonly packagePath: string
  readonly settings: JsonObject
  readonly slots: Readonly<Record<string, RunTargetIdentity | GrantedSlot>>
  readonly boundAttachments?: BoundAttachments
}

export interface PackageProjectValue {
  readonly flows: readonly LinkedFlow[]
  readonly bindings: readonly LinkedPackageBinding[]
}

interface PreparedBinding {
  readonly id: string
  readonly declarationPath: string
  readonly definition: BindingDefinition
  readonly flow: PreparedFlow
  readonly boundAttachments?: BoundAttachments
}

interface PreparedFlow {
  readonly value: LinkedFlow
  readonly inspected: InspectedPackage
}

/** Link retained Run packages and evaluated Binding values without I/O. */
export function linkPackageProject(
  input: PackageProjectInput,
  maximumActivationTargets?: number,
): PackageProjectValue {
  if (
    maximumActivationTargets !== undefined &&
    (!Number.isSafeInteger(maximumActivationTargets) || maximumActivationTargets < 1)
  ) {
    throw new TypeError('maximum activation targets must be a positive safe integer')
  }
  const root = readClosedRecord(
    input,
    [
      'flows',
      'bindings',
      ...(input && Object.hasOwn(input, 'grants') ? ['grants'] : []),
      ...(input && Object.hasOwn(input, 'defaultProviders') ? ['defaultProviders'] : []),
    ],
    'package project',
  )
  const grantValues = root.grants === undefined ? {} : snapshotJsonObject(root.grants, 'grants')
  if (Object.keys(grantValues).length > 256)
    invalid('PROJECT_GRANTS_LIMIT', 'grant catalog exceeds 256 entries')
  const grants = Object.freeze(
    Object.fromEntries(
      Object.entries(grantValues).map(([name, policy]) => [
        grantName(name),
        normalizeGrant(policy),
      ]),
    ),
  )
  const budget = new WorkBudget()
  let flows = prepareFlows(readBoundedArray(root.flows, 'flows'), budget)
  let flowByPath = new Map(flows.map((flow) => [flow.value.provenance.projectPath, flow]))
  let preparedBindings = prepareBindings(
    readBoundedArray(root.bindings, 'bindings'),
    flowByPath,
    budget,
  )
  const declaredBindingById = new Map(preparedBindings.map((binding) => [binding.id, binding]))
  const defaults = prepareDefaults(root.defaultProviders, flowByPath, declaredBindingById)
  flows = flows.map((flow) => {
    let slots: Readonly<Record<string, RunTargetIdentity>> = {}
    let resolved: InvocationSlots | undefined
    try {
      slots = defaultSlots(flow.value.uses, {}, defaults, flow.value.provenance.projectPath)
      resolved = resolveInvocationSlots(flow.value.uses, slots)
    } catch (error) {
      // An ordinary package with unsatisfied dependencies can still be configured
      // through an explicit Binding. An incompatible default never reverts to
      // native authority for the automatically derived direct target.
      if (
        !(error instanceof TypeError) &&
        !(
          error instanceof CheckError &&
          (error.code === 'PROJECT_DEFAULT_INTERFACE_MISMATCH' ||
            (error.code === 'PROJECT_PROVIDER_AMBIGUOUS' &&
              preparedBindings.some((binding) => binding.flow === flow)))
        )
      )
        throw error
    }
    // A default implementation may itself consume the same interface through
    // an explicitly configured backend. Its unconfigured direct identity must
    // not select itself or veto that valid Binding's separate configuration.
    const selfDefault = Object.values(slots).some((target) => {
      const path =
        target.kind === 'flow'
          ? target.path
          : declaredBindingById.get(target.id)?.definition.package
      return path === flow.value.provenance.projectPath
    })
    const directRun =
      !selfDefault &&
      resolved !== undefined &&
      isDirectRunEligible(flow.inspected, Object.keys(slots).length === 0 ? undefined : resolved)
    return Object.freeze({
      inspected: flow.inspected,
      value: Object.freeze({
        ...flow.value,
        directRun,
        ...(directRun && Object.keys(slots).length > 0 ? { slots } : {}),
      }),
    })
  })
  flowByPath = new Map(flows.map((flow) => [flow.value.provenance.projectPath, flow]))
  preparedBindings = preparedBindings.map((binding) =>
    Object.freeze({
      ...binding,
      flow: flowByPath.get(binding.definition.package)!,
    }),
  )
  const activationTargetCount =
    preparedBindings.length + flows.filter(({ value }) => value.directRun).length
  if (maximumActivationTargets !== undefined && activationTargetCount > maximumActivationTargets) {
    invalid(
      'PROJECT_ACTIVATION_TARGET_LIMIT',
      `project contains ${activationTargetCount} activation targets, exceeding the caller bound ${maximumActivationTargets}`,
    )
  }
  const bindingById = new Map(preparedBindings.map((binding) => [binding.id, binding]))
  for (const { target } of defaults.explicit.values()) {
    const flow =
      target.kind === 'flow' ? flowByPath.get(target.path)! : bindingById.get(target.id)!.flow
    if (
      Object.keys(flow.inspected.invocation?.attachments ?? {}).length > 0 ||
      (target.kind === 'flow' && !flow.value.directRun)
    )
      invalid(
        'PROJECT_DEFAULT_UNAVAILABLE',
        'default must select an invokable Flow without root-only attachments',
        'jig.ts',
        '/defaultProviders',
      )
  }
  const value = Object.freeze({
    flows: Object.freeze(flows.map((flow) => flow.value)),
    bindings: Object.freeze(
      preparedBindings.map((binding) =>
        linkBinding(binding, flowByPath, bindingById, grants, defaults),
      ),
    ),
  })
  // Inspect the complete linked graph, not only each immediate target. This
  // bounds every possible invocation path before any package is admitted.
  for (const flow of flows) {
    if (!flow.value.directRun) continue
    linkFlowSlots(
      {
        label: `Flow ${flow.value.provenance.projectPath}`,
        path: flow.value.provenance.projectPath,
        packagePath: flow.value.provenance.projectPath,
        uses: flow.value.uses,
        selectors: Object.fromEntries(
          Object.entries(flow.value.slots ?? {}).map(([slot, target]) => [
            slot,
            targetSelector(target),
          ]),
        ),
      },
      flowByPath,
      bindingById,
      grants,
    )
  }
  validateChildGraph(
    new Map(value.bindings.map((binding) => [binding.id, binding])),
    new Map(
      value.flows
        .filter((flow) => flow.directRun)
        .map((flow) => [
          flow.provenance.projectPath,
          {
            packagePath: flow.provenance.projectPath,
            slots: flow.slots ?? {},
          },
        ]),
    ),
    (units) => budget.consume(units),
  )
  authenticPackageProjects.add(value)
  return value
}

export function requirePackageProjectValue(value: unknown): PackageProjectValue {
  if (value === null || typeof value !== 'object' || !authenticPackageProjects.has(value)) {
    throw new TypeError('project was not produced by the package-project linker')
  }
  return value as PackageProjectValue
}

function prepareFlows(values: readonly unknown[], budget: WorkBudget): readonly PreparedFlow[] {
  const flows = values.map((value) => {
    let retained: RetainedFlowInput
    try {
      retained = requireRetainedFlowInput(value)
    } catch (error) {
      invalid('PROJECT_FLOW_NOT_RETAINED', errorText(error))
    }
    if (retained.package.digest !== retained.inspected.digest) {
      throw new Error('retained Flow invariant violated: Package/1 digest differs from inspection')
    }
    if (retained.inspected.mode !== 'run') {
      invalid(
        'PROJECT_FLOW_MODE_UNSUPPORTED',
        'the direct alpha supports Run packages only',
        retained.provenance.projectPath,
      )
    }
    const uses = projectInvocationRequirements(retained.inspected, retained.provenance.projectPath)
    const attachments = Object.values(retained.inspected.invocation?.attachments ?? {})
    if (
      attachments.filter((access) => access === 'read-write').length > 1 ||
      attachments.length > 8
    ) {
      invalid(
        'PROJECT_ATTACHMENTS_UNSUPPORTED',
        'Jig supports at most eight root attachments and one initially empty writable attachment',
        retained.provenance.projectPath,
      )
    }
    budget.consume(1 + Object.keys(retained.inspected.invocation?.attachments ?? {}).length)
    const linked = Object.freeze({
      provenance: retained.provenance,
      package: retained.package,
      mode: 'run' as const,
      metadata: retained.inspected.metadata,
      invocation: retained.inspected.invocation ?? {},
      ...(retained.inspected.contract?.descriptor.id === undefined
        ? {}
        : {
            offeredContract: {
              id: retained.inspected.contract.descriptor.id,
              version: retained.inspected.contract.descriptor.version!,
              digest: retained.inspected.contract.digest,
            },
          }),
      uses,
      ...(retained.inspected.entrypoint === undefined
        ? {}
        : { entrypoint: retained.inspected.entrypoint }),
      directRun: isDirectRunEligible(retained.inspected),
    })
    return Object.freeze({ value: linked, inspected: retained.inspected })
  })
  flows.sort((left, right) =>
    compareProjectPaths(left.value.provenance.projectPath, right.value.provenance.projectPath),
  )
  try {
    assertNoProjectPathCollisions(
      flows.map((flow) => flow.value.provenance.projectPath),
      'Flow member',
    )
  } catch (error) {
    invalid('PROJECT_FLOW_COLLISION', errorText(error))
  }
  return Object.freeze(flows)
}

export function projectInvocationRequirements(
  inspected: InspectedPackage,
  packagePath: string,
): Readonly<Record<string, InvocationRequirement>> {
  const output: Record<string, InvocationRequirement> = Object.create(null)
  if (inspected.markdown !== undefined) {
    const contract = markdownAgentContract()
    output[MARKDOWN_AGENT_SLOT] = Object.freeze({
      id: contract.descriptor.id!,
      version: contract.descriptor.version!,
      digest: contract.digest,
    })
  }
  for (const [slot, declaration] of Object.entries(inspected.metadata.uses ?? {})) {
    if (declaration.contract === undefined) {
      output[slot] = Object.freeze({})
      continue
    }
    const reference = inspected.usedContracts.find((candidate) => candidate.slot === slot)
    if (reference === undefined)
      throw new Error('inspected invocation reference invariant violated')
    const { id, version } = reference.contract.descriptor
    if (id === undefined || version === undefined)
      invalid(
        'PROJECT_INTERFACE_ANONYMOUS',
        'a required interface must have a named identity',
        packagePath,
        `/uses/${pointerToken(slot)}`,
      )
    output[slot] = Object.freeze({ id, version, digest: reference.contract.digest })
    if (
      id === 'https://jig.md/contracts/run-checkpoint' &&
      reference.contract.digest === RUN_CHECKPOINT_CONTRACT_DIGEST &&
      !Object.values(inspected.invocation?.attachments ?? {}).includes('read-write')
    )
      invalid(
        'PROJECT_CHECKPOINT_ATTACHMENT',
        'Run Checkpoint requires a root writable attachment',
        packagePath,
      )
  }
  return Object.freeze(output)
}

function prepareBindings(
  values: readonly unknown[],
  flowByPath: ReadonlyMap<string, PreparedFlow>,
  budget: WorkBudget,
): readonly PreparedBinding[] {
  const bindings = values.map((value, index) => {
    const record = readClosedRecord(
      value,
      [
        'sourcePath',
        'definition',
        ...(value !== null &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'capturedAttachments')
          ? ['capturedAttachments']
          : []),
      ],
      `bindings[${index}]`,
    )
    const declarationPath = normalizeProjectPath(
      record.sourcePath,
      `bindings[${index}] source path`,
    )
    if (isProtectedProjectPath(declarationPath)) {
      invalid(
        'PROJECT_BINDING_PROTECTED_PATH',
        'Binding declaration cannot be beneath .jig',
        declarationPath,
      )
    }
    const name = declarationPath.slice(declarationPath.lastIndexOf('/') + 1)
    if (!name.endsWith('.ts') || name.slice(0, -3).includes('.')) {
      invalid(
        'PROJECT_BINDING_DECLARATION_PATH',
        'Binding declaration must be named <LocalName>.ts',
        declarationPath,
      )
    }
    const id = name.slice(0, -3)
    if (!LOCAL_NAME.test(id) || id.length > 64) {
      invalid(
        'PROJECT_BINDING_ID',
        'Binding declaration basename must be a LocalName',
        declarationPath,
      )
    }
    let definition: BindingDefinition
    try {
      const candidate = record.definition
      definition =
        typeof candidate === 'object' && candidate !== null && Object.hasOwn(candidate, 'kind')
          ? normalizePackageBindingDefinition(candidate)
          : defineBinding(candidate as PackageBindingInput)
    } catch (error) {
      invalid('PROJECT_BINDING_DECLARATION', errorText(error), declarationPath)
    }
    budget.consume(jsonWork(definition as unknown as JsonValue))
    const flow = flowByPath.get(definition.package)
    if (flow === undefined) {
      invalid(
        'PROJECT_BINDING_PACKAGE_MISSING',
        `Binding ${id} selects unknown Flow member ${definition.package}`,
        declarationPath,
        '/package',
      )
    }
    requireSupportedPackageProfile(flow.inspected, definition.package)
    validateSettings(definition.settings, flow.inspected, declarationPath)
    const boundAttachments = normalizeBoundAttachments(record.capturedAttachments ?? {})
    const selected = definition.attachments ?? {}
    if (Object.keys(selected).sort().join('\0') !== Object.keys(boundAttachments).sort().join('\0'))
      invalid(
        'PROJECT_BINDING_ATTACHMENTS_NOT_CAPTURED',
        'Binding attachments require retained file capture',
        declarationPath,
      )
    for (const [name, source] of Object.entries(selected)) {
      if (flow.inspected.invocation?.attachments?.[name] !== 'read')
        invalid(
          'PROJECT_BINDING_ATTACHMENT_UNDECLARED',
          `attachment ${name} must be declared read-only by the selected Flow`,
          declarationPath,
          `/attachments/${name}`,
        )
      if (boundAttachments[name]!.source !== source)
        invalid(
          'PROJECT_BINDING_ATTACHMENTS_NOT_CAPTURED',
          'Binding attachment capture does not match its selection',
          declarationPath,
        )
    }
    return Object.freeze({
      id,
      declarationPath,
      definition,
      flow,
      ...(Object.keys(boundAttachments).length === 0 ? {} : { boundAttachments }),
    })
  })
  bindings.sort((left, right) => compareProjectPaths(left.id, right.id))
  assertUniqueBindings(bindings)
  return Object.freeze(bindings)
}

interface DefaultTarget {
  readonly target: RunTargetIdentity
  readonly contract: InvocationIdentity
}

interface ProviderSelections {
  readonly explicit: ReadonlyMap<string, DefaultTarget>
  readonly candidates: ReadonlyMap<string, readonly DefaultTarget[]>
}

function providerKey(contract: InvocationRequirement): string {
  return JSON.stringify([contract.id, contract.version, contract.digest])
}

function prepareDefaults(
  value: unknown,
  flows: ReadonlyMap<string, PreparedFlow>,
  bindings: ReadonlyMap<string, PreparedBinding>,
): ProviderSelections {
  const selectors = value === undefined ? {} : snapshotJsonObject(value, 'defaultProviders')
  if (Object.keys(selectors).length > 256)
    invalid('PROJECT_DEFAULT_LIMIT', 'defaultProviders exceeds 256 targets')
  const defaults = new Map<string, DefaultTarget>()
  for (const [id, selector] of Object.entries(selectors)) {
    const target = parseRunTargetSelector(selector, 'default')
    const flow = target.kind === 'flow' ? flows.get(target.path) : bindings.get(target.id)?.flow
    if (flow === undefined)
      invalid(
        'PROJECT_DEFAULT_MISSING',
        `default selects unknown target ${selector}`,
        'jig.ts',
        `/defaultProviders/${pointerToken(id)}`,
      )
    const contract = flow.value.offeredContract
    if (contract === undefined || isHostOnlyInvocationId(contract.id))
      invalid(
        'PROJECT_DEFAULT_CONTRACT',
        'default must offer a named ordinary Flow contract',
        'jig.ts',
        `/defaultProviders/${pointerToken(id)}`,
      )
    if (id !== contract.id)
      invalid(
        'PROJECT_DEFAULT_CONTRACT',
        'default provider key does not match the selected Flow contract ID',
        'jig.ts',
        `/defaultProviders/${pointerToken(id)}`,
      )
    defaults.set(contract.id, Object.freeze({ target, contract }))
  }
  const candidates = new Map<string, DefaultTarget[]>()
  const consider = (
    flow: PreparedFlow,
    target: RunTargetIdentity,
    settings: JsonObject,
    slots: PackageBindingDefinitionSlots,
  ): void => {
    const contract = flow.value.offeredContract
    if (
      !contract ||
      isHostOnlyInvocationId(contract.id) ||
      Object.keys(flow.value.invocation.attachments ?? {}).length > 0
    )
      return
    try {
      validateSettings(settings, flow.inspected, flow.value.provenance.projectPath)
    } catch (error) {
      if (error instanceof CheckError) return
      throw error
    }
    // Missing native authority or an anonymous route cannot be supplied by inference.
    for (const [slot, required] of Object.entries(flow.value.uses))
      if (
        (required.id === undefined || isHostOnlyInvocationId(required.id)) &&
        !Object.hasOwn(slots, slot)
      )
        return
    const key = providerKey(contract)
    const matches = candidates.get(key) ?? []
    matches.push(Object.freeze({ target, contract }))
    candidates.set(key, matches)
  }
  for (const [path, flow] of flows) consider(flow, { kind: 'flow', path }, {}, {})
  for (const [id, binding] of bindings)
    consider(
      binding.flow,
      { kind: 'binding', id },
      binding.definition.settings,
      binding.definition.slots,
    )
  for (const matches of candidates.values()) Object.freeze(matches)
  return Object.freeze({ explicit: defaults, candidates })
}

type PackageBindingDefinitionSlots = BindingDefinition['slots']

/** Resolve meaning at review, never from mutable project settings at execution. */
function defaultSlots(
  uses: LinkedFlow['uses'],
  explicit: NonNullable<PackageBindingInput['slots']>,
  defaults: ProviderSelections,
  path: string,
): Readonly<Record<string, RunTargetIdentity>> {
  const slots: Record<string, RunTargetIdentity> = Object.create(null)
  for (const [slot, required] of Object.entries(uses)) {
    if (Object.hasOwn(explicit, slot) || required.id === undefined) continue
    let selected = defaults.explicit.get(required.id)
    if (selected === undefined && !isHostOnlyInvocationId(required.id)) {
      const matches = defaults.candidates.get(providerKey(required)) ?? []
      if (matches.length > 1)
        invalid(
          'PROJECT_PROVIDER_AMBIGUOUS',
          'multiple exact providers match; select defaultProviders or an explicit consumer slot',
          path,
          `/uses/${pointerToken(slot)}`,
        )
      selected = matches[0]
    }
    if (selected === undefined) continue
    if (!sameInvocationIdentity(required, selected.contract))
      invalid(
        'PROJECT_DEFAULT_INTERFACE_MISMATCH',
        `default for ${required.id} does not match slot ${slot}'s exact contract`,
        path,
        `/uses/${pointerToken(slot)}`,
      )
    slots[slot] = selected.target
  }
  return Object.freeze(slots)
}

function targetSelector(target: RunTargetIdentity): string {
  return target.kind === 'flow' ? flowSelector(target.path) : `binding:${target.id}`
}

function linkBinding(
  prepared: PreparedBinding,
  flowByPath: ReadonlyMap<string, PreparedFlow>,
  bindingById: ReadonlyMap<string, PreparedBinding>,
  grants: Readonly<Record<string, GrantPolicy>>,
  defaults: ProviderSelections,
): LinkedPackageBinding {
  const { id, declarationPath, definition } = prepared
  const selectedDefaults = defaultSlots(
    prepared.flow.value.uses,
    definition.slots,
    defaults,
    declarationPath,
  )
  const slots = linkFlowSlots(
    {
      label: `Binding ${id}`,
      path: declarationPath,
      packagePath: definition.package,
      uses: prepared.flow.value.uses,
      selectors: {
        ...Object.fromEntries(
          Object.entries(selectedDefaults).map(([slot, target]) => [slot, targetSelector(target)]),
        ),
        ...definition.slots,
      },
    },
    flowByPath,
    bindingById,
    grants,
  )
  try {
    resolveInvocationSlots(prepared.flow.value.uses, slots)
  } catch (error) {
    invalid('PROJECT_BINDING_INTERFACE_UNRESOLVED', errorText(error), declarationPath, '/slots')
  }
  return Object.freeze({
    kind: 'package' as const,
    id,
    declarationPath,
    packagePath: definition.package,
    settings: definition.settings,
    slots,
    ...(prepared.boundAttachments === undefined
      ? {}
      : { boundAttachments: prepared.boundAttachments }),
  })
}

function linkFlowSlots(
  owner: {
    label: string
    path: string
    packagePath: string
    uses: LinkedFlow['uses']
    selectors: PackageBindingInput['slots']
  },
  flowByPath: ReadonlyMap<string, PreparedFlow>,
  bindingById: ReadonlyMap<string, PreparedBinding>,
  grants: Readonly<Record<string, GrantPolicy>>,
): Readonly<Record<string, RunTargetIdentity | GrantedSlot>> {
  const { label, path: declarationPath, packagePath } = owner
  const slots: Record<string, RunTargetIdentity | GrantedSlot> = Object.create(null)
  for (const [name, selector] of Object.entries(owner.selectors ?? {})) {
    const pointer = `/slots/${pointerToken(name)}`
    if (typeof selector !== 'string' || selector.startsWith('grant:')) {
      const resourceName = typeof selector === 'string' ? grantName(selector.slice(6)) : undefined
      const policy = resourceName === undefined ? selector : grants[resourceName]
      if (policy === undefined)
        invalid(
          'PROJECT_GRANT_MISSING',
          'slot selects a missing grant: ' + resourceName,
          declarationPath,
          pointer,
        )
      slots[name] = Object.freeze({
        kind: 'grant',
        policy: normalizeGrant(policy),
        ...(resourceName === undefined ? {} : { name: resourceName }),
      })
      continue
    }
    const identity = parseRunTargetSelector(selector, `slot ${name}`)
    const childBinding = identity.kind === 'binding' ? bindingById.get(identity.id) : undefined
    const target = identity.kind === 'flow' ? flowByPath.get(identity.path) : childBinding?.flow
    if (target === undefined) {
      invalid(
        'PROJECT_BINDING_SLOT_MISSING',
        `${label} slot ${name} selects unknown target ${selector}`,
        declarationPath,
        pointer,
      )
    }
    if (target.value.provenance.projectPath === packagePath) {
      invalid(
        'PROJECT_BINDING_SLOT_RECURSIVE',
        `${label} slot ${name} selects its own Flow package`,
        declarationPath,
        pointer,
      )
    }
    if (Object.keys(target.inspected.invocation?.attachments ?? {}).length !== 0) {
      invalid(
        'PROJECT_BINDING_SLOT_ATTACHMENTS_UNSUPPORTED',
        `${label} slot ${name} requires root-only file attachments`,
        declarationPath,
        pointer,
      )
    }
    if (identity.kind === 'flow' && !target.value.directRun) {
      invalid(
        'PROJECT_BINDING_SLOT_NOT_DIRECT',
        `${label} slot ${name} must select a direct Flow target or configured Binding`,
        declarationPath,
        pointer,
      )
    }
    const expected = owner.uses[name]
    if (
      expected?.id !== undefined &&
      (isHostOnlyInvocationId(expected.id) ||
        target.value.offeredContract === undefined ||
        !sameInvocationIdentity(expected, target.value.offeredContract))
    )
      invalid(
        'PROJECT_BINDING_INTERFACE_MISMATCH',
        `slot ${name} requires an exact matching Flow interface without host-only evidence claims`,
        declarationPath,
        pointer,
      )
    slots[name] = identity
  }
  return Object.freeze(slots)
}

function pointerToken(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function validateSettings(settings: JsonObject, inspected: InspectedPackage, path: string): void {
  if (inspected.schemas.settings === undefined) {
    if (Object.keys(settings).length !== 0) {
      invalid(
        'PROJECT_BINDING_SETTINGS_UNDECLARED',
        'package has no settings.schema.json but Binding settings are not empty',
        path,
        '/settings',
      )
    }
    return
  }
  try {
    inspected.schemas.settings.validate(settings, 'PROJECT_BINDING_SETTINGS_INVALID')
  } catch (error) {
    if (error instanceof SchemaDiagnostic) {
      throw new CheckError(
        'invalid',
        error.code,
        error.message,
        path,
        `/settings${error.instancePointer}`,
        error.typeMismatch,
      )
    }
    throw error
  }
}

class WorkBudget {
  private used = 0

  consume(amount: number): void {
    this.used += amount
    if (this.used > MAX_SEMANTIC_WORK) {
      invalid(
        'PROJECT_PACKAGE_WORK_LIMIT',
        `package-project semantic work exceeds ${MAX_SEMANTIC_WORK} units`,
      )
    }
  }
}

function jsonWork(value: JsonValue): number {
  if (value === null || typeof value !== 'object') return 1
  let work = 1
  for (const child of Object.values(value)) work += jsonWork(child)
  return work
}

function assertUniqueBindings(bindings: readonly PreparedBinding[]): void {
  const ids = new Set<string>()
  const paths: string[] = []
  for (const binding of bindings) {
    if (ids.has(binding.id)) {
      invalid(
        'PROJECT_BINDING_COLLISION',
        `duplicate Binding ID ${binding.id}`,
        binding.declarationPath,
      )
    }
    ids.add(binding.id)
    paths.push(binding.declarationPath)
  }
  try {
    assertNoProjectPathCollisions(paths, 'Binding declaration')
  } catch (error) {
    invalid('PROJECT_BINDING_COLLISION', errorText(error))
  }
}

function readBoundedArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid('PROJECT_PACKAGE_INPUT', `${label} must be an array`)
  if (value.length > MAX_MEMBERS) {
    invalid('PROJECT_PACKAGE_LIMIT', `${label} exceeds ${MAX_MEMBERS} members`)
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    invalid('PROJECT_PACKAGE_INPUT', `${label} must be an ordinary array`)
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== value.length + 1 ||
    keys.some(
      (key) => typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)),
    )
  ) {
    invalid('PROJECT_PACKAGE_INPUT', `${label} must not contain extra or symbolic properties`)
  }
  const output: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      invalid('PROJECT_PACKAGE_INPUT', `${label} must not be sparse or accessor-backed`)
    }
    output.push(descriptor.value)
  }
  return output
}

function readClosedRecord(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid('PROJECT_PACKAGE_INPUT', `${label} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    invalid('PROJECT_PACKAGE_INPUT', `${label} must be a plain object`)
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.some((key) => typeof key !== 'string') ||
    keys.length !== fields.length ||
    fields.some((field) => !keys.includes(field))
  ) {
    invalid('PROJECT_PACKAGE_INPUT', `${label} must contain only ${fields.join(' and ')}`)
  }
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      invalid('PROJECT_PACKAGE_INPUT', `${label}.${field} must be an enumerable data property`)
    }
    output[field] = descriptor.value
  }
  return output
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
