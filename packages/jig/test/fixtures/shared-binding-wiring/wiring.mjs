import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createAttemptClient } from '@jigging/jig/client'

const fixture = fileURLToPath(new URL('project/', import.meta.url))
const jig = fileURLToPath(new URL('node_modules/.bin/jig', import.meta.url))
const digestPattern = /^sha256:[0-9a-f]{64}$/
const env = { NO_COLOR: '1' }
for (const key of [
  'PATH',
  'HOME',
  'TMPDIR',
  'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS',
  'JIG_AUTHORING_NODE_PATH',
  'JIG_BWRAP_PATH',
  'AGENT_DELEGATED_CGROUP',
]) {
  if (process.env[key] !== undefined) env[key] = process.env[key]
}

async function scenario(label, run) {
  const keep = process.env.JIG_WIRING_EVIDENCE_DIRECTORY
  const root = await mkdtemp(join(await realpath(keep ?? tmpdir()), `jig-wiring-${label}-`))
  const cwd = join(root, 'project')
  let passed = false
  try {
    await mkdir(cwd)
    for (const path of ['package.json', 'jig.ts', 'bindings', 'flows']) {
      await cp(join(fixture, path), join(cwd, path), { recursive: true })
    }
    await command(root, cwd, 'install', 'bun', ['install', '--lockfile-only', '--ignore-scripts'])
    const client = createAttemptClient({ executable: jig, cwd, env, timeoutMs: 150_000 })
    await run({ root, cwd, client, runIds: new Set() })
    passed = true
  } finally {
    if (passed && !keep) await rm(root, { recursive: true, force: true })
    else console.error(`Wiring evidence retained at ${root}`)
  }
}

async function command(root, cwd, label, executable, args, diagnostic) {
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 150_000,
    maxBuffer: 1024 * 1024,
    killSignal: 'SIGINT',
  })
  await save(root, label, {
    command: [executable, ...args],
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  })
  if (result.error) throw result.error
  assert.equal(
    result.status,
    diagnostic === undefined ? 0 : 1,
    `${label}: ${result.stderr}\n${result.stdout}`,
  )
  if (diagnostic !== undefined) {
    assert.equal(result.stdout, '')
    assert.match(result.stderr, diagnostic)
  }
  return result.stdout
}

