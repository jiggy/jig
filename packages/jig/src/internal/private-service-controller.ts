import { lstat, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import {
  allocatePrivateServiceMount,
  closePrivateServiceMount,
  listPrivateServiceMountRecoveryWork,
  recordPrivateServiceMountAcknowledged,
  recordPrivateServiceMountBacking,
  recordPrivateServiceMountFence,
  recordPrivateServiceMountGeneration,
  recordPrivateServiceMountPlan,
  recordPrivateServiceMountPrepared,
  recordPrivateServiceMountProvisional,
  recordPrivateServiceMountRelease,
  recordPrivateServiceMountSandbox,
  requirePrivateServiceMountFinalizationReady,
  type PrivateProjectCoordinator,
  type PrivateServiceMountAllocationResult,
  type PrivateServiceMountSnapshot,
} from "./activation-admission-store.js";
import {
  requirePrivateBunServiceRecipe,
  type PrivateBunServiceRecipe,
} from "./bun-service-recipe.js";
import { privateFileDigest } from "./identity.js";
import {
  cancelPrivateLinuxOwnerStateAllocation,
  planPrivateLinuxOwnerStateAllocation,
  releasePrivateLinuxOwnerState,
  requirePrivateLinuxCgroupBackend,
  type PrivateLinuxCgroupBackend,
  type PrivateLinuxConfirmedEnforcementReceipt,
  type PrivateLinuxComponentProcess,
  type PrivateLinuxSealedOwnerIdentity,
} from "./linux-cgroup-backend.js";
import { captureStoredPackage } from "./package-artifact-store.js";
import {
  allocatePrivatePackageMaterialization,
  disposePrivatePackageMaterializationLease,
  materializePrivatePackageLease,
  recoverPrivatePackageMaterializationAllocation,
  type PrivatePackageMaterializationLease,
} from "./package-materialization.js";
import type { PrivateServiceMountClassification } from "./private-service-state.js";
import {
  ServiceHostSession,
  type ServiceHostInvocation,
  type ServiceHostInvocationGate,
  type ServiceInvocationObservation,
  type ServiceHostTerminal,
} from "../service/session.js";

export interface PrivateBunServiceMount {
  readonly mountId: string;
  readonly bindingId: string;
  readonly generationId: string;
  invokeDetailed(
    request: ServiceHostInvocation,
    gate?: ServiceHostInvocationGate,
  ): Promise<ServiceInvocationObservation>;
  fence(): Promise<PrivateServiceMountSnapshot>;
  stop(): Promise<PrivateServiceMountSnapshot>;
}

interface MountedServiceOwner {
  readonly mountId: string;
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly recipe: PrivateBunServiceRecipe;
  readonly component: PrivateLinuxComponentProcess;
  readonly packageLease: PrivatePackageMaterializationLease;
  readonly session: ServiceHostSession;
  readonly snapshot: PrivateServiceMountSnapshot;
  readonly signal?: AbortSignal;
}

/**
 * Start the one exact private Bun Service recipe and expose only clean stop.
 * This is a concrete proof controller, not a Service registry or public SPI.
 */
export async function startPrivateBunServiceMount(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly recipe: PrivateBunServiceRecipe;
  readonly effectiveDeadlineUnixMs: number;
  readonly signal?: AbortSignal;
}): Promise<PrivateBunServiceMount> {
  const recipe = requirePrivateBunServiceRecipe(input.recipe);
  await input.coordinator.verify();
  const allocation = await allocatePrivateServiceMount({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    packageStoreRoot: input.packageStoreRoot,
    recipe,
    effectiveDeadlineUnixMs: input.effectiveDeadlineUnixMs,
  });
  if (!allocation.created) {
    throw new Error("Service Mount startup attempt was already allocated");
  }
  const initial = allocation.snapshot;
  const mountId = initial.allocation.mountId;
  let durable = initial;
  let packageLease: PrivatePackageMaterializationLease | undefined;
  let component: PrivateLinuxComponentProcess | undefined;
  let session: ServiceHostSession | undefined;
  try {
    const roots = await protectedServiceRoots(input.projectRoot);
    const hexadecimal = mountHex(mountId);
    const packageAllocation = await allocatePrivatePackageMaterialization({
      protectedParent: roots.materializations,
      name: `service-${hexadecimal}`,
      packageDigest: recipe.request.package.digest,
      ownerToken: initial.allocationDigest,
    });
    const ownerAllocation = await planPrivateLinuxOwnerStateAllocation({
      parent: roots.owners,
      name: `s-${hexadecimal.slice(0, 62)}`,
    });
    durable = await recordPrivateServiceMountPlan({
      ...mountStoreInput(input, mountId, recipe, allocation),
      packageAllocation,
      ownerAllocation,
    });

    const captured = await captureStoredPackage(input.packageStoreRoot, recipe.request.package);
    try {
      packageLease = await materializePrivatePackageLease(captured, packageAllocation);
    } finally {
      await captured.dispose();
    }
    durable = await recordPrivateServiceMountBacking({
      ...mountStoreInput(input, mountId, recipe, allocation),
      lease: packageLease.identity,
    });
    await revalidateRecipe(recipe);

    const sealed = await recipe.backend.seal({
      runId: `service-${hexadecimal.slice(0, 40)}`,
      limits: {
        ...recipe.resourceCeilings,
        deadlineUnixMs: input.effectiveDeadlineUnixMs,
        cancellationGraceMs: recipe.cancellationGraceMs,
      },
      readOnlyMounts: [
        ...recipe.runtimeSupport.closureSources.map((source) => ({ source, destination: source })),
        { source: packageLease.root, destination: recipe.packageDestination },
      ],
      privateProcessFilesystem: true,
      privateRuntimeDevices: true,
      command: [
        recipe.executablePath,
        ...recipe.bunPolicy,
        `${recipe.packageDestination}/${recipe.request.entrypoint.path}`,
      ],
    }, ownerAllocation);
    durable = await recordPrivateServiceMountSandbox({
      ...mountStoreInput(input, mountId, recipe, allocation),
      owner: sealed.identity,
    });

    const startup = startupCancellation(input.signal);
    try {
      component = await sealed.admit(startup.signal, async (prepared) => {
        durable = await recordPrivateServiceMountPrepared({
          ...mountStoreInput(input, mountId, recipe, allocation),
          prepared,
        });
      });
    } finally {
      startup.release();
    }

    session = new ServiceHostSession(component, {
      settings: recipe.request.settings,
      attachments: {},
      scratch: recipe.scratch,
      startupDeadlineUnixMs: input.effectiveDeadlineUnixMs,
      exports: recipe.expectedExports,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }, { cancellationGraceMs: recipe.cancellationGraceMs }, {
      beforeAcknowledgement: async (exports) => {
        durable = await recordPrivateServiceMountGeneration({
          ...mountStoreInput(input, mountId, recipe, allocation),
          exports,
        });
      },
      afterAcknowledgementWrite: async () => {
        durable = await recordPrivateServiceMountAcknowledged(
          mountStoreInput(input, mountId, recipe, allocation),
        );
      },
    });
    await session.start();
    if (durable.generation === undefined || durable.acknowledged === undefined) {
      throw new Error("Service readiness completed without durable generation acknowledgement");
    }
    return new ConcretePrivateBunServiceMount({
      mountId,
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      recipe,
      component,
      packageLease,
      session,
      snapshot: durable,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }, durable.allocation.bindingId, durable.generation.value.generationId);
  } catch (error) {
    let terminal: ServiceHostTerminal;
    if (session !== undefined) {
      terminal = await session.stop().catch(async () => await session!.result());
    } else {
      await component?.terminate();
      terminal = startupFailure(input.signal, input.effectiveDeadlineUnixMs, error);
    }
    const fenced = await fenceMount({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      backend: recipe.backend,
      mountId,
      terminal,
      classification: failedClassification(input.signal, input.effectiveDeadlineUnixMs),
      ...(component === undefined ? {} : { enforcement: component.enforcement }),
      snapshot: durable,
    });
    await finalizeMount({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      mountId,
      ...(packageLease === undefined ? {} : { packageLease }),
      snapshot: fenced,
    });
    throw error;
  }
}

