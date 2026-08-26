import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import { invalid, unavailable } from "../diagnostics.js";
import { canonicalJson, decodeJson1, type JsonValue } from "../json.js";
import { privateDomainDigest } from "./identity.js";
import {
  observePrivatePythonLinuxRootIntent,
  requirePrivatePythonLinuxRootIntentObservation,
  type PrivatePythonLinuxStateRootIdentity,
} from "./python-linux-host-generation-roots.js";

const REGISTRATION_FILE = "registration.json";
const STATE_DIRECTORY = "state";
const MAX_REGISTRATION_BYTES = 4 * 1024;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,19})$/u;
const UINT64_MAX = (1n << 64n) - 1n;
const UID_MAX = (1n << 32n) - 1n;
const REGISTRATION_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const authenticRegistrationObservations = new WeakSet<object>();

interface ProtectedDirectory {
  readonly handle: FileHandle;
  readonly path: string;
  readonly information: BigIntStats;
  verify(): Promise<void>;
}

interface ProtectedRegistrationFile {
  readonly handle: FileHandle;
  readonly path: string;
  readonly information: BigIntStats;
  readonly bytes: Uint8Array;
  verify(): Promise<void>;
}

interface PrivatePythonLinuxHostRegistrationRecord {
  readonly kind: "python-linux-host-registration/1";
  readonly digest: string;
  readonly generationDigest: string;
  readonly stateRoot: PrivatePythonLinuxStateRootIdentity;
}

export interface PrivatePythonLinuxHostRegistrationAnchor {
  readonly path: string;
  readonly device: string;
  readonly inode: string;
}

export interface PrivatePythonLinuxHostRegistrationObservation {
  readonly kind: "python-linux-host-registration-observation/1";
  readonly admissible: false;
  readonly digest: string;
  readonly registrationDigest: string;
  readonly generationDigest: string;
  readonly rootIntentDigest: string;
  readonly registrationAnchor: PrivatePythonLinuxHostRegistrationAnchor;
  readonly registrationRoot: Readonly<{
    readonly path: string;
    readonly device: string;
    readonly inode: string;
  }>;
  readonly registrationFile: Readonly<{
    readonly path: string;
    readonly device: string;
    readonly inode: string;
  }>;
  readonly stateRoot: PrivatePythonLinuxStateRootIdentity;
}

/**
 * Observe one administrator-installed registration and its live stored intent.
 * It installs no policy or roots and produces no execution acquisition.
 * Existing owner SQLite state may undergo ordinary recovery while inspected.
 */
export async function observePrivatePythonLinuxHostRegistration(input: {
  readonly registrationAnchor: PrivatePythonLinuxHostRegistrationAnchor;
  readonly registrationName: string;
  readonly expectedRegistrationDigest: string;
}): Promise<PrivatePythonLinuxHostRegistrationObservation> {
  const request = normalizeObservationInput(input);
  const anchor = await openRegistrationAnchor(request.registrationAnchor);
  let root: ProtectedDirectory | undefined;
  let registration: ProtectedRegistrationFile | undefined;
  let state: ProtectedDirectory | undefined;
  let failure: unknown;
  try {
    root = await openRegistrationRoot(anchor, request.registrationName);
    await requireExactEntries(root);
    registration = await openRegistrationFile(root);
    const record = decodeRegistration(registration.bytes);
    if (record.digest !== request.expectedRegistrationDigest) {
      unavailable("HOST_REGISTRATION_CONFLICT", "host registration does not match the expected record digest");
    }
    if (record.stateRoot.path !== join(root.path, STATE_DIRECTORY)) {
      invalid("HOST_REGISTRATION_STATE_PATH", "registered state root is not the fixed direct child");
    }
    state = await openRegisteredState(root, record.stateRoot);
    await verifyAll(root, registration, state);

    const intent = requirePrivatePythonLinuxRootIntentObservation(
      await observePrivatePythonLinuxRootIntent({
        stateRoot: record.stateRoot.path,
        expectedDigest: record.generationDigest,
      }),
    );
    if (intent.generationDigest !== record.generationDigest ||
        !sameStateRoot(intent.stateRoot, record.stateRoot)) {
      invalid("HOST_REGISTRATION_INTENT", "registered generation does not match its protected state intent");
    }
    await verifyAll(root, registration, state);

    const identity = Object.freeze({
      kind: "python-linux-host-registration-observation/1" as const,
      admissible: false as const,
      registrationDigest: record.digest,
      generationDigest: record.generationDigest,
      rootIntentDigest: intent.digest,
      registrationAnchor: directoryIdentity(anchor),
      registrationRoot: directoryIdentity(root),
      registrationFile: fileIdentity(registration),
      stateRoot: record.stateRoot,
    });
    const observation = Object.freeze({
      ...identity,
      digest: privateDomainDigest(
        "JIG-Python-Linux-Host-Registration-Observation/1",
        identity as unknown as JsonValue,
      ),
    });
    authenticRegistrationObservations.add(observation);
    return observation;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const cleanupFailures: unknown[] = [];
    try { await state?.handle.close(); } catch (error) { cleanupFailures.push(error); }
    try { await registration?.handle.close(); } catch (error) { cleanupFailures.push(error); }
    try { await root?.handle.close(); } catch (error) { cleanupFailures.push(error); }
    try { await anchor.handle.close(); } catch (error) { cleanupFailures.push(error); }
    if (cleanupFailures.length > 0) {
      const cleanup = new AggregateError(cleanupFailures, "host registration observation did not close");
      if (failure !== undefined) throw new AggregateError([failure, cleanup], "host registration observation failed");
      throw cleanup;
    }
  }
}

