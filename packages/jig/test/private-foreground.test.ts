import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const HOSTILE = process.env.JIG_LINUX_CGROUP_HOSTILE === "1";
const proofDescribe = HOSTILE ? describe.serial : describe.skip;

proofDescribe("private foreground project path", () => {
  test("reviews, applies, and runs one direct Python and one composed Bun-to-Python target", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-private-foreground-"));
    try {
      await writeProject(root);
      const planned = await invoke([
        "plan",
        root,
      ]) as {
        kind: string;
        planDigest: string;
        baseGeneration: string | null;
        targets: readonly { target: { kind: string; path?: string; id?: string } }[];
      };
      expect(planned).toMatchObject({
        kind: "private-foreground-plan/1",
        baseGeneration: null,
      });
      expect(planned.targets.map(({ target }) => target)).toEqual([
        { kind: "binding", id: "parent" },
        { kind: "flow", path: "flows/child" },
      ]);
      await writeFile(
        join(root, "flows", "child", "flow.py"),
        "raise RuntimeError('apply-run must use the retained reviewed package')\n",
      );

      const applied = await invoke([
        "apply-run",
        root,
        "--plan",
        planned.planDigest,
        "--base",
        "null",
        "--yes",
        "--request",
        JSON.stringify({
          submissionId: "foreground-direct",
          target: { kind: "flow", path: "flows/child" },
          input: { ticket: "direct" },
        }),
        "--request",
        JSON.stringify({
          submissionId: "foreground-composed",
          target: { kind: "binding", id: "parent" },
          input: { ticket: "composed" },
        }),
      ]) as {
        kind: string;
        planDigest: string;
        admissionDigest: string;
        runs: readonly { submissionId: string; status: unknown }[];
      };
      expect(applied).toMatchObject({
        kind: "private-foreground-apply-run/1",
        planDigest: planned.planDigest,
        runs: [
          {
            submissionId: "foreground-direct",
            status: {
              state: "terminal",
              terminal: {
                status: "succeeded",
                outcome: "done",
                output: { child: { ticket: "direct" } },
              },
            },
          },
          {
            submissionId: "foreground-composed",
            status: {
              state: "terminal",
              terminal: {
                status: "succeeded",
                outcome: "done",
                output: {
                  parent: "bun",
                  child: {
                    outcome: "done",
                    output: { child: { ticket: "composed" } },
                  },
                },
              },
            },
          },
        ],
      });
      expect(applied.admissionDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(await residualCgroups()).toEqual([]);
      expect((await readdir("/dev")).filter(
        (name) => name.startsWith(".jig-jig-run-") && name.endsWith("-devices"),
      )).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});

async function writeProject(root: string): Promise<void> {
  await mkdir(join(root, "bindings"));
  await mkdir(join(root, "flows", "parent"), { recursive: true });
  await mkdir(join(root, "flows", "child"), { recursive: true });
  await writeFile(join(root, "jig.ts"), [
    'import { defineJig, discover } from "@jigging/jig";',
    'export default defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
    "",
  ].join("\n"));
  await writeFile(join(root, "bindings", "parent.ts"), [
    'import { defineBinding, flowRef } from "@jigging/jig";',
    "export default defineBinding({",
    '  package: "flows/parent",',
    '  settings: { marker: "reviewed" },',
    '  slots: { child: flowRef("flows/child") },',
    "});",
    "",
  ].join("\n"));

  const parent = join(root, "flows", "parent");
  await writeFile(join(parent, "FLOW.md"), [
    "---",
    "name: foreground-parent",
    "description: Calls one exact Python child from a contained Bun Run.",
    "---",
    "",
  ].join("\n"));
  await writeFile(join(parent, "settings.schema.json"), JSON.stringify({
    $schema: "https://flow.dev/schemas/schema-1.json",
    type: "object",
    properties: { marker: { const: "reviewed" } },
    required: ["marker"],
    additionalProperties: false,
  }));
  await writeFile(join(parent, "flow.ts"), [
    "#!/usr/bin/env bun",
    'import { serve } from "./flow-sdk/index.ts";',
    "",
    "await serve(async (context) => ({",
    '  outcome: "done",',
    "  output: {",
    '    parent: "bun",',
    "    child: await context.callFlow({",
    '      operationId: "foreground-child",',
    '      slot: "child",',
    "      input: context.input,",
    "    }),",
    "  },",
    "}));",
    "",
  ].join("\n"));
  const typescriptSdk = join(parent, "flow-sdk");
  await mkdir(typescriptSdk);
  for (const name of [
    "index.ts",
    "json.ts",
    "protocol.ts",
    "service-session.ts",
    "session.ts",
    "transport.ts",
    "types.ts",
  ]) {
    await writeFile(
      join(typescriptSdk, name),
      await readFile(join(import.meta.dir, "..", "..", "flow-sdk", "src", name)),
    );
  }

  const child = join(root, "flows", "child");
  await writeFile(join(child, "FLOW.md"), [
    "---",
    "name: foreground-child",
    "description: Returns its input from a contained Python Run.",
    "---",
    "",
  ].join("\n"));
  await writeFile(join(child, "input.schema.json"), JSON.stringify({
    $schema: "https://flow.dev/schemas/schema-1.json",
    type: "object",
    properties: { ticket: { type: "string" } },
    required: ["ticket"],
    additionalProperties: false,
  }));
  await writeFile(join(child, "result.schema.json"), JSON.stringify({
    $schema: "https://flow.dev/schemas/schema-1.json",
    type: "object",
    properties: {
      outcome: { const: "done" },
      output: {
        type: "object",
        properties: { child: {} },
        required: ["child"],
        additionalProperties: false,
      },
    },
    required: ["outcome", "output"],
    additionalProperties: false,
  }));
  await writeFile(join(child, "flow.py"), [
    "#!/usr/bin/env python",
    "from flowmd_sdk import serve",
    "",
    "async def run(context):",
    '    return {"outcome": "done", "output": {"child": context.input}}',
    "",
    "serve(run)",
    "",
  ].join("\n"));
  const pythonSdk = join(child, "flowmd_sdk");
  await mkdir(pythonSdk);
  for (const name of ["__init__.py", "_json.py", "_runtime.py", "_service.py", "_types.py"]) {
    await writeFile(
      join(pythonSdk, name),
      await readFile(join(import.meta.dir, "..", "..", "flowmd-sdk", "src", "flowmd_sdk", name)),
    );
  }
}

async function invoke(arguments_: readonly string[]): Promise<unknown> {
  const subprocess = Bun.spawn([
    process.execPath,
    join(import.meta.dir, "..", "scripts", "private-foreground.ts"),
    ...arguments_,
  ], {
    cwd: join(import.meta.dir, "..", "..", ".."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  if (exitCode !== 0) throw new Error(`private foreground failed (${exitCode}): ${stderr}`);
  expect(stderr).toBe("");
  return JSON.parse(stdout);
}

async function residualCgroups(): Promise<string[]> {
  const relative = (await readFile("/proc/self/cgroup", "utf8")).trim().split(":").at(-1)!;
  const self = await realpath(`/sys/fs/cgroup${relative}`);
  return (await readdir(dirname(self))).filter((name) => name.startsWith("jig-run-")).sort();
}
