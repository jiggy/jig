import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "jig-package-"));
const expectedInstalledFiles = [
  "README.md",
  "dist/administration.d.ts",
  "dist/administration.js",
  "dist/administration/root.d.ts",
  "dist/administration/root.js",
  "dist/bare-init.js",
  "dist/administration/project.d.ts",
  "dist/administration/project.js",
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
  "dist/project-administration-1.schema.json",
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
    ".gitignore", "bindings", "flows", "jig.ts", "package.json", "tsconfig.json",
  ]);
  assert.deepEqual(await readdir(join(bareProject, "bindings")), []);
  assert.deepEqual(await readdir(join(bareProject, "flows")), []);
  assert.deepEqual(
    JSON.parse(await readFile(join(bareProject, "package.json"), "utf8")),
    {
      private: true,
      type: "module",
      dependencies: { "@jigging/jig": installedManifest.version },
      devDependencies: { typescript: "7.0.2" },
    },
  );
  await run([
    "bun",
    resolve(packageRoot, "node_modules/typescript/bin/tsc"),
    "-p",
    join(bareProject, "tsconfig.json"),
  ], packageRoot);

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
import { ProjectAdministrationError } from "@jigging/jig/administration";
const error = new RootAdministrationError("PROJECT_BUSY", "busy");
if (error.code !== "PROJECT_BUSY" || error.toJSON().message !== "busy") throw new Error("bad administration export");
const projectError = new ProjectAdministrationError("STALE_PLAN", "stale");
if (projectError.code !== "STALE_PLAN" || projectError.toJSON().message !== "stale") throw new Error("bad project administration export");
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
const projectAdministrationPath = import.meta.resolve("@jigging/jig/schema/project-administration-1");
const projectAdministration = JSON.parse(await readFile(new URL(projectAdministrationPath), "utf8"));
if (!projectAdministration.$defs?.planResult) throw new Error("bad packaged project administration schema");
`);
  await run(["bun", "schema-smoke.mjs"], consumer);

  assert.equal(installedManifest.private, true);

  await writeFile(join(consumer, "smoke.ts"), `
import { defineJig, discover, type JigDefinitionInput } from "@jigging/jig";
import { defineHook, defineJig as defineHookJig, bindingRef, flowRef } from "@jigging/jig/experimental/hooks";
import type { ProjectSession, RootAdministration, RootRunStatus } from "@jigging/jig/administration";
const input: JigDefinitionInput = { flows: discover("./flows") };
const project = defineJig(input);
const hookProject = defineHookJig({ hooks: discover("./hooks") });
const hook = defineHook({ on: { publisher: bindingRef("events"), type: "https://example.org/events/work" }, run: flowRef("./flows/review") });
declare const administration: RootAdministration;
declare const session: ProjectSession;
const status: Promise<RootRunStatus> = administration.runStatus({ runId: "sha256:${"a".repeat(64)}" });
const planned = session.plan({ lockMode: "update" });
void project;
void hookProject;
void hook;
void status;
void planned;
`);
  await writeFile(
    join(consumer, "root-administration-consumer.ts"),
    await readFile(resolve(
      packageRoot,
      "../../conformance/root-administration-1/consumer.ts",
    ), "utf8"),
  );
  await writeFile(
    join(consumer, "project-administration-consumer.ts"),
    await readFile(resolve(
      packageRoot,
      "../../conformance/project-administration-1/consumer.ts",
    ), "utf8"),
  );
  await writeFile(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
      strict: true, noEmit: true,
    },
    files: ["smoke.ts", "root-administration-consumer.ts", "project-administration-consumer.ts"],
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
