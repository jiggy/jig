import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  createPrivateActivationPlanningObservation,
  createPrivateActivationRecipeObservation,
} from "../src/internal/activation-planning.js";
import {
  createPrivateProjectLocalLock,
  privateProjectLocalLockDigest,
} from "../src/internal/project-local-lock.js";
import {
  bindingRef,
  candidates,
  definePrivateProjectRunTargetsBinding,
  defineHook,
  defineJig,
  defineJournalPublisher,
  flowRef,
  projectRunTargets,
} from "../src/project/author.js";
import { captureFlowSource } from "../src/project/flow-source.js";
import {
  linkPackageProject,
  linkPrivateProjectRunTargetsPackageProject,
  privateProjectRunTargetCatalogue,
  type InjectedBindingDeclaration,
} from "../src/project/package-project.js";
import {
  buildPrivateActivationRequests,
  resolveLinkedPackageProjectObservation,
  type PrivateActivationRequest,
} from "../src/project/package-resolution.js";
import { retainFlowSourcePackages } from "../src/project/retained-flow.js";

const journalContract = await readFile(new URL(
  "../../../docs/spec/contracts/jig/journal.capability.json",
  import.meta.url,
), "utf8");

describe("private project Run-target catalogue", () => {
  test("enumerates every structural Run target in canonical immutable order", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-project-run-targets-"));
    const store = join(root, "store");
    let source: Awaited<ReturnType<typeof captureFlowSource>> | undefined;
    try {
      await mkdir(store, { mode: 0o700 });
      await writeTree(root, {
        "flows/z-direct/FLOW.md": metadata("name: z-direct\ndescription: Z direct."),
        "flows/z-direct/flow.ts": "export {};\n",
        "flows/a-direct/FLOW.md": metadata("name: a-direct\ndescription: A direct."),
        "flows/a-direct/flow.py": "#!/usr/bin/env python3\n",
        "flows/configured/FLOW.md": metadata("name: configured\ndescription: Configured."),
        "flows/configured/flow.ts": "export {};\n",
        "flows/configured/settings.schema.json": JSON.stringify({
          $schema: "https://flow.dev/schemas/schema-1.json",
          type: "object",
          properties: { profile: { const: "strict" } },
          required: ["profile"],
          additionalProperties: false,
        }),
        "flows/instructions/FLOW.md": metadata("name: instructions\ndescription: Instructions only."),
        "flows/service/FLOW.md": metadata("name: service\ndescription: Service.\nservice: 1"),
        "flows/service/flow.ts": "export {};\n",
        "flows/producer/FLOW.md": metadata(`name: producer
description: Producer.
uses:
  journal:
    contract: ./contracts/journal.capability.json`),
        "flows/producer/flow.ts": "export {};\n",
        "flows/producer/contracts/journal.capability.json": journalContract,
      });

      source = await captureFlowSource(root, defineJig({
        flows: [
          "flows/z-direct",
          "flows/service",
          "flows/instructions",
          "flows/configured",
          "flows/producer",
          "flows/a-direct",
        ],
      }).flows);
      const flows = await retainFlowSourcePackages(store, source);
      expect(() => linkPackageProject({
        flows,
        bindings: [declaration("bindings/dispatcher.ts", definePrivateProjectRunTargetsBinding({
          package: "flows/z-direct",
          slots: { work: projectRunTargets() },
        }))],
      })).toThrow("not part of Project Authoring SDK/1");
      const bindings: InjectedBindingDeclaration[] = [
        declaration("bindings/z-run.ts", { package: "flows/z-direct" }),
        declaration("bindings/a-configured.ts", {
          package: "flows/configured",
          settings: { profile: "strict" },
        }),
        declaration("bindings/service.ts", { package: "flows/service" }),
        declaration("bindings/publisher.ts", defineJournalPublisher({
          eventTypes: ["https://example.org/events/created"],
        })),
        declaration("bindings/producer.ts", {
          package: "flows/producer",
          slots: { journal: bindingRef("publisher") },
        }),
      ];
      const project = linkPackageProject({
        flows,
        bindings,
        hooks: [{
          sourcePath: "hooks/on-created.ts",
          definition: defineHook({
            on: {
              publisher: bindingRef("publisher"),
              type: "https://example.org/events/created",
            },
            run: bindingRef("a-configured"),
          }),
        }],
      });

      const catalogue = privateProjectRunTargetCatalogue(project);
      expect(catalogue).toEqual([
        { kind: "binding", id: "a-configured" },
        { kind: "binding", id: "producer" },
        { kind: "binding", id: "z-run" },
        { kind: "flow", path: "flows/a-direct" },
        { kind: "flow", path: "flows/z-direct" },
      ]);
      expect(Object.isFrozen(catalogue)).toBeTrue();
      expect(catalogue.every(Object.isFrozen)).toBeTrue();
      const repeated = privateProjectRunTargetCatalogue(project);
      expect(repeated).toEqual(catalogue);
      expect(repeated).not.toBe(catalogue);
      expect(repeated[0]).not.toBe(catalogue[0]);

      expect(() => privateProjectRunTargetCatalogue({
        flows: project.flows,
        bindings: project.bindings,
        journalPublishers: project.journalPublishers,
        hooks: project.hooks,
      })).toThrow("project was not produced by the package-project linker");
    } finally {
      await source?.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("permits an empty dynamic expansion and an authenticated empty project", async () => {
    const project = linkPrivateProjectRunTargetsPackageProject({
      flows: [],
      bindings: [],
    }, 1);
    const catalogue = privateProjectRunTargetCatalogue(project);
    expect(catalogue).toEqual([]);
    expect(Object.isFrozen(catalogue)).toBeTrue();
    expect(project.bindings).toEqual([]);

    await withFlows({
      "flows/service": {
        "FLOW.md": metadata("name: service\ndescription: Service.\nservice: 1"),
        "flow.ts": "export {};\n",
      },
    }, async (flows) => {
      const serviceProject = linkPrivateProjectRunTargetsPackageProject({
        flows,
        bindings: [declaration(
          "bindings/service.ts",
          definePrivateProjectRunTargetsBinding({
            package: "flows/service",
            slots: { work: projectRunTargets() },
          }),
        )],
      }, 1);
      expect(serviceProject.bindings[0]!.slots.work).toEqual({
        kind: "flow-call",
        source: "project-run-targets",
        targets: [],
      });
      expect(privateProjectRunTargetCatalogue(serviceProject)).toEqual([]);
    });
  });

  test("expands every marker from one complete immutable two-phase catalogue", async () => {
    await withFlows({
      "flows/dispatcher": {
        "FLOW.md": metadata("name: dispatcher\ndescription: Dispatcher."),
        "flow.ts": "export {};\n",
      },
      "flows/worker": {
        "FLOW.md": metadata("name: worker\ndescription: Worker."),
        "flow.py": "#!/usr/bin/env python3\n",
      },
    }, async (flows) => {
      const project = linkPrivateProjectRunTargetsPackageProject({
        flows,
        bindings: [
          declaration("bindings/dispatcher.ts", definePrivateProjectRunTargetsBinding({
            package: "flows/dispatcher",
            slots: {
              first: projectRunTargets(),
              second: projectRunTargets(),
              exact: bindingRef("worker"),
              chosen: candidates([
                bindingRef("worker"),
                flowRef("flows/worker"),
              ]),
            },
          })),
          declaration("bindings/worker.ts", { package: "flows/worker" }),
        ],
      }, 16);

      const dispatcher = project.bindings.find(({ id }) => id === "dispatcher")!;
      const first = dispatcher.slots.first!;
      const second = dispatcher.slots.second!;
      expect(first).toEqual({
        kind: "flow-call",
        source: "project-run-targets",
        targets: [
          { kind: "binding", id: "dispatcher" },
          { kind: "binding", id: "worker" },
          { kind: "flow", path: "flows/dispatcher" },
          { kind: "flow", path: "flows/worker" },
        ],
      });
      expect(second).toEqual(first);
      expect(second.kind === "flow-call" && first.kind === "flow-call" && second.targets).toBe(first.targets);
      expect(dispatcher.slots.exact).toEqual({
        kind: "flow-call",
        source: "exact",
        targets: [{ kind: "binding", id: "worker" }],
      });
      expect(dispatcher.slots.chosen).toEqual({
        kind: "flow-call",
        source: "candidates",
        targets: [
          { kind: "binding", id: "worker" },
          { kind: "flow", path: "flows/worker" },
        ],
      });
      expect(privateProjectRunTargetCatalogue(project)).toEqual(first.kind === "flow-call" ? first.targets : []);
      expect(Object.isFrozen(first)).toBeTrue();
      expect(first.kind === "flow-call" && Object.isFrozen(first.targets)).toBeTrue();
      expect(first.kind === "flow-call" && first.targets.every(Object.isFrozen)).toBeTrue();
      expect(() => {
        (first as { source: string }).source = "exact";
      }).toThrow();

      const lock = createPrivateProjectLocalLock(project);
      expect(lock.kind).toBe("private-package-project-lock/3");
      expect(lock.bindings.dispatcher!.slots.first).toEqual(first);
      const dispatcherRequest = buildPrivateActivationRequests(project).find(
        ({ target }) => target.kind === "binding" && target.id === "dispatcher",
      )!;
      expect(dispatcherRequest.kind).toBe("activation-request/2");
      expect(dispatcherRequest.slots.first).toEqual(first);

      const fixed = linkPrivateProjectRunTargetsPackageProject({
        flows,
        bindings: [
          declaration("bindings/dispatcher.ts", definePrivateProjectRunTargetsBinding({
            package: "flows/dispatcher",
            slots: {
              first: candidates([
                bindingRef("dispatcher"),
                bindingRef("worker"),
                flowRef("flows/dispatcher"),
                flowRef("flows/worker"),
              ]),
              second: projectRunTargets(),
              exact: bindingRef("worker"),
              chosen: candidates([
                bindingRef("worker"),
                flowRef("flows/worker"),
              ]),
            },
          })),
          declaration("bindings/worker.ts", { package: "flows/worker" }),
        ],
      }, 16);
      const fixedLock = createPrivateProjectLocalLock(fixed);
      expect(fixedLock.bindings.dispatcher!.slots.first).toMatchObject({
        kind: "flow-call",
        source: "candidates",
        targets: first.kind === "flow-call" ? first.targets : [],
      });
      expect(privateProjectLocalLockDigest(fixedLock)).not.toBe(privateProjectLocalLockDigest(lock));
      const fixedRequest = buildPrivateActivationRequests(fixed).find(
        ({ target }) => target.kind === "binding" && target.id === "dispatcher",
      )!;
      expect(fixedRequest.digest).not.toBe(dispatcherRequest.digest);
      const dynamicResolution = resolveLinkedPackageProjectObservation(
        project,
        testDigest("same-capture"),
        planned(buildPrivateActivationRequests(project)),
      );
      const fixedResolution = resolveLinkedPackageProjectObservation(
        fixed,
        testDigest("same-capture"),
        planned(buildPrivateActivationRequests(fixed)),
      );
      expect(fixedResolution.semanticDigest).not.toBe(dynamicResolution.semanticDigest);
    });
  });

  test("rejects invalid caller bounds and complete catalogues above the bound", async () => {
    for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => linkPrivateProjectRunTargetsPackageProject({ flows: [], bindings: [] }, limit)).toThrow(
        "maximum activation targets must be a positive safe integer",
      );
    }

    await withFlows({
      "flows/dispatcher": {
        "FLOW.md": metadata("name: dispatcher\ndescription: Dispatcher."),
        "flow.ts": "export {};\n",
      },
    }, async (flows) => {
      expect(() => linkPrivateProjectRunTargetsPackageProject({
        flows,
        bindings: [
          declaration("bindings/a.ts", { package: "flows/dispatcher" }),
          declaration("bindings/b.ts", { package: "flows/dispatcher" }),
        ],
      }, 2)).toThrow("project contains 3 activation targets, exceeding the caller bound 2");
    });
  });

  test("counts Service Bindings in the caller-owned aggregate activation bound", async () => {
    await withFlows({
      "flows/service": {
        "FLOW.md": metadata("name: service\ndescription: Service.\nservice: 1"),
        "flow.ts": "export {};\n",
      },
    }, async (flows) => {
      const bindings = [
        declaration("bindings/a.ts", { package: "flows/service" }),
        declaration("bindings/b.ts", { package: "flows/service" }),
      ];
      expect(() => linkPrivateProjectRunTargetsPackageProject({ flows, bindings }, 1)).toThrow(
        "project contains 2 activation targets, exceeding the caller bound 1",
      );
      const project = linkPrivateProjectRunTargetsPackageProject({ flows, bindings }, 2);
      expect(privateProjectRunTargetCatalogue(project)).toEqual([]);
    });
  });

  test("charges every dynamic expansion to the existing semantic-work budget", async () => {
    await withFlows({
      "flows/dispatcher": {
        "FLOW.md": metadata("name: dispatcher\ndescription: Dispatcher."),
        "flow.ts": "export {};\n",
      },
    }, async (flows) => {
      const bindings = Array.from({ length: 600 }, (_, index) => declaration(
        `bindings/b-${index.toString().padStart(3, "0")}.ts`,
        definePrivateProjectRunTargetsBinding({
          package: "flows/dispatcher",
          slots: { work: projectRunTargets() },
        }),
      ));
      expect(() => linkPrivateProjectRunTargetsPackageProject({ flows, bindings }, 601)).toThrow(
        "package-project semantic work exceeds 1000000 units",
      );
    });
  });
});

