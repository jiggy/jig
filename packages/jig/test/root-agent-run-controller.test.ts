import { describe, expect, test } from "bun:test";

import {
  isPrivateRootAgentRunOwner,
  renderPrivateAgentRunInstructions,
} from "../src/internal/root-agent-run-controller.js";
import { AgentRunValidationError, type AgentRunSkillManifest } from
  "../src/internal/private-agent-run.js";

describe("private root Agent Run controller", () => {
  test("renders only the selected transient skill manifest deterministically", () => {
    const manifest = skillManifest([
      ["review", [
        ["SKILL.md", "Review carefully."],
        ["references/checklist.md", "Check tests."],
      ]],
    ]);

    const first = renderPrivateAgentRunInstructions("Review the patch", manifest);
    const second = renderPrivateAgentRunInstructions("Review the patch", manifest);

    expect(first).toBe(second);
    expect(first).toContain('"instructions":"Review the patch"');
    expect(first).toContain('"name":"review"');
    expect(first).toContain('"content":"Review carefully.","path":"SKILL.md"');
    expect(first).not.toContain("OPENROUTER_API_KEY");
  });

  test("rejects non-text skill bytes before provider allocation", () => {
    const file = Object.freeze({
      path: "SKILL.md",
      size: 1,
      bytes: () => Uint8Array.of(0xff),
    });
    const manifest: AgentRunSkillManifest = Object.freeze({
      skills: Object.freeze([
        Object.freeze({ name: "review", files: Object.freeze([file]) }),
      ]),
      fileCount: 1,
      contentBytes: 1,
    });

    expect(() => renderPrivateAgentRunInstructions("Review", manifest)).toThrow(
      AgentRunValidationError,
    );
  });

  test("classifies only its own cleanup-ledger allocation kind", () => {
    const base = {
      parentRunId: `sha256:${"1".repeat(64)}`,
      operationId: "agent:1",
    };
    expect(isPrivateRootAgentRunOwner({
      ...base,
      allocation: {
        digest: `sha256:${"2".repeat(64)}`,
        value: { kind: "private-root-agent-owner-allocation/1" },
      },
    })).toBe(true);
    expect(isPrivateRootAgentRunOwner({
      ...base,
      allocation: {
        digest: `sha256:${"3".repeat(64)}`,
        value: { kind: "private-root-child-owner-allocation/1" },
      },
    })).toBe(false);
  });
});

function skillManifest(
  values: readonly [string, readonly [string, string][]][],
): AgentRunSkillManifest {
  const skills = values.map(([name, sources]) => Object.freeze({
    name,
    files: Object.freeze(sources.map(([path, content]) => {
      const retained = new TextEncoder().encode(content);
      return Object.freeze({
        path,
        size: retained.byteLength,
        bytes: () => Uint8Array.from(retained),
      });
    })),
  }));
  return Object.freeze({
    skills: Object.freeze(skills),
    fileCount: skills.reduce((total, skill) => total + skill.files.length, 0),
    contentBytes: skills.reduce(
      (total, skill) => total + skill.files.reduce((sum, file) => sum + file.size, 0),
      0,
    ),
  });
}
