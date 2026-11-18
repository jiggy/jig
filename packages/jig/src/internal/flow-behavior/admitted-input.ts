import { posix } from 'node:path'
import type { DisplayComposition } from '@jigging/display-model'
import { inspectCapturedPackage } from '../../package/inspect.js'
import type { RunTargetIdentity } from '../../project/package-project.js'
import { flowSelector } from '../../project/package-selector.js'
import type { PrivateActivationCandidateArtifactV5 } from '../activation-admission.js'
import type { PrivateBunExecutionArtifact } from '../bun-execution-layout.js'
import type { PrivateFileLocation } from '../descriptor-files.js'
import { captureStoredPackage } from '../package-artifact-store.js'
import { readBehaviorPackage } from './captured-input.js'
import { analyzeFlowBehavior } from './compose.js'
import {
  BEHAVIOR_LIMITS,
  type BehaviorPackage,
  type BehaviorReport,
  type BehaviorTarget,
} from './model.js'
import { matchesReportingProfile } from './reporting-capture.js'

const selector = (target: RunTargetIdentity): string =>
  target.kind === 'flow' ? flowSelector(target.path) : 'binding:' + target.id
const key = (target: RunTargetIdentity): string =>
  JSON.stringify([target.kind, target.kind === 'flow' ? target.path : target.id])

/** Inspect retained source and its selected execution dependencies without loading either. */
export async function prepareAdmittedFlowBehavior(
  store: PrivateFileLocation,
  admission: PrivateActivationCandidateArtifactV5,
  composition: Extract<DisplayComposition, { state: 'available' }>,
  signal?: AbortSignal,
): Promise<{ report: BehaviorReport; nodes: ReadonlyMap<string, string> }> {
  const byNode = new Map(
    admission.candidate.targets.map((entry) => [key(entry.request.target), entry]),
  )
  const nodes = new Map<string, string>()
  const targets: BehaviorTarget[] = []
  const packages = new Map<string, BehaviorPackage>()
  const outcomes = new Map<string, string[]>()
  let bytes: number = BEHAVIOR_LIMITS.sourceBytes
  for (const node of composition.nodes) {
    signal?.throwIfAborted()
    if (node.kind === 'resource') continue
    const entry = byNode.get(node.id)
    if (!entry) continue
    const { request, disposition } = entry
    const id = selector(request.target)
    nodes.set(id, node.id)
    const implementation = request.packagePath
    if (!packages.has(implementation) && packages.size < BEHAVIOR_LIMITS.packages && bytes > 0) {
      const captured = await captureStoredPackage(store, request.package)
      let execution: Awaited<ReturnType<typeof captureStoredPackage>> | undefined
      try {
        const inspected = await inspectCapturedPackage(captured)
        outcomes.set(implementation, ['done', ...Object.keys(inspected.invocation?.outcomes ?? {})])
        const read = await readBehaviorPackage(
          implementation,
          captured,
          inspected,
          { bytes, packages: packages.size },
          async (file) => {
            if (
              disposition.state !== 'ready' ||
              disposition.execution.package.digest === request.package.digest
            )
              return false
            execution ??= await captureStoredPackage(store, disposition.execution.package)
            return verifyExecutionReporting(execution, disposition.execution, file)
          },
          signal,
        )
        packages.set(implementation, read.package)
        bytes -= read.bytes
      } finally {
        try {
          await execution?.dispose()
        } finally {
          await captured.dispose()
        }
      }
    }
    targets.push({
      id,
      implementation,
      settings: request.settings,
      slots: new Map(
        Object.entries(request.slots).map(([slot, route]) => [
          slot,
          route.kind === 'native' ? route.native : selector(route.target),
        ]),
      ),
      outcomes: outcomes.get(implementation) ?? ['done'],
      attachments: request.attachments,
      artifactResults: request.artifactResults ?? [],
    })
  }
  const focus = targets[0]?.id
  return {
    report: analyzeFlowBehavior(
      {
        revision: admission.candidate.lockDigest,
        focus,
        targets,
        packages,
        visible: targets.slice(0, BEHAVIOR_LIMITS.scopes).map((target) => target.id),
      },
      signal,
    ),
    nodes,
  }
}

async function verifyExecutionReporting(
  captured: Awaited<ReturnType<typeof captureStoredPackage>>,
  execution: PrivateBunExecutionArtifact,
  file: string,
): Promise<boolean> {
  const layout = execution.layout
  let directory = posix.dirname(posix.join(layout.flowRoot, file))
  for (;;) {
    const path = posix.join(directory, 'node_modules/@jigging/reporting')
    const alias = layout.aliases.find((entry) => entry.path === path)
    if (alias || captured.files.some((file) => file.path.startsWith(path + '/')))
      return matchesReportingProfile(captured, alias?.target ?? path)
    if (directory === '.') return false
    directory = posix.dirname(directory)
  }
}
