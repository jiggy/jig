import { readFile, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import {
  observePrivateRuntimeSupport,
  type PrivateRuntimeSupportObservation,
} from "../src/internal/runtime-support.js";
import { PrivateLinuxCgroupBackend } from "../src/internal/linux-rootless-backend.js";
import { privateFileDigest } from "../src/internal/identity.js";
import type { PrivateProjectSessionHost } from "../src/internal/project-session-controller.js";

const RUN_TIMEOUT_MS = 60_000;

/** Construct the development-only rootless proof fixture from retained host evidence. */
export async function openRootlessProofHost(): Promise<PrivateProjectSessionHost> {
  const receiptsDirectory = process.env.AGENT_RUNTIME_RECEIPTS_DIR;
  if (receiptsDirectory === undefined) {
    throw new Error("proof host did not expose retained runtime evidence");
  }
  const bunPath = await realpath("/bin/bun");
  const bun = await proofRuntime(receiptsDirectory, "runtime-rootfs.json", bunPath, "proof-bun");
  const python = await proofHostPython(receiptsDirectory);
  const workerBundlePath = await realpath(join(
    import.meta.dir,
    "..",
    "dist",
    "internal",
    "bun-native-preparation-worker.bundle.js",
  ));
  return Object.freeze({
    backend: new PrivateLinuxCgroupBackend({ bunPath }),
    bunRuntimeSupport: bun,
    directRuntimeSupport: Object.freeze({ bun, python }),
    bunNativePreparation: Object.freeze({
      workerBundlePath,
      workerBundleDigest: await privateFileDigest(workerBundlePath),
    }),
    jigDistributionPath: await realpath(join(import.meta.dir, "..", "dist")),
    runTimeoutMs: RUN_TIMEOUT_MS,
  });
}

async function proofHostPython(receiptsDirectory: string): Promise<PrivateRuntimeSupportObservation> {
  const candidates: Array<{ receiptName: string; executablePath: string }> = [];
  for (const receiptName of (await readdir(receiptsDirectory)).sort()) {
    if (!/^need-[0-9a-f]{64}\.json$/.test(receiptName)) continue;
    const value = JSON.parse(await readFile(join(receiptsDirectory, receiptName), "utf8")) as {
      kind?: unknown;
      installable?: unknown;
      selected_out_path?: unknown;
    };
    if (value.kind === "need-materialization" && value.installable === "nixpkgs#python314" &&
        typeof value.selected_out_path === "string") {
      candidates.push({
        receiptName,
        executablePath: join(value.selected_out_path, "bin", "python3"),
      });
    }
  }
  if (candidates.length === 0) throw new Error("proof host Python runtime evidence is absent");
  const observations = await Promise.all(candidates.map(async ({ receiptName, executablePath }) =>
    await proofRuntime(receiptsDirectory, receiptName, executablePath, "proof-python")
  ));
  const selected = observations[0]!;
  if (observations.some(({ digest }) => digest !== selected.digest)) {
    throw new Error("proof host Python runtime evidence is ambiguous");
  }
  return selected;
}

async function proofRuntime(
  receiptsDirectory: string,
  receiptName: string,
  executablePath: string,
  supportId: string,
): Promise<PrivateRuntimeSupportObservation> {
  const document = JSON.parse(await readFile(join(receiptsDirectory, receiptName), "utf8")) as {
    readonly closure?: readonly { readonly path?: unknown; readonly references?: unknown }[];
  };
  if (!Array.isArray(document.closure)) throw new Error("proof runtime evidence has no closure");
  const closure = document.closure.map((entry) => {
    if (typeof entry.path !== "string" || !Array.isArray(entry.references) ||
        !entry.references.every((value) => typeof value === "string")) {
      throw new Error("proof runtime evidence contains an invalid closure member");
    }
    return { path: entry.path, references: entry.references as string[] };
  });
  const canonicalExecutable = await realpath(executablePath);
  const root = closure.find(({ path }) =>
    canonicalExecutable === path || canonicalExecutable.startsWith(`${path}/`)
  );
  if (root === undefined) throw new Error("proof runtime evidence omits its executable");
  const byPath = new Map(closure.map((entry) => [entry.path, entry]));
  const sources = new Set<string>();
  const visit = (path: string): void => {
    if (sources.has(path)) return;
    const entry = byPath.get(path);
    if (entry === undefined) throw new Error(`proof runtime evidence omits referenced path ${path}`);
    sources.add(path);
    for (const reference of entry.references) visit(reference);
  };
  visit(root.path);
  return await observePrivateRuntimeSupport({
    supportId,
    executablePath: canonicalExecutable,
    closureSources: [...sources].sort(),
  });
}
