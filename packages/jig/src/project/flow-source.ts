import { constants, type BigIntStats } from "node:fs";
import { type FileHandle, lstat, open, opendir } from "node:fs/promises";

import { CheckError, invalid, unavailable } from "../diagnostics.js";
import {
  captureOpenedPackageDirectory,
  type CapturedPackage,
} from "../package/capture.js";
import {
  inspectCapturedPackage,
  type InspectedPackage,
} from "../package/inspect.js";
import { SchemaDiagnostic } from "../schema/index.js";
import type { ProjectSource } from "./author.js";
import {
  assertNoProjectPathCollisions,
  compareProjectPaths,
  isProtectedProjectPath,
  validateProjectPath,
} from "./paths.js";
import {
  openPrivateProjectRoot,
  requirePrivateProjectRoot,
  type PrivateProjectRoot,
} from "./root.js";

const CAPTURE_ATTEMPTS = 3;
const MAX_MEMBERS = 65_536;
const MAX_ROOT_ENTRIES = 262_144;
const MAX_ROOT_NAME_BYTES = 16 * 1024 * 1024;
const GLOB_CHARACTERS = /[*?\[\]{}]/;
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface FlowMemberProvenance {
  readonly membership: "discovered" | "exact";
  readonly projectPath: string;
  readonly configuredRoot?: string;
}

export interface CapturedFlowMember {
  readonly provenance: FlowMemberProvenance;
  readonly captured: CapturedPackage;
  readonly inspected: InspectedPackage;
}

export interface FlowDiscoveryObservation {
  readonly kind: "discover";
  readonly root: string;
  readonly state: "missing" | "captured";
  readonly members: readonly string[];
}

export interface FlowExactObservation {
  readonly kind: "members";
  readonly members: readonly string[];
}

export interface CapturedFlowSource {
  readonly observations: readonly (FlowDiscoveryObservation | FlowExactObservation)[];
  readonly members: readonly CapturedFlowMember[];
  dispose(): Promise<void>;
}

export interface DirectRunTargetCandidate {
  readonly kind: "flow";
  readonly path: string;
  readonly packageDigest: string;
}

interface OpenDirectory {
  readonly handle: FileHandle;
  readonly information: BigIntStats;
}

interface DiscoveryFingerprint {
  readonly rootIdentity: string;
  readonly records: readonly string[];
  readonly selectedNames: readonly string[];
  readonly selectedIdentities: ReadonlyMap<string, string>;
}

interface DiscoveryObservation {
  readonly root: string;
  readonly fingerprint?: DiscoveryFingerprint;
}

interface ExactObservation {
  readonly path: string;
  readonly identity: string;
}

/**
 * Capture one already-normalized Flow source beneath an opened project root.
 * This private checkpoint is invocation-local; callers own `dispose()`.
 */
export async function captureFlowSource(
  projectRoot: string,
  source?: ProjectSource,
): Promise<CapturedFlowSource> {
  const normalized = validateSource(source);
  const project = await openPrivateProjectRoot(projectRoot);
  try {
    return await captureOpenedFlowSource(project, normalized);
  } finally {
    await project.dispose();
  }
}

/** Capture a Flow source beneath a borrowed private project-root descriptor. */
export async function captureOpenedFlowSource(
  projectRoot: PrivateProjectRoot,
  source?: ProjectSource,
): Promise<CapturedFlowSource> {
  const project = requirePrivateProjectRoot(projectRoot);
  const normalized = validateSource(source);
  if (normalized === undefined) return createSource([], []);
  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt += 1) {
    const captured: CapturedFlowMember[] = [];
    try {
      const observations = normalized.kind === "discover"
        ? await captureDiscovered(project, normalized.roots, captured)
        : await captureExact(project, normalized.paths, captured);
      await project.verify();
      captured.sort((left, right) => compareProjectPaths(
        left.provenance.projectPath,
        right.provenance.projectPath,
      ));
      assertUniqueMembers(captured);
      return createSource(observations, captured);
    } catch (error) {
      await disposeMembers(captured);
      if (isSourceChange(error) && attempt < CAPTURE_ATTEMPTS) continue;
      if (isSourceChange(error)) {
        unavailable(
          "PROJECT_SOURCE_CHANGED",
          `project Flow source kept changing during ${CAPTURE_ATTEMPTS} capture attempts`,
          project.requestedPath,
        );
      }
      throw error;
    }
  }
  throw new Error("unreachable Flow-source capture attempt state");
}

