import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { bindingRef, candidates, defineHook, defineJig, defineJournalPublisher, flowRef } from "../src/project/author.js";
import { captureFlowSource } from "../src/project/flow-source.js";
import {
  linkPackageProject,
  privateHookRelationDigest,
  type InjectedBindingDeclaration,
  type PackageProjectValue,
} from "../src/project/package-project.js";
import {
  retainFlowSourcePackages,
  type RetainedFlowInput,
} from "../src/project/retained-flow.js";

const encoder = new TextEncoder();
const schemaUri = "https://flow.dev/schemas/schema-1.json";
const journalContract = await readFile(new URL(
  "../../../docs/spec/contracts/jig/journal.capability.json",
  import.meta.url,
), "utf8");

describe("private package-project portable lock projection", () => {
  test("has one empty canonical byte vector and external identity", () => {
    const bytes = encoder.encode(
      '{"bindings":{},"hooks":{},"journalPublishers":{},"kind":"private-package-project-lock/3","packages":{}}\n',
    );
    const value = decodePrivateProjectLocalLock(bytes);

    expect(encodePrivateProjectLocalLock(value)).toEqual(bytes);
    expect(privateProjectLocalLockDigest(value)).toBe(
      "sha256:bf8fe0abc029c09fc7657628cae5d7ac9cc33c2857b31fa5fde8876c44743905",
    );
    // Strict decoding validates inert spelling and relations; it does not
    // prove that these portable bytes came from captured package sources.
    expect(requirePrivateProjectLocalLock(value)).toBe(value);
    expect(Object.isFrozen(value)).toBeTrue();
    expect(Object.isFrozen(value.packages)).toBeTrue();
    expect(() => requirePrivateProjectLocalLock(structuredClone(value))).toThrow(
      "was not built or strictly decoded",
    );
  });

  test("projects exact package, contract, candidate, provider, and attachment choices", async () => {
    await withFlows(projectTrees(), async (flows) => {
      const project = linkedProject(flows, 3);
      const lock = createPrivateProjectLocalLock(project);
      expect(() => createPrivateProjectLocalLock(structuredClone(project))).toThrow(
        "not produced by the package-project linker",
      );

      expect(lock.packages["flows/consumer"]).toMatchObject({
        mode: "run",
        directRun: false,
        attachments: { source: "read-write" },
        uses: {
          index: {
            kind: "contract",
            id: "https://example.org/contracts/index",
            version: "1.0.0",
          },
        },
      });
      expect(lock.bindings.consumer).toEqual({
        packagePath: "flows/consumer",
        attachments: { source: { source: "workspace", access: "read-write" } },
        slots: {
          index: { kind: "capability", provider: { binding: "provider", export: "api" } },
          work: {
            kind: "flow-call",
            source: "candidates",
            targets: [
              { kind: "binding", id: "consumer" },
              { kind: "flow", path: "flows/worker" },
            ],
          },
        },
      });
      const encoded = encodePrivateProjectLocalLock(lock);
      const decoded = decodePrivateProjectLocalLock(encoded);
      expect(encodePrivateProjectLocalLock(decoded)).toEqual(encoded);
      expect(privateProjectLocalLockDigest(decoded)).toBe(privateProjectLocalLockDigest(lock));
      expect(Object.isFrozen(decoded.packages["flows/consumer"])).toBeTrue();
      expect(Object.isFrozen(decoded.packages["flows/consumer"]!.uses.index)).toBeTrue();
      expect(Object.isFrozen(decoded.bindings.consumer.slots.work)).toBeTrue();
      expect(Object.isFrozen((decoded.bindings.consumer.slots.work as any).targets)).toBeTrue();

      // Settings are authored desired state and remain in the semantic plan,
      // but are not a portable resolution choice duplicated by this lock.
      const otherSettings = createPrivateProjectLocalLock(linkedProject(flows, 9));
      expect(encodePrivateProjectLocalLock(otherSettings)).toEqual(encoded);
    });
  });

  test("changes for package bytes and contract identity", async () => {
    let first: Uint8Array | undefined;
    await withFlows(projectTrees(), async (flows) => {
      first = encodePrivateProjectLocalLock(createPrivateProjectLocalLock(linkedProject(flows, 3)));
    });
    const changed = projectTrees();
    changed["flows/worker"]!["flow.py"] = "# changed package bytes\n";
    await withFlows(changed, async (flows) => {
      const second = encodePrivateProjectLocalLock(createPrivateProjectLocalLock(linkedProject(flows, 3)));
      expect(second).not.toEqual(first!);
    });

    const changedContract = projectTrees("1.0.1");
    await withFlows(changedContract, async (flows) => {
      const second = encodePrivateProjectLocalLock(createPrivateProjectLocalLock(linkedProject(flows, 3)));
      expect(second).not.toEqual(first!);
    });
  }, 15_000);

  test("projects one canonical Journal publisher without making it an activation Binding", async () => {
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
    }, async (flows) => {
      const linked = linkPackageProject({
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
        hooks: [{
          sourcePath: "hooks/on-work.ts",
          definition: defineHook({
            on: {
              publisher: bindingRef("publisher"),
              type: "https://example.org/events/work-created",
            },
            run: bindingRef("producer"),
          }),
        }],
      });
      const lock = createPrivateProjectLocalLock(linked);
      expect(Object.keys(lock.bindings)).toEqual(["producer"]);
      expect(lock.journalPublishers.publisher).toEqual({
        source: "binding:publisher",
        contract: {
          id: "https://jig.dev/contracts/journal",
          version: "1.0.0",
          digest: "sha256:dd749f53de3a5f80e02386699355e28c1fd7e707b2b12bdf2d5c725eb436ddf9",
        },
        eventTypes: ["https://example.org/events/work-created"],
      });
      expect(lock.hooks["on-work"]).toMatchObject({
        declarationPath: "hooks/on-work.ts",
        source: "binding:publisher",
        publisherBinding: "publisher",
        type: "https://example.org/events/work-created",
        target: { kind: "binding", id: "producer" },
      });
      expect(lock.hooks["on-work"]!.relationDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expectInvalid(structuredClone(lock) as any, (value) => {
        value.hooks["on-work"].relationDigest = `sha256:${"0".repeat(64)}`;
      }, "does not match");
      const decoded = decodePrivateProjectLocalLock(encodePrivateProjectLocalLock(lock));
      expect(decoded).toEqual(lock);
      const base = structuredClone(lock) as any;
      expectInvalid(base, (value) => {
        value.journalPublishers.publisher.source = "binding:other";
      }, "source must be binding:publisher");
      expectInvalid(base, (value) => {
        value.journalPublishers.publisher.eventTypes = ["https://jig.dev/events/run-completed"];
      }, "protected lifecycle namespace");
      expectInvalid(base, (value) => {
        value.journalPublishers.publisher.contract.digest = `sha256:${"0".repeat(64)}`;
      }, "canonical Journal contract");
      expectInvalid(base, (value) => {
        value.hooks["on-work"].type = "https://example.org/events/unknown";
        refreshHookRelation(value, "on-work");
      }, "not authorized");
      expectInvalid(base, (value) => {
        value.hooks["on-work"].target = { kind: "binding", id: "missing" };
        refreshHookRelation(value, "on-work");
      }, "non-Run Binding");
    });
  });

  test("rejects every alternate spelling and forged host evidence", () => {
    const canonical = {
      kind: "private-package-project-lock/3",
      packages: {},
      bindings: {},
      journalPublishers: {},
      hooks: {},
    };
    const valid = lockBytes(canonical);
    expect(() => decodePrivateProjectLocalLock(valid)).not.toThrow();
    expect(() => decodePrivateProjectLocalLock(valid.subarray(0, valid.length - 1))).toThrow(
      "not in canonical",
    );
    expect(() => decodePrivateProjectLocalLock(lockBytes({
      ...canonical,
      kind: "invalid-lock-kind",
    }))).toThrow("lock kind must be private-package-project-lock/3");
    expect(() => decodePrivateProjectLocalLock(encoder.encode(JSON.stringify(canonical, null, 2) + "\n"))).toThrow(
      "not in canonical",
    );
    expect(() => decodePrivateProjectLocalLock(encoder.encode(
      '{"kind":"private-package-project-lock/3","kind":"private-package-project-lock/3","packages":{},"bindings":{},"journalPublishers":{},"hooks":{}}\n',
    ))).toThrow("duplicate object member");
    expect(() => decodePrivateProjectLocalLock(lockBytes({
      ...canonical,
      backend: { digest: `sha256:${"a".repeat(64)}` },
    }))).toThrow("must contain exactly");
    expect(() => decodePrivateProjectLocalLock(lockBytes({
      ...canonical,
      policyDigest: `sha256:${"a".repeat(64)}`,
    }))).toThrow("must contain exactly");
    expect(() => decodePrivateProjectLocalLock(Uint8Array.from([0xef, 0xbb, 0xbf, ...valid]))).toThrow(
      "BOM is not allowed",
    );
  });

  test("strict decoding rejects invalid and dangling normalized relations", async () => {
    await withFlows(projectTrees(), async (flows) => {
      const lock = createPrivateProjectLocalLock(linkedProject(flows, 3));
      const base = structuredClone(lock) as any;

      expectInvalid(base, (value) => {
        value.packages["flows/worker"].digest = `sha256:${"A".repeat(64)}`;
      }, "digest must be sha256");
      expectInvalid(base, (value) => {
        value.packages["flows/consumer"].uses.index.version = "1.0";
      }, "stable SemVer core");
      expectInvalid(base, (value) => {
        value.packages["flows/consumer"].uses.index.id = "not-a-uri";
      }, "Capability Contract/1 ID");
      expectInvalid(base, (value) => {
        value.bindings.consumer.slots.index.provider.binding = "missing";
      }, "unknown provider Binding");
      expectInvalid(base, (value) => {
        value.bindings.consumer.attachments.source.access = "read";
      }, "access does not match");
      expectInvalid(base, (value) => {
        value.bindings.consumer.slots.work.targets.reverse();
      }, "not in canonical");
      expectInvalid(base, (value) => {
        value.bindings.consumer.slots.work.targets.push({ kind: "flow", path: "flows/worker" });
      }, "duplicate target");
      expectInvalid(base, (value) => {
        delete value.bindings.consumer.slots.work.source;
      }, "must contain exactly kind, source, targets");
      expectInvalid(base, (value) => {
        value.bindings.consumer.slots.work.source = "query";
      }, "source has an invalid kind");
      expectInvalid(base, (value) => {
        value.bindings.consumer.slots.work.source = "exact";
      }, "exact source must contain exactly one target");
      expectInvalid(base, (value) => {
        value.bindings.consumer.slots.work.source = "candidates";
        value.bindings.consumer.slots.work.targets = [
          value.bindings.consumer.slots.work.targets[0],
        ];
      }, "candidates source must contain at least two targets");
      const incompleteDynamic = structuredClone(base);
      incompleteDynamic.bindings.consumer.slots.work.source = "project-run-targets";
      incompleteDynamic.bindings.consumer.slots.work.targets = [
        incompleteDynamic.bindings.consumer.slots.work.targets[0],
      ];
      expect(() => decodePrivateProjectLocalLock(lockBytes(incompleteDynamic))).toThrow(
        "does not match the complete project Run catalogue",
      );
      const emptyDynamic = {
        kind: "private-package-project-lock/3",
        packages: {
          "flows/service": {
            digest: `sha256:${"d".repeat(64)}`,
            mode: "service",
            directRun: false,
            attachments: {},
            uses: {},
            provides: {},
          },
        },
        bindings: {
          service: {
            packagePath: "flows/service",
            attachments: {},
            slots: {
              work: { kind: "flow-call", source: "project-run-targets", targets: [] },
            },
          },
        },
        journalPublishers: {},
        hooks: {},
      };
      expect(() => decodePrivateProjectLocalLock(lockBytes(emptyDynamic))).not.toThrow();
      expectInvalid(base, (value) => {
        value.packages["FLOWS/WORKER"] = value.packages["flows/worker"];
      }, "collide");
      expectInvalid(base, (value) => {
        value.packages[".JIG/worker"] = value.packages["flows/worker"];
      }, "protected .jig");
      expectInvalid(base, (value) => {
        value.bindings.consumer.packagePath = ".jig/consumer";
      }, "protected .jig");
      expectInvalid(base, (value) => {
        value.bindings.consumer.attachments.source.source = ".jIg/secret";
      }, "protected .jig");
      expectInvalid(base, (value) => {
        value.bindings.consumer.slots.work.targets[1].path = ".JIG/worker";
      }, "protected .jig");
      expectInvalid(base, (value) => {
        value.bindings.consumer.slots.index.provider.export = "missing";
      }, "incompatible provider export");
      expectInvalid(base, (value) => {
        value.bindings.provider.packagePath = "flows/consumer";
      }, "non-Service provider");
      expectInvalid(base, (value) => {
        value.packages["flows/consumer"].uses.index = { kind: "local" };
      }, "unsupported local capability");
      expectInvalid(base, (value) => {
        value.packages["flows/provider"].uses.dependency = {
          ...value.packages["flows/provider"].provides.api,
          kind: "contract",
        };
        value.bindings.provider.slots.dependency = {
          kind: "capability",
          provider: { binding: "provider", export: "api" },
        };
      }, "dependency cycle");
      expectInvalid(base, (value) => {
        value.packages["flows/provider"].uses.dependency = {
          ...value.packages["flows/provider"].provides.api,
          kind: "contract",
          digest: `sha256:${"b".repeat(64)}`,
        };
      }, "equivocates");
      expectInvalid(base, (value) => {
        value.bindings.consumer.attachments = Object.fromEntries(
          Array.from({ length: 257 }, (_, index) => [
            `item-${index}`,
            { source: "workspace", access: "read" },
          ]),
        );
      }, "exceeds 256 members");

      const allowed = structuredClone(base);
      allowed.packages[".jig-safe/worker"] = allowed.packages["flows/worker"];
      delete allowed.packages["flows/worker"];
      allowed.bindings.consumer.slots.work.targets[1].path = ".jig-safe/worker";
      expect(() => decodePrivateProjectLocalLock(lockBytes(allowed))).not.toThrow();

      const nestedAllowed = structuredClone(base);
      nestedAllowed.packages["safe/.JIG/worker"] = nestedAllowed.packages["flows/worker"];
      delete nestedAllowed.packages["flows/worker"];
      nestedAllowed.bindings.consumer.slots.work.targets[1].path = "safe/.JIG/worker";
      expect(() => decodePrivateProjectLocalLock(lockBytes(nestedAllowed))).not.toThrow();
    });
  });

  test("enforces Metadata/1 maps and the one aggregate activation-target bound", () => {
    for (const field of ["attachments", "uses", "provides"] as const) {
      expect(() => decodePrivateProjectLocalLock(lockBytes(metadataBoundLock(field, 256, false)))).not.toThrow();
      expect(() => decodePrivateProjectLocalLock(lockBytes(metadataBoundLock(field, 257, true)))).toThrow(
        "exceeds 256 members",
      );
    }
    expect(() => decodePrivateProjectLocalLock(lockBytes(rootPackageCollection(257)))).not.toThrow();
    expect(() => decodePrivateProjectLocalLock(lockBytes(rootPackageCollection(4_097)))).toThrow(
      "activation targets exceed 4096 targets",
    );
  });

  test("validates large Service dependency graphs without recursive traversal", () => {
    expect(() => decodePrivateProjectLocalLock(lockBytes(serviceGraph(4_096, false)))).not.toThrow();
    expect(() => decodePrivateProjectLocalLock(lockBytes(serviceGraph(4_097, false)))).toThrow(
      "activation targets exceed 4096 targets",
    );
    expect(() => decodePrivateProjectLocalLock(lockBytes(serviceGraph(1, true)))).toThrow(
      "dependency cycle",
    );
    expect(() => decodePrivateProjectLocalLock(lockBytes(serviceGraph(2, true)))).toThrow(
      "dependency cycle",
    );
  }, 20_000);

  test("uses one inclusive JSON/1 file-byte ceiling including terminal LF", () => {
    const value = lockAtCanonicalBodySize(JSON_1_LIMITS.bytes - 1);
    const bytes = lockBytes(value);
    expect(bytes.byteLength).toBe(JSON_1_LIMITS.bytes);
    const decoded = decodePrivateProjectLocalLock(bytes);
    expect(encodePrivateProjectLocalLock(decoded)).toEqual(bytes);

    const oversized = structuredClone(value) as any;
    const first = Object.keys(oversized.packages).sort()[0]!;
    oversized.packages[`${first}z`] = oversized.packages[first];
    delete oversized.packages[first];
    const oversizedBytes = lockBytes(oversized);
    expect(oversizedBytes.byteLength).toBe(JSON_1_LIMITS.bytes + 1);
    expect(() => decodePrivateProjectLocalLock(oversizedBytes)).toThrow("maximum bytes exceeded");
  }, 30_000);
});

