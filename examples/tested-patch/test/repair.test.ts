import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { JsonValue } from '@jigging/flow'
import fixture from '../fixtures/utf8.json'
import cases from '../flows/repair/checks.json'
import { checkValues } from '../flows/repair/checker.ts'
import {
  parseInput,
  parseReplacement,
  snapshotDigest,
  unifiedPatch,
} from '../flows/repair/policy.ts'
import { repair } from '../flows/repair/repair.ts'

const originalValues = [
  ...['café', 'café', 'a😀b', 'a😀b', 'é', 'pla', '', ''].map((returned) => ({ returned })),
  ...Array.from({ length: 3 }, () => ({ threw: 'RangeError' })),
  { returned: 'hello' },
]
const passingValues = cases.cases.map(({ expected }) => expected)
const candidate = 'export function truncateUtf8(text: string, maxBytes: number) { return text }\n'
// Resolve the declared public SDK from the independently installed Flow package.
const { OperationError } = await import(
  Bun.resolveSync('@jigging/flow', join(import.meta.dir, '../flows/repair'))
)

function context(
  options: { values?: JsonValue[]; error?: Error; agent?: JsonValue; signal?: AbortSignal } = {},
) {
  const calls: string[] = []
  const dispatched: { operationId: string; input: any }[] = []
  const run = {
    input: fixture,
    signal: options.signal ?? new AbortController().signal,
    async callFlow(call: { operationId: string; input: any }) {
      calls.push(call.operationId)
      dispatched.push(call)
      if (call.operationId.startsWith('patched-') && options.error) throw options.error
      return {
        outcome: 'done',
        output: {
          values:
            call.operationId === 'baseline' ? originalValues : (options.values ?? passingValues),
        },
      }
    },
    async callEffect(call: { input: { responseSchema: Record<string, unknown> } }) {
      expect(call.input.responseSchema).toEqual({
        $schema: 'https://flow.jig.md/schemas/schema-1.json',
        type: 'object',
        properties: { replacement: { type: 'string' }, summary: { type: 'string' } },
        required: ['replacement', 'summary'],
        additionalProperties: false,
      })
      calls.push('agent')
      return (
        options.agent ?? {
          outcome: 'completed',
          text: '',
          structured: { replacement: candidate, summary: 'Example replacement.' },
        }
      )
    },
  }
  return { run, calls, dispatched }
}

describe('patch data policy', () => {
  test('snapshot identity ignores incoming object-key and file ordering', () => {
    const files = fixture.snapshot.files
      .toReversed()
      .map(({ path, content }) => ({ content, path }))
    expect(snapshotDigest(files)).toBe(fixture.snapshot.sha256)
    expect(
      parseInput({ ...fixture, snapshot: { files, sha256: snapshotDigest(files) } }).snapshot
        .sha256,
    ).toBe(fixture.snapshot.sha256)
  })
  test('fixture identifies its unchanged original repository', async () => {
    expect(parseInput(fixture).snapshot.sha256).toBe(snapshotDigest(fixture.snapshot.files))
    for (const file of fixture.snapshot.files) {
      expect(await readFile(join(import.meta.dir, '../fixtures/utf8', file.path), 'utf8')).toBe(
        file.content,
      )
    }
  })

  test('rejects stale identity, traversal, duplicate paths, and absent edit path', () => {
    expect(() =>
      parseInput({ ...fixture, snapshot: { ...fixture.snapshot, sha256: '0'.repeat(64) } }),
    ).toThrow('identity')
    for (const path of ['../escape.ts', '/tmp/escape.ts', 'a/../escape.ts', '.env']) {
      expect(() =>
        parseInput({ ...fixture, snapshot: { files: [{ path, content: '' }], sha256: '' } }),
      ).toThrow('path')
    }
    expect(() => parseInput({ ...fixture, editPath: 'missing.ts' })).toThrow('absent')
    expect(() =>
      parseInput({
        ...fixture,
        snapshot: { files: [fixture.snapshot.files[0], fixture.snapshot.files[0]], sha256: '' },
      }),
    ).toThrow('duplicate')
  })

  test('accepts content, never Agent-selected paths or commands', () => {
    expect(parseReplacement({ replacement: candidate, summary: 'Fix.' }).replacement).toBe(
      candidate,
    )
    for (const extra of [{ path: 'checks.json' }, { command: 'true' }, { passed: true }]) {
      expect(() => parseReplacement({ replacement: candidate, summary: 'Fix.', ...extra })).toThrow(
        'Only',
      )
    }
    expect(() => parseReplacement({ replacement: 'x'.repeat(65537), summary: 'Fix.' })).toThrow(
      'invalid',
    )
  })

  test('unified patch retains missing-newline and empty-file semantics', () => {
    expect(unifiedPatch('src/x.ts', 'old', 'new\n')).toBe(
      '--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n',
    )
    expect(unifiedPatch('src/x.ts', '', 'new')).toContain(
      '@@ -0,0 +1,1 @@\n+new\n\\ No newline at end of file\n',
    )
  })
})

