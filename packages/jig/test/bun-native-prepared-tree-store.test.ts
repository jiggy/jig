import { describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  normalizePrivateBunNativePreparedCandidate,
  type PrivateBunNativePreparedCandidate,
} from "../src/internal/bun-native-prepared-candidate.js";
import {
  capturePrivateBunNativePreparedTree,
  normalizePrivateBunNativePreparedTreeRef,
  publishPrivateBunNativePreparedTree,
  type PrivateBunNativePreparedTreeRef,
} from "../src/internal/bun-native-prepared-tree-store.js";
import {
  observePrivateBunNativePreparation,
  type PrivateBunNativePreparationObservation,
} from "../src/internal/bun-native-preparation.js";
import { privateDomainDigest } from "../src/internal/identity.js";
import { canonicalJson, type JsonValue } from "../src/json.js";
import { defineJig } from "../src/project/author.js";
import { captureFlowSource, type CapturedFlowSource } from "../src/project/flow-source.js";
import { linkPackageProject } from "../src/project/package-project.js";
import { buildPrivateActivationRequests } from "../src/project/package-resolution.js";
import { retainFlowSourcePackages } from "../src/project/retained-flow.js";

const ARCHIVE_PATH = "vendor/flowmd-sdk-0.0.0.tgz";
const ARCHIVE = Uint8Array.of(0x1f, 0x8b, 0x08, 0x00, 0x46, 0x4c, 0x4f, 0x57);
const SDK_MANIFEST = JSON.stringify({
  name: "@flowmd/sdk",
  version: "0.0.0",
  type: "module",
  exports: "./dist/index.js",
});
const SDK_FILES = Object.freeze([
  file("dist/index.js", "export const prepared = true;\n"),
  file("package.json", SDK_MANIFEST),
]);

