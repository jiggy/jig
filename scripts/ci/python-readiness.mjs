import { appendFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  digest,
  parseOptions,
  readMetadata,
  regularFile,
  requireRevision,
} from './candidate-provenance.mjs'
import {
  downloadArtifactDirectory,
  githubClient,
  paginated,
  validateWorkflowRun,
  verifyArtifactMetadata,
} from './candidate-transfer.mjs'
import { requireJobs } from './release-readiness.mjs'

export const PYTHON_QUALIFICATION_JOBS = Object.freeze([
  'Build Python SDK artifacts',
  'Source and package tests',
  'test',
  'Python 3.11 on ubuntu-24.04',
  'Python 3.12 on ubuntu-24.04',
  'Python 3.13 on ubuntu-24.04',
  'Python 3.14 on ubuntu-24.04',
  'Python 3.14 on macos-14',
  'Python 3.13 on windows-2022',
])
const WORKFLOW = '.github/workflows/ci.yml'
const HASH = /^[0-9a-f]{64}$/
const VERSION =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:a|b|rc)(?:0|[1-9][0-9]*)$/

function expectation(repository, sourceRevision) {
  return {
    repository,
    workflowPath: WORKFLOW,
    event: 'push',
    headBranch: 'main',
    headRepository: repository,
    headSha: sourceRevision,
  }
}
function qualifiedRun(run, expected, runId, runAttempt) {
  validateWorkflowRun(run, expected)
  if (
    run.id !== runId ||
    run.run_attempt !== runAttempt ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  )
    throw new Error('Python qualification requires the successful triggering CI attempt')
  return run
}

function validFiles(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) return false
  const names = Object.keys(files)
  const wheel = names.find(
    (name) =>
      name.startsWith('jiggy_flow-') &&
      name.endsWith('-py3-none-any.whl') &&
      VERSION.test(name.slice('jiggy_flow-'.length, -'-py3-none-any.whl'.length)),
  )
  return (
    names.length === 2 &&
    Boolean(wheel) &&
    names.includes(wheel.replace('-py3-none-any.whl', '.tar.gz')) &&
    names.every((name) => HASH.test(files[name] ?? ''))
  )
}

export async function verifyPythonCandidate(directory, sourceRevision) {
  requireRevision(sourceRevision)
  const receiptPath = await regularFile(directory, 'SUCCESS.json')
  const receipt = await readMetadata(receiptPath)
  if (
    receipt.package !== 'jiggy-flow' ||
    receipt.commit !== sourceRevision ||
    receipt.candidate !== true ||
    !VERSION.test(receipt.version ?? '') ||
    !['pending', 'installed'].includes(receipt.qualification)
  )
    throw new Error('Python candidate source or build receipt mismatch')
  const names = [
    `jiggy_flow-${receipt.version}-py3-none-any.whl`,
    `jiggy_flow-${receipt.version}.tar.gz`,
  ].sort()
  if (
    !receipt.files ||
    JSON.stringify(Object.keys(receipt.files).sort()) !== JSON.stringify(names) ||
    JSON.stringify((await readdir(directory)).sort()) !==
      JSON.stringify([...names, 'SUCCESS.json'].sort())
  )
    throw new Error('Python candidate requires exactly its retained wheel, sdist and receipt')
  for (const name of names) {
    const path = await regularFile(directory, name)
    if (
      !HASH.test(receipt.files[name] ?? '') ||
      digest(await readFile(path)) !== receipt.files[name]
    )
      throw new Error('Python candidate archive differs from its original receipt')
  }
  return { receiptSha256: digest(await readFile(receiptPath)), files: receipt.files }
}

export async function revalidatePythonSnapshot(
  snapshot,
  { client = githubClient(snapshot?.repository), now = Date.now() } = {},
) {
  if (
    snapshot?.schemaVersion !== 1 ||
    snapshot.group !== 'python' ||
    !HASH.test(snapshot.receiptSha256 ?? '') ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(snapshot.repository ?? '') ||
    !Number.isSafeInteger(snapshot.run?.runId) ||
    snapshot.run.runId <= 0 ||
    !Number.isSafeInteger(snapshot.run.runAttempt) ||
    snapshot.run.runAttempt <= 0 ||
    !Array.isArray(snapshot.run.jobs) ||
    !Number.isSafeInteger(snapshot.artifact?.artifactId) ||
    snapshot.artifact.artifactId <= 0 ||
    !validFiles(snapshot.files)
  )
    throw new Error('Invalid Python qualification snapshot')
  requireRevision(snapshot.sourceRevision)
  const expected = expectation(snapshot.repository, snapshot.sourceRevision)
  const proof = snapshot.run
  if (
    proof.workflowPath !== WORKFLOW ||
    proof.event !== 'push' ||
    proof.headSha !== snapshot.sourceRevision ||
    proof.headBranch !== 'main' ||
    proof.headRepository !== snapshot.repository ||
    JSON.stringify(proof.jobs.map((job) => job?.name).sort()) !==
      JSON.stringify([...PYTHON_QUALIFICATION_JOBS].sort()) ||
    new Set(proof.jobs.map((job) => job.jobId)).size !== PYTHON_QUALIFICATION_JOBS.length ||
    proof.jobs.some(
      (job) =>
        !Number.isSafeInteger(job.jobId) ||
        job.jobId <= 0 ||
        job.runId !== proof.runId ||
        job.runAttempt !== proof.runAttempt,
    ) ||
    snapshot.artifact.name !==
      `python-candidate-${snapshot.sourceRevision}-r${proof.runId}-a${proof.runAttempt}` ||
    !/^sha256:[0-9a-f]{64}$/.test(snapshot.artifact.digest ?? '') ||
    snapshot.artifact.runId !== proof.runId ||
    snapshot.artifact.headSha !== snapshot.sourceRevision
  )
    throw new Error('Python snapshot producer identity mismatch')
  const current = await client.api(`repos/${snapshot.repository}/actions/runs/${proof.runId}`)
  qualifiedRun(current, expected, proof.runId, proof.runAttempt)
  const jobs = await requireJobs(client, snapshot.repository, current, PYTHON_QUALIFICATION_JOBS)
  if (
    JSON.stringify([...jobs].sort((a, b) => a.name.localeCompare(b.name))) !==
    JSON.stringify([...proof.jobs].sort((a, b) => a.name.localeCompare(b.name)))
  )
    throw new Error('Python qualification jobs changed after authorization')
  const artifact = await client.api(
    `repos/${snapshot.repository}/actions/artifacts/${snapshot.artifact.artifactId}`,
  )
  verifyArtifactMetadata(artifact, {
    name: `python-candidate-${snapshot.sourceRevision}-r${proof.runId}-a${proof.runAttempt}`,
    runId: proof.runId,
    headSha: snapshot.sourceRevision,
    now,
  })
  if (
    artifact.id !== snapshot.artifact.artifactId ||
    artifact.name !== snapshot.artifact.name ||
    artifact.digest !== snapshot.artifact.digest ||
    snapshot.artifact.runId !== proof.runId ||
    snapshot.artifact.headSha !== snapshot.sourceRevision
  )
    throw new Error('Python candidate artifact changed after authorization')
  qualifiedRun(
    await client.api(`repos/${snapshot.repository}/actions/runs/${proof.runId}`),
    expected,
    proof.runId,
    proof.runAttempt,
  )
  return snapshot
}

