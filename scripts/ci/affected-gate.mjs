#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createAffectedPlan, digest, parseArguments, stableJson } from './affected-plan.mjs'
import { authorizeExpectedSkips } from './expected-skips.mjs'

const SOURCE_REVISION = /^[0-9a-f]{40}$/

// The retained plan is evidence, not authority for its own comparison base,
// event or rollout mode. GitHub supplies these inputs outside the artifact.
export function trustedWorkflowContext({ cwd = process.cwd(), env = process.env, event } = {}) {
  const head = execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 1024,
  }).trim()
  if (!SOURCE_REVISION.test(head)) throw new Error('Cannot identify the tested checkout')
  const github =
    env.GITHUB_ACTIONS === 'true' ||
    env.GITHUB_SHA !== undefined ||
    env.GITHUB_EVENT_NAME !== undefined
  if (!github) return { head }
  if (env.GITHUB_SHA !== head) throw new Error('GitHub source differs from the tested checkout')
  if (!/^[a-z_]+$/.test(env.GITHUB_EVENT_NAME ?? ''))
    throw new Error('Missing trusted GitHub event')
  if (event === undefined) {
    if (!env.GITHUB_EVENT_PATH) throw new Error('Missing trusted GitHub event payload')
    const bytes = readFileSync(env.GITHUB_EVENT_PATH)
    if (bytes.length > 1024 * 1024) throw new Error('Oversized trusted GitHub event payload')
    event = JSON.parse(bytes.toString('utf8'))
  }
  const mode = env.MODE ?? 'shadow'
  if (!['shadow', 'active'].includes(mode)) throw new Error('Invalid trusted selection mode')
  if (env.FORCE !== undefined && !['true', 'false'].includes(env.FORCE))
    throw new Error('Invalid trusted full-execution override')
  const pullRequest = env.GITHUB_EVENT_NAME === 'pull_request'
  const base = (pullRequest ? event.pull_request?.base?.sha : event.before) || null
  const prHead = pullRequest ? event.pull_request?.head?.sha : null
  if (
    (base !== null && !SOURCE_REVISION.test(base)) ||
    (pullRequest && !SOURCE_REVISION.test(prHead ?? ''))
  )
    throw new Error('Missing or invalid trusted comparison revision')
  return { head, base, prHead, event: env.GITHUB_EVENT_NAME, mode, forceFull: env.FORCE === 'true' }
}

