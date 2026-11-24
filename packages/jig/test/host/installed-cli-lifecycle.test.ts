import { constants, Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
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
import { checkInstalledFlowBehavior } from '../fixtures/installed-flow-behavior.js'
import { checkInstalledSlotSpecialization } from '../fixtures/installed-specialize-slot.js'

requireFoundationOptIn()
const qualification = await qualifyFoundationHost()

async function installFixtureCli(root: string, command: ReturnType<typeof foundationCommands>) {
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
  return { cli, tooling }
}

test('installed CLI: Binding authoring changes only offer samples', async () => {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'jig-installed-specialize-slot-')))
  let passed = false
  try {
    const command = foundationCommands(join(root, 'commands'))
    const { cli, tooling } = await installFixtureCli(root, command)
    const flowVersion = JSON.parse(
      await readFile(join(tooling, 'node_modules/@jigging/flow/package.json'), 'utf8'),
    ).version
    const before = await foundationResidue(qualification, command, root)
    for (const membership of ['discovered', 'exact'] as const)
      await checkInstalledSlotSpecialization(
        cli,
        join(root, 'specialize-slot-' + membership),
        command,
        flowVersion,
        membership,
      )
    expect(await foundationResidue(qualification, command, root)).toEqual(before)
    passed = true
  } finally {
    if (passed) await rm(root, { recursive: true, force: true })
    else console.error(`Installed Binding authoring evidence retained at ${root}`)
  }
}, 600_000)

