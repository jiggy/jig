import { expect, test } from 'bun:test'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  foundationCommands,
  foundationResidue,
  freezeFoundationArchives,
  qualifyFoundationHost,
  requireFoundationOptIn,
} from '../fixtures/host-foundation/materialize.js'
import { checkInstalledDisplay, installedRuntime } from '../fixtures/installed-display.js'

requireFoundationOptIn()
const qualification = await qualifyFoundationHost()

test('installed CLI: admitted greeting, exact output, real saved inspectors and native residue', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-installed-cli-lifecycle-'))
  let passed = false
  try {
    const command = foundationCommands(join(root, 'commands'))
    const archives = await freezeFoundationArchives(root, command)
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: {
          '@jigging/jig': `file:${archives.jig}`,
          '@jigging/flow': `file:${archives.flow}`,
        },
      }),
    )
    await command(
      [process.execPath, 'install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'],
      root,
      120_000,
    )
    const cli = join(root, 'node_modules/.bin/jig')
    const project = join(root, 'greeting')
    const before = await foundationResidue(qualification, command, root)
    await command([cli, 'init', project], root)
    // Ordinary source-workspace consumption of the exact public SDK archive.
    // This avoids registry publication claims and preserves the normal resolver.
    const library = join(project, 'libs/flow')
    await mkdir(library, { recursive: true })
    await command(['tar', '-xzf', archives.flow, '--strip-components=1', '-C', library], root)
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({
        name: 'installed-cli-greeting',
        private: true,
        type: 'module',
        workspaces: ['flows/*', 'libs/*'],
      }),
    )
    await command(['git', 'init', '--quiet'], project)
    await command([cli, 'review', '--yes', '--allow-resolution-network'], project)
    const lock = await readFile(join(project, 'jig.lock'), 'utf8')
    for (const display of [[], ['--display', 'plain'], ['--json']]) {
      const result = await command(
        [cli, 'run', 'flow:flows/hello', '--input', JSON.stringify('Ada'), ...display],
        project,
      )
      expect(JSON.parse(result.stdout)).toEqual({
        diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
        outcome: 'done',
        output: { message: 'Hello, Ada!' },
        status: 'succeeded',
      })
      expect(result.stdout.trim().split('\n')).toHaveLength(1)
      expect(result.stdout + result.stderr).not.toMatch(
        /private-root-owners|private-host-ticket|#cap=/,
      )
      expect(await readFile(join(project, 'jig.lock'), 'utf8')).toBe(lock)
      expect(await foundationResidue(qualification, command, root)).toEqual(before)
    }
    const installed = realpathSync(join(root, 'node_modules/@jigging/jig'))
    const runtime = realpathSync(
      join(installed, 'node_modules/@oven', installedRuntime.package, 'bin/bun'),
    )
    await checkInstalledDisplay({
      consumer: root,
      installed,
      runtime,
      command: cli,
      run: (args, cwd, _environment, timeout) => command(args, cwd, timeout),
    })
    expect(await foundationResidue(qualification, command, root)).toEqual(before)
    passed = true
  } finally {
    if (passed) await rm(root, { recursive: true, force: true })
    else console.error(`Installed CLI native evidence retained at ${root}`)
  }
}, 600_000)
