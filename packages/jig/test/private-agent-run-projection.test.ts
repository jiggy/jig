import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { parseCapabilityContract, type ParsedCapabilityContract } from "../src/capability/index.js";
import {
  PrivateAgentRunError,
  runPrivateAgentProjection,
  type PrivateAgentSkillView,
} from "../src/internal/private-agent-run-projection.js";
import {
  publishCapturedPackage,
  type PackageArtifactRef,
} from "../src/internal/package-artifact-store.js";
import { capturePackageDirectory } from "../src/package/capture.js";
import { SCHEMA_1_URI } from "../src/schema/index.js";

let contract: ParsedCapabilityContract;
const temporary: string[] = [];

beforeAll(async () => {
  contract = parseCapabilityContract(
    await Bun.file(new URL("../../../docs/spec/contracts/jig/agent-run.capability.json", import.meta.url)).bytes(),
    "agent-run.capability.json",
  );
});

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("private Agent Run skill projection", () => {
  test("projects only selected exact subtrees and revokes them after a valid result", async () => {
    const fixture = await agentPackage();
    let retained: PrivateAgentSkillView | undefined;
    const result = await runPrivateAgentProjection({
      packageStoreRoot: fixture.store,
      package: fixture.package,
      contract,
      request: {
        instructions: "Use the coding skill.",
        skills: ["coding"],
        responseSchema: {
          $schema: SCHEMA_1_URI,
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
          additionalProperties: false,
        },
      },
      integration: async (context) => {
        retained = context.skills;
        expect(context.instructions).toBe("Use the coding skill.");
        expect(context.skills.names).toEqual(["coding"]);
        expect(context.skills.files("coding")).toEqual(["SKILL.md", "references/check.txt"]);
        const first = await context.skills.read("coding", "references/check.txt");
        expect(new TextDecoder().decode(first)).toBe("exact evidence\n");
        first.fill(0);
        expect(new TextDecoder().decode(
          await context.skills.read("coding", "references/check.txt"),
        )).toBe("exact evidence\n");
        expect(() => context.skills.files("review")).toThrow("not selected");
        await expect(context.skills.read("coding", "../../secret.txt")).rejects.toThrow();
        return { outcome: "completed", text: "done", structured: { answer: "yes" } };
      },
    });

    expect(result).toEqual({ outcome: "completed", text: "done", structured: { answer: "yes" } });
    expect(() => retained!.files("coding")).toThrow("no longer active");
    await expect(retained!.read("coding", "SKILL.md")).rejects.toThrow("no longer active");
  });

  test("omission exposes an empty view", async () => {
    const fixture = await agentPackage();
    await expect(runPrivateAgentProjection({
      packageStoreRoot: fixture.store,
      package: fixture.package,
      contract,
      request: { instructions: "No package skills." },
      integration: (context) => {
        expect(context.skills.names).toEqual([]);
        expect(() => context.skills.files("coding")).toThrow("not selected");
        return { outcome: "blocked", text: "nothing selected" };
      },
    })).resolves.toEqual({ outcome: "blocked", text: "nothing selected" });
  });

  test("projects multiple selected skills in canonical order", async () => {
    const fixture = await agentPackage();
    await expect(runPrivateAgentProjection({
      packageStoreRoot: fixture.store,
      package: fixture.package,
      contract,
      request: { instructions: "Compare both.", skills: ["coding", "review"] },
      integration: async (context) => {
        expect(context.skills.names).toEqual(["coding", "review"]);
        expect(context.skills.files("coding")).toEqual(["SKILL.md", "references/check.txt"]);
        expect(context.skills.files("review")).toEqual(["SKILL.md"]);
        expect(new TextDecoder().decode(await context.skills.read("review", "SKILL.md")))
          .toBe("# Review\n");
        return { outcome: "completed", text: "compared" };
      },
    })).resolves.toEqual({ outcome: "completed", text: "compared" });
  });

  test("rejects invalid skill selections before provider work", async () => {
    const fixture = await agentPackage();
    const selections = [
      ["unknown"],
      ["coding", "coding"],
      ["review", "coding"],
      ["Bad"],
      ["nested/path"],
    ];
    for (const skills of selections) {
      let calls = 0;
      await expect(runPrivateAgentProjection({
        packageStoreRoot: fixture.store,
        package: fixture.package,
        contract,
        request: { instructions: "invalid", skills },
        integration: () => {
          calls += 1;
          return { outcome: "completed", text: "unexpected" };
        },
      })).rejects.toBeInstanceOf(PrivateAgentRunError);
      expect(calls).toBe(0);
    }
  });

  test("revokes the view after provider failure and cancellation", async () => {
    const fixture = await agentPackage();
    let failedView: PrivateAgentSkillView | undefined;
    await expect(runPrivateAgentProjection({
      packageStoreRoot: fixture.store,
      package: fixture.package,
      contract,
      request: { instructions: "fail", skills: ["coding"] },
      integration: (context) => {
        failedView = context.skills;
        throw new Error("provider failed");
      },
    })).rejects.toThrow("provider failed");
    expect(() => failedView!.files("coding")).toThrow("no longer active");

    const cancellation = new AbortController();
    let cancelledView: PrivateAgentSkillView | undefined;
    let postCancellationRead: Promise<unknown> | undefined;
    const pending = runPrivateAgentProjection({
      packageStoreRoot: fixture.store,
      package: fixture.package,
      contract,
      request: { instructions: "wait", skills: ["coding"] },
      signal: cancellation.signal,
      integration: async (context) => {
        cancelledView = context.skills;
        await new Promise<void>((resolve) => context.signal.addEventListener("abort", resolve, { once: true }));
        await Promise.resolve();
        postCancellationRead = context.skills.read("coding", "SKILL.md");
        await postCancellationRead;
        return { outcome: "completed", text: "unexpected" };
      },
    });
    while (cancelledView === undefined) await Bun.sleep(1);
    cancellation.abort();
    await expect(pending).rejects.toMatchObject({ code: "AGENT_RUN_CANCELLED" });
    expect(() => cancelledView!.files("coding")).toThrow("no longer active");
    while (postCancellationRead === undefined) await Bun.sleep(1);
    await expect(postCancellationRead).rejects.toMatchObject({ code: "AGENT_RUN_PROJECTION_REVOKED" });
  });

  test("validates provider output and responseSchema", async () => {
    const fixture = await agentPackage();
    await expect(runPrivateAgentProjection({
      packageStoreRoot: fixture.store,
      package: fixture.package,
      contract,
      request: { instructions: "malformed" },
      integration: () => ({ outcome: "invented", text: "bad" }),
    })).rejects.toMatchObject({ code: "AGENT_RUN_OUTPUT_INVALID" });

    const request = {
      instructions: "structured",
      responseSchema: {
        $schema: SCHEMA_1_URI,
        type: "object",
        properties: { score: { type: "integer", minimum: 0 } },
        required: ["score"],
        additionalProperties: false,
      },
    } as const;
    await expect(runPrivateAgentProjection({
      packageStoreRoot: fixture.store,
      package: fixture.package,
      contract,
      request,
      integration: () => ({ outcome: "completed", text: "missing" }),
    })).rejects.toMatchObject({ code: "AGENT_RUN_STRUCTURED_REQUIRED" });
    await expect(runPrivateAgentProjection({
      packageStoreRoot: fixture.store,
      package: fixture.package,
      contract,
      request,
      integration: () => ({ outcome: "completed", text: "bad", structured: { score: -1 } }),
    })).rejects.toMatchObject({ code: "AGENT_RUN_STRUCTURED_INVALID" });
  });

  test("recompiles the exact descriptor and ignores a forged schema map", async () => {
    const fixture = await agentPackage();
    const forgedSchemas = new Map(contract.schemas);
    forgedSchemas.set("/methods/run/input", { path: "forged", schemaPointer: "", validate() {} });
    forgedSchemas.set("/methods/run/output", { path: "forged", schemaPointer: "", validate() {} });
    const forged = { ...contract, schemas: forgedSchemas } as ParsedCapabilityContract;
    let calls = 0;
    await expect(runPrivateAgentProjection({
      packageStoreRoot: fixture.store,
      package: fixture.package,
      contract: forged,
      request: { instructions: 3 },
      integration: () => {
        calls += 1;
        return { outcome: "invented", text: 7 };
      },
    })).rejects.toMatchObject({ code: "AGENT_RUN_INPUT_INVALID" });
    expect(calls).toBe(0);

    const changedDescriptor = {
      ...contract.descriptor,
      version: "1.0.1",
    };
    await expect(runPrivateAgentProjection({
      packageStoreRoot: fixture.store,
      package: fixture.package,
      contract: { ...contract, descriptor: changedDescriptor } as ParsedCapabilityContract,
      request: { instructions: "must reject" },
      integration: () => ({ outcome: "completed", text: "unexpected" }),
    })).rejects.toMatchObject({ code: "AGENT_RUN_CONTRACT_MISMATCH" });
  });

  test("snapshots ordinary JSON once and rejects accessors before integration", async () => {
    const fixture = await agentPackage();
    let calls = 0;
    const accessorRequest = Object.defineProperty({}, "instructions", {
      enumerable: true,
      get: () => "hidden getter",
    });
    await expect(runPrivateAgentProjection({
      packageStoreRoot: fixture.store,
      package: fixture.package,
      contract,
      request: accessorRequest,
      integration: () => {
        calls += 1;
        return { outcome: "completed", text: "unexpected" };
      },
    })).rejects.toMatchObject({ code: "AGENT_RUN_JSON_INVALID" });
    expect(calls).toBe(0);

    let resultView: PrivateAgentSkillView | undefined;
    await expect(runPrivateAgentProjection({
      packageStoreRoot: fixture.store,
      package: fixture.package,
      contract,
      request: { instructions: "reject output accessor", skills: ["coding"] },
      integration: (context) => {
        resultView = context.skills;
        return Object.defineProperty({ outcome: "completed" }, "text", {
          enumerable: true,
          get: () => "hidden getter",
        });
      },
    })).rejects.toMatchObject({ code: "AGENT_RUN_JSON_INVALID" });
    expect(() => resultView!.files("coding")).toThrow("no longer active");
  });

  test("rejects an invalid response Schema/1 before provider work", async () => {
    const fixture = await agentPackage();
    let calls = 0;
    await expect(runPrivateAgentProjection({
      packageStoreRoot: fixture.store,
      package: fixture.package,
      contract,
      request: {
        instructions: "invalid schema",
        responseSchema: { type: "object" },
      },
      integration: () => {
        calls += 1;
        return { outcome: "completed", text: "unexpected" };
      },
    })).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    expect(calls).toBe(0);
  });
});

async function agentPackage(): Promise<{ readonly store: string; readonly package: PackageArtifactRef }> {
  const root = await mkdtemp(join(tmpdir(), "jig-agent-package-"));
  const store = await mkdtemp(join(tmpdir(), "jig-agent-store-"));
  temporary.push(root, store);
  await mkdir(join(root, "skills", "coding", "references"), { recursive: true });
  await mkdir(join(root, "skills", "review"), { recursive: true });
  await writeFile(join(root, "FLOW.md"), "---\nname: agent-fixture\ndescription: Agent projection fixture.\n---\n");
  await writeFile(join(root, "secret.txt"), "not projected\n");
  await writeFile(join(root, "skills", "coding", "SKILL.md"), "# Coding\n");
  await writeFile(join(root, "skills", "coding", "references", "check.txt"), "exact evidence\n");
  await writeFile(join(root, "skills", "review", "SKILL.md"), "# Review\n");
  const captured = await capturePackageDirectory(root);
  try {
    return { store, package: await publishCapturedPackage(store, captured) };
  } finally {
    await captured.dispose();
  }
}
