import { realpath } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import { invalid } from '../diagnostics.js'
import type { JsonValue } from '../json.js'
import { captureOpenedPackageDirectory } from '../package/capture.js'
import { inspectCapturedPackage } from '../package/inspect.js'
import type { BindingDefinition } from '../project/author.js'
import type {
  EvaluatedAuthorDeclaration,
  PrivateAuthorEvaluatorOptions,
} from '../project/author-evaluator.js'
import { captureProjectAuthoring } from '../project/captured-authoring.js'
import { parseProjectEntrypoint } from '../project/entrypoint.js'
import { type CapturedFlowMember, captureOpenedFlowSource } from '../project/flow-source.js'
import { captureGrantSource } from '../project/grant-source.js'
import { resolveInvocationSlots } from '../project/invocation-slots.js'
import { captureProjectJigRequirement } from '../project/jig-version.js'
import {
  type InjectedBindingDeclaration,
  inspectPackageProject,
  type PackageProjectInspection,
} from '../project/package-project.js'
import { flowSelector, npmPackageName } from '../project/package-selector.js'
import { isProtectedProjectPath } from '../project/paths.js'
import { openPrivateProjectRoot, type PrivateProjectRoot } from '../project/root.js'
import type { BehaviorReport } from './flow-behavior/model.js'
import { findFlowImportBoundary } from './flow-import-boundary.js'
import {
  type FlowContextOptions,
  type FlowInspectionOptions,
  resolveFlowInspectionPath,
  selectFlowContext,
} from './flow-inspection-scope.js'
import { privateDomainDigest } from './identity.js'
import { PRIVATE_FLOW_CONTEXT_LIMITS } from './inspection-policy.js'

/** Capture and link current authoring with the ordinary resolver. Never opens admission state. */
export function inspectWorkingFlow(
  project: string,
  evaluator: PrivateAuthorEvaluatorOptions,
  options: FlowInspectionOptions = {},
  signal?: AbortSignal,
): Promise<{ topology: JsonValue; scope: FlowContextOptions }> {
  return captureWorkingFlow(
    project,
    evaluator,
    options,
    (topology, scope) => ({ topology, scope }),
    signal,
  )
}

export type WorkingFlowReport =
  | { kind: 'index'; topology: JsonValue; bindingDeclarations: ReadonlyMap<string, string> }
  | { kind: 'behavior'; behavior: BehaviorReport }

export function inspectWorkingFlowReport(
  project: string,
  evaluator: PrivateAuthorEvaluatorOptions,
  options: FlowInspectionOptions,
  signal?: AbortSignal,
): Promise<WorkingFlowReport> {
  return captureWorkingFlow<WorkingFlowReport>(
    project,
    evaluator,
    options,
    async (topology, scope, linked, members) => {
      const selection = selectFlowContext(topology, scope)
      if (selection.focus === undefined && scope.packagePath === undefined && !scope.all)
        return {
          kind: 'index',
          topology,
          bindingDeclarations: new Map(
            linked.bindings.map((binding) => ['binding:' + binding.id, binding.declarationPath]),
          ),
        }

      const behavior = await inspectBehavior(project, scope, selection, linked, members, signal)
      return { kind: 'behavior', behavior }
    },
    signal,
  )
}

async function inspectBehavior(
  project: string,
  options: FlowContextOptions,
  selection: ReturnType<typeof selectFlowContext>,
  linked: PackageProjectInspection,
  members: readonly CapturedFlowMember[],
  signal?: AbortSignal,
): Promise<BehaviorReport> {
  if (
    selection.included.length > PRIVATE_FLOW_CONTEXT_LIMITS.targets ||
    selection.edges.length > PRIVATE_FLOW_CONTEXT_LIMITS.connections
  )
    return {
      revision: String(selection.snapshot.revision),
      focus: selection.focus,
      inventory: [],
      childPaths: [],
      scopes: [],
      unavailable:
        options.packagePath === undefined
          ? 'This view exceeds the presentation limits. Inspect a smaller target.'
          : 'Package inspection exceeds the presentation limits. Add --json for the complete configured records.',
    }

  const { prepareFlowBehavior } = await import('./flow-behavior/captured-input.js')
  const report = await prepareFlowBehavior(
    resolve(project),
    String(selection.snapshot.revision),
    selection.focus,
    selection.entrypoint,
    selection.included.map((item) => String(item.target)),
    linked,
    members,
    signal,
    options.packagePath,
  )
  const orientation = selection.focus ?? selection.entrypoint
  const sourcePackage =
    options.packagePath ?? selection.included.find((item) => item.target === orientation)?.package
  if (typeof sourcePackage !== 'string' || sourcePackage.startsWith('npm:')) return report
  const source = members.find((member) => member.provenance.projectPath === sourcePackage)
  if (source === undefined) return report
  const boundary = await findFlowImportBoundary(source.captured, source.inspected.entrypoint.path, {
    signal,
  })
  if (boundary === undefined) return report
  const importedPath = posix.join(sourcePackage, boundary.target)
  const targetPackage = linked.flows.find(({ provenance }) =>
    importedPath.startsWith(provenance.projectPath + '/'),
  )?.provenance.projectPath
  return {
    ...report,
    importBoundary: {
      ...boundary,
      sourcePackage,
      ...(targetPackage === undefined ? {} : { targetPackage }),
    },
  }
}

