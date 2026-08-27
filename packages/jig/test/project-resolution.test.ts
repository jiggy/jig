import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { canonicalJson, type JsonValue } from "../src/json.js";
import {
  createPrivateActivationPlanningObservation,
  createPrivateActivationRecipeObservation,
  type PrivateActivationPlanningObservation,
  type PrivateActivationRecipeObservationInput,
} from "../src/internal/activation-planning.js";
import { privateDomainDigest } from "../src/internal/identity.js";
import { bindingRef, defineBinding, defineHook, defineJig, defineJournalPublisher, flowRef } from "../src/project/author.js";
import { captureFlowSource } from "../src/project/flow-source.js";
import {
  linkPackageProject,
  requirePackageProjectValue,
  type InjectedBindingDeclaration,
  type InjectedHookDeclaration,
  type PackageProjectValue,
  type RunTargetIdentity,
} from "../src/project/package-project.js";
import {
  buildPrivateActivationRequests,
  requirePrivateActivationRequest,
  requirePrivateRetainedResolutionObservation,
  resolveLinkedPackageProjectObservation,
  type PrivateActivationRequest,
} from "../src/project/package-resolution.js";
import { retainFlowSourcePackages } from "../src/project/retained-flow.js";

const journalContract = await readFile(new URL(
  "../../../docs/spec/contracts/jig/journal.capability.json",
  import.meta.url,
), "utf8");