/**
 * Fence unresolved current/older Mount attempts without releasing their
 * package or owner resources. Recovery receives no recipe and therefore
 * cannot restart or replace a Provider generation.
 */
export async function recoverPrivateServiceMountFences(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly backend: PrivateLinuxCgroupBackend;
}): Promise<readonly PrivateServiceMountSnapshot[]> {
  const backend = requirePrivateLinuxCgroupBackend(input.backend);
  const recovered: PrivateServiceMountSnapshot[] = [];
  for (const epoch of ["older", "current"] as const) {
    const work = await listPrivateServiceMountRecoveryWork({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      epoch,
    });
    for (const snapshot of work) {
      const classification = epoch === "older"
        ? "coordinator-loss"
        : snapshot.acknowledged === undefined && snapshot.sandbox === undefined
          ? "startup-cancelled"
          : "provider-loss";
      recovered.push(await fenceMount({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        backend,
        mountId: snapshot.allocation.mountId,
        classification,
        terminal: recoveryTerminal(classification),
        snapshot,
      }));
    }
  }
  return Object.freeze(recovered);
}

/**
 * Release and close already-fenced recovery work after its roots have closed
 * every generation lease. This never starts or replaces a Provider.
 */
export async function finalizeRecoveredPrivateServiceMounts(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
}): Promise<readonly PrivateServiceMountSnapshot[]> {
  const finalized: PrivateServiceMountSnapshot[] = [];
  for (const epoch of ["older", "current"] as const) {
    const work = await listPrivateServiceMountRecoveryWork({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      epoch,
    });
    for (const snapshot of work) {
      finalized.push(await finalizeMount({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        mountId: snapshot.allocation.mountId,
        snapshot,
      }));
    }
  }
  return Object.freeze(finalized);
}

