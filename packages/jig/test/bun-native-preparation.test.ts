import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  classifyPrivateBunRetainedDependencies,
  observePrivateBunNativePreparation,
  requirePrivateBunRetainedDependencyClassification,
  requirePrivateBunNativePreparationObservation,
} from "../src/internal/bun-native-preparation.js";
import {
  revalidatePrivateBunNativeRunRecipe,
  requirePrivateBunNativeRunRecipe,
} from "../src/internal/bun-native-run-recipe.js";
import {
  requirePrivateBunNativePreparationControllerObservation,
} from "../src/internal/bun-native-preparation-controller.js";
import {
  observePrivateRuntimeSupport,
  type PrivateRuntimeSupportObservation,
} from "../src/internal/runtime-support.js";
import {
  planPrivateDirectRun,
  requirePrivateDirectRunRecipe,
  runPrivateDirectRunRecipe,
} from "../src/internal/direct-run.js";
import { privateFileDigest } from "../src/internal/identity.js";
import { PrivateLinuxCgroupBackend } from "../src/internal/linux-rootless-backend.js";
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
const hostPlanningTest = process.platform === "linux" &&
  process.env.AGENT_RUNTIME_RECEIPTS_DIR !== undefined &&
  process.env.AGENT_DELEGATED_CGROUP !== undefined
  ? test
  : test.skip;

