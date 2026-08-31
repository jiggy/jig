import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "flow-sdk-package-"));

try {
  const artifacts = join(temporary, "artifacts");
  const consumer = join(temporary, "consumer");
  await mkdir(artifacts);
  await mkdir(consumer);

  await run([
    "bun",
    "pm",
    "pack",
    "--ignore-scripts",
    "--destination",
    artifacts,
  ], packageRoot);
  const packed = (await readdir(artifacts)).filter((name) => name.endsWith(".tgz"));
  assert.equal(packed.length, 1);
  const archive = join(artifacts, packed[0]!);

  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { "@flowmd/sdk": `file:${archive}` },
    }),
  );
  await run([
    "bun",
    "install",
    "--ignore-scripts",
    "--no-progress",
    "--cache-dir",
    join(temporary, "bun-cache"),
    "--backend",
    "copyfile",
    "--network-concurrency",
    "1",
  ], consumer);

  const installed = join(consumer, "node_modules", "@flowmd", "sdk");
  assert.deepEqual(
    (await readdir(installed)).sort(),
    ["README.md", "dist", "package.json"],
  );
  assert.deepEqual(
    (await readdir(join(installed, "dist"))).sort(),
    [
      "index.d.ts",
      "index.js",
      "json.d.ts",
      "json.js",
      "protocol.d.ts",
      "protocol.js",
      "session.d.ts",
      "session.js",
      "transport.d.ts",
      "transport.js",
      "types.d.ts",
      "types.js",
    ],
  );
  const readme = await readFile(join(installed, "README.md"), "utf8");
  assert.doesNotMatch(readme, /\]\((?:\.\.\/)+docs\//);

  const manifest = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(manifest.private, true);
  assert.equal(manifest.types, "./dist/index.d.ts");

  await writeFile(
    join(consumer, "smoke.mjs"),
    `import { EffectError, OperationError } from "@flowmd/sdk";
const operation = new OperationError("UNAVAILABLE");
const effect = new EffectError("not-found", null);
if (operation.code !== "UNAVAILABLE" || effect.errorName !== "not-found") {
  throw new Error("installed runtime exports are invalid");
}
`,
  );
  await run(["bun", "smoke.mjs"], consumer);
  const node = Bun.env.FLOW_NODE;
  if (node === undefined || node === "" || !isAbsolute(node)) {
    throw new Error("Node was not supplied; set FLOW_NODE to its exact executable");
  }
  const nodeIdentity = await run([
    node,
    "-e",
    'if (process.release?.name !== "node" || process.versions?.bun !== undefined) process.exit(70); process.stdout.write("FLOW_NODE_OK\\n")',
  ], packageRoot);
  assert.equal(nodeIdentity.stdout, "FLOW_NODE_OK\n");
  assert.equal(nodeIdentity.stderr, "");
  await run([node, "smoke.mjs"], consumer);

  await writeFile(
    join(consumer, "smoke.ts"),
    `import { OperationError, type JsonValue, type RunHandler, type RunResult } from "@flowmd/sdk";
const handler: RunHandler = async (run) => ({
  outcome: "done",
  output: await run.callEffect({
    operationId: "smoke:1",
    slot: "clock",
    method: "now",
    input: null,
  }),
});
void handler;
const runResult: RunResult = {
  outcome: "done",
  output: { value: 1 },
};
const directJson: JsonValue = runResult;
const nestedJson: JsonValue = { result: runResult };
void directJson;
void nestedJson;
void new OperationError("UNAVAILABLE");
`,
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
      },
      files: ["smoke.ts"],
    }),
  );
  await run(
    ["bunx", "--bun", "tsc", "-p", join(consumer, "tsconfig.json")],
    packageRoot,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function run(command: string[], cwd: string): Promise<{
  readonly stdout: string;
  readonly stderr: string;
}> {
  const process = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => process.kill(), 30_000);
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]).finally(() => clearTimeout(timeout));
  if (exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed (${exitCode})\n${stdout}${stderr}`,
    );
  }
  return { stdout, stderr };
}
