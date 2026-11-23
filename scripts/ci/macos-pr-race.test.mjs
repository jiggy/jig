import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { digest } from './candidate-provenance.mjs'
import { readGitHubApiJson } from './github-read.mjs'
import {
  bindMacDecisionPreparation,
  chooseMacOffer,
  DECISION_UPLOAD_STEP_NAME,
  decisionName,
  NOOP_STEP_NAMES,
  offerName,
  readMacDecisionArtifact,
  readMacOfferArtifact,
  retainedMacPrDecision,
  SELECT_STEP_NAME,
  selectMacPrDecisions,
  selectorJobName,
  validateMacDecision,
  validateMacReady,
  WATCH_STEP_NAME,
} from './macos-pr-race.mjs'
import { macJobName } from './macos-qualification.mjs'

const source = 'a'.repeat(40)
const context = {
  repository: 'jiggy/jig',
  source,
  headSha: 'b'.repeat(40),
  runId: 50,
  attempt: 1,
  preparedArtifactId: 12,
  planSha256: 'c'.repeat(64),
}
const ready = {
  version: 1,
  repository: context.repository,
  source,
  runId: 50,
  attempt: 1,
  shard: 0,
  major: 15,
  jobId: 150,
  preparedArtifactId: 12,
  planSha256: context.planSha256,
}
const now = Date.parse('2026-11-17T12:10:00Z')
const stamp = (seconds) =>
  `2026-11-17T12:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}Z`
function step(name, number, start = 70, end = 80, conclusion = 'success') {
  return {
    name,
    number,
    status: end === null ? 'in_progress' : 'completed',
    conclusion: end === null ? null : conclusion,
    started_at: start === null ? null : stamp(start),
    completed_at: end === null ? null : stamp(end),
  }
}
function job(major = 15, attempt = 1, patch = {}) {
  return {
    id: major * 10 + attempt - 1,
    name: macJobName(major, 0),
    run_id: 50,
    run_attempt: attempt,
    head_sha: context.headSha,
    status: 'in_progress',
    conclusion: null,
    runner_id: major,
    runner_name: `runner-${major}`,
    labels: [`macos-${major}`],
    created_at: stamp(0),
    started_at: stamp(60),
    completed_at: null,
    steps: [step('Publish PR worker readiness', 1, 70, 80)],
    ...patch,
  }
}
function selector(attempt = 1, patch = {}) {
  return {
    ...job(15, attempt),
    id: 500 + attempt,
    name: selectorJobName(0),
    labels: ['ubuntu-24.04'],
    steps: [step(SELECT_STEP_NAME, 1, 125, 130), step(DECISION_UPLOAD_STEP_NAME, 2, 131, null)],
    ...patch,
  }
}
function success(input) {
  return {
    ...input,
    status: 'completed',
    conclusion: 'success',
    completed_at: stamp(300),
    steps: input.steps.map((s) =>
      s.status === 'in_progress'
        ? { ...s, status: 'completed', conclusion: 'success', completed_at: stamp(140) }
        : s,
    ),
  }
}
function macNoop(major, attempt) {
  return success(
    job(major, attempt, {
      steps: [
        step('Decide PR shard contention', 1),
        ...NOOP_STEP_NAMES.map((name, index) => step(name, index + 2, null, null, 'skipped')).map(
          (s) => ({ ...s, status: 'completed', conclusion: 'skipped' }),
        ),
      ],
    }),
  )
}
function selectorNoop(attempt) {
  return success(
    selector(attempt, {
      steps: [
        step(SELECT_STEP_NAME, 1),
        ...[DECISION_UPLOAD_STEP_NAME, WATCH_STEP_NAME].map((name, index) => ({
          ...step(name, index + 2, null, null),
          status: 'completed',
          conclusion: 'skipped',
        })),
      ],
    }),
  )
}
async function store(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-mac-decision-test-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const records = new Map()
  let nextId = 90
  const client = {
    api: async (path) => {
      const id = Number(path.split('/').at(-1))
      if (!records.has(id)) throw Error('missing artifact metadata')
      return records.get(id).artifact
    },
    download: async (id, destination) => {
      if (!records.has(id)) throw Error('missing artifact bytes')
      await writeFile(destination, records.get(id).bytes, { flag: 'wx' })
    },
  }
  const add = async (value, file, name, created = stamp(120), entries) => {
    const id = nextId++,
      archive = join(temporary, `${id}.zip`)
    execFileSync('python3', [
      '-c',
      "import sys,zipfile,json\nwith zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_DEFLATED) as z:\n for name,value in json.loads(sys.argv[2]):z.writestr(name,value)\n",
      archive,
      JSON.stringify(entries ?? [[file, JSON.stringify(value)]]),
    ])
    const bytes = await readFile(archive),
      artifact = {
        id,
        name,
        digest: `sha256:${digest(bytes)}`,
        size_in_bytes: bytes.length,
        expired: false,
        created_at: created,
        expires_at: '2026-11-18T12:00:00Z',
        workflow_run: { id: 50, head_sha: context.headSha },
      }
    records.set(id, { artifact, bytes })
    return artifact
  }
  const offer = (value = ready, options = {}) =>
    add(value, 'READY.json', offerName(value), options.created, options.entries)
  const decision = async (value = ready, options = {}) => {
    const offerArtifact = options.offerArtifact ?? (await offer(value))
    const body = {
      ...value,
      selectorJobId: 501 + value.attempt - 1,
      offerArtifactId: offerArtifact.id,
      offerArtifactDigest: offerArtifact.digest,
      ...options.patch,
    }
    const artifact = await add(
      body,
      'DECISION.json',
      decisionName(value),
      stamp(132),
      options.entries,
    )
    return { decision: body, artifact, offerArtifact }
  }
  return { client, offer, decision, records }
}

