import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import {
  bindingRef,
  candidates,
  defineBinding,
  defineJig,
  defineJournalPublisher,
  discover,
  flowRef,
} from "../src/index.js";
import {
  defineHook,
  defineJig as defineHookJig,
} from "../src/experimental/hooks.js";
import { compileSchemaFile, SchemaDiagnostic } from "../src/schema/index.js";

const schemaBytes = await readFile(new URL(
  "../../../docs/spec/machine/project-authoring-1.schema.json",
  import.meta.url,
));
const schema = compileSchemaFile(schemaBytes, "project-authoring-1.schema.json");
const hookSchemaBytes = await readFile(new URL(
  "../../../docs/spec/machine/private-project-authoring-hooks-1.schema.json",
  import.meta.url,
));
const hookSchema = compileSchemaFile(hookSchemaBytes, "private-project-authoring-hooks-1.schema.json");

const project = defineJig({
  flows: discover("./flows"),
  bindings: ["./bindings/review.ts"],
});
const hookProject = defineHookJig({
  flows: discover("./flows"),
  bindings: ["./bindings/review.ts"],
  hooks: discover("./hooks"),
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
const publisher = defineJournalPublisher({
  eventTypes: ["https://example.org/events/work-created"],
});
const hook = defineHook({
  on: {
    publisher: bindingRef("publisher"),
    type: "https://example.org/events/work-created",
  },
  run: flowRef("flows/review"),
});

function changed(value: unknown, mutator: (copy: Record<string, any>) => void): unknown {
  const copy = structuredClone(value) as Record<string, any>;
  mutator(copy);
  return copy;
}

describe("Project Authoring SDK/1 and private Hook-overlay shape schemas", () => {
  test("keeps Hook values out of the frozen public profile", () => {
    expect(() => schema.validate(project, "INVALID_PROJECT_AUTHORING")).not.toThrow();
    expect(() => schema.validate(binding, "INVALID_PROJECT_AUTHORING")).not.toThrow();
    expect(() => schema.validate(publisher, "INVALID_PROJECT_AUTHORING")).not.toThrow();
    expect(() => schema.validate(hookProject, "INVALID_PROJECT_AUTHORING")).toThrow(SchemaDiagnostic);
    expect(() => schema.validate(hook, "INVALID_PROJECT_AUTHORING")).toThrow(SchemaDiagnostic);
    expect(() => hookSchema.validate(hookProject, "INVALID_PROJECT_AUTHORING")).not.toThrow();
    expect(() => hookSchema.validate(hook, "INVALID_PROJECT_AUTHORING")).not.toThrow();
  });

  for (const [name, value] of [
    ["unknown project field", changed(hookProject, (item) => { item.extra = {}; })],
    ["unknown source kind", changed(hookProject, (item) => { item.flows.kind = "glob"; })],
    ["missing discovery roots", changed(hookProject, (item) => { delete item.flows.roots; })],
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
    ["oversized project path", changed(binding, (item) => {
      item.package = "a".repeat(1025);
    })],
    ["empty Journal publisher authority", changed(publisher, (item) => {
      item.eventTypes = [];
    })],
    ["unknown Journal publisher field", changed(publisher, (item) => {
      item.grants = {};
    })],
    ["raw Hook publisher", changed(hook, (item) => {
      item.on.publisher = "publisher";
    })],
    ["candidate Hook target", changed(hook, (item) => {
      item.run = { kind: "candidates", targets: [flowRef("flows/a"), flowRef("flows/b")] };
    })],
    ["unknown Hook field", changed(hook, (item) => {
      item.filter = {};
    })],
  ] as const) {
    test(`rejects ${name}`, () => {
      expect(() => hookSchema.validate(value, "INVALID_PROJECT_AUTHORING")).toThrow(SchemaDiagnostic);
    });
  }
});
