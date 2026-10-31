import { CheckError, invalid } from '../diagnostics.js'
import { PRIVATE_ACTIVATION_TARGET_LIMIT } from '../internal/activation-planning.js'
import { type BoundAttachments, captureBoundAttachments } from '../internal/bound-attachments.js'
import type { PrivateFileLocation } from '../internal/descriptor-files.js'
import { privateDomainDigest } from '../internal/identity.js'
import {
  captureStoredPackage,
  normalizePackageArtifactRef,
} from '../internal/package-artifact-store.js'
import { privateProfileSpan } from '../internal/private-profile.js'
import {
  normalizePrivateRetainedProjectEvaluation,
  type PrivateRetainedProjectEvaluation,
} from '../internal/project-evaluation-retention.js'
import type { JsonValue } from '../json.js'
import type { CapturedPackage } from '../package/capture.js'
import {
  type PrivateAgentSourceLocation,
  privateAgentSourceLocations,
} from './agent-source-location.js'
import type { BindingDefinition, JigDefinition } from './author.js'
import {
  type EvaluatedAuthorDeclaration,
  evaluateAuthorClosure,
  evaluateAuthorClosureBatch,
  type PrivateAuthorEvaluatorOptions,
} from './author-evaluator.js'
import { type CapturedAuthorClosure, captureOpenedAuthorClosure } from './author-module.js'
import {
  captureDeclarationSource,
  type DeclarationSourceObservation,
} from './declaration-source.js'
import { entrypointWords, parseProjectEntrypoint } from './entrypoint.js'
import type { ProjectEvaluation } from './evaluation.js'
import {
  type CapturedFlowSource,
  captureOpenedFlowSource,
  type FlowDiscoveryObservation,
  type FlowExactObservation,
  type PrepareCapturedFlow,
} from './flow-source.js'
import { captureGrantSource } from './grant-source.js'
import type { AcpGrant, GrantPolicy } from './grants.js'
import type { JigLimits } from './limits.js'
import { captureProjectJigRequirement } from './jig-version.js'
import { linkPackageProject, type PackageProjectValue } from './package-project.js'
import { npmPackageName } from './package-selector.js'
import { type RetainedAuthorClosure, retainAuthorClosure } from './retained-author-closure.js'
import { type RetainedFlowInput, retainFlowSourcePackages } from './retained-flow.js'
import {
  openPrivateProjectRoot,
  type PrivateProjectRoot,
  requirePrivateProjectRoot,
} from './root.js'

const authenticProjects = new WeakSet<object>()

export interface PrivateRetainedProjectOptions {
  readonly projectRoot: string
  readonly storeRoot: PrivateFileLocation
  readonly evaluator: PrivateAuthorEvaluatorOptions
  readonly agentOverride?: AcpGrant['client']
}

export interface PrivateRetainedOpenedProjectOptions {
  readonly onProjectLimits?: (limits: JigLimits | undefined) => void
  readonly projectRoot: PrivateProjectRoot
  readonly storeRoot: PrivateFileLocation
  readonly evaluator: PrivateAuthorEvaluatorOptions
  readonly agentOverride?: AcpGrant['client']
  readonly prepareFlow?: PrepareCapturedFlow
  readonly reviewEvaluation?: (
    grant: ProjectEvaluation,
    captured: CapturedPackage,
  ) => Promise<PrivateRetainedProjectEvaluation>
  readonly dependencyFlows?: (selectors: readonly string[]) => Promise<CapturedFlowSource>
}

export interface RetainedBindingDeclaration {
  readonly id: string
  readonly sourcePath: string
  readonly evaluation: EvaluatedAuthorDeclaration<BindingDefinition>
  readonly attachments?: BoundAttachments
  readonly retainedEvaluations?: Readonly<Record<string, PrivateRetainedProjectEvaluation>>
}

