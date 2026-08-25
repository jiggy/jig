import { constants, type BigIntStats } from "node:fs";
import { type FileHandle, lstat, open, opendir } from "node:fs/promises";

import { invalid, unavailable } from "../diagnostics.js";
import { fullCaseFold15_1 } from "../package/paths.js";
import type { ProjectSource } from "./author.js";
import {
  assertNoProjectPathCollisions,
  compareProjectPaths,
  validateProjectPath,
} from "./paths.js";
import { requirePrivateProjectRoot, type PrivateProjectRoot } from "./root.js";

const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GLOB_CHARACTERS = /[*?\[\]{}]/;
const MAX_MEMBERS = 65_536;
const MAX_ROOT_ENTRIES = 262_144;
const MAX_ROOT_NAME_BYTES = 16 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface DeclarationMember {
  readonly id: string;
  readonly projectPath: string;
  readonly membership: "discovered" | "exact";
  readonly configuredRoot?: string;
}

export type DeclarationSourceObservation =
  | {
      readonly kind: "discover";
      readonly root: string;
      readonly state: "missing" | "captured";
      readonly members: readonly string[];
    }
  | {
      readonly kind: "members";
      readonly members: readonly string[];
    };

export interface CapturedDeclarationSource {
  readonly observations: readonly DeclarationSourceObservation[];
  readonly members: readonly DeclarationMember[];
  verify(): Promise<void>;
}

interface OpenDirectory {
  readonly handle: FileHandle;
  readonly information: BigIntStats;
}

interface Fingerprint {
  readonly rootIdentity: string;
  readonly records: readonly string[];
  readonly selectedNames: readonly string[];
}

type PrivateObservation =
  | { readonly kind: "discover"; readonly root: string; readonly fingerprint?: Fingerprint }
  | { readonly kind: "member"; readonly path: string; readonly fingerprint: string };

/** Select shallow TypeScript declarations beneath one borrowed project root. */
export async function captureDeclarationSource(
  projectRoot: PrivateProjectRoot,
  source?: ProjectSource,
): Promise<CapturedDeclarationSource> {
  const project = requirePrivateProjectRoot(projectRoot);
  const normalized = validateSource(source);
  if (normalized === undefined) {
    return Object.freeze({ observations: Object.freeze([]), members: Object.freeze([]), verify: async () => {} });
  }

  const members: DeclarationMember[] = [];
  const privateObservations: PrivateObservation[] = [];
  const observations: DeclarationSourceObservation[] = [];
  if (normalized.kind === "discover") {
    for (const root of normalized.roots) {
      const directory = await openProjectDirectory(project.handle, root, true);
      if (directory === undefined) {
        privateObservations.push({ kind: "discover", root });
        observations.push(Object.freeze({
          kind: "discover" as const,
          root,
          state: "missing" as const,
          members: Object.freeze([]),
        }));
        continue;
      }
      try {
        const fingerprint = await fingerprintRoot(directory, root);
        privateObservations.push({ kind: "discover", root, fingerprint });
        const paths = fingerprint.selectedNames.map((name) => `${root}/${name}`);
        for (const projectPath of paths) {
          members.push(member(projectPath, "discovered", root));
        }
        observations.push(Object.freeze({
          kind: "discover" as const,
          root,
          state: "captured" as const,
          members: Object.freeze(paths),
        }));
      } finally {
        await directory.handle.close().catch(() => undefined);
      }
    }
  } else {
    for (const projectPath of normalized.paths) {
      const opened = await openProjectFile(project.handle, projectPath, false);
      if (opened === undefined) throw new Error("unreachable exact declaration member state");
      try {
        requireDeclarationFile(opened.information, projectPath);
        privateObservations.push({
          kind: "member",
          path: projectPath,
          fingerprint: statFingerprint(opened.information),
        });
        members.push(member(projectPath, "exact"));
      } finally {
        await opened.handle.close().catch(() => undefined);
      }
    }
    observations.push(Object.freeze({ kind: "members" as const, members: Object.freeze([...normalized.paths]) }));
  }

  members.sort((left, right) => compareProjectPaths(left.projectPath, right.projectPath));
  assertMembers(members);
  await project.verify();
  return Object.freeze({
    observations: Object.freeze(observations),
    members: Object.freeze(members),
    async verify(): Promise<void> {
      await project.verify();
      for (const observation of privateObservations) {
        if (observation.kind === "member") {
          const current = await openProjectFile(project.handle, observation.path, true);
          if (current === undefined) sourceChanged("exact declaration disappeared during capture", observation.path);
          try {
            requireDeclarationFile(current.information, observation.path);
            if (statFingerprint(current.information) !== observation.fingerprint) {
              sourceChanged("exact declaration changed during capture", observation.path);
            }
          } finally {
            await current.handle.close().catch(() => undefined);
          }
          continue;
        }
        const current = await openProjectDirectory(project.handle, observation.root, true);
        if (observation.fingerprint === undefined) {
          if (current !== undefined) {
            await current.handle.close().catch(() => undefined);
            sourceChanged("missing declaration root appeared during capture", observation.root);
          }
          continue;
        }
        if (current === undefined) sourceChanged("declaration root disappeared during capture", observation.root);
        try {
          const fingerprint = await fingerprintRoot(current, observation.root);
          if (!sameFingerprint(observation.fingerprint, fingerprint)) {
            sourceChanged("declaration root changed during capture", observation.root);
          }
        } finally {
          await current.handle.close().catch(() => undefined);
        }
      }
    },
  });
}

