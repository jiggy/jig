import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson, decodeJson1, type JsonObject, type JsonValue } from "../json.js";
import { privateDomainDigest, privateFileDigest } from "./identity.js";
import {
  privateNixStoreMember,
  queryPrivateNixClosure,
  requirePrivateNixStorePath,
} from "./private-nix-store.js";
import {
  requirePrivatePythonNixRuntimeObservation,
  verifyPrivatePythonNixRuntime,
  type PrivatePythonNixRuntimeObservation,
} from "./python-nix-runtime.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_ROLE_BYTES = 512 * 1024 * 1024;
const MAX_GENERATION_BYTES = 1024 * 1024;
const ROLE_NAMES = Object.freeze([
  "coordinator",
  "helper",
  "coordinator-bun",
  "helper-bun",
  "python",
  "bubblewrap",
  "nix-store",
  "bash",
] as const);
const observedGeneration = Symbol("observed Python/Linux host generation");
const authenticGenerations = new WeakSet<object>();

export type PrivatePythonLinuxHostRoleName = typeof ROLE_NAMES[number];

export interface PrivatePythonLinuxHostGenerationOptions {
  readonly coordinatorPath: string;
  readonly helperPath: string;
  readonly coordinatorBunPath: string;
  readonly helperBunPath: string;
  readonly bubblewrapPath: string;
  readonly bashPath: string;
  readonly runtime: PrivatePythonNixRuntimeObservation;
}

export interface PrivatePythonLinuxHostRole {
  readonly role: PrivatePythonLinuxHostRoleName;
  readonly path: string;
  readonly storePath: string;
  readonly byteCount: number;
  readonly fileDigest: string;
}

export interface PrivateNixGenerationMember {
  readonly storePath: string;
  readonly roles: readonly PrivatePythonLinuxHostRoleName[];
  readonly closureCount: number;
  readonly closureDigest: string;
}

export interface PrivatePythonLinuxHostGenerationIntent {
  readonly kind: "python-linux-host-generation/1";
  readonly digest: string;
  readonly observerRevision: "python-linux-host-generation-observer/1";
  readonly roles: readonly PrivatePythonLinuxHostRole[];
  readonly members: readonly PrivateNixGenerationMember[];
}

export interface PrivatePythonLinuxHostGeneration extends PrivatePythonLinuxHostGenerationIntent {
  readonly [observedGeneration]: true;
}

/** Observe one inert, exact Python/Linux implementation generation. */
export async function observePrivatePythonLinuxHostGeneration(
  options: PrivatePythonLinuxHostGenerationOptions,
): Promise<PrivatePythonLinuxHostGeneration> {
  const runtime = await verifyPrivatePythonNixRuntime(
    requirePrivatePythonNixRuntimeObservation(options.runtime),
  );
  const requestedRoles: readonly [PrivatePythonLinuxHostRoleName, string][] = [
    ["coordinator", options.coordinatorPath],
    ["helper", options.helperPath],
    ["coordinator-bun", options.coordinatorBunPath],
    ["helper-bun", options.helperBunPath],
    ["python", runtime.executable],
    ["bubblewrap", options.bubblewrapPath],
    ["nix-store", runtime.closureQueryExecutable],
    ["bash", options.bashPath],
  ];
  const roles: PrivatePythonLinuxHostRole[] = [];
  for (const [role, requestedPath] of requestedRoles) {
    requireAbsolutePath(requestedPath, `${role} path`);
    const path = await realpath(requestedPath);
    const information = await requireProtectedRoleFile(path, role);
    roles.push(Object.freeze({
      role,
      path,
      storePath: privateNixStoreMember(path, `${role} path`),
      byteCount: information.size,
      fileDigest: await privateFileDigest(path),
    }));
  }
  const nixStore = roles[ROLE_NAMES.indexOf("nix-store")]!.path;
  const memberRoles = new Map<string, PrivatePythonLinuxHostRoleName[]>();
  for (const role of roles) {
    const values = memberRoles.get(role.storePath) ?? [];
    values.push(role.role);
    memberRoles.set(role.storePath, values);
  }
  const members: PrivateNixGenerationMember[] = [];
  for (const storePath of [...memberRoles.keys()].sort(compareText)) {
    await requireProtectedStoreObject(storePath);
    const closureStores = await queryPrivateNixClosure(nixStore, storePath);
    for (const closureStore of closureStores) await requireProtectedStoreObject(closureStore);
    members.push(Object.freeze({
      storePath,
      roles: Object.freeze(memberRoles.get(storePath)!.sort(compareRoles)),
      closureCount: closureStores.length,
      closureDigest: closureDigest(closureStores),
    }));
  }
  return authenticateGeneration(roles, members);
}

export function requirePrivatePythonLinuxHostGeneration(
  value: unknown,
): PrivatePythonLinuxHostGeneration {
  if (value === null || typeof value !== "object" ||
      !authenticGenerations.has(value) || !Object.isFrozen(value)) {
    throw new TypeError("host generation was not produced by the private observer");
  }
  return value as PrivatePythonLinuxHostGeneration;
}

