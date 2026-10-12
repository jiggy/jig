import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MACOS_FIXTURE_RUN_MS,
  MACOS_FIXTURE_SETTLEMENT_MS,
} from '../fixtures/agent-fixture-host.js'
import { settleTestCommand } from '../fixtures/bounded-command.js'
import {
  assertDeliveredPacket,
  assertExplicitObservation,
  assertTypedObservation,
  lostObservation,
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

test('installed typed views preserve clean and lost automatic and explicit observation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-observation-consumer-'))
  const project = join(directory, 'project')
  const tooling = join(directory, 'tooling')
  const artifacts = join(directory, 'artifacts')
  const evidence = join(directory, 'commands')
  const packageRoot = join(testRoot, '..')
  let passed = false
  let sequence = 0
  await mkdir(evidence)
  const command = (args: string[], cwd: string, phase: FixtureTimingPhase) =>
    timeFixturePhase('installed-observation', phase, async () => {
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
    const flow = join(project, 'flows/witness')
    await mkdir(flow, { recursive: true })
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        workspaces: ['flows/*', 'libs/*'],
      }),
    )
    for (const [name, variable] of [
      ['flow-sdk', 'FLOW_SDK_PACKAGE_ARCHIVE'],
      ['reporting', 'REPORTING_PACKAGE_ARCHIVE'],
    ] as const) {
      const library = join(project, 'libs', name)
      await mkdir(library, { recursive: true })
      await command(
        ['tar', '-xzf', await archive(name, variable), '--strip-components=1', '-C', library],
        project,
        'archive-extract',
      )
    }
    await cp(join(project, 'libs/reporting/dist/reporting.json'), join(flow, 'reporting.json'))
    await writeFile(
      join(flow, 'package.json'),
      JSON.stringify({
        name: 'ordinary-observation-witness',
        private: true,
        type: 'module',
        dependencies: { '@jigging/flow': 'workspace:*', '@jigging/reporting': 'workspace:*' },
      }),
    )
    await writeFile(
      join(flow, 'FLOW.contract.json'),
      JSON.stringify({
        $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
        id: 'https://example.org/contracts/observation-witness',
        version: '1.0.0',
        input: {
          type: 'object',
          properties: { mode: { enum: ['clean', 'lagged', 'hold'] } },
          required: ['mode'],
          additionalProperties: false,
        },
        channels: {
          progress: {
            direction: 'send',
            required: false,
            delivery: 'broadcast',
            contract: './reporting.json',
          },
        },
        attachments: { deliverables: 'read-write' },
      }),
    )
    await writeFile(
      join(flow, 'FLOW.ts'),
      `import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {handle} from '@jigging/flow';
import {withReporting} from '@jigging/reporting';
await handle(async run => {
 const evidence='Ordinary result and delivered evidence remain independent of optional observation.\\n';
 await writeFile(join(run.attachments.deliverables.path,'evidence.txt'),evidence,{flag:'wx'});
 if(run.input.mode==='hold') {
  const sender=run.channels.progress;
  if(!sender||sender.direction!=='send')throw new Error('The witness requires its selected observer');
  await sender.send({kind:'notice',text:'Interrupt witness ready.',severity:'info'});
  await new Promise(()=>{});
 }
 const views=[['jobs','Jobs'],['checks','Checks'],['patches','Patches']].map(([id,title])=>({kind:'view',id,title,summary:'Witness '+title+': evidence written',sections:[{blocks:[{kind:'facts',items:[{label:'Evidence',value:{kind:'artifact',attachment:'deliverables',path:'evidence.txt'}}]}]}]}));
 if(run.input.mode==='clean') await withReporting(run,'progress',async updates=>{
  for(const view of views) updates.view(view.id,{title:view.title}).update({summary:view.summary,sections:view.sections});
 });
 else {
  const sender=run.channels.progress;
  if(!sender||sender.direction!=='send')throw new Error('The witness requires its selected observer');
  for(const view of views) await sender.send(view);
  await sender.close({error:'LAGGED'});
 }
 return {outcome:'done',output:{mode:run.input.mode,evidence:'evidence.txt'}};
});`,
    )
    await writeFile(
      join(project, 'jig.ts'),
      "import {defineJig,discover} from '@jigging/jig';export default defineJig({flows:discover('flows')});",
    )
    await command(
      [process.execPath, 'install', '--ignore-scripts', '--backend', 'copyfile'],
      project,
      'project-install',
    )
    await command(
      [installed, 'review', '--yes', '--allow-resolution-network', '--allow-authority-changes'],
      project,
      'review',
    )
    for (const reception of ['automatic', 'explicit'] as const) {
      for (const mode of ['clean', 'lagged'] as const) {
        const destination = `witness-${reception}-${mode}`
        const stdout = await command(
          [
            installed,
            'run',
            'flow:flows/witness',
            '--input',
            JSON.stringify({ mode }),
            '--out',
            destination,
            ...(reception === 'explicit'
              ? ['--receive', 'progress', '--json']
              : ['--display', 'plain']),
            '--timeout',
            `${MACOS_FIXTURE_RUN_MS}ms`,
          ],
          project,
          `run-${reception}-${mode}`,
        )
        const explicit = reception === 'explicit' ? assertExplicitObservation(stdout) : undefined
        const terminal = explicit?.terminal ?? JSON.parse(stdout)
        expect(terminal).toMatchObject({
          status: 'succeeded',
          outcome: 'done',
          output: { mode, evidence: 'evidence.txt' },
          delivery: { status: 'written' },
        })
        await assertDeliveredPacket(terminal, project, destination, ['evidence.txt'])
        const delivered = await readFile(join(project, destination, 'files/evidence.txt'))
        expect(delivered.toString()).toBe(
          'Ordinary result and delivered evidence remain independent of optional observation.\n',
        )
        if (explicit) {
          expect(explicit.status).toBe(mode === 'clean' ? 'closed' : 'lagged')
          const expectedViews = ['jobs', 'checks', 'patches'].map((id) => {
            const title = id[0].toUpperCase() + id.slice(1)
            return {
              kind: 'view',
              id,
              title,
              summary: `Witness ${title}: evidence written`,
              sections: [
                {
                  blocks: [
                    {
                      kind: 'facts',
                      items: [
                        {
                          label: 'Evidence',
                          value: {
                            kind: 'artifact',
                            attachment: 'deliverables',
                            path: 'evidence.txt',
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            }
          })
          if (mode === 'clean') expect(explicit.updates).toEqual(expectedViews)
          else {
            expect(explicit.updates.length).toBeLessThanOrEqual(expectedViews.length)
            expect(explicit.updates).toEqual(expectedViews.slice(0, explicit.updates.length))
          }
        } else {
          const transcript = await readFile(join(evidence, `${sequence}.stderr`), 'utf8')
          expect(transcript).not.toContain('\u001b')
          expect(transcript).not.toContain('Updates unavailable')
          expect(transcript).not.toContain('DISCONNECTED')
          expect(
            assertTypedObservation(
              transcript,
              Object.fromEntries(
                ['Jobs', 'Checks', 'Patches'].map((title) => [
                  title,
                  [
                    `Witness ${title}: evidence written`,
                    `Witness ${title}: evidence written`,
                  ] as const,
                ]),
              ),
              await realpath(join(project, destination)),
            ),
          ).toBe(mode === 'clean' ? 'ended' : 'lagged')
          if (mode === 'clean') {
            expect(transcript).toContain('  Flow: Jobs\n    Witness Jobs: evidence written\n')
            expect(transcript).toContain(
              '  Flow / Jobs: Observation ended; application reports remain provisional\n',
            )
            expect(transcript.split('Witness Jobs: evidence written')).toHaveLength(2)
            expect(transcript).not.toContain('observation incomplete')
            expect(transcript).not.toContain('LAGGED')
          } else {
            expect(transcript).toContain(
              `  Jig — observation incomplete:\n      Flow: ${lostObservation}\n`,
            )
            expect(transcript).not.toContain('Observation ended')
          }
        }
      }
    }
    await timeFixturePhase('installed-observation', 'run-interrupted', async () => {
      const child = Bun.spawn(
        [
          installed,
          'run',
          'flow:flows/witness',
          '--input',
          JSON.stringify({ mode: 'hold' }),
          '--out',
          'witness-interrupted',
          '--receive',
          'progress',
          '--json',
          '--timeout',
          `${MACOS_FIXTURE_RUN_MS}ms`,
        ],
        {
          cwd: project,
          env: { ...process.env, NO_COLOR: '1' },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const beginning = { type: 'begin', channel: 'progress', startSequence: 1 }
      const readiness = {
        type: 'data',
        channel: 'progress',
        sequence: 1,
        value: { kind: 'notice', text: 'Interrupt witness ready.', severity: 'info' },
      }
      let began = false
      let interruptSent = false
      let pending = ''
      let observedBytes = 0
      const decoder = new TextDecoder('utf-8', { fatal: true })
      // Readiness comes from the installed CLI's actual selected stream. The
      // transform forwards every original byte to the same bounded collector;
      // there is no second reader, guessed delay or Flow-private state probe.
      const stdout = child.stdout.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, output) {
            output.enqueue(chunk)
            if (interruptSent) return
            observedBytes += chunk.byteLength
            if (observedBytes > 8192)
              throw new Error('Interrupted witness readiness exceeded its bound')
            pending += decoder.decode(chunk, { stream: true })
            for (;;) {
              const newline = pending.indexOf('\n')
              if (newline === -1) return
              const record = JSON.parse(pending.slice(0, newline))
              pending = pending.slice(newline + 1)
              if (!began) {
                expect(record).toEqual(beginning)
                began = true
              } else {
                expect(record).toEqual(readiness)
                child.kill('SIGINT')
                interruptSent = true
                return
              }
            }
          },
          flush() {
            if (!interruptSent)
              throw new Error('Interrupted witness never reached observed readiness')
          },
        }),
      )
      const cancelled = await settleTestCommand(
        {
          exited: child.exited,
          stdout,
          stderr: child.stderr,
          kill: (signal) => child.kill(signal),
        },
        {
          evidence: join(evidence, String(++sequence)),
          timeoutMs: MACOS_FIXTURE_SETTLEMENT_MS,
        },
      )
      expect(interruptSent).toBeTrue()
      expect(cancelled.code, cancelled.stdout + cancelled.stderr).toBe(2)
      expect(cancelled.stdout.endsWith('\n')).toBeTrue()
      const records = cancelled.stdout
        .slice(0, -1)
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(records).toHaveLength(4)
      expect(records[0]).toEqual(beginning)
      expect(records[1]).toEqual(readiness)
      const end = records[2]
      if (end.status === 'closed')
        expect(end).toEqual({ type: 'end', channel: 'progress', status: 'closed', lastSequence: 1 })
      else {
        expect(['CANCELLED', 'DISCONNECTED']).toContain(end.code)
        expect(end).toEqual({ type: 'end', channel: 'progress', status: 'failed', code: end.code })
      }
      expect(Object.keys(records[3]).sort()).toEqual(['result', 'type'])
      expect(records[3].type).toBe('terminal')
      const terminal = records[3].result
      expect(terminal).toMatchObject({
        status: 'failed',
        code: 'CANCELLED',
        command: { status: 'interrupted' },
        delivery: { status: 'written', source: 'none', files: [] },
      })
      expect(terminal.cleanup).toBeUndefined()
      expect(typeof terminal.runId).toBe('string')
      expect(terminal.runId.length).toBeGreaterThan(0)
      await assertDeliveredPacket(terminal, project, 'witness-interrupted', [])
      for (const reception of ['automatic', 'explicit']) {
        for (const mode of ['clean', 'lagged']) {
          const prior = JSON.parse(
            await readFile(join(project, `witness-${reception}-${mode}`, 'result.json'), 'utf8'),
          )
          expect(terminal.runId).not.toBe(prior.runId)
        }
      }
    })
    passed = true
  } finally {
    if (passed) await rm(directory, { recursive: true, force: true })
    else console.error(`Ordinary observation evidence retained at ${directory}`)
  }
}, 600_000)
