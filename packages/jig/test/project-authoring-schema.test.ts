import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { defineBinding, defineJig, discover } from "../src/index.js";
import { compileSchemaFile, SchemaDiagnostic } from "../src/schema/index.js";

const schema = compileSchemaFile(await readFile(new URL(
  "../../../docs/spec/machine/project-authoring-1.schema.json",
  import.meta.url,
)), "project-authoring-1.schema.json");

const project = defineJig({
  flows: discover("./flows"),
  bindings: ["./bindings/review.ts"],
});
const binding = defineBinding({
  package: "./flows/review",
  settings: { retries: 2 },
});

function changed(value: unknown, mutate: (copy: Record<string, any>) => void): unknown {
  const copy = structuredClone(value) as Record<string, any>;
  mutate(copy);
  return copy;
}

describe("Project Authoring SDK/1 shape schema", () => {
  test("accepts the complete direct-alpha authoring surface", () => {
    expect(() => schema.validate(project, "INVALID_PROJECT_AUTHORING")).not.toThrow();
    expect(() => schema.validate(binding, "INVALID_PROJECT_AUTHORING")).not.toThrow();
  });

  for (const [name, value] of [
    ["unknown project field", changed(project, (item) => { item.extra = {}; })],
    ["unknown source kind", changed(project, (item) => { item.flows.kind = "glob"; })],
    ["missing discovery roots", changed(project, (item) => { delete item.flows.roots; })],
    ["unknown Binding field", changed(binding, (item) => { item.grants = {}; })],
    ["unsupported Binding attachments", changed(binding, (item) => { item.attachments = {}; })],
    ["missing normalized settings", changed(binding, (item) => { delete item.settings; })],
    ["oversized project path", changed(binding, (item) => { item.package = "a".repeat(1025); })],
  ] as const) {
    test(`rejects ${name}`, () => {
      expect(() => schema.validate(value, "INVALID_PROJECT_AUTHORING")).toThrow(SchemaDiagnostic);
    });
  }
});
