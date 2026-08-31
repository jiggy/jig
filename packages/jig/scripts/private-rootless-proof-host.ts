import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

import {
  observePrivateRuntimeSupport,
  type PrivateRuntimeSupportObservation,
} from "../src/internal/runtime-support.js";
import { PrivateLinuxCgroupBackend } from "../src/internal/linux-rootless-backend.js";
import type { PrivateProjectSessionHost } from "../src/internal/project-session-controller.js";

const RUN_TIMEOUT_MS = 60_000;

/** Construct the development-only rootless proof fixture from retained host evidence. */
export async function openRootlessBunProofHost(): Promise<PrivateProjectSessionHost> {
  const receiptsDirectory = process.env.AGENT_RUNTIME_RECEIPTS_DIR;
  if (receiptsDirectory === undefined) {
    throw new Error("proof host did not expose retained runtime evidence");
  }
  const bunPath = await realpath("/bin/bun");
  const bun = await proofRuntime(receiptsDirectory, "runtime-rootfs.json", bunPath, "proof-bun");
  return Object.freeze({
    backend: new PrivateLinuxCgroupBackend({ bunPath }),
    bunRuntimeSupport: bun,
    jigDistributionPath: await realpath(join(import.meta.dir, "..", "dist")),
    runTimeoutMs: RUN_TIMEOUT_MS,
  });
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
