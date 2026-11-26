import { createHash } from 'node:crypto'
import { validateMacShardPolicy } from './macos-host-test-shards.mjs'
import { MAC_PYTHON_MAJOR, MAC_PYTHON_SHARD } from './python-ci-profiles.mjs'

export const MACOS_COMPATIBILITY_MAJORS = Object.freeze([15, 26])
export const macPrShardMajors = (shard) =>
  shard === MAC_PYTHON_SHARD ? [MAC_PYTHON_MAJOR] : MACOS_COMPATIBILITY_MAJORS
export const macJobName = (major, shard) => `Native host shard — macos-${major} / ${shard}`
const stable = (value) =>
  Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
          .join(',')}}`
      : JSON.stringify(value)
const positive = (value) => Number.isSafeInteger(value) && value > 0

// This retained receipt binds the complete frozen plan to actual runner jobs.
// The collector separately reconstructs source membership and validates reports.
export function validateMacCoverage(coverage, { source, scope = 'release', attempt } = {}) {
  if (!['pull_request', 'release'].includes(scope) || coverage?.scope !== scope)
    throw new Error('Mac qualification coverage scope does not match its required evidence')
  const plan = coverage?.plan
  if (
    !/^[a-f0-9]{40}$/.test(source ?? '') ||
    plan?.version !== 1 ||
    plan.source !== source ||
    plan.architecture !== 'arm64'
  )
    throw new Error('Mac qualification lacks its exact source-bound frozen plan')
  const policy = validateMacShardPolicy(plan.policy)
  const { digest, ...payload } = plan
  if (
    digest !== createHash('sha256').update(stable(payload)).digest('hex') ||
    !/^[0-9a-f]{64}$/.test(plan.inventoryDigest ?? '') ||
    !Array.isArray(plan.shards) ||
    plan.shards.length < policy.minShards ||
    plan.shards.length > policy.maxShards ||
    plan.shards.some((shard, index) => shard.index !== index || !Array.isArray(shard.groups))
  )
    throw new Error('Mac qualification frozen plan is incomplete or changed')
  // PRs qualify each frozen role once, on its already selected physical host.
  // Releases independently qualify every role on both supported majors.
  const expected =
    scope === 'pull_request'
      ? plan.shards.map(({ index: shard }) => ({
          shard,
          ...(shard === MAC_PYTHON_SHARD ? { major: MAC_PYTHON_MAJOR } : {}),
        }))
      : MACOS_COMPATIBILITY_MAJORS.flatMap((major) =>
          plan.shards.map((shard) => ({ major, shard: shard.index })),
        )
  if (!Array.isArray(coverage.executions) || coverage.executions.length !== expected.length)
    throw new Error('Mac qualification lacks complete executed shard identities')
  const jobs = new Set()
  const artifacts = new Set()
  for (const { major, shard } of expected) {
    const rows = coverage.executions.filter(
      (row) => row?.shard === shard && (major === undefined || row.major === major),
    )
    const row = rows[0]
    if (
      rows.length !== 1 ||
      !MACOS_COMPATIBILITY_MAJORS.includes(row.major) ||
      row.name !== macJobName(row.major, shard) ||
      !positive(row.jobId) ||
      jobs.has(row.jobId) ||
      !positive(row.runAttempt) ||
      (attempt !== undefined && row.runAttempt !== attempt) ||
      !positive(row.artifactId) ||
      artifacts.has(row.artifactId) ||
      !/^sha256:[0-9a-f]{64}$/.test(row.artifactDigest ?? '')
    )
      throw new Error('Mac qualification executed shard identity is invalid or stale')
    jobs.add(row.jobId)
    artifacts.add(row.artifactId)
  }
  const majors =
    scope === 'release'
      ? MACOS_COMPATIBILITY_MAJORS
      : MACOS_COMPATIBILITY_MAJORS.filter((major) =>
          coverage.executions.some((row) => row.major === major),
        )
  if (JSON.stringify(coverage.majors) !== JSON.stringify(majors))
    throw new Error('Mac qualification majors do not match its complete executed coverage')
  return coverage
}

export function macQualificationJobNames(coverage) {
  return coverage.executions.map(({ major, shard }) => macJobName(major, shard))
}
