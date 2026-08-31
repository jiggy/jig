import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
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
import { dirname, join } from "node:path";

import {
  observePrivateRuntimeSupport,
  requirePrivateRuntimeSupportObservation,
} from "../src/internal/runtime-support.js";
import { createPrivateActivationPlanningObservation } from "../src/internal/activation-planning.js";
import { createPrivateActivationCandidateV5 } from "../src/internal/activation-admission.js";
import {
  applyPrivateActivationReviewPlan,
  createPrivateActivationReviewPlan,
  loadPrivateRootBunNativePreparation,
  loadPrivateRootRun,
  openPrivateProjectCoordinator,
  publishPrivateActivationCandidate,
  submitPrivateRootRun,
} from "../src/internal/activation-admission-store.js";
import {
  executePrivateRootBunNativePreparation,
} from "../src/internal/bun-native-preparation-controller.js";
import {
  PrivateBunNativePreparationFenceUnconfirmedError,
  runPrivateBunNativePreparationFeasibility,
} from "../src/internal/bun-native-preparation-feasibility.js";
import { privateFileDigest } from "../src/internal/identity.js";
import { planPrivateDirectRun } from "../src/internal/direct-run.js";
import { executePrivateRootRunLaunch } from "../src/internal/root-run-controller.js";
import {
  PrivateLinuxCgroupBackend,
} from "../src/internal/linux-rootless-backend.js";
import { defineJig } from "../src/project/author.js";
import { captureFlowSource, type CapturedFlowSource } from "../src/project/flow-source.js";
import { linkPackageProject } from "../src/project/package-project.js";
import {
  buildPrivateActivationRequests,
  type PrivateActivationRequest,
} from "../src/project/package-resolution.js";
import { retainFlowSourcePackages } from "../src/project/retained-flow.js";
import { retainPackageProject } from "../src/project/retained-project.js";
import { resolveRetainedPackageProjectObservation } from "../src/project/package-resolution.js";

const HOSTILE = process.env.JIG_LINUX_ROOTLESS_HOSTILE === "1";
const hostileDescribe = HOSTILE ? describe.serial : describe.skip;
const ARCHIVE_MEMBER = "vendor/flowmd-sdk-0.0.0.tgz";