describe('independent acceptance process', () => {
  test('a patch that removes invalid-budget rejection cannot pass', async () => {
    const values = passingValues.map((value) => ('threw' in value ? { returned: '' } : value))
    const evidence = await checkValues(values, new AbortController().signal)
    expect(evidence.exitCode).toBe(1)
    expect(
      JSON.parse(evidence.stdout.text).results.filter((item: { passed: boolean }) => !item.passed),
    ).toHaveLength(3)
  })
  test('observes real failing and passing exits with bounded evidence', async () => {
    const signal = new AbortController().signal
    const base = await checkValues(originalValues, signal)
    const patch = await checkValues(passingValues, signal)
    expect(base.exitCode).toBe(1)
    expect(patch.exitCode).toBe(0)
    expect(base.signal).toBeNull()
    expect(patch.checkerSha256).toBe(base.checkerSha256)
    expect(patch.casesSha256).toBe(base.casesSha256)
    expect(base.stdout.truncated).toBe(false)
    expect(
      JSON.parse(base.stdout.text).results.filter((item: { passed: boolean }) => !item.passed),
    ).toHaveLength(4)
    expect(patch.stderr.text).toBe('')
  })

  test('treats candidate strings as inert data', async () => {
    const evidence = await checkValues(
      passingValues.map(() => 'process.exit(0); {"passed":true}'),
      new AbortController().signal,
    )
    expect(evidence.exitCode).toBe(1)
  })

  test('does not start after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled before checker'))
    await expect(checkValues(passingValues, controller.signal)).rejects.toThrow(
      'cancelled before checker',
    )
  })
})