test('readiness and decisions use distinct role-bound names and exact schemas', () => {
  assert.equal(offerName(ready), `macos-pr-offer-15-0-${source}-r50-a1`)
  assert.equal(decisionName(ready), `macos-pr-decision-0-${source}-r50-a1`)
  assert.equal(validateMacReady(ready, context), ready)
  for (const patch of [{ source: 'bad' }, { runId: 0 }, { attempt: 0 }, { shard: 8 }])
    assert.throws(() => decisionName({ ...ready, ...patch }))
  for (const patch of [
    { version: 2 },
    { extra: true },
    { major: 14 },
    { jobId: 0 },
    { preparedArtifactId: 99 },
    { planSha256: 'd'.repeat(64) },
    { attempt: 2 },
  ])
    assert.throws(() => validateMacReady({ ...ready, ...patch }, context))
  assert.throws(() => validateMacDecision(ready, context))
})

test('actual concurrent distinct offer ZIPs produce one sole-selector decision for both Mac candidates', async (t) => {
  const s = await store(t),
    other = { ...ready, major: 26, jobId: 260 }
  const offers = await Promise.all([s.offer(ready), s.offer(other, { created: stamp(121) })])
  const jobs = [job(), job(26), selector()]
  const chosen = await chooseMacOffer(
    s.client,
    { ...context, shard: 0 },
    { jobs, artifacts: offers, now },
  )
  assert.equal(chosen.ready.jobId, 150)
  const result = await s.decision(chosen.ready, { offerArtifact: chosen.artifact })
  const readers = await Promise.all(
    [15, 26].map(() => readMacDecisionArtifact(s.client, result.artifact, context, { jobs, now })),
  )
  assert.deepEqual(
    readers.map((row) => row.decision.jobId),
    [150, 150],
  )
  assert.deepEqual(
    [150, 260].map((id) => readers[0].decision.jobId === id),
    [true, false],
  )
  assert.equal(readers[0].selectorJob.id, 501)
})

test('duplicate offers or duplicate sole-selector decisions fail closed without artifact-name atomicity assumptions', async (t) => {
  const s = await store(t),
    offer = await s.offer()
  await assert.rejects(
    chooseMacOffer(
      s.client,
      { ...context, shard: 0 },
      { jobs: [job()], artifacts: [offer, { ...offer, id: 999 }], now },
    ),
    /Ambiguous/,
  )
  const decision = await s.decision(ready, { offerArtifact: offer })
  const row = await readMacDecisionArtifact(s.client, decision.artifact, context, {
    jobs: [success(job()), success(selector())],
    now,
  })
  assert.throws(
    () =>
      selectMacPrDecisions({
        decisions: [row, row],
        jobs: [success(job()), success(selector())],
        context,
        shards: [0],
      }),
    /Ambiguous/,
  )
})