export function requirePrivatePythonLinuxHostRegistrationObservation(
  value: unknown,
): PrivatePythonLinuxHostRegistrationObservation {
  if (value === null || typeof value !== "object" ||
      !authenticRegistrationObservations.has(value)) {
    throw new TypeError("Python/Linux host registration was not produced by the private observer");
  }
  return value as PrivatePythonLinuxHostRegistrationObservation;
}

async function openRegistrationAnchor(
  input: PrivatePythonLinuxHostRegistrationAnchor,
): Promise<ProtectedDirectory> {
  const expected = normalizeAnchor(input);
  const canonical = await realpath(expected.path).catch((error) => {
    if (hasCode(error, "ENOENT")) {
      unavailable("HOST_REGISTRATION_ANCHOR_MISSING", "host registration anchor does not exist");
    }
    throw error;
  });
  if (canonical !== expected.path) {
    invalid("HOST_REGISTRATION_ANCHOR_PATH", "host registration anchor must be one canonical real path");
  }
  const before = await lstat(canonical, { bigint: true });
  requireRegistrationDirectory(before, "host registration anchor");
  if (!matchesDirectory(before, expected)) {
    invalid("HOST_REGISTRATION_ANCHOR_IDENTITY", "host registration anchor does not match trusted configuration");
  }
  const handle = await openChecked(
    canonical,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    "HOST_REGISTRATION_ANCHOR_CHANGED",
    "host registration anchor changed while opening",
  );
  try {
    const information = await handle.stat({ bigint: true });
    requireRegistrationDirectory(before, "host registration anchor");
    requireRegistrationDirectory(information, "host registration anchor");
    if (!sameIdentity(before, information) || !matchesDirectory(information, expected)) {
      invalid("HOST_REGISTRATION_ANCHOR_IDENTITY", "host registration anchor does not match trusted configuration");
    }
    return Object.freeze({
      handle,
      path: canonical,
      information,
      async verify(): Promise<void> {
        const [visible, actual, resolved] = await Promise.all([
          lstat(canonical, { bigint: true }),
          handle.stat({ bigint: true }),
          realpath(canonical),
        ]);
        requireRegistrationDirectory(visible, "host registration anchor");
        requireRegistrationDirectory(actual, "host registration anchor");
        if (!sameIdentity(information, visible) || !sameIdentity(information, actual) ||
            resolved !== canonical || !matchesDirectory(actual, expected)) {
          invalid("HOST_REGISTRATION_ANCHOR_CHANGED", "host registration anchor changed during observation");
        }
      },
    });
  } catch (error) {
    return rethrowAfterClose(handle, error, "host registration anchor did not close");
  }
}

function normalizeObservationInput(value: unknown): Readonly<{
  readonly registrationAnchor: PrivatePythonLinuxHostRegistrationAnchor;
  readonly registrationName: string;
  readonly expectedRegistrationDigest: string;
}> {
  const input = snapshotDataRecord(value, [
    "expectedRegistrationDigest",
    "registrationAnchor",
    "registrationName",
  ], "host registration observation");
  const registrationName = input.registrationName;
  if (typeof registrationName !== "string" || !REGISTRATION_NAME.test(registrationName)) {
    invalid("HOST_REGISTRATION_NAME", "host registration name must be one bounded path component");
  }
  return Object.freeze({
    registrationAnchor: normalizeAnchor(input.registrationAnchor),
    registrationName,
    expectedRegistrationDigest: requireDigest(
      input.expectedRegistrationDigest as JsonValue,
      "expected host registration",
    ),
  });
}

