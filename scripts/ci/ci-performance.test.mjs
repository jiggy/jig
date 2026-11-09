import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import {
  analyzeCiPerformance,
  PERFORMANCE_WORKFLOWS,
  performanceMarkdown,
  performanceRequestBudget,
  requireCollectionBudget,
} from './ci-performance.mjs'

const base = Date.parse('2026-10-30T12:00:00Z')
const stamp = (seconds) => new Date(base + seconds * 1000).toISOString()
const source = 'a'.repeat(40)
function job(id, name, attempt = 1, changes = {}) {
  return {
    id,
    name,
    run_id: 10,
    run_attempt: attempt,
    head_sha: source,
    created_at: stamp(300),
    started_at: stamp(360),
    completed_at: stamp(480),
    conclusion: 'success',
    runner_name: 'GitHub Actions 1',
    steps: [],
    ...changes,
  }
}
function entry(changes = {}) {
  return {
    run: {
      id: 10,
      run_attempt: 1,
      head_sha: source,
      head_branch: 'feature',
      event: 'pull_request',
      conclusion: 'success',
      path: PERFORMANCE_WORKFLOWS[0],
      created_at: stamp(0),
      repository: { full_name: 'jiggy/jig' },
    },
    attempts: [
      { number: 1, startedAt: stamp(0), conclusion: 'success', jobs: [job(101, 'quick')] },
    ],
    ...changes,
  }
}
function snapshot(runs = [entry()]) {
  return { repository: 'jiggy/jig', since: stamp(-1), until: stamp(3600), runs }
}

function workflowGroup(idBase, elapsedSeconds = 600, event = 'pull_request') {
  const head = idBase.toString(16).padStart(40, '0')
  return PERFORMANCE_WORKFLOWS.map((path, index) => {
    const run = entry()
    Object.assign(run.run, {
      id: idBase + index,
      path,
      event,
      head_sha: head,
      created_at: stamp(index * 3),
    })
    run.attempts[0].startedAt = run.run.created_at
    run.attempts[0].jobs = [
      job(idBase * 10 + index, 'host', 1, {
        run_id: run.run.id,
        head_sha: head,
        created_at: stamp(10 + index * 3),
        started_at: stamp(20 + index * 3),
        completed_at: stamp(elapsedSeconds - (2 - index) * 30),
      }),
    ]
    return run
  })
}

test('workflow waiting, job queue, release offsets and concurrent work remain separate observations', () => {
  const run = entry()
  run.attempts[0].jobs.push(
    job(102, 'source', 1, {
      created_at: stamp(420),
      started_at: stamp(450),
      completed_at: stamp(540),
    }),
  )
  const report = analyzeCiPerformance(snapshot([run]))
  const first = report.attempts[0]
  assert.equal(first.preJobSeconds, 300)
  assert.equal(first.elapsedSeconds, 540)
  assert.equal(first.runnerSeconds, 210)
  assert.deepEqual(
    first.jobs.map(({ releasedAfterSeconds, jobQueueSeconds, executionSeconds }) => ({
      releasedAfterSeconds,
      jobQueueSeconds,
      executionSeconds,
    })),
    [
      { releasedAfterSeconds: 300, jobQueueSeconds: 60, executionSeconds: 120 },
      { releasedAfterSeconds: 420, jobQueueSeconds: 30, executionSeconds: 90 },
    ],
  )
  assert.equal(report.workflowSummaries[0].successfulFirstAttempts.medianSeconds, 540)
  assert.equal(report.envelopes[0].threeWorkflowEnvelopeSeconds, null)
})

