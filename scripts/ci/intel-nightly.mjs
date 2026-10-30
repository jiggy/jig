import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  candidateBinding,
  requireRevision,
  verifyCandidateBundle,
} from './candidate-provenance.mjs'
import {
  acquireCandidate,
  downloadArtifactDirectory,
  githubClient,
  paginated,
  verifyArtifactMetadata,
} from './candidate-transfer.mjs'

export const INTEL_WORKFLOW = '.github/workflows/macos-intel-nightly.yml'

function scheduledRuns(client, repository) {
  // Retained health expires after 90 days; include one boundary day.
  const since = new Date(Date.now() - 91 * 24 * 60 * 60_000).toISOString()
  const query = new URLSearchParams({ branch: 'main', event: 'schedule', created: `>=${since}` })
  return paginated(
    client,
    `repos/${repository}/actions/workflows/macos-intel-nightly.yml/runs?${query}`,
    'workflow_runs',
  )
}

function trustedNight(run, repository) {
  return (
    run.path === INTEL_WORKFLOW &&
    run.head_branch === 'main' &&
    run.repository?.full_name === repository &&
    run.head_repository?.full_name === repository &&
    run.event === 'schedule'
  )
}

export function intelHealthRecord(receipt, target, env = process.env) {
  const consumer = receipt?.consumer
  if (
    receipt?.schemaVersion !== 1 ||
    receipt.kind !== 'macos' ||
    receipt.profile !== 'x64' ||
    receipt.stage !== 'qualification' ||
    receipt.candidate?.sourceRevision !== target.source ||
    consumer?.workflowPath !== INTEL_WORKFLOW ||
    consumer.repository !== env.GITHUB_REPOSITORY ||
    consumer.runId !== Number(env.GITHUB_RUN_ID) ||
    consumer.runAttempt !== Number(env.GITHUB_RUN_ATTEMPT) ||
    consumer.headSha !== env.GITHUB_SHA ||
    consumer.headBranch !== 'main' ||
    consumer.headRepository !== env.GITHUB_REPOSITORY ||
    !['schedule', 'workflow_dispatch'].includes(consumer.event)
  )
    throw new Error('Intel health requires this run\'s complete exact-source qualification')
  return {
    schemaVersion: 1,
    outcome: 'passed',
    sourceRevision: requireRevision(target.source),
    version: target.version ?? null,
    label: target.label,
    runId: consumer.runId,
    runAttempt: consumer.runAttempt,
    workflowHead: consumer.headSha,
  }
}

async function healthFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })) {
    if (entry.isDirectory()) files.push(...(await healthFiles(join(directory, entry.name))))
    else if (entry.isFile() && entry.name === 'intel-health.json')
      files.push(JSON.parse(await readFile(join(directory, entry.name), 'utf8')))
  }
  return files
}

export function healthRows(targets, records, env = process.env) {
  return targets.map((target) => ({
    ...target,
    passed: records.filter((record) =>
      record.schemaVersion === 1 &&
      record.outcome === 'passed' &&
      record.sourceRevision === target.source &&
      record.runId === Number(env.GITHUB_RUN_ID) &&
      record.runAttempt === Number(env.GITHUB_RUN_ATTEMPT) &&
      record.workflowHead === env.GITHUB_SHA &&
      record.version === (target.version ?? null),
    ).length === 1,
  }))
}

