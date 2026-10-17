import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
