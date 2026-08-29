import { CheckError, invalid } from "../diagnostics.js";
import { privateDomainDigest } from "../internal/identity.js";
import type { JsonObject, JsonValue } from "../json.js";
import type { CheckedContractReference, InspectedPackage } from "../package/inspect.js";
import { SchemaDiagnostic } from "../schema/index.js";
import {
  defineBinding,
  definePrivateProjectRunTargetsBinding,
  normalizeJournalPublisherDefinition,
  normalizeHookDefinition,
  normalizePackageBindingDefinition,
  normalizePrivateProjectRunTargetsBindingDefinition,
  type BindingDefinition,
  type HookDefinition,
  type JournalPublisherDefinition,
  type PackageBindingInput,
  type PrivateProjectRunTargetsBindingDefinition,
  type PrivateProjectRunTargetsBindingInput,
  type PrivateProjectRunTargetsRef,
  type RunTargetRef,
  type SlotRef,
} from "./author.js";
import { isDirectRunEligible } from "./flow-source.js";
import {
  requireRetainedFlowInput,
  type RetainedFlowInput,
} from "./retained-flow.js";
import {
  assertNoProjectPathCollisions,
  compareProjectPaths,
  isProtectedProjectPath,
  normalizeProjectPath,
} from "./paths.js";

const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_MEMBERS = 65_536;
const MAX_SEMANTIC_WORK = 1_000_000;
const authenticPackageProjects = new WeakSet<object>();
export const PRIVATE_CANONICAL_JOURNAL_CONTRACT = Object.freeze({
  id: "https://jig.dev/contracts/journal",
  version: "1.0.0",
  digest: "sha256:dd749f53de3a5f80e02386699355e28c1fd7e707b2b12bdf2d5c725eb436ddf9",
});

export interface InjectedBindingDeclaration {
  readonly sourcePath: string;
  readonly definition: unknown;
}

export interface InjectedHookDeclaration {
  readonly sourcePath: string;
  readonly definition: unknown;
}

export interface PackageProjectInput {
  readonly flows: readonly RetainedFlowInput[];
  readonly bindings: readonly InjectedBindingDeclaration[];
  readonly hooks?: readonly InjectedHookDeclaration[];
}

