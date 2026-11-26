import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createFrozenMacPlan,
  INSTALLED_STARTUP_TEST,
  NATIVE_PREREQUISITE_TESTS,
} from './macos-host-test-shards.mjs'
import {
  macJobName,
  macQualificationJobNames,
  validateMacCoverage,
} from './macos-qualification.mjs'

const source = 'a'.repeat(40)
function fixture(scope = 'release', selected = [15, 26, 15]) {
  const plan = createFrozenMacPlan(
    [
      ...NATIVE_PREREQUISITE_TESTS,
      INSTALLED_STARTUP_TEST,
      ...['a', 'b', 'c'].map((name) => `packages/jig/test/host/${name}.test.ts`),
    ],
    'arm64',
    { source, policy: { targetSeconds: 1200, minShards: 3, maxShards: 3 } },
  )
  const roles =
    scope === 'release'
      ? [15, 26].flatMap((major) => plan.shards.map(({ index: shard }) => ({ major, shard })))
      : selected.map((major, shard) => ({ major, shard }))
  return {
    scope,
    plan,
    majors: [15, 26].filter((major) => roles.some((row) => row.major === major)),
    executions: roles.map(({ major, shard }, index) => ({
      major,
      shard,
      name: macJobName(major, shard),
      jobId: index + 100,
      runAttempt: 2,
      artifactId: index + 200,
      artifactDigest: `sha256:${'b'.repeat(64)}`,
    })),
  }
}

test('default release scope requires both complete compatibility matrices and current execution identities', () => {
  const coverage = fixture()
  assert.equal(validateMacCoverage(coverage, { source, attempt: 2 }), coverage)
  assert.deepEqual(
    macQualificationJobNames(coverage),
    [15, 26].flatMap((major) => [0, 1, 2].map((shard) => macJobName(major, shard))),
  )
  for (const change of [
    (value) => {
      value.majors = [26]
    },
    (value) => {
      value.executions.pop()
    },
    (value) => {
      value.executions[0].runAttempt = 1
    },
    (value) => {
      value.plan.source = 'c'.repeat(40)
    },
  ]) {
    const changed = structuredClone(coverage)
    change(changed)
    assert.throws(() => validateMacCoverage(changed, { source, attempt: 2 }))
  }
})

test('explicit PR scope admits one complete role per selected major and records actual coverage', () => {
  for (const selected of [
    [15, 26, 15],
    [15, 26, 26],
    [15, 15, 15],
  ]) {
    const coverage = fixture('pull_request', selected)
    assert.equal(validateMacCoverage(coverage, { source, scope: 'pull_request' }), coverage)
    assert.deepEqual(
      macQualificationJobNames(coverage),
      selected.map((major, shard) => macJobName(major, shard)),
    )
    // Retained successful PR roles need not be from the current attempt.
    coverage.executions[0].runAttempt = 1
    assert.equal(validateMacCoverage(coverage, { source, scope: 'pull_request' }), coverage)
  }
  assert.throws(
    () => validateMacCoverage(fixture('pull_request', [26, 15, 26]), { source, scope: 'pull_request' }),
    /executed shard identity/,
  )
})

test('merge-only coverage cannot satisfy strict publication validation or be relabeled into it', () => {
  const coverage = fixture('pull_request')
  assert.throws(() => validateMacCoverage(coverage, { source }), /scope/)
  assert.throws(() => validateMacCoverage(coverage, { source, majors: [15, 26] }), /scope/)
  coverage.scope = 'release'
  assert.throws(() => validateMacCoverage(coverage, { source }), /complete executed shard/)
  assert.throws(() => validateMacCoverage(fixture(), { source, scope: 'pull_request' }), /scope/)
  assert.throws(() => validateMacCoverage(fixture(), { source, scope: 'unknown' }), /scope/)
})

test('PR coverage rejects missing, duplicate, loser, foreign-major and reused physical executions', () => {
  const changes = [
    (value) => {
      value.executions.pop()
    },
    (value) => {
      value.executions.push({
        ...value.executions[0],
        major: 26,
        name: macJobName(26, 0),
        jobId: 999,
        artifactId: 888,
      })
    },
    (value) => {
      value.executions[1] = { ...value.executions[1], shard: 0, major: 26, name: macJobName(26, 0) }
    },
    (value) => {
      value.executions[0].major = 14
      value.executions[0].name = macJobName(14, 0)
    },
    (value) => {
      value.executions[0].jobId = value.executions[1].jobId
    },
    (value) => {
      value.executions[0].artifactId = value.executions[1].artifactId
    },
    (value) => {
      value.executions[0].name = macJobName(26, 0)
    },
    (value) => {
      value.executions[0].runAttempt = 0
    },
    (value) => {
      value.executions[0].artifactDigest = 'changed'
    },
    (value) => {
      value.plan.source = 'c'.repeat(40)
    },
    (value) => {
      value.plan.digest = 'c'.repeat(64)
    },
    (value) => {
      value.majors = [26]
    },
    (value) => {
      value.majors = [26, 15]
    },
    (value) => {
      delete value.scope
    },
  ]
  for (const change of changes) {
    const coverage = fixture('pull_request')
    change(coverage)
    assert.throws(() => validateMacCoverage(coverage, { source, scope: 'pull_request' }))
  }
  assert.throws(() =>
    validateMacCoverage(fixture('pull_request'), { source: 'd'.repeat(40), scope: 'pull_request' }),
  )
})
