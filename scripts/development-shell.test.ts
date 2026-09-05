import { expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const shellSource = await readFile(new URL('../shell.nix', import.meta.url), 'utf8')
const hook = /shellHook = ''\n([\s\S]*?)\n {2}'';/u.exec(shellSource)?.[1]
if (!hook) throw new Error('shell.nix has no shellHook')

// This is Nix interpolation, not JavaScript interpolation.
const repositoryExpression = `\${pkgs.lib.escapeShellArg (toString ./.)}`
if (!hook.includes(repositoryExpression)) throw new Error('shellHook repository binding changed')
const bash = Bun.which('bash')
if (!bash) throw new Error('development-shell tests require bash')

interface BuildFixture {
  launcher?: boolean
  entrypoint?: boolean
  builtVersion?: string
  versionFailure?: boolean
}

async function runHook(fixture: BuildFixture) {
  const root = await mkdtemp(join(tmpdir(), 'jig development shell '))
  try {
    const pkg = join(root, 'packages/jig')
    await mkdir(join(pkg, 'bin'), { recursive: true })
    await mkdir(join(pkg, 'libexec'), { recursive: true })
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ version: '0.1.0-alpha.2' }))
    if (fixture.launcher) {
      await writeFile(
        join(pkg, 'bin/jig'),
        fixture.versionFailure
          ? '#!/bin/sh\nexit 2\n'
          : `#!/bin/sh\n[ "$1" = --version ] || exit 3\nprintf '%s\\n' '${fixture.builtVersion ?? ''}'\n`,
      )
      await chmod(join(pkg, 'bin/jig'), 0o755)
    }
    if (fixture.entrypoint) await writeFile(join(pkg, 'libexec/installed-cli.js'), '')
    const escapedRoot = `'${root.replaceAll("'", "'\\''")}'`
    // Execute the actual hook, substituting only Nix's resolved repository path.
    // A different cwd and spaces in the path must not change its decisions.
    const child = Bun.spawn(
      [
        bash,
        '-eu',
        '-c',
        `${hook.replace(repositoryExpression, escapedRoot)}\nprintf '%s\\n' "$PATH"`,
      ],
      { cwd: tmpdir(), env: { PATH: process.env.PATH }, stdout: 'pipe', stderr: 'pipe' },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exitCode).toBe(0)
    expect(stdout.split(':')[0]).toBe(join(pkg, 'bin'))
    return stderr
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

for (const [name, fixture] of [
  ['no build', {}],
  ['missing launcher', { entrypoint: true, builtVersion: '0.1.0-alpha.2' }],
  ['missing entrypoint', { launcher: true, builtVersion: '0.1.0-alpha.2' }],
] as const) {
  test(`shell warns in bold red for ${name}`, async () => {
    const output = await runHook(fixture)
    expect(output).toStartWith('\x1b[1;31mJig is not built')
    expect(output).toContain('bun i && just jig::build')
    expect(output).toEndWith('\x1b[0m\n')
  })
}

test('shell names both versions and the rebuild command in bold red', async () => {
  const output = await runHook({
    launcher: true,
    entrypoint: true,
    builtVersion: '0.1.0-alpha.1',
  })
  expect(output).toStartWith('\x1b[1;31mJig build version 0.1.0-alpha.1')
  expect(output).toContain('package.json version 0.1.0-alpha.2')
  expect(output).toContain('just jig::build')
  expect(output).toEndWith('\x1b[0m\n')
})

test('a matching complete build enters the shell without warnings', async () => {
  expect(await runHook({ launcher: true, entrypoint: true, builtVersion: '0.1.0-alpha.2' })).toBe(
    '',
  )
})

test('a CLI that cannot report its version warns without failing shell entry', async () => {
  const output = await runHook({ launcher: true, entrypoint: true, versionFailure: true })
  expect(output).toStartWith('\x1b[1;31mJig could not report its built version.')
  expect(output).toContain('bun i && just jig::build')
  expect(output).toEndWith('\x1b[0m\n')
})

test('an empty version response is not treated as a matching build', async () => {
  const output = await runHook({ launcher: true, entrypoint: true })
  expect(output).toStartWith('\x1b[1;31mJig build version ')
  expect(output).toContain('does not match package.json version 0.1.0-alpha.2')
})
