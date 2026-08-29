import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalJson, type JsonValue } from "../src/json.js";
import { capturePackageDirectory } from "../src/package/capture.js";
import type { RunTargetIdentity } from "../src/project/package-project.js";
import {
  applyPrivateActivationReviewPlan,
  createPrivateActivationReviewPlan,
  initializePrivateActivationState,
  openPrivateProjectCoordinator,
  reacquirePrivateRootExecutionWork,
  submitPrivateRootRun,
  type PrivateProjectCoordinator,
  type PrivateReacquiredRootExecutionWork,
} from "../src/internal/activation-admission-store.js";
import {
  decodePrivateActivationCandidateV5,
  encodePrivateActivationCandidateV5,
  privateActivationCandidateDigestV5,
} from "../src/internal/activation-admission.js";
import { privateActivationTargetKey } from "../src/internal/activation-planning.js";
import { privateDomainDigest } from "../src/internal/identity.js";
import {
  publishCapturedPackage,
  type PackageArtifactRef,
} from "../src/internal/package-artifact-store.js";
import {
  decodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
} from "../src/internal/project-local-lock.js";
import {
  PrivateRootFlowCallResolutionError,
  resolvePrivateRootFlowCall,
} from "../src/internal/root-flow-call-resolution.js";

type Disposition =
  | { readonly state: "ready" }
  | {
      readonly state: "unavailable";
      readonly code?: "RUNTIME_UNAVAILABLE" | "SANDBOX_UNAVAILABLE";
    };

interface FlowSpec {
  readonly path: string;
  readonly flavor?: "open" | "strict" | "exhaustive" | "configured" | "attached";
  readonly disposition?: Disposition;
  readonly requestEntrypoint?: string;
}

interface BindingSpec {
  readonly id: string;
  readonly packagePath: string;
  readonly disposition?: Disposition;
  readonly settings?: Readonly<Record<string, JsonValue>>;
  readonly attachments?: Readonly<Record<string, {
    readonly source: string;
    readonly access: "read" | "read-write";
  }>>;
  readonly slots?: Readonly<Record<string, JsonValue>>;
}

interface FixtureInput {
  readonly source: "exact" | "candidates" | "project-run-targets";
  readonly flows: readonly FlowSpec[];
  readonly bindings?: readonly BindingSpec[];
  readonly slotTargets?: readonly RunTargetIdentity[];
}

interface Fixture {
  readonly base: string;
  readonly store: string;
  readonly work: PrivateReacquiredRootExecutionWork;
  readonly inertCandidate: ReturnType<typeof decodePrivateActivationCandidateV5>;
  readonly coordinator: PrivateProjectCoordinator;
  dispose(): Promise<void>;
}