async function captureWorkingFlow<T>(
  project: string,
  evaluator: PrivateAuthorEvaluatorOptions,
  options: FlowInspectionOptions,
  projectResult: (
    topology: JsonValue,
    scope: FlowContextOptions,
    linked: PackageProjectInspection,
    members: readonly CapturedFlowMember[],
  ) => T | Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  return captureWorkingProject(
    project,
    evaluator,
    async ({ linked, members, dependencies, revision }) => {
      const flowByPath = new Map(linked.flows.map((flow) => [flow.provenance.projectPath, flow]))
      if (options.packagePath !== undefined && !flowByPath.has(options.packagePath))
        invalid(
          'INSPECTION_PACKAGE_MISSING',
          'Flow package is absent from the working-tree configuration.',
        )
      const requests = [
        ...linked.flows
          .filter((flow) => flow.directRun)
          .map((flow) => ({
            target: { kind: 'flow' as const, path: flow.provenance.projectPath },
            packagePath: flow.provenance.projectPath,
            settings: {},
            slots: resolveInvocationSlots(flow.uses, flow.slots ?? {}),
            attachments: flow.invocation.attachments ?? {},
            artifactResults: flow.invocation.artifactResults ?? [],
          })),
        ...linked.bindings.map((binding) => {
          const flow = flowByPath.get(binding.packagePath)!
          return {
            target: { kind: 'binding' as const, id: binding.id },
            packagePath: binding.packagePath,
            settings: binding.settings,
            slots: resolveInvocationSlots(flow.uses, binding.slots),
            attachments: flow.invocation.attachments ?? {},
            artifactResults: flow.invocation.artifactResults ?? [],
          }
        }),
      ]
      if (
        options.target !== undefined &&
        !requests.some((r) => selector(r.target) === options.target)
      ) {
        const packagePath = [...flowByPath.keys()].find(
          (path) => flowSelector(path) === options.target,
        )
        if (packagePath !== undefined)
          invalid(
            'INSPECTION_PACKAGE_SCOPE_REQUIRED',
            'This package has no direct target in the captured configuration.',
            packagePath,
          )
        invalid('INSPECTION_TARGET_MISSING', 'target is absent from the working-tree configuration')
      }
      const targets: ({ target: string; package: string } & Record<string, JsonValue>)[] = []
      const memberByPath = new Map(members.map((member) => [member.provenance.projectPath, member]))
      const dependencyByPath = new Map(
        dependencies.map((member) => [member.provenance.projectPath, member]),
      )
      for (const request of requests) {
        const dependency = dependencyByPath.get(request.packagePath)
        targets.push({
          target: selector(request.target),
          package: request.packagePath,
          state: 'unreviewed',
          flow: {
            digest: memberByPath.get(request.packagePath)!.captured.digest,
            ...(dependency
              ? {
                  installedDependency: {
                    version: dependency.installedVersion,
                    agreement: 'unchecked',
                  },
                }
              : {}),
            settings: request.settings,
            routes: Object.entries(request.slots).map(([slot, route]) =>
              route.kind === 'flow'
                ? { slot, target: selector(route.target) }
                : { slot, resource: route.native },
            ),
          },
        })
      }
      const topology: JsonValue = {
        basis: 'working-tree',
        state: 'unreviewed',
        revision,
        ...(linked.entrypoint === undefined ? {} : { entrypoint: linked.entrypoint }),
        targets,
      }
      const { pathOperand, ...requested } = options
      let scope = requested
      if (pathOperand !== undefined) {
        const binding = linked.bindings.find(
          ({ declarationPath }) => declarationPath === pathOperand,
        )
        scope = binding
          ? { target: 'binding:' + binding.id }
          : await resolveFlowInspectionPath(
              pathOperand,
              targets,
              (path) => memberByPath.has(path),
              (path, file) =>
                memberByPath.get(path)!.captured.files.some((entry) => entry.path === file),
              'working-tree configuration',
            )
      }
      return await projectResult(topology, scope, linked, members)
    },
    signal,
  )
}

