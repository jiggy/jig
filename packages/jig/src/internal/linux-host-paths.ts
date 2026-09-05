import { realpath } from "node:fs/promises";

/** System-owned locations only; project files and ambient PATH never select tools. */
export function privateLinuxHostToolCandidates(
  name: "bwrap" | "systemd-run" | "systemctl",
): readonly string[] {
  return [`/usr/bin/${name}`, `/bin/${name}`, `/run/current-system/sw/bin/${name}`];
}

/** Resolve names only. Callers still validate files, features, and retained identity. */
export async function resolvePrivateLinuxHostPath(
  candidates: readonly string[],
  resolve: (path: string) => Promise<string> = realpath,
): Promise<string> {
  for (const path of candidates) {
    try {
      return await resolve(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("the required system-owned host file is unavailable");
}

export function resolvePrivateLinuxHostLoader(
  resolve: (path: string) => Promise<string> = realpath,
): Promise<string> {
  // nix-ld's system-managed link points to glibc itself. Never mount the
  // /lib64 nix-ld shim, which would require its host configuration in a Run.
  return resolvePrivateLinuxHostPath([
    "/run/current-system/sw/share/nix-ld/lib/ld.so",
    "/lib64/ld-linux-x86-64.so.2",
  ], resolve);
}
