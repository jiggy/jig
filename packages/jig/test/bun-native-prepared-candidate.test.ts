import { describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  normalizePrivateBunNativePreparedCandidate,
  requirePrivateBunNativePreparedCandidate,
} from "../src/internal/bun-native-prepared-candidate.js";
import {
  observePrivateBunNativePreparation,
  type PrivateBunNativePreparationObservation,
} from "../src/internal/bun-native-preparation.js";
import { canonicalJson, type JsonValue } from "../src/json.js";
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
const MANIFEST = JSON.stringify({
  name: "@flowmd/sdk",
  version: "0.0.0",
  type: "module",
  exports: "./dist/index.js",
});
const RUNTIME_ENTRY = file("dist/index.js", "export const value = 1;\n");

describe("private Bun native prepared candidate", () => {
  test("normalizes one deterministic frozen candidate tied to authentic retained evidence", async () => {
    await withObservation({}, async ({ observation }) => {
      const files = [RUNTIME_ENTRY, file("package.json", MANIFEST)];
      const bytes = candidateBytes(observation, files);
      const first = normalizePrivateBunNativePreparedCandidate(observation, bytes);
      const second = normalizePrivateBunNativePreparedCandidate(observation, bytes);

      expect(first).toEqual(second);
      expect(first.digest).toBe(second.digest);
      expect(first.observationDigest).toBe(observation.digest);
      expect(first.requestDigest).toBe(observation.requestDigest);
      expect(first.packageDigest).toBe(observation.packageDigest);
      expect(first.dependencyDigest).toBe(observation.dependency.memberDigest);
      expect(first.totalBytes).toBe(
        Buffer.byteLength("export const value = 1;\n") + Buffer.byteLength(MANIFEST),
      );
      expect(first.files).toEqual(files);
      expect(Object.isFrozen(first)).toBeTrue();
      expect(Object.isFrozen(first.files)).toBeTrue();
      expect(first.files.every((entry) => Object.isFrozen(entry))).toBeTrue();
      expect(requirePrivateBunNativePreparedCandidate(first)).toBe(first);

      const changed = normalizePrivateBunNativePreparedCandidate(
        observation,
        candidateBytes(observation, [
          file("dist/index.js", "export const value = 2;\n"),
          file("package.json", MANIFEST),
        ]),
      );
      expect(changed.digest).not.toBe(first.digest);
    });
  });

  test("requires canonical bytes, the exact candidate shape, and the observed archive digest", async () => {
    await withObservation({}, async ({ observation }) => {
      const valid = candidateValue(observation, [RUNTIME_ENTRY, file("package.json", MANIFEST)]);
      const padded = Buffer.concat([Buffer.from(canonicalJson(valid)), Buffer.from("\n")]);
      expect(() => normalizePrivateBunNativePreparedCandidate(observation, padded)).toThrow(
        "not canonical JSON/1",
      );
      expect(() => normalizePrivateBunNativePreparedCandidate(
        observation,
        canonicalJson({ ...valid, extra: null }),
      )).toThrow("unexpected members");
      expect(() => normalizePrivateBunNativePreparedCandidate(
        observation,
        canonicalJson({ ...valid, kind: "other" }),
      )).toThrow("invalid identity");
      expect(() => normalizePrivateBunNativePreparedCandidate(
        observation,
        canonicalJson({ ...valid, dependencyDigest: `sha256:${"0".repeat(64)}` }),
      )).toThrow("invalid identity");
    });
  });

  test("rejects noncanonical base64, unsorted paths, path collisions, and missing identity", async () => {
    await withObservation({}, async ({ observation }) => {
      expect(() => normalizePrivateBunNativePreparedCandidate(
        observation,
        candidateBytes(observation, [{ path: "package.json", contentBase64: "e30" }]),
      )).toThrow("not canonical base64");

      expect(() => normalizePrivateBunNativePreparedCandidate(
        observation,
        candidateBytes(observation, [
          file("package.json", MANIFEST),
          file("dist/index.js", "export {};\n"),
        ]),
      )).toThrow("not strictly byte-sorted");

      expect(() => normalizePrivateBunNativePreparedCandidate(
        observation,
        candidateBytes(observation, [
          file("README", "a"),
          file("Readme", "b"),
          file("package.json", MANIFEST),
        ]),
      )).toThrow("collide under Unicode 15.1 case folding");

      expect(() => normalizePrivateBunNativePreparedCandidate(
        observation,
        candidateBytes(observation, [file("dist/index.js", "export {};\n")]),
      )).toThrow("missing package.json");

      expect(() => normalizePrivateBunNativePreparedCandidate(
        observation,
        candidateBytes(observation, [file("package.json", MANIFEST)]),
      )).toThrow("missing dist/index.js");

      expect(() => normalizePrivateBunNativePreparedCandidate(
        observation,
        candidateBytes(observation, [
          file("package.json", JSON.stringify({ name: "@flowmd/sdk", version: "1.0.0" })),
        ]),
      )).toThrow("must be exact @flowmd/sdk@0.0.0");
    });
  });

  test("enforces the file-count and decoded-byte ceilings before accepting output", async () => {
    await withObservation({}, async ({ observation }) => {
      expect(() => normalizePrivateBunNativePreparedCandidate(
        observation,
        new Uint8Array(2 * 1024 * 1024 + 1),
      )).toThrow("exceeds its byte bound");

      const tooMany = Array.from({ length: 257 }, (_, index) =>
        file(index === 256 ? "package.json" : `files/${String(index).padStart(3, "0")}`, index === 256 ? MANIFEST : ""));
      expect(() => normalizePrivateBunNativePreparedCandidate(
        observation,
        candidateBytes(observation, tooMany),
      )).toThrow("must contain 1-256 files");

      expect(() => normalizePrivateBunNativePreparedCandidate(
        observation,
        candidateBytes(observation, [
          file("large.bin", Buffer.alloc(1024 * 1024).toString("binary")),
          file("package.json", MANIFEST),
        ]),
      )).toThrow("exceeds 1048576 decoded bytes");

      const oversizedManifest = JSON.stringify({
        name: "@flowmd/sdk",
        version: "0.0.0",
        padding: "x".repeat(64 * 1024),
      });
      expect(() => normalizePrivateBunNativePreparedCandidate(
        observation,
        candidateBytes(observation, [RUNTIME_ENTRY, file("package.json", oversizedManifest)]),
      )).toThrow("package.json exceeds its byte bound");
    });
  });

  test("rejects another retained relation and forged values without invoking getters", async () => {
    await withObservation({}, async ({ observation }) => {
      const bytes = candidateBytes(observation, [RUNTIME_ENTRY, file("package.json", MANIFEST)]);
      await withObservation({ archive: Uint8Array.of(...ARCHIVE, 0xff) }, async ({ observation: other }) => {
        expect(() => normalizePrivateBunNativePreparedCandidate(other, bytes)).toThrow(
          "invalid identity",
        );
      });

      let observationGetterCalls = 0;
      const forgedObservation = Object.defineProperty({}, "digest", {
        get() {
          observationGetterCalls += 1;
          return observation.digest;
        },
      });
      expect(() => normalizePrivateBunNativePreparedCandidate(
        forgedObservation,
        bytes,
      )).toThrow("was not produced by private inspection");
      expect(observationGetterCalls).toBe(0);

      let byteGetterCalls = 0;
      const forgedBytes = Object.defineProperty({}, "byteLength", {
        get() {
          byteGetterCalls += 1;
          return bytes.byteLength;
        },
      });
      expect(() => normalizePrivateBunNativePreparedCandidate(
        observation,
        forgedBytes,
      )).toThrow("must be Uint8Array bytes");
      expect(byteGetterCalls).toBe(0);

      const candidate = normalizePrivateBunNativePreparedCandidate(observation, bytes);
      let candidateGetterCalls = 0;
      const forgedCandidate = Object.defineProperty({}, "kind", {
        get() {
          candidateGetterCalls += 1;
          return candidate.kind;
        },
      });
      expect(() => requirePrivateBunNativePreparedCandidate(forgedCandidate)).toThrow(
        "was not produced by private normalization",
      );
      expect(candidateGetterCalls).toBe(0);
    });
  });
});