test('sole-selector identity, successful select, upload phase and referenced offer are mandatory', async (t) => {
  const s = await store(t),
    result = await s.decision()
  for (const changed of [
    selector(1, { labels: ['ubuntu-22.04'] }),
    selector(1, { name: selectorJobName(1) }),
    selector(1, { runner_id: 0 }),
    selector(1, { run_attempt: 2 }),
    selector(1, {
      steps: [
        step(SELECT_STEP_NAME, 1, 125, 130, 'failure'),
        step(DECISION_UPLOAD_STEP_NAME, 2, 131, null),
      ],
    }),
    selector(1, {
      steps: [
        step(SELECT_STEP_NAME, 1, 125, 130),
        step(DECISION_UPLOAD_STEP_NAME, 2, 131, 140, 'failure'),
      ],
    }),
  ])
    await assert.rejects(
      readMacDecisionArtifact(s.client, result.artifact, context, { jobs: [job(), changed], now }),
    )
  const pendingSelector = selector(1, { steps: [step(SELECT_STEP_NAME, 1, 125, null)] })
  await assert.rejects(
    readMacDecisionArtifact(s.client, result.artifact, context, {
      jobs: [job(), pendingSelector],
      now,
    }),
    { code: 'MAC_RACE_PENDING' },
  )
  const mismatched = await s.decision(ready, {
    patch: { offerArtifactDigest: `sha256:${'d'.repeat(64)}` },
  })
  await assert.rejects(
    readMacDecisionArtifact(s.client, mismatched.artifact, context, {
      jobs: [job(), selector()],
      now,
    }),
    /changed readiness/,
  )
  const otherOffer = await s.offer({ ...ready, major: 26, jobId: 260 })
  const wrong = await s.decision(ready, { offerArtifact: otherOffer })
  await assert.rejects(
    readMacDecisionArtifact(s.client, wrong.artifact, context, {
      jobs: [job(), job(26), selector()],
      now,
    }),
    /does not match/,
  )
})

test('transport, expired metadata, foreign inputs, oversized expansion and unsafe ZIP paths refuse', async (t) => {
  const s = await store(t),
    artifact = await s.offer()
  for (const patch of [
    { expired: true },
    { digest: 'bad' },
    { size_in_bytes: 16385 },
    { workflow_run: { id: 51, head_sha: context.headSha } },
    { created_at: stamp(30) },
  ])
    await assert.rejects(
      readMacOfferArtifact(s.client, { ...artifact, ...patch }, context, { jobs: [job()], now }),
    )
  await assert.rejects(
    readMacOfferArtifact(
      {
        ...s.client,
        download: async () => {
          throw Error('transport unavailable')
        },
      },
      artifact,
      context,
      { jobs: [job()], now },
    ),
    /transport unavailable/,
  )
  await assert.rejects(
    readMacOfferArtifact(
      { ...s.client, download: async (_id, path) => writeFile(path, 'changed') },
      artifact,
      context,
      { jobs: [job()], now },
    ),
    /transport digest/,
  )
  for (const entries of [
    [['READY.json', ' '.repeat(4097)]],
    [['../READY.json', JSON.stringify(ready)]],
    [
      ['READY.json', JSON.stringify(ready)],
      ['extra', 'bad'],
    ],
  ]) {
    const bad = await s.offer(ready, { entries })
    await assert.rejects(readMacOfferArtifact(s.client, bad, context, { jobs: [job()], now }))
  }
  await assert.rejects(
    readMacOfferArtifact(
      s.client,
      artifact,
      { ...context, preparedArtifactId: 99 },
      { jobs: [job()], now },
    ),
    /identity mismatch/,
  )
})

