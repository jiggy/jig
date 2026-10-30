import { readFileSync } from 'node:fs'
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  digest,
  parseOptions,
  readMetadata,
  requireRevision,
  validateCandidateRelease,
  validateProducer,
  verifyCandidateBundle,
} from './candidate-provenance.mjs'
import {
  downloadArtifactDirectory,
  githubClient,
  paginated,
  validateWorkflowRun,
  verifyArtifactMetadata,
} from './candidate-transfer.mjs'
import { MAC_HOST_SHARDS } from './macos-host-test-shards.mjs'

const WORKFLOWS = Object.freeze({
  ci: '.github/workflows/ci.yml',
  linux: '.github/workflows/linux-host-conformance.yml',
  macos: '.github/workflows/macos-hosted-candidates.yml',
  native: '.github/workflows/native-agent-api-qualification.yml',
})

const catalog = JSON.parse(readFileSync(new URL('./test-suites.json', import.meta.url), 'utf8'))
export const PYTHON_INSTALLED_JOBS = Object.freeze(
  catalog.targets
    .find((target) => target.id === 'python-installed')
    .profiles.map((profile) => {
      const [os, python] = profile.split('/python-')
      return `Python ${python} on ${os}`
    }),
)

export const CI_QUALIFICATION_JOBS = Object.freeze([
  'Quick development checks',
  'Build public sites',
  'Source and package tests',
  'Build Python reporting artifacts',
  'test',
  ...PYTHON_INSTALLED_JOBS,
  ...['flow', 'agent', 'acp', 'jig'].map((kind) => `Build ${kind} release candidate`),
])
export const LINUX_QUALIFICATION_JOBS = Object.freeze([
  'rootless-linux',
  ...['agent-lifecycle', 'delegated-authority', 'package-lifecycle', 'installed-evidence'].map(
    (suite) => `Linux host — ${suite}`,
  ),
])
export const MACOS_QUALIFICATION_JOBS = Object.freeze([
  'Native host qualification — arm64',
  ...Array.from(
    { length: MAC_HOST_SHARDS.arm64 },
    (_, shard) => `Native host shard — arm64 / ${shard}`,
  ),
])

