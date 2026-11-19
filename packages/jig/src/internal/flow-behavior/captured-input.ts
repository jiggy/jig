import { dirname, join } from 'node:path'
import type { JsonValue } from '../../json.js'
import type { CapturedPackage } from '../../package/capture.js'
import type { InspectedPackage } from '../../package/inspect.js'
import type { CapturedFlowMember } from '../../project/flow-source.js'
import { resolveInvocationSlots } from '../../project/invocation-slots.js'
import type { PackageProjectInspection } from '../../project/package-project.js'
import { flowSelector } from '../../project/package-selector.js'
import { SchemaDiagnostic } from '../../schema/index.js'
import { analyzeFlowBehavior, applicationScopeOrder } from './compose.js'
import { inputFromContract } from './input-contract.js'
import {
  BEHAVIOR_LIMITS,
  type BehaviorPackage,
  type BehaviorReport,
  type BehaviorTarget,
} from './model.js'
import { captureReportingProfile } from './reporting-capture.js'

/** Read only through the package descriptors owned by working-tree inspection. */
export async function prepareFlowBehavior(
  directory: string,
  revision: string,
  focus: string | undefined,
  entrypoint: string | undefined,
  visible: readonly string[],
  project: PackageProjectInspection,
  members: readonly CapturedFlowMember[],
  signal?: AbortSignal,
  packagePath?: string,
): Promise<BehaviorReport> {
  const byPackage = new Map(project.flows.map((f) => [f.provenance.projectPath, f]))
  const targets: BehaviorTarget[] = []
  function target(
    id: string,
    implementation: string,
    settings: JsonValue,
    configured?: PackageProjectInspection['bindings'][number]['slots'],
  ) {
    const flow = byPackage.get(implementation)!
    const slots = new Map(
      Object.entries(resolveInvocationSlots(flow.uses, configured ?? flow.slots ?? {})).map(
        ([name, route]) => [
          name,
          route.kind === 'native'
            ? route.native
            : route.target.kind === 'binding'
              ? 'binding:' + route.target.id
              : flowSelector(route.target.path),
        ],
      ),
    )
    const requiredSlots = Object.entries(flow.uses)
      .filter(([, requirement]) => requirement.optional !== true)
      .map(([name]) => name)
      .sort()
    const declaration = implementation.startsWith('npm:')
      ? undefined
      : implementation + (flow.entrypoint?.suffix === 'md' ? '/FLOW.md' : '/FLOW.meta.json')
    targets.push({
      id,
      implementation,
      settings,
      slots,
      ...(requiredSlots.length
        ? {
            requiredSlots,
            ...(declaration === undefined ? {} : { slotDeclarationPath: declaration }),
          }
        : {}),
      outcomes: ['done', ...Object.keys(flow.invocation.outcomes ?? {})],
      attachments: flow.invocation.attachments ?? {},
      artifactResults: flow.invocation.artifactResults ?? [],
    })
  }
  for (const flow of project.flows)
    if (flow.directRun)
      target(flowSelector(flow.provenance.projectPath), flow.provenance.projectPath, {})
  for (const binding of project.bindings)
    target('binding:' + binding.id, binding.packagePath, binding.settings, binding.slots)

  const packages = new Map<string, BehaviorPackage>()
  const known = new Map(targets.map((item) => [item.id, item]))
  const qualified = new Map(members.map((member) => [member.provenance.projectPath, member]))
  const selected = new Set(
    focus !== undefined
      ? [focus, ...visible]
      : packagePath === undefined
        ? applicationScopeOrder(visible, known, entrypoint)
        : visible,
  )
  const pending = [...selected]
  for (const id of pending)
    for (const child of known.get(id)?.slots.values() ?? [])
      if (known.has(child) && !selected.has(child)) {
        selected.add(child)
        pending.push(child)
      }
  let bytes = BEHAVIOR_LIMITS.sourceBytes as number
  const reporting = new Map<string, boolean>()
  for (const id of selected) {
    signal?.throwIfAborted()
    const implementation = known.get(id)?.implementation
    if (implementation === undefined || packages.has(implementation)) continue
    const member = qualified.get(implementation)
    if (member === undefined) continue
    const read = await readBehaviorPackage(
      implementation,
      member.captured,
      member.inspected,
      { bytes, packages: packages.size },
      async (file) => {
        const from = dirname(join(directory, implementation, file))
        if (!reporting.has(from))
          reporting.set(
            from,
            (await captureReportingProfile(directory, from, signal)) !== undefined,
          )
        return reporting.get(from) ?? false
      },
      signal,
    )
    bytes -= read.bytes
    packages.set(implementation, read.package)
  }
  return analyzeFlowBehavior(
    {
      revision,
      focus,
      ...(packagePath === undefined ? {} : { packagePath }),
      ...(entrypoint === undefined ? {} : { entrypoint }),
      targets,
      visible,
      packages,
    },
    signal,
  )
}

