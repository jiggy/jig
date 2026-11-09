import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyProbeJobs } from './orchestration-probe.mjs'
import { hostScopeSummary } from './host-scope.mjs'

test('probe rejects execution, missing queue observation and slow cancellation', () => {
  const jobs = [
    {
      name: 'Probe guard',
      conclusion: 'failure',
      runner_id: 1,
      steps: [
        {
          started_at: '2026-11-05T00:00:00Z',
          completed_at: '2026-11-05T00:00:30Z',
          conclusion: 'failure',
        },
      ],
      completed_at: '2026-11-05T00:00:30Z',
    },
    {
      name: 'Probe unallocated',
      conclusion: 'cancelled',
      runner_id: 0,
      runner_name: '',
      steps: [],
      completed_at: '2026-11-05T00:00:31Z',
    },
  ]
  assert.deepEqual(verifyProbeJobs(jobs, true), { cancellationMs: 1000 })
  assert.throws(() => verifyProbeJobs(jobs, false))
  for (const patch of [
    { runner_id: 1 },
    { conclusion: 'success' },
    { steps: [{ started_at: '2026-11-05T00:00:30Z' }] },
    { completed_at: '2026-11-05T00:02:00Z' },
  ]) {
    assert.throws(() => verifyProbeJobs([jobs[0], { ...jobs[1], ...patch }], true))
  }
})

test('scope summaries distinguish omission, selection and verified execution', () => {
  const report = { source: 'a'.repeat(40), reason: 'pending-changesets', required: false }
  assert.match(hostScopeSummary('macos', report), /Native qualification omitted/)
  assert.match(hostScopeSummary('macos', report, true), /No native tests ran/)
  assert.doesNotMatch(
    hostScopeSummary('macos', { ...report, required: true }),
    /qualification passed/,
  )
  assert.match(
    hostScopeSummary('macos', { ...report, required: true }, true),
    /All required host jobs passed/,
  )
})

