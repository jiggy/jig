import { execFileSync } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  candidateBinding,
  digest,
  githubContext,
  parseOptions,
  readMetadata,
  requireRevision,
  verifyCandidateBundle,
} from './candidate-provenance.mjs'

export function githubClient(repository = process.env.GITHUB_REPOSITORY) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ''))
    throw new Error('Invalid GitHub repository')
  return {
    api: async (path) =>
      JSON.parse(
        execFileSync('gh', ['api', path], {
          encoding: 'utf8',
          timeout: 60_000,
          maxBuffer: 16 * 1024 * 1024,
        }),
      ),
    download: async (artifactId, destination) => {
      if (!Number.isSafeInteger(artifactId) || artifactId <= 0)
        throw new Error('Invalid artifact ID')
      const bytes = execFileSync(
        'gh',
        ['api', `repos/${repository}/actions/artifacts/${artifactId}/zip`],
        { timeout: 120_000, maxBuffer: 256 * 1024 * 1024 },
      )
      await writeFile(destination, bytes, { flag: 'wx' })
    },
  }
}

export async function paginated(client, path, key) {
  const values = []
  for (let page = 1; page <= 10; page++) {
    const result = await client.api(
      `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
    )
    if (!Array.isArray(result[key])) throw new Error(`Missing GitHub ${key} response`)
    values.push(...result[key])
    if (result[key].length < 100) return values
  }
  throw new Error('GitHub pagination limit exceeded; refusing incomplete evidence')
}

export function validateWorkflowRun(run, expected) {
  if (
    !run ||
    run.repository?.full_name !== expected.repository ||
    run.path !== expected.workflowPath ||
    !Number.isSafeInteger(run.id) ||
    run.id <= 0 ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt <= 0 ||
    !(expected.allowedEvents ?? [expected.event]).includes(run.event) ||
    run.head_branch !== expected.headBranch ||
    run.head_sha !== expected.headSha ||
    run.head_repository?.full_name !== expected.headRepository
  )
    throw new Error('GitHub workflow producer identity mismatch')
  return run
}

export function verifyArtifactMetadata(artifact, { name, runId, headSha, now = Date.now() }) {
  if (
    !artifact ||
    !Number.isSafeInteger(artifact.id) ||
    artifact.id <= 0 ||
    artifact.name !== name ||
    artifact.expired !== false ||
    !Number.isFinite(Date.parse(artifact.expires_at)) ||
    Date.parse(artifact.expires_at) <= now ||
    !/^sha256:[0-9a-f]{64}$/.test(artifact.digest ?? '') ||
    artifact.workflow_run?.id !== runId ||
    artifact.workflow_run?.head_sha !== headSha
  )
    throw new Error('GitHub artifact identity or retention mismatch')
  return artifact
}

// GitHub artifact ZIPs are inert inputs. Reject links, traversal, duplicates and
// excessive expansion before writing any entry into an empty destination.
export async function extractArtifactZip(archive, destination) {
  const program = `import pathlib, stat, sys, zipfile\nroot=pathlib.Path(sys.argv[2])\nwith zipfile.ZipFile(sys.argv[1]) as z:\n entries=z.infolist()\n if len(entries)>100000 or sum(e.file_size for e in entries)>1024*1024*1024: raise ValueError('oversized artifact')\n seen=set()\n for e in entries:\n  p=pathlib.PurePosixPath(e.filename)\n  mode=e.external_attr>>16\n  if not e.filename or e.filename.startswith('/') or '\\\\' in e.filename or any(x in ('', '.', '..') for x in e.filename.rstrip('/').split('/')) or str(p) in seen or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)): raise ValueError('unsafe artifact entry')\n  seen.add(str(p))\n for e in entries:\n  target=root.joinpath(*pathlib.PurePosixPath(e.filename).parts)\n  if e.is_dir(): target.mkdir(parents=True, exist_ok=True)\n  else:\n   target.parent.mkdir(parents=True, exist_ok=True)\n   with target.open('xb') as f: f.write(z.read(e))\n`
  await mkdir(destination, { recursive: false })
  execFileSync('python3', ['-c', program, archive, destination], {
    stdio: 'pipe',
    maxBuffer: 1024 * 1024,
  })
}

export async function downloadArtifactDirectory(
  client,
  artifact,
  destination,
  { extract = extractArtifactZip } = {},
) {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-ci-artifact-'))
  try {
    const archive = join(temporary, 'artifact.zip')
    await client.download(artifact.id, archive)
    if (`sha256:${digest(await readFile(archive))}` !== artifact.digest)
      throw new Error('GitHub artifact transport digest mismatch')
    await extract(archive, destination)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function acquisitionExpectation(sourceRevision, env = process.env) {
  requireRevision(sourceRevision)
  const context = await githubContext({ env, sourceRevision })
  const pr = context.event === 'pull_request'
  return {
    repository: context.repository,
    workflowPath: '.github/workflows/ci.yml',
    event: pr ? 'pull_request' : 'push',
    headBranch: pr ? context.headBranch : 'main',
    ...(pr ? {} : { allowedEvents: ['push', 'schedule', 'workflow_dispatch'] }),
    headRepository: pr ? context.headRepository : context.repository,
    headSha: pr ? context.headSha : sourceRevision,
  }
}

export async function acquireCandidate({
  destination,
  sourceRevision,
  producerRunId,
  expected,
  client,
  timeoutSeconds = 90,
  now = () => Date.now(),
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  extract,
}) {
  requireRevision(sourceRevision)
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 300)
    throw new Error('Candidate acquisition timeout must be 0–300 seconds')
  if (producerRunId !== undefined && (!Number.isSafeInteger(producerRunId) || producerRunId <= 0))
    throw new Error('Invalid producer run ID')
  const deadline = now() + timeoutSeconds * 1000
  while (true) {
    let runs
    if (producerRunId)
      runs = [await client.api(`repos/${expected.repository}/actions/runs/${producerRunId}`)]
    else {
      const responses = await Promise.all(
        (expected.allowedEvents ?? [expected.event]).map(async (event) => {
          const query = new URLSearchParams({
            event,
            head_sha: expected.headSha,
            branch: expected.headBranch,
          })
          return paginated(
            client,
            `repos/${expected.repository}/actions/workflows/ci.yml/runs?${query}`,
            'workflow_runs',
          )
        }),
      )
      runs = [...new Map(responses.flat().map((entry) => [entry.id, entry])).values()]
      runs = runs
        .filter((run) => {
          try {
            validateWorkflowRun(run, expected)
            return true
          } catch {
            return false
          }
        })
        .sort((a, b) => b.id - a.id)
      // Do not fall back to stale attempts when the newest matching CI run is
      // rebuilding its candidate. Its identity determines this acquisition.
      runs = runs.slice(0, 1)
    }
    for (const run of runs) {
      validateWorkflowRun(run, expected)
      const name = `candidates-${sourceRevision}-r${run.id}-a${run.run_attempt}`
      const artifacts = await paginated(
        client,
        `repos/${expected.repository}/actions/runs/${run.id}/artifacts`,
        'artifacts',
      )
      const matches = artifacts.filter((artifact) => artifact.name === name)
      if (matches.length > 1) throw new Error('Ambiguous canonical candidate artifacts')
      if (!matches.length) continue
      const artifact = verifyArtifactMetadata(matches[0], {
        name,
        runId: run.id,
        headSha: run.head_sha,
        now: now(),
      })
      await downloadArtifactDirectory(client, artifact, destination, { extract })
      const receipt = await verifyCandidateBundle(destination, {
        sourceRevision,
        producerRunId: run.id,
        producerRunAttempt: run.run_attempt,
        producerRepository: expected.repository,
      })
      for (const key of ['workflowPath', 'event', 'headBranch', 'headRepository', 'headSha'])
        if (receipt.producer[key] !== (key === 'event' ? run.event : expected[key]))
          throw new Error(`Candidate producer ${key} mismatch`)
      const current = await client.api(`repos/${expected.repository}/actions/runs/${run.id}`)
      validateWorkflowRun(current, expected)
      if (current.run_attempt !== run.run_attempt)
        throw new Error('Candidate producer attempt changed during acquisition')
      const envelope = {
        schemaVersion: 1,
        repository: expected.repository,
        sourceRevision,
        runId: run.id,
        runAttempt: run.run_attempt,
        artifactId: artifact.id,
        artifactDigest: artifact.digest,
        receiptSha256: receipt.receiptSha256,
      }
      await writeFile(
        resolve(destination, 'ARTIFACT.json'),
        `${JSON.stringify(envelope, null, 2)}\n`,
        { flag: 'wx' },
      )
      return envelope
    }
    if (now() >= deadline)
      throw new Error('Canonical CI candidate was not available before the acquisition deadline')
    await sleep(Math.min(10000, Math.max(1, deadline - now())))
  }
}

export async function acquireLinuxQualification({
  destination,
  qualificationDirectory,
  sourceRevision,
  linuxRunId,
  repository,
  client,
  extract,
}) {
  requireRevision(sourceRevision)
  const { LINUX_QUALIFICATION_JOBS, requireJobs, verifyQualification } = await import(
    './release-readiness.mjs'
  )
  const expected = {
    repository,
    workflowPath: '.github/workflows/linux-host-conformance.yml',
    event: 'push',
    headBranch: 'main',
    headRepository: repository,
    headSha: sourceRevision,
  }
  let run
  if (linuxRunId !== undefined) {
    if (!Number.isSafeInteger(linuxRunId) || linuxRunId <= 0)
      throw new Error('Invalid Linux run ID')
    run = await client.api(`repos/${repository}/actions/runs/${linuxRunId}`)
  } else {
    const query = new URLSearchParams({ branch: 'main', event: 'push', head_sha: sourceRevision })
    const runs = await paginated(
      client,
      `repos/${repository}/actions/workflows/linux-host-conformance.yml/runs?${query}`,
      'workflow_runs',
    )
    run = runs
      .filter((entry) => {
        try {
          validateWorkflowRun(entry, expected)
          return true
        } catch {
          return false
        }
      })
      .sort((a, b) => b.id - a.id)[0]
  }
  validateWorkflowRun(run, expected)
  if (run.status !== 'completed' || run.conclusion !== 'success')
    throw new Error('Complete same-revision Linux qualification is required')
  await requireJobs(client, repository, run, LINUX_QUALIFICATION_JOBS)
  const name = `linux-qualification-${sourceRevision}-r${run.id}-a${run.run_attempt}`
  const artifacts = await paginated(
    client,
    `repos/${repository}/actions/runs/${run.id}/artifacts`,
    'artifacts',
  )
  const matches = artifacts.filter((entry) => entry.name === name)
  if (matches.length !== 1)
    throw new Error('Missing or ambiguous exact-attempt Linux qualification receipt')
  const artifact = verifyArtifactMetadata(matches[0], {
    name,
    runId: run.id,
    headSha: run.head_sha,
  })
  let qualification
  if (client.readQualification) {
    const value = await client.readQualification(artifact)
    qualification = value.receipt ?? value
    await mkdir(qualificationDirectory)
    await writeFile(
      join(qualificationDirectory, 'QUALIFICATION.json'),
      `${JSON.stringify(qualification, null, 2)}\n`,
      { flag: 'wx' },
    )
  } else {
    await downloadArtifactDirectory(client, artifact, qualificationDirectory, { extract })
    qualification = await readMetadata(join(qualificationDirectory, 'QUALIFICATION.json'))
  }
  verifyQualification(qualification, {
    kind: 'linux',
    profile: '',
    candidate: qualification.candidate,
    run,
    repository,
  })
  if (qualification.candidate.sourceRevision !== sourceRevision)
    throw new Error('Linux receipt tested source mismatch')
  const producerExpected = { ...expected, workflowPath: '.github/workflows/ci.yml' }
  const envelope = await acquireCandidate({
    destination,
    sourceRevision,
    producerRunId: qualification.candidate.producerRunId,
    expected: producerExpected,
    client,
    timeoutSeconds: 0,
    extract,
  })
  const candidate = candidateBinding(await verifyCandidateBundle(destination), envelope)
  if (JSON.stringify(candidate) !== JSON.stringify(qualification.candidate))
    throw new Error('Linux qualification used different canonical candidate bytes')
  const current = await client.api(`repos/${repository}/actions/runs/${run.id}`)
  validateWorkflowRun(current, expected)
  if (
    current.run_attempt !== run.run_attempt ||
    current.status !== 'completed' ||
    current.conclusion !== 'success'
  )
    throw new Error('Linux qualification attempt changed during acquisition')
  return { ...envelope, linuxRunId: run.id, linuxRunAttempt: run.run_attempt }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { positional, options } = parseOptions(process.argv.slice(2))
    if (
      !['acquire', 'acquire-linux'].includes(positional[0]) ||
      positional.length !== 2 ||
      !options.source
    )
      throw new Error(
        'Use acquire OUTPUT --source SHA [--producer-run ID] or acquire-linux OUTPUT --source SHA --qualification-output DIR [--linux-run ID]',
      )
    const expected = await acquisitionExpectation(options.source)
    const client = githubClient(expected.repository)
    let envelope
    if (positional[0] === 'acquire-linux') {
      if (!options['qualification-output'])
        throw new Error('Linux acquisition requires a qualification output directory')
      envelope = await acquireLinuxQualification({
        destination: resolve(positional[1]),
        qualificationDirectory: resolve(options['qualification-output']),
        sourceRevision: options.source,
        linuxRunId: options['linux-run'] === undefined ? undefined : Number(options['linux-run']),
        repository: expected.repository,
        client,
      })
    } else
      envelope = await acquireCandidate({
        destination: resolve(positional[1]),
        sourceRevision: options.source,
        producerRunId:
          options['producer-run'] === undefined ? undefined : Number(options['producer-run']),
        expected,
        client,
        timeoutSeconds: Number(options['timeout-seconds'] ?? 90),
      })
    if (options['github-output'])
      await appendFile(
        options['github-output'],
        `source_revision=${envelope.sourceRevision}\nproducer_run_id=${envelope.runId}\nproducer_run_attempt=${envelope.runAttempt}\nartifact_id=${envelope.artifactId}\n${envelope.linuxRunId ? `linux_run_id=${envelope.linuxRunId}\nlinux_run_attempt=${envelope.linuxRunAttempt}\n` : ''}`,
      )
    console.log(JSON.stringify(envelope))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