async function openRegistrationRoot(
  anchor: ProtectedDirectory,
  name: string,
): Promise<ProtectedDirectory> {
  if (typeof name !== "string" || !REGISTRATION_NAME.test(name)) {
    invalid("HOST_REGISTRATION_NAME", "host registration name must be one bounded path component");
  }
  const descriptor = childDescriptor(anchor, name);
  const visiblePath = join(anchor.path, name);
  let before: BigIntStats;
  try {
    before = await lstat(descriptor, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) unavailable("HOST_REGISTRATION_MISSING", "host registration root does not exist");
    throw error;
  }
  requireRegistrationDirectory(before, "host registration root", anchor.information.dev);
  const handle = await openChecked(
    descriptor,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    "HOST_REGISTRATION_CHANGED",
    "host registration root changed while opening",
  );
  try {
    const [actual, visible, resolved] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(visiblePath, { bigint: true }),
      realpath(visiblePath),
    ]);
    requireRegistrationDirectory(before, "host registration root", anchor.information.dev);
    requireRegistrationDirectory(actual, "host registration root", anchor.information.dev);
    requireRegistrationDirectory(visible, "host registration root", anchor.information.dev);
    if (!sameIdentity(before, actual) || !sameIdentity(before, visible) || resolved !== visiblePath) {
      invalid("HOST_REGISTRATION_CHANGED", "host registration root changed while opening");
    }
    return Object.freeze({
      handle,
      path: visiblePath,
      information: actual,
      async verify(): Promise<void> {
        await anchor.verify();
        const [descriptorCurrent, visibleCurrent, handleCurrent, currentResolved] = await Promise.all([
          lstat(descriptor, { bigint: true }),
          lstat(visiblePath, { bigint: true }),
          handle.stat({ bigint: true }),
          realpath(visiblePath),
        ]);
        requireRegistrationDirectory(descriptorCurrent, "host registration root", anchor.information.dev);
        requireRegistrationDirectory(visibleCurrent, "host registration root", anchor.information.dev);
        requireRegistrationDirectory(handleCurrent, "host registration root", anchor.information.dev);
        if (!sameIdentity(actual, descriptorCurrent) || !sameIdentity(actual, visibleCurrent) ||
            !sameIdentity(actual, handleCurrent) || currentResolved !== visiblePath) {
          invalid("HOST_REGISTRATION_CHANGED", "host registration root changed during observation");
        }
      },
    });
  } catch (error) {
    return rethrowAfterClose(handle, error, "host registration root did not close");
  }
}

async function openRegistrationFile(root: ProtectedDirectory): Promise<ProtectedRegistrationFile> {
  const descriptor = childDescriptor(root, REGISTRATION_FILE);
  const visiblePath = join(root.path, REGISTRATION_FILE);
  let before: BigIntStats;
  try {
    before = await lstat(descriptor, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) unavailable("HOST_REGISTRATION_MISSING", "host registration file does not exist");
    throw error;
  }
  requireRegistrationFile(before, root.information.dev);
  const handle = await openChecked(
    descriptor,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    "HOST_REGISTRATION_CHANGED",
    "host registration file changed while opening",
  );
  try {
    const [actual, visible] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(visiblePath, { bigint: true }),
    ]);
    requireRegistrationFile(before, root.information.dev);
    requireRegistrationFile(actual, root.information.dev);
    requireRegistrationFile(visible, root.information.dev);
    if (!sameIdentity(before, actual) || !sameIdentity(before, visible)) {
      invalid("HOST_REGISTRATION_CHANGED", "host registration file changed while opening");
    }
    const bytes = await readExactFile(handle, actual);
    const file: ProtectedRegistrationFile = Object.freeze({
      handle,
      path: visiblePath,
      information: actual,
      bytes,
      async verify(): Promise<void> {
        await root.verify();
        const [descriptorCurrent, visibleCurrent, handleCurrent] = await Promise.all([
          lstat(descriptor, { bigint: true }),
          lstat(visiblePath, { bigint: true }),
          handle.stat({ bigint: true }),
        ]);
        requireRegistrationFile(descriptorCurrent, root.information.dev);
        requireRegistrationFile(visibleCurrent, root.information.dev);
        requireRegistrationFile(handleCurrent, root.information.dev);
        if (!sameIdentity(actual, descriptorCurrent) || !sameIdentity(actual, visibleCurrent) ||
            !sameIdentity(actual, handleCurrent) ||
            !sameBytes(bytes, await readExactFile(handle, handleCurrent))) {
          invalid("HOST_REGISTRATION_CHANGED", "host registration file changed during observation");
        }
      },
    });
    return file;
  } catch (error) {
    return rethrowAfterClose(handle, error, "host registration file did not close");
  }
}

