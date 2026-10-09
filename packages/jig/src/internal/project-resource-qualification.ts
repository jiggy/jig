import { unavailable } from '../diagnostics.js'
import { parseRunTargetSelector } from '../project/author.js'
import { entrypointWords } from '../project/entrypoint.js'
import type { AcpGrant } from '../project/grants.js'
import type { PrivateActivationRequest } from '../project/package-resolution.js'
import type { PrivateRetainedPackageProject } from '../project/retained-project.js'
import { privateActivationTargetKey } from './activation-planning.js'
import type { PrivateInstalledBunSupport } from './installed-bun-support.js'
import { resolvePrivateNativeAgentExecutable } from './native-agent-executable.js'
import {
  type PrivateAcpResources,
  PrivateAcpResourceUnavailableError,
  selectPrivateAcpResources,
} from './private-acp-resources.js'
import {
  type PrivateRuntimeReadinessCause,
  privateResourceFailureEvidence,
} from './resource-qualification-evidence.js'
import type { PrivateAgentReadinessReport } from './review-agent-setup.js'

export interface PrivateRuntimeReadinessFailure {
  readonly state: 'unavailable'
  readonly code: 'RUNTIME_UNAVAILABLE'
  readonly cause: PrivateRuntimeReadinessCause
  readonly evidenceDigests: readonly string[]
}
/** Qualify selected resources once, then propagate only through exact captured edges. */
export async function qualifyPrivateProjectAcpResources(input: {
  readonly requests: readonly PrivateActivationRequest[]
  readonly resources: PrivateAcpResources | undefined
  readonly installedSupport: PrivateInstalledBunSupport
  readonly featureFailures: ReadonlyMap<string, string>
  readonly signal: AbortSignal
  readonly declarationFor?: (request: PrivateActivationRequest) => string
}): Promise<ReadonlyMap<string, PrivateRuntimeReadinessFailure>> {
  const failures = new Map<string, PrivateRuntimeReadinessFailure>()
  const byTarget = new Map(
    input.requests.map((request) => [privateActivationTargetKey(request.target), request]),
  )
  for (const request of input.requests) {
    input.signal.throwIfAborted()
    const key = privateActivationTargetKey(request.target)
    if (input.featureFailures.has(key)) continue
    try {
      await selectPrivateAcpResources(input.resources, request.slots, input.installedSupport)
    } catch (error) {
      input.signal.throwIfAborted()
      if (!(error instanceof PrivateAcpResourceUnavailableError)) throw error
      if (!error.expected)
        unavailable(
          error.code,
          error.message,
          input.declarationFor?.(request) ?? `${request.packagePath}/${request.entrypoint.path}`,
          `/slots/${error.slot.replaceAll('~', '~0').replaceAll('/', '~1')}`,
        )
      const route = request.slots[error.slot]
      if (route?.kind !== 'native' || route.native !== 'finite-acp' || route.grant?.kind !== 'acp')
        throw error
      const cause = Object.freeze({
        kind: 'acp' as const,
        slot: error.slot,
        client: route.grant.client,
        diagnostic: error.code,
      })
      failures.set(
        key,
        Object.freeze({
          state: 'unavailable',
          code: 'RUNTIME_UNAVAILABLE',
          cause,
          evidenceDigests: Object.freeze([privateResourceFailureEvidence(request, cause)]),
        }),
      )
    }
    input.signal.throwIfAborted()
  }
  const visited = new Set<string>()
  function visit(key: string): PrivateRuntimeReadinessFailure | undefined {
    if (visited.has(key)) return failures.get(key)
    visited.add(key)
    const request = byTarget.get(key)
    if (!request) throw new TypeError('resource qualification target missing')
    if (input.featureFailures.has(key)) return undefined
    for (const [slot, route] of Object.entries(request.slots).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      if (route.kind !== 'flow') continue
      const dependency = visit(privateActivationTargetKey(route.target))
      if (dependency === undefined || failures.has(key)) continue
      const child = byTarget.get(privateActivationTargetKey(route.target))!
      const cause = Object.freeze({ kind: 'dependency' as const, slot, target: route.target })
      failures.set(
        key,
        Object.freeze({
          state: 'unavailable',
          code: 'RUNTIME_UNAVAILABLE',
          cause,
          evidenceDigests: Object.freeze([
            privateResourceFailureEvidence(request, cause, {
              request: child,
              disposition: dependency,
            }),
          ]),
        }),
      )
    }
    return failures.get(key)
  }
  for (const key of byTarget.keys()) {
    input.signal.throwIfAborted()
    visit(key)
  }
  return failures
}

