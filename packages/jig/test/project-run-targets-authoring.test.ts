import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import {
  defineBinding,
  defineJournalPublisher,
  flowRef,
  normalizePackageBindingDefinition,
  projectRunTargets,
} from "../src/project/author.js";
import * as publicSdk from "../src/index.js";
import { compileSchemaFile, SchemaDiagnostic } from "../src/schema/index.js";

const schema = compileSchemaFile(
  await readFile(new URL(
    "../../../docs/spec/machine/project-authoring-1.schema.json",
    import.meta.url,
  )),
  "project-authoring-1.schema.json",
);

describe("public projectRunTargets authoring source", () => {
  test("accepts, snapshots, deeply freezes, and canonically re-normalizes the marker", () => {
    const source = projectRunTargets();
    const binding = defineBinding({
      package: "./flows/dispatcher",
      slots: { work: source },
    });

    expect(binding).toEqual({
      kind: "package",
      package: "flows/dispatcher",
      settings: {},
      slots: { work: { kind: "project-run-targets" } },
      attachments: {},
    });
    expect(Object.isFrozen(source)).toBeTrue();
    expect(Object.isFrozen(binding)).toBeTrue();
    expect(Object.isFrozen(binding.slots)).toBeTrue();
    expect(Object.isFrozen(binding.slots.work)).toBeTrue();

    const normalized = normalizePackageBindingDefinition(binding);
    expect(normalized).toEqual(binding);
    expect(normalizePackageBindingDefinition(normalized)).toEqual(normalized);
    expect(() => schema.validate(binding, "INVALID_PROJECT_AUTHORING")).not.toThrow();
    expect(() => schema.validate(
      defineJournalPublisher({ eventTypes: ["https://example.test/event"] }),
      "INVALID_PROJECT_AUTHORING",
    )).not.toThrow();
    expect(publicSdk.projectRunTargets()).toEqual(source);
  });

  test("rejects expanded and speculative marker shapes", () => {
    for (const marker of [
      { kind: "project-run-targets", extra: true },
      { kind: "candidate-source", source: "project-run-targets" },
    ]) {
      const binding = {
        kind: "package",
        package: "flows/dispatcher",
        settings: {},
        slots: { work: marker },
        attachments: {},
      };
      expect(() => normalizePackageBindingDefinition(binding)).toThrow();
      expect(() => schema.validate(binding, "INVALID_PROJECT_AUTHORING")).toThrow(
        SchemaDiagnostic,
      );
    }
  });

  test("forbids a changing source inside candidates", () => {
    const nested = {
      kind: "package",
      package: "flows/dispatcher",
      settings: {},
      slots: {
        work: {
          kind: "candidates",
          targets: [projectRunTargets(), flowRef("flows/worker")],
        },
      },
      attachments: {},
    };

    expect(() => normalizePackageBindingDefinition(nested)).toThrow(
      "Run target must be a flowRef() or bindingRef()",
    );
    expect(() => schema.validate(nested, "INVALID_PROJECT_AUTHORING")).toThrow(
      SchemaDiagnostic,
    );
  });
});
