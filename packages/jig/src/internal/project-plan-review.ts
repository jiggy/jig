import { ProjectAdministrationError } from '../administration/project.js'
import { privateCliValueFields } from '../cli-value-presentation.js'
import type { RunTargetIdentity } from '../project/package-project.js'
import { flowSelector } from '../project/package-selector.js'
import { privateAcpAgentRuntime, requirePrivateAcpAgentProvider } from './acp-agent-provider.js'
import type { PrivateActivationReviewPlan } from './activation-admission-store.js'
import { type PrivateDirectRunRecipe, requirePrivateDirectRunRecipe } from './direct-run.js'
import { grantChanges, requiresAuthorityApproval } from './grant-review.js'

// Four MiB leaves a conservative JSON/0 envelope after every ASCII backslash
// and quote in the review string is escaped by the outer value encoding.
const MAX_REVIEW_BYTES = 4 * 1024 * 1024
const BUFFER_BYTES = 8 * 1024

export interface PrivateProjectPlanReview {
  readonly mediaType: 'text/plain; charset=utf-8'
  readonly text: string
  readonly details: string
  readonly authorityChanges: boolean
}

/**
 * Render sectioned portable-policy diffs with optional complete unchanged context
 * without exposing the private Plan, recipe, host-observation, or
 * protected-store representations.
 */
export function renderPrivateProjectPlanReview(
  review: PrivateActivationReviewPlan,
  maximumBytes = MAX_REVIEW_BYTES,
  recipes: readonly PrivateDirectRunRecipe[] = [],
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
  const acp = projectAcpSelections(plan.proposed.targets, recipes)
  const grants = grantChanges(review.baseCandidate?.lock ?? null, plan.proposed.lock)
  const featureMismatches = projectFeatureMismatches(plan.proposed.lock, plan.proposed.targets)
  const authorityChanges = requiresAuthorityApproval(
    review.baseCandidate?.lock ?? null,
    plan.proposed.lock,
  )
  const render = (includeUnchanged: boolean): string => {
    const summary = new BoundedAsciiWriter(maximumBytes)
    summary.write('Review changes before approval\n\n')
    summary.write('Approval permits these exact methods, settings and invocation routes to run.\n')
    summary.write('It does not execute a Flow. Declining keeps your previous approval.\n\n')
    if (grants.length !== 0) {
      summary.write('Resource delegation changes (recipient, exact policy):\n')
      writePolicy(summary, grants, 1)
      summary.write(
        '\nNew or changed grants require explicit authority approval. Removed grants affect new Runs after admission.\n\n',
      )
    }
    if (Object.keys(acp).length !== 0) {
      summary.write('ACP runtimes selected for resource slots:\n')
      writePolicy(summary, acp, 1)
      summary.write(
        '\nData supplied to these slots goes to the selected clients. Credentials remain private.\n\n',
      )
    }
    const beforeEntrypoint = review.baseCandidate?.lock.entrypoint
    const afterEntrypoint = plan.proposed.lock.entrypoint
    if (
      beforeEntrypoint !== afterEntrypoint ||
      (includeUnchanged && afterEntrypoint !== undefined)
    ) {
      summary.write('Project entrypoint (jig run):\n')
      if (beforeEntrypoint === afterEntrypoint) writePolicy(summary, afterEntrypoint, 1)
      else
        writePolicyDiff(
          summary,
          { entrypoint: beforeEntrypoint ?? null },
          { entrypoint: afterEntrypoint ?? null },
          1,
        )
      summary.write(
        '  File arguments select current job data when invoked; paths are project-relative.\n\n',
      )
    }
    writeChanges(
      summary,
      'Packages (source / dependency identity and invocation requirements)',
      changes.packages,
      current?.portablePolicy.packages ?? {},
      proposed.portablePolicy.packages,
      includeUnchanged,
    )
    writeChanges(
      summary,
      'Bindings (settings, invocation slots, resource grants and captured files)',
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
    if (featureMismatches.length > 0) {
      summary.write(
        '  Required features are missing on these selected routes (their dependents are unavailable too):\n',
      )
      writePolicy(summary, featureMismatches, 1)
    }
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
    authorityChanges,
    mediaType: 'text/plain; charset=utf-8' as const,
    text,
    details,
  })
}

type ReviewedTarget = PrivateActivationReviewPlan['candidate']['candidate']['targets'][number]

function projectAcpSelections(
  targets: readonly ReviewedTarget[],
  recipes: readonly PrivateDirectRunRecipe[],
): Record<
  string,
  Record<string, { client: string; model: string; authentication: string; executable: string }>
