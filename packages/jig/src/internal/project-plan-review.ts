import { ProjectAdministrationError } from '../administration/project.js'
import { privateCliValueFields } from '../cli-value-presentation.js'
import type { RunTargetIdentity } from '../project/package-project.js'
import type { PrivateActivationReviewPlan } from './activation-admission-store.js'
import type { PrivateAgentProvider } from './agent-provider.js'
import { AGENT_RUN_CONTRACT_DIGEST } from './private-agent-run.js'

// Four MiB leaves a conservative JSON/1 envelope after every ASCII backslash
// and quote in the review string is escaped by the outer value encoding.
const MAX_REVIEW_BYTES = 4 * 1024 * 1024
const BUFFER_BYTES = 8 * 1024

export interface PrivateProjectPlanReview {
  readonly mediaType: 'text/plain; charset=utf-8'
  readonly text: string
  readonly details: string
}

/**
 * Render sectioned portable-policy diffs with optional complete unchanged context
 * without exposing the private Plan, recipe, host-observation, or
 * protected-store representations.
 */
export function renderPrivateProjectPlanReview(
  review: PrivateActivationReviewPlan,
  maximumBytes = MAX_REVIEW_BYTES,
  agentProvider?: PrivateAgentProvider,
): PrivateProjectPlanReview {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_REVIEW_BYTES) {
    throw new TypeError('project plan review byte limit is invalid')
  }
  const plan = review.plan
  const current =
    review.baseCandidate === null
      ? null
      : projectCandidate(review.baseCandidate.lock, review.baseCandidate.candidate.targets)
  const proposed = projectCandidate(plan.proposed.lock, plan.proposed.targets)
  const changes = projectChanges(
    current,
    proposed,
    review.baseCandidate?.candidate.targets ?? [],
    plan.proposed.targets,
  )
  const agent =
    agentProvider !== undefined &&
    plan.proposed.targets.some((target) =>
      Object.values(target.request.capabilities ?? {}).some(
        (use) => use.digest === AGENT_RUN_CONTRACT_DIGEST,
      ),
    )
      ? agentProvider.kind === 'private-openai-agent-provider/1'
        ? {
            client: 'OpenAI-compatible API',
            api: agentProvider.api,
            endpoint: agentProvider.baseURL,
            model: agentProvider.model,
          }
        : {
            client: agentProvider.client,
            model: agentProvider.model,
            authentication: agentProvider.credentialMode,
          }
      : undefined
  const render = (includeUnchanged: boolean): string => {
    const summary = new BoundedAsciiWriter(maximumBytes)
    summary.write('Review changes before approval\n\n')
    summary.write('Approval permits these exact methods, settings and capabilities to run.\n')
    summary.write('It does not execute a Flow. Declining keeps your previous approval.\n\n')
    if (agent !== undefined) {
      summary.write('Host Agent selected for methods requiring it:\n')
      writePolicy(summary, agent, 1)
      summary.write(
        '\nInstructions and selected data go to this Agent. Credentials are never part of the review.\n\n',
      )
    }
    writeChanges(
      summary,
      'Packages (source / dependency identity and capabilities)',
      changes.packages,
      current?.portablePolicy.packages ?? {},
      proposed.portablePolicy.packages,
      includeUnchanged,
    )
    writeChanges(
      summary,
      'Bindings (settings, child slots and command policy)',
      changes.bindings,
      current?.portablePolicy.bindings ?? {},
      proposed.portablePolicy.bindings,
      includeUnchanged,
    )
    writeChanges(
      summary,
      'Run targets (execution and file authority)',
      changes.targets,
      Object.fromEntries(
        (current?.targets ?? []).map((target) => [targetKey(target.target), target]),
      ),
      Object.fromEntries(proposed.targets.map((target) => [targetKey(target.target), target])),
      includeUnchanged,
      (key) =>
        executionChangeExplanation(
          review.baseCandidate?.candidate.targets.find(
            (target) => targetKey(target.request.target) === key,
          ),
          plan.proposed.targets.find((target) => targetKey(target.request.target) === key),
        ),
    )
    summary.write('Targets after approval:\n')
    if (proposed.targets.length === 0)
      summary.write('  None. Add a Flow under flows/ and review again.\n')
    for (const target of proposed.targets) {
      summary.write('  ')
      writeAsciiJsonString(summary, targetKey(target.target))
      summary.write(` - ${target.availability.state}\n`)
    }
    if (!includeUnchanged)
      summary.write(
        '\nUnchanged policy is omitted above. Use jig review --details for complete policy.\n',
      )
    return summary.finish()
  }
  const text = render(false)
  const details = render(true)
  if (text.length + details.length > maximumBytes)
    throw new ProjectAdministrationError(
      'UNAVAILABLE',
      'project review exceeds the supported display size',
    )
  return Object.freeze({
    mediaType: 'text/plain; charset=utf-8' as const,
    text,
    details,
  })
}