test('a fixed failed Mac never hands off to the other ready candidate', async (t) => {
  const s = await store(t),
    result = await s.decision(),
    loser = await s.offer({ ...ready, major: 26, jobId: 260 })
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    const failed = { ...success(job()), conclusion },
      jobs = [failed, job(26), success(selector())]
    const row = await readMacDecisionArtifact(s.client, result.artifact, context, { jobs, now })
    assert.equal(row.decision.jobId, 150)
    assert.throws(
      () => selectMacPrDecisions({ decisions: [row], jobs, context, shards: [0] }),
      /fixed Mac worker did not succeed/,
    )
    assert.equal(loser.name, offerName({ ...ready, major: 26 }))
  }
})

test('collector waits raw winner and selector outcomes; failed selector cannot inherit green', async (t) => {
  const s = await store(t),
    result = await s.decision()
  const jobs = [success(job()), selector()]
  const row = await readMacDecisionArtifact(s.client, result.artifact, context, { jobs, now })
  assert.throws(() => selectMacPrDecisions({ decisions: [row], jobs, context, shards: [0] }), {
    code: 'MAC_RACE_PENDING',
  })
  assert.throws(
    () =>
      selectMacPrDecisions({
        decisions: [row],
        jobs: [job(), success(selector())],
        context,
        shards: [0],
      }),
    { code: 'MAC_RACE_PENDING' },
  )
  assert.throws(
    () =>
      selectMacPrDecisions({
        decisions: [row],
        jobs: [success(job()), { ...success(selector()), conclusion: 'failure' }],
        context,
        shards: [0],
      }),
    /selector did not succeed/,
  )
  assert.equal(
    selectMacPrDecisions({
      decisions: [row],
      jobs: [success(job()), success(selector())],
      context,
      shards: [0],
    })[0].job.id,
    150,
  )
})

test('explicit completed Mac noops retain old success; later actual work or failure cannot', async (t) => {
  const s = await store(t),
    result = await s.decision(),
    jobs = [success(job()), success(selector())]
  const row = await readMacDecisionArtifact(s.client, result.artifact, context, { jobs, now }),
    next = { ...context, attempt: 2 }
  const retained = [...jobs, macNoop(15, 2), macNoop(26, 2)]
  assert.equal(
    selectMacPrDecisions({ decisions: [row], jobs: retained, context: next, shards: [0] })[0].job
      .id,
    150,
  )
  for (const bad of [{ ...macNoop(26, 2), conclusion: 'failure' }, success(job(26, 2))])
    assert.throws(
      () =>
        selectMacPrDecisions({
          decisions: [row],
          jobs: [...jobs, bad],
          context: next,
          shards: [0],
        }),
      /replacement decision or verified noop/,
    )
  assert.throws(
    () =>
      selectMacPrDecisions({
        decisions: [row],
        jobs: [...jobs, job(26, 2)],
        context: next,
        shards: [0],
      }),
    { code: 'MAC_RACE_PENDING' },
  )
})

test('a later verified selector retention noop can repair original watch failure after green Mac', async (t) => {
  const s = await store(t),
    result = await s.decision(),
    failedSelector = { ...success(selector()), conclusion: 'failure' }
  const jobs = [success(job()), failedSelector]
  const row = await readMacDecisionArtifact(s.client, result.artifact, context, { jobs, now })
  const retained = await retainedMacPrDecision(
    s.client,
    { ...context, attempt: 2, shard: 0 },
    { jobs, artifacts: [result.artifact], now },
  )
  assert.equal(retained.decision.jobId, 150)
  const selected = selectMacPrDecisions({
    decisions: [row],
    jobs: [...jobs, selectorNoop(2)],
    context: { ...context, attempt: 2 },
    shards: [0],
  })[0]
  assert.equal(selected.selectorJob.id, 502)
  assert.equal(selected.decisionSelectorJob.id, 501)
  assert.throws(() =>
    selectMacPrDecisions({
      decisions: [row],
      jobs: [...jobs, { ...selectorNoop(2), conclusion: 'failure' }],
      context: { ...context, attempt: 2 },
      shards: [0],
    }),
  )
})