/** Decode bounded TypeScript and contract facts from an already-owned capture. */
export async function readBehaviorPackage(
  implementation: string,
  captured: CapturedPackage,
  inspected: InspectedPackage,
  budget: Readonly<{ bytes: number; packages: number }>,
  reporting: (file: string) => Promise<boolean>,
  signal?: AbortSignal,
): Promise<{ bytes: number; package: BehaviorPackage }> {
  let bytes = 0
  const entry = inspected.entrypoint.path
  const sources = new Map<string, string>()
  const reportingFiles = new Set<string>()
  const files = captured.files.filter((f) => f.path.endsWith('.ts') && !f.path.endsWith('.d.ts'))
  const unavailable = !entry.endsWith('.ts')
    ? 'This entrypoint language is outside the supported subset.'
    : implementation.startsWith('npm:')
      ? 'Installed implementation is opaque to source behavior inspection.'
      : budget.packages >= BEHAVIOR_LIMITS.packages ||
          files.length > BEHAVIOR_LIMITS.filesPerPackage ||
          files.some((f) => f.size > BEHAVIOR_LIMITS.fileBytes) ||
          files.reduce((n, f) => n + f.size, 0) > budget.bytes
        ? 'The implementation exceeds source analysis limits.'
        : undefined
  if (unavailable === undefined)
    for (const file of files) {
      signal?.throwIfAborted()
      const data = await captured.read(file.path, BEHAVIOR_LIMITS.fileBytes)
      bytes += data.byteLength
      sources.set(file.path, new TextDecoder('utf-8', { fatal: true }).decode(data))
    }
  if (
    [...sources.values()].some((source) => source.includes('@jigging/reporting')) &&
    captured.files.some((file) => file.path === 'package.json' && file.size <= 8192)
  ) {
    try {
      const manifest = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(await captured.read('package.json', 8192)),
      )
      if (typeof manifest?.dependencies?.['@jigging/reporting'] === 'string')
        for (const [file, source] of sources) {
          if (!source.includes('@jigging/reporting')) continue
          if (await reporting(file)) reportingFiles.add(file)
        }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  const schema = inspected.schemas.result
  return {
    bytes,
    package: {
      entry,
      sources,
      reportingFiles,
      ...(inspected.invocation?.input === undefined
        ? {}
        : { acceptedInput: inputFromContract(inspected.invocation.input) }),
      ...(captured.files.some((file) => file.path === 'FLOW.contract.json')
        ? { contractPath: implementation + '/FLOW.contract.json' }
        : {}),
      ...(unavailable === undefined ? {} : { unavailable }),
      ...(schema === undefined
        ? {}
        : {
            checkResult(value: JsonValue) {
              try {
                schema.validate(value, 'INVALID_RESULT')
                return true
              } catch (error) {
                if (error instanceof SchemaDiagnostic) return false
                throw error
              }
            },
          }),
    },
  }
}
