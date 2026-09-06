import { constants, type BigIntStats } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'

import {
  ProjectAdministrationError,
  normalizeProjectApplyRequest,
  normalizeProjectPlanRequest,
  type ProjectApplyReceipt,
  type ProjectApplyRequest,
  type ProjectPlanRequest,
  type ProjectPlanResult,
  type ProjectSession,
} from '../administration/project.js'
import { CheckError } from '../diagnostics.js'
import {
  applyPrivateActivationReviewPlan,
  capturePrivateActivationPlanningBase,
  publishPrivateActivationReviewPlan,
  readPrivateAdmittedExecutionReuse,
} from './activation-admission-store.js'
import { createPrivateActivationCandidateV5 } from './activation-admission.js'
import { createPrivateActivationPlanningObservation } from './activation-planning.js'
import type { PrivateInstalledBunSupport } from './installed-bun-support.js'
import { inspectPrivateBunPackageInput } from './bun-package-input.js'
import {
  createPrivateBunPreparationBudget,
  type PrivateBunPreparationBudget,
} from './bun-native-preparation-budget.js'
import {
  preparePrivateBunPackage,
  recoverPrivateBunPreparationOwner,
} from './bun-native-preparation.js'
import {
  captureStoredPackage,
  publishCapturedPackage,
  type PackageArtifactRef,
} from './package-artifact-store.js'
import { planPrivateDirectRun, type PrivateDirectRunRecipe } from './direct-run.js'
import { privateDomainDigest } from './identity.js'
import { validateJson1 } from '../json.js'
import type { PrivateLinuxCgroupBackend } from './linux-rootless-backend.js'
import type { PrivateAgentProvider } from './agent-provider.js'
import { renderPrivateProjectPlanReview } from './project-plan-review.js'
import type { PrivateProjectPlanReview } from './project-plan-review.js'
import {
  attachPrivateRootAdministrationController,
  type PrivateRootAdministrationController,
} from './root-administration-controller.js'
import { executePrivateRootRunLaunch } from './root-run-controller.js'
import type { PrivateRootRunFiles } from './root-run-files.js'
import {
  openPrivateProjectSessionOwner,
  type PrivateProjectSessionOwner,
} from './project-session-owner.js'
import {
  buildPrivateActivationRequests,
  resolveRetainedPackageProjectObservation,
} from '../project/package-resolution.js'
import { retainOpenedPackageProject } from '../project/retained-project.js'

const STORE_DIRECTORY = 'private-package-store'

/** One closed proof-host input. It is not a public host or extension SPI. */
export interface PrivateProjectSessionHost {
  readonly backend: PrivateLinuxCgroupBackend
  readonly installedBunSupport: PrivateInstalledBunSupport
  readonly runTimeoutMs: number
  readonly agentProvider?: PrivateAgentProvider | undefined
  readonly files?: PrivateRootRunFiles
}

/** Open one finite project session against already selected trusted machinery. */
export async function openPrivateProjectSession(input: {
  readonly directory: string
  readonly host: PrivateProjectSessionHost
}): Promise<ProjectSession> {
  let owner: PrivateProjectSessionOwner | undefined
  let roots: PrivateRootAdministrationController | undefined
  let projectIdentityLost = false
  let closeForIdentityLoss: (() => void) | undefined
  try {
    owner = await openPrivateProjectSessionOwner(input.directory)
    const packageStoreRoot = await preparePackageStore(owner)
    await recoverPrivateBunPreparationOwner({
      projectRoot: owner.root.requestedPath,
      coordinator: owner.coordinator,
      backend: input.host.backend,
    })
    roots = await attachPrivateRootAdministrationController({
      coordinator: owner.coordinator,
      projectRoot: owner.root.requestedPath,
      packageStoreRoot,
      runTimeoutMs: input.host.runTimeoutMs,
      ...(input.host.files === undefined ? {} : { files: input.host.files }),
      execute: (runId, coordinator, signal) =>
        executePrivateRootRunLaunch({
          projectRoot: owner!.root.requestedPath,
          packageStoreRoot,
          runId,
          coordinator,
          installedSupport: input.host.installedBunSupport,
          backend: input.host.backend,
          agentProvider: input.host.agentProvider,
          ...(input.host.files === undefined ? {} : { files: input.host.files }),
          signal,
        }),
      onProjectIdentityLoss: () => {
        projectIdentityLost = true
        closeForIdentityLoss?.()
      },
    })
    const created = createSession(owner, roots, packageStoreRoot, input.host)
    closeForIdentityLoss = created.projectIdentityLost
    if (projectIdentityLost) created.projectIdentityLost()
    return created.session
  } catch (error) {
    const failures: unknown[] = [error]
    try {
      await roots?.dispose()
    } catch (cleanup) {
      failures.push(cleanup)
    }
    try {
      await owner?.dispose()
    } catch (cleanup) {
      failures.push(cleanup)
    }
    if (failures.length > 1) {
      throw projectError(
        new AggregateError(failures, 'project-session acquisition cleanup failed'),
        'acquire',
      )
    }
    throw projectError(error, 'acquire')
  }
}

