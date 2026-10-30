import { expect, test } from 'bun:test'
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { foundationCommands } from '../fixtures/host-foundation/materialize.js'
import {
  foundationEvaluationFailure,
  foundationEvaluationFailureSummary,
} from '../fixtures/private-profile-diagnostics.js'

function evaluationFailureObservation(evaluation: unknown) {
  return {
    terminal: {
      status: 'failed',
      code: 'DEADLINE_EXCEEDED',
      message: 'PRIVATE_MESSAGE',
      diagnostics: { stderr: 'PRIVATE_STDERR' },
      details: { evaluation, input: 'PRIVATE_INPUT' },
    },
    receipt: { runId: 'PRIVATE_RUN_ID' },
    ticket: 'PRIVATE_TICKET',
  }
}

test('foundation evaluation failure summaries retain only closed public phase facts', () => {
  const observation = evaluationFailureObservation({
    phase: 'compile',
    stage: 'collection',
    limit: 'phase',
    process: {
      stopReason: 'deadline',
      durationMs: 37.5,
      invocation: ['PRIVATE_INVOCATION'],
      stdout: { text: 'PRIVATE_STDOUT' },
      stderr: { text: 'PRIVATE_STDERR' },
    },
    phases: [{ phase: 'generate', files: [{ path: 'PRIVATE_PATH' }] }],
    cleanup: 'complete',
    candidateDigest: 'PRIVATE_CANDIDATE',
    files: [{ path: 'PRIVATE_PATH' }],
  })
  expect(foundationEvaluationFailure(observation)).toEqual({
    phase: 'compile',
    stage: 'collection',
    limit: 'phase',
    stopReason: 'deadline',
    durationMs: 37.5,
    cleanup: 'complete',
    phaseCount: 1,
    processCount: 1,
  })
  expect(JSON.stringify(foundationEvaluationFailure(observation))).not.toContain('PRIVATE')
  expect(
    foundationEvaluationFailure(
      evaluationFailureObservation({
        phase: null,
        stage: 'setup',
        limit: 'evaluation',
        process: null,
        phases: [],
        cleanup: 'complete',
      }),
    ),
  ).toEqual({
    phase: null,
    stage: 'setup',
    limit: 'evaluation',
    stopReason: null,
    durationMs: null,
    cleanup: 'complete',
    phaseCount: 0,
    processCount: 0,
  })
})

test('foundation evaluation failure projection ignores unknown values and accessors', () => {
  const malformed = {
    phase: 'PRIVATE_PHASE',
    stage: 'PRIVATE_STAGE',
    limit: 'PRIVATE_LIMIT',
    process: { stopReason: 'PRIVATE_STOP', message: 'PRIVATE_MESSAGE' },
    phases: [1, 2, 3, 4],
    cleanup: 'PRIVATE_CLEANUP',
  }
  expect(foundationEvaluationFailure(evaluationFailureObservation(malformed))).toEqual({
    phase: 'unknown',
    stage: 'unknown',
    limit: 'unknown',
    stopReason: 'unknown',
    durationMs: null,
    cleanup: 'unknown',
    phaseCount: null,
    processCount: 1,
  })
  expect(
    JSON.stringify(foundationEvaluationFailure(evaluationFailureObservation(malformed))),
  ).not.toContain('PRIVATE')
  let reads = 0
  const accessor = {
    get() {
      reads++
      throw new Error('PRIVATE_GETTER')
    },
  }
  const process = Object.defineProperty({}, 'stopReason', accessor)
  const evaluation = Object.create({ phase: 'compile', cleanup: 'complete' })
  Object.defineProperties(evaluation, {
    stage: accessor,
    limit: accessor,
    process: { value: process },
    phases: { value: new Proxy([], { get: accessor.get }) },
  })
  expect(foundationEvaluationFailure(evaluationFailureObservation(evaluation))).toEqual({
    phase: 'unknown',
    stage: 'unknown',
    limit: 'unknown',
    stopReason: 'unknown',
    durationMs: null,
    cleanup: 'unknown',
    phaseCount: 0,
    processCount: 1,
  })
  expect(reads).toBe(0)
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  for (const value of [null, undefined, [], revoked.proxy, { terminal: { status: 'succeeded' } }])
    expect(foundationEvaluationFailure(value)).toBeUndefined()
  expect(
    foundationEvaluationFailure(Object.defineProperty({}, 'terminal', accessor)),
  ).toBeUndefined()
  expect(reads).toBe(0)
})