function file(path: string, contents: string): { readonly path: string; readonly contentBase64: string } {
  return { path, contentBase64: Buffer.from(contents, "binary").toString("base64") };
}

function candidateValue(
  observation: PrivateBunNativePreparationObservation,
  files: readonly { readonly path: string; readonly contentBase64: string }[],
): JsonValue {
  return {
    kind: "private-bun-native-prepared-candidate/1",
    dependencyDigest: observation.dependency.memberDigest,
    files,
  };
}

function candidateBytes(
  observation: PrivateBunNativePreparationObservation,
  files: readonly { readonly path: string; readonly contentBase64: string }[],
): Uint8Array {
  return canonicalJson(candidateValue(observation, files));
}

async function withObservation(
  options: { readonly archive?: Uint8Array },
  action: (value: {
    readonly observation: PrivateBunNativePreparationObservation;
    readonly request: PrivateActivationRequest;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "jig-bun-native-candidate-"));
  const store = join(root, "store");
  let source: CapturedFlowSource | undefined;
  try {
    await mkdir(store, { mode: 0o700 });
    await writeTree(join(root, "flows/reviewer"), {
      "FLOW.md": "---\nname: reviewer\ndescription: Review one value.\n---\n",
      "flow.ts": "#!/usr/bin/env bun\nexport {};\n",
      "package.json": JSON.stringify({
        private: true,
        type: "module",
        dependencies: { "@flowmd/sdk": `file:./${ARCHIVE_PATH}` },
      }),
      [ARCHIVE_PATH]: options.archive ?? ARCHIVE,
    });
    source = await captureFlowSource(root, defineJig({ flows: ["flows/reviewer"] }).flows);
    const flows = await retainFlowSourcePackages(store, source);
    const project = linkPackageProject({
      flows,
      bindings: [{
        sourcePath: "bindings/reviewer.ts",
        definition: { package: "flows/reviewer" },
      }],
    });
    const request = buildPrivateActivationRequests(project).find((candidate) =>
      candidate.target.kind === "binding" && candidate.target.id === "reviewer");
    if (request === undefined) throw new Error("missing private Bun Run Binding request");
    const observation = await observePrivateBunNativePreparation({
      request,
      packageStoreRoot: store,
    });
    await action({ observation, request });
  } finally {
    await source?.dispose();
    await rm(root, { recursive: true, force: true });
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
