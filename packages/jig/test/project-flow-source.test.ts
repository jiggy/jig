import { describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CheckError } from "../src/diagnostics.js";
import { defineJig, discover } from "../src/project/author.js";
import {
  captureFlowSource,
  deriveDirectRunTargetCandidates,
} from "../src/project/flow-source.js";
import { SchemaDiagnostic } from "../src/schema/index.js";

const schemaUri = "https://flow.jig.md/schemas/schema-1.json";
const linuxTest = process.platform === "linux" ? test : test.skip;

describe("private project Flow source capture", () => {
  linuxTest("records a missing discovery root as an empty source", async () => {
    await withProject(async (root) => {
      const source = await captureFlowSource(root, discover("flows"));
      try {
        expect(source.members).toEqual([]);
        expect(source.observations).toEqual([{
          kind: "discover",
          root: "flows",
          state: "missing",
          members: [],
        }]);
      } finally {
        await source.dispose();
      }
    });
  });

  linuxTest("discovers only immediate real directories with exact FLOW.md", async () => {
    await withProject(async (root) => {
      await packageFiles(root, "flows/z", { "FLOW.md": metadata("z"), "flow.py": "pass\n" });
      await packageFiles(root, "flows/a", { "FLOW.md": metadata("a"), "flow.ts": "export {};\n" });
      await packageFiles(root, "flows/not-a-package", { "README.md": "inert\n" });
      await packageFiles(root, "flows/nested/too-deep", { "FLOW.md": metadata("deep") });
      await writeFile(join(root, "flows", "ordinary.txt"), "inert");

      const source = await captureFlowSource(root, defineJig({ flows: discover("flows") }).flows);
      try {
        expect(source.members.map((member) => member.provenance.projectPath)).toEqual([
          "flows/a",
          "flows/z",
        ]);
        expect(source.observations[0]).toEqual({
          kind: "discover",
          root: "flows",
          state: "captured",
          members: ["flows/a", "flows/z"],
        });
      } finally {
        await source.dispose();
      }
    });
  });

  linuxTest("canonicalizes exact members before capture and records their provenance", async () => {
    await withProject(async (root) => {
      await packageFiles(root, "flows/a", { "FLOW.md": metadata("a"), "flow.ts": "export {};\n" });
      await packageFiles(root, "flows/z", { "FLOW.md": metadata("z"), "flow.py": "pass\n" });
      const paths = ["flows/z", "flows/a"];
      const capture = captureFlowSource(root, { kind: "members", paths });
      paths[0] = "flows/missing";
      const source = await capture;
      try {
        expect(source.members.map((member) => member.provenance)).toEqual([
          { membership: "exact", projectPath: "flows/a" },
          { membership: "exact", projectPath: "flows/z" },
        ]);
        expect(source.observations).toEqual([{
          kind: "members",
          members: ["flows/a", "flows/z"],
        }]);
      } finally {
        await source.dispose();
      }
    });
  });

  linuxTest("keeps exact membership strict and project-confined", async () => {
    await withProject(async (root) => {
      await packageFiles(root, "flows/ok", { "FLOW.md": metadata("ok"), "flow.ts": "export {};\n" });
      await expectCode(
        () => captureFlowSource(root, { kind: "members", paths: ["flows/missing"] }),
        "PROJECT_MEMBER_MISSING",
      );
      await expectCode(
        () => captureFlowSource(root, { kind: "members", paths: [".jig/private"] }),
        "PROJECT_SOURCE_PROTECTED",
      );
      await expectCode(
        () => captureFlowSource(root, { kind: "members", paths: [".JIG/private"] }),
        "PROJECT_SOURCE_PROTECTED",
      );
      await packageFiles(root, ".jig-safe/ok", { "FLOW.md": metadata("safe") });
      const similarlyNamed = await captureFlowSource(root, {
        kind: "members",
        paths: [".jig-safe/ok"],
      });
      await similarlyNamed.dispose();
      await writeFile(join(root, "not-a-directory"), "file");
      await expectCode(
        () => captureFlowSource(root, { kind: "members", paths: ["not-a-directory"] }),
        "PROJECT_MEMBER_KIND",
      );
    });
  });

  linuxTest("rejects source symlinks and ignores unrelated discovered symlinks", async () => {
    await withProject(async (root) => {
      await packageFiles(root, "outside", { "FLOW.md": metadata("outside") });
      await symlink(join(root, "outside"), join(root, "flows"));
      await expectCode(
        () => captureFlowSource(root, discover("flows")),
        "PROJECT_SOURCE_SYMLINK",
      );

      await rm(join(root, "flows"));
      await mkdir(join(root, "flows"));
      await symlink(join(root, "outside"), join(root, "flows", "linked"));
      const source = await captureFlowSource(root, discover("flows"));
      try {
        expect(source.members).toEqual([]);
      } finally {
        await source.dispose();
      }
    });
  });

  linuxTest("rejects overlapping and case-fold-colliding membership", async () => {
    await withProject(async (root) => {
      await packageFiles(root, "flows/a", { "FLOW.md": metadata("a") });
      await expectCode(
        () => captureFlowSource(root, { kind: "discover", roots: ["flows", "flows"] }),
        "PROJECT_SOURCE_COLLISION",
      );
      await packageFiles(root, "flows/A", { "FLOW.md": metadata("other") });
      await expectCode(
        () => captureFlowSource(root, discover("flows")),
        "PROJECT_SOURCE_COLLISION",
      );
    });
  });

  linuxTest("rejects malformed selected packages instead of hiding them", async () => {
    await withProject(async (root) => {
      await packageFiles(root, "flows/bad", { "FLOW.md": "not frontmatter\n" });
      await expectCode(
        () => captureFlowSource(root, discover("flows")),
        "METADATA_DELIMITER",
      );
    });
  });

  linuxTest("cleans prior member snapshots and descriptors after a partial failure", async () => {
    await withProject(async (root) => {
      await packageFiles(root, "flows/a-good", {
        "FLOW.md": metadata("good"),
        "flow.ts": "export {};\n",
      });
      await packageFiles(root, "flows/z-bad", { "FLOW.md": "not frontmatter\n" });
      const before = (await readdir("/proc/self/fd")).length;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await expectCode(
          () => captureFlowSource(root, discover("flows")),
          "METADATA_DELIMITER",
        );
      }
      expect((await readdir("/proc/self/fd")).length).toBe(before);
    });
  });

  linuxTest("retains exact bytes after visible source mutation", async () => {
    await withProject(async (root) => {
      await packageFiles(root, "flows/a", {
        "FLOW.md": metadata("a"),
        "flow.ts": "export {};\n",
        "value.txt": "before",
      });
      const source = await captureFlowSource(root, discover("flows"));
      try {
        await writeFile(join(root, "flows/a/value.txt"), "after");
        expect(new TextDecoder().decode(await source.members[0]!.captured.read("value.txt"))).toBe("before");
      } finally {
        await source.dispose();
      }
      await expect(source.members[0]!.captured.read("value.txt")).rejects.toMatchObject({
        code: "PACKAGE_SNAPSHOT_CLOSED",
      });
    });
  });

  linuxTest("derives only exact zero-configuration Run targets", async () => {
    await withProject(async (root) => {
      await packageFiles(root, "flows/direct", {
        "FLOW.md": metadata("direct"),
        "flow.ts": "export {};\n",
      });
      await packageFiles(root, "flows/instruction-only", { "FLOW.md": metadata("instruction") });
      await packageFiles(root, "flows/dependency", {
        "FLOW.md": metadata("dependency", "uses:\n  host:\n    local: true"),
        "flow.py": "pass\n",
      });
      await packageFiles(root, "flows/attachment", {
        "FLOW.md": metadata("attachment", "attachments:\n  source: read"),
        "flow.py": "pass\n",
      });
      await packageFiles(root, "flows/settings", {
        "FLOW.md": metadata("settings"),
        "flow.py": "pass\n",
        "settings.schema.json": schema({
          type: "object",
          properties: { required: { type: "string" } },
          required: ["required"],
          additionalProperties: false,
        }),
      });

      const source = await captureFlowSource(root, discover("flows"));
      try {
        expect(deriveDirectRunTargetCandidates(source)).toEqual([{
          kind: "flow",
          path: "flows/direct",
          packageDigest: source.members.find(
            (member) => member.provenance.projectPath === "flows/direct",
          )!.captured.digest,
        }]);
      } finally {
        await source.dispose();
      }
    });
  });

  test("does not hide schema evaluator failures as direct-target ineligibility", () => {
    const failure = new SchemaDiagnostic("schema work exhausted", {
      code: "SCHEMA_LIMIT_EXCEEDED",
      instancePointer: "",
      schemaPointer: "",
      path: "settings.schema.json",
    });
    const source = {
      observations: [],
      members: [{
        provenance: { membership: "exact", projectPath: "flows/a" },
        captured: { digest: "sha256:test" },
        inspected: {
          mode: "run",
          entrypoint: { path: "flow.ts", suffix: "ts" },
          metadata: { name: "a", description: "a", extensions: {} },
          schemas: { settings: { validate: () => { throw failure; } } },
        },
      }],
      dispose: async () => undefined,
    };
    expect(() => deriveDirectRunTargetCandidates(source as never)).toThrow(failure);
  });
});

async function withProject(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "jig-project-flow-test-"));
  try {
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function packageFiles(
  root: string,
  path: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const file = join(root, path, name);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, contents);
  }
}

function metadata(name: string, extra = ""): string {
  return `---\nname: ${name}\ndescription: ${name}.\n${extra.length === 0 ? "" : `${extra}\n`}---\n`;
}

function schema(value: unknown): string {
  return `${JSON.stringify({ $schema: schemaUri, ...value })}\n`;
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await action();
    throw new Error("expected CheckError");
  } catch (error) {
    expect(error).toBeInstanceOf(CheckError);
    expect((error as CheckError).code).toBe(code);
  }
}
