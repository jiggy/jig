import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Exercise the real worker and pinned Bun against synthetic loopback metadata.
// Only fixture paths and the registry constant change. This is an acquisition
// policy regression, not evidence about the production containment envelope.
test.each(['denied', 'unsupported-root', 'unsupported-graph', 'transitive-fetch'] as const)(
  'resolution worker preserves the acquisition boundary: %s',
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'jig-resolution-worker-'))
    const requests: string[] = []
    const target = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        requests.push('transitive fetch')
        return new Response('synthetic refusal; no package bytes served', { status: 404 })
      },
    })
    const registry = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname
        requests.push(path)
        if (path !== '/fixture-root') return new Response(null, { status: 404 })
        return Response.json({
          name: 'fixture-root',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              name: 'fixture-root',
              version: '1.0.0',
              ...(mode === 'transitive-fetch'
                ? {
                    dependencies: { leaf: `http://127.0.0.1:${target.port}/leaf.tgz` },
                  }
                : {}),
              dist: {
                tarball: `http://127.0.0.1:${registry.port}/fixture-root.tgz`,
                integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
              },
            },
          },
        })
      },
    })
    try {
      const worker = join(root, 'worker.js')
      const build = Bun.spawn(
        [
          process.execPath,
          'build',
          join(import.meta.dir, '../src/internal/bun-native-preparation-worker.ts'),
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
      const bundle = await readFile(worker, 'utf8')
      expect(bundle).toContain('/work/package')
      expect(bundle).toContain('--registry=https://registry.npmjs.org')
      const work = join(root, 'work')
      await mkdir(work)
      await writeFile(
        worker,
        bundle
          .replaceAll('/work', work)
          .replaceAll(
            '--registry=https://registry.npmjs.org',
            `--registry=http://127.0.0.1:${registry.port}`,
          ),
      )
      const manifest = JSON.stringify({
        name: 'fixture',
        dependencies: {
          'fixture-root':
            mode === 'unsupported-root' ? `http://127.0.0.1:${target.port}/root.tgz` : '1.0.0',
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
        { cwd: root, env: {}, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
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
      const expected = {
        denied: 'PACKAGE_BUN_PROTOCOL',
        'unsupported-root': 'PACKAGE_BUN_SOURCE_UNSUPPORTED',
        'unsupported-graph': 'PACKAGE_BUN_RESOLVED_SOURCE_UNSUPPORTED',
        'transitive-fetch': 'PACKAGE_BUN_RESOLUTION_FAILED',
      }
      expect(failure.code).toBe(expected[mode])
      if (mode === 'denied' || mode === 'unsupported-root') {
        expect(requests).toEqual([])
      } else {
        expect(requests).toContain('/fixture-root')
        expect(requests.includes('transitive fetch')).toBe(mode === 'transitive-fetch')
        expect(requests).not.toContain('/fixture-root.tgz')
        expect(failure.message).toContain('may already have occurred')
        expect(await readFile(join(work, 'package/package.json'), 'utf8')).toBe(manifest)
      }
    } finally {
      registry.stop(true)
      target.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  },
  30_000,
)
