import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  observePrivateBunServicePackage,
  planPrivateBunService,
  requirePrivateBunServicePackageObservation,
  requirePrivateBunServiceRecipe,
} from "../src/internal/bun-service-recipe.js";
import { defineJig } from "../src/project/author.js";
import { captureFlowSource } from "../src/project/flow-source.js";
import {
  linkPackageProject,
  type InjectedBindingDeclaration,
  type PackageProjectValue,
} from "../src/project/package-project.js";
import {
  buildPrivateActivationRequests,
  type PrivateActivationRequest,
} from "../src/project/package-resolution.js";
import { retainFlowSourcePackages } from "../src/project/retained-flow.js";

describe("private Bun Service recipe prerequisite", () => {
  test("derives a stable sorted fixed export projection from retained Package/1 contracts", async () => {
    await withServiceProject({ bindings: ["counter"] }, async ({ store, project }) => {
      const request = serviceRequest(project, "counter");
      const first = await observePrivateBunServicePackage({ request, packageStoreRoot: store });
      const second = await observePrivateBunServicePackage({ request, packageStoreRoot: store });

      expect(first).toEqual(second);
      expect(first.digest).toBe(second.digest);
      expect(first.requestDigest).toBe(request.digest);
      expect(first.packageDigest).toBe(request.package.digest);
      expect(first.selector).toBe("bun");
      expect(first.exports.map((entry) => entry.name)).toEqual(["alpha", "zeta"]);
      expect(first.exports.map((entry) => entry.contract.id)).toEqual([
        "https://example.org/contracts/alpha",
        "https://example.org/contracts/zeta",
      ]);
      expect(Object.isFrozen(first)).toBeTrue();
      expect(Object.isFrozen(first.exports)).toBeTrue();
      expect(first.exports.every((entry) =>
        Object.isFrozen(entry) && Object.isFrozen(entry.contract))).toBeTrue();
      expect(requirePrivateBunServicePackageObservation(first)).toBe(first);
      await expect(observePrivateBunServicePackage({
        request,
        packageStoreRoot: store,
        selector: "",
      })).rejects.toThrow("selector is invalid");
    });
  });

  test("binds an observed export projection to one exact Binding request", async () => {
    await withServiceProject({ bindings: ["counter-a", "counter-b"] }, async ({ store, project }) => {
      const requestA = serviceRequest(project, "counter-a");
      const requestB = serviceRequest(project, "counter-b");
      const observedB = await observePrivateBunServicePackage({
        request: requestB,
        packageStoreRoot: store,
      });

      await expect(planPrivateBunService({
        request: requestA,
        packageObservation: observedB,
        runtimeSupport: {} as never,
        backend: {} as never,
      })).rejects.toThrow("belongs to another activation request");
    });
  });

  test("rejects non-Service and configured Service activations before package execution", async () => {
    await withServiceProject({ bindings: ["counter"], includeRun: true }, async ({ store, project }) => {
      const runRequest = buildPrivateActivationRequests(project).find(
        (request) => request.target.kind === "flow",
      )!;
      await expect(observePrivateBunServicePackage({
        request: runRequest,
        packageStoreRoot: store,
      })).rejects.toThrow("matching flow.ts Binding activation");
    });

    await withServiceProject({
      bindings: ["counter"],
      includeRun: true,
      counterSlots: { child: { kind: "flow", path: "flows/run" } },
    }, async ({ store, project }) => {
      await expect(observePrivateBunServicePackage({
        request: serviceRequest(project, "counter"),
        packageStoreRoot: store,
      })).rejects.toThrow("dependency-free zero-configuration Binding");
    });
  });

  test("rejects forged package observations and recipes without reading attacker fields", () => {
    let accessed = false;
    const forged = Object.defineProperty({}, "kind", {
      get() {
        accessed = true;
        return "private-bun-service-recipe/1";
      },
    });
    expect(() => requirePrivateBunServicePackageObservation(forged)).toThrow(
      "was not produced by private inspection",
    );
    expect(() => requirePrivateBunServiceRecipe(forged)).toThrow(
      "was not produced by the private planner",
    );
    expect(accessed).toBeFalse();
  });
});

async function withServiceProject(
  options: {
    readonly bindings: readonly string[];
    readonly includeRun?: boolean;
    readonly counterSlots?: Readonly<Record<string, unknown>>;
  },
  action: (value: {
    readonly store: string;
    readonly project: PackageProjectValue;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "jig-bun-service-recipe-"));
  const store = join(root, "store");
  let source: Awaited<ReturnType<typeof captureFlowSource>> | undefined;
  try {
    await mkdir(store, { mode: 0o700 });
    await writeTree(join(root, "flows/counter"), {
      "FLOW.md": metadata([
        "name: counter",
        "description: Counter Service.",
        "service: 1",
        "provides:",
        "  zeta: ./contracts/zeta.capability.json",
        "  alpha: ./contracts/alpha.capability.json",
      ].join("\n")),
      "flow.ts": "#!/usr/bin/env bun\nexport {};\n",
      "contracts/zeta.capability.json": capability("https://example.org/contracts/zeta"),
      "contracts/alpha.capability.json": capability("https://example.org/contracts/alpha"),
    });
    if (options.includeRun === true) {
      await writeTree(join(root, "flows/run"), {
        "FLOW.md": metadata("name: run\ndescription: Direct Run."),
        "flow.ts": "#!/usr/bin/env bun\nexport {};\n",
      });
    }
    const flowPaths = ["flows/counter", ...(options.includeRun === true ? ["flows/run"] : [])];
    source = await captureFlowSource(root, defineJig({ flows: flowPaths }).flows);
    const flows = await retainFlowSourcePackages(store, source);
    const bindings: InjectedBindingDeclaration[] = options.bindings.map((id) => ({
      sourcePath: `bindings/${id}.ts`,
      definition: {
        package: "flows/counter",
        ...(options.counterSlots === undefined ? {} : { slots: options.counterSlots }),
      },
    }));
    await action({ store, project: linkPackageProject({ flows, bindings }) });
  } finally {
    await source?.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

function serviceRequest(project: PackageProjectValue, id: string): PrivateActivationRequest {
  const request = buildPrivateActivationRequests(project).find(
    (candidate) => candidate.target.kind === "binding" && candidate.target.id === id,
  );
  if (request === undefined) throw new Error(`missing Service request ${id}`);
  return request;
}

async function writeTree(
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
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
    methods: {
      next: {
        input: { type: "object", additionalProperties: false },
        output: { type: "integer" },
        errors: {},
      },
    },
  });
}
