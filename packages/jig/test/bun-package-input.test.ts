import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectPrivateBunPackageInput } from "../src/internal/bun-package-input.js";
import { capturePackageDirectory } from "../src/package/capture.js";

describe("private Bun package input", () => {
  test("accepts a package-local implementation without native dependencies", async () => {
    await withPackage({
      "FLOW.md": metadata(),
      "flow.ts": 'import { readFile } from "node:fs/promises"; import "./helper.ts"; void readFile;\n',
      "helper.ts": "export const value = 1;\n",
    }, async (captured) => {
      expect(await inspectPrivateBunPackageInput(captured)).toEqual({ state: "direct" });
    });
  });

  test("accepts the ordinary package.json plus bun.lock shape", async () => {
    await withPackage({
      "FLOW.md": metadata(),
      "flow.ts": 'import { z } from "zod"; void z;\n',
      "package.json": '{"private":true,"dependencies":{"zod":"4.1.5"}}\n',
      "bun.lock": '{"lockfileVersion":1,"workspaces":{"":{"dependencies":{"zod":"4.1.5"}}},"packages":{}}\n',
    }, async (captured) => {
      expect(await inspectPrivateBunPackageInput(captured)).toEqual({
        state: "locked",
        manifestPath: "package.json",
        lockPath: "bun.lock",
      });
    });
  });

  test("does not require a lock for an inert package.json", async () => {
    await withPackage({
      "FLOW.md": metadata(),
      "flow.ts": "export {};\n",
      "package.json": '{"private":true,"type":"module"}\n',
    }, async (captured) => {
      expect(await inspectPrivateBunPackageInput(captured)).toEqual({ state: "direct" });
    });
  });

  test.each([
    {
      files: { "package.json": '{"dependencies":{"zod":"4.1.5"}}\n' },
      code: "PACKAGE_BUN_LOCK_MISSING",
      path: "bun.lock",
    },
    {
      files: { "bun.lock": "{}\n" },
      code: "PACKAGE_BUN_MANIFEST_MISSING",
      path: "package.json",
    },
    {
      files: { "node_modules/zod/index.js": "export {};\n" },
      code: "PACKAGE_BUN_NODE_MODULES",
      path: "node_modules",
    },
    {
      files: {
        "package.json": '{"dependencies":{"@example/value":"1.0.0"}}\n',
        "bun.lock": '{"lockfileVersion":1,"workspaces":{"":{"dependencies":{"@example/value":"1.0.0"}}},"packages":{}}\n',
        ".npmrc": "@example:registry=https://packages.example.invalid/\n",
      },
      code: "PACKAGE_BUN_CONFIG_UNSUPPORTED",
      path: ".npmrc",
    },
  ])("rejects incomplete or generated dependency input: $code", async ({ files, code, path }) => {
    await withPackage({
      "FLOW.md": metadata(),
      "flow.ts": "export {};\n",
      ...files,
    }, async (captured) => {
      await expect(inspectPrivateBunPackageInput(captured)).rejects.toMatchObject({ code, path });
    });
  });

  test("rejects malformed package.json", async () => {
    await withPackage({
      "FLOW.md": metadata(),
      "flow.ts": "export {};\n",
      "package.json": "not json\n",
      "bun.lock": "{}\n",
    }, async (captured) => {
      await expect(inspectPrivateBunPackageInput(captured)).rejects.toMatchObject({
        code: "PACKAGE_BUN_MANIFEST_INVALID",
        path: "package.json",
      });
    });
  });
});

function metadata(): string {
  return "---\nname: dependency-fixture\ndescription: Exercises private Bun input policy.\n---\n";
}

async function withPackage(
  files: Readonly<Record<string, string>>,
  use: (captured: Awaited<ReturnType<typeof capturePackageDirectory>>) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "jig-bun-input-"));
  try {
    for (const [path, contents] of Object.entries(files)) {
      const destination = join(root, path);
      await mkdir(join(destination, ".."), { recursive: true });
      await writeFile(destination, contents);
    }
    const captured = await capturePackageDirectory(root);
    try {
      await use(captured);
    } finally {
      await captured.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
