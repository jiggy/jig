import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { hostJobReason, hostJobSummary } from './host-job-diagnostics.mjs'

const identity = { repository: 'jiggy/jig', runId: 43882848119, attempt: 2 }
const unassigned = {
  id: 133383789366,
  run_id: identity.runId,
  run_attempt: 2,
  name: 'Native host worker — arm64 / 0',
  status: 'completed',
  conclusion: 'cancelled',
  runner_id: 0,
  runner_name: '',
  steps: [],
}
const annotations = [
  {
    annotation_level: 'failure',
    message: 'The job was not acquired by Runner of type hosted even after multiple attempts',
  },
  {
    annotation_level: 'notice',
    message:
      'Due to capacity constraints, jobs targeting macOS arm64 runners may experience longer queue times.',
  },
]

test('confirmed unallocated capacity failure is prominent and links the original job', () => {
  const failed = {
    ...unassigned,
    id: 12,
    name: 'Allocator',
    conclusion: 'failure',
    runner_id: 1,
    runner_name: 'runner',
  }
  const summary = hostJobSummary(identity, [failed, unassigned], { [unassigned.id]: annotations })
  assert.match(
    summary,
    /\*\*Infrastructure allocation failure: GitHub macOS ARM runner capacity unavailable/,
  )
  assert.ok(
    summary.includes(
      `https://github.com/jiggy/jig/actions/runs/${identity.runId}/job/${unassigned.id}`,
    ),
  )
  assert.ok(summary.indexOf('[Native host worker') < summary.indexOf('[Allocator]'))
  assert.match(summary, /No test steps started/)
  assert.match(summary, /re-run failed jobs within this unchanged workflow run/)
})

test('cancellation and partial or unknown annotations never invent a capacity cause', () => {
  for (const entries of [
    [],
    [annotations[0]],
    [annotations[1]],
    [{ message: 'private payload' }],
    annotations.map((entry) => ({ ...entry, annotation_level: 'warning' })),
  ]) {
    assert.match(hostJobReason(unassigned, entries), /Cause unavailable/)
  }
  for (const job of [
    { ...unassigned, runner_id: 1 },
    { ...unassigned, runner_name: 'runner' },
    { ...unassigned, steps: [{ name: 'Set up job' }] },
    { ...unassigned, runner_id: undefined },
    { ...unassigned, steps: undefined },
  ])
    assert.doesNotMatch(
      hostJobReason(job, annotations),
      /capacity unavailable|No test steps started/,
    )
  assert.match(
    hostJobReason({ ...unassigned, runner_id: null, runner_name: null }, annotations),
    /capacity unavailable/,
  )
})

test('foreign, duplicate and malformed observations refuse without raw annotation disclosure', () => {
  for (const jobs of [
    [{ ...unassigned, run_attempt: 1 }],
    [{ ...unassigned, run_id: 9 }],
    [{ ...unassigned, id: -1 }],
    [unassigned, unassigned],
  ])
    assert.throws(() => hostJobSummary(identity, jobs))
  assert.throws(() => hostJobSummary({ ...identity, repository: '../jig' }, [unassigned]))
  const summary = hostJobSummary(identity, [{ ...unassigned, name: '[spoof]|<SCRIPT>\nheading' }], {
    [unassigned.id]: [{ message: 'private payload' }],
  })
  assert.doesNotMatch(summary, /private payload|[<>]|\[spoof\]/)
  assert.equal(hostJobSummary(identity, [{ ...unassigned, conclusion: 'success' }]), '')
})

test('unavailable API diagnostics cannot fail their CLI or grant qualification', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jig-host-diagnostics-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const summary = join(root, 'summary.md')
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./host-job-diagnostics.mjs', import.meta.url))],
    {
      env: {
        PATH: root,
        GITHUB_REPOSITORY: identity.repository,
        GITHUB_RUN_ID: String(identity.runId),
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_STEP_SUMMARY: summary,
      },
      encoding: 'utf8',
      timeout: 5000,
    },
  )
  assert.ifError(result.error)
  assert.equal(result.status, 0)
  assert.match(await readFile(summary, 'utf8'), /diagnostics unavailable/)
  assert.doesNotMatch(result.stdout + result.stderr, /ENOENT|capacity unavailable/)
})

test('a verified PR collector distinguishes nonselected candidates from missing required coverage', () => {
  const candidate = { ...unassigned, name: 'Native host shard — macos-26 / 0' }
  const pr = { ...identity, event: 'pull_request' }
  const passing = hostJobSummary(
    { ...pr, macQualificationComplete: true },
    [candidate],
    { [candidate.id]: annotations },
  )
  assert.match(passing, /verified every selected shard/)
  assert.doesNotMatch(passing, /Infrastructure allocation failure/)
  const failed = hostJobSummary(pr, [candidate], {
    [candidate.id]: annotations,
  })
  assert.match(failed, /Infrastructure allocation failure/)
  assert.equal(hostJobSummary(pr, [{ ...candidate, conclusion: 'skipped' }]), '')
})
