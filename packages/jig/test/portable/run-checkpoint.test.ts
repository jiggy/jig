const suiteTestUrl = new URL('../' + import.meta.url.split('/').at(-1), import.meta.url).href

import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import {
  assertChildCheckpointContract,
  CHILD_CHECKPOINT_CONTRACT_DIGEST,
  parseChildCheckpointInput,
  PrivateChildCheckpointResultLimitError,
  projectChildCheckpoint,
} from '../../src/internal/private-child-checkpoint.js'
import {
  assertRunCheckpointContract,
  isPrivateCheckpointScope,
  parseRunCheckpointIdentity,
  parseRunCheckpointInput,
  privateRunCheckpointScope,
  type RetainedRunCheckpoint,
  RUN_CHECKPOINT_CONTRACT_DIGEST,
} from '../../src/internal/private-run-checkpoint.js'
import { PRIVATE_MAX_CHILD_FLOW_LEVELS } from '../../src/internal/root-operation-limits.js'
import { parseInvocationContract } from '../../src/invocation-contract.js'
import { type JsonValue } from '../../src/json.js'

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

test('checkpoint scope binds the original Run and full authenticated invocation ancestry', () => {
  const runId = 'sha256:' + 'a'.repeat(64)
  const otherRunId = 'sha256:' + 'b'.repeat(64)
  expect(privateRunCheckpointScope(runId, [])).toBe('root')
  const path = ['router', 'child:qualified']
  const nested = privateRunCheckpointScope(runId, path)
  expect(isPrivateCheckpointScope(nested)).toBeTrue()
  expect(nested).not.toBe('root')
  expect(privateRunCheckpointScope(runId, [...path])).toBe(nested)
  expect(privateRunCheckpointScope(otherRunId, path)).not.toBe(nested)
  expect(privateRunCheckpointScope(runId, ['child:qualified'])).not.toBe(nested)
  expect(privateRunCheckpointScope(runId, ['other-router', 'child:qualified'])).not.toBe(nested)
  expect(privateRunCheckpointScope(runId, ['router', 'other-child'])).not.toBe(nested)
  expect(privateRunCheckpointScope(runId, ['child:qualified', 'router'])).not.toBe(nested)
  path[0] = 'mutated'
  expect(privateRunCheckpointScope(runId, ['router', 'child:qualified'])).toBe(nested)
})

test('checkpoint scope rejects malformed Run IDs, operation IDs, and excess ancestry', () => {
  const runId = 'sha256:' + 'a'.repeat(64)
  for (const invalid of ['', runId + '\n', runId + '\r', 'sha256:' + 'A'.repeat(64)])
    expect(() => privateRunCheckpointScope(invalid, [])).toThrow()
  for (const invalid of ['', '/child', 'child\n', 'child\r', 'child\u2028', 'a'.repeat(129)])
    expect(() => privateRunCheckpointScope(runId, [invalid])).toThrow()
  expect(() =>
    privateRunCheckpointScope(runId, Array(PRIVATE_MAX_CHILD_FLOW_LEVELS + 1).fill('child')),
  ).toThrow()
  expect(() =>
    privateRunCheckpointScope(runId, Array(PRIVATE_MAX_CHILD_FLOW_LEVELS).fill('child')),
  ).not.toThrow()
  expect(privateRunCheckpointScope(runId, ['a'.repeat(128)])).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(isPrivateCheckpointScope(runId + '\n')).toBeFalse()
})

test('checkpoint identities require the exact scope without an implicit root fallback', () => {
  const runId = 'sha256:' + 'a'.repeat(64)
  const identity = { runId, scope: 'root', method: null, input: null }
  expect(parseRunCheckpointIdentity(identity)).toEqual(identity)
  expect(() => parseRunCheckpointIdentity({ runId, method: null, input: null })).toThrow()
  expect(() => parseRunCheckpointIdentity({ ...identity, scope: runId + '\n' })).toThrow()
  expect(() => parseRunCheckpointIdentity({ ...identity, runId: runId + '\n' })).toThrow()
  expect(() => parseRunCheckpointIdentity({ ...identity, operationPath: [] })).toThrow()
})

test('child checkpoint descriptor has one exact native identity and a host artifact result', async () => {
  const contract = parseInvocationContract(
    await readFile(
      new URL('../../../docs/jig/spec/contracts/child-checkpoint/contract.json', suiteTestUrl),
    ),
  )
  expect(contract.digest).toBe(CHILD_CHECKPOINT_CONTRACT_DIGEST)
  expect(contract.invocation!.artifactResults).toEqual(['checkpoint'])
  assertChildCheckpointContract(contract)
  expect(() => assertChildCheckpointContract({ ...contract, digest: 'sha256:' + '0'.repeat(64) })).toThrow()
})

test('child checkpoint accepts only a bounded caller-local operation ID', () => {
  const input = { operationId: 'draft:1' }
  const parsed = parseChildCheckpointInput(input)
  input.operationId = 'other'
  expect(parsed).toEqual({ operationId: 'draft:1' })
  expect(Object.isFrozen(parsed)).toBeTrue()
  expect(parseChildCheckpointInput({ operationId: 'a'.repeat(128) }).operationId).toHaveLength(128)
  for (const value of [
    null,
    {},
    { operationId: '' },
    { operationId: 'a'.repeat(129) },
    { operationId: 'draft\n' },
    { operationId: '/draft' },
    { operationId: 1 },
    { operationId: 'draft', runId: 'foreign' },
    { operationId: 'draft', scope: 'root' },
  ])
    expect(() => parseChildCheckpointInput(value)).toThrow()
})

test('child checkpoint projection contains accepted data without producer identities or references', () => {
  const record: RetainedRunCheckpoint = {
    identity: { runId: 'sha256:' + '1'.repeat(64), scope: 'root', method: {}, input: {} },
    sequence: 1,
    digest: 'sha256:' + '2'.repeat(64),
    evidence: { acceptedByApplication: false },
    files: { 'draft.txt': 'retained' },
    artifacts: { draft: 'producer-reference' },
    associations: { draft: { privateIdentity: 'opaque' } },
  }
  const projected = projectChildCheckpoint(record)
  expect(projected).toEqual({
    checkpoint: {
      sequence: 1,
      digest: record.digest,
      evidence: { acceptedByApplication: false },
      files: { 'draft.txt': 'retained' },
    },
  })
  expect(Object.isFrozen(projected.checkpoint)).toBeTrue()
  expect(projectChildCheckpoint(undefined)).toEqual({ checkpoint: null })
})

test('child checkpoint rejects a saved value whose retrieval envelope exceeds JSON depth', () => {
  let evidence: JsonValue = null
  for (let depth = 0; depth < 124; depth++) evidence = [evidence]
  const saved = parseRunCheckpointInput({ sequence: 1, evidence, files: {} })
  expect(() =>
    projectChildCheckpoint({
      ...saved,
      identity: { runId: 'sha256:' + '1'.repeat(64), scope: 'root', method: {}, input: {} },
      digest: 'sha256:' + '2'.repeat(64),
    }),
  ).toThrow(PrivateChildCheckpointResultLimitError)
})
