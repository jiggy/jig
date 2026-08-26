import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath } from "node:fs/promises";

import { invalid, unavailable } from "../diagnostics.js";
import {
  PrivateLinuxCgroupBackend,
  type PrivateLinuxReadOnlyMount,
} from "../internal/linux-cgroup-backend.js";
import {
  requirePrivateRuntimeSupportObservation,
  type PrivateRuntimeSupportObservation,
} from "../internal/agent-sandbox-runtime-support.js";
import { materializeCapturedPackage } from "../internal/package-materialization.js";
import {
  canonicalJson,
  decodeJson1,
  JSON_1_LIMITS,
  Json1Error,
  type JsonObject,
  type JsonValue,
} from "../json.js";
import { compileEmbeddedSchema } from "../schema/index.js";
import { capturePackageDirectory } from "../package/capture.js";
import {
  type JigDefinition,
  normalizeJigDefinition,
  normalizePackageBindingDefinition,
  type PackageBindingDefinition,
} from "./author.js";
import {
  isCapturedAuthorClosure,
  type CapturedAuthorClosure,
} from "./author-module.js";

const PROTOCOL = "jig-author-evaluator/1";
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_STDOUT_BYTES = JSON_1_LIMITS.bytes + 16 * 1024;
const EVALUATION_CODES = new Set([
  "PROJECT_AUTHORING_VALUE",
  "PROJECT_DEFAULT_EXPORT",
  "PROJECT_EVALUATION_FAILED",
  "PROJECT_EVALUATION_LIMIT",
  "PROJECT_EVALUATOR_COMPILE",
  "PROJECT_EVALUATOR_IMPORT",
  "PROJECT_EVALUATOR_PROTOCOL",
]);
const decoder = new TextDecoder("utf-8", { fatal: true });
let evaluationSequence = 0;

export interface PrivateAuthorEvaluatorOptions {
  readonly backend: PrivateLinuxCgroupBackend;
  readonly bunPath: string;
  readonly runtimeMounts: readonly PrivateLinuxReadOnlyMount[];
  /** Private host-retained runtime evidence; not a Runtime Adapter interface. */
  readonly runtimeSupport: PrivateRuntimeSupportObservation;
  readonly jigDistributionPath: string;
}

export interface EvaluatorProfile {
  readonly protocol: typeof PROTOCOL;
  readonly evaluatorDigest: string;
  readonly authoringSdkDigest: string;
  readonly schemaDigest: string;
  readonly evaluatorPackageDigest: string;
  readonly runtimeExecutable: string;
  readonly runtimeDigest: string;
  readonly runtimeMounts: readonly string[];
  readonly runtimeSupport: {
    readonly kind: "runtime-support-observation/1";
    readonly digest: string;
    readonly leaseId: string;
    readonly receiptDigest: string;
  };
  readonly buildOptions: "bun-cjs-closed-static-closure/1";
  readonly sandbox: {
    readonly kind: "linux-cgroup-v2-bubblewrap/1";
    readonly helperDigest: string;
    readonly bubblewrapPath: string;
    readonly bubblewrapDigest: string;
    readonly coordinatorRuntimePath: string;
    readonly coordinatorRuntimeDigest: string;
    readonly trustedLauncherPath: string;
    readonly trustedLauncherDigest: string;
    readonly payloadUid: number;
    readonly payloadGid: number;
    readonly limits: ReturnType<typeof evaluatorLimits>;
    readonly rootProcessMappings: true;
    readonly entropyDevice: true;
  };
}

export interface EvaluatedAuthorDeclaration<
  Value extends JigDefinition | PackageBindingDefinition = JigDefinition | PackageBindingDefinition,