type ReviewedTarget = PrivateActivationReviewPlan['candidate']['candidate']['targets'][number]

function executionChangeExplanation(
  before: ReviewedTarget | undefined,
  after: ReviewedTarget | undefined,
): string {
  if (samePolicy(before, after))
    return 'A selected child target changed. Approval authorizes this parent to use the changed child revision described in this review.'
  if (before?.disposition.state === 'ready' && after?.disposition.state === 'ready') {
    const reasons: string[] = []
    if (!samePolicy(before.request, after.request))
      reasons.push(
        'The execution request changed; see the package, settings and permission changes in this review.',
      )
    if (!samePolicy(before.disposition.execution, after.disposition.execution))
      reasons.push('Prepared execution files or dependency layout changed.')
    if (reasons.length === 0) {
      reasons.push(
        'Execution environment changed: Jig installation, Agent configuration, or sandbox support.',
      )
      reasons.push('Flow source, prepared dependencies, settings and permissions are unchanged.')
      reasons.push(
        'The previous approval retains a combined environment fingerprint; it cannot identify which individual component changed.',
      )
      reasons.push(
        'Approval authorizes this target to run with the currently selected execution environment.',
      )
    }
    return reasons.join('\n  ')
  }
  return 'Execution availability or its supporting evidence changed. Review the proposed availability and selected environment before approving.'
}

function writeChanges(
  writer: BoundedAsciiWriter,
  title: string,
  changes: { added: readonly string[]; changed: readonly string[]; removed: readonly string[] },
  current: Readonly<Record<string, unknown>>,
  proposed: Readonly<Record<string, unknown>>,
  includeUnchanged: boolean,
  unchangedReason?: (key: string) => string,
): void {
  const unchanged = includeUnchanged
    ? Object.keys(proposed)
        .filter((key) => !changes.added.includes(key) && !changes.changed.includes(key))
        .sort(compareUtf16)
    : []
  if (
    changes.added.length + changes.changed.length + changes.removed.length + unchanged.length ===
    0
  )
    return
  writer.write(
    `${title}: ${changes.added.length} added, ${changes.changed.length} changed, ${changes.removed.length} removed\n`,
  )
  for (const [label, keys] of [
    ['Added', changes.added],
    ['Changed', changes.changed],
    ['Removed', changes.removed],
    ['Unchanged', unchanged],
  ] as const) {
    for (const key of keys) {
      writer.write(`\n${label}: `)
      writeAsciiJsonString(writer, key)
      writer.write('\n')
      if (label === 'Changed') {
        if (samePolicy(current[key], proposed[key])) {
          writer.write(`  ${unchangedReason?.(key) ?? 'Public policy is unchanged.'}\n`)
          if (includeUnchanged) writePolicy(writer, proposed[key], 1)
        } else {
          writer.write('  - removed / previous; + added / proposed\n')
          writePolicyDiff(writer, current[key], proposed[key], 1, includeUnchanged)
        }
      } else if (label === 'Unchanged') {
        writePolicy(writer, proposed[key], 1)
      } else {
        writeSignedPolicy(
          writer,
          label === 'Added' ? proposed[key] : current[key],
          1,
          label === 'Added' ? '+' : '-',
        )
      }
    }
  }
  writer.write('\n')
}

/** Object insertion order has no policy meaning; array order does. */
function samePolicy(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const before = left as Record<string, unknown>
  const after = right as Record<string, unknown>
  const keys = Object.keys(before)
  return (
    keys.length === Object.keys(after).length &&
    keys.every((key) => Object.hasOwn(after, key) && samePolicy(before[key], after[key]))
  )
}

function writeSignedPolicy(
  writer: BoundedAsciiWriter,
  value: unknown,
  depth: number,
  sign: string,
): void {
  const part = new BoundedAsciiWriter(writer.maximumBytes)
  writePolicy(part, value, depth)
  for (const line of part.finish().slice(0, -1).split('\n')) writer.write(`${sign} ${line}\n`)
}

