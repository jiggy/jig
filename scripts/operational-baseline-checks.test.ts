import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkInvalidRunTarget, finishOperationalBaseline } from './operational-baseline-checks.js'

test('invalid target assertion requires every current selector and the closed diagnostic', () => {
  const stderr =
    'Error: Run target is invalid\n\n  use flow:<path>, npm:<package> or binding:<id>, for example flow:flows/hello.\n\n  Diagnostic code: JIG_RUN_TARGET_INVALID\n'
  expect(() => checkInvalidRunTarget({ stdout: '', stderr })).not.toThrow()
  for (const changed of [
    stderr.replace(', npm:<package>', ''),
    stderr.replace('binding:<id>', ''),
    stderr.replace('JIG_RUN_TARGET_INVALID', 'INTERNAL'),
  ]) {
    expect(() => checkInvalidRunTarget({ stdout: '', stderr: changed })).toThrow()
  }
  expect(() => checkInvalidRunTarget({ stdout: 'unexpected', stderr })).toThrow()
})

for (const [mainFailed, residueFailed] of [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
] as const) {
  test(`baseline teardown: main failure=${mainFailed}, residue failure=${residueFailed}`, async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'jig-baseline-check-'))
    const evidence = join(temporary, 'evidence.json')
    await writeFile(evidence, 'original evidence')
    const original = new Error('original assertion')
    const residue = new Error('owned work remains')
    let checked = false
    let removed = false
    try {
      let failure: AggregateError | undefined
      try {
        await finishOperationalBaseline({
          failures: mainFailed ? [original] : [],
          temporary,
          checkResidue: async () => {
            checked = true
            if (residueFailed) throw residue
          },
          removeFixture: async () => {
            removed = true
            await rm(temporary, { recursive: true })
          },
        })
      } catch (error) {
        failure = error as AggregateError
      }
      expect(checked).toBe(true)
      expect(removed).toBe(!mainFailed && !residueFailed)
      if (mainFailed || residueFailed) {
        expect(failure).toBeInstanceOf(AggregateError)
        expect(failure!.message).toContain(temporary)
        expect(failure!.errors).toEqual([
          ...(mainFailed ? [original] : []),
          ...(residueFailed ? [residue] : []),
        ])
        expect(await readFile(evidence, 'utf8')).toBe('original evidence')
      } else {
        expect(failure).toBeUndefined()
        expect(await Bun.file(evidence).exists()).toBe(false)
      }
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })
}

test('fixture removal failure is reported, never converted into success', async () => {
  const removal = new Error('removal failed')
  try {
    await finishOperationalBaseline({
      failures: [],
      temporary: '/fixture',
      checkResidue: async () => {},
      removeFixture: async () => {
        throw removal
      },
    })
    throw new Error('expected failure')
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([removal])
    expect((error as Error).message).toContain('possibly partial')
  }
})
