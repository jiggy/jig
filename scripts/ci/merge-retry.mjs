import { execFileSync } from 'node:child_process'
import { appendFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  digest,
  githubContext,
  parseOptions,
  readMetadata,
  requireRevision,
  verifyCandidateBundle,
} from './candidate-provenance.mjs'
import {
  acquisitionExpectation,
  downloadArtifactDirectory,
  githubClient,
  paginated,
  validateWorkflowRun,
  verifyArtifactMetadata,
} from './candidate-transfer.mjs'
import { allRunJobs, latestJob } from './merge-attempts.mjs'

const WORKFLOW = '.github/workflows/ci.yml'
const SOURCE_TARGETS = ['source-portable', 'source-protocol', 'source-applications', 'source-python']
const PYTHON = [
  ['ubuntu-24.04', '3.11'], ['ubuntu-24.04', '3.12'], ['ubuntu-24.04', '3.13'],
  ['ubuntu-24.04', '3.14'], ['macos-15', '3.14'], ['windows-2022', '3.13'],
]

// This is the closed merge-CI job inventory, not a test selector. Workflow tests
// reconcile every matrix row with it. Publication uses the original strict path.
export const MERGE_JOBS = Object.freeze([
  { name: 'Quick development checks', stem: 'quick', targets: ['quick-checks'], inputs: [], os: 'Linux' },
  { name: 'Build public sites', stem: 'sites', targets: ['sites'], inputs: [], os: 'Linux' },
  { name: 'Build Python reporting artifacts', stem: 'python-build', targets: ['python-build'], inputs: [], os: 'Linux' },
  { name: 'Source and package tests', stem: 'source', targets: SOURCE_TARGETS, inputs: ['canonical', 'python', 'python-reporting'], os: 'Linux' },
  ...PYTHON.map(([os, python]) => ({
    name: 'Python ' + python + ' on ' + os, stem: 'python-' + os + '-' + python,
    targets: ['python-installed'], inputs: ['python', 'python-reporting'],
    profile: os + '/python-' + python,
    os: os.startsWith('windows') ? 'Windows' : os.startsWith('macos') ? 'macOS' : 'Linux',
  })),
  ...['flow', 'agent', 'acp', 'jig'].map((profile) => ({
    name: 'Build ' + profile + ' release candidate', stem: 'npm-' + profile,
    targets: ['npm-candidate'], inputs: ['canonical'], profile, os: 'Linux',
  })),
])

const INPUTS = Object.freeze({
  canonical: { producer: 'candidate-build', prefix: 'candidates' },
  python: { producer: 'Build Python reporting artifacts', prefix: 'python-candidate' },
  'python-reporting': { producer: 'Build Python reporting artifacts', prefix: 'python-reporting-candidate' },
})
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Hash committed workflow bytes. Checkout conversions such as Windows
// CRLF must not produce a different workflow identity for the same tested source.
export function workflowSourceDigest(source, repository = process.cwd()) {
  requireRevision(source)
  return digest(execFileSync('git', ['-C', repository, 'cat-file', 'blob', source + ':' + WORKFLOW], {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  }))
}

export function mergeJobSpec(name) {
  const spec = MERGE_JOBS.find((item) => item.name === name)
  if (!spec) throw new Error('Unknown merge job: ' + name)
  return spec
}

// The image build is retained as an observation of the completed job. The
// accepted family/architecture comes from its fixed runs-on label, not a caller.
export function validateMergeRuntime(spec, runtime) {
  const profiles = {
    Linux: { architecture: 'X64', image: 'ubuntu24' },
    Windows: { architecture: 'X64', image: 'win22' },
    macOS: { architecture: 'ARM64', image: 'macos15' },
  }
  const expected = profiles[spec.os]
  if (!expected || runtime?.os !== spec.os ||
      runtime.architecture !== expected.architecture || runtime.image !== expected.image ||
      typeof runtime.imageVersion !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(runtime.imageVersion) ||
      !/^v24\.\d+\.\d+$/.test(runtime.node ?? ''))
    throw new Error('Merge runtime does not match its declared runner profile')
}

