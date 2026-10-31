import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import { digest } from './candidate-provenance.mjs'
import { collectJobEvidence, executionInventory } from './job-evidence.mjs'
import { allRunJobs, latestJob } from './merge-attempts.mjs'
import {
  acquireMergeEvidence,
  inputArtifact,
  MERGE_JOBS,
  mergeContext,
  validateMergeRuntime,
  verifyMergeReport,
  workflowSourceDigest,
} from './merge-retry.mjs'

const source = executionInventory().source
const head = 'b'.repeat(40)
const repository = 'jiggy/jig'
const workflowDigest = workflowSourceDigest(source)
const run = {
  id: 100, run_attempt: 2, path: '.github/workflows/ci.yml', event: 'pull_request',
  head_sha: head, head_branch: 'feature', repository: { full_name: repository },
  head_repository: { full_name: repository }, status: 'in_progress', conclusion: null,
}
const runtime = (os) => ({
  os, architecture: os === 'macOS' ? 'ARM64' : 'X64',
  image: { Linux: 'ubuntu24', Windows: 'win22', macOS: 'macos15' }[os],
  imageVersion: '20261001.1', node: 'v24.0.0',
})
const job = (id, name, attempt = 1, extra = {}) => ({
  id, name, run_id: 100, run_attempt: attempt, head_sha: head,
  status: 'completed', conclusion: 'success', ...extra,
})
const artifact = (id, name) => ({
  id, name, expired: false, expires_at: '2099-01-01T00:00:00Z',
  digest: 'sha256:' + 'a'.repeat(64), workflow_run: { id: 100, head_sha: head },
})
const execution = {
  created_at: '2026-10-31T05:35:14Z', started_at: '2026-10-31T05:54:42Z',
  completed_at: '2026-10-31T05:59:34Z', runner_id: 7, runner_name: 'runner-7',
  runner_group_id: 0, labels: ['ubuntu-24.04'],
  steps: [{ name: 'Execute complete suite', number: 1, status: 'completed', conclusion: 'success',
    started_at: '2026-10-31T05:54:45Z', completed_at: '2026-10-31T05:59:30Z' }],
}
const copiedCheck = (original, id, attempt = 2) => ({
  ...structuredClone(original), id, run_attempt: attempt, created_at: '2026-10-31T06:01:02Z',
  runner_group_id: null,
})

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'jig-merge-retry-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const eventPath = join(root, 'event.json')
  await writeFile(eventPath, JSON.stringify({
    pull_request: { head: { sha: head, ref: 'feature', repo: { full_name: repository } } },
  }))
  const env = {
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: repository, GITHUB_SHA: source,
    GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '2', GITHUB_EVENT_PATH: eventPath,
    GITHUB_WORKFLOW_REF: repository + '/.github/workflows/ci.yml@refs/pull/1/merge',
  }
  const jobs = [job(1, 'candidate-build'), ...MERGE_JOBS.map((spec, i) =>
    job(i + 2, spec.name, spec.name === 'Python 3.14 on macos-15' ? 2 : 1))]
  const artifacts = [
    artifact(1, 'candidates-' + source + '-r100-a1'),
    artifact(2, 'python-candidate-' + source + '-r100-a1'),
    artifact(3, 'python-reporting-candidate-' + source + '-r100-a1'),
  ]
  const snapshot = { source, context: { repository }, run: structuredClone(run), jobs, artifacts }
  const inventory = executionInventory({ scope: 'ci' })
  const archiveBytes = new Map(), reports = new Map(), downloaded = []
  const client = {
    api: async (path) => {
      const url = new URL('https://api.github.com/' + path)
      if (url.pathname.endsWith('/jobs')) return { jobs: structuredClone(snapshot.jobs) }
      if (url.pathname.endsWith('/artifacts')) return { artifacts: structuredClone(snapshot.artifacts) }
      if (url.pathname.endsWith('/runs/100')) return structuredClone(snapshot.run)
      throw new Error('Unexpected API path: ' + path)
    },
    download: async (id, path) => { downloaded.push(id); await writeFile(path, archiveBytes.get(id)) },
  }
  for (const spec of MERGE_JOBS) {
    const selected = latestJob(jobs, run, spec.name)
    const rows = spec.targets.map((id) => {
      const target = inventory.targets.find((item) => item.id === id)
      return { id, status: 'success', inventoryDigest: target.inventoryDigest,
        executedCount: 1, basis: 'test-cases', unexpectedSkips: 0, observedSkipped: 0,
        profiles: spec.profile ? [spec.profile] : target.runtimeProfiles,
        artifactsVerified: true, residueVerified: true }
    })
    const receipt = { schemaVersion: 1, source, repository, workflowDigest, runId: 100,
      jobId: selected.id, name: spec.name, attempt: selected.run_attempt,
      runtime: runtime(spec.os), inputs: spec.inputs.map((kind) => inputArtifact(snapshot, kind)) }
    reports.set(spec.name, rows.map((row) => ({ schemaVersion: 1, source, results: [row], mergeRetry: receipt })))
  }
  async function pack() {
    const archivePlan = []
    for (const spec of MERGE_JOBS) {
      const selected = latestJob(jobs, run, spec.name)
      const name = 'ci-evidence-' + spec.stem + '-' + source + '-a' + selected.run_attempt
      const a = artifact(10 + MERGE_JOBS.indexOf(spec), name)
      const folder = join(root, 'pack-' + spec.stem)
      await rm(folder, { recursive: true, force: true })
      await mkdir(folder)
      for (const [i, report] of reports.get(spec.name).entries())
        await writeFile(join(folder, i + '.json'), JSON.stringify(report))
      archivePlan.push({ folder, zip: join(root, spec.stem + '.zip'), artifact: a })
    }
    execFileSync('python3', ['-c', 'import json,pathlib,sys,zipfile\nfor item in json.loads(sys.argv[1]):\n p=pathlib.Path(item["folder"])\n with zipfile.ZipFile(item["zip"],"w") as z:\n  for f in p.iterdir(): z.write(f,f.name)', JSON.stringify(archivePlan)])
    for (const { zip, artifact: a } of archivePlan) {
      const bytes = await readFile(zip)
      a.digest = 'sha256:' + digest(bytes)
      const existing = artifacts.findIndex((item) => item.name === a.name)
      if (existing === -1) artifacts.push(a)
      else artifacts[existing] = a
      archiveBytes.set(a.id, bytes)
    }
  }
  await pack()
  return { root, env, snapshot, jobs, artifacts, client, reports, pack, downloaded }
}