function metadataBoundLock(
  field: "attachments" | "uses" | "provides",
  count: number,
  malformedFirst: boolean,
): unknown {
  const contract = {
    id: "https://example.org/contracts/bounded",
    version: "1.0.0",
    digest: `sha256:${"a".repeat(64)}`,
  };
  const entries = Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const value = field === "attachments"
      ? "read"
      : field === "uses"
        ? { kind: "contract", ...contract }
        : contract;
    return [`slot-${index}`, index === 0 && malformedFirst ? null : value];
  }));
  return {
    kind: "private-package-project-lock/3",
    packages: {
      "flows/bounded": {
        digest: `sha256:${"b".repeat(64)}`,
        mode: field === "provides" ? "service" : "run",
        directRun: false,
        attachments: field === "attachments" ? entries : {},
        uses: field === "uses" ? entries : {},
        provides: field === "provides" ? entries : {},
      },
    },
    bindings: {},
    journalPublishers: {},
    hooks: {},
  };
}

function rootPackageCollection(count: number): unknown {
  const packages = Object.fromEntries(Array.from({ length: count }, (_, index) => [
    `flows/item-${index}`,
    {
      digest: `sha256:${"e".repeat(64)}`,
      mode: "run",
      directRun: true,
      attachments: {},
      uses: {},
      provides: {},
    },
  ]));
  return { kind: "private-package-project-lock/3", packages, bindings: {}, journalPublishers: {}, hooks: {} };
}