describe("private Bun native preparation relation", () => {
  test("classifies retained dependency bytes as none or the one exact requirement", async () => {
    await withRunBinding({ includeManifest: false }, async ({ store, request }) => {
      const classification = await classifyPrivateBunRetainedDependencies({
        request,
        packageStoreRoot: store,
      });
      expect(classification).toMatchObject({
        kind: "private-bun-retained-dependency-classification/1",
        state: "none",
        requestDigest: request.digest,
        packageDigest: request.package.digest,
        preparationObservation: null,
      });
      expect(Object.isFrozen(classification)).toBeTrue();
      expect(requirePrivateBunRetainedDependencyClassification(classification)).toBe(classification);
    });

    await withRunBinding({ manifest: JSON.stringify({ private: true, type: "module" }) },
      async ({ store, request }) => {
        expect((await classifyPrivateBunRetainedDependencies({
          request,
          packageStoreRoot: store,
        })).state).toBe("none");
      });

    await withRunBinding({}, async ({ store, request }) => {
      const first = await classifyPrivateBunRetainedDependencies({
        request,
        packageStoreRoot: store,
      });
      const second = await classifyPrivateBunRetainedDependencies({
        request,
        packageStoreRoot: store,
      });
      expect(first.state).toBe("exact-required");
      expect(first.digest).toBe(second.digest);
      if (first.state !== "exact-required") throw new Error("expected exact dependency relation");
      expect(first.preparationObservation.dependency.memberPath).toBe(ARCHIVE_PATH);
      expect(requirePrivateBunNativePreparationObservation(first.preparationObservation))
        .toBe(first.preparationObservation);
    });
  });

  test("makes every unsupported dependency shape unavailable instead of dependency-free", async () => {
    await withRunBinding({
      manifest: JSON.stringify({ dependencies: { "@flowmd/sdk": "0.0.0" } }),
    }, async ({ store, request }) => {
      await expect(classifyPrivateBunRetainedDependencies({
        request,
        packageStoreRoot: store,
      })).rejects.toMatchObject({
        kind: "unavailable",
        code: "BUN_NATIVE_DEPENDENCY_SOURCE",
      });
    });

    await withRunBinding({}, async ({ store, directRequest }) => {
      await expect(classifyPrivateBunRetainedDependencies({
        request: directRequest,
        packageStoreRoot: store,
      })).rejects.toMatchObject({
        kind: "unavailable",
        code: "BUN_NATIVE_TARGET_UNSUPPORTED",
      });
    });

    for (const sourceNodeModule of ["node_modules/foreign/index.js", "lib/node_modules/foreign/index.js"]) {
      await withRunBinding({
        manifest: JSON.stringify({ private: true }),
        sourceNodeModule,
      }, async ({ store, request }) => {
        await expect(classifyPrivateBunRetainedDependencies({
          request,
          packageStoreRoot: store,
        })).rejects.toMatchObject({
          kind: "unavailable",
          code: "BUN_NATIVE_SOURCE_CONFLICT",
        });
      });
    }

    for (const manifest of [
      { dependenciesMeta: {} },
      { installConfig: {} },
      { packageManager: "bun@1" },
      { pnpm: {} },
    ]) {
      await withRunBinding({ manifest: JSON.stringify(manifest) }, async ({ store, request }) => {
        await expect(classifyPrivateBunRetainedDependencies({
          request,
          packageStoreRoot: store,
        })).rejects.toMatchObject({
          kind: "unavailable",
          code: "BUN_NATIVE_MANIFEST_FIELD_UNSUPPORTED",
        });
      });
    }

    for (const lockfile of [
      "bun.lock",
      "bun.lockb",
      "npm-shrinkwrap.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
    ]) {
      await withRunBinding({ includeManifest: false, lockfile }, async ({ store, request }) => {
        await expect(classifyPrivateBunRetainedDependencies({
          request,
          packageStoreRoot: store,
        })).rejects.toMatchObject({
          kind: "unavailable",
          code: "BUN_NATIVE_LOCKFILE_UNSUPPORTED",
          path: lockfile,
        });
      });
    }

    let accessed = false;
    const forged = Object.defineProperty({}, "state", {
      get() {
        accessed = true;
        return "none";
      },
    });
    expect(() => requirePrivateBunRetainedDependencyClassification(forged)).toThrow(
      "was not produced by private inspection",
    );
    expect(accessed).toBeFalse();
  });

  hostPlanningTest("plans a distinct path-independent native Run identity without executing it", async () => {
    const host = await unprivilegedPlanningHost();
    await withRunBinding({}, async ({ root, store, request }) => {
      const workerA = join(root, "worker-a.js");
      const workerB = join(root, "relocated", "worker-b.js");
      const workerBytes = "export {};\n";
      await writeFile(workerA, workerBytes);
      await mkdir(dirname(workerB), { recursive: true });
      await writeFile(workerB, workerBytes);
      const workerBundleDigest = await privateFileDigest(workerA);
      const nativeInput = {
        workerBundleDigest,
      } as const;
      const first = await planPrivateDirectRun({
        request,
        runtimeSupport: host.runtimeSupport,
        backend: host.backend,
        packageStoreRoot: store,
        bunNativePreparation: { ...nativeInput, workerBundlePath: workerA },
      });
      const relocated = await planPrivateDirectRun({
        request,
        runtimeSupport: host.runtimeSupport,
        backend: host.backend,
        packageStoreRoot: store,
        bunNativePreparation: { ...nativeInput, workerBundlePath: workerB },
      });

      expect(first.kind).toBe("private-bun-native-run-recipe/1");
      if (first.kind !== "private-bun-native-run-recipe/1" ||
          relocated.kind !== "private-bun-native-run-recipe/1") {
        throw new Error("expected native Run recipes");
      }
      expect(requirePrivateBunNativeRunRecipe(first)).toBe(first);
      expect(requirePrivateDirectRunRecipe(first)).toBe(first);
      expect(first.observation.preparationPlanDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(first.observation.preparationEnvelopeDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(first.observation.inspectionDigest).toBe(first.preparationObservation.digest);
      expect(first.observation.toolchainDigest).toBe(host.runtimeSupport.digest);
      expect(first.mechanismDigest).toBe((await host.backend.observeMechanism()).digest);
      expect(first.workerBundleDigest).toBe(workerBundleDigest);
      expect(requirePrivateBunNativePreparationControllerObservation(first.preparationController))
        .toBe(first.preparationController);
      expect(first.preparationController.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(first.preparationResourceCeilings).toBe(first.preparationController.resourceLimits);
      expect(first.workerBundlePath).not.toBe(relocated.workerBundlePath);
      expect(relocated.digest).toBe(first.digest);
      expect(relocated.observation.digest).toBe(first.observation.digest);
      expect(relocated.observation.preparationPlanDigest)
        .toBe(first.observation.preparationPlanDigest);
      expect(relocated.observation.preparationEnvelopeDigest)
        .toBe(first.observation.preparationEnvelopeDigest);
      await expect(revalidatePrivateBunNativeRunRecipe(first)).resolves.toBe(first);
      await writeFile(workerA, "export const changed = true;\n");
      await expect(revalidatePrivateBunNativeRunRecipe(first)).rejects.toThrow(
        "no longer matches retained host preparation support",
      );

      await expect(runPrivateDirectRunRecipe({
        recipe: first,
        packageStoreRoot: store,
        runId: "planning-only-native",
        invocation: {
          input: {},
          settings: request.settings,
          attachments: request.attachments,
          deadlineUnixMs: Date.now() + 10_000,
        },
      })).rejects.toThrow("execution is not joined");
    });

    await withRunBinding({ includeManifest: false }, async ({ root, store, request }) => {
      const worker = join(root, "unused-worker.js");
      await writeFile(worker, "export {};\n");
      const recipe = await planPrivateDirectRun({
        request,
        runtimeSupport: host.runtimeSupport,
        backend: host.backend,
        packageStoreRoot: store,
        bunNativePreparation: {
          workerBundlePath: worker,
          workerBundleDigest: await privateFileDigest(worker),
        },
      });
      expect(recipe.kind).toBe("private-bun-direct-recipe/1");
      expect(recipe.observation.preparationPlanDigest).toBeNull();
      expect(recipe.observation.preparationEnvelopeDigest).toBeNull();
    });

    await withRunBinding({}, async ({ store, request }) => {
      await expect(planPrivateDirectRun({
        request,
        runtimeSupport: host.runtimeSupport,
        backend: host.backend,
        packageStoreRoot: store,
      })).rejects.toThrow("no trusted host worker selection");
    });

    await withRunBinding({
      manifest: JSON.stringify({ dependencies: { "@flowmd/sdk": "0.0.0" } }),
    }, async ({ root, store, request }) => {
      const worker = join(root, "unavailable-worker.js");
      await writeFile(worker, "export {};\n");
      await expect(planPrivateDirectRun({
        request,
        runtimeSupport: host.runtimeSupport,
        backend: host.backend,
        packageStoreRoot: store,
        bunNativePreparation: {
          workerBundlePath: worker,
          workerBundleDigest: await privateFileDigest(worker),
        },
      })).rejects.toMatchObject({
        kind: "unavailable",
        code: "BUN_NATIVE_DEPENDENCY_SOURCE",
      });
    });
  }, 15_000);

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
    await withRunBinding({ sourceNodeModule: "nested/node_modules/foreign/index.js" }, async ({ store, request }) => {
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
    expect(() => requirePrivateBunNativePreparationControllerObservation(forged)).toThrow(
      "is not authentic",
    );
    expect(accessed).toBeFalse();
  });
});

async function withRunBinding(
  options: {
    readonly manifest?: string;
    readonly includeManifest?: boolean;
    readonly archive?: Uint8Array;
    readonly includeArchive?: boolean;
    readonly selector?: string;
    readonly sourceNodeModule?: string;
    readonly lockfile?: string;
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
    };
    if (options.includeManifest !== false) files["package.json"] = options.manifest ?? VALID_MANIFEST;
    if (options.includeArchive !== false) files[ARCHIVE_PATH] = options.archive ?? ARCHIVE;
    if (options.sourceNodeModule !== undefined) files[options.sourceNodeModule] = "export {};\n";
    if (options.lockfile !== undefined) files[options.lockfile] = "retained dependency state\n";
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

async function unprivilegedPlanningHost(): Promise<{
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly backend: PrivateLinuxCgroupBackend;
}> {
  const receiptsDirectory = process.env.AGENT_RUNTIME_RECEIPTS_DIR;
  if (receiptsDirectory === undefined) {
    throw new Error("planning test requires the retained runtime receipt");
  }
  const executablePath = await realpath("/bin/bun");
  const runtimeSupport = await observePrivateRuntimeSupport({
    supportId: "test-host-bun",
    executablePath,
    closureSources: await retainedClosureFixture(receiptsDirectory, executablePath),
  });
  return {
    runtimeSupport,
    backend: new PrivateLinuxCgroupBackend({ bunPath: executablePath }),
  };
}

async function retainedClosureFixture(
  receiptsDirectory: string,
  executablePath: string,
): Promise<readonly string[]> {
  const value: unknown = JSON.parse(
    await readFile(join(receiptsDirectory, "runtime-rootfs.json"), "utf8"),
  );
  if (!isRecord(value) || !Array.isArray(value.closure)) {
    throw new Error("planning test runtime receipt has no closure");
  }
  const closure = new Map<string, readonly string[]>();
  for (const raw of value.closure) {
    if (!isRecord(raw) || typeof raw.path !== "string" ||
        !Array.isArray(raw.references) ||
        !raw.references.every((reference) => typeof reference === "string")) {
      throw new Error("planning test runtime receipt contains an invalid closure entry");
    }
    closure.set(raw.path, raw.references as readonly string[]);
  }
  const start = [...closure.keys()].filter((path) =>
    executablePath === path || executablePath.startsWith(`${path}/`)
  ).sort((left, right) => right.length - left.length)[0];
  if (start === undefined) throw new Error("planning test Bun is outside the retained closure");

  const selected = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (selected.has(path)) continue;
    const references = closure.get(path);
    if (references === undefined) {
      throw new Error("planning test runtime receipt has an incomplete closure");
    }
    selected.add(path);
    pending.push(...references);
  }
  return [...selected].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