class ConcretePrivateBunServiceMount implements PrivateBunServiceMount {
  readonly mountId: string;
  private fencing?: Promise<PrivateServiceMountSnapshot>;
  private finalization: Promise<PrivateServiceMountSnapshot> | undefined;
  private stopRequest?: Promise<ServiceHostTerminal>;
  private requestedStop = false;
  private lifetimeTimer?: ReturnType<typeof setTimeout>;
  private readonly cancel = (): void => {
    this.requestedStop = true;
    void this.fence().catch(() => undefined);
  };

  constructor(
    private readonly owner: MountedServiceOwner,
    readonly bindingId: string,
    readonly generationId: string,
  ) {
    this.mountId = owner.mountId;
    owner.signal?.addEventListener("abort", this.cancel, { once: true });
    if (owner.signal?.aborted) queueMicrotask(this.cancel);
    const cooperativeStopAt = owner.snapshot.allocation.effectiveDeadlineUnixMs -
      owner.recipe.cancellationGraceMs;
    const remaining = cooperativeStopAt - Date.now();
    if (remaining <= 0) queueMicrotask(this.cancel);
    else this.lifetimeTimer = setTimeout(this.cancel, remaining);
    const monitor = owner.session.result().then(async (terminal) => await this.fenceTerminal(terminal));
    void monitor.catch(() => undefined);
  }

  invokeDetailed(
    request: ServiceHostInvocation,
    gate?: ServiceHostInvocationGate,
  ): Promise<ServiceInvocationObservation> {
    return gate === undefined
      ? this.owner.session.invokeDetailed(request)
      : this.owner.session.invokeDetailed(request, gate);
  }

  fence(): Promise<PrivateServiceMountSnapshot> {
    this.requestedStop = true;
    if (this.fencing !== undefined) return this.fencing;
    this.stopRequest ??= this.owner.session.stop();
    const stopping = this.stopRequest.then(async (terminal) => await this.fenceTerminal(terminal));
    void stopping.catch(() => undefined);
    return stopping;
  }

  async stop(): Promise<PrivateServiceMountSnapshot> {
    this.requestedStop = true;
    const fenced = await this.fence();
    if (this.finalization !== undefined) return await this.finalization;
    const attempt = finalizeMount({
      coordinator: this.owner.coordinator,
      projectRoot: this.owner.projectRoot,
      mountId: this.mountId,
      packageLease: this.owner.packageLease,
      snapshot: fenced,
    });
    this.finalization = attempt;
    try {
      return await attempt;
    } catch (error) {
      if (this.finalization === attempt) this.finalization = undefined;
      throw error;
    }
  }

  private fenceTerminal(terminal: ServiceHostTerminal): Promise<PrivateServiceMountSnapshot> {
    this.fencing ??= fenceMount({
      coordinator: this.owner.coordinator,
      projectRoot: this.owner.projectRoot,
      backend: this.owner.recipe.backend,
      mountId: this.mountId,
      terminal,
      classification: terminal.status === "succeeded"
        ? this.requestedStop ? "host-lifetime" : "voluntary-exit"
        : "provider-loss",
      enforcement: this.owner.component.enforcement,
      snapshot: this.owner.snapshot,
    }).finally(() => {
      if (this.lifetimeTimer !== undefined) clearTimeout(this.lifetimeTimer);
      this.owner.signal?.removeEventListener("abort", this.cancel);
    });
    return this.fencing;
  }
}