export function deriveDirectRunTargetCandidates(
  source: CapturedFlowSource,
): readonly DirectRunTargetCandidate[] {
  return Object.freeze(source.members.flatMap((member) => {
    if (!isDirectRunEligible(member.inspected)) return [];
    return [Object.freeze({
      kind: "flow" as const,
      path: member.provenance.projectPath,
      packageDigest: member.captured.digest,
    })];
  }));
}

async function captureDiscovered(
  project: OpenDirectory & { readonly requestedPath: string },
  roots: readonly string[],
  captured: CapturedFlowMember[],
): Promise<readonly FlowDiscoveryObservation[]> {
  const observations: DiscoveryObservation[] = [];
  const physicalRoots = new Map<string, string>();
  const physicalMembers = new Map<string, string>();
  for (const root of roots) {
    const directory = await openProjectDirectory(project.handle, root, true);
    if (directory === undefined) {
      observations.push({ root });
      continue;
    }
    try {
      const fingerprint = await fingerprintDiscoveryRoot(directory);
      const rootIdentity = fingerprint.rootIdentity;
      const priorRoot = physicalRoots.get(rootIdentity);
      if (priorRoot !== undefined) {
        invalid(
          "PROJECT_SOURCE_COLLISION",
          `Flow discovery roots ${priorRoot} and ${root} name one physical directory`,
          root,
        );
      }
      physicalRoots.set(rootIdentity, root);
      observations.push({ root, fingerprint });
      for (const name of fingerprint.selectedNames) {
        if (captured.length >= MAX_MEMBERS) {
          invalid("PROJECT_SOURCE_LIMIT", `Flow source exceeds ${MAX_MEMBERS} members`, root);
        }
        const projectPath = `${root}/${name}`;
        validateProjectSourcePath(projectPath);
        const member = await openSelectedMember(
          directory.handle,
          name,
          projectPath,
          fingerprint,
        );
        try {
          const identity = identityKey(member.information);
          const prior = physicalMembers.get(identity);
          if (prior !== undefined) {
            invalid(
              "PROJECT_MEMBER_COLLISION",
              `Flow members ${prior} and ${projectPath} name one physical directory`,
              projectPath,
            );
          }
          physicalMembers.set(identity, projectPath);
          captured.push(await captureMember(member.handle, {
            membership: "discovered",
            configuredRoot: root,
            projectPath,
          }));
        } finally {
          await member.handle.close().catch(() => undefined);
        }
      }
    } finally {
      await directory.handle.close().catch(() => undefined);
    }
  }

  assertUniqueMembers(captured);
  for (const observation of observations) {
    await verifyDiscoveryObservation(project.handle, observation);
  }
  return Object.freeze(observations.map((observation) => Object.freeze({
    kind: "discover" as const,
    root: observation.root,
    state: observation.fingerprint === undefined ? "missing" as const : "captured" as const,
    members: Object.freeze((observation.fingerprint?.selectedNames ?? []).map(
      (name) => `${observation.root}/${name}`,
    )),
  })));
}

