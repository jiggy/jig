import {
  canonicalJson,
  decodeJson1,
  JSON_1_LIMITS,
  type JsonObject,
  type JsonValue,
} from "../json.js";
import {
  requirePackageProjectValue,
  type PackageProjectValue,
} from "../project/package-project.js";
import {
  assertNoProjectPathCollisions,
  isProtectedProjectPath,
  validateProjectPath,
} from "../project/paths.js";
import { PRIVATE_ACTIVATION_TARGET_LIMIT } from "./activation-planning.js";
import { privateDomainDigest } from "./identity.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validatedLocks = new WeakSet<object>();

export interface PrivateLockPackage {
  readonly digest: string;
  readonly directRun: boolean;
}

export interface PrivateLockBinding {
  readonly packagePath: string;
  readonly settings: JsonObject;
  readonly slots: Readonly<Record<string, string>>;
}

export interface PrivateProjectLocalLock {
  readonly packages: Readonly<Record<string, PrivateLockPackage>>;
  readonly bindings: Readonly<Record<string, PrivateLockBinding>>;
}

/** Project-portable package and Binding choices, with no host activation data. */
export function createPrivateProjectLocalLock(
  project: PackageProjectValue,
): PrivateProjectLocalLock {
  const linked = requirePackageProjectValue(project);
  const packages: Record<string, PrivateLockPackage> = Object.create(null) as
    Record<string, PrivateLockPackage>;
  for (const flow of linked.flows) {
    packages[flow.provenance.projectPath] = Object.freeze({
      digest: flow.package.digest,
      directRun: flow.directRun,
    });
  }
  const bindings: Record<string, PrivateLockBinding> = Object.create(null) as
    Record<string, PrivateLockBinding>;
  for (const binding of linked.bindings) {
    bindings[binding.id] = Object.freeze({
      packagePath: binding.packagePath,
      settings: binding.settings,
      slots: binding.slots,
    });
  }
  const lock = normalizeLock({ packages, bindings });
  encodeNormalized(lock);
  return markValidated(lock);
}

export function encodePrivateProjectLocalLock(value: PrivateProjectLocalLock): Uint8Array {
  return encodeNormalized(requirePrivateProjectLocalLock(value));
}

export function decodePrivateProjectLocalLock(bytes: Uint8Array): PrivateProjectLocalLock {
  const normalized = normalizeLock(decodeJson1(bytes));
  if (!sameBytes(bytes, encodeNormalized(normalized))) {
    throw new TypeError("private package-project lock is not in canonical JSON/1 + LF form");
  }
  return markValidated(normalized);
}

export function privateProjectLocalLockDigest(value: PrivateProjectLocalLock): string {
  return privateDomainDigest(
    "JIG-Project-Lock",
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
  const root = exactObject(value, ["packages", "bindings"], "lock");
  const packages = normalizePackages(root.packages);
  const bindings = normalizeBindings(root.bindings);
  const activationTargetCount = Object.keys(bindings).length + Object.values(packages).filter(
    ({ directRun }) => directRun,
  ).length;
  if (activationTargetCount > PRIVATE_ACTIVATION_TARGET_LIMIT) {
    throw new TypeError(
      `lock activation targets exceed ${PRIVATE_ACTIVATION_TARGET_LIMIT} targets`,
    );
  }
  validateReferences(packages, bindings);
  return Object.freeze({ packages, bindings });
}

function normalizePackages(value: unknown): PrivateProjectLocalLock["packages"] {
  const input = object(value, "packages");
  const paths = Object.keys(input);
  assertNoProjectPathCollisions(paths, "lock package");
  const output: Record<string, PrivateLockPackage> = Object.create(null) as
    Record<string, PrivateLockPackage>;
  for (const path of paths.sort()) {
    projectPath(path, `package ${JSON.stringify(path)}`);
    const item = exactObject(
      input[path],
      ["digest", "directRun"],
      `package ${path}`,
    );
    if (typeof item.directRun !== "boolean") {
      throw new TypeError(`package ${path} directRun must be boolean`);
    }
    output[path] = Object.freeze({
      digest: digest(item.digest, `package ${path}`),
      directRun: item.directRun,
    });
  }
  return Object.freeze(output);
}

function normalizeBindings(value: unknown): PrivateProjectLocalLock["bindings"] {
  const input = object(value, "bindings");
  const output: Record<string, PrivateLockBinding> = Object.create(null) as
    Record<string, PrivateLockBinding>;
  for (const id of Object.keys(input).sort()) {
    localName(id, `Binding ${JSON.stringify(id)}`);
    const item = exactObject(
      input[id],
      ["packagePath", "settings", "slots"],
      `Binding ${id}`,
    );
    const settings = object(item.settings, `Binding ${id} settings`);
    const slots = normalizeSlots(item.slots, `Binding ${id}`);
    output[id] = Object.freeze({
      packagePath: projectPath(item.packagePath, `Binding ${id} packagePath`),
      settings,
      slots,
    });
  }
  return Object.freeze(output);
}

function validateReferences(
  packages: PrivateProjectLocalLock["packages"],
  bindings: PrivateProjectLocalLock["bindings"],
): void {
  for (const [id, binding] of Object.entries(bindings)) {
    const selected = packages[binding.packagePath];
    if (selected === undefined) throw new TypeError(`Binding ${id} selects an unknown package`);
    for (const [name, path] of Object.entries(binding.slots)) {
      const target = packages[path];
      if (target === undefined) {
        throw new TypeError(`Binding ${id} slot ${name} selects an unknown package`);
      }
      if (path === binding.packagePath) {
        throw new TypeError(`Binding ${id} slot ${name} selects its own package`);
      }
      if (!target.directRun) {
        throw new TypeError(`Binding ${id} slot ${name} must select a direct Run package`);
      }
    }
  }
}

function normalizeSlots(value: unknown, label: string): Readonly<Record<string, string>> {
  const input = object(value, `${label} slots`);
  const names = Object.keys(input);
  if (names.length > 256) throw new TypeError(`${label} slots exceed 256 entries`);
  const output: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const name of names.sort()) {
    localName(name, `${label} slot`);
    output[name] = projectPath(input[name], `${label} slot ${name}`);
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
    throw new TypeError(
      `${label} digest must be sha256: followed by 64 lowercase hexadecimal digits`,
    );
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
  const actual = Object.keys(result).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly ${expected.join(", ")}`);
  }
  return result;
}

function markValidated(value: PrivateProjectLocalLock): PrivateProjectLocalLock {
  validatedLocks.add(value);
  return value;
}

function encodeNormalized(value: PrivateProjectLocalLock): Uint8Array {
  const body = canonicalJson(value as unknown as JsonValue);
  if (body.byteLength >= JSON_1_LIMITS.bytes) {
    throw new TypeError(
      `private package-project lock exceeds ${JSON_1_LIMITS.bytes} bytes including LF`,
    );
  }
  const bytes = new Uint8Array(body.byteLength + 1);
  bytes.set(body);
  bytes[body.byteLength] = 0x0a;
  return bytes;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index]);
}
