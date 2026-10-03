import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runPrivateAuthorEvaluatorChild } from '../src/internal/project-evaluator-child.js'

// These are trusted synthetic subprocesses, not hostile authored declarations
// or kernel-containment proof. Real guest code is tested only on the proof host.
describe.serial('trusted declaration subprocess settlement', () => {
  test('collects actual bytes only after a clean exit', async () => {
    await fixture(`process.stdout.write(await Bun.stdin.text());`, async (worker) => {
      const bytes = new TextEncoder().encode('exact captured request')
      expect(await runPrivateAuthorEvaluatorChild(bytes, worker)).toEqual(bytes)
    })
  }, 10_000)

  test('passes the relocated SDK path to the exact trusted child', async () => {
    await fixture(`process.stdout.write(process.env.JIG_EVALUATOR_SDK);`, async (worker) => {
      const sdkPath = '/captured/evaluator/project-evaluator-sdk.bundle.js'
      const bytes = await runPrivateAuthorEvaluatorChild(new Uint8Array(), worker, sdkPath)
      expect(new TextDecoder().decode(bytes)).toBe(sdkPath)
    })
  }, 10_000)

  test('reaps a stalled child at its individual ceiling, without borrowing batch time', async () => {
    await fixture(
      `
      await Bun.write(import.meta.dir + '/pid', String(process.pid));
      setInterval(() => {}, 1000);
      await new Promise(() => {});
    `,
      async (worker, root) => {
        await expect(
          runPrivateAuthorEvaluatorChild(new Uint8Array(), worker),
        ).rejects.toMatchObject({ code: 'PROJECT_EVALUATOR_DEADLINE' })
        const pid = Number(await readFile(join(root, 'pid'), 'utf8'))
        expect(() => process.kill(pid, 0)).toThrow()
      },
    )
  }, 20_000)

  test.each([
    ["process.stdout.write('answer'); process.exit(2);", 'PROJECT_EVALUATION_FAILED'],
    [
      "process.stderr.write('x'.repeat(65537)); setInterval(() => {},1000);",
      'PROJECT_EVALUATION_LIMIT',
    ],
  ])(
    'nonzero exit or bounded-output loss cannot become success (%s)',
    async (source, code) => {
      await fixture(source!, async (worker) => {
        await expect(
          runPrivateAuthorEvaluatorChild(new Uint8Array(), worker),
        ).rejects.toMatchObject({ code })
      })
    },
    10_000,
  )
})

async function fixture(action: string, check: (worker: string, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'jig-evaluator-child-'))
  try {
    const worker = join(root, 'worker.ts')
    await writeFile(worker, action)
    await check(worker, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