test('merge retry uses latest execution and never falls back from a later failure', () => {
  const jobs = [job(1, 'test', 1), job(2, 'test', 2, { conclusion: 'failure' })]
  assert.throws(() => latestJob(jobs, run, 'test'), /did not succeed/)
  assert.equal(latestJob(jobs.slice(0, 1), run, 'test').run_attempt, 1)
  for (const changed of [
    [job(1, 'test', 3)], [job(1, 'test', 1, { run_id: 101 })],
    [job(1, 'test', 1, { head_sha: source })], [job(1, 'test'), job(2, 'test')], [],
  ]) assert.throws(() => latestJob(changed, run, 'test'))
})

test('GitHub carried checks retain the exact original execution identity across retries', () => {
  const original = job(1, 'source', 1, execution)
  const copy = copiedCheck(original, 2)
  assert.equal(latestJob([original, copy], run, 'source'), original)
  assert.equal(latestJob([original, copy, copiedCheck(original, 3, 3)], { ...run, run_attempt: 3 }, 'source'), original)
  for (const change of [
    { started_at: '2026-10-31T05:54:43Z' }, { completed_at: '2026-10-31T05:59:33Z' },
    { runner_id: 8 }, { runner_name: 'other' }, { labels: ['windows-2022'] }, { steps: [] },
    { steps: [{ ...execution.steps[0], conclusion: 'failure' }] },
    { steps: [{ ...execution.steps[0], completed_at: '2026-10-31T05:59:29Z' }] },
  ]) assert.throws(() => latestJob([original, { ...copy, ...change }], run, 'source'), /Unverifiable carried/)
  assert.throws(() => latestJob([copy], run, 'source'), /Unverifiable carried/)
  assert.throws(() => latestJob([original, { ...original, id: 9 }, copy], run, 'source'), /Unverifiable carried/)
  const laterFailure = job(4, 'source', 2, { ...execution, conclusion: 'failure' })
  assert.throws(() => latestJob([original, laterFailure, copiedCheck(original, 5, 3)], { ...run, run_attempt: 3 }, 'source'), /did not succeed/)
  assert.throws(() => latestJob([original, { ...copy, status: 'in_progress', conclusion: null }], run, 'source'), /did not succeed/)
})