function validateSource(source?: ProjectSource): ProjectSource | undefined {
  if (source === undefined) return undefined;
  if (source.kind === "discover") {
    if (!Array.isArray(source.roots) || source.roots.length === 0) invalid("PROJECT_SOURCE", "declaration discovery requires roots");
    const roots = [...source.roots];
    for (const root of roots) {
      validateSourcePath(root);
      if (GLOB_CHARACTERS.test(root)) invalid("PROJECT_SOURCE", "declaration roots cannot contain glob characters", root);
    }
    roots.sort(compareProjectPaths);
    assertPaths(roots);
    return Object.freeze({ kind: "discover", roots: Object.freeze(roots) });
  }
  if (source.kind === "members") {
    if (!Array.isArray(source.paths)) invalid("PROJECT_SOURCE", "exact declaration source requires paths");
    const paths = [...source.paths];
    for (const path of paths) validateDeclarationPath(path);
    paths.sort(compareProjectPaths);
    assertPaths(paths);
    return Object.freeze({ kind: "members", paths: Object.freeze(paths) });
  }
  invalid("PROJECT_SOURCE", "unknown declaration source kind");
}

async function fingerprintRoot(directory: OpenDirectory, root: string): Promise<Fingerprint> {
  const records: string[] = [];
  const selectedNames: string[] = [];
  for await (const name of readDirectoryNames(directory.handle)) {
    const descriptorPath = `/proc/self/fd/${directory.handle.fd}/${name}`;
    let information: BigIntStats;
    try {
      information = await lstat(descriptorPath, { bigint: true });
    } catch (error) {
      if (isEntryRace(error)) sourceChanged("declaration entry changed during inspection", `${root}/${name}`);
      unavailable("PROJECT_SOURCE_IO", `cannot inspect declaration entry: ${errorText(error)}`, `${root}/${name}`);
    }
    if (!name.endsWith(".ts")) continue;
    const projectPath = `${root}/${name}`;
    validateDeclarationPath(projectPath);
    if (information.isSymbolicLink()) invalid("PROJECT_SOURCE_SYMLINK", "declaration members cannot be symlinks", projectPath);
    requireDeclarationFile(information, projectPath);
    selectedNames.push(name);
    records.push(`${name}\0${statFingerprint(information)}`);
    if (selectedNames.length > MAX_MEMBERS) invalid("PROJECT_SOURCE_LIMIT", `declaration source exceeds ${MAX_MEMBERS} members`, root);
  }
  records.sort(compareProjectPaths);
  selectedNames.sort(compareProjectPaths);
  return Object.freeze({
    rootIdentity: identityKey(directory.information),
    records: Object.freeze(records),
    selectedNames: Object.freeze(selectedNames),
  });
}

function member(
  projectPath: string,
  membership: "discovered" | "exact",
  configuredRoot?: string,
): DeclarationMember {
  validateDeclarationPath(projectPath);
  const name = projectPath.split("/").at(-1)!.slice(0, -3);
  return Object.freeze({ id: name, projectPath, membership, ...(configuredRoot === undefined ? {} : { configuredRoot }) });
}

