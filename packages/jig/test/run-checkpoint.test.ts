import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { parseCapabilityContract } from '../src/capability/index.js'
import {
  assertRunCheckpointContract,
  PrivateRunCheckpoints,
  parseRunCheckpointInput,
  RUN_CHECKPOINT_CONTRACT_DIGEST,
} from '../src/internal/private-run-checkpoint.js'

const identity = {
  runId: `sha256:${'a'.repeat(64)}`,
  method: { package: 'one-exact-method' },
  input: { digest: `sha256:${'b'.repeat(64)}` },
}
test('checkpoint descriptor and private contract have one exact identity', async () => {
  const contract = parseCapabilityContract(
    await readFile(
      new URL('../../../docs/jig/spec/contracts/run-checkpoint.capability.json', import.meta.url),
    ),
  )
  expect(contract.digest).toBe(RUN_CHECKPOINT_CONTRACT_DIGEST)
  assertRunCheckpointContract(contract)
})
test('checkpoint accepts copied exact bytes and preserves previous progress after rejected replacement', () => {
  const owner = new PrivateRunCheckpoints(identity)
  const first = {
    sequence: 1,
    evidence: { candidate: 'original', passed: false },
    files: { 'job/proposal.patch': 'first' },
  }
  const receipt = owner.accept(first)
  first.files['job/proposal.patch'] = 'mutated caller'
  expect(owner.latest).toMatchObject({
    ...receipt,
    files: { 'job/proposal.patch': 'first' },
    evidence: { passed: false },
  })
  expect(() => owner.accept({ ...first, sequence: 3 })).toThrow('advance by one')
  expect(() => owner.accept({ ...first, sequence: 2, files: { '../escape': 'bad' } })).toThrow()
  expect(owner.latest?.digest).toBe(receipt.digest)
  const next = owner.accept({
    sequence: 2,
    evidence: { candidate: 'second', passed: true },
    files: { 'job/review.patch': 'second' },
  })
  expect(next.digest).not.toBe(receipt.digest)
  expect(owner.latest?.files).toEqual({ 'job/review.patch': 'second' })
  owner.close()
  expect(owner.latest).toBeUndefined()
  expect(() => owner.accept(first)).toThrow('closed')
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
  ])
    expect(() => parseRunCheckpointInput(value)).toThrow()
})
