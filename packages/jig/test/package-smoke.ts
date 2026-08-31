import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "jig-package-"));
const expectedInstalledFiles = [
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES",
  "bin/jig",
  "dist/index.d.ts",
  "dist/index.js",
  "dist/json.d.ts",
  "dist/project/author.d.ts",
  "libexec/evaluator/project-authoring-1.schema.json",
  "libexec/evaluator/project-evaluator-sdk.bundle.js",
  "libexec/evaluator/project-evaluator-worker.js",
  "libexec/linux-rootless-supervisor.js",
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
  const installedManifest = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.deepEqual(installedFiles, expectedInstalledFiles);
  assert.deepEqual(installedManifest.bin, { jig: "./bin/jig" });
  assert.equal(installedManifest.dependencies, undefined);
  assert.equal(installedManifest.private, true);
  assert.equal(installedManifest.version, "0.1.0-alpha.1");
  assert.equal(installedManifest.license, "MPL-2.0");
  assert.deepEqual(installedManifest.os, ["linux"]);
  assert.deepEqual(installedManifest.cpu, ["x64"]);
  assert.deepEqual(installedManifest.libc, ["glibc"]);

  const executable = join(installed, "bin", "jig");
  const command = join(consumer, "node_modules", ".bin", "jig");
  assert.notEqual((await stat(executable)).mode & 0o111, 0);
  assert.equal((await readFile(executable)).subarray(0, 4).toString("hex"), "7f454c46");
  const help = await run([command, "--help"], consumer);
  assert.equal(help.stderr, "");
  assert.match(help.stdout, /^Usage:\n  jig init --bare <directory>$/m);
  assert.match(help.stdout, /^  jig check \[project\] \[--yes\]$/m);
  assert.match(help.stdout, /^  jig run <flow:path\|binding:id> \[--input JSON\]$/m);
  assert.doesNotMatch(help.stdout, /setup|package check|planDigest/);

  const bun = await run([command, "--version"], consumer, { BUN_BE_BUN: "1" });
  assert.equal(bun.stdout, "1.3.3\n");
  assert.equal(bun.stderr, "");

  const bareProject = join(consumer, "bare-project");
  const initialized = await run([command, "init", "--bare", bareProject], consumer);
  assert.equal(initialized.stdout, "created bare Jig project\n");
  assert.equal(initialized.stderr, "");
  assert.deepEqual((await readdir(bareProject)).sort(), [
    ".gitignore", "bindings", "flows", "jig.ts",
  ]);
  assert.deepEqual(await readdir(join(bareProject, "bindings")), []);
  assert.deepEqual(await readdir(join(bareProject, "flows")), []);

  for (const relative of [
    "libexec/linux-rootless-supervisor.js",
    "libexec/evaluator/project-evaluator-worker.js",
    "libexec/evaluator/project-evaluator-sdk.bundle.js",
  ]) {
    const source = await readFile(join(installed, relative), "utf8");
    assert.doesNotMatch(source, /(?:from|import\()\s*["']\.\.?\//);
  }

  await writeFile(join(consumer, "smoke.mjs"), `
import { defineBinding, defineJig, discover } from "@jigging/jig";
const project = defineJig({ flows: discover("./flows") });
const binding = defineBinding({ package: "./flows/review", settings: { profile: "fast" } });
if (project.flows.roots[0] !== "flows" || binding.package !== "flows/review" ||
    binding.settings.profile !== "fast") throw new Error("bad package exports");
`);
  await run(["bun", "smoke.mjs"], consumer);

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
  await run([
    process.execPath,
    join(packageRoot, "node_modules", "typescript", "bin", "tsc"),
    "-p", join(consumer, "tsconfig.json"),
  ], packageRoot);
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

async function run(
  command: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = {},
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const child = Bun.spawn(command, {
    cwd,
    env: { ...process.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
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