async function fenceMount(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly backend: PrivateLinuxCgroupBackend;
  readonly mountId: string;
  readonly terminal: ServiceHostTerminal;
  readonly classification: PrivateServiceMountClassification;
  readonly enforcement?: Promise<PrivateLinuxConfirmedEnforcementReceipt>;
  readonly snapshot: PrivateServiceMountSnapshot;
}): Promise<PrivateServiceMountSnapshot> {
  let snapshot = input.snapshot;
  if (snapshot.allocation.mountId !== input.mountId) {
    throw new TypeError("Service Mount fencing evidence belongs to another Mount");
  }
  if (snapshot.provisional === undefined) {
    const classification = snapshot.sandbox === undefined &&
      input.classification === "provider-loss"
      ? "startup-cancelled"
      : input.classification;
    const terminal = classification === "startup-cancelled" &&
      input.terminal.status === "failed" && input.terminal.code !== "CANCELLED"
      ? failedTerminal("CANCELLED", `Service startup was stopped after failure: ${input.terminal.message}`)
      : input.terminal;
    snapshot = await recordPrivateServiceMountProvisional({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      mountId: input.mountId,
      classification,
      terminal,
    });
  }

  if (snapshot.plan !== undefined && snapshot.fence === undefined) {
    if (snapshot.sandbox === undefined) {
      const cancellation = await cancelPrivateLinuxOwnerStateAllocation(
        snapshot.plan.value.ownerAllocation,
      );
      snapshot = await recordPrivateServiceMountFence({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        mountId: input.mountId,
        proof: { kind: "allocation-cancelled", cancellation },
      });
    } else {
      const receipt = await confirmedEnforcement(
        input.backend,
        snapshot.sandbox.value.owner,
        input.enforcement,
      );
      snapshot = await recordPrivateServiceMountFence({
        coordinator: input.coordinator,
        projectRoot: input.projectRoot,
        mountId: input.mountId,
        proof: {
          kind: "enforcement-confirmed",
          sandboxDigest: snapshot.sandbox.digest,
          receipt,
        },
      });
    }
  }

  return snapshot;
}

async function finalizeMount(input: {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly mountId: string;
  readonly packageLease?: PrivatePackageMaterializationLease;
  readonly snapshot: PrivateServiceMountSnapshot;
}): Promise<PrivateServiceMountSnapshot> {
  if (input.snapshot.allocation.mountId !== input.mountId) {
    throw new TypeError("Service Mount finalization evidence belongs to another Mount");
  }
  let snapshot = await requirePrivateServiceMountFinalizationReady({
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    mountId: input.mountId,
  });
  if (snapshot.release === undefined) {
    let ownerRelease = null;
    if (snapshot.plan !== undefined) {
      if (snapshot.backing !== undefined) {
        await (input.packageLease?.dispose() ?? disposePrivatePackageMaterializationLease(
          snapshot.plan.value.packageAllocation.parent.path,
          snapshot.backing.value.lease,
        ));
      } else {
        const recovered = await recoverPrivatePackageMaterializationAllocation(
          snapshot.plan.value.packageAllocation.parent.path,
          snapshot.plan.value.packageAllocation,
        );
        if (recovered.state === "complete") await recovered.lease.dispose();
      }
      if (snapshot.fence === undefined) {
        throw new Error("planned Service Mount cannot release before a confirmed fence");
      }
      if (snapshot.fence.value.proof.kind === "allocation-cancelled") {
        ownerRelease = await releasePrivateLinuxOwnerState(
          snapshot.plan.value.ownerAllocation,
          snapshot.fence.value.proof.cancellation,
        );
      } else {
        ownerRelease = await releasePrivateLinuxOwnerState(
          snapshot.sandbox!.value.owner,
          snapshot.fence.value.proof.receipt,
        );
      }
    }
    snapshot = await recordPrivateServiceMountRelease({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      mountId: input.mountId,
      packageReleased: true,
      ownerRelease,
    });
  }
  if (snapshot.closure === undefined) {
    snapshot = await closePrivateServiceMount({
      coordinator: input.coordinator,
      projectRoot: input.projectRoot,
      mountId: input.mountId,
    });
  }
  return snapshot;
}

async function confirmedEnforcement(
  backend: PrivateLinuxCgroupBackend,
  owner: PrivateLinuxSealedOwnerIdentity,
  inMemory?: Promise<PrivateLinuxConfirmedEnforcementReceipt>,
): Promise<PrivateLinuxConfirmedEnforcementReceipt> {
  if (inMemory === undefined) return await backend.recoverFence(owner);
  try {
    return await inMemory;
  } catch (memoryError) {
    try {
      return await backend.recoverFence(owner);
    } catch (recoveryError) {
      throw new AggregateError(
        [memoryError, recoveryError],
        "Service Mount in-memory and recovered enforcement evidence both failed",
      );
    }
  }
}