export interface ContractIdentity {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

export interface LinkedFlow {
  readonly provenance: RetainedFlowInput["provenance"];
  readonly package: RetainedFlowInput["package"];
  readonly mode: "run" | "service";
  readonly metadata: InspectedPackage["metadata"];
  readonly entrypoint?: InspectedPackage["entrypoint"];
  readonly skills: readonly string[];
  readonly uses: Readonly<Record<string, ContractIdentity | { readonly local: true }>>;
  readonly provides: Readonly<Record<string, ContractIdentity>>;
  readonly directRun: boolean;
}

export type RunTargetIdentity =
  | { readonly kind: "flow"; readonly path: string }
  | { readonly kind: "binding"; readonly id: string };

export type LinkedSlot =
  | {
      readonly kind: "flow-call";
      readonly source: "exact" | "candidates" | "project-run-targets";
      readonly targets: readonly RunTargetIdentity[];
    }
  | {
      readonly kind: "capability";
      readonly contract: ContractIdentity;
      readonly provider: {
        readonly binding: string;
        readonly export: string;
      };
    };

export interface LinkedPackageBinding {
  readonly kind: "package";
  readonly id: string;
  readonly declarationPath: string;
  readonly packagePath: string;
  readonly settings: JsonObject;
  readonly attachments: Readonly<Record<string, {
    readonly source: string;
    readonly access: "read" | "read-write";
  }>>;
  readonly slots: Readonly<Record<string, LinkedSlot>>;
}

export interface LinkedJournalPublisher {
  readonly kind: "journal-publisher";
  readonly id: string;
  readonly declarationPath: string;
  readonly source: string;
  readonly contract: ContractIdentity;
  readonly eventTypes: readonly string[];
}

export interface LinkedHook {
  readonly kind: "hook";
  readonly id: string;
  readonly declarationPath: string;
  readonly source: string;
  readonly publisherBinding: string;
  readonly type: string;
  readonly target: RunTargetIdentity;
  readonly relationDigest: string;
}

export interface PackageProjectValue {
  readonly flows: readonly LinkedFlow[];
  readonly bindings: readonly LinkedPackageBinding[];
  readonly journalPublishers: readonly LinkedJournalPublisher[];
  readonly hooks: readonly LinkedHook[];
}

interface PreparedBinding {
  readonly id: string;
  readonly declarationPath: string;
  readonly definition: ReturnType<typeof defineBinding> | PrivateProjectRunTargetsBindingDefinition;
  readonly flow: PreparedFlow;
}

interface PreparedJournalPublisher {
  readonly id: string;
  readonly declarationPath: string;
  readonly definition: JournalPublisherDefinition;
}

interface PreparedFlow {
  readonly value: LinkedFlow;
  readonly inspected: InspectedPackage;
  readonly usedContractBySlot: ReadonlyMap<string, CheckedContractReference>;
  readonly providedContractsByIdentity: ReadonlyMap<string, readonly CheckedContractReference[]>;
}

/**
 * Link factory-retained package inspections and evaluated Binding values
 * without I/O. This is invocation-local meaning, not capture or admission.
 */
export function linkPackageProject(input: PackageProjectInput): PackageProjectValue {
  return linkPackageProjectImplementation(input, undefined);
}

/**
 * Private two-phase linker for the sealed projectRunTargets() authoring
 * profile. The caller supplies the already-owned aggregate activation-target
 * bound; this layer neither invents another cap nor truncates the catalogue.
 */
export function linkPrivateProjectRunTargetsPackageProject(
  input: PackageProjectInput,
  maximumActivationTargets: number,
): PackageProjectValue {
  if (!Number.isSafeInteger(maximumActivationTargets) || maximumActivationTargets < 1) {
    throw new TypeError("maximum activation targets must be a positive safe integer");
  }
  return linkPackageProjectImplementation(input, maximumActivationTargets);
}

function linkPackageProjectImplementation(
  input: PackageProjectInput,
  maximumActivationTargets: number | undefined,
): PackageProjectValue {
  const root = readClosedRecord(
    input,
    Object.hasOwn(input, "hooks") ? ["flows", "bindings", "hooks"] : ["flows", "bindings"],
    "package project",
  );
  const budget = new WorkBudget();
  const preparedFlows = prepareFlows(readBoundedArray(root.flows, "flows"), budget);
  const flowByPath = new Map(preparedFlows.map((flow) => [flow.value.provenance.projectPath, flow]));
  const declarations = prepareBindings(
    readBoundedArray(root.bindings, "bindings"),
    flowByPath,
    budget,
    maximumActivationTargets !== undefined,
  );
  const prepared = declarations.filter((value): value is PreparedBinding => "flow" in value);
  const publishers = declarations.filter((value): value is PreparedJournalPublisher => !("flow" in value));
  const bindingById = new Map(prepared.map((binding) => [binding.id, binding]));
  const publisherById = new Map(publishers.map((publisher) => [publisher.id, publisher]));
  const projectRunTargets = maximumActivationTargets === undefined
    ? undefined
    : deriveStructuralRunTargetCatalogue(
        preparedFlows.map(preparedFlowCatalogueMember),
        prepared.map(preparedBindingCatalogueMember),
      );
  const activationTargetCount = prepared.length + preparedFlows.filter(
    ({ value }) => value.mode === "run" && value.directRun,
  ).length;
  if (maximumActivationTargets !== undefined &&
      activationTargetCount > maximumActivationTargets) {
    invalid(
      "PROJECT_ACTIVATION_TARGET_LIMIT",
      `project contains ${activationTargetCount} activation targets, exceeding the caller bound ${maximumActivationTargets}`,
    );
  }
  const bindings = prepared.map((binding) => linkBinding(
    binding,
    flowByPath,
    bindingById,
    publisherById,
    budget,
    projectRunTargets,
  ));
  const journalPublishers = publishers.map((publisher) => Object.freeze({
    kind: "journal-publisher" as const,
    id: publisher.id,
    declarationPath: publisher.declarationPath,
    source: `binding:${publisher.id}`,
    contract: PRIVATE_CANONICAL_JOURNAL_CONTRACT,
    eventTypes: publisher.definition.eventTypes,
  }));
  const hooks = prepareHooks(
    root.hooks === undefined ? [] : readBoundedArray(root.hooks, "hooks"),
    flowByPath,
    bindingById,
    publisherById,
    budget,
  );

  rejectServiceCycles(bindings, flowByPath);
  const value = Object.freeze({
    flows: Object.freeze(preparedFlows.map((flow) => flow.value)),
    bindings: Object.freeze(bindings),
    journalPublishers: Object.freeze(journalPublishers),
    hooks,
  });
  authenticPackageProjects.add(value);
  return value;
}

function prepareHooks(
  values: readonly unknown[],
  flowByPath: ReadonlyMap<string, PreparedFlow>,
  bindingById: ReadonlyMap<string, PreparedBinding>,
  publisherById: ReadonlyMap<string, PreparedJournalPublisher>,
  budget: WorkBudget,
): readonly LinkedHook[] {
  const hooks = values.map((value, index) => {
    const record = readClosedRecord(value, ["sourcePath", "definition"], `hooks[${index}]`);
    const declarationPath = normalizeProjectPath(record.sourcePath, `hooks[${index}] source path`);
    if (isProtectedProjectPath(declarationPath)) {
      invalid("PROJECT_HOOK_PROTECTED_PATH", "Hook declaration cannot be beneath .jig", declarationPath);
    }
    const name = declarationPath.slice(declarationPath.lastIndexOf("/") + 1);
    if (!name.endsWith(".ts") || name.slice(0, -3).includes(".")) {
      invalid("PROJECT_HOOK_DECLARATION_PATH", "Hook declaration must be named <LocalName>.ts", declarationPath);
    }
    const id = name.slice(0, -3);
    if (!LOCAL_NAME.test(id) || id.length > 64) {
      invalid("PROJECT_HOOK_ID", "Hook declaration basename must be a LocalName", declarationPath);
    }
    let definition: HookDefinition;
    try {
      definition = normalizeHookDefinition(record.definition);
    } catch (error) {
      invalid("PROJECT_HOOK_DECLARATION", errorText(error), declarationPath);
    }
    budget.consume(jsonWork(definition as unknown as JsonValue));
    const publisher = publisherById.get(definition.on.publisher.id);
    if (publisher === undefined) {
      invalid(
        "PROJECT_HOOK_PUBLISHER",
        `Hook ${id} publisher must resolve to one Journal publisher Binding`,
        declarationPath,
        "/on/publisher",
      );
    }
    if (!publisher.definition.eventTypes.includes(definition.on.type)) {
      invalid(
        "PROJECT_HOOK_EVENT_TYPE",
        `Hook ${id} event type is not declared by Journal publisher ${publisher.id}`,
        declarationPath,
        "/on/type",
      );
    }
    const target = validateRunTarget(
      `Hook ${id}`,
      definition.run,
      flowByPath,
      bindingById,
      declarationPath,
      "/run",
    );
    const relationDigest = privateHookRelationDigest({
      id,
      declarationPath,
      source: `binding:${publisher.id}`,
      publisherBinding: publisher.id,
      type: definition.on.type,
      target,
    });
    return Object.freeze({
      kind: "hook" as const,
      id,
      declarationPath,
      source: `binding:${publisher.id}`,
      publisherBinding: publisher.id,
      type: definition.on.type,
      target,
      relationDigest,
    });
  });
  hooks.sort((left, right) => compareProjectPaths(left.id, right.id));
  const ids = new Set<string>();
  const paths: string[] = [];
  for (const hook of hooks) {
    if (ids.has(hook.id)) invalid("PROJECT_HOOK_COLLISION", `duplicate Hook ID ${hook.id}`, hook.declarationPath);
    ids.add(hook.id);
    paths.push(hook.declarationPath);
  }
  try {
    assertNoProjectPathCollisions(paths, "Hook declaration");
  } catch (error) {
    invalid("PROJECT_HOOK_COLLISION", errorText(error));
  }
  return Object.freeze(hooks);
}

/** Identity of the inert declaration; executable Hook revisions are derived only at admission. */
export function privateHookRelationDigest(input: {
  readonly id: string;
  readonly declarationPath: string;
  readonly source: string;
  readonly publisherBinding: string;
  readonly type: string;
  readonly target: RunTargetIdentity;
}): string {
  return privateDomainDigest("JIG-Hook-Declared-Relation/1", input as unknown as JsonValue);
}

export function requirePackageProjectValue(value: unknown): PackageProjectValue {
  if (value === null || typeof value !== "object" || !authenticPackageProjects.has(value)) {
    throw new TypeError("project was not produced by the package-project linker");
  }
  return value as PackageProjectValue;
}

/**
 * Derive the complete structural Run-target catalogue from one authenticated
 * linked project. This deliberately ignores operational readiness: planning
 * decides whether each exact target is runnable on the current host.
 *
 * Private checkpoint only. The changing-source marker is not linked here.
 */
export function privateProjectRunTargetCatalogue(value: unknown): readonly RunTargetIdentity[] {
  const project = requirePackageProjectValue(value);
  const flowByPath = new Map(project.flows.map((flow) => [flow.provenance.projectPath, flow]));
  return deriveStructuralRunTargetCatalogue(
    project.flows.map((flow) => ({
      path: flow.provenance.projectPath,
      mode: flow.mode,
      directRun: flow.directRun,
    })),
    project.bindings.map((binding) => {
      const flow = flowByPath.get(binding.packagePath);
      if (flow === undefined) throw new Error("linked project invariant violated: Binding package is missing");
      return { id: binding.id, mode: flow.mode };
    }),
  );
}

interface StructuralFlowCatalogueMember {
  readonly path: string;
  readonly mode: "run" | "service";
  readonly directRun: boolean;
}

interface StructuralBindingCatalogueMember {
  readonly id: string;
  readonly mode: "run" | "service";
}

function preparedFlowCatalogueMember(flow: PreparedFlow): StructuralFlowCatalogueMember {
  return {
    path: flow.value.provenance.projectPath,
    mode: flow.value.mode,
    directRun: flow.value.directRun,
  };
}

function preparedBindingCatalogueMember(binding: PreparedBinding): StructuralBindingCatalogueMember {
  return { id: binding.id, mode: binding.flow.value.mode };
}

function deriveStructuralRunTargetCatalogue(
  flows: readonly StructuralFlowCatalogueMember[],
  bindings: readonly StructuralBindingCatalogueMember[],
): readonly RunTargetIdentity[] {
  const targets: RunTargetIdentity[] = [];
  for (const binding of bindings) {
    if (binding.mode === "run") {
      targets.push(Object.freeze({ kind: "binding" as const, id: binding.id }));
    }
  }
  for (const flow of flows) {
    if (flow.mode === "run" && flow.directRun) {
      targets.push(Object.freeze({ kind: "flow" as const, path: flow.path }));
    }
  }
  targets.sort(compareRunTargets);
  return Object.freeze(targets);
}

function compareRunTargets(left: RunTargetIdentity, right: RunTargetIdentity): number {
  if (left.kind !== right.kind) return left.kind === "binding" ? -1 : 1;
  return left.kind === "binding"
    ? compareProjectPaths(left.id, (right as Extract<RunTargetIdentity, { kind: "binding" }>).id)
    : compareProjectPaths(left.path, (right as Extract<RunTargetIdentity, { kind: "flow" }>).path);
}

function prepareFlows(values: readonly unknown[], budget: WorkBudget): readonly PreparedFlow[] {
  const flows = values.map((value) => {
    let retained: RetainedFlowInput;
    try {
      retained = requireRetainedFlowInput(value);
    } catch (error) {
      invalid("PROJECT_FLOW_NOT_RETAINED", errorText(error));
    }
    if (retained.package.digest !== retained.inspected.digest) {
      throw new Error("retained Flow invariant violated: Package/1 digest differs from inspection");
    }
    budget.consume(
      1 + retained.inspected.skills.length + retained.inspected.usedContracts.length +
      retained.inspected.providedContracts.length +
      Object.keys(retained.inspected.metadata.uses ?? {}).length +
      Object.keys(retained.inspected.metadata.attachments ?? {}).length,
    );
    const usedContractBySlot = new Map(
      retained.inspected.usedContracts.map((reference) => [reference.slot, reference]),
    );
    const providedContractsByIdentity = new Map<string, CheckedContractReference[]>();
    for (const reference of retained.inspected.providedContracts) {
      const key = contractKey(reference);
      const matches = providedContractsByIdentity.get(key) ?? [];
      matches.push(reference);
      providedContractsByIdentity.set(key, matches);
    }
    const linked = Object.freeze({
      provenance: retained.provenance,
      package: retained.package,
      mode: retained.inspected.mode,
      metadata: retained.inspected.metadata,
      ...(retained.inspected.entrypoint === undefined ? {} : { entrypoint: retained.inspected.entrypoint }),
      skills: retained.inspected.skills,
      uses: contractUses(retained.inspected, usedContractBySlot),
      provides: contractProvides(retained.inspected),
      directRun: isDirectRunEligible(retained.inspected),
    });
    return Object.freeze({
      value: linked,
      inspected: retained.inspected,
      usedContractBySlot,
      providedContractsByIdentity,
    });
  });
  flows.sort((left, right) => compareProjectPaths(
    left.value.provenance.projectPath,
    right.value.provenance.projectPath,
  ));
  try {
    assertNoProjectPathCollisions(
      flows.map((flow) => flow.value.provenance.projectPath),
      "Flow member",
    );
  } catch (error) {
    invalid("PROJECT_FLOW_COLLISION", errorText(error));
  }
  return Object.freeze(flows);
}

function prepareBindings(
  values: readonly unknown[],
  flowByPath: ReadonlyMap<string, PreparedFlow>,
  budget: WorkBudget,
  allowProjectRunTargets: boolean,
): readonly (PreparedBinding | PreparedJournalPublisher)[] {
  const bindings = values.map((value, index) => {
    const record = readClosedRecord(value, ["sourcePath", "definition"], `bindings[${index}]`);
    const declarationPath = normalizeProjectPath(
      record.sourcePath,
      `bindings[${index}] source path`,
    );
    if (isProtectedProjectPath(declarationPath)) {
      invalid("PROJECT_BINDING_PROTECTED_PATH", "Binding declaration cannot be beneath .jig", declarationPath);
    }
    const name = declarationPath.slice(declarationPath.lastIndexOf("/") + 1);
    if (!name.endsWith(".ts") || name.slice(0, -3).includes(".")) {
      invalid("PROJECT_BINDING_DECLARATION_PATH", "Binding declaration must be named <LocalName>.ts", declarationPath);
    }
    const id = name.slice(0, -3);
    if (!LOCAL_NAME.test(id) || id.length > 64) {
      invalid("PROJECT_BINDING_ID", "Binding declaration basename must be a LocalName", declarationPath);
    }

    let definition: BindingDefinition | PrivateProjectRunTargetsBindingDefinition;
    try {
      const candidate = record.definition;
      if (typeof candidate === "object" && candidate !== null &&
          Object.hasOwn(candidate, "kind")) {
        definition = (candidate as { readonly kind?: unknown }).kind === "journal-publisher"
          ? normalizeJournalPublisherDefinition(candidate)
          : allowProjectRunTargets
            ? normalizePrivateProjectRunTargetsBindingDefinition(candidate)
            : normalizePackageBindingDefinition(candidate);
      } else {
        definition = allowProjectRunTargets
          ? definePrivateProjectRunTargetsBinding(candidate as PrivateProjectRunTargetsBindingInput)
          : defineBinding(candidate as PackageBindingInput);
      }
    } catch (error) {
      invalid("PROJECT_BINDING_DECLARATION", errorText(error), declarationPath);
    }
    budget.consume(jsonWork(definition as unknown as JsonValue));
    if (definition.kind === "journal-publisher") {
      return Object.freeze({ id, declarationPath, definition });
    }
    const flow = flowByPath.get(definition.package);
    if (flow === undefined) {
      invalid(
        "PROJECT_BINDING_PACKAGE_MISSING",
        `Binding ${id} selects unknown Flow member ${definition.package}`,
        declarationPath,
        "/package",
      );
    }
    if (flow.inspected.mode === "run" && flow.inspected.entrypoint === undefined) {
      invalid(
        "PROJECT_BINDING_AGENT_REQUIRED",
        `Binding ${id} selects an instruction-only package but project authoring has no Agent provider`,
        declarationPath,
        "/package",
      );
    }
    validateSettings(definition.settings, flow.inspected, declarationPath);
    return Object.freeze({ id, declarationPath, definition, flow });
  });
  bindings.sort((left, right) => compareProjectPaths(left.id, right.id));
  assertUniqueBindings(bindings);
  return Object.freeze(bindings);
}

function linkBinding(
  prepared: PreparedBinding,
  flowByPath: ReadonlyMap<string, PreparedFlow>,
  bindingById: ReadonlyMap<string, PreparedBinding>,
  publisherById: ReadonlyMap<string, PreparedJournalPublisher>,
  budget: WorkBudget,
  projectRunTargets: readonly RunTargetIdentity[] | undefined,
): LinkedPackageBinding {
  const { id, declarationPath, definition, flow } = prepared;
  const slots: Record<string, LinkedSlot> = Object.create(null) as Record<string, LinkedSlot>;
  const uses = flow.inspected.metadata.uses ?? {};

  for (const slot of Object.keys(uses).sort(compareProjectPaths)) {
    const configured = definition.slots[slot];
    if (configured === undefined) {
      invalid("PROJECT_BINDING_CAPABILITY_MISSING", `Binding ${id} does not configure required capability ${slot}`, declarationPath, slotPointer(slot));
    }
    slots[slot] = linkCapability(id, slot, configured, flow, bindingById, publisherById, declarationPath);
  }
  for (const slot of Object.keys(definition.slots).sort(compareProjectPaths)) {
    if (Object.hasOwn(uses, slot)) continue;
    slots[slot] = linkFlowCall(
      slot,
      definition.slots[slot]!,
      flowByPath,
      bindingById,
      declarationPath,
      budget,
      projectRunTargets,
    );
  }

  return Object.freeze({
    kind: "package" as const,
    id,
    declarationPath,
    packagePath: definition.package,
    settings: definition.settings,
    attachments: linkAttachments(definition.attachments, flow.inspected, declarationPath),
    slots: freezeRecord(slots),
  });
}

function linkCapability(
  consumerId: string,
  slot: string,
  configured: SlotRef | PrivateProjectRunTargetsRef,
  consumer: PreparedFlow,
  bindingById: ReadonlyMap<string, PreparedBinding>,
  publisherById: ReadonlyMap<string, PreparedJournalPublisher>,
  path: string,
): Extract<LinkedSlot, { readonly kind: "capability" }> {
  const declaration = consumer.inspected.metadata.uses![slot]!;
  if (declaration.local === true) {
    invalid("PROJECT_BINDING_LOCAL_CAPABILITY_UNSUPPORTED", `Binding ${consumerId} requires unsupported local capability ${slot}`, path, slotPointer(slot));
  }
  if (configured.kind !== "binding") {
    invalid("PROJECT_BINDING_CAPABILITY_TARGET", `capability ${slot} must target one exact provider Binding`, path, slotPointer(slot));
  }
  const publisher = publisherById.get(configured.id);
  if (publisher !== undefined) {
    const required = consumer.usedContractBySlot.get(slot);
    if (required === undefined) throw new Error(`inspector omitted public capability ${slot}`);
    if (contractKey(required) !== contractIdentityKey(PRIVATE_CANONICAL_JOURNAL_CONTRACT)) {
      invalid(
        "PROJECT_BINDING_CAPABILITY_INCOMPATIBLE",
        `Journal publisher Binding ${configured.id} does not implement capability ${slot}`,
        path,
        slotPointer(slot),
      );
    }
    return Object.freeze({
      kind: "capability" as const,
      contract: contractIdentity(required),
      provider: Object.freeze({ binding: configured.id, export: "journal" }),
    });
  }
  const provider = bindingById.get(configured.id);
  if (provider === undefined) {
    invalid("PROJECT_BINDING_REFERENCE_MISSING", `capability ${slot} targets unknown Binding ${configured.id}`, path, slotPointer(slot));
  }
  if (provider.flow.inspected.mode !== "service") {
    invalid("PROJECT_BINDING_CAPABILITY_MODE", `capability ${slot} targets non-Service Binding ${configured.id}`, path, slotPointer(slot));
  }
  const required = consumer.usedContractBySlot.get(slot);
  if (required === undefined) throw new Error(`inspector omitted public capability ${slot}`);
  const matches = provider.flow.providedContractsByIdentity.get(contractKey(required)) ?? [];
  if (matches.length !== 1) {
    invalid(
      matches.length === 0 ? "PROJECT_BINDING_CAPABILITY_INCOMPATIBLE" : "PROJECT_BINDING_CAPABILITY_AMBIGUOUS",
      `Service Binding ${configured.id} has ${matches.length} exact exports for capability ${slot}`,
      path,
      slotPointer(slot),
    );
  }
  return Object.freeze({
    kind: "capability" as const,
    contract: contractIdentity(required),
    provider: Object.freeze({ binding: configured.id, export: matches[0]!.slot }),
  });
}

function contractIdentityKey(value: ContractIdentity): string {
  return `${value.id}\0${value.version}\0${value.digest}`;
}

function linkFlowCall(
  slot: string,
  configured: SlotRef | PrivateProjectRunTargetsRef,
  flowByPath: ReadonlyMap<string, PreparedFlow>,
  bindingById: ReadonlyMap<string, PreparedBinding>,
  path: string,
  budget: WorkBudget,
  projectRunTargets: readonly RunTargetIdentity[] | undefined,
): Extract<LinkedSlot, { readonly kind: "flow-call" }> {
  if (configured.kind === "project-run-targets") {
    if (projectRunTargets === undefined) {
      invalid(
        "PROJECT_BINDING_DECLARATION",
        "projectRunTargets() is not part of Project Authoring SDK/1",
        path,
        slotPointer(slot),
      );
    }
    budget.consume(jsonWork(projectRunTargets as unknown as JsonValue));
    return Object.freeze({
      kind: "flow-call" as const,
      source: "project-run-targets" as const,
      targets: projectRunTargets,
    });
  }
  const targets = configured.kind === "candidates" ? configured.targets : [configured];
  return Object.freeze({
    kind: "flow-call" as const,
    source: configured.kind === "candidates" ? "candidates" as const : "exact" as const,
    targets: Object.freeze(targets.map(
      (target, index) => validateRunTarget(
        slot,
        target,
        flowByPath,
        bindingById,
        path,
        configured.kind === "candidates" ? `${slotPointer(slot)}/targets/${index}` : slotPointer(slot),
      ),
    )),
  });
}

function validateRunTarget(
  slot: string,
  target: RunTargetRef,
  flowByPath: ReadonlyMap<string, PreparedFlow>,
  bindingById: ReadonlyMap<string, PreparedBinding>,
  path: string,
  pointer: string,
): RunTargetIdentity {
  if (target.kind === "flow") {
    const flow = flowByPath.get(target.path);
    if (flow === undefined) {
      invalid("PROJECT_FLOW_REFERENCE_MISSING", `flow-call slot ${slot} targets unknown Flow ${target.path}`, path, pointer);
    }
    if (!flow.value.directRun) {
      invalid("PROJECT_FLOW_REFERENCE_NOT_DIRECT", `flow-call slot ${slot} targets Flow ${target.path}, which requires a Binding`, path, pointer);
    }
    return Object.freeze({ kind: "flow" as const, path: target.path });
  }
  const binding = bindingById.get(target.id);
  if (binding === undefined) {
    invalid("PROJECT_BINDING_REFERENCE_MISSING", `flow-call slot ${slot} targets unknown Binding ${target.id}`, path, pointer);
  }
  if (binding.flow.inspected.mode !== "run") {
    invalid("PROJECT_BINDING_RUN_MODE", `flow-call slot ${slot} targets Service Binding ${target.id}`, path, pointer);
  }
  return Object.freeze({ kind: "binding" as const, id: target.id });
}

function linkAttachments(
  configured: Readonly<Record<string, string>>,
  inspected: InspectedPackage,
  path: string,
): LinkedPackageBinding["attachments"] {
  const declared = inspected.metadata.attachments ?? {};
  const configuredKeys = Object.keys(configured).sort(compareProjectPaths);
  const declaredKeys = Object.keys(declared).sort(compareProjectPaths);
  if (configuredKeys.join("\0") !== declaredKeys.join("\0")) {
    const differing = configuredKeys.find((name) => !Object.hasOwn(declared, name)) ??
      declaredKeys.find((name) => !Object.hasOwn(configured, name));
    invalid("PROJECT_BINDING_ATTACHMENTS", "configured attachments must exactly match package attachment declarations", path, differing === undefined ? "/attachments" : attachmentPointer(differing));
  }
  const output: Record<string, { readonly source: string; readonly access: "read" | "read-write" }> = Object.create(null) as Record<string, { readonly source: string; readonly access: "read" | "read-write" }>;
  for (const name of declaredKeys) {
    const source = configured[name]!;
    if (isProtectedProjectPath(source)) {
      invalid("PROJECT_BINDING_ATTACHMENT_PROTECTED", `attachment ${name} cannot expose .jig`, path, attachmentPointer(name));
    }
    output[name] = Object.freeze({ source, access: declared[name]! });
  }
  return freezeRecord(output);
}

function validateSettings(settings: JsonObject, inspected: InspectedPackage, path: string): void {
  if (inspected.schemas.settings === undefined) {
    if (Object.keys(settings).length !== 0) {
      invalid("PROJECT_BINDING_SETTINGS_UNDECLARED", "package has no settings.schema.json but Binding settings are not empty", path, "/settings");
    }
    return;
  }
  try {
    inspected.schemas.settings.validate(settings, "PROJECT_BINDING_SETTINGS_INVALID");
  } catch (error) {
    if (error instanceof SchemaDiagnostic) {
      throw new CheckError("invalid", error.code, error.message, path, `/settings${error.instancePointer}`);
    }
    throw error;
  }
}

function contractIdentity(reference: CheckedContractReference): ContractIdentity {
  return Object.freeze({
    id: reference.contract.descriptor.id,
    version: reference.contract.descriptor.version,
    digest: reference.contract.digest,
  });
}

function contractKey(reference: CheckedContractReference): string {
  return `${reference.contract.descriptor.id}\0${reference.contract.descriptor.version}\0${reference.contract.digest}`;
}

function contractUses(
  inspected: InspectedPackage,
  usedContractBySlot: ReadonlyMap<string, CheckedContractReference>,
): LinkedFlow["uses"] {
  const output: Record<string, ContractIdentity | { readonly local: true }> = Object.create(null) as Record<string, ContractIdentity | { readonly local: true }>;
  for (const slot of Object.keys(inspected.metadata.uses ?? {}).sort(compareProjectPaths)) {
    const declaration = inspected.metadata.uses![slot]!;
    if (declaration.local === true) output[slot] = Object.freeze({ local: true as const });
    else {
      const checked = usedContractBySlot.get(slot);
      if (checked === undefined) throw new Error(`inspector omitted public capability ${slot}`);
      output[slot] = contractIdentity(checked);
    }
  }
  return freezeRecord(output);
}

function contractProvides(inspected: InspectedPackage): LinkedFlow["provides"] {
  const output: Record<string, ContractIdentity> = Object.create(null) as Record<string, ContractIdentity>;
  for (const checked of inspected.providedContracts) output[checked.slot] = contractIdentity(checked);
  return freezeRecord(output);
}

function rejectServiceCycles(
  bindings: readonly LinkedPackageBinding[],
  flowByPath: ReadonlyMap<string, PreparedFlow>,
): void {
  const services = new Map(bindings.filter(
    (binding) => flowByPath.get(binding.packagePath)!.inspected.mode === "service",
  ).map((binding) => [binding.id, binding]));
  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const id of services.keys()) {
    dependencies.set(id, new Set());
    dependents.set(id, new Set());
  }
  for (const binding of services.values()) {
    for (const slot of Object.values(binding.slots)) {
      if (slot.kind !== "capability" || !services.has(slot.provider.binding)) continue;
      dependencies.get(binding.id)!.add(slot.provider.binding);
      dependents.get(slot.provider.binding)!.add(binding.id);
    }
  }
  const ready = [...dependencies].filter(([, required]) => required.size === 0)
    .map(([id]) => id).sort(compareProjectPaths);
  let settled = 0;
  let cursor = 0;
  while (cursor < ready.length) {
    const id = ready[cursor++]!;
    settled += 1;
    for (const dependent of dependents.get(id)!) {
      const required = dependencies.get(dependent)!;
      required.delete(id);
      if (required.size === 0) {
        ready.push(dependent);
      }
    }
  }
  if (settled !== services.size) {
    const residual = new Set([...dependencies].filter(([, required]) => required.size > 0).map(([id]) => id));
    const trail: string[] = [];
    const seen = new Map<string, number>();
    let current = [...residual].sort(compareProjectPaths)[0]!;
    while (!seen.has(current)) {
      seen.set(current, trail.length);
      trail.push(current);
      current = [...dependencies.get(current)!].filter((id) => residual.has(id)).sort(compareProjectPaths)[0]!;
    }
    const cycle = trail.slice(seen.get(current)!);
    const cycleIds = new Set(cycle);
    const first = services.get(cycle[0]!)!;
    const slot = Object.entries(first.slots).find(([, value]) =>
      value.kind === "capability" && cycleIds.has(value.provider.binding))?.[0];
    invalid(
      "PROJECT_SERVICE_DEPENDENCY_CYCLE",
      `Service dependency cycle includes: ${cycle.join(", ")}`,
      first.declarationPath,
      slot === undefined ? "/slots" : slotPointer(slot),
    );
  }
}

