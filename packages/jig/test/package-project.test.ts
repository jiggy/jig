import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  captureStoredPackage,
  type PackageArtifactRef,
} from "../src/internal/package-artifact-store.js";
import { defineJig } from "../src/project/author.js";
import { captureFlowSource } from "../src/project/flow-source.js";
import {
  linkPackageProject,
  type InjectedBindingDeclaration,
} from "../src/project/package-project.js";
import {
  retainFlowSourcePackages,
  type RetainedFlowInput,
} from "../src/project/retained-flow.js";

const schemaUri = "https://flow.dev/schemas/schema-1.json";

describe("private package-project linker", () => {
  test("retains captured Flow members without taking source ownership", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-retained-source-"));
    const store = join(root, "store");
    const packageRoot = join(root, "flows", "run");
    await mkdir(store, { mode: 0o700 });
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "FLOW.md"), metadata("name: run\ndescription: Run."));
    await writeFile(join(packageRoot, "flow.ts"), "export {};\n");
    const source = await captureFlowSource(root, defineJig({ flows: ["flows/run"] }).flows);
    try {
      const retained = await retainFlowSourcePackages(store, source);
      expect(retained).toHaveLength(1);
      await source.dispose();
      const reopened = await captureStoredPackage(store, retained[0]!.package);
      try {
        expect(new TextDecoder().decode(await reopened.read("flow.ts"))).toBe("export {};\n");
      } finally {
        await reopened.dispose();
      }
    } finally {
      await source.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("links and canonically orders minimal direct Run packages", async () => {
    await withFlows({
      "flows/z": run("z"),
      "flows/a": run("a"),
    }, async ([z, a]) => {
      const value = linkPackageProject({ flows: [z!, a!], bindings: [] });
      expect(value.flows.map((flow) => flow.provenance.projectPath)).toEqual(["flows/a", "flows/z"]);
      expect(value.flows.every((flow) => flow.directRun)).toBeTrue();
      expect(value.bindings).toEqual([]);
      expect(Object.isFrozen(value)).toBeTrue();
      expect(Object.isFrozen(value.flows)).toBeTrue();
      expectCode(
        () => linkPackageProject({ flows: [z!, a!], bindings: [] }, 1),
        "PROJECT_ACTIVATION_TARGET_LIMIT",
      );
    });
  });

  test("rejects forged retained inputs and oversized or active containers", () => {
    const forged = Object.freeze({
      provenance: Object.freeze({ membership: "exact", projectPath: "flows/forged" }),
      package: Object.freeze({ kind: "flow-package/1", digest: `sha256:${"a".repeat(64)}` }),
      inspected: Object.freeze({ digest: `sha256:${"a".repeat(64)}` }),
    });
    expectCode(
      () => linkPackageProject({ flows: [forged] as never, bindings: [] }),
      "PROJECT_FLOW_NOT_RETAINED",
    );
    expectCode(() => linkPackageProject({
      flows: new Array(65_537).fill(null) as never,
      bindings: [],
    }), "PROJECT_PACKAGE_LIMIT");

    let invoked = false;
    const flows = Object.defineProperty([], Symbol.iterator, {
      value: () => { invoked = true; return [][Symbol.iterator](); },
    });
    expectCode(() => linkPackageProject({ flows, bindings: [] }), "PROJECT_PACKAGE_INPUT");
    expect(invoked).toBeFalse();
  });

  test("bounds aggregate semantic work across individually valid Bindings", async () => {
    await withFlows({
      "flows/configurable": {
        "FLOW.md": metadata("name: configurable\ndescription: Configurable."),
        "flow.ts": "export {};\n",
        "settings.schema.json": schema({ type: "object" }),
      },
    }, async (flows) => {
      const settings = { values: new Array(60_000).fill(null) };
      expectCode(() => linkPackageProject({
        flows,
        bindings: Array.from({ length: 17 }, (_, index) => binding(
          `bindings/b-${index}.ts`,
          { package: "flows/configurable", settings },
        )),
      }), "PROJECT_PACKAGE_WORK_LIMIT");
    });
  });

  test("links a basic Binding with validated settings and attachments", async () => {
    await withFlows({
      "flows/review": {
        "FLOW.md": metadata(`name: review
description: Review.
attachments:
  source: read-write`),
        "flow.ts": "export {};\n",
        "settings.schema.json": schema({
          type: "object",
          properties: { maxRetries: { type: "integer", minimum: 1 } },
          required: ["maxRetries"],
          additionalProperties: false,
        }),
      },
    }, async (flows) => {
      expectCode(() => linkPackageProject({
        flows,
        bindings: [binding("bindings/review.ts", {
          package: "flows/review",
          settings: { maxRetries: 0 },
          attachments: { source: "workspace" },
        })],
      }), "PROJECT_BINDING_SETTINGS_INVALID", "/settings/maxRetries");
      const value = linkPackageProject({
        flows,
        bindings: [binding("bindings/review.ts", {
          package: "flows/review",
          settings: { maxRetries: 3 },
          attachments: { source: "workspace" },
        })],
      });
      expect(value.bindings).toEqual([{
        kind: "package",
        id: "review",
        declarationPath: "bindings/review.ts",
        packagePath: "flows/review",
        settings: { maxRetries: 3 },
        attachments: { source: { source: "workspace", access: "read-write" } },
      }]);
      expect(value.flows[0]!.directRun).toBeFalse();
    });
  });

  test("rejects capability-bearing packages at the direct-alpha linker boundary", async () => {
    await withFlows({
      "flows/consumer": {
        "FLOW.md": metadata(`name: consumer
description: Consumer.
uses:
  index:
    contract: ./contracts/index.capability.json`),
        "flow.ts": "export {};\n",
        "contracts/index.capability.json": capability("https://example.org/contracts/index"),
      },
    }, async (flows) => {
      expectCode(
        () => linkPackageProject({ flows, bindings: [] }),
        "PROJECT_FLOW_CAPABILITY_UNSUPPORTED",
      );
    });
  });

  test("rejects mismatched retained facts and declaration identities", async () => {
    await withFlows({ "flows/run": run("run") }, async ([flow]) => {
      const wrongReference = {
        ...flow!.package,
        digest: `sha256:${"0".repeat(64)}`,
      } as PackageArtifactRef;
      expectCode(() => linkPackageProject({
        flows: [{ ...flow!, package: wrongReference }],
        bindings: [],
      }), "PROJECT_FLOW_NOT_RETAINED");
      expectCode(() => linkPackageProject({
        flows: [flow!],
        bindings: [binding("bindings/Bad.ts", { package: "flows/run" })],
      }), "PROJECT_BINDING_ID");
      expectCode(() => linkPackageProject({
        flows: [flow!],
        bindings: [binding("bindings/one.ts", { package: "flows/missing" })],
      }), "PROJECT_BINDING_PACKAGE_MISSING");
    });
  });

  test("requires exact settings and attachment declarations", async () => {
    await withFlows({
      "flows/plain": run("plain"),
      "flows/configured": {
        "FLOW.md": metadata(`name: configured
description: Configured.
attachments:
  source: read`),
        "flow.ts": "export {};\n",
      },
    }, async (flows) => {
      expectCode(() => linkPackageProject({
        flows,
        bindings: [binding("bindings/plain.ts", {
          package: "flows/plain",
          settings: { unexpected: true },
        })],
      }), "PROJECT_BINDING_SETTINGS_UNDECLARED", "/settings");
      expectCode(() => linkPackageProject({
        flows,
        bindings: [binding("bindings/configured.ts", { package: "flows/configured" })],
      }), "PROJECT_BINDING_ATTACHMENTS", "/attachments/source");
      for (const source of [".jig/private", ".JIG/private"]) {
        expectCode(() => linkPackageProject({
          flows,
          bindings: [binding("bindings/configured.ts", {
            package: "flows/configured",
            attachments: { source },
          })],
        }), "PROJECT_BINDING_ATTACHMENT_PROTECTED", "/attachments/source");
      }
    });
  });

  test("retains deeply immutable semantic facts and linked values", async () => {
    await withFlows({
      "flows/immutable": {
        "FLOW.md": metadata(`name: immutable
description: Immutable.
attachments:
  source: read
x-state:
  nested:
    - safe`),
        "flow.ts": "export {};\n",
      },
    }, async (flows) => {
      const value = linkPackageProject({
        flows,
        bindings: [binding("bindings/immutable.ts", {
          package: "flows/immutable",
          attachments: { source: "workspace" },
        })],
      });
      const metadata = value.flows[0]!.metadata;
      expect(Object.isFrozen(metadata)).toBeTrue();
      expect(Object.isFrozen(value.flows[0]!.entrypoint)).toBeTrue();
      expect(Object.isFrozen(metadata.attachments)).toBeTrue();
      expect(Object.isFrozen(metadata.extensions["x-state"])).toBeTrue();
      expect(Object.isFrozen((metadata.extensions["x-state"] as { nested: readonly string[] }).nested)).toBeTrue();
      expect(() => { (metadata as { name: string }).name = "changed"; }).toThrow();
      expect(() => { (value.bindings[0]!.settings as Record<string, unknown>).extra = true; }).toThrow();
      expect(metadata.name).toBe("immutable");
    });
  });
});

function run(name: string): Record<string, string> {
  return {
    "FLOW.md": metadata(`name: ${name}\ndescription: ${name}.`),
    "flow.ts": "export {};\n",
  };
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

function capability(id: string): string {
  return JSON.stringify({
    $schema: "https://flow.dev/schemas/capability-contract-1.schema.json",
    flowCapabilityContract: 1,
    id,
    version: "1.0.0",
    methods: { call: { input: true, output: true, errors: {} } },
  });
}

async function withFlows(
  trees: Readonly<Record<string, Readonly<Record<string, string>>>>,
  action: (flows: readonly RetainedFlowInput[]) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "jig-package-project-"));
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

function expectCode(
  action: () => unknown,
  code: string,
  pointer?: string,
): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ code, ...(pointer === undefined ? {} : { pointer }) });
}
