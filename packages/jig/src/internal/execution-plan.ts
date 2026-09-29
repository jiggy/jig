import { join } from 'node:path'
import type { PrivateExecutionIntent } from './execution-intent.js'
import type { PrivateLinuxLaunchPlan } from './linux-rootless-backend.js'
import type { PrivateMacosOwnerStateAllocationIdentity } from './macos-backend-state.js'
import type { PrivateMacosLaunchPlan } from './macos-native-backend.js'

/** Pure lowering only. Backends still authenticate, validate and seal all authority. */
export function privateLinuxExecutionPlan(intent: PrivateExecutionIntent): PrivateLinuxLaunchPlan {
  return {
    runId: intent.runId,
    limits: intent.limits,
    command: intent.command.map((value) => (typeof value === 'string' ? value : value.path)) as [
      string,
      ...string[],
    ],
    readOnlyMounts: [
      ...intent.projections.map(({ source, destination }) => ({ source, destination })),
      ...(intent.network === 'inherited'
        ? [{ source: '/etc/resolv.conf', destination: '/etc/resolv.conf' }]
        : []),
    ],
    ...(intent.environment === undefined ? {} : { environment: intent.environment }),
    ...(intent.network === undefined ? {} : { network: intent.network }),
    ...(intent.nestedUserNamespaces ? { nestedUserNamespaces: true } : {}),
    ...(intent.output === undefined ? {} : { output: intent.output }),
    ...(intent.capturedInputs === undefined ? {} : { capturedInputs: intent.capturedInputs }),
    ...(intent.inputDirectories === undefined ? {} : { inputDirectories: intent.inputDirectories }),
  }
}

export function privateMacosExecutionPlan(
  intent: PrivateExecutionIntent,
  allocation: PrivateMacosOwnerStateAllocationIdentity,
): PrivateMacosLaunchPlan {
  const data = join(allocation.directory, 'data')
  const mappings = intent.projections.map(
    ({ source, destination }) => [destination, source] as const,
  )
  const orderedMappings = [...mappings].sort((a, b) => b[0].length - a[0].length)
  const path = (value: string): string => {
    // Most-specific mapping wins; a sibling sharing a prefix is never relocated.
    const match = orderedMappings.find(
      ([destination]) => value === destination || value.startsWith(`${destination}/`),
    )
    if (match) return `${match[1]}${value.slice(match[0].length)}`
    for (const [logical, physical] of [
      ['/jig-input', join(data, 'inputs')],
      ['/jig-output', join(data, 'output')],
      ['/work', join(data, 'work')],
      ['/tmp', join(data, 'tmp')],
    ] as const)
      if (value === logical || value.startsWith(`${logical}/`))
        return `${physical}${value.slice(logical.length)}`
    return value
  }
  const embedded = (value: string): string => {
    let result = value
    for (const [destination, source] of mappings) result = result.split(destination).join(source)
    return result
      .split('/jig-output')
      .join(join(data, 'output'))
      .split('/tmp/')
      .join(`${join(data, 'tmp')}/`)
  }
  const environment = Object.fromEntries(
    Object.entries(intent.environment ?? {}).map(([name, value]) => [
      name,
      intent.relocateEnvironment ? embedded(value) : value,
    ]),
  )
  for (const [name, value] of Object.entries(intent.relocatedEnvironment ?? {}))
    environment[name] = path(value)
  if (intent.readOnlyCwd === undefined) environment.TMPDIR = join(data, 'tmp')
  const { cancellationGraceMs: _, ...limits } = intent.limits
  return {
    runId: intent.runId,
    limits: { ...limits, cleanupTimeoutMs: limits.cleanupTimeoutMs ?? 5000 },
    command: intent.command.map((value) =>
      typeof value === 'string' ? value : path(value.path),
    ) as [string, ...string[]],
    cwd: path(intent.readOnlyCwd ?? '/work'),
    environment,
    files: {
      readOnlyFiles: [
        ...new Set(intent.projections.filter((p) => p.kind === 'file').map((p) => p.source)),
      ],
      readOnlyTrees: [
        ...new Set([
          ...intent.projections.filter((p) => p.kind === 'tree').map((p) => p.source),
          ...((intent.inputDirectories?.length ?? 0) > 0 ? [join(data, 'inputs')] : []),
        ]),
      ],
      writableTrees:
        intent.readOnlyCwd === undefined
          ? [
              join(data, 'work'),
              join(data, 'tmp'),
              ...(intent.output ? [join(data, 'output')] : []),
            ]
          : [],
      protectedRoots: [join(allocation.directory, 'control')],
      network: intent.network ?? 'isolated',
    },
    maxOutputBytes: intent.maxOutputBytes,
    ...(intent.readOnlyCwd === undefined
      ? {
          storage: {
            mountPath: data,
            bytes: intent.storageBytes,
            collect: intent.output ? ('output' as const) : null,
          },
        }
      : {}),
    capturedInputs: (intent.capturedInputs ?? []).map(({ input, destination }) => ({
      input,
      path: inputPath(destination),
    })),
    inputDirectories: (intent.inputDirectories ?? []).map(inputPath),
  }
}

function inputPath(destination: string): string {
  if (!destination.startsWith('/jig-input/'))
    throw new TypeError('input projection is outside the input root')
  return destination.slice('/jig-input/'.length)
}