test('new preparation requires fresh offers and decisions without downloading old input proof', async (t) => {
  const s = await store(t),
    result = await s.decision(),
    fresh = { ...context, attempt: 2, minimumDecisionAttempt: 2, shard: 0, preparedArtifactId: 99 }
  assert.equal(
    await retainedMacPrDecision(
      {
        download: async () => {
          throw Error('old proof downloaded')
        },
      },
      fresh,
      { jobs: [success(job()), success(selector())], artifacts: [result.artifact], now },
    ),
    undefined,
  )
  assert.throws(
    () =>
      selectMacPrDecisions({
        decisions: [],
        jobs: [success(job()), macNoop(26, 1)],
        context: fresh,
        shards: [0],
      }),
    { code: 'MAC_RACE_PENDING' },
  )
  await assert.rejects(
    readMacDecisionArtifact(s.client, result.artifact, fresh, { jobs: [job(), selector()], now }),
    /attempt mismatch/,
  )
  const current = { ...ready, attempt: 2, jobId: 151, preparedArtifactId: 99 }
  const next = await s.decision(current)
  const jobs = [success(job(15, 2)), success(selector(2))]
  const row = await readMacDecisionArtifact(s.client, next.artifact, fresh, { jobs, now })
  assert.equal(
    selectMacPrDecisions({ decisions: [row], jobs, context: fresh, shards: [0] })[0].decision
      .preparedArtifactId,
    99,
  )
  for (const minimumDecisionAttempt of [0, -1, 1.5, 3])
    assert.throws(() => validateMacReady(current, { ...fresh, minimumDecisionAttempt }), /context/)
})

test('prepared input identity derives from the latest actual successful producer', async (t) => {
  const s = await store(t),
    artifact = await s.offer(),
    run = { id: 50, run_attempt: 2, head_sha: context.headSha }
  const producer = { ...success(job()), id: 900, name: 'Prepare Mac inputs' }
  const prepared = { ...artifact, id: 12, name: `macos-host-artifacts-${source}-r50-a1` }
  assert.equal(
    bindMacDecisionPreparation({
      jobs: [producer],
      artifacts: [prepared],
      run,
      context: { ...context, attempt: 2 },
      now,
    }).minimumDecisionAttempt,
    1,
  )
  const newer = { ...producer, id: 901, run_attempt: 2 },
    fresh = { ...prepared, id: 99, name: `macos-host-artifacts-${source}-r50-a2` }
  assert.equal(
    bindMacDecisionPreparation({
      jobs: [producer, newer],
      artifacts: [fresh],
      run,
      context: { ...context, attempt: 2, preparedArtifactId: 99 },
      now,
    }).minimumDecisionAttempt,
    2,
  )
  assert.throws(
    () =>
      bindMacDecisionPreparation({
        jobs: [producer, newer],
        artifacts: [prepared, fresh],
        run,
        context: { ...context, attempt: 2 },
        now,
      }),
    /exact current prepared/,
  )
})

test('incomplete candidate registration remains pending; terminal missing decisions refuse', () => {
  for (const jobs of [[], [success(job())], [job(), success(job(26))]])
    assert.throws(() => selectMacPrDecisions({ decisions: [], jobs, context, shards: [0] }), {
      code: 'MAC_RACE_PENDING',
    })
  assert.throws(
    () =>
      selectMacPrDecisions({
        decisions: [],
        jobs: [success(job()), success(job(26))],
        context,
        shards: [0],
      }),
    /no immutable selector decision/,
  )
})

test('raw failed steps cannot be hidden beneath successful Mac or selector job conclusions', async (t) => {
  const s = await store(t),
    result = await s.decision()
  const goodMac = success(job()),
    goodSelector = success(selector())
  const row = await readMacDecisionArtifact(s.client, result.artifact, context, {
    jobs: [goodMac, goodSelector],
    now,
  })
  for (const jobs of [
    [
      { ...goodMac, steps: goodMac.steps.map((step) => ({ ...step, conclusion: 'failure' })) },
      goodSelector,
    ],
    [
      goodMac,
      {
        ...goodSelector,
        steps: [...goodSelector.steps, step('Watch selected PR worker', 3, 150, 160, 'failure')],
      },
    ],
  ])
    assert.throws(
      () => selectMacPrDecisions({ decisions: [row], jobs, context, shards: [0] }),
      /did not succeed/,
    )
})

