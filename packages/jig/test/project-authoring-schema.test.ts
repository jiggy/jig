import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import {
  bindingRef,
  candidates,
  defineBinding,
  defineJig,
  discover,
  flowRef,
} from "../src/index.js";
import { compileSchemaFile, SchemaDiagnostic } from "../src/schema/index.js";

const schemaBytes = await readFile(new URL(
  "../../../docs/spec/machine/project-authoring-1.schema.json",
  import.meta.url,
));
const schema = compileSchemaFile(schemaBytes, "project-authoring-1.schema.json");

const project = defineJig({
  flows: discover("./flows"),
  bindings: ["./bindings/review.ts"],
});
const binding = defineBinding({
  package: "./flows/review",
  settings: {},
  slots: {
    "exact-flow": flowRef("./flows/exact"),
    "exact-binding": bindingRef("strict"),
    research: candidates([
      bindingRef("research-deep"),
      flowRef("./flows/research-fast"),
    ]),
  },
  attachments: { source: "./workspace" },
});

function changed(value: unknown, mutator: (copy: Record<string, any>) => void): unknown {
  const copy = structuredClone(value) as Record<string, any>;
  mutator(copy);
  return copy;
}

describe("Project Authoring SDK/1 shape schema", () => {
  test("accepts actual helper-produced project and Binding values", () => {
    expect(() => schema.validate(project, "INVALID_PROJECT_AUTHORING")).not.toThrow();
    expect(() => schema.validate(binding, "INVALID_PROJECT_AUTHORING")).not.toThrow();
  });

  for (const [name, value] of [
    ["unknown project field", changed(project, (item) => { item.hooks = {}; })],
    ["unknown source kind", changed(project, (item) => { item.flows.kind = "glob"; })],
    ["missing discovery roots", changed(project, (item) => { delete item.flows.roots; })],
    ["unknown Binding field", changed(binding, (item) => { item.grants = {}; })],
    ["missing normalized settings", changed(binding, (item) => { delete item.settings; })],
    ["raw slot target", changed(binding, (item) => { item.slots.research = "research"; })],
    ["singleton candidate set", changed(binding, (item) => { item.slots.research.targets.pop(); })],
    ["unknown candidate field", changed(binding, (item) => { item.slots.research.extra = true; })],
    ["wrong Flow reference branch", changed(binding, (item) => {
      item.slots["exact-flow"] = { kind: "flow", id: "wrong" };
    })],
    ["wrong Binding reference branch", changed(binding, (item) => {
      item.slots["exact-binding"] = { kind: "binding", path: "wrong" };
    })],
  ] as const) {
    test(`rejects ${name}`, () => {
      expect(() => schema.validate(value, "INVALID_PROJECT_AUTHORING")).toThrow(SchemaDiagnostic);
    });
  }
});
