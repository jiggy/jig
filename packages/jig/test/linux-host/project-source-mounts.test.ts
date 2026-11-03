import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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

for (const mode of [
  'helper',
  'application',
  'prefix',
  'nested',
  'file',
  'protected',
  'protected-folded',
  'alias',
  'freshness',
] as const) {
  test(`workspace capture enforces selected roots across real ${mode} mounts`, async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'jig-workspace-mount-')))
    const workspace = join(base, 'workspace')
    const helper = join(workspace, 'packages/helper')
    try {
      for (const name of ['control', 'workspace']) {
        const root = join(base, name)
        const put = async (path: string, value: string | Record<string, unknown>) => {
          await mkdir(dirname(join(root, path)), { recursive: true })
          await writeFile(
            join(root, path),
            typeof value === 'string' ? value : JSON.stringify(value),
          )
        }
        await put('package.json', {
          private: true,
          workspaces: ['apps/demo/flows/*', 'packages/*'],
        })
        await put(
          'apps/demo/jig.ts',
          "import { defineJig, discover } from '@jigging/jig'\nexport default defineJig({ flows: discover('./flows') })\n",
        )
        await put('apps/demo/flows/echo/package.json', {
          name: 'echo',
          type: 'module',
          dependencies: { 'fixture-helper': 'workspace:*' },
        })
        await put('apps/demo/flows/echo/FLOW.meta.json', {
          name: 'echo',
          description: 'Return a local helper value.',
        })
        await put(
          'apps/demo/flows/echo/FLOW.ts',
          "import { message } from 'fixture-helper'\nconsole.log(JSON.stringify({ message }))\n",
        )
        await put('packages/helper/package.json', {
          name: 'fixture-helper',
          version: '0.1.0',
          type: 'module',
          files: mode === 'prefix' ? ['**/*'] : ['index.js', 'data'],
          exports: './index.js',
        })
        await put('packages/helper/index.js', "export const message = 'synthetic helper'\n")
        await put('packages/helper/data/value.json', '{"retained":true}\n')
        if (mode === 'prefix' && name === 'workspace') {
          await put('packages/helper/.jig/admission-secret', 'protected admission fixture state')
          await put('packages/helper/data/.JiG/run-secret', 'protected Run fixture state')
        }
        await put('packages/unrelated/package.json', { name: 'unrelated', version: '0.1.0' })
        await put('packages/unrelated/private-note', 'unrelated source must stay absent')
      }
      await cp(helper, join(base, '.jig'), { recursive: true })
      if (mode === 'protected-folded')
        await cp(helper, join(base, '.JiG'), { recursive: true })
      await mkdir(join(base, 'extra'))
      await writeFile(join(base, 'extra/value.json'), '{"retained":false}\n')
      const mountArgs =
        mode === 'freshness'
          ? ['--uid', '0', '--gid', '0', '--cap-add', 'CAP_SYS_ADMIN']
          : mode === 'protected' || mode === 'protected-folded'
            ? ['--ro-bind', join(base, mode === 'protected' ? '.jig' : '.JiG'), helper]
            : mode === 'alias'
              ? ['--ro-bind', join(workspace, 'apps/demo'), helper]
              : mode === 'prefix'
                ? ['--bind', join(workspace, 'packages'), join(workspace, 'packages')]
                : [
                    ...(mode === 'application'
                      ? ['--bind', join(workspace, 'apps/demo'), join(workspace, 'apps/demo')]
                      : []),
                    '--bind',
                    helper,
                    helper,
                    ...(mode === 'nested'
                      ? ['--ro-bind', join(base, 'extra'), join(helper, 'data')]
                      : mode === 'file'
                        ? ['--ro-bind', join(helper, 'index.js'), join(helper, 'index.js')]
                        : []),
                  ]
      const worker = fileURLToPath(
        new URL('../fixtures/workspace-source-mount-worker.ts', import.meta.url),
      )
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
          base,
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
          stdout: 'workspace source roots verified\n',
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