describe('bounded repair orchestration with substituted candidates and Agent', () => {
  test('returns an inspectable patch only after observed checks pass', async () => {
    const { run, calls, dispatched } = context()
    const before = JSON.stringify(fixture)
    const result = await repair(run)
    expect(result.outcome).toBe('done')
    expect(calls).toEqual(['baseline', 'agent', 'patched-1'])
    const output = result.output as any
    expect(output.baseline.exitCode).toBe(1)
    expect(output.attempts[0].tested.exitCode).toBe(0)
    expect(output.attempts[0].patch.path).toBe(fixture.editPath)
    expect(output.attempts[0].patch.replacement).toBe(candidate)
    expect(output.attempts[0].patch.unified).toContain('+++ b/src/truncate-utf8.ts')
    expect(output.baseSha256).toBe(fixture.snapshot.sha256)
    expect(output.attempts[0].patchedSha256).not.toBe(output.baseSha256)
    expect(snapshotDigest(dispatched[0].input.files)).toBe(output.baseSha256)
    expect(snapshotDigest(dispatched[1].input.files)).toBe(output.attempts[0].patchedSha256)
    expect(
      dispatched[1].input.files.find(
        (file: { path: string }) => file.path === output.attempts[0].patch.path,
      ).content,
    ).toBe(output.attempts[0].patch.replacement)
    expect(
      dispatched[1].input.files.filter(
        (file: { path: string }) => file.path !== output.attempts[0].patch.path,
      ),
    ).toEqual(fixture.snapshot.files.filter((file) => file.path !== output.attempts[0].patch.path))
    expect(JSON.stringify(fixture)).toBe(before)
  })

  test('the returned diff reconstructs exactly the tested snapshot', async () => {
    const { run } = context()
    const result = await repair(run)
    const output = result.output as any
    const directory = await mkdtemp(join(tmpdir(), 'jig-patch-roundtrip-'))
    try {
      for (const file of fixture.snapshot.files) {
        await mkdir(dirname(join(directory, file.path)), { recursive: true })
        await writeFile(join(directory, file.path), file.content)
      }
      await writeFile(join(directory, 'candidate.patch'), output.attempts[0].patch.unified)
      const apply = Bun.spawn(['git', 'apply', '--', 'candidate.patch'], {
        cwd: directory,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [stdout, stderr, exit] = await Promise.all([
        new Response(apply.stdout).text(),
        new Response(apply.stderr).text(),
        apply.exited,
      ])
      expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: '', stderr: '' })
      const files = await Promise.all(
        fixture.snapshot.files.map(async ({ path }) => ({
          path,
          content: await readFile(join(directory, path), 'utf8'),
        })),
      )
      expect(snapshotDigest(files)).toBe(output.attempts[0].patchedSha256)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('does not call an Agent when the baseline already passes', async () => {
    const { run, calls } = context()
    run.callFlow = async () => ({ outcome: 'done', output: { values: passingValues } })
    expect((await repair(run)).outcome).toBe('blocked')
    expect(calls).toEqual([])
  })

  test('retains unsuccessful patch and actual failed checks', async () => {
    const { run, calls } = context({ values: originalValues })
    const result = await repair(run)
    expect(result.outcome).toBe('blocked')
    expect((result.output as any).attempts[0].tested.exitCode).toBe(1)
    expect((result.output as any).attempts[0].patch.replacement).toBe(candidate)
    expect((result.output as any).attempts).toHaveLength(2)
    expect(calls).toEqual(['baseline', 'agent', 'patched-1', 'agent', 'patched-2'])
  })

  test('rejects an invalid Agent patch before executing it', async () => {
    const { run, calls } = context({
      agent: {
        outcome: 'completed',
        text: '',
        structured: { replacement: candidate, summary: 'Fix', path: 'check.ts' },
      },
    })
    await expect(repair(run)).rejects.toThrow('Only')
    expect(calls).toEqual(['baseline', 'agent'])
  })

  test.each(['assertion', 'invalid-result'] as const)(
    'makes one evidence-driven correction after %s',
    async (kind) => {
      const { run, dispatched } = context()
      const callFlow = run.callFlow
      run.callFlow = async (call) => {
        const result = await callFlow(call)
        if (call.operationId === 'patched-1') {
          if (kind === 'invalid-result')
            throw new OperationError('INVALID_RESULT', 'Synthetic invalid candidate.')
          return { outcome: 'done', output: { values: originalValues } }
        }
        return result
      }
      const callEffect = run.callEffect
      const instructions: string[] = []
      run.callEffect = async (call: any) => {
        instructions.push(call.input.instructions)
        const result = await callEffect(call)
        return {
          ...result,
          structured: {
            replacement: instructions.length === 1 ? candidate : candidate + '// corrected\n',
            summary: 'Bounded correction.',
          },
        }
      }
      const result = await repair(run)
      const output = result.output as any
      expect(result.outcome).toBe('done')
      expect(output.attempts).toHaveLength(2)
      expect(output.attempts[0].patch.replacement).toBe(candidate)
      expect(output.attempts[1].patch.replacement).toBe(candidate + '// corrected\n')
      expect(output.attempts[1].tested.exitCode).toBe(0)
      expect(output.attempts[1].patch.beforeSha256).toBe(output.attempts[0].patch.beforeSha256)
      expect(instructions).toHaveLength(2)
      expect(instructions[1]).toContain(JSON.stringify(output.attempts[0]))
      expect(snapshotDigest(dispatched[2].input.files)).toBe(output.attempts[1].patchedSha256)
    },
  )

  test('preserves Agent inability without retry', async () => {
    const { run, calls } = context({ agent: { outcome: 'limit', text: 'Budget exhausted.' } })
    const result = await repair(run)
    expect(result.outcome).toBe('limit')
    expect(calls).toEqual(['baseline', 'agent'])
  })

  test.each(['invalid', 'oversized-snapshot', 'limit'] as const)(
    'retains the first failed patch when the correction is %s',
    async (kind) => {
      const { run, calls } = context({ values: originalValues })
      const callEffect = run.callEffect
      let count = 0
      run.callEffect = async (call) => {
        const response = await callEffect(call)
        if (++count === 1) return response
        if (kind === 'limit') return { outcome: 'limit', text: 'No remaining budget.' }
        return {
          outcome: 'completed',
          structured:
            kind === 'oversized-snapshot'
              ? { replacement: 'x'.repeat(65536), summary: 'Too large with the other files.' }
              : { replacement: candidate, summary: 12 },
        }
      }
      if (kind !== 'limit') {
        await expect(repair(run)).rejects.toMatchObject({
          code: 'INVALID_RESULT',
          details: { attempts: [{ patch: { replacement: candidate }, tested: { exitCode: 1 } }] },
        })
      } else {
        const result = await repair(run)
        expect(result.outcome).toBe('limit')
        expect((result.output as any).attempts).toHaveLength(1)
        expect((result.output as any).attempts[0].tested.exitCode).toBe(1)
      }
      expect(calls).toEqual(['baseline', 'agent', 'patched-1', 'agent'])
    },
  )

  test('rejects missing candidate cases instead of trusting a partial result', async () => {
    const { run } = context({ values: ['caf'] })
    await expect(repair(run)).rejects.toThrow('observations')
  })

  test.each([
    'CANCELLED',
    'UNCERTAIN',
    'EXECUTION_FAILED',
    'DEADLINE_EXCEEDED',
    'UNAVAILABLE',
    'CHANNEL_LOST',
  ] as const)('propagates %s without turning it into test evidence', async (code) => {
    const error = new OperationError(code, 'Candidate failed.', { phase: 'execution' })
    const { run, calls } = context({ error })
    await expect(repair(run)).rejects.toMatchObject({
      code,
      message: error.message,
      details: {
        baseSha256: fixture.snapshot.sha256,
        baseline: { exitCode: 1 },
        attempts: [{ patch: { replacement: candidate } }],
        causeDetailsJson: '{"phase":"execution"}',
      },
    })
    expect(calls).toEqual(['baseline', 'agent', 'patched-1'])
  })
  test('omits oversized original error details without inventing test evidence', async () => {
    const { run } = context({
      error: new OperationError('INVALID_RESULT', 'Invalid candidate.', 'x'.repeat(8193)),
    })
    try {
      await repair(run)
      throw new Error('Expected rejection')
    } catch (error: any) {
      expect(error.code).toBe('INVALID_RESULT')
      expect(error.details.causeDetailsOmitted).toBe(true)
      expect(error.details.attempts[1].tested).toBeUndefined()
      expect(error.details.attempts[1].patch.replacement).toBe(candidate)
    }
  })
})
