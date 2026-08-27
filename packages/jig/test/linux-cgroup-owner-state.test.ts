import { describe, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cancelPrivateLinuxOwnerStateAllocation,
  normalizePrivateLinuxOwnerStateAllocationIdentity,
  planPrivateLinuxOwnerStateAllocation,
  PrivateLinuxFenceUnconfirmedError,
  releasePrivateLinuxOwnerState,
} from "../src/internal/linux-cgroup-backend.js";

describe("private Linux durable owner allocation", () => {
  test("plans without creating a leaf and cancellation is durable and idempotent", async () => {
    const parent = await protectedDirectory("jig-linux-owner-allocation-");
    try {
      const allocation = await planPrivateLinuxOwnerStateAllocation({ parent, name: "run-one" });
      expect(normalizePrivateLinuxOwnerStateAllocationIdentity(
        JSON.parse(JSON.stringify(allocation)),
      )).toEqual(allocation);
      await expect(lstat(allocation.directory)).rejects.toMatchObject({ code: "ENOENT" });

      const first = await cancelPrivateLinuxOwnerStateAllocation(allocation);
      const second = await cancelPrivateLinuxOwnerStateAllocation(
        JSON.parse(JSON.stringify(allocation)),
      );
      expect(second).toEqual(first);
      expect(JSON.parse(await readFile(join(allocation.directory, "claim.json"), "utf8"))).toEqual({
        allocationDigest: allocation.digest,
        kind: "private-linux-owner-claim/1",
        state: "cancelled",
        token: allocation.ownerToken,
      });

      const released = await releasePrivateLinuxOwnerState(allocation, first);
      expect(await releasePrivateLinuxOwnerState(allocation, first)).toEqual(released);
      await expect(lstat(allocation.directory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("repairs only an inert partial owner record before cancellation", async () => {
    const parent = await protectedDirectory("jig-linux-owner-incomplete-");
    try {
      const allocation = await planPrivateLinuxOwnerStateAllocation({ parent, name: "run-two" });
      await mkdir(allocation.directory, { mode: 0o700 });
      await writeFile(join(allocation.directory, "owner.json"), "{", { mode: 0o600 });

      await cancelPrivateLinuxOwnerStateAllocation(allocation);
      expect(JSON.parse(await readFile(join(allocation.directory, "owner.json"), "utf8"))).toEqual({
        allocationDigest: allocation.digest,
        kind: "private-linux-owner-state/1",
        token: allocation.ownerToken,
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("does not erase unexpected caller-owned state or steal an active claim", async () => {
    const parent = await protectedDirectory("jig-linux-owner-preserve-");
    try {
      const unexpected = await planPrivateLinuxOwnerStateAllocation({ parent, name: "run-three" });
      await mkdir(unexpected.directory, { mode: 0o700 });
      await writeFile(join(unexpected.directory, "owner.json"), "{", { mode: 0o600 });
      await writeFile(join(unexpected.directory, "keep.txt"), "caller-owned\n", { mode: 0o600 });
      await expect(cancelPrivateLinuxOwnerStateAllocation(unexpected)).rejects.toThrow(
        "incomplete Linux owner state contains unexpected entries",
      );
      expect(await readFile(join(unexpected.directory, "keep.txt"), "utf8")).toBe("caller-owned\n");

      const active = await planPrivateLinuxOwnerStateAllocation({ parent, name: "run-four" });
      await mkdir(active.directory, { mode: 0o700 });
      await writeFile(join(active.directory, "owner.json"), `${JSON.stringify({
        allocationDigest: active.digest,
        kind: "private-linux-owner-state/1",
        token: active.ownerToken,
      })}\n`, { mode: 0o600 });
      await writeFile(join(active.directory, "claim.json"), `${JSON.stringify({
        allocationDigest: active.digest,
        kind: "private-linux-owner-claim/1",
        state: "active",
        token: active.ownerToken,
      })}\n`, { mode: 0o600 });
      await expect(cancelPrivateLinuxOwnerStateAllocation(active)).rejects.toBeInstanceOf(
        PrivateLinuxFenceUnconfirmedError,
      );
      expect(JSON.parse(await readFile(join(active.directory, "claim.json"), "utf8"))).toMatchObject({
        state: "active",
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("resumes an exact marker-backed release after interruption", async () => {
    const parent = await protectedDirectory("jig-linux-owner-release-");
    try {
      const allocation = await planPrivateLinuxOwnerStateAllocation({ parent, name: "run-five" });
      const cancellation = await cancelPrivateLinuxOwnerStateAllocation(allocation);
      await writeFile(join(allocation.directory, "release.json"), `${JSON.stringify({
        allocationDigest: allocation.digest,
        directoryDevice: cancellation.directoryDevice,
        directoryInode: cancellation.directoryInode,
        kind: "private-linux-owner-state-release-marker/1",
        proofDigest: cancellation.digest,
      })}\n`, { mode: 0o600 });
      await unlink(join(allocation.directory, "owner.json"));

      const released = await releasePrivateLinuxOwnerState(allocation, cancellation);
      expect(released).toMatchObject({
        allocationDigest: allocation.digest,
        released: true,
      });
      await expect(lstat(allocation.directory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

async function protectedDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await chmod(directory, 0o700);
  return directory;
}
