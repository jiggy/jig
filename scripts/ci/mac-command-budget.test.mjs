import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { macJobBudget, retainedMacBudget, runCommandBeforeDeadline } from './mac-command-budget.mjs'

const now = Date.now()
const expected = {
  repository: 'jiggy/jig',
  source: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  runId: 42,
  attempt: 2,
  name: 'Native host shard — macos-26 / 0',
  minutes: 25,
}
const job = {
  id: 100,
  run_id: 42,
  run_attempt: 2,
  head_sha: expected.headSha,
  name: expected.name,
  runner_id: 1,
  runner_name: 'Hosted Mac',
  labels: ['macos-26'],
  status: 'in_progress',
  created_at: new Date(now - 60000).toISOString(),
  started_at: new Date(now - 1000).toISOString(),
  steps: [{ started_at: new Date(now - 900).toISOString() }],
}
const budgetEnv = (budget) => ({
  GITHUB_SHA: expected.source,
  GITHUB_RUN_ID: '42',
  GITHUB_RUN_ATTEMPT: '2',
  JIG_MACOS_BUDGET: JSON.stringify(budget),
})

test('Mac work anchors only to the exact active assigned execution, preserving a two-minute reserve', () => {
  const budget = macJobBudget([job], expected, now)
  assert.equal(budget.finalDeadline, Date.parse(job.started_at) + 1500000)
  assert.equal(budget.workDeadline, budget.finalDeadline - 120000)
  assert.equal(budget.jobId, job.id)
  assert.deepEqual(retainedMacBudget(budgetEnv(budget), now), budget)
  assert.equal(
    macJobBudget([job], { ...expected, minutes: 65 }, now).finalDeadline,
    Date.parse(job.started_at) + 3900000,
  )
  for (const changed of [
    { runner_id: 0 },
    { runner_name: '' },
    { status: 'queued' },
    { status: 'completed' },
    { run_attempt: 1 },
    { head_sha: expected.source },
    { labels: ['ubuntu-24.04'] },
    { steps: [] },
    { started_at: new Date(now + 1000).toISOString() },
    { created_at: new Date(now + 1000).toISOString() },
  ])
    assert.throws(
      () => macJobBudget([{ ...job, ...changed }], expected, now),
      /exact active assigned/,
    )
  assert.throws(() => macJobBudget([], expected, now), /Missing/)
  assert.throws(() => macJobBudget([job, job], expected, now), /ambiguous/)
  assert.throws(() => macJobBudget([job], { ...expected, minutes: 90 }, now), /identity/)
  assert.throws(() => macJobBudget([job], expected, now + 1500000), /expired/)
})

test('retained deadline arithmetic and workflow identities are validated', () => {
  const budget = macJobBudget([job], expected, now)
  for (const changed of [
    { source: 'c'.repeat(40) },
    { runId: 43 },
    { attempt: 3 },
    { finalDeadline: budget.finalDeadline + 1 },
    { workDeadline: budget.workDeadline + 1 },
    { jobId: 0 },
  ])
    assert.throws(() => retainedMacBudget(budgetEnv({ ...budget, ...changed }), now))
})

test('real command success and failure preserve their exit status, while expired work cannot start', async () => {
  const success = await runCommandBeforeDeadline(process.execPath, ['-e', 'process.exit(0)'], {
    deadlineEpochMs: Date.now() + 5000,
  })
  assert.equal(success.code, 0)
  assert.equal(success.deadlineExceeded, false)
  const failure = await runCommandBeforeDeadline(process.execPath, ['-e', 'process.exit(7)'], {
    deadlineEpochMs: Date.now() + 5000,
  })
  assert.equal(failure.code, 7)
  await assert.rejects(
    runCommandBeforeDeadline(process.execPath, ['-e', 'process.exit(0)'], {
      deadlineEpochMs: Date.now() - 1,
    }),
    /elapsed/,
  )
  await assert.rejects(
    runCommandBeforeDeadline(process.execPath, [], { deadlineEpochMs: null }),
    /Invalid/,
  )
})

test('real deadline cancellation rejects a child that acknowledges TERM by exiting successfully', async () => {
  const result = await runCommandBeforeDeadline(
    process.execPath,
    ['-e', "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"],
    { deadlineEpochMs: Date.now() + 2000, terminationGraceMs: 100 },
  )
  assert.equal(result.deadlineExceeded, true)
  assert.equal(result.code, 124)
})

test('successful leaders cannot leave a live descendant after the owned process group drains', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-mac-budget-'))
  const heartbeat = join(root, 'heartbeat')
  const pidFile = join(root, 'pid')
  let descendantPid
  const descendant =
    "const fs=require('fs');fs.writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>fs.writeFileSync(process.argv[2],String(Date.now())),10)"
  const leader =
    "const{spawn}=require('child_process');const fs=require('fs');spawn(process.execPath,['-e',process.argv[1],process.argv[2],process.argv[3]],{stdio:'ignore'});const poll=setInterval(()=>{if(fs.existsSync(process.argv[3])){clearInterval(poll);process.exit(0)}},5)"
  try {
    const result = await runCommandBeforeDeadline(
      process.execPath,
      ['-e', leader, descendant, pidFile, heartbeat],
      { deadlineEpochMs: Date.now() + 5000, terminationGraceMs: 100 },
    )
    assert.equal(result.code, 0)
    assert.equal(result.deadlineExceeded, false)
    descendantPid = Number(await readFile(pidFile, 'utf8'))
    const stopped = await readFile(heartbeat, 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.equal(await readFile(heartbeat, 'utf8'), stopped)
  } finally {
    if (descendantPid) {
      try {
        process.kill(descendantPid, 'SIGKILL')
      } catch {}
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('final CLI checking rejects an expired retained allowance without restarting it', () => {
  const budget = macJobBudget([job], expected, now)
  budget.started -= 1500000
  budget.finalDeadline -= 1500000
  budget.workDeadline -= 1500000
  const result = spawnSync(
    process.execPath,
    [new URL('./mac-command-budget.mjs', import.meta.url).pathname, 'check'],
    { env: { ...process.env, ...budgetEnv(budget) }, encoding: 'utf8', timeout: 5000 },
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /deadline expired/)
})