describe("private package resolution", () => {
  test("authenticates inputs, canonically orders targets, and freezes results", async () => {
    await withProject({
      "flows/z": run("z"),
      "flows/a": run("a"),
    }, [
      binding("bindings/z.ts", { package: "flows/z" }),
    ], async (project) => {
      expect(() => requirePackageProjectValue({ ...project })).toThrow(
        "project was not produced by the package-project linker",
      );
      const requests = buildPrivateActivationRequests(project);
      expect(requirePrivateActivationRequest(requests[0])).toBe(requests[0]);
      expect(() => requirePrivateActivationRequest({ ...requests[0]! })).toThrow(
        "activation request was not produced from a linked package project",
      );
      expect(requests.map(({ target }) => target)).toEqual([
        { kind: "binding", id: "z" },
        { kind: "flow", path: "flows/a" },
        { kind: "flow", path: "flows/z" },
      ]);

      const snapshot = planning(requests, () => "planned", true);
      const reversed = planning(requests, () => "planned", false);
      expect(reversed.digest).toBe(snapshot.digest);
      expect(() => resolveLinkedPackageProjectObservation(project, digest("capture"), { ...snapshot })).toThrow(
        "planning observation was not produced by the trusted host boundary",
      );

      const resolution = resolveLinkedPackageProjectObservation(project, digest("capture"), snapshot);
      expect(resolution.targets.map(({ request }) => request.target)).toEqual(
        requests.map(({ target }) => target),
      );
      expect(resolution.admissible).toBeFalse();
      expect(Object.isFrozen(resolution)).toBeTrue();
      expect(Object.isFrozen(resolution.targets)).toBeTrue();
      expect(Object.isFrozen(resolution.targets[0]!.request)).toBeTrue();
      expect(Object.isFrozen(resolution.targets[0]!.disposition)).toBeTrue();
      expect(() => requirePrivateRetainedResolutionObservation(resolution)).toThrow(
        "resolution observation was not tied to the retained aggregate boundary",
      );
    });
  });

  test("separates capture, host-input, and semantic identity", async () => {
    await withProject({ "flows/run": run("run") }, [], async (project) => {
      const requests = buildPrivateActivationRequests(project);
      const first = planning(requests, () => "planned");
      const captureA = resolveLinkedPackageProjectObservation(project, digest("capture-a"), first);
      const captureB = resolveLinkedPackageProjectObservation(project, digest("capture-b"), first);
      expect(captureB.semanticDigest).toBe(captureA.semanticDigest);
      expect(captureB.captureDigest).not.toBe(captureA.captureDigest);
      expect(captureB.planningObservationDigest).toBe(captureA.planningObservationDigest);
      expect(captureB.resolutionInputDigest).not.toBe(captureA.resolutionInputDigest);

      const otherPolicy = planning(requests, () => "planned", true, {
        policyDigest: digest("other-policy"),
      });
      const policyResult = resolveLinkedPackageProjectObservation(project, digest("capture-a"), otherPolicy);
      expect(policyResult.semanticDigest).toBe(captureA.semanticDigest);
      expect(policyResult.resolutionInputDigest).not.toBe(captureA.resolutionInputDigest);

      const otherRecipe = planning(requests, () => "planned", true, {
        recipe: { adapter: extension("other-adapter") },
      });
      const recipeResult = resolveLinkedPackageProjectObservation(project, digest("capture-a"), otherRecipe);
      expect(recipeResult.semanticDigest).not.toBe(captureA.semanticDigest);
    });
  });

  test("keeps Journal publishers in semantics but outside the activation target set", async () => {
    await withProject({
      "flows/producer": {
        "FLOW.md": metadata(`name: producer
description: Producer.
uses:
  journal:
    contract: ./contracts/journal.capability.json`),
        "flow.ts": "export {};\n",
        "contracts/journal.capability.json": journalContract,
      },
    }, [
      { sourcePath: "bindings/publisher.ts", definition: defineJournalPublisher({
        eventTypes: ["https://example.org/events/work-created"],
      }) },
      binding("bindings/producer.ts", {
        package: "flows/producer",
        slots: { journal: bindingRef("publisher") },
      }),
    ], async (project) => {
      const requests = buildPrivateActivationRequests(project);
      expect(requests.map(({ target }) => target)).toEqual([
        { kind: "binding", id: "producer" },
      ]);
      const resolution = resolveLinkedPackageProjectObservation(
        project,
        digest("journal-capture"),
        planning(requests, () => "planned"),
      );
      expect(resolution.targets).toHaveLength(1);
      expect(project.journalPublishers[0]).toMatchObject({
        id: "publisher",
        source: "binding:publisher",
        eventTypes: ["https://example.org/events/work-created"],
      });
    });
  });

  test("commits linked Hooks to semantic identity without creating activation targets", async () => {
    const trees = { "flows/triage": run("triage") };
    const bindings = [{
      sourcePath: "bindings/publisher.ts",
      definition: defineJournalPublisher({
        eventTypes: ["https://example.org/events/work-created"],
      }),
    }];
    let withoutHook: string | undefined;
    await withProject(trees, bindings, async (project) => {
      const requests = buildPrivateActivationRequests(project);
      withoutHook = resolveLinkedPackageProjectObservation(
        project,
        digest("hook-capture"),
        planning(requests, () => "planned"),
      ).semanticDigest;
    });
    await withProject(trees, bindings, async (project) => {
      const requests = buildPrivateActivationRequests(project);
      expect(requests.map(({ target }) => target)).toEqual([
        { kind: "flow", path: "flows/triage" },
      ]);
      expect(project.hooks).toHaveLength(1);
      const withHook = resolveLinkedPackageProjectObservation(
        project,
        digest("hook-capture"),
        planning(requests, () => "planned"),
      );
      expect(withHook.semanticDigest).not.toBe(withoutHook);
    }, [{
      sourcePath: "hooks/on-work.ts",
      definition: defineHook({
        on: {
          publisher: bindingRef("publisher"),
          type: "https://example.org/events/work-created",
        },
        run: flowRef("flows/triage"),
      }),
    }]);
  });

  test("requires an exact request-matched planning answer for every target", async () => {
    await withProject({ "flows/run": run("run") }, [], async (project) => {
      const [request] = buildPrivateActivationRequests(project);
      const empty = createPrivateActivationPlanningObservation({
        policyDigest: digest("policy"),
        mechanismDigest: digest("mechanisms"),
        entries: [],
      });
      expect(() => resolveLinkedPackageProjectObservation(project, digest("capture"), empty)).toThrow(
        "activation planning observation does not cover the exact target set",
      );

      const wrongRequest = { ...request!, digest: digest("wrong-request") };
      const wrong = planning([wrongRequest], () => "unavailable");
      expect(() => resolveLinkedPackageProjectObservation(project, digest("capture"), wrong)).toThrow(
        "activation planning observation does not match target flow\0flows/run",
      );

      const observation = plannedObservation(request!);
      expect(() => createPrivateActivationPlanningObservation({
        policyDigest: digest("policy"),
        mechanismDigest: digest("mechanisms"),
        entries: [{
          target: request!.target,
          requestDigest: digest("wrong-request"),
          disposition: { state: "planned", observation },
        }],
      })).toThrow("recipe observation does not belong to activation request");
    });
  });

  test("propagates unavailable Service dependencies but not child-Flow candidates", async () => {
    const contract = capability("https://example.org/contracts/index");
    await withProject({
      "flows/index": {
        "FLOW.md": metadata(`name: index
description: Index.
service: 1
provides:
  api: ./contracts/index.capability.json`),
        "flow.py": "pass\n",
        "contracts/index.capability.json": contract,
      },
      "flows/search": {
        "FLOW.md": metadata(`name: search
description: Search.
uses:
  index:
    contract: ./contracts/index.capability.json`),
        "flow.py": "pass\n",
        "contracts/index.capability.json": contract,
      },
      "flows/dispatcher": run("dispatcher"),
      "flows/worker": run("worker"),
    }, [
      binding("bindings/index.ts", { package: "flows/index" }),
      binding("bindings/search.ts", {
        package: "flows/search",
        slots: { index: bindingRef("index") },
      }),
      binding("bindings/dispatcher.ts", {
        package: "flows/dispatcher",
        slots: { work: flowRef("flows/worker") },
      }),
    ], async (project) => {
      const requests = buildPrivateActivationRequests(project);
      const snapshot = planning(requests, (request) => {
        const key = targetKey(request.target);
        return key === "binding:index" || key === "flow:flows/worker"
          ? "unavailable"
          : "planned";
      });
      const resolution = resolveLinkedPackageProjectObservation(project, digest("capture"), snapshot);
      const byTarget = new Map(resolution.targets.map((target) => [
        targetKey(target.request.target),
        target.disposition,
      ]));
      expect(byTarget.get("binding:index")).toMatchObject({
        state: "unavailable",
        code: "RUNTIME_UNAVAILABLE",
      });
      expect(byTarget.get("binding:search")).toMatchObject({
        state: "unavailable",
        code: "DEPENDENCY_UNAVAILABLE",
      });
      expect(byTarget.get("binding:dispatcher")).toMatchObject({ state: "planned" });
      expect(byTarget.get("flow:flows/worker")).toMatchObject({
        state: "unavailable",
        code: "RUNTIME_UNAVAILABLE",
      });
    });
  });

  test("normalizes only closed bounded planning data", async () => {
    await withProject({ "flows/run": run("run") }, [], async (project) => {
      const [request] = buildPrivateActivationRequests(project);
      let getterCalls = 0;
      const accessor = Object.defineProperty({
        policyDigest: digest("policy"),
        mechanismDigest: digest("mechanisms"),
      }, "entries", {
        enumerable: true,
        get() {
          getterCalls += 1;
          return [];
        },
      });
      expect(() => createPrivateActivationPlanningObservation(accessor as never)).toThrow(
        "entries must be an enumerable data property",
      );
      expect(getterCalls).toBe(0);

      let proxyTraps = 0;
      const proxy = new Proxy({}, {
        ownKeys() {
          proxyTraps += 1;
          return [];
        },
      });
      expect(() => createPrivateActivationPlanningObservation(proxy as never)).toThrow(
        "must not be a Proxy",
      );
      expect(proxyTraps).toBe(0);

      const sparse = new Array(1);
      expect(() => createPrivateActivationPlanningObservation({
        policyDigest: digest("policy"),
        mechanismDigest: digest("mechanisms"),
        entries: sparse as never,
      })).toThrow("sparse");

      class Entries extends Array<unknown> {}
      expect(() => createPrivateActivationPlanningObservation({
        policyDigest: digest("policy"),
        mechanismDigest: digest("mechanisms"),
        entries: new Entries() as never,
      })).toThrow("ordinary array");

      const evidenceDigests = Array.from({ length: 65 }, (_, index) => digest(`evidence-${index}`));
      expect(() => createPrivateActivationPlanningObservation({
        policyDigest: digest("policy"),
        mechanismDigest: digest("mechanisms"),
        entries: [{
          target: request!.target,
          requestDigest: request!.digest,
          disposition: {
            state: "unavailable",
            code: "RUNTIME_UNAVAILABLE",
            evidenceDigests,
          },
        }],
      })).toThrow("exceeds 64 members");

      expect(() => createPrivateActivationPlanningObservation({
        policyDigest: digest("policy"),
        mechanismDigest: digest("mechanisms"),
        entries: Array.from({ length: 4_097 }, () => null) as never,
      })).toThrow("exceeds 4096 members");

      const orderedEvidence = [digest("evidence-a"), digest("evidence-b")];
      const evidenceObservation = (evidence: readonly string[]) =>
        createPrivateActivationPlanningObservation({
          policyDigest: digest("policy"),
          mechanismDigest: digest("mechanisms"),
          entries: [{
            target: request!.target,
            requestDigest: request!.digest,
            disposition: {
              state: "unavailable",
              code: "RUNTIME_UNAVAILABLE",
              evidenceDigests: evidence,
            },
          }],
        });
      expect(evidenceObservation([...orderedEvidence].reverse()).digest).toBe(
        evidenceObservation(orderedEvidence).digest,
      );

      const commonEvidence = Array.from({ length: 64 }, (_, index) => digest(`common-${index}`));
      expect(() => createPrivateActivationPlanningObservation({
        policyDigest: digest("policy"),
        mechanismDigest: digest("mechanisms"),
        entries: Array.from({ length: 1_025 }, (_, index) => ({
          target: { kind: "flow" as const, path: `flows/target-${index}` },
          requestDigest: digest(`request-${index}`),
          disposition: {
            state: "unavailable" as const,
            code: "RUNTIME_UNAVAILABLE" as const,
            evidenceDigests: commonEvidence,
          },
        })),
      })).toThrow("evidence exceeds 65536 digests");
    });
  });

  test("closes preparation, runtime-predicate, and digest domains", async () => {
    await withProject({ "flows/run": run("run") }, [], async (project) => {
      const [request] = buildPrivateActivationRequests(project);
      const base = observationInput(request!);
      expect(() => createPrivateActivationRecipeObservation({
        ...base,
        preparationPlanDigest: digest("preparation"),
      })).toThrow("preparation plan and envelope must both be present or both be absent");
      expect(() => createPrivateActivationRecipeObservation({
        ...base,
        preparationEnvelopeDigest: digest("envelope"),
      })).toThrow("preparation plan and envelope must both be present or both be absent");
      expect(() => createPrivateActivationRecipeObservation({
        ...base,
        runtimePredicates: ["root-process-mappings" as never],
      })).toThrow("runtime predicates exceeds 0 members");
    });

    const value = { same: true } as const;
    const expected = `sha256:${createHash("sha256")
      .update("JIG-Test-A/1\0", "ascii")
      .update(canonicalJson(value as unknown as JsonValue))
      .digest("hex")}`;
    expect(privateDomainDigest("JIG-Test-A/1", value)).toBe(expected);
    expect(privateDomainDigest("JIG-Test-B/1", value)).not.toBe(expected);
  });

  test("excludes Binding declaration provenance from observed semantics", async () => {
    let firstSemantic: string | undefined;
    await withProject({ "flows/run": run("run") }, [
      binding("bindings-a/run.ts", { package: "flows/run" }),
    ], async (project) => {
      const requests = buildPrivateActivationRequests(project);
      firstSemantic = resolveLinkedPackageProjectObservation(
        project,
        digest("capture-a"),
        planning(requests, () => "planned"),
      ).semanticDigest;
    });
    await withProject({ "flows/run": run("run") }, [
      binding("bindings-b/run.ts", { package: "flows/run" }),
    ], async (project) => {
      const requests = buildPrivateActivationRequests(project);
      const second = resolveLinkedPackageProjectObservation(
        project,
        digest("capture-b"),
        planning(requests, () => "planned"),
      );
      expect(second.semanticDigest).toBe(firstSemantic);
    });
  });
});