function declaration(sourcePath: string, definition: unknown): InjectedBindingDeclaration {
  return { sourcePath, definition };
}

function metadata(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n`;
}

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
}

async function withFlows(
  trees: Readonly<Record<string, Readonly<Record<string, string>>>>,
  action: (flows: Awaited<ReturnType<typeof retainFlowSourcePackages>>) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "jig-project-run-target-linker-"));
  const store = join(root, "store");
  let source: Awaited<ReturnType<typeof captureFlowSource>> | undefined;
  try {
    await mkdir(store, { mode: 0o700 });
    for (const [packagePath, files] of Object.entries(trees)) {
      for (const [path, contents] of Object.entries(files)) {
        await writeTree(root, { [`${packagePath}/${path}`]: contents });
      }
    }
    source = await captureFlowSource(root, defineJig({ flows: Object.keys(trees) }).flows);
    await action(await retainFlowSourcePackages(store, source));
  } finally {
    await source?.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

function planned(requests: readonly PrivateActivationRequest[]) {
  const digest = testDigest("fixed-proof-value");
  const extension = Object.freeze({ artifactDigest: digest, revision: "proof/1" });
  return createPrivateActivationPlanningObservation({
    policyDigest: digest,
    mechanismDigest: digest,
    entries: requests.map((request) => ({
      target: request.target,
      requestDigest: request.digest,
      disposition: {
        state: "planned" as const,
        observation: createPrivateActivationRecipeObservation({
          requestDigest: request.digest,
          adapter: extension,
          toolchainDigest: digest,
          inspectionDigest: digest,
          preparationPlanDigest: null,
          launchPlanner: extension,
          backend: extension,
          preparationEnvelopeDigest: null,
          launchEnvelopeDigest: digest,
          runtimeSupportClosureDigest: digest,
          runtimePredicates: [],
          requestedAuthorityDigest: digest,
          wouldGrantAuthorityDigest: digest,
          plannedAuthorityDigest: digest,
        }),
      },
    })),
  });
}

function testDigest(label: string): string {
  const bytes = new TextEncoder().encode(label);
  let hex = "";
  for (let index = 0; index < 32; index += 1) {
    hex += bytes[index % bytes.length]!.toString(16).padStart(2, "0");
  }
  return `sha256:${hex}`;
}
