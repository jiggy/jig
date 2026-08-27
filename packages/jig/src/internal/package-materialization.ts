import { constants, type BigIntStats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  captureOpenedPackageDirectory,
  type CapturedFile,
  type CapturedPackage,
} from "../package/capture.js";
import { validateLogicalPath } from "../package/paths.js";

const TEMPORARY_PREFIX = "jig-package-";
const ALLOCATION_KIND = "private-package-materialization-allocation/1";
const LEASE_KIND = "private-package-materialization-lease/1";
const PACKAGE_NAME = "package";
const DISPOSING_NAME = "package.disposing";
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LEAF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UNSIGNED_64 = /^(?:0|[1-9][0-9]{0,19})$/;
const MAX_UNSIGNED_64 = (1n << 64n) - 1n;
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY |
  constants.O_NOFOLLOW | constants.O_NONBLOCK;

interface PrivateMaterializationPathIdentity {
  readonly path: string;
  readonly dev: string;
  readonly ino: string;
}

export interface PrivatePackageMaterializationAllocationOptions {
  readonly protectedParent: string;
  readonly name: string;
  readonly packageDigest: string;
  readonly ownerToken: string;
}

/** Persist this no-effect identity before allowing its exact leaf to be made. */
export interface PrivatePackageMaterializationAllocationIdentity {
  readonly kind: typeof ALLOCATION_KIND;
  readonly parent: PrivateMaterializationPathIdentity;
  readonly name: string;
  readonly path: string;
  readonly packageDigest: string;
  /** Caller correlation evidence, not standalone filesystem authority. */
  readonly ownerToken: string;
}

export interface PrivatePackageMaterializationLeaseIdentity {
  readonly kind: typeof LEASE_KIND;
  readonly allocation: PrivatePackageMaterializationAllocationIdentity;
  readonly transaction: PrivateMaterializationPathIdentity;
  readonly package: PrivateMaterializationPathIdentity;
}

export interface PrivatePackageMaterialization {
  readonly root: string;
  readonly packageDigest: string;
  dispose(): Promise<void>;
}

export interface PrivatePackageMaterializationLease extends PrivatePackageMaterialization {
  readonly identity: PrivatePackageMaterializationLeaseIdentity;
}

export type PrivatePackageMaterializationAllocationRecovery =
  | { readonly state: "absent" }
  | { readonly state: "incomplete-removed" }
  | { readonly state: "complete"; readonly lease: PrivatePackageMaterializationLease };

/** Original invocation-local materializer retained for existing callers. */
export async function materializeCapturedPackage(
  captured: CapturedPackage,
  temporaryParent = tmpdir(),
): Promise<PrivatePackageMaterialization> {
  const transactionRoot = await mkdtemp(join(temporaryParent, TEMPORARY_PREFIX));
  const packageRoot = join(transactionRoot, PACKAGE_NAME);
  const directories = new Set<string>([packageRoot]);
  try {
    await mkdir(packageRoot, { mode: 0o700 });
    for (const file of captured.files) {
      validateLogicalPath(file.path);
      const destination = join(packageRoot, ...file.path.split("/"));
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      rememberVisibleDirectories(directories, packageRoot, file.path);
      await copyCapturedFile(captured, file.path, file.size, destination);
    }
    for (const directory of [...directories].sort(deeperVisiblePathFirst)) {
      await chmod(directory, 0o555);
    }
    await chmod(transactionRoot, 0o711);
    let disposal: Promise<void> | undefined;
    return Object.freeze({
      root: packageRoot,
      packageDigest: captured.digest,
      dispose(): Promise<void> {
        disposal ??= (async () => {
          await chmod(transactionRoot, 0o700).catch(() => undefined);
          for (const directory of [...directories].sort(shorterVisiblePathFirst)) {
            await chmod(directory, 0o700).catch(() => undefined);
          }
          await rm(transactionRoot, { recursive: true, force: true });
        })();
        return disposal;
      },
    });
  } catch (error) {
    for (const directory of [...directories].sort(shorterVisiblePathFirst)) {
      await chmod(directory, 0o700).catch(() => undefined);
    }
    try {
      await chmod(transactionRoot, 0o700).catch(() => undefined);
      await rm(transactionRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "package materialization failed and staging cleanup failed",
      );
    }
    throw error;
  }
}

/**
 * Allocate identity only: prove the protected parent and exact unique leaf,
 * but make no filesystem entry. The caller durably records the result before
 * invoking `materializePrivatePackageLease`.
 *
 * Allocation/recovery assumes one trusted same-UID mutator beneath this
 * owner-only 0700 parent. A no-effect allocation cannot contain the future
 * transaction inode; that assumption is what permits recovery to classify an
 * exact, safely opened owner directory at the previously absent unique leaf as
 * this allocation's incomplete state. Symlinks, special files, unsafe modes,
 * unexpected top-level entries, and identities replaced while open are never
 * classified as absent or removable.
 */
