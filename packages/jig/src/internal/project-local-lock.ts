import {
  isCapabilityContractId,
  isCapabilityContractVersion,
} from "../capability/index.js";
import {
  canonicalJson,
  decodeJson1,
  JSON_1_LIMITS,
  type JsonObject,
  type JsonValue,
} from "../json.js";
import {
  requirePackageProjectValue,
  PRIVATE_CANONICAL_JOURNAL_CONTRACT,
  type ContractIdentity,
  type PackageProjectValue,
  type RunTargetIdentity,
} from "../project/package-project.js";
import {
  assertNoProjectPathCollisions,
  compareProjectPaths,
  isProtectedProjectPath,
  validateProjectPath,
} from "../project/paths.js";
import { privateDomainDigest } from "./identity.js";

const KIND = "private-package-project-lock/2";
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_METADATA_MEMBERS = 256;
const validatedLocks = new WeakSet<object>();

export interface PrivateLockContractIdentity extends ContractIdentity {}

export type PrivateLockCapabilityUse =
  | { readonly kind: "local" }
  | ({ readonly kind: "contract" } & PrivateLockContractIdentity);

export interface PrivateLockPackage {
  readonly digest: string;
  readonly mode: "run" | "service";
  readonly directRun: boolean;
  readonly attachments: Readonly<Record<string, "read" | "read-write">>;
  readonly uses: Readonly<Record<string, PrivateLockCapabilityUse>>;
  readonly provides: Readonly<Record<string, PrivateLockContractIdentity>>;
}

export type PrivateLockSlot =
  | {
      readonly kind: "flow-call";
      readonly targets: readonly RunTargetIdentity[];
    }
  | {
      readonly kind: "capability";
      readonly provider: {
        readonly binding: string;
        readonly export: string;
      };
    };

export interface PrivateLockBinding {
  readonly packagePath: string;
  readonly attachments: Readonly<Record<string, {
    readonly source: string;
    readonly access: "read" | "read-write";
  }>>;
  readonly slots: Readonly<Record<string, PrivateLockSlot>>;
}

export interface PrivateLockJournalPublisher {
  readonly source: string;
  readonly contract: PrivateLockContractIdentity;
  readonly eventTypes: readonly string[];
}

export interface PrivateLockHook {
  readonly declarationPath: string;
  readonly source: string;
  readonly publisherBinding: string;
  readonly type: string;
  readonly target: RunTargetIdentity;
  readonly definitionDigest: string;
}

/**
 * Package-project-only portable evidence. This is deliberately not the public
 * jig.lock schema: upstream source revisions, Semantic Choice, and generic
 * host-capability registrations do not have closed models yet. Its one inert
 * Hook relation is closed here only as private candidate evidence.
 */
export interface PrivateProjectLocalLock {
  readonly kind: typeof KIND;
  readonly packages: Readonly<Record<string, PrivateLockPackage>>;
  readonly bindings: Readonly<Record<string, PrivateLockBinding>>;
  readonly journalPublishers: Readonly<Record<string, PrivateLockJournalPublisher>>;
  readonly hooks: Readonly<Record<string, PrivateLockHook>>;
}

/** Project portable package/contract choices, with no host activation data. */
export function createPrivateProjectLocalLock(
  project: PackageProjectValue,
): PrivateProjectLocalLock {
  const linked = requirePackageProjectValue(project);
  const packages: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const flow of linked.flows) {
    const attachments: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const name of Object.keys(flow.metadata.attachments ?? {}).sort()) {
      attachments[name] = flow.metadata.attachments![name]!;
    }
    const uses: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const name of Object.keys(flow.uses).sort()) {
      const requirement = flow.uses[name]!;
      uses[name] = "local" in requirement
        ? { kind: "local" }
        : { kind: "contract", ...requirement };
    }
    const provides: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const name of Object.keys(flow.provides).sort()) {
      provides[name] = { ...flow.provides[name]! };
    }
    packages[flow.provenance.projectPath] = {
      digest: flow.package.digest,
      mode: flow.mode,
      directRun: flow.directRun,
      attachments,
      uses,
      provides,
    };
  }

  const bindings: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const binding of linked.bindings) {
    const attachments: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const name of Object.keys(binding.attachments).sort()) {
      attachments[name] = { ...binding.attachments[name]! };
    }
    const slots: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const name of Object.keys(binding.slots).sort()) {
      const slot = binding.slots[name]!;
      slots[name] = slot.kind === "flow-call"
        ? { kind: slot.kind, targets: slot.targets.map((target) => ({ ...target })) }
        : { kind: slot.kind, provider: { ...slot.provider } };
    }
    bindings[binding.id] = {
      packagePath: binding.packagePath,
      attachments,
      slots,
    };
  }

  const journalPublishers: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const publisher of linked.journalPublishers) {
    journalPublishers[publisher.id] = {
      source: publisher.source,
      contract: { ...publisher.contract },
      eventTypes: [...publisher.eventTypes],
    };
  }

  const hooks: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const hook of linked.hooks) {
    hooks[hook.id] = {
      declarationPath: hook.declarationPath,
      source: hook.source,
      publisherBinding: hook.publisherBinding,
      type: hook.type,
      target: { ...hook.target },
      definitionDigest: hook.definitionDigest,
    };
  }

  const lock = normalizeLock({ kind: KIND, packages, bindings, journalPublishers, hooks });
  // The guarded value must already satisfy the same persisted byte budget its
  // strict decoder enforces; a later encode is not allowed to discover this.
  encodeNormalized(lock);
  return markValidated(lock);
}