hostileDescribe("private contained Bun native preparation feasibility", () => {
  let delegatedCgroup: string | undefined;
  let temporaryStateBaseline: readonly string[] = [];

  afterAll(async () => {
    if (delegatedCgroup === undefined) return;
    expect(await jigCgroups(delegatedCgroup)).toEqual([]);
    await waitForRootlessTemporaryState(temporaryStateBaseline);
  });

  test("installs one real package-local FLOW SDK archive without ambient package access", async () => {
    temporaryStateBaseline = await rootlessTemporaryState();
    const host = await hostConfiguration();
    delegatedCgroup = host.delegatedCgroup;
    const bun = await proofHostBunClosure();
    const backend = new PrivateLinuxCgroupBackend({ bunPath: host.bun });
    const root = await mkdtemp(join(tmpdir(), "jig-native-preparation-hostile-"));
    const projectRoot = join(root, "project");
    const store = join(root, "store");
    const artifacts = join(root, "artifacts");
    const archive = join(artifacts, "real", "flowmd-sdk-0.0.0.tgz");
    const scriptArchive = join(artifacts, "script", "flowmd-sdk-0.0.0.tgz");
    const workerBundle = join(artifacts, "bun-native-preparation-worker.js");
    const overflowWorker = join(artifacts, "bun-native-preparation-overflow.js");
    let source: CapturedFlowSource | undefined;
    let cleanupAllowed = true;
    try {
      await mkdir(artifacts, { recursive: true, mode: 0o700 });
      await mkdir(store, { recursive: true, mode: 0o700 });
      await mkdir(dirname(archive), { recursive: true });
      await mkdir(dirname(scriptArchive), { recursive: true });
      await buildSdkArchive(archive);
      await buildScriptBearingSdkArchive(scriptArchive, join(root, "script-sdk"));
      await buildWorkerBundle(workerBundle);
      await writeFile(overflowWorker, [
        "await Bun.write(Bun.stdout, new Uint8Array(2 * 1024 * 1024 + 1));",
        "await new Promise(() => {});",
        "",
      ].join("\n"), { mode: 0o400 });
      expect((await stat(archive)).size).toBeLessThanOrEqual(1024 * 1024);

      await writeReviewerFlow(projectRoot, "reviewer", archive);
      await writeReviewerFlow(projectRoot, "script-reviewer", scriptArchive);

      source = await captureFlowSource(
        projectRoot,
        defineJig({ flows: ["flows/reviewer", "flows/script-reviewer"] }).flows,
      );
      const flows = await retainFlowSourcePackages(store, source);
      const project = linkPackageProject({
        flows,
        bindings: [
          {
            sourcePath: "bindings/reviewer.ts",
            definition: { package: "flows/reviewer" },
          },
          {
            sourcePath: "bindings/script-reviewer.ts",
            definition: { package: "flows/script-reviewer" },
          },
        ],
      });
      const requests = buildPrivateActivationRequests(project);
      const request = requireReviewerRequest(requests, "reviewer");
      const scriptRequest = requireReviewerRequest(requests, "script-reviewer");

      // The mount sealer requires every source ancestor to be traversable by
      // the payload UID. The artifact itself remains immutable and read-only.
      await chmod(root, 0o711);
      await chmod(artifacts, 0o555);
      // This unique 0400 snapshot is sufficient only for the ephemeral proof.
      // Product readiness requires a host-owned, restart-reacquirable artifact.
      await chmod(workerBundle, 0o400);
      const workerBundleDigest = await privateFileDigest(workerBundle);
      const first = await runPrivateBunNativePreparationFeasibility({
        request,
        packageStoreRoot: store,
        runtimeSupport: bun.runtimeSupport,
        backend,
        workerBundlePath: workerBundle,
        workerBundleDigest,
        runId: "native-prep-a",
        deadlineUnixMs: Date.now() + 30_000,
      });
      const second = await runPrivateBunNativePreparationFeasibility({
        request,
        packageStoreRoot: store,
        runtimeSupport: bun.runtimeSupport,
        backend,
        workerBundlePath: workerBundle,
        workerBundleDigest,
        runId: "native-prep-b",
        deadlineUnixMs: Date.now() + 30_000,
      });
      const scriptBearing = await runPrivateBunNativePreparationFeasibility({
        request: scriptRequest,
        packageStoreRoot: store,
        runtimeSupport: bun.runtimeSupport,
        backend,
        workerBundlePath: workerBundle,
        workerBundleDigest,
        runId: "native-prep-script",
        deadlineUnixMs: Date.now() + 30_000,
      });

      expect(first.candidate.digest).toBe(second.candidate.digest);
      expect(first.workerDigest).toBe(workerBundleDigest);
      expect(first.enforcement).toMatchObject({
        fenced: true,
        stopReason: "payload_exit",
        exitCode: 0,
        signal: null,
      });
      expect(first.candidate.files.some((file) => file.path === "package.json")).toBeTrue();
      expect(first.candidate.files.some((file) => file.path === "dist/index.js")).toBeTrue();
      const scriptManifest = scriptBearing.candidate.files.find((file) => file.path === "package.json");
      expect(scriptManifest).toBeDefined();
      expect(Buffer.from(scriptManifest!.contentBase64, "base64").toString("utf8"))
        .toContain("postinstall");
      expect(await jigCgroups(host.delegatedCgroup)).toEqual([]);

      await mkdir(join(projectRoot, "bindings"), { recursive: true });
      await writeFile(join(projectRoot, "jig.ts"), [
        'import { defineJig } from "@jigging/jig";',
        'export default defineJig({ flows: ["flows/reviewer"], bindings: ["bindings/reviewer.ts"] });',
        "",
      ].join("\n"));
      await writeFile(join(projectRoot, "bindings", "reviewer.ts"), [
        'import { defineBinding } from "@jigging/jig";',
        'export default defineBinding({ package: "flows/reviewer" });',
        "",
      ].join("\n"));
      const distribution = await realpath(join(import.meta.dir, "..", "dist"));
      const evaluator = {
        backend,
        bunPath: bun.runtimeSupport.executablePath,
        runtimeMounts: bun.runtimeSupport.closureSources.map((member) => ({
          source: member,
          destination: member,
        })),
        runtimeSupport: bun.runtimeSupport,
        jigDistributionPath: distribution,
      } as const;
      const aggregate = await retainPackageProject({
        projectRoot,
        storeRoot: store,
        evaluator,
      });
      const retainedRequests = buildPrivateActivationRequests(aggregate.linked);
      const retainedRequest = retainedRequests.find(({ target }) =>
        target.kind === "binding" && target.id === "reviewer");
      if (retainedRequest === undefined) throw new Error("missing retained reviewer request");
      const recipe = await planPrivateDirectRun({
        request: retainedRequest,
        runtimeSupport: bun.runtimeSupport,
        backend,
        packageStoreRoot: store,
        bunNativePreparation: {
          workerBundlePath: workerBundle,
          workerBundleDigest,
        },
      });
      const planning = createPrivateActivationPlanningObservation({
        policyDigest: testDigest("native-preparation-policy"),
        mechanismDigest: recipe.mechanismDigest,
        entries: retainedRequests.map((candidateRequest) => candidateRequest.digest === retainedRequest.digest
          ? {
              target: candidateRequest.target,
              requestDigest: candidateRequest.digest,
              disposition: { state: "planned" as const, observation: recipe.observation },
            }
          : {
              target: candidateRequest.target,
              requestDigest: candidateRequest.digest,
              disposition: {
                state: "unavailable" as const,
                code: "RUNTIME_UNAVAILABLE" as const,
                evidenceDigests: [testDigest(`native-binding-only:${candidateRequest.digest}`)],
              },
            }),
      });
      const candidate = createPrivateActivationCandidateV5(
        aggregate,
        resolveRetainedPackageProjectObservation(aggregate, planning),
        recipe,
      );
      await publishPrivateActivationCandidate({
        projectRoot,
        packageStoreRoot: store,
        candidate,
      });
      const review = await createPrivateActivationReviewPlan({
        projectRoot,
        packageStoreRoot: store,
        lockMode: "update",
      });
      await applyPrivateActivationReviewPlan({
        projectRoot,
        packageStoreRoot: store,
        planDigest: review.planDigest,
      });
      const coordinator = await openPrivateProjectCoordinator({ projectRoot });
      try {
        const submitPreparation = async (submissionId: string) => {
          const submitted = await submitPrivateRootRun({
            coordinator,
            projectRoot,
            packageStoreRoot: store,
            submissionId,
            target: retainedRequest.target,
            input: { submissionId },
            deadlineUnixMs: Date.now() + 60_000,
          });
          if (submitted.launch === undefined) throw new Error("expected fresh root launch");
          return submitted;
        };
        const executePreparation = async (
          parentRunId: string,
          selectedWorker: string,
        ) => {
          return await executePrivateRootBunNativePreparation({
            coordinator,
            projectRoot,
            packageStoreRoot: store,
            parentRunId,
            runtimeSupport: bun.runtimeSupport,
            backend,
            workerBundlePath: selectedWorker,
            workerBundleDigest: await privateFileDigest(selectedWorker),
          });
        };
        const runPreparation = async (submissionId: string, selectedWorker: string) => {
          const submission = await submitPreparation(submissionId);
          return await executePreparation(submission.run.runId, selectedWorker);
        };

        const durable = await runPreparation("native-preparation-controller-success", workerBundle);
        expect(durable).toMatchObject({
          state: "terminal",
          snapshot: {
            outcome: { value: { status: "succeeded" } },
            artifact: { value: { reference: { kind: "private-bun-native-prepared-tree/1" } } },
            release: { value: { packageReleased: true } },
          },
        });
        const replay = await executePrivateRootBunNativePreparation({
          coordinator,
          projectRoot,
          packageStoreRoot: store,
          parentRunId: durable.snapshot.allocation.parentRunId,
          runtimeSupport: bun.runtimeSupport,
          backend,
          workerBundlePath: workerBundle,
          workerBundleDigest,
        });
        expect(replay).toEqual(durable);

        const concurrentSubmission = await submitPreparation(
          "native-preparation-controller-concurrent",
        );
        const concurrent = await Promise.all([
          executePreparation(concurrentSubmission.run.runId, workerBundle),
          executePreparation(concurrentSubmission.run.runId, workerBundle),
        ]);
        expect(concurrent.filter(({ state }) => state === "terminal")).toHaveLength(1);
        expect(concurrent.filter(({ state }) => state === "pending")).toHaveLength(1);
        expect(concurrent.find(({ state }) => state === "pending")).toEqual({
          state: "pending",
          reason: "in-progress",
        });
        expect(concurrent.find(({ state }) => state === "terminal")).toMatchObject({
          state: "terminal",
          snapshot: { outcome: { value: { status: "succeeded" } } },
        });

        const overflow = await runPreparation("native-preparation-controller-overflow", overflowWorker);
        expect(overflow).toMatchObject({
          state: "terminal",
          snapshot: {
            outcome: { value: { status: "failed", code: "INVALID_RESULT" } },
            release: { value: { packageReleased: true } },
          },
        });
        expect(overflow.snapshot.artifact).toBeUndefined();

        const joinedSubmission = await submitPreparation("native-preparation-root-join");
        const joined = await executePrivateRootRunLaunch({
          projectRoot,
          packageStoreRoot: store,
          runId: joinedSubmission.run.runId,
          coordinator,
          runtimeSupport: { bun: bun.runtimeSupport },
          backend,
          bunNativePreparation: { workerBundlePath: workerBundle, workerBundleDigest },
          notifyWorkAvailable: () => undefined,
        });
        expect(joined).toMatchObject({
          state: "terminal",
          run: {
            state: "terminal",
            terminal: {
              status: "succeeded",
              result: {
                outcome: "done",
                output: {
                  submissionId: "native-preparation-root-join",
                  packageReadOnly: true,
                },
              },
            },
          },
        });
        expect(await loadPrivateRootRun({
          projectRoot,
          runId: joinedSubmission.run.runId,
        })).toEqual(joined.run);
        expect(await loadPrivateRootBunNativePreparation({
          coordinator,
          projectRoot,
          parentRunId: joinedSubmission.run.runId,
        })).toMatchObject({
          outcome: { value: { status: "succeeded" } },
          closure: { value: { parentRunId: joinedSubmission.run.runId } },
        });
        expect(await readdir(join(projectRoot, ".jig", "private-root-materializations")))
          .toEqual([]);
        expect(await readdir(join(projectRoot, ".jig", "private-root-linux-owners")))
          .toEqual([]);
      } finally {
        await coordinator.dispose();
      }
      expect(await jigCgroups(host.delegatedCgroup)).toEqual([]);
    } catch (error) {
      if (error instanceof PrivateBunNativePreparationFenceUnconfirmedError) {
        cleanupAllowed = false;
      }
      throw error;
    } finally {
      await source?.dispose();
      if (cleanupAllowed) {
        await chmod(artifacts, 0o700).catch(() => undefined);
        await chmod(root, 0o700).catch(() => undefined);
        await rm(root, { recursive: true, force: true });
      }
    }
  }, 240_000);
});

