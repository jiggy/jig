import { beforeAll, describe, expect, test } from "bun:test";

import {
  parseCapabilityContract,
  type ParsedCapabilityContract,
} from "../src/capability/index.js";
import {
  AGENT_RUN_CONTRACT_DIGEST,
  AGENT_RUN_CONTRACT_ID,
  AGENT_RUN_CONTRACT_VERSION,
  AgentRunValidationError,
  assertAgentRunContract,
  parseAgentRunInput,
  parseAgentRunResult,
  projectAgentRunSkills,
} from "../src/internal/private-agent-run.js";
import type { CapturedFile, CapturedPackage } from "../src/package/capture.js";
import { comparePathBytes } from "../src/package/paths.js";
import { SCHEMA_1_URI, SchemaDiagnostic } from "../src/schema/index.js";

const contractPath = new URL(
  "../../../docs/jig/spec/contracts/agent-run.capability.json",
  import.meta.url,
);
let contract: ParsedCapabilityContract;

beforeAll(async () => {
  contract = parseCapabilityContract(
    await Bun.file(contractPath).bytes(),
    "agent-run.capability.json",
  );
});

describe("private Agent Run contract", () => {
  test("publishes and exact-matches the current Jig-owned descriptor", () => {
    expect(contract.descriptor.id).toBe(AGENT_RUN_CONTRACT_ID);
    expect(contract.descriptor.version).toBe(AGENT_RUN_CONTRACT_VERSION);
    expect(contract.digest).toBe(AGENT_RUN_CONTRACT_DIGEST);
    expect(Object.keys(contract.descriptor.methods)).toEqual(["run"]);
    expect(() => assertAgentRunContract(contract)).not.toThrow();
  });

  test("snapshots one valid input and treats omitted skills as none", () => {
    const source = { instructions: "Do the bounded work." };
    const prepared = parseAgentRunInput(contract, source);
    source.instructions = "changed afterward";

    expect(prepared.input).toEqual({ instructions: "Do the bounded work." });
    expect(prepared.selectedSkills).toEqual([]);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.input)).toBe(true);
    expect(Object.isFrozen(prepared.selectedSkills)).toBe(true);
    expect(parseAgentRunResult(contract, prepared, {
      outcome: "blocked",
      text: "No suitable action.",
    })).toEqual({ outcome: "blocked", text: "No suitable action." });
  });

  test("requires recursive responseSchema results and validates their structured value", () => {
    const prepared = parseAgentRunInput(contract, {
      instructions: "Return bounded evidence.",
      responseSchema: {
        $schema: SCHEMA_1_URI,
        type: "object",
        properties: {
          assessment: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["clear", "ambiguous"] },
              amount: { type: ["integer", "null"] },
              note: { type: ["string", "null"] },
              sources: {
                type: "array",
                minItems: 0,
                maxItems: 2,
                items: {
                  type: "object",
                  properties: {
                    page: { type: "integer" },
                    excerpt: { type: "string" },
                  },
                  required: ["page", "excerpt"],
                  additionalProperties: false,
                },
              },
            },
            required: ["status", "amount", "note", "sources"],
            additionalProperties: false,
          },
        },
        required: ["assessment"],
        additionalProperties: false,
      },
    });

    expect(() => parseAgentRunResult(contract, prepared, {
      outcome: "completed",
      text: "missing",
    })).toThrow(expect.objectContaining({ code: "AGENT_RUN_STRUCTURED_REQUIRED" }));
    expect(() => parseAgentRunResult(contract, prepared, {
      outcome: "completed",
      text: "invalid",
      structured: {
        assessment: {
          status: "clear",
          amount: 1_500,
          note: null,
          sources: [{ page: 1 }],
        },
      },
    })).toThrow(expect.objectContaining({ code: "AGENT_RUN_STRUCTURED_INVALID" }));
    expect(parseAgentRunResult(contract, prepared, {
      outcome: "completed",
      text: "valid",
      structured: {
        assessment: {
          status: "clear",
          amount: 1_500,
          note: null,
          sources: [{ page: 1, excerpt: "base pay" }],
        },
      },
    })).toEqual({
      outcome: "completed",
      text: "valid",
      structured: {
        assessment: {
          status: "clear",
          amount: 1_500,
          note: null,
          sources: [{ page: 1, excerpt: "base pay" }],
        },
      },
    });
    expect(parseAgentRunResult(contract, prepared, {
      outcome: "limit",
      text: "output limit reached",
    })).toEqual({ outcome: "limit", text: "output limit reached" });
  });

  test("rejects malformed values and an invalid response Schema/1 root", () => {
    expect(() => parseAgentRunInput(contract, { instructions: "" }))
      .toThrow(expect.objectContaining({ code: "AGENT_RUN_INPUT_INVALID" }));
    expect(() => parseAgentRunInput(contract, {
      instructions: "invalid schema",
      responseSchema: { type: "object" },
    })).toThrow(expect.objectContaining({ code: "SCHEMA_INVALID" }));

    const prepared = parseAgentRunInput(contract, { instructions: "check output" });
    expect(() => parseAgentRunResult(contract, prepared, {
      outcome: "invented",
      text: "invalid",
    })).toThrow(expect.objectContaining({ code: "AGENT_RUN_RESULT_INVALID" }));

    const accessor = Object.defineProperty({}, "instructions", {
      enumerable: true,
      get: () => "hidden getter",
    });
    expect(() => parseAgentRunInput(contract, accessor))
      .toThrow(expect.objectContaining({ code: "AGENT_RUN_JSON_INVALID" }));
  });

  test("reparses exact descriptor bytes instead of trusting caller schema state", () => {
    const schemas = new Map(contract.schemas);
    schemas.set("/methods/run/input", { path: "forged", schemaPointer: "", validate() {} });
    const forgedSchemas = { ...contract, schemas } as ParsedCapabilityContract;
    expect(() => parseAgentRunInput(forgedSchemas, { instructions: 3 }))
      .toThrow(expect.objectContaining({ code: "AGENT_RUN_INPUT_INVALID" }));

    const changed = {
      ...contract,
      descriptor: { ...contract.descriptor, version: "1.0.1" },
    } as ParsedCapabilityContract;
    expect(() => assertAgentRunContract(changed))
      .toThrow(expect.objectContaining({ code: "AGENT_RUN_CONTRACT_MISMATCH" }));

    const oldDomain = {
      ...contract,
      descriptor: { ...contract.descriptor, id: "https://jig.dev/contracts/agent-run" },
    } as ParsedCapabilityContract;
    expect(() => assertAgentRunContract(oldDomain))
      .toThrow(expect.objectContaining({ code: "AGENT_RUN_CONTRACT_MISMATCH" }));
  });

  test("rejects a forged prepared-input object", () => {
    expect(() => parseAgentRunResult(
      contract,
      { input: { instructions: "forged" }, selectedSkills: [] },
      { outcome: "completed", text: "not admitted" },
    )).toThrow(expect.objectContaining({ code: "AGENT_RUN_INPUT_UNPREPARED" }));
  });
});

