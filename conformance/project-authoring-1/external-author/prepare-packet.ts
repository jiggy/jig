import { createHash } from "node:crypto";
import {
  constants,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const campaignDir = dirname(fileURLToPath(import.meta.url));
const repository = resolve(campaignDir, "../../..");

function usage(): never {
  throw new Error(
    "usage: bun prepare-packet.ts <empty-output-directory> " +
      "--python <absolute-executable> --python-wheel <absolute-wheel> " +
      "[--python-sdist <absolute-sdist>]",
  );
}

function parseArgs(argv: string[]) {
  if (argv.length < 3) usage();
  const output = resolve(argv[2]!);
  let python: string | undefined;
  let pythonWheel: string | undefined;
  let pythonSdist: string | undefined;

  for (let index = 3; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value || !isAbsolute(value)) usage();
    if (option === "--python") python = value;
    else if (option === "--python-wheel") pythonWheel = value;
    else if (option === "--python-sdist") pythonSdist = value;
    else usage();
  }
  if (!python || !pythonWheel) usage();
  return { output, python, pythonWheel, pythonSdist };
}

async function command(
  executable: string,
  args: string[],
  cwd = repository,
): Promise<string> {
  const process = Bun.spawn([executable, ...args], {
    cwd,
    env: { ...Bun.env, NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });
  const output = await new Response(process.stdout).text();
  const code = await process.exited;
  if (code !== 0) {
    throw new Error(`${executable} ${args.join(" ")} exited ${code}`);
  }
  return output.trim();
}

async function ensureFreshOutput(path: string): Promise<void> {
  const repositoryRelative = relative(repository, path);
  if (repositoryRelative === "" || !repositoryRelative.startsWith("..")) {
    throw new Error("packet output must be outside the repository");
  }
  const parent = await realpath(dirname(path));
  if (join(parent, basename(path)) !== path) {
    throw new Error("packet output parent must not resolve through a symlink");
  }
  try {
    await lstat(path);
    throw new Error("packet output path already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(path, { mode: 0o700 });
}

async function copy(path: string, destination: string): Promise<void> {
  const source = resolve(repository, path);
  if (!source.startsWith(`${repository}/`)) {
    throw new Error(`packet source escapes the repository: ${path}`);
  }
  const sourceStat = await lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`packet source is not a regular file: ${path}`);
  }
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination, constants.COPYFILE_EXCL);
}

async function lines(path: string): Promise<string[]> {
  return (await readFile(join(campaignDir, path), "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function packPackage(source: string, destination: string): Promise<string> {
  const before = new Set(await readdir(destination));
  await command("bun", ["pm", "pack", "--ignore-scripts", "--destination", destination], source);
  const created = (await readdir(destination)).filter((name) => !before.has(name));
  if (created.length !== 1 || !created[0]!.endsWith(".tgz")) {
    throw new Error(`packing ${source} produced ${created.length} artifacts`);
  }
  return join(destination, created[0]!);
}

async function requirePackage(source: string, name: string, version: string): Promise<void> {
  const value = JSON.parse(await readFile(join(source, "package.json"), "utf8")) as {
    name?: unknown;
    version?: unknown;
  };
  if (value.name !== name || value.version !== version) {
    throw new Error(`expected ${name}@${version} at ${source}`);
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return `sha256:${hash.digest("hex")}`;
}

async function regularFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) found.push(path);
      else throw new Error(`packet contains a special file: ${path}`);
    }
  }
  await visit(root);
  return found;
}

const args = parseArgs(process.argv);
await ensureFreshOutput(args.output);

