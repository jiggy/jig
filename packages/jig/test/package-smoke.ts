import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "jig-package-"));
const expectedInstalledFiles = [
  "README.md",
  "dist/bare-init.js",
  "dist/capability/index.js",
  "dist/cli.js",
  "dist/diagnostics.js",
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
  const installedManifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(installedFiles, expectedInstalledFiles);
  assert.equal(installedFiles.some((path) => path.startsWith("dist/internal/")), false);

  const bareProject = join(consumer, "bare-project");
  const initialized = await run([
    join(consumer, "node_modules", ".bin", "jig"),
    "init", "--bare", bareProject,
  ], consumer);
  assert.equal(initialized.stdout, "created bare Jig project\n");
  assert.deepEqual((await readdir(bareProject)).sort(), [
    ".gitignore", "bindings", "flows", "jig.ts",
  ]);
  assert.deepEqual(await readdir(join(bareProject, "bindings")), []);
  assert.deepEqual(await readdir(join(bareProject, "flows")), []);

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
import { defineBinding, defineJig, discover } from "@jigging/jig";
const project = defineJig({ flows: discover("./flows") });
const binding = defineBinding({ package: "./flows/review", settings: { profile: "fast" } });
if (project.flows.roots[0] !== "flows" || binding.package !== "flows/review" ||
    binding.settings.profile !== "fast") throw new Error("bad package exports");
`);
  await run(["bun", "smoke.mjs"], consumer);

  await writeFile(join(consumer, "schema-smoke.mjs"), `
import { readFile } from "node:fs/promises";
const path = import.meta.resolve("@jigging/jig/schema/project-authoring-1");
const schema = JSON.parse(await readFile(new URL(path), "utf8"));
if (schema.$schema !== "https://flow.dev/schemas/schema-1.json") throw new Error("bad packaged schema");
if (!schema.$defs?.packageBinding) throw new Error("missing package Binding schema");
`);
  await run(["bun", "schema-smoke.mjs"], consumer);

  assert.equal(installedManifest.private, true);

  await writeFile(join(consumer, "smoke.ts"), `
import { defineBinding, defineJig, discover, type JigDefinitionInput, type PackageBindingInput } from "@jigging/jig";
const input: JigDefinitionInput = { flows: discover("./flows") };
const project = defineJig(input);
const bindingInput: PackageBindingInput = { package: "./flows/router", settings: { profile: "fast" } };
const binding = defineBinding(bindingInput);
void project;
void binding;
`);
  await writeFile(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
      strict: true, noEmit: true,
    },
    files: ["smoke.ts"],
  }));
  await run(["bunx", "--bun", "tsc", "-p", join(consumer, "tsconfig.json")], packageRoot);

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
