import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";

interface InventoryFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

const forbiddenDirectories = new Set([
  ".bun",
  ".cache",
  ".git",
  ".hg",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".svn",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "env",
  "node_modules",
  "venv",
]);

const forbiddenFiles = new Set([
  ".DS_Store",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

function usage(): never {
  throw new Error("usage: bun freeze-submission.ts <submission-directory>");
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeSegment(segment: string): boolean {
  return (
    segment !== "." &&
    segment !== ".." &&
    /^[A-Za-z0-9._-]+$/u.test(segment)
  );
}

function digest(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readStableRegularFile(path: string): Promise<Uint8Array> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error(`not a regular file: ${path}`);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new Error(`file changed while freezing: ${path}`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function inventory(root: string): Promise<readonly InventoryFile[]> {
  const files: InventoryFile[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compare(left.name, right.name));

    for (const entry of entries) {
      if (!safeSegment(entry.name)) {
        throw new Error(`non-canonical campaign path segment: ${entry.name}`);
      }
      const path = resolve(directory, entry.name);
      const pathStat = await lstat(path);
      if (pathStat.isSymbolicLink()) {
        throw new Error(`submission contains a symbolic link: ${path}`);
      }
      if (entry.isDirectory()) {
        if (forbiddenDirectories.has(entry.name) || entry.name.endsWith(".egg-info")) {
          throw new Error(`submission contains generated dependency/build directory: ${path}`);
        }
        await visit(path);
        continue;
      }
      if (!entry.isFile() || !pathStat.isFile()) {
        throw new Error(`submission contains a special file: ${path}`);
      }
      if (
        forbiddenFiles.has(entry.name) ||
        entry.name.endsWith(".pyc") ||
        entry.name.endsWith(".pyo") ||
        entry.name.endsWith(".tsbuildinfo")
      ) {
        throw new Error(`submission contains generated output: ${path}`);
      }

      const bytes = await readStableRegularFile(path);
      const normalized = relative(root, path).split(sep).join("/");
      files.push({ path: normalized, bytes: bytes.byteLength, sha256: digest(bytes) });
    }
  }

  await visit(root);
  files.sort((left, right) => compare(left.path, right.path));
  if (files.length === 0) throw new Error("submission contains no regular files");
  return files;
}

if (process.argv.length !== 3) usage();
const root = resolve(process.argv[2]!);
const rootStat = await lstat(root);
if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
  throw new Error("submission root must be a real directory");
}
if (!safeSegment(basename(root))) {
  throw new Error("submission root has a non-canonical campaign path segment");
}

const files = await inventory(root);
const canonicalInventory = `${files
  .map((file) => `${JSON.stringify(file.path)}\t${file.bytes}\t${file.sha256}`)
  .join("\n")}\n`;
const result = {
  campaign: "project-authoring-probe-1",
  format: 1,
  algorithm: "sha256",
  rootDigest: digest(canonicalInventory),
  files,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