test('real ZIP collection accepts copied GitHub checks only through their original job receipts', async (t) => {
  const f = await fixture(t)
  const originals = f.jobs.filter((job) => job.run_attempt === 1)
  for (const job of originals) Object.assign(job, structuredClone(execution))
  f.jobs.push(...originals.map((job) => copiedCheck(job, 1000 + job.id)))
  const receipt = await acquireMergeEvidence({ directory: join(f.root, 'copied'), output: join(f.root, 'copied.json'), env: f.env, client: f.client })
  assert.equal(receipt.jobs.filter((job) => job.attempt === 1).length, MERGE_JOBS.length - 1)
  for (const retained of receipt.jobs.filter((job) => job.attempt === 1)) {
    assert.equal(retained.jobId, originals.find((job) => job.name === retained.name).id)
    assert.ok(retained.jobId < 1000)
  }
})

test('partial PR retry combines immutable successful jobs and the freshly retried matrix job', async (t) => {
  const f = await fixture(t)
  const directory = join(f.root, 'evidence'), output = join(f.root, 'MERGE_RETRY.json')
  f.env.GITHUB_STEP_SUMMARY = join(f.root, 'summary.md')
  const receipt = await acquireMergeEvidence({ directory, output, env: f.env, client: f.client })
  assert.equal(receipt.mergeOnly, true)
  assert.deepEqual(Object.keys(receipt.jobResults).sort(), ['candidate-build', 'quick-checks', 'sites', 'python-build', 'source-tests', 'python-installed', 'npm-candidate'].sort())
  assert.ok(Object.values(receipt.jobResults).every((item) => item.result === 'success'))
  assert.equal(receipt.jobs.length, MERGE_JOBS.length)
  assert.equal(receipt.jobs.find((item) => item.name === 'Python 3.14 on macos-15').attempt, 2)
  assert.equal(receipt.jobs.filter((item) => item.attempt === 1).length, MERGE_JOBS.length - 1)
  assert.equal(new Set(f.downloaded).size, MERGE_JOBS.length)
  const statuses = Object.fromEntries(executionInventory({ scope: 'ci' }).targets.map((item) => [item.id, 'success']))
  await writeFile(join(f.root, 'statuses.json'), JSON.stringify(statuses))
  await collectJobEvidence({ directory, output: join(f.root, 'combined.json'), resultsPath: join(f.root, 'statuses.json') })
  const combined = JSON.parse(await readFile(join(f.root, 'combined.json')))
  assert.equal(combined.results.length, Object.keys(statuses).length)
  const summary = await readFile(f.env.GITHUB_STEP_SUMMARY, 'utf8')
  assert.ok(summary.includes(`Tested merge source: \`${source}\``))
  assert.ok(summary.includes('**1 current-attempt** and **13 retained from earlier attempts**'))
  for (const accepted of receipt.jobs) {
    assert.ok(summary.includes(`| ${accepted.name} | ${accepted.attempt} |`))
    assert.ok(summary.includes(`/actions/runs/100/job/${accepted.jobId})`))
    assert.ok(summary.includes(`/actions/runs/100/artifacts/${accepted.artifactId})`))
  }
})

test('first-attempt summaries identify fresh jobs and unavailable summaries preserve verified receipts', async (t) => {
  const f = await fixture(t)
  f.snapshot.run.run_attempt = 1
  f.env.GITHUB_RUN_ATTEMPT = '1'
  f.env.GITHUB_STEP_SUMMARY = join(f.root, 'summary.md')
  for (const job of f.jobs) job.run_attempt = 1
  for (const reports of f.reports.values())
    for (const report of reports) report.mergeRetry.attempt = 1
  await f.pack()
  await acquireMergeEvidence({ directory: join(f.root, 'fresh'), output: join(f.root, 'fresh.json'), env: f.env, client: f.client })
  assert.ok((await readFile(f.env.GITHUB_STEP_SUMMARY, 'utf8')).includes('**14 current-attempt** and **0 retained from earlier attempts**'))
  f.env.GITHUB_STEP_SUMMARY = f.root
  const output = join(f.root, 'unavailable-summary.json')
  const receipt = await acquireMergeEvidence({ directory: join(f.root, 'unavailable-summary'), output, env: f.env, client: f.client })
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), receipt)
})

