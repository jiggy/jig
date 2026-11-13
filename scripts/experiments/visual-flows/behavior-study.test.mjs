import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  applyProposedEdits,
  directory,
  loadStudy,
  readSources,
  repository,
  sha256,
  sourceInventory,
  studies,
  validateCurrentAnswers,
} from './agent-context/behavior-study.mjs'

test('current behavior is a separate frozen record with explicit abstention', () => {
  const packet = { questions: { gate: ['Question', ['yes', 'no']] } }
  const input = { gate: 'unknown' }
  const recorded = validateCurrentAnswers(packet, input)
  input.gate = 'yes'
  assert.equal(recorded.gate, 'unknown')
  assert.throws(() => validateCurrentAnswers(packet, {}), /exactly/)
  assert.throws(() => validateCurrentAnswers(packet, { gate: 'probably' }), /vocabulary/)
  assert.throws(() => validateCurrentAnswers(packet, { gate: 'yes', future: 'no' }), /exactly/)
})

test('behavioral briefs refuse changed source instead of silently refreshing their basis', async () => {
  const basis = JSON.parse(await readFile(path.join(directory, 'behavior-basis.json'), 'utf8'))
  for (const study of studies) {
    const files = await sourceInventory(path.join(repository, 'examples', study.id))
    assert.deepEqual(
      Object.fromEntries(Object.entries(files).map(([name, value]) => [name, value.sha256])),
      basis[study.id],
    )
    for (const brief of study.briefs)
      assert.ok((await readFile(path.join(directory, brief), 'utf8')).includes('mermaid'))
  }
})

test('source reads expose only frozen exact members and never partial success on an invalid request', () => {
  const packet = { files: { 'method.ts': { source: 'old', sha256: sha256('old') } } }
  assert.equal(readSources(packet, ['method.ts'])[0].source, 'old')
  assert.throws(() => readSources(packet, ['method.ts', '../secret']), /unavailable/)
  assert.throws(() => readSources(packet, Array(9).fill('method.ts')), /1-8/)
})

test('proposed edits require read ownership, unique context, and preserve replacement literals', () => {
  const packet = { editable: ['method.ts'], files: { 'method.ts': { source: 'old' } } }
  const answer = { edits: [{ file: 'method.ts', old: 'old', new: '$& new' }] }
  assert.throws(() => applyProposedEdits(packet, answer, new Set()), /previously read/)
  assert.equal(applyProposedEdits(packet, answer, new Set(['method.ts']))['method.ts'], '$& new')
  assert.equal(packet.files['method.ts'].source, 'old')
  assert.throws(
    () =>
      applyProposedEdits(
        packet,
        { edits: [{ ...answer.edits[0], file: '../other' }] },
        new Set(['../other']),
      ),
    /allowed/,
  )
  assert.throws(
    () =>
      applyProposedEdits(
        { ...packet, files: { 'method.ts': { source: 'old old' } } },
        answer,
        new Set(['method.ts']),
      ),
    /exactly once/,
  )
})

test('corrupt retained source cannot enter a study', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'jig-behavior-study-'))
  try {
    await writeFile(
      path.join(temporary, 'packets.json'),
      JSON.stringify([
        { files: { 'method.ts': { source: 'changed', sha256: sha256('original') } } },
      ]),
    )
    await assert.rejects(loadStudy(temporary), /Corrupt source packet/)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