class WorkBudget {
  private used = 0;

  consume(amount: number): void {
    this.used += amount;
    if (this.used > MAX_SEMANTIC_WORK) {
      invalid(
        "PROJECT_PACKAGE_WORK_LIMIT",
        `package-project semantic work exceeds ${MAX_SEMANTIC_WORK} units`,
      );
    }
  }
}

function jsonWork(value: JsonValue): number {
  if (value === null || typeof value !== "object") return 1;
  let work = 1;
  for (const child of Object.values(value)) work += jsonWork(child);
  return work;
}

function assertUniqueBindings(bindings: readonly (PreparedBinding | PreparedJournalPublisher)[]): void {
  const ids = new Set<string>();
  const paths: string[] = [];
  for (const binding of bindings) {
    if (ids.has(binding.id)) invalid("PROJECT_BINDING_COLLISION", `duplicate Binding ID ${binding.id}`, binding.declarationPath);
    ids.add(binding.id);
    paths.push(binding.declarationPath);
  }
  try {
    assertNoProjectPathCollisions(paths, "Binding declaration");
  } catch (error) {
    invalid("PROJECT_BINDING_COLLISION", errorText(error));
  }
}

function readBoundedArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid("PROJECT_PACKAGE_INPUT", `${label} must be an array`);
  if (value.length > MAX_MEMBERS) {
    invalid("PROJECT_PACKAGE_LIMIT", `${label} exceeds ${MAX_MEMBERS} members`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    invalid("PROJECT_PACKAGE_INPUT", `${label} must be an ordinary array`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) =>
    typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)))) {
    invalid("PROJECT_PACKAGE_INPUT", `${label} must not contain extra or symbolic properties`);
  }
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      invalid("PROJECT_PACKAGE_INPUT", `${label} must not be sparse or accessor-backed`);
    }
    output.push(descriptor.value);
  }
  return output;
}

function readClosedRecord(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid("PROJECT_PACKAGE_INPUT", `${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid("PROJECT_PACKAGE_INPUT", `${label} must be a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string") ||
      keys.length !== fields.length ||
      fields.some((field) => !keys.includes(field))) {
    invalid("PROJECT_PACKAGE_INPUT", `${label} must contain only ${fields.join(" and ")}`);
  }
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      invalid("PROJECT_PACKAGE_INPUT", `${label}.${field} must be an enumerable data property`);
    }
    output[field] = descriptor.value;
  }
  return output;
}

function slotPointer(name: string): string {
  return `/slots/${escapePointer(name)}`;
}

function attachmentPointer(name: string): string {
  return `/attachments/${escapePointer(name)}`;
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function freezeRecord<T>(value: Record<string, T>): Readonly<Record<string, T>> {
  return Object.freeze(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
