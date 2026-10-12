import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  digest,
  parseOptions,
  readMetadata,
  requireRevision,
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

const WORKFLOWS = Object.freeze({
  ci: '.github/workflows/ci.yml',
  linux: '.github/workflows/linux-host-conformance.yml',
  macos: '.github/workflows/macos-hosted-candidates.yml',
  native: '.github/workflows/native-agent-api-qualification.yml',
})

export const CI_QUALIFICATION_JOBS = Object.freeze([
  'Plan affected work',
  'Quick development checks',
  'Build public sites',
  'Source and package tests',
  'Build Python SDK artifacts',
  'test',
  'Python 3.11 on ubuntu-24.04',
  'Python 3.12 on ubuntu-24.04',
  'Python 3.13 on ubuntu-24.04',
  'Python 3.14 on ubuntu-24.04',
  'Python 3.14 on macos-14',
  'Python 3.13 on windows-2022',
  ...['flow', 'agent', 'acp', 'jig'].map((kind) => `Build ${kind} release candidate`),
])
export const LINUX_QUALIFICATION_JOBS = Object.freeze([
  'rootless-linux',
  ...['agent-lifecycle', 'delegated-authority', 'package-lifecycle', 'installed-evidence'].map(
    (suite) => `Linux host — ${suite}`,
  ),
])
export const MACOS_QUALIFICATION_JOBS = Object.freeze([
  'Native host qualification — x64',
  'Native host qualification — arm64',
  ...[0, 1, 2].map((shard) => `Native host shard — x64 / ${shard}`),
  ...[0, 1].map((shard) => `Native host shard — arm64 / ${shard}`),
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

async function latestMainRun(client, repository, kind, source) {
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
    .sort((a, b) => b.id - a.id)[0]
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
  return {
    sourceRevision: source,
    receiptSha256: receipt.receiptSha256,
    producerRunId: run.id,
    producerRunAttempt: run.run_attempt,
    artifactId: artifact.id,
    artifactDigest: artifact.digest,
  }
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
    result.reasons.push('No trusted tested source was identified')
    return result
  }
  const ci = await latestMainRun(client, repository, 'ci', source)
  if (!succeeded(ci)) {
    result.reasons.push('Complete current-attempt CI qualification is pending or failed')
    return result
  }
  let candidate
  try {
    result.obligations.push(
      ...(await requireJobs(client, repository, ci, [...CI_QUALIFICATION_JOBS, ciJobName])),
    )
    candidate = await loadCanonical(client, repository, ci, source)
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
    if (!succeeded(linux)) throw new Error('Complete Linux qualification is pending or failed')
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
    const mac = await latestMainRun(client, repository, 'macos', source)
    if (!succeeded(mac)) throw new Error('Complete Mac qualification is pending or failed')
    result.obligations.push(
      ...(await requireJobs(client, repository, mac, MACOS_QUALIFICATION_JOBS)),
    )
    for (const profile of ['x64', 'arm64']) {
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
    const nativeRuns = await paginated(
      client,
      `repos/${repository}/actions/workflows/native-agent-api-qualification.yml/runs`,
      'workflow_runs',
    )
    // Native head_sha is the default-branch workflow revision, not the tested
    // source. Receipts and Linux lineage are the only source association.
    let nativeMatch
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
      const suffix = new RegExp(`-${source}-r${run.id}-a[1-9][0-9]*$`)
      if (
        !(run.event === 'workflow_dispatch' && run.head_sha === source) &&
        !artifacts.some(
          (artifact) =>
            /^native-(qualification|inputs)-/.test(artifact.name ?? '') &&
            suffix.test(artifact.name),
        )
      )
        continue
      if (!succeeded(run))
        throw new Error('Current matching native qualification is pending or failed')
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
      nativeMatch = run
      break
    }
    if (!nativeMatch) throw new Error('No complete current-candidate native qualification exists')
    // Recheck producer and every retained qualification attempt immediately
    // before granting readiness, closing rerun races during the API snapshot.
    for (const run of [ci, linux, mac, nativeMatch]) {
      const current = await client.api(`repos/${repository}/actions/runs/${run.id}`)
      if (current.run_attempt !== run.run_attempt || !succeeded(current))
        throw new Error('Qualification changed during readiness evaluation')
    }
    result.readyHost = true
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
    result.readyFlow = false
    result.readyHost = false
    result.flowSnapshot = null
    result.hostSnapshot = null
    result.reasons.push(error.message)
  }
  return result
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
    if (options['github-output'])
      await appendFile(
        options['github-output'],
        `source_revision=${result.sourceRevision}\nproducer_run_id=${result.producerRunId}\nproducer_run_attempt=${result.producerRunAttempt}\ncandidate_artifact_id=${result.artifactId}\ncandidate_artifact_digest=${result.artifactDigest}\ncandidate_receipt_sha256=${result.receiptSha256}\nready_flow=${result.readyFlow}\nready_host=${result.readyHost}\nflow_snapshot=${result.flowSnapshot ? JSON.stringify(result.flowSnapshot) : ''}\nhost_snapshot=${result.hostSnapshot ? JSON.stringify(result.hostSnapshot) : ''}\n`,
      )
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
