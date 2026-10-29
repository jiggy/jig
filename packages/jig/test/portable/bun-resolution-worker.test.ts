import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodePrivateBunPreparedResult } from '../../src/internal/bun-native-preparation.js'
import { capturePrivateBunPreparationOutput } from '../../src/internal/bun-preparation-output.js'
import { capturePackageDirectory } from '../../src/package/capture.js'

for (const mode of ['production', 'evaluation'] as const)
  test(`real preparation worker publishes ${mode} bytes through directory custody only`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-preparation-worker-'))
    try {
      const source = join(root, 'source')
      const work = join(root, 'work')
      await mkdir(source)
      await mkdir(work)
      const manifest = JSON.stringify({
        name: 'preparation-consumer',
        private: true,
        dependencies: { 'is-number': '7.0.0' },
        devDependencies: { typescript: '5.7.3' },
      })
      await writeFile(join(source, 'package.json'), manifest)
      const lock = Bun.spawn(
        [
          process.execPath,
          'install',
          '--lockfile-only',
          '--ignore-scripts',
          '--registry=https://registry.npmjs.org',
          '--no-progress',
        ],
        {
          cwd: source,
          env: {},
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [lockExit, lockOut, lockError] = await Promise.all([
        lock.exited,
        new Response(lock.stdout).text(),
        new Response(lock.stderr).text(),
      ])
      expect(lockExit, lockOut + lockError).toBe(0)
      const captured = await capturePackageDirectory(source)
      try {
        const files = []
        for (const file of captured.files)
          files.push({
            path: file.path,
            content: Buffer.from(await captured.read(file.path)).toString('base64'),
          })
        const worker = Bun.spawn(
          [
            process.execPath,
            '--no-env-file',
            '--no-install',
            '--config=/dev/null',
            join(import.meta.dir, '../../src/internal/bun-native-preparation-worker.ts'),
          ],
          {
            cwd: work,
            env: {},
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
          },
        )
        worker.stdin.write(
          JSON.stringify({ type: 'source', files, ...(mode === 'evaluation' ? { mode } : {}) }) +
            '\n',
        )
        worker.stdin.end()
        const [exit, stdout, stderr] = await Promise.all([
          worker.exited,
          new Response(worker.stdout).text(),
          new Response(worker.stderr).text(),
        ])
        expect(exit, stdout + stderr).toBe(0)
        expect(stderr).toBe('')
        const metadata = JSON.parse(stdout)
        expect(Object.keys(metadata).sort()).toEqual([
          'bytes',
          'digest',
          'fileCount',
          'layout',
          'type',
        ])
        expect(stdout.length).toBeLessThan(2048)
        const directory = await open(work, 'r')
        try {
          const prepared = await capturePrivateBunPreparationOutput(directory, mode)
          try {
            const result = await decodePrivateBunPreparedResult(prepared, metadata, {
              captured,
              mode,
            })
            expect(
              result.captured.files.some(({ path }) => path === 'node_modules/is-number/index.js'),
            ).toBeTrue()
            expect(
              result.captured.files.some(
                ({ path }) => path === 'node_modules/typescript/lib/tsc.js',
              ),
            ).toBe(mode === 'evaluation')
          } finally {
            await prepared.dispose()
          }
        } finally {
          await directory.close()
        }
      } finally {
        await captured.dispose()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)

for (const mode of ['denied', 'unsupported-root'] as const) {
  test(`unmodified resolution worker refuses ${mode} before materialization`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-resolution-worker-'))
    try {
      const worker = join(root, 'worker.js')
      const build = Bun.spawn(
        [
          process.execPath,
          'build',
          join(import.meta.dir, '../../src/internal/bun-native-preparation-worker.ts'),
          '--target=bun',
          '--outfile',
          worker,
        ],
        { env: {}, stdout: 'ignore', stderr: 'pipe' },
      )
      const [buildExit, buildError] = await Promise.all([
        build.exited,
        new Response(build.stderr).text(),
      ])
      expect(buildExit, buildError).toBe(0)
      const bundle = await readFile(worker)
      const work = join(root, 'work')
      await mkdir(work)
      const manifest = JSON.stringify({
        name: 'fixture',
        dependencies: {
          'fixture-root':
            mode === 'unsupported-root' ? 'https://example.invalid/root.tgz' : '1.0.0',
        },
      })
      const child = Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          '--no-install',
          '--config=/dev/null',
          worker,
          ...(mode === 'denied' ? [] : ['--allow-resolution-network']),
        ],
        { cwd: work, env: {}, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      )
      child.stdin.write(
        `${JSON.stringify({
          type: 'source',
          files: [{ path: 'package.json', content: Buffer.from(manifest).toString('base64') }],
        })}\n`,
      )
      child.stdin.end()
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(exit).toBe(1)
      expect(stderr).toBe('')
      const failure = JSON.parse(stdout)
      expect(failure.type).toBe('failure')
      expect(failure.code).toBe(
        mode === 'denied' ? 'PACKAGE_BUN_PROTOCOL' : 'PACKAGE_BUN_SOURCE_UNSUPPORTED',
      )
      expect(await readdir(work)).toEqual([])
      expect(await readFile(worker)).toEqual(bundle)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
}

test('real preparation worker uses explicit production limits instead of ambient overrides', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-preparation-limits-'))
  try {
    const source = join(root, 'source')
    await mkdir(source)
    await writeFile(
      join(source, 'package.json'),
      JSON.stringify({
        name: 'preparation-consumer',
        private: true,
        workspaces: ['libs/*'],
        dependencies: { helper: 'workspace:*' },
      }),
    )
    await mkdir(join(source, 'libs/helper'), { recursive: true })
    await writeFile(
      join(source, 'libs/helper/package.json'),
      '{"name":"helper","version":"1.0.0","main":"index.js"}',
    )
    await writeFile(join(source, 'libs/helper/index.js'), 'export default 1')
    const workspace = { target: '', members: ['libs/helper'], selected: ['libs/helper'] }
    const author = Bun.spawn(
      [
        process.execPath,
        '--no-env-file',
        '--config=/dev/null',
        'install',
        '--lockfile-only',
        '--ignore-scripts',
        '--no-progress',
      ],
      { cwd: source, env: {}, stdout: 'pipe', stderr: 'pipe' },
    )
    const [authorExit, authorOut, authorError] = await Promise.all([
      author.exited,
      new Response(author.stdout).text(),
      new Response(author.stderr).text(),
    ])
    expect(authorExit, authorOut + authorError).toBe(0)
    const captured = await capturePackageDirectory(source)
    try {
      const files = []
      for (const file of captured.files)
        files.push({
          path: file.path,
          content: Buffer.from(await captured.read(file.path)).toString('base64'),
        })
      for (const maxPreparedFiles of [1, 8]) {
        const work = join(root, `work-${maxPreparedFiles}`)
        await mkdir(work)
        const dependencyLimits = { maxPreparedFiles, maxPreparedBytes: 1024 * 1024 }
        const worker = Bun.spawn(
          [
            process.execPath,
            '--no-env-file',
            '--no-install',
            '--config=/dev/null',
            join(import.meta.dir, '../../src/internal/bun-native-preparation-worker.ts'),
          ],
          {
            cwd: work,
            env: { JIG_LIMITS_DEPENDENCIES_MAX_PREPARED_FILES: '65536' },
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
          },
        )
        worker.stdin.write(
          `${JSON.stringify({ type: 'source', files, dependencyLimits, workspace })}\n`,
        )
        worker.stdin.end()
        const [exit, stdout, stderr] = await Promise.all([
          worker.exited,
          new Response(worker.stdout).text(),
          new Response(worker.stderr).text(),
        ])
        expect(stderr).toBe('')
        const message = JSON.parse(stdout)
        if (maxPreparedFiles === 1) {
          expect(exit).toBe(1)
          expect(message).toMatchObject({
            type: 'failure',
            code: 'PACKAGE_BUN_OUTPUT_LIMIT',
            preparationLimit: { dimension: 'files', observed: 2, maximum: 1 },
          })
        } else {
          expect(exit, stdout).toBe(0)
          const directory = await open(work, 'r')
          try {
            const prepared = await capturePrivateBunPreparationOutput(
              directory,
              'production',
              dependencyLimits,
            )
            try {
              const result = await decodePrivateBunPreparedResult(prepared, message, {
                captured,
                dependencyLimits,
                workspace,
              })
              expect(result.captured.files.map((file) => file.path)).toEqual([
                'bun.lock',
                'libs/helper/index.js',
                'libs/helper/package.json',
                'package.json',
              ])
            } finally {
              await prepared.dispose()
            }
          } finally {
            await directory.close()
          }
        }
      }
    } finally {
      await captured.dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