async function openRegisteredState(
  root: ProtectedDirectory,
  expected: PrivatePythonLinuxStateRootIdentity,
): Promise<ProtectedDirectory> {
  const descriptor = childDescriptor(root, STATE_DIRECTORY);
  const before = await lstat(descriptor, { bigint: true }).catch((error) => {
    if (hasCode(error, "ENOENT")) unavailable("HOST_REGISTRATION_STATE_MISSING", "registered state root does not exist");
    throw error;
  });
  requireStateDirectory(before, root.information.dev);
  const handle = await openChecked(
    descriptor,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    "HOST_REGISTRATION_STATE_CHANGED",
    "registered state root changed while opening",
  );
  try {
    const [actual, visible, resolved] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(expected.path, { bigint: true }),
      realpath(expected.path),
    ]);
    requireStateDirectory(before, root.information.dev);
    requireStateDirectory(actual, root.information.dev);
    requireStateDirectory(visible, root.information.dev);
    if (!sameIdentity(before, actual) || !sameIdentity(before, visible) ||
        resolved !== expected.path || !matchesStateRoot(actual, expected)) {
      invalid("HOST_REGISTRATION_STATE_IDENTITY", "registered state root identity does not match policy");
    }
    return Object.freeze({
      handle,
      path: expected.path,
      information: actual,
      async verify(): Promise<void> {
        await root.verify();
        const [descriptorCurrent, visibleCurrent, handleCurrent, currentResolved] = await Promise.all([
          lstat(descriptor, { bigint: true }),
          lstat(expected.path, { bigint: true }),
          handle.stat({ bigint: true }),
          realpath(expected.path),
        ]);
        requireStateDirectory(descriptorCurrent, root.information.dev);
        requireStateDirectory(visibleCurrent, root.information.dev);
        requireStateDirectory(handleCurrent, root.information.dev);
        if (!sameIdentity(actual, descriptorCurrent) || !sameIdentity(actual, visibleCurrent) ||
            !sameIdentity(actual, handleCurrent) || currentResolved !== expected.path ||
            !matchesStateRoot(handleCurrent, expected)) {
          invalid("HOST_REGISTRATION_STATE_CHANGED", "registered state root changed during observation");
        }
      },
    });
  } catch (error) {
    return rethrowAfterClose(handle, error, "registered state root did not close");
  }
}

async function openChecked(
  path: string,
  flags: number,
  diagnostic: string,
  message: string,
): Promise<FileHandle> {
  try {
    return await open(path, flags);
  } catch (error) {
    if (["EACCES", "EISDIR", "ELOOP", "ENOENT", "ENOTDIR", "ENXIO"].some((code) => hasCode(error, code))) {
      invalid(diagnostic, message);
    }
    throw error;
  }
}

async function rethrowAfterClose(
  handle: FileHandle,
  failure: unknown,
  message: string,
): Promise<never> {
  try {
    await handle.close();
  } catch (cleanupFailure) {
    throw new AggregateError([failure, cleanupFailure], message);
  }
  throw failure;
}

async function verifyAll(
  root: ProtectedDirectory,
  registration: ProtectedRegistrationFile,
  state: ProtectedDirectory,
): Promise<void> {
  await root.verify();
  await requireExactEntries(root);
  await registration.verify();
  await state.verify();
}

async function requireExactEntries(root: ProtectedDirectory): Promise<void> {
  const entries = (await readdir(`/proc/self/fd/${root.handle.fd}`)).sort(compareText);
  if (entries.length !== 2 || entries[0] !== REGISTRATION_FILE || entries[1] !== STATE_DIRECTORY) {
    invalid("HOST_REGISTRATION_ENTRIES", "host registration root has unexpected or missing entries");
  }
}

