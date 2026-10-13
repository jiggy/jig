import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  MACOS_FIXTURE_RUN_MS,
  MACOS_FIXTURE_SETTLEMENT_MS,
} from '../fixtures/agent-fixture-host.js'
import { settleTestCommand } from '../fixtures/bounded-command.js'
import {
  assertDeliveredPacket,
  assertEvaluation,
  assertExplicitObservation,
  assertFactoryPrefix,
  assertRequestedJob,
  assertTypedObservation,
} from '../fixtures/factory-observation.js'
import { type FixtureTimingPhase, timeFixturePhase } from '../fixtures/phase-timing.js'

if (
  !(
    (process.platform === 'linux' && process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1') ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  )
) {
  throw new Error(
    'This suite requires JIG_LINUX_ROOTLESS_HOSTILE=1 on Linux or JIG_MACOS_PROCESS_TEST=1 on macOS',
  )
}

const testRoot = join(import.meta.dir, '..')

test('installed software factory delivers complete blocked and checked dashboard views', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-factory-consumer-'))
  const project = join(directory, 'project')
  const tooling = join(directory, 'tooling')
  const artifacts = join(directory, 'artifacts')
  const evidence = join(directory, 'commands')
  const packageRoot = join(testRoot, '..')
  const example = join(packageRoot, '../../examples/software-factory')
  const requestedJobs = JSON.parse(await readFile(join(example, 'batch.json'), 'utf8')).jobs
  let passed = false
  let sequence = 0
  await mkdir(evidence)
  const command = (args: string[], cwd: string, phase: FixtureTimingPhase) =>
    timeFixturePhase('installed-factory', phase, async () => {
      const child = Bun.spawn(args, {
        cwd,
        env: { ...process.env, NO_COLOR: '1' },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const result = await settleTestCommand(child, {
        evidence: join(evidence, String(++sequence)),
        timeoutMs: MACOS_FIXTURE_SETTLEMENT_MS,
      })
      expect(result.code, result.stdout + result.stderr).toBe(0)
      return result.stdout
    })
  const archive = async (name: string, variable: string) => {
    const supplied = process.env[variable]
    if (supplied) return supplied
    const destination = join(artifacts, name)
    await mkdir(destination, { recursive: true })
    await command(
      name === 'jig'
        ? [process.execPath, 'scripts/pack.ts', '--destination', destination]
        : [process.execPath, 'pm', 'pack', '--ignore-scripts', '--destination', destination],
      join(packageRoot, '..', name),
      'archive-pack',
    )
    const manifest = JSON.parse(
      await readFile(join(packageRoot, '..', name, 'package.json'), 'utf8'),
    )
    return join(
      destination,
      `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`,
    )
  }
  try {
    await mkdir(tooling)
    await writeFile(
      join(tooling, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: { '@jigging/jig': `file:${await archive('jig', 'JIG_PACKAGE_ARCHIVE')}` },
      }),
    )
    await command(
      [process.execPath, 'install', '--ignore-scripts', '--backend', 'copyfile'],
      tooling,
      'tooling-install',
    )
    const installed = join(tooling, 'node_modules/.bin/jig')
    // Copy the authored application unchanged. Only operator composition is
    // replaced with a deterministic public Flow; no native client or model.
    await cp(example, project, {
      recursive: true,
      filter: (source) =>
        !['.jig', '.git', 'node_modules', 'factory-result'].includes(basename(source)),
    })
    const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
    manifest.workspaces.push('libs/*')
    await writeFile(join(project, 'package.json'), JSON.stringify(manifest))
    for (const [name, variable] of [
      ['flow-sdk', 'FLOW_SDK_PACKAGE_ARCHIVE'],
      ['user-updates', 'USER_UPDATES_PACKAGE_ARCHIVE'],
      ['agent-method', 'AGENT_METHOD_PACKAGE_ARCHIVE'],
      ['agent-acp', 'AGENT_ACP_PACKAGE_ARCHIVE'],
    ] as const) {
      const library = join(project, 'libs', name)
      await mkdir(library, { recursive: true })
      await command(
        ['tar', '-xzf', await archive(name, variable), '--strip-components=1', '-C', library],
        project,
        'archive-extract',
      )
    }
    const peer = join(project, 'flows/test-agent')
    await mkdir(peer)
    await cp(join(project, 'flows/repair/contracts/agent-run'), peer, { recursive: true })
    await writeFile(join(peer, 'FLOW.contract.json'), await readFile(join(peer, 'contract.json')))
    await writeFile(
      join(peer, 'package.json'),
      JSON.stringify({
        name: 'factory-test-agent',
        private: true,
        type: 'module',
        dependencies: { '@jigging/flow': 'workspace:*' },
      }),
    )
    const cause = 'Deterministic test peer declined to propose a patch.'
    await writeFile(
      join(peer, 'FLOW.ts'),
      `import {handle} from '@jigging/flow'; await handle(async () => ({outcome:'blocked',output:{text:${JSON.stringify(cause)}}}));`,
    )
    await writeFile(
      join(project, 'bindings/agent.ts'),
      "import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'flows/test-agent'});",
    )
    await command(
      [process.execPath, 'install', '--ignore-scripts', '--backend', 'copyfile'],
      project,
      'project-install',
    )
    await command(
      [installed, 'review', '--yes', '--allow-resolution-network', '--allow-authority-changes'],
      project,
      'review-blocked',
    )
    // Admitted bytes must suffice even when the editable sibling disappears.
    await rm(join(project, 'flows/repair'), { recursive: true })
    const stdout = await command(
      [
        installed,
        'run',
        '--out',
        'factory-result',
        '--receive',
        'progress',
        '--json',
        '--timeout',
        `${MACOS_FIXTURE_RUN_MS}ms`,
      ],
      project,
      'run-blocked',
    )
    const blocked = assertExplicitObservation(stdout)
    const terminal = blocked.terminal
    expect(terminal).toMatchObject({
      status: 'succeeded',
      outcome: 'blocked',
      delivery: { status: 'written' },
    })
    expect(terminal.output.jobs.map((job) => job.id)).toEqual(['logs', 'timesheet'])
    expect(terminal.output.overlaps).toEqual([])
    const blockedFiles = [
      'summary.txt',
      ...['logs', 'timesheet'].flatMap((id) =>
        ['goal.txt', 'summary.txt'].map((file) => `${id}/${file}`),
      ),
    ]
    await assertDeliveredPacket(terminal, project, 'factory-result', blockedFiles)
    for (const job of terminal.output.jobs) {
      assertRequestedJob(
        job,
        requestedJobs.find((requested) => requested.id === job.id),
      )
      expect(job).toMatchObject({
        status: 'settled',
        ready: false,
        result: { outcome: 'blocked', output: { reason: cause, attempts: [] } },
      })
      const cases = JSON.parse(
        await readFile(join(example, 'flows/factory', `${job.id}-cases.json`), 'utf8'),
      )
      assertEvaluation(job.result.output.baseline, cases, false)
      expect(job.result.output.baseline.acceptance.filter((item) => item.passed)).toHaveLength(
        job.id === 'logs' ? 1 : 2,
      )
      expect(
        await readFile(join(project, 'factory-result/files', job.id, 'goal.txt'), 'utf8'),
      ).toBe(job.issue)
      const summary = await readFile(
        join(project, 'factory-result/files', job.id, 'summary.txt'),
        'utf8',
      )
      expect(summary).toContain(cause)
      expect(summary).toContain('0 validated proposal(s)')
      expect(summary).not.toContain('Review files/')
    }
    expect(await readFile(join(project, 'factory-result/files/summary.txt'), 'utf8')).toContain(
      cause,
    )
    const updates = blocked.updates
    assertFactoryPrefix(updates, 'blocked', requestedJobs)
    if (blocked.status === 'closed') {
      for (const id of ['jobs', 'checks', 'patches'])
        expect(updates.some((update) => update.kind === 'view' && update.id === id)).toBe(true)
      const finalJobs = updates
        .filter((update) => update.kind === 'view' && update.id === 'jobs')
        .at(-1)
      expect(finalJobs.sections[0].blocks[0]).toMatchObject({ completed: 2, total: 2 })
      const finalChecks = updates
        .filter((update) => update.kind === 'view' && update.id === 'checks')
        .at(-1)
      expect(JSON.stringify(finalChecks)).not.toContain('Pending independent verification')
      expect(JSON.stringify(finalChecks)).toContain('No checked patch')
      const finalPatches = updates
        .filter((update) => update.kind === 'view' && update.id === 'patches')
        .at(-1)
      expect(finalPatches.summary).toContain('0 independently checked candidates')
      expect(
        updates.some(
          (update) =>
            update.kind === 'view' &&
            update.id === 'jobs' &&
            JSON.stringify(update).includes('Requested goal:'),
        ),
      ).toBe(true)
      const retainedChecks = JSON.stringify(finalChecks.sections)
      expect(retainedChecks).toContain('Repository test command failed.')
      expect(retainedChecks).toContain('Independent acceptance cases: 1/4 passed.')
      expect(retainedChecks).toContain('Independent acceptance cases: 2/4 passed.')
      expect(retainedChecks).toContain('Observed commands:')
      expect(
        updates.some(
          (update) => update.kind === 'notice' && update.text.includes('Baseline check report:'),
        ),
      ).toBe(true)
    }
    // A second reviewed ordinary peer returns deterministic fixture repairs.
    // The factory source, test commands and independent assertions stay unchanged.
    await cp(join(example, 'flows/repair'), join(project, 'flows/repair'), {
      recursive: true,
      filter: (source) => basename(source) !== 'node_modules',
    })
    await writeFile(
      join(peer, 'FLOW.ts'),
      `import {handle} from '@jigging/flow';
await handle(async run => {
 const instructions=run.input.instructions;
 const input=JSON.parse(instructions.slice(instructions.indexOf('\\n')+1));
 const replacements=input.editPaths.map(path=>{
   let content=input.files[path];
   if(path==='src/parse.ts'&&content.includes('parseTime')) content=content.replace('if (hour > 23)','if (hour > 23 || minute > 59)');
   else if(path==='src/parse.ts') content=content.replace("typeof value.status !== 'number'", "typeof value.status !== 'number' || !Number.isInteger(value.status) || value.status < 100 || value.status > 599");
   if(path==='src/report.ts') content=content.replace('r.status >= 400).length','r.status >= 500 && r.status < 600).length');
   if(path==='src/total.ts') content=content.replace('Math.max(0, shift.end - shift.start)','(shift.end - shift.start + 1440) % 1440');
   return {path,content};
 });
 return {outcome:'done',output:{text:'Deterministic fixture correction',structured:{summary:'Deterministic fixture correction',replacements}}};
});`,
    )
    await command(
      [installed, 'review', '--yes', '--allow-resolution-network', '--allow-authority-changes'],
      project,
      'review-checked',
    )
    const checked = assertExplicitObservation(
      await command(
        [
          installed,
          'run',
          '--out',
          'factory-checked',
          '--receive',
          'progress',
          '--json',
          '--timeout',
          `${MACOS_FIXTURE_RUN_MS}ms`,
        ],
        project,
        'run-checked',
      ),
    )
    const checkedTerminal = checked.terminal
    expect(checkedTerminal).toMatchObject({
      status: 'succeeded',
      outcome: 'done',
      delivery: { status: 'written' },
    })
    expect(checkedTerminal.output.jobs.map((job) => job.id)).toEqual(['logs', 'timesheet'])
    expect(checkedTerminal.output.overlaps).toEqual([])
    const checkedFiles = [
      'summary.txt',
      ...['logs', 'timesheet'].flatMap((id) =>
        ['goal.txt', 'summary.txt', 'proposal-1.patch', 'review.patch'].map(
          (file) => `${id}/${file}`,
        ),
      ),
    ]
    await assertDeliveredPacket(checkedTerminal, project, 'factory-checked', checkedFiles)
    for (const job of checkedTerminal.output.jobs) {
      assertRequestedJob(
        job,
        requestedJobs.find((requested) => requested.id === job.id),
      )
      expect(job).toMatchObject({
        status: 'settled',
        ready: true,
        verification: { proposal: 1, changedPaths: job.editPaths },
      })
      const cases = JSON.parse(
        await readFile(join(example, 'flows/factory', `${job.id}-cases.json`), 'utf8'),
      )
      expect(job.verification.acceptanceCases).toEqual(cases.map((item) => item.id))
      assertEvaluation(job.result.output.baseline, cases, false)
      expect(job.result.output.attempts).toHaveLength(1)
      assertEvaluation(job.result.output.attempts[0].evaluation, cases, true)
      expect(
        await readFile(join(project, 'factory-checked/files', job.id, 'goal.txt'), 'utf8'),
      ).toBe(job.issue)
      const patch = await readFile(
        join(project, 'factory-checked/files', job.id, 'review.patch'),
        'utf8',
      )
      for (const path of job.editPaths) expect(patch).toContain(`--- a/${path}`)
      expect(patch).toBe(
        await readFile(join(project, 'factory-checked/files', job.id, 'proposal-1.patch'), 'utf8'),
      )
      expect(
        await readFile(join(project, 'factory-checked/files', job.id, 'summary.txt'), 'utf8'),
      ).toContain('1 validated proposal(s)')
    }
    expect(await readFile(join(project, 'factory-checked/files/summary.txt'), 'utf8')).toContain(
      'Patches were checked separately, not as a combined change. Review before applying.',
    )
    const checkedUpdates = checked.updates
    assertFactoryPrefix(checkedUpdates, 'checked', requestedJobs)
    if (checked.status === 'closed') {
      expect(
        checkedUpdates.filter((update) => update.kind === 'view' && update.id === 'jobs').at(-1)
          .summary,
      ).toContain('2 independently checked patches')
      expect(
        JSON.stringify(
          checkedUpdates
            .filter((update) => update.kind === 'view' && update.id === 'checks')
            .at(-1),
        ),
      ).toContain('Passed; independently verified')
      const patches = checkedUpdates
        .filter((update) => update.kind === 'view' && update.id === 'patches')
        .at(-1)
      expect(patches.summary).toContain('2 independently checked candidates')
      expect(patches.sections[0].blocks[0].rows.map((row) => row.cells.patch)).toEqual([
        { kind: 'artifact', attachment: 'deliverables', path: 'logs/review.patch' },
        { kind: 'artifact', attachment: 'deliverables', path: 'timesheet/review.patch' },
      ])
    }
    const plain = JSON.parse(
      await command(
        [
          installed,
          'run',
          '--out',
          'factory-auto',
          '--display',
          'plain',
          '--timeout',
          `${MACOS_FIXTURE_RUN_MS}ms`,
        ],
        project,
        'run-automatic',
      ),
    )
    expect(plain).toMatchObject({
      status: 'succeeded',
      outcome: 'done',
      delivery: { status: 'written' },
    })
    expect(plain.output.jobs.every((job) => job.ready === true)).toBe(true)
    expect(plain.output.summary).toContain('2 of 2 jobs produced a checked patch for review.')
    expect(plain.output.jobs).toHaveLength(2)
    expect(plain.output.jobs.map((job) => job.id)).toEqual(['logs', 'timesheet'])
    expect(plain.output.jobs.map(({ result: _result, ...evidence }) => evidence)).toEqual(
      checkedTerminal.output.jobs.map(({ result: _result, ...evidence }) => evidence),
    )
    expect(plain.output.overlaps).toEqual([])
    const automaticSummary = await readFile(join(project, 'factory-auto/files/summary.txt'), 'utf8')
    expect(automaticSummary).toBe(
      await readFile(join(project, 'factory-checked/files/summary.txt'), 'utf8'),
    )
    expect(automaticSummary).toContain(
      'Patches were checked separately, not as a combined change. Review before applying.',
    )
    const expectedFiles = [
      'summary.txt',
      ...['logs', 'timesheet'].flatMap((id) =>
        ['goal.txt', 'proposal-1.patch', 'review.patch', 'summary.txt'].map(
          (file) => `${id}/${file}`,
        ),
      ),
    ].sort()
    await assertDeliveredPacket(plain, project, 'factory-auto', expectedFiles)
    for (const file of plain.delivery.files) {
      const delivered = await readFile(join(project, 'factory-auto/files', file.path))
      expect(delivered.byteLength).toBe(file.bytes)
      expect(`sha256:${createHash('sha256').update(delivered).digest('hex')}`).toBe(file.digest)
      expect(delivered).toEqual(await readFile(join(project, 'factory-checked/files', file.path)))
    }
    for (const job of plain.output.jobs) {
      expect(job).toMatchObject({
        status: 'settled',
        ready: true,
        verification: {
          proposal: 1,
          changedPaths: job.editPaths,
          acceptanceCases: JSON.parse(
            await readFile(join(example, 'flows/factory', `${job.id}-cases.json`), 'utf8'),
          ).map((item) => item.id),
        },
      })
      expect(job.result.output.attempts[0].evaluation.repositoryTestsPassed).toBe(true)
      expect(job.result.output.attempts[0].evaluation.acceptance).toHaveLength(4)
      expect(
        job.result.output.attempts[0].evaluation.acceptance.every((item) => item.passed === true),
      ).toBe(true)
      const reviewPatch = await readFile(
        join(project, 'factory-auto/files', job.id, 'review.patch'),
        'utf8',
      )
      for (const path of job.editPaths) expect(reviewPatch).toContain(`--- a/${path}`)
      expect(await readFile(join(project, 'factory-auto/files', job.id, 'goal.txt'), 'utf8')).toBe(
        job.issue,
      )
    }
    const transcript = await readFile(join(evidence, `${sequence}.stderr`), 'utf8')
    assertTypedObservation(transcript)
    passed = true
  } finally {
    if (passed) await rm(directory, { recursive: true, force: true })
    else console.error(`Software factory consumer evidence retained at ${directory}`)
  }
}, 600_000)