export interface PrivateRetainedPackageProject {
  readonly captureDigest: string
  readonly agentOverride?: AcpGrant['client']
  readonly root: {
    readonly device: string
    readonly inode: string
  }
  readonly declarationArtifact: RetainedAuthorClosure
  readonly project: EvaluatedAuthorDeclaration<JigDefinition>
  readonly flowSource: readonly (FlowDiscoveryObservation | FlowExactObservation)[]
  readonly bindingSource: readonly DeclarationSourceObservation[]
  readonly grantSource: readonly DeclarationSourceObservation[]
  readonly grants: Readonly<Record<string, GrantPolicy>>
  readonly grantFiles: Readonly<Record<string, PrivateAgentSourceLocation>>
  readonly agentSources: Readonly<
    Record<string, Readonly<Record<string, PrivateAgentSourceLocation>>>
  >
  readonly flows: readonly RetainedFlowInput[]
  readonly bindings: readonly RetainedBindingDeclaration[]
  readonly linked: PackageProjectValue
}

/**
 * Capture, evaluate, retain, and link one package-only project candidate.
 * Nothing returned by a failed attempt is admissible or reusable as a project.
 */
export async function retainPackageProject(
  options: PrivateRetainedProjectOptions,
  signal?: AbortSignal,
): Promise<PrivateRetainedPackageProject> {
  const root = await openPrivateProjectRoot(options.projectRoot)
  let operationFailure: unknown
  try {
    return await retainOpenedPackageProject({ ...options, projectRoot: root }, signal)
  } catch (error) {
    operationFailure = error
    throw error
  } finally {
    try {
      await root.dispose()
    } catch (error) {
      // biome-ignore lint/correctness/noUnsafeFinally: Failed cleanup must prevent success; preserve any operation failure too.
      throw new AggregateError(
        operationFailure === undefined ? [error] : [operationFailure, error],
        'retained project operation and root cleanup did not both complete',
      )
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
  const entry = 'jig.ts'
  const root = requirePrivateProjectRoot(options.projectRoot)
  let bootstrap: CapturedAuthorClosure | undefined
  let closure: CapturedAuthorClosure | undefined
  let flowSource: Awaited<ReturnType<typeof captureOpenedFlowSource>> | undefined
  let dependencies: CapturedFlowSource | undefined
  let operationFailure: unknown
  try {
    const jigRequirement = await captureProjectJigRequirement(root)
    const bootstrapClosure = await captureOpenedAuthorClosure(root, [entry])
    bootstrap = bootstrapClosure
    const bootstrapProject = (await privateProfileSpan('author-configuration-evaluation', () =>
      evaluateAuthorClosure(options.evaluator, bootstrapClosure, entry, 'project', signal),
    )) as EvaluatedAuthorDeclaration<JigDefinition>

    const bindingSource = await captureDeclarationSource(root, bootstrapProject.value.bindings)
    const capturedClosure = await captureOpenedAuthorClosure(root, [
      entry,
      ...bindingSource.members.map(({ projectPath }) => projectPath),
    ])
    closure = capturedClosure
    assertBootstrapPreserved(bootstrapClosure, capturedClosure)
    const evaluations = await privateProfileSpan('author-configuration-evaluation', () =>
      evaluateAuthorClosureBatch(
        options.evaluator,
        capturedClosure,
        [
          { entryProjectPath: entry, expected: 'project' },
          ...bindingSource.members.map(({ projectPath }) => ({
            entryProjectPath: projectPath,
            expected: 'binding' as const,
          })),
        ],
        signal,
      ),
    )
    const project = evaluations[0] as EvaluatedAuthorDeclaration<JigDefinition>
    if (project.outputDigest !== bootstrapProject.outputDigest) {
      invalid(
        'PROJECT_SOURCE_CHANGED',
        'project definition changed while its complete declaration closure was captured',
        entry,
      )
    }

    options.onProjectLimits?.(project.value.limits)
    const grantSource = await captureGrantSource(root, project.value.grants)
    const reviewedEvaluations = new Map<string, PrivateRetainedProjectEvaluation>()
    const reviewEvaluation = async (
      policy: GrantPolicy,
    ): Promise<PrivateRetainedProjectEvaluation | undefined> => {
      if (policy.kind !== 'evaluation') return
      return privateProfileSpan('project-evaluation-review', async () => {
        const { kind: _, ...grant } = policy
        const key = JSON.stringify(grant)
        const existing = reviewedEvaluations.get(key)
        if (existing !== undefined) return existing
        if (options.reviewEvaluation === undefined)
          invalid(
            'PROJECT_EVALUATION_UNAVAILABLE',
            'evaluation review requires locked dependency preparation',
          )
        const retained = await captureBoundAttachments(
          root,
          { recipe: grant.recipe },
          options.storeRoot,
        )
        const captured = await captureStoredPackage(
          options.storeRoot,
          normalizePackageArtifactRef({
            kind: 'flow-package/0',
            digest: retained.recipe!.digest,
          }),
        )
        try {
          const reviewed = normalizePrivateRetainedProjectEvaluation(
            await options.reviewEvaluation(grant, captured),
          )
          if (reviewed.recipe.digest !== captured.digest)
            throw new TypeError('evaluation review did not retain its captured recipe')
          reviewedEvaluations.set(key, reviewed)
          return reviewed
        } finally {
          await captured.dispose()
        }
      })
    }
    const bindings: RetainedBindingDeclaration[] = []
    for (const [index, member] of bindingSource.members.entries()) {
      const evaluation = evaluations[index + 1] as EvaluatedAuthorDeclaration<BindingDefinition>
      let attachments: BoundAttachments | undefined
      const retainedEvaluations: Record<string, PrivateRetainedProjectEvaluation> =
        Object.create(null)
      for (const [slot, selection] of Object.entries(evaluation.value.slots)) {
        const policy =
          typeof selection === 'string'
            ? selection.startsWith('grant:')
              ? grantSource.grants[selection.slice(6)]
              : undefined
            : 'kind' in selection
              ? selection
              : undefined
        if (policy !== undefined) {
          const reviewed = await reviewEvaluation(policy)
          if (reviewed !== undefined) retainedEvaluations[slot] = reviewed
        }
      }
      try {
        if (evaluation.value.attachments !== undefined)
          attachments = await captureBoundAttachments(
            root,
            evaluation.value.attachments,
            options.storeRoot,
          )
      } catch (error) {
        if (error instanceof CheckError)
          throw new CheckError(
            error.kind,
            error.code,
            error.message,
            member.projectPath,
            '/attachments',
          )
        throw error
      }
      bindings.push(
        Object.freeze({
          id: member.id,
          sourcePath: member.projectPath,
          evaluation,
          ...(attachments === undefined ? {} : { attachments }),
          ...(Object.keys(retainedEvaluations).length === 0
            ? {}
            : {
                retainedEvaluations: Object.freeze(retainedEvaluations),
              }),
        }),
      )
    }
    await bindingSource.verify()
    await grantSource.verify()

    const selected = new Set<string>()
    const select = (value: string): void => {
      if (value.startsWith('npm:')) {
        npmPackageName(value)
        selected.add(value)
      }
    }
    if (project.value.entrypoint !== undefined) {
      try {
        parseProjectEntrypoint(project.value.entrypoint)
        select(entrypointWords(project.value.entrypoint)[0]!)
      } catch {
        invalid(
          'PROJECT_ENTRYPOINT_INVALID',
          'entrypoint has invalid Run arguments',
          'jig.ts',
          '/entrypoint',
        )
      }
    }
    for (const value of Object.values(project.value.defaultProviders ?? {})) select(value)
    for (const binding of bindings) {
      select(binding.evaluation.value.package)
      for (const value of Object.values(binding.evaluation.value.slots))
        if (typeof value === 'string') select(value)
        else if ('target' in value) select(value.target)
    }
    const configured = project.value.flows
    if (configured?.kind === 'members') for (const path of configured.paths) select(path)
    if (selected.size > 256)
      invalid('PROJECT_DEPENDENCY_LIMIT', 'too many selected package dependencies')
    flowSource = await captureOpenedFlowSource(
      root,
      configured?.kind === 'members'
        ? { kind: 'members', paths: configured.paths.filter((path) => !path.startsWith('npm:')) }
        : configured,
      options.prepareFlow,
    )
    if (selected.size > 0) {
      if (!options.dependencyFlows)
        invalid('PROJECT_DEPENDENCY_UNAVAILABLE', 'this host cannot capture npm Flow targets')
      dependencies = await options.dependencyFlows([...selected].sort())
    }
    const retainedFlows = [
      ...(await retainFlowSourcePackages(options.storeRoot, flowSource)),
      ...(dependencies ? await retainFlowSourcePackages(options.storeRoot, dependencies) : []),
    ]
    const declarationArtifact = await retainAuthorClosure(options.storeRoot, closure)
    await bindingSource.verify()
    await grantSource.verify()
    await root.verify()

    const linked = linkPackageProject(
      {
        flows: retainedFlows,
        ...(project.value.entrypoint === undefined ? {} : { entrypoint: project.value.entrypoint }),
        grants: grantSource.grants,
        ...(project.value.defaultProviders === undefined
          ? {}
          : { defaultProviders: project.value.defaultProviders }),
        bindings: bindings.map(({ sourcePath, evaluation, attachments, retainedEvaluations }) => ({
          sourcePath,
          definition: evaluation.value,
          ...(attachments === undefined ? {} : { capturedAttachments: attachments }),
          ...(retainedEvaluations === undefined
            ? {}
            : { capturedEvaluations: retainedEvaluations }),
        })),
      },
      PRIVATE_ACTIVATION_TARGET_LIMIT,
      options.agentOverride,
    )
    const agentSources: Record<
      string,
      Readonly<Record<string, PrivateAgentSourceLocation>>
    > = Object.create(null)
    for (const binding of bindings) {
      const clients: Record<string, string> = Object.create(null)
      for (const [slot, selection] of Object.entries(binding.evaluation.value.slots)) {
        const policy =
          typeof selection === 'string'
            ? grantSource.grants[selection.startsWith('grant:') ? selection.slice(6) : selection]
            : selection
        if (policy !== undefined && 'kind' in policy && policy.kind === 'acp')
          clients[slot] = policy.client
      }
      agentSources[binding.id] = privateAgentSourceLocations(
        binding.sourcePath,
        closure.read(binding.sourcePath),
        clients,
      )
    }
    await jigRequirement.verify()
    const rootIdentity = Object.freeze({
      device: root.information.dev.toString(),
      inode: root.information.ino.toString(),
    })
    const captureDigest = digestCapture({
      ...(options.agentOverride === undefined ? {} : { agentOverride: options.agentOverride }),
      root: rootIdentity,
      declarationArtifact,
      project,
      flowSource: [...flowSource.observations, ...(dependencies?.observations ?? [])],
      bindingSource: bindingSource.observations,
      grantSource: grantSource.observations,
      grants: grantSource.grants,
      flows: retainedFlows,
      bindings,
    })
    const value = Object.freeze({
      captureDigest,
      ...(options.agentOverride === undefined ? {} : { agentOverride: options.agentOverride }),
      root: rootIdentity,
      declarationArtifact,
      project,
      flowSource: [...flowSource.observations, ...(dependencies?.observations ?? [])],
      bindingSource: bindingSource.observations,
      grantSource: grantSource.observations,
      grants: grantSource.grants,
      grantFiles: grantSource.files,
      agentSources: Object.freeze(agentSources),
      flows: retainedFlows,
      bindings: Object.freeze(bindings),
      linked,
    })
    authenticProjects.add(value)
    return value
  } catch (error) {
    operationFailure = error
    throw error
  } finally {
    const cleanupFailures: unknown[] = []
    try {
      await flowSource?.dispose()
    } catch (error) {
      cleanupFailures.push(error)
    }
    try {
      await dependencies?.dispose()
    } catch (error) {
      cleanupFailures.push(error)
    }
    try {
      closure?.dispose()
    } catch (error) {
      cleanupFailures.push(error)
    }
    try {
      bootstrap?.dispose()
    } catch (error) {
      cleanupFailures.push(error)
    }
    if (cleanupFailures.length > 0) {
      // biome-ignore lint/correctness/noUnsafeFinally: Failure to release captured resources disqualifies this candidate.
      throw new AggregateError(
        operationFailure === undefined ? cleanupFailures : [operationFailure, ...cleanupFailures],
        'retained project operation and cleanup did not both complete',
      )
    }
  }
}

export function requirePrivateRetainedPackageProject(
  value: unknown,
): PrivateRetainedPackageProject {
  if (value === null || typeof value !== 'object' || !authenticProjects.has(value)) {
    throw new TypeError('project was not produced by the retained aggregate boundary')
  }
  return value as PrivateRetainedPackageProject
}

function assertBootstrapPreserved(
  bootstrap: CapturedAuthorClosure,
  complete: CapturedAuthorClosure,
): void {
  const completeByPath = new Map(complete.modules.map((module) => [module.projectPath, module]))
  for (const module of bootstrap.modules) {
    const current = completeByPath.get(module.projectPath)
    const mismatch =
      current === undefined
        ? 'missing module'
        : current.sourceBytes !== module.sourceBytes
          ? 'byte count'
          : current.sourceDigest !== module.sourceDigest
            ? 'content digest'
            : !sameImports(current.imports, module.imports)
              ? 'import edges'
              : undefined
    if (mismatch !== undefined) {
      invalid(
        'PROJECT_SOURCE_CHANGED',
        `project declaration closure changed during source expansion (${mismatch})`,
        module.projectPath,
      )
    }
  }
}

function digestCapture(input: {
  readonly agentOverride?: AcpGrant['client']
  readonly root: { readonly device: string; readonly inode: string }
  readonly declarationArtifact: RetainedAuthorClosure
  readonly project: EvaluatedAuthorDeclaration<JigDefinition>
  readonly flowSource: readonly (FlowDiscoveryObservation | FlowExactObservation)[]
  readonly bindingSource: readonly DeclarationSourceObservation[]
  readonly grantSource: readonly DeclarationSourceObservation[]
  readonly grants: Readonly<Record<string, GrantPolicy>>
  readonly flows: readonly RetainedFlowInput[]
  readonly bindings: readonly RetainedBindingDeclaration[]
}): string {
  const value = {
    ...(input.agentOverride === undefined ? {} : { agentOverride: input.agentOverride }),
    root: input.root,
    declarationArtifact: input.declarationArtifact,
    project: evaluationIdentity(input.project),
    flowSource: input.flowSource,
    bindingSource: input.bindingSource,
    grantSource: input.grantSource,
    grants: input.grants,
    flows: input.flows.map((flow) => ({ provenance: flow.provenance, package: flow.package })),
    bindings: input.bindings.map((binding) => ({
      id: binding.id,
      sourcePath: binding.sourcePath,
      evaluation: evaluationIdentity(binding.evaluation),
      ...(binding.attachments === undefined ? {} : { attachments: binding.attachments }),
      ...(binding.retainedEvaluations === undefined
        ? {}
        : { evaluations: binding.retainedEvaluations }),
    })),
  }
  return privateDomainDigest('JIG-Package-Project-Capture/3', value as unknown as JsonValue)
}

function evaluationIdentity(value: EvaluatedAuthorDeclaration): object {
  return {
    expected: value.expected,
    source: value.source,
    profile: value.profile,
    outputDigest: value.outputDigest,
    value: value.value,
  }
}

function sameImports(
  left: readonly { readonly specifier: string; readonly projectPath: string }[],
  right: readonly { readonly specifier: string; readonly projectPath: string }[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (edge, index) =>
        edge.specifier === right[index]!.specifier &&
        edge.projectPath === right[index]!.projectPath,
    )
  )
}
