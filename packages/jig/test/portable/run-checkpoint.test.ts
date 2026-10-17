const suiteTestUrl = new URL('../' + import.meta.url.split('/').at(-1), import.meta.url).href

import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import {
  assertRunCheckpointContract,
  parseRunCheckpointInput,
  RUN_CHECKPOINT_CONTRACT_DIGEST,
} from '../../src/internal/private-run-checkpoint.js'
import { parseInvocationContract } from '../../src/invocation-contract.js'

test('checkpoint descriptor and private contract have one exact identity', async () => {
  const contract = parseInvocationContract(
    await readFile(
      new URL('../../../docs/jig/spec/contracts/run-checkpoint/contract.json', suiteTestUrl),
    ),
  )
  expect(contract.digest).toBe(RUN_CHECKPOINT_CONTRACT_DIGEST)
  assertRunCheckpointContract(contract)
})
test('checkpoint input parsing copies caller data without granting acceptance', () => {
  const first = {
    sequence: 1,
    evidence: { candidate: 'original', passed: false },
    files: { 'job/proposal.patch': 'first' },
  }
  const parsed = parseRunCheckpointInput(first)
  first.files['job/proposal.patch'] = 'mutated caller'
  first.evidence.candidate = 'mutated caller'
  expect(parsed).toEqual({
    sequence: 1,
    files: { 'job/proposal.patch': 'first' },
    evidence: { candidate: 'original', passed: false },
  })
  // Parsing has no owner or sequence history. Native lifecycle tests prove saves.
  expect(parseRunCheckpointInput({ ...first, sequence: 3 }).sequence).toBe(3)
})
test('checkpoint rejects hidden authority, oversized data, invalid Unicode, and ambiguous paths', () => {
  for (const value of [
    { sequence: 1, evidence: null, files: {}, destination: '/tmp/out' },
    { sequence: 1, evidence: null, files: { a: 'a', 'a/b': 'b' } },
    { sequence: 1, evidence: null, files: { '/absolute': 'a' } },
    { sequence: 1, evidence: null, files: { a: '\ud800' } },
    { sequence: 1, evidence: null, files: { a: 'a'.repeat(1024 * 1024 + 1) } },
    { sequence: 1, evidence: 'a'.repeat(2 * 1024 * 1024), files: {} },
    { sequence: 17, evidence: null, files: {} },
    { sequence: 1, evidence: null, files: {}, artifacts: { '../escape': 'opaque' } },
    { sequence: 1, evidence: null, files: {}, artifacts: { selected: '' } },
    {
      sequence: 1,
      evidence: null,
      files: { 'artifacts/selected/data': 'collision' },
      artifacts: { selected: 'opaque' },
    },
  ])
    expect(() => parseRunCheckpointInput(value)).toThrow()
})

test('checkpoint optional associations are inert identities and text-only saves stay ordinary', () => {
  expect(
    parseRunCheckpointInput({ sequence: 1, evidence: null, files: {} }).artifacts,
  ).toBeUndefined()
  expect(
    parseRunCheckpointInput({
      sequence: 1,
      evidence: null,
      files: { 'review.txt': 'review' },
      artifacts: { selected: 'opaque-held-reference' },
    }).artifacts,
  ).toEqual({ selected: 'opaque-held-reference' })
})