/** Private bounded authoring report; never serialize this through the Plan API. */
export async function privateAgentReadinessReport(input: {
  readonly aggregate: PrivateRetainedPackageProject
  readonly requests: readonly PrivateActivationRequest[]
  readonly failures: ReadonlyMap<string, PrivateRuntimeReadinessFailure>
  readonly featureFailures: ReadonlyMap<string, string>
  readonly alternatives?: readonly AcpGrant['client'][]
}): Promise<PrivateAgentReadinessReport> {
  const { aggregate } = input
  const issues: PrivateAgentReadinessReport['issues'][number][] = []
  let reportBytes = 512
  let complete = true
  for (const request of input.requests) {
    const cause = input.failures.get(privateActivationTargetKey(request.target))?.cause
    if (cause?.kind !== 'acp') continue
    const bindingId = request.target.kind === 'binding' ? request.target.id : undefined
    const binding =
      bindingId === undefined ? undefined : aggregate.bindings.find((b) => b.id === bindingId)
    const declaration = binding?.sourcePath ?? `${request.packagePath}/${request.entrypoint.path}`
    const selection = binding?.evaluation.value.slots?.[cause.slot]
    const name =
      typeof selection === 'string' && selection.startsWith('grant:')
        ? selection.slice(6)
        : undefined
    const file = name === undefined ? undefined : aggregate.grantFiles[name]
    const policy = name === undefined ? undefined : aggregate.grants[name]
    const recipients: { binding: string; declaration: string; slot: string }[] = []
    let recipientBytes = 0
    if (name !== undefined) {
      for (const b of aggregate.bindings) {
        for (const [slot, value] of Object.entries(b.evaluation.value.slots ?? {})) {
          if (value !== `grant:${name}`) continue
          const recipient = { binding: b.id, declaration: b.sourcePath, slot }
          recipientBytes += Buffer.byteLength(JSON.stringify(recipient)) + 1
          if (reportBytes + recipientBytes > 1_048_576) {
            complete = false
            break
          }
          recipients.push(recipient)
        }
        if (!complete) break
      }
    }
    if (!complete) break
    const issue = Object.freeze({
      target: request.target,
      declaration,
      slot: cause.slot,
      client: cause.client,
      code: cause.diagnostic,
      ...(file && policy?.kind === 'acp'
        ? {
            grant: Object.freeze({
              path: file.path,
              bytes: file.bytes.slice(),
              policy,
              recipients: Object.freeze(recipients),
            }),
          }
        : {}),
      alternatives: Object.freeze([...(input.alternatives ?? [])]),
    })
    const encodedBytes = Buffer.byteLength(JSON.stringify(issue))
    if (reportBytes + encodedBytes > 1_048_576) {
      complete = false
      break
    }
    reportBytes += encodedBytes
    issues.push(issue)
  }
  const unavailableTargets = new Set([...input.failures.keys(), ...input.featureFailures.keys()])
    .size
  const authoredEntrypoint = aggregate.project.value.entrypoint
  const entrypoint =
    authoredEntrypoint === undefined
      ? undefined
      : parseRunTargetSelector(entrypointWords(authoredEntrypoint)[0]!, 'entrypoint')
  const base = {
    ...(entrypoint === undefined
      ? {}
      : {
          entrypoint: Object.freeze({
            target: entrypoint,
            state:
              unavailableTargets !== 0 &&
              (input.failures.has(privateActivationTargetKey(entrypoint)) ||
                input.featureFailures.has(privateActivationTargetKey(entrypoint)))
                ? ('unavailable' as const)
                : ('ready' as const),
          }),
        }),
    projectIdentity: aggregate.root,
    readyTargets: input.requests.length - unavailableTargets,
    unavailableTargets,
  }
  // Charge the encoded form including byte arrays; no retained editable handles after overflow.
  if (!complete) return Object.freeze({ ...base, complete: false, issues: Object.freeze([]) })
  return Object.freeze({ ...base, complete: true, issues: Object.freeze(issues) })
}

/** Discovery observes operator executable locations, without executing a dispatcher. */
export async function privateDetectedAgentAlternatives(
  environment: Readonly<Record<string, string | undefined>>,
  project: string,
  selected: readonly AcpGrant['client'][],
): Promise<readonly AcpGrant['client'][]> {
  const detected: AcpGrant['client'][] = []
  for (const client of ['claude', 'codex', 'pi'] as const) {
    if (selected.includes(client)) continue
    try {
      await resolvePrivateNativeAgentExecutable(client, environment, project)
      detected.push(client)
    } catch {
      /* Detection is only an optional authoring hint, never readiness or authority. */
    }
  }
  return Object.freeze(detected)
}
