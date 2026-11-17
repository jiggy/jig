import assert from 'node:assert/strict'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  downloadArtifactDirectory,
  githubClient,
  paginated,
  verifyArtifactMetadata,
} from './candidate-transfer.mjs'

// Temporary public synthetic service control; never creates qualification evidence.
const env = process.env
const repository = env.GITHUB_REPOSITORY
const runId = Number(env.GITHUB_RUN_ID)
const attempt = Number(env.GITHUB_RUN_ATTEMPT)
const source = env.GITHUB_SHA
const candidateNames = ['alpha', 'beta']
const artifactName = `claim-service-r${runId}-a${attempt}`
const client = githubClient(repository)
const prefix = `repos/${repository}/actions/runs/${runId}`
function identity() {
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  assert.ok(Number.isSafeInteger(runId) && runId > 0)
  assert.equal(attempt, 1, 'This one-run control is not a retry experiment')
  assert.match(source, /^[a-f0-9]{40}$/)
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch')
}
function selectArtifact(artifacts, name) {
  const matches = artifacts.filter((item) => item.name === name)
  assert.equal(matches.length, 1, 'Exactly one finalized immutable artifact is required')
  const artifact = verifyArtifactMetadata(matches[0], { name, runId, headSha: source })
  assert.ok(artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 16384)
  return artifact
}
async function jsonArtifact(artifact, leaf) {
  const directory = join(env.RUNNER_TEMP, `control-artifact-${artifact.id}`)
  await downloadArtifactDirectory(client, artifact, directory)
  assert.deepEqual(await readdir(directory), [leaf])
  const bytes = await readFile(join(directory, leaf))
  assert.ok(bytes.length > 0 && bytes.length <= 8192)
  return JSON.parse(bytes)
}
async function jobs() {
  const result = await client.api(`${prefix}/attempts/${attempt}/jobs?per_page=100`)
  assert.ok(Array.isArray(result.jobs) && result.jobs.length === result.total_count)
  return result.jobs
}
function allocatedJob(rows, candidate, completed) {
  const name = `Claim candidate — ${candidate}`
  const matches = rows.filter((item) => item.name === name)
  assert.equal(matches.length, 1)
  const job = matches[0]
  assert.equal(job.run_id, runId)
  assert.equal(job.run_attempt, attempt)
  assert.equal(job.head_sha, source)
  assert.ok(Number.isSafeInteger(job.id) && job.id > 0)
  assert.ok(Number.isSafeInteger(job.runner_id) && job.runner_id > 0)
  assert.ok(job.runner_name)
  assert.deepEqual(job.labels, ['ubuntu-24.04'])
  assert.ok(Array.isArray(job.steps) && job.steps.length > 0)
  assert.ok(Date.parse(job.created_at) <= Date.parse(job.started_at))
  if (completed) {
    assert.equal(job.status, 'completed')
    assert.equal(job.conclusion, 'success')
    assert.ok(Date.parse(job.started_at) <= Date.parse(job.completed_at))
  } else assert.equal(job.status, 'in_progress')
  return job
}
function verifyClaim(claim, rows) {
  assert.equal(claim.kind, 'artifact-claim-service-control/1')
  assert.equal(claim.diagnosticOnly, true)
  assert.equal(claim.repository, repository)
  assert.equal(claim.sourceRevision, source)
  assert.equal(claim.runId, runId)
  assert.equal(claim.runAttempt, attempt)
  assert.ok(candidateNames.includes(claim.candidate))
  assert.equal(claim.jobId, allocatedJob(rows, claim.candidate, true).id)
  assert.ok(Number.isSafeInteger(claim.readyAt) && claim.readyAt < claim.claimAt)
  return claim
}