/** Encode the one accepted byte spelling: RFC 8785 JSON followed by LF. */
export function encodePrivateProjectLocalLock(value: PrivateProjectLocalLock): Uint8Array {
  return encodeNormalized(requirePrivateProjectLocalLock(value));
}

/** Strictly decode canonical bytes and mint a new immutable inert value. */
export function decodePrivateProjectLocalLock(bytes: Uint8Array): PrivateProjectLocalLock {
  const normalized = normalizeLock(decodeJson1(bytes));
  const expected = encodeNormalized(normalized);
  if (!sameBytes(bytes, expected)) {
    throw new TypeError("private package-project lock is not in canonical JSON/1 + LF form");
  }
  return markValidated(normalized);
}

/** External evidence identity; it is intentionally not embedded in the lock. */
export function privateProjectLocalLockDigest(value: PrivateProjectLocalLock): string {
  return privateDomainDigest(
    "JIG-Private-Package-Project-Lock/2",
    requirePrivateProjectLocalLock(value) as unknown as JsonValue,
  );
}

export function requirePrivateProjectLocalLock(value: unknown): PrivateProjectLocalLock {
  if (value === null || typeof value !== "object" || !validatedLocks.has(value)) {
    throw new TypeError("private package-project lock was not built or strictly decoded");
  }
  return value as PrivateProjectLocalLock;
}

function normalizeLock(value: unknown): PrivateProjectLocalLock {
  const root = exactObject(value, ["kind", "packages", "bindings", "journalPublishers", "hooks"], "lock");
  if (root.kind !== KIND) throw new TypeError(`lock kind must be ${KIND}`);
  const packages = normalizePackages(root.packages);
  const bindings = normalizeBindings(root.bindings);
  const journalPublishers = normalizeJournalPublishers(root.journalPublishers);
  const hooks = normalizeHooks(root.hooks);
  validateReferences(packages, bindings, journalPublishers, hooks);
  return Object.freeze({ kind: KIND, packages, bindings, journalPublishers, hooks });
}

function normalizeHooks(value: unknown): PrivateProjectLocalLock["hooks"] {
  const input = object(value, "hooks");
  const output: Record<string, PrivateLockHook> = Object.create(null) as Record<string, PrivateLockHook>;
  for (const id of Object.keys(input).sort()) {
    localName(id, `Hook ${JSON.stringify(id)}`);
    const item = exactObject(
      input[id],
      ["declarationPath", "source", "publisherBinding", "type", "target", "definitionDigest"],
      `Hook ${id}`,
    );
    const declarationPath = projectPath(item.declarationPath, `Hook ${id} declarationPath`);
    if (!declarationPath.endsWith(`/${id}.ts`) && declarationPath !== `${id}.ts`) {
      throw new TypeError(`Hook ${id} declaration path must end in ${id}.ts`);
    }
    const publisherBinding = localName(item.publisherBinding, `Hook ${id} publisherBinding`);
    if (item.source !== `binding:${publisherBinding}`) {
      throw new TypeError(`Hook ${id} source must name its publisher Binding`);
    }
    if (typeof item.type !== "string" || [...item.type].length === 0 || [...item.type].length > 512) {
      throw new TypeError(`Hook ${id} type must be a non-empty string of at most 512 characters`);
    }
    output[id] = Object.freeze({
      declarationPath,
      source: item.source,
      publisherBinding,
      type: item.type,
      target: normalizeTarget(item.target, `Hook ${id} target`),
      definitionDigest: digest(item.definitionDigest, `Hook ${id} definition`),
    });
  }
  return Object.freeze(output);
}

