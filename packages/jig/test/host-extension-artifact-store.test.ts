import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  capturePrivateHostExtensionBlob,
  normalizePrivateHostExtensionBlobRef,
  PRIVATE_HOST_EXTENSION_BLOB_LIMIT,
  publishPrivateHostExtensionBlob,
  recoverPrivateHostExtensionBlobStore,
  requirePrivateCapturedHostExtensionBlob,
  type PrivateHostExtensionBlobRef,
} from "../src/internal/host-extension-artifact-store.js";

const encoder = new TextEncoder();

describe("private host-extension Blob/1 artifact store", () => {
  test("publishes one domain-separated bundle and reacquires copied bytes", async () => {
    await withStore(async (store) => {
      const source = encoder.encode("export const abi = 'private/1';\n");
      const expected = `sha256:${createHash("sha256")
        .update("JIG-Host-Extension-Blob/1\0", "ascii")
        .update(source)
        .digest("hex")}`;
      const reference = await publishPrivateHostExtensionBlob(store, source);
      expect(reference).toEqual({
        kind: "host-extension-blob/1",
        digest: expected,
        bytes: source.byteLength,
      });

      source.fill(0);
      const captured = await capturePrivateHostExtensionBlob(store, reference);
      expect(requirePrivateCapturedHostExtensionBlob(captured)).toBe(captured);
      const first = captured.read();
      expect(new TextDecoder().decode(first)).toBe("export const abi = 'private/1';\n");
      first.fill(0);
      expect(new TextDecoder().decode(captured.read())).toBe("export const abi = 'private/1';\n");
      captured.dispose();
      captured.dispose();
      expect(() => captured.read()).toThrow("capture is closed");
    });
  }, 30_000);

  test("concurrent identical publications converge without staging residue", async () => {
    await withStore(async (store) => {
      const bytes = encoder.encode("export default 1;\n");
      const references = await Promise.all(
        Array.from({ length: 4 }, () => publishPrivateHostExtensionBlob(store, bytes)),
      );
      expect(new Set(references.map((reference) => reference.digest)).size).toBe(1);
      const path = artifactPath(store, references[0]!);
      expect(await readdir(dirname(path))).toEqual([path.split("/").at(-1)!]);
    });
  }, 30_000);

  test("rejects confused references before deriving a store path", async () => {
    await withStore(async (store) => {
      for (const reference of [
        { kind: "flow-package/1", digest: `sha256:${"a".repeat(64)}`, bytes: 1 },
        { kind: "host-extension-blob/1", digest: `sha256:${"A".repeat(64)}`, bytes: 1 },
        { kind: "host-extension-blob/1", digest: `sha256:${"a".repeat(64)}`, bytes: 0 },
        { kind: "host-extension-blob/1", digest: `sha256:${"a".repeat(64)}`, bytes: 1, path: "/tmp/x" },
      ]) {
        expect(() => normalizePrivateHostExtensionBlobRef(reference)).toThrow();
        await expect(capturePrivateHostExtensionBlob(
          store,
          reference as unknown as PrivateHostExtensionBlobRef,
        )).rejects.toBeDefined();
      }

      try {
        normalizePrivateHostExtensionBlobRef({
          kind: "host-extension-blob/1",
          digest: `sha256:${"a".repeat(64)}`,
          bytes: 0,
        });
        throw new Error("malformed byte count was accepted");
      } catch (error) {
        expect(error).toMatchObject({ code: "HOST_EXTENSION_ARTIFACT_BYTES" });
      }

      let getterInvoked = false;
      const accessor = Object.defineProperty({
        kind: "host-extension-blob/1",
        bytes: 1,
      }, "digest", {
        enumerable: true,
        get() {
          getterInvoked = true;
          return `sha256:${"a".repeat(64)}`;
        },
      });
      expect(() => normalizePrivateHostExtensionBlobRef(accessor)).toThrow("data property");
      expect(getterInvoked).toBeFalse();
      expect(() => normalizePrivateHostExtensionBlobRef(new Proxy({}, {}))).toThrow("plain object");
    });
  }, 30_000);

  test("never repairs a corrupt retained blob", async () => {
    await withStore(async (store) => {
      const bytes = encoder.encode("trusted bundle\n");
      const reference = await publishPrivateHostExtensionBlob(store, bytes);
      const path = artifactPath(store, reference);
      await chmod(path, 0o600);
      await appendFile(path, "corrupt");
      await chmod(path, 0o400);

      await expect(capturePrivateHostExtensionBlob(store, reference)).rejects.toMatchObject({
        code: "HOST_EXTENSION_ARTIFACT_CORRUPT",
      });
      await expect(publishPrivateHostExtensionBlob(store, bytes)).rejects.toMatchObject({
        code: "HOST_EXTENSION_ARTIFACT_CORRUPT",
      });
      expect((await readFile(path)).subarray(-7).toString()).toBe("corrupt");
    });
  }, 30_000);

  test("keeps one acquired copy immutable after later store corruption", async () => {
    await withStore(async (store) => {
      const reference = await publishPrivateHostExtensionBlob(store, encoder.encode("original bundle\n"));
      const captured = await capturePrivateHostExtensionBlob(store, reference);
      try {
        const path = artifactPath(store, reference);
        await chmod(path, 0o600);
        await appendFile(path, "corrupt");
        await chmod(path, 0o400);
        expect(new TextDecoder().decode(captured.read())).toBe("original bundle\n");
        await expect(capturePrivateHostExtensionBlob(store, reference)).rejects.toMatchObject({
          code: "HOST_EXTENSION_ARTIFACT_CORRUPT",
        });
      } finally {
        captured.dispose();
      }
    });
  }, 30_000);

  test("rejects a special-file substitution at a retained digest", async () => {
    await withStore(async (store) => {
      const reference = await publishPrivateHostExtensionBlob(store, encoder.encode("bundle\n"));
      const path = artifactPath(store, reference);
      await unlink(path);
      await symlink("/dev/null", path);
      await expect(capturePrivateHostExtensionBlob(store, reference)).rejects.toMatchObject({
        code: "HOST_EXTENSION_ARTIFACT_CORRUPT",
      });
    });
  }, 30_000);

  test("enforces its exact byte ceiling before publication", async () => {
    await withStore(async (store) => {
      await expect(publishPrivateHostExtensionBlob(store, new Uint8Array())).rejects.toThrow(
        `1-${PRIVATE_HOST_EXTENSION_BLOB_LIMIT}`,
      );
      const maximum = await publishPrivateHostExtensionBlob(
        store,
        new Uint8Array(PRIVATE_HOST_EXTENSION_BLOB_LIMIT),
      );
      expect(maximum.bytes).toBe(PRIVATE_HOST_EXTENSION_BLOB_LIMIT);
      await expect(publishPrivateHostExtensionBlob(
        store,
        new Uint8Array(PRIVATE_HOST_EXTENSION_BLOB_LIMIT + 1),
      )).rejects.toThrow(`1-${PRIVATE_HOST_EXTENSION_BLOB_LIMIT}`);
      const proxied = new Proxy(new Uint8Array([1]), {});
      await expect(publishPrivateHostExtensionBlob(store, proxied)).rejects.toThrow(
        "source must be bytes",
      );
    });
  }, 30_000);

  test("reacquires a JSON-decoded reference in a fresh process", async () => {
    await withStore(async (store) => {
      const reference = await publishPrivateHostExtensionBlob(store, encoder.encode("restart bundle\n"));
      const moduleUrl = new URL("../src/internal/host-extension-artifact-store.ts", import.meta.url).href;
      const script = [
        `const api = await import(${JSON.stringify(moduleUrl)});`,
        "const reference = JSON.parse(process.env.JIG_TEST_BLOB_REF);",
        "const captured = await api.capturePrivateHostExtensionBlob(process.env.JIG_TEST_BLOB_STORE, reference);",
        "process.stdout.write(Buffer.from(captured.read()).toString('base64'));",
        "captured.dispose();",
      ].join("\n");
      const child = Bun.spawn([process.execPath, "--eval", script], {
        env: {
          ...process.env,
          JIG_TEST_BLOB_REF: JSON.stringify(reference),
          JIG_TEST_BLOB_STORE: store,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [status, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(stderr).toBe("");
      expect(status).toBe(0);
      expect(Buffer.from(stdout, "base64").toString()).toBe("restart bundle\n");
    });
  }, 30_000);

  test("recovers early, synchronized, and linked stages after publisher SIGKILL", async () => {
    await withStore(async (store) => {
      expect(await recoverPrivateHostExtensionBlobStore(store)).toBe(0);
      const staging = stagingPath(store);
      const linkedReference = testBlobReference(encoder.encode("linked"));
      const linkedFinal = artifactPath(store, linkedReference);
      await mkdir(dirname(linkedFinal), { recursive: true, mode: 0o700 });
      await chmod(dirname(linkedFinal), 0o700);
      const script = String.raw`
        import { createHash, randomUUID } from "node:crypto";
        import { link, open, readFile, stat, writeFile } from "node:fs/promises";
        const boot = (await readFile("/proc/sys/kernel/random/boot_id", "utf8"))
          .trim().replaceAll("-", "").toLowerCase();
        const namespace = await stat("/proc/self/ns/pid", { bigint: true });
        const processStat = await readFile("/proc/self/stat", "utf8");
        const fields = processStat.slice(processStat.lastIndexOf(")") + 1).trim().split(/\s+/);
        const owner = [".stage", boot, namespace.dev, namespace.ino, process.pid, fields[19]];
        const stage = (contents) => {
          const bytes = Buffer.from(contents);
          const digest = createHash("sha256")
            .update(Buffer.concat([
              Buffer.from("JIG-Host-Extension-Blob/1", "ascii"), Buffer.from([0]),
            ])).update(bytes).digest("hex");
          return process.env.JIG_TEST_STAGE_DIR + "/" +
            [...owner, digest, bytes.byteLength, randomUUID().replaceAll("-", "")].join("-") + ".blob";
        };
        process.umask(0o777);
        const early = stage("partial");
        await writeFile(early, "partial", { mode: 0o600 });
        const synchronized = stage("complete");
        const synchronizedHandle = await open(synchronized, "wx", 0o600);
        await synchronizedHandle.writeFile("complete");
        await synchronizedHandle.sync();
        await synchronizedHandle.chmod(0o400);
        await synchronizedHandle.sync();
        await synchronizedHandle.close();
        const linked = stage("linked");
        const linkedHandle = await open(linked, "wx", 0o600);
        await linkedHandle.writeFile("linked");
        await linkedHandle.sync();
        await linkedHandle.chmod(0o400);
        await linkedHandle.sync();
        await linkedHandle.close();
        await link(linked, process.env.JIG_TEST_LINKED_FINAL);
        process.kill(process.pid, "SIGKILL");
      `;
      const child = Bun.spawn([process.execPath, "--eval", script], {
        env: {
          ...process.env,
          JIG_TEST_LINKED_FINAL: linkedFinal,
          JIG_TEST_STAGE_DIR: staging,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [status, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(stderr).toBe("");
      expect(status).not.toBe(0);
      expect((await readdir(staging)).length).toBe(3);
      const recovered = await Promise.all([
        recoverPrivateHostExtensionBlobStore(store),
        recoverPrivateHostExtensionBlobStore(store),
      ]);
      expect(recovered[0]! + recovered[1]!).toBe(3);
      expect(await readdir(staging)).toEqual([]);
      expect((await readFile(linkedFinal)).toString()).toBe("linked");
    });
  }, 30_000);

  test("preserves a live stage and removes the same PID with mismatched start time", async () => {
    await withStore(async (store) => {
      await recoverPrivateHostExtensionBlobStore(store);
      const staging = stagingPath(store);
      const lease = await currentTestStageLease();
      const liveReference = testBlobReference(encoder.encode("live"));
      const live = join(staging, [
        lease.prefix,
        liveReference.digest.slice("sha256:".length),
        liveReference.bytes,
        "a".repeat(32),
      ].join("-") + ".blob");
      await writeFile(live, "live", { mode: 0o600 });
      await chmod(live, 0o600);
      expect(await recoverPrivateHostExtensionBlobStore(store)).toBe(0);
      expect(await readdir(staging)).toEqual([live.split("/").at(-1)!]);
      await unlink(live);

      const mismatchedPrefix = [
        ".stage",
        lease.bootId,
        lease.namespaceDevice,
        lease.namespaceInode,
        process.pid,
        (BigInt(lease.startTime) + 1n).toString(10),
      ].join("-");
      const staleReference = testBlobReference(encoder.encode("stale"));
      const mismatched = join(staging, [
        mismatchedPrefix,
        staleReference.digest.slice("sha256:".length),
        staleReference.bytes,
        "b".repeat(32),
      ].join("-") + ".blob");
      await writeFile(mismatched, "stale", { mode: 0o600 });
      await chmod(mismatched, 0o600);
      expect(await recoverPrivateHostExtensionBlobStore(store)).toBe(1);
      expect(await readdir(staging)).toEqual([]);
    });
  }, 30_000);

  test("rejects symlinked and writable protected-store directories", async () => {
    const parent = await mkdtemp(join(tmpdir(), "jig-host-extension-policy-"));
    try {
      const real = join(parent, "real");
      const linked = join(parent, "linked");
      await mkdir(real, { mode: 0o700 });
      await symlink(real, linked);
      await expect(publishPrivateHostExtensionBlob(linked, encoder.encode("bundle\n"))).rejects.toMatchObject({
        code: "HOST_EXTENSION_ARTIFACT_STORE",
      });

      await chmod(real, 0o770);
      await expect(publishPrivateHostExtensionBlob(real, encoder.encode("bundle\n"))).rejects.toMatchObject({
        code: "HOST_EXTENSION_ARTIFACT_STORE_PERMISSIONS",
      });
      await chmod(real, 0o700);

      const outside = join(parent, "outside");
      await mkdir(outside, { mode: 0o700 });
      await symlink(outside, join(real, "host-extensions"));
      await expect(publishPrivateHostExtensionBlob(real, encoder.encode("bundle\n"))).rejects.toBeDefined();
      expect(await readdir(outside)).toEqual([]);
      await unlink(join(real, "host-extensions"));

      await mkdir(join(real, "host-extensions"), { mode: 0o770 });
      await chmod(join(real, "host-extensions"), 0o770);
      await expect(publishPrivateHostExtensionBlob(real, encoder.encode("bundle\n"))).rejects.toMatchObject({
        code: "HOST_EXTENSION_ARTIFACT_STORE_PERMISSIONS",
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }, 30_000);
});

function artifactPath(store: string, reference: PrivateHostExtensionBlobRef): string {
  const hexadecimal = reference.digest.slice("sha256:".length);
  return join(
    store,
    "host-extensions",
    "v1",
    "sha256",
    hexadecimal.slice(0, 2),
    `${hexadecimal.slice(2)}.blob`,
  );
}

function testBlobReference(bytes: Uint8Array): PrivateHostExtensionBlobRef {
  return {
    kind: "host-extension-blob/1",
    digest: `sha256:${createHash("sha256")
      .update("JIG-Host-Extension-Blob/1\0", "ascii")
      .update(bytes)
      .digest("hex")}`,
    bytes: bytes.byteLength,
  } as PrivateHostExtensionBlobRef;
}

function stagingPath(store: string): string {
  return join(store, "host-extensions", "v1", "staging");
}

async function currentTestStageLease(): Promise<{
  readonly bootId: string;
  readonly namespaceDevice: string;
  readonly namespaceInode: string;
  readonly startTime: string;
  readonly prefix: string;
}> {
  const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8"))
    .trim()
    .replaceAll("-", "")
    .toLowerCase();
  const namespace = await stat("/proc/self/ns/pid", { bigint: true });
  const processStat = await readFile("/proc/self/stat", "utf8");
  const fields = processStat.slice(processStat.lastIndexOf(")") + 1).trim().split(/\s+/);
  const startTime = fields[19]!;
  const namespaceDevice = namespace.dev.toString(10);
  const namespaceInode = namespace.ino.toString(10);
  return {
    bootId,
    namespaceDevice,
    namespaceInode,
    startTime,
    prefix: [".stage", bootId, namespaceDevice, namespaceInode, process.pid, startTime].join("-"),
  };
}

async function withStore(action: (store: string) => Promise<void>): Promise<void> {
  const store = await mkdtemp(join(tmpdir(), "jig-host-extension-store-"));
  try {
    await action(store);
  } finally {
    await rm(store, { recursive: true, force: true });
  }
}