type CapturedBinding = InjectedBindingDeclaration & { readonly definition: BindingDefinition }

type WorkingProjectCapture = {
  readonly root: PrivateProjectRoot
  readonly authoring: Awaited<ReturnType<typeof captureProjectAuthoring>>
  readonly bindings: readonly CapturedBinding[]
  readonly linked: PackageProjectInspection
  readonly link: (bindings: readonly InjectedBindingDeclaration[]) => PackageProjectInspection
  readonly members: readonly CapturedFlowMember[]
  readonly dependencies: readonly (CapturedFlowMember & { installedVersion: string | null })[]
  readonly revision: string
}

/** Capture the working configuration and link proposed Binding values against those same facts. */
export async function captureWorkingProject<T>(
  project: string,
  evaluator: PrivateAuthorEvaluatorOptions,
  projectResult: (facts: WorkingProjectCapture) => T | Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const root = await openPrivateProjectRoot(project)
  let authoring: Awaited<ReturnType<typeof captureProjectAuthoring>> | undefined
  let metadata: Awaited<ReturnType<typeof captureOpenedPackageDirectory>> | undefined
  let flows: Awaited<ReturnType<typeof captureOpenedFlowSource>> | undefined
  const dependencies: (CapturedFlowMember & { installedVersion: string | null })[] = []
  let operationFailure: unknown
  try {
    signal?.throwIfAborted()
    const jigRequirement = await captureProjectJigRequirement(root)
    authoring = await captureProjectAuthoring(root, evaluator, signal)
    const { project: declaration, bindingSource, evaluations, closure } = authoring
    const grants = await captureGrantSource(root, declaration.value.grants)
    const selectors = new Set<string>()
    const select = (value: string) => {
      if (value.startsWith('npm:')) {
        npmPackageName(value)
        selectors.add(value)
      }
    }
    const bindings: CapturedBinding[] = []
    for (const [index, member] of bindingSource.members.entries()) {
      const definition = (evaluations[index + 1] as EvaluatedAuthorDeclaration<BindingDefinition>)
        .value
      select(definition.package)
      for (const target of Object.values(definition.slots)) {
        if (typeof target === 'string') select(target)
        else if ('target' in target) select(target.target)
      }
      bindings.push({ sourcePath: member.projectPath, definition })
    }
    const configured = declaration.value.flows
    if (configured?.kind === 'members') for (const value of configured.paths) select(value)
    for (const target of Object.values(declaration.value.defaultProviders ?? {})) select(target)
    // Entrypoint parsing stays owned by the ordinary linker.
    if (declaration.value.entrypoint !== undefined) {
      const entry = parseProjectEntrypoint(declaration.value.entrypoint).target
      if (entry.kind === 'flow') select(entry.path)
    }
    flows = await captureOpenedFlowSource(
      root,
      configured?.kind === 'members'
        ? { kind: 'members', paths: configured.paths.filter((path) => !path.startsWith('npm:')) }
        : configured,
    )
    if (selectors.size > 256)
      invalid('PROJECT_DEPENDENCY_LIMIT', 'too many selected package dependencies')
    let declarations: Record<string, unknown> = {}
    if (selectors.size) {
      metadata = await captureOpenedPackageDirectory(
        'project dependency declarations',
        root.handle,
        { includes: (path) => path === 'package.json', maximumFiles: 1, maximumBytes: 1048576 },
      )
      const manifest = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          await metadata.read('package.json', 1048576),
        ),
      )
      declarations = manifest.dependencies ?? {}
    }
    for (const selector of selectors) {
      signal?.throwIfAborted()
      dependencies.push(await captureInstalledFlow(root.requestedPath, selector, declarations))
    }
    const members = [...flows.members, ...dependencies]
    const link = (selected: readonly InjectedBindingDeclaration[]) =>
      inspectPackageProject({
        flows: members,
        bindings: selected,
        grants: grants.grants,
        ...(declaration.value.entrypoint === undefined
          ? {}
          : { entrypoint: declaration.value.entrypoint }),
        ...(declaration.value.defaultProviders === undefined
          ? {}
          : { defaultProviders: declaration.value.defaultProviders }),
      })
    const linked = link(bindings)
    await bindingSource.verify()
    await grants.verify()
    await jigRequirement.verify()
    await root.verify()
    signal?.throwIfAborted()
    const revision = privateDomainDigest('JIG-Working-Flow-Inspection/1', {
      declarations: closure.closureDigest,
      evaluations: evaluations.map((value) => value.outputDigest),
      packages: members.map((value) => ({
        path: value.provenance.projectPath,
        digest: value.captured.digest,
      })),
      grants: grants.grants as unknown as JsonValue,
      dependencyDeclarations: metadata?.digest ?? null,
    })
    return await projectResult({
      root,
      authoring,
      bindings,
      linked,
      link,
      members,
      dependencies,
      revision,
    })
  } catch (error) {
    operationFailure = error
    throw error
  } finally {
    const results = await Promise.allSettled([
      metadata?.dispose(),
      flows?.dispose(),
      ...dependencies.map((m) => m.captured.dispose()),
      root.dispose(),
    ])
    authoring?.bootstrap.dispose()
    authoring?.closure.dispose()
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (failures.length)
      // biome-ignore lint/correctness/noUnsafeFinally: Cleanup failure prevents success and preserves the original operation error.
      throw new AggregateError(
        operationFailure === undefined ? failures : [operationFailure, ...failures],
        'working-tree capture cleanup could not finish',
      )
  }
}
function selector(
  target: { kind: 'flow'; path: string } | { kind: 'binding'; id: string },
): string {
  return target.kind === 'binding' ? 'binding:' + target.id : flowSelector(target.path)
}