test('merge receipt rejects source, workflow, job, profile, runtime and immutable-input drift', async (t) => {
  const f = await fixture(t)
  const spec = MERGE_JOBS.find((item) => item.name === 'Build jig release candidate')
  const selected = latestJob(f.jobs, run, spec.name)
  const report = f.reports.get(spec.name)[0]
  const verify = (value) => verifyMergeReport(value, { snapshot: f.snapshot, spec, job: selected, workflowDigest })
  verify(report)
  for (const change of [
    { source: head }, { workflowDigest: 'c'.repeat(64) }, { runId: 101 }, { jobId: 900 },
    { name: 'other' }, { attempt: 2 }, { repository: 'other/repo' },
    { runtime: { ...runtime(spec.os), os: 'Windows' } },
    { runtime: { ...runtime(spec.os), architecture: 'ARM64' } },
    { runtime: { ...runtime(spec.os), image: 'ubuntu22' } },
    { runtime: { ...runtime(spec.os), node: 'v22.0.0' } },
    { inputs: [{ ...report.mergeRetry.inputs[0], artifactId: 999 }] },
    { inputs: [{ ...report.mergeRetry.inputs[0], artifactDigest: 'sha256:' + 'f'.repeat(64) }] },
  ]) assert.throws(() => verify({ ...report, mergeRetry: { ...report.mergeRetry, ...change } }))
  assert.throws(() => verify({ ...report, results: [{ ...report.results[0], profiles: ['agent'] }] }))
  assert.throws(() => verify({ ...report, results: [] }))
  f.artifacts[0].id = 999
  assert.throws(() => verify(report), /different input/)
})

test('runner image families and valid-but-wrong architectures refuse qualification', () => {
  for (const os of ['Linux', 'Windows', 'macOS']) {
    const spec = { os }, valid = runtime(os)
    validateMergeRuntime(spec, valid)
    assert.throws(() => validateMergeRuntime(spec, { ...valid, architecture: valid.architecture === 'X64' ? 'ARM64' : 'X64' }))
    assert.throws(() => validateMergeRuntime(spec, { ...valid, image: 'another-image' }))
    assert.throws(() => validateMergeRuntime(spec, { ...valid, imageVersion: '' }))
  }
})

test('a newer failed job or a rebuilt input cannot inherit an earlier successful report', async (t) => {
  const f = await fixture(t), spec = MERGE_JOBS[0]
  f.env.GITHUB_STEP_SUMMARY = join(f.root, 'summary.md')
  f.jobs.push(job(900, spec.name, 2, { conclusion: 'failure' }))
  await assert.rejects(acquireMergeEvidence({ directory: join(f.root, 'failed'), output: join(f.root, 'failed.json'), env: f.env, client: f.client }), /Latest merge job did not succeed/)
  await assert.rejects(readFile(f.env.GITHUB_STEP_SUMMARY), { code: 'ENOENT' })
  f.jobs.pop()
  f.jobs.push(job(901, 'candidate-build', 2))
  f.artifacts.push(artifact(902, 'candidates-' + source + '-r100-a2'))
  await assert.rejects(acquireMergeEvidence({ directory: join(f.root, 'rebuilt'), output: join(f.root, 'rebuilt.json'), env: f.env, client: f.client }), /different input/)
})

test('expired, cross-run and modified transport evidence cannot qualify', async (t) => {
  for (const kind of ['expired', 'foreign', 'transport']) {
    const f = await fixture(t), proof = f.artifacts.find((item) => item.name.startsWith('ci-evidence-'))
    if (kind === 'expired') proof.expired = true
    if (kind === 'foreign') proof.workflow_run.id = 200
    if (kind === 'transport') proof.digest = 'sha256:' + 'd'.repeat(64)
    await assert.rejects(acquireMergeEvidence({ directory: join(f.root, 'bad'), output: join(f.root, 'bad.json'), env: f.env, client: f.client }))
  }
})

test('missing reports, duplicate targets and run changes fail closed', async (t) => {
  for (const kind of ['missing', 'duplicate', 'race']) {
    const f = await fixture(t), spec = MERGE_JOBS.find((item) => item.stem === 'source')
    if (kind === 'missing') f.reports.get(spec.name).pop()
    if (kind === 'duplicate') f.reports.get(spec.name).push(f.reports.get(spec.name)[0])
    await f.pack()
    if (kind === 'race') {
      const download = f.client.download
      f.client.download = async (...args) => { await download(...args); f.snapshot.run.run_attempt = 3 }
    }
    await assert.rejects(acquireMergeEvidence({ directory: join(f.root, 'bad'), output: join(f.root, 'bad.json'), env: f.env, client: f.client }))
  }
})

test('main/manual publication and unrelated workflow identities cannot enter merge retry collection', async (t) => {
  const f = await fixture(t)
  for (const changed of [
    { GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_WORKFLOW_REF: repository + '/.github/workflows/npm-publish.yml@refs/heads/main' },
    { GITHUB_RUN_ID: '101' }, { GITHUB_RUN_ATTEMPT: '3' },
  ]) await assert.rejects(mergeContext({ env: { ...f.env, ...changed }, client: f.client }))
})

