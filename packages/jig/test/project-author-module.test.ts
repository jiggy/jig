import { describe, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
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