test('selectors stop promptly only after every current platform candidate is authoritatively terminal', async () => {
  const unassigned = (major, attempt = 1) => ({
    ...job(major, attempt),
    status: 'completed',
    conclusion: 'failure',
    runner_id: 0,
    runner_name: '',
    steps: [],
    started_at: null,
    completed_at: stamp(300),
  })
  const options = { artifacts: [], now }
  await assert.rejects(
    chooseMacOffer(
      {},
      { ...context, shard: 0 },
      {
        ...options,
        jobs: [unassigned(15), unassigned(26)],
      },
    ),
    /All current Mac candidates completed/,
  )
  for (const jobs of [[unassigned(15)], [unassigned(15, 2), unassigned(26)]]) {
    const attempt = Math.max(...jobs.map((job) => job.run_attempt))
    await assert.rejects(
      chooseMacOffer(
        {},
        { ...context, attempt, shard: 0 },
        {
          ...options,
          jobs,
        },
      ),
      { code: 'MAC_RACE_PENDING' },
    )
  }
  const originals = [success(job()), success(job(26))]
  const copies = originals.map((job) => ({
    ...job,
    id: job.id + 1000,
    run_attempt: 2,
    created_at: stamp(400),
  }))
  await assert.rejects(
    chooseMacOffer(
      {},
      { ...context, attempt: 2, shard: 0 },
      {
        ...options,
        jobs: [...originals, ...copies],
      },
    ),
    /All current Mac candidates completed/,
  )
  await assert.rejects(
    chooseMacOffer(
      {},
      { ...context, shard: 0 },
      {
        ...options,
        jobs: [unassigned(15), { ...unassigned(26), head_sha: source }],
      },
    ),
    /identity mismatch/,
  )
})

test('a live verified readiness offer is selected without waiting for the other platform outcome', async (t) => {
  const s = await store(t),
    artifact = await s.offer()
  const row = await chooseMacOffer(
    s.client,
    { ...context, shard: 0 },
    {
      jobs: [job(), { ...success(job(26)), conclusion: 'failure' }],
      artifacts: [artifact],
      now,
    },
  )
  assert.equal(row.ready.jobId, 150)
})

function githubReadError(status) {
  return Object.assign(new Error(`gh: read failed (HTTP ${status})`), {
    stderr: Buffer.from(`gh: read failed (HTTP ${status})`),
  })
}

test('a listed immutable artifact with a transient archive404 remains pending then validates real bytes', async (t) => {
  const s = await store(t),
    artifact = await s.offer()
  let downloads = 0
  const delayed = {
    ...s.client,
    download: async (...args) => {
      if (downloads++ === 0) throw githubReadError(404)
      return s.client.download(...args)
    },
  }
  await assert.rejects(readMacOfferArtifact(delayed, artifact, context, { jobs: [job()], now }), {
    code: 'MAC_RACE_PENDING',
  })
  const row = await readMacOfferArtifact(delayed, artifact, context, { jobs: [job()], now })
  assert.equal(row.ready.jobId, 150)
  assert.equal(downloads, 2)
  for (const error of [
    githubReadError(503),
    Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
  ])
    await assert.rejects(
      readMacOfferArtifact(
        {
          ...s.client,
          download: async () => {
            throw error
          },
        },
        artifact,
        context,
        { jobs: [job()], now },
      ),
      { code: 'MAC_RACE_PENDING' },
    )
  for (const status of [401, 403])
    await assert.rejects(
      readMacOfferArtifact(
        {
          ...s.client,
          download: async () => {
            throw githubReadError(status)
          },
        },
        artifact,
        context,
        { jobs: [job()], now },
      ),
      (error) => error.code !== 'MAC_RACE_PENDING',
    )
})