test('retry history records retained work without assuming receipt acceptance or hypothetical savings', () => {
  const run = entry()
  run.run.run_attempt = 2
  run.attempts[0].conclusion = 'failure'
  run.attempts[0].jobs.push(job(102, 'source', 1, { conclusion: 'failure' }))
  run.attempts.push({
    number: 2,
    startedAt: stamp(1000),
    conclusion: 'success',
    jobs: [
      job(103, 'source', 2, {
        created_at: stamp(1005),
        started_at: stamp(1010),
        completed_at: stamp(1100),
      }),
    ],
  })
  const report = analyzeCiPerformance(snapshot([run]))
  const latest = report.latestRuns[0]
  assert.equal(latest.timeToLatestAttemptSeconds, 1000)
  assert.equal(latest.elapsedSeconds, 100)
  assert.equal(latest.totalElapsedSeconds, 1100)
  assert.equal(latest.observedRetainedRunnerSeconds, 120)
  assert.deepEqual(latest.observedRetainedSuccessfulJobs, [
    { id: 101, name: 'quick', attempt: 1, executionSeconds: 120 },
  ])
  assert.equal(report.workflowSummaries[0].successfulFirstAttempts.count, 0)
  assert.ok(report.notes.some((note) => note.includes('receipt acceptance')))
})

test('timestamps with mixed ISO precision retain chronological interval boundaries', () => {
  const run = entry()
  run.attempts[0].jobs[0].created_at = stamp(300).replace('.000Z', 'Z')
  run.attempts[0].jobs[0].completed_at = stamp(480).replace('.000Z', 'Z')
  run.attempts[0].jobs.push(
    job(102, 'source', 1, {
      created_at: stamp(300.1),
      started_at: stamp(360.1),
      completed_at: stamp(480.1),
    }),
  )
  const report = analyzeCiPerformance(snapshot([run]))
  assert.equal(report.attempts[0].preJobSeconds, 300)
  assert.equal(report.attempts[0].elapsedSeconds, 480.1)
})

test('a newer failed execution cannot count an older success as retained work', () => {
  const run = entry()
  run.run.run_attempt = 2
  run.attempts.push({
    number: 2,
    startedAt: stamp(1000),
    conclusion: 'failure',
    jobs: [
      job(103, 'quick', 2, {
        conclusion: 'failure',
        created_at: stamp(1005),
        started_at: stamp(1010),
        completed_at: stamp(1100),
      }),
    ],
  })
  run.run.conclusion = 'failure'
  assert.equal(analyzeCiPerformance(snapshot([run])).latestRuns[0].observedRetainedRunnerSeconds, 0)
})

function copiedCheckSnapshot() {
  const run = entry()
  run.run.created_at = '2026-10-31T05:31:36Z'
  run.run.id = 41172855617
  run.run.run_attempt = 2
  const original = job(124455277111, 'Source and package tests', 1, {
    status: 'completed',
    run_id: run.run.id,
    created_at: '2026-10-31T05:35:14Z',
    started_at: '2026-10-31T05:54:42Z',
    completed_at: '2026-10-31T05:59:34Z',
    runner_id: 19,
    runner_name: 'GitHub Actions 1000017883',
    labels: ['ubuntu-24.04'],
    runner_group_id: 0,
    steps: [
      {
        number: 1,
        name: 'Run source tests',
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-10-31T05:54:42Z',
        completed_at: '2026-10-31T05:59:34Z',
      },
    ],
  })
  run.attempts = [
    { number: 1, startedAt: run.run.created_at, conclusion: 'success', jobs: [original] },
    {
      number: 2,
      startedAt: '2026-10-31T06:01:00Z',
      conclusion: 'success',
      jobs: [
        {
          ...structuredClone(original),
          id: 124460177041,
          run_attempt: 2,
          created_at: '2026-10-31T06:01:02Z',
          runner_group_id: null,
        },
        job(124460177042, 'Quick development checks', 2, {
          run_id: run.run.id,
          created_at: '2026-10-31T06:01:03Z',
          started_at: '2026-10-31T06:01:05Z',
          completed_at: '2026-10-31T06:03:05Z',
        }),
      ],
    },
  ]
  return {
    repository: 'jiggy/jig',
    since: '2026-10-31T00:00:00Z',
    until: '2026-11-01T00:00:00Z',
    runs: [run],
  }
}