function validateDeclarationPath(path: string): void {
  validateSourcePath(path);
  const name = path.split("/").at(-1)!;
  if (!name.endsWith(".ts") || !LOCAL_NAME.test(name.slice(0, -3))) {
    invalid("PROJECT_DECLARATION_NAME", "declaration member must be named <LocalName>.ts", path);
  }
}

function validateSourcePath(path: string): void {
  try {
    validateProjectPath(path, "project source path");
  } catch (error) {
    invalid("PROJECT_SOURCE_PATH", errorText(error), path);
  }
  if (fullCaseFold15_1(path.split("/", 1)[0]!) === ".jig") {
    invalid("PROJECT_SOURCE_PROTECTED", "project source cannot use protected .jig state", path);
  }
}

function requireDeclarationFile(information: BigIntStats, path: string): void {
  if (!information.isFile()) invalid("PROJECT_MEMBER_KIND", "declaration member must be a regular file", path);
  if (information.nlink !== 1n) invalid("PROJECT_MEMBER_COLLISION", "declaration member must be singly linked", path);
}

function assertMembers(members: readonly DeclarationMember[]): void {
  if (members.length > MAX_MEMBERS) invalid("PROJECT_SOURCE_LIMIT", `declaration source exceeds ${MAX_MEMBERS} members`);
  assertPaths(members.map(({ projectPath }) => projectPath));
  const ids = new Map<string, string>();
  for (const value of members) {
    const prior = ids.get(value.id);
    if (prior !== undefined) invalid("PROJECT_MEMBER_COLLISION", `declaration ID ${value.id} is provided by ${prior} and ${value.projectPath}`);
    ids.set(value.id, value.projectPath);
  }
}

function assertPaths(paths: readonly string[]): void {
  try {
    assertNoProjectPathCollisions(paths, "project source");
  } catch (error) {
    invalid("PROJECT_SOURCE_COLLISION", errorText(error));
  }
  for (let index = 1; index < paths.length; index += 1) {
    if (paths[index - 1] === paths[index]) invalid("PROJECT_SOURCE_COLLISION", `project source repeats ${paths[index]}`);
  }
}

async function openProjectDirectory(project: FileHandle, projectPath: string, missingAllowed: boolean): Promise<OpenDirectory | undefined> {
  validateSourcePath(projectPath);
  let parent = project;
  const ancestors: FileHandle[] = [];
  try {
    const segments = projectPath.split("/");
    for (const [index, segment] of segments.entries()) {
      const logicalPath = segments.slice(0, index + 1).join("/");
      const child = await openEntry(parent, segment, logicalPath, true, missingAllowed);
      if (child === undefined) return undefined;
      if (index === segments.length - 1) return child;
      ancestors.push(child.handle);
      parent = child.handle;
    }
  } finally {
    await closeAll(ancestors);
  }
}

async function openProjectFile(project: FileHandle, projectPath: string, missingIsChange: boolean): Promise<OpenDirectory | undefined> {
  validateDeclarationPath(projectPath);
  const segments = projectPath.split("/");
  let parent = project;
  const ancestors: FileHandle[] = [];
  try {
    for (let index = 0; index < segments.length; index += 1) {
      const logicalPath = segments.slice(0, index + 1).join("/");
      const opened = await openEntry(parent, segments[index]!, logicalPath, index < segments.length - 1, false, missingIsChange);
      if (opened === undefined) return undefined;
      if (index === segments.length - 1) return opened;
      ancestors.push(opened.handle);
      parent = opened.handle;
    }
  } finally {
    await closeAll(ancestors);
  }
  throw new Error("unreachable declaration path traversal");
}