async function buildSdkArchive(destination: string): Promise<void> {
  const sdk = join(import.meta.dir, "..", "..", "flow-sdk");
  await invoke(process.execPath, ["run", "build"], sdk);
  await invoke(process.execPath, [
    "pm",
    "pack",
    "--ignore-scripts",
    "--quiet",
    "--destination",
    dirname(destination),
  ], sdk);
}

async function buildScriptBearingSdkArchive(destination: string, source: string): Promise<void> {
  await mkdir(join(source, "dist"), { recursive: true });
  await writeFile(join(source, "dist/index.js"), "export const scriptFree = true;\n");
  await writeFile(join(source, "package.json"), JSON.stringify({
    name: "@flowmd/sdk",
    version: "0.0.0",
    type: "module",
    exports: "./dist/index.js",
    files: ["dist"],
    scripts: {
      postinstall: "bun -e \"await Bun.write('/work/project/script-ran', 'unsafe')\"",
    },
  }));
  await invoke(process.execPath, [
    "pm",
    "pack",
    "--ignore-scripts",
    "--quiet",
    "--destination",
    dirname(destination),
  ], source);
}

async function buildWorkerBundle(destination: string): Promise<void> {
  const source = join(import.meta.dir, "..", "src", "internal", "bun-native-preparation-worker.ts");
  await invoke(process.execPath, [
    "build",
    source,
    "--target=bun",
    "--format=esm",
    `--outfile=${destination}`,
  ], join(import.meta.dir, ".."));
}

