import { expect, test } from 'bun:test'
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('installed launcher uses the NixOS system tool, not ambient readlink or Bun', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-launcher-paths-'))
  try {
    const release = join(root, 'release')
    const runtime = join(release, 'node_modules/@oven/bun-linux-x64-baseline/bin/bun')
    const systemReadlink = join(root, 'system/readlink')
    const shell = await realpath(Bun.which('bash')!)
    const launcher = join(release, 'bin/jig')
    await mkdir(join(release, 'bin'), { recursive: true })
    await mkdir(join(release, 'libexec'), { recursive: true })
    await mkdir(join(runtime, '..'), { recursive: true })
    await mkdir(join(systemReadlink, '..'), { recursive: true })
    await writeFile(join(release, 'libexec/installed-cli.js'), '')
    await writeFile(runtime, `#!${shell}\nprintf "%s\\n" "$@"\n`)
    await chmod(runtime, 0o755)
    const readlink = await realpath(Bun.which('readlink')!)
    await symlink(readlink, systemReadlink)
    // Substitute fixture-owned filesystem locations, not launcher decisions.
    const source = await readFile(new URL('../scripts/installed-jig.sh', import.meta.url), 'utf8')
    await writeFile(
      launcher,
      source
        .replaceAll('/run/current-system/sw/bin/readlink', systemReadlink)
        .replaceAll('/usr/bin/readlink', join(root, 'missing-usr-readlink'))
        .replaceAll('/bin/readlink', join(root, 'missing-bin-readlink')),
    )
    await chmod(launcher, 0o755)
    const command = () =>
      Bun.spawn([shell, launcher, '--help'], {
        env: { PATH: '/nonexistent', BUN_OPTIONS: 'invalid', NODE_OPTIONS: 'invalid' },
        stdout: 'pipe',
        stderr: 'pipe',
      })
    const child = command()
    const output = await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    expect(output.split('\n').filter(Boolean)).toEqual([
      '--no-env-file',
      '--no-install',
      '--config=/dev/null',
      join(release, 'libexec/installed-cli.js'),
      '--help',
    ])
    await rm(systemReadlink)
    const missing = command()
    expect(await missing.exited).toBe(2)
    expect(await new Response(missing.stderr).text()).toBe(
      'JIG_COMMAND_UNAVAILABLE: the installed Jig runtime is unavailable\n',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