> {
  readonly expected: "project" | "binding";
  readonly source: {
    readonly entryProjectPath: string;
    readonly bytes: number;
    readonly digest: string;
    readonly modules: readonly {
      readonly projectPath: string;
      readonly bytes: number;
      readonly digest: string;
      readonly imports: readonly {
        readonly specifier: string;
        readonly projectPath: string;
      }[];
    }[];
  };
  readonly profile: EvaluatorProfile;
  readonly outputDigest: string;
  readonly value: Value;
  readonly enforcement: {
    readonly cgroup: {
      readonly parentCgroup: string;
      readonly runCgroup: string;
      readonly payloadPid: number;
    };
    readonly terminal: {
      readonly reason: "payload_exit";
      readonly exitCode: 0;
      readonly signal: null;
      readonly fenced: true;
    };
    readonly cpuStat: Readonly<Record<string, number>>;
    readonly memoryEvents: Readonly<Record<string, number>>;
    readonly pidsEvents: Readonly<Record<string, number>>;
  };
}

/** Evaluate one entry from an authentic captured closure in the enforced envelope. */
export async function evaluateAuthorClosure(
  options: PrivateAuthorEvaluatorOptions,
  captured: CapturedAuthorClosure,
  entryProjectPath: string,
  expected: "project" | "binding",
  signal?: AbortSignal,
): Promise<EvaluatedAuthorDeclaration> {
  if (!isCapturedAuthorClosure(captured)) {
    invalid("PROJECT_AUTHOR_CAPTURE", "author closure was not produced by the capture boundary");
  }
  if (!captured.entries.includes(entryProjectPath)) {
    invalid("PROJECT_AUTHOR_CAPTURE", "selected entry is outside the author closure", entryProjectPath);
  }
  const distribution = await realpath(options.jigDistributionPath);
  const bunPath = await realpath(options.bunPath);
  const runtimeSupport = requirePrivateRuntimeSupportObservation(options.runtimeSupport);
  const runtimeMounts = await checkedRuntimeMounts(
    options.runtimeMounts,
    bunPath,
    runtimeSupport,
  );
  const toolchain = await capturePackageDirectory(distribution).catch((error) => unavailable(
    "PROJECT_EVALUATOR_UNAVAILABLE",
    `cannot capture evaluator toolchain: ${errorText(error)}`,
  ));
  const materialized = await materializeCapturedPackage(toolchain).catch(async (error) => {
    try {
      await toolchain.dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "evaluator materialization failed and captured toolchain cleanup failed",
      );
    }
    unavailable("PROJECT_EVALUATOR_UNAVAILABLE", `cannot materialize evaluator toolchain: ${errorText(error)}`);
  });

  let evaluationFailure: unknown;
  try {
    const [workerBytes, helperBytes, sdkBytes, schemaBytes, runtimeDigest] = await Promise.all([
      toolchain.read("internal/project-evaluator-worker.js"),
      toolchain.read("internal/linux-cgroup-helper.js"),
      toolchain.read("internal/project-evaluator-sdk.bundle.js"),
      toolchain.read("project-authoring-1.schema.json"),
      digestFile(bunPath),
    ]).catch((error) => unavailable(
      "PROJECT_EVALUATOR_UNAVAILABLE",
      `cannot seal evaluator toolchain: ${errorText(error)}`,
    ));
    const profileBase = Object.freeze({
      protocol: PROTOCOL,
      evaluatorDigest: digestBytes(workerBytes),
      authoringSdkDigest: digestBytes(sdkBytes),
      schemaDigest: digestBytes(schemaBytes),
      evaluatorPackageDigest: toolchain.digest,
      runtimeExecutable: bunPath,
      runtimeDigest,
      runtimeMounts: Object.freeze(runtimeMounts.map(({ source }) => source)),
      runtimeSupport: Object.freeze({
        kind: runtimeSupport.kind,
        digest: runtimeSupport.digest,
        leaseId: runtimeSupport.lease.id,
        receiptDigest: runtimeSupport.lease.receiptDigest,
      }),
      buildOptions: "bun-cjs-closed-static-closure/1" as const,
    });
    if (bunPath !== runtimeSupport.executablePath ||
        runtimeDigest !== runtimeSupport.executableDigest) {
      unavailable(
        "PROJECT_EVALUATOR_UNAVAILABLE",
        "selected Bun executable no longer matches its retained runtime support",
      );
    }
    const modules = captured.modules.map((module) => ({
      projectPath: module.projectPath,
      source: decoder.decode(captured.read(module.projectPath)),
      imports: module.imports.map(({ specifier, projectPath }) => ({ specifier, projectPath })),
    }));
    const request = canonicalJson({
      protocol: PROTOCOL,
      entryProjectPath,
      modules,
    });
    const runId = `config-${process.pid.toString(36)}-${(++evaluationSequence).toString(36)}`;
    const component = await options.backend.launch({
      runId,
      limits: evaluatorLimits(),
      readOnlyMounts: [
        ...runtimeMounts,
        { source: materialized.root, destination: "/jig-evaluator" },
      ],
      rootProcessMappings: true,
      entropyDevice: true,
      trustedHelperPath: `${materialized.root}/internal/linux-cgroup-helper.js`,
      command: [bunPath, "/jig-evaluator/internal/project-evaluator-worker.js"],
    }, signal).catch((error) => unavailable(
      "PROJECT_EVALUATOR_UNAVAILABLE",
      `cannot launch evaluator envelope: ${errorText(error)}`,
    ));
    if (!component.envelope.rootProcessMappings || !component.envelope.entropyDevice ||
        component.envelope.trustedHelperDigest !== digestBytes(helperBytes) ||
        component.envelope.trustedCoordinatorBunDigest !== runtimeDigest) {
      await component.terminate().catch(() => undefined);
      const completion = await component.completion.catch((error) => unavailable(
        "PROJECT_EVALUATOR_UNAVAILABLE",
        `evaluator envelope lost while rejecting its predicates: ${errorText(error)}`,
      ));
      if (!completion.fenced || completion.cleanupError !== undefined) {
        unavailable(
          "PROJECT_EVALUATOR_UNAVAILABLE",
          "evaluator envelope predicates were absent and cleanup was not proven",
        );
      }
      unavailable(
        "PROJECT_EVALUATOR_UNAVAILABLE",
        "evaluator envelope did not preserve its sealed helper, runtime, or root-only predicates",
      );
    }
    const profile: EvaluatorProfile = Object.freeze({
      ...profileBase,
      sandbox: Object.freeze({
        kind: component.envelope.kind,
        helperDigest: component.envelope.trustedHelperDigest,
        bubblewrapPath: component.envelope.trustedBubblewrapPath,
        bubblewrapDigest: component.envelope.trustedBubblewrapDigest,
        coordinatorRuntimePath: component.envelope.trustedCoordinatorBunPath,
        coordinatorRuntimeDigest: component.envelope.trustedCoordinatorBunDigest,
        trustedLauncherPath: component.envelope.trustedLauncherPath,
        trustedLauncherDigest: component.envelope.trustedLauncherDigest,
        payloadUid: component.envelope.payloadUid,
        payloadGid: component.envelope.payloadGid,
        limits: component.envelope.limits as ReturnType<typeof evaluatorLimits>,
        rootProcessMappings: component.envelope.rootProcessMappings,
        entropyDevice: component.envelope.entropyDevice,
      }),
    });

    const stdout = collectBounded(component.stdout, MAX_STDOUT_BYTES, component.terminate);
    const stderr = collectBounded(component.stderr, MAX_STDERR_BYTES, component.terminate);
    try {
      await component.write(request);
      await component.closeInput();
      const [output, diagnostics, exit, evidence, terminationReason] = await Promise.all([
        stdout,
        stderr,
        component.completion,
        component.evidence,
        component.terminationReason,
      ]);
      if (exit.cleanupError !== undefined || !exit.fenced) {
        unavailable(
          "PROJECT_EVALUATOR_UNAVAILABLE",
          `evaluator cleanup was not proven: ${exit.cleanupError ?? "not fenced"}`,
          entryProjectPath,
        );
      }
      if ((evidence.memoryEvents.max ?? 0) > 0 || (evidence.pidsEvents.max ?? 0) > 0) {
        invalid("PROJECT_EVALUATION_LIMIT", "evaluator reached a hard resource limit", entryProjectPath);
      }
      if (terminationReason === "deadline") {
        invalid("PROJECT_EVALUATION_LIMIT", "evaluator reached its hard wall deadline", entryProjectPath);
      }
      if (terminationReason !== "payload_exit") {
        unavailable(
          "PROJECT_EVALUATOR_UNAVAILABLE",
          `evaluator ended for an unexpected reason: ${terminationReason}`,
          entryProjectPath,
        );
      }
      if (exit.exitCode !== 0 || exit.signal !== null) {
        invalid(
          "PROJECT_EVALUATION_FAILED",
          `evaluator exited ${exit.exitCode ?? exit.signal}${diagnostics.length === 0 ? "" : `: ${safeText(diagnostics)}`}`,
          entryProjectPath,
        );
      }
      let response: JsonValue;
      try {
        response = decodeJson1(output);
      } catch (error) {
        if (error instanceof Json1Error) {
          unavailable("PROJECT_EVALUATOR_PROTOCOL", error.message, entryProjectPath);
        }
        throw error;
      }
      const value = checkedResponse(response, entryProjectPath);
      contextualAuthorSchema(schemaBytes, expected).validate(
        value,
        "PROJECT_AUTHORING_SCHEMA_INVALID",
      );
      let normalized: JigDefinition | PackageBindingDefinition;
      try {
        normalized = expected === "project"
          ? normalizeJigDefinition(value)
          : normalizePackageBindingDefinition(value);
      } catch (error) {
        invalid(
          "PROJECT_DECLARATION_INVALID",
          errorText(error),
          entryProjectPath,
        );
      }
      const outputBytes = canonicalJson(normalized as unknown as JsonValue);
      return Object.freeze({
        expected,
        source: Object.freeze({
          entryProjectPath,
          bytes: captured.sourceBytes,
          digest: captured.closureDigest,
          modules: Object.freeze(captured.modules.map((module) => Object.freeze({
            projectPath: module.projectPath,
            bytes: module.sourceBytes,
            digest: module.sourceDigest,
            imports: Object.freeze(module.imports.map((edge) => Object.freeze({ ...edge }))),
          }))),
        }),
        profile,
        outputDigest: digestBytes(outputBytes),
        value: normalized,
        enforcement: Object.freeze({
          cgroup: Object.freeze({ ...component.cgroup }),
          terminal: Object.freeze({
            reason: terminationReason,
            exitCode: exit.exitCode,
            signal: exit.signal,
            fenced: exit.fenced,
          }) as EvaluatedAuthorDeclaration["enforcement"]["terminal"],
          cpuStat: frozenNumbers(evidence.cpuStat),
          memoryEvents: frozenNumbers(evidence.memoryEvents),
          pidsEvents: frozenNumbers(evidence.pidsEvents),
        }),
      });
    } catch (error) {
      await component.terminate().catch(() => undefined);
      const settled = await Promise.allSettled([
        stdout,
        stderr,
        component.completion,
        component.evidence,
      ]);
      const cleanup = settled[2];
      if (cleanup.status === "rejected") {
        throw new AggregateError([error, cleanup.reason], "evaluator failed and cleanup was not confirmed");
      }
      if (!cleanup.value.fenced || cleanup.value.cleanupError !== undefined) {
        throw new AggregateError([error, cleanup.value], "evaluator failed without a clean fence");
      }
      throw error;
    }
  } catch (error) {
    evaluationFailure = error;
    throw error;
  } finally {
    const cleanup = await Promise.allSettled([materialized.dispose(), toolchain.dispose()]);
    const failed = cleanup.filter((item): item is PromiseRejectedResult => item.status === "rejected");
    if (failed.length > 0) {
      throw new AggregateError(
        [
          ...(evaluationFailure === undefined ? [] : [evaluationFailure]),
          ...failed.map((item) => item.reason),
        ],
        "evaluator toolchain cleanup failed",
      );
    }
  }
}