test('merge retry inventory matches every CI matrix row and leaves native/release strict', async () => {
  const workflow = parse(await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'))
  const names = []
  for (const [id, job] of Object.entries(workflow.jobs)) {
    if (['candidate-build', 'test'].includes(id)) continue
    const matrix = job.strategy?.matrix
    const rows = matrix?.include ?? matrix?.package?.map((name) => ({ package: name })) ?? [{}]
    for (const row of rows)
      names.push((job.name ?? id).replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, key) => row[key]))
    assert.ok(job.steps.some((step) => step.run?.includes('merge-retry.mjs record')))
    assert.equal(job.permissions?.actions ?? workflow.permissions.actions, 'read')
    assert.equal(job.permissions?.contents ?? workflow.permissions.contents, 'read')
  }
  assert.deepEqual(names.sort(), MERGE_JOBS.map((job) => job.name).sort())
  const collect = workflow.jobs.test.steps.find((step) => step.run?.includes('merge-retry.mjs collect'))
  assert.equal(collect.if, "github.event_name == 'pull_request'")
  const strict = workflow.jobs.test.steps.find((step) => step.uses?.startsWith('actions/download-artifact'))
  assert.equal(strict.if, "github.event_name != 'pull_request'")
  const readiness = await readFile(new URL('./release-readiness.mjs', import.meta.url), 'utf8')
  assert.match(readiness, /attempts\/\$\{run.run_attempt\}\/jobs/)
  assert.doesNotMatch(readiness, /merge-retry|merge-attempts/)
})

test('incomplete API pagination refuses partial job history', async () => {
  await assert.rejects(allRunJobs({ api: async () => ({ jobs: Array.from({ length: 100 }, () => ({})) }) }, repository, run), /pagination/)
})

test('workflow identity uses the exact Git blob across Windows checkout conversion', async (t) => {
  const repository = await mkdtemp(join(tmpdir(), 'jig-workflow-digest-'))
  t.after(() => rm(repository, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    timeout: 5000,
  }).trim()
  git('init', '--quiet')
  git('config', 'commit.gpgSign', 'false')
  git('config', 'core.hooksPath', join(repository, 'no-hooks'))
  const attributes = join(repository, 'empty-attributes')
  await writeFile(attributes, '')
  git('config', 'core.attributesFile', attributes)
  git('config', 'core.autocrlf', 'false')
  await mkdir(join(repository, '.github/workflows'), { recursive: true })
  const file = join(repository, '.github/workflows/ci.yml')
  const committed = 'name: CI\non:\n  pull_request: null\njobs: {}\n'
  await writeFile(file, committed)
  git('add', '.github/workflows/ci.yml')
  const commit = () => git('-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.test', 'commit', '--quiet', '-m', 'workflow')
  commit()
  const revision = git('rev-parse', 'HEAD')
  assert.equal(workflowSourceDigest(revision, repository), digest(committed))
  git('config', 'core.autocrlf', 'true')
  await rm(file)
  git('checkout', 'HEAD', '--', '.github/workflows/ci.yml')
  const checkout = await readFile(file, 'utf8')
  assert.equal(checkout, committed.replaceAll('\n', '\r\n'))
  assert.notEqual(digest(checkout), digest(committed))
  assert.equal(workflowSourceDigest(revision, repository), digest(committed))
  await writeFile(file, checkout.replace('name: CI', 'name: changed'))
  git('add', '.github/workflows/ci.yml')
  commit()
  const changed = git('rev-parse', 'HEAD')
  assert.notEqual(workflowSourceDigest(changed, repository), workflowSourceDigest(revision, repository))
  assert.equal(workflowSourceDigest(revision, repository), digest(committed))
  assert.throws(() => workflowSourceDigest('not-a-revision', repository))
})

test('collection refuses a platform-dependent workflow hash and names its exact owner and field', async (t) => {
  const f = await fixture(t)
  const name = 'Python 3.13 on windows-2022'
  const report = f.reports.get(name)[0]
  const bytes = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  report.mergeRetry.workflowDigest = digest(bytes.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'))
  assert.notEqual(report.mergeRetry.workflowDigest, workflowDigest)
  await f.pack()
  await assert.rejects(acquireMergeEvidence({
    directory: join(f.root, 'windows-worktree-hash'),
    output: join(f.root, 'bad.json'),
    env: f.env,
    client: f.client,
  }), /Python 3\.13 on windows-2022: workflowDigest/)
  report.mergeRetry.workflowDigest = workflowSourceDigest(source)
  await f.pack()
  const receipt = await acquireMergeEvidence({
    directory: join(f.root, 'git-blob-hash'),
    output: join(f.root, 'good.json'),
    env: f.env,
    client: f.client,
  })
  assert.equal(receipt.jobs.length, MERGE_JOBS.length)
})