async function lastPublishedPass(client, repository) {
  const runs = await scheduledRuns(client, repository)
  for (const run of runs.sort((a, b) => b.id - a.id)) {
    if (!trustedNight(run, repository)) continue
    const artifacts = await paginated(
      client, `repos/${repository}/actions/runs/${run.id}/artifacts`, 'artifacts',
    )
    const name = new RegExp(`^intel-health-[0-9a-f]{40}-r${run.id}-a[1-9][0-9]*$`)
    for (const artifact of artifacts.filter((entry) => name.test(entry.name) && !entry.expired)) {
      verifyArtifactMetadata(artifact, { name: artifact.name, runId: run.id, headSha: run.head_sha })
      const temporary = await mkdtemp(join(tmpdir(), 'jig-intel-health-'))
      try {
        const directory = join(temporary, 'health')
        await downloadArtifactDirectory(client, artifact, directory)
        for (const record of await healthFiles(directory)) {
          const recordName = `intel-health-${record.sourceRevision}-r${run.id}-a${record.runAttempt}`
          if (
            record.schemaVersion === 1 && record.outcome === 'passed' && record.version &&
            artifact.name === recordName && record.runId === run.id && record.runAttempt > 0 &&
            record.runAttempt <= run.run_attempt && record.workflowHead === run.head_sha
          ) return record
        }
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    }
  }
}

function expected(repository, source) {
  return {
    repository,
    workflowPath: '.github/workflows/ci.yml',
    event: 'push',
    headBranch: 'main',
    headRepository: repository,
    headSha: requireRevision(source),
  }
}

export async function selectIntelTargets({
  client, repository, mainSource, pullRequest, publishedVersion = currentPublishedVersion,
}) {
  requireRevision(mainSource)
  if (pullRequest) {
    if (!/^[1-9][0-9]*$/.test(String(pullRequest))) throw new Error('Invalid PR number')
    const pr = await client.api(`repos/${repository}/pulls/${pullRequest}`)
    if (pr.state !== 'open' || pr.base?.repo?.full_name !== repository)
      throw new Error('Intel PR checks require an open PR in this repository')
    return [
      {
        label: `PR ${pullRequest}`,
        source: requireRevision(pr.merge_commit_sha),
        expected: {
          ...expected(repository, pr.head.sha),
          event: 'pull_request',
          headBranch: pr.head.ref,
          headRepository: pr.head.repo.full_name,
        },
      },
    ]
  }
  const version = await publishedVersion()
  const targets = []
  if (version !== undefined) {
    if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version))
      throw new Error('Invalid published Jig version')
    const tag = `jig-v${version}`
    const commit = await client.api(`repos/${repository}/commits/${encodeURIComponent(tag)}`)
    const source = requireRevision(commit.sha)
    targets.push({ label: tag, version, source, expected: expected(repository, source) })
  }
  if (!targets.some((target) => target.source === mainSource))
    targets.push({ label: 'main', source: mainSource, expected: expected(repository, mainSource) })
  return targets
}

export async function verifyIntelInput(
  directory, target, { integrityForVersion = publishedIntegrity } = {},
) {
  const receipt = await verifyCandidateBundle(directory, { sourceRevision: target.source })
  for (const key of ['repository', 'workflowPath', 'event', 'headBranch', 'headRepository', 'headSha'])
    if (receipt.producer[key] !== target.expected[key])
      throw new Error(`Intel input producer ${key} mismatch`)
  const envelope = JSON.parse(await readFile(resolve(directory, 'ARTIFACT.json'), 'utf8'))
  const binding = candidateBinding(receipt, envelope)
  const jig = receipt.packages.find((entry) => entry.kind === 'jig')
  if (target.version && jig?.version !== target.version)
    throw new Error('Published Intel input version mismatch')
  if (target.version) {
    const bytes = await readFile(resolve(directory, jig.archive))
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
    if (integrity !== (await integrityForVersion(target.version)))
      throw new Error('Intel candidate is not the exact published Jig archive')
  }
  return binding
}

function currentPublishedVersion() {
  let version
  try {
    version = JSON.parse(execFileSync('npm', [
      'view', '@jigging/jig@alpha', 'version', '--json', '--registry=https://registry.npmjs.org',
    ], { encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024 }))
  } catch (error) {
    let code
    try { code = JSON.parse(error.stdout).error?.code } catch {}
    if (code === 'E404') return undefined
    throw new Error('Could not determine the published Jig alpha version', { cause: error })
  }
  return version
}

