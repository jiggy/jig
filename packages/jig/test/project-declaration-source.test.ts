import { describe, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { captureStoredPackage } from "../src/internal/package-artifact-store.js";
import { discover } from "../src/project/author.js";
import { captureOpenedAuthorClosure } from "../src/project/author-module.js";
import { captureDeclarationSource } from "../src/project/declaration-source.js";
import { retainAuthorClosure } from "../src/project/retained-author-closure.js";
import { openPrivateProjectRoot } from "../src/project/root.js";

describe("private declaration-source capture", () => {
  test("discovers canonical shallow declarations and verifies membership", async () => {
    await withProject(async (root) => {
      await mkdir(join(root, "bindings"));
      await writeFile(join(root, "bindings", "z.ts"), "export default {};\n");
      await writeFile(join(root, "bindings", "a.ts"), "export default {};\n");
      await writeFile(join(root, "bindings", "notes.md"), "ignored\n");
      await mkdir(join(root, "bindings", "nested"));

      const project = await openPrivateProjectRoot(root);
      try {
        const source = await captureDeclarationSource(project, discover("bindings"));
        expect(source.members).toEqual([
          { id: "a", projectPath: "bindings/a.ts", membership: "discovered", configuredRoot: "bindings" },
          { id: "z", projectPath: "bindings/z.ts", membership: "discovered", configuredRoot: "bindings" },
        ]);
        expect(source.observations).toEqual([{
          kind: "discover",
          root: "bindings",
          state: "captured",
          members: ["bindings/a.ts", "bindings/z.ts"],
        }]);
        await source.verify();
        await writeFile(join(root, "bindings", "later.ts"), "export default {};\n");
        await expect(source.verify()).rejects.toMatchObject({ code: "PROJECT_SOURCE_CHANGED" });
      } finally {
        await project.dispose();
      }
    });
  });

  test("records a missing discovered root but keeps exact membership strict", async () => {
    await withProject(async (root) => {
      const project = await openPrivateProjectRoot(root);
      try {
        const missing = await captureDeclarationSource(project, discover("bindings"));
        expect(missing.observations).toEqual([{
          kind: "discover",
          root: "bindings",
          state: "missing",
          members: [],
        }]);
        await mkdir(join(root, "bindings"));
        await expect(missing.verify()).rejects.toMatchObject({ code: "PROJECT_SOURCE_CHANGED" });
        await expect(captureDeclarationSource(project, {
          kind: "members",
          paths: ["bindings/missing.ts"],
        })).rejects.toMatchObject({ code: "PROJECT_MEMBER_MISSING" });
      } finally {
        await project.dispose();
      }
    });
  });

  test("rejects malformed names, symlinks, hardlinks, duplicate IDs, and collisions", async () => {
    await withProject(async (root) => {
      await mkdir(join(root, "one"));
      await mkdir(join(root, "two"));
      await writeFile(join(root, "one", "Bad.ts"), "export default {};\n");
      const project = await openPrivateProjectRoot(root);
      try {
        await expect(captureDeclarationSource(project, discover("one"))).rejects.toMatchObject({
          code: "PROJECT_DECLARATION_NAME",
        });
      } finally {
        await project.dispose();
      }

      await rm(join(root, "one", "Bad.ts"));
      await writeFile(join(root, "one", "same.ts"), "export default {};\n");
      await link(join(root, "one", "same.ts"), join(root, "two", "hard.ts"));
      const second = await openPrivateProjectRoot(root);
      try {
        await expect(captureDeclarationSource(second, discover("one"))).rejects.toMatchObject({
          code: "PROJECT_MEMBER_COLLISION",
        });
      } finally {
        await second.dispose();
      }

      await symlink("same.ts", join(root, "one", "linked.ts"));
      const third = await openPrivateProjectRoot(root);
      try {
        await expect(captureDeclarationSource(third, {
          kind: "members",
          paths: ["one/linked.ts"],
        })).rejects.toMatchObject({ code: "PROJECT_SOURCE_SYMLINK" });
      } finally {
        await third.dispose();
      }
    });
  });

  test("feeds selected entries into one closure beneath the same root owner", async () => {
    await withProject(async (root) => {
      await mkdir(join(root, "bindings"));
      await writeFile(join(root, "shared.ts"), "export const packagePath = 'flows/run';\n");
      await writeFile(join(root, "jig.ts"), [
        "import { packagePath } from './shared.ts';",
        "export default { flows: [packagePath] };",
      ].join("\n"));
      await writeFile(join(root, "bindings", "run.ts"), [
        "import { packagePath } from '../shared.ts';",
        "export default { package: packagePath };",
      ].join("\n"));

      const project = await openPrivateProjectRoot(root);
      try {
        const bootstrap = await captureOpenedAuthorClosure(project, ["jig.ts"]);
        const source = await captureDeclarationSource(project, discover("bindings"));
        const closure = await captureOpenedAuthorClosure(project, [
          "jig.ts",
          ...source.members.map(({ projectPath }) => projectPath),
        ]);
        try {
          for (const module of bootstrap.modules) {
            expect(closure.modules.find(({ projectPath }) => projectPath === module.projectPath)).toEqual(module);
          }
          expect(closure.entries).toEqual(["bindings/run.ts", "jig.ts"]);
          expect(closure.modules.map(({ projectPath }) => projectPath)).toEqual([
            "bindings/run.ts",
            "jig.ts",
            "shared.ts",
          ]);
          await source.verify();
        } finally {
          bootstrap.dispose();
          closure.dispose();
        }
      } finally {
        await project.dispose();
      }
    });
  });

  test("detects replacement of the visible project root", async () => {
    await withProject(async (root) => {
      await writeFile(join(root, "jig.ts"), "export default {};\n");
      const project = await openPrivateProjectRoot(root);
      const moved = `${root}-moved`;
      try {
        await rename(root, moved);
        await mkdir(root);
        await expect(project.verify()).rejects.toMatchObject({ code: "PROJECT_SOURCE_CHANGED" });
      } finally {
        await project.dispose();
        await rm(moved, { recursive: true, force: true });
      }
    });
  });

  test("retains the complete declaration byte closure after live owners close", async () => {
    await withProject(async (root) => {
      const store = await mkdtemp(join(tmpdir(), "jig-declaration-store-"));
      await writeFile(join(root, "helper.ts"), "export const value = 1;\n");
      await writeFile(join(root, "jig.ts"), [
        'import { value } from "./helper.ts";',
        "export default { value };",
      ].join("\n"));
      const project = await openPrivateProjectRoot(root);
      let closure: Awaited<ReturnType<typeof captureOpenedAuthorClosure>> | undefined;
      try {
        closure = await captureOpenedAuthorClosure(project, ["jig.ts"]);
        const retained = await retainAuthorClosure(store, closure);
        closure.dispose();
        closure = undefined;
        await project.dispose();
        const acquired = await captureStoredPackage(store, retained.package);
        try {
          expect(acquired.files.map(({ path }) => path)).toEqual(["helper.ts", "jig.ts"]);
          expect(new TextDecoder().decode(await acquired.read("helper.ts"))).toBe("export const value = 1;\n");
        } finally {
          await acquired.dispose();
        }
      } finally {
        closure?.dispose();
        await project.dispose();
        await rm(store, { recursive: true, force: true });
      }
    });
  });
});

async function withProject(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "jig-declaration-source-"));
  try {
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
