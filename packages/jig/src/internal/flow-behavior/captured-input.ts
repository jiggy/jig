import { dirname, join } from 'node:path'
import type { JsonValue } from '../../json.js'
import type { CapturedFlowMember } from '../../project/flow-source.js'
import { resolveInvocationSlots } from '../../project/invocation-slots.js'
import type { PackageProjectValue } from '../../project/package-project.js'
import { flowSelector } from '../../project/package-selector.js'
import { SchemaDiagnostic } from '../../schema/index.js'
import { analyzeFlowBehavior } from './compose.js'
import { captureReportingProfile } from './reporting-capture.js'
import {
  BEHAVIOR_LIMITS,
  type BehaviorPackage,
  type BehaviorReport,
  type BehaviorTarget,
} from './model.js'

/** Read only through the package descriptors owned by working-tree inspection. */
export async function prepareFlowBehavior(
  directory: string,
  revision: string,
  focus: string | undefined,
  visible: readonly string[],
  project: PackageProjectValue,
  members: readonly CapturedFlowMember[],
  signal?: AbortSignal,
): Promise<BehaviorReport> {
  const byPackage = new Map(project.flows.map((f) => [f.provenance.projectPath, f]))
  const targets: BehaviorTarget[] = []
  function target(
    id: string,
    implementation: string,
    settings: JsonValue,
    configured?: PackageProjectValue['bindings'][number]['slots'],
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
    targets.push({
      id,
      implementation,
      settings,
      slots,
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
  if (focus !== undefined) {
    const known = new Map(targets.map((item) => [item.id, item]))
    const qualified = new Map(members.map((member) => [member.provenance.projectPath, member]))
    const selected = new Set([focus, ...visible])
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
      const entry = member.inspected.entrypoint.path
      const sources = new Map<string, string>()
      const reportingFiles = new Set<string>()
      const files = member.captured.files.filter(
        (f) => f.path.endsWith('.ts') && !f.path.endsWith('.d.ts'),
      )
      const unavailable = !entry.endsWith('.ts')
        ? 'This entrypoint language is outside the supported subset.'
        : implementation.startsWith('npm:')
          ? 'Installed implementation is opaque to source behavior inspection.'
          : packages.size >= BEHAVIOR_LIMITS.packages ||
              files.length > BEHAVIOR_LIMITS.filesPerPackage ||
              files.some((f) => f.size > BEHAVIOR_LIMITS.fileBytes) ||
              files.reduce((n, f) => n + f.size, 0) > bytes
            ? 'The implementation exceeds source analysis limits.'
            : undefined
      if (unavailable === undefined)
        for (const file of files) {
          signal?.throwIfAborted()
          const data = await member.captured.read(file.path, BEHAVIOR_LIMITS.fileBytes)
          bytes -= data.byteLength
          sources.set(file.path, new TextDecoder('utf-8', { fatal: true }).decode(data))
        }
      if (
        [...sources.values()].some((source) => source.includes('@jigging/reporting')) &&
        member.captured.files.some((file) => file.path === 'package.json' && file.size <= 8192)
      ) {
        try {
          const manifest = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(
              await member.captured.read('package.json', 8192),
            ),
          )
          if (typeof manifest?.dependencies?.['@jigging/reporting'] === 'string')
            for (const [file, source] of sources) {
              if (!source.includes('@jigging/reporting')) continue
              const from = dirname(join(directory, implementation, file))
              if (!reporting.has(from))
                reporting.set(
                  from,
                  (await captureReportingProfile(directory, from, signal)) !== undefined,
                )
              if (reporting.get(from)) reportingFiles.add(file)
            }
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error
        }
      }
      const schema = member.inspected.schemas.result
      packages.set(implementation, {
        entry,
        sources,
        reportingFiles,
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
      })
    }
  }
  return analyzeFlowBehavior({ revision, focus, targets, visible, packages }, signal)
}