test('GitHub copied successful checks retain the original execution once without reversed timing', () => {
  const report = analyzeCiPerformance(copiedCheckSnapshot())
  const copy = report.attempts[1].jobs[0]
  assert.equal(copy.classification, 'carried-success-check')
  assert.deepEqual(copy.carriedExecution, {
    origin: 'matched',
    originJobId: 124455277111,
    originAttempt: 1,
  })
  assert.equal(copy.releasedAfterSeconds, null)
  assert.equal(copy.jobQueueSeconds, null)
  assert.equal(copy.executionSeconds, null)
  assert.equal(report.attempts[0].runnerSeconds, 292)
  assert.equal(report.attempts[1].runnerSeconds, 120)
  assert.equal(report.attempts[1].elapsedSeconds, 125)
  assert.equal(report.latestRuns[0].observedRetainedRunnerSeconds, 292)
  assert.deepEqual(
    report.latestRuns[0].observedRetainedSuccessfulJobs.map((job) => job.id),
    [124455277111],
  )
})

test('copied success with missing or ambiguous execution origins stays explicit without timing credit', () => {
  const missing = copiedCheckSnapshot()
  missing.runs[0].attempts[0].jobs = []
  const report = analyzeCiPerformance(missing)
  assert.equal(report.attempts[1].jobs[0].carriedExecution.origin, 'unobserved')
  assert.equal(report.latestRuns[0].observedRetainedRunnerSeconds, 0)
  const ambiguous = copiedCheckSnapshot()
  const run = ambiguous.runs[0]
  const copyAttempt = run.attempts.pop()
  const repeated = structuredClone(run.attempts[0])
  repeated.number = 2
  repeated.jobs[0].id++
  repeated.jobs[0].run_attempt = 2
  run.attempts.push(repeated)
  copyAttempt.number = 3
  for (const job of copyAttempt.jobs) job.run_attempt = 3
  run.attempts.push(copyAttempt)
  run.run.run_attempt = 3
  const result = analyzeCiPerformance(ambiguous)
  assert.equal(result.attempts[2].jobs[0].carriedExecution.origin, 'ambiguous')
  assert.equal(result.latestRuns[0].observedRetainedRunnerSeconds, 0)
})

test('a later failure or pending real job supersedes copied success observations', () => {
  for (const conclusion of ['failure', null]) {
    const input = copiedCheckSnapshot()
    const run = input.runs[0]
    run.run.run_attempt = 3
    run.run.conclusion = conclusion
    run.attempts.push({
      number: 3,
      startedAt: '2026-10-31T06:05:00Z',
      conclusion,
      jobs: [
        job(124460177043, 'Source and package tests', 3, {
          run_id: run.run.id,
          conclusion,
          created_at: '2026-10-31T06:05:02Z',
          started_at: '2026-10-31T06:05:03Z',
          completed_at: conclusion ? '2026-10-31T06:05:30Z' : null,
        }),
      ],
    })
    assert.equal(
      analyzeCiPerformance(input).latestRuns[0].observedRetainedSuccessfulJobs.some(
        (job) => job.name === 'Source and package tests',
      ),
      false,
    )
  }
})