async function openEntry(
  parent: FileHandle,
  name: string,
  logicalPath: string,
  directory: boolean,
  missingAllowed: boolean,
  missingIsChange = false,
): Promise<OpenDirectory | undefined> {
  const descriptorPath = `/proc/self/fd/${parent.fd}/${name}`;
  let observed: BigIntStats;
  try {
    observed = await lstat(descriptorPath, { bigint: true });
  } catch (error) {
    if (isEntryRace(error)) {
      if (missingIsChange) sourceChanged("declaration path changed during capture", logicalPath);
      if (missingAllowed) return undefined;
      invalid("PROJECT_MEMBER_MISSING", `project path is missing: ${logicalPath}`, logicalPath);
    }
    unavailable("PROJECT_SOURCE_IO", `cannot inspect project path: ${errorText(error)}`, logicalPath);
  }
  if (observed.isSymbolicLink()) invalid("PROJECT_SOURCE_SYMLINK", "project source paths cannot contain symlinks", logicalPath);
  if (directory ? !observed.isDirectory() : !observed.isFile()) {
    invalid("PROJECT_MEMBER_KIND", directory ? "project source parent must be a directory" : "declaration member must be a regular file", logicalPath);
  }
  let handle: FileHandle;
  try {
    handle = await open(descriptorPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (directory ? constants.O_DIRECTORY : 0));
  } catch (error) {
    if (isEntryRace(error)) sourceChanged("project source changed while it was opened", logicalPath);
    unavailable("PROJECT_SOURCE_IO", `cannot open project source: ${errorText(error)}`, logicalPath);
  }
  const information = await handle.stat({ bigint: true });
  if (!sameIdentity(observed, information) || (directory ? !information.isDirectory() : !information.isFile())) {
    await handle.close().catch(() => undefined);
    sourceChanged("project source changed while it was opened", logicalPath);
  }
  return { handle, information };
}

async function* readDirectoryNames(directory: FileHandle): AsyncIterable<string> {
  const openRaw = opendir as unknown as (path: string, options: { readonly encoding: "buffer" }) => Promise<RawDirectory>;
  let stream: RawDirectory;
  try {
    stream = await openRaw(`/proc/self/fd/${directory.fd}`, { encoding: "buffer" });
  } catch (error) {
    unavailable("PROJECT_SOURCE_IO", `cannot enumerate declaration source: ${errorText(error)}`);
  }
  let count = 0;
  let bytes = 0;
  try {
    while (true) {
      const entry = await stream.read();
      if (entry === null) return;
      const raw = directoryEntryName(entry);
      count += 1;
      bytes += raw.byteLength;
      if (count > MAX_ROOT_ENTRIES || bytes > MAX_ROOT_NAME_BYTES) unavailable("PROJECT_SOURCE_LIMIT", "declaration root exceeds its enumeration budget");
      try {
        yield decoder.decode(raw);
      } catch {
        invalid("PROJECT_SOURCE_PATH", "declaration entry name is not valid UTF-8");
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

interface RawDirectory { read(): Promise<unknown | null>; close(): Promise<void> }

function directoryEntryName(entry: unknown): Uint8Array {
  if (entry instanceof Uint8Array) return entry;
  if (typeof entry === "object" && entry !== null && "name" in entry && (entry as { name: unknown }).name instanceof Uint8Array) {
    return (entry as { name: Uint8Array }).name;
  }
  unavailable("PROJECT_SOURCE_UNAVAILABLE", "runtime cannot enumerate raw declaration names incrementally");
}

async function closeAll(handles: readonly FileHandle[]): Promise<void> {
  for (const handle of [...handles].reverse()) await handle.close().catch(() => undefined);
}

function statFingerprint(value: BigIntStats): string {
  return [value.dev, value.ino, value.nlink, value.size, value.mtimeNs, value.ctimeNs, value.mode].join(":");
}

function identityKey(value: BigIntStats): string { return `${value.dev}:${value.ino}`; }
function sameIdentity(left: BigIntStats, right: BigIntStats): boolean { return left.dev === right.dev && left.ino === right.ino; }
function sameFingerprint(left: Fingerprint, right: Fingerprint): boolean {
  return left.rootIdentity === right.rootIdentity && left.records.length === right.records.length &&
    left.records.every((record, index) => record === right.records[index]);
}
function sourceChanged(message: string, path: string): never { invalid("PROJECT_SOURCE_CHANGED", message, path); }
function isEntryRace(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && ["ENOENT", "ELOOP", "ENOTDIR", "EISDIR"].includes(String(error.code));
}
function isDirectoryAlreadyClosed(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String(error.code) === "ERR_DIR_CLOSED";
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