function normalizeJournalPublishers(value: unknown): PrivateProjectLocalLock["journalPublishers"] {
  const input = object(value, "journalPublishers");
  const output: Record<string, PrivateLockJournalPublisher> = Object.create(null) as Record<string, PrivateLockJournalPublisher>;
  for (const id of Object.keys(input).sort()) {
    localName(id, `Journal publisher ${JSON.stringify(id)}`);
    const item = exactObject(input[id], ["source", "contract", "eventTypes"], `Journal publisher ${id}`);
    if (item.source !== `binding:${id}`) {
      throw new TypeError(`Journal publisher ${id} source must be binding:${id}`);
    }
    const contract = contractIdentity(
      exactObject(item.contract, ["id", "version", "digest"], `Journal publisher ${id} contract`),
      `Journal publisher ${id} contract`,
    );
    if (contractKey(contract) !== contractKey(PRIVATE_CANONICAL_JOURNAL_CONTRACT)) {
      throw new TypeError(`Journal publisher ${id} must implement the canonical Journal contract`);
    }
    const values = array(item.eventTypes, `Journal publisher ${id} eventTypes`);
    if (values.length === 0 || values.length > JSON_1_LIMITS.containerEntries) {
      throw new TypeError(`Journal publisher ${id} eventTypes must contain 1..${JSON_1_LIMITS.containerEntries} values`);
    }
    const eventTypes = values.map((eventType) => {
      if (typeof eventType !== "string" || [...eventType].length === 0 || [...eventType].length > 512) {
        throw new TypeError(`Journal publisher ${id} event type must be a non-empty string of at most 512 characters`);
      }
      if (eventType.startsWith("https://jig.dev/events/")) {
        throw new TypeError(`Journal publisher ${id} event type uses Jig's protected lifecycle namespace`);
      }
      return eventType;
    });
    for (let index = 1; index < eventTypes.length; index += 1) {
      if (eventTypes[index - 1]! >= eventTypes[index]!) {
        throw new TypeError(`Journal publisher ${id} eventTypes are not strictly ordered`);
      }
    }
    output[id] = Object.freeze({ source: item.source, contract, eventTypes: Object.freeze(eventTypes) });
  }
  return Object.freeze(output);
}

function normalizePackages(value: unknown): PrivateProjectLocalLock["packages"] {
  const input = object(value, "packages");
  const paths = Object.keys(input);
  assertNoProjectPathCollisions(paths, "lock package");
  const output: Record<string, PrivateLockPackage> = Object.create(null) as Record<string, PrivateLockPackage>;
  for (const path of paths.sort()) {
    validateProjectPath(path, `package ${JSON.stringify(path)}`);
    if (isProtectedProjectPath(path)) throw new TypeError(`package ${path} uses protected .jig state`);
    const item = exactObject(
      input[path],
      ["digest", "mode", "directRun", "attachments", "uses", "provides"],
      `package ${path}`,
    );
    const mode = item.mode;
    if (mode !== "run" && mode !== "service") {
      throw new TypeError(`package ${path} mode must be run or service`);
    }
    if (typeof item.directRun !== "boolean") {
      throw new TypeError(`package ${path} directRun must be boolean`);
    }
    const attachments = stringMap(item.attachments, `package ${path} attachments`, (entry, label) => {
      if (entry !== "read" && entry !== "read-write") {
        throw new TypeError(`${label} must be read or read-write`);
      }
      return entry;
    }, MAX_METADATA_MEMBERS);
    const uses = stringMap(item.uses, `package ${path} uses`, (entry, label) => {
      const use = object(entry, label);
      if (use.kind === "local") {
        exactFields(use, ["kind"], label);
        return Object.freeze({ kind: "local" as const });
      }
      exactFields(use, ["kind", "id", "version", "digest"], label);
      if (use.kind !== "contract") throw new TypeError(`${label} has an invalid kind`);
      return Object.freeze({ kind: "contract" as const, ...contractIdentity(use, label) });
    }, MAX_METADATA_MEMBERS);
    const provides = stringMap(
      item.provides,
      `package ${path} provides`,
      (entry, label) => contractIdentity(exactObject(entry, ["id", "version", "digest"], label), label),
      MAX_METADATA_MEMBERS,
    );
    rejectContractEquivocation(path, uses, provides);
    if (mode === "run" && Object.keys(provides).length !== 0) {
      throw new TypeError(`Run package ${path} cannot provide capabilities`);
    }
    if (mode === "service" && item.directRun) {
      throw new TypeError(`Service package ${path} cannot be a direct Run target`);
    }
    if (item.directRun && (Object.keys(attachments).length !== 0 || Object.keys(uses).length !== 0)) {
      throw new TypeError(`direct Run package ${path} cannot require attachments or capabilities`);
    }
    output[path] = Object.freeze({
      digest: digest(item.digest, `package ${path}`),
      mode,
      directRun: item.directRun,
      attachments,
      uses,
      provides,
    });
  }
  return Object.freeze(output);
}