> {
  const byTarget = new Map<string, PrivateDirectRunRecipe>()
  for (const value of recipes) {
    const recipe = requirePrivateDirectRunRecipe(value)
    const key = targetKey(recipe.request.target)
    if (byTarget.has(key)) throw new TypeError('duplicate ACP review target recipe')
    byTarget.set(key, recipe)
  }
  const result: ReturnType<typeof projectAcpSelections> = Object.create(null)
  for (const target of targets) {
    if (target.disposition.state !== 'ready') continue
    const selected: ReturnType<typeof projectAcpSelections>[string] = Object.create(null)
    for (const [slot, route] of Object.entries(target.request.slots)) {
      if (route.kind !== 'native' || route.native !== 'finite-acp') continue
      const recipe = byTarget.get(targetKey(target.request.target))
      if (
        recipe === undefined ||
        recipe.request.digest !== target.request.digest ||
        recipe.digest !== target.disposition.recipeDigest ||
        recipe.observation.digest !== target.disposition.observationDigest ||
        route.grant?.kind !== 'acp'
      )
        throw new TypeError('ACP review selection does not match the exact proposed recipe')
      const provider = requirePrivateAcpAgentProvider(recipe.acp[slot])
      selected[slot] = {
        client: route.grant.client,
        model: provider.model,
        authentication: provider.credentialMode,
        executable: privateAcpAgentRuntime(provider).executablePath,
      }
    }
    if (Object.keys(selected).length !== 0) result[targetKey(target.request.target)] = selected
  }
  return result
}

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
    if (
      !samePolicy(before.disposition.execution?.package, after.disposition.execution?.package) ||
      !samePolicy(before.disposition.execution?.layout, after.disposition.execution?.layout)
    )
      reasons.push('Prepared execution files or dependency layout changed.')
    else if (
      before.disposition.execution?.preparationInputDigest !==
      after.disposition.execution?.preparationInputDigest
    )
      reasons.push(
        before.disposition.execution?.preparationInputDigest === undefined
          ? 'This review records captured workspace inputs for future preparation reuse.\n  Prepared files and dependency layout are unchanged.'
          : 'Workspace preparation inputs changed.\n  Prepared files and dependency layout are unchanged.',
      )
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
    slots: request.slots,
    attachments: request.attachments,
    ...(request.boundAttachments === undefined
      ? {}
      : { capturedAttachments: Object.keys(request.boundAttachments) }),
    ...(Object.keys(request.attachments).length === 0
      ? {}
      : {
          filePolicy:
            'Root-only captured input; one initially empty bounded output; no live host writes.',
        }),
    availability:
      disposition.state === 'ready'
        ? { state: 'ready' as const }
        : {
            state: 'unavailable' as const,
            code: disposition.code,
            ...(disposition.code === 'FEATURE_UNAVAILABLE'
              ? {
                  hint: 'A selected dependency does not declare all required features. Review uses.requires and select a matching implementation; grants do not supply feature support.',
                }
              : {}),
          },
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
            ...(value.supports === undefined ? {} : { supports: value.supports }),
          },
        ]),
      ),
      bindings: lock.bindings,
    },
    targets,
  }
}

function projectFeatureMismatches(
  lock: PrivateActivationReviewPlan['candidate']['lock'],
  targets: PrivateActivationReviewPlan['candidate']['candidate']['targets'],
) {
  const byTarget = new Map(targets.map(({ request }) => [targetKey(request.target), request]))
  const issues: { caller: string; slot: string; selected: string; missing: readonly string[] }[] =
    []
  for (const { request } of targets) {
    const requirements = lock.packages[request.packagePath]!.uses
    for (const [slot, route] of Object.entries(request.slots)) {
      if (route.kind !== 'flow') continue
      const required = requirements[slot]?.requires ?? []
      if (required.length === 0) continue
      const selected = targetKey(route.target)
      const provider = byTarget.get(selected)
      if (provider === undefined) throw new Error('review feature provider is missing')
      const supports = lock.packages[provider.packagePath]!.supports ?? []
      const missing = required.filter((feature) => !supports.includes(feature))
      if (missing.length > 0)
        issues.push({ caller: targetKey(request.target), slot, selected, missing })
    }
  }
  return issues
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
      [...Object.values(prior.slots), ...Object.values(binding.slots)]
        .filter((slot): slot is RunTargetIdentity => slot.kind !== 'grant')
        .map(targetKey),
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
  return target.kind === 'flow' ? flowSelector(target.path) : `binding:${target.id}`
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