test('a matched copy of older green cannot mask an intervening real failure on a later attempt', () => {
  const input = copiedCheckSnapshot()
  const run = input.runs[0]
  const copiedAttempt = run.attempts.pop()
  run.attempts.push({
    number: 2,
    startedAt: '2026-10-31T06:00:00Z',
    conclusion: 'failure',
    jobs: [
      job(124460177043, 'Source and package tests', 2, {
        run_id: run.run.id,
        conclusion: 'failure',
        created_at: '2026-10-31T06:00:01Z',
        started_at: '2026-10-31T06:00:02Z',
        completed_at: '2026-10-31T06:00:30Z',
      }),
    ],
  })
  copiedAttempt.number = 3
  for (const job of copiedAttempt.jobs) job.run_attempt = 3
  run.attempts.push(copiedAttempt)
  run.run.run_attempt = 4
  run.attempts.push({
    number: 4,
    startedAt: '2026-10-31T06:06:00Z',
    conclusion: 'success',
    jobs: [
      job(124460177044, 'Other check', 4, {
        run_id: run.run.id,
        created_at: '2026-10-31T06:06:01Z',
        started_at: '2026-10-31T06:06:02Z',
        completed_at: '2026-10-31T06:06:30Z',
      }),
    ],
  })
  const report = analyzeCiPerformance(input)
  assert.equal(report.attempts[2].jobs[0].carriedExecution.origin, 'matched')
  assert.equal(
    report.latestRuns[0].observedRetainedSuccessfulJobs.some(
      (job) => job.name === 'Source and package tests',
    ),
    false,
  )
})

test('collection preserves qualification rate budget and preflights the complete window', () => {
  const rate = (remaining, limit = 1000) => ({ resources: { core: { remaining, limit } } })
  assert.equal(performanceRequestBudget(rate(1000)), 200)
  assert.equal(performanceRequestBudget(rate(550)), 50)
  assert.equal(performanceRequestBudget(rate(15000, 15000)), 200)
  for (const invalid of [rate(500), rate(20), rate(1100), {}, rate('900')])
    assert.throws(() => performanceRequestBudget(invalid))
  const runs = Array.from({ length: 98 }, (_, i) => ({ id: i + 1, run_attempt: 1 }))
  assert.doesNotThrow(() => requireCollectionBudget(runs, 4, 200))
  assert.throws(
    () => requireCollectionBudget([...runs, { id: 99, run_attempt: 1 }], 4, 200),
    /Complete performance window exceeds/,
  )
  assert.throws(
    () => requireCollectionBudget([{ id: 1, run_attempt: 2 }], 4, 6),
    /Complete performance window exceeds/,
  )
})

test('approval, no-runner cancellation, generic failures and skipped jobs retain their distinct evidence', () => {
  const run = entry()
  run.attempts[0].conclusion = 'cancelled'
  run.run.conclusion = 'cancelled'
  run.attempts[0].jobs = [
    job(101, 'unassigned', 1, { conclusion: 'cancelled', runner_name: '', started_at: null }),
    job(102, 'unknown-cancel', 1, {
      conclusion: 'cancelled',
      steps: undefined,
      runner_name: undefined,
    }),
    job(103, 'failed', 1, {
      conclusion: 'failure',
      steps: [{ name: 'Run checks', conclusion: 'failure' }],
    }),
    job(104, 'skipped', 1, { conclusion: 'skipped' }),
  ]
  const approval = entry()
  approval.run.id = 11
  approval.run.conclusion = 'action_required'
  approval.attempts[0] = { number: 1, startedAt: stamp(0), conclusion: 'action_required', jobs: [] }
  const report = analyzeCiPerformance(snapshot([run, approval]))
  assert.deepEqual(
    report.attempts[0].jobs.map((row) => row.classification),
    ['runner-not-assigned', 'job-cancelled', 'job-failed', 'job-skipped'],
  )
  assert.deepEqual(report.attempts[0].jobs[2].failedSteps, ['Run checks'])
  assert.equal(report.attempts[0].jobs[3].executionSeconds, null)
  assert.equal(report.latestRuns[1].elapsedSeconds, null)
  assert.deepEqual(report.workflowSummaries[0].conclusions, { cancelled: 1, action_required: 1 })
  assert.equal(report.workflowSummaries[0].successfulFirstAttempts.count, 0)
  assert.equal('flakeRate' in report, false)
})