test('controller dispatches one real HTTP diagnostic and verifies its queued cancellation', async (t) => {
  const { createServer } = await import('node:http')
  const { once } = await import('node:events')
  const { runProbe } = await import('./orchestration-probe.mjs')
  const requests = []
  let polls = 0
  const child = {
    id: 73,
    display_title: 'CI probe child 1-1',
    head_sha: 'a'.repeat(40),
    head_branch: 'main',
    event: 'workflow_dispatch',
    path: '.github/workflows/ci-orchestration-probe-worker.yml',
    repository: { full_name: 'jiggy/jig' },
  }
  const jobs = [
    {
      name: 'Probe guard',
      conclusion: 'failure',
      runner_id: 1,
      steps: [
        {
          started_at: '2026-11-05T00:00:00Z',
          completed_at: '2026-11-05T00:00:30Z',
          conclusion: 'failure',
        },
      ],
      completed_at: '2026-11-05T00:00:30Z',
    },
    {
      name: 'Probe unallocated',
      conclusion: 'cancelled',
      runner_id: 0,
      runner_name: '',
      steps: [],
      completed_at: '2026-11-05T00:00:31Z',
    },
  ]
  const server = createServer(async (req, res) => {
    requests.push([req.method, req.url])
    assert.equal(req.headers.authorization, 'Bearer probe-test-token')
    if (req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      const input = JSON.parse(body)
      assert.deepEqual(input, { ref: 'main', inputs: { parent: '1-1', source: 'a'.repeat(40) } })
      res.writeHead(204).end()
      return
    }
    res.setHeader('content-type', 'application/json')
    if (req.url.includes('/workflows/')) res.end(JSON.stringify({ workflow_runs: [child] }))
    else if (req.url.includes('/jobs?')) {
      res.end(
        JSON.stringify({
          total_count: 2,
          jobs: polls === 1 ? [jobs[0], { ...jobs[1], status: 'queued', conclusion: null }] : jobs,
        }),
      )
    } else {
      polls++
      res.end(
        JSON.stringify({
          run_attempt: 1,
          status: polls === 1 ? 'in_progress' : 'completed',
          conclusion: 'failure',
        }),
      )
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  await runProbe(
    {
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: 'jiggy/jig',
      GITHUB_SHA: 'a'.repeat(40),
      GITHUB_RUN_ID: '1',
      GITHUB_RUN_ATTEMPT: '1',
      GH_TOKEN: 'probe-test-token',
    },
    { apiOrigin: `http://127.0.0.1:${server.address().port}`, pollIntervalMs: 10 },
  )
  assert.equal(requests.filter(([method]) => method === 'POST').length, 1)
  assert.equal(polls, 2)
})

async function diagnosticBoundary(t, respond) {
  const { createServer } = await import('node:http')
  const { once } = await import('node:events')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const directory = await mkdtemp(join(tmpdir(), 'jig-ci-probe-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const requests = []
  const server = createServer(async (req, res) => {
    requests.push([req.method, req.url])
    res.setHeader('content-type', 'application/json')
    await respond(req, res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return {
    requests,
    options: { apiOrigin: `http://127.0.0.1:${server.address().port}`, pollIntervalMs: 10 },
    env: {
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: 'jiggy/jig',
      GITHUB_SHA: 'a'.repeat(40),
      GITHUB_RUN_ID: '1',
      GITHUB_RUN_ATTEMPT: '1',
      GH_TOKEN: 'private-test-credential',
      GITHUB_STEP_SUMMARY: join(directory, 'summary.md'),
    },
  }
}

function diagnosticChild(patch = {}) {
  return {
    id: 73,
    display_title: 'CI probe child 1-1',
    head_sha: 'a'.repeat(40),
    head_branch: 'main',
    event: 'workflow_dispatch',
    path: '.github/workflows/ci-orchestration-probe-worker.yml',
    repository: { full_name: 'jiggy/jig' },
    status: 'in_progress',
    ...patch,
  }
}

test('failed observation retains its original error and exposes refused cleanup without response bodies', async (t) => {
  const { runProbe } = await import('./orchestration-probe.mjs')
  const { readFile } = await import('node:fs/promises')
  const boundary = await diagnosticBoundary(t, (req, res) => {
    if (req.url.endsWith('/dispatches')) res.writeHead(204).end()
    else if (req.url.includes('/workflows/'))
      res.end(JSON.stringify({ workflow_runs: [diagnosticChild()] }))
    else res.writeHead(req.method === 'POST' ? 403 : 503).end('private-response-body')
  })
  await assert.rejects(
    runProbe(boundary.env, boundary.options),
    /Probe API request failed: HTTP 503/,
  )
  const summary = await readFile(boundary.env.GITHUB_STEP_SUMMARY, 'utf8')
  assert.match(summary, /Orchestration probe failed/)
  assert.match(summary, /Phase: child observation/)
  assert.match(summary, /actions\/runs\/73/)
  assert.match(summary, /Cancellation was not acknowledged \(HTTP 403\)/)
  assert.match(summary, /Settlement remains unverified/)
  assert.doesNotMatch(summary, /private-response-body|private-test-credential|probe passed/)
  assert.equal(
    boundary.requests.filter(([method, path]) => method === 'POST' && path.endsWith('/cancel'))
      .length,
    1,
  )
})

test('observation and final cleanup refuse unverified children before using their IDs', async (t) => {
  const { runProbe } = await import('./orchestration-probe.mjs')
  const { readFile } = await import('node:fs/promises')
  for (const [name, patch] of Object.entries({
    foreign: { repository: { full_name: 'other/repo' } },
    workflow: { path: '.github/workflows/other.yml' },
    id: { id: '73/../74' },
    branch: { head_branch: 'other' },
    event: { event: 'push' },
  })) {
    for (const cancelOnly of [false, true])
      await t.test(`${name} / cleanup=${cancelOnly}`, async (t) => {
        const boundary = await diagnosticBoundary(t, (req, res) => {
          if (req.method === 'POST') res.writeHead(204).end()
          else res.end(JSON.stringify({ workflow_runs: [diagnosticChild(patch)] }))
        })
        await assert.rejects(
          runProbe(
            { ...boundary.env, PROBE_CANCEL_ONLY: cancelOnly ? '1' : undefined },
            boundary.options,
          ),
        )
        assert.ok(
          boundary.requests.every(
            ([method, path]) => method === 'GET' || path.endsWith('/dispatches'),
          ),
        )
        const summary = await readFile(boundary.env.GITHUB_STEP_SUMMARY, 'utf8')
        assert.ok(
          summary.includes(`Phase: ${cancelOnly ? 'cleanup discovery' : 'child discovery'}`),
        )
        assert.match(summary, /No verified child link/)
        assert.doesNotMatch(summary, /actions\/runs\//)
      })
  }
})

test('a cancellation conflict requires a fresh completed observation of the exact child', async (t) => {
  const { runProbe } = await import('./orchestration-probe.mjs')
  const { readFile } = await import('node:fs/promises')
  for (const [name, patch, completed] of [
    ['completed', { status: 'completed' }, true],
    ['still queued', { status: 'queued' }, false],
    ['different source', { status: 'completed', head_sha: 'b'.repeat(40) }, false],
    ['different ID', { status: 'completed', id: 74 }, false],
  ]) {
    await t.test(name, async (t) => {
      const boundary = await diagnosticBoundary(t, (req, res) => {
        if (req.method === 'POST') res.writeHead(409).end()
        else if (req.url.includes('/workflows/'))
          res.end(JSON.stringify({ workflow_runs: [diagnosticChild()] }))
        else res.end(JSON.stringify(diagnosticChild({ run_attempt: 1, ...patch })))
      })
      const operation = runProbe({ ...boundary.env, PROBE_CANCEL_ONLY: '1' }, boundary.options)
      if (completed) await operation
      else await assert.rejects(operation, /cancellation was not acknowledged/)
      const summary = await readFile(boundary.env.GITHUB_STEP_SUMMARY, 'utf8')
      if (completed) assert.match(summary, /child completed before cancellation/)
      else assert.match(summary, /Cancellation was not acknowledged \(HTTP 409\)/)
      assert.equal(boundary.requests.filter(([method]) => method === 'POST').length, 1)
    })
  }
})

test('a main advance refuses the probe and requests cleanup of its verified child', async (t) => {
  const { runProbe } = await import('./orchestration-probe.mjs')
  const { readFile } = await import('node:fs/promises')
  const boundary = await diagnosticBoundary(t, (req, res) => {
    if (req.method === 'POST') res.writeHead(204).end()
    else res.end(JSON.stringify({ workflow_runs: [diagnosticChild({ head_sha: 'b'.repeat(40) })] }))
  })
  await assert.rejects(runProbe(boundary.env, boundary.options), /Main changed before dispatch/)
  const summary = await readFile(boundary.env.GITHUB_STEP_SUMMARY, 'utf8')
  assert.match(summary, /Phase: source validation/)
  assert.match(summary, /Cancellation requested\. Settlement remains unverified/)
  assert.equal(boundary.requests.filter(([, path]) => path.endsWith('/cancel')).length, 1)
})

test('final cleanup reports acknowledgement separately from settlement and refuses denied requests', async (t) => {
  const { runProbe } = await import('./orchestration-probe.mjs')
  const { readFile } = await import('node:fs/promises')
  for (const status of [202, 403]) {
    await t.test(String(status), async (t) => {
      const boundary = await diagnosticBoundary(t, (req, res) => {
        if (req.method === 'POST') res.writeHead(status).end()
        else res.end(JSON.stringify({ workflow_runs: [diagnosticChild()] }))
      })
      const operation = runProbe({ ...boundary.env, PROBE_CANCEL_ONLY: '1' }, boundary.options)
      if (status === 202) await operation
      else await assert.rejects(operation, /cancellation was not acknowledged/)
      const summary = await readFile(boundary.env.GITHUB_STEP_SUMMARY, 'utf8')
      assert.match(summary, /Diagnostic child cleanup/)
      assert.match(summary, /Settlement remains unverified/)
      assert.doesNotMatch(summary, /Orchestration probe passed/)
      assert.equal(boundary.requests.filter(([method]) => method === 'POST').length, 1)
    })
  }
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
  assert.ok(
    parent.jobs.probe.steps.some(
      (step) => step.if === 'always()' && step.env.PROBE_CANCEL_ONLY === '1',
    ),
  )
})

test('nonrelease readiness summaries offer no unnecessary release action', async () => {
  const { releaseSummary } = await import('./release-readiness.mjs')
  for (const state of ['not-release', 'ignored']) {
    const text = releaseSummary(
      { state, packages: [], checks: [], reasons: [], readyHost: false },
      'jiggy/jig',
    )
    assert.match(text, /Nothing published/)
    assert.doesNotMatch(text, /Merge the generated|Re-run all jobs/)
  }
})
