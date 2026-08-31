import { invalid } from "../diagnostics.js";
import { PRIVATE_ACTIVATION_TARGET_LIMIT } from "../internal/activation-planning.js";
import { privateDomainDigest } from "../internal/identity.js";
import type { JsonValue } from "../json.js";
import type { BindingDefinition, JigDefinition } from "./author.js";
import {
  evaluateAuthorClosure,
  type EvaluatedAuthorDeclaration,
  type PrivateAuthorEvaluatorOptions,
} from "./author-evaluator.js";
import {
  captureOpenedAuthorClosure,
  type CapturedAuthorClosure,
} from "./author-module.js";
import {
  captureDeclarationSource,
  type DeclarationSourceObservation,
} from "./declaration-source.js";
import { captureOpenedFlowSource, type FlowDiscoveryObservation, type FlowExactObservation } from "./flow-source.js";
import {
  linkPackageProject,
  type PackageProjectValue,
} from "./package-project.js";
import { retainAuthorClosure, type RetainedAuthorClosure } from "./retained-author-closure.js";
import { retainFlowSourcePackages, type RetainedFlowInput } from "./retained-flow.js";
import {
  openPrivateProjectRoot,
  requirePrivateProjectRoot,
  type PrivateProjectRoot,
} from "./root.js";

const authenticProjects = new WeakSet<object>();

export interface PrivateRetainedProjectOptions {
  readonly projectRoot: string;
  readonly storeRoot: string;
  readonly evaluator: PrivateAuthorEvaluatorOptions;
}

export interface PrivateRetainedOpenedProjectOptions {
  readonly projectRoot: PrivateProjectRoot;
  readonly storeRoot: string;
  readonly evaluator: PrivateAuthorEvaluatorOptions;
}

export interface RetainedBindingDeclaration {
  readonly id: string;
  readonly sourcePath: string;
  readonly evaluation: EvaluatedAuthorDeclaration<BindingDefinition>;
}

export interface PrivateRetainedPackageProject {
  readonly captureDigest: string;
  readonly root: {
    readonly device: string;
    readonly inode: string;
  };
  readonly declarationArtifact: RetainedAuthorClosure;
  readonly project: EvaluatedAuthorDeclaration<JigDefinition>;
  readonly flowSource: readonly (FlowDiscoveryObservation | FlowExactObservation)[];
  readonly bindingSource: readonly DeclarationSourceObservation[];
  readonly flows: readonly RetainedFlowInput[];
  readonly bindings: readonly RetainedBindingDeclaration[];
  readonly linked: PackageProjectValue;
}

/**
 * Capture, evaluate, retain, and link one package-only project candidate.
 * Nothing returned by a failed attempt is admissible or reusable as a project.
 */
export async function retainPackageProject(
  options: PrivateRetainedProjectOptions,
  signal?: AbortSignal,
): Promise<PrivateRetainedPackageProject> {
  const root = await openPrivateProjectRoot(options.projectRoot);
  let operationFailure: unknown;
  try {
    return await retainOpenedPackageProject({ ...options, projectRoot: root }, signal);
  } catch (error) {
    operationFailure = error;
    throw error;
  } finally {
    try {
      await root.dispose();
    } catch (error) {
      throw new AggregateError(
        operationFailure === undefined ? [error] : [operationFailure, error],
        "retained project operation and root cleanup did not both complete",
      );
    }
  }
}

/**
 * Capture one aggregate beneath a caller-owned project-root descriptor.
 * The borrowed descriptor remains owned by the caller on every path.
 */
