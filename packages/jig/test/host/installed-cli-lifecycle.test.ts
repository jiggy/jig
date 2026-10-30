import { expect, test } from 'bun:test'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settleTestCommand } from '../fixtures/bounded-command.js'
import {
  foundationCommands,
  foundationEnvironment,
  foundationResidue,
  freezeFoundationArchives,
  qualifyFoundationHost,
  requireFoundationOptIn,
} from '../fixtures/host-foundation/materialize.js'
import { checkInstalledDisplay, installedRuntime } from '../fixtures/installed-display.js'

requireFoundationOptIn()
const qualification = await qualifyFoundationHost()

test('installed CLI: pristine initialized greeting, exact output, real saved inspectors and native residue', async () => {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'jig-installed-cli-lifecycle-')))
  let passed = false
  try {
    const command = foundationCommands(join(root, 'commands'))
    const archives = await freezeFoundationArchives(root, command)
    const tooling = join(root, 'tooling')
    await mkdir(tooling)
    await writeFile(
      join(tooling, 'package.json'),
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
      tooling,
      120_000,
    )
    const cli = join(tooling, 'node_modules/.bin/jig')
    const project = join(root, 'greeting')
    const before = await foundationResidue(qualification, command, root)
    await command([cli, 'init', project], root)
    // The tutorial must work on the files init writes, outside the tooling
    // installation, without a workspace, a local dependency install or Git setup.
    const authoredPaths = [
      '.gitignore',
      'README.md',
      'jig.ts',
      'flows/hello/package.json',
      'flows/hello/FLOW.meta.json',
      'flows/hello/FLOW.ts',
    ]
    const authoredBytes = await Promise.all(
      authoredPaths.map((path) => readFile(join(project, path))),
    )
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
      for (const [index, path] of authoredPaths.entries())
        expect(await readFile(join(project, path))).toEqual(authoredBytes[index])
      for (const path of [
        'package.json',
        'bun.lock',
        'node_modules',
        '.git',
        'flows/hello/bun.lock',
        'flows/hello/node_modules',
      ])
        expect(existsSync(join(project, path))).toBe(false)
      expect(await foundationResidue(qualification, command, root)).toEqual(before)
    }
    const installed = realpathSync(join(tooling, 'node_modules/@jigging/jig'))
    const runtime = realpathSync(
      createRequire(join(installed, 'package.json')).resolve(
        `@oven/${installedRuntime.package}/bin/bun`,
      ),
    )
    await checkInstalledDisplay({
      consumer: tooling,
      installed,
      runtime,
      command: cli,
      run: (args, cwd, _environment, timeout) => command(args, cwd, timeout),
    })
    expect(await foundationResidue(qualification, command, root)).toEqual(before)
    // A new ordinary reviewed revision requires an explicitly connected output.
    // Keep the greeting and saved-display proofs above on their original approval.
    const requiredContract = {
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      input: { type: 'string' },
      channels: { progress: { direction: 'send', required: true, schema: { type: 'string' } } },
    }
    const requiredTask = [
      'import { handle } from "@jigging/flow";',
      'await handle(async (run) => {',
      '  const progress = run.channels.progress;',
      '  if (progress?.direction !== "send") throw new Error("Required output unavailable");',
      '  await progress.send("Greeting prepared.");',
      '  await progress.close();',
      '  return { outcome: "done", output: { message: `Hello, ${run.input}!` } };',
      '});',
      '',
    ].join('\n')
    await writeFile(
      join(project, 'flows/hello/FLOW.contract.json'),
      JSON.stringify(requiredContract),
    )
    await writeFile(join(project, 'flows/hello/FLOW.ts'), requiredTask)
    await command([cli, 'review', '--yes', '--allow-resolution-network'], project)
    const channelLock = await readFile(join(project, 'jig.lock'), 'utf8')
    expect(channelLock).not.toBe(lock)
    const refused = await settleTestCommand(
      Bun.spawn([cli, 'run', 'flow:flows/hello', '--input', JSON.stringify('Ada'), '--json'], {
        cwd: project,
        env: foundationEnvironment(),
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      }),
      { evidence: join(root, 'required-channel-refusal'), timeoutMs: 120_000, graceMs: 10_000 },
    )
    expect(refused.code).toBe(1)
    expect(JSON.parse(refused.stdout)).toMatchObject({ status: 'failed', code: 'INVALID_INPUT' })
    expect(refused.stderr).toContain('JIG_RUN_INPUT_INVALID')
    expect(refused.stderr).toContain('input or channel request was rejected as invalid')
    expect(refused.stderr).toContain("$ jig inspect 'flow:flows/hello'")
    expect(refused.stderr).toContain('--input')
    expect(refused.stderr).toContain('--receive NAME')
    expect(refused.stderr).not.toContain('Input does not match the approved target input schema')
    expect(refused.stderr).not.toContain('No Flow was started')
    expect(refused.stderr).not.toContain(root)
    expect(refused.stdout + refused.stderr).not.toMatch(
      /private-root-owners|private-host-ticket|#cap=/,
    )
    expect(await readFile(join(project, 'jig.lock'), 'utf8')).toBe(channelLock)
    expect(await foundationResidue(qualification, command, root)).toEqual(before)
    const connected = await command(
      [
        cli,
        'run',
        'flow:flows/hello',
        '--input',
        JSON.stringify('Ada'),
        '--receive',
        'progress',
        '--json',
      ],
      project,
    )
    const records = connected.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(records).toEqual([
      { type: 'begin', channel: 'progress', startSequence: 1 },
      { type: 'data', channel: 'progress', sequence: 1, value: 'Greeting prepared.' },
      { type: 'end', channel: 'progress', status: 'closed', lastSequence: 1 },
      {
        type: 'terminal',
        result: {
          diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
          outcome: 'done',
          output: { message: 'Hello, Ada!' },
          status: 'succeeded',
        },
      },
    ])
    expect(connected.stdout + connected.stderr).not.toMatch(
      /private-root-owners|private-host-ticket|#cap=/,
    )
    expect(await readFile(join(project, 'jig.lock'), 'utf8')).toBe(channelLock)
    expect(await foundationResidue(qualification, command, root)).toEqual(before)
    passed = true
  } finally {
    if (passed) await rm(root, { recursive: true, force: true })
    else console.error(`Installed CLI native evidence retained at ${root}`)
  }
}, 600_000)