// Evidence must come from completed tests/build qualification or the existing
// owning host summaries. A GitHub job's success alone is not execution evidence.
// executedCount counts observed passing cases/pages/qualified archives; profiles
// enumerate the actual completed matrix, never an invented success sentinel.
export function reconcileAffectedEvidence(
  plan,
  evidence,
  { cwd = process.cwd(), scope = 'ci', expectedContext } = {},
) {
  const errors = []
  if (!['ci', 'linux', 'macos', 'all'].includes(scope))
    throw new Error('Gate scope must be ci, linux, macos or all')
  let expected
  try {
    if (
      expectedContext &&
      (!SOURCE_REVISION.test(expectedContext.head ?? '') ||
        !['shadow', 'active'].includes(expectedContext.mode) ||
        !/^[a-z_]+$/.test(expectedContext.event ?? '') ||
        typeof expectedContext.forceFull !== 'boolean' ||
        (expectedContext.base !== null && !SOURCE_REVISION.test(expectedContext.base ?? '')) ||
        (expectedContext.prHead !== null && !SOURCE_REVISION.test(expectedContext.prHead ?? '')))
    )
      throw new Error('Invalid trusted selection context')
    expected = createAffectedPlan({
      cwd,
      base: expectedContext ? expectedContext.base : plan.requestedBase,
      head: expectedContext ? expectedContext.head : plan.identity.head,
      prHead: expectedContext ? expectedContext.prHead : plan.requestedPrHead,
      event: expectedContext ? expectedContext.event : plan.event,
      mode: expectedContext ? expectedContext.mode : plan.mode,
      forceFull: expectedContext ? expectedContext.forceFull : plan.forceFull,
    })
  } catch {
    return {
      qualified: false,
      scope,
      errors: ['Cannot independently reconstruct source plan'],
      targets: [],
    }
  }
  if (stableJson(expected) !== stableJson(plan))
    errors.push('Plan differs from independently reconstructed policy, source inventory or graph')
  errors.push(
    ...expected.inventory.coverageErrors.map(
      (error) => `Incomplete source coverage reconciliation: ${error}`,
    ),
  )
  if (
    evidence?.schemaVersion !== 1 ||
    evidence.planDigest !== expected.planDigest ||
    evidence.source !== expected.identity.head
  )
    errors.push('Evidence has wrong schema, plan identity or source revision')
  const results = Array.isArray(evidence?.results) ? evidence.results : []
  if (!Array.isArray(evidence?.results)) errors.push('Missing execution results')
  const knownTargets = expected.targets.filter(
    (target) => scope === 'all' || target.scope === scope,
  )
  const knownIds = new Set(knownTargets.map((target) => target.id))
  const seen = new Set()
  for (const result of results) {
    if (!result || !knownIds.has(result.id))
      errors.push(`Unexpected execution target: ${result?.id ?? 'missing'}`)
    if (seen.has(result?.id)) errors.push(`Repeated execution target: ${result?.id}`)
    seen.add(result?.id)
  }
  const targets = knownTargets.map((target) => {
    const result = results.find((item) => item?.id === target.id)
    const row = { id: target.id, selected: target.selected, qualified: false }
    if (!target.selected) {
      // Omission authorization is reconstructed above; supplied reasons cannot
      // remove targets, policies or obligations from the source inventory.
      if (result?.status !== 'skipped' || result.omissionReason !== target.omissionReason)
        errors.push(`Missing explicit authorized policy omission: ${target.id}`)
      else row.qualified = true
      return row
    }
    if (result?.status !== 'success') {
      errors.push(`Selected target missing, failed, cancelled or skipped: ${target.id}`)
      return row
    }
    if (result.inventoryDigest !== target.inventoryDigest)
      errors.push(`Wrong execution inventory: ${target.id}`)
    if (
      !Number.isInteger(result.executedCount) ||
      result.executedCount <= 0 ||
      !['test-cases', 'built-pages', 'qualified-artifacts'].includes(result.basis)
    )
      errors.push(`Selected target has no observed nonempty execution proof: ${target.id}`)
    if (result.unexpectedSkips !== 0) errors.push(`Unexpected or unaccounted skips: ${target.id}`)
    const profiles = Array.isArray(result.profiles) ? result.profiles : []
    if (
      profiles.length !== new Set(profiles).size ||
      stableJson([...profiles].sort()) !== stableJson([...target.runtimeProfiles].sort())
    )
      errors.push(`Incomplete or unexpected runtime/host matrix: ${target.id}`)
    if (!Number.isSafeInteger(result.observedSkipped) || result.observedSkipped < 0)
      errors.push(`Missing observed skip accounting: ${target.id}`)
    else if (result.observedSkipped > 0) {
      try {
        if (!target.skipPolicy || result.skipPolicy !== target.skipPolicy || profiles.length !== 1)
          throw new Error('Unknown skip policy')
        const authorization = authorizeExpectedSkips({
          repository: cwd,
          source: expected.identity.head,
          targetId: target.id,
          profile: profiles[0],
          skipPolicy: result.skipPolicy,
          skippedCases: result.skippedCases,
        })
        if (
          authorization.observedSkipped !== result.observedSkipped ||
          authorization.skippedCaseDigest !== result.skippedCaseDigest
        )
          throw new Error('Incomplete skipped case identities')
      } catch {
        errors.push(
          `Skipped cases lack unchanged reviewed source and owning command proof: ${target.id}`,
        )
      }
    } else if (result.skippedCases?.length)
      errors.push(`Skip totals disagree with reported case identities: ${target.id}`)
    if (
      [
        'native-and-installed',
        'installed-consumer',
        'candidate-and-consumer',
        'candidate-build',
      ].includes(target.kind)
    ) {
      if (result.artifactsVerified !== true)
        errors.push(`Missing unchanged archive identity proof: ${target.id}`)
    }
    if (target.kind === 'native-and-installed' && result.residueVerified !== true)
      errors.push(`Missing host residue proof: ${target.id}`)
    row.qualified = !errors.some((error) => error.endsWith(`: ${target.id}`))
    return row
  })
  return {
    schemaVersion: 1,
    qualified: errors.length === 0,
    scope,
    planDigest: expected.planDigest,
    source: expected.identity.head,
    evidenceDigest: digest(evidence ?? null),
    targets,
    errors,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArguments(process.argv.slice(2), [
      '--plan',
      '--evidence',
      '--root',
      '--scope',
    ])
    if (!options['--plan'] || !options['--evidence'])
      throw new Error('Provide --plan and --evidence JSON files')
    const context = trustedWorkflowContext({ cwd: options['--root'] })
    const plan = JSON.parse(readFileSync(options['--plan'], 'utf8'))
    if (plan.identity?.head !== context.head)
      throw new Error('Plan source differs from the tested checkout')
    const report = reconcileAffectedEvidence(
      plan,
      JSON.parse(readFileSync(options['--evidence'], 'utf8')),
      {
        cwd: options['--root'],
        scope: options['--scope'] ?? 'ci',
        expectedContext: context.event ? context : undefined,
      },
    )
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.qualified) process.exitCode = 1
  } catch (error) {
    process.stderr.write(`Affected gate refused: ${error.message}\n`)
    process.exitCode = 1
  }
}