export async function retainOpenedPackageProject(
  options: PrivateRetainedOpenedProjectOptions,
  signal?: AbortSignal,
): Promise<PrivateRetainedPackageProject> {
  const entry = "jig.ts";
  const root = requirePrivateProjectRoot(options.projectRoot);
  let bootstrap: CapturedAuthorClosure | undefined;
  let closure: CapturedAuthorClosure | undefined;
  let flowSource: Awaited<ReturnType<typeof captureOpenedFlowSource>> | undefined;
  let operationFailure: unknown;
  try {
    bootstrap = await captureOpenedAuthorClosure(root, [entry]);
    const bootstrapProject = await evaluateAuthorClosure(
      options.evaluator,
      bootstrap,
      entry,
      "project",
      signal,
    ) as EvaluatedAuthorDeclaration<JigDefinition>;

    const bindingSource = await captureDeclarationSource(root, bootstrapProject.value.bindings);
    closure = await captureOpenedAuthorClosure(root, [
      entry,
      ...bindingSource.members.map(({ projectPath }) => projectPath),
    ]);
    assertBootstrapPreserved(bootstrap, closure);
    const project = await evaluateAuthorClosure(
      options.evaluator,
      closure,
      entry,
      "project",
      signal,
    ) as EvaluatedAuthorDeclaration<JigDefinition>;
    if (project.outputDigest !== bootstrapProject.outputDigest) {
      invalid("PROJECT_SOURCE_CHANGED", "project definition changed while its complete declaration closure was captured", entry);
    }

    const bindings: RetainedBindingDeclaration[] = [];
    for (const member of bindingSource.members) {
      const evaluation = await evaluateAuthorClosure(
        options.evaluator,
        closure,
        member.projectPath,
        "binding",
        signal,
      ) as EvaluatedAuthorDeclaration<BindingDefinition>;
      bindings.push(Object.freeze({ id: member.id, sourcePath: member.projectPath, evaluation }));
    }
    await bindingSource.verify();

    flowSource = await captureOpenedFlowSource(root, project.value.flows);
    const retainedFlows = await retainFlowSourcePackages(options.storeRoot, flowSource);
    const declarationArtifact = await retainAuthorClosure(options.storeRoot, closure);
    await bindingSource.verify();
    await root.verify();

    const linked = linkPackageProject({
      flows: retainedFlows,
      bindings: bindings.map(({ sourcePath, evaluation }) => ({ sourcePath, definition: evaluation.value })),
    }, PRIVATE_ACTIVATION_TARGET_LIMIT);
    const rootIdentity = Object.freeze({
      device: root.information.dev.toString(),
      inode: root.information.ino.toString(),
    });
    const captureDigest = digestCapture({
      root: rootIdentity,
      declarationArtifact,
      project,
      flowSource: flowSource.observations,
      bindingSource: bindingSource.observations,
      flows: retainedFlows,
      bindings,
    });
    const value = Object.freeze({
      captureDigest,
      root: rootIdentity,
      declarationArtifact,
      project,
      flowSource: flowSource.observations,
      bindingSource: bindingSource.observations,
      flows: retainedFlows,
      bindings: Object.freeze(bindings),
      linked,
    });
    authenticProjects.add(value);
    return value;
  } catch (error) {
    operationFailure = error;
    throw error;
  } finally {
    const cleanupFailures: unknown[] = [];
    try { await flowSource?.dispose(); } catch (error) { cleanupFailures.push(error); }
    try { closure?.dispose(); } catch (error) { cleanupFailures.push(error); }
    try { bootstrap?.dispose(); } catch (error) { cleanupFailures.push(error); }
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        operationFailure === undefined ? cleanupFailures : [operationFailure, ...cleanupFailures],
        "retained project operation and cleanup did not both complete",
      );
    }
  }
}

export function requirePrivateRetainedPackageProject(value: unknown): PrivateRetainedPackageProject {
  if (value === null || typeof value !== "object" || !authenticProjects.has(value)) {
    throw new TypeError("project was not produced by the retained aggregate boundary");
  }
  return value as PrivateRetainedPackageProject;
}

function assertBootstrapPreserved(bootstrap: CapturedAuthorClosure, complete: CapturedAuthorClosure): void {
  const completeByPath = new Map(complete.modules.map((module) => [module.projectPath, module]));
  for (const module of bootstrap.modules) {
    const current = completeByPath.get(module.projectPath);
    const mismatch = current === undefined ? "missing module" :
      current.sourceBytes !== module.sourceBytes ? "byte count" :
      current.sourceDigest !== module.sourceDigest ? "content digest" :
      !sameImports(current.imports, module.imports) ? "import edges" :
      undefined;
    if (mismatch !== undefined) {
      invalid("PROJECT_SOURCE_CHANGED", `project declaration closure changed during source expansion (${mismatch})`, module.projectPath);
    }
  }
}

function digestCapture(input: {
  readonly root: { readonly device: string; readonly inode: string };
  readonly declarationArtifact: RetainedAuthorClosure;
  readonly project: EvaluatedAuthorDeclaration<JigDefinition>;
  readonly flowSource: readonly (FlowDiscoveryObservation | FlowExactObservation)[];
  readonly bindingSource: readonly DeclarationSourceObservation[];
  readonly flows: readonly RetainedFlowInput[];
  readonly bindings: readonly RetainedBindingDeclaration[];
}): string {
  const value = {
    root: input.root,
    declarationArtifact: input.declarationArtifact,
    project: evaluationIdentity(input.project),
    flowSource: input.flowSource,
    bindingSource: input.bindingSource,
    flows: input.flows.map((flow) => ({ provenance: flow.provenance, package: flow.package })),
    bindings: input.bindings.map((binding) => ({
      id: binding.id,
      sourcePath: binding.sourcePath,
      evaluation: evaluationIdentity(binding.evaluation),
    })),
  };
  return privateDomainDigest(
    "JIG-Package-Project-Capture/3",
    value as unknown as JsonValue,
  );
}

function evaluationIdentity(value: EvaluatedAuthorDeclaration): object {
  return {
    expected: value.expected,
    source: value.source,
    profile: value.profile,
    outputDigest: value.outputDigest,
    value: value.value,
  };
}

function sameImports(
  left: readonly { readonly specifier: string; readonly projectPath: string }[],
  right: readonly { readonly specifier: string; readonly projectPath: string }[],
): boolean {
  return left.length === right.length && left.every((edge, index) =>
    edge.specifier === right[index]!.specifier && edge.projectPath === right[index]!.projectPath
  );
}
