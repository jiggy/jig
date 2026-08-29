import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  observePrivateBunNativePreparation,
  requirePrivateBunNativePreparationObservation,
} from "../src/internal/bun-native-preparation.js";
import { defineJig } from "../src/project/author.js";
import { captureFlowSource, type CapturedFlowSource } from "../src/project/flow-source.js";
import { linkPackageProject } from "../src/project/package-project.js";
import {
  buildPrivateActivationRequests,
  type PrivateActivationRequest,
} from "../src/project/package-resolution.js";
import { retainFlowSourcePackages } from "../src/project/retained-flow.js";

const ARCHIVE_PATH = "vendor/flowmd-sdk-0.0.0.tgz";
const ARCHIVE = Uint8Array.of(0x1f, 0x8b, 0x08, 0x00, 0x46, 0x4c, 0x4f, 0x57);
const VALID_MANIFEST = JSON.stringify({
  name: "reviewer",
  private: true,
  type: "module",
  dependencies: { "@flowmd/sdk": `file:./${ARCHIVE_PATH}` },
});

describe("private Bun native preparation relation", () => {
  test("derives one frozen deterministic relation from retained Package/1 bytes", async () => {
    await withRunBinding({}, async ({ store, request }) => {
      const first = await observePrivateBunNativePreparation({
        request,
        packageStoreRoot: store,
      });
      const second = await observePrivateBunNativePreparation({
        request,
        packageStoreRoot: store,
      });

      expect(first).toEqual(second);
      expect(first.digest).toBe(second.digest);
      expect(first.requestDigest).toBe(request.digest);
      expect(first.packageDigest).toBe(request.package.digest);
      expect(first.dependency).toEqual({
        key: "@flowmd/sdk",
        memberPath: ARCHIVE_PATH,
        memberSize: ARCHIVE.byteLength,
        memberDigest: `sha256:${createHash("sha256").update(ARCHIVE).digest("hex")}`,
      });
      expect(Object.isFrozen(first)).toBeTrue();
      expect(Object.isFrozen(first.dependency)).toBeTrue();
      expect(requirePrivateBunNativePreparationObservation(first)).toBe(first);
    });

    await withRunBinding({ archive: Uint8Array.of(...ARCHIVE, 0xff) }, async ({ store, request }) => {
      const changed = await observePrivateBunNativePreparation({ request, packageStoreRoot: store });
      expect(changed.packageDigest).not.toBeUndefined();
      expect(changed.dependency.memberDigest).not.toBe(
        `sha256:${createHash("sha256").update(ARCHIVE).digest("hex")}`,
      );
    });
  });

  test("ignores visible-source mutation after retained publication", async () => {
    await withRunBinding({}, async ({ root, store, request }) => {
      const first = await observePrivateBunNativePreparation({ request, packageStoreRoot: store });
      await writeFile(join(root, "flows/reviewer/package.json"), JSON.stringify({
        dependencies: { other: "latest" },
      }));
      await writeFile(join(root, `flows/reviewer/${ARCHIVE_PATH}`), "mutated source bytes");
      const second = await observePrivateBunNativePreparation({ request, packageStoreRoot: store });

      expect(second).toEqual(first);
      expect(second.packageDigest).toBe(request.package.digest);
    });
  });

  test("requires the exact Bun flow.ts Run Binding request", async () => {
    await withRunBinding({}, async ({ store, request, directRequest }) => {
      await expect(observePrivateBunNativePreparation({
        request: directRequest,
        packageStoreRoot: store,
      })).rejects.toThrow("direct Flows are not yet covered");
      expect(request.target.kind).toBe("binding");
    });

    await withRunBinding({ selector: "deno" }, async ({ store, request }) => {
      await expect(observePrivateBunNativePreparation({
        request,
        packageStoreRoot: store,
      })).rejects.toThrow("matching flow.ts Run Binding activation");
    });
  });

  test("rejects malformed manifests and every unsupported dependency shape", async () => {
    const cases: readonly { readonly name: string; readonly manifest: string; readonly code: string }[] = [
      {
        name: "duplicate dependencies member",
        manifest: `{"dependencies":{"@flowmd/sdk":"file:./${ARCHIVE_PATH}"},"dependencies":{}}`,
        code: "BUN_NATIVE_MANIFEST_INVALID",
      },
      { name: "non-object root", manifest: "[]", code: "BUN_NATIVE_MANIFEST_SHAPE" },
      { name: "missing dependencies", manifest: "{}", code: "BUN_NATIVE_MANIFEST_SHAPE" },
      { name: "empty dependencies", manifest: '{"dependencies":{}}', code: "BUN_NATIVE_DEPENDENCY_SET" },
      {
        name: "second dependency",
        manifest: JSON.stringify({
          dependencies: { "@flowmd/sdk": `file:./${ARCHIVE_PATH}`, extra: "1.0.0" },
        }),
        code: "BUN_NATIVE_DEPENDENCY_SET",
      },
      {
        name: "non-string dependency",
        manifest: JSON.stringify({ dependencies: { "@flowmd/sdk": null } }),
        code: "BUN_NATIVE_DEPENDENCY_SOURCE",
      },
      {
        name: "registry dependency",
        manifest: JSON.stringify({ dependencies: { "@flowmd/sdk": "0.0.0" } }),
        code: "BUN_NATIVE_DEPENDENCY_SOURCE",
      },
      {
        name: "file dependency without dot slash",
        manifest: JSON.stringify({ dependencies: { "@flowmd/sdk": `file:${ARCHIVE_PATH}` } }),
        code: "BUN_NATIVE_DEPENDENCY_SOURCE",
      },
      {
        name: "traversal",
        manifest: JSON.stringify({ dependencies: { "@flowmd/sdk": "file:./vendor/../sdk.tgz" } }),
        code: "BUN_NATIVE_DEPENDENCY_SOURCE",
      },
      {
        name: "wrong archive suffix",
        manifest: JSON.stringify({ dependencies: { "@flowmd/sdk": "file:./vendor/sdk.tar" } }),
        code: "BUN_NATIVE_DEPENDENCY_SOURCE",
      },
      {
        name: "URL-encoded path",
        manifest: JSON.stringify({ dependencies: { "@flowmd/sdk": "file:./vendor/%2e%2e/sdk.tgz" } }),
        code: "BUN_NATIVE_DEPENDENCY_SOURCE",
      },
      {
        name: "second dependency collection",
        manifest: JSON.stringify({
          dependencies: { "@flowmd/sdk": `file:./${ARCHIVE_PATH}` },
          devDependencies: {},
        }),
        code: "BUN_NATIVE_DEPENDENCY_SET",
      },
    ];

    for (const item of cases) {
      await withRunBinding({ manifest: item.manifest }, async ({ store, request }) => {
        await expect(observePrivateBunNativePreparation({
          request,
          packageStoreRoot: store,
        })).rejects.toMatchObject({ kind: "unavailable", code: item.code });
      });
    }
  });

  test("treats a captured node_modules tree as recipe unavailability, not invalid FLOW", async () => {
    await withRunBinding({ sourceNodeModule: true }, async ({ store, request }) => {
      await expect(observePrivateBunNativePreparation({
        request,
        packageStoreRoot: store,
      })).rejects.toMatchObject({
        kind: "unavailable",
        code: "BUN_NATIVE_SOURCE_CONFLICT",
      });
    });
  });

  test("rejects missing and oversized package-local members before tar interpretation", async () => {
    await withRunBinding({ includeArchive: false }, async ({ store, request }) => {
      await expect(observePrivateBunNativePreparation({
        request,
        packageStoreRoot: store,
      })).rejects.toMatchObject({ code: "BUN_NATIVE_DEPENDENCY_MISSING" });
    });

    await withRunBinding({ archive: new Uint8Array(1024 * 1024 + 1) }, async ({ store, request }) => {
      await expect(observePrivateBunNativePreparation({
        request,
        packageStoreRoot: store,
      })).rejects.toMatchObject({ code: "BUN_NATIVE_DEPENDENCY_LIMIT" });
    });
  });

  test("fails closed when the protected Package/1 object is corrupted", async () => {
    await withRunBinding({}, async ({ store, request }) => {
      const artifact = packageArtifactPath(store, request);
      await chmod(artifact, 0o600);
      await appendFile(artifact, "corruption");
      await chmod(artifact, 0o400);

      await expect(observePrivateBunNativePreparation({
        request,
        packageStoreRoot: store,
      })).rejects.toMatchObject({ code: "PACKAGE_ARTIFACT_CORRUPT" });
    });
  });

  test("rejects forged observations without reading attacker properties", () => {
    let accessed = false;
    const forged = Object.defineProperty({}, "kind", {
      get() {
        accessed = true;
        return "private-bun-native-preparation-observation/1";
      },
    });
    expect(() => requirePrivateBunNativePreparationObservation(forged)).toThrow(
      "was not produced by private inspection",
    );
    expect(accessed).toBeFalse();
  });
});

