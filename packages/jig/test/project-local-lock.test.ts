import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { canonicalJson, JSON_1_LIMITS, type JsonValue } from "../src/json.js";
import {
  createPrivateProjectLocalLock,
  decodePrivateProjectLocalLock,
  encodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
  requirePrivateProjectLocalLock,
} from "../src/internal/project-local-lock.js";
import { defineJig } from "../src/project/author.js";
import { captureFlowSource } from "../src/project/flow-source.js";
import {
  linkPackageProject,
  type InjectedBindingDeclaration,
  type PackageProjectValue,
} from "../src/project/package-project.js";
import {
  retainFlowSourcePackages,
  type RetainedFlowInput,
} from "../src/project/retained-flow.js";

const encoder = new TextEncoder();
const schemaUri = "https://flow.dev/schemas/schema-1.json";

describe("private package-project portable lock projection", () => {
  test("has one empty canonical byte vector and authenticated identity", () => {
    const bytes = encoder.encode(
      '{"bindings":{},"packages":{}}\n',
    );
    const value = decodePrivateProjectLocalLock(bytes);

    expect(encodePrivateProjectLocalLock(value)).toEqual(bytes);
    expect(privateProjectLocalLockDigest(value)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(requirePrivateProjectLocalLock(value)).toBe(value);
    expect(Object.isFrozen(value)).toBeTrue();
    expect(Object.isFrozen(value.packages)).toBeTrue();
    expect(() => requirePrivateProjectLocalLock(structuredClone(value))).toThrow(
      "was not built or strictly decoded",
    );
  });

  test("projects exact package, Binding settings, and attachment choices", async () => {
    await withFlows(projectTrees(), async (flows) => {
      const project = linkedProject(flows, 3);
      const lock = createPrivateProjectLocalLock(project);
      expect(() => createPrivateProjectLocalLock(structuredClone(project))).toThrow(
        "not produced by the package-project linker",
      );

      expect(lock.packages["flows/configured"]).toMatchObject({
        directRun: false,
        attachments: { source: "read-write" },
      });
      expect(lock.packages["flows/worker"]).toMatchObject({
        directRun: true,
        attachments: {},
      });
      expect(lock.bindings.configured).toEqual({
        packagePath: "flows/configured",
        settings: { maxRetries: 3 },
        attachments: { source: { source: "workspace", access: "read-write" } },
      });

      const encoded = encodePrivateProjectLocalLock(lock);
      const decoded = decodePrivateProjectLocalLock(encoded);
      expect(encodePrivateProjectLocalLock(decoded)).toEqual(encoded);
      expect(privateProjectLocalLockDigest(decoded)).toBe(privateProjectLocalLockDigest(lock));
      expect(Object.isFrozen(decoded.packages["flows/configured"])).toBeTrue();
      expect(Object.isFrozen(decoded.bindings.configured.attachments.source)).toBeTrue();
    });
  });

  test("changes when package bytes or Binding settings change", async () => {
    let first: Uint8Array | undefined;
    await withFlows(projectTrees(), async (flows) => {
      first = encodePrivateProjectLocalLock(createPrivateProjectLocalLock(linkedProject(flows, 3)));
      const changedSettings = encodePrivateProjectLocalLock(
        createPrivateProjectLocalLock(linkedProject(flows, 9)),
      );
      expect(changedSettings).not.toEqual(first);
    });

    const changed = projectTrees();
    changed["flows/worker"]!["flow.ts"] = "export const changed = true;\n";
    await withFlows(changed, async (flows) => {
      const second = encodePrivateProjectLocalLock(createPrivateProjectLocalLock(linkedProject(flows, 3)));
      expect(second).not.toEqual(first!);
    });
  });

  test("rejects alternate spelling and forged fields", () => {
    const canonical = {
      packages: {},
      bindings: {},
    };
    const valid = lockBytes(canonical);
    expect(() => decodePrivateProjectLocalLock(valid)).not.toThrow();
    expect(() => decodePrivateProjectLocalLock(valid.subarray(0, valid.length - 1))).toThrow(
      "not in canonical",
    );
    expect(() => decodePrivateProjectLocalLock(encoder.encode(
      JSON.stringify(canonical, null, 2) + "\n",
    ))).toThrow("not in canonical");
    expect(() => decodePrivateProjectLocalLock(encoder.encode(
      '{"packages":{},"packages":{},"bindings":{}}\n',
    ))).toThrow("duplicate object member");
    expect(() => decodePrivateProjectLocalLock(lockBytes({
      ...canonical,
      backend: { digest: `sha256:${"a".repeat(64)}` },
    }))).toThrow("must contain exactly");
    expect(() => decodePrivateProjectLocalLock(Uint8Array.from([0xef, 0xbb, 0xbf, ...valid]))).toThrow(
      "BOM is not allowed",
    );
  });

  test("strict decoding rejects corrupt packages and dangling Binding relations", async () => {
    await withFlows(projectTrees(), async (flows) => {
      const base = structuredClone(
        createPrivateProjectLocalLock(linkedProject(flows, 3)),
      ) as any;

      expectInvalid(base, (value) => {
        value.packages["flows/worker"].digest = `sha256:${"A".repeat(64)}`;
      }, "digest must be sha256");
      expectInvalid(base, (value) => {
        value.packages["flows/configured"].directRun = true;
      }, "cannot require attachments");
      expectInvalid(base, (value) => {
        value.bindings.configured.packagePath = "flows/missing";
      }, "selects an unknown package");
      expectInvalid(base, (value) => {
        value.bindings.configured.attachments.source.access = "read";
      }, "access does not match");
      expectInvalid(base, (value) => {
        value.packages["FLOWS/WORKER"] = value.packages["flows/worker"];
      }, "collide");
      expectInvalid(base, (value) => {
        value.packages[".JIG/worker"] = value.packages["flows/worker"];
      }, "protected .jig");
      expectInvalid(base, (value) => {
        value.bindings.configured.packagePath = ".jig/configured";
      }, "protected .jig");
      expectInvalid(base, (value) => {
        value.bindings.configured.attachments.source.source = ".jIg/secret";
      }, "protected .jig");
      expectInvalid(base, (value) => {
        value.packages["flows/configured"].unexpected = true;
      }, "must contain exactly");
    });
  });

  test("enforces attachment and aggregate activation-target bounds", () => {
    expect(() => decodePrivateProjectLocalLock(lockBytes(attachmentBoundLock(256)))).not.toThrow();
    expect(() => decodePrivateProjectLocalLock(lockBytes(attachmentBoundLock(257)))).toThrow(
      "exceeds 256 members",
    );
    expect(() => decodePrivateProjectLocalLock(lockBytes(rootPackageCollection(257)))).not.toThrow();
    expect(() => decodePrivateProjectLocalLock(lockBytes(rootPackageCollection(4_097)))).toThrow(
      "activation targets exceed 4096 targets",
    );
  });

  test("enforces the JSON/1 file-byte ceiling", () => {
    expect(() => decodePrivateProjectLocalLock(new Uint8Array(JSON_1_LIMITS.bytes + 1))).toThrow(
      "maximum bytes exceeded",
    );
  });
});

function attachmentBoundLock(count: number): unknown {
  const attachments = Object.fromEntries(Array.from({ length: count }, (_, index) => [
    `slot-${index}`,
    "read",
  ]));
  return {
    packages: {
      "flows/bounded": {
        digest: `sha256:${"b".repeat(64)}`,
        directRun: false,
        attachments,
      },
    },
    bindings: {},
  };
}

function rootPackageCollection(count: number): unknown {
  const packages = Object.fromEntries(Array.from({ length: count }, (_, index) => [
    `flows/item-${index}`,
    {
      digest: `sha256:${"e".repeat(64)}`,
      directRun: true,
      attachments: {},
    },
  ]));
  return { packages, bindings: {} };
}

function projectTrees(): Record<string, Record<string, string>> {
  return {
    "flows/configured": {
      "FLOW.md": metadata(`name: configured
description: Configured.
attachments:
  source: read-write`),
      "flow.ts": "export {};\n",
      "settings.schema.json": schema({
        type: "object",
        properties: { maxRetries: { type: "integer" } },
        required: ["maxRetries"],
        additionalProperties: false,
      }),
    },
    "flows/worker": {
      "FLOW.md": metadata("name: worker\ndescription: Worker."),
      "flow.ts": "export {};\n",
    },
  };
}

function linkedProject(flows: readonly RetainedFlowInput[], maxRetries: number): PackageProjectValue {
  return linkPackageProject({
    flows,
    bindings: [binding("bindings/configured.ts", {
      package: "flows/configured",
      settings: { maxRetries },
      attachments: { source: "workspace" },
    })],
  });
}

function binding(sourcePath: string, definition: unknown): InjectedBindingDeclaration {
  return { sourcePath, definition };
}

function metadata(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n`;
}

function schema(value: Record<string, unknown>): string {
  return JSON.stringify({ $schema: schemaUri, ...value });
}

async function withFlows(
  trees: Readonly<Record<string, Readonly<Record<string, string>>>>,
  action: (flows: readonly RetainedFlowInput[]) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "jig-project-lock-"));
  const store = join(root, "store");
  let source: Awaited<ReturnType<typeof captureFlowSource>> | undefined;
  try {
    await mkdir(store, { mode: 0o700 });
    for (const [path, tree] of Object.entries(trees)) {
      for (const [name, contents] of Object.entries(tree)) {
        const file = join(root, path, name);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, contents);
      }
    }
    source = await captureFlowSource(root, defineJig({ flows: Object.keys(trees) }).flows);
    await action(await retainFlowSourcePackages(store, source));
  } finally {
    await source?.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

function lockBytes(value: unknown): Uint8Array {
  const body = canonicalJson(value as JsonValue);
  const bytes = new Uint8Array(body.length + 1);
  bytes.set(body);
  bytes[body.length] = 0x0a;
  return bytes;
}

function expectInvalid(base: unknown, change: (value: any) => void, message: string): void {
  const value = structuredClone(base);
  change(value);
  expect(() => decodePrivateProjectLocalLock(lockBytes(value))).toThrow(message);
}