export async function mergeContext({ env = process.env, client = githubClient(), source = env.GITHUB_SHA } = {}) {
  requireRevision(source)
  if (env.GITHUB_EVENT_NAME !== 'pull_request') throw new Error('Merge retry evidence is PR-only')
  const context = await githubContext({ env, sourceRevision: source })
  if (context.workflowPath !== WORKFLOW) throw new Error('Merge retries require the CI workflow')
  const expected = await acquisitionExpectation(source, env)
  const run = await client.api('repos/' + context.repository + '/actions/runs/' + context.runId)
  validateWorkflowRun(run, expected)
  if (run.id !== context.runId || run.run_attempt !== context.runAttempt) throw new Error('Merge workflow attempt changed')
  const jobs = await allRunJobs(client, context.repository, run)
  const artifacts = await paginated(client, 'repos/' + context.repository + '/actions/runs/' + run.id + '/artifacts', 'artifacts')
  return { source, context, run, jobs, artifacts, expected }
}

export function inputArtifact(snapshot, kind) {
  const spec = INPUTS[kind]
  if (!spec) throw new Error('Unknown merge input')
  const job = latestJob(snapshot.jobs, snapshot.run, spec.producer)
  const name = spec.prefix + '-' + snapshot.source + '-r' + snapshot.run.id + '-a' + job.run_attempt
  const matches = snapshot.artifacts.filter((artifact) => artifact.name === name)
  if (matches.length !== 1) throw new Error('Missing or ambiguous immutable merge input: ' + kind)
  const artifact = verifyArtifactMetadata(matches[0], { name, runId: snapshot.run.id, headSha: snapshot.run.head_sha })
  return { kind, artifactId: artifact.id, artifactDigest: artifact.digest, name, producerJobId: job.id, producerAttempt: job.run_attempt }
}

async function unchanged(snapshot, client) {
  const current = await client.api('repos/' + snapshot.context.repository + '/actions/runs/' + snapshot.run.id)
  validateWorkflowRun(current, snapshot.expected)
  if (current.run_attempt !== snapshot.run.run_attempt) throw new Error('Merge workflow changed during verification')
  const jobs = await allRunJobs(client, snapshot.context.repository, current)
  for (const job of snapshot.jobs) {
    const latest = latestJob(snapshot.jobs, snapshot.run, job.name, { completed: false })
    if (job.id !== latest.id) continue
    const now = latestJob(jobs, current, job.name, { completed: false })
    if (now.id !== job.id || (job.conclusion === 'success' && now.conclusion !== 'success'))
      throw new Error('Merge job changed during verification')
  }
}

export async function acquireMergeInput({ kind, destination, inputsPath, env = process.env, client = githubClient(), extract }) {
  const snapshot = await mergeContext({ env, client })
  const binding = inputArtifact(snapshot, kind)
  const artifact = snapshot.artifacts.find((item) => item.id === binding.artifactId)
  await downloadArtifactDirectory(client, artifact, destination, { extract })
  if (kind === 'canonical') {
    const receipt = await verifyCandidateBundle(destination, {
      sourceRevision: snapshot.source, producerRunId: snapshot.run.id,
      producerRunAttempt: binding.producerAttempt, producerRepository: snapshot.context.repository,
    })
    for (const key of ['workflowPath', 'event', 'headBranch', 'headRepository', 'headSha'])
      if (receipt.producer[key] !== snapshot.context[key]) throw new Error('Merge candidate ' + key + ' mismatch')
    await writeFile(join(destination, 'ARTIFACT.json'), JSON.stringify({
      schemaVersion: 1, repository: snapshot.context.repository, sourceRevision: snapshot.source,
      runId: snapshot.run.id, runAttempt: binding.producerAttempt,
      artifactId: binding.artifactId, artifactDigest: binding.artifactDigest, receiptSha256: receipt.receiptSha256,
    }, null, 2) + '\n', { flag: 'wx' })
  }
  let inputs = []
  try { inputs = await readMetadata(inputsPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!Array.isArray(inputs) || inputs.some((input) => input.kind === kind)) throw new Error('Repeated or malformed merge input binding')
  await unchanged(snapshot, client)
  await writeFile(inputsPath, JSON.stringify([...inputs, binding], null, 2) + '\n')
  return binding
}

async function evidenceFiles(path) {
  const { lstat } = await import('node:fs/promises')
  const stat = await lstat(path)
  if (stat.isSymbolicLink()) throw new Error('Merge evidence cannot contain links')
  if (stat.isFile()) return [path]
  if (!stat.isDirectory()) throw new Error('Invalid merge evidence path')
  const files = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) throw new Error('Unexpected merge evidence entry')
    files.push(join(path, entry.name))
  }
  if (!files.length) throw new Error('Empty merge evidence')
  return files.sort()
}