/** Rehash every role and re-query every exact Nix closure. */
export async function verifyPrivatePythonLinuxHostGeneration(
  value: PrivatePythonLinuxHostGeneration,
): Promise<PrivatePythonLinuxHostGeneration> {
  const generation = requirePrivatePythonLinuxHostGeneration(value);
  for (const role of generation.roles) {
    if (await realpath(role.path) !== role.path) throw new Error(`${role.role} path changed`);
    const information = await requireProtectedRoleFile(role.path, role.role);
    if (information.size !== role.byteCount || await privateFileDigest(role.path) !== role.fileDigest) {
      throw new Error(`${role.role} bytes changed`);
    }
    if (privateNixStoreMember(role.path, `${role.role} path`) !== role.storePath) {
      throw new Error(`${role.role} store member changed`);
    }
  }
  const nixStore = generation.roles.find((role) => role.role === "nix-store")!.path;
  for (const member of generation.members) {
    await requireProtectedStoreObject(member.storePath);
    const closureStores = await queryPrivateNixClosure(nixStore, member.storePath);
    if (closureStores.length !== member.closureCount ||
        closureDigest(closureStores) !== member.closureDigest) {
      throw new Error(`Nix closure changed for ${member.storePath}`);
    }
    for (const closureStore of closureStores) await requireProtectedStoreObject(closureStore);
  }
  return generation;
}

/** Canonical inert bytes suitable for a later durable root intent. */
export function encodePrivatePythonLinuxHostGeneration(
  value: PrivatePythonLinuxHostGeneration,
): Uint8Array {
  const generation = requirePrivatePythonLinuxHostGeneration(value);
  const canonical = canonicalJson(generation as unknown as JsonValue);
  if (canonical.byteLength + 1 > MAX_GENERATION_BYTES) {
    throw new Error("host generation exceeds its persisted byte limit");
  }
  const result = new Uint8Array(canonical.byteLength + 1);
  result.set(canonical);
  result[result.length - 1] = 0x0a;
  return result;
}

/** Strictly decode inert expected-state bytes; this does not authorize execution. */
export function decodePrivatePythonLinuxHostGeneration(
  bytes: Uint8Array,
): PrivatePythonLinuxHostGenerationIntent {
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_GENERATION_BYTES || bytes.at(-1) !== 0x0a) {
    throw new Error("host generation must be bounded canonical JSON/1 plus LF");
  }
  const source = bytes.subarray(0, -1);
  const decoded = decodeJson1(source);
  if (!Buffer.from(canonicalJson(decoded)).equals(Buffer.from(source))) {
    throw new Error("host generation is not canonically encoded");
  }
  const root = requireObject(decoded, "host generation");
  requireKeys(root, ["digest", "kind", "members", "observerRevision", "roles"], "host generation");
  if (root.kind !== "python-linux-host-generation/1" ||
      root.observerRevision !== "python-linux-host-generation-observer/1") {
    throw new Error("host generation discriminator is invalid");
  }
  requireDigest(root.digest, "host generation");
  const rolesValue = requireArray(root.roles, "host generation roles");
  if (rolesValue.length !== ROLE_NAMES.length) throw new Error("host generation role set is incomplete");
  const roles = rolesValue.map((value, index) => decodeRole(value, ROLE_NAMES[index]!));
  const membersValue = requireArray(root.members, "host generation members");
  if (membersValue.length === 0 || membersValue.length > ROLE_NAMES.length) {
    throw new Error("host generation member set is outside its bound");
  }
  const members = membersValue.map(decodeMember);
  for (let index = 1; index < members.length; index += 1) {
    if (compareText(members[index - 1]!.storePath, members[index]!.storePath) >= 0) {
      throw new Error("host generation members are not uniquely sorted");
    }
  }
  const assigned = new Map<PrivatePythonLinuxHostRoleName, string>();
  for (const member of members) {
    for (const role of member.roles) {
      if (assigned.has(role)) throw new Error("host generation assigns one role more than once");
      assigned.set(role, member.storePath);
    }
  }
  for (const role of roles) {
    if (assigned.get(role.role) !== role.storePath) {
      throw new Error("host generation role-to-member relation is inconsistent");
    }
  }
  const generation = Object.freeze(generationValue(roles, members));
  if (generation.digest !== root.digest) throw new Error("host generation digest does not match its value");
  return generation;
}

function authenticateGeneration(
  rolesInput: readonly PrivatePythonLinuxHostRole[],
  membersInput: readonly PrivateNixGenerationMember[],
): PrivatePythonLinuxHostGeneration {
  const generation = generationValue(rolesInput, membersInput) as PrivatePythonLinuxHostGeneration;
  Object.defineProperty(generation, observedGeneration, { value: true });
  Object.freeze(generation);
  authenticGenerations.add(generation);
  return generation;
}