function createSession(
  owner: PrivateProjectSessionOwner,
  roots: PrivateRootAdministrationController,
  packageStoreRoot: string,
  host: PrivateProjectSessionHost,
): {
  readonly session: ProjectSession
  readonly projectIdentityLost: () => void
} {
  const planningCancellation = new AbortController()
  const operations = new Set<Promise<void>>()
  let state: 'open' | 'closing' | 'closed' = 'open'
  let closure: Promise<void> | undefined
  let rootClosure: Promise<void> | undefined

  const session: ProjectSession = Object.freeze({
    rootAdministration: roots.administration,

    async plan(value: ProjectPlanRequest): Promise<ProjectPlanResult> {
      const leave = enterOperation()
      let preparationBudget: PrivateBunPreparationBudget | undefined
      try {
        const request = normalizeProjectPlanRequest(value)
        planningCancellation.signal.throwIfAborted()
        await owner.verify()
        const planningBase = await capturePrivateActivationPlanningBase({
          projectRoot: owner.root,
        })
        planningCancellation.signal.throwIfAborted()
        const aggregate = await retainOpenedPackageProject(
          {
            projectRoot: owner.root,
            storeRoot: packageStoreRoot,
            evaluator: {
              backend: host.backend,
              installedSupport: host.installedBunSupport,
            },
          },
          planningCancellation.signal,
        )
        planningCancellation.signal.throwIfAborted()
        const requests = buildPrivateActivationRequests(aggregate.linked)
        if (requests.length === 0) {
          throw new ProjectAdministrationError(
            'INVALID_CANDIDATE',
            'project has no exact Run target',
          )
        }
        preparationBudget = createPrivateBunPreparationBudget(planningCancellation.signal)
        const recipes: PrivateDirectRunRecipe[] = []
        const executionPackages = new Map<string, PackageArtifactRef>()
        for (const request of requests) {
          preparationBudget.signal.throwIfAborted()
          if (request.mode !== 'run') {
            throw new ProjectAdministrationError(
              'UNAVAILABLE',
              'project target requires a host execution mode which is not available',
            )
          }
          try {
            let executionPackage = executionPackages.get(request.package.digest)
            if (executionPackage === undefined) {
              const source = await captureStoredPackage(packageStoreRoot, request.package)
              try {
                const dependencyInput = await inspectPrivateBunPackageInput(source)
                if (dependencyInput.state === 'direct') {
                  executionPackage = request.package
                } else {
                  const admitted = readPrivateAdmittedExecutionReuse({ planningBase, request })
                  if (admitted !== undefined) {
                    const current = await planPrivateDirectRun({
                      request,
                      executionPackage: admitted.executionPackage,
                      installedSupport: host.installedBunSupport,
                      backend: host.backend,
                      agentProvider: host.agentProvider,
                    })
                    if (
                      current.digest === admitted.recipeDigest &&
                      current.observation.digest === admitted.observationDigest
                    ) {
                      executionPackage = admitted.executionPackage
                    }
                  }
                  if (executionPackage === undefined) {
                    preparationBudget.reserve(request.package.digest, request.packagePath)
                    const prepared = await preparePrivateBunPackage({
                      captured: source,
                      installedSupport: host.installedBunSupport,
                      backend: host.backend,
                      projectRoot: owner.root.requestedPath,
                      coordinator: owner.coordinator,
                      deadlineUnixMs: preparationBudget.deadlineUnixMs,
                      signal: preparationBudget.signal,
                    })
                    try {
                      preparationBudget.retain(prepared.files, request.packagePath)
                      executionPackage = await publishCapturedPackage(packageStoreRoot, prepared)
                    } finally {
                      await prepared.dispose()
                    }
                  }
                }
              } finally {
                await source.dispose()
              }
              executionPackages.set(request.package.digest, executionPackage)
            }
            recipes.push(
              await planPrivateDirectRun({
                request,
                executionPackage,
                installedSupport: host.installedBunSupport,
                backend: host.backend,
                agentProvider: host.agentProvider,
              }),
            )
          } catch (error) {
            const scoped = scopePrivatePackagePlanningError(error, request.packagePath)
            if (scoped !== error) throw scoped
            if (error instanceof TypeError) {
              throw new ProjectAdministrationError(
                'UNAVAILABLE',
                'project target has no available exact execution recipe',
              )
            }
            throw error
          }
        }
        preparationBudget.signal.throwIfAborted()
        const mechanismDigests = new Set(recipes.map(({ mechanismDigest }) => mechanismDigest))
        if (mechanismDigests.size !== 1) {
          throw new Error('planned targets did not resolve through one exact host mechanism')
        }
        const planning = createPrivateActivationPlanningObservation({
          policyDigest: privateDomainDigest('JIG-Private-Project-Session-Policy/1', {
            targetPolicy: 'all-exact-or-fail',
          }),
          mechanismDigest: recipes[0]!.mechanismDigest,
          entries: recipes.map((recipe) => ({
            target: recipe.request.target,
            requestDigest: recipe.request.digest,
            disposition: { state: 'planned' as const, observation: recipe.observation },
          })),
        })
        const candidate = createPrivateActivationCandidateV5(
          aggregate,
          resolveRetainedPackageProjectObservation(aggregate, planning),
          recipes,
        )
        preparationBudget.signal.throwIfAborted()
        let review: PrivateProjectPlanReview | undefined
        const result = await publishPrivateActivationReviewPlan({
          projectRoot: owner.root,
          packageStoreRoot,
          planningBase,
          candidate,
          lockMode: request.lockMode,
          beforePersistApplicable(applicable): void {
            review = renderPrivateProjectPlanReview(applicable)
          },
        })
        preparationBudget.signal.throwIfAborted()
        await owner.verify()
        preparationBudget.signal.throwIfAborted()
        if (result.state === 'unchanged') return Object.freeze({ state: 'unchanged' as const })
        if (review === undefined) throw new Error('applicable project Plan has no validated review')
        const publicResult = Object.freeze({
          state: 'applicable' as const,
          operation: result.plan.operation,
          planDigest: result.planDigest,
          review,
        })
        validateJson1(publicResult)
        return publicResult
      } catch (error) {
        throw handleOperationError(error, 'plan')
      } finally {
        preparationBudget?.dispose()
        leave()
      }
    },

    async apply(value: ProjectApplyRequest): Promise<ProjectApplyReceipt> {
      const leave = enterOperation()
      try {
        const request = normalizeProjectApplyRequest(value)
        await owner.verify()
        const receipt = await applyPrivateActivationReviewPlan({
          projectRoot: owner.root,
          packageStoreRoot,
          planDigest: request.planDigest,
        })
        await owner.verify()
        return Object.freeze(
          'admission' in receipt
            ? {
                operation: 'admission' as const,
                planDigest: request.planDigest,
              }
            : {
                operation: 'lock-repair' as const,
                planDigest: request.planDigest,
              },
        )
      } catch (error) {
        throw handleOperationError(error, 'apply')
      } finally {
        leave()
      }
    },

    close(): Promise<void> {
      return initiateClose()
    },
  })
  return Object.freeze({
    session,
    projectIdentityLost(): void {
      void initiateClose().catch(() => undefined)
    },
  })

  function enterOperation(): () => void {
    if (state !== 'open') {
      throw new ProjectAdministrationError('PROJECT_CLOSED', 'project session is closed')
    }
    let settle!: () => void
    const token = new Promise<void>((resolve) => {
      settle = resolve
    })
    operations.add(token)
    let left = false
    return () => {
      if (left) return
      left = true
      operations.delete(token)
      settle()
    }
  }

  function initiateClose(): Promise<void> {
    if (closure !== undefined) return closure
    state = 'closing'
    planningCancellation.abort(new Error('project session closed'))
    rootClosure = roots.dispose()
    closure = finishClose()
    return closure
  }

  async function finishClose(): Promise<void> {
    const failures: unknown[] = []
    while (operations.size > 0) await Promise.all([...operations])
    try {
      await rootClosure
    } catch (error) {
      failures.push(error)
    }
    try {
      await owner.dispose()
    } catch (error) {
      failures.push(error)
    }
    state = 'closed'
    if (failures.length > 0) {
      throw new ProjectAdministrationError(
        'UNAVAILABLE',
        'project session cleanup did not complete',
      )
    }
  }

  function handleOperationError(
    error: unknown,
    operation: 'plan' | 'apply',
  ): ProjectAdministrationError {
    if (isRootIdentityLoss(error, owner)) {
      void initiateClose().catch(() => undefined)
      return new ProjectAdministrationError('PROJECT_CLOSED', 'project session identity was lost')
    }
    if (operation === 'plan' && state !== 'open') {
      return new ProjectAdministrationError('PROJECT_CLOSED', 'project session is closed')
    }
    return projectError(error, operation)
  }
}