function writePolicyDiff(
  writer: BoundedAsciiWriter,
  before: unknown,
  after: unknown,
  depth: number,
  includeUnchanged = false,
): void {
  if (samePolicy(before, after)) return
  if (
    before !== null &&
    after !== null &&
    typeof before === 'object' &&
    typeof after === 'object' &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const old = before as Record<string, unknown>
    const next = after as Record<string, unknown>
    for (const key of [...new Set([...Object.keys(old), ...Object.keys(next)])].sort(
      compareUtf16,
    )) {
      if (samePolicy(old[key], next[key])) {
        if (includeUnchanged) writeSignedPolicy(writer, { [key]: next[key] }, depth, ' ')
        continue
      }
      if (
        Object.hasOwn(old, key) &&
        Object.hasOwn(next, key) &&
        old[key] !== null &&
        next[key] !== null &&
        typeof old[key] === 'object' &&
        typeof next[key] === 'object' &&
        !Array.isArray(old[key]) &&
        !Array.isArray(next[key]) &&
        Object.keys(old[key] as object).length > 0 &&
        Object.keys(next[key] as object).length > 0
      ) {
        writer.write('  ')
        writeIndent(writer, depth)
        writeAsciiJsonString(writer, key)
        writer.write(':\n')
        writePolicyDiff(writer, old[key], next[key], depth + 1, includeUnchanged)
      } else {
        if (Object.hasOwn(old, key)) writeSignedPolicy(writer, { [key]: old[key] }, depth, '-')
        if (Object.hasOwn(next, key)) writeSignedPolicy(writer, { [key]: next[key] }, depth, '+')
      }
    }
  } else {
    writeSignedPolicy(writer, before, depth, '-')
    writeSignedPolicy(writer, after, depth, '+')
  }
}

function projectCandidate(
  lock: PrivateActivationReviewPlan['candidate']['lock'],
  targetValues: PrivateActivationReviewPlan['candidate']['candidate']['targets'],
) {
  const targets = targetValues.map(({ request, disposition }) => ({
    target: request.target,
    mode: request.mode,
    packagePath: request.packagePath,
    entrypoint: request.entrypoint,
    settings: request.settings,
    ...(request.commands === undefined ? {} : { commands: request.commands }),
    attachments: request.attachments,
    ...(Object.keys(request.attachments).length === 0
      ? {}
      : {
          filePolicy:
            'Root-only captured input; one initially empty bounded output; no live host writes.',
        }),
    availability:
      disposition.state === 'ready'
        ? { state: 'ready' as const }
        : { state: 'unavailable' as const, code: disposition.code },
  }))
  return {
    portablePolicy: {
      packages: Object.fromEntries(
        Object.entries(lock.packages).map(([path, value]) => [
          path,
          {
            digest: value.digest,
            directRun: value.directRun,
            uses: value.uses,
          },
        ]),
      ),
      bindings: lock.bindings,
    },
    targets,
  }
}

function projectChanges(
  current: ReturnType<typeof projectCandidate> | null,
  proposed: ReturnType<typeof projectCandidate>,
  currentTargets: PrivateActivationReviewPlan['candidate']['candidate']['targets'],
  proposedTargets: PrivateActivationReviewPlan['candidate']['candidate']['targets'],
) {
  const targetChanges = recordChanges(
    Object.fromEntries(currentTargets.map((target) => [targetKey(target.request.target), target])),
    Object.fromEntries(proposedTargets.map((target) => [targetKey(target.request.target), target])),
  )
  const changedTargets = new Set(targetChanges.changed)
  for (const id of changedBindingSlotDependencies(
    current,
    proposed,
    currentTargets,
    proposedTargets,
  )) {
    changedTargets.add(`binding:${id}`)
  }
  return {
    packages: recordChanges(
      current?.portablePolicy.packages ?? {},
      proposed.portablePolicy.packages,
    ),
    bindings: recordChanges(
      current?.portablePolicy.bindings ?? {},
      proposed.portablePolicy.bindings,
    ),
    targets: {
      ...targetChanges,
      changed: [...changedTargets].sort(compareUtf16),
    },
  }
}