function publishedIntegrity(version) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error('Invalid published version')
  const metadata = execFileSync(
    'npm', ['view', `@jigging/jig@${version}`, 'dist.integrity', '--json',
      '--registry=https://registry.npmjs.org'],
    { encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024 },
  )
  return JSON.parse(metadata)
}

export async function acquireIntelInput({ client, repository, target, destination }) {
  requireRevision(target.source)
  // A nightly mirror retains already verified bytes across original CI expiry.
  // It is compatibility input only, never current-attempt release evidence.
  if (target.expected.event === 'push') {
    const runs = await scheduledRuns(client, repository)
    for (const run of runs.sort((a, b) => b.id - a.id)) {
      if (!trustedNight(run, repository)) continue
      const artifacts = await paginated(
        client, `repos/${repository}/actions/runs/${run.id}/artifacts`, 'artifacts',
      )
      const name = `intel-inputs-${target.source}-r${run.id}-a${run.run_attempt}`
      const matches = artifacts.filter((artifact) => artifact.name === name && !artifact.expired)
      if (!matches.length) continue
      if (matches.length !== 1) throw new Error('Ambiguous Intel input mirror')
      const artifact = verifyArtifactMetadata(matches[0], {
        name, runId: run.id, headSha: run.head_sha,
      })
      await downloadArtifactDirectory(client, artifact, destination)
      return verifyIntelInput(destination, target)
    }
  }
  await acquireCandidate({
    destination,
    sourceRevision: target.source,
    expected: target.expected,
    client,
    timeoutSeconds: 300,
    producerTimeoutSeconds: 1800,
  })
  return verifyIntelInput(destination, target)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Intel workflow must run from main')
    const repository = process.env.GITHUB_REPOSITORY
    const client = githubClient(repository)
    if (process.argv[2] === 'select') {
      const targets = await selectIntelTargets({ client, repository, mainSource: process.env.GITHUB_SHA,
        pullRequest: process.env.INTEL_PULL_REQUEST })
      const shards = targets.flatMap((target) => [3, 0, 1, 2].map((shard) => ({
        ...target, arch: 'x64', shard, installed: shard === 3,
      })))
      const aggregates = targets.map((target) => ({ ...target, arch: 'x64', count: 4 }))
      await appendFile(process.env.GITHUB_OUTPUT,
        `targets=${JSON.stringify({ include: aggregates })}\nshards=${JSON.stringify({ include: shards })}\n`)
    } else if (process.argv[2] === 'acquire') {
      const target = JSON.parse(process.env.INTEL_TARGET)
      await acquireIntelInput({ client, repository, target, destination: resolve(process.argv[3]) })
    } else if (process.argv[2] === 'record') {
      const receipt = JSON.parse(await readFile(process.argv[3], 'utf8'))
      const result = intelHealthRecord(receipt, JSON.parse(process.env.INTEL_TARGET))
      await writeFile(process.argv[4], JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
    } else if (process.argv[2] === 'health') {
      const targets = JSON.parse(process.env.INTEL_TARGETS).include
      if (!Array.isArray(targets) || !targets.length) throw new Error('Missing Intel target selection')
      const rows = healthRows(targets, await healthFiles(process.argv[3]))
      const latest = rows.find((row) => row.version && row.passed)
      let previous = latest
      let history = 'none retained'
      if (!previous) {
        try {
          previous = await lastPublishedPass(client, repository)
        } catch {
          // History is display-only; current qualification is checked below.
          history = 'history unavailable'
        }
      }
      const summary = [
        '## Intel compatibility health', '',
        '| Target | Exact source | Result |', '| --- | --- | --- |',
        ...rows.map((row) => `| ${row.label} | ${row.source} | ${row.passed ? 'Passed' : 'Failed or incomplete'} |`),
        '', `Last recorded passing published version: ${previous?.version ?? history}.`,
        'Intel results do not grant or block release readiness.', '',
      ].join('\n')
      await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
      if (rows.some((row) => !row.passed)) throw new Error('Intel compatibility failed or is incomplete')
    } else throw new Error('Use select, acquire, record or health')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