const status = await command("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
if (status !== "") throw new Error("prepare-packet requires a clean worktree");
const revision = await command("git", ["rev-parse", "HEAD"]);
const symbolic = await command("git", ["symbolic-ref", "-q", "--short", "HEAD"]);
if (!symbolic) throw new Error("prepare-packet requires a named branch");
const pythonVersion = await command(args.python, ["--version"]);

await command("bun", ["run", "build"], join(repository, "packages/flow-sdk"));
await command("bun", ["run", "build"], join(repository, "packages/jig"));

const authorRoot = join(args.output, "author");
const evaluatorRoot = join(args.output, "evaluator");
const artifactsRoot = join(args.output, "artifacts");
await mkdir(artifactsRoot, { recursive: true });

await copy(
  "conformance/project-authoring-1/external-author/AUTHOR-BRIEF.md",
  join(authorRoot, "AUTHOR-BRIEF.md"),
);
await copy(
  "conformance/project-authoring-1/external-author/EVALUATOR-BRIEF.md",
  join(evaluatorRoot, "EVALUATOR-BRIEF.md"),
);
for (const name of ["SETUP.md", "FIXTURES.json"]) {
  await copy(
    `conformance/project-authoring-1/external-author/${name}`,
    join(authorRoot, name),
  );
  await copy(
    `conformance/project-authoring-1/external-author/${name}`,
    join(evaluatorRoot, name),
  );
}
for (const name of ["EVALUATION.schema.json", "freeze-submission.ts"]) {
  await copy(
    `conformance/project-authoring-1/external-author/${name}`,
    join(evaluatorRoot, name),
  );
}

const authorDocuments = await lines("AUTHOR-DOCUMENTS.txt");
const evaluatorDocuments = await lines("EVALUATOR-DOCUMENTS.txt");
for (const document of authorDocuments) {
  await copy(document, join(authorRoot, document));
  await copy(document, join(evaluatorRoot, document));
}
for (const document of evaluatorDocuments) {
  await copy(document, join(evaluatorRoot, document));
}

const jigSource = join(repository, "packages/jig");
const flowSource = join(repository, "packages/flow-sdk");
await requirePackage(jigSource, "@jigging/jig", "0.0.0");
await requirePackage(flowSource, "@flowmd/sdk", "0.0.0");
const jigArtifact = await packPackage(jigSource, artifactsRoot);
const flowArtifact = await packPackage(flowSource, artifactsRoot);
const typescriptSource = await realpath(join(repository, "packages/flow-sdk/node_modules/typescript"));
await requirePackage(typescriptSource, "typescript", "7.0.2");
const typescriptArtifact = await packPackage(typescriptSource, artifactsRoot);
const typescriptPlatformSource = await realpath(join(
  repository,
  "packages/flow-sdk/node_modules/@typescript/typescript-linux-x64",
));
await requirePackage(typescriptPlatformSource, "@typescript/typescript-linux-x64", "7.0.2");
const typescriptPlatformArtifact = await packPackage(typescriptPlatformSource, artifactsRoot);
const yamlSource = await realpath(join(repository, "packages/jig/node_modules/yaml"));
await requirePackage(yamlSource, "yaml", "2.9.0");
const yamlArtifact = await packPackage(yamlSource, artifactsRoot);

for (const source of [args.pythonWheel, args.pythonSdist].filter(Boolean) as string[]) {
  const sourceStat = await lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`Python artifact is not a regular file: ${source}`);
  }
  await copyFile(source, join(artifactsRoot, basename(source)), constants.COPYFILE_EXCL);
}
if (!basename(args.pythonWheel).startsWith("flowmd_sdk-0.0.0-") ||
    !basename(args.pythonWheel).endsWith(".whl")) {
  throw new Error("Python wheel is not the expected flowmd-sdk 0.0.0 artifact");
}

const artifacts = await Promise.all(
  (await readdir(artifactsRoot))
    .sort()
    .map(async (name) => ({
      path: `artifacts/${name}`,
      sha256: await sha256(join(artifactsRoot, name)),
      bytes: (await stat(join(artifactsRoot, name))).size,
    })),
);

const manifest = {
  campaign: "project-authoring-probe-1",
  format: 1,
  source: { revision, namedBranch: true },
  operationalJigHost: false,
  networkAfterPreparation: "denied",
  runtimes: {
    bun: { version: Bun.version, executable: process.execPath },
    python: { version: pythonVersion, executable: args.python },
    platform: { os: process.platform, architecture: process.arch },
  },
  packages: {
    jig: { name: "@jigging/jig", version: "0.0.0", artifact: relative(args.output, jigArtifact) },
    flowTypeScript: { name: "@flowmd/sdk", version: "0.0.0", artifact: relative(args.output, flowArtifact) },
    flowPython: { name: "flowmd-sdk", version: "0.0.0", artifact: `artifacts/${basename(args.pythonWheel)}` },
    typescript: { name: "typescript", version: "7.0.2", artifact: relative(args.output, typescriptArtifact) },
    typescriptPlatform: {
      name: "@typescript/typescript-linux-x64",
      version: "7.0.2",
      artifact: relative(args.output, typescriptPlatformArtifact),
    },
    yaml: { name: "yaml", version: "2.9.0", artifact: relative(args.output, yamlArtifact) },
  },
  authorVisible: ["author", "artifacts", "CAMPAIGN.json", "PACKET-SHA256SUMS", "PACKET-ROOT"],
  evaluatorVisible: ["author", "evaluator", "artifacts", "CAMPAIGN.json", "PACKET-SHA256SUMS", "PACKET-ROOT"],
  commands: {
    packageCheck: "jig package check <FLOW-package-directory>",
    note: "Install only the sealed local artifacts; no operational Jig command is supplied.",
  },
  artifacts,
};
await writeFile(join(args.output, "CAMPAIGN.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o600,
  flag: "wx",
});

const inventory = await Promise.all(
  (await regularFiles(args.output))
    .filter((path) => basename(path) !== "PACKET-SHA256SUMS" && basename(path) !== "PACKET-ROOT")
    .map(async (path) => `${(await sha256(path)).slice("sha256:".length)}  ${relative(args.output, path)}`),
);
await writeFile(join(args.output, "PACKET-SHA256SUMS"), `${inventory.join("\n")}\n`, {
  mode: 0o600,
  flag: "wx",
});
const packetRoot = await sha256(join(args.output, "PACKET-SHA256SUMS"));
await writeFile(join(args.output, "PACKET-ROOT"), `${packetRoot}\n`, {
  mode: 0o600,
  flag: "wx",
});

console.log(JSON.stringify({ path: args.output, packetRoot }));