function serviceGraph(count: number, cyclic: boolean): unknown {
  const contract = {
    id: "https://example.org/contracts/chain",
    version: "1.0.0",
    digest: `sha256:${"a".repeat(64)}`,
  };
  const packages: Record<string, unknown> = {};
  const bindings: Record<string, unknown> = {};
  for (let index = 0; index < count; index += 1) {
    const id = `service-${index}`;
    const dependency = index === 0 ? (cyclic ? count - 1 : undefined) : index - 1;
    packages[`flows/${id}`] = {
      digest: `sha256:${"b".repeat(64)}`,
      mode: "service",
      directRun: false,
      attachments: {},
      uses: dependency === undefined ? {} : { dependency: { kind: "contract", ...contract } },
      provides: { api: contract },
    };
    bindings[id] = {
      packagePath: `flows/${id}`,
      attachments: {},
      slots: dependency === undefined ? {} : {
        dependency: {
          kind: "capability",
          provider: { binding: `service-${dependency}`, export: "api" },
        },
      },
    };
  }
  return { kind: "private-package-project-lock/3", packages, bindings, journalPublishers: {}, hooks: {} };
}

function lockAtCanonicalBodySize(target: number): unknown {
  const count = 65;
  const make = (contractSegmentLength: number, firstPathExtra: number): unknown => {
    const id = `https://example.org/${"x".repeat(contractSegmentLength)}`;
    const contract = {
      id,
      version: "1.0.0",
      digest: `sha256:${"c".repeat(64)}`,
    };
    const packages: Record<string, unknown> = {};
    for (let index = 0; index < count; index += 1) {
      const path = index === 0
        ? `flows/a${"z".repeat(firstPathExtra)}`
        : `flows/service-${index}`;
      packages[path] = {
        digest: `sha256:${"d".repeat(64)}`,
        mode: "service",
        directRun: false,
        attachments: {},
        uses: {},
        provides: { api: contract },
      };
    }
    return { kind: "private-package-project-lock/3", packages, bindings: {}, journalPublishers: {}, hooks: {} };
  };

  const minimum = canonicalJson(make(1, 0) as JsonValue).byteLength;
  const segmentLength = 1 + Math.floor((target - minimum) / count);
  const provisional = make(segmentLength, 0);
  const remainder = target - canonicalJson(provisional as JsonValue).byteLength;
  if (remainder < 0 || remainder >= count) throw new Error("cannot construct lock byte-boundary fixture");
  const result = make(segmentLength, remainder);
  if (canonicalJson(result as JsonValue).byteLength !== target) {
    throw new Error("lock byte-boundary fixture has the wrong size");
  }
  return result;
}