function planning(
  requests: readonly PrivateActivationRequest[],
  disposition: (request: PrivateActivationRequest) => "planned" | "unavailable",
  reverse = true,
  overrides: {
    readonly policyDigest?: string;
    readonly recipe?: Partial<PrivateActivationRecipeObservationInput>;
  } = {},
): PrivateActivationPlanningObservation {
  const ordered = reverse ? [...requests].reverse() : [...requests];
  return createPrivateActivationPlanningObservation({
    policyDigest: overrides.policyDigest ?? digest("policy"),
    mechanismDigest: digest("mechanisms"),
    entries: ordered.map((request) => ({
      target: request.target,
      requestDigest: request.digest,
      disposition: disposition(request) === "planned"
        ? {
            state: "planned" as const,
            observation: plannedObservation(request, overrides.recipe),
          }
        : {
            state: "unavailable" as const,
            code: "RUNTIME_UNAVAILABLE" as const,
            evidenceDigests: [digest(`unavailable:${targetKey(request.target)}`)],
          },
    })),
  });
}

function plannedObservation(
  request: PrivateActivationRequest,
  overrides: Partial<PrivateActivationRecipeObservationInput> = {},
) {
  return createPrivateActivationRecipeObservation({
    ...observationInput(request),
    ...overrides,
  });
}