describe("private Bun native prepared-tree store", () => {
  test("publishes a distinct composite identity and reacquires the complete tree", async () => {
    await withFixture({}, async (fixture) => {
      const reference = await publishFixture(fixture);
      const serialized = JSON.stringify(reference);
      expect(reference.kind).toBe("private-bun-native-prepared-tree/1");
      expect(reference.digest).not.toBe(fixture.observation.packageDigest);
      expect(reference.sourcePackageDigest).toBe(fixture.observation.packageDigest);

      await fixture.disposeSource();
      await rm(join(fixture.root, "flows"), { recursive: true, force: true });
      const capture = await capturePrivateBunNativePreparedTree({
        preparedStoreRoot: fixture.preparedStore,
        packageStoreRoot: fixture.packageStore,
        reference: JSON.parse(serialized),
      });
      try {
        expect(new TextDecoder().decode(await capture.read("flow.ts")))
          .toContain("source = 'retained'");
        expect(new TextDecoder().decode(
          await capture.read("node_modules/@flowmd/sdk/dist/index.js"),
        )).toBe("export const prepared = true;\n");
        expect(capture.files.map((entry) => entry.path)).toContain(
          "node_modules/@flowmd/sdk/package.json",
        );
        const chunks: Uint8Array[] = [];
        for await (const chunk of capture.stream("node_modules/@flowmd/sdk/dist/index.js")) {
          chunks.push(chunk);
        }
        expect(Buffer.concat(chunks).toString()).toBe("export const prepared = true;\n");
        const first = capture.dispose();
        expect(capture.dispose()).toBe(first);
        await first;
        await expect(capture.read("flow.ts")).rejects.toMatchObject({
          code: "BUN_PREPARED_TREE_CLOSED",
        });
      } finally {
        await capture.dispose();
      }
    });
  });

  test("concurrent identical publications converge without stage residue", async () => {
    await withFixture({}, async (fixture) => {
      const references = await Promise.all(Array.from({ length: 8 }, () => publishFixture(fixture)));
      expect(new Set(references.map((value) => value.digest)).size).toBe(1);
      const finalPath = preparedArtifactPath(fixture.preparedStore, references[0]!);
      expect(await readdir(dirname(finalPath))).toEqual([finalPath.split("/").at(-1)!]);
    });
  });

  test("refuses source/dependency topology collisions before publication", async () => {
    await withFixture({
      sourceFiles: {
        "Node_Modules/@flowmd/sdk/dist/index.js": "source collision\n",
      },
    }, async (fixture) => {
      await expect(publishFixture(fixture)).rejects.toMatchObject({
        code: "BUN_PREPARED_TREE_SOURCE_COLLISION",
      });
      expect(await readdir(fixture.preparedStore)).toEqual([]);
    });
  });

  test("rejects forged evidence and hostile reference accessors without invoking them", async () => {
    await withFixture({}, async (fixture) => {
      let observationCalls = 0;
      const forgedObservation = Object.defineProperty({}, "digest", {
        enumerable: true,
        get() { observationCalls += 1; return fixture.observation.digest; },
      });
      await expect(publishPrivateBunNativePreparedTree({
        preparedStoreRoot: fixture.preparedStore,
        packageStoreRoot: fixture.packageStore,
        observation: forgedObservation as PrivateBunNativePreparationObservation,
        candidate: fixture.candidate,
      })).rejects.toThrow("was not produced by private inspection");
      expect(observationCalls).toBe(0);

      const reference = await publishFixture(fixture);
      let getterCalls = 0;
      const accessor = Object.defineProperty({ ...reference }, "digest", {
        enumerable: true,
        get() { getterCalls += 1; return reference.digest; },
      });
      expect(() => normalizePrivateBunNativePreparedTreeRef(accessor))
        .toThrow("enumerable data fields");
      expect(getterCalls).toBe(0);
    });
  });

  test("refuses a symlinked record and retained source drift", async () => {
    await withFixture({}, async (fixture) => {
      const reference = await publishFixture(fixture);
      const preparedPath = preparedArtifactPath(fixture.preparedStore, reference);
      await unlink(preparedPath);
      await symlink("/dev/null", preparedPath);
      await expect(captureFixture(fixture, reference)).rejects.toMatchObject({
        code: "BUN_PREPARED_TREE_CORRUPT",
      });

      await unlink(preparedPath);
      await publishFixture(fixture);
      await chmod(preparedPath, 0o440);
      await expect(captureFixture(fixture, reference)).rejects.toMatchObject({
        code: "BUN_PREPARED_TREE_CORRUPT",
      });
      await chmod(preparedPath, 0o400);
      await chmod(packageArtifactPath(fixture.packageStore, reference.sourcePackageDigest), 0o600);
      await expect(captureFixture(fixture, reference)).rejects.toMatchObject({
        code: "PACKAGE_ARTIFACT_CORRUPT",
      });
    });
  });

  test("independently rejects a content-addressed record with the wrong SDK manifest", async () => {
    await withFixture({}, async (fixture) => {
      const files = Object.freeze([
        file("dist/index.js", "export {};\n"),
        file("package.json", JSON.stringify({ name: "other", version: "0.0.0" })),
      ]);
      const totalBytes = files.reduce((sum, entry) =>
        sum + Buffer.from(entry.contentBase64, "base64").byteLength, 0);
      const candidateIdentity = {
        kind: "private-bun-native-prepared-candidate/1",
        observationDigest: fixture.observation.digest,
        requestDigest: fixture.observation.requestDigest,
        packageDigest: fixture.observation.packageDigest,
        dependencyDigest: fixture.observation.dependency.memberDigest,
        totalBytes,
        files,
      };
      const record = {
        kind: "private-bun-native-prepared-tree-record/1",
        sourcePackageDigest: fixture.observation.packageDigest,
        observationDigest: fixture.observation.digest,
        requestDigest: fixture.observation.requestDigest,
        candidateDigest: privateDomainDigest(
          "JIG-Private-Bun-Native-Prepared-Candidate/1",
          candidateIdentity as JsonValue,
        ),
        dependencyDigest: fixture.observation.dependency.memberDigest,
        files,
      };
      const reference: PrivateBunNativePreparedTreeRef = {
        kind: "private-bun-native-prepared-tree/1",
        digest: privateDomainDigest(
          "JIG-Private-Bun-Native-Prepared-Tree/1",
          record as JsonValue,
        ),
        sourcePackageDigest: record.sourcePackageDigest,
        observationDigest: record.observationDigest,
        requestDigest: record.requestDigest,
        candidateDigest: record.candidateDigest,
        dependencyDigest: record.dependencyDigest,
      };
      const path = preparedArtifactPath(fixture.preparedStore, reference);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await chmodTreeDirectories(fixture.preparedStore, dirname(path));
      await writeFile(path, canonicalJson(record as JsonValue), { mode: 0o400 });

      await expect(captureFixture(fixture, reference)).rejects.toMatchObject({
        code: "BUN_PREPARED_TREE_CORRUPT",
      });
    });
  });

  test("cleans a failed stage without replacing an unexpected final leaf", async () => {
    await withFixture({}, async (fixture) => {
      const reference = await publishFixture(fixture);
      const otherStore = join(fixture.root, "prepared-other");
      await mkdir(otherStore, { mode: 0o700 });
      const finalPath = preparedArtifactPath(otherStore, reference);
      await mkdir(finalPath, { recursive: true, mode: 0o700 });
      await chmodTreeDirectories(otherStore, finalPath);

      await expect(publishPrivateBunNativePreparedTree({
        preparedStoreRoot: otherStore,
        packageStoreRoot: fixture.packageStore,
        observation: fixture.observation,
        candidate: fixture.candidate,
      })).rejects.toMatchObject({ code: "BUN_PREPARED_TREE_CORRUPT" });
      const entries = await readdir(dirname(finalPath));
      expect(entries.filter((entry) => entry.startsWith(".stage-"))).toEqual([]);
      expect(entries).toContain(finalPath.split("/").at(-1)!);
    });
  });
});

