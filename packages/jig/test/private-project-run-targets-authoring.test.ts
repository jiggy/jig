import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import * as publicSdk from "../src/index.js";
import { defineBinding, flowRef } from "../src/index.js";
import {
  definePrivateProjectRunTargetsBinding,
  defineJournalPublisher,
  normalizePackageBindingDefinition,
  normalizePrivateProjectRunTargetsBindingDefinition,
  projectRunTargets,
} from "../src/project/author.js";
import { compileSchemaFile, SchemaDiagnostic } from "../src/schema/index.js";

const publicSchema = compileSchemaFile(
  await readFile(new URL("../../../docs/spec/machine/project-authoring-1.schema.json", import.meta.url)),
  "project-authoring-1.schema.json",
);
const privateSchema = compileSchemaFile(
  await readFile(new URL(
    "../../../docs/spec/machine/private-project-run-targets-authoring-1.schema.json",
    import.meta.url,
  )),
  "private-project-run-targets-authoring-1.schema.json",
);

describe("private projectRunTargets authoring overlay", () => {
  test("accepts, snapshots, deeply freezes, and canonically re-normalizes the marker", () => {
    const source = projectRunTargets();
    const binding = definePrivateProjectRunTargetsBinding({
      package: "./flows/dispatcher",
      slots: { work: source },
    });

    expect(binding).toEqual({
      kind: "package",
      package: "flows/dispatcher",
      settings: {},
      slots: {
        work: {
          kind: "project-run-targets",
        },
      },
      attachments: {},
    });
    expect(Object.isFrozen(source)).toBeTrue();
    expect(Object.isFrozen(binding)).toBeTrue();
    expect(Object.isFrozen(binding.slots)).toBeTrue();
    expect(Object.isFrozen(binding.slots.work)).toBeTrue();

    const normalized = normalizePrivateProjectRunTargetsBindingDefinition(binding);
    expect(normalized).toEqual(binding);
    expect(normalizePrivateProjectRunTargetsBindingDefinition(normalized)).toEqual(normalized);
    expect(Object.isFrozen(normalized.slots.work)).toBeTrue();
    expect(() => privateSchema.validate(binding, "INVALID_PRIVATE_PROJECT_RUN_TARGETS")).not.toThrow();
    expect(() => privateSchema.validate(
      defineJournalPublisher({ eventTypes: ["https://example.test/event"] }),
      "INVALID_PRIVATE_PROJECT_RUN_TARGETS",
    )).not.toThrow();
  });

  test("keeps the marker outside the public author and machine profiles", () => {
    const privateBinding = definePrivateProjectRunTargetsBinding({
      package: "flows/dispatcher",
      slots: { work: projectRunTargets() },
    });

    expect(() => defineBinding({
      package: "flows/dispatcher",
      slots: { work: projectRunTargets() } as never,
    })).toThrow("not part of Project Authoring SDK/1");
    expect(() => normalizePackageBindingDefinition(privateBinding)).toThrow(
      "not part of Project Authoring SDK/1",
    );
    expect(() => publicSchema.validate(privateBinding, "INVALID_PROJECT_AUTHORING")).toThrow(
      SchemaDiagnostic,
    );
    expect("projectRunTargets" in publicSdk).toBeFalse();
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
      expect(() => normalizePrivateProjectRunTargetsBindingDefinition(binding)).toThrow();
      expect(() => privateSchema.validate(binding, "INVALID_PRIVATE_PROJECT_RUN_TARGETS")).toThrow(
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

    expect(() => normalizePrivateProjectRunTargetsBindingDefinition(nested)).toThrow(
      "Run target must be a flowRef() or bindingRef()",
    );
    expect(() => privateSchema.validate(nested, "INVALID_PRIVATE_PROJECT_RUN_TARGETS")).toThrow(
      SchemaDiagnostic,
    );
  });
});