describe("private Agent Run package-local skill projection", () => {
  test("copies only selected exact subtrees into an immutable relative manifest", async () => {
    const fixture = capturedPackage({
      "FLOW.md": "package metadata",
      "secret.txt": "not projected",
      "skills/coding/SKILL.md": "# Coding\n",
      "skills/coding/assets/check.bin": Uint8Array.of(0, 1, 255),
      "skills/coding/references/check.txt": "exact evidence\n",
      "skills/review/SKILL.md": "# Review\n",
    });

    const manifest = await projectAgentRunSkills(fixture.package, ["coding"]);
    expect(fixture.reads).toEqual([
      "skills/coding/SKILL.md",
      "skills/coding/assets/check.bin",
      "skills/coding/references/check.txt",
    ]);
    expect(manifest.fileCount).toBe(3);
    expect(manifest.contentBytes).toBe(9 + 3 + 15);
    expect(manifest.skills.map((skill) => skill.name)).toEqual(["coding"]);
    expect(manifest.skills[0]!.files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "assets/check.bin",
      "references/check.txt",
    ]);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.skills)).toBe(true);
    expect(Object.isFrozen(manifest.skills[0])).toBe(true);
    expect(Object.isFrozen(manifest.skills[0]!.files)).toBe(true);

    const file = manifest.skills[0]!.files[1]!;
    const first = file.bytes();
    first.fill(9);
    expect(file.bytes()).toEqual(Uint8Array.of(0, 1, 255));
    expect(first).not.toBe(file.bytes());
  });

  test("preserves canonical selected-skill order and exposes an empty omission", async () => {
    const fixture = capturedPackage({
      "FLOW.md": "package metadata",
      "skills/coding/SKILL.md": "# Coding\n",
      "skills/review/SKILL.md": "# Review\n",
    });
    const manifest = await projectAgentRunSkills(fixture.package, ["coding", "review"]);
    expect(manifest.skills.map((skill) => skill.name)).toEqual(["coding", "review"]);

    fixture.reads.splice(0);
    const empty = await projectAgentRunSkills(fixture.package, []);
    expect(empty).toEqual({ skills: [], fileCount: 0, contentBytes: 0 });
    expect(fixture.reads).toEqual([]);
  });

  test("rejects malformed, duplicate, unsorted, and unknown selections before reads", async () => {
    const fixture = capturedPackage({
      "FLOW.md": "package metadata",
      "skills/coding/SKILL.md": "# Coding\n",
      "skills/review/SKILL.md": "# Review\n",
      "skills/nested/reference.txt": "not a skill without its root SKILL.md",
    });
    for (const selected of [
      ["Bad"],
      ["nested/path"],
      ["coding", "coding"],
      ["review", "coding"],
    ]) {
      await expect(projectAgentRunSkills(fixture.package, selected))
        .rejects.toBeInstanceOf(AgentRunValidationError);
    }
    for (const selected of [["missing"], ["nested"]]) {
      await expect(projectAgentRunSkills(fixture.package, selected))
        .rejects.toMatchObject({ code: "AGENT_RUN_SKILL_UNKNOWN" });
    }
    expect(fixture.reads).toEqual([]);
  });

  test("bounds the complete eager manifest before reading package content", async () => {
    const tooMany: CapturedFile[] = [{ path: "skills/coding/SKILL.md", size: 0 }];
    for (let index = 0; index < 1_024; index += 1) {
      tooMany.push({ path: `skills/coding/references/${String(index).padStart(4, "0")}`, size: 0 });
    }
    const fileBound = capturedMetadata(tooMany);
    await expect(projectAgentRunSkills(fileBound.package, ["coding"]))
      .rejects.toMatchObject({ code: "AGENT_RUN_SKILL_PROJECTION_LIMIT" });
    expect(fileBound.reads).toEqual([]);

    const byteBound = capturedMetadata([
      { path: "skills/coding/SKILL.md", size: 8_388_609 },
    ]);
    await expect(projectAgentRunSkills(byteBound.package, ["coding"]))
      .rejects.toMatchObject({ code: "AGENT_RUN_SKILL_PROJECTION_LIMIT" });
    expect(byteBound.reads).toEqual([]);
  });

  test("rejects captured content which disagrees with its immutable metadata", async () => {
    const fixture = capturedMetadata(
      [{ path: "skills/coding/SKILL.md", size: 4 }],
      { "skills/coding/SKILL.md": Uint8Array.of(1, 2, 3) },
    );
    await expect(projectAgentRunSkills(fixture.package, ["coding"]))
      .rejects.toMatchObject({ code: "AGENT_RUN_SKILL_CONTENT_INVALID" });
  });
});