function checkedResponse(response: JsonValue, projectPath: string): JsonValue {
  if (!isRecord(response) || response.protocol !== PROTOCOL ||
      (response.status !== "ok" && response.status !== "error")) {
    unavailable("PROJECT_EVALUATOR_PROTOCOL", "evaluator returned an invalid envelope", projectPath);
  }
  if (response.status === "error") {
    if (!exactKeys(response, ["code", "message", "protocol", "status"]) ||
        typeof response.code !== "string" || typeof response.message !== "string") {
      unavailable("PROJECT_EVALUATOR_PROTOCOL", "evaluator error has an invalid shape", projectPath);
    }
    if (!EVALUATION_CODES.has(response.code)) {
      unavailable("PROJECT_EVALUATOR_PROTOCOL", "evaluator returned an unknown error code", projectPath);
    }
    const code = response.code;
    if (code === "PROJECT_EVALUATOR_PROTOCOL") {
      unavailable(code, response.message, projectPath);
    }
    const message = response.message;
    invalid(code, message, projectPath);
  }
  if (!exactKeys(response, ["protocol", "status", "value"])) {
    unavailable("PROJECT_EVALUATOR_PROTOCOL", "evaluator success has an invalid shape", projectPath);
  }
  return response.value!;
}

function contextualAuthorSchema(bytes: Uint8Array, expected: "project" | "binding") {
  let document: JsonValue;
  try {
    document = decodeJson1(bytes);
  } catch (error) {
    unavailable(
      "PROJECT_EVALUATOR_UNAVAILABLE",
      `captured authoring schema is invalid: ${errorText(error)}`,
    );
  }
  if (!isRecord(document) || !isRecord(document.$defs)) {
    unavailable("PROJECT_EVALUATOR_UNAVAILABLE", "captured authoring schema has no definitions");
  }
  const definition = expected === "project" ? "project" : "packageBinding";
  try {
    return compileEmbeddedSchema(
      Object.freeze({ $ref: `#/$defs/${definition}` }),
      {
        path: "project-authoring-1.schema.json",
        rootDefs: document.$defs as JsonObject,
      },
    );
  } catch (error) {
    unavailable(
      "PROJECT_EVALUATOR_UNAVAILABLE",
      `captured authoring schema cannot compile: ${errorText(error)}`,
    );
  }
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function evaluatorLimits() {
  return Object.freeze({
    memoryBytes: 256 * 1024 * 1024,
    pids: 32,
    cpuQuotaMicros: 50_000,
    cpuPeriodMicros: 100_000,
    wallClockMs: 3_000,
    cleanupTimeoutMs: 5_000,
  });
}

async function checkedRuntimeMounts(
  mounts: readonly PrivateLinuxReadOnlyMount[],
  bunPath: string,
  observation: PrivateRuntimeSupportObservation,
): Promise<readonly PrivateLinuxReadOnlyMount[]> {
  requirePrivateRuntimeSupportObservation(observation);
  if (bunPath !== observation.executablePath) {
    unavailable("PROJECT_EVALUATOR_UNAVAILABLE", "evaluator runtime executable is not retained");
  }
  const normalized = await Promise.all(mounts.map(async ({ source, destination }) => {
    const canonical = await realpath(source);
    if (destination !== canonical) {
      unavailable(
        "PROJECT_EVALUATOR_UNAVAILABLE",
        "evaluator runtime mounts must preserve their retained absolute paths",
      );
    }
    return Object.freeze({ source: canonical, destination: canonical });
  }));
  if (!normalized.some(({ source }) => bunPath === source || bunPath.startsWith(`${source}/`))) {
    unavailable(
      "PROJECT_EVALUATOR_UNAVAILABLE",
      "evaluator runtime mounts do not contain the selected Bun executable",
    );
  }
  const observedSources = normalized.map(({ source }) => source).sort();
  const sealedSources = [...observation.closureSources];
  if (observedSources.length !== sealedSources.length ||
      observedSources.some((source, index) => source !== sealedSources[index])) {
    unavailable(
      "PROJECT_EVALUATOR_UNAVAILABLE",
      "evaluator runtime mounts do not match the retained support closure",
    );
  }
  return Object.freeze(normalized);
}

async function collectBounded(
  stream: AsyncIterable<Uint8Array>,
  maximum: number,
  terminate: () => Promise<void>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > maximum) {
      await terminate();
      invalid("PROJECT_EVALUATION_LIMIT", `evaluator channel exceeds ${maximum} bytes`);
    }
    chunks.push(chunk.slice());
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function frozenNumbers(value: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  return Object.freeze(Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0)));
}

function safeText(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes).slice(0, 4_096);
  } catch {
    return "non-UTF-8 diagnostics";
  }
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
