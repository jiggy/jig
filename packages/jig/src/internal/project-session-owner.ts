import {
  initializePrivateActivationState,
  openPrivateProjectCoordinator,
  type PrivateProjectCoordinator,
} from "./activation-admission-store.js";
import {
  openPrivateProjectRoot,
  requirePrivateProjectRoot,
  type PrivateProjectRoot,
} from "../project/root.js";

const authenticOwners = new WeakSet<object>();

/** Private lifetime owner for one descriptor-held local project session. */
export interface PrivateProjectSessionOwner {
  readonly root: PrivateProjectRoot;
  readonly coordinator: PrivateProjectCoordinator;
  verify(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Acquire one exact project identity and its single local coordinator lease.
 * Safe protected-state bootstrap may remain when a competing lease wins.
 */
export async function openPrivateProjectSessionOwner(
  directory: string,
): Promise<PrivateProjectSessionOwner> {
  const root = await openPrivateProjectRoot(directory);
  let coordinator: PrivateProjectCoordinator | undefined;
  try {
    await initializePrivateActivationState({ projectRoot: root });
    coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
    let disposed = false;
    let disposal: Promise<void> | undefined;
    const owner: PrivateProjectSessionOwner = Object.freeze({
      root,
      coordinator,
      async verify(): Promise<void> {
        if (disposed) throw new TypeError("private project-session owner is closed");
        await root.verify();
        await coordinator!.verify();
      },
      dispose(): Promise<void> {
        disposal ??= disposeOwner();
        return disposal;
      },
    });
    authenticOwners.add(owner);
    await owner.verify();
    return owner;

    async function disposeOwner(): Promise<void> {
      if (disposed) return;
      disposed = true;
      const failures: unknown[] = [];
      try { await coordinator!.dispose(); } catch (error) { failures.push(error); }
      try { await root.dispose(); } catch (error) { failures.push(error); }
      if (failures.length > 0) {
        throw new AggregateError(failures, "private project-session owner cleanup did not complete");
      }
    }
  } catch (error) {
    const failures: unknown[] = [error];
    try { await coordinator?.dispose(); } catch (cleanup) { failures.push(cleanup); }
    try { await root.dispose(); } catch (cleanup) { failures.push(cleanup); }
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        "private project-session acquisition and cleanup did not both complete",
      );
    }
    throw error;
  }
}

export function requirePrivateProjectSessionOwner(value: unknown): PrivateProjectSessionOwner {
  if (value === null || typeof value !== "object" || !authenticOwners.has(value)) {
    throw new TypeError("project session was not produced by the private acquisition boundary");
  }
  const owner = value as PrivateProjectSessionOwner;
  requirePrivateProjectRoot(owner.root);
  return owner;
}