async function save(root, label, record) {
  await writeFile(join(root, `${label}.json`), `${JSON.stringify(record, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
}

const shared = 'binding:shared-producer'
const dedicated = 'binding:offer-producer'
const direct = 'flow:flows/producer'
const standard = 'binding:standard'
const specialist = 'binding:specialist'

async function review({ root, cwd, client }, stage, offerProducer, sharedPostEdit) {
  const lock = await readFile(join(cwd, 'bun.lock'))
  await command(root, cwd, `${stage}-review`, jig, ['review', '--yes'])
  assert.deepEqual(await readFile(join(cwd, 'bun.lock')), lock)

  const inventory = await client.inspect()
  await save(root, `${stage}-inventory`, inventory)
  const { approval } = inventory
  assert.match(approval, digestPattern)
  const targets = ['binding:book', 'binding:offer', shared, direct, standard, specialist]
  if (offerProducer === dedicated) targets.push(dedicated)
  assert.deepEqual(inventory.targets.map(({ target }) => target).sort(), targets.sort())
  const inspected = Object.fromEntries(
    await Promise.all(
      targets.map(async (id) => {
        const facts = await client.inspect({ target: id })
        assert.equal(facts.approval, approval)
        assert.equal(facts.target, id)
        assert.equal(facts.availability.state, 'ready', id)
        return [id, facts]
      }),
    ),
  )
  await save(root, `${stage}-routes`, inspected)

  function routes(id, expected) {
    const actual = Object.fromEntries(
      Object.entries(inspected[id].slots).map(([slot, route]) => {
        assert.equal(route.kind, 'flow')
        assert.equal(route.target.kind, 'binding')
        return [slot, `binding:${route.target.id}`]
      }),
    )
    assert.deepEqual(actual, expected, id)
  }

  for (const [caller, producer] of [
    ['binding:book', shared],
    ['binding:offer', offerProducer],
  ]) {
    routes(caller, { producer })
    assert.equal(inspected[caller].slots.producer.attachments.review.create, true)
  }
  routes(shared, { 'post-edit': sharedPostEdit, review: standard })
  routes(direct, { 'post-edit': standard, review: standard })
  const implementation = inspected[direct].digest
  assert.match(implementation, digestPattern)
  assert.equal(inspected[shared].digest, implementation)
  for (const [id, policy, minimumWords] of [
    [standard, 'standard', 1],
    [specialist, 'specialist', 2],
  ]) {
    assert.deepEqual({ ...inspected[id].settings }, { policy, minimumWords })
  }
  if (offerProducer === dedicated) {
    routes(dedicated, { 'post-edit': specialist, review: standard })
    assert.equal(inspected[dedicated].digest, implementation)
  }
  return { approval, implementation }
}

const row = (scope, purpose, text, words, review = 'standard', decision = 'accept') => ({
  scope,
  purpose,
  text,
  words,
  review,
  decision,
})

function expectedReviews(mode, postEdit) {
  const whole = row('book', 'post-edit', 'Complete manuscript', 2)
  return mode === 'fresh'
    ? [
        row('chapter', 'developmental', 'Introduction', 1),
        row('chapter', 'post-edit', 'Chapter One', 2, postEdit),
        whole,
      ]
    : [
        row(
          'chapter',
          'post-edit',
          'Epilogue',
          1,
          postEdit,
          postEdit === 'specialist' ? 'revise' : 'accept',
        ),
        whole,
      ]
}

function verifyReviews(observed, mode, postEdit) {
  assert.deepEqual(observed, expectedReviews(mode, postEdit), `${mode} reviewer handoffs`)
}

async function run({ root, client, runIds }, admission, stage, target, mode, caller) {
  const label = `${stage}-${target.split(':').at(-1).split('/').at(-1)}-${mode}`
  const { approval } = admission
  const result = await client.run(
    {
      expectedApproval: approval,
      target,
      input: mode,
      files: [],
      constraints: { durationMs: 120_000, resultBytes: 65_536, artifactBytes: 1_048_576 },
      outputIntent: { packet: true, receive: ['review'] },
    },
    {
      persist: (prepared) => save(root, `${label}-prepared`, prepared),
    },
  )
  const { prepared, receipt, observation } = result
  await save(root, `${label}-settlement`, { receipt, observation })
  assert.equal(result.role, 'owner')
  assert.equal(receipt.target, target)
  assert.equal(receipt.approval, approval)
  assert.equal(receipt.requestDigest, prepared.requestDigest)
  assert.match(receipt.runId, digestPattern)
  assert.equal(runIds.has(receipt.runId), false)
  runIds.add(receipt.runId)
  assert.equal(observation?.identity, 'accepted')
  assert.equal(observation.dispatch, 'confirmed')
  assert.equal(observation.cleanup, 'confirmed')
  assert.equal(observation.receipt.runId, receipt.runId)
  assert.equal(observation.terminal.status, 'succeeded')
  assert.equal(observation.terminal.outcome, 'done')
  assert.match(observation.terminal.resultDigest, digestPattern)

  const retained = await client.result({ ticket: prepared.ticket })
  await save(root, `${label}-retained`, retained)
  assert.equal(retained.observation.receipt.runId, receipt.runId)
  assert.equal(retained.observation.cleanup, 'confirmed')
  assert.equal(retained.observation.retained, 'available')
  assert.deepEqual(retained.observation.terminal, observation.terminal)
  assert.equal(retained.artifactResults.length, 1)
  const [artifact] = retained.artifactResults
  assert.equal(artifact.name, 'review')
  assert.equal(artifact.availability, 'available')
  assert.match(artifact.manifestDigest, digestPattern)

  const destination = join(root, `${label}-packet`)
  const exported = await client.export({
    ticket: prepared.ticket,
    destination,
    artifactResult: 'review',
  })
  await save(root, `${label}-export`, exported)
  assert.equal(exported.destination, destination)
  assert.equal(exported.source, 'final')
  assert.match(exported.manifestDigest, digestPattern)
  const packet = JSON.parse(await readFile(join(destination, 'result.json'), 'utf8'))
  assert.equal(packet.runId, receipt.runId)
  assert.equal(packet.status, 'succeeded')
  assert.equal(packet.outcome, 'done')
  assert.equal(packet.resultDigest, observation.terminal.resultDigest)
  assert.deepEqual(packet.output, JSON.parse(JSON.stringify(retained.output)))
  const output = caller ? packet.output[caller] : packet.output
  assert.deepEqual(Object.keys(packet.output), caller ? [caller] : ['reviews'])
  assert.deepEqual(Object.keys(output), ['reviews'])
  const [delivery] = packet.delivery.files
  assert.equal(packet.delivery.files.length, 1)
  assert.equal(packet.delivery.source, 'final')
  assert.equal(packet.delivery.status, 'written')
  assert.equal(delivery.path, 'report.json')
  const report = await readFile(join(destination, 'files', delivery.path))
  assert.equal(delivery.bytes, report.length)
  assert.equal(delivery.digest, `sha256:${createHash('sha256').update(report).digest('hex')}`)
  assert.deepEqual(JSON.parse(report), output)
  return output.reviews
}

function replaceOnce(contents, before, after) {
  assert.equal(contents.split(before).length, 2, `Expected a unique selection of ${before}`)
  return contents.replace(before, after)
}

async function change(source, before, after) {
  const contents = await readFile(source, 'utf8')
  await writeFile(source, replaceOnce(contents, before, after))
}

async function verifyStage(context, stage, admission, offerReviewer) {
  for (const mode of ['fresh', 'resumed']) {
    verifyReviews(
      await run(context, admission, stage, 'binding:book', mode, 'book'),
      mode,
      'standard',
    )
    verifyReviews(
      await run(context, admission, stage, 'binding:offer', mode, 'offer'),
      mode,
      offerReviewer,
    )
  }
  verifyReviews(await run(context, admission, stage, direct, 'resumed'), 'resumed', 'standard')
  verifyReviews(await run(context, admission, stage, shared, 'fresh'), 'fresh', 'standard')
}

test('checks the working composition and compares a split without changing approval', async () => {
  await scenario('composition-check', async (context) => {
    const { root, cwd, client } = context
    const check = (label, args, diagnostic) =>
      command(root, cwd, label, jig, ['check', ...args], diagnostic)
    const linked = { basis: 'working-tree', status: 'linked' }
    const initialFiles = (await readdir(cwd)).sort()
    assert.deepEqual(JSON.parse(await check('before-approval', ['--json'])), linked)
    await check('missing-baseline', ['--diff', '--json'], /JIG_CHECK_NO_APPROVAL/)
    assert.deepEqual((await readdir(cwd)).sort(), initialFiles)

    const { approval } = await review(context, 'baseline', shared, standard)
    const sha256 = async (name) =>
      createHash('sha256')
        .update(await readFile(join(cwd, name)))
        .digest('hex')
    const hashes = async () => ({
      approval: (await client.inspect()).approval,
      state: await sha256('.jig/jig.sqlite3'),
      jigLock: await sha256('jig.lock'),
      bunLock: await sha256('bun.lock'),
    })
    const before = await hashes()
    assert.equal(before.approval, approval)
    await save(root, 'before-checks-hashes', before)

    await change(join(cwd, 'flows/producer/FLOW.ts'), "'Chapter One'", "'Opening Chapter'")
    assert.deepEqual(JSON.parse(await check('body-only', ['--diff', '--json'])), {
      ...linked,
      diff: { basis: 'approved', targets: [], slots: [], settingsChanged: [] },
    })
    await command(root, cwd, 'split', jig, [
      'split-binding',
      'binding:offer',
      '--slot',
      'producer',
      '--as',
      'offer-producer',
      '--select',
      'post-edit=binding:specialist',
    ])
    assert.equal(await check('split-check', []), 'Working configuration linked.\n')
    const plain = await check('split-diff-plain', ['--diff'])
    assert.match(
      plain,
      /Slot "binding:offer" \/ "producer": "binding:shared-producer" -> "binding:offer-producer"/,
    )
    assert.deepEqual(JSON.parse(await check('split-diff', ['--diff', '--json'])), {
      ...linked,
      diff: {
        basis: 'approved',
        targets: [{ target: dedicated, before: null, after: 'flows/producer' }],
        slots: [
          {
            caller: 'binding:offer',
            slot: 'producer',
            before: { target: shared },
            after: { target: dedicated },
          },
          { caller: dedicated, slot: 'post-edit', before: null, after: { target: specialist } },
          { caller: dedicated, slot: 'review', before: null, after: { target: standard } },
        ],
        settingsChanged: [],
      },
    })
    await change(join(cwd, 'bindings/offer.ts'), dedicated, 'binding:missing-producer')
    await check('unwired-check', ['--json'], /PROJECT_BINDING_SLOT_MISSING/)
    await check('unwired-diff', ['--diff', '--json'], /PROJECT_BINDING_SLOT_MISSING/)
    await change(join(cwd, 'bindings/offer.ts'), 'binding:missing-producer', standard)
    await check('incompatible-check', ['--json'], /PROJECT_CHILD_ATTACHMENT_MAPPING_INVALID/)
    const after = await hashes()
    await save(root, 'after-checks-hashes', after)
    assert.deepEqual(after, before)
  })
})

test('only offer adopts a dedicated post-edit reviewer', async () => {
  await scenario('scoped-edit', async (context) => {
    const baseline = await review(context, 'baseline', shared, standard)
    await verifyStage(context, 'baseline', baseline, 'standard')
    const edited = await isolateOffer(context, baseline)
    await verifyStage(context, 'edited', edited, 'specialist')
  })
})

async function isolateOffer(context, baseline) {
  const bindings = join(context.cwd, 'bindings')
  const original = await readFile(join(bindings, 'shared-producer.ts'), 'utf8')
  await writeFile(
    join(bindings, 'offer-producer.ts'),
    replaceOnce(original, "'post-edit': 'binding:standard'", "'post-edit': 'binding:specialist'"),
    { flag: 'wx' },
  )
  await change(join(bindings, 'offer.ts'), shared, dedicated)
  const stillApproved = await context.client.inspect({ target: 'binding:offer' })
  assert.equal(stillApproved.approval, baseline.approval)
  const edited = await review(context, 'edited', dedicated, standard)
  assert.notEqual(edited.approval, baseline.approval)
  assert.equal(edited.implementation, baseline.implementation)
  return edited
}

test('editing the shared Binding violates the sibling expectation', async (t) => {
  await scenario('wrong-scope', async (context) => {
    await change(
      join(context.cwd, 'bindings/shared-producer.ts'),
      "'post-edit': 'binding:standard'",
      "'post-edit': 'binding:specialist'",
    )
    const wrong = await review(context, 'wrong', shared, specialist)
    const offer = await run(context, wrong, 'wrong', 'binding:offer', 'resumed', 'offer')
    verifyReviews(offer, 'resumed', 'specialist')
    const book = await run(context, wrong, 'wrong', 'binding:book', 'resumed', 'book')
    verifyReviews(book, 'resumed', 'specialist')
    assert.throws(() => verifyReviews(book, 'resumed', 'standard'), {
      code: 'ERR_ASSERTION',
      message: /^resumed reviewer handoffs/,
    })
    t.diagnostic('The preserved book assertion rejects the specialist post-edit chapter review.')
  })
})
