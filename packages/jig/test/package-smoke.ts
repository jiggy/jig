import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "jig-package-"));
const expectedInstalledFiles = [
  "README.md",
  "dist/administration.d.ts",
  "dist/administration.js",
  "dist/administration/root.d.ts",
  "dist/administration/root.js",
  "dist/capability/index.js",
  "dist/cli.js",
  "dist/diagnostics.js",
  "dist/experimental/hooks.d.ts",
  "dist/experimental/hooks.js",
  "dist/index.d.ts",
  "dist/index.js",
  "dist/json.d.ts",
  "dist/json.js",
  "dist/package/capture.js",
  "dist/package/case-fold-15.1.js",
  "dist/package/digest.js",
  "dist/package/inspect.js",
  "dist/package/metadata.js",
  "dist/package/paths.js",
  "dist/project-authoring-1.schema.json",
  "dist/project/author.d.ts",
  "dist/project/author.js",
  "dist/project/paths.js",
  "dist/root-administration-1.schema.json",
  "dist/schema/compiler.js",
  "dist/schema/index.js",
  "dist/schema/types.js",
  "package.json",
].sort();

try {
  const artifacts = join(temporary, "artifacts");
  const consumer = join(temporary, "consumer");
  await mkdir(artifacts);
  await mkdir(consumer);
  await run(["bun", "pm", "pack", "--ignore-scripts", "--destination", artifacts], packageRoot);
  const archives = (await readdir(artifacts)).filter((name) => name.endsWith(".tgz"));
  assert.equal(archives.length, 1);

  await writeFile(join(consumer, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies: { "@jigging/jig": `file:${join(artifacts, archives[0]!)}` },
  }));
  await run([
    "bun", "install", "--ignore-scripts", "--no-progress",
    "--cache-dir", join(temporary, "cache"), "--backend", "copyfile",
  ], consumer);
  const installed = join(consumer, "node_modules", "@jigging", "jig");
  const installedFiles = await listFiles(installed);
  assert.deepEqual(installedFiles, expectedInstalledFiles);
  assert.equal(installedFiles.some((path) => path.startsWith("dist/internal/")), false);

  const flow = join(consumer, "smoke-flow");
  await mkdir(flow);
  await writeFile(join(flow, "FLOW.md"), `---
name: smoke-flow
description: A valid installed Jig package-check smoke Flow.
---

# Smoke Flow
`);
  const checked = await run([
    join(consumer, "node_modules", ".bin", "jig"),
    "package", "check", flow,
  ], consumer);
  assert.match(checked.stdout, /^valid FLOW run package: smoke-flow$/m);
  assert.match(checked.stdout, /^implementation: instruction$/m);

  await writeFile(join(consumer, "smoke.mjs"), `
import { defineBinding, defineJig, discover, flowRef } from "@jigging/jig";
import { bindingRef, defineHook, defineJig as defineHookJig } from "@jigging/jig/experimental/hooks";
const project = defineJig({ flows: discover("./flows") });
const binding = defineBinding({ package: "./flows/review", slots: { child: flowRef("./flows/child") } });
const hookProject = defineHookJig({ hooks: discover("./hooks") });
const hook = defineHook({ on: { publisher: bindingRef("events"), type: "https://example.org/events/work" }, run: flowRef("./flows/review") });
if (project.flows.roots[0] !== "flows" || binding.package !== "flows/review" ||
    hookProject.hooks.roots[0] !== "hooks" || hook.kind !== "hook") throw new Error("bad package exports");
`);
  await run(["bun", "smoke.mjs"], consumer);

  await writeFile(join(consumer, "administration-smoke.mjs"), `
import { RootAdministrationError } from "@jigging/jig/administration";
const error = new RootAdministrationError("PROJECT_BUSY", "busy");
if (error.code !== "PROJECT_BUSY" || error.toJSON().message !== "busy") throw new Error("bad administration export");
`);
  await run(["bun", "administration-smoke.mjs"], consumer);

  await writeFile(join(consumer, "schema-smoke.mjs"), `
import { readFile } from "node:fs/promises";
const path = import.meta.resolve("@jigging/jig/schema/project-authoring-1");
const schema = JSON.parse(await readFile(new URL(path), "utf8"));
if (schema.$schema !== "https://flow.dev/schemas/schema-1.json") throw new Error("bad packaged schema");
const administrationPath = import.meta.resolve("@jigging/jig/schema/root-administration-1");
const administration = JSON.parse(await readFile(new URL(administrationPath), "utf8"));
if (!administration.$defs?.startRunRequest) throw new Error("bad packaged administration schema");
`);
  await run(["bun", "schema-smoke.mjs"], consumer);

  const installedManifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8")) as Record<string, unknown>;
  assert.equal(installedManifest.private, true);

  await writeFile(join(consumer, "smoke.ts"), `
import { defineJig, discover, type JigDefinitionInput } from "@jigging/jig";
import { defineHook, defineJig as defineHookJig, bindingRef, flowRef } from "@jigging/jig/experimental/hooks";
import type { RootAdministration, RootRunStatus } from "@jigging/jig/administration";
const input: JigDefinitionInput = { flows: discover("./flows") };
const project = defineJig(input);
const hookProject = defineHookJig({ hooks: discover("./hooks") });
const hook = defineHook({ on: { publisher: bindingRef("events"), type: "https://example.org/events/work" }, run: flowRef("./flows/review") });
declare const administration: RootAdministration;
const status: Promise<RootRunStatus> = administration.runStatus({ runId: "sha256:${"a".repeat(64)}" });
void project;
void hookProject;
void hook;
void status;
`);
  await writeFile(
    join(consumer, "root-administration-consumer.ts"),
    await readFile(resolve(
      packageRoot,
      "../../conformance/root-administration-1/consumer.ts",
    ), "utf8"),
  );
  await writeFile(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
      strict: true, noEmit: true,
    },
    files: ["smoke.ts", "root-administration-consumer.ts"],
  }));
  await run(["bunx", "--bun", "tsc", "-p", join(consumer, "tsconfig.json")], packageRoot);

  const node = Bun.env.FLOW_NODE;
  if (node === undefined || node === "" || !isAbsolute(node)) {
    throw new Error("Node is required for package smoke; set FLOW_NODE to its exact executable");
  }
  const nodeIdentity = await run([
    node,
    "-e",
    'if (process.release?.name !== "node" || process.versions?.bun !== undefined) process.exit(70); process.stdout.write("FLOW_NODE_OK\\n")',
  ], packageRoot);
  assert.equal(nodeIdentity.stdout, "FLOW_NODE_OK\n");
  assert.equal(nodeIdentity.stderr, "");
  await run([node, "smoke.mjs"], consumer);
  await run([node, "administration-smoke.mjs"], consumer);
  await run([node, "schema-smoke.mjs"], consumer);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) output.push(...await listFiles(root, path));
    else if (entry.isFile()) output.push(path);
    else throw new Error(`installed package contains a non-file member: ${path}`);
  }
  return output.sort();
}

async function run(command: string[], cwd: string): Promise<{
  readonly stdout: string;
  readonly stderr: string;
}> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill(), 30_000);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]).finally(() => clearTimeout(timeout));
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed (${exitCode})\n${stdout}${stderr}`);
  }
  return { stdout, stderr };
}