function observationInput(
  request: PrivateActivationRequest,
): PrivateActivationRecipeObservationInput {
  const adapter = extension("adapter");
  return {
    requestDigest: request.digest,
    adapter,
    toolchainDigest: digest("toolchain"),
    inspectionDigest: digest("inspection"),
    preparationPlanDigest: null,
    launchPlanner: adapter,
    backend: extension("backend"),
    preparationEnvelopeDigest: null,
    launchEnvelopeDigest: digest("launch-envelope"),
    runtimeSupportClosureDigest: digest("runtime-closure"),
    runtimePredicates: [],
    requestedAuthorityDigest: digest("requested-authority"),
    wouldGrantAuthorityDigest: digest("would-grant-authority"),
    plannedAuthorityDigest: digest("planned-authority"),
  };
}

function extension(name: string) {
  return Object.freeze({ artifactDigest: digest(name), revision: `${name}/1` });
}

function targetKey(target: RunTargetIdentity): string {
  return target.kind === "flow" ? `flow:${target.path}` : `binding:${target.id}`;
}

function run(name: string): Record<string, string> {
  return {
    "FLOW.md": metadata(`name: ${name}\ndescription: ${name}.`),
    "flow.py": "pass\n",
  };
}

function binding(sourcePath: string, definition: Parameters<typeof defineBinding>[0]): InjectedBindingDeclaration {
  return { sourcePath, definition: defineBinding(definition) };
}

function metadata(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n`;
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

function digest(label: string): string {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

async function withProject(
  trees: Readonly<Record<string, Readonly<Record<string, string>>>>,
  bindings: readonly InjectedBindingDeclaration[],
  action: (project: PackageProjectValue) => Promise<void> | void,
  hooks: readonly InjectedHookDeclaration[] = [],
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "jig-project-resolution-"));
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
    const flows = await retainFlowSourcePackages(store, source);
    await action(linkPackageProject({ flows, bindings, hooks }));
  } finally {
    await source?.dispose();
    await rm(root, { recursive: true, force: true });
  }
}
