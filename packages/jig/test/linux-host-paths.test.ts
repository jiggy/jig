import { describe, expect, test } from "bun:test";
import {
  privateLinuxHostToolCandidates,
  resolvePrivateLinuxHostLoader,
  resolvePrivateLinuxHostPath,
} from "../src/internal/linux-host-paths.js";

const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });

describe("system-owned Linux host paths", () => {
  for (const tool of ["bwrap", "systemd-run", "systemctl"] as const) {
    test(`resolves ${tool} through the NixOS system profile without PATH`, async () => {
      const visited: string[] = [];
      const resolved = await resolvePrivateLinuxHostPath(privateLinuxHostToolCandidates(tool), async (path) => {
        visited.push(path);
        if (path === `/run/current-system/sw/bin/${tool}`) return `/nix/store/fixed-tool/bin/${tool}`;
        throw missing();
      });
      expect(resolved).toBe(`/nix/store/fixed-tool/bin/${tool}`);
      expect(visited).toEqual([`/usr/bin/${tool}`, `/bin/${tool}`, `/run/current-system/sw/bin/${tool}`]);
    });
  }

  test("fails rather than guessing a host executable", async () => {
    await expect(resolvePrivateLinuxHostPath(privateLinuxHostToolCandidates("bwrap"), async () => {
      throw missing();
    })).rejects.toThrow("system-owned host file is unavailable");
  });

  test("does not hide access errors behind another path", async () => {
    const visited: string[] = [];
    await expect(resolvePrivateLinuxHostPath(privateLinuxHostToolCandidates("bwrap"), async (path) => {
      visited.push(path);
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    })).rejects.toThrow("denied");
    expect(visited).toEqual(["/usr/bin/bwrap"]);
  });

  test("selects real NixOS glibc, not the FHS nix-ld shim", async () => {
    const visited: string[] = [];
    const resolved = await resolvePrivateLinuxHostLoader(async (path) => {
      visited.push(path);
      return "/nix/store/fixed-glibc/lib/ld-linux-x86-64.so.2";
    });
    expect(resolved).toBe("/nix/store/fixed-glibc/lib/ld-linux-x86-64.so.2");
    expect(visited).toEqual(["/run/current-system/sw/share/nix-ld/lib/ld.so"]);
  });

  test("uses the FHS glibc loader on hosts without nix-ld", async () => {
    expect(await resolvePrivateLinuxHostLoader(async (path) => {
      if (path.startsWith("/run/")) throw missing();
      return "/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2";
    })).toBe("/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2");
  });
});