async function captureExact(
  project: OpenDirectory & { readonly requestedPath: string },
  paths: readonly string[],
  captured: CapturedFlowMember[],
): Promise<readonly FlowExactObservation[]> {
  const physicalMembers = new Map<string, string>();
  const observations: ExactObservation[] = [];
  for (const projectPath of paths) {
    const member = await openProjectDirectory(project.handle, projectPath, false);
    if (member === undefined) throw new Error("unreachable strict project member state");
    try {
      const identity = identityKey(member.information);
      const prior = physicalMembers.get(identity);
      if (prior !== undefined) {
        invalid(
          "PROJECT_MEMBER_COLLISION",
          `Flow members ${prior} and ${projectPath} name one physical directory`,
          projectPath,
        );
      }
      physicalMembers.set(identity, projectPath);
      observations.push({ path: projectPath, identity });
      captured.push(await captureMember(member.handle, {
        membership: "exact",
        projectPath,
      }));
    } finally {
      await member.handle.close().catch(() => undefined);
    }
  }
  assertUniqueMembers(captured);
  for (const observation of observations) {
    const current = await reopenObservedDirectory(project.handle, observation.path);
    if (current === undefined) sourceChanged("exact Flow member disappeared during capture", observation.path);
    try {
      if (identityKey(current.information) !== observation.identity) {
        sourceChanged("exact Flow member changed identity during capture", observation.path);
      }
    } finally {
      await current.handle.close().catch(() => undefined);
    }
  }
  return [Object.freeze({ kind: "members", members: Object.freeze([...paths]) })];
}

async function captureMember(
  handle: FileHandle,
  provenance: FlowMemberProvenance,
): Promise<CapturedFlowMember> {
  const captured = await captureOpenedPackageDirectory(provenance.projectPath, handle);
  try {
    const inspected = await inspectCapturedPackage(captured);
    return Object.freeze({ provenance: Object.freeze(provenance), captured, inspected });
  } catch (error) {
    await captured.dispose();
    throw error;
  }
}

async function openProjectDirectory(
  project: FileHandle,
  projectPath: string,
  missingAllowed: boolean,
): Promise<OpenDirectory | undefined> {
  validateProjectSourcePath(projectPath);
  let parent = project;
  let ownedParent: FileHandle | undefined;
  try {
    const segments = projectPath.split("/");
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]!;
      const currentPath = segments.slice(0, index + 1).join("/");
      const opened = await openChildDirectory(parent, segment, currentPath, missingAllowed);
      if (opened === undefined) return undefined;
      await ownedParent?.close().catch(() => undefined);
      ownedParent = opened.handle;
      parent = opened.handle;
      if (index === segments.length - 1) {
        ownedParent = undefined;
        return opened;
      }
    }
  } finally {
    await ownedParent?.close().catch(() => undefined);
  }
  throw new Error("unreachable project path traversal state");
}