/** Read an already installed, declared dependency using ordinary node_modules ancestry. No installer or module import. */
async function captureInstalledFlow(
  project: string,
  selected: string,
  declarations: Record<string, unknown>,
): Promise<CapturedFlowMember & { installedVersion: string | null }> {
  const name = npmPackageName(selected)
  if (typeof declarations[name] !== 'string')
    invalid(
      'PROJECT_DEPENDENCY_MISSING',
      'npm Flow target must be a declared project dependency',
      selected,
    )
  for (let directory = resolve(project); ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name)
    let location: string
    try {
      location = await realpath(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (dirname(directory) === directory) break
      continue
    }
    if (location.split('/').some(isProtectedProjectPath))
      invalid(
        'PROJECT_DEPENDENCY_PROTECTED',
        'installed dependency selects protected state',
        selected,
      )
    const opened = await openPrivateProjectRoot(location)
    try {
      const captured = await captureOpenedPackageDirectory(selected, opened.handle, {
        includes: (path) =>
          !path.split('/').some((part) => part === 'node_modules' || isProtectedProjectPath(part)),
        maximumFiles: 65536,
        maximumBytes: 4294967296,
      })
      try {
        const metadata = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            await captured.read('package.json', 1048576),
          ),
        )
        if (metadata.name !== name)
          invalid(
            'PROJECT_DEPENDENCY_IDENTITY',
            'installed dependency name differs from its selection',
            selected,
          )
        const inspected = await inspectCapturedPackage(captured)
        await opened.verify()
        if ((await realpath(candidate)) !== location)
          invalid('PROJECT_SOURCE_CHANGED', 'installed dependency changed during capture', selected)
        return {
          provenance: { membership: 'exact', projectPath: selected },
          captured,
          inspected,
          installedVersion: typeof metadata.version === 'string' ? metadata.version : null,
        }
      } catch (error) {
        await captured.dispose()
        throw error
      }
    } finally {
      await opened.dispose()
    }
  }
  return invalid(
    'PROJECT_DEPENDENCY_MISSING',
    'selected dependency is not installed; inspect its project dependency declaration',
    selected,
  )
}