test('foundation evaluation observation reads reject links, malformed files and oversized input', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'jig-evaluation-failure-summary-')))
  const path = join(directory, 'adaptive-observation.json')
  try {
    const observation = evaluationFailureObservation({
      phase: 'test',
      stage: 'admission',
      limit: 'enclosing',
      process: null,
      phases: [],
      cleanup: 'complete',
    })
    const expected = JSON.stringify(foundationEvaluationFailure(observation))
    await writeFile(path, JSON.stringify(observation))
    expect(await foundationEvaluationFailureSummary(path)).toBe(expected)
    expect(await foundationEvaluationFailureSummary(join(directory, 'absent'))).toBeUndefined()
    expect(await foundationEvaluationFailureSummary(directory)).toBeUndefined()
    await symlink(path, join(directory, 'alias'))
    expect(await foundationEvaluationFailureSummary(join(directory, 'alias'))).toBeUndefined()
    await writeFile(path, '{PRIVATE_INVALID_JSON')
    expect(await foundationEvaluationFailureSummary(path)).toBeUndefined()
    const full = { ...observation, padding: '' }
    full.padding = 'x'.repeat(256 * 1024 - Buffer.byteLength(JSON.stringify(full)))
    const encoded = JSON.stringify(full)
    expect(Buffer.byteLength(encoded)).toBe(256 * 1024)
    await writeFile(path, encoded)
    expect(await foundationEvaluationFailureSummary(path)).toBe(expected)
    await writeFile(path, `${encoded} `)
    expect(await foundationEvaluationFailureSummary(path)).toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('foundation evaluation diagnostics preserve real failed commands and remain opt-in', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'jig-evaluation-command-summary-')))
  try {
    const observation = evaluationFailureObservation({
      phase: 'compile',
      stage: 'collection',
      limit: 'phase',
      process: { stopReason: 'deadline' },
      phases: [],
      cleanup: 'complete',
    })
    await writeFile(join(directory, 'adaptive-observation.json'), JSON.stringify(observation))
    const command = foundationCommands(join(directory, 'commands'))
    const args = [process.execPath, '-e', "console.error('PRIVATE_CHILD_MESSAGE'); process.exit(7)"]
    const failed = await command(args, directory, undefined, 'run').then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failed).toMatchObject({ actual: 7, expected: 0 })
    const message = (failed as Error).message
    expect(message).toContain(
      'evaluation failure: {"phase":"compile","stage":"collection","limit":"phase","stopReason":"deadline","durationMs":null,"cleanup":"complete","phaseCount":0,"processCount":1}',
    )
    expect(message).not.toContain('PRIVATE')
    expect(await readFile(join(directory, 'commands/001.stderr'), 'utf8')).toContain(
      'PRIVATE_CHILD_MESSAGE',
    )
    const ordinary = await command(args, directory).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(ordinary).toMatchObject({ actual: 7, expected: 0 })
    expect((ordinary as Error).message).not.toContain('evaluation failure:')
    await writeFile(join(directory, 'adaptive-observation.json'), '{not JSON}')
    const invalid = await command(args, directory, undefined, 'run').then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(invalid).toMatchObject({ actual: 7, expected: 0 })
    expect((invalid as Error).message).not.toContain('evaluation failure:')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('foundation evaluation duration is finite, bounded public process evidence', () => {
  const summary = (durationMs: unknown) =>
    foundationEvaluationFailure(evaluationFailureObservation({ process: { durationMs } }))
      ?.durationMs
  for (const value of [0, 37.5, 86_400_000]) expect(summary(value)).toBe(value)
  for (const value of [-1, 86_400_001, Number.NaN, Infinity, 'PRIVATE_DURATION', {}, null])
    expect(summary(value)).toBeNull()
})