async function invoke(command: string, arguments_: readonly string[], cwd: string): Promise<void> {
  const child = spawn(command, arguments_, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const [exit, stdout, stderr] = await Promise.all([
    new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    }),
    collectTrusted(child.stdout, 1024 * 1024),
    collectTrusted(child.stderr, 1024 * 1024),
  ]);
  if (exit.code !== 0) {
    throw new Error(
      `trusted fixture command exited ${exit.code ?? exit.signal}: ${stderr || stdout || "no diagnostic"}`,
    );
  }
}

async function collectTrusted(source: AsyncIterable<Uint8Array>, maximum: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of source) {
    if (value.byteLength > maximum - total) throw new Error("trusted fixture output exceeded its bound");
    total += value.byteLength;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString("utf8").trim();
}

async function hostConfiguration(): Promise<{
  readonly delegatedCgroup: string;
  readonly bun: string;
}> {
  const requestedCgroup = process.env.AGENT_DELEGATED_CGROUP;
  if (requestedCgroup === undefined) {
    throw new Error("rootless proof host did not expose its delegated cgroup");
  }
  const delegatedCgroup = await realpath(requestedCgroup);
  if (delegatedCgroup !== requestedCgroup) {
    throw new Error("rootless proof host delegated cgroup must be canonical");
  }
  return { delegatedCgroup, bun: await realpath("/bin/bun") };
}

