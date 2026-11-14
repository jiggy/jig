import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { FlowContextOptions } from '../cli-flow-context.js'
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
import { inspectPackageProject } from '../project/package-project.js'
import { flowSelector, npmPackageName } from '../project/package-selector.js'
import { isProtectedProjectPath } from '../project/paths.js'
import { retainFlowSourcePackages } from '../project/retained-flow.js'
import { openPrivateProjectRoot } from '../project/root.js'
import { privateDomainDigest } from './identity.js'

/** Capture and link current authoring with the ordinary resolver. Never opens admission state. */
export async function inspectWorkingFlow(
  project: string,
  evaluator: PrivateAuthorEvaluatorOptions,
  options: FlowContextOptions = {},
  signal?: AbortSignal,
): Promise<JsonValue> {
  const root = await openPrivateProjectRoot(project)
  let temporary: string | undefined
  let authoring: Awaited<ReturnType<typeof captureProjectAuthoring>> | undefined
  let metadata: Awaited<ReturnType<typeof captureOpenedPackageDirectory>> | undefined
  let flows: Awaited<ReturnType<typeof captureOpenedFlowSource>> | undefined
  const dependencies: (CapturedFlowMember & { installedVersion: string | null })[] = []
  let operationFailure: unknown
  try {
    signal?.throwIfAborted()
    const jigRequirement = await captureProjectJigRequirement(root)
    authoring = await captureProjectAuthoring(root, evaluator, signal)
    temporary = await mkdtemp(join(tmpdir(), 'jig-flow-inspection-'))
    temporary = await realpath(temporary)
    const store = join(temporary, 'packages')
    await mkdir(store, { mode: 0o700 })
    const { project: declaration, bindingSource, evaluations, closure } = authoring
    const grants = await captureGrantSource(root, declaration.value.grants)
    const selectors = new Set<string>()
    const select = (value: string) => {
      if (value.startsWith('npm:')) {
        npmPackageName(value)
        selectors.add(value)
      }
    }
    const bindings = []
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
    const source = {
      observations: [],
      members: [...flows.members, ...dependencies],
      async dispose() {},
    }
    const retained = await retainFlowSourcePackages(store, source)
    const linked = inspectPackageProject({
      flows: retained,
      bindings,
      grants: grants.grants,
      ...(declaration.value.entrypoint === undefined
        ? {}
        : { entrypoint: declaration.value.entrypoint }),
      ...(declaration.value.defaultProviders === undefined
        ? {}
        : { defaultProviders: declaration.value.defaultProviders }),
    })
    const flowByPath = new Map(linked.flows.map((flow) => [flow.provenance.projectPath, flow]))
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
    )
      invalid('INSPECTION_TARGET_MISSING', 'target is absent from the working-tree configuration')
    const targets: JsonValue[] = []
    for (const request of requests) {
      targets.push({
        target: selector(request.target),
        package: request.packagePath,
        state: 'unreviewed',
        flow: {
          digest: retained.find((member) => member.provenance.projectPath === request.packagePath)!
            .package.digest,
          ...(dependencies.find(
            (dependency) => dependency.provenance.projectPath === request.packagePath,
          )
            ? {
                installedDependency: {
                  version: dependencies.find(
                    (dependency) => dependency.provenance.projectPath === request.packagePath,
                  )!.installedVersion,
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
    await bindingSource.verify()
    await grants.verify()
    await jigRequirement.verify()
    await root.verify()
    signal?.throwIfAborted()
    return {
      basis: 'working-tree',
      state: 'unreviewed',
      revision: privateDomainDigest('JIG-Working-Flow-Inspection/1', {
        declarations: closure.closureDigest,
        evaluations: evaluations.map((value) => value.outputDigest),
        packages: retained.map((value) => ({
          path: value.provenance.projectPath,
          digest: value.package.digest,
        })),
        grants: grants.grants as unknown as JsonValue,
        dependencyDeclarations: metadata?.digest ?? null,
      }),
      ...(declaration.value.entrypoint === undefined
        ? {}
        : { entrypoint: declaration.value.entrypoint }),
      targets,
    }
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
    if (temporary !== undefined) {
      try {
        await rm(temporary, { recursive: true, force: true })
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length)
      // biome-ignore lint/correctness/noUnsafeFinally: Cleanup failure prevents success and preserves the original operation error.
      throw new AggregateError(
        operationFailure === undefined ? failures : [operationFailure, ...failures],
        'working-tree inspection cleanup could not finish',
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