export async function recordMergeEvidence({ name, path, inputsPath, env = process.env, client = githubClient() }) {
  const spec = mergeJobSpec(name)
  const snapshot = await mergeContext({ env, client })
  const job = latestJob(snapshot.jobs, snapshot.run, name, { completed: false })
  if (job.run_attempt !== snapshot.context.runAttempt || job.status !== 'in_progress') throw new Error('Receipt must be written by its current live job')
  const inputs = inputsPath ? await readMetadata(inputsPath) : []
  const expectedInputs = spec.inputs.map((kind) => inputArtifact(snapshot, kind))
  if (!same(inputs, expectedInputs)) throw new Error('Merge job consumed different immutable inputs')
  const workflowDigest = workflowSourceDigest(snapshot.source)
  const runtime = { os: env.RUNNER_OS, architecture: env.RUNNER_ARCH, image: env.ImageOS, imageVersion: env.ImageVersion, node: process.version }
  validateMergeRuntime(spec, runtime)
  for (const file of await evidenceFiles(path)) {
    const report = await readMetadata(file)
    if (report.schemaVersion !== 1 || report.source !== snapshot.source || !Array.isArray(report.results)) throw new Error('Invalid merge execution report')
    if (report.results.some((row) => !spec.targets.includes(row.id) || (spec.profile && !same(row.profiles, [spec.profile])))) throw new Error('Merge execution target/profile mismatch')
    await writeFile(file, JSON.stringify({ ...report, mergeRetry: {
      schemaVersion: 1, source: snapshot.source, repository: snapshot.context.repository,
      workflowDigest, runId: snapshot.run.id, jobId: job.id, name, attempt: job.run_attempt, runtime, inputs,
    } }, null, 2) + '\n')
  }
}

export function verifyMergeReport(report, { snapshot, spec, job, workflowDigest }) {
  const receipt = report.mergeRetry
  const identity = {
    schemaVersion: report.schemaVersion === 1,
    source: report.source === snapshot.source,
    results: Array.isArray(report.results),
    receiptSchemaVersion: receipt?.schemaVersion === 1,
    receiptSource: receipt?.source === snapshot.source,
    repository: receipt?.repository === snapshot.context.repository,
    workflowDigest: receipt?.workflowDigest === workflowDigest,
    runId: receipt?.runId === snapshot.run.id,
    jobId: receipt?.jobId === job.id,
    name: receipt?.name === spec.name,
    attempt: receipt?.attempt === job.run_attempt,
  }
  const mismatches = Object.keys(identity).filter((field) => !identity[field])
  if (mismatches.length)
    throw new Error('Merge report identity mismatch for ' + spec.name + ': ' + mismatches.join(', '))
  validateMergeRuntime(spec, receipt.runtime)
  const inputs = spec.inputs.map((kind) => inputArtifact(snapshot, kind))
  if (!same(receipt.inputs, inputs)) throw new Error('Merge report used a replaced or different input artifact')
  if (!report.results.length || report.results.some((row) => !spec.targets.includes(row.id) ||
      row.status !== 'success' || (spec.profile && !same(row.profiles, [spec.profile]))))
    throw new Error('Merge report target/profile mismatch')
}

