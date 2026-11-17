import { execFileSync } from 'node:child_process'
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { digest, githubContext } from './candidate-provenance.mjs'
import {
  downloadArtifactDirectory,
  extractArtifactZip,
  paginated,
  validateWorkflowRun,
  verifyArtifactMetadata,
} from './candidate-transfer.mjs'
import { retainedMacBudget } from './mac-command-budget.mjs'
import { readFrozenMacPlan } from './macos-host-test-shards.mjs'
import { MACOS_COMPATIBILITY_MAJORS, macJobName } from './macos-qualification.mjs'
import { allRunJobs, latestJob } from './merge-attempts.mjs'

export const SELECT_STEP_NAME = 'Select one ready PR worker'
export const DECISION_UPLOAD_STEP_NAME = 'Publish PR shard decision'
export const WATCH_STEP_NAME = 'Watch selected PR worker'
export const NOOP_STEP_NAMES = Object.freeze([
  'Publish PR worker readiness',
  'Resolve PR shard decision',
  'Build the source-test workspace packages',
  'Test native containment and recovery',
  'Run the complete assigned whole-file shard',
  'Record successful shard',
])
export const selectorJobName = (shard) => `Select PR Mac worker — shard ${shard}`
const maximumArchiveBytes = 16384
const maximumRecordBytes = 4096
const positive = (value) => Number.isSafeInteger(value) && value > 0
const revision = (value) => /^[a-f0-9]{40}$/.test(value ?? '')
const sha256 = (value) => /^[a-f0-9]{64}$/.test(value ?? '')
const readyFields = [
  'version',
  'repository',
  'source',
  'runId',
  'attempt',
  'shard',
  'major',
  'jobId',
  'preparedArtifactId',
  'planSha256',
].sort()
const decisionFields = [
  ...readyFields,
  'selectorJobId',
  'offerArtifactId',
  'offerArtifactDigest',
].sort()
const pending = (message) => Object.assign(new Error(message), { code: 'MAC_RACE_PENDING' })