describe("private root Flow-call resolution", () => {
  test("selects one exact direct Flow without preempting durable input admission", async () => {
    const fixture = await createFixture({
      source: "exact",
      flows: [{ path: "flows/strict", flavor: "strict" }],
      slotTargets: [{ kind: "flow", path: "flows/strict" }],
    });
    try {
      const selected = await resolvePrivateRootFlowCall({
        parent: fixture.work,
        packageStoreRoot: fixture.store,
        call: call({ accept: true }),
      });
      expect(selected).toMatchObject({
        state: "selected",
        source: "exact",
        selected: { request: { target: { kind: "flow", path: "flows/strict" } } },
        rejected: [],
      });
      expect(Object.isFrozen(selected)).toBeTrue();
      expect(Object.isFrozen(selected.rejected)).toBeTrue();

      await expect(resolvePrivateRootFlowCall({
        parent: fixture.work,
        packageStoreRoot: fixture.store,
        call: call({ accept: false }),
      })).resolves.toMatchObject({
        state: "selected",
        source: "exact",
        selected: { request: { target: { kind: "flow", path: "flows/strict" } } },
      });
    } finally { await fixture.dispose(); }
  });

  test("filters broad candidates with complete canonical rejection evidence", async () => {
    const fixture = await createFixture({
      source: "candidates",
      flows: [
        { path: "flows/z-compatible" },
        { path: "flows/incompatible", flavor: "strict" },
        {
          path: "flows/unavailable",
          disposition: { state: "unavailable", code: "SANDBOX_UNAVAILABLE" },
        },
      ],
      bindings: [{
        id: "configured",
        packagePath: "flows/z-compatible",
        slots: {
          nested: {
            kind: "flow-call",
            source: "exact",
            targets: [{ kind: "flow", path: "flows/z-compatible" }],
          },
        },
      }],
      slotTargets: [
        { kind: "flow", path: "flows/z-compatible" },
        { kind: "binding", id: "dispatcher" },
        { kind: "flow", path: "flows/unavailable" },
        { kind: "binding", id: "configured" },
        { kind: "flow", path: "flows/incompatible" },
      ],
    });
    try {
      const result = await resolvePrivateRootFlowCall({
        parent: fixture.work,
        packageStoreRoot: fixture.store,
        call: call({ accept: false }),
      });
      expect(result).toMatchObject({
        state: "selected",
        source: "candidates",
        selected: { request: { target: { kind: "flow", path: "flows/z-compatible" } } },
      });
      expect(result.rejected.map(({ target, code }) => ({ target, code }))).toEqual([
        { target: { kind: "binding", id: "configured" }, code: "TARGET_CONFIGURATION_UNSUPPORTED" },
        { target: { kind: "binding", id: "dispatcher" }, code: "ACTIVE_OWNER" },
        { target: { kind: "flow", path: "flows/incompatible" }, code: "INPUT_INCOMPATIBLE" },
        { target: { kind: "flow", path: "flows/unavailable" }, code: "TARGET_UNAVAILABLE" },
      ]);
      expect(result.rejected[2]).toMatchObject({
        diagnostic: { code: "INVALID_INPUT", keyword: "const" },
      });
      expect(result.rejected[3]).toMatchObject({
        unavailableCode: "SANDBOX_UNAVAILABLE",
        evidenceDigests: [digest("evidence:flows/unavailable")],
      });
    } finally { await fixture.dispose(); }
  });

  test("returns missing after broad incompatibility and ambiguity without truncating 257 survivors", async () => {
    const missing = await createFixture({
      source: "candidates",
      flows: [
        { path: "flows/strict-a", flavor: "strict" },
        { path: "flows/strict-b", flavor: "strict" },
      ],
    });
    try {
      const result = await resolvePrivateRootFlowCall({
        parent: missing.work,
        packageStoreRoot: missing.store,
        call: call({ accept: false }),
      });
      expect(result).toMatchObject({ state: "missing", source: "candidates" });
      expect(result.rejected).toHaveLength(2);
      expect(result.rejected.every(({ code }) => code === "INPUT_INCOMPATIBLE")).toBeTrue();
    } finally { await missing.dispose(); }

    const flows = Array.from({ length: 257 }, (_, index) => ({
      path: `flows/worker-${index.toString().padStart(3, "0")}`,
    }));
    const ambiguous = await createFixture({ source: "candidates", flows });
    try {
      const result = await resolvePrivateRootFlowCall({
        parent: ambiguous.work,
        packageStoreRoot: ambiguous.store,
        call: call(null),
      });
      expect(result.state).toBe("ambiguous");
      if (result.state !== "ambiguous") throw new Error("expected ambiguity");
      expect(result.survivors).toHaveLength(257);
      expect(result.rejected).toEqual([]);
      expect(result.survivors.map(({ request }) => privateActivationTargetKey(request.target)))
        .toEqual([...result.survivors]
          .map(({ request }) => privateActivationTargetKey(request.target))
          .sort(compareOrdinal));
    } finally { await ambiguous.dispose(); }
  }, 30_000);

  test("maps broad Schema/1 work exhaustion to RESOURCE_EXHAUSTED", async () => {
    const fixture = await createFixture({
      source: "candidates",
      flows: [
        { path: "flows/exhaustive", flavor: "exhaustive" },
        { path: "flows/strict", flavor: "strict" },
      ],
    });
    try {
      await expect(resolvePrivateRootFlowCall({
        parent: fixture.work,
        packageStoreRoot: fixture.store,
        call: call("x".repeat(1_000_001)),
      })).rejects.toMatchObject({
        kind: "unavailable",
        code: "RESOURCE_EXHAUSTED",
      });
    } finally { await fixture.dispose(); }
  }, 20_000);

  test("consumes the full 4096-target project expansion without sampling", async () => {
    const flows = Array.from({ length: 4_095 }, (_, index) => ({
      path: `flows/worker-${index.toString().padStart(4, "0")}`,
    }));
    const fixture = await createFixture({ source: "project-run-targets", flows });
    try {
      const result = await resolvePrivateRootFlowCall({
        parent: fixture.work,
        packageStoreRoot: fixture.store,
        call: call(null),
      });
      expect(result.state).toBe("ambiguous");
      if (result.state !== "ambiguous") throw new Error("expected ambiguity");
      expect(result.source).toBe("project-run-targets");
      expect(result.survivors).toHaveLength(4_095);
      expect(result.rejected).toEqual([{
        target: { kind: "binding", id: "dispatcher" },
        code: "ACTIVE_OWNER",
      }]);
      expect(result.survivors.length + result.rejected.length).toBe(4_096);
    } finally { await fixture.dispose(); }
  }, 120_000);

  test("stops a broad scan after operation cancellation", async () => {
    const flows = Array.from({ length: 257 }, (_, index) => ({
      path: `flows/worker-${index.toString().padStart(3, "0")}`,
    }));
    const fixture = await createFixture({ source: "project-run-targets", flows });
    try {
      const descriptorsBefore = (await readdir("/proc/self/fd")).length;
      const cancellation = new AbortController();
      const resolution = resolvePrivateRootFlowCall({
        parent: fixture.work,
        packageStoreRoot: fixture.store,
        call: call(null),
        signal: cancellation.signal,
      });
      setTimeout(() => cancellation.abort(), 0);
      await expect(resolution).rejects.toMatchObject({
        kind: "unavailable",
        code: "CANCELLED",
      });
      expect((await readdir("/proc/self/fd")).length).toBe(descriptorsBefore);

      const alreadyCancelled = new AbortController();
      alreadyCancelled.abort();
      await expect(resolvePrivateRootFlowCall({
        parent: fixture.work,
        packageStoreRoot: fixture.store,
        call: call(null),
        signal: alreadyCancelled.signal,
      })).rejects.toMatchObject({ kind: "unavailable", code: "CANCELLED" });

      const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
      const database = sqlite.Database.open(
        join(fixture.base, "project", ".jig", "private-activation-admission-v18.sqlite3"),
        sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
      );
      try {
        expect(database.query("SELECT count(*) AS count FROM root_flow_calls").get().count).toBe(0);
      } finally { database.close(true); }
    } finally { await fixture.dispose(); }
  }, 30_000);

  test("rejects non-store provenance and pinned candidate or Package/1 corruption", async () => {
    const fixture = await createFixture({
      source: "exact",
      flows: [{ path: "flows/worker" }],
      slotTargets: [{ kind: "flow", path: "flows/worker" }],
    });
    try {
      await expect(resolvePrivateRootFlowCall({
        parent: { ...fixture.work, candidate: fixture.inertCandidate },
        packageStoreRoot: fixture.store,
        call: call(null),
      })).rejects.toMatchObject({ code: "ROOT_FLOW_CALL_RESOLUTION_CORRUPT" });

      const worker = fixture.work.candidate.candidate.targets.find(({ request }) =>
        request.target.kind === "flow" && request.target.path === "flows/worker"
      )!;
      const hexadecimal = worker.request.package.digest.slice("sha256:".length);
      await unlink(join(
        fixture.store,
        "packages",
        "v1",
        "sha256",
        hexadecimal.slice(0, 2),
        `${hexadecimal.slice(2)}.pkg`,
      ));
      await expect(resolvePrivateRootFlowCall({
        parent: fixture.work,
        packageStoreRoot: fixture.store,
        call: call(null),
      })).rejects.toMatchObject({ code: "ROOT_FLOW_CALL_RESOLUTION_CORRUPT" });
    } finally { await fixture.dispose(); }

    const wrongEntrypoint = await createFixture({
      source: "exact",
      flows: [{ path: "flows/worker", requestEntrypoint: "flow.py" }],
      slotTargets: [{ kind: "flow", path: "flows/worker" }],
    });
    try {
      await expect(resolvePrivateRootFlowCall({
        parent: wrongEntrypoint.work,
        packageStoreRoot: wrongEntrypoint.store,
        call: call(null),
      })).rejects.toBeInstanceOf(PrivateRootFlowCallResolutionError);
    } finally { await wrongEntrypoint.dispose(); }
  }, 20_000);

  test("treats absent package-controlled slots as deterministic missing", async () => {
    const fixture = await createFixture({
      source: "exact",
      flows: [{ path: "flows/worker" }],
      slotTargets: [{ kind: "flow", path: "flows/worker" }],
    });
    try {
      await expect(resolvePrivateRootFlowCall({
        parent: fixture.work,
        packageStoreRoot: fixture.store,
        call: { ...call(null), slot: "missing" },
      })).resolves.toEqual({ state: "missing", rejected: [] });
    } finally { await fixture.dispose(); }
  });

  test("selects settings-configured Run Bindings with their retained child settings", async () => {
    const fixture = await createFixture({
      source: "exact",
      flows: [{ path: "flows/configured", flavor: "configured" }],
      bindings: [
        { id: "alpha", packagePath: "flows/configured", settings: { profile: "alpha" } },
        { id: "beta", packagePath: "flows/configured", settings: { profile: "beta" } },
      ],
      slotTargets: [{ kind: "binding", id: "alpha" }],
    });
    try {
      const selected = await resolvePrivateRootFlowCall({
        parent: fixture.work,
        packageStoreRoot: fixture.store,
        call: call({ accept: false }),
      });
      expect(selected).toMatchObject({
        state: "selected",
        selected: {
          request: {
            target: { kind: "binding", id: "alpha" },
            settings: { profile: "alpha" },
          },
        },
      });
      if (selected.state !== "selected") throw new Error("expected configured Binding");
      expect(selected.selected.request.settings).not.toEqual({ profile: "parent" });
    } finally { await fixture.dispose(); }

    const empty = await createFixture({
      source: "exact",
      flows: [{ path: "flows/open" }],
      bindings: [{ id: "empty", packagePath: "flows/open", settings: {} }],
      slotTargets: [{ kind: "binding", id: "empty" }],
    });
    try {
      await expect(resolvePrivateRootFlowCall({
        parent: empty.work,
        packageStoreRoot: empty.store,
        call: call(null),
      })).resolves.toMatchObject({
        state: "selected",
        selected: { request: { target: { kind: "binding", id: "empty" }, settings: {} } },
      });
    } finally { await empty.dispose(); }

    const ambiguous = await createFixture({
      source: "candidates",
      flows: [{ path: "flows/configured", flavor: "configured" }],
      bindings: [
        { id: "alpha", packagePath: "flows/configured", settings: { profile: "alpha" } },
        { id: "beta", packagePath: "flows/configured", settings: { profile: "beta" } },
      ],
      slotTargets: [
        { kind: "binding", id: "beta" },
        { kind: "binding", id: "alpha" },
      ],
    });
    try {
      const result = await resolvePrivateRootFlowCall({
        parent: ambiguous.work,
        packageStoreRoot: ambiguous.store,
        call: call(null),
      });
      expect(result).toMatchObject({
        state: "ambiguous",
        survivors: [
          { request: { target: { kind: "binding", id: "alpha" }, settings: { profile: "alpha" } } },
          { request: { target: { kind: "binding", id: "beta" }, settings: { profile: "beta" } } },
        ],
      });
    } finally { await ambiguous.dispose(); }
  }, 20_000);

  test("rejects configured Binding authority shapes outside the settings-only checkpoint", async () => {
    const fixture = await createFixture({
      source: "candidates",
      flows: [
        { path: "flows/open" },
        { path: "flows/attached", flavor: "attached" },
      ],
      bindings: [
        {
          id: "with-child-slot",
          packagePath: "flows/open",
          slots: {
            nested: {
              kind: "flow-call",
              source: "exact",
              targets: [{ kind: "flow", path: "flows/open" }],
            },
          },
        },
        {
          id: "declares-attachment",
          packagePath: "flows/attached",
          attachments: { source: { source: "workspace", access: "read" } },
        },
      ],
      slotTargets: [
        { kind: "binding", id: "with-child-slot" },
        { kind: "binding", id: "declares-attachment" },
      ],
    });
    try {
      const result = await resolvePrivateRootFlowCall({
        parent: fixture.work,
        packageStoreRoot: fixture.store,
        call: call(null),
      });
      expect(result).toMatchObject({ state: "missing", source: "candidates" });
      expect(result.rejected.map(({ target, code }) => ({ target, code }))).toEqual([
        { target: { kind: "binding", id: "declares-attachment" }, code: "TARGET_CONFIGURATION_UNSUPPORTED" },
        { target: { kind: "binding", id: "with-child-slot" }, code: "TARGET_CONFIGURATION_UNSUPPORTED" },
      ]);
    } finally { await fixture.dispose(); }
  });

  test("treats invalid or undeclared retained Binding settings as protected corruption", async () => {
    for (const [flavor, settings] of [
      ["configured", { profile: "gamma" }],
      ["open", { profile: "alpha" }],
    ] as const) {
      const fixture = await createFixture({
        source: "exact",
        flows: [{ path: "flows/child", flavor }],
        bindings: [{ id: "configured", packagePath: "flows/child", settings }],
        slotTargets: [{ kind: "binding", id: "configured" }],
      });
      try {
        await expect(resolvePrivateRootFlowCall({
          parent: fixture.work,
          packageStoreRoot: fixture.store,
          call: call(null),
        })).rejects.toMatchObject({ code: "ROOT_FLOW_CALL_RESOLUTION_CORRUPT" });
      } finally { await fixture.dispose(); }
    }
  });
});