function normalizeBindings(value: unknown): PrivateProjectLocalLock["bindings"] {
  const input = object(value, "bindings");
  const output: Record<string, PrivateLockBinding> = Object.create(null) as Record<string, PrivateLockBinding>;
  for (const id of Object.keys(input).sort()) {
    localName(id, `Binding ${JSON.stringify(id)}`);
    const item = exactObject(input[id], ["packagePath", "attachments", "slots"], `Binding ${id}`);
    const packagePath = projectPath(item.packagePath, `Binding ${id} packagePath`);
    const attachments = stringMap(item.attachments, `Binding ${id} attachments`, (entry, label) => {
      const attachment = exactObject(entry, ["source", "access"], label);
      if (attachment.access !== "read" && attachment.access !== "read-write") {
        throw new TypeError(`${label} access must be read or read-write`);
      }
      return Object.freeze({
        source: projectPath(attachment.source, `${label} source`),
        access: attachment.access,
      });
    }, MAX_METADATA_MEMBERS);
    const slots = stringMap(item.slots, `Binding ${id} slots`, (entry, label) => {
      const slot = object(entry, label);
      if (slot.kind === "flow-call") {
        exactFields(slot, ["kind", "targets"], label);
        const rawTargets = array(slot.targets, `${label} targets`);
        if (rawTargets.length === 0) throw new TypeError(`${label} targets cannot be empty`);
        const targets = rawTargets.map((target, index) => normalizeTarget(target, `${label} targets[${index}]`));
        targets.sort(compareTargets);
        for (let index = 1; index < targets.length; index += 1) {
          if (targetKey(targets[index - 1]!) === targetKey(targets[index]!)) {
            throw new TypeError(`${label} contains duplicate target ${targetKey(targets[index]!)}`);
          }
        }
        return Object.freeze({ kind: "flow-call" as const, targets: Object.freeze(targets) });
      }
      exactFields(slot, ["kind", "provider"], label);
      if (slot.kind !== "capability") throw new TypeError(`${label} has an invalid kind`);
      const provider = exactObject(slot.provider, ["binding", "export"], `${label} provider`);
      return Object.freeze({
        kind: "capability" as const,
        provider: Object.freeze({
          binding: localName(provider.binding, `${label} provider Binding`),
          export: localName(provider.export, `${label} provider export`),
        }),
      });
    });
    output[id] = Object.freeze({ packagePath, attachments, slots });
  }
  return Object.freeze(output);
}