async function withRunBinding(
  options: {
    readonly manifest?: string;
    readonly archive?: Uint8Array;
    readonly includeArchive?: boolean;
    readonly selector?: string;
    readonly sourceNodeModule?: boolean;
  },
  action: (value: {
    readonly root: string;
    readonly store: string;
    readonly request: PrivateActivationRequest;
    readonly directRequest: PrivateActivationRequest;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "jig-bun-native-preparation-"));
  const store = join(root, "store");
  let source: CapturedFlowSource | undefined;
  try {
    await mkdir(store, { mode: 0o700 });
    const files: Record<string, string | Uint8Array> = {
      "FLOW.md": "---\nname: reviewer\ndescription: Review one value.\n---\n",
      "flow.ts": `#!/usr/bin/env ${options.selector ?? "bun"}\nexport {};\n`,
      "package.json": options.manifest ?? VALID_MANIFEST,
    };
    if (options.includeArchive !== false) files[ARCHIVE_PATH] = options.archive ?? ARCHIVE;
    if (options.sourceNodeModule === true) files["node_modules/foreign/index.js"] = "export {};\n";
    await writeTree(join(root, "flows/reviewer"), files);

    source = await captureFlowSource(root, defineJig({ flows: ["flows/reviewer"] }).flows);
    const flows = await retainFlowSourcePackages(store, source);
    const project = linkPackageProject({
      flows,
      bindings: [{
        sourcePath: "bindings/reviewer.ts",
        definition: { package: "flows/reviewer" },
      }],
    });
    const requests = buildPrivateActivationRequests(project);
    const request = requests.find((candidate) =>
      candidate.target.kind === "binding" && candidate.target.id === "reviewer");
    const directRequest = requests.find((candidate) => candidate.target.kind === "flow");
    if (request === undefined || directRequest === undefined) throw new Error("missing Run requests");
    await action({ root, store, request, directRequest });
  } finally {
    await source?.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

function packageArtifactPath(store: string, request: PrivateActivationRequest): string {
  const hexadecimal = request.package.digest.slice("sha256:".length);
  return join(
    store,
    "packages",
    "v1",
    "sha256",
    hexadecimal.slice(0, 2),
    `${hexadecimal.slice(2)}.pkg`,
  );
}

async function writeTree(
  root: string,
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(root, ...path.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
}
