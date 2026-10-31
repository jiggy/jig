import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import { analyzeCiPerformance, PERFORMANCE_WORKFLOWS } from './ci-performance.mjs'

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
  assert.ok(collect.run.includes('7*24*60*60*1000'))
  assert.ok(collect.run.includes('setUTCHours(0,0,0,0)'))
  assert.ok(collect.run.includes('--report'))
  assert.equal(collect.env.GH_TOKEN, '$' + '{{ github.token }}')
  assert.equal(job.steps.at(-1).with['retention-days'], 14)
  assert.ok(job.steps.every((step) => !step.run || !/\b(?:bun|npm|just|sudo)\b/.test(step.run)))
})
