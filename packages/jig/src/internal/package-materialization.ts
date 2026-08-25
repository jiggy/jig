import { constants } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { CapturedPackage } from "../package/capture.js";
import { validateLogicalPath } from "../package/paths.js";

const MATERIALIZATION_PREFIX = "jig-package-";

/**
 * One host-private copy of an already captured Package/1 tree.
 *
 * This is deliberately package-private. It is a staging primitive for a
 * future Sandbox Backend, not a public package execution API.
 */
export interface PrivatePackageMaterialization {
  readonly root: string;
  readonly packageDigest: string;
  dispose(): Promise<void>;
}

/**
 * Materialize exactly the captured bytes without reopening the source tree.
 */
export async function materializeCapturedPackage(
  captured: CapturedPackage,
  temporaryParent = tmpdir(),
): Promise<PrivatePackageMaterialization> {
  const transactionRoot = await mkdtemp(join(temporaryParent, MATERIALIZATION_PREFIX));
  const packageRoot = join(transactionRoot, "package");
  const directories = new Set<string>([packageRoot]);

  try {
    await mkdir(packageRoot, { mode: 0o700 });
    for (const file of captured.files) {
      validateLogicalPath(file.path);
      const destination = join(packageRoot, ...file.path.split("/"));
      const parent = dirname(destination);
      await mkdir(parent, { recursive: true, mode: 0o700 });
      rememberDirectories(directories, packageRoot, file.path);
      await copyCapturedFile(captured, file.path, file.size, destination);
    }

    // The future Backend will also mount the tree read-only. These modes make
    // accidental host-side mutation fail during the interval before mounting.
    for (const directory of [...directories].sort(deeperPathFirst)) {
      await chmod(directory, 0o555);
    }
    // Bubblewrap resolves bind sources after applying its payload identity.
    // The unpredictable transaction directory therefore permits traversal but
    // not listing or mutation; the package tree beneath it remains read-only.
    await chmod(transactionRoot, 0o711);

    let disposal: Promise<void> | undefined;
    return Object.freeze({
      root: packageRoot,
      packageDigest: captured.digest,
      dispose(): Promise<void> {
        disposal ??= (async () => {
          await chmod(transactionRoot, 0o700).catch(() => undefined);
          await makeRemovable(directories);
          await rm(transactionRoot, { recursive: true, force: true });
        })();
        return disposal;
      },
    });
  } catch (error) {
    await makeRemovable(directories);
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

async function copyCapturedFile(
  captured: CapturedPackage,
  logicalPath: string,
  expectedBytes: number,
  destination: string,
): Promise<void> {
  const handle = await open(
    destination,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o400,
  );
  let observedBytes = 0;
  try {
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
  } finally {
    await handle.close();
  }
  await chmod(destination, 0o444);
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset);
    if (bytesWritten <= 0) throw new Error("materialized package write made no progress");
    offset += bytesWritten;
  }
}

function rememberDirectories(
  result: Set<string>,
  root: string,
  logicalPath: string,
): void {
  const segments = logicalPath.split("/");
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    result.add(current);
  }
}

async function makeRemovable(directories: ReadonlySet<string>): Promise<void> {
  for (const directory of [...directories].sort(shorterPathFirst)) {
    await chmod(directory, 0o700).catch(() => undefined);
  }
}

function deeperPathFirst(left: string, right: string): number {
  return right.length - left.length || left.localeCompare(right);
}

function shorterPathFirst(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right);
}