async function createFixture(input: FixtureInput): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "jig-flow-call-resolution-"));
  const root = join(base, "project");
  const store = join(base, "store");
  let coordinator: PrivateProjectCoordinator | undefined;
  try {
    await Promise.all([mkdir(root, { mode: 0o700 }), mkdir(store, { mode: 0o700 })]);
    const packages = await retainFixturePackages(base, store);
    const packageLock: Record<string, JsonValue> = {
      "flows/dispatcher": lockPackage(packages.parent, false),
    };
    for (const flow of input.flows) {
      const flavor = flow.flavor ?? "open";
      packageLock[flow.path] = lockPackage(
        packages[flavor],
        flavor === "open" || flavor === "strict" || flavor === "exhaustive",
        flavor,
      );
    }
    const bindings: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const binding of input.bindings ?? []) {
      bindings[binding.id] = {
        packagePath: binding.packagePath,
        attachments: binding.attachments ?? {},
        slots: binding.slots ?? {},
      };
    }
    const structuralTargets: RunTargetIdentity[] = [
      { kind: "binding", id: "dispatcher" },
      ...(input.bindings ?? []).map(({ id }) => ({ kind: "binding" as const, id })),
      ...input.flows.flatMap(({ path, flavor = "open" }) =>
        flavor === "open" || flavor === "strict" || flavor === "exhaustive"
          ? [{ kind: "flow" as const, path }]
          : []
      ),
    ].sort(compareTargets);
    const slotTargets = [...(input.slotTargets ?? (
      input.source === "project-run-targets"
        ? structuralTargets
        : input.flows.map(({ path }) => ({ kind: "flow" as const, path }))
    ))].sort(compareTargets);
    bindings.dispatcher = {
      packagePath: "flows/dispatcher",
      attachments: {},
      slots: {
        work: {
          kind: "flow-call",
          source: input.source,
          targets: slotTargets,
        },
      },
    };

    const lockBytes = json1({
      kind: "private-package-project-lock/3",
      packages: packageLock,
      bindings,
      journalPublishers: {},
      hooks: {},
    });
    const lock = decodePrivateProjectLocalLock(lockBytes);
    const rootInformation = await stat(root, { bigint: true });
    const targets = structuralTargets.map((target) => {
      if (target.kind === "binding" && target.id === "dispatcher") {
        return candidateTarget(activationRequest({
          target,
          mode: "run",
          packagePath: "flows/dispatcher",
          package: packages.parent,
          entrypoint: { path: "flow.ts", suffix: "ts" },
          settings: { profile: "parent" },
          attachments: {},
          slots: {
            work: { kind: "flow-call", source: input.source, targets: slotTargets },
          },
        }), { state: "ready" });
      }
      if (target.kind === "binding") {
        const spec = input.bindings!.find(({ id }) => id === target.id)!;
        const flow = input.flows.find(({ path }) => path === spec.packagePath)!;
        return candidateTarget(activationRequest({
          target,
          mode: "run",
          packagePath: spec.packagePath,
          package: packages[flow.flavor ?? "open"],
          entrypoint: { path: "flow.ts", suffix: "ts" },
          settings: spec.settings ?? {},
          attachments: spec.attachments ?? {},
          slots: spec.slots ?? {},
        }), spec.disposition ?? { state: "ready" });
      }
      const flow = input.flows.find(({ path }) => path === target.path)!;
      return candidateTarget(activationRequest({
        target,
        mode: "run",
        packagePath: flow.path,
        package: packages[flow.flavor ?? "open"],
        entrypoint: { path: flow.requestEntrypoint ?? "flow.ts", suffix: (flow.requestEntrypoint ?? "flow.ts").slice(5) },
        settings: {},
        attachments: {},
        slots: {},
      }), flow.disposition ?? { state: "ready" });
    });
    const observedSemanticDigest = digest("semantic");
    const planningObservationDigest = digest("planning");
    const candidateValue = {
      kind: "private-activation-candidate/5",
      projectRoot: {
        device: rootInformation.dev.toString(),
        inode: rootInformation.ino.toString(),
      },
      captureDigest: digest("capture"),
      observedSemanticDigest,
      activationMeaningDigest: privateDomainDigest(
        "JIG-Private-Activation-Meaning/1",
        { observedSemanticDigest, targets } as unknown as JsonValue,
      ),
      resolutionInputDigest: privateDomainDigest(
        "JIG-Package-Project-Resolution-Input/1",
        { captureDigest: digest("capture"), planningObservationDigest },
      ),
      planningObservationDigest,
      lockDigest: privateProjectLocalLockDigest(lock),
      declarationArtifact: {
        kind: "author-closure/1",
        closureDigest: digest("declaration"),
        package: packages.parent,
      },
      targets,
    } as unknown as JsonValue;
    const inertCandidate = decodePrivateActivationCandidateV5({
      candidate: json1(candidateValue),
      lock: lockBytes,
    });

    await initializePrivateActivationState({ projectRoot: root });
    seedCandidate(root, inertCandidate);
    const planned = await createPrivateActivationReviewPlan({
      projectRoot: root,
      packageStoreRoot: store,
      lockMode: "update",
    });
    if (planned.state !== "applicable") throw new Error("fixture Candidate did not produce a Plan");
    await applyPrivateActivationReviewPlan({
      projectRoot: root,
      packageStoreRoot: store,
      planDigest: planned.planDigest,
    });
    coordinator = await openPrivateProjectCoordinator({ projectRoot: root });
    const submission = await submitPrivateRootRun({
      coordinator,
      projectRoot: root,
      packageStoreRoot: store,
      submissionId: "root",
      target: { kind: "binding", id: "dispatcher" },
      input: null,
      deadlineUnixMs: Date.now() + 60_000,
    });
    if (submission.launch === undefined) throw new Error("fixture root did not receive launch authority");
    const work = await reacquirePrivateRootExecutionWork({
      coordinator,
      projectRoot: root,
      packageStoreRoot: store,
      runId: submission.run.runId,
    });
    const ownedCoordinator = coordinator;
    return Object.freeze({
      base,
      store,
      work,
      inertCandidate,
      coordinator: ownedCoordinator,
      async dispose(): Promise<void> {
        await ownedCoordinator.dispose();
        await rm(base, { recursive: true, force: true });
      },
    });
  } catch (error) {
    await coordinator?.dispose().catch(() => undefined);
    await rm(base, { recursive: true, force: true });
    throw error;
  }
}

