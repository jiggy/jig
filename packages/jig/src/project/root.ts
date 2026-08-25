import { constants, type BigIntStats } from "node:fs";
import { type FileHandle, lstat, open } from "node:fs/promises";
import { resolve } from "node:path";

import { invalid, unavailable } from "../diagnostics.js";

const authenticRoots = new WeakSet<object>();

/** Private, invocation-local owner for one opened project-root identity. */
export interface PrivateProjectRoot {
  readonly requestedPath: string;
  readonly handle: FileHandle;
  readonly information: BigIntStats;
  verify(): Promise<void>;
  dispose(): Promise<void>;
}

export async function openPrivateProjectRoot(projectRoot: string): Promise<PrivateProjectRoot> {
  if (process.platform !== "linux") {
    unavailable("PROJECT_ROOT_UNAVAILABLE", "project-root capture requires Linux descriptor paths");
  }
  const requestedPath = resolve(projectRoot);
  let observed: BigIntStats;
  try {
    observed = await lstat(requestedPath, { bigint: true });
  } catch (error) {
    unavailable("PROJECT_ROOT_IO", `cannot inspect project root: ${errorText(error)}`, requestedPath);
  }
  if (observed.isSymbolicLink()) invalid("PROJECT_ROOT", "project root must not be a symlink", requestedPath);
  if (!observed.isDirectory()) invalid("PROJECT_ROOT", "project root is not a directory", requestedPath);

  let handle: FileHandle;
  try {
    handle = await open(
      requestedPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    unavailable("PROJECT_ROOT_IO", `cannot open project root: ${errorText(error)}`, requestedPath);
  }
  let information: BigIntStats;
  try {
    information = await handle.stat({ bigint: true });
  } catch (error) {
    await handle.close().catch(() => undefined);
    unavailable("PROJECT_ROOT_IO", `cannot inspect opened project root: ${errorText(error)}`, requestedPath);
  }
  if (!information.isDirectory() || !sameIdentity(observed, information)) {
    await handle.close().catch(() => undefined);
    sourceChanged("project root changed while it was opened", requestedPath);
  }

  let disposed = false;
  const root = Object.freeze({
    requestedPath,
    handle,
    information,
    async verify(): Promise<void> {
      if (disposed) unavailable("PROJECT_ROOT_CLOSED", "project-root capture has been disposed", requestedPath);
      let current: BigIntStats;
      try {
        current = await lstat(requestedPath, { bigint: true });
      } catch {
        sourceChanged("project root disappeared during capture", requestedPath);
      }
      if (!current.isDirectory() || !sameIdentity(information, current)) {
        sourceChanged("project root changed during capture", requestedPath);
      }
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      try {
        await handle.close();
      } catch (error) {
        unavailable("PROJECT_ROOT_IO", `cannot close project root: ${errorText(error)}`, requestedPath);
      }
    },
  });
  authenticRoots.add(root);
  return root;
}

export function requirePrivateProjectRoot(value: unknown): PrivateProjectRoot {
  if (value === null || typeof value !== "object" || !authenticRoots.has(value)) {
    throw new TypeError("project root was not produced by the private root boundary");
  }
  return value as PrivateProjectRoot;
}

function sameIdentity(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sourceChanged(message: string, path: string): never {
  invalid("PROJECT_SOURCE_CHANGED", message, path);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