test('a cancellation with GitHub sentinel start time and no runner never becomes execution', () => {
  const run = entry()
  run.run.conclusion = run.attempts[0].conclusion = 'cancelled'
  run.attempts[0].jobs = [
    job(101, 'Python 3.14 on macos-14', 1, {
      runner_name: '',
      steps: [],
      conclusion: 'cancelled',
      created_at: stamp(300),
      started_at: stamp(300),
      completed_at: stamp(3014),
    }),
  ]
  const report = analyzeCiPerformance(snapshot([run]))
  const observation = report.attempts[0].jobs[0]
  assert.equal(observation.classification, 'runner-not-assigned')
  assert.equal(observation.jobQueueSeconds, null)
  assert.equal(observation.executionSeconds, null)
  assert.equal(observation.unassignedSeconds, 2714)
  assert.equal(report.attempts[0].runnerSeconds, 0)
})

test('only a complete unambiguous three-workflow success receives an event-head envelope', () => {
  const runs = PERFORMANCE_WORKFLOWS.map((path, i) => {
    const run = entry()
    run.run.id += i
    run.run.path = path
    run.attempts[0].jobs = [
      job(101 + i, 'host', 1, { run_id: 10 + i, completed_at: stamp(480 + i * 60) }),
    ]
    return run
  })
  const report = analyzeCiPerformance(snapshot(runs))
  assert.equal(report.envelopes[0].threeWorkflowEnvelopeSeconds, 600)
  assert.equal(report.envelopes[0].eventHeadSha, source)
  const duplicate = structuredClone(runs[0])
  duplicate.run.id = 20
  duplicate.attempts[0].jobs = [job(201, 'host', 1, { run_id: 20 })]
  const ambiguous = analyzeCiPerformance(snapshot([...runs, duplicate]))
  assert.equal(ambiguous.envelopes[0].threeWorkflowEnvelopeSeconds, null)
  assert.equal(ambiguous.envelopes[0].reason, 'missing-or-duplicate-workflow')
})

test('PR budget reporting keeps failed, cancelled, incomplete and ambiguous groups in its denominator', () => {
  const failed = workflowGroup(130)
  failed[1].run.conclusion = failed[1].attempts[0].conclusion = 'failure'
  failed[1].attempts[0].jobs[0].conclusion = 'failure'
  failed[2].run.conclusion = failed[2].attempts[0].conclusion = 'cancelled'
  failed[2].attempts[0].jobs[0].conclusion = 'cancelled'
  const cancelled = workflowGroup(140)
  cancelled[2].run.conclusion = cancelled[2].attempts[0].conclusion = 'cancelled'
  cancelled[2].attempts[0].jobs[0].conclusion = 'cancelled'
  const pending = workflowGroup(160)
  pending[2].run.conclusion = pending[2].attempts[0].conclusion = null
  Object.assign(pending[2].attempts[0].jobs[0], { conclusion: null, completed_at: null })
  const ambiguous = workflowGroup(170)
  const duplicate = structuredClone(ambiguous[0])
  duplicate.run.id = 173
  Object.assign(duplicate.attempts[0].jobs[0], { id: 1730, run_id: 173 })
  const report = analyzeCiPerformance(
    snapshot([
      ...workflowGroup(100, 600),
      ...workflowGroup(110, 1500),
      ...workflowGroup(120, 1501),
      ...failed,
      ...cancelled,
      ...workflowGroup(150).slice(0, 2),
      ...pending,
      ...ambiguous,
      duplicate,
      ...workflowGroup(180, 1800, 'push'),
    ]),
  )
  assert.equal(report.prEnvelopeSummary.budgetSeconds, 1500)
  assert.equal(report.prEnvelopeSummary.groupCount, 8)
  assert.deepEqual(report.prEnvelopeSummary.outcomes, {
    success: 3,
    failed: 1,
    cancelled: 1,
    incomplete: 2,
    ambiguous: 1,
  })
  assert.deepEqual(report.prEnvelopeSummary.successful, {
    count: 3,
    medianSeconds: 1500,
    p90Seconds: 1501,
    p95Seconds: 1501,
    maxSeconds: 1501,
    overBudgetCount: 1,
  })
  assert.deepEqual(
    report.envelopes
      .filter((row) => row.outcome !== 'success')
      .map((row) => row.threeWorkflowEnvelopeSeconds),
    [null, null, null, null, null],
  )
  const markdown = performanceMarkdown(report)
  assert.ok(markdown.includes('Observed PR event-head groups: 8.'))
  assert.ok(markdown.includes('| 3 | 1 | 1 | 2 | 1 |'))
  assert.ok(markdown.includes('| All latest successes | 3 | 25.0 | 25.0 | 25.0 | 25.0 | 1 |'))
  assert.ok(markdown.includes('not distinct pushes or verified branch-policy readiness'))
})