function generationValue(
  rolesInput: readonly PrivatePythonLinuxHostRole[],
  membersInput: readonly PrivateNixGenerationMember[],
): PrivatePythonLinuxHostGenerationIntent {
  const roles = Object.freeze([...rolesInput]);
  const members = Object.freeze([...membersInput]);
  const identity = Object.freeze({
    kind: "python-linux-host-generation/1" as const,
    observerRevision: "python-linux-host-generation-observer/1" as const,
    roles,
    members,
  });
  return {
    ...identity,
    digest: privateDomainDigest(
      "JIG-Python-Linux-Host-Generation/1",
      identity as unknown as JsonValue,
    ),
  };
}

function decodeRole(value: JsonValue, expectedRole: PrivatePythonLinuxHostRoleName): PrivatePythonLinuxHostRole {
  const role = requireObject(value, `${expectedRole} role`);
  requireKeys(role, ["byteCount", "fileDigest", "path", "role", "storePath"], `${expectedRole} role`);
  if (role.role !== expectedRole) throw new Error("host generation roles are not in fixed order");
  const path = requireAbsolutePath(role.path, `${expectedRole} path`);
  const storePath = requirePrivateNixStorePath(requireString(role.storePath, `${expectedRole} store`), `${expectedRole} store`);
  if (privateNixStoreMember(path, `${expectedRole} path`) !== storePath) {
    throw new Error(`${expectedRole} path is outside its declared member`);
  }
  const byteCount = requirePositiveInteger(role.byteCount, `${expectedRole} byte count`, MAX_ROLE_BYTES);
  const fileDigest = requireDigest(role.fileDigest, `${expectedRole} file`);
  return Object.freeze({ role: expectedRole, path, storePath, byteCount, fileDigest });
}

function decodeMember(value: JsonValue): PrivateNixGenerationMember {
  const member = requireObject(value, "host generation member");
  requireKeys(member, ["closureCount", "closureDigest", "roles", "storePath"], "host generation member");
  const storePath = requirePrivateNixStorePath(requireString(member.storePath, "generation member store"), "generation member store");
  const rolesValue = requireArray(member.roles, "generation member roles");
  if (rolesValue.length === 0 || rolesValue.length > ROLE_NAMES.length) {
    throw new Error("generation member role set is outside its bound");
  }
  const roles = rolesValue.map((role) => {
    if (typeof role !== "string" || !ROLE_NAMES.includes(role as PrivatePythonLinuxHostRoleName)) {
      throw new Error("generation member contains an unknown role");
    }
    return role as PrivatePythonLinuxHostRoleName;
  });
  for (let index = 1; index < roles.length; index += 1) {
    if (compareRoles(roles[index - 1]!, roles[index]!) >= 0) {
      throw new Error("generation member roles are not uniquely sorted");
    }
  }
  const closureCount = requirePositiveInteger(member.closureCount, "generation member closure count", 512);
  const digest = requireDigest(member.closureDigest, "generation member closure");
  return Object.freeze({
    storePath,
    roles: Object.freeze(roles),
    closureCount,
    closureDigest: digest,
  });
}

async function requireProtectedRoleFile(path: string, label: string): Promise<{ readonly size: number }> {
  const information = await stat(path);
  if (!information.isFile() || information.uid !== 0 || (information.mode & 0o022) !== 0 ||
      !Number.isSafeInteger(information.size) || information.size <= 0 || information.size > MAX_ROLE_BYTES) {
    throw new Error(`${label} is not a bounded root-owned non-writable regular file`);
  }
  return Object.freeze({ size: information.size });
}

async function requireProtectedStoreObject(path: string): Promise<void> {
  if (await realpath(path) !== path) throw new Error("host generation contains an aliased Nix store member");
  const information = await stat(path);
  if ((!information.isDirectory() && !information.isFile()) ||
      information.uid !== 0 || (information.mode & 0o022) !== 0) {
    throw new Error("host generation contains an unprotected Nix store member");
  }
}

function closureDigest(stores: readonly string[]): string {
  return privateDomainDigest("JIG-Nix-Closure/1", stores as unknown as JsonValue);
}

function requireObject(value: JsonValue, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function requireArray(value: JsonValue | undefined, label: string): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireKeys(object: JsonObject, expected: readonly string[], label: string): void {
  const actual = Object.keys(object).sort(compareText);
  if (!sameStrings(actual, expected)) throw new Error(`${label} has unknown or missing fields`);
}

function requireString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function requireAbsolutePath(value: JsonValue | string | undefined, label: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || resolve(value) !== value ||
      /[\u0000\r\n]/u.test(value)) {
    throw new Error(`${label} must be a canonical absolute single-line path`);
  }
  return value;
}

function requireDigest(value: JsonValue | string | undefined, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new Error(`${label} digest is invalid`);
  return value;
}

function requirePositiveInteger(value: JsonValue | undefined, label: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} is outside its bound`);
  }
  return value;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareRoles(left: PrivatePythonLinuxHostRoleName, right: PrivatePythonLinuxHostRoleName): number {
  return ROLE_NAMES.indexOf(left) - ROLE_NAMES.indexOf(right);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
