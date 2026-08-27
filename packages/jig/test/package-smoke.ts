import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "jig-package-"));

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

  await writeFile(join(consumer, "smoke.mjs"), `
import { defineBinding, defineJig, discover, flowRef } from "@jigging/jig";
const project = defineJig({ flows: discover("./flows") });
const binding = defineBinding({ package: "./flows/review", slots: { child: flowRef("./flows/child") } });
if (project.flows.roots[0] !== "flows" || binding.package !== "flows/review") throw new Error("bad package exports");
`);
  const node = Bun.which("node");
  if (node === null) throw new Error("Node is required for package smoke");
  await run([node, "smoke.mjs"], consumer);
  await run(["bun", "smoke.mjs"], consumer);

  await writeFile(join(consumer, "administration-smoke.mjs"), `
import { RootAdministrationError } from "@jigging/jig/administration";
const error = new RootAdministrationError("PROJECT_BUSY", "busy");
if (error.code !== "PROJECT_BUSY" || error.toJSON().message !== "busy") throw new Error("bad administration export");
`);
  await run([node, "administration-smoke.mjs"], consumer);
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
  await run([node, "schema-smoke.mjs"], consumer);

  const installedManifest = JSON.parse(await readFile(
    join(consumer, "node_modules", "@jigging", "jig", "package.json"),
    "utf8",
  )) as Record<string, unknown>;
  assert.equal(installedManifest.private, true);

  await writeFile(join(consumer, "smoke.ts"), `
import { defineJig, discover, type JigDefinitionInput } from "@jigging/jig";
import type { RootAdministration, RootRunStatus } from "@jigging/jig/administration";
const input: JigDefinitionInput = { flows: discover("./flows") };
const project = defineJig(input);
declare const administration: RootAdministration;
const status: Promise<RootRunStatus> = administration.runStatus({ runId: "sha256:${"a".repeat(64)}" });
void project;
void status;
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

async function run(command: string[], cwd: string): Promise<void> {
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
}