function changedBindingSlotDependencies(
  current: ReturnType<typeof projectCandidate> | null,
  proposed: ReturnType<typeof projectCandidate>,
  currentTargets: PrivateActivationReviewPlan['candidate']['candidate']['targets'],
  proposedTargets: PrivateActivationReviewPlan['candidate']['candidate']['targets'],
): readonly string[] {
  if (current === null) return []
  const currentByTarget = new Map(
    currentTargets.map((target) => [targetKey(target.request.target), target] as const),
  )
  const proposedByTarget = new Map(
    proposedTargets.map((target) => [targetKey(target.request.target), target] as const),
  )
  const changed: string[] = []
  for (const [id, binding] of Object.entries(proposed.portablePolicy.bindings)) {
    const prior = current.portablePolicy.bindings[id]
    if (prior === undefined) continue
    const keys = new Set(
      [...Object.values(prior.slots), ...Object.values(binding.slots)].map(targetKey),
    )
    if (
      [...keys].some((key) => {
        const before = currentByTarget.get(key)
        const after = proposedByTarget.get(key)
        return (
          !samePolicy(before, after) ||
          (before !== undefined &&
            after !== undefined &&
            current.portablePolicy.packages[before.request.packagePath]?.digest !==
              proposed.portablePolicy.packages[after.request.packagePath]?.digest)
        )
      })
    )
      changed.push(id)
  }
  return changed.sort(compareUtf16)
}

function recordChanges(
  current: Readonly<Record<string, unknown>>,
  proposed: Readonly<Record<string, unknown>>,
) {
  const currentKeys = Object.keys(current)
  const proposedKeys = Object.keys(proposed)
  const currentSet = new Set(currentKeys)
  const proposedSet = new Set(proposedKeys)
  return {
    added: proposedKeys.filter((key) => !currentSet.has(key)).sort(compareUtf16),
    removed: currentKeys.filter((key) => !proposedSet.has(key)).sort(compareUtf16),
    changed: proposedKeys
      .filter((key) => currentSet.has(key) && !samePolicy(current[key], proposed[key]))
      .sort(compareUtf16),
  }
}

function targetKey(target: RunTargetIdentity): string {
  return target.kind === 'flow' ? `flow:${target.path}` : `binding:${target.id}`
}

/**
 * Review text is deliberately ASCII-only. Project-controlled Unicode and all
 * controls are rendered as JSON escapes so terminal bidi, zero-width, and
 * line-control behavior cannot alter the human consent surface.
 */
class BoundedAsciiWriter {
  readonly #parts: string[] = []
  #buffer = ''
  #length = 0

  constructor(readonly maximumBytes: number) {}

  write(value: string): void {
    if (value.length > this.maximumBytes - this.#length) {
      throw new ProjectAdministrationError(
        'UNAVAILABLE',
        'project plan review exceeds the supported display size',
      )
    }
    this.#length += value.length
    if (this.#buffer.length + value.length <= BUFFER_BYTES) {
      this.#buffer += value
      return
    }
    this.#flush()
    if (value.length >= BUFFER_BYTES) this.#parts.push(value)
    else this.#buffer = value
  }

  finish(): string {
    this.#flush()
    return this.#parts.join('')
  }

  #flush(): void {
    if (this.#buffer.length === 0) return
    this.#parts.push(this.#buffer)
    this.#buffer = ''
  }
}

/** YAML keeps complete values and container types without extra type labels. */
function writePolicy(writer: BoundedAsciiWriter, value: unknown, depth: number): void {
  writer.write(privateCliValueFields(value, depth, true))
}

function writeIndent(writer: BoundedAsciiWriter, depth: number): void {
  writer.write('  '.repeat(depth))
}

function writeAsciiJsonString(writer: BoundedAsciiWriter, value: string): void {
  writer.write('"')
  let run = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    const printable = code >= 0x20 && code <= 0x7e && code !== 0x22 && code !== 0x5c
    if (printable) continue
    if (run < index) writer.write(value.slice(run, index))
    if (code === 0x22) writer.write('\\"')
    else if (code === 0x5c) writer.write('\\\\')
    else if (code === 0x08) writer.write('\\b')
    else if (code === 0x09) writer.write('\\t')
    else if (code === 0x0a) writer.write('\\n')
    else if (code === 0x0c) writer.write('\\f')
    else if (code === 0x0d) writer.write('\\r')
    else writer.write(`\\u${code.toString(16).padStart(4, '0')}`)
    run = index + 1
  }
  if (run < value.length) writer.write(value.slice(run))
  writer.write('"')
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
