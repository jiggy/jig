import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  bindingRef,
  definePrivateProjectRunTargetsBinding,
  defineHook,
  defineJig,
  defineJournalPublisher,
  projectRunTargets,
} from "../src/project/author.js";
import { captureFlowSource } from "../src/project/flow-source.js";
import {
  linkPackageProject,
  privateProjectRunTargetCatalogue,
  type InjectedBindingDeclaration,
} from "../src/project/package-project.js";
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

  test("returns one frozen empty catalogue for an authenticated empty project", () => {
    const catalogue = privateProjectRunTargetCatalogue(linkPackageProject({
      flows: [],
      bindings: [],
    }));
    expect(catalogue).toEqual([]);
    expect(Object.isFrozen(catalogue)).toBeTrue();
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