test('referenced readiness metadata404 is pending but authorization and malformed evidence stay fatal', async (t) => {
  const s = await store(t),
    result = await s.decision(),
    jobs = [job(), selector()]
  let reads = 0
  const delayed = {
    ...s.client,
    api: async (...args) => {
      if (reads++ === 0) throw githubReadError(404)
      return s.client.api(...args)
    },
  }
  await assert.rejects(readMacDecisionArtifact(delayed, result.artifact, context, { jobs, now }), {
    code: 'MAC_RACE_PENDING',
  })
  assert.equal(
    (await readMacDecisionArtifact(delayed, result.artifact, context, { jobs, now })).decision
      .jobId,
    150,
  )
  await assert.rejects(
    readMacDecisionArtifact(
      {
        ...s.client,
        api: async () => {
          throw githubReadError(403)
        },
      },
      result.artifact,
      context,
      { jobs, now },
    ),
    (error) => error.code !== 'MAC_RACE_PENDING',
  )
  await assert.rejects(
    readMacDecisionArtifact({ ...s.client, api: async () => ({}) }, result.artifact, context, {
      jobs,
      now,
    }),
    /changed readiness/,
  )
  let downloads = 0
  await assert.rejects(
    readMacOfferArtifact(
      {
        ...s.client,
        download: async () => {
          downloads++
          throw githubReadError(404)
        },
      },
      { ...result.offerArtifact, expired: true },
      context,
      { jobs, now },
    ),
    (error) => error.code !== 'MAC_RACE_PENDING',
  )
  assert.equal(downloads, 0)
  const malformed = await s.offer(ready, { entries: [['READY.json', '{']] })
  await assert.rejects(
    readMacOfferArtifact(s.client, malformed, context, { jobs, now }),
    (error) => error instanceof SyntaxError && error.code !== 'MAC_RACE_PENDING',
  )
  await assert.rejects(
    readMacOfferArtifact(
      { ...s.client, download: async (_id, path) => writeFile(path, 'forged') },
      result.offerArtifact,
      context,
      { jobs, now },
    ),
    /transport digest/,
  )
})

test('API JSON reads retry only known transient transport,5xx or truncated API responses with a three-read bound', async () => {
  const backoffs = []
  let calls = 0
  assert.deepEqual(
    await readGitHubApiJson(
      async () => {
        calls++
        if (calls === 1) throw githubReadError(502)
        if (calls === 2) return '{"jobs":['
        return '{"jobs":[]}'
      },
      { sleep: async (ms) => backoffs.push(ms) },
    ),
    { jobs: [] },
  )
  assert.equal(calls, 3)
  assert.deepEqual(backoffs, [1000, 1000])
  for (const error of [
    githubReadError(401),
    githubReadError(403),
    new Error('identity mismatch'),
  ]) {
    let calls = 0
    await assert.rejects(
      readGitHubApiJson(
        async () => {
          calls++
          throw error
        },
        { sleep: async () => assert.fail('fatal error must not back off') },
      ),
    )
    assert.equal(calls, 1)
  }
  calls = 0
  await assert.rejects(
    readGitHubApiJson(
      async () => {
        calls++
        throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
      },
      { sleep: async () => {} },
    ),
    /timed out/,
  )
  assert.equal(calls, 3)
  calls = 0
  await assert.rejects(
    readGitHubApiJson(
      async () => {
        calls++
        return '{bad json} '
      },
      { sleep: async () => assert.fail('malformed API JSON must not back off') },
    ),
    SyntaxError,
  )
  assert.equal(calls, 1)
  calls = 0
  await assert.rejects(
    readGitHubApiJson(
      async () => {
        calls++
        return '{"jobs":['
      },
      { sleep: async () => {} },
    ),
    SyntaxError,
  )
  assert.equal(calls, 3)
})

test('selection tries another readable live offer after archive visibility is pending, but never after invalid evidence', async (t) => {
  const s = await store(t)
  const first = await s.offer()
  const second = await s.offer({ ...ready, major: 26, jobId: 260 }, { created: stamp(121) })
  const delayed = {
    ...s.client,
    download: async (id, path) => {
      if (id === first.id) throw githubReadError(404)
      return s.client.download(id, path)
    },
  }
  const options = { jobs: [job(), job(26)], artifacts: [first, second], now }
  const selected = await chooseMacOffer(delayed, { ...context, shard: 0 }, options)
  assert.equal(selected.ready.jobId, 260)
  await assert.rejects(
    chooseMacOffer(
      s.client,
      { ...context, shard: 0 },
      {
        ...options,
        artifacts: [{ ...first, digest: `sha256:${'d'.repeat(64)}` }, second],
      },
    ),
    /transport digest/,
  )
})
