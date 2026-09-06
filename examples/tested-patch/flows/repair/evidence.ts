import { isDeepStrictEqual } from 'node:util'
import {
  parseInput,
  parseReplacement,
  type RepairInput,
  sha256,
  snapshotDigest,
  unifiedPatch,
} from './policy.ts'

export interface Acceptance {
  checkerSha256: string
  casesSha256: string
  cases: { id: string; expected: unknown }[]
}

function record(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Missing evidence record.')
  return value
}

function check(value: any, acceptance: Acceptance) {
  const item = record(value)
  if (
    item.checkerSha256 !== acceptance.checkerSha256 ||
    item.casesSha256 !== acceptance.casesSha256
  )
    throw new Error(
      'Check identities differ from this application. Review its current checks before running.',
    )
  if (item.signal !== null || (item.exitCode !== 0 && item.exitCode !== 1))
    throw new Error('Checker did not finish an acceptance verdict.')
  for (const log of [item.stdout, item.stderr]) {
    if (
      typeof log?.text !== 'string' ||
      log.truncated !== false ||
      log.bytes !== Buffer.byteLength(log.text) ||
      log.bytes > 16384
    )
      throw new Error('Checker logs are missing, incomplete, or oversized.')
  }
  const results = JSON.parse(item.stdout.text).results
  if (!Array.isArray(results) || results.length !== acceptance.cases.length)
    throw new Error('Incomplete case results.')
  results.forEach((result, index) => {
    const expected = acceptance.cases[index]
    if (
      result.id !== expected.id ||
      !isDeepStrictEqual(result.expected, expected.expected) ||
      !Object.hasOwn(result, 'actual') ||
      result.passed !== isDeepStrictEqual(result.actual, expected.expected)
    )
      throw new Error('Case results do not match the fixed acceptance policy.')
  })
  const passed = results.filter((result) => result.passed).length
  if (item.exitCode !== (passed === results.length ? 0 : 1))
    throw new Error('Checker exit contradicts its results.')
  return { passed, total: results.length, exitCode: item.exitCode as number }
}

// Method-owned evidence checks run before returning a result or writing a reviewable patch.
export function inspect(methodResult: unknown, input: RepairInput, acceptance: Acceptance) {
  const result = record(methodResult)
  const evidence = result.output
  const summary = {
    status: 'unsuccessful' as 'review-ready' | 'unsuccessful' | 'invalid-evidence',
    reason:
      typeof evidence?.reason === 'string' ? evidence.reason : 'No passing patch was returned.',
    baseline: undefined as ReturnType<typeof check> | undefined,
    attempts: [] as { number: number; checks?: ReturnType<typeof check>; failure?: string }[],
    proposals: [] as string[],
  }
  if (evidence === undefined) return summary
  try {
    if (record(evidence).baseSha256 !== input.snapshot.sha256)
      throw new Error('Original snapshot identity does not match.')
    summary.baseline = check(evidence.baseline, acceptance)
    if (!Array.isArray(evidence.attempts) || evidence.attempts.length > 2)
      throw new Error('Invalid attempt history.')
    const before = input.snapshot.files.find((file) => file.path === input.editPath)!.content
    for (const [index, attempt] of evidence.attempts.entries()) {
      const patch = record(record(attempt).patch)
      parseReplacement({ replacement: patch.replacement, summary: patch.summary })
      const files = input.snapshot.files.map((file) =>
        file.path === input.editPath ? { ...file, content: patch.replacement } : file,
      )
      parseInput({ ...input, snapshot: { files, sha256: attempt.patchedSha256 } })
      if (
        patch.path !== input.editPath ||
        patch.beforeSha256 !== sha256(before) ||
        attempt.patchedSha256 !== snapshotDigest(files) ||
        patch.unified !== unifiedPatch(input.editPath, before, patch.replacement)
      )
        throw new Error('Patch bytes or identities do not match the captured original.')
      summary.proposals.push(patch.unified)
      summary.attempts.push({
        number: index + 1,
        ...(attempt.tested === undefined ? {} : { checks: check(attempt.tested, acceptance) }),
        ...(attempt.failure === undefined ? {} : { failure: String(attempt.failure.code) }),
      })
    }
    const last = summary.attempts.at(-1)
    if (result.outcome === 'done') {
      if (
        summary.baseline.exitCode !== 1 ||
        last?.checks?.exitCode !== 0 ||
        last.failure !== undefined
      )
        throw new Error('Completion is not backed by a reproduced defect and passing patch checks.')
      summary.status = 'review-ready'
    }
  } catch (error) {
    summary.status = 'invalid-evidence'
    summary.reason = error instanceof Error ? error.message : 'Invalid repair evidence.'
  }
  return summary
}
