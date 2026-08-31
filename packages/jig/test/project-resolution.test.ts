import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { defineBinding, defineJig } from "../src/project/author.js";
import { captureFlowSource } from "../src/project/flow-source.js";
import {
  linkPackageProject,
  requirePackageProjectValue,
  type InjectedBindingDeclaration,
  type PackageProjectValue,
  type RunTargetIdentity,
} from "../src/project/package-project.js";
import {
  buildPrivateActivationRequests,
  requirePrivateActivationRequest,
  requirePrivateRetainedResolutionObservation,
  resolveLinkedPackageProjectObservation,
  restorePrivateActivationRequest,
  type PrivateActivationRequest,
} from "../src/project/package-resolution.js";
import { retainFlowSourcePackages } from "../src/project/retained-flow.js";

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
      const restored = restorePrivateActivationRequest(structuredClone(requests[0]!));
      expect(restored).toEqual(requests[0]);
      expect(() => restorePrivateActivationRequest({
        ...structuredClone(requests[0]!),
        kind: "invalid-activation-request-kind",
      })).toThrow("activation request kind must be activation-request/2");
      expect(() => restorePrivateActivationRequest({
        ...structuredClone(requests[0]!),
        target: { kind: "unknown", id: "z" },
      })).toThrow("activation target kind must be flow or binding");
      expect(requests.map(({ target }) => target)).toEqual([
        { kind: "binding", id: "z" },
        { kind: "flow", path: "flows/a" },
        { kind: "flow", path: "flows/z" },
      ]);

      const snapshot = planning(requests, (request) =>
        targetKey(request.target) === "flow:flows/a" ? "unavailable" : "planned", true);
      const reversed = planning(requests, (request) =>
        targetKey(request.target) === "flow:flows/a" ? "unavailable" : "planned", false);
      expect(reversed.digest).toBe(snapshot.digest);
      expect(() => resolveLinkedPackageProjectObservation(project, digest("capture"), { ...snapshot })).toThrow(
        "planning observation was not produced by the trusted host boundary",
      );

      const resolution = resolveLinkedPackageProjectObservation(project, digest("capture"), snapshot);
      expect(resolution.targets.map(({ request }) => request.target)).toEqual(
        requests.map(({ target }) => target),
      );
      expect(resolution.targets[1]!.disposition).toMatchObject({
        state: "unavailable",
        code: "RUNTIME_UNAVAILABLE",
      });
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
              state: "unavailable" as const,
              code: "RUNTIME_UNAVAILABLE" as const,
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

  test("closes runtime-predicate and digest domains", async () => {
    await withProject({ "flows/run": run("run") }, [], async (project) => {
      const [request] = buildPrivateActivationRequests(project);
      const base = observationInput(request!);
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
    launchPlanner: adapter,
    backend: extension("backend"),
    launchEnvelopeDigest: digest("launch-envelope"),
    installedSupportDigest: digest("installed-support"),
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
    "flow.ts": "export {};\n",
  };
}

function binding(
  sourcePath: string,
  definition: Parameters<typeof defineBinding>[0],
): InjectedBindingDeclaration {
  return { sourcePath, definition: defineBinding(definition) };
}

function metadata(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n`;
}

function digest(label: string): string {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

async function withProject(
  trees: Readonly<Record<string, Readonly<Record<string, string>>>>,
  bindings: readonly InjectedBindingDeclaration[],
  action: (project: PackageProjectValue) => Promise<void> | void,
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
    await action(linkPackageProject({ flows, bindings }));
  } finally {
    await source?.dispose();
    await rm(root, { recursive: true, force: true });
  }
}
