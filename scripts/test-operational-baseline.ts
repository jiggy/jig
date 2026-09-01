import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repositoryRoot, "packages", "jig");
const systemctl = await fixedSystemctl();
const temporary = await mkdtemp(join(tmpdir(), "jig-operational-baseline-"));
const runtimeTemporary = join(temporary, "runtime-tmp");

let failure: unknown;
try {
  await mkdir(runtimeTemporary);
  await eventuallyNoJigResidue();

  const artifacts = join(temporary, "artifacts");
  const consumer = join(temporary, "consumer");
  await mkdir(artifacts);
  await mkdir(consumer);

  const archive = await selectPackageArchive(artifacts);

  await writeFile(join(consumer, "package.json"), JSON.stringify({
    private: true,
    dependencies: {
      "@jigging/jig": `file:${archive}`,
    },
  }));
  await run([
    "bun", "install", "--ignore-scripts", "--no-progress",
    "--cache-dir", join(temporary, "cache"), "--backend", "copyfile",
  ], consumer, [0], 60_000);

  const jig = join(consumer, "node_modules", ".bin", "jig");
  const project = join(consumer, "hello-project");
  const initialized = await run([jig, "init", "--bare", project], consumer);
  assert.equal(initialized.stdout, "created bare Jig project\n");
  assert.equal(initialized.stderr, "");

  await writeMalformedFlow(project);
  const malformed = await run([jig, "check", project, "--yes"], consumer, [1], 120_000);
  assert.equal(malformed.stdout, "");
  assert.equal(
    malformed.stderr,
    'INVALID_CANDIDATE: the project definition is invalid; ' +
      'METADATA_FIELD at "flows/malformed/FLOW.md" pointer "/format"\n',
  );
  assert.doesNotMatch(malformed.stderr, /\.jig|coordinator|sqlite|\/tmp\//i);
  await assert.rejects(stat(join(project, "jig.lock")), { code: "ENOENT" });
  await rm(join(project, "flows", "malformed"), { recursive: true });

  await writeHelloFlow(project);
  await writeFriendlyBinding(project);
  await writeLockedDependencyFlow(project);
  await writeMissingDependencyFlow(project);

  const approved = await run([jig, "check", project, "--yes"], consumer, [0], 120_000);
  assert.match(approved.stdout, /^Jig project plan review\n/);
  assert.match(approved.stdout, /\nproject is ready\n$/);
  assert.equal(approved.stderr, "");
  assert.doesNotMatch(
    approved.stdout,
    /planDigest|lockDigest|recipeDigest|observationDigest|coordinator|cgroup|bubblewrap/i,
  );

  const lock = JSON.parse(await readFile(join(project, "jig.lock"), "utf8")) as unknown;
  assert.deepEqual(Object.keys(requireRecord(lock)).sort(), ["bindings", "packages"]);
  assert.deepEqual(requireRecord(requireRecord(lock).bindings).friendly, {
    packagePath: "flows/hello",
    settings: { prefix: "Welcome" },
  });
  for (const value of Object.values(requireRecord(requireRecord(lock).packages))) {
    const digest = requireRecord(value).digest;
    assert.equal(typeof digest, "string");
    assert.match(digest, /^sha256:[0-9a-f]{64}$/);
    assert.match(approved.stdout, new RegExp(digest));
  }

  const lockedPackage = requireRecord(
    requireRecord(requireRecord(lock).packages)["flows/locked-dependency"],
  );
  assert.equal(typeof lockedPackage.digest, "string");
  assert.match(lockedPackage.digest as string, /^sha256:[0-9a-f]{64}$/);
  const preparationGuard = join(
    project,
    ".jig",
    "private-preparation-linux-owners",
    `prep-${(lockedPackage.digest as string).slice("sha256:".length, "sha256:".length + 48)}`,
  );
  await mkdir(preparationGuard, { mode: 0o700 });
  try {
    const unchanged = await run([jig, "check", project, "--yes"], consumer, [0], 120_000);
    assert.deepEqual(unchanged, { stdout: "project is ready\n", stderr: "", exitCode: 0 });
  } finally {
    await rm(preparationGuard, { recursive: true, force: true });
  }

  const invalidTarget = await run([jig, "run", "hello"], project, [1], 60_000);
  assert.equal(invalidTarget.stdout, "");
  assert.equal(
    invalidTarget.stderr,
    "JIG_RUN_TARGET_INVALID: the target must be flow:<path> or binding:<id>\n",
  );

  const malformedInput = await run([
    jig, "run", "flow:flows/hello", "--input", "{",
  ], project, [1], 60_000);
  assert.equal(malformedInput.stdout, "");
  assert.equal(malformedInput.stderr, "JIG_RUN_INPUT_INVALID: --input must be FLOW JSON/1\n");

  const schemaInvalid = await run([
    jig, "run", "flow:flows/hello", "--input", JSON.stringify({ name: 42 }),
  ], project, [1], 120_000);
  assert.equal(schemaInvalid.stderr, "");
  const rejectedTerminal = requireRecord(JSON.parse(schemaInvalid.stdout));
  assert.equal(rejectedTerminal.status, "failed");
  assert.equal(rejectedTerminal.code, "INVALID_INPUT");

  const unsupportedDependency = await run([
    jig, "run", "flow:flows/missing-dependency",
  ], project, [1], 120_000);
  assert.equal(unsupportedDependency.stderr, "");
  const dependencyTerminal = requireRecord(JSON.parse(unsupportedDependency.stdout));
  assert.equal(dependencyTerminal.status, "failed");
  assert.equal(dependencyTerminal.code, "CHANNEL_LOST");

  const dependencyRun = await run([
    jig, "run", "flow:flows/locked-dependency", "--input", "3",
  ], project, [0], 120_000);
  assert.equal(dependencyRun.stderr, "");
  const dependencyResult = requireRecord(JSON.parse(dependencyRun.stdout));
  assert.equal(dependencyResult.status, "succeeded");
  assert.equal(dependencyResult.outcome, "done");
  assert.deepEqual(dependencyResult.output, { odd: true });
  await assert.rejects(stat(join(project, "flows", "locked-dependency", "node_modules")), {
    code: "ENOENT",
  });
  await assert.rejects(stat(join(project, "flows", "locked-dependency", "postinstall-ran")), {
    code: "ENOENT",
  });

  const executed = await run([
    jig, "run", "flow:flows/hello", "--input", JSON.stringify({ name: "Ada" }),
  ], project, [0], 120_000);
  assert.equal(executed.stderr, "");
  const terminal = requireRecord(JSON.parse(executed.stdout));
  assert.equal(terminal.status, "succeeded");
  assert.equal(terminal.outcome, "done");
  assert.deepEqual(terminal.output, {
    greeting: "Hello, Ada!",
    received: { name: "Ada" },
  });
  assert.deepEqual(terminal.diagnostics, {
    stderr: "",
    stderrBytes: 0,
    stderrTruncated: false,
  });
  assert.doesNotMatch(executed.stdout, /sha256:|runId|coordinator|cgroup|bubblewrap|\/tmp\//i);

  const bound = await run([
    jig, "run", "binding:friendly", "--input", JSON.stringify({ name: "Ada" }),
  ], project, [0], 120_000);
  assert.equal(bound.stderr, "");
  const boundTerminal = requireRecord(JSON.parse(bound.stdout));
  assert.equal(boundTerminal.status, "succeeded");
  assert.equal(boundTerminal.outcome, "done");
  assert.deepEqual(boundTerminal.output, {
    greeting: "Welcome, Ada!",
    received: { name: "Ada" },
  });
} catch (error) {
  failure = error;
}

try {
  await eventuallyNoJigResidue();
} catch (cleanupFailure) {
  failure = failure === undefined
    ? cleanupFailure
    : new AggregateError(
        [failure, cleanupFailure],
        "Operational Baseline/1 and its residue check both failed",
      );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
if (failure !== undefined) throw failure;

process.stdout.write("Operational Baseline/1 passed\n");

async function selectPackageArchive(artifacts: string): Promise<string> {
  const supplied = process.env.JIG_PACKAGE_ARCHIVE;
  if (supplied !== undefined) {
    if (!isAbsolute(supplied) || supplied.includes("\0") || !supplied.endsWith(".tgz")) {
      throw new Error("JIG_PACKAGE_ARCHIVE must name one absolute .tgz file");
    }
    const canonical = await realpath(supplied);
    if (canonical !== supplied || !(await stat(canonical)).isFile()) {
      throw new Error("JIG_PACKAGE_ARCHIVE must name one canonical regular file");
    }
    return canonical;
  }

  // Build and pack the release candidate exactly once. Packing is explicitly
  // script-free so it cannot trigger a second build through `prepack`.
  await run(["bun", "run", "build"], packageRoot, [0], 120_000);
  await run([
    "bun", "pm", "pack", "--ignore-scripts", "--destination", artifacts,
  ], packageRoot, [0], 60_000);
  const archives = (await readdir(artifacts)).filter((name) => name.endsWith(".tgz"));
  assert.equal(archives.length, 1, "packing must produce exactly one Jig archive");
  return join(artifacts, archives[0]!);
}

async function writeHelloFlow(project: string): Promise<void> {
  const flow = join(project, "flows", "hello");
  await mkdir(flow);
  await writeFile(join(flow, "FLOW.md"), [
    "---",
    "name: hello",
    "description: Return a greeting for the supplied name.",
    "---",
    "",
    "A dependency-closed finite FLOW Run/1 example.",
    "",
  ].join("\n"));
  await writeFile(join(flow, "input.schema.json"), JSON.stringify({
    $schema: "https://flow.jig.md/schemas/schema-1.json",
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  }));
  await writeFile(join(flow, "settings.schema.json"), JSON.stringify({
    $schema: "https://flow.jig.md/schemas/schema-1.json",
    type: "object",
    properties: { prefix: { type: "string" } },
    additionalProperties: false,
  }));
  await writeFile(join(flow, "result.schema.json"), JSON.stringify({
    $schema: "https://flow.jig.md/schemas/schema-1.json",
    type: "object",
    properties: {
      outcome: { const: "done" },
      output: {
        type: "object",
        properties: {
          greeting: { type: "string" },
          received: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
            additionalProperties: false,
          },
        },
        required: ["greeting", "received"],
        additionalProperties: false,
      },
    },
    required: ["outcome", "output"],
    additionalProperties: false,
  }));
  await writeFile(join(flow, "flow.ts"), [
    'import { createInterface } from "node:readline";',
    "",
    "const lines = createInterface({ input: process.stdin });",
    "for await (const line of lines) {",
    "  const request = JSON.parse(line);",
    "  if (request.jsonrpc !== \"2.0\" || request.method !== \"flow/run\") {",
    '    throw new Error("expected one FLOW Run/1 request");',
    "  }",
    "  const received = request.params.input;",
    '  const prefix = request.params.settings.prefix ?? "Hello";',
    "  const response = {",
    '    jsonrpc: "2.0",',
    "    id: request.id,",
    "    result: {",
    '      outcome: "done",',
    "      output: { greeting: `${prefix}, ${received.name}!`, received },",
    "    },",
    "  };",
    "  process.stdout.write(`${JSON.stringify(response)}\\n`);",
    "  lines.close();",
    "  break;",
    "}",
    "",
  ].join("\n"));
}

async function writeMalformedFlow(project: string): Promise<void> {
  const flow = join(project, "flows", "malformed");
  await mkdir(flow);
  await writeFile(join(flow, "FLOW.md"), [
    "---",
    "name: malformed",
    "description: Exercise one bounded author diagnostic.",
    "format: 1",
    "---",
    "",
  ].join("\n"));
}

async function writeFriendlyBinding(project: string): Promise<void> {
  await writeFile(join(project, "bindings", "friendly.ts"), [
    'import { defineBinding } from "@jigging/jig";',
    "",
    "export default defineBinding({",
    '  package: "./flows/hello",',
    '  settings: { prefix: "Welcome" },',
    "});",
    "",
  ].join("\n"));
}

async function writeMissingDependencyFlow(project: string): Promise<void> {
  const flow = join(project, "flows", "missing-dependency");
  await mkdir(flow);
  await writeFile(join(flow, "FLOW.md"), [
    "---",
    "name: missing-dependency",
    "description: Prove that unsupported dependencies fail without installation.",
    "---",
    "",
  ].join("\n"));
  await writeFile(
    join(flow, "flow.ts"),
    'import "jig-alpha-deliberately-missing";\n',
  );
}

async function writeLockedDependencyFlow(project: string): Promise<void> {
  const flow = join(project, "flows", "locked-dependency");
  await mkdir(flow);
  await writeFile(join(flow, "FLOW.md"), [
    "---",
    "name: locked-dependency",
    "description: Run one ordinary locked Bun production dependency.",
    "---",
    "",
  ].join("\n"));
  await writeFile(join(flow, "package.json"), `${JSON.stringify({
    name: "jig-locked-dependency-baseline",
    private: true,
    scripts: { postinstall: "touch postinstall-ran" },
    dependencies: { "is-odd": "3.0.1" },
  }, null, 2)}\n`);
  await writeFile(join(flow, "bun.lock"), `{
  "lockfileVersion": 1,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "jig-locked-dependency-baseline",
      "dependencies": { "is-odd": "3.0.1" },
    },
  },
  "packages": {
    "is-number": ["is-number@6.0.0", "", {}, "sha512-Wu1VHeILBK8KAWJUAiSZQX94GmOE45Rg6/538fKwiloUu21KncEkYGPqob2oSZ5mUT73vLGrHQjKw3KMPwfDzg=="],
    "is-odd": ["is-odd@3.0.1", "", { "dependencies": { "is-number": "^6.0.0" } }, "sha512-CQpnWPrDwmP1+SMHXZhtLtJv90yiyVfluGsX5iNCVkrhQtU3TQHsUWPG9wkdk9Lgd5yNpAg9jQEo90CBaXgWMA=="],
  },
}\n`);
  await writeFile(join(flow, "flow.ts"), [
    'import isOdd from "is-odd";',
    'import { createInterface } from "node:readline";',
    "",
    "const lines = createInterface({ input: process.stdin });",
    "for await (const line of lines) {",
    "  const request = JSON.parse(line);",
    "  process.stdout.write(`${JSON.stringify({",
    '    jsonrpc: "2.0",',
    "    id: request.id,",
    '    result: { outcome: "done", output: { odd: isOdd(request.params.input) } },',
    "  })}\\n`);",
    "  lines.close();",
    "  break;",
    "}",
    "",
  ].join("\n"));
}

async function run(
  command: readonly string[],
  cwd: string,
  acceptedExitCodes: readonly number[] = [0],
  timeoutMs = 60_000,
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  const child = Bun.spawn([...command], {
    cwd,
    env: { ...process.env, TMPDIR: runtimeTemporary },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]).finally(() => clearTimeout(timeout));
  if (!acceptedExitCodes.includes(exitCode)) {
    throw new Error(`${command.map(shellWord).join(" ")} exited ${exitCode}\n${stdout}${stderr}`);
  }
  return { stdout, stderr, exitCode };
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : JSON.stringify(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

async function eventuallyNoJigResidue(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let residue: readonly string[] = [];
  do {
    residue = await jigResidue();
    if (residue.length === 0) return;
    await Bun.sleep(50);
  } while (Date.now() < deadline);
  assert.fail(`Jig execution residue remained:\n${residue.join("\n")}`);
}

async function jigResidue(): Promise<readonly string[]> {
  const units = await run([
    systemctl, "--user", "list-units", "--all", "--plain", "--no-legend", "jig-*",
  ], "/", [0], 5_000);
  const residue = units.stdout.split("\n").filter((line) => line.trim() !== "")
    .map((line) => `unit:${line.trim()}`);

  const directories = ["/sys/fs/cgroup"];
  while (directories.length > 0) {
    const directory = directories.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(directory, entry.name);
      directories.push(path);
      if (/^jig-[0-9a-f]{24}\.scope$/.test(entry.name) || entry.name.startsWith("jig-run-")) {
        residue.push(`cgroup:${path}`);
      }
    }
  }

  for (const root of [tmpdir(), runtimeTemporary]) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.name.startsWith("jig-rootless-control-") ||
          entry.name.startsWith("jig-rootless-owner-") ||
          entry.name.startsWith("jig-rootless-devices-")) {
        residue.push(`temporary:${join(root, entry.name)}`);
      }
    }
  }
  return residue.sort();
}

async function fixedSystemctl(): Promise<string> {
  for (const candidate of ["/usr/bin/systemctl", "/bin/systemctl"] as const) {
    try {
      const canonical = await realpath(candidate);
      const information = await stat(canonical);
      if (isAbsolute(canonical) && information.isFile() && (information.mode & 0o111) !== 0 &&
          (information.mode & 0o6000) === 0) {
        return canonical;
      }
    } catch {
      // The acceptance gate shares the product's closed candidate set.
    }
  }
  throw new Error("the fixed user service manager control is unavailable");
}