function validateReferences(
  packages: PrivateProjectLocalLock["packages"],
  bindings: PrivateProjectLocalLock["bindings"],
  journalPublishers: PrivateProjectLocalLock["journalPublishers"],
  hooks: PrivateProjectLocalLock["hooks"],
): void {
  for (const [id, binding] of Object.entries(bindings)) {
    const consumer = packages[binding.packagePath];
    if (consumer === undefined) throw new TypeError(`Binding ${id} selects an unknown package`);
    const attachmentNames = Object.keys(binding.attachments).sort();
    const requestedNames = Object.keys(consumer.attachments).sort();
    if (attachmentNames.join("\0") !== requestedNames.join("\0")) {
      throw new TypeError(`Binding ${id} attachments do not match its package`);
    }
    for (const name of requestedNames) {
      if (binding.attachments[name]!.access !== consumer.attachments[name]) {
        throw new TypeError(`Binding ${id} attachment ${name} access does not match its package`);
      }
    }
    for (const [name, requirement] of Object.entries(consumer.uses)) {
      if (requirement.kind === "local") {
        throw new TypeError(`Binding ${id} uses unsupported local capability ${name}`);
      }
      if (binding.slots[name]?.kind !== "capability") {
        throw new TypeError(`Binding ${id} does not resolve required capability ${name}`);
      }
    }
    for (const [name, slot] of Object.entries(binding.slots)) {
      if (slot.kind === "flow-call") {
        if (Object.hasOwn(consumer.uses, name)) {
          throw new TypeError(`Binding ${id} maps capability ${name} as a Flow call`);
        }
        for (const target of slot.targets) validateRunTarget(target, packages, bindings, `Binding ${id} slot ${name}`);
        continue;
      }
      const required = consumer.uses[name];
      if (required === undefined || required.kind !== "contract") {
        throw new TypeError(`Binding ${id} maps undeclared capability ${name}`);
      }
      const providerBinding = bindings[slot.provider.binding];
      if (providerBinding === undefined) {
        const publisher = journalPublishers[slot.provider.binding];
        if (publisher === undefined) {
          throw new TypeError(`Binding ${id} capability ${name} selects unknown provider Binding`);
        }
        if (slot.provider.export !== "journal" ||
            contractKey(publisher.contract) !== contractKey(required)) {
          throw new TypeError(`Binding ${id} capability ${name} selects an incompatible Journal publisher`);
        }
        continue;
      }
      const providerPackage = packages[providerBinding.packagePath];
      if (providerPackage === undefined || providerPackage.mode !== "service") {
        throw new TypeError(`Binding ${id} capability ${name} selects a non-Service provider`);
      }
      const provided = providerPackage.provides[slot.provider.export];
      if (provided === undefined || contractKey(provided) !== contractKey(required)) {
        throw new TypeError(`Binding ${id} capability ${name} selects an incompatible provider export`);
      }
    }
  }
  for (const id of Object.keys(journalPublishers)) {
    if (Object.hasOwn(bindings, id)) throw new TypeError(`duplicate Binding ID ${id}`);
  }
  for (const [id, hook] of Object.entries(hooks)) {
    const publisher = journalPublishers[hook.publisherBinding];
    if (publisher === undefined) throw new TypeError(`Hook ${id} selects an unknown Journal publisher`);
    if (!publisher.eventTypes.includes(hook.type)) {
      throw new TypeError(`Hook ${id} type is not authorized by its Journal publisher`);
    }
    validateRunTarget(hook.target, packages, bindings, `Hook ${id}`);
  }
  rejectServiceCycles(packages, bindings);
}

function validateRunTarget(
  target: RunTargetIdentity,
  packages: PrivateProjectLocalLock["packages"],
  bindings: PrivateProjectLocalLock["bindings"],
  label: string,
): void {
  if (target.kind === "flow") {
    const flow = packages[target.path];
    if (flow === undefined || flow.mode !== "run" || !flow.directRun) {
      throw new TypeError(`${label} selects a non-direct Run Flow`);
    }
    return;
  }
  const binding = bindings[target.id];
  if (binding === undefined || packages[binding.packagePath]?.mode !== "run") {
    throw new TypeError(`${label} selects a non-Run Binding`);
  }
}

function rejectServiceCycles(
  packages: PrivateProjectLocalLock["packages"],
  bindings: PrivateProjectLocalLock["bindings"],
): void {
  const services = new Set(Object.entries(bindings).flatMap(([id, binding]) =>
    packages[binding.packagePath]?.mode === "service" ? [id] : []
  ));
  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const id of services) {
    dependencies.set(id, new Set());
    dependents.set(id, new Set());
  }
  for (const id of services) {
    for (const slot of Object.values(bindings[id]!.slots)) {
      if (slot.kind !== "capability" || !services.has(slot.provider.binding)) continue;
      dependencies.get(id)!.add(slot.provider.binding);
      dependents.get(slot.provider.binding)!.add(id);
    }
  }
  const ready = [...dependencies].flatMap(([id, required]) => required.size === 0 ? [id] : [])
    .sort();
  let cursor = 0;
  while (cursor < ready.length) {
    const id = ready[cursor++]!;
    for (const dependent of dependents.get(id)!) {
      const required = dependencies.get(dependent)!;
      required.delete(id);
      if (required.size === 0) ready.push(dependent);
    }
  }
  if (cursor !== services.size) throw new TypeError("Service capability dependency cycle in lock");
}

