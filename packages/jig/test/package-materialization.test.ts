import { describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { materializeCapturedPackage } from "../src/internal/package-materialization.js";
import { capturePackageDirectory } from "../src/package/capture.js";

describe("private package materialization", () => {
  test("materializes captured bytes and shares one cleanup settlement", async () => {
    const source = await mkdtemp(join(tmpdir(), "jig-materialize-source-"));
    const stagingParent = await mkdtemp(join(tmpdir(), "jig-materialize-parent-"));
    try {
      await writeTree(source, {
        "FLOW.md": "---\nname: exact\ndescription: Exact fixture.\n---\n",
        "flow.ts": "export const captured = 'old';\n",
        "lib/value.ts": "export default 1;\n",
      });
      const captured = await capturePackageDirectory(source);
      try {
        await writeFile(join(source, "flow.ts"), "export const captured = 'new';\n");
        const materialized = await materializeCapturedPackage(captured, stagingParent);

        expect(materialized.packageDigest).toBe(captured.digest);
        expect(await readFile(join(materialized.root, "flow.ts"), "utf8"))
          .toBe("export const captured = 'old';\n");
        expect(await readFile(join(materialized.root, "lib/value.ts"), "utf8"))
          .toBe("export default 1;\n");
        expect((await stat(materialized.root)).mode & 0o777).toBe(0o555);
        expect((await stat(join(materialized.root, "flow.ts"))).mode & 0o777).toBe(0o444);

        const firstDisposal = materialized.dispose();
        const secondDisposal = materialized.dispose();
        expect(secondDisposal).toBe(firstDisposal);
        await Promise.all([firstDisposal, secondDisposal]);
        await expect(stat(materialized.root)).rejects.toThrow();
        expect(await readdir(stagingParent)).toEqual([]);
      } finally {
        await captured.dispose();
      }
    } finally {
      await rm(source, { recursive: true, force: true });
      await rm(stagingParent, { recursive: true, force: true });
    }
  });
});

async function writeTree(
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}
