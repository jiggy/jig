import test from 'node:test'
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
} from './experiment.mjs'

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