test('PR timing quantiles and maximum use successful envelopes rather than summed workflow durations', () => {
  const runs = Array.from({ length: 20 }, (_, index) =>
    workflowGroup(1000 + index * 10, 600 + index * 60),
  ).flat()
  const report = analyzeCiPerformance(snapshot(runs))
  assert.deepEqual(report.prEnvelopeSummary.successful, {
    count: 20,
    medianSeconds: 1170,
    p90Seconds: 1620,
    p95Seconds: 1680,
    maxSeconds: 1740,
    overBudgetCount: 4,
  })
  assert.deepEqual(
    report.prEnvelopeSummary.successfulFirstAttempts,
    report.prEnvelopeSummary.successful,
  )
})

test('successful retry envelopes retain the original creation time and preceding unsuccessful attempt', () => {
  const runs = workflowGroup(200)
  const retried = runs[2]
  retried.run.run_attempt = 2
  retried.attempts[0].conclusion = retried.attempts[0].jobs[0].conclusion = 'failure'
  retried.attempts.push({
    number: 2,
    startedAt: stamp(1800),
    conclusion: 'success',
    jobs: [
      job(2030, 'host', 2, {
        run_id: retried.run.id,
        head_sha: retried.run.head_sha,
        created_at: stamp(1810),
        started_at: stamp(1820),
        completed_at: stamp(1860),
      }),
    ],
  })
  const report = analyzeCiPerformance(snapshot(runs))
  assert.equal(report.envelopes[0].hasRetries, true)
  assert.equal(report.envelopes[0].threeWorkflowEnvelopeSeconds, 1860)
  assert.equal(report.latestRuns[2].elapsedSeconds, 60)
  assert.equal(report.attempts[2].conclusion, 'failure')
  assert.equal(report.prEnvelopeSummary.successfulFirstAttempts.count, 0)
  assert.deepEqual(report.prEnvelopeSummary.successfulWithRetries, {
    count: 1,
    medianSeconds: 1860,
    p90Seconds: 1860,
    p95Seconds: 1860,
    maxSeconds: 1860,
    overBudgetCount: 1,
  })
  assert.ok(
    performanceMarkdown(report).includes('| After reruns | 1 | 31.0 | 31.0 | 31.0 | 31.0 | 1 |'),
  )
})

test('a window without PR successes reports empty timing without a fast-success fallback', () => {
  const report = analyzeCiPerformance(snapshot(workflowGroup(300, 1800, 'push')))
  assert.equal(report.prEnvelopeSummary.groupCount, 0)
  assert.deepEqual(report.prEnvelopeSummary.successful, {
    count: 0,
    medianSeconds: null,
    p90Seconds: null,
    p95Seconds: null,
    maxSeconds: null,
    overBudgetCount: 0,
  })
  assert.ok(
    performanceMarkdown(report).includes('| All latest successes | 0 | — | — | — | — | 0 |'),
  )
})