interface Fixture {
  readonly root: string;
  readonly packageStore: string;
  readonly preparedStore: string;
  readonly observation: PrivateBunNativePreparationObservation;
  readonly candidate: PrivateBunNativePreparedCandidate;
  disposeSource(): Promise<void>;
}

async function withFixture(
  options: { readonly sourceFiles?: Readonly<Record<string, string | Uint8Array>> },
  action: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "jig-prepared-tree-"));
  const packageStore = join(root, "package-store");
  const preparedStore = join(root, "prepared-store");
  let source: CapturedFlowSource | undefined;
  let disposed = false;
  try {
    await mkdir(packageStore, { mode: 0o700 });
    await mkdir(preparedStore, { mode: 0o700 });
    await writeTree(join(root, "flows/reviewer"), {
      "FLOW.md": "---\nname: reviewer\ndescription: Review one value.\n---\n",
      "flow.ts": "#!/usr/bin/env bun\nexport const source = 'retained';\n",
      "package.json": JSON.stringify({
        private: true,
        type: "module",
        dependencies: { "@flowmd/sdk": `file:./${ARCHIVE_PATH}` },
      }),
      [ARCHIVE_PATH]: ARCHIVE,
      ...options.sourceFiles,
    });
    source = await captureFlowSource(root, defineJig({ flows: ["flows/reviewer"] }).flows);
    const flows = await retainFlowSourcePackages(packageStore, source);
    const project = linkPackageProject({
      flows,
      bindings: [{
        sourcePath: "bindings/reviewer.ts",
        definition: { package: "flows/reviewer" },
      }],
    });
    const request = buildPrivateActivationRequests(project).find((value) =>
      value.target.kind === "binding" && value.target.id === "reviewer");
    if (request === undefined) throw new Error("missing prepared-tree test request");
    const observation = await observePrivateBunNativePreparation({
      request,
      packageStoreRoot: packageStore,
    });
    const candidate = normalizePrivateBunNativePreparedCandidate(
      observation,
      candidateBytes(observation, SDK_FILES),
    );
    await action({
      root,
      packageStore,
      preparedStore,
      observation,
      candidate,
      async disposeSource() {
        if (disposed) return;
        disposed = true;
        await source!.dispose();
      },
    });
  } finally {
    if (!disposed) await source?.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

async function publishFixture(fixture: Fixture): Promise<PrivateBunNativePreparedTreeRef> {
  return await publishPrivateBunNativePreparedTree({
    preparedStoreRoot: fixture.preparedStore,
    packageStoreRoot: fixture.packageStore,
    observation: fixture.observation,
    candidate: fixture.candidate,
  });
}

async function captureFixture(fixture: Fixture, reference: PrivateBunNativePreparedTreeRef) {
  return await capturePrivateBunNativePreparedTree({
    preparedStoreRoot: fixture.preparedStore,
    packageStoreRoot: fixture.packageStore,
    reference,
  });
}

function file(path: string, contents: string): { readonly path: string; readonly contentBase64: string } {
  return Object.freeze({ path, contentBase64: Buffer.from(contents).toString("base64") });
}

function candidateBytes(
  observation: PrivateBunNativePreparationObservation,
  files: readonly { readonly path: string; readonly contentBase64: string }[],
): Uint8Array {
  return canonicalJson({
    kind: "private-bun-native-prepared-candidate/1",
    dependencyDigest: observation.dependency.memberDigest,
    files,
  });
}

function preparedArtifactPath(store: string, reference: PrivateBunNativePreparedTreeRef): string {
  const hexadecimal = reference.digest.slice("sha256:".length);
  return join(
    store,
    "prepared",
    "bun-v1",
    "sha256",
    hexadecimal.slice(0, 2),
    `${hexadecimal.slice(2)}.tree`,
  );
}

function packageArtifactPath(store: string, digest: string): string {
  const hexadecimal = digest.slice("sha256:".length);
  return join(
    store,
    "packages",
    "v1",
    "sha256",
    hexadecimal.slice(0, 2),
    `${hexadecimal.slice(2)}.pkg`,
  );
}

async function chmodTreeDirectories(root: string, leaf: string): Promise<void> {
  let current = root;
  await chmod(current, 0o700);
  const relative = leaf.slice(root.length).split("/").filter(Boolean);
  for (const segment of relative) {
    current = join(current, segment);
    await chmod(current, 0o700);
  }
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