export async function acquireMergeEvidence({ directory, output, env = process.env, client = githubClient(), extract }) {
  const snapshot = await mergeContext({ env, client })
  // Even jobs without a test report must have completed successfully.
  latestJob(snapshot.jobs, snapshot.run, 'candidate-build')
  inputArtifact(snapshot, 'canonical')
  inputArtifact(snapshot, 'python')
  inputArtifact(snapshot, 'python-reporting')
  const workflowDigest = workflowSourceDigest(snapshot.source)
  await mkdir(directory)
  const retained = []
  for (const spec of MERGE_JOBS) {
    const job = latestJob(snapshot.jobs, snapshot.run, spec.name)
    const name = 'ci-evidence-' + spec.stem + '-' + snapshot.source + '-a' + job.run_attempt
    const matches = snapshot.artifacts.filter((artifact) => artifact.name === name)
    if (matches.length !== 1) throw new Error('Missing or ambiguous merge evidence: ' + spec.name)
    const artifact = verifyArtifactMetadata(matches[0], { name, runId: snapshot.run.id, headSha: snapshot.run.head_sha })
    const target = join(directory, spec.stem)
    await downloadArtifactDirectory(client, artifact, target, { extract })
    const targets = []
    for (const file of await evidenceFiles(target)) {
      const report = await readMetadata(file)
      verifyMergeReport(report, { snapshot, spec, job, workflowDigest })
      targets.push(...report.results.map((row) => row.id))
    }
    if (!same(targets.sort(), [...spec.targets].sort())) throw new Error('Incomplete or repeated merge job target inventory')
    retained.push({ name: spec.name, jobId: job.id, attempt: job.run_attempt, artifactId: artifact.id, artifactDigest: artifact.digest })
  }
  await unchanged(snapshot, client)
  const jobResults = { 'candidate-build': { result: 'success' } }
  for (const spec of MERGE_JOBS) {
    const id = spec.stem === 'source' ? 'source-tests' : spec.targets[0]
    jobResults[id] = { result: 'success' }
  }
  const receipt = { schemaVersion: 1, mergeOnly: true, source: snapshot.source, runId: snapshot.run.id,
    attempt: snapshot.run.run_attempt, workflowDigest, jobs: retained, jobResults }
  await writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  if (env.GITHUB_STEP_SUMMARY) {
    const earlier = retained.filter((job) => job.attempt < receipt.attempt).length
    const repository = snapshot.context.repository
    const summary = [
      '## Verified PR CI executions', '',
      `Tested merge source: \`${receipt.source}\`. Current workflow attempt: **${receipt.attempt}**.`, '',
      `Accepted ${retained.length} successful job executions: **${retained.length - earlier} current-attempt** and **${earlier} retained from earlier attempts**.`, '',
      '| Job | Execution attempt | Job ID | Evidence artifact ID |',
      '| --- | ---: | --- | --- |',
      ...retained.map((job) => `| ${job.name} | ${job.attempt} | [${job.jobId}](https://github.com/${repository}/actions/runs/${receipt.runId}/job/${job.jobId}) | [${job.artifactId}](https://github.com/${repository}/actions/runs/${receipt.runId}/artifacts/${job.artifactId}) |`),
      '',
      'All selected reports passed source, workflow, runtime, target inventory and immutable-input verification.',
      'The required aggregate separately validates the complete observed physical suite inventories.',
      'This merge-only receipt supplies PR CI evidence. Host and publication qualification require fresh execution.', '',
    ].join('\n')
    try {
      await appendFile(env.GITHUB_STEP_SUMMARY, summary)
    } catch {
      console.error('PR CI execution summary unavailable; the verified merge receipt remains retained.')
    }
  }
  return receipt
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { positional, options } = parseOptions(process.argv.slice(2))
    if (positional[0] === 'input' && positional.length === 2 && options.destination && options.inputs)
      await acquireMergeInput({ kind: positional[1], destination: resolve(options.destination), inputsPath: resolve(options.inputs) })
    else if (positional[0] === 'record' && positional.length === 1 && options.job && options.evidence)
      await recordMergeEvidence({ name: options.job, path: resolve(options.evidence), inputsPath: options.inputs && resolve(options.inputs) })
    else if (positional[0] === 'collect' && positional.length === 1 && options.directory && options.output)
      await acquireMergeEvidence({ directory: resolve(options.directory), output: resolve(options.output) })
    else throw new Error('Use input KIND --destination DIR --inputs FILE, record --job NAME --evidence PATH [--inputs FILE], or collect --directory DIR --output FILE')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
