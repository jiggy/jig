import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyProbeJobs } from './orchestration-probe.mjs'
import { hostScopeSummary } from './host-scope.mjs'

test('probe rejects execution, missing queue observation and slow cancellation', () => {
  const jobs = [
    { name: 'Probe guard', conclusion: 'failure', runner_id: 1, steps: [{ started_at: '2026-11-05T00:00:00Z', completed_at: '2026-11-05T00:00:30Z', conclusion: 'failure' }], completed_at: '2026-11-05T00:00:30Z' },
    { name: 'Probe unallocated', conclusion: 'cancelled', runner_id: 0, runner_name: '', steps: [], completed_at: '2026-11-05T00:00:31Z' },
  ]
  assert.deepEqual(verifyProbeJobs(jobs, true), { cancellationMs: 1000 })
  assert.throws(() => verifyProbeJobs(jobs, false))
  for (const patch of [{ runner_id: 1 }, { conclusion: 'success' },
    { steps: [{ started_at: '2026-11-05T00:00:30Z' }] }, { completed_at: '2026-11-05T00:02:00Z' }]) {
    assert.throws(() => verifyProbeJobs([jobs[0], { ...jobs[1], ...patch }], true))
  }
})

test('scope summaries distinguish omission, selection and verified execution', () => {
  const report = { source: 'a'.repeat(40), reason: 'pending-changesets', required: false }
  assert.match(hostScopeSummary('macos', report), /Native qualification omitted/)
  assert.match(hostScopeSummary('macos', report, true), /No native tests ran/)
  assert.doesNotMatch(hostScopeSummary('macos', { ...report, required: true }), /qualification passed/)
  assert.match(hostScopeSummary('macos', { ...report, required: true }, true), /All required host jobs passed/)
})

test('controller dispatches one real HTTP diagnostic and verifies its queued cancellation', async t => {
  const { createServer } = await import('node:http')
  const { once } = await import('node:events')
  const { runProbe } = await import('./orchestration-probe.mjs')
  const requests = []
  let polls = 0
  const child = { id: 73, display_title: 'CI probe child 1-1', head_sha: 'a'.repeat(40),
    head_branch: 'main', path: '.github/workflows/ci-orchestration-probe-worker.yml',
    repository: { full_name: 'jiggy/jig' } }
  const jobs = [
    { name: 'Probe guard', conclusion: 'failure', runner_id: 1, steps: [{ started_at: '2026-11-05T00:00:00Z', completed_at: '2026-11-05T00:00:30Z', conclusion: 'failure' }], completed_at: '2026-11-05T00:00:30Z' },
    { name: 'Probe unallocated', conclusion: 'cancelled', runner_id: 0, runner_name: '', steps: [], completed_at: '2026-11-05T00:00:31Z' },
  ]
  const server = createServer(async (req, res) => {
    requests.push([req.method, req.url])
    assert.equal(req.headers.authorization, 'Bearer probe-test-token')
    if (req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk
      const input = JSON.parse(body)
      assert.deepEqual(input, { ref: 'main', inputs: { parent: '1-1', source: 'a'.repeat(40) } })
      res.writeHead(204).end(); return
    }
    res.setHeader('content-type', 'application/json')
    if (req.url.includes('/workflows/')) res.end(JSON.stringify({ workflow_runs: [child] }))
    else if (req.url.includes('/jobs?')) {
      res.end(JSON.stringify({ total_count: 2, jobs: polls === 1
        ? [jobs[0], { ...jobs[1], status: 'queued', conclusion: null }] : jobs }))
    } else {
      polls++
      res.end(JSON.stringify({ run_attempt: 1, status: polls === 1 ? 'in_progress' : 'completed', conclusion: 'failure' }))
    }
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  await runProbe({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'jiggy/jig', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1', GH_TOKEN: 'probe-test-token' },
    { apiOrigin: `http://127.0.0.1:${server.address().port}`, pollIntervalMs: 10 })
  assert.equal(requests.filter(([method]) => method === 'POST').length, 1)
  assert.equal(polls, 2)
})

test('diagnostic workflows restrict writes to the trusted controller', async () => {
  const { readFile } = await import('node:fs/promises')
  const { parse } = await import('yaml')
  const parent = parse(await readFile('.github/workflows/ci-orchestration-probe.yml', 'utf8'))
  const child = parse(await readFile('.github/workflows/ci-orchestration-probe-worker.yml', 'utf8'))
  assert.deepEqual(Object.keys(parent.on), ['workflow_dispatch'])
  assert.deepEqual(Object.keys(child.on), ['workflow_dispatch'])
  assert.deepEqual(child.permissions, {})
  assert.match(child.jobs.cancellation.if, /github.sha == inputs.source/)
  assert.equal(child.jobs.cancellation.strategy['max-parallel'], 2)
  assert.equal(child.jobs.cancellation.strategy['fail-fast'], true)
  assert.equal(parent.jobs.probe.permissions.actions, 'write')
  assert.equal(parent.jobs.probe.if, "github.ref == 'refs/heads/main'")
  assert.ok(parent.jobs.probe.steps.some(step => step.if === 'always()' && step.env.PROBE_CANCEL_ONLY === '1'))
})

test('nonrelease readiness summaries offer no unnecessary release action', async () => {
  const { releaseSummary } = await import('./release-readiness.mjs')
  for (const state of ['not-release', 'ignored']) {
    const text = releaseSummary({ state, packages: [], checks: [], reasons: [], readyHost: false }, 'jiggy/jig')
    assert.match(text, /Nothing published/)
    assert.doesNotMatch(text, /Merge the generated|Re-run all jobs/)
  }
})