function mainExpectation(repository, workflowPath, source) {
  return {
    repository,
    workflowPath,
    event: 'push',
    headBranch: 'main',
    headRepository: repository,
    headSha: source,
  }
}
const succeeded = (run) => run?.status === 'completed' && run?.conclusion === 'success'
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export async function requireJobs(client, repository, run, names) {
  const jobs = await paginated(
    client,
    `repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,
    'jobs',
  )
  for (const name of names) {
    const matching = jobs.filter((job) => job.name === name)
    if (
      matching.length !== 1 ||
      matching[0].status !== 'completed' ||
      matching[0].conclusion !== 'success'
    )
      throw new Error(`Missing successful current-attempt job: ${name}`)
    if (matching[0].run_attempt !== undefined && matching[0].run_attempt !== run.run_attempt)
      throw new Error('Stale qualification job attempt')
  }
  return jobs
    .filter((job) => names.includes(job.name))
    .map((job) => ({ jobId: job.id, name: job.name, runId: run.id, runAttempt: run.run_attempt }))
}

function qualificationSnapshot(repository, group, candidate, runs, artifacts, obligations) {
  return {
    schemaVersion: 1,
    repository,
    group,
    sourceRevision: candidate.sourceRevision,
    candidate,
    runs: runs.map((run) => ({
      runId: run.id,
      runAttempt: run.run_attempt,
      workflowPath: run.path,
      event: run.event,
      headSha: run.head_sha,
      headBranch: run.head_branch,
      headRepository: run.head_repository.full_name,
      jobs: obligations.filter((job) => job.runId === run.id),
    })),
    artifacts: artifacts.map((artifact) => ({
      artifactId: artifact.id,
      name: artifact.name,
      digest: artifact.digest,
      runId: artifact.workflow_run.id,
      headSha: artifact.workflow_run.head_sha,
    })),
  }
}

async function artifactFor(client, repository, run, name) {
  const artifacts = await paginated(
    client,
    `repos/${repository}/actions/runs/${run.id}/artifacts`,
    'artifacts',
  )
  const matching = artifacts.filter((artifact) => artifact.name === name)
  if (matching.length !== 1) throw new Error(`Missing or ambiguous evidence artifact: ${name}`)
  return verifyArtifactMetadata(matching[0], { name, runId: run.id, headSha: run.head_sha })
}

async function qualificationFromArtifact(client, artifact) {
  if (client.readQualification) {
    const value = await client.readQualification(artifact)
    return value.receipt
      ? value
      : { receipt: value, receiptSha256: digest(`${JSON.stringify(value, null, 2)}\n`) }
  }
  const temporary = await mkdtemp(join(tmpdir(), 'jig-release-evidence-'))
  try {
    const directory = join(temporary, 'evidence')
    await downloadArtifactDirectory(client, artifact, directory)
    const path = join(
      directory,
      artifact.name.startsWith('native-inputs-') ? 'INPUTS.json' : 'QUALIFICATION.json',
    )
    return { receipt: await readMetadata(path), receiptSha256: digest(await readFile(path)) }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export function verifyQualification(
  receipt,
  { kind, profile, candidate, run, repository, stage = 'qualification' },
) {
  if (
    receipt?.schemaVersion !== 1 ||
    receipt.stage !== stage ||
    receipt.kind !== kind ||
    receipt.profile !== profile ||
    !same(receipt.candidate, candidate)
  )
    throw new Error('Qualification candidate or profile mismatch')
  const consumer = validateProducer(receipt.consumer)
  if (
    consumer.runId !== run.id ||
    consumer.runAttempt !== run.run_attempt ||
    consumer.repository !== repository ||
    consumer.workflowPath !== WORKFLOWS[kind] ||
    consumer.event !== run.event ||
    consumer.headSha !== run.head_sha ||
    consumer.headBranch !== run.head_branch ||
    consumer.headRepository !== run.head_repository?.full_name
  )
    throw new Error('Qualification consumer run or attempt mismatch')
  if (kind !== 'native')
    validateWorkflowRun(run, mainExpectation(repository, WORKFLOWS[kind], candidate.sourceRevision))
  else if (
    run.repository?.full_name !== repository ||
    run.path !== WORKFLOWS.native ||
    run.head_branch !== 'main' ||
    run.head_repository?.full_name !== repository ||
    !['workflow_run', 'workflow_dispatch'].includes(run.event)
  )
    throw new Error('Native qualification trust mismatch')
  return receipt
}

async function mainRuns(client, repository, kind, source) {
  const query = new URLSearchParams({ branch: 'main', event: 'push', head_sha: source })
  const runs = await paginated(
    client,
    `repos/${repository}/actions/workflows/${WORKFLOWS[kind].split('/').at(-1)}/runs?${query}`,
    'workflow_runs',
  )
  return runs
    .filter((run) => {
      try {
        validateWorkflowRun(run, mainExpectation(repository, WORKFLOWS[kind], source))
        return true
      } catch {
        return false
      }
    })
    .sort((a, b) => b.id - a.id)
}

async function latestMainRun(client, repository, kind, source) {
  return (await mainRuns(client, repository, kind, source))[0]
}

function creationTime(value) {
  const time = Date.parse(value)
  if (
    typeof value !== 'string' ||
    !Number.isFinite(time) ||
    time > Date.now() ||
    new Date(time).toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')
  )
    throw new Error('Missing valid CI creation time for native qualification discovery')
  return time
}

async function loadCanonical(client, repository, run, source) {
  const name = `candidates-${source}-r${run.id}-a${run.run_attempt}`
  const artifact = await artifactFor(client, repository, run, name)
  let receipt
  if (client.readCandidate) receipt = await client.readCandidate(artifact)
  else {
    const temporary = await mkdtemp(join(tmpdir(), 'jig-release-candidate-'))
    try {
      const directory = join(temporary, 'candidate')
      await downloadArtifactDirectory(client, artifact, directory)
      receipt = await verifyCandidateBundle(directory, {
        sourceRevision: source,
        producerRepository: repository,
        producerRunId: run.id,
        producerRunAttempt: run.run_attempt,
      })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
  validateProducer(receipt.producer)
  if (
    receipt.sourceRevision !== source ||
    receipt.producer.runId !== run.id ||
    receipt.producer.runAttempt !== run.run_attempt
  )
    throw new Error('Canonical producer source or attempt mismatch')
  for (const [key, wanted] of Object.entries(mainExpectation(repository, WORKFLOWS.ci, source)))
    if (receipt.producer[key] !== wanted) throw new Error('Canonical producer trust mismatch')
  if (!/^[0-9a-f]{64}$/.test(receipt.receiptSha256 ?? ''))
    throw new Error('Missing canonical receipt digest')
  if (receipt.schemaVersion !== 2) throw new Error('Unsupported canonical candidate receipt')
  const release = validateCandidateRelease(receipt.release, source, receipt.packages)
  return {
    release,
    candidate: {
      sourceRevision: source,
      receiptSha256: receipt.receiptSha256,
      producerRunId: run.id,
      producerRunAttempt: run.run_attempt,
      artifactId: artifact.id,
      artifactDigest: artifact.digest,
    },
  }
}

async function latestNativeRun(client, repository, source, ciRuns) {
  // Rerunning an older Linux/native pair may consume a newer same-source CI
  // producer. Preserve descendants since the first verified push of that source.
  const earliestCi = ciRuns.reduce((earliest, run) =>
    creationTime(run.created_at) < creationTime(earliest.created_at) ? run : earliest,
  )
  creationTime(earliestCi.created_at)
  // A queued manual run can predate even the first CI run; its head identifies
  // the tested source directly, unlike a workflow_run descendant's head.
  const nativeQueries = [
    new URLSearchParams({
      branch: 'main',
      event: 'workflow_run',
      created: `>=${earliestCi.created_at}`,
    }),
    new URLSearchParams({ branch: 'main', event: 'workflow_dispatch', head_sha: source }),
  ]
  const nativeResponses = await Promise.all(
    nativeQueries.map((query) =>
      paginated(
        client,
        `repos/${repository}/actions/workflows/native-agent-api-qualification.yml/runs?${query}`,
        'workflow_runs',
      ),
    ),
  )
  const nativeRuns = [...new Map(nativeResponses.flat().map((run) => [run.id, run])).values()]
  // Native head_sha is the default-branch workflow revision, not the tested
  // source. Receipts and Linux lineage are the only source association.
  for (const run of nativeRuns.sort((a, b) => b.id - a.id)) {
    if (
      run.repository?.full_name !== repository ||
      run.path !== WORKFLOWS.native ||
      run.head_branch !== 'main' ||
      run.head_repository?.full_name !== repository ||
      !['workflow_run', 'workflow_dispatch'].includes(run.event)
    )
      continue
    const artifacts = await paginated(
      client,
      `repos/${repository}/actions/runs/${run.id}/artifacts`,
      'artifacts',
    )
    const suffix = /-([0-9a-f]{40})-r([1-9][0-9]*)-a[1-9][0-9]*$/
    if (
      !(run.event === 'workflow_dispatch' && run.head_sha === source) &&
      !artifacts.some((artifact) => {
        const name = artifact.name ?? ''
        const identity = suffix.exec(name)
        return (
          /^native-(qualification|inputs)-/.test(name) &&
          identity?.[1] === source &&
          identity[2] === String(run.id)
        )
      })
    )
      continue
    return run
  }
  return undefined
}

export async function resolveTriggerSource({ client, repository, triggerRunId, sourceRevision }) {
  if (sourceRevision) return requireRevision(sourceRevision)
  if (!Number.isSafeInteger(triggerRunId) || triggerRunId <= 0)
    throw new Error('A source revision or trigger run is required')
  const run = await client.api(`repos/${repository}/actions/runs/${triggerRunId}`)
  if (
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository ||
    run.head_branch !== 'main'
  )
    return undefined
  if ([WORKFLOWS.ci, WORKFLOWS.linux, WORKFLOWS.macos].includes(run.path))
    return run.event === 'push' ? requireRevision(run.head_sha) : undefined
  if (run.path !== WORKFLOWS.native || !['workflow_run', 'workflow_dispatch'].includes(run.event))
    return undefined
  // Manual qualification checks out github.sha itself. Its API head is the
  // tested source even before protected-environment approval; descendant
  // workflow_run heads still require canonical input receipts.
  if (run.event === 'workflow_dispatch') return requireRevision(run.head_sha)
  const artifacts = await paginated(
    client,
    `repos/${repository}/actions/runs/${run.id}/artifacts`,
    'artifacts',
  )
  const sources = new Set()
  for (const artifact of artifacts) {
    if (
      !new RegExp(
        `^native-(qualification|inputs)-(codex|claude|pi)-[0-9a-f]{40}-r${run.id}-a${run.run_attempt}$`,
      ).test(artifact.name ?? '')
    )
      continue
    verifyArtifactMetadata(artifact, { name: artifact.name, runId: run.id, headSha: run.head_sha })
    const { receipt } = await qualificationFromArtifact(client, artifact)
    const source = requireRevision(receipt.candidate?.sourceRevision)
    // The receipt names the tested revision; its consumer still must match the
    // descendant workflow's API identity. Complete lineage is checked below.
    const stage = artifact.name.startsWith('native-inputs-') ? 'inputs' : 'qualification'
    verifyQualification(receipt, {
      kind: 'native',
      profile: receipt.profile,
      candidate: receipt.candidate,
      run,
      repository,
      stage,
    })
    if (
      artifact.name !==
      `native-${stage}-${receipt.profile}-${source}-r${run.id}-a${run.run_attempt}`
    )
      throw new Error('Native artifact source mismatch')
    sources.add(source)
  }
  if (sources.size > 1) throw new Error('Native run contains mixed candidate sources')
  return [...sources][0]
}

const CHECK_NAMES = {
  ci: 'CI',
  linux: 'Linux host conformance',
  macos: 'macOS hosted candidates',
  native: 'Native Agent API qualification',
}

function qualificationCheck(kind, run) {
  return {
    kind,
    name: CHECK_NAMES[kind],
    runId: run?.id ?? null,
    runAttempt: run?.run_attempt ?? null,
    status: run?.status ?? 'missing',
    conclusion: run?.conclusion ?? null,
  }
}

function failedCheck(checks) {
  return checks.some((check) => check.status === 'completed' && check.conclusion !== 'success')
}

export async function releaseReadiness({
  client,
  repository,
  triggerRunId,
  sourceRevision,
  ciJobName = 'candidate-build',
}) {
  const source = await resolveTriggerSource({ client, repository, triggerRunId, sourceRevision })
  const result = {
    sourceRevision: source ?? '',
    state: 'waiting',
    checks: [],
    packages: [],
    producerRunId: '',
    producerRunAttempt: '',
    artifactId: '',
    artifactDigest: '',
    receiptSha256: '',
    readyFlow: false,
    readyHost: false,
    flowSnapshot: null,
    hostSnapshot: null,
    reasons: [],
    obligations: [],
  }
  if (!source) {
    result.state = 'ignored'
    result.reasons.push('No trusted tested source was identified')
    return result
  }
  const ciRuns = await mainRuns(client, repository, 'ci', source)
  const ci = ciRuns[0]
  result.checks.push(qualificationCheck('ci', ci))
  if (!succeeded(ci)) {
    result.state = failedCheck(result.checks) ? 'blocked' : 'waiting'
    result.reasons.push('Complete current-attempt CI qualification is pending or failed')
    return result
  }
  let candidate
  result.state = 'blocked'
  try {
    result.obligations.push(
      ...(await requireJobs(client, repository, ci, [...CI_QUALIFICATION_JOBS, ciJobName])),
    )
    const canonical = await loadCanonical(client, repository, ci, source)
    result.packages = canonical.release.packages.map(({ name, version }) => ({ name, version }))
    if (!canonical.release.eligible) {
      result.state = canonical.release.reason === 'stale-release-plan' ? 'blocked' : 'not-release'
      result.reasons.push(
        `Canonical source is not a versioned release: ${canonical.release.reason}`,
      )
      return result
    }
    candidate = canonical.candidate
    result.producerRunId = ci.id
    result.producerRunAttempt = ci.run_attempt
    result.artifactId = candidate.artifactId
    result.artifactDigest = candidate.artifactDigest
    result.receiptSha256 = candidate.receiptSha256
    const current = await client.api(`repos/${repository}/actions/runs/${ci.id}`)
    validateWorkflowRun(current, mainExpectation(repository, WORKFLOWS.ci, source))
    if (current.run_attempt !== ci.run_attempt || !succeeded(current))
      throw new Error('CI attempt changed during readiness evaluation')
    result.readyFlow = true
    result.flowSnapshot = qualificationSnapshot(
      repository,
      'flow',
      candidate,
      [ci],
      [
        {
          id: candidate.artifactId,
          name: `candidates-${source}-r${ci.id}-a${ci.run_attempt}`,
          digest: candidate.artifactDigest,
          workflow_run: { id: ci.id, head_sha: ci.head_sha },
        },
      ],
      result.obligations,
    )
  } catch (error) {
    result.reasons.push(error.message)
    return result
  }
  let linuxReceipt
  try {
    const linux = await latestMainRun(client, repository, 'linux', source)
    const mac = await latestMainRun(client, repository, 'macos', source)
    const nativeMatch = await latestNativeRun(client, repository, source, ciRuns)
    result.checks.push(
      qualificationCheck('linux', linux),
      qualificationCheck('macos', mac),
      qualificationCheck('native', nativeMatch),
    )
    const pending = [
      [linux, 'Complete Linux qualification is pending or failed'],
      [mac, 'Complete Mac qualification is pending or failed'],
      [nativeMatch, 'Current matching native qualification is pending or failed'],
    ].filter(([run]) => !succeeded(run))
    if (pending.length) {
      result.state = failedCheck(result.checks) ? 'blocked' : 'waiting'
      result.reasons.push(...pending.slice(1).map(([, reason]) => reason))
      throw new Error(pending[0][1])
    }
    result.obligations.push(
      ...(await requireJobs(client, repository, linux, LINUX_QUALIFICATION_JOBS)),
    )
    const linuxArtifact = await artifactFor(
      client,
      repository,
      linux,
      `linux-qualification-${source}-r${linux.id}-a${linux.run_attempt}`,
    )
    const hostArtifacts = [
      ...result.flowSnapshot.artifacts.map((artifact) => ({
        id: artifact.artifactId,
        name: artifact.name,
        digest: artifact.digest,
        workflow_run: { id: artifact.runId, head_sha: artifact.headSha },
      })),
      linuxArtifact,
    ]
    linuxReceipt = await qualificationFromArtifact(client, linuxArtifact)
    verifyQualification(linuxReceipt.receipt, {
      kind: 'linux',
      profile: '',
      candidate,
      run: linux,
      repository,
    })
    result.obligations.push(
      ...(await requireJobs(client, repository, mac, MACOS_QUALIFICATION_JOBS)),
    )
    for (const profile of ['arm64']) {
      const artifact = await artifactFor(
        client,
        repository,
        mac,
        `macos-qualification-${profile}-${source}-r${mac.id}-a${mac.run_attempt}`,
      )
      hostArtifacts.push(artifact)
      const { receipt } = await qualificationFromArtifact(client, artifact)
      verifyQualification(receipt, { kind: 'macos', profile, candidate, run: mac, repository })
    }
    const run = nativeMatch
    result.obligations.push(
      ...(await requireJobs(
        client,
        repository,
        run,
        ['codex', 'claude', 'pi'].map((profile) => `${profile} — Ubuntu 24.04`),
      )),
    )
    for (const profile of ['codex', 'claude', 'pi']) {
      const artifact = await artifactFor(
        client,
        repository,
        run,
        `native-qualification-${profile}-${source}-r${run.id}-a${run.run_attempt}`,
      )
      hostArtifacts.push(artifact)
      const { receipt } = await qualificationFromArtifact(client, artifact)
      verifyQualification(receipt, { kind: 'native', profile, candidate, run, repository })
      if (
        receipt.upstream?.receiptSha256 !== linuxReceipt.receiptSha256 ||
        !same(receipt.upstream?.receipt, linuxReceipt.receipt)
      )
        throw new Error('Native qualification Linux lineage mismatch')
    }
    // Recheck producer and every retained qualification attempt immediately
    // before granting readiness, closing rerun races during the API snapshot.
    for (const run of [ci, linux, mac, nativeMatch]) {
      const current = await client.api(`repos/${repository}/actions/runs/${run.id}`)
      if (current.run_attempt !== run.run_attempt || !succeeded(current))
        throw new Error('Qualification changed during readiness evaluation')
    }
    result.readyHost = true
    result.state = 'ready'
    result.hostSnapshot = qualificationSnapshot(
      repository,
      'host',
      candidate,
      [ci, linux, mac, nativeMatch],
      hostArtifacts,
      result.obligations,
    )
  } catch (error) {
    result.reasons.push(error.message)
  }
  const currentCi = await client.api(`repos/${repository}/actions/runs/${ci.id}`)
  try {
    validateWorkflowRun(currentCi, mainExpectation(repository, WORKFLOWS.ci, source))
    if (currentCi.run_attempt !== ci.run_attempt || !succeeded(currentCi))
      throw new Error('CI changed before readiness completed')
  } catch (error) {
    result.state = 'blocked'
    result.readyFlow = false
    result.readyHost = false
    result.flowSnapshot = null
    result.hostSnapshot = null
    result.reasons.push(error.message)
  }
  return result
}

function summaryText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replaceAll('`', '&#96;')
    .replaceAll('[', '&#91;')
    .replaceAll(']', '&#93;')
    .replaceAll(/\r?\n/g, ' ')
}

export function releaseSummary(result, repository) {
  const titles = {
    ready: 'Ready for publication',
    waiting: 'Waiting for qualification',
    blocked: 'Blocked',
    'not-release': 'No versioned release',
    ignored: 'No release source',
  }
  const root = `https://github.com/${repository}`
  const lines = [`## npm release: ${titles[result.state] ?? 'Blocked'}`, '']
  if (result.sourceRevision)
    lines.push(`Source: [${result.sourceRevision}](${root}/commit/${result.sourceRevision})`, '')
  if (result.packages.length) {
    lines.push('| Package | Candidate version |', '| --- | --- |')
    for (const entry of result.packages)
      lines.push(`| ${summaryText(entry.name)} | ${summaryText(entry.version)} |`)
    lines.push('')
  }
  lines.push('| Required qualification | Current attempt |', '| --- | --- |')
  for (const [kind, name] of Object.entries(CHECK_NAMES)) {
    const check = result.checks.find((entry) => entry.kind === kind)
    let state = check ? summaryText(check.conclusion ?? check.status) : 'not inspected'
    if (check?.runId)
      state = `[${state}](${root}/actions/runs/${check.runId}/attempts/${check.runAttempt})`
    lines.push(`| ${name} | ${state} |`)
  }
  lines.push('')
  for (const reason of result.reasons) lines.push(`- ${summaryText(reason)}`)
  lines.push('')
  if (result.readyHost) {
    lines.push(
      'Qualification permits publication. The publication jobs must still verify registry convergence.',
      '',
    )
  } else if (result.state === 'not-release') {
    lines.push('Merge the generated release PR before publication can qualify.', '')
  } else {
    lines.push(
      '**No packages were published by this readiness check.**',
      '',
      'Wait for queued or running checks. Fix failed qualification, then choose **Re-run all jobs** in that workflow.',
      'Completion events check readiness again. Partial qualification reruns cannot reuse earlier proof.',
      '',
    )
  }
  lines.push(`[Release and recovery instructions](${root}/blob/main/RELEASING.md)`, '')
  return lines.join('\n')
}

export async function reportReleaseReadiness(result, { repository, output, summary, eventName }) {
  if (output)
    await appendFile(
      output,
      `source_revision=${result.sourceRevision}\nproducer_run_id=${result.producerRunId}\nproducer_run_attempt=${result.producerRunAttempt}\ncandidate_artifact_id=${result.artifactId}\ncandidate_artifact_digest=${result.artifactDigest}\ncandidate_receipt_sha256=${result.receiptSha256}\nready_flow=${result.readyFlow}\nready_host=${result.readyHost}\nflow_snapshot=${result.flowSnapshot ? JSON.stringify(result.flowSnapshot) : ''}\nhost_snapshot=${result.hostSnapshot ? JSON.stringify(result.hostSnapshot) : ''}\n`,
    )
  if (summary) await appendFile(summary, releaseSummary(result, repository))
  return result.state === 'blocked' || (eventName === 'workflow_dispatch' && !result.readyHost)
    ? 1
    : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { positional, options } = parseOptions(process.argv.slice(2))
    if (positional.length)
      throw new Error('Use --source SHA or workflow event context, optionally --github-output PATH')
    const repository = process.env.GITHUB_REPOSITORY
    const event = process.env.GITHUB_EVENT_PATH
      ? await readMetadata(process.env.GITHUB_EVENT_PATH)
      : {}
    if (
      options.source &&
      process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      process.env.GITHUB_REF !== 'refs/heads/main'
    )
      throw new Error('Manual release reconciliation is restricted to main')
    const result = await releaseReadiness({
      client: githubClient(repository),
      repository,
      sourceRevision: options.source,
      triggerRunId: event.workflow_run?.id,
      ciJobName: options['ci-job-name'] ?? 'candidate-build',
    })
    process.exitCode = await reportReleaseReadiness(result, {
      repository,
      output: options['github-output'],
      summary: process.env.GITHUB_STEP_SUMMARY,
      eventName: process.env.GITHUB_EVENT_NAME,
    })
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error.message)
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        "## npm release: Blocked\n\nReadiness could not be verified. Inspect this job's error before retrying.\n",
      )
    process.exitCode = 1
  }
}