test('installed CLI: pristine initialized greeting, exact output, real saved inspectors and native residue', async () => {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'jig-installed-cli-lifecycle-')))
  let passed = false
  try {
    const command = foundationCommands(join(root, 'commands'))
    const { cli, tooling } = await installFixtureCli(root, command)
    const project = join(root, 'greeting')
    const path = [join(tooling, 'node_modules/.bin'), process.env.PATH].join(delimiter)
    const bunTest = ['env', `PATH=${path}`, process.execPath, 'test']
    const before = await foundationResidue(qualification, command, root)
    const starter = join(root, 'kitchen-shifts')
    await command([cli, 'init', starter, '--starter', 'kitchen-shifts'], root)
    const checkedStarter = await command([cli, 'check', '--json'], starter)
    expect(JSON.parse(checkedStarter.stdout)).toMatchObject({
      basis: 'working-tree',
      status: 'linked',
    })
    await command([cli, 'review', '--yes', '--allow-resolution-network'], starter)
    const kitchenTests = await command([...bunTest, 'tests/shifts.test.ts'], starter)
    expect(kitchenTests.stderr).toContain('2 pass')
    await command([cli, 'init', project], root)
    // The tutorial must work on the files init writes, outside the tooling
    // installation, without a workspace, a local dependency install or Git setup.
    const authoredPaths = [
      '.gitignore',
      'AGENTS.md',
      'README.md',
      'tests/fixtures/greeting.json',
      'tests/AGENTS.md',
      'tests/greeting.test.ts',
      'jig.ts',
      'package.json',
      'flows/hello/AGENTS.md',
      'flows/hello/package.json',
      'flows/hello/FLOW.meta.json',
      'flows/hello/FLOW.ts',
    ]
    const authoredBytes = await Promise.all(
      authoredPaths.map((path) => readFile(join(project, path))),
    )
    const checked = await command([cli, 'check', '--json'], project)
    expect(JSON.parse(checked.stdout)).toMatchObject({ basis: 'working-tree', status: 'linked' })
    const beforeApproval = await command(
      [cli, 'inspect', '--flow', 'flow:./flows/hello', '--json'],
      project,
    )
    const originalTopology = JSON.parse(beforeApproval.stdout)
    expect(originalTopology.basis).toBe('working-tree')
    expect(originalTopology.scope.target).toBe('flow:flows/hello')
    expect(originalTopology.targets[0].flow.routes).toEqual([])
    expect(existsSync(join(project, '.jig'))).toBe(false)
    expect(existsSync(join(project, 'jig.lock'))).toBe(false)
    const approvedLookup = [cli, 'inspect', '--flow', '--find', 'supplied string', '--approved']
    const unreviewed = await settleTestCommand(
      Bun.spawn(approvedLookup, {
        cwd: project,
        env: foundationEnvironment(),
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      }),
      { evidence: join(root, 'unreviewed-lookup'), timeoutMs: 30_000, graceMs: 10_000 },
    )
    expect(unreviewed.code).toBe(1)
    expect(unreviewed.stdout).toBe('')
    expect(unreviewed.stderr).toContain('No locally approved revision to search.')
    expect(existsSync(join(project, '.jig'))).toBe(false)
    await command([cli, 'review', '--yes', '--allow-resolution-network'], project)
    const greetingTest = await command([...bunTest, 'tests/greeting.test.ts'], project)
    expect(greetingTest.stderr).toContain('1 pass')
    const lock = await readFile(join(project, 'jig.lock'), 'utf8')
    const graph = await command([cli, 'inspect', '--flow', '--topology'], project)
    expect(graph.stdout).toContain('# Configured topology')
    expect(graph.stdout).toContain('flowchart LR')
    const methodPath = join(project, 'flows/hello/FLOW.ts')
    const originalMethod = await readFile(methodPath, 'utf8')
    await writeFile(methodPath, originalMethod + '\n// changed source basis\n')
    const current = JSON.parse(
      (await command([cli, 'inspect', '--flow', '--json'], project)).stdout,
    )
    const approvedTopology = JSON.parse(
      (
        await command(
          [cli, 'inspect', '--flow', 'flow:./flows/hello', '--approved', '--json'],
          project,
        )
      ).stdout,
    )
    expect(current.targets[0].flow.digest).not.toBe(originalTopology.targets[0].flow.digest)
    expect(approvedTopology.targets[0].flow.digest).toBe(originalTopology.targets[0].flow.digest)
    expect(approvedTopology.scope.target).toBe('flow:flows/hello')
    const approvedByFile = await command(
      [cli, 'inspect', '--flow', 'flows/hello/FLOW.ts', '--approved', '--json'],
      project,
    )
    expect(JSON.parse(approvedByFile.stdout)).toEqual(approvedTopology)
    const statePath = join(project, '.jig', 'jig.sqlite3')
    const state = await readFile(statePath)
    const metadataPath = join(project, 'flows/hello/FLOW.meta.json')
    const metadata = await readFile(metadataPath, 'utf8')
    await writeFile(
      metadataPath,
      JSON.stringify({ ...JSON.parse(metadata), description: 'Identify this working greeting.' }),
    )
    const liveLookup = await command(
      [cli, 'inspect', '--flow', '--find', 'working greeting'],
      project,
    )
    expect(liveLookup.stdout).toContain('flow:flows/hello · Identify this working greeting.')
    const retained = await command(approvedLookup, project)
    expect(retained.stdout).toContain(
      'Basis: last locally approved configuration. Revision ' + approvedTopology.revision + '.',
    )
    expect(retained.stdout).toContain('Current source and environment are unchecked.')
    expect(retained.stdout).toContain('flow:flows/hello · Greet the supplied string')
    expect(retained.stdout).toContain('jig inspect --flow --approved flow:flows/hello')
    expect(retained.stdout).not.toContain('Identify this working greeting.')
    await writeFile(metadataPath, metadata)
    const declarationPath = join(project, 'jig.ts')
    const declaration = await readFile(declarationPath)
    await writeFile(declarationPath, 'export default {')
    const invalidLookup = await settleTestCommand(
      Bun.spawn([cli, 'inspect', '--flow', '--find', 'supplied string'], {
        cwd: project,
        env: foundationEnvironment(),
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      }),
      { evidence: join(root, 'invalid-current-lookup'), timeoutMs: 30_000, graceMs: 10_000 },
    )
    expect(invalidLookup.code).toBe(1)
    expect(invalidLookup.stdout).toBe('')
    expect(invalidLookup.stderr).toContain('JIG_SOURCE_INSPECTION_FAILED')
    expect((await command(approvedLookup, project)).stdout).toBe(retained.stdout)
    await writeFile(declarationPath, declaration)
    expect(await readFile(statePath)).toEqual(state)
    expect(await readFile(join(project, 'jig.lock'), 'utf8')).toBe(lock)
    await writeFile(methodPath, originalMethod)

    for (const display of [[], ['--display', 'plain'], ['--json']]) {
      const result = await command(
        [cli, 'run', 'flow:flows/hello', '--input', '@tests/fixtures/greeting.json', ...display],
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
        'bun.lock',
        'node_modules',
        '.git',
        'flows/hello/bun.lock',
        'flows/hello/node_modules',
      ])
        expect(existsSync(join(project, path))).toBe(false)
      expect(await foundationResidue(qualification, command, root)).toEqual(before)
    }
    const packet = join(root, 'greeting-result')
    const written = JSON.parse(
      (
        await command(
          [
            cli,
            'run',
            'flow:flows/hello',
            '--input',
            JSON.stringify('Ada'),
            '--out',
            packet,
            '--json',
          ],
          project,
        )
      ).stdout,
    )
    const saved = JSON.parse(
      (await command([cli, 'inspect', '--result', packet, '--json'], root)).stdout,
    )
    expect(saved.runId).toBe(written.runId)
    expect(saved.status).toBe('succeeded')
    expect(saved.output).toEqual({ message: 'Hello, Ada!' })
    expect(saved.delivery.files).toEqual([])
    const database = Database.open(
      join(project, '.jig/jig.sqlite3'),
      constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW,
    )
    try {
      const limits = database
        .query<{ artifact_limit: number; result_limit: number }, [string]>(
          'SELECT artifact_limit, result_limit FROM prepared_attempts WHERE run_id = ?1',
        )
        .get(written.runId)
      expect(limits).toEqual({ artifact_limit: 0, result_limit: 1_048_576 })
    } finally {
      database.close()
    }
    await checkInstalledFlowBehavior(cli, join(root, 'behavior'), command)
    expect(await foundationResidue(qualification, command, root)).toEqual(before)
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
    // The explorer consumes an ordinary reviewed project through the installed
    // launcher. The held input makes cancellation an actual contained Run.
    await writeFile(
      join(project, 'flows/hello/FLOW.contract.json'),
      JSON.stringify({
        $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
        input: { type: 'string' },
      }),
    )
    await writeFile(
      join(project, 'flows/hello/FLOW.ts'),
      [
        'import { handle } from "@jigging/flow";',
        'await handle(async (run) => {',
        '  if (run.input === "Hold") await new Promise((resolve) => setTimeout(resolve, 30_000));',
        '  return { outcome: "done", output: { message: `Hello, ${run.input}!` } };',
        '});',
        '',
      ].join('\n'),
    )
    await command([cli, 'review', '--yes', '--allow-resolution-network'], project)
    const explored = await command(
      [
        process.env.PYTHON ?? 'python3',
        join(import.meta.dir, '../fixtures/installed-explore.py'),
        cli,
      ],
      project,
      240_000,
    )
    expect(JSON.parse(explored.stdout)).toEqual({
      passed: true,
      checks: [
        'approved-map-before-run',
        'invalid-input-without-launch',
        'stale-approval-refusal',
        'refresh-after-review',
        'ordinary-live-inspector',
        'duplicate-request-no-replay',
        'closed-inspector-run-again',
        'sequential-run-owners',
        'busy-request-lookup',
        'active-close-cancellation',
        'joined-explorer-exit',
        'settled-terminal-interruption',
        'active-terminal-interruption',
        'uncertainty-after-refusal',
      ],
    })
    expect(explored.stderr).toBe('')
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