function mountStoreInput(
  input: {
    readonly coordinator: PrivateProjectCoordinator;
    readonly projectRoot: string;
    readonly packageStoreRoot: string;
  },
  mountId: string,
  recipe: PrivateBunServiceRecipe,
  allocation: PrivateServiceMountAllocationResult,
): {
  readonly coordinator: PrivateProjectCoordinator;
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly mountId: string;
  readonly recipe: PrivateBunServiceRecipe;
  readonly allocation: PrivateServiceMountAllocationResult;
} {
  return {
    coordinator: input.coordinator,
    projectRoot: input.projectRoot,
    packageStoreRoot: input.packageStoreRoot,
    mountId,
    recipe,
    allocation,
  };
}

async function revalidateRecipe(recipe: PrivateBunServiceRecipe): Promise<void> {
  const [mechanism, executableDigest] = await Promise.all([
    recipe.backend.observeMechanism(),
    privateFileDigest(recipe.executablePath),
  ]);
  if (mechanism.digest !== recipe.mechanismDigest ||
      executableDigest !== recipe.runtimeSupport.executableDigest) {
    throw new Error("Bun Service recipe no longer matches retained host support");
  }
}

async function protectedServiceRoots(projectRoot: string): Promise<{
  readonly materializations: string;
  readonly owners: string;
}> {
  const state = await realpath(join(projectRoot, ".jig"));
  const materializations = join(state, "private-root-materializations");
  const owners = join(state, "private-root-linux-owners");
  await Promise.all([ensureProtectedDirectory(materializations), ensureProtectedDirectory(owners)]);
  return Object.freeze({ materializations, owners });
}

async function ensureProtectedDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700 }).catch((error) => {
    if (!hasCode(error, "EEXIST")) throw error;
  });
  const information = await lstat(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (!information.isDirectory() || information.isSymbolicLink() || information.uid !== uid ||
      (information.mode & 0o077) !== 0 || await realpath(path) !== path) {
    throw new Error("private Service work directory is not protected");
  }
}

function startupCancellation(signal?: AbortSignal): {
  readonly signal: AbortSignal;
  release(): void;
} {
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  return Object.freeze({
    signal: controller.signal,
    release(): void { signal?.removeEventListener("abort", abort); },
  });
}

function startupFailure(
  signal: AbortSignal | undefined,
  deadlineUnixMs: number,
  error: unknown,
): ServiceHostTerminal {
  if (signal?.aborted) return failedTerminal("CANCELLED", "Service Mount startup was cancelled");
  if (Date.now() >= deadlineUnixMs) {
    return failedTerminal("DEADLINE_EXCEEDED", "Service Mount readiness deadline elapsed");
  }
  return failedTerminal("EXECUTION_FAILED", boundedError(error));
}

function failedClassification(
  signal: AbortSignal | undefined,
  deadlineUnixMs: number,
): PrivateServiceMountClassification {
  if (signal?.aborted) return "startup-cancelled";
  if (Date.now() >= deadlineUnixMs) return "readiness-timeout";
  return "provider-loss";
}

function recoveryTerminal(classification: PrivateServiceMountClassification): ServiceHostTerminal {
  if (classification === "coordinator-loss") {
    return failedTerminal("UNCERTAIN", "coordinator ownership was lost before Mount closure");
  }
  if (classification === "startup-cancelled") {
    return failedTerminal("CANCELLED", "unstarted Service Mount attempt was cancelled during recovery");
  }
  return failedTerminal("UNCERTAIN", "Service Provider ownership was fenced during recovery");
}

function failedTerminal(
  code: Extract<ServiceHostTerminal, { readonly status: "failed" }>["code"],
  message: string,
): ServiceHostTerminal {
  return Object.freeze({
    status: "failed" as const,
    code,
    message,
    diagnostics: Object.freeze({ stderr: "", stderrBytes: 0, stderrTruncated: false }),
  });
}

function mountHex(mountId: string): string {
  const hexadecimal = mountId.startsWith("sha256:") ? mountId.slice(7) : "";
  if (!/^[0-9a-f]{64}$/.test(hexadecimal)) throw new TypeError("durable Service Mount ID is invalid");
  return hexadecimal;
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 4_096 ? message : `${message.slice(0, 4_093)}...`;
}

function hasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && (error as NodeJS.ErrnoException).code === code;
}