function projectTrees(version = "1.0.0"): Record<string, Record<string, string>> {
  const contract = capability("https://example.org/contracts/index", version);
  return {
    "flows/consumer": {
      "FLOW.md": metadata(`name: consumer
description: Consumer.
attachments:
  source: read-write
uses:
  index:
    contract: ./contracts/index.capability.json`),
      "flow.py": "# consumer\n",
      "settings.schema.json": schema({
        type: "object",
        properties: { maxRetries: { type: "integer" } },
        required: ["maxRetries"],
        additionalProperties: false,
      }),
      "contracts/index.capability.json": contract,
    },
    "flows/provider": {
      "FLOW.md": metadata(`name: provider
description: Provider.
service: 1
provides:
  api: ./contracts/index.capability.json`),
      "flow.py": "# provider\n",
      "contracts/index.capability.json": contract,
    },
    "flows/worker": {
      "FLOW.md": metadata("name: worker\ndescription: Worker."),
      "flow.py": "# worker\n",
    },
  };
}

function linkedProject(flows: readonly RetainedFlowInput[], maxRetries: number): PackageProjectValue {
  return linkPackageProject({
    flows,
    bindings: [
      binding("bindings/provider.ts", { package: "flows/provider" }),
      binding("bindings/consumer.ts", {
        package: "flows/consumer",
        settings: { maxRetries },
        attachments: { source: "workspace" },
        slots: {
          index: bindingRef("provider"),
          work: candidates([flowRef("flows/worker"), bindingRef("consumer")]),
        },
      }),
    ],
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

function capability(id: string, version: string): string {
  return JSON.stringify({
    $schema: "https://flow.dev/schemas/capability-contract-1.schema.json",
    flowCapabilityContract: 1,
    id,
    version,
    methods: { call: { input: true, output: true, errors: {} } },
  });
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

function refreshHookRelation(value: any, id: string): void {
  const hook = value.hooks[id];
  hook.relationDigest = privateHookRelationDigest({
    id,
    declarationPath: hook.declarationPath,
    source: hook.source,
    publisherBinding: hook.publisherBinding,
    type: hook.type,
    target: hook.target,
  });
}