function decodeRegistration(bytes: Uint8Array): PrivatePythonLinuxHostRegistrationRecord {
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_REGISTRATION_BYTES || bytes.at(-1) !== 0x0a) {
    invalid("HOST_REGISTRATION_FORMAT", "host registration must be bounded canonical JSON/1 plus LF");
  }
  const source = bytes.subarray(0, -1);
  let value: JsonValue;
  try {
    value = decodeJson1(source);
  } catch (error) {
    invalid("HOST_REGISTRATION_FORMAT", `host registration is not JSON/1: ${errorText(error)}`);
  }
  if (!sameBytes(canonicalJson(value), source)) {
    invalid("HOST_REGISTRATION_FORMAT", "host registration is not canonically encoded");
  }
  const root = requireObject(value, "host registration");
  requireKeys(root, ["digest", "generationDigest", "kind", "stateRoot"], "host registration");
  if (root.kind !== "python-linux-host-registration/1") {
    invalid("HOST_REGISTRATION_KIND", "host registration kind is unsupported");
  }
  const generationDigest = requireDigest(root.generationDigest!, "registered generation");
  const stateValue = requireObject(root.stateRoot!, "registered state root");
  requireKeys(stateValue, ["device", "inode", "ownerUid", "path"], "registered state root");
  const stateRoot = Object.freeze({
    path: requireCanonicalAbsolutePath(stateValue.path!, "registered state root"),
    device: requireDecimal(stateValue.device!, "registered state device", false, UINT64_MAX),
    inode: requireDecimal(stateValue.inode!, "registered state inode", false, UINT64_MAX),
    ownerUid: requireDecimal(stateValue.ownerUid!, "registered state owner", true, UID_MAX),
  });
  const identity = Object.freeze({
    kind: "python-linux-host-registration/1" as const,
    generationDigest,
    stateRoot,
  });
  const digest = privateDomainDigest(
    "JIG-Python-Linux-Host-Registration/1",
    identity as unknown as JsonValue,
  );
  if (root.digest !== digest) {
    invalid("HOST_REGISTRATION_DIGEST", "host registration digest does not match its value");
  }
  return Object.freeze({ ...identity, digest });
}

function requireRegistrationDirectory(
  information: BigIntStats,
  label: string,
  expectedDevice?: bigint,
): void {
  if (!information.isDirectory() || information.isSymbolicLink() || information.uid !== 0n ||
      (information.mode & 0o7777n) !== 0o755n ||
      (expectedDevice !== undefined && information.dev !== expectedDevice)) {
    invalid("HOST_REGISTRATION_PERMISSIONS", `${label} must be a root-owned mode 0755 directory`);
  }
}

function requireRegistrationFile(information: BigIntStats, device: bigint): void {
  if (!information.isFile() || information.isSymbolicLink() || information.uid !== 0n ||
      information.nlink !== 1n || (information.mode & 0o7777n) !== 0o444n ||
      information.dev !== device || information.size < 2n ||
      information.size > BigInt(MAX_REGISTRATION_BYTES)) {
    invalid("HOST_REGISTRATION_FILE", "host registration must be one root-owned mode 0444 bounded regular file");
  }
}

function requireStateDirectory(information: BigIntStats, device: bigint): void {
  const expectedUid = BigInt(currentEuid());
  if (!information.isDirectory() || information.isSymbolicLink() ||
      information.uid !== expectedUid || (information.mode & 0o7777n) !== 0o700n ||
      information.dev !== device) {
    invalid("HOST_REGISTRATION_STATE_PERMISSIONS", "registered state root must be one owner-only mode 0700 directory");
  }
}

async function readExactFile(handle: FileHandle, information: BigIntStats): Promise<Uint8Array> {
  const size = Number(information.size);
  if (!Number.isSafeInteger(size) || size < 2 || size > MAX_REGISTRATION_BYTES) {
    invalid("HOST_REGISTRATION_FILE", "host registration file size is outside its bound");
  }
  const bytes = Buffer.alloc(size);
  const { bytesRead } = await handle.read(bytes, 0, size, 0);
  if (bytesRead !== size) invalid("HOST_REGISTRATION_CHANGED", "host registration changed while reading");
  return Uint8Array.from(bytes);
}

function directoryIdentity(directory: ProtectedDirectory): Readonly<{
  readonly path: string;
  readonly device: string;
  readonly inode: string;
}> {
  return Object.freeze({
    path: directory.path,
    device: directory.information.dev.toString(10),
    inode: directory.information.ino.toString(10),
  });
}

