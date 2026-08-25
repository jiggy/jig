import { describe, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  captureAuthorClosure,
  captureAuthorModule,
} from "../src/project/author-module.js";

async function withTemporaryDirectory(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "jig-author-module-"));
  try {
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("private project author-module capture", () => {
  test("captures one immutable TypeScript module and authenticates its boundary", async () => {
    await withTemporaryDirectory(async (root) => {
      const path = join(root, "jig.ts");
      await writeFile(path, "export default { flows: [] }\n");
      const captured = await captureAuthorModule(root, "jig.ts");
      try {
        await writeFile(path, "export default { changed: true }\n");
        expect(new TextDecoder().decode(captured.read())).toBe("export default { flows: [] }\n");
        expect(captured.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      } finally {
        captured.dispose();
      }
      expect(() => captured.read()).toThrow("disposed");
    });
  });

  test("rejects symlinks, hardlinks, protected state, non-files, and non-TypeScript paths", async () => {
    await withTemporaryDirectory(async (root) => {
      await writeFile(join(root, "source.ts"), "export default {};");
      await link(join(root, "source.ts"), join(root, "alias.ts"));
      await symlink("source.ts", join(root, "linked.ts"));
      await mkdir(join(root, "folder.ts"));
      await mkdir(join(root, ".JIG"));
      await writeFile(join(root, ".JIG", "hidden.ts"), "export default {};");
      await writeFile(join(root, "plain.js"), "export default {};");

      for (const path of ["source.ts", "alias.ts", "linked.ts", "folder.ts", ".JIG/hidden.ts", "plain.js"]) {
        await expect(captureAuthorModule(root, path)).rejects.toBeDefined();
      }
    });
  });

  test("rejects invalid UTF-8 and sources above the fixed byte ceiling", async () => {
    await withTemporaryDirectory(async (root) => {
      await writeFile(join(root, "invalid.ts"), Uint8Array.from([0xff]));
      await expect(captureAuthorModule(root, "invalid.ts")).rejects.toThrow("valid UTF-8");

      await writeFile(join(root, "large.ts"), new Uint8Array(1024 * 1024 + 1));
      await expect(captureAuthorModule(root, "large.ts")).rejects.toMatchObject({
        code: "PROJECT_EVALUATION_LIMIT",
      });
    });
  });

  test("classifies an initially missing exact module as invalid source", async () => {
    await withTemporaryDirectory(async (root) => {
      await expect(captureAuthorModule(root, "missing.ts")).rejects.toMatchObject({
        kind: "invalid",
        code: "PROJECT_EVALUATOR_SOURCE",
      });
    });
  });
});

describe("private project author static closure capture", () => {
  test("captures shared modules once under one deterministic closure identity", async () => {
    await withTemporaryDirectory(async (root) => {
      await mkdir(join(root, "bindings"));
      await writeFile(join(root, "jig.ts"), [
        'import { defineJig } from "@jigging/jig";',
        'import { flows } from "./shared.ts";',
        "export default defineJig({ flows });",
      ].join("\n"));
      await writeFile(join(root, "bindings", "build.ts"), [
        'import { defineBinding } from "@jigging/jig";',
        'import { settings } from "../shared.ts";',
        'export default defineBinding({ package: "flows/build", settings });',
      ].join("\n"));
      await writeFile(join(root, "shared.ts"), [
        'export const flows = ["flows/build"];',
        "export const settings = { maxRetries: 3 };",
      ].join("\n"));

      const first = await captureAuthorClosure(root, ["jig.ts", "bindings/build.ts"]);
      const reordered = await captureAuthorClosure(root, ["bindings/build.ts", "jig.ts"]);
      try {
        expect(first.entries).toEqual(["bindings/build.ts", "jig.ts"]);
        expect(first.modules.map(({ projectPath }) => projectPath)).toEqual([
          "bindings/build.ts",
          "jig.ts",
          "shared.ts",
        ]);
        expect(first.modules.filter(({ projectPath }) => projectPath === "shared.ts")).toHaveLength(1);
        expect(first.modules[0]!.imports).toEqual([
          { specifier: "../shared.ts", projectPath: "shared.ts" },
        ]);
        expect(first.closureDigest).toBe(reordered.closureDigest);

        await writeFile(join(root, "shared.ts"), "export const changed = true;\n");
        expect(new TextDecoder().decode(first.read("shared.ts"))).toContain("maxRetries");
        expect(() => first.read("outside.ts")).toThrow("outside the author closure");
      } finally {
        first.dispose();
        reordered.dispose();
      }
      expect(() => first.read("jig.ts")).toThrow("disposed");
    });
  });

  test("rejects cycles and case-fold collisions", async () => {
    await withTemporaryDirectory(async (root) => {
      await writeFile(join(root, "jig.ts"), 'import "./a.ts"; export default {};');
      await writeFile(join(root, "a.ts"), 'import "./b.ts"; export const a = true;');
      await writeFile(join(root, "b.ts"), 'import "./a.ts"; export const b = true;');
      await expect(captureAuthorClosure(root, ["jig.ts"])).rejects.toMatchObject({
        code: "PROJECT_EVALUATOR_IMPORT",
      });

      await writeFile(join(root, "jig.ts"), [
        'import "./Name.ts";',
        'import "./name.ts";',
        "export default {};",
      ].join("\n"));
      await writeFile(join(root, "Name.ts"), "export const upper = true;");
      await writeFile(join(root, "name.ts"), "export const lower = true;");
      await expect(captureAuthorClosure(root, ["jig.ts"])).rejects.toMatchObject({
        code: "PROJECT_SOURCE_COLLISION",
      });
    });
  });

  test("admits only explicit static ESM imports in the confined TypeScript graph", async () => {
    await withTemporaryDirectory(async (root) => {
      await writeFile(join(root, "local.ts"), "export const value = true;");
      const rejected = [
        'const value = import("./local.ts"); export default value;',
        'const value = require("./local.ts"); export default value;',
        'import "node:fs"; export default {};',
        'import "./local"; export default {};',
        'import "../outside.ts"; export default {};',
      ];
      for (const [index, source] of rejected.entries()) {
        const entry = `entry-${index}.ts`;
        await writeFile(join(root, entry), source);
        await expect(captureAuthorClosure(root, [entry])).rejects.toMatchObject({
          code: "PROJECT_EVALUATOR_IMPORT",
        });
      }
    });
  });

  test("bounds the complete closure rather than only individual modules", async () => {
    await withTemporaryDirectory(async (root) => {
      const padding = "x".repeat(600 * 1024);
      await writeFile(join(root, "jig.ts"), `import "./large.ts";\n/*${padding}*/\nexport default {};`);
      await writeFile(join(root, "large.ts"), `/*${padding}*/\nexport const value = true;`);
      await expect(captureAuthorClosure(root, ["jig.ts"])).rejects.toMatchObject({
        code: "PROJECT_EVALUATION_LIMIT",
      });
    });
  });
});
