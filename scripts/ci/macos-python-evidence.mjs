import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import {
  candidateBinding,
  githubContext,
  readMetadata,
  regularFile,
  verifyCandidateBundle,
} from './candidate-provenance.mjs'
import {
  acquisitionExpectation,
  downloadArtifactDirectory,
  githubClient,
  paginated,
  validateWorkflowRun,
} from './candidate-transfer.mjs'
import { readGitHubApiJson, retryGitHubRead } from './github-read.mjs'
import { observedCount } from './job-evidence.mjs'
import { retainedMacBudget } from './mac-command-budget.mjs'
import { allRunJobs, latestJob } from './merge-attempts.mjs'
import { inputArtifact, mergeJobSpec, validateMergeRuntime } from './merge-retry.mjs'
import {
  MAC_PYTHON_MAJOR,
  MAC_PYTHON_PROFILE,
  MAC_PYTHON_SHARD,
  pythonInstalledJob,
} from './python-ci-profiles.mjs'

const WORKFLOW = '.github/workflows/macos-hosted-candidates.yml'
const BUILD_PYTHON = 'Build Python reporting artifacts'
const kinds = ['python', 'python-reporting']
const clientFor = (repository) =>
  githubClient(repository, { readApiJson: readGitHubApiJson, readArchive: retryGitHubRead })
const pythonSpec = mergeJobSpec(pythonInstalledJob(MAC_PYTHON_PROFILE))

export async function readMacPythonInputs({
  candidateDirectory,
  candidate,
  env = process.env,
  client = clientFor(env.GITHUB_REPOSITORY),
  waitUntil,
}) {
  const source = env.GITHUB_SHA
  const context = await githubContext({ env, sourceRevision: source })
  if (context.event !== 'pull_request' || context.workflowPath !== WORKFLOW)
    throw new Error('Native Python inputs require their PR Mac workflow')
  const envelope = candidateBinding(
    candidate ?? (await verifyCandidateBundle(candidateDirectory, { sourceRevision: source })),
    await readMetadata(join(candidateDirectory, 'ARTIFACT.json')),
  )
  if (envelope.sourceRevision !== source) throw new Error('Native Python candidate source changed')
  const expected = await acquisitionExpectation(source, env)
  const runs = `repos/${context.repository}/actions/runs`
  for (;;) {
    const run = await client.api(`${runs}/${envelope.producerRunId}`)
    validateWorkflowRun(run, expected)
    if (run.id !== envelope.producerRunId) throw new Error('Wrong CI run for native Python inputs')
    const jobs = await allRunJobs(client, context.repository, run)
    const producer = jobs.some(({ name }) => name === BUILD_PYTHON)
      ? latestJob(jobs, run, BUILD_PYTHON, { completed: false })
      : undefined
    if (!producer || ['queued', 'in_progress'].includes(producer.status)) {
      if (!waitUntil || Date.now() >= waitUntil || run.status === 'completed')
        throw new Error('The exact CI Python build has not completed')
      await new Promise((done) =>
        setTimeout(done, Math.min(10_000, Math.max(1, waitUntil - Date.now()))),
      )
      continue
    }
    const artifacts = await paginated(client, `${runs}/${run.id}/artifacts`, 'artifacts')
    const snapshot = { source, run, jobs, artifacts }
    const canonical = inputArtifact(snapshot, 'canonical')
    if (
      canonical.artifactId !== envelope.artifactId ||
      canonical.artifactDigest !== envelope.artifactDigest ||
      canonical.producerAttempt !== envelope.producerRunAttempt
    )
      throw new Error('Native Python artifacts came from a different canonical build')
    return {
      runId: run.id,
      inputs: kinds.map((kind) => inputArtifact(snapshot, kind)),
      artifacts,
    }
  }
}

export async function acquireMacPython({
  destination,
  candidateDirectory,
  receipt,
  env = process.env,
  client = clientFor(env.GITHUB_REPOSITORY),
  extract,
}) {
  const runtime = {
    os: env.RUNNER_OS,
    architecture: env.RUNNER_ARCH,
    image: env.ImageOS,
    imageVersion: env.ImageVersion,
    node: process.version,
  }
  validateMergeRuntime(pythonSpec, runtime)
  const budget = retainedMacBudget(env)
  // Leave time to run the installed test and retain its evidence.
  const waitUntil = budget.workDeadline - 120_000
  const before = await readMacPythonInputs({ candidateDirectory, env, client, waitUntil })
  await mkdir(destination)
  await Promise.all(
    before.inputs.map((input) =>
      downloadArtifactDirectory(
        client,
        before.artifacts.find(({ id }) => id === input.artifactId),
        join(destination, input.kind),
        { extract },
      ),
    ),
  )
  const after = await readMacPythonInputs({ candidateDirectory, env, client })
  if (before.runId !== after.runId || !isDeepStrictEqual(before.inputs, after.inputs))
    throw new Error('Native Python input changed during download')
  await writeFile(
    receipt,
    `${JSON.stringify(
      {
        source: env.GITHUB_SHA,
        profile: MAC_PYTHON_PROFILE,
        jobId: budget.jobId,
        producerRunId: before.runId,
        inputs: before.inputs,
        runtime,
      },
      null,
      2,
    )}\n`,
    { flag: 'wx' },
  )
}

export async function verifyMacPython({
  row,
  directory,
  candidateDirectory,
  candidate,
  env,
  client,
}) {
  const step = row.job.steps.filter(
    ({ name }) => name === 'Test installed Python reporting on macOS 15',
  )
  if (
    row.major !== MAC_PYTHON_MAJOR ||
    row.shard !== MAC_PYTHON_SHARD ||
    step.length !== 1 ||
    step[0].status !== 'completed' ||
    step[0].conclusion !== 'success'
  )
    throw new Error('Missing successful installed Python test on the selected macOS 15 worker')
  const receipt = await readMetadata(await regularFile(directory, 'PYTHON-INPUTS.json'))
  const expected = await readMacPythonInputs({ candidateDirectory, candidate, env, client })
  if (
    receipt.source !== env.GITHUB_SHA ||
    receipt.profile !== MAC_PYTHON_PROFILE ||
    receipt.jobId !== row.job.id ||
    receipt.producerRunId !== expected.runId ||
    !isDeepStrictEqual(receipt.inputs, expected.inputs)
  )
    throw new Error('Native Python proof used different immutable inputs or worker identity')
  validateMergeRuntime(pythonSpec, receipt.runtime)
  const transcript = await regularFile(directory, 'PYTHON-REPORTING.txt')
  const text = await readFile(transcript, 'utf8')
  if (!/^CI installed Python: Python 3\.14\.\d+$/m.test(text))
    throw new Error('Native Python proof has a different interpreter')
  const execution = await observedCount({ transcript })
  const runs = [...text.matchAll(/^Ran (\d+) tests? in [^\n]+\n\nOK$/gm)]
  if (runs.length !== 2 || runs[0][1] !== runs[1][1] || execution.count !== 2 * Number(runs[0][1]))
    throw new Error('Native Python proof requires both wheel and source distribution tests')
  return { ...receipt, executedCount: execution.count, skipped: execution.skipped }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [destination, candidateDirectory, receipt] = process.argv.slice(2)
    if (!destination || !candidateDirectory || !receipt || process.argv.length !== 5)
      throw new Error('Give destination, canonical candidate directory and receipt path')
    await acquireMacPython({ destination, candidateDirectory, receipt })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
