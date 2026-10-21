import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'linux' || process.env.JIG_LINUX_ROOTLESS_HOSTILE !== '1')
  throw Error('This suite requires opted-in rootless Linux qualification')

for (const mode of ['bind', 'tmpfs', 'file', 'freshness'] as const) {
  test(`project capture rejects real ${mode} mounts`, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'jig-source-mount-')))
    const project = join(base, 'project')
    const protectedSource = join(base, '.jig')
    try {
      await mkdir(join(project, 'mounted'), { recursive: true })
      await mkdir(protectedSource)
      for (const name of ['jig.ts', 'binding.ts', 'policy.json'])
        await writeFile(join(protectedSource, name), 'export default {};\n')
      await writeFile(join(project, 'binding.ts'), 'export default {};\n')
      await writeFile(join(project, 'ordinary.ts'), 'export default {};\n')
      await writeFile(join(project, 'mounted.ts'), 'export default {};\n')
      await writeFile(
        join(project, 'package.json'),
        JSON.stringify({
          name: 'root-app',
          private: true,
          workspaces: ['mounted'],
          dependencies: { helper: 'workspace:*' },
        }),
      )
      const mounted = mode === 'file' ? join(project, 'mounted.ts') : join(project, 'mounted')
      // util-linux also requires UID 0 for mounts without an fstab entry.
      // Bubblewrap maps this namespace's root to the unprivileged host user.
      const mountArgs =
        mode === 'freshness'
          ? ['--uid', '0', '--gid', '0', '--cap-add', 'CAP_SYS_ADMIN']
          : mode === 'tmpfs'
            ? ['--tmpfs', mounted]
            : [
                '--ro-bind',
                mode === 'file' ? join(protectedSource, 'jig.ts') : protectedSource,
                mounted,
              ]
      const worker = fileURLToPath(new URL('../fixtures/source-mount-worker.ts', import.meta.url))
      const child = Bun.spawn(
        [
          process.env.JIG_BWRAP_PATH ?? '/usr/bin/bwrap',
          '--unshare-user',
          '--unshare-pid',
          '--die-with-parent',
          '--ro-bind',
          '/',
          '/',
          '--bind',
          base,
          base,
          '--proc',
          '/proc',
          '--dev',
          '/dev',
          '--setenv',
          'TMPDIR',
          base,
          ...mountArgs,
          '--',
          process.execPath,
          '--no-env-file',
          '--no-install',
          '--config=/dev/null',
          worker,
          project,
          mode,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      )
      const timer = setTimeout(() => child.kill('SIGKILL'), 20_000)
      try {
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        expect({ code, stdout, stderr }).toEqual({
          code: 0,
          stdout: 'mount boundaries refused\n',
          stderr: '',
        })
      } finally {
        clearTimeout(timer)
      }
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  }, 25_000)
}
