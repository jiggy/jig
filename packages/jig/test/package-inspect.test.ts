import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { CheckError } from "../src/diagnostics.js";
import { capturePackageDirectory } from "../src/package/capture.js";
import {
  checkPackageDirectory,
  inspectCapturedPackage,
} from "../src/package/inspect.js";
import { SchemaDiagnostic } from "../src/schema/index.js";

const schemaUri = "https://flow.dev/schemas/schema-1.json";
const runMetadata = flowMetadata("name: exact\ndescription: Exact.");

describe("aggregate Package/1 inspection", () => {
  test("requires exact-case root FLOW.md", async () => {
    await withPackage({ "flow.md": runMetadata }, async (root) => {
      await expectCheckError(() => checkPackageDirectory(root), "PACKAGE_FLOW_MISSING");
    });
  });

  test("classifies invalid frontmatter UTF-8 as invalid during aggregate inspection", async () => {
    const prefix = new TextEncoder().encode("---\nname: exact\ndescription: ");
    const suffix = new TextEncoder().encode("\n---\n");
    await withPackage({
      "FLOW.md": Uint8Array.from([...prefix, 0xff, ...suffix]),
    }, async (root) => {
      await expectCheckError(() => checkPackageDirectory(root), "METADATA_INVALID_UTF8");
    });
  });

  test("admits zero or one root implementation and rejects several", async () => {
    await withPackage({ "FLOW.md": runMetadata }, async (root) => {
      const checked = await checkPackageDirectory(root);
      expect(checked.mode).toBe("run");
      expect(checked.entrypoint).toBeUndefined();
    });

    await withPackage({
      "FLOW.md": runMetadata,
      "flow.ts": "export {};\n",
      "nested/flow.py": "# ordinary nested resource\n",
      "flow.d.ts": "// ordinary multi-suffix resource\n",
    }, async (root) => {
      const captured = await capturePackageDirectory(root);
      try {
        const checked = await inspectCapturedPackage(captured);
        expect(checked.digest).toBe(captured.digest);
        expect(checked.entrypoint).toEqual({ path: "flow.ts", suffix: "ts" });
      } finally {
        await captured.dispose();
      }
    });

    await withPackage({
      "FLOW.md": runMetadata,
      "flow.ts": "export {};\n",
      "flow.py": "pass\n",
    }, async (root) => {
      await expectCheckError(() => checkPackageDirectory(root), "PACKAGE_ENTRYPOINT_AMBIGUOUS");
    });
  });

  test("parses only the exact optional Adapter selector grammar", async () => {
    await withPackage({
      "FLOW.md": runMetadata,
      "flow.ts": "#!/usr/bin/env bun\r\nexport {};\n",
    }, async (root) => {
      expect((await checkPackageDirectory(root)).entrypoint).toEqual({
        path: "flow.ts",
        suffix: "ts",
        selector: "bun",
      });
    });

    for (const selector of [
      "#!/usr/bin/env -S bun\n",
      "#!/usr/bin/env bun --flag\n",
      "#!/bin/bun\n",
      `#!/usr/bin/env ${"a".repeat(65)}\n`,
    ]) {
      await withPackage({ "FLOW.md": runMetadata, "flow.ts": selector }, async (root) => {
        await expectCheckError(() => checkPackageDirectory(root), "PACKAGE_SELECTOR");
      });
    }
  });

  test("requires exact code for Services and rejects Run-only Service schemas", async () => {
    const service = flowMetadata("name: service\ndescription: Service.\nservice: 1");
    await withPackage({ "FLOW.md": service }, async (root) => {
      await expectCheckError(() => checkPackageDirectory(root), "PACKAGE_SERVICE_CODE");
    });

    for (const schema of ["input.schema.json", "result.schema.json"]) {
      await withPackage({
        "FLOW.md": service,
        "flow.py": "#!/usr/bin/env python\n",
        [schema]: schemaDocument({ type: "object" }),
      }, async (root) => {
        await expectCheckError(() => checkPackageDirectory(root), "PACKAGE_SCHEMA_MODE");
      });
    }

    await withPackage({
      "FLOW.md": service,
      "flow.py": "#!/usr/bin/env python\n",
      "settings.schema.json": schemaDocument({ type: "object" }),
    }, async (root) => {
      const checked = await checkPackageDirectory(root);
      expect(checked.mode).toBe("service");
      expect(checked.schemas.settings).toBeDefined();
    });
  });

  test("compiles every conventional Run schema during inspection", async () => {
    await withPackage({
      "FLOW.md": runMetadata,
      "input.schema.json": schemaDocument({
        type: "object",
        properties: { value: { type: "string", minLength: 1 } },
        required: ["value"],
        additionalProperties: false,
      }),
      "settings.schema.json": schemaDocument({ type: "object", maxProperties: 0 }),
      "result.schema.json": schemaDocument({
        type: "object",
        properties: { outcome: { const: "done" }, output: true },
        required: ["outcome", "output"],
        additionalProperties: false,
      }),
    }, async (root) => {
      const schemas = (await checkPackageDirectory(root)).schemas;
      schemas.input!.validate({ value: "ok" }, "INVALID_INPUT");
      schemas.settings!.validate({}, "INVALID_SETTINGS");
      schemas.result!.validate({ outcome: "done", output: null }, "INVALID_RESULT");
      expect(() => schemas.input!.validate({}, "INVALID_INPUT")).toThrow(SchemaDiagnostic);
    });
  });

  test("rejects an invalid conventional schema while the package is inert", async () => {
    await withPackage({
      "FLOW.md": runMetadata,
      "input.schema.json": schemaDocument({ type: "string", pattern: ".*" }),
    }, async (root) => {
      await expect(checkPackageDirectory(root)).rejects.toBeInstanceOf(SchemaDiagnostic);
    });
  });

  test("loads exact referenced consumed and provided capability contracts", async () => {
    const consumer = capability("https://example.org/contracts/consumer");
    const provider = capability("https://example.org/contracts/provider");
    const metadata = flowMetadata(`name: service
description: Service.
service: 1
uses:
  dependency:
    contract: ./contracts/consumer.capability.json
provides:
  api: ./contracts/provider.capability.json`);
    await withPackage({
      "FLOW.md": metadata,
      "flow.ts": "export {};\n",
      "contracts/consumer.capability.json": consumer,
      "contracts/provider.capability.json": provider,
    }, async (root) => {
      const checked = await checkPackageDirectory(root);
      expect(checked.usedContracts.map(({ slot, path, contract }) => ({
        slot,
        path,
        id: contract.descriptor.id,
      }))).toEqual([{
        slot: "dependency",
        path: "contracts/consumer.capability.json",
        id: "https://example.org/contracts/consumer",
      }]);
      expect(checked.providedContracts.map(({ slot, path, contract }) => ({
        slot,
        path,
        id: contract.descriptor.id,
      }))).toEqual([{
        slot: "api",
        path: "contracts/provider.capability.json",
        id: "https://example.org/contracts/provider",
      }]);
    });
  });

  test("rejects a capability reference absent from the captured package", async () => {
    await withPackage({
      "FLOW.md": flowMetadata(`name: exact
description: Exact.
uses:
  agent:
    contract: ./contracts/missing.capability.json`),
    }, async (root) => {
      await expectCheckError(() => checkPackageDirectory(root), "PACKAGE_REFERENCE_MISSING");
    });
  });

  test("discovers only exact immediate selectable skill subtrees", async () => {
    const maximum = "a".repeat(64);
    const oversized = "b".repeat(65);
    await withPackage({
      "FLOW.md": runMetadata,
      "skills/coding/SKILL.md": "# Coding\n",
      "skills/review/SKILL.md": "# Review\n",
      [`skills/${maximum}/SKILL.md`]: "# Maximum LocalName\n",
      [`skills/${oversized}/SKILL.md`]: "# Not a LocalName\n",
      "skills/Bad/SKILL.md": "# Invalid local name\n",
      "skills/deep/nested/SKILL.md": "# Not immediate\n",
      "skills/wrong/skill.md": "# Wrong case\n",
    }, async (root) => {
      expect((await checkPackageDirectory(root)).skills).toEqual([maximum, "coding", "review"]);
    });
  });
});

function flowMetadata(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n`;
}

function schemaDocument(schema: Record<string, unknown>): string {
  return JSON.stringify({ $schema: schemaUri, ...schema });
}

function capability(id: string): string {
  return JSON.stringify({
    $schema: "https://flow.dev/schemas/capability-contract-1.schema.json",
    flowCapabilityContract: 1,
    id,
    version: "1.0.0",
    methods: {
      call: { input: true, output: true, errors: {} },
    },
  });
}

async function withPackage(
  files: Readonly<Record<string, string | Uint8Array>>,
  action: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "jig-inspect-test-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function expectCheckError(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action();
    throw new Error("expected CheckError");
  } catch (error) {
    expect(error).toBeInstanceOf(CheckError);
    expect((error as CheckError).code).toBe(code);
  }
}