async function openChildDirectory(
  parent: FileHandle,
  name: string,
  logicalPath: string,
  missingAllowed = false,
): Promise<OpenDirectory | undefined> {
  const descriptorPath = `/proc/self/fd/${parent.fd}/${name}`;
  let observed: BigIntStats;
  try {
    observed = await lstat(descriptorPath, { bigint: true });
  } catch (error) {
    if (missingAllowed && isMissing(error)) return undefined;
    if (isMissing(error)) invalid("PROJECT_MEMBER_MISSING", `project path is missing: ${logicalPath}`, logicalPath);
    unavailable("PROJECT_SOURCE_IO", `cannot inspect project path: ${errorText(error)}`, logicalPath);
  }
  if (observed.isSymbolicLink()) invalid("PROJECT_SOURCE_SYMLINK", "project source paths cannot contain symlinks", logicalPath);
  if (!observed.isDirectory()) invalid("PROJECT_MEMBER_KIND", "Flow source member must be a directory", logicalPath);

  let handle: FileHandle;
  try {
    handle = await open(
      descriptorPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (missingAllowed && isMissing(error)) return undefined;
    if (isEntryRace(error)) sourceChanged("project directory changed while it was opened", logicalPath);
    unavailable("PROJECT_SOURCE_IO", `cannot open project directory: ${errorText(error)}`, logicalPath);
  }
  try {
    const information = await handle.stat({ bigint: true });
    if (!information.isDirectory() || !sameIdentity(observed, information)) {
      sourceChanged("project directory changed while it was opened", logicalPath);
    }
    return { handle, information };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function openSelectedMember(
  root: FileHandle,
  name: string,
  projectPath: string,
  fingerprint: DiscoveryFingerprint,
): Promise<OpenDirectory> {
  let member: OpenDirectory | undefined;
  try {
    member = await openChildDirectory(root, name, projectPath);
  } catch (error) {
    if (error instanceof CheckError && [
      "PROJECT_MEMBER_MISSING",
      "PROJECT_MEMBER_KIND",
      "PROJECT_SOURCE_SYMLINK",
    ].includes(error.code)) {
      sourceChanged("selected Flow member changed before capture", projectPath);
    }
    throw error;
  }
  if (member === undefined) throw new Error("unreachable selected member state");
  const expected = fingerprint.selectedIdentities.get(name);
  if (expected === undefined) {
    await member.handle.close().catch(() => undefined);
    throw new Error("selected Flow member has no fingerprint identity");
  }
  if (identityKey(member.information) !== expected) {
    await member.handle.close().catch(() => undefined);
    sourceChanged("selected Flow member changed identity before capture", projectPath);
  }
  return member;
}

async function fingerprintDiscoveryRoot(directory: OpenDirectory): Promise<DiscoveryFingerprint> {
  const records: string[] = [];
  const selectedNames: string[] = [];
  const selectedIdentities = new Map<string, string>();
  for await (const name of readDirectoryNames(directory.handle)) {
    const descriptorPath = `/proc/self/fd/${directory.handle.fd}/${name}`;
    let information: BigIntStats;
    try {
      information = await lstat(descriptorPath, { bigint: true });
    } catch (error) {
      if (isEntryRace(error)) sourceChanged("Flow discovery entry changed during inspection", name);
      unavailable("PROJECT_SOURCE_IO", `cannot inspect Flow discovery entry: ${errorText(error)}`, name);
    }
    if (!information.isDirectory()) continue;
    const child = await openChildDirectory(directory.handle, name, name);
    if (child === undefined) throw new Error("unreachable discovered directory state");
    try {
      const flow = await flowMarker(child.handle, name);
      if (flow.selected) {
        selectedNames.push(name);
        selectedIdentities.set(name, identityKey(child.information));
        records.push(`${name}\0${identityKey(child.information)}\0${flow.fingerprint}`);
      }
    } finally {
      await child.handle.close().catch(() => undefined);
    }
  }
  records.sort(compareProjectPaths);
  selectedNames.sort(compareProjectPaths);
  return {
    rootIdentity: identityKey(directory.information),
    records: Object.freeze(records),
    selectedNames: Object.freeze(selectedNames),
    selectedIdentities,
  };
}

async function flowMarker(
  directory: FileHandle,
  logicalPath: string,
): Promise<{ readonly selected: boolean; readonly fingerprint: string }> {
  const path = `/proc/self/fd/${directory.fd}/FLOW.md`;
  let information: BigIntStats;
  try {
    information = await lstat(path, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return { selected: false, fingerprint: "missing" };
    if (isEntryRace(error)) sourceChanged("FLOW.md changed during discovery", `${logicalPath}/FLOW.md`);
    unavailable("PROJECT_SOURCE_IO", `cannot inspect FLOW.md: ${errorText(error)}`, `${logicalPath}/FLOW.md`);
  }
  if (information.isSymbolicLink()) return { selected: false, fingerprint: "symlink" };
  if (!information.isFile()) return { selected: false, fingerprint: "non-file" };
  return { selected: true, fingerprint: statFingerprint(information) };
}

async function verifyDiscoveryObservation(
  project: FileHandle,
  observation: DiscoveryObservation,
): Promise<void> {
  const current = await reopenObservedDirectory(project, observation.root);
  if (observation.fingerprint === undefined) {
    if (current !== undefined) {
      await current.handle.close().catch(() => undefined);
      sourceChanged("missing discovery root appeared during capture", observation.root);
    }
    return;
  }
  if (current === undefined) sourceChanged("discovery root disappeared during capture", observation.root);
  try {
    if (observation.fingerprint.rootIdentity !== identityKey(current.information)) {
      sourceChanged("discovery root changed identity during capture", observation.root);
    }
    const fingerprint = await fingerprintDiscoveryRoot(current);
    if (!sameDiscoveryFingerprint(observation.fingerprint!, fingerprint)) {
      sourceChanged("discovery root changed during capture", observation.root);
    }
  } finally {
    await current.handle.close().catch(() => undefined);
  }
}

async function reopenObservedDirectory(
  project: FileHandle,
  projectPath: string,
): Promise<OpenDirectory | undefined> {
  try {
    return await openProjectDirectory(project, projectPath, true);
  } catch (error) {
    if (error instanceof CheckError && [
      "PROJECT_MEMBER_KIND",
      "PROJECT_SOURCE_SYMLINK",
    ].includes(error.code)) {
      sourceChanged("observed project directory changed during capture", projectPath);
    }
    throw error;
  }
}

async function* readDirectoryNames(directory: FileHandle): AsyncIterable<string> {
  let stream: RawDirectory;
  try {
    const openRawDirectory = opendir as unknown as (
      path: string,
      options: { readonly encoding: "buffer" },
    ) => Promise<RawDirectory>;
    stream = await openRawDirectory(`/proc/self/fd/${directory.fd}`, { encoding: "buffer" });
  } catch (error) {
    unavailable("PROJECT_SOURCE_IO", `cannot enumerate Flow source: ${errorText(error)}`);
  }
  let count = 0;
  let nameBytes = 0;
  try {
    while (true) {
      let entry: unknown;
      try {
        entry = await stream.read();
      } catch (error) {
        unavailable("PROJECT_SOURCE_IO", `cannot enumerate Flow source: ${errorText(error)}`);
      }
      if (entry === null) return;
      const rawName = directoryEntryName(entry);
      count += 1;
      nameBytes += rawName.byteLength;
      if (count > MAX_ROOT_ENTRIES || nameBytes > MAX_ROOT_NAME_BYTES) {
        unavailable("PROJECT_SOURCE_LIMIT", "Flow discovery root exceeds its enumeration budget");
      }
      try {
        yield decoder.decode(rawName);
      } catch {
        invalid("PROJECT_SOURCE_PATH", "Flow discovery entry name is not valid UTF-8");
      }
    }
  } finally {
    try {
      await stream.close();
    } catch (error) {
      if (!isDirectoryAlreadyClosed(error)) throw error;
    }
  }
}

function validateSource(source?: ProjectSource): ProjectSource | undefined {
  if (source === undefined) return undefined;
  if (source.kind === "discover") {
    if (!Array.isArray(source.roots) || source.roots.length === 0) {
      invalid("PROJECT_SOURCE", "Flow discovery requires at least one root");
    }
    const roots = [...source.roots];
    for (const root of roots) {
      if (typeof root !== "string") invalid("PROJECT_SOURCE", "Flow discovery roots must be strings");
      validateProjectSourcePath(root);
      if (GLOB_CHARACTERS.test(root)) invalid("PROJECT_SOURCE", "Flow discovery roots cannot contain glob characters", root);
    }
    roots.sort(compareProjectPaths);
    assertProjectPathCollisions(roots);
    return Object.freeze({ kind: "discover", roots: Object.freeze(roots) });
  }
  if (source.kind === "members") {
    if (!Array.isArray(source.paths)) invalid("PROJECT_SOURCE", "Flow exact source requires a path array");
    const paths = [...source.paths];
    for (const path of paths) {
      if (typeof path !== "string") invalid("PROJECT_SOURCE", "Flow exact members must be strings");
      validateProjectSourcePath(path);
    }
    paths.sort(compareProjectPaths);
    assertProjectPathCollisions(paths);
    return Object.freeze({ kind: "members", paths: Object.freeze(paths) });
  }
  invalid("PROJECT_SOURCE", "unknown Flow source kind");
}

function validateProjectSourcePath(path: string): void {
  try {
    validateProjectPath(path, "project source path");
  } catch (error) {
    invalid("PROJECT_SOURCE_PATH", errorText(error), path);
  }
  if (isProtectedProjectPath(path)) {
    invalid("PROJECT_SOURCE_PROTECTED", "project source cannot use protected .jig state", path);
  }
}

function assertUniqueMembers(members: readonly CapturedFlowMember[]): void {
  assertProjectPathCollisions(members.map((member) => member.provenance.projectPath));
}

function assertProjectPathCollisions(paths: readonly string[]): void {
  try {
    assertNoProjectPathCollisions(paths, "project source");
  } catch (error) {
    invalid("PROJECT_SOURCE_COLLISION", errorText(error));
  }
}

export function isDirectRunEligible(inspected: InspectedPackage): boolean {
  if (inspected.mode !== "run" || inspected.entrypoint === undefined) return false;
  if (Object.keys(inspected.metadata.uses ?? {}).length > 0) return false;
  if (Object.keys(inspected.metadata.attachments ?? {}).length > 0) return false;
  try {
    inspected.schemas.settings?.validate({}, "DIRECT_SETTINGS_INVALID");
    return true;
  } catch (error) {
    if (error instanceof SchemaDiagnostic && error.code === "DIRECT_SETTINGS_INVALID") return false;
    throw error;
  }
}

function createSource(
  observations: readonly (FlowDiscoveryObservation | FlowExactObservation)[],
  members: readonly CapturedFlowMember[],
): CapturedFlowSource {
  let disposed = false;
  return Object.freeze({
    observations: Object.freeze([...observations]),
    members: Object.freeze([...members]),
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await disposeMembers(members);
    },
  });
}

async function disposeMembers(members: readonly CapturedFlowMember[]): Promise<void> {
  const failures: unknown[] = [];
  for (const member of [...members].reverse()) {
    try {
      await member.captured.dispose();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "cannot dispose captured Flow source");
}

function statFingerprint(information: BigIntStats): string {
  return [
    information.dev,
    information.ino,
    information.nlink,
    information.size,
    information.mtimeNs,
    information.ctimeNs,
    information.mode,
  ].join(":");
}

function sameDiscoveryFingerprint(left: DiscoveryFingerprint, right: DiscoveryFingerprint): boolean {
  return left.rootIdentity === right.rootIdentity &&
    left.records.length === right.records.length &&
    left.records.every((record, index) => record === right.records[index]);
}

function identityKey(value: { readonly dev: bigint; readonly ino: bigint }): string {
  return `${value.dev}:${value.ino}`;
}

function sameIdentity(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sourceChanged(message: string, path?: string): never {
  invalid("PROJECT_SOURCE_CHANGED", message, path);
}

function isSourceChange(error: unknown): error is CheckError {
  return error instanceof CheckError && error.code === "PROJECT_SOURCE_CHANGED";
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    ["ENOENT", "ENOTDIR"].includes(String(error.code));
}

function isEntryRace(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    ["ENOENT", "ELOOP", "ENOTDIR", "EISDIR"].includes(String(error.code));
}

function isDirectoryAlreadyClosed(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    String(error.code) === "ERR_DIR_CLOSED";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface RawDirectory {
  read(): Promise<unknown | null>;
  close(): Promise<void>;
}

function directoryEntryName(entry: unknown): Uint8Array {
  if (entry instanceof Uint8Array) return entry;
  if (typeof entry === "object" && entry !== null && "name" in entry) {
    const name = (entry as { readonly name: unknown }).name;
    if (name instanceof Uint8Array) return name;
  }
  unavailable("PROJECT_SOURCE_UNAVAILABLE", "runtime cannot enumerate raw Flow source names incrementally");
}