async function preparePackageStore(owner: PrivateProjectSessionOwner): Promise<string> {
  await owner.verify()
  const statePath = `/proc/self/fd/${owner.root.handle.fd}/.jig`
  const state = await open(
    statePath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const storePath = `/proc/self/fd/${state.fd}/${STORE_DIRECTORY}`
    try {
      await mkdir(storePath, { mode: 0o700 })
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error
    }
    await state.sync()
    const observed = await lstat(storePath, { bigint: true })
    requireProtectedStore(observed, owner.root.information.dev)
    const store = await open(
      storePath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const actual = await store.stat({ bigint: true })
      requireProtectedStore(actual, owner.root.information.dev)
      if (observed.dev !== actual.dev || observed.ino !== actual.ino) {
        throw new ProjectAdministrationError(
          'PROJECT_UNSAFE',
          'project package store changed while opening',
        )
      }
    } finally {
      await store.close()
    }
  } finally {
    await state.close()
  }
  await owner.verify()
  return `/proc/self/fd/${owner.root.handle.fd}/.jig/${STORE_DIRECTORY}`
}

function requireProtectedStore(information: BigIntStats, projectDevice: bigint): void {
  if (
    !information.isDirectory() ||
    information.isSymbolicLink() ||
    information.dev !== projectDevice ||
    information.uid !== BigInt(currentEuid()) ||
    (information.mode & 0o022n) !== 0n
  ) {
    throw new ProjectAdministrationError(
      'PROJECT_UNSAFE',
      'project package store is not a protected local directory',
    )
  }
}