function normalizeTarget(value: unknown, label: string): RunTargetIdentity {
  const target = object(value, label);
  if (target.kind === "flow") {
    exactFields(target, ["kind", "path"], label);
    return Object.freeze({ kind: "flow" as const, path: projectPath(target.path, `${label} path`) });
  }
  exactFields(target, ["kind", "id"], label);
  if (target.kind !== "binding") throw new TypeError(`${label} has an invalid kind`);
  return Object.freeze({ kind: "binding" as const, id: localName(target.id, `${label} id`) });
}

function contractIdentity(value: JsonObject, label: string): PrivateLockContractIdentity {
  if (typeof value.id !== "string" || !isCapabilityContractId(value.id)) {
    throw new TypeError(`${label} id is not a Capability Contract/1 ID`);
  }
  if (typeof value.version !== "string" || !isCapabilityContractVersion(value.version)) {
    throw new TypeError(`${label} version is not stable SemVer core`);
  }
  return Object.freeze({
    id: value.id,
    version: value.version,
    digest: digest(value.digest, `${label} contract`),
  });
}

function stringMap<T>(
  value: unknown,
  label: string,
  normalize: (value: JsonValue, label: string) => T,
  limit?: number,
): Readonly<Record<string, T>> {
  const input = object(value, label);
  const keys = Object.keys(input);
  if (limit !== undefined && keys.length > limit) {
    throw new TypeError(`${label} exceeds ${limit} members`);
  }
  const output: Record<string, T> = Object.create(null) as Record<string, T>;
  for (const key of keys.sort()) {
    localName(key, `${label} key`);
    output[key] = normalize(input[key]!, `${label}.${key}`);
  }
  return Object.freeze(output);
}

function projectPath(value: unknown, label: string): string {
  validateProjectPath(value, label);
  if (isProtectedProjectPath(value)) throw new TypeError(`${label} uses protected .jig state`);
  return value;
}

function localName(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 64 || !LOCAL_NAME.test(value)) {
    throw new TypeError(`${label} must be a LocalName`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} digest must be sha256: followed by 64 lowercase hexadecimal digits`);
  }
  return value;
}

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonObject;
}

function exactObject(value: unknown, fields: readonly string[], label: string): JsonObject {
  const result = object(value, label);
  exactFields(result, fields, label);
  return result;
}

function exactFields(value: JsonObject, fields: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly ${expected.join(", ")}`);
  }
}

function array(value: JsonValue | undefined, label: string): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function targetKey(target: RunTargetIdentity): string {
  return target.kind === "binding" ? `binding\0${target.id}` : `flow\0${target.path}`;
}

function compareTargets(left: RunTargetIdentity, right: RunTargetIdentity): number {
  if (left.kind !== right.kind) return left.kind === "binding" ? -1 : 1;
  return left.kind === "binding"
    ? compareProjectPaths(left.id, (right as Extract<RunTargetIdentity, { kind: "binding" }>).id)
    : compareProjectPaths(left.path, (right as Extract<RunTargetIdentity, { kind: "flow" }>).path);
}

function contractKey(value: PrivateLockContractIdentity): string {
  return `${value.id}\0${value.version}\0${value.digest}`;
}

function rejectContractEquivocation(
  packagePath: string,
  uses: Readonly<Record<string, PrivateLockCapabilityUse>>,
  provides: Readonly<Record<string, PrivateLockContractIdentity>>,
): void {
  const seen = new Map<string, string>();
  for (const contract of [
    ...Object.values(uses).flatMap((use) => use.kind === "contract" ? [use] : []),
    ...Object.values(provides),
  ]) {
    const identity = `${contract.id}\0${contract.version}`;
    const prior = seen.get(identity);
    if (prior !== undefined && prior !== contract.digest) {
      throw new TypeError(`package ${packagePath} equivocates on capability contract ${contract.id}@${contract.version}`);
    }
    seen.set(identity, contract.digest);
  }
}

function markValidated(value: PrivateProjectLocalLock): PrivateProjectLocalLock {
  validatedLocks.add(value);
  return value;
}

function encodeNormalized(value: PrivateProjectLocalLock): Uint8Array {
  const body = canonicalJson(value as unknown as JsonValue);
  if (body.byteLength >= JSON_1_LIMITS.bytes) {
    throw new TypeError(`private package-project lock exceeds ${JSON_1_LIMITS.bytes} bytes including LF`);
  }
  const bytes = new Uint8Array(body.byteLength + 1);
  bytes.set(body);
  bytes[body.byteLength] = 0x0a;
  return bytes;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}
