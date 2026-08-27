import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  captureStoredPackage,
  type PackageArtifactRef,
} from "../src/internal/package-artifact-store.js";
import { bindingRef, candidates, defineHook, defineJig, defineJournalPublisher, flowRef } from "../src/project/author.js";
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
const journalContract = await readFile(new URL(
  "../../../docs/spec/contracts/jig/journal.capability.json",
  import.meta.url,
), "utf8");

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
    });
  });

  test("rejects forged retained inputs and oversized or active containers", () => {
    const forged = Object.freeze({
      provenance: Object.freeze({ membership: "exact", projectPath: "flows/forged" }),
      package: Object.freeze({ kind: "flow-package/1", digest: `sha256:${"a".repeat(64)}` }),
      inspected: Object.freeze({ digest: `sha256:${"a".repeat(64)}` }),
    });
    expectCode(() => linkPackageProject({ flows: [forged] as never, bindings: [] }), "PROJECT_FLOW_NOT_RETAINED");
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

  test("bounds aggregate semantic work across individually valid declarations", async () => {
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

  test("joins settings, attachments, and configured flow-call targets", async () => {
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
      "flows/research": run("research"),
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
          slots: { research: flowRef("flows/research") },
        })],
      });
      expect(value.bindings[0]).toMatchObject({
        id: "review",
        packagePath: "flows/review",
        settings: { maxRetries: 3 },
        attachments: { source: { source: "workspace", access: "read-write" } },
        slots: {
          research: {
            kind: "flow-call",
            targets: [{ kind: "flow", path: "flows/research" }],
          },
        },
      });
    });
  });

  test("links one exact public contract export through a Service Binding", async () => {
    const contract = capability("https://example.org/contracts/index");
    await withFlows({
      "flows/consumer": {
        "FLOW.md": metadata(`name: consumer
description: Consumer.
uses:
  index:
    contract: ./contracts/index.capability.json`),
        "flow.ts": "export {};\n",
        "contracts/index.capability.json": contract,
      },
      "flows/provider": {
        "FLOW.md": metadata(`name: provider
description: Provider.
service: 1
provides:
  api: ./contracts/index.capability.json`),
        "flow.py": "#!/usr/bin/env python\n",
        "contracts/index.capability.json": contract,
      },
      "flows/run-provider": run("run-provider"),
    }, async (flows) => {
      expectCode(() => linkPackageProject({
        flows,
        bindings: [
          binding("bindings/provider.ts", { package: "flows/provider" }),
          binding("bindings/consumer.ts", { package: "flows/consumer" }),
        ],
      }), "PROJECT_BINDING_CAPABILITY_MISSING", "/slots/index");
      expectCode(() => linkPackageProject({
        flows,
        bindings: [
          binding("bindings/run-provider.ts", { package: "flows/run-provider" }),
          binding("bindings/consumer.ts", {
            package: "flows/consumer",
            slots: { index: bindingRef("run-provider") },
          }),
        ],
      }), "PROJECT_BINDING_CAPABILITY_MODE", "/slots/index");
      const value = linkPackageProject({
        flows,
        bindings: [
          binding("bindings/provider.ts", { package: "flows/provider" }),
          binding("bindings/consumer.ts", {
            package: "flows/consumer",
            slots: { index: bindingRef("provider") },
          }),
        ],
      });
      expect(value.bindings.map((item) => item.id)).toEqual(["consumer", "provider"]);
      expect(value.bindings[0]!.slots.index).toMatchObject({
        kind: "capability",
        contract: { id: "https://example.org/contracts/index", version: "1.0.0" },
        provider: { binding: "provider", export: "api" },
      });
      expect(Object.isFrozen(value.flows[0]!.metadata.uses!.index)).toBeTrue();
      expect(Object.isFrozen(value.flows[0]!.uses.index)).toBeTrue();
      expect(Object.isFrozen(value.flows[1]!.provides.api)).toBeTrue();
    });
  });

  test("links the exact Journal contract through one canonical publisher Binding", async () => {
    await withFlows({
      "flows/producer": {
        "FLOW.md": metadata(`name: producer
description: Producer.
uses:
  journal:
    contract: ./contracts/journal.capability.json`),
        "flow.ts": "export {};\n",
        "contracts/journal.capability.json": journalContract,
      },
      "flows/other": {
        "FLOW.md": metadata(`name: other
description: Other.
uses:
  journal:
    contract: ./contracts/other.capability.json`),
        "flow.ts": "export {};\n",
        "contracts/other.capability.json": capability("https://example.org/contracts/other"),
      },
    }, async (flows) => {
      expectCode(() => linkPackageProject({
        flows,
        bindings: [
          binding("bindings/publisher.ts", defineJournalPublisher({
            eventTypes: ["https://example.org/events/work-created"],
          })),
          binding("bindings/other.ts", {
            package: "flows/other",
            slots: { journal: bindingRef("publisher") },
          }),
        ],
      }), "PROJECT_BINDING_CAPABILITY_INCOMPATIBLE", "/slots/journal");
      const value = linkPackageProject({
        flows,
        bindings: [
          binding("bindings/publisher.ts", defineJournalPublisher({
            eventTypes: ["https://example.org/events/work-created"],
          })),
          binding("bindings/producer.ts", {
            package: "flows/producer",
            slots: { journal: bindingRef("publisher") },
          }),
        ],
      });
      expect(value.journalPublishers).toEqual([{
        kind: "journal-publisher",
        id: "publisher",
        declarationPath: "bindings/publisher.ts",
        source: "binding:publisher",
        contract: {
          id: "https://jig.dev/contracts/journal",
          version: "1.0.0",
          digest: "sha256:dd749f53de3a5f80e02386699355e28c1fd7e707b2b12bdf2d5c725eb436ddf9",
        },
        eventTypes: ["https://example.org/events/work-created"],
      }]);
      expect(value.bindings[0]!.slots.journal).toEqual({
        kind: "capability",
        contract: value.journalPublishers[0]!.contract,
        provider: { binding: "publisher", export: "journal" },
      });
    });
  });

  test("links one exact inert Hook relation without admitting an executable revision", async () => {
    await withFlows({ "flows/triage": run("triage") }, async (flows) => {
      const definition = defineHook({
        on: {
          publisher: bindingRef("publisher"),
          type: "https://example.org/events/work-created",
        },
        run: flowRef("flows/triage"),
      });
      const linked = linkPackageProject({
        flows,
        bindings: [binding("bindings/publisher.ts", defineJournalPublisher({
          eventTypes: ["https://example.org/events/work-created"],
        }))],
        hooks: [{ sourcePath: "hooks/on-work.ts", definition }],
      });
      expect(linked.hooks).toEqual([{
        kind: "hook",
        id: "on-work",
        declarationPath: "hooks/on-work.ts",
        source: "binding:publisher",
        publisherBinding: "publisher",
        type: "https://example.org/events/work-created",
        target: { kind: "flow", path: "flows/triage" },
        relationDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }]);
      const changedPublisher = linkPackageProject({
        flows,
        bindings: [binding("bindings/publisher.ts", defineJournalPublisher({
          eventTypes: [
            "https://example.org/events/work-created",
            "https://example.org/events/work-finished",
          ],
        }))],
        hooks: [{ sourcePath: "hooks/on-work.ts", definition }],
      });
      expect(changedPublisher.hooks[0]!.relationDigest)
        .toBe(linked.hooks[0]!.relationDigest);
      const changedRelation = linkPackageProject({
        flows,
        bindings: [binding("bindings/publisher.ts", defineJournalPublisher({
          eventTypes: [
            "https://example.org/events/work-created",
            "https://example.org/events/work-finished",
          ],
        }))],
        hooks: [{
          sourcePath: "hooks/on-work.ts",
          definition: defineHook({
            on: {
              publisher: bindingRef("publisher"),
              type: "https://example.org/events/work-finished",
            },
            run: flowRef("flows/triage"),
          }),
        }],
      });
      expect(changedRelation.hooks[0]!.relationDigest).not.toBe(linked.hooks[0]!.relationDigest);
    });
  });

  test("rejects Hook publisher, type, and Run-target ambiguity", async () => {
    await withFlows({
      "flows/triage": run("triage"),
      "flows/service": {
        "FLOW.md": metadata("name: service\ndescription: Service.\nservice: 1"),
        "flow.ts": "export {};\n",
      },
    }, async (flows) => {
      const publisher = binding("bindings/publisher.ts", defineJournalPublisher({
        eventTypes: ["https://example.org/events/work-created"],
      }));
      const exactHook = defineHook({
        on: { publisher: bindingRef("publisher"), type: "https://example.org/events/work-created" },
        run: flowRef("flows/triage"),
      });
      expectCode(() => linkPackageProject({
        flows,
        bindings: [publisher],
        hooks: [{ sourcePath: "hooks/missing.ts", definition: defineHook({
          on: { publisher: bindingRef("unknown"), type: "https://example.org/events/work-created" },
          run: flowRef("flows/triage"),
        }) }],
      }), "PROJECT_HOOK_PUBLISHER");
      expectCode(() => linkPackageProject({
        flows,
        bindings: [publisher],
        hooks: [{ sourcePath: "hooks/type.ts", definition: defineHook({
          on: { publisher: bindingRef("publisher"), type: "https://example.org/events/other" },
          run: flowRef("flows/triage"),
        }) }],
      }), "PROJECT_HOOK_EVENT_TYPE");
      expectCode(() => linkPackageProject({
        flows,
        bindings: [
          publisher,
          binding("bindings/triage.ts", { package: "flows/triage" }),
        ],
        hooks: [{ sourcePath: "hooks/package-publisher.ts", definition: defineHook({
          on: { publisher: bindingRef("triage"), type: "https://example.org/events/work-created" },
          run: flowRef("flows/triage"),
        }) }],
      }), "PROJECT_HOOK_PUBLISHER");
      expectCode(() => linkPackageProject({
        flows,
        bindings: [
          publisher,
          binding("bindings/service.ts", { package: "flows/service" }),
        ],
        hooks: [{ sourcePath: "hooks/service.ts", definition: defineHook({
          on: { publisher: bindingRef("publisher"), type: "https://example.org/events/work-created" },
          run: bindingRef("service"),
        }) }],
      }), "PROJECT_BINDING_RUN_MODE");
      expectCode(() => linkPackageProject({
        flows,
        bindings: [publisher],
        hooks: [
          { sourcePath: "hooks/on-work.ts", definition: exactHook },
          { sourcePath: "other/on-work.ts", definition: exactHook },
        ],
      }), "PROJECT_HOOK_COLLISION");
    });
  });

  test("rejects mismatched and ambiguous public contract exports", async () => {
    const required = capability("https://example.org/contracts/exact");
    const mismatched = capability("https://example.org/contracts/exact", false);
    await withFlows({
      "flows/consumer": {
        "FLOW.md": metadata(`name: consumer
description: Consumer.
uses:
  exact:
    contract: ./contracts/exact.capability.json`),
        "flow.ts": "export {};\n",
        "contracts/exact.capability.json": required,
      },
      "flows/mismatch": {
        "FLOW.md": metadata(`name: mismatch
description: Mismatch.
service: 1
provides:
  api: ./contracts/exact.capability.json`),
        "flow.ts": "export {};\n",
        "contracts/exact.capability.json": mismatched,
      },
      "flows/ambiguous": {
        "FLOW.md": metadata(`name: ambiguous
description: Ambiguous.
service: 1
provides:
  a: ./contracts/exact.capability.json
  b: ./contracts/exact.capability.json`),
        "flow.ts": "export {};\n",
        "contracts/exact.capability.json": required,
      },
    }, async (flows) => {
      for (const [provider, code] of [
        ["mismatch", "PROJECT_BINDING_CAPABILITY_INCOMPATIBLE"],
        ["ambiguous", "PROJECT_BINDING_CAPABILITY_AMBIGUOUS"],
      ] as const) {
        expectCode(() => linkPackageProject({
          flows,
          bindings: [
            binding(`bindings/${provider}.ts`, { package: `flows/${provider}` }),
            binding("bindings/consumer.ts", {
              package: "flows/consumer",
              slots: { exact: bindingRef(provider) },
            }),
          ],
        }), code, "/slots/exact");
      }
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
      expectCode(() => linkPackageProject({
        flows,
        bindings: [binding("bindings/configured.ts", {
          package: "flows/configured",
          attachments: { source: ".jig/private" },
        })],
      }), "PROJECT_BINDING_ATTACHMENT_PROTECTED", "/attachments/source");
      expectCode(() => linkPackageProject({
        flows,
        bindings: [binding("bindings/configured.ts", {
          package: "flows/configured",
          attachments: { source: ".JIG/private" },
        })],
      }), "PROJECT_BINDING_ATTACHMENT_PROTECTED", "/attachments/source");
    });
  });

  test("enforces direct-Flow and Run-Binding rules for flow-call slots", async () => {
    await withFlows({
      "flows/caller": run("caller"),
      "flows/configured": {
        "FLOW.md": metadata("name: configured\ndescription: Configured."),
        "flow.ts": "export {};\n",
        "settings.schema.json": schema({
          type: "object",
          required: ["required"],
          properties: { required: { type: "boolean" } },
        }),
      },
      "flows/service": {
        "FLOW.md": metadata("name: service\ndescription: Service.\nservice: 1"),
        "flow.ts": "export {};\n",
      },
    }, async (flows) => {
      expectCode(() => linkPackageProject({
        flows,
        bindings: [binding("bindings/caller.ts", {
          package: "flows/caller",
          slots: { work: flowRef("flows/configured") },
        })],
      }), "PROJECT_FLOW_REFERENCE_NOT_DIRECT", "/slots/work");
      expectCode(() => linkPackageProject({
        flows,
        bindings: [
          binding("bindings/caller.ts", {
            package: "flows/caller",
            slots: { work: bindingRef("service") },
          }),
          binding("bindings/service.ts", { package: "flows/service" }),
        ],
      }), "PROJECT_BINDING_RUN_MODE", "/slots/work");
    });
  });

  test("preserves candidate identity and allows recursive Run-call topology", async () => {
    await withFlows({
      "flows/dispatcher": run("dispatcher"),
      "flows/worker": run("worker"),
    }, async (flows) => {
      expectCode(() => linkPackageProject({
        flows,
        bindings: [binding("bindings/dispatcher.ts", {
          package: "flows/dispatcher",
          slots: {
            next: candidates([flowRef("flows/missing"), bindingRef("missing")]),
          },
        })],
      }), "PROJECT_BINDING_REFERENCE_MISSING", "/slots/next/targets/0");
      const value = linkPackageProject({
        flows,
        bindings: [
          binding("bindings/dispatcher.ts", {
            package: "flows/dispatcher",
            slots: {
              next: candidates([flowRef("flows/worker"), bindingRef("worker")]),
            },
          }),
          binding("bindings/worker.ts", {
            package: "flows/worker",
            slots: { again: bindingRef("dispatcher") },
          }),
        ],
      });
      expect(value.bindings[0]!.slots.next).toEqual({
        kind: "flow-call",
        targets: [
          { kind: "binding", id: "worker" },
          { kind: "flow", path: "flows/worker" },
        ],
      });
      expect(value.bindings[1]!.slots.again).toMatchObject({
        targets: [{ kind: "binding", id: "dispatcher" }],
      });
    });
  });

  test("rejects unsupported local capabilities and Service dependency cycles", async () => {
    const contract = capability("https://example.org/contracts/service");
    await withFlows({
      "flows/local": {
        "FLOW.md": metadata(`name: local
description: Local.
uses:
  host:
    local: true`),
        "flow.ts": "export {};\n",
      },
      "flows/a": serviceWithContract("a", contract),
      "flows/b": serviceWithContract("b", contract),
      "flows/c": serviceWithContract("c", contract),
    }, async (flows) => {
      expectCode(() => linkPackageProject({
        flows,
        bindings: [binding("bindings/local.ts", {
          package: "flows/local",
          slots: { host: bindingRef("a") },
        })],
      }), "PROJECT_BINDING_LOCAL_CAPABILITY_UNSUPPORTED");

      const cycle = expectCode(() => linkPackageProject({
        flows,
        bindings: [
          binding("bindings/a.ts", { package: "flows/a", slots: { dependency: bindingRef("b") } }),
          binding("bindings/b.ts", { package: "flows/b", slots: { dependency: bindingRef("a") } }),
          binding("bindings/c.ts", { package: "flows/c", slots: { dependency: bindingRef("a") } }),
        ],
      }), "PROJECT_SERVICE_DEPENDENCY_CYCLE", "/slots/dependency");
      expect(cycle.message).toBe("Service dependency cycle includes: a, b");
    });
  });

  test("rejects instruction-only packages because no Agent provider is authored yet", async () => {
    await withFlows({
      "flows/instruction": { "FLOW.md": metadata("name: instruction\ndescription: Instruction.") },
    }, async (flows) => {
      expectCode(() => linkPackageProject({
        flows,
        bindings: [binding("bindings/instruction.ts", { package: "flows/instruction" })],
      }), "PROJECT_BINDING_AGENT_REQUIRED");
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
      expect(() => {
        (value.bindings[0]!.slots as Record<string, unknown>).extra = true;
      }).toThrow();
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

function serviceWithContract(name: string, contract: string): Record<string, string> {
  return {
    "FLOW.md": metadata(`name: ${name}
description: ${name}.
service: 1
uses:
  dependency:
    contract: ./contracts/service.capability.json
provides:
  api: ./contracts/service.capability.json`),
    "flow.ts": "export {};\n",
    "contracts/service.capability.json": contract,
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

function capability(id: string, input: boolean = true): string {
  return JSON.stringify({
    $schema: "https://flow.dev/schemas/capability-contract-1.schema.json",
    flowCapabilityContract: 1,
    id,
    version: "1.0.0",
    methods: { call: { input, output: true, errors: {} } },
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
      const directory = join(root, path);
      for (const [name, contents] of Object.entries(tree)) {
        const file = join(directory, name);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, contents);
      }
    }
    source = await captureFlowSource(
      root,
      defineJig({ flows: Object.keys(trees) }).flows,
    );
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
): { readonly message: string } {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ code, ...(pointer === undefined ? {} : { pointer }) });
  return thrown as { readonly message: string };
}
