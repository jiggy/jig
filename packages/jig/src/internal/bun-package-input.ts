import { CheckError } from "../diagnostics.js";
import type { CapturedPackage } from "../package/capture.js";

const MANIFEST = "package.json";
const LOCK = "bun.lock";
const MAX_MANIFEST_BYTES = 1024 * 1024;

export type PrivateBunPackageInput =
  | { readonly state: "direct" }
  | {
      readonly state: "locked";
      readonly manifestPath: typeof MANIFEST;
      readonly lockPath: typeof LOCK;
    };

/**
 * Classify the one Bun authoring shape supported by the alpha host.
 *
 * This is host policy, not Package/1 metadata. Package/1 already binds the
 * exact manifest and lock bytes when they are present.
 */
export async function inspectPrivateBunPackageInput(
  captured: CapturedPackage,
): Promise<PrivateBunPackageInput> {
  const paths = new Set(captured.files.map(({ path }) => path));
  if ([...paths].some((path) => path === "node_modules" || path.startsWith("node_modules/"))) {
    throw diagnostic(
      "invalid",
      "PACKAGE_BUN_NODE_MODULES",
      "node_modules is generated state; remove it and let jig review prepare the locked dependencies",
      "node_modules",
    );
  }

  const hasManifest = paths.has(MANIFEST);
  const hasLock = paths.has(LOCK);
  if (!hasManifest && !hasLock) {
    return Object.freeze({ state: "direct" as const });
  }
  if (!hasManifest) {
    throw diagnostic(
      "invalid",
      "PACKAGE_BUN_MANIFEST_MISSING",
      "bun.lock requires a package.json in the same FLOW package",
      MANIFEST,
    );
  }

  const manifest = await requireManifestObject(captured);
  if (!hasLock) {
    if (!declaresRuntimeDependencies(manifest)) {
      return Object.freeze({ state: "direct" as const });
    }
    throw diagnostic(
      "invalid",
      "PACKAGE_BUN_LOCK_MISSING",
      "package.json declares dependencies but bun.lock is missing; run bun install --lockfile-only",
      LOCK,
    );
  }
  if (paths.has(".npmrc")) {
    throw diagnostic(
      "invalid",
      "PACKAGE_BUN_CONFIG_UNSUPPORTED",
      "the direct alpha does not allow package-local .npmrc to influence dependency preparation",
      ".npmrc",
    );
  }
  return Object.freeze({
    state: "locked" as const,
    manifestPath: MANIFEST,
    lockPath: LOCK,
  });
}

async function requireManifestObject(captured: CapturedPackage): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    const bytes = await captured.read(MANIFEST, MAX_MANIFEST_BYTES);
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch (error) {
    if (error instanceof CheckError) throw error;
    throw diagnostic(
      "invalid",
      "PACKAGE_BUN_MANIFEST_INVALID",
      "package.json must be valid UTF-8 JSON with an object root",
      MANIFEST,
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw diagnostic(
      "invalid",
      "PACKAGE_BUN_MANIFEST_INVALID",
      "package.json must be valid UTF-8 JSON with an object root",
      MANIFEST,
    );
  }
  return value as Record<string, unknown>;
}

function declaresRuntimeDependencies(manifest: Record<string, unknown>): boolean {
  for (const field of ["dependencies", "optionalDependencies"] as const) {
    const value = manifest[field];
    if (value === undefined) continue;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return true;
    if (Object.keys(value).length > 0) return true;
  }
  return false;
}

function diagnostic(
  kind: "invalid" | "unavailable",
  code: string,
  message: string,
  path: string,
): CheckError {
  return new CheckError(kind, code, message, path);
}