test('foreign identity, duplicate jobs, reversed timing and missing attempts refuse the report', () => {
  const mutations = [
    (s) => {
      s.runs[0].run.repository.full_name = 'foreign/repo'
    },
    (s) => {
      s.runs[0].run.path = '.github/workflows/other.yml'
    },
    (s) => {
      s.runs[0].attempts[0].jobs.push(structuredClone(s.runs[0].attempts[0].jobs[0]))
    },
    (s) => {
      s.runs[0].attempts[0].jobs[0].run_id = 99
    },
    (s) => {
      s.runs[0].attempts[0].jobs[0].head_sha = 'b'.repeat(40)
    },
    (s) => {
      s.runs[0].attempts[0].jobs[0].started_at = stamp(250)
    },
    (s) => {
      s.runs[0].run.run_attempt = 2
    },
    (s) => {
      s.runs[0].attempts[0].number = 2
    },
    (s) => {
      s.until = stamp(-2)
    },
    (s) => {
      s.until = '2027-01-01T00:00:00Z'
    },
  ]
  for (const mutate of mutations) {
    const input = snapshot()
    mutate(input)
    assert.throws(() => analyzeCiPerformance(input))
  }
})

test('the real snapshot CLI is read-only and rejects ambiguous command options', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-ci-performance-'))
  try {
    const file = join(directory, 'snapshot.json')
    const contents = JSON.stringify(snapshot())
    await writeFile(file, contents)
    const script = resolve(import.meta.dirname, 'ci-performance.mjs')
    const child = spawnSync(process.execPath, [script, '--snapshot', file], { encoding: 'utf8' })
    assert.equal(child.status, 0, child.stderr)
    assert.equal(JSON.parse(child.stdout).latestRuns[0].elapsedSeconds, 480)
    assert.equal(await readFile(file, 'utf8'), contents)
    const reportPath = join(directory, 'report.json')
    await writeFile(reportPath, child.stdout)
    const rendered = spawnSync(process.execPath, [script, '--report', reportPath], {
      encoding: 'utf8',
    })
    assert.equal(rendered.status, 0, rendered.stderr)
    assert.ok(rendered.stdout.includes('| ci.yml | pull_request | 1 | 8.0 | 8.0 | success: 1 |'))
    assert.ok(rendered.stdout.includes('no flake rate'))
    assert.ok(rendered.stdout.includes('PR three-workflow elapsed envelope'))
    assert.ok(
      rendered.stdout.includes('latest observed job completion in the successful workflows'),
    )
    assert.ok(rendered.stdout.includes('Observed PR event-head groups: 1.'))
    assert.ok(rendered.stdout.includes('| 0 | 0 | 0 | 1 | 0 |'))
    for (const args of [
      ['--snapshot', file, '--repository', 'jiggy/jig'],
      ['--snapshot', file, '--snapshot', file],
      ['--unknown', 'value'],
    ]) {
      const refused = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
      assert.equal(refused.status, 1)
      assert.equal(refused.stdout, '')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('daily observation workflow stays read-only, bounded and separate from qualification', async () => {
  const workflow = parse(
    await readFile(new URL('../../.github/workflows/ci-performance.yml', import.meta.url), 'utf8'),
  )
  assert.deepEqual(Object.keys(workflow.on).sort(), ['schedule', 'workflow_dispatch'])
  assert.equal(workflow.on.schedule[0].cron, '17 3 * * *')
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' })
  const job = workflow.jobs.report
  assert.equal(job.if, "github.ref == 'refs/heads/main'")
  assert.equal(job['runs-on'], 'ubuntu-24.04')
  assert.equal(job['timeout-minutes'], 20)
  assert.equal(job.steps[0].with['persist-credentials'], false)
  const collect = job.steps.find((step) => step.run?.includes('--since'))
  assert.ok(collect.run.includes('days*24*60*60*1000'))
  assert.ok(collect.run.includes('[1,3,7].includes(days)'))
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.days.options, ['1', '3', '7'])
  assert.ok(collect.run.includes('setUTCHours(0,0,0,0)'))
  assert.ok(collect.run.includes('--report'))
  assert.equal(collect.env.GH_TOKEN, '$' + '{{ github.token }}')
  assert.equal(job.steps.at(-1).with['retention-days'], 14)
  assert.ok(job.steps.every((step) => !step.run || !/\b(?:bun|npm|just|sudo)\b/.test(step.run)))
})
