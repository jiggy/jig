import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ciJobResults, writeCiJobResults } from './ci-job-results.mjs'

const helper = fileURLToPath(new URL('./ci-job-results.mjs', import.meta.url))
const jobs = {
  'source-tests': { result: 'success', outputs: {} },
  'quick-checks': { result: 'success', outputs: {} },
  'python-installed': { result: 'success', outputs: {} },
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'jig-ci-results-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return {
    root,
    output: join(root, 'results.json'),
    diagnostics: join(root, 'diagnostics.json'),
    json: async (name) => JSON.parse(await readFile(join(root, name), 'utf8')),
  }
}

test('successful needs retain source target aliases and do not invent observed proof', async (t) => {
  const f = await fixture(t)
  await writeCiJobResults({ jobs, ...f })
  const results = await f.json('results.json')
  assert.equal(results['source-portable'], 'success')
  assert.equal(results['source-protocol'], 'success')
  assert.equal(results['source-applications'], 'success')
  assert.equal(results['source-python'], 'success')
  assert.deepEqual(await f.json('diagnostics.json'), {
    schemaVersion: 1,
    failures: [],
    observations: null,
  })
})

test('actual failed CLI invocation writes results and diagnostics before refusing the aggregate', async (t) => {
  const f = await fixture(t)
  const summary = join(f.root, 'summary.md')
  const observations = join(f.root, 'jobs.json')
  await writeFile(
    observations,
    JSON.stringify([
      {
        id: 123,
        name: 'Python 3.14 on macos-14',
        conclusion: 'cancelled',
        runner_name: '',
        steps: [],
      },
    ]),
  )
  const result = spawnSync(
    process.execPath,
    [helper, '--output', f.output, '--diagnostics', f.diagnostics, '--jobs', observations],
    {
      env: {
        ...process.env,
        JOB_RESULTS: JSON.stringify({ ...jobs, 'python-installed': { result: 'cancelled' } }),
        GITHUB_STEP_SUMMARY: summary,
      },
      encoding: 'utf8',
      timeout: 5_000,
    },
  )
  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /python-installed=cancelled/)
  assert.equal((await f.json('results.json'))['python-installed'], 'cancelled')
  const diagnostics = await f.json('diagnostics.json')
  assert.deepEqual(diagnostics.failures, [{ id: 'python-installed', result: 'cancelled' }])
  assert.equal(diagnostics.observations[0].classification, 'runner-not-assigned')
  assert.match(await readFile(summary, 'utf8'), /Python 3.14 on macos-14: runner-not-assigned/)
})

test('started failures and cancellations retain their distinction without inferring a test cause', () => {
  const report = ciJobResults(jobs, [
    {
      id: 1,
      name: 'Source and package tests',
      conclusion: 'failure',
      runner_name: 'runner',
      steps: [{ name: 'Install dependencies', conclusion: 'failure' }],
    },
    {
      id: 2,
      name: 'Cancelled after start',
      conclusion: 'cancelled',
      runner_name: 'runner',
      steps: [],
    },
    { id: 3, name: 'Unknown runner', conclusion: 'cancelled', steps: [] },
    { id: 4, name: 'No step observation', conclusion: 'cancelled', runner_name: '' },
    { id: 5, name: 'Expired job', conclusion: 'timed_out', runner_name: 'runner', steps: [] },
    { id: 6, name: 'Successful', conclusion: 'success', runner_name: 'runner', steps: [] },
    { id: 7, name: 'Current aggregate', conclusion: null, runner_name: 'runner', steps: [] },
  ])
  assert.deepEqual(
    report.diagnostics.observations.map((job) => job.classification),
    ['job-failed', 'job-cancelled', 'job-cancelled', 'job-cancelled', 'job-timed-out'],
  )
  assert.deepEqual(report.diagnostics.observations[0].failedSteps, ['Install dependencies'])
  assert.equal(report.diagnostics.observations[2].runnerAssigned, null)
})

test('unavailable API metadata cannot change successful needs or hide failed source stages', async (t) => {
  const f = await fixture(t)
  const result = spawnSync(
    process.execPath,
    [
      helper,
      '--output',
      f.output,
      '--diagnostics',
      f.diagnostics,
      '--jobs',
      join(f.root, 'absent'),
    ],
    {
      env: {
        ...process.env,
        JOB_RESULTS: JSON.stringify(jobs),
        GITHUB_STEP_SUMMARY: join(f.root, 'summary.md'),
      },
      encoding: 'utf8',
      timeout: 5_000,
    },
  )
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.equal((await f.json('diagnostics.json')).observations, null)
  const failed = ciJobResults({ ...jobs, 'source-tests': { result: 'failure' } }, [])
  for (const target of [
    'source-portable',
    'source-protocol',
    'source-applications',
    'source-python',
  ])
    assert.equal(failed.results[target], 'failure')
})

test('malformed needs and existing evidence are refused without overwriting results', async (t) => {
  const f = await fixture(t)
  for (const bad of [
    null,
    [],
    {},
    { x: { result: 'success' } },
    { 'source-tests': { result: 'unknown' } },
  ])
    assert.throws(() => ciJobResults(bad), /Missing|Malformed/)
  await writeFile(f.output, 'original evidence')
  await assert.rejects(() => writeCiJobResults({ jobs, ...f }), /EEXIST/)
  assert.equal(await readFile(f.output, 'utf8'), 'original evidence')
})