/** Package-private closed projection from implementation failures. */
export function projectError(
  error: unknown,
  operation: 'acquire' | 'plan' | 'apply',
): ProjectAdministrationError {
  if (error instanceof ProjectAdministrationError) return error
  if (error instanceof CheckError) {
    if (
      error.code === 'COORDINATOR_BUSY' ||
      error.code === 'ADMISSION_STATE_BUSY' ||
      error.code === 'PROJECT_BUSY' ||
      error.code === 'PROJECT_SOURCE_CHANGED'
    ) {
      return new ProjectAdministrationError(
        'PROJECT_BUSY',
        'project changed or is busy; retry the operation',
      )
    }
    if (error.code === 'LOCK_MISMATCH') {
      return new ProjectAdministrationError(
        'LOCK_MISMATCH',
        'visible jig.lock does not match the proposed lock',
      )
    }
    if (error.code === 'ADMISSION_PLAN_MISSING') {
      return new ProjectAdministrationError(
        'PLAN_NOT_FOUND',
        'reviewed project Plan does not exist',
      )
    }
    if (error.code === 'STALE_PLAN') {
      return new ProjectAdministrationError('STALE_PLAN', 'reviewed project Plan is stale')
    }
    if (operation === 'acquire' && error.code === 'PROJECT_ROOT_IO') {
      return new ProjectAdministrationError('PROJECT_NOT_FOUND', 'project directory is unavailable')
    }
    if (
      operation === 'acquire' &&
      (error.code.startsWith('PROJECT_ROOT') ||
        error.code.startsWith('ADMISSION_STATE') ||
        error.code.startsWith('COORDINATOR_SCHEMA'))
    ) {
      return new ProjectAdministrationError(
        'PROJECT_UNSAFE',
        'project directory or protected state is unsafe',
      )
    }
    if (
      operation === 'plan' &&
      error.kind === 'invalid' &&
      error.path !== undefined &&
      isCandidateDiagnosticCode(error.code)
    ) {
      try {
        return new ProjectAdministrationError('INVALID_CANDIDATE', 'project candidate is invalid', {
          code: error.code,
          path: error.path,
          ...(error.pointer === undefined ? {} : { pointer: error.pointer }),
        })
      } catch {
        return new ProjectAdministrationError('INVALID_CANDIDATE', 'project candidate is invalid')
      }
    }
    if (error.kind === 'unavailable') {
      if (
        operation === 'plan' &&
        error.path !== undefined &&
        isUnavailableDiagnosticCode(error.code)
      ) {
        try {
          return new ProjectAdministrationError('UNAVAILABLE', `${operation} is unavailable`, {
            code: error.code,
            path: error.path,
            ...(error.pointer === undefined ? {} : { pointer: error.pointer }),
          })
        } catch {
          // An invalid or protected location remains a closed unavailability.
        }
      }
      return new ProjectAdministrationError('UNAVAILABLE', `${operation} is unavailable`)
    }
  }
  return new ProjectAdministrationError('INTERNAL', `${operation} failed`)
}