async function retainFixturePackages(
  base: string,
  store: string,
): Promise<Record<
  "parent" | "open" | "strict" | "exhaustive" | "configured" | "attached",
  PackageArtifactRef
>> {
  const parent = join(base, "parent-package");
  const open = join(base, "open-package");
  const strict = join(base, "strict-package");
  const exhaustive = join(base, "exhaustive-package");
  const configured = join(base, "configured-package");
  const attached = join(base, "attached-package");
  await Promise.all([
    mkdir(parent), mkdir(open), mkdir(strict), mkdir(exhaustive), mkdir(configured), mkdir(attached),
  ]);
  await Promise.all([
    writePackage(parent, "dispatcher", {
      "settings.schema.json": schema({
        type: "object",
        properties: { profile: { const: "parent" } },
        required: ["profile"],
        additionalProperties: false,
      }),
    }),
    writePackage(open, "open", {}),
    writePackage(strict, "strict", {
      "input.schema.json": schema({
        type: "object",
        properties: { accept: { const: true } },
        required: ["accept"],
        additionalProperties: false,
      }),
    }),
    writePackage(exhaustive, "exhaustive", {
      "input.schema.json": schema({
        type: "string",
        maxLength: 2_000_000,
      }),
    }),
    writePackage(configured, "configured", {
      "settings.schema.json": schema({
        type: "object",
        properties: { profile: { enum: ["alpha", "beta"] } },
        required: ["profile"],
        additionalProperties: false,
      }),
    }),
    writePackage(attached, "attached", {}, ["attachments:", "  source: read"]),
  ]);
  const [
    parentPackage,
    openPackage,
    strictPackage,
    exhaustivePackage,
    configuredPackage,
    attachedPackage,
  ] = await Promise.all([
    retainPackage(store, parent),
    retainPackage(store, open),
    retainPackage(store, strict),
    retainPackage(store, exhaustive),
    retainPackage(store, configured),
    retainPackage(store, attached),
  ]);
  return {
    parent: parentPackage,
    open: openPackage,
    strict: strictPackage,
    exhaustive: exhaustivePackage,
    configured: configuredPackage,
    attached: attachedPackage,
  };
}