function capturedPackage(
  tree: Readonly<Record<string, string | Uint8Array>>,
): { readonly package: CapturedPackage; readonly reads: string[] } {
  const contents: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  for (const [path, value] of Object.entries(tree)) {
    contents[path] = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
  }
  return capturedMetadata(
    Object.entries(contents).map(([path, value]) => ({ path, size: value.byteLength })),
    contents,
  );
}

function capturedMetadata(
  sourceFiles: readonly CapturedFile[],
  contents: Readonly<Record<string, Uint8Array>> = {},
): { readonly package: CapturedPackage; readonly reads: string[] } {
  const files = Object.freeze([...sourceFiles]
    .map((file) => Object.freeze({ ...file }))
    .sort((left, right) => comparePathBytes(left.path, right.path)));
  const reads: string[] = [];
  const read = async (path: string, maximumBytes = Number.MAX_SAFE_INTEGER): Promise<Uint8Array> => {
    reads.push(path);
    const value = contents[path] ?? new Uint8Array(files.find((file) => file.path === path)?.size ?? 0);
    if (value.byteLength > maximumBytes) throw new RangeError("fixture exceeds read bound");
    return Uint8Array.from(value);
  };
  const captured: CapturedPackage = Object.freeze({
    sourceLabel: "agent-run-test-package",
    files,
    digest: `sha256:${"0".repeat(64)}`,
    read,
    async readPrefix(path: string, maximumBytes: number): Promise<Uint8Array> {
      return (await read(path, maximumBytes)).subarray(0, maximumBytes);
    },
    async *stream(path: string, maximumBytes = Number.MAX_SAFE_INTEGER): AsyncIterable<Uint8Array> {
      yield await read(path, maximumBytes);
    },
    async dispose(): Promise<void> {},
  });
  return { package: captured, reads };
}
