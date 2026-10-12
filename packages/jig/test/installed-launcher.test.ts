import { expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('installed launcher rejects unsupported OS/CPU pairs before selecting a runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-launcher-hosts-'))
  try {
    const launcher = join(root, 'bin/jig')
    const uname = join(root, 'uname')
    const shell = await realpath(Bun.which('bash')!)
    await mkdir(join(root, 'bin'))
    await mkdir(join(root, 'libexec'))
    await writeFile(join(root, 'libexec/installed-cli.js'), '')
    const source = await readFile(new URL('../scripts/installed-jig.sh', import.meta.url), 'utf8')
    await writeFile(
      launcher,
      source.replaceAll('/usr/bin/uname', uname).replaceAll('/bin/uname', uname),
    )
    for (const [system, architecture, expected] of [
      ['Linux', 'x86_64', 'bun-linux-x64-baseline'],
      ['Darwin', 'x86_64', 'bun-darwin-x64-baseline'],
      ['Darwin', 'arm64', 'bun-darwin-aarch64'],
      ['Linux', 'aarch64', undefined],
      ['Linux', 'arm64', undefined],
      ['Darwin', 'i386', undefined],
      ['FreeBSD', 'x86_64', undefined],
    ] as const) {
      await writeFile(
        uname,
        `#!${shell}\ncase "$1" in -s) echo ${system};; -m) echo ${architecture};; esac\n`,
        { mode: 0o755 },
      )
      for (const name of [
        'bun-linux-x64-baseline',
        'bun-darwin-x64-baseline',
        'bun-darwin-aarch64',
      ]) {
        const runtime = join(root, 'node_modules/@oven', name, 'bin/bun')
        await mkdir(join(runtime, '..'), { recursive: true })
        await writeFile(runtime, `#!${shell}\necho ${name}\n`, { mode: 0o755 })
      }
      const child = Bun.spawn([shell, launcher, '--help'], { stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(code).toBe(expected === undefined ? 2 : 0)
      expect(stdout).toBe(expected === undefined ? '' : `${expected}\n`)
      if (expected === undefined) {
        expect(stderr).toContain('This operating system and CPU combination is not supported.')
        expect(stderr).not.toContain('Restore the complete Jig installation')
      } else expect(stderr).toBe('')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)

test('installed launcher uses a fixed system tool, not ambient readlink or Bun', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-launcher-paths-'))
  try {
    const release = join(root, 'release')
    const runtimePackage =
      process.platform === 'darwin'
        ? process.arch === 'arm64'
          ? 'bun-darwin-aarch64'
          : 'bun-darwin-x64-baseline'
        : 'bun-linux-x64-baseline'
    const runtime = join(release, `node_modules/@oven/${runtimePackage}/bin/bun`)
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
      await realpath(join(release, 'libexec/installed-cli.js')),
      '--help',
    ])
    await rm(systemReadlink)
    const missing = command()
    expect(await missing.exited).toBe(2)
    expect(await new Response(missing.stderr).text()).toBe(
      'Error: Jig could not start\n\n  The installed Jig runtime is unavailable.\n\n  Next step: Restore the complete Jig installation.\n  See https://jig.md/guide/#install.\n\n  Diagnostic code: JIG_COMMAND_UNAVAILABLE\n',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
