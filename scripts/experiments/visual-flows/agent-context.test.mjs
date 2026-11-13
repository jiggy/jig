import test from 'node:test'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  loadPacket,
  render,
  arms,
  applyEdit,
  repository,
  directory,
  score,
  expected,
  decodeScreeningResponse,
  screeningResponseBody,
} from './agent-context/experiment.mjs'

test('all representations preserve every audited fact and source reference once', async () => {
  const packet = await loadPacket()
  for (const arm of arms) {
    const text = render(packet, arm)
    for (const f of packet.facts) {
      assert.equal(text.split(f.text).length - 1, 1)
      for (const e of f.evidence) assert.ok(text.includes(`${e.file}:${e.line}`))
    }
  }
})
test('changed source invalidates a frozen interpretation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jig-packet-'))
  try {
    await mkdir(path.join(root, 'examples'), { recursive: true })
    await cp(
      path.join(repository, 'examples/support-case'),
      path.join(root, 'examples/support-case'),
      { recursive: true },
    )
    await writeFile(path.join(root, 'examples/support-case/flows/assess/assess.ts'), 'changed')
    await assert.rejects(loadPacket(root), /Stale packet/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('the edit boundary refuses arbitrary generated code and wrong targets', () => {
  assert.throws(
    () =>
      applyEdit('const maximumCreditCents = 5000', {
        file: expected.change,
        old: 'const maximumCreditCents = 5000',
        new: 'process.exit(0)',
      }),
    /bounded/,
  )
  assert.throws(
    () =>
      applyEdit('const maximumCreditCents = 5000', {
        file: 'other.ts',
        old: 'const maximumCreditCents = 5000',
        new: 'const maximumCreditCents = 7500',
      }),
    /bounded/,
  )
})
test('unknown answers cannot earn a perfect score', () => {
  assert.ok(
    Object.values(
      score({ answers: Object.fromEntries(Object.keys(expected).map((k) => [k, 'unknown'])) }),
    ).some((v) => !v),
  )
})

test('response schema failures stay distinct from correct answers and numeric edit validity', () => {
  const valid = {
    answers: { ...expected },
    edit: { file: expected.change, old: 'a', new: 'b' },
    rationale: 'Evidence',
  }
  assert.equal(decodeScreeningResponse(JSON.stringify(valid)).schemaValid, true)
  const incomplete = decodeScreeningResponse(JSON.stringify({ answers: valid.answers }))
  assert.equal(incomplete.schemaValid, false)
  assert.ok(Object.values(score(incomplete.answer)).every(Boolean))
  assert.equal(
    decodeScreeningResponse(JSON.stringify({ ...valid, answers: [] })).schemaValid,
    false,
  )
  assert.equal(decodeScreeningResponse(JSON.stringify({ ...valid, edit: [] })).schemaValid, false)
  assert.throws(() => decodeScreeningResponse('{'))
})
test('provider protocol bodies are bounded and screen credentials before retention', async () => {
  const key = 'provider-secret-for-this-test'
  const result = await screeningResponseBody(
    new Response(
      'HTTP error ' +
        key +
        ' ' +
        encodeURIComponent(key) +
        ' ' +
        Buffer.from(key).toString('base64') +
        ' Bearer unknown-token',
    ),
    [key],
  )
  assert.ok(!result.rawHttpBody.includes(key))
  assert.ok(!result.rawHttpBody.includes('unknown-token'))
  assert.equal(result.bodyTruncated, false)
  const large = await screeningResponseBody(new Response('x'.repeat(100000)), [])
  assert.equal(large.rawHttpBody.length, 65536)
  assert.equal(large.bodyTruncated, true)
})

test('summary reports actual mixed-model coverage and invalid outer shapes separately', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jig-screening-summary-'))
  try {
    const complete = {
      answers: { ...expected },
      edit: {
        file: expected.change,
        old: 'const maximumCreditCents = 5000',
        new: 'const maximumCreditCents = 7500',
      },
      rationale: 'Evidence',
    }
    await writeFile(
      path.join(root, 'results.json'),
      JSON.stringify({
        revision: 'fixture',
        results: [
          {
            arm: 'prose',
            repetition: 0,
            provider: 'one',
            requestedModel: 'alias',
            returnedModel: 'model-a',
            raw: JSON.stringify(complete),
            modificationPassed: true,
          },
          {
            arm: 'prose',
            repetition: 1,
            provider: 'two',
            requestedModel: 'alias',
            returnedModel: 'model-b',
            raw: JSON.stringify({ answers: { ...expected } }),
            modificationPassed: true,
          },
          {
            attempt: true,
            arm: 'prose',
            provider: 'failed',
            requestedModel: 'other',
            rawHttpBody: 'HTTP error',
          },
        ],
      }),
    )
    execFileSync(process.execPath, [path.join(directory, 'summarize.mjs'), root])
    const summary = JSON.parse(await readFile(path.join(root, 'summary.json'), 'utf8'))
    assert.equal(summary.mixedModels, true)
    assert.equal(summary.samples.length, 2)
    assert.deepEqual(
      summary.models.map((model) => model.returnedModel),
      ['model-a', 'model-b'],
    )
    const row = summary.rows.find((row) => row.arm === 'prose')
    assert.equal(row.samples, 2)
    assert.equal(row.correct, 16)
    assert.equal(row.invalid, 1)
    assert.equal(row.modified, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
