import { unavailable } from '../diagnostics.js'
import { parseProjectEntrypoint } from '../project/entrypoint.js'
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
import type {
  PrivateAgentGrantRecipient,
  PrivateAgentReadinessIssue,
  PrivateAgentReadinessReport,
  PrivateAgentReviewSelection,
} from './review-agent-setup.js'

const rejectedExecutableOverrides = new WeakSet<PrivateRuntimeReadinessFailure>()

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
      const failure = Object.freeze({
        state: 'unavailable' as const,
        code: 'RUNTIME_UNAVAILABLE' as const,
        cause,
        evidenceDigests: Object.freeze([privateResourceFailureEvidence(request, cause)]),
      })
      if (error.overrideRejected) rejectedExecutableOverrides.add(failure)
      failures.set(key, failure)
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

const AGENT_REPORT_BYTES = 1_048_576

/** Private bounded observations; qualification and its typed dispositions stay authoritative. */
export async function privateAgentReadinessReport(input: {
  readonly aggregate: PrivateRetainedPackageProject
  readonly requests: readonly PrivateActivationRequest[]
  readonly failures: ReadonlyMap<string, PrivateRuntimeReadinessFailure>
  readonly featureFailures: ReadonlyMap<string, string>
  readonly alternatives?: readonly AcpGrant['client'][]
}): Promise<PrivateAgentReadinessReport> {
  const { aggregate } = input
  const bindings = new Map(aggregate.bindings.map((binding) => [binding.id, binding]))
  const namedRecipients = new Map<string, PrivateAgentGrantRecipient[]>()
  for (const binding of aggregate.bindings) {
    for (const [slot, selection] of Object.entries(binding.evaluation.value.slots ?? {})) {
      if (typeof selection !== 'string' || !selection.startsWith('grant:')) continue
      const name = selection.slice(6)
      let recipients = namedRecipients.get(name)
      if (recipients === undefined) {
        recipients = []
        namedRecipients.set(name, recipients)
      }
      recipients.push(Object.freeze({ binding: binding.id, declaration: binding.sourcePath, slot }))
    }
  }
  const groups = new Map<
    string,
    { issue: PrivateAgentReadinessIssue; recipients: readonly PrivateAgentGrantRecipient[] }
  >()
  const selections: PrivateAgentReviewSelection[] = []
  function sourceFor(request: PrivateActivationRequest, slot: string, client: AcpGrant['client']) {
    const bindingId = request.target.kind === 'binding' ? request.target.id : undefined
    const binding = bindingId === undefined ? undefined : bindings.get(bindingId)
    const declaration = binding?.sourcePath ?? `${request.packagePath}/${request.entrypoint.path}`
    const selection = binding?.evaluation.value.slots?.[slot]
    const name =
      typeof selection === 'string' && selection.startsWith('grant:')
        ? selection.slice(6)
        : undefined
    const authored = name === undefined ? selection : aggregate.grants[name]
    const sourceClient =
      authored !== null && typeof authored === 'object' && authored.kind === 'acp'
        ? authored.client
        : client
    const path =
      name === undefined ? declaration : (aggregate.grantFiles[name]?.path ?? declaration)
    const location = Object.freeze(
      (name === undefined
        ? bindingId === undefined
          ? undefined
          : aggregate.agentSources?.[bindingId]?.[slot]
        : aggregate.grantFiles[name]) ?? {
        path,
        kind: 'unlocated' as const,
      },
    )
    return { bindingId, declaration, name, sourceClient, path, location }
  }
  let observedIssues = 0
  let uncheckedResources = 0
  for (const request of input.requests) {
    const key = privateActivationTargetKey(request.target)
    const cause = input.failures.get(key)?.cause
    const acpSlots = Object.entries(request.slots)
      .filter(([, route]) => route.kind === 'native' && route.native === 'finite-acp')
      .map(([slot]) => slot)
      .sort()
    for (const slot of acpSlots) {
      const route = request.slots[slot]!
      if (route.kind !== 'native' || route.grant?.kind !== 'acp')
        throw new TypeError('selected ACP resource has no policy')
      const source = sourceFor(request, slot, route.grant.client)
      if (source.bindingId === undefined) continue
      selections.push(
        Object.freeze({
          binding: source.bindingId,
          declaration: source.declaration,
          slot,
          sourceClient: source.sourceClient,
          effectiveClient: route.grant.client,
          source: source.location,
        }),
      )
    }
    if (input.featureFailures.has(key)) uncheckedResources += acpSlots.length
    else if (cause?.kind === 'acp')
      uncheckedResources += acpSlots.length - acpSlots.indexOf(cause.slot) - 1
    if (cause?.kind !== 'acp') continue
    observedIssues++
    const route = request.slots[cause.slot]
    if (route?.kind !== 'native' || route.native !== 'finite-acp' || route.grant?.kind !== 'acp')
      throw new TypeError('observed ACP refusal has no selected policy')
    const { bindingId, declaration, name, sourceClient, path, location } = sourceFor(
      request,
      cause.slot,
      cause.client,
    )
    const recipients =
      name === undefined
        ? bindingId === undefined
          ? []
          : [Object.freeze({ binding: bindingId, declaration, slot: cause.slot })]
        : (namedRecipients.get(name) ?? [])
    // A shared named policy is one source selection; separate inline slots stay separate.
    const groupKey = JSON.stringify([
      name === undefined ? ['inline', declaration, cause.slot] : ['named', path, name],
      cause.client,
      cause.diagnostic,
    ])
    const existing = groups.get(groupKey)
    if (existing !== undefined) {
      existing.issue = Object.freeze({
        ...existing.issue,
        observedRefusals: existing.issue.observedRefusals + 1,
      })
      continue
    }
    groups.set(groupKey, {
      issue: Object.freeze({
        source: name === undefined ? ('inline' as const) : ('named' as const),
        location,
        declaration,
        slot: cause.slot,
        client: cause.client,
        sourceClient,
        ...(aggregate.agentOverride === undefined ? {} : { override: aggregate.agentOverride }),
        policy: Object.freeze({ ...route.grant }),
        code: cause.diagnostic,
        ...(rejectedExecutableOverrides.has(input.failures.get(key)!)
          ? {
              rejectedOverride: `${cause.client.toUpperCase()}_PATH` as
                | 'CODEX_PATH'
                | 'CLAUDE_PATH'
                | 'PI_PATH',
            }
          : {}),
        recipients: Object.freeze([]),
        omittedRecipients: recipients.length,
        observedRefusals: 1,
        alternatives: Object.freeze(
          cause.diagnostic === `PROJECT_ACP_${cause.client.toUpperCase()}_EXECUTABLE`
            ? [...new Set(input.alternatives ?? [])].filter((client) => client !== cause.client)
            : [],
        ),
      }),
      recipients,
    })
  }
  // Reserve the primary fact before spending the bounded presentation budget on recipients.
  const primaryIssue = groups.values().next().value?.issue as PrivateAgentReadinessIssue | undefined
  const entrypoint =
    aggregate.linked?.entrypoint === undefined
      ? undefined
      : parseProjectEntrypoint(aggregate.linked.entrypoint).target
  const base = {
    selectedAcpUnavailable: observedIssues > 0,
    ...(primaryIssue === undefined ? {} : { primaryIssue }),
    observedIssues,
    observedPolicyGroups: groups.size,
    uncheckedResources,
    readyTargets: input.requests.filter((request) => {
      const key = privateActivationTargetKey(request.target)
      return !input.featureFailures.has(key) && !input.failures.has(key)
    }).length,
    unavailableTargets: input.requests.filter((request) => {
      const key = privateActivationTargetKey(request.target)
      return input.featureFailures.has(key) || input.failures.has(key)
    }).length,
    ...(entrypoint === undefined
      ? {}
      : {
          entrypoint: {
            target: entrypoint,
            state:
              input.featureFailures.has(privateActivationTargetKey(entrypoint)) ||
              input.failures.has(privateActivationTargetKey(entrypoint))
                ? ('unavailable' as const)
                : ('ready' as const),
          },
        }),
  }
  const issues: PrivateAgentReadinessIssue[] = []
  let reportBytes = Buffer.byteLength(JSON.stringify(base)) + 256
  let omittedPolicyGroups = 0
  let complete = true
  for (const { issue, recipients } of groups.values()) {
    const retained: PrivateAgentGrantRecipient[] = []
    let issueBytes = Buffer.byteLength(JSON.stringify(issue)) + 1
    if (reportBytes + issueBytes > AGENT_REPORT_BYTES) {
      complete = false
      omittedPolicyGroups++
      continue
    }
    for (const recipient of recipients) {
      const bytes = Buffer.byteLength(JSON.stringify(recipient)) + 1
      if (reportBytes + issueBytes + bytes > AGENT_REPORT_BYTES) break
      issueBytes += bytes
      retained.push(recipient)
    }
    const omittedRecipients = recipients.length - retained.length
    if (omittedRecipients > 0) complete = false
    reportBytes += issueBytes
    issues.push(Object.freeze({ ...issue, recipients: Object.freeze(retained), omittedRecipients }))
  }
  const retainedSelections: PrivateAgentReviewSelection[] = []
  for (const selection of selections) {
    const bytes = Buffer.byteLength(JSON.stringify(selection)) + 1
    if (reportBytes + bytes > AGENT_REPORT_BYTES) break
    reportBytes += bytes
    retainedSelections.push(selection)
  }
  const omittedSelections = selections.length - retainedSelections.length
  if (omittedSelections > 0) complete = false
  return Object.freeze({
    ...base,
    complete,
    omittedPolicyGroups,
    issues: Object.freeze(issues),
    selections: Object.freeze(retainedSelections),
    omittedSelections,
  })
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