async function proofHostBunClosure(): Promise<{
  readonly runtimeSupport: Awaited<ReturnType<typeof observePrivateRuntimeSupport>>;
}> {
  const executablePath = await realpath("/bin/bun");
  const receiptsDirectory = process.env.AGENT_RUNTIME_RECEIPTS_DIR;
  if (receiptsDirectory === undefined) {
    throw new Error("rootless proof host did not expose retained runtime evidence");
  }
  const document = JSON.parse(
    await readFile(join(receiptsDirectory, "runtime-rootfs.json"), "utf8"),
  ) as {
    readonly closure?: readonly { readonly path?: unknown; readonly references?: unknown }[];
  };
  if (!Array.isArray(document.closure)) {
    throw new Error("rootless proof runtime evidence has no closure");
  }
  const closure = document.closure.map((entry) => {
    if (typeof entry.path !== "string" || !Array.isArray(entry.references) ||
        !entry.references.every((value) => typeof value === "string")) {
      throw new Error("rootless proof runtime evidence contains an invalid closure member");
    }
    return { path: entry.path, references: entry.references as string[] };
  });
  const root = closure.find(({ path }) =>
    executablePath === path || executablePath.startsWith(`${path}/`)
  );
  if (root === undefined) {
    throw new Error("rootless proof runtime evidence omits Bun");
  }
  const byPath = new Map(closure.map((entry) => [entry.path, entry]));
  const sources = new Set<string>();
  const visit = (path: string): void => {
    if (sources.has(path)) return;
    const entry = byPath.get(path);
    if (entry === undefined) {
      throw new Error(`rootless proof runtime evidence omits referenced path ${path}`);
    }
    sources.add(path);
    for (const reference of entry.references) visit(reference);
  };
  visit(root.path);
  const runtimeSupport = await observePrivateRuntimeSupport({
    supportId: "proof-bun",
    executablePath,
    closureSources: [...sources].sort(),
  });
  expect(requirePrivateRuntimeSupportObservation(runtimeSupport)).toBe(runtimeSupport);
  return { runtimeSupport };
}