async function writePackage(
  root: string,
  name: string,
  files: Readonly<Record<string, string>>,
  extraMetadata: readonly string[] = [],
): Promise<void> {
  await Promise.all([
    writeFile(join(root, "FLOW.md"), [
      "---",
      `name: ${name}`,
      "description: Resolution fixture.",
      ...extraMetadata,
      "---",
      "",
    ].join("\n")),
    writeFile(join(root, "flow.ts"), "export {};\n"),
    ...Object.entries(files).map(async ([path, bytes]) => await writeFile(join(root, path), bytes)),
  ]);
}

async function retainPackage(store: string, source: string): Promise<PackageArtifactRef> {
  const captured = await capturePackageDirectory(source);
  try { return await publishCapturedPackage(store, captured); }
  finally { await captured.dispose(); }
}

function seedCandidate(
  root: string,
  candidate: ReturnType<typeof decodePrivateActivationCandidateV5>,
): void {
  const sqlite = createRequire(import.meta.url)("bun:sqlite") as any;
  const database = sqlite.Database.open(
    join(root, ".jig", "private-activation-admission-v18.sqlite3"),
    sqlite.constants.SQLITE_OPEN_READWRITE | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
  );
  const encoded = encodePrivateActivationCandidateV5(candidate);
  try {
    database.exec("BEGIN IMMEDIATE");
    database.query(
      "INSERT INTO candidates(revision, candidate_digest, candidate_bytes, lock_bytes) VALUES (1, ?1, ?2, ?3)",
    ).run(privateActivationCandidateDigestV5(candidate), encoded.candidate, encoded.lock);
    database.query("UPDATE candidate_head SET revision = 1 WHERE singleton = 1").run();
    database.exec("COMMIT");
  } finally { database.close(true); }
}