function validateContext(context) {
  if (
    !context ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(context.repository ?? '') ||
    context.repository.split('/').some((part) => part === '.' || part === '..') ||
    !revision(context.source) ||
    !revision(context.headSha) ||
    !positive(context.runId) ||
    !positive(context.attempt) ||
    !positive(context.minimumDecisionAttempt ?? 1) ||
    (context.minimumDecisionAttempt ?? 1) > context.attempt ||
    !positive(context.preparedArtifactId) ||
    !sha256(context.planSha256)
  )
    throw new Error('Invalid Mac decision context')
}
function role({ source, runId, attempt, shard }) {
  if (
    !revision(source) ||
    !positive(runId) ||
    !positive(attempt) ||
    !Number.isSafeInteger(shard) ||
    shard < 0 ||
    shard > 7
  )
    throw new Error('Invalid Mac decision role')
  return `${shard}-${source}-r${runId}-a${attempt}`
}
export const decisionName = (context) => `macos-pr-decision-${role(context)}`
export function offerName(context) {
  if (!MACOS_COMPATIBILITY_MAJORS.includes(context.major))
    throw new Error('Invalid Mac readiness major')
  return `macos-pr-offer-${context.major}-${role(context)}`
}
function validateRecord(value, context, decision) {
  validateContext(context)
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(decision ? decisionFields : readyFields) ||
    value.version !== 1 ||
    !MACOS_COMPATIBILITY_MAJORS.includes(value.major) ||
    !positive(value.jobId) ||
    !Number.isSafeInteger(value.shard) ||
    value.shard < 0 ||
    value.shard > 7 ||
    !positive(value.attempt) ||
    value.attempt > context.attempt ||
    value.attempt < (context.minimumDecisionAttempt ?? 1) ||
    ['repository', 'source', 'runId', 'preparedArtifactId', 'planSha256'].some(
      (key) => value[key] !== context[key],
    ) ||
    (context.shard !== undefined && value.shard !== context.shard) ||
    (context.recordAttempt !== undefined && value.attempt !== context.recordAttempt) ||
    (decision &&
      (!positive(value.selectorJobId) ||
        !positive(value.offerArtifactId) ||
        !/^sha256:[a-f0-9]{64}$/.test(value.offerArtifactDigest ?? '')))
  )
    throw new Error('Mac decision or readiness identity mismatch')
  return value
}
export const validateMacReady = (value, context) => validateRecord(value, context, false)
export const validateMacDecision = (value, context) => validateRecord(value, context, true)
function readyFor(context, major, jobId) {
  const { repository, source, runId, attempt, shard, preparedArtifactId, planSha256 } = context
  return validateMacReady(
    {
      version: 1,
      repository,
      source,
      runId,
      attempt,
      shard,
      major,
      jobId,
      preparedArtifactId,
      planSha256,
    },
    context,
  )
}
function assignedJob(job, id, name, attempt, label, context) {
  const created = Date.parse(job?.created_at),
    started = Date.parse(job?.started_at)
  if (
    !job ||
    job.id !== id ||
    job.name !== name ||
    job.run_id !== context.runId ||
    job.run_attempt !== attempt ||
    job.head_sha !== context.headSha ||
    !['in_progress', 'completed'].includes(job.status) ||
    (job.status === 'in_progress'
      ? job.conclusion !== null
      : typeof job.conclusion !== 'string' || !job.conclusion) ||
    !positive(job.runner_id) ||
    typeof job.runner_name !== 'string' ||
    !job.runner_name ||
    !Array.isArray(job.labels) ||
    !job.labels.includes(label) ||
    !Array.isArray(job.steps) ||
    !job.steps.some((step) => Number.isFinite(Date.parse(step.started_at))) ||
    !Number.isFinite(created) ||
    !Number.isFinite(started) ||
    created > started ||
    (job.status === 'completed' &&
      (!Number.isFinite(Date.parse(job.completed_at)) || started > Date.parse(job.completed_at)))
  )
    throw new Error('Mac decision lacks its original assigned job')
  return job
}
function exactJob(jobs, id) {
  const matches = jobs.filter((job) => job.id === id)
  if (matches.length !== 1) throw new Error('Missing or ambiguous Mac decision job')
  return matches[0]
}
function macJob(jobs, value, context) {
  return assignedJob(
    exactJob(jobs, value.jobId),
    value.jobId,
    macJobName(value.major, value.shard),
    value.attempt,
    `macos-${value.major}`,
    context,
  )
}
function selectorJob(jobs, value, context) {
  return assignedJob(
    exactJob(jobs, value.selectorJobId),
    value.selectorJobId,
    selectorJobName(value.shard),
    value.attempt,
    'ubuntu-24.04',
    context,
  )
}
function boundedRead(path, maximum) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > maximum)
      throw new Error('Oversized or nonregular Mac decision input')
    const bytes = Buffer.alloc(maximum + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null)
      if (!count) break
      length += count
    }
    if (length > maximum) throw new Error('Oversized Mac decision input')
    return bytes.subarray(0, length)
  } finally {
    closeSync(fd)
  }
}
function transientRead(error, allow404 = false) {
  const detail = `${error?.stderr ?? ''} ${error?.message ?? ''}`
  const observed = /HTTP[ /:](\d{3})\b/i.exec(detail)
  const status = observed ? Number(observed[1]) : Number(error?.statusCode ?? error?.status)
  if (status >= 400 && status <= 599) return status >= 500 || (allow404 && status === 404)
  return (
    [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EAI_AGAIN',
      'ENOTFOUND',
      'EPIPE',
    ].includes(error?.code) ||
    /TLS handshake timeout|i\/o timeout|connection reset by peer|unexpected EOF|temporary failure in name resolution/i.test(
      detail,
    )
  )
}
export async function readMacApiJson(
  read,
  { sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {},
) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response
    try {
      response = await read()
      return JSON.parse(response)
    } catch (error) {
      const position = /position (\d+)/.exec(error.message ?? '')
      const truncated =
        typeof response === 'string' &&
        error instanceof SyntaxError &&
        (/Unexpected end of JSON input|Unterminated string in JSON/.test(error.message) ||
          (position !== null && Number(position[1]) >= response.trimEnd().length))
      if (attempt === 3 || (!truncated && !transientRead(error))) throw error
      await sleep(1000)
    }
  }
}
async function readRecord(client, artifact, context, name, file, now) {
  verifyArtifactMetadata(artifact, { name, runId: context.runId, headSha: context.headSha, now })
  if (
    !positive(artifact.size_in_bytes) ||
    artifact.size_in_bytes > maximumArchiveBytes ||
    !Number.isFinite(Date.parse(artifact.created_at)) ||
    Date.parse(artifact.created_at) > now
  )
    throw new Error('Invalid or oversized Mac decision artifact')
  const temporary = await mkdtemp(join(tmpdir(), 'jig-mac-decision-'))
  try {
    const directory = join(temporary, 'record')
    const transport = {
      ...client,
      download: async (...args) => {
        try {
          return await client.download(...args)
        } catch (error) {
          if (transientRead(error, true))
            throw pending('GitHub artifact archive is not readable yet')
          throw error
        }
      },
    }
    await downloadArtifactDirectory(transport, artifact, directory, {
      extract: async (archive, destination) => {
        boundedRead(archive, maximumArchiveBytes)
        execFileSync(
          'python3',
          [
            '-c',
            "import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n e=z.infolist()\n if len(e)!=1 or e[0].filename!=sys.argv[2] or e[0].file_size>4096: raise ValueError('invalid Mac decision ZIP inventory')\n",
            archive,
            file,
          ],
          { timeout: 10000, maxBuffer: 16384, stdio: 'pipe' },
        )
        await extractArtifactZip(archive, destination)
      },
    })
    return JSON.parse(boundedRead(join(directory, file), maximumRecordBytes).toString('utf8'))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
function artifactDuringJob(artifact, job) {
  const created = Date.parse(artifact.created_at),
    started = Date.parse(job.started_at)
  if (
    created < started ||
    !job.steps.some(
      (step) => Date.parse(step.started_at) >= started && Date.parse(step.started_at) <= created,
    ) ||
    (job.status === 'completed' && created > Date.parse(job.completed_at))
  )
    throw new Error('Mac decision artifact was not published during its original job')
}
function artifactAttempt(artifact, context, kind) {
  const prefix =
    kind === 'decision'
      ? 'macos-pr-decision-'
      : `macos-pr-offer-(${MACOS_COMPATIBILITY_MAJORS.join('|')})-`
  const match = artifact?.name?.match(
    new RegExp(`^${prefix}([0-7])-([a-f0-9]{40})-r([1-9][0-9]*)-a([1-9][0-9]*)$`),
  )
  if (!match) throw new Error('Invalid Mac decision artifact name')
  const offset = kind === 'decision' ? 0 : 1
  const shard = Number(match[1 + offset]),
    attempt = Number(match[4 + offset])
  if (
    !positive(attempt) ||
    attempt < (context.minimumDecisionAttempt ?? 1) ||
    attempt > context.attempt ||
    (context.recordAttempt !== undefined && context.recordAttempt !== attempt)
  )
    throw new Error('Mac decision artifact attempt mismatch')
  return { ...context, shard: context.shard ?? shard, recordAttempt: attempt }
}
export async function readMacOfferArtifact(
  client,
  artifact,
  context,
  { jobs, now = Date.now() } = {},
) {
  const expected = artifactAttempt(artifact, context, 'offer')
  const major = Number(artifact.name.split('-')[3])
  const value = validateMacReady(
    await readRecord(
      client,
      artifact,
      context,
      offerName({ ...context, major, shard: expected.shard, attempt: expected.recordAttempt }),
      'READY.json',
      now,
    ),
    expected,
  )
  if (value.major !== major) throw new Error('Mac offer major mismatch')
  const job = macJob(jobs, value, context)
  artifactDuringJob(artifact, job)
  return { ready: value, artifact, job }
}
function decisionProducer(artifact, job) {
  artifactDuringJob(artifact, job)
  const selected = job.steps.filter((step) => step.name === SELECT_STEP_NAME)
  const uploaded = job.steps.filter((step) => step.name === DECISION_UPLOAD_STEP_NAME)
  if (selected.length !== 1 || uploaded.length !== 1) {
    if (job.status === 'completed') throw new Error('Missing sole-selector publication steps')
    throw pending('Selector step metadata is not visible yet')
  }
  const selection = selected[0],
    upload = uploaded[0],
    created = Date.parse(artifact.created_at)
  if (selection.status === 'completed' && selection.conclusion !== 'success')
    throw new Error('Sole-selector validation failed')
  if (
    selection.status !== 'completed' ||
    selection.conclusion !== 'success' ||
    !Number.isFinite(Date.parse(selection.completed_at)) ||
    Date.parse(selection.completed_at) > created
  )
    throw pending('Selector decision validation has not completed')
  if (!Number.isFinite(Date.parse(upload.started_at)))
    throw pending('Selector upload is not observed yet')
  if (
    Date.parse(upload.started_at) > created ||
    !['in_progress', 'completed'].includes(upload.status) ||
    (upload.status === 'completed' &&
      (upload.conclusion !== 'success' ||
        !Number.isFinite(Date.parse(upload.completed_at)) ||
        created > Date.parse(upload.completed_at)))
  )
    throw new Error('Mac decision lacks a successful sole-selector upload')
}
export async function readMacDecisionArtifact(
  client,
  artifact,
  context,
  { jobs, now = Date.now() } = {},
) {
  const expected = artifactAttempt(artifact, context, 'decision')
  const decision = validateMacDecision(
    await readRecord(
      client,
      artifact,
      context,
      decisionName({ ...context, shard: expected.shard, attempt: expected.recordAttempt }),
      'DECISION.json',
      now,
    ),
    expected,
  )
  const job = macJob(jobs, decision, context),
    selector = selectorJob(jobs, decision, context)
  decisionProducer(artifact, selector)
  let offerArtifact
  try {
    offerArtifact = await client.api(
      `repos/${context.repository}/actions/artifacts/${decision.offerArtifactId}`,
    )
  } catch (error) {
    if (transientRead(error, true))
      throw pending('Referenced Mac readiness metadata is not readable yet')
    throw error
  }
  if (
    offerArtifact.id !== decision.offerArtifactId ||
    offerArtifact.digest !== decision.offerArtifactDigest
  )
    throw new Error('Mac decision references changed readiness evidence')
  const offer = await readMacOfferArtifact(
    client,
    offerArtifact,
    { ...context, shard: decision.shard, recordAttempt: decision.attempt },
    { jobs, now },
  )
  if (
    readyFields.some((key) => offer.ready[key] !== decision[key]) ||
    Date.parse(offerArtifact.created_at) > Date.parse(artifact.created_at)
  )
    throw new Error('Mac decision does not match its selected readiness offer')
  return { decision, artifact, job, selectorJob: selector }
}
function noAllocation(job) {
  return (
    job.runner_id === 0 &&
    job.runner_name === '' &&
    Array.isArray(job.steps) &&
    job.steps.length === 0
  )
}
function noop(job, decisionStep, names) {
  if (
    job.status !== 'completed' ||
    job.conclusion !== 'success' ||
    !Array.isArray(job.steps) ||
    job.steps.some(
      (step) => step.status !== 'completed' || !['success', 'skipped'].includes(step.conclusion),
    )
  )
    return false
  const exact = (name, conclusion) =>
    job.steps.filter((step) => step.name === name).length === 1 &&
    job.steps.find((step) => step.name === name).conclusion === conclusion
  return exact(decisionStep, 'success') && names.every((name) => exact(name, 'skipped'))
}
export function selectMacPrDecisions({
  decisions,
  jobs,
  context,
  shards,
  requireSelectorSuccess = true,
}) {
  validateContext(context)
  if (
    !Array.isArray(decisions) ||
    !Array.isArray(jobs) ||
    !Array.isArray(shards) ||
    !shards.length ||
    new Set(shards).size !== shards.length
  )
    throw new Error('Incomplete Mac decision selection')
  for (const row of decisions) validateMacDecision(row.decision, context)
  const run = { id: context.runId, run_attempt: context.attempt, head_sha: context.headSha }
  return shards.map((shard) => {
    role({ ...context, shard })
    const latest = (name) =>
      jobs.some((job) => job.name === name)
        ? latestJob(jobs, run, name, { completed: false })
        : undefined
    const candidates = MACOS_COMPATIBILITY_MAJORS.map((major) =>
      latest(macJobName(major, shard)),
    ).filter((job) => job && job.run_attempt >= (context.minimumDecisionAttempt ?? 1))
    const rows = decisions.filter((row) => row.decision.shard === shard)
    if (!rows.length) {
      if (
        candidates.length < MACOS_COMPATIBILITY_MAJORS.length ||
        candidates.some((job) => ['queued', 'in_progress'].includes(job.status))
      )
        throw pending('Mac shard has no finalized decision yet')
      throw new Error('Completed Mac candidates have no immutable selector decision')
    }
    const attempt = Math.max(...rows.map((row) => row.decision.attempt)),
      selected = rows.filter((row) => row.decision.attempt === attempt)
    if (selected.length !== 1) throw new Error('Ambiguous latest Mac shard decision')
    const row = selected[0]
    const selectedName = macJobName(row.decision.major, shard)
    for (const candidate of candidates) {
      if (candidate.run_attempt <= attempt) continue
      // GitHub has queued a replacement of this winner, even before it assigns a runner.
      if (candidate.name === selectedName && candidate.status === 'queued')
        throw pending('The fixed Mac worker retry is awaiting allocation')
      if (noAllocation(candidate) || noop(candidate, 'Decide PR shard contention', NOOP_STEP_NAMES))
        continue
      if (['queued', 'in_progress'].includes(candidate.status))
        throw pending('New Mac candidate has not settled its decision')
      throw new Error('New Mac execution lacks its replacement decision or verified noop')
    }
    const job = macJob(jobs, row.decision, context)
    if (job.status !== 'completed') throw pending('The fixed Mac worker is still executing')
    if (
      job.conclusion !== 'success' ||
      job.steps.some(
        (step) => step.status !== 'completed' || !['success', 'skipped'].includes(step.conclusion),
      )
    )
      throw new Error('The fixed Mac worker did not succeed')
    let effectiveSelector = row.selectorJob
    if (requireSelectorSuccess) {
      const selector = latest(selectorJobName(shard))
      if (!selector) throw new Error('Missing authoritative Mac selector')
      if (selector.status !== 'completed')
        throw pending('The Mac selector is still watching its worker')
      if (
        selector.id !== row.decision.selectorJobId &&
        !noop(selector, SELECT_STEP_NAME, [DECISION_UPLOAD_STEP_NAME, WATCH_STEP_NAME])
      )
        throw new Error('Later selector did not verify retained Mac success')
      if (
        selector.conclusion !== 'success' ||
        selector.steps.some(
          (step) =>
            step.status !== 'completed' || !['success', 'skipped'].includes(step.conclusion),
        )
      )
        throw new Error('The Mac selector did not succeed')
      assignedJob(
        selector,
        selector.id,
        selectorJobName(shard),
        selector.run_attempt,
        'ubuntu-24.04',
        context,
      )
      effectiveSelector = selector
    }
    return {
      shard,
      major: row.decision.major,
      ...row,
      job,
      selectorJob: effectiveSelector,
      decisionSelectorJob: row.selectorJob,
    }
  })
}
function latestArtifact(artifacts, context, kind) {
  const prefix = `macos-pr-${kind}-${context.shard}-${context.source}-r${context.runId}-a`
  const eligible = artifacts
    .filter((artifact) => artifact.name?.startsWith(prefix))
    .filter((artifact) => {
      const value = Number(artifact.name.slice(prefix.length))
      if (!positive(value) || value > context.attempt)
        throw new Error('Invalid Mac decision attempt')
      return value >= (context.minimumDecisionAttempt ?? 1)
    })
  if (!eligible.length) return undefined
  const attempt = Math.max(
    ...eligible.map((artifact) => Number(artifact.name.slice(prefix.length))),
  )
  const matches = eligible.filter(
    (artifact) => Number(artifact.name.slice(prefix.length)) === attempt,
  )
  if (matches.length !== 1) throw new Error('Ambiguous immutable Mac selector decisions')
  return matches[0]
}
export async function retainedMacPrDecision(
  client,
  context,
  { jobs, artifacts, now = Date.now() },
) {
  validateContext(context)
  const artifact = latestArtifact(artifacts, context, 'decision')
  if (!artifact || artifact.name === decisionName(context)) return undefined
  const row = await readMacDecisionArtifact(client, artifact, context, { jobs, now })
  if (row.job.status === 'completed' && row.job.conclusion !== 'success') return undefined
  return selectMacPrDecisions({
    decisions: [row],
    jobs: jobs.filter((job) => job.run_attempt < context.attempt),
    context,
    shards: [context.shard],
    requireSelectorSuccess: false,
  })[0]
}
export function bindMacDecisionPreparation({ jobs, artifacts, run, context, now = Date.now() }) {
  validateContext(context)
  const preparation = latestJob(jobs, run, 'Prepare Mac inputs')
  const name = `macos-host-artifacts-${context.source}-r${context.runId}-a${preparation.run_attempt}`
  const matches = artifacts.filter((artifact) => artifact.name === name)
  if (matches.length !== 1 || matches[0].id !== context.preparedArtifactId)
    throw new Error('Mac decision does not use the exact current prepared input artifact')
  verifyArtifactMetadata(matches[0], { name, runId: context.runId, headSha: context.headSha, now })
  return { ...context, minimumDecisionAttempt: preparation.run_attempt }
}
function apiClient(repository) {
  return {
    api: (path) =>
      readMacApiJson(() =>
        execFileSync('gh', ['api', path], {
          encoding: 'utf8',
          timeout: 15000,
          maxBuffer: 1024 * 1024,
        }),
      ),
    download: async (id, destination) => {
      if (!positive(id)) throw new Error('Invalid Mac artifact ID')
      await writeFile(
        destination,
        execFileSync('gh', ['api', `repos/${repository}/actions/artifacts/${id}/zip`], {
          timeout: 15000,
          maxBuffer: maximumArchiveBytes + 1,
        }),
        { flag: 'wx' },
      )
    },
  }
}
export async function chooseMacOffer(client, context, { jobs, artifacts, now = Date.now() }) {
  const offers = []
  for (const major of MACOS_COMPATIBILITY_MAJORS) {
    const name = offerName({ ...context, major }),
      matches = artifacts.filter((artifact) => artifact.name === name)
    if (matches.length > 1) throw new Error('Ambiguous Mac readiness offers')
    if (matches.length) offers.push(matches[0])
  }
  offers.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id)
  for (const artifact of offers) {
    try {
      const row = await readMacOfferArtifact(
        client,
        artifact,
        { ...context, recordAttempt: context.attempt },
        { jobs, now },
      )
      if (row.job.status === 'in_progress') return row
    } catch (error) {
      if (error.code !== 'MAC_RACE_PENDING') throw error
    }
  }
  const run = { id: context.runId, run_attempt: context.attempt, head_sha: context.headSha }
  const candidates = MACOS_COMPATIBILITY_MAJORS.map((major) => {
    const name = macJobName(major, context.shard)
    const current = jobs.filter((job) => job.name === name && job.run_attempt === context.attempt)
    if (!current.length) return undefined
    if (current.length !== 1) throw new Error('Ambiguous current Mac readiness candidate')
    return latestJob(jobs, run, name, { completed: false })
  })
  if (candidates.every((job) => job?.status === 'completed'))
    throw new Error('All current Mac candidates completed without a live readiness offer')
  throw pending('Awaiting a live allocated Mac readiness offer')
}
async function poll(operation, deadline) {
  for (;;) {
    if (Date.now() >= deadline) throw new Error('Mac decision observation deadline expired')
    try {
      const result = await operation()
      if (Date.now() >= deadline) throw new Error('Mac decision observation deadline expired')
      return result
    } catch (error) {
      if (error.code !== 'MAC_RACE_PENDING') throw error
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(60000, Math.max(1, deadline - Date.now()))),
    )
  }
}
async function cli() {
  const [mode, path] = process.argv.slice(2),
    env = process.env
  if (
    !['prepare', 'select', 'resolve', 'watch'].includes(mode) ||
    (mode === 'resolve' ? process.argv.length !== 3 : !path || process.argv.length !== 4)
  )
    throw new Error(
      'usage: macos-pr-race.mjs prepare READY.json | select DECISION.json | resolve | watch DECISION.json',
    )
  const github = await githubContext({ env, sourceRevision: env.GITHUB_SHA })
  if (
    github.event !== 'pull_request' ||
    github.workflowPath !== '.github/workflows/macos-hosted-candidates.yml'
  )
    throw new Error('Mac worker selection requires its PR workflow')
  const bytes = boundedRead(env.JIG_MACOS_TEST_PLAN_FILE, 1024 * 1024)
  const plan = await readFrozenMacPlan(env.JIG_MACOS_TEST_PLAN_FILE, { source: env.GITHUB_SHA })
  if (JSON.stringify(JSON.parse(bytes.toString('utf8'))) !== JSON.stringify(plan))
    throw new Error('Mac plan changed during selection')
  let context = {
    repository: github.repository,
    source: env.GITHUB_SHA,
    headSha: github.headSha,
    runId: github.runId,
    attempt: github.runAttempt,
    shard: Number(env.MACOS_SHARD),
    preparedArtifactId: Number(env.MACOS_PREPARED_ARTIFACT_ID),
    planSha256: digest(bytes),
  }
  validateContext(context)
  if (!plan.shards.some((row) => row.index === context.shard))
    throw new Error('Mac role is absent from its frozen plan')
  const client = apiClient(context.repository)
  const snapshot = async () => {
    const run = await client.api(`repos/${context.repository}/actions/runs/${context.runId}`)
    validateWorkflowRun(run, github)
    const age = Date.now() - Date.parse(run.created_at)
    if (
      run.id !== context.runId ||
      run.run_attempt !== context.attempt ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > 86400000
    )
      throw new Error('Mac selection run changed or exceeded its 24-hour session')
    const [jobs, artifacts] = await Promise.all([
      allRunJobs(client, context.repository, run),
      paginated(
        client,
        `repos/${context.repository}/actions/runs/${context.runId}/artifacts`,
        'artifacts',
      ),
    ])
    context = bindMacDecisionPreparation({ jobs, artifacts, run, context })
    return { run, jobs, artifacts }
  }
  let state = await snapshot()
  const output = async (value) => {
    if (!env.GITHUB_OUTPUT) throw new Error('Missing GitHub selection output')
    await appendFile(env.GITHUB_OUTPUT, value)
  }
  const mac = ['prepare', 'resolve'].includes(mode)
  const budget = mac ? retainedMacBudget(env) : undefined
  let observationDeadline = budget?.workDeadline
  const checkBudget = () => {
    if (observationDeadline !== undefined && Date.now() >= observationDeadline)
      throw new Error('Mac selection work allowance expired')
  }
  checkBudget()
  let own
  if (mac)
    own = macJob(state.jobs, readyFor(context, Number(env.MACOS_MAJOR), budget.jobId), context)
  else {
    const candidate = latestJob(state.jobs, state.run, selectorJobName(context.shard), {
      completed: false,
    })
    own = assignedJob(
      candidate,
      candidate.id,
      selectorJobName(context.shard),
      context.attempt,
      'ubuntu-24.04',
      context,
    )
  }
  observationDeadline ??= Date.parse(own.started_at) + 40 * 60000
  checkBudget()
  if (own.status !== 'in_progress')
    throw new Error('Mac selection requires its exact active execution')
  if (mode === 'prepare' || mode === 'select') {
    const retained = await poll(
      () => retainedMacPrDecision(client, context, state),
      observationDeadline,
    )
    if (retained) {
      checkBudget()
      await output('contend=false\nwinner=false\n')
      return
    }
  }
  if (mode === 'prepare') {
    const ready = readyFor(context, Number(env.MACOS_MAJOR), budget.jobId)
    checkBudget()
    await writeFile(path, `${JSON.stringify(ready)}\n`, { flag: 'wx', mode: 0o600 })
    await output(`contend=true\noffer_name=${offerName(ready)}\n`)
    return
  }
  if (mode === 'select') {
    const offer = await poll(async () => {
      state = await snapshot()
      if (state.artifacts.some((artifact) => artifact.name === decisionName(context)))
        throw new Error('This selector attempt already published its decision')
      return chooseMacOffer(client, context, state)
    }, observationDeadline)
    const decision = validateMacDecision(
      {
        ...offer.ready,
        selectorJobId: own.id,
        offerArtifactId: offer.artifact.id,
        offerArtifactDigest: offer.artifact.digest,
      },
      context,
    )
    await writeFile(path, `${JSON.stringify(decision)}\n`, { flag: 'wx', mode: 0o600 })
    await output(`contend=true\ndecision_name=${decisionName(context)}\n`)
    return
  }
  const row = await poll(async () => {
    checkBudget()
    state = await snapshot()
    const artifacts = state.artifacts.filter((artifact) => artifact.name === decisionName(context))
    if (artifacts.length > 1) throw new Error('Ambiguous immutable Mac selector decisions')
    if (!artifacts.length) {
      const selector = state.jobs.filter(
        (job) => job.name === selectorJobName(context.shard) && job.run_attempt === context.attempt,
      )
      if (selector.length && selector.every((job) => job.status === 'completed'))
        throw new Error('Completed selector published no decision')
      throw pending('Awaiting this attempt selector decision')
    }
    return readMacDecisionArtifact(client, artifacts[0], context, { jobs: state.jobs })
  }, observationDeadline)
  if (mode === 'resolve') {
    checkBudget()
    if (
      macJob(state.jobs, readyFor(context, Number(env.MACOS_MAJOR), budget.jobId), context)
        .status !== 'in_progress'
    )
      throw new Error('Mac candidate is no longer active')
    const winner = row.decision.jobId === budget.jobId
    if (env.MACOS_DECISION_EVIDENCE_FILE)
      await writeFile(
        env.MACOS_DECISION_EVIDENCE_FILE,
        `${JSON.stringify({ decision: row.decision, artifact: { id: row.artifact.id, digest: row.artifact.digest } })}\n`,
        { flag: 'wx', mode: 0o600 },
      )
    await output(
      `winner=${winner}\ndecision_artifact_id=${row.artifact.id}\ndecision_artifact_digest=${row.artifact.digest}\n`,
    )
    return
  }
  const local = validateMacDecision(
    JSON.parse(boundedRead(path, maximumRecordBytes).toString('utf8')),
    context,
  )
  if (
    local.selectorJobId !== own.id ||
    decisionFields.some((key) => local[key] !== row.decision[key])
  )
    throw new Error('Watcher does not own this exact published decision')
  await poll(async () => {
    state = await snapshot()
    const job = macJob(state.jobs, local, context)
    if (job.status !== 'completed') throw pending('Selected Mac worker is still executing')
    if (job.conclusion !== 'success') throw new Error('The selected Mac worker did not succeed')
    return job
  }, observationDeadline)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await cli()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