/** Package-private projection of known package-local preparation failures. */
export function scopePrivatePackagePlanningError(error: unknown, packagePath: string): unknown {
  if (!(error instanceof CheckError) || error.kind !== 'unavailable') {
    return error
  }
  const relativePath =
    error.code === 'PACKAGE_BUN_SOURCE_UNSUPPORTED' && error.path === 'bun.lock'
      ? 'bun.lock'
      : error.code === 'PACKAGE_BUN_PREPARATION_FAILED' && error.path === undefined
        ? 'package.json'
        : undefined
  if (relativePath === undefined) return error
  return new CheckError(
    error.kind,
    error.code,
    error.message,
    `${packagePath}/${relativePath}`,
    error.pointer,
  )
}

function isUnavailableDiagnosticCode(code: string): boolean {
  return (
    code === 'PACKAGE_BUN_SOURCE_UNSUPPORTED' ||
    code === 'PACKAGE_BUN_PREPARATION_FAILED' ||
    code === 'PROJECT_AGENT_UNAVAILABLE'
  )
}

function isCandidateDiagnosticCode(code: string): boolean {
  return (
    code.startsWith('CAPABILITY_') ||
    code.startsWith('METADATA_') ||
    code.startsWith('SCHEMA_') ||
    code.startsWith('PACKAGE_BUN_') ||
    code.startsWith('PROJECT_BINDING_') ||
    code.startsWith('PROJECT_DECLARATION_') ||
    code.startsWith('PROJECT_EVALUATION_') ||
    code.startsWith('PROJECT_EVALUATOR_') ||
    code.startsWith('PROJECT_MEMBER_') ||
    code.startsWith('PROJECT_SOURCE_') ||
    [
      'PACKAGE_ENTRYPOINT_AMBIGUOUS',
      'PACKAGE_FILE_LIMIT',
      'PACKAGE_FLOW_MISSING',
      'PACKAGE_HARDLINK',
      'PACKAGE_LIMIT',
      'PACKAGE_PATH',
      'PACKAGE_PATH_COLLISION',
      'PACKAGE_PATH_LIMIT',
      'PACKAGE_PATH_NFC',
      'PACKAGE_PATH_UTF8',
      'PACKAGE_REFERENCE_MISSING',
      'PACKAGE_ROOT',
      'PACKAGE_SELECTOR',
      'PACKAGE_SPECIAL_FILE',
      'PACKAGE_SYMLINK',
      'PROJECT_FLOW_CAPABILITY_UNSUPPORTED',
      'PROJECT_FLOW_COLLISION',
      'PROJECT_FLOW_MODE_UNSUPPORTED',
    ].includes(code)
  )
}

function isRootIdentityLoss(error: unknown, owner: PrivateProjectSessionOwner): boolean {
  return (
    error instanceof CheckError &&
    (error.code === 'COORDINATOR_PROJECT_MISMATCH' ||
      (error.code === 'PROJECT_SOURCE_CHANGED' && error.path === owner.root.requestedPath))
  )
}

function currentEuid(): number {
  if (typeof process.geteuid !== 'function') {
    throw new ProjectAdministrationError(
      'UNAVAILABLE',
      'project ownership requires a Unix user identity',
    )
  }
  return process.geteuid()
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === code
  )
}
