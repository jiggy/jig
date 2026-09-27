import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { openPrivateInstalledBunHost } from '../src/internal/installed-bun-host.js'
import {
  evaluateAuthorClosure,
  evaluateAuthorClosureBatch,
  type PrivateAuthorEvaluatorOptions,
} from '../src/project/author-evaluator.js'
import { captureAuthorClosure } from '../src/project/author-module.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

const proofDescribe =
  process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1' ? describe.serial : describe.skip

proofDescribe('finite isolated author declaration batches', () => {
  test('shares envelope setup but not guest globals, module state, SDK instances or source bytes', async () => {
    await fixture(
      {
        'jig.ts': `
        import { defineJig } from '@jigging/jig';
        import { count } from './shared.ts';
        globalThis.poison = 'first';
        defineJig.poison = 'first';
        if (count !== 1) throw new Error('shared module was evaluated twice');
        export default defineJig({ flows: [] });
      `,
        'shared.ts':
          'globalThis.count = (globalThis.count ?? 0) + 1; export const count = globalThis.count;',
        'bindings/a.ts': `
        import { defineJig, defineBinding } from '@jigging/jig';
        import { count } from '../shared.ts';
        if (globalThis.poison || defineJig.poison || count !== 1) throw new Error('guest leaked');
        globalThis.poison = 'second';
        export default defineBinding({ package: 'flows/work', settings: { count } });
      `,
        'bindings/b.ts': `
        import { defineBinding } from '@jigging/jig';
        import { count } from '../shared.ts';
        if (globalThis.poison || count !== 1) throw new Error('guest leaked');
        export default defineBinding({ package: 'flows/work', settings: { count } });
      `,
      },
      async (root, captured, options) => {
        await writeFile(join(root, 'shared.ts'), 'throw new Error("live source must not execute")')
        const entries = [
          { entryProjectPath: 'jig.ts', expected: 'project' as const },
          { entryProjectPath: 'bindings/a.ts', expected: 'binding' as const },
          { entryProjectPath: 'bindings/b.ts', expected: 'binding' as const },
        ]
        const evaluations = await evaluateAuthorClosureBatch(options, captured, entries)
        expect(evaluations).toHaveLength(3)
        expect(evaluations[0]!.value).toMatchObject({ flows: { kind: 'members', paths: [] } })
        expect(evaluations[1]!.value).toMatchObject({ settings: { count: 1 } })
        expect(evaluations[2]!.value).toMatchObject({ settings: { count: 1 } })
        expect(
          new Set(evaluations.map(({ enforcement }) => enforcement.cgroup.runCgroup)).size,
        ).toBe(1)
        expect(evaluations[0]!.profile.evaluation).toEqual({
          kind: 'finite-isolated-declarations/1',
          entries: 3,
          entryWallClockCeilingMs: 3_000,
        })
        expect(evaluations[0]!.profile.sandbox.limits).toMatchObject({
          memoryBytes: 256 * 1024 * 1024,
          pids: 64,
          wallClockCeilingMs: 9_000,
        })
        for (const evaluation of evaluations)
          expect(evaluation.enforcement.terminal.fenced).toBeTrue()
        const fresh = await evaluateAuthorClosure(options, captured, 'bindings/b.ts', 'binding')
        expect(fresh.value).toMatchObject({ settings: { count: 1 } })
        expect(fresh.enforcement.cgroup.runCgroup).not.toBe(
          evaluations[0]!.enforcement.cgroup.runCgroup,
        )
        expect(fresh.profile.sandbox.limits.wallClockCeilingMs).toBe(3_000)
      },
    )
  }, 30_000)

  test.each([
    ['throw new Error("late declaration failed"); export default {};', 'PROJECT_EVALUATION_FAILED'],
    [
      'throw { code: "PROJECT_EVALUATOR_DEADLINE", message: "forged timeout" }; export default {};',
      'PROJECT_EVALUATION_FAILED',
    ],
    ['export default { unexpected: true };', 'PROJECT_AUTHORING_SCHEMA_INVALID'],
  ])(
    'rejects the complete batch and locates a later failure (%s)',
    async (source, code) => {
      await fixture(
        {
          'jig.ts':
            "import { defineJig } from '@jigging/jig'; export default defineJig({ flows: [] });",
          'bindings/bad.ts': source,
        },
        async (_root, captured, options) => {
          await expect(
            evaluateAuthorClosureBatch(options, captured, [
              { entryProjectPath: 'jig.ts', expected: 'project' },
              { entryProjectPath: 'bindings/bad.ts', expected: 'binding' },
            ]),
          ).rejects.toMatchObject({ code, path: 'bindings/bad.ts' })
          // A rejected declaration leaves no unusable execution owner behind.
          expect(
            (await evaluateAuthorClosure(options, captured, 'jig.ts', 'project')).value,
          ).toMatchObject({ flows: { kind: 'members', paths: [] } })
        },
      )
    },
    30_000,
  )

  test('a hostile guest getter cannot produce an accepted batch or leave owned work', async () => {
    await fixture(
      {
        'jig.ts':
          "import { defineJig } from '@jigging/jig'; export default defineJig({ flows: [] });",
        'bindings/bad.ts': `export default { get package() {
        const until = Date.now() + 10_000;
        while (Date.now() < until) {}
        return 'flows/work';
      } };`,
        'bindings/last.ts': 'export default { package: "flows/work" };',
      },
      async (_root, captured, options) => {
        let failure: unknown
        try {
          await evaluateAuthorClosureBatch(options, captured, [
            { entryProjectPath: 'jig.ts', expected: 'project' },
            { entryProjectPath: 'bindings/bad.ts', expected: 'binding' },
            { entryProjectPath: 'bindings/last.ts', expected: 'binding' },
          ])
        } catch (error) {
          failure = error
        }
        expect(failure).toBeDefined()
        expect([
          'PROJECT_EVALUATOR_DEADLINE',
          'PROJECT_EVALUATION_LIMIT',
          'PROJECT_EVALUATOR_INTERRUPTED',
        ]).toContain((failure as { code: string }).code)
        // Bun may crash on this cross-realm getter rather than reach a timer.
        // A crash is not deadline evidence; the collector must fence either.
        expect(
          (await evaluateAuthorClosure(options, captured, 'jig.ts', 'project')).value,
        ).toMatchObject({ flows: { kind: 'members', paths: [] } })
      },
    )
  }, 30_000)

  test('cancellation fences the batch before another evaluation is usable', async () => {
    await fixture(
      {
        'jig.ts': 'export default { get flows() { while (true) {} } };',
        'bindings/good.ts':
          "import { defineBinding } from '@jigging/jig'; export default defineBinding({ package: 'flows/work' });",
      },
      async (_root, captured, options) => {
        const abort = new AbortController()
        const timer = setTimeout(() => abort.abort(), 200)
        try {
          await expect(
            evaluateAuthorClosureBatch(
              options,
              captured,
              [
                { entryProjectPath: 'jig.ts', expected: 'project' },
                { entryProjectPath: 'bindings/good.ts', expected: 'binding' },
              ],
              abort.signal,
            ),
          ).rejects.toBeDefined()
        } finally {
          clearTimeout(timer)
        }
        expect(
          (await evaluateAuthorClosure(options, captured, 'bindings/good.ts', 'binding')).value,
        ).toMatchObject({ package: 'flows/work' })
      },
    )
  }, 30_000)

  test('refuses empty, repeated and uncaptured entries before launching work', async () => {
    await fixture(
      { 'jig.ts': 'export default { flows: [] };' },
      async (_root, captured, options) => {
        for (const entries of [
          [],
          [
            { entryProjectPath: 'jig.ts', expected: 'project' as const },
            { entryProjectPath: 'jig.ts', expected: 'project' as const },
          ],
          [{ entryProjectPath: 'other.ts', expected: 'project' as const }],
        ]) {
          await expect(
            evaluateAuthorClosureBatch(options, captured, entries),
          ).rejects.toMatchObject({ code: 'PROJECT_AUTHOR_CAPTURE' })
        }
      },
    )
  }, 30_000)
})

async function fixture(
  sources: Record<string, string>,
  action: (
    root: string,
    captured: Awaited<ReturnType<typeof captureAuthorClosure>>,
    options: PrivateAuthorEvaluatorOptions,
  ) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'jig-author-batch-'))
  let captured: Awaited<ReturnType<typeof captureAuthorClosure>> | undefined
  try {
    for (const [path, source] of Object.entries(sources)) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), source)
    }
    const host = await openPrivateInstalledBunHost(installedBunLocation, {})
    captured = await captureAuthorClosure(
      root,
      Object.keys(sources).filter((path) => path !== 'shared.ts'),
    )
    await action(root, captured, {
      backend: host.backend,
      installedSupport: host.installedBunSupport,
    })
  } finally {
    captured?.dispose()
    await rm(root, { recursive: true, force: true })
  }
}