function requireReviewerRequest(
  requests: readonly PrivateActivationRequest[],
  id: string,
): PrivateActivationRequest {
  const request = requests.find((candidate) =>
    candidate.target.kind === "binding" && candidate.target.id === id);
  if (request === undefined) throw new Error(`missing ${id} Binding activation request`);
  return request;
}

async function writeReviewerFlow(
  projectRoot: string,
  name: string,
  archive: string,
): Promise<void> {
  const flowRoot = join(projectRoot, `flows/${name}`);
  await mkdir(join(flowRoot, "vendor"), { recursive: true });
  await writeFile(
    join(flowRoot, "FLOW.md"),
    `---\nname: ${name}\ndescription: Review one value.\n---\n`,
  );
  await writeFile(join(flowRoot, "input.schema.json"), JSON.stringify({
    $schema: "https://flow.dev/schemas/schema-1.json",
    type: "object",
    properties: { submissionId: { type: "string" } },
    required: ["submissionId"],
    additionalProperties: false,
  }));
  await writeFile(join(flowRoot, "result.schema.json"), JSON.stringify({
    $schema: "https://flow.dev/schemas/schema-1.json",
    type: "object",
    properties: {
      outcome: { const: "done" },
      output: {
        type: "object",
        properties: {
          submissionId: { type: "string" },
          packageReadOnly: { const: true },
        },
        required: ["submissionId", "packageReadOnly"],
        additionalProperties: false,
      },
    },
    required: ["outcome", "output"],
    additionalProperties: false,
  }));
  await writeFile(join(flowRoot, "flow.ts"), [
    "#!/usr/bin/env bun",
    'import { serve } from "@flowmd/sdk";',
    "",
    "await serve(async (context) => {",
    "  let packageReadOnly = false;",
    '  try { await Bun.write("/package/.write-probe", "unsafe"); }',
    "  catch { packageReadOnly = true; }",
    '  if (!packageReadOnly) throw new Error("prepared package mount was writable");',
    "  return {",
    '    outcome: "done",',
    "    output: { submissionId: context.input.submissionId, packageReadOnly },",
    "  };",
    "});",
    "",
  ].join("\n"));
  await writeFile(join(flowRoot, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies: { "@flowmd/sdk": `file:./${ARCHIVE_MEMBER}` },
  }));
  await copyFile(archive, join(flowRoot, ARCHIVE_MEMBER));
}

async function jigCgroups(scope: string): Promise<string[]> {
  return (await readdir(scope)).filter((name) => name.startsWith("jig-run-")).sort();
}

async function rootlessTemporaryState(): Promise<readonly string[]> {
  return (await readdir(tmpdir())).filter((name) =>
    name.startsWith("jig-rootless-control-") || name.startsWith("jig-rootless-owner-")
  ).sort();
}

async function waitForRootlessTemporaryState(expected: readonly string[]): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() <= deadline) {
    const entries = await rootlessTemporaryState();
    if (JSON.stringify(entries) === JSON.stringify(expected)) return;
    await Bun.sleep(20);
  }
  throw new Error(
    `rootless native preparation changed temporary ownership state: ${JSON.stringify(await rootlessTemporaryState())}`,
  );
}

function testDigest(label: string): string {
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(label);
  return `sha256:${hash.digest("hex")}`;
}