function candidateTarget(request: Record<string, unknown>, disposition: Disposition): JsonValue {
  return {
    request,
    disposition: disposition.state === "ready"
      ? {
          state: "ready",
          recipeDigest: digest(`recipe:${privateActivationTargetKey(request.target as RunTargetIdentity)}`),
          observationDigest: digest(`observation:${privateActivationTargetKey(request.target as RunTargetIdentity)}`),
        }
      : {
          state: "unavailable",
          code: disposition.code ?? "RUNTIME_UNAVAILABLE",
          evidenceDigests: [digest(`evidence:${targetLabel(request.target as RunTargetIdentity)}`)],
        },
  } as unknown as JsonValue;
}

function activationRequest(content: Record<string, unknown>): Record<string, unknown> {
  const request = { kind: "activation-request/2", ...content };
  return {
    ...request,
    digest: privateDomainDigest("JIG-Activation-Request/2", request as unknown as JsonValue),
  };
}

function lockPackage(
  reference: PackageArtifactRef,
  directRun: boolean,
  flavor?: FlowSpec["flavor"],
): JsonValue {
  return {
    digest: reference.digest,
    mode: "run",
    directRun,
    attachments: flavor === "attached" ? { source: "read" } : {},
    uses: {},
    provides: {},
  };
}

function call(input: JsonValue): { operationId: string; slot: string; input: JsonValue } {
  return { operationId: "work-1", slot: "work", input };
}

function schema(content: Record<string, unknown>): string {
  return JSON.stringify({ $schema: "https://flow.dev/schemas/schema-1.json", ...content });
}

function json1(value: JsonValue): Uint8Array {
  const bytes = canonicalJson(value);
  const result = new Uint8Array(bytes.byteLength + 1);
  result.set(bytes);
  result[bytes.byteLength] = 0x0a;
  return result;
}

function digest(label: string): string {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function targetLabel(target: RunTargetIdentity): string {
  return target.kind === "flow" ? target.path : target.id;
}

function compareTargets(left: RunTargetIdentity, right: RunTargetIdentity): number {
  return compareOrdinal(privateActivationTargetKey(left), privateActivationTargetKey(right));
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