export async function pythonReadiness({
  repository,
  sourceRevision,
  producerRunId,
  producerRunAttempt,
  client = githubClient(repository),
  now = Date.now(),
}) {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') ||
    !Number.isSafeInteger(producerRunId) ||
    producerRunId <= 0 ||
    !Number.isSafeInteger(producerRunAttempt) ||
    producerRunAttempt <= 0
  )
    throw new Error('Python readiness requires an exact repository, CI run and attempt')
  requireRevision(sourceRevision)
  const expected = expectation(repository, sourceRevision)
  const run = qualifiedRun(
    await client.api(`repos/${repository}/actions/runs/${producerRunId}`),
    expected,
    producerRunId,
    producerRunAttempt,
  )
  const jobs = await requireJobs(client, repository, run, PYTHON_QUALIFICATION_JOBS)
  if (jobs.some((job) => !Number.isSafeInteger(job.jobId) || job.jobId <= 0))
    throw new Error('Missing Python qualification job identity')
  const name = `python-candidate-${sourceRevision}-r${run.id}-a${run.run_attempt}`
  const artifacts = await paginated(
    client,
    `repos/${repository}/actions/runs/${run.id}/artifacts`,
    'artifacts',
  )
  const matching = artifacts.filter((artifact) => artifact.name === name)
  if (matching.length !== 1) throw new Error('Missing or ambiguous current-attempt Python artifact')
  const artifact = verifyArtifactMetadata(matching[0], {
    name,
    runId: run.id,
    headSha: sourceRevision,
    now,
  })
  const temporary = await mkdtemp(join(tmpdir(), 'jig-python-readiness-'))
  try {
    const directory = join(temporary, 'candidate')
    await downloadArtifactDirectory(client, artifact, directory)
    const candidate = await verifyPythonCandidate(directory, sourceRevision)
    const snapshot = {
      schemaVersion: 1,
      repository,
      group: 'python',
      sourceRevision,
      run: {
        runId: run.id,
        runAttempt: run.run_attempt,
        workflowPath: run.path,
        event: run.event,
        headSha: run.head_sha,
        headBranch: run.head_branch,
        headRepository: run.head_repository.full_name,
        jobs,
      },
      artifact: {
        artifactId: artifact.id,
        name: artifact.name,
        digest: artifact.digest,
        runId: run.id,
        headSha: sourceRevision,
      },
      ...candidate,
    }
    return await revalidatePythonSnapshot(snapshot, { client, now })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { positional, options } = parseOptions(process.argv.slice(2))
    if (
      positional.length ||
      Object.keys(options).some(
        (key) => !['source', 'producer-run', 'producer-attempt', 'github-output'].includes(key),
      )
    )
      throw new Error(
        'Use --source SHA --producer-run ID --producer-attempt ATTEMPT [--github-output PATH]',
      )
    const snapshot = await pythonReadiness({
      repository: process.env.GITHUB_REPOSITORY,
      sourceRevision: options.source,
      producerRunId: Number(options['producer-run']),
      producerRunAttempt: Number(options['producer-attempt']),
    })
    if (options['github-output'])
      await appendFile(
        options['github-output'],
        `source_revision=${snapshot.sourceRevision}\nproducer_run_id=${snapshot.run.runId}\nproducer_run_attempt=${snapshot.run.runAttempt}\ncandidate_artifact_id=${snapshot.artifact.artifactId}\ncandidate_artifact_digest=${snapshot.artifact.digest}\ncandidate_receipt_sha256=${snapshot.receiptSha256}\npython_snapshot=${JSON.stringify(snapshot)}\n`,
      )
    console.log(
      JSON.stringify({
        sourceRevision: snapshot.sourceRevision,
        runId: snapshot.run.runId,
        runAttempt: snapshot.run.runAttempt,
        artifactId: snapshot.artifact.artifactId,
      }),
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