function fileIdentity(file: ProtectedRegistrationFile): Readonly<{
  readonly path: string;
  readonly device: string;
  readonly inode: string;
}> {
  return Object.freeze({
    path: file.path,
    device: file.information.dev.toString(10),
    inode: file.information.ino.toString(10),
  });
}

function matchesStateRoot(
  information: BigIntStats,
  expected: PrivatePythonLinuxStateRootIdentity,
): boolean {
  return information.dev.toString(10) === expected.device &&
    information.ino.toString(10) === expected.inode &&
    information.uid.toString(10) === expected.ownerUid;
}

function normalizeAnchor(
  value: unknown,
): PrivatePythonLinuxHostRegistrationAnchor {
  const input = snapshotDataRecord(
    value,
    ["device", "inode", "path"],
    "host registration anchor",
  );
  return Object.freeze({
    path: requireCanonicalAbsolutePath(input.path as JsonValue, "host registration anchor"),
    device: requireDecimal(input.device as JsonValue, "host registration anchor device", false, UINT64_MAX),
    inode: requireDecimal(input.inode as JsonValue, "host registration anchor inode", false, UINT64_MAX),
  });
}

function snapshotDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid("HOST_REGISTRATION_INPUT", `${label} must be one plain data object`);
  }
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    invalid("HOST_REGISTRATION_INPUT", `${label} properties could not be inspected`);
  }
  const propertyKeys = Reflect.ownKeys(descriptors);
  if (propertyKeys.some((key) => typeof key !== "string")) {
    invalid("HOST_REGISTRATION_INPUT", `${label} has unknown or missing fields`);
  }
  const keys = (propertyKeys as string[]).sort(compareText);
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    invalid("HOST_REGISTRATION_INPUT", `${label} has unknown or missing fields`);
  }
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || descriptor.enumerable !== true) {
      invalid("HOST_REGISTRATION_INPUT", `${label}.${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function matchesDirectory(
  information: BigIntStats,
  expected: PrivatePythonLinuxHostRegistrationAnchor,
): boolean {
  return information.dev.toString(10) === expected.device &&
    information.ino.toString(10) === expected.inode;
}

function sameStateRoot(
  left: PrivatePythonLinuxStateRootIdentity,
  right: PrivatePythonLinuxStateRootIdentity,
): boolean {
  return left.path === right.path && left.device === right.device &&
    left.inode === right.inode && left.ownerUid === right.ownerUid;
}

function childDescriptor(root: ProtectedDirectory, name: string): string {
  return `/proc/self/fd/${root.handle.fd}/${name}`;
}

function requireObject(value: JsonValue, label: string): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid("HOST_REGISTRATION_FORMAT", `${label} must be an object`);
  }
  return value as Readonly<Record<string, JsonValue>>;
}

function requireKeys(
  value: Readonly<Record<string, JsonValue>>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value).sort(compareText);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    invalid("HOST_REGISTRATION_FORMAT", `${label} has unknown or missing fields`);
  }
}

function requireDigest(value: JsonValue, label: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    invalid("HOST_REGISTRATION_FORMAT", `${label} must be one SHA-256 digest`);
  }
  return value;
}

function requireCanonicalAbsolutePath(value: JsonValue, label: string): string;
function requireCanonicalAbsolutePath(value: string, label: string): string;
function requireCanonicalAbsolutePath(value: JsonValue | string, label: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || resolve(value) !== value ||
      /[\u0000\r\n]/u.test(value)) {
    invalid("HOST_REGISTRATION_FORMAT", `${label} must be a canonical absolute single-line path`);
  }
  return value;
}

function requireDecimal(
  value: JsonValue,
  label: string,
  allowZero: boolean,
  maximum: bigint,
): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    invalid("HOST_REGISTRATION_FORMAT", `${label} must be one canonical unsigned decimal string`);
  }
  const number = BigInt(value);
  if ((!allowZero && number === 0n) || number > maximum) {
    invalid("HOST_REGISTRATION_FORMAT", `${label} is outside its supported range`);
  }
  return value;
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    left.uid === right.uid && left.gid === right.gid && left.nlink === right.nlink &&
    left.size === right.size;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function currentEuid(): number {
  const value = process.geteuid?.();
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
    unavailable("HOST_REGISTRATION_PLATFORM", "effective user identity is unavailable");
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" &&
    (error as { readonly code?: unknown }).code === code;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