export async function allocatePrivatePackageMaterialization(
  raw: PrivatePackageMaterializationAllocationOptions,
): Promise<PrivatePackageMaterializationAllocationIdentity> {
  const options = parseAllocationOptions(raw);
  const parent = await openProtectedParent(options.protectedParent);
  try {
    await requireChildAbsent(parent.handle, options.name);
    await verifyVisibleParent(parent);
    return freezeAllocation({
      kind: ALLOCATION_KIND,
      parent: pathIdentity(parent.path, parent.information),
      name: options.name,
      path: join(parent.path, options.name),
      packageDigest: options.packageDigest,
      ownerToken: options.ownerToken,
    });
  } finally {
    await parent.handle.close();
  }
}

/** Materialize only after the no-effect allocation identity is durable. */
export async function materializePrivatePackageLease(
  captured: CapturedPackage,
  value: unknown,
): Promise<PrivatePackageMaterializationLease> {
  const allocation = parseAllocation(value);
  if (captured.digest !== allocation.packageDigest) {
    throw new Error("captured package does not match its materialization allocation digest");
  }
  const parent = await openProtectedParent(allocation.parent.path, allocation.parent);
  let transaction: FileHandle | undefined;
  let packageDirectory: FileHandle | undefined;
  let transactionInformation: BigIntStats | undefined;
  let created = false;
  let failure: unknown;
  try {
    await mkdir(childPath(parent.handle, allocation.name), { mode: 0o700 });
    created = true;
    transactionInformation = await lstat(
      childPath(parent.handle, allocation.name),
      { bigint: true },
    );
    const openedTransaction = await openOwnedDirectory(
      parent.handle,
      allocation.name,
      parent.information,
      [0o700n],
    );
    transaction = openedTransaction.handle;
    if (!sameIdentity(transactionInformation, openedTransaction.information)) {
      throw new Error("new materialization transaction changed before opening");
    }

    await mkdir(childPath(transaction, PACKAGE_NAME), { mode: 0o700 });
    const openedPackage = await openOwnedDirectory(
      transaction,
      PACKAGE_NAME,
      parent.information,
      [0o700n],
    );
    packageDirectory = openedPackage.handle;
    const directories = new Set<string>([""]);
    for (const file of captured.files) {
      validateLogicalPath(file.path);
      rememberLogicalDirectories(directories, file.path);
      const segments = file.path.split("/");
      const directory = await openPackageDirectory(
        packageDirectory,
        segments.slice(0, -1).join("/"),
        true,
        parent.information,
        0o700n,
      );
      try {
        await copyCapturedFile(
          captured,
          file.path,
          file.size,
          childPath(directory, segments.at(-1)!),
          parent.information,
        );
      } finally {
        await directory.close();
      }
    }
    for (const logicalPath of [...directories].sort(deeperLogicalPathFirst)) {
      const directory = await openPackageDirectory(
        packageDirectory,
        logicalPath,
        false,
        parent.information,
        0o700n,
      );
      try {
        await directory.chmod(0o555);
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    await transaction.chmod(0o711);
    await transaction.sync();
    await parent.handle.sync();

    transactionInformation = await transaction.stat({ bigint: true });
    const packageInformation = await packageDirectory.stat({ bigint: true });
    requireOwnedDirectory(transactionInformation, parent.information, [0o711n], "transaction");
    if (!await packageMatches(
      packageDirectory,
      packageInformation,
      allocation.packageDigest,
      parent.information,
    )) throw new Error("new materialized package failed its digest verification");
    await verifyVisibleParent(parent, allocation.parent);
    await requireChildIdentity(parent.handle, allocation.name, transactionInformation);
    await requireChildIdentity(transaction, PACKAGE_NAME, packageInformation);
    return leaseFromObserved(allocation, transactionInformation, packageInformation);
  } catch (error) {
    failure = error;
  } finally {
    if (failure !== undefined && created) {
      try {
        if (transaction === undefined) {
          const opened = await openOwnedDirectory(
            parent.handle,
            allocation.name,
            parent.information,
            [0o700n, 0o711n],
          );
          transaction = opened.handle;
          if (transactionInformation !== undefined &&
              !sameIdentity(transactionInformation, opened.information)) {
            throw new Error("refusing to clean a replaced materialization transaction");
          }
          transactionInformation = opened.information;
        }
        await removeTransaction(
          parent,
          transaction,
          allocation.name,
          transactionInformation!,
        );
        transaction = undefined;
      } catch (cleanupError) {
        failure = new AggregateError(
          [failure, cleanupError],
          "durable materialization and exact cleanup did not both complete",
        );
      }
    }
    await packageDirectory?.close().catch(() => undefined);
    await transaction?.close().catch(() => undefined);
    await parent.handle.close().catch(() => undefined);
  }
  throw failure;
}

/** Recover exactly one pre-recorded allocation, never by ambient scanning. */
export async function recoverPrivatePackageMaterializationAllocation(
  protectedParent: string,
  value: unknown,
): Promise<PrivatePackageMaterializationAllocationRecovery> {
  const allocation = parseAllocation(value);
  requireExpectedParent(protectedParent, allocation.parent.path);
  const parent = await openProtectedParent(allocation.parent.path, allocation.parent);
  let transaction: FileHandle | undefined;
  let packageDirectory: FileHandle | undefined;
  try {
    const openedTransaction = await tryOpenOwnedDirectory(
      parent.handle,
      allocation.name,
      parent.information,
      [0o700n, 0o711n],
    );
    if (openedTransaction === undefined) {
      await parent.handle.sync();
      await verifyVisibleParent(parent, allocation.parent);
      return Object.freeze({ state: "absent" as const });
    }
    transaction = openedTransaction.handle;
    const entries = await directoryNames(transaction);
    if (
      entries.length === 1 && entries[0] === PACKAGE_NAME
    ) {
      const openedPackage = await openOwnedDirectory(
        transaction,
        PACKAGE_NAME,
        parent.information,
        [0o700n, 0o555n],
      );
      packageDirectory = openedPackage.handle;
      if (
        fileMode(openedPackage.information) === 0o555n &&
        await packageMatches(
          packageDirectory,
          openedPackage.information,
          allocation.packageDigest,
          parent.information,
        )
      ) {
        await transaction.chmod(0o711);
        await transaction.sync();
        await parent.handle.sync();
        const transactionInformation = await transaction.stat({ bigint: true });
        await verifyVisibleParent(parent, allocation.parent);
        await requireChildIdentity(parent.handle, allocation.name, transactionInformation);
        await requireChildIdentity(transaction, PACKAGE_NAME, openedPackage.information);
        const lease = leaseFromObserved(
          allocation,
          transactionInformation,
          openedPackage.information,
        );
        return Object.freeze({ state: "complete" as const, lease });
      }
    } else if (
      entries.length !== 0 &&
      !(entries.length === 1 && entries[0] === DISPOSING_NAME)
    ) {
      throw new Error("allocated materialization leaf contains an unexpected entry");
    }

    await packageDirectory?.close();
    packageDirectory = undefined;
    await removeTransaction(
      parent,
      transaction,
      allocation.name,
      openedTransaction.information,
    );
    transaction = undefined;
    return Object.freeze({ state: "incomplete-removed" as const });
  } finally {
    await packageDirectory?.close().catch(() => undefined);
    await transaction?.close().catch(() => undefined);
    await parent.handle.close().catch(() => undefined);
  }
}

/** Reacquire one complete lease after strict JSON decoding and inode checks. */
export async function reacquirePrivatePackageMaterializationLease(
  protectedParent: string,
  value: unknown,
): Promise<PrivatePackageMaterializationLease> {
  const identity = parseLease(value);
  requireExpectedParent(protectedParent, identity.allocation.parent.path);
  const opened = await openActiveLease(identity);
  try {
    await requireEntries(opened.transaction, [PACKAGE_NAME]);
    if (!await packageMatches(
      opened.package,
      opened.packageInformation,
      identity.allocation.packageDigest,
      opened.parentInformation,
    )) throw new Error("materialized package no longer matches its lease digest");
    await verifyVisibleLease(opened, identity);
    return durableLease(identity);
  } finally {
    await closeAll(opened.package, opened.transaction, opened.parent);
  }
}

/** Digest-gated, descriptor-confined, resumable disposal of one exact lease. */
export async function disposePrivatePackageMaterializationLease(
  protectedParent: string,
  value: unknown,
): Promise<void> {
  const identity = parseLease(value);
  const allocation = identity.allocation;
  requireExpectedParent(protectedParent, allocation.parent.path);
  const parent = await openProtectedParent(allocation.parent.path, allocation.parent);
  let transaction: FileHandle | undefined;
  let packageDirectory: FileHandle | undefined;
  try {
    const openedTransaction = await tryOpenOwnedDirectory(
      parent.handle,
      allocation.name,
      parent.information,
      [0o700n, 0o711n],
    );
    if (openedTransaction === undefined) {
      await parent.handle.sync();
      return;
    }
    transaction = openedTransaction.handle;
    requireStoredIdentity(openedTransaction.information, identity.transaction, "transaction");
    const entries = await directoryNames(transaction);
    const active = entries.length === 1 && entries[0] === PACKAGE_NAME;
    const disposing = entries.length === 1 && entries[0] === DISPOSING_NAME;
    if (active) {
      const openedPackage = await openOwnedDirectory(
        transaction,
        PACKAGE_NAME,
        parent.information,
        [0o555n],
      );
      packageDirectory = openedPackage.handle;
      requireStoredIdentity(openedPackage.information, identity.package, "package");
      if (!await packageMatches(
        packageDirectory,
        openedPackage.information,
        allocation.packageDigest,
        parent.information,
      )) throw new Error("refusing to dispose a package with a changed digest");
      await verifyVisibleParent(parent, allocation.parent);
      await requireChildIdentity(parent.handle, allocation.name, openedTransaction.information);
      await requireChildIdentity(transaction, PACKAGE_NAME, openedPackage.information);
      await transaction.chmod(0o700);
      await transaction.sync();
      await rename(childPath(transaction, PACKAGE_NAME), childPath(transaction, DISPOSING_NAME));
      await transaction.sync();
      await requireChildIdentity(transaction, DISPOSING_NAME, openedPackage.information);
    } else if (disposing) {
      if (fileMode(openedTransaction.information) !== 0o700n) {
        throw new Error("disposing materialization transaction has an invalid mode");
      }
      const openedPackage = await openOwnedDirectory(
        transaction,
        DISPOSING_NAME,
        parent.information,
        [0o555n, 0o700n],
      );
      packageDirectory = openedPackage.handle;
      requireStoredIdentity(openedPackage.information, identity.package, "disposing package");
      await verifyVisibleParent(parent, allocation.parent);
      await requireChildIdentity(parent.handle, allocation.name, openedTransaction.information);
    } else if (entries.length === 0 && fileMode(openedTransaction.information) === 0o700n) {
      await removeTransaction(
        parent,
        transaction,
        allocation.name,
        openedTransaction.information,
      );
      transaction = undefined;
      return;
    } else {
      throw new Error("materialization transaction has an unexpected disposal state");
    }

    await removeTree(packageDirectory, parent.information);
    const packageAfter = await packageDirectory.stat({ bigint: true });
    requireStoredIdentity(packageAfter, identity.package, "disposing package");
    await requireChildIdentity(transaction, DISPOSING_NAME, packageAfter);
    await packageDirectory.close();
    packageDirectory = undefined;
    await rmdir(childPath(transaction, DISPOSING_NAME));
    await transaction.sync();
    if ((await directoryNames(transaction)).length !== 0) {
      throw new Error("materialization transaction gained entries during disposal");
    }
    await removeTransaction(
      parent,
      transaction,
      allocation.name,
      openedTransaction.information,
    );
    transaction = undefined;
  } finally {
    await packageDirectory?.close().catch(() => undefined);
    await transaction?.close().catch(() => undefined);
    await parent.handle.close().catch(() => undefined);
  }
}

function leaseFromObserved(
  allocation: PrivatePackageMaterializationAllocationIdentity,
  transaction: BigIntStats,
  packageDirectory: BigIntStats,
): PrivatePackageMaterializationLease {
  const identity = freezeLease({
    kind: LEASE_KIND,
    allocation,
    transaction: pathIdentity(allocation.path, transaction),
    package: pathIdentity(join(allocation.path, PACKAGE_NAME), packageDirectory),
  });
  return durableLease(identity);
}

function durableLease(
  identity: PrivatePackageMaterializationLeaseIdentity,
): PrivatePackageMaterializationLease {
  let disposal: Promise<void> | undefined;
  return Object.freeze({
    root: identity.package.path,
    packageDigest: identity.allocation.packageDigest,
    identity,
    dispose(): Promise<void> {
      disposal ??= disposePrivatePackageMaterializationLease(
        identity.allocation.parent.path,
        identity,
      );
      return disposal;
    },
  });
}

interface PrivateOpenedParent {
  readonly handle: FileHandle;
  readonly information: BigIntStats;
  readonly path: string;
}

interface PrivateOpenedLease {
  readonly parent: FileHandle;
  readonly parentInformation: BigIntStats;
  readonly transaction: FileHandle;
  readonly transactionInformation: BigIntStats;
  readonly package: FileHandle;
  readonly packageInformation: BigIntStats;
}

async function openActiveLease(
  identity: PrivatePackageMaterializationLeaseIdentity,
): Promise<PrivateOpenedLease> {
  const allocation = identity.allocation;
  const parent = await openProtectedParent(allocation.parent.path, allocation.parent);
  let transaction: FileHandle | undefined;
  let packageDirectory: FileHandle | undefined;
  try {
    const openedTransaction = await openOwnedDirectory(
      parent.handle,
      allocation.name,
      parent.information,
      [0o711n],
    );
    transaction = openedTransaction.handle;
    requireStoredIdentity(openedTransaction.information, identity.transaction, "transaction");
    const openedPackage = await openOwnedDirectory(
      transaction,
      PACKAGE_NAME,
      parent.information,
      [0o555n],
    );
    packageDirectory = openedPackage.handle;
    requireStoredIdentity(openedPackage.information, identity.package, "package");
    return {
      parent: parent.handle,
      parentInformation: parent.information,
      transaction,
      transactionInformation: openedTransaction.information,
      package: packageDirectory,
      packageInformation: openedPackage.information,
    };
  } catch (error) {
    await closeAll(packageDirectory, transaction, parent.handle);
    throw error;
  }
}

async function verifyVisibleLease(
  opened: PrivateOpenedLease,
  identity: PrivatePackageMaterializationLeaseIdentity,
): Promise<void> {
  const allocation = identity.allocation;
  await verifyVisibleParent(
    { handle: opened.parent, information: opened.parentInformation, path: allocation.parent.path },
    allocation.parent,
  );
  await requireChildIdentity(opened.parent, allocation.name, opened.transactionInformation);
  await requireChildIdentity(opened.transaction, PACKAGE_NAME, opened.packageInformation);
}

async function openProtectedParent(
  value: string,
  expected?: PrivateMaterializationPathIdentity,
): Promise<PrivateOpenedParent> {
  requireLinux();
  const path = normalizeParent(value);
  const handle = await openAbsoluteDirectory(path);
  try {
    const information = await handle.stat({ bigint: true });
    if (typeof process.geteuid !== "function") {
      throw new Error("durable materialization requires a POSIX effective owner identity");
    }
    if (
      !information.isDirectory() || information.uid !== BigInt(process.geteuid()) ||
      fileMode(information) !== 0o700n
    ) throw new Error("protected materialization parent must be owner-owned mode 0700");
    if (expected !== undefined) requireStoredIdentity(information, expected, "protected parent");
    return { handle, information, path };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function verifyVisibleParent(
  parent: PrivateOpenedParent,
  expected?: PrivateMaterializationPathIdentity,
): Promise<void> {
  const visible = await openProtectedParent(parent.path, expected);
  try {
    if (!sameIdentity(visible.information, parent.information)) {
      throw new Error("protected materialization parent changed while in use");
    }
  } finally {
    await visible.handle.close();
  }
}

async function openAbsoluteDirectory(path: string): Promise<FileHandle> {
  let current = await open("/", DIRECTORY_FLAGS);
  try {
    for (const segment of path.split("/").filter((part) => part.length > 0)) {
      const next = await openDirectoryUnchecked(current, segment);
      await current.close();
      current = next.handle;
    }
    return current;
  } catch (error) {
    await current.close().catch(() => undefined);
    throw error;
  }
}

async function openDirectoryUnchecked(
  parent: FileHandle,
  name: string,
): Promise<{ readonly handle: FileHandle; readonly information: BigIntStats }> {
  const path = childPath(parent, name);
  const observed = await lstat(path, { bigint: true });
  if (observed.isSymbolicLink() || !observed.isDirectory()) {
    throw new Error(`materialization path ${JSON.stringify(name)} is not a real directory`);
  }
  const handle = await open(path, DIRECTORY_FLAGS);
  try {
    const information = await handle.stat({ bigint: true });
    if (!information.isDirectory() || !sameIdentity(observed, information)) {
      throw new Error(`materialization path ${JSON.stringify(name)} changed while opening`);
    }
    return { handle, information };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function openOwnedDirectory(
  parent: FileHandle,
  name: string,
  filesystem: BigIntStats,
  modes: readonly bigint[],
): Promise<{ readonly handle: FileHandle; readonly information: BigIntStats }> {
  const opened = await openDirectoryUnchecked(parent, name);
  try {
    requireOwnedDirectory(opened.information, filesystem, modes, JSON.stringify(name));
    return opened;
  } catch (error) {
    await opened.handle.close().catch(() => undefined);
    throw error;
  }
}

async function tryOpenOwnedDirectory(
  parent: FileHandle,
  name: string,
  filesystem: BigIntStats,
  modes: readonly bigint[],
): Promise<{ readonly handle: FileHandle; readonly information: BigIntStats } | undefined> {
  try {
    return await openOwnedDirectory(parent, name, filesystem, modes);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function openPackageDirectory(
  root: FileHandle,
  logicalPath: string,
  create: boolean,
  filesystem: BigIntStats,
  expectedMode: bigint,
): Promise<FileHandle> {
  let current = await duplicateDirectory(root);
  try {
    requireOwnedDirectory(await current.stat({ bigint: true }), filesystem, [expectedMode], "package root");
    if (logicalPath.length === 0) return current;
    for (const segment of logicalPath.split("/")) {
      const path = childPath(current, segment);
      if (create) {
        try {
          await mkdir(path, { mode: Number(expectedMode) });
          await current.sync();
        } catch (error) {
          if (!hasCode(error, "EEXIST")) throw error;
        }
      }
      const next = await openOwnedDirectory(current, segment, filesystem, [expectedMode]);
      await current.close();
      current = next.handle;
    }
    return current;
  } catch (error) {
    await current.close().catch(() => undefined);
    throw error;
  }
}

async function duplicateDirectory(directory: FileHandle): Promise<FileHandle> {
  const before = await directory.stat({ bigint: true });
  const duplicate = await open(
    `/proc/self/fd/${directory.fd}`,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NONBLOCK,
  );
  try {
    const after = await duplicate.stat({ bigint: true });
    if (!after.isDirectory() || !sameIdentity(before, after)) {
      throw new Error("materialization directory changed while duplicating its descriptor");
    }
    return duplicate;
  } catch (error) {
    await duplicate.close().catch(() => undefined);
    throw error;
  }
}

async function packageMatches(
  packageDirectory: FileHandle,
  packageInformation: BigIntStats,
  expectedDigest: string,
  filesystem: BigIntStats,
): Promise<boolean> {
  if (fileMode(packageInformation) !== 0o555n) return false;
  requireOwnedDirectory(packageInformation, filesystem, [0o555n], "package");
  const captured = await captureOpenedPackageDirectory(
    "durable package materialization",
    packageDirectory,
  );
  try {
    if (captured.digest !== expectedDigest) return false;
    if (!await packageModesMatch(packageDirectory, captured.files, filesystem)) return false;
    return sameIdentity(await packageDirectory.stat({ bigint: true }), packageInformation);
  } finally {
    await captured.dispose();
  }
}

async function packageModesMatch(
  packageDirectory: FileHandle,
  files: readonly CapturedFile[],
  filesystem: BigIntStats,
): Promise<boolean> {
  const directories = new Set<string>([""]);
  for (const file of files) rememberLogicalDirectories(directories, file.path);
  for (const path of directories) {
    try {
      const directory = await openPackageDirectory(
        packageDirectory,
        path,
        false,
        filesystem,
        0o555n,
      );
      await directory.close();
    } catch {
      return false;
    }
  }
  for (const file of files) {
    const segments = file.path.split("/");
    let parent: FileHandle;
    try {
      parent = await openPackageDirectory(
        packageDirectory,
        segments.slice(0, -1).join("/"),
        false,
        filesystem,
        0o555n,
      );
    } catch {
      return false;
    }
    try {
      const path = childPath(parent, segments.at(-1)!);
      const observed = await lstat(path, { bigint: true });
      if (observed.isSymbolicLink() || !observed.isFile()) return false;
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const information = await handle.stat({ bigint: true });
        if (
          !sameIdentity(observed, information) || !information.isFile() ||
          information.nlink !== 1n || information.uid !== filesystem.uid ||
          information.dev !== filesystem.dev || fileMode(information) !== 0o444n
        ) return false;
      } finally {
        await handle.close();
      }
    } finally {
      await parent.close();
    }
  }
  return true;
}

async function removeTransaction(
  parent: PrivateOpenedParent,
  transaction: FileHandle,
  name: string,
  expected: BigIntStats,
): Promise<void> {
  await verifyVisibleParent(parent);
  await requireChildIdentity(parent.handle, name, expected);
  await removeTree(transaction, parent.information);
  await requireChildIdentity(parent.handle, name, expected);
  await transaction.close();
  await rmdir(childPath(parent.handle, name));
  await parent.handle.sync();
  await verifyVisibleParent(parent);
}

/** Remove descendants only through an already-open exact directory. */
async function removeTree(root: FileHandle, filesystem: BigIntStats): Promise<void> {
  requireOwnedDirectory(
    await root.stat({ bigint: true }),
    filesystem,
    [0o555n, 0o700n, 0o711n],
    "cleanup root",
  );
  await root.chmod(0o700);
  await root.sync();
  for (const name of await directoryNames(root)) {
    const path = childPath(root, name);
    const observed = await lstat(path, { bigint: true });
    if (observed.isSymbolicLink()) {
      throw new Error("refusing to remove a symlink from a materialization allocation");
    }
    if (observed.isDirectory()) {
      const child = await openOwnedDirectory(root, name, filesystem, [0o555n, 0o700n]);
      try {
        await removeTree(child.handle, filesystem);
        await requireChildIdentity(root, name, child.information);
      } finally {
        await child.handle.close();
      }
      await rmdir(path);
      await root.sync();
      continue;
    }
    if (!observed.isFile()) {
      throw new Error("refusing to remove a special file from a materialization allocation");
    }
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let information: BigIntStats;
    try {
      information = await file.stat({ bigint: true });
      if (
        !sameIdentity(observed, information) || !information.isFile() ||
        information.nlink !== 1n || information.uid !== filesystem.uid ||
        information.dev !== filesystem.dev
      ) throw new Error("materialization file changed before cleanup");
    } finally {
      await file.close();
    }
    await requireChildIdentity(root, name, information!);
    await unlink(path);
    await root.sync();
  }
}

async function requireEntries(directory: FileHandle, expected: readonly string[]): Promise<void> {
  const actual = (await directoryNames(directory)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((value, index) => value !== wanted[index])) {
    throw new Error("materialization directory has unexpected entries");
  }
}

async function directoryNames(directory: FileHandle): Promise<string[]> {
  const names = await readdir(`/proc/self/fd/${directory.fd}`, { encoding: "utf8" });
  for (const name of names) {
    if (name.length === 0 || name === "." || name === ".." || name.includes("/")) {
      throw new Error("materialization contains an invalid directory entry name");
    }
  }
  return names;
}

async function requireChildAbsent(parent: FileHandle, name: string): Promise<void> {
  try {
    await lstat(childPath(parent, name), { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
  throw new Error("materialization allocation leaf is already present");
}

async function requireChildIdentity(
  parent: FileHandle,
  name: string,
  expected: BigIntStats,
): Promise<void> {
  const visible = await lstat(childPath(parent, name), { bigint: true });
  if (!sameIdentity(visible, expected)) {
    throw new Error(`materialization entry ${JSON.stringify(name)} changed identity`);
  }
}

function requireOwnedDirectory(
  information: BigIntStats,
  filesystem: BigIntStats,
  modes: readonly bigint[],
  label: string,
): void {
  if (
    !information.isDirectory() || information.uid !== filesystem.uid ||
    information.dev !== filesystem.dev || !modes.includes(fileMode(information))
  ) throw new Error(`materialization ${label} has unsafe filesystem identity`);
}

function requireStoredIdentity(
  information: { readonly dev: bigint; readonly ino: bigint },
  expected: PrivateMaterializationPathIdentity,
  label: string,
): void {
  if (information.dev.toString() !== expected.dev || information.ino.toString() !== expected.ino) {
    throw new Error(`materialization ${label} does not match its durable device/inode identity`);
  }
}

function parseAllocationOptions(
  value: PrivatePackageMaterializationAllocationOptions,
): PrivatePackageMaterializationAllocationOptions {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("materialization allocation options must be an object");
  }
  return Object.freeze({
    protectedParent: normalizeParent(value.protectedParent),
    name: normalizeLeaf(value.name),
    packageDigest: parseDigest(value.packageDigest),
    ownerToken: normalizeOwnerToken(value.ownerToken),
  });
}

function parseAllocation(value: unknown): PrivatePackageMaterializationAllocationIdentity {
  const root = exactRecord(
    value,
    ["kind", "parent", "name", "path", "packageDigest", "ownerToken"],
    "materialization allocation",
  );
  if (root.kind !== ALLOCATION_KIND) {
    throw new TypeError(`materialization allocation kind must be ${ALLOCATION_KIND}`);
  }
  const parent = parsePathIdentity(root.parent, "allocation parent");
  const name = normalizeLeaf(root.name);
  const path = normalizeAbsolutePath(root.path, "allocation path");
  const packageDigest = parseDigest(root.packageDigest);
  const ownerToken = normalizeOwnerToken(root.ownerToken);
  if (parent.path !== normalizeParent(parent.path) || path !== join(parent.path, name)) {
    throw new TypeError("materialization allocation paths are not canonical and correlated");
  }
  return freezeAllocation({
    kind: ALLOCATION_KIND,
    parent,
    name,
    path,
    packageDigest,
    ownerToken,
  });
}

function parseLease(value: unknown): PrivatePackageMaterializationLeaseIdentity {
  const root = exactRecord(
    value,
    ["kind", "allocation", "transaction", "package"],
    "materialization lease",
  );
  if (root.kind !== LEASE_KIND) {
    throw new TypeError(`materialization lease kind must be ${LEASE_KIND}`);
  }
  const allocation = parseAllocation(root.allocation);
  const transaction = parsePathIdentity(root.transaction, "lease transaction");
  const packageDirectory = parsePathIdentity(root.package, "lease package");
  if (
    transaction.path !== allocation.path ||
    packageDirectory.path !== join(allocation.path, PACKAGE_NAME)
  ) throw new TypeError("materialization lease paths do not match their allocation");
  return freezeLease({
    kind: LEASE_KIND,
    allocation,
    transaction,
    package: packageDirectory,
  });
}

function parsePathIdentity(value: unknown, label: string): PrivateMaterializationPathIdentity {
  const record = exactRecord(value, ["path", "dev", "ino"], label);
  return Object.freeze({
    path: normalizeAbsolutePath(record.path, `${label} path`),
    dev: normalizeUnsigned64(record.dev, `${label} dev`),
    ino: normalizeUnsigned64(record.ino, `${label} ino`),
  });
}

function freezeAllocation(
  value: PrivatePackageMaterializationAllocationIdentity,
): PrivatePackageMaterializationAllocationIdentity {
  return Object.freeze({
    kind: ALLOCATION_KIND,
    parent: Object.freeze({ ...value.parent }),
    name: value.name,
    path: value.path,
    packageDigest: value.packageDigest,
    ownerToken: value.ownerToken,
  });
}

function freezeLease(
  value: PrivatePackageMaterializationLeaseIdentity,
): PrivatePackageMaterializationLeaseIdentity {
  return Object.freeze({
    kind: LEASE_KIND,
    allocation: freezeAllocation(value.allocation),
    transaction: Object.freeze({ ...value.transaction }),
    package: Object.freeze({ ...value.package }),
  });
}

function pathIdentity(
  path: string,
  information: { readonly dev: bigint; readonly ino: bigint },
): PrivateMaterializationPathIdentity {
  return Object.freeze({ path, dev: information.dev.toString(), ino: information.ino.toString() });
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must have exactly the canonical fields`);
  }
  return record;
}

function normalizeParent(value: unknown): string {
  return normalizeAbsolutePath(value, "protected materialization parent");
}

function normalizeAbsolutePath(value: unknown, label: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value.includes("\0") ||
    !isAbsolute(value) || resolve(value) !== value || Buffer.byteLength(value, "utf8") > 4096
  ) throw new TypeError(`${label} must be a bounded canonical absolute path`);
  return value;
}

function normalizeLeaf(value: unknown): string {
  if (typeof value !== "string" || !LEAF.test(value)) {
    throw new TypeError("materialization allocation name must be one strict ASCII leaf segment");
  }
  return value;
}

function normalizeOwnerToken(value: unknown): string {
  const bytes = typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;
  if (typeof value !== "string" || bytes < 16 || bytes > 256) {
    throw new TypeError("materialization owner token must contain 16-256 UTF-8 bytes");
  }
  return value;
}

function parseDigest(value: unknown): string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError("materialization package digest must be sha256 plus 64 lowercase hex digits");
  }
  return value;
}

function normalizeUnsigned64(value: unknown, label: string): string {
  if (typeof value !== "string" || !UNSIGNED_64.test(value) || BigInt(value) > MAX_UNSIGNED_64) {
    throw new TypeError(`${label} must be a canonical unsigned 64-bit decimal string`);
  }
  return value;
}

function requireExpectedParent(value: string, expected: string): void {
  if (normalizeParent(value) !== expected) {
    throw new Error("materialization identity belongs to a different protected parent");
  }
}

async function copyCapturedFile(
  captured: CapturedPackage,
  logicalPath: string,
  expectedBytes: number,
  destination: string,
  filesystem?: BigIntStats,
): Promise<void> {
  const handle = await open(
    destination,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o400,
  );
  let observedBytes = 0;
  try {
    if (filesystem !== undefined) {
      const information = await handle.stat({ bigint: true });
      if (
        !information.isFile() || information.nlink !== 1n ||
        information.uid !== filesystem.uid || information.dev !== filesystem.dev
      ) throw new Error(`new materialized file ${logicalPath} has unsafe identity`);
    }
    for await (const chunk of captured.stream(logicalPath, expectedBytes)) {
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError(`captured stream for ${logicalPath} yielded a non-byte chunk`);
      }
      observedBytes += chunk.byteLength;
      if (!Number.isSafeInteger(observedBytes) || observedBytes > expectedBytes) {
        throw new Error(`captured stream for ${logicalPath} exceeded its recorded size`);
      }
      await writeAll(handle, chunk);
    }
    if (observedBytes !== expectedBytes) {
      throw new Error(
        `captured stream for ${logicalPath} had ${observedBytes} bytes; expected ${expectedBytes}`,
      );
    }
    await handle.sync();
    await handle.chmod(0o444);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (bytesWritten <= 0) throw new Error("materialized package write made no progress");
    offset += bytesWritten;
  }
}

function rememberVisibleDirectories(result: Set<string>, root: string, logicalPath: string): void {
  let current = root;
  for (const segment of logicalPath.split("/").slice(0, -1)) {
    current = join(current, segment);
    result.add(current);
  }
}

function rememberLogicalDirectories(result: Set<string>, logicalPath: string): void {
  let current = "";
  for (const segment of logicalPath.split("/").slice(0, -1)) {
    current = current.length === 0 ? segment : `${current}/${segment}`;
    result.add(current);
  }
}

async function closeAll(...handles: Array<FileHandle | undefined>): Promise<void> {
  for (const handle of handles) await handle?.close().catch(() => undefined);
}

function childPath(parent: FileHandle, name: string): string {
  return `/proc/self/fd/${parent.fd}/${name}`;
}

function fileMode(information: { readonly mode: bigint }): bigint {
  return information.mode & 0o7777n;
}

function sameIdentity(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function requireLinux(): void {
  if (process.platform !== "linux") {
    throw new Error("durable materialization requires Linux descriptor paths");
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { readonly code?: unknown }).code === code;
}

function deeperVisiblePathFirst(left: string, right: string): number {
  return right.length - left.length || left.localeCompare(right);
}

function shorterVisiblePathFirst(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right);
}

function deeperLogicalPathFirst(left: string, right: string): number {
  const leftDepth = left.length === 0 ? 0 : left.split("/").length;
  const rightDepth = right.length === 0 ? 0 : right.split("/").length;
  return rightDepth - leftDepth || left.localeCompare(right);
}
