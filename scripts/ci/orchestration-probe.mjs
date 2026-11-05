import assert from 'node:assert/strict'
import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function verifyProbeJobs(jobs, observedQueued) {
  assert.equal(jobs.length, 2, 'Probe requires both matrix jobs')
  const guard = jobs.find(job => job.name === 'Probe guard')
  const worker = jobs.find(job => job.name === 'Probe unallocated')
  assert.ok(guard && worker, 'Missing or duplicate probe role')
  assert.ok(observedQueued, 'No queued sibling was observed before cancellation')
  assert.equal(guard.conclusion, 'failure')
  assert.ok(guard.runner_id > 0 && guard.steps.some(step => step.started_at))
  assert.equal(worker.conclusion, 'cancelled')
  assert.ok(!worker.runner_id && !worker.runner_name)
  assert.ok(worker.steps.every(step => !step.started_at), 'Unallocated probe unexpectedly executed')
  const failure = guard.steps.find(step => step.conclusion === 'failure')
  assert.ok(failure?.completed_at, 'Missing monitor failure timestamp')
  const cancellationMs = Date.parse(worker.completed_at) - Date.parse(failure.completed_at)
  assert.ok(Number.isFinite(cancellationMs) && cancellationMs >= -1000 && cancellationMs <= 60_000,
    'Queued sibling did not settle within sixty seconds of guard failure')
  return { cancellationMs }
}

export async function runProbe(env, { apiOrigin = 'https://api.github.com', pollIntervalMs = 5000 } = {}) {
  const origin = new URL(apiOrigin)
  assert.ok(origin.origin === 'https://api.github.com' ||
    (origin.protocol === 'http:' && origin.hostname === '127.0.0.1'))
  assert.ok(Number.isSafeInteger(pollIntervalMs) && pollIntervalMs > 0 && pollIntervalMs <= 5000)
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch')
  assert.equal(env.GITHUB_REF, 'refs/heads/main')
  assert.match(env.GITHUB_REPOSITORY ?? '', /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/)
  assert.match(env.GITHUB_SHA ?? '', /^[0-9a-f]{40}$/)
  assert.match(env.GITHUB_RUN_ID ?? '', /^[1-9][0-9]*$/)
  assert.match(env.GITHUB_RUN_ATTEMPT ?? '', /^[1-9][0-9]*$/)
  assert.ok(env.GH_TOKEN)
  const marker = `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`
  const deadline = Date.now() + 180_000
  const prefix = `${origin.origin}/repos/${env.GITHUB_REPOSITORY}/actions/`
  const workflow = 'ci-orchestration-probe-worker.yml'
  const request = async (path, body) => {
    assert.ok(Date.now() < deadline, 'Probe observation deadline expired')
    const response = await fetch(prefix + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(Math.min(10_000, deadline - Date.now())),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    assert.ok(response.ok, `Probe API request failed: HTTP ${response.status}`)
    if (response.status === 204) return
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      assert.ok(size <= 4 * 1024 * 1024, 'Oversized probe metadata')
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  if (env.PROBE_CANCEL_ONLY === '1') {
    const runs = await request(`workflows/${workflow}/runs?event=workflow_dispatch&per_page=100`)
    const matches = runs.workflow_runs.filter(run => run.display_title === `CI probe child ${marker}`)
    assert.ok(matches.length <= 1, 'Ambiguous diagnostic child')
    for (const run of matches) {
      assert.equal(run.path, `.github/workflows/${workflow}`)
      assert.equal(run.repository.full_name, env.GITHUB_REPOSITORY)
      if (run.status !== 'completed') await request(`runs/${run.id}/cancel`, {})
    }
    return
  }
  let child
  let settled = false
  try {
    await request(`workflows/${workflow}/dispatches`, { ref: 'main', inputs: { parent: marker, source: env.GITHUB_SHA } })
    let observedQueued = false
    for (;;) {
      if (!child) {
        const runs = await request(`workflows/${workflow}/runs?event=workflow_dispatch&per_page=100`)
        const matches = runs.workflow_runs.filter(run => run.display_title === `CI probe child ${marker}`)
        assert.ok(matches.length <= 1, 'Ambiguous diagnostic child')
        child = matches[0]
        if (child) {
          assert.equal(child.head_sha, env.GITHUB_SHA, 'Main changed before dispatch; rerun the probe')
          assert.equal(child.head_branch, 'main')
          assert.equal(child.path, `.github/workflows/${workflow}`)
          assert.equal(child.repository.full_name, env.GITHUB_REPOSITORY)
        }
      }
      if (child) {
        const run = await request(`runs/${child.id}`)
        const snapshot = await request(`runs/${child.id}/attempts/1/jobs?per_page=100`)
        assert.equal(run.run_attempt, 1)
        assert.equal(snapshot.total_count, snapshot.jobs.length)
        observedQueued ||= snapshot.jobs.some(job => job.name === 'Probe unallocated' &&
          job.status === 'queued' && !job.runner_id && !job.steps.some(step => step.started_at))
        if (run.status === 'completed') {
          settled = true
          assert.equal(run.conclusion, 'failure', 'Diagnostic child must fail deliberately')
          const result = verifyProbeJobs(snapshot.jobs, observedQueued)
          const summary = `## Orchestration probe passed\n\n` +
            `Child: https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${child.id}\n\n` +
            `Queued cancellation settled in ${result.cancellationMs} ms relative to monitor failure.\n\n` +
            'The child failure is intentional. No native tests ran and no qualification evidence was created.\n'
          if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary)
          console.log(summary)
          return
        }
      }
      assert.ok(Date.now() + pollIntervalMs < deadline, 'Probe did not settle within three minutes')
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }
  } finally {
    if (child && !settled) {
      // Cancellation is a bounded cleanup request, not a claim that GitHub has settled it.
      await fetch(prefix + `runs/${child.id}/cancel`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
      }).catch(() => undefined)
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runProbe(process.env).catch(error => { console.error(error.message); process.exitCode = 1 })