identity()
const [mode] = process.argv.slice(2)
if (mode === 'prepare') {
  const candidate = env.CANDIDATE
  assert.ok(candidateNames.includes(candidate))
  const run = await client.api(prefix)
  assert.equal(run.id, runId)
  assert.equal(run.run_attempt, attempt)
  assert.equal(run.head_sha, source)
  const job = allocatedJob(await jobs(), candidate, false)
  const claimAt = Date.parse(run.created_at) + 120000
  const readyAt = Date.now()
  assert.ok(
    Number.isFinite(claimAt) && claimAt - readyAt >= 1000,
    'Rendezvous was missed; no contention evidence',
  )
  const directory = join(env.RUNNER_TEMP, 'claim-control')
  await mkdir(directory)
  await writeFile(
    join(directory, 'CLAIM.json'),
    `${JSON.stringify({
      kind: 'artifact-claim-service-control/1',
      diagnosticOnly: true,
      repository,
      sourceRevision: source,
      runId,
      runAttempt: attempt,
      candidate,
      jobId: job.id,
      readyAt,
      claimAt,
    })}\n`,
    { flag: 'wx' },
  )
  await new Promise((resolve) => setTimeout(resolve, claimAt - Date.now()))
  console.log(JSON.stringify({ candidate, jobId: job.id, uploadRendezvousAt: Date.now(), claimAt }))
} else if (mode === 'outcome') {
  const claim = JSON.parse(await readFile(join(env.RUNNER_TEMP, 'claim-control/CLAIM.json')))
  assert.ok(['success', 'failure'].includes(env.UPLOAD_OUTCOME))
  const record = {
    ...claim,
    uploadOutcome: env.UPLOAD_OUTCOME,
    artifactId: env.ARTIFACT_ID ? Number(env.ARTIFACT_ID) : null,
  }
  await mkdir(join(env.RUNNER_TEMP, 'claim-outcome'))
  await writeFile(
    join(env.RUNNER_TEMP, 'claim-outcome/OUTCOME.json'),
    `${JSON.stringify(record)}\n`,
    { flag: 'wx' },
  )
} else if (mode === 'verify') {
  const artifacts = await paginated(client, `${prefix}/artifacts`, 'artifacts')
  const observedJobs = await jobs()
  const artifact = selectArtifact(artifacts, artifactName)
  const claim = verifyClaim(await jsonArtifact(artifact, 'CLAIM.json'), observedJobs)
  const outcomes = []
  for (const candidate of candidateNames) {
    const retained = selectArtifact(artifacts, `claim-outcome-${candidate}-r${runId}-a${attempt}`)
    const outcome = verifyClaim(await jsonArtifact(retained, 'OUTCOME.json'), observedJobs)
    assert.equal(outcome.candidate, candidate)
    outcomes.push(outcome)
  }
  const successful = outcomes.filter((row) => row.uploadOutcome === 'success')
  const failed = outcomes.filter((row) => row.uploadOutcome === 'failure')
  assert.equal(successful.length, 1)
  assert.equal(failed.length, 1)
  assert.equal(successful[0].candidate, claim.candidate)
  assert.equal(successful[0].jobId, claim.jobId)
  assert.equal(successful[0].artifactId, artifact.id)
  assert.equal(failed[0].artifactId, null)
  // Ordinary inert negative inputs establish refusal, not remote service behavior.
  assert.throws(() => selectArtifact([], artifactName))
  assert.throws(() => selectArtifact([artifact, artifact], artifactName))
  assert.throws(() => selectArtifact([{ ...artifact, expired: true }], artifactName))
  assert.throws(() => verifyClaim({ ...claim, jobId: claim.jobId + 1 }, observedJobs))
  const report = {
    diagnosticOnly: true,
    sourceRevision: source,
    runId,
    runAttempt: attempt,
    finalizedClaimArtifacts: 1,
    winner: {
      candidate: claim.candidate,
      jobId: claim.jobId,
      artifactId: artifact.id,
      digest: artifact.digest,
    },
    outcomes: outcomes.map((row) => ({
      candidate: row.candidate,
      jobId: row.jobId,
      uploadOutcome: row.uploadOutcome,
      artifactId: row.artifactId,
      readyAt: row.readyAt,
      claimAt: row.claimAt,
    })),
    absentAmbiguousExpiredAndWrongJobRefused: true,
    qualification: false,
  }
  await mkdir(join(env.RUNNER_TEMP, 'claim-control-report'))
  await writeFile(
    join(env.RUNNER_TEMP, 'claim-control-report/REPORT.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await appendFile(
    env.GITHUB_STEP_SUMMARY,
    '## Artifact first-claim service control\n\nExactly one finalized claim and one rejected upload were observed. Absent, ambiguous, expired and wrong-job claims refused. This is public synthetic platform evidence, not Mac or release qualification. Inspect the losing upload log to confirm the conflict cause.\n',
  )
  console.log(JSON.stringify(report))
} else throw Error('usage: artifact-claim-service-control.mjs prepare|outcome|verify')
