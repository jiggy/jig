import { describe, expect, test } from 'bun:test'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { RootAdministration, StartRootRunReceipt } from '../src/administration/root.js'
import { openPrivateInstalledBunHost } from '../src/internal/installed-bun-host.js'
import {
  PrivateLinuxCgroupBackend,
  type PrivateLinuxCgroupBackendOptions,
  type PrivateLinuxConfirmedEnforcementReceipt,
  PrivateLinuxFenceUnconfirmedError,
  type PrivateLinuxSealedOwner,
  type PrivateLinuxSealedOwnerIdentity,
} from '../src/internal/linux-rootless-backend.js'
import { openPrivateProjectSession } from '../src/internal/project-session-controller.js'
import { checkPackageDirectory } from '../src/package/inspect.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'
import { writeOrdinaryAgent } from './fixtures/ordinary-agent.js'

const HOSTILE = process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1'
const proofDescribe = HOSTILE ? describe.serial : describe.skip
const agentProofTest = process.env.JIG_OPENAI_AGENT_PROOF === '1' ? test : test.skip
const initialRootlessTemporaryState = new Set(
  (await readdir(tmpdir())).filter(rootlessTemporaryEntry),
)
const initialRootlessCgroups = new Set(await rootlessCgroups())

describe('private foreground command boundary', () => {
  test('constructs current package declarations and parseable code for every contained fixture', async () => {
    const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun' })
    for (const construct of [
      writeProject,
      writeAgentFreeProject,
      writeAgentRouterProject,
      writeChannelProject,
      writeChildChannelProject,
      writeBroadcastChannelProject,
      writeBoundResourceProject,
    ]) {
      const root = await mkdtemp(join(tmpdir(), 'jig-foreground-fixture-'))
      try {
        await construct(root)
        for (const name of await readdir(join(root, 'flows'))) {
          const directory = join(root, 'flows', name)
          const inspected = await checkPackageDirectory(directory)
          expect(inspected.entrypoint).toMatchObject({ path: 'FLOW.ts', suffix: 'ts' })
          const source = await readFile(join(directory, 'FLOW.ts'), 'utf8')
          expect(() => transpiler.transformSync(source)).not.toThrow()
        }
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })

  test('requires explicit approval separately from a reviewed Plan', async () => {
    const failure = await invokeFailure(['apply', '.', '--plan', `sha256:${'0'.repeat(64)}`])
    expect(failure).toContain('apply requires explicit --yes approval')
  })

  test('constructs every named conversation peer', async () => {
    for (const peer of [
      'normal',
      'fahrenheit',
      'duplicate',
      'unexpected',
      'eof',
      'held',
    ] as const) {
      const root = await mkdtemp(join(tmpdir(), 'jig-conversation-fixture-'))
      try {
        await writeChannelConversationProject(root, peer)
        for (const name of ['investigate', 'analysis', 'dataset']) {
          const built = await Bun.build({
            entrypoints: [join(root, 'flows', name, 'FLOW.ts')],
            target: 'bun',
          })
          expect(built.success, String(built.logs)).toBeTrue()
        }
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })

  test('does not combine admission and root execution', async () => {
    expect(await invokeFailure(['run', '.', '--request'])).toContain('--request requires a value')
    expect(await invokeFailure(['apply-run'])).toContain('usage: private-foreground')
  })
})

proofDescribe('private rootless project session', () => {
  test('reviewed Binding resources run unchanged methods with immutable bytes, honest failure and cancellation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-bound-resource-consumer-'))
    try {
      await writeBoundResourceProject(root)
      const review = await invokeChannelCli(root, ['review', '--yes'])
      expect(review.code, review.stderr).toBe(0)
      expect(review.stdout).toContain('capturedAttachments')
      expect(review.stdout).toContain('tools/first')
      const lock = JSON.parse(await readFile(join(root, 'jig.lock'), 'utf8'))
      expect(lock.bindings.first.attachments.decoder.files).toHaveLength(1)
      // Neither changing nor removing originals may change an existing admission.
      await writeFile(join(root, 'tools/first/decode.ts'), 'throw new Error("unreviewed")')
      await rm(join(root, 'tools/second'), { recursive: true })
      for (const id of ['first', 'second']) {
        const result = await invokeChannelCli(root, [
          'run',
          `binding:${id}`,
          '--input',
          '"AP+ACg0B/g=="',
        ])
        expect(result.code, result.stderr + result.stdout).toBe(0)
        expect(JSON.parse(result.stdout)).toMatchObject({
          status: 'succeeded',
          outcome: 'done',
          output: { bytes: [0, 255, 128, 10, 13, 1, 254], immutable: true, hostAbsent: true },
        })
      }
      const override = await invokeChannelCli(root, [
        'run',
        'binding:first',
        '--attach',
        'decoder=tools/first',
      ])
      expect(override.code).not.toBe(0)
      expect(override.stderr).toContain('cannot be overridden')
      const failed = await invokeChannelCli(root, ['run', 'binding:first', '--input', '"bad"'])
      expect(JSON.parse(failed.stdout)).toMatchObject({
        status: 'succeeded',
        outcome: 'blocked',
        output: { exitCode: 2 },
      })
      let stopped = false
      const cancelled = await invokeChannelCli(
        root,
        ['run', 'binding:first', '--input', '"hold"'],
        {
          diagnostic(text, _running, cancel) {
            if (text.includes('bound-tool-started')) {
              stopped = true
              cancel()
            }
          },
        },
      )
      expect(stopped).toBeTrue()
      expect(cancelled.code).not.toBe(0)
      if (cancelled.stdout.trim()) expect(JSON.parse(cancelled.stdout).status).not.toBe('succeeded')
      await expectNoChildResidue(root)
      await waitForRootlessCgroups(initialRootlessCgroups)
      await waitForRootlessTemporaryState(initialRootlessTemporaryState)
      // An invalid recapture cannot silently replace the prior generation.
      const missing = await invokeChannelCli(root, ['review', '--yes'])
      expect(missing.code).not.toBe(0)
      expect(await readFile(join(root, 'jig.lock'), 'utf8')).toBe(JSON.stringify(lock) + '\n')
      for (const id of ['first', 'second'])
        await writeFile(
          join(root, 'bindings', id + '.ts'),
          "import { defineBinding } from '@jigging/jig'; export default defineBinding({ package: 'flows/decode' });",
        )
      const revoke = await invokeChannelCli(root, ['review', '--yes'])
      expect(revoke.code, revoke.stderr).toBe(0)
      const refused = await invokeChannelCli(root, [
        'run',
        'binding:first',
        '--input',
        '"AP+ACg0B/g=="',
      ])
      expect(refused.code).not.toBe(0)
      expect(refused.stderr).toContain('unbound read attachments')
      await waitForRootlessCgroups(initialRootlessCgroups)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 300_000)

  test('installed dataset conversation preserves named meaning, correlated results, and cancellation', async () => {
    for (const peer of [
      'normal',
      'fahrenheit',
      'duplicate',
      'unexpected',
      'eof',
      'held',
    ] as const) {
      const root = await mkdtemp(join(tmpdir(), `jig-private-dataset-${peer}-`))
      try {
        await writeChannelConversationProject(root, peer)
        const reviewed = await invokeChannelCli(root, ['review', '--yes'])
        expect(reviewed.code, peer + ':' + reviewed.stderr + reviewed.stdout).toBe(0)
        let interrupted = false
        let diagnostics = ''
        const run = await invokeChannelCli(
          root,
          ['run', 'binding:analysis', '--input', '@input.json', '--timeout', '1m'],
          {
            diagnostic(text, running, cancel) {
              diagnostics += text
              if (peer === 'held' && running && diagnostics.includes('dataset-outstanding')) {
                interrupted = true
                cancel()
              }
            },
          },
        )
        if (peer === 'held') {
          expect(interrupted, run.stderr + run.stdout).toBeTrue()
          expect(run.code).not.toBe(0)
          // Cancellation may prevent terminal delivery; absence is not success.
          if (run.stdout.trim()) expect(JSON.parse(run.stdout).status).not.toBe('succeeded')
        } else {
          expect(run.code, peer + ':' + run.stderr + run.stdout).toBe(0)
          const terminal = JSON.parse(run.stdout)
          expect(terminal.status).toBe('succeeded')
          const output = terminal.output
          if (peer === 'normal') {
            const observations = [
              { sample: 's4', celsius: 31 },
              { sample: 's2', celsius: 23 },
              { sample: 's3', celsius: 26 },
            ]
            expect(terminal.outcome).toBe('done')
            expect(output.verification.accepted).toBeTrue()
            expect(output.crossing).toEqual({ sample: 's4', index: 4, celsius: 31 })
            expect(output.observations).toEqual(observations)
            expect(output.children.analysis).toMatchObject({
              outcome: 'done',
              output: { threshold: 30, observations },
            })
            expect(output.children.dataset).toEqual({
              outcome: 'done',
              output: { served: ['s4', 's2', 's3'] },
            })
            expect(new Set(output.children.dataset.output.served).size).toBe(3)
            expect(output.observations.length).toBeLessThanOrEqual(8)
          } else {
            expect(terminal.outcome).toBe('blocked')
            expect(output.verification.accepted).toBeFalse()
            if (peer === 'fahrenheit') {
              expect(output.failures.dataset).toBe('INVALID_INPUT')
              expect(output.children.dataset).toBeNull()
              expect(run.stderr).not.toContain('dataset-dispatched')
            } else {
              expect(run.stderr).toContain('dataset-dispatched')
              expect(output.children.analysis.outcome).toBe('blocked')
              const problem = output.children.analysis.output.problem
              expect(
                peer === 'eof'
                  ? problem === 'missing-reply'
                  : peer === 'unexpected'
                    ? problem === 'unexpected-reply'
                    : ['unexpected-reply', 'extra-reply'].includes(problem),
              ).toBeTrue()
              if (peer === 'duplicate')
                expect(output.observations).toEqual([{ sample: 's4', celsius: 31 }])
              if (peer === 'eof') {
                // A cleanly ended peer is not a completed analysis when it
                // never answers the controller's outstanding request. The
                // analysis's blocked result may cancel the peer before its
                // independent result settles.
                if (output.children.dataset === null)
                  expect(output.failures.dataset).toBe('CANCELLED')
                else
                  expect(output.children.dataset).toEqual({
                    outcome: 'done',
                    output: { served: [] },
                  })
              }
            }
          }
        }
        await expectNoChildResidue(root)
        expect(await directoryEntries(join(root, '.jig/private-root-linux-owners'))).toEqual([])
        await waitForRootlessCgroups(initialRootlessCgroups)
        await waitForRootlessTemporaryState(initialRootlessTemporaryState)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  }, 240_000)

  test('installed broadcast isolates a slow monitor while its worker and root recorder complete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-private-broadcast-cli-'))
    try {
      await writeBroadcastChannelProject(root)
      const reviewed = await invokeChannelCli(root, ['review', '--yes'])
      expect(reviewed.code, reviewed.stderr + reviewed.stdout).toBe(0)
      for (const mode of ['normal', 'lagged', 'schema', 'dispose']) {
        let live = false
        const result = await invokeChannelCli(
          root,
          [
            'run',
            'binding:composition',
            '--input',
            JSON.stringify({ mode }),
            '--receive',
            'progress',
          ],
          {
            record(record, running) {
              if (record.type === 'data') live ||= running
            },
          },
        )
        expect(result.code, mode + ':' + result.stderr + result.stdout).toBe(0)
        const records = result.stdout
          .trimEnd()
          .split('\n')
          .map((line) => JSON.parse(line))
        expect(records[0]).toEqual({ type: 'begin', channel: 'progress', startSequence: 1 })
        expect(records.at(-2)).toMatchObject({ type: 'end', channel: 'progress', status: 'closed' })
        const terminal = records.at(-1)
        expect(terminal).toMatchObject({ type: 'terminal', result: { status: 'succeeded' } })
        const output = terminal.result.output
        const count = mode === 'lagged' ? 20 : mode === 'schema' ? 2 : 1
        expect(output.worker).toEqual({ outcome: 'done', output: { completed: true, sent: count } })
        expect(output.recorded).toHaveLength(count)
        expect(
          records.filter((record) => record.type === 'data').map((record) => record.value),
        ).toEqual(output.recorded)
        expect(live).toBeTrue()
        expect(output.monitor.output.incomplete).toBe(
          mode === 'lagged' ? 'LAGGED' : mode === 'schema' ? 'INVALID_INPUT' : null,
        )
        expect(output.monitor.output.count).toBe(mode === 'normal' ? 1 : 0)
        expect(output.monitor.output.disposed).toBe(mode === 'dispose')
        await expectNoChildResidue(root)
        await waitForRootlessCgroups(initialRootlessCgroups)
        await waitForRootlessTemporaryState(initialRootlessTemporaryState)
      }
      let interrupted = false
      const stopped = await invokeChannelCli(
        root,
        [
          'run',
          'binding:composition',
          '--input',
          JSON.stringify({ mode: 'cancel' }),
          '--receive',
          'progress',
        ],
        {
          record(record, _running, cancel) {
            if (record.type === 'data' && !interrupted) {
              interrupted = true
              cancel()
            }
          },
        },
      )
      expect(interrupted).toBeTrue()
      expect(stopped.code).not.toBe(0)
      for (const line of stopped.stdout.trimEnd().split('\n')) {
        const record = JSON.parse(line)
        if (record.type === 'terminal') expect(record.result.status).not.toBe('succeeded')
      }
      await expectNoChildResidue(root)
      await waitForRootlessCgroups(initialRootlessCgroups)
      await waitForRootlessTemporaryState(initialRootlessTemporaryState)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 240_000)

  test('installed sibling channels preserve exact admission, leaf results, and independent cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-private-child-channel-cli-'))
    try {
      await writeChildChannelProject(root)
      const reviewed = await invokeChannelCli(root, ['review', '--yes'])
      expect(reviewed.code, reviewed.stderr + reviewed.stdout).toBe(0)
      for (const mode of [
        'success',
        'mismatch',
        'monitor-fail',
        'monitor-cancel',
        'early-monitor-fail',
        'invalid-result',
      ]) {
        let sawLiveData = false
        const result = await invokeChannelCli(
          root,
          [
            'run',
            'binding:composition',
            '--input',
            JSON.stringify({ mode }),
            '--receive',
            'progress',
          ],
          {
            record(record, running) {
              if (record.type === 'data') sawLiveData ||= running
            },
          },
        )
        expect(result.code, mode + ':' + result.stderr + result.stdout).toBe(0)
        const records = result.stdout
          .trimEnd()
          .split('\n')
          .map((line) => JSON.parse(line))
        expect(records[0]).toEqual({ type: 'begin', channel: 'progress', startSequence: 1 })
        expect(records.at(-2)).toMatchObject({ type: 'end', channel: 'progress', status: 'closed' })
        const terminal = records.at(-1)
        expect(terminal).toMatchObject({ type: 'terminal', result: { status: 'succeeded' } })
        const output = terminal.result.output
        if (mode === 'invalid-result') {
          expect(output.worker).toEqual({ error: 'INVALID_RESULT' })
          expect(output.monitor.output.incomplete).toBe('OWNER_CLOSED')
        } else {
          expect(output.worker).toMatchObject({ outcome: 'done', output: { completed: true } })
        }
        if (mode === 'mismatch') {
          expect(output.monitor).toEqual({ error: 'INVALID_INPUT' })
          expect(output.retained).toBeTrue()
          expect(sawLiveData).toBeFalse()
          expect(result.stderr).not.toContain('monitor-started')
        } else if (mode === 'early-monitor-fail') {
          expect(sawLiveData).toBeFalse()
          expect(result.stderr).toContain('monitor-started')
          expect(output.monitor).toEqual({ error: 'EXECUTION_FAILED' })
          expect(output.worker.output.observationLost).toBe('DISCONNECTED')
          expect(output.displayIncomplete).not.toBeNull()
        } else {
          expect(sawLiveData).toBeTrue()
          expect(result.stderr).toContain('monitor-started')
        }
        if (mode === 'monitor-fail' || mode === 'monitor-cancel') {
          expect(output.monitor.error).toBe(
            mode === 'monitor-fail' ? 'EXECUTION_FAILED' : 'CANCELLED',
          )
          expect(output.worker.output.observationLost).toBe('DISCONNECTED')
          expect(output.displayIncomplete).not.toBeNull()
        }
        if (mode === 'success') {
          expect(output.monitor).toMatchObject({
            outcome: 'done',
            output: { count: 2, incomplete: null },
          })
          expect(output.displayIncomplete).toBeNull()
        }
        await expectNoChildResidue(root)
      }
      let cancelled = false
      const stopped = await invokeChannelCli(
        root,
        [
          'run',
          'binding:composition',
          '--input',
          '{"mode":"root-cancel"}',
          '--receive',
          'progress',
        ],
        {
          record(record, running, cancel) {
            if (record.type === 'data' && running) {
              cancelled = true
              cancel()
            }
          },
        },
      )
      expect(cancelled).toBeTrue()
      expect(stopped.code).not.toBe(0)
      expect(
        stopped.stdout
          .trimEnd()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .filter((record) => record.type === 'terminal')
          .every((record) => record.result.status !== 'succeeded'),
      ).toBeTrue()
      await expectNoChildResidue(root)
      expect(await directoryEntries(join(root, '.jig/private-root-linux-owners'))).toEqual([])
      await waitForRootlessCgroups(initialRootlessCgroups)
      await waitForRootlessTemporaryState(initialRootlessTemporaryState)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 240_000)

  test('installed direct channels stream, recover optional observation, and clean root cancellation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-private-channel-cli-'))
    try {
      await writeChannelProject(root)
      const reviewed = await invokeChannelCli(root, ['review', '--yes'])
      expect(reviewed.code, reviewed.stderr + reviewed.stdout).toBe(0)

      let consoleWasLive = false
      const consoleRun = await invokeChannelCli(root, ['run', 'flow:flows/worker'], {
        diagnostic(text, running) {
          if (text.includes('live:console')) consoleWasLive = running
        },
      })
      expect(consoleRun.code, consoleRun.stderr + consoleRun.stdout).toBe(0)
      expect(consoleWasLive).toBeTrue()
      expect(consoleRun.stderr).toBe('live:console\n')
      expect(JSON.parse(consoleRun.stdout)).toMatchObject({
        status: 'succeeded',
        output: { mode: 'console' },
      })

      for (const mode of ['stream', 'recover']) {
        let dataWasLive = false
        const result = await invokeChannelCli(
          root,
          [
            'run',
            'flow:flows/worker',
            '--input',
            JSON.stringify({ mode }),
            '--receive',
            'progress',
          ],
          {
            record(value, running) {
              if (value.type === 'data') dataWasLive = running
            },
          },
        )
        expect(result.code, result.stderr + result.stdout).toBe(0)
        expect(dataWasLive).toBeTrue()
        expect(result.stderr).toBe(`live:${mode}\n`)
        const records = result.stdout
          .trimEnd()
          .split('\n')
          .map((line) => JSON.parse(line))
        expect(records.map((record) => record.type)).toEqual(['begin', 'data', 'end', 'terminal'])
        expect(records[0]).toEqual({ type: 'begin', channel: 'progress', startSequence: 1 })
        expect(records[1]).toMatchObject({ type: 'data', channel: 'progress', sequence: 1 })
        expect(records[2]).toEqual({
          type: 'end',
          channel: 'progress',
          status: 'closed',
          lastSequence: 1,
        })
        expect(records[3]).toMatchObject({
          type: 'terminal',
          result: { status: 'succeeded', output: { mode } },
        })
        if (mode === 'recover') {
          expect(records[3].result.output.recovered).toBe('CANCELLED')
          expect(records[3].result.output.sendAfterDisposal).toBe('DISCONNECTED')
        }
        await expectNoChildResidue(root)
      }

      const rejected = await invokeChannelCli(root, [
        'run',
        'flow:flows/worker',
        '--receive',
        'missing',
      ])
      expect(rejected.code, rejected.stderr + rejected.stdout).toBe(1)
      const rejectedRecords = rejected.stdout
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(rejectedRecords).toHaveLength(1)
      expect(rejectedRecords[0]).toMatchObject({
        type: 'terminal',
        result: { status: 'failed', code: 'UNAVAILABLE' },
      })
      expect(rejected.stderr).toContain('Run failed')
      expect(rejected.stderr).toContain('Required execution support was unavailable.')
      expect(rejected.stderr).toContain('https://jig.md/guide/results')
      expect(rejected.stderr).toContain('Diagnostic code: UNAVAILABLE')
      expect(rejected.stderr).not.toContain('\u001b[')

      let cancelledOnData = false
      const interrupted = await invokeChannelCli(
        root,
        ['run', 'flow:flows/worker', '--input', '{"mode":"cancel"}', '--receive', 'progress'],
        {
          record(value, running, cancel) {
            if (value.type === 'data' && running) {
              cancelledOnData = true
              cancel()
            }
          },
        },
      )
      expect(cancelledOnData).toBeTrue()
      expect(interrupted.code).not.toBe(0)
      // Interruption need not deliver a terminal, but it cannot manufacture success.
      const terminals = interrupted.stdout
        .trimEnd()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((record) => record.type === 'terminal')
      expect(terminals.every((record) => record.result.status !== 'succeeded')).toBeTrue()
      await expectNoChildResidue(root)
      expect(await directoryEntries(join(root, '.jig/private-root-linux-owners'))).toEqual([])
      await waitForRootlessCgroups(initialRootlessCgroups)
      await waitForRootlessTemporaryState(initialRootlessTemporaryState)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 180_000)

  test('a rebuilt Jig requires review before any Flow starts and explains the environment-only change', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'jig-stale-approval-'))
    const root = join(temporary, 'project')
    const releaseRoot = join(temporary, 'installed')
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
    try {
      await mkdir(root)
      await mkdir(releaseRoot)
      await cp(join(installedBunLocation.releaseRoot, 'libexec'), join(releaseRoot, 'libexec'), {
        recursive: true,
      })
      await cp(
        join(installedBunLocation.releaseRoot, 'package.json'),
        join(releaseRoot, 'package.json'),
      )
      await symlink(
        join(installedBunLocation.releaseRoot, 'node_modules'),
        join(releaseRoot, 'node_modules'),
      )
      const location = {
        ...installedBunLocation,
        releaseRoot,
        installedCliPath: join(releaseRoot, 'libexec', 'installed-cli.js'),
      }
      await writeAgentFreeProject(root)
      session = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(location, {}),
      })
      const first = await session.plan({ lockMode: 'update' })
      if (first.state !== 'applicable') throw new Error('expected initial review')
      await session.apply({ planDigest: first.planDigest })
      await session.close()
      session = undefined
      await writeFile(
        location.installedCliPath,
        (await readFile(location.installedCliPath, 'utf8')) + '\n// rebuilt Jig\n',
      )
      session = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(location, {}),
      })
      const rejected = await session.rootAdministration.startRun({
        submissionId: 'stale-host',
        target: { kind: 'flow', path: 'flows/worker' },
        input: null,
      })
      expect(await waitForTerminalStatus(session.rootAdministration, rejected)).toMatchObject({
        state: 'terminal',
        terminal: {
          status: 'failed',
          code: 'REVIEW_REQUIRED',
          details: {
            reason: 'EXECUTION_ENVIRONMENT_CHANGED',
            flowStarted: false,
          },
        },
      })
      expect(inspectRootExecution(root, rejected.runId).sandboxDigest).toBe('null')
      await session.close()
      session = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(location, {}),
      })
      expect(await session.rootAdministration.runStatus(rejected)).toMatchObject({
        state: 'terminal',
        terminal: { code: 'REVIEW_REQUIRED' },
      })
      const next = await session.plan({ lockMode: 'update' })
      if (next.state !== 'applicable') throw new Error('expected renewed review')
      expect(next.review.text).toContain('Execution environment changed:')
      expect(next.review.text).toContain(
        'Flow source, prepared dependencies, settings and permissions are unchanged.',
      )
      await session.apply({ planDigest: next.planDigest })
      const accepted = await session.rootAdministration.startRun({
        submissionId: 'fresh-host',
        target: { kind: 'flow', path: 'flows/worker' },
        input: { proof: 'reviewed' },
      })
      expect(await waitForTerminalStatus(session.rootAdministration, accepted)).toMatchObject({
        state: 'terminal',
        terminal: { status: 'succeeded', output: { worker: { proof: 'reviewed' } } },
      })
      await session.close()
      session = undefined
      await expectNoChildResidue(root)
      await waitForRootlessCgroups(initialRootlessCgroups)
      await waitForRootlessTemporaryState(initialRootlessTemporaryState)
    } finally {
      await session?.close().catch(() => undefined)
      await rm(temporary, { recursive: true, force: true })
    }
  }, 180_000)

  test('refuses and cleans up an execution environment changed at sealing before admitting the Flow', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'jig-seal-approval-'))
    const root = join(temporary, 'project')
    const releaseRoot = join(temporary, 'installed')
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
    try {
      await mkdir(root)
      await mkdir(releaseRoot)
      await cp(join(installedBunLocation.releaseRoot, 'libexec'), join(releaseRoot, 'libexec'), {
        recursive: true,
      })
      await symlink(
        join(installedBunLocation.releaseRoot, 'node_modules'),
        join(releaseRoot, 'node_modules'),
      )
      const host = await openPrivateInstalledBunHost(
        {
          ...installedBunLocation,
          releaseRoot,
          installedCliPath: join(releaseRoot, 'libexec', 'installed-cli.js'),
        },
        {},
      )
      const supervisor = host.installedBunSupport.supervisorPath
      let changeAtSeal = false
      let changed = false
      let admits = 0
      class ChangingBackend extends PrivateLinuxCgroupBackend {
        override async seal(
          ...arguments_: Parameters<PrivateLinuxCgroupBackend['seal']>
        ): Promise<PrivateLinuxSealedOwner> {
          if (changeAtSeal) {
            changeAtSeal = false
            changed = true
            await writeFile(supervisor, (await readFile(supervisor, 'utf8')) + '\n// changed\n')
          }
          const sealed = await super.seal(...arguments_)
          return Object.freeze({
            identity: sealed.identity,
            admit: (...args: Parameters<PrivateLinuxSealedOwner['admit']>) => {
              admits += 1
              return sealed.admit(...args)
            },
          })
        }
      }
      const backend = new ChangingBackend({
        bunPath: host.installedBunSupport.executablePath,
        bunHostLibraryPath: host.installedBunSupport.hostLibraryDirectory,
        supervisorPath: supervisor,
      })
      await writeAgentFreeProject(root)
      session = await openPrivateProjectSession({ directory: root, host: { ...host, backend } })
      const review = await session.plan({ lockMode: 'update' })
      if (review.state !== 'applicable') throw new Error('expected initial review')
      await session.apply({ planDigest: review.planDigest })
      admits = 0
      changeAtSeal = true
      const rejected = await session.rootAdministration.startRun({
        submissionId: 'changed-at-seal',
        target: { kind: 'flow', path: 'flows/worker' },
        input: null,
      })
      expect(await waitForTerminalStatus(session.rootAdministration, rejected)).toMatchObject({
        state: 'terminal',
        terminal: {
          status: 'failed',
          code: 'REVIEW_REQUIRED',
          details: { reason: 'EXECUTION_ENVIRONMENT_CHANGED', flowStarted: false },
        },
      })
      expect(changed).toBeTrue()
      expect(admits).toBe(0)
      expect(inspectRootExecution(root, rejected.runId).sandboxDigest).not.toBe('null')
      await session.close()
      session = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(
          {
            ...installedBunLocation,
            releaseRoot,
            installedCliPath: join(releaseRoot, 'libexec', 'installed-cli.js'),
          },
          {},
        ),
      })
      expect(await session.rootAdministration.runStatus(rejected)).toMatchObject({
        state: 'terminal',
        terminal: { code: 'REVIEW_REQUIRED' },
      })
      await session.close()
      session = undefined
      await expectNoChildResidue(root)
      expect(await directoryEntries(join(root, '.jig/private-root-linux-owners'))).toEqual([])
      await waitForRootlessCgroups(initialRootlessCgroups)
      await waitForRootlessTemporaryState(initialRootlessTemporaryState)
    } finally {
      await session?.close().catch(() => undefined)
      await rm(temporary, { recursive: true, force: true })
    }
  }, 180_000)

  test('keeps unavailable native clients out of resource-free review and Run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-private-agent-isolation-'))
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
    try {
      await writeAgentFreeProject(root)
      const host = await openPrivateInstalledBunHost(installedBunLocation, {
        CODEX_PATH: '/missing/codex',
      })
      expect(host.acpResources).toEqual({ kind: 'private-acp-resources/1' })
      session = await openPrivateProjectSession({ directory: root, host })

      const plan = await session.plan({ lockMode: 'update' })
      if (plan.state !== 'applicable') {
        throw new Error('Agent-free project did not produce a Plan')
      }
      await session.apply({ planDigest: plan.planDigest })
      const receipt = await session.rootAdministration.startRun({
        submissionId: 'agent-isolation',
        target: { kind: 'flow', path: 'flows/worker' },
        input: { ticket: 'unrelated' },
      })
      expect(await waitForTerminalStatus(session.rootAdministration, receipt)).toMatchObject({
        state: 'terminal',
        terminal: {
          status: 'succeeded',
          outcome: 'done',
          output: { worker: { ticket: 'unrelated' } },
        },
      })
    } finally {
      await session?.close().catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  }, 300_000)

  test('preserves one bounded malformed-source diagnostic through a real session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-private-diagnostic-'))
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
    try {
      const malformed = join(root, 'flows', 'malformed')
      await mkdir(malformed, { recursive: true })
      await writeFile(
        join(root, 'jig.ts'),
        [
          'import { defineJig, discover } from "@jigging/jig";',
          'export default defineJig({ flows: discover("flows") });',
          '',
        ].join('\n'),
      )
      await writeFile(join(malformed, 'flow.meta.json'), 'not Metadata/1\n')
      await writeFile(join(malformed, 'FLOW.ts'), 'export {};\n')

      session = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedBunLocation),
      })
      const failure = await session.plan({ lockMode: 'update' }).then(
        () => undefined,
        (error) => error,
      )
      expect(failure).toMatchObject({
        code: 'INVALID_CANDIDATE',
        message: 'project candidate is invalid',
        diagnostic: {
          code: 'METADATA_INVALID_JSON',
          path: 'flows/malformed/flow.meta.json',
        },
      })
      expect(JSON.stringify(failure)).not.toContain(root)
      expect(JSON.stringify(failure)).not.toContain('not Metadata/1')
    } finally {
      await session?.close().catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  })

  test('executes exact child slots inside the parent deadline and leaves no child owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-private-child-slots-'))
    try {
      await writeProject(root)
      const planned = (await invoke(['plan', root])) as ApplicablePlan
      expect(planned).toMatchObject({ state: 'applicable', operation: 'admission' })
      await invoke(['apply', root, '--plan', planned.planDigest, '--yes'])

      const singleStarted = Date.now()
      const single = firstRun(
        await invokeRun(root, {
          submissionId: 'child-slot-single',
          target: { kind: 'binding', id: 'ticket-router' },
          input: { scenario: 'single', kind: 'bug', ticket: 'save fails' },
        }),
      )
      expect(Date.now() - singleStarted).toBeLessThan(30_000)
      expect(single.status).toMatchObject({
        state: 'terminal',
        terminal: {
          status: 'succeeded',
          outcome: 'done',
          output: {
            scenario: 'single',
            route: 'bug',
            parentSettings: ['label'],
            child: {
              outcome: 'done',
              output: {
                handled: 'bug',
                ticket: 'save fails',
                settings: [],
                attachments: [],
                parentMarkerVisible: false,
              },
            },
          },
        },
      })
      await expectNoChildResidue(root)

      const sequential = firstRun(
        await invokeRun(root, {
          submissionId: 'child-slot-sequential',
          target: { kind: 'binding', id: 'ticket-router' },
          input: { scenario: 'sequential', kind: 'bug', ticket: 'two steps' },
        }),
      )
      expect(sequential.status).toMatchObject({
        state: 'terminal',
        terminal: {
          status: 'succeeded',
          output: {
            scenario: 'sequential',
            children: [
              {
                outcome: 'done',
                output: { handled: 'bug', parentMarkerVisible: false },
              },
              {
                outcome: 'done',
                output: { handled: 'question', parentMarkerVisible: false },
              },
            ],
          },
        },
      })
      await expectNoChildResidue(root)

      const concurrent = firstRun(
        await invokeRun(root, {
          submissionId: 'child-slot-concurrent',
          target: { kind: 'binding', id: 'ticket-router' },
          input: { scenario: 'concurrent', kind: 'bug', ticket: 'capacity' },
        }),
      )
      expect(concurrent.status).toMatchObject({
        state: 'terminal',
        terminal: {
          status: 'succeeded',
          output: {
            scenario: 'concurrent',
            after: { outcome: 'done', output: { handled: 'question' } },
          },
        },
      })
      const concurrentCalls = (concurrent.status as any).terminal.output.concurrent as any[]
      expect(concurrentCalls).toHaveLength(3)
      const completed = concurrentCalls.filter(({ status }) => status === 'succeeded')
      expect(completed).toHaveLength(2)
      expect(Math.max(...completed.map((c) => c.result.output.started))).toBeLessThan(
        Math.min(...completed.map((c) => c.result.output.finished)),
      )
      expect(
        concurrentCalls.filter(
          ({ status, code }) => status === 'failed' && code === 'RESOURCE_EXHAUSTED',
        ),
      ).toHaveLength(1)
      await expectNoChildResidue(root)

      const selected = firstRun(
        await invokeRun(root, {
          submissionId: 'selected-worker-stop',
          target: { kind: 'binding', id: 'ticket-router' },
          input: { scenario: 'selected-cancel', kind: 'bug', ticket: 'stop only one' },
        }),
      )
      expect((selected.status as any).terminal.output.children).toMatchObject([
        { status: 'failed', code: 'CANCELLED' },
        { status: 'succeeded', result: { outcome: 'done' } },
      ])
      await expectNoChildResidue(root)

      for (const [scenario, code] of [
        ['invalid-input', 'INVALID_INPUT'],
        ['invalid-result', 'INVALID_RESULT'],
        ['execution-failure', 'EXECUTION_FAILED'],
        ['recursive', 'UNAVAILABLE'],
      ] as const) {
        const errorCase = firstRun(
          await invokeRun(root, {
            submissionId: `child-slot-${scenario}`,
            target: { kind: 'binding', id: 'ticket-router' },
            input: { scenario, kind: 'bug', ticket: 'fail safely' },
          }),
        )
        expect(errorCase.status).toMatchObject({
          state: 'terminal',
          terminal: {
            status: 'succeeded',
            output: { scenario, observed: { status: 'failed', code } },
          },
        })
        await expectNoChildResidue(root)
      }

      const direct = firstRun(
        await invokeRun(root, {
          submissionId: 'child-slot-direct-parent',
          target: { kind: 'flow', path: 'flows/ticket-router' },
          input: { scenario: 'single', kind: 'question', ticket: 'how?' },
        }),
      )
      expect(direct.status).toMatchObject({
        state: 'terminal',
        terminal: { status: 'failed', code: 'UNAVAILABLE' },
      })
      await expectNoChildResidue(root)

      const crashRequest = {
        submissionId: 'child-slot-coordinator-loss',
        target: { kind: 'binding' as const, id: 'ticket-router' },
        input: { scenario: 'slow', kind: 'bug', ticket: 'child-slot-coordinator-loss' },
      }
      const crashed = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, 'fixtures', 'project-session-runner.ts'),
          root,
          crashRequest.submissionId,
          'child',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      )
      const crashDiagnostics = new Response(crashed.stderr).text()
      const crashedReceipt = JSON.parse(await firstLine(crashed.stdout)) as {
        readonly runId: string
      }
      await waitForChildSandbox(root, crashedReceipt.runId).catch(async (error) => {
        crashed.kill('SIGKILL')
        await crashed.exited
        throw new Error(`${String(error)}: ${await crashDiagnostics}`)
      })
      crashed.kill('SIGKILL')
      expect(await crashed.exited).toBe(137)
      await waitForRootlessCgroups(initialRootlessCgroups)

      const recovered = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedBunLocation),
      })
      expect(await recovered.rootAdministration.startRun(crashRequest)).toEqual(crashedReceipt)
      expect(await recovered.rootAdministration.runStatus(crashedReceipt)).toMatchObject({
        state: 'terminal',
        terminal: { status: 'lost', code: 'COORDINATOR_LOST' },
      })
      await recovered.close()
      await expectNoChildResidue(root)

      const withheldBase = await openPrivateInstalledBunHost(installedBunLocation)
      const withheldBackend = new WithheldChildFenceBackend({
        bunPath: withheldBase.installedBunSupport.executablePath,
        bunHostLibraryPath: withheldBase.installedBunSupport.hostLibraryDirectory,
        supervisorPath: withheldBase.installedBunSupport.supervisorPath,
      })
      const withheldSession = await openPrivateProjectSession({
        directory: root,
        host: Object.freeze({ ...withheldBase, backend: withheldBackend }),
      })
      const uncertainReceipt = await withheldSession.rootAdministration.startRun({
        submissionId: 'child-slot-unconfirmed-fence',
        target: { kind: 'binding', id: 'ticket-router' },
        input: { scenario: 'fence-uncertain', kind: 'bug', ticket: 'withhold fence' },
      })
      await waitForChildSandbox(root, uncertainReceipt.runId)
      await withheldBackend.waitForRecoverAttempts(2)
      expect(await withheldSession.rootAdministration.runStatus(uncertainReceipt)).toMatchObject({
        state: 'pending',
      })
      expect(inspectRunOwnership(root, uncertainReceipt.runId)).toEqual({
        childOwners: 1,
        terminals: 0,
      })
      expect(withheldBackend.childAdmits()).toBe(1)
      await expect(withheldSession.close()).rejects.toMatchObject({ code: 'UNAVAILABLE' })

      withheldBackend.allowRecovery()
      const uncertainRecovery = await openPrivateProjectSession({
        directory: root,
        host: Object.freeze({ ...withheldBase, backend: withheldBackend }),
      })
      // Recovery settles the retained ownership; it cannot rewrite a fatal
      // execution result into success or authorize replay of the child.
      const recoveredUncertain =
        await uncertainRecovery.rootAdministration.runStatus(uncertainReceipt)
      expect(recoveredUncertain).toMatchObject({
        state: 'terminal',
        terminal: {
          status: 'failed',
          code: 'UNCERTAIN',
        },
      })
      expect(recoveredUncertain).not.toHaveProperty('terminal.output')
      expect(withheldBackend.childAdmits()).toBe(1)
      expect(inspectRunOwnership(root, uncertainReceipt.runId)).toEqual({
        childOwners: 0,
        terminals: 1,
      })
      await uncertainRecovery.close()
      await expectNoChildResidue(root)

      const cancellationRequest = {
        submissionId: 'child-slot-cancellation',
        target: { kind: 'binding' as const, id: 'ticket-router' },
        input: { scenario: 'slow', kind: 'bug', ticket: 'child-slot-cancellation' },
      }
      const cancelling = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedBunLocation),
      })
      const cancelledReceipt = await cancelling.rootAdministration.startRun(cancellationRequest)
      await waitForChildSandbox(root, cancelledReceipt.runId)
      await cancelling.close()
      const cancelled = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedBunLocation),
      })
      expect(await cancelled.rootAdministration.startRun(cancellationRequest)).toEqual(
        cancelledReceipt,
      )
      expect(await cancelled.rootAdministration.runStatus(cancelledReceipt)).toMatchObject({
        state: 'terminal',
        terminal: { status: 'failed', code: 'CANCELLED' },
      })
      await cancelled.close()
      await expectNoChildResidue(root)

      const deadlineRequest = {
        submissionId: 'child-slot-deadline',
        target: { kind: 'binding' as const, id: 'ticket-router' },
        input: { scenario: 'slow', kind: 'bug', ticket: 'child-slot-deadline' },
      }
      const installed = await openPrivateInstalledBunHost(installedBunLocation)
      const expiring = await openPrivateProjectSession({
        directory: root,
        host: Object.freeze({ ...installed, runTimeoutMs: 12_000 }),
      })
      const deadlineReceipt = await expiring.rootAdministration.startRun(deadlineRequest)
      await waitForChildSandbox(root, deadlineReceipt.runId)
      expect(
        await waitForTerminalStatus(expiring.rootAdministration, deadlineReceipt),
      ).toMatchObject({
        state: 'terminal',
        terminal: { status: 'failed', code: 'DEADLINE_EXCEEDED' },
      })
      await expiring.close()
      await expectNoChildResidue(root)

      expect(inspectPlanningState(root).rootRuns).toBe(13)
      await waitForRootlessCgroups(initialRootlessCgroups)
      await waitForRootlessTemporaryState(initialRootlessTemporaryState)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 300_000)

  agentProofTest(
    'executes one packed ordinary HTTP Agent choice and exact child without retaining its key',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'jig-private-agent-router-'))
      let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
      try {
        await writeAgentRouterProject(root)
        const api = process.env.OPENAI_API ?? 'responses'
        const model = process.env.OPENAI_MODEL
        const credential = process.env.OPENAI_API_KEY
        if ((api !== 'responses' && api !== 'chat-completions') || !model || !credential)
          throw new Error(
            'The opted-in HTTP Agent proof requires OPENAI_MODEL, OPENAI_API_KEY and a supported OPENAI_API',
          )
        const base = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
        await writeOrdinaryAgent(root, {
          url: `${base}/${api === 'responses' ? 'responses' : 'chat/completions'}`,
          api,
          model,
          bearerEnv: 'OPENAI_API_KEY',
          maxCompletionTokens: 4096,
          default: true,
        })
        session = await openPrivateProjectSession({
          directory: root,
          host: await openPrivateInstalledBunHost(installedBunLocation, {
            OPENAI_API_KEY: credential,
          }),
        })
        const plan = await session.plan({ lockMode: 'update' })
        if (plan.state !== 'applicable') throw new Error('Agent router did not produce a Plan')
        expect(plan.review.text).toContain('https://jig.md/contracts/agent-run')
        await session.apply({ planDigest: plan.planDigest, allowAuthorityChanges: true })

        const started = Date.now()
        const receipt = await session.rootAdministration.startRun({
          submissionId: 'agent-router-live',
          target: { kind: 'binding', id: 'ticket-router' },
          input: { route: 'technical', ticket: 'Login fails after password reset' },
        })
        const status = await waitForTerminalStatus(session.rootAdministration, receipt)
        expect(Date.now() - started).toBeLessThan(30_000)
        expect(status).toMatchObject({
          state: 'terminal',
          terminal: {
            status: 'succeeded',
            outcome: 'done',
            output: {
              route: 'technical',
              evidence: [{ source: 'ticket', sourceLine: 1, amount: null, ambiguity: null }],
              parentHasKey: false,
              child: {
                outcome: 'done',
                output: { handled: 'technical' },
              },
            },
          },
        })
        await session.close()
        session = undefined
        await expectNoChildResidue(root)
        expect(await treeContains(root, credential)).toBeFalse()
        await waitForRootlessCgroups(initialRootlessCgroups)
        await waitForRootlessTemporaryState(initialRootlessTemporaryState)
      } finally {
        await session?.close().catch(() => undefined)
        await rm(root, { recursive: true, force: true })
      }
    },
    180_000,
  )

  test('reviews, admits, executes, replays, cancels, and recovers one exact Bun Flow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-private-foreground-'))
    try {
      await writeProject(root)

      const planned = (await invoke(['plan', root])) as ApplicablePlan
      expect(planned).toMatchObject({
        kind: 'private-foreground-plan/1',
        state: 'applicable',
        operation: 'admission',
      })
      expect(planned.review.mediaType).toBe('text/plain; charset=utf-8')
      expect(planned.review.text).toContain('"path": "flows/worker"')
      expect(planned.review.text).not.toContain(root)
      expect(planned.review.text).not.toContain('recipeDigest')

      await expect(readFile(join(root, 'jig.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(inspectPlanningState(root)).toEqual({
        candidateRevision: 1,
        candidates: 1,
        plans: 1,
        admissions: 0,
        rootRuns: 0,
        planDigest: planned.planDigest,
      })

      // Applying retained review bytes must not re-evaluate mutable source.
      await writeFile(
        join(root, 'flows', 'worker', 'FLOW.ts'),
        "throw new Error('Run must use the retained reviewed package');\n",
      )
      expect(await invoke(['apply', root, '--plan', planned.planDigest, '--yes'])).toEqual({
        kind: 'private-foreground-apply/1',
        operation: 'admission',
        planDigest: planned.planDigest,
      })

      const directRequest = {
        submissionId: 'foreground-direct',
        target: { kind: 'flow', path: 'flows/worker' },
        input: { ticket: 'direct' },
      } as const
      const ran = (await invoke([
        'run',
        root,
        '--request',
        JSON.stringify(directRequest),
        '--request',
        JSON.stringify(directRequest),
      ])) as ForegroundRunResult
      expect(ran.kind).toBe('private-foreground-run/1')
      expect(ran.runs).toHaveLength(2)
      expect(ran.runs[0]!.receipt).toEqual(ran.runs[1]!.receipt)
      for (const run of ran.runs) {
        expect(run).toMatchObject({
          submissionId: 'foreground-direct',
          status: {
            state: 'terminal',
            terminal: {
              status: 'succeeded',
              outcome: 'done',
              output: { worker: { ticket: 'direct' } },
            },
          },
        })
      }
      expect(inspectPlanningState(root).rootRuns).toBe(1)

      expect(
        JSON.parse(
          await invokeFailure([
            'run',
            root,
            '--request',
            JSON.stringify({ ...directRequest, input: { ticket: 'changed' } }),
          ]),
        ),
      ).toMatchObject({ code: 'SUBMISSION_CONFLICT' })
      expect(inspectPlanningState(root).rootRuns).toBe(1)

      const cancellationSession = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedBunLocation),
      })
      const cancellationRequest = {
        submissionId: 'foreground-close-cancel',
        target: { kind: 'flow' as const, path: 'flows/worker' },
        input: { ticket: 'cancelled', delayMs: 20_000 },
      }
      const cancelledReceipt =
        await cancellationSession.rootAdministration.startRun(cancellationRequest)
      await waitForPrepared(root, cancelledReceipt.runId)
      const escapedAdministration = cancellationSession.rootAdministration
      await cancellationSession.close()
      await expect(escapedAdministration.runStatus(cancelledReceipt)).rejects.toMatchObject({
        code: 'PROJECT_CLOSED',
      })

      const cancellationRecovery = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedBunLocation),
      })
      expect(await cancellationRecovery.rootAdministration.startRun(cancellationRequest)).toEqual(
        cancelledReceipt,
      )
      expect(
        await cancellationRecovery.rootAdministration.runStatus(cancelledReceipt),
      ).toMatchObject({
        state: 'terminal',
        terminal: { status: 'failed', code: 'CANCELLED' },
      })
      await cancellationRecovery.close()

      const crashRequest = {
        submissionId: 'foreground-session-crash',
        target: { kind: 'flow' as const, path: 'flows/worker' },
        input: { ticket: 'foreground-session-crash', delayMs: 20_000 },
      }
      const crashed = Bun.spawn(
        [
          process.execPath,
          join(import.meta.dir, 'fixtures', 'project-session-runner.ts'),
          root,
          crashRequest.submissionId,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      )
      const crashDiagnostics = new Response(crashed.stderr).text()
      const crashedReceipt = JSON.parse(await firstLine(crashed.stdout)) as {
        readonly runId: string
      }
      await waitForPrepared(root, crashedReceipt.runId).catch(async (error) => {
        crashed.kill('SIGKILL')
        await crashed.exited
        throw new Error(`${String(error)}: ${await crashDiagnostics}`)
      })
      const beforeRecovery = inspectRootExecution(root, crashedReceipt.runId)
      crashed.kill('SIGKILL')
      expect(await crashed.exited).toBe(137)
      await waitForRootlessCgroups(initialRootlessCgroups)

      const crashRecovery = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedBunLocation),
      })
      expect(await crashRecovery.rootAdministration.startRun(crashRequest)).toEqual(crashedReceipt)
      expect(await crashRecovery.rootAdministration.runStatus(crashedReceipt)).toMatchObject({
        state: 'terminal',
        terminal: { status: 'lost', code: 'COORDINATOR_LOST' },
      })
      expect(inspectRootExecution(root, crashedReceipt.runId)).toMatchObject({
        sandboxDigest: beforeRecovery.sandboxDigest,
        preparedDigest: beforeRecovery.preparedDigest,
        rows: 1,
      })
      await crashRecovery.close()

      // Closing the recovered session releases exclusive project authority.
      const reopened = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedBunLocation),
      })
      await reopened.close()
      await waitForRootlessCgroups(initialRootlessCgroups)
      await waitForRootlessTemporaryState(initialRootlessTemporaryState)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 300_000)
})

interface ApplicablePlan {
  readonly kind: string
  readonly state: 'applicable'
  readonly operation: 'admission'
  readonly planDigest: string
  readonly review: { readonly mediaType: string; readonly text: string }
}

interface ForegroundRunResult {
  readonly kind: string
  readonly runs: readonly ForegroundRunEntry[]
}

interface ForegroundRunEntry {
  readonly submissionId: string
  readonly receipt: { readonly runId: string }
  readonly status: unknown
}

async function writeProject(root: string): Promise<void> {
  const worker = join(root, 'flows', 'worker')
  await mkdir(worker, { recursive: true })
  await writeFile(
    join(root, 'jig.ts'),
    [
      'import { defineJig, discover } from "@jigging/jig";',
      'export default defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
      '',
    ].join('\n'),
  )
  await writeFile(
    join(worker, 'flow.meta.json'),
    metadata('foreground-worker', 'Returns its input from one contained Bun Run.'),
  )
  await writeFile(
    join(worker, 'FLOW.contract.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
      input: {
        type: 'object',
        properties: {
          ticket: { type: 'string' },
          delayMs: { type: 'number', minimum: 0, maximum: 20_000 },
        },
        required: ['ticket'],
        additionalProperties: false,
      },
      result: {
        type: 'object',
        properties: {
          outcome: { const: 'done' },
          output: {
            type: 'object',
            properties: { worker: {} },
            required: ['worker'],
            additionalProperties: false,
          },
        },
        required: ['outcome', 'output'],
        additionalProperties: false,
      },
    }),
  )

  await writeFile(join(worker, 'FLOW.ts'), bunWorkerProgram())
  const sdk = join(worker, 'flow-sdk')
  await mkdir(sdk)
  for (const name of [
    'index.ts',
    'channels.ts',
    'json.ts',
    'protocol.ts',
    'session.ts',
    'transport.ts',
    'types.ts',
  ]) {
    await writeFile(
      join(sdk, name),
      await readFile(join(import.meta.dir, '..', '..', 'flow-sdk', 'src', name)),
    )
  }

  const router = join(root, 'flows', 'ticket-router')
  const bug = join(root, 'flows', 'handle-bug')
  const question = join(root, 'flows', 'answer-question')
  const invalidInput = join(root, 'flows', 'invalid-input-child')
  const invalidResult = join(root, 'flows', 'invalid-result-child')
  const executionFailure = join(root, 'flows', 'execution-failure-child')
  const recursive = join(root, 'flows', 'recursive-child')
  const slotPackages = [
    router,
    bug,
    question,
    invalidInput,
    invalidResult,
    executionFailure,
    recursive,
  ]
  for (const directory of slotPackages) await mkdir(directory, { recursive: true })
  await writeFile(join(router, 'flow.meta.json'), metadata('ticket-router', 'Routes one ticket.'))
  await writeFile(join(router, 'FLOW.contract.json'), ticketSchema())
  await writeFile(
    join(router, 'settings.schema.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/schema-1.json',
      type: 'object',
      properties: { label: { const: 'parent' } },
      required: ['label'],
      additionalProperties: false,
    }),
  )
  await writeFile(join(router, 'FLOW.ts'), routerProgram())
  await writeFile(join(bug, 'flow.meta.json'), metadata('handle-bug', 'Handles one bug.'))
  await writeFile(join(bug, 'FLOW.contract.json'), ticketSchema('bug'))
  await writeFile(join(bug, 'FLOW.ts'), childProgram('bug'))
  await writeFile(
    join(question, 'flow.meta.json'),
    metadata('answer-question', 'Answers one question.'),
  )
  await writeFile(join(question, 'FLOW.contract.json'), ticketSchema('question'))
  await writeFile(join(question, 'FLOW.ts'), childProgram('question'))
  await writeFile(
    join(invalidInput, 'flow.meta.json'),
    metadata('invalid-input-child', 'Must never start for the invalid test input.'),
  )
  await writeFile(
    join(invalidInput, 'FLOW.contract.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
      input: {
        type: 'object',
        properties: { allowed: { const: true } },
        required: ['allowed'],
        additionalProperties: false,
      },
    }),
  )
  await writeFile(
    join(invalidInput, 'FLOW.ts'),
    throwingChildProgram('invalid input reached child code'),
  )
  await writeFile(
    join(invalidResult, 'flow.meta.json'),
    metadata('invalid-result-child', 'Returns a result rejected by its declaration.'),
  )
  await writeFile(
    join(invalidResult, 'FLOW.contract.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
      result: {
        type: 'object',
        properties: {
          outcome: { const: 'done' },
          output: {
            type: 'object',
            properties: { valid: { const: true } },
            required: ['valid'],
            additionalProperties: false,
          },
        },
        required: ['outcome', 'output'],
        additionalProperties: false,
      },
    }),
  )
  await writeFile(join(invalidResult, 'FLOW.ts'), invalidResultChildProgram())
  await writeFile(
    join(executionFailure, 'flow.meta.json'),
    metadata('execution-failure-child', 'Fails after it starts.'),
  )
  await writeFile(
    join(executionFailure, 'FLOW.ts'),
    throwingChildProgram('deliberate child failure'),
  )
  await writeFile(
    join(recursive, 'flow.meta.json'),
    metadata('recursive-child', 'Attempts one unavailable child call.'),
  )
  await writeFile(join(recursive, 'FLOW.ts'), recursiveChildProgram())
  for (const directory of slotPackages) await copyFlowSdk(directory)
  const bindings = join(root, 'bindings')
  await mkdir(bindings)
  await writeFile(
    join(bindings, 'ticket-router.ts'),
    [
      'import { defineBinding } from "@jigging/jig";',
      'export default defineBinding({',
      '  package: "./flows/ticket-router",',
      '  settings: { label: "parent" },',
      '  slots: {',
      '    bug: "flow:flows/handle-bug",',
      '    question: "flow:flows/answer-question",',
      '    "invalid-input": "flow:flows/invalid-input-child",',
      '    "invalid-result": "flow:flows/invalid-result-child",',
      '    "execution-failure": "flow:flows/execution-failure-child",',
      '    recursive: "flow:flows/recursive-child",',
      '  },',
      '});',
      '',
    ].join('\n'),
  )
}

async function writeAgentFreeProject(root: string): Promise<void> {
  const worker = join(root, 'flows', 'worker')
  await mkdir(worker, { recursive: true })
  await writeFile(
    join(root, 'jig.ts'),
    [
      'import { defineJig } from "@jigging/jig";',
      'export default defineJig({ flows: ["./flows/worker"] });',
      '',
    ].join('\n'),
  )
  await writeFile(
    join(worker, 'flow.meta.json'),
    metadata('agent-isolation', 'Returns its input without an Agent invocation.'),
  )
  await writeFile(join(worker, 'FLOW.ts'), bunWorkerProgram())
  await copyFlowSdk(worker)
}

async function writeAgentRouterProject(root: string): Promise<void> {
  const router = join(root, 'flows', 'ticket-router')
  const billing = join(root, 'flows', 'billing')
  const technical = join(root, 'flows', 'technical')
  await Promise.all(
    [router, billing, technical, join(root, 'bindings')].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  )
  await writeFile(
    join(root, 'jig.ts'),
    [
      'import { defineJig, discover } from "@jigging/jig";',
      'export default defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
      '',
    ].join('\n'),
  )

  await mkdir(join(router, 'contracts'))
  await cp(
    join(import.meta.dir, '../../../docs/jig/spec/contracts/agent-run'),
    join(router, 'contracts/agent-run'),
    { recursive: true },
  )
  await mkdir(join(router, 'skills', 'ticket-routing'), { recursive: true })
  await writeFile(
    join(router, 'skills', 'ticket-routing', 'SKILL.md'),
    "# Ticket routing\n\nCopy the ticket's explicit `route` field exactly.\n",
  )
  await writeFile(
    join(router, 'flow.meta.json'),
    JSON.stringify({
      name: 'ticket-router',
      description: 'Uses one Agent choice before calling an exact child.',
      uses: { agent: { contract: './contracts/agent-run/contract.json' } },
    }),
  )
  await writeFile(join(router, 'FLOW.ts'), agentRouterProgram())
  await copyFlowSdk(router)

  for (const [directory, route] of [
    [billing, 'billing'],
    [technical, 'technical'],
  ] as const) {
    await writeFile(
      join(directory, 'flow.meta.json'),
      metadata(route, `Handles one ${route} ticket.`),
    )
    await writeFile(
      join(directory, 'FLOW.ts'),
      [
        '#!/usr/bin/env bun',
        'import { handle } from "./flow-sdk/index.ts";',
        `await handle(async (run) => ({ outcome: "done", output: { handled: ${JSON.stringify(route)}, input: run.input } }));`,
        '',
      ].join('\n'),
    )
    await copyFlowSdk(directory)
  }
  await writeFile(
    join(root, 'bindings', 'ticket-router.ts'),
    [
      'import { defineBinding } from "@jigging/jig";',
      'export default defineBinding({',
      '  package: "./flows/ticket-router",',
      '  slots: {',
      '    billing: "flow:flows/billing",',
      '    technical: "flow:flows/technical",',
      '  },',
      '});',
      '',
    ].join('\n'),
  )
}

function agentRouterProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.ts";',
    'const responseSchema = {',
    '  $schema: "https://flow.jig.md/schemas/schema-1.json",',
    '  type: "object", properties: { decision: {',
    '    type: "object", properties: {',
    '      route: { type: "string", enum: ["billing", "technical"] },',
    '      evidence: { type: "array", minItems: 1, maxItems: 1, items: {',
    '        type: "object", properties: {',
    '          source: { type: "string", enum: ["ticket"] },',
    '          sourceLine: { type: "integer" },',
    '          amount: { type: ["integer", "null"] },',
    '          ambiguity: { type: ["string", "null"] },',
    '        }, required: ["source", "sourceLine", "amount", "ambiguity"], additionalProperties: false,',
    '      } },',
    '    }, required: ["route", "evidence"], additionalProperties: false,',
    '  } }, required: ["decision"], additionalProperties: false,',
    '};',
    'await handle(async (run) => {',
    '  const input = run.input as { route: "billing" | "technical"; ticket: string };',
    '  const agent = await run.call({',
    '    operationId: "choose-route", slot: "agent",',
    '    input: {',
    '      instructions: `Return only JSON matching the response schema. Copy route exactly from this ticket; set evidence to one item with source ticket, sourceLine 1, amount null, and ambiguity null: ${JSON.stringify(input)}`,',
    '      skills: [{ name: "ticket-routing", files: [{path: "SKILL.md", text: await Bun.file(new URL("./skills/ticket-routing/SKILL.md", import.meta.url)).text()}] }], responseSchema,',
    '    },',
    '  }) as { outcome: string; output: { structured?: { decision: {',
    '    route: "billing" | "technical";',
    '    evidence: [{ source: "ticket"; sourceLine: number; amount: number | null; ambiguity: string | null }];',
    '  } } } };',
    '  if (agent.outcome !== "done" || agent.output.structured === undefined) throw new Error("Agent did not choose");',
    '  const decision = agent.output.structured.decision;',
    '  const child = await run.call({',
    '    operationId: "dispatch-route", slot: decision.route, input,',
    '  });',
    '  return { outcome: "done", output: {',
    '    route: decision.route, evidence: decision.evidence, child,',
    '    parentHasKey: process.env.OPENAI_API_KEY !== undefined,',
    '  } };',
    '});',
    '',
  ].join('\n')
}

function metadata(name: string, description: string): string {
  return JSON.stringify({ name, description })
}

function ticketSchema(kind?: 'bug' | 'question'): string {
  return JSON.stringify({
    $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
    input: {
      type: 'object',
      properties: {
        scenario: {
          enum: [
            'single',
            'sequential',
            'concurrent',
            'selected-cancel',
            'invalid-input',
            'invalid-result',
            'execution-failure',
            'recursive',
            'slow',
            'fence-uncertain',
          ],
        },
        kind: kind === undefined ? { enum: ['bug', 'question'] } : { const: kind },
        ticket: { type: 'string' },
        delayMs: { type: 'number', minimum: 0, maximum: 25_000 },
      },
      required: kind === undefined ? ['scenario', 'kind', 'ticket'] : ['kind', 'ticket'],
      additionalProperties: false,
    },
  })
}

function routerProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.ts";',
    'await handle(async (context) => {',
    '  const input = context.input as { scenario: string; kind: "bug" | "question"; ticket: string };',
    '  await Bun.write(`${context.scratch}/parent-marker`, "parent");',
    '  const call = async (operationId: string, slot: string, childInput: unknown, signal?: AbortSignal) => {',
    '    try {',
    '      const result = await context.call({ operationId, slot, input: childInput as any }, { signal });',
    '      return { status: "succeeded", result };',
    '    } catch (error) {',
    '      const code = typeof error === "object" && error !== null && "code" in error',
    '        ? String((error as { code: unknown }).code) : "UNKNOWN";',
    '      const message = error instanceof Error ? error.message : String(error);',
    '      return { status: "failed", code, message };',
    '    }',
    '  };',
    '  if (input.scenario === "sequential") {',
    '    const children = [',
    '      await context.call({ operationId: "sequential:bug", slot: "bug", input: { kind: "bug", ticket: input.ticket } }),',
    '      await context.call({ operationId: "sequential:question", slot: "question", input: { kind: "question", ticket: input.ticket } }),',
    '    ];',
    '    return { outcome: "done", output: { scenario: input.scenario, children } };',
    '  }',
    '  if (input.scenario === "concurrent") {',
    '    const concurrent = await Promise.all([',
    '      call("concurrent:a", "bug", { kind: "bug", ticket: input.ticket, delayMs: 3000 }),',
    '      call("concurrent:b", "bug", { kind: "bug", ticket: input.ticket, delayMs: 3000 }),',
    '      call("concurrent:c", "bug", { kind: "bug", ticket: input.ticket, delayMs: 3000 }),',
    '    ]);',
    '    const after = await context.call({ operationId: "concurrent:after", slot: "question", input: { kind: "question", ticket: input.ticket } });',
    '    return { outcome: "done", output: { scenario: input.scenario, concurrent, after } };',
    '  }',
    '  if (input.scenario === "selected-cancel") {',
    '    const selected = new AbortController();',
    '    const timer = setTimeout(() => selected.abort(), 7000);',
    '    try {',
    '      const children = await Promise.all([',
    '        call("stop:first", "bug", { kind: "bug", ticket: input.ticket, delayMs: 20000 }, selected.signal),',
    '        call("keep:second", "bug", { kind: "bug", ticket: input.ticket, delayMs: 8000 }),',
    '      ]);',
    '      return { outcome: "done", output: { children } };',
    '    } finally { clearTimeout(timer); }',
    '  }',
    '  if (input.scenario === "invalid-input") {',
    '    const observed = await call("errors:input", "invalid-input", { allowed: false });',
    '    return { outcome: "done", output: { scenario: input.scenario, observed } };',
    '  }',
    '  if (input.scenario === "invalid-result") {',
    '    const observed = await call("errors:result", "invalid-result", {});',
    '    return { outcome: "done", output: { scenario: input.scenario, observed } };',
    '  }',
    '  if (input.scenario === "execution-failure") {',
    '    const observed = await call("errors:execution", "execution-failure", {});',
    '    return { outcome: "done", output: { scenario: input.scenario, observed } };',
    '  }',
    '  if (input.scenario === "fence-uncertain") {',
    '    const observed = await call("errors:fence", "bug", { kind: "bug", ticket: input.ticket });',
    '    return { outcome: "done", output: { scenario: input.scenario, observed } };',
    '  }',
    '  if (input.scenario === "recursive") {',
    '    const observed = await call("errors:recursive", "recursive", {});',
    '    return { outcome: "done", output: { scenario: input.scenario, observed } };',
    '  }',
    '  if (input.scenario === "slow") {',
    '    const child = await context.call({ operationId: "slow:1", slot: "bug", input: { kind: "bug", ticket: input.ticket, delayMs: 20_000 } });',
    '    return { outcome: "done", output: { scenario: input.scenario, child } };',
    '  }',
    '  const route = input.kind === "bug" ? "bug" : "question";',
    '  const child = await context.call({',
    '    operationId: "dispatch:1",',
    '    slot: route,',
    '    input,',
    '  });',
    '  return { outcome: "done", output: {',
    '    scenario: input.scenario, route, parentSettings: Object.keys(context.settings).sort(), child,',
    '  } };',
    '});',
    '',
  ].join('\n')
}

function childProgram(kind: 'bug' | 'question'): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.ts";',
    'await handle(async (context) => {',
    '  const started = Date.now();',
    '  const input = context.input as { kind: string; ticket: string; delayMs?: number };',
    '  const marker = `${context.scratch}/parent-marker`;',
    '  const parentMarkerVisible = await Bun.file(marker).exists();',
    '  await Bun.write(marker, "child");',
    '  if (input.delayMs !== undefined) await Bun.sleep(input.delayMs);',
    `  return { outcome: "done", output: {`,
    `    handled: "${kind}", ticket: input.ticket,`,
    '    settings: Object.keys(context.settings).sort(),',
    '    attachments: Object.keys(context.attachments).sort(),',
    '    parentMarkerVisible,',
    '    started, finished: Date.now(),',
    '  } };',
    '});',
    '',
  ].join('\n')
}

function throwingChildProgram(message: string): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.ts";',
    `await handle(async () => { throw new Error(${JSON.stringify(message)}); });`,
    '',
  ].join('\n')
}

function invalidResultChildProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.ts";',
    'await handle(async () => ({ outcome: "done", output: { valid: false } }));',
    '',
  ].join('\n')
}

function recursiveChildProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.ts";',
    'await handle(async (context) => await context.call({',
    '  operationId: "recursive:inner",',
    '  slot: "not-admitted",',
    '  input: {},',
    '}));',
    '',
  ].join('\n')
}

async function copyFlowSdk(directory: string): Promise<void> {
  const target = join(directory, 'flow-sdk')
  await mkdir(target)
  for (const name of [
    'index.ts',
    'channels.ts',
    'json.ts',
    'protocol.ts',
    'session.ts',
    'transport.ts',
    'types.ts',
  ]) {
    await writeFile(
      join(target, name),
      await readFile(join(import.meta.dir, '..', '..', 'flow-sdk', 'src', name)),
    )
  }
}

async function writeChannelProject(root: string): Promise<void> {
  const flow = join(root, 'flows/worker')
  await mkdir(flow, { recursive: true })
  await cp(join(import.meta.dir, '../../flow-sdk/dist'), join(flow, 'sdk'), { recursive: true })
  await writeFile(
    join(root, 'jig.ts'),
    [
      'import { defineJig, discover } from "@jigging/jig";',
      'export default defineJig({ flows: discover("flows") });',
    ].join('\n'),
  )
  await writeFile(
    join(flow, 'flow.meta.json'),
    metadata('channel-worker', 'Publish direct progress and retain the separate execution result.'),
  )
  await writeFile(
    join(flow, 'FLOW.contract.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
      channels: { progress: { direction: 'send', required: false, schema: { type: 'string' } } },
    }),
  )
  await writeFile(
    join(flow, 'FLOW.ts'),
    `
    import { handle } from './sdk/index.js';
    await handle(async run => {
      const mode = run.input.mode ?? 'console';
      console.log('live:' + mode);
      let recovered = null, sendAfterDisposal = null;
      if (mode === 'recover') {
        const pair = await run.channel({schema:{type:'string'}});
        const stop = new AbortController();
        const reading = pair.receive.next({signal:stop.signal}).catch(error => error.code);
        await Bun.sleep(50);
        stop.abort();
        recovered = await reading;
        await pair.receive.close();
        try { await pair.send.send('late'); } catch (error) { sendAfterDisposal = error.code; }
      }
      if (run.channels.progress) await run.channels.progress.send('working:' + mode);
      if (mode === 'cancel') await Bun.sleep(60_000);
      if (run.channels.progress) await run.channels.progress.close();
      await Bun.sleep(300);
      return {outcome:'done',output:{mode,recovered,sendAfterDisposal}};
    });
  `,
  )
}

async function writeChildChannelProject(root: string): Promise<void> {
  await mkdir(join(root, 'bindings'), { recursive: true })
  await writeFile(
    join(root, 'jig.ts'),
    `
    import { defineJig, discover } from '@jigging/jig';
    export default defineJig({flows:discover('flows'),bindings:discover('bindings')});
  `,
  )
  await writeFile(
    join(root, 'bindings/composition.ts'),
    `
    import { defineBinding } from '@jigging/jig';
    export default defineBinding({package:'./flows/root',slots:{
      worker:'flow:flows/worker',monitor:'flow:flows/monitor',mismatch:'flow:flows/mismatch'
    }});
  `,
  )
  for (const name of ['root', 'worker', 'monitor', 'mismatch']) {
    const directory = join(root, 'flows', name)
    await mkdir(directory, { recursive: true })
    await cp(join(import.meta.dir, '../../flow-sdk/dist'), join(directory, 'sdk'), {
      recursive: true,
    })
    const channels =
      name === 'root'
        ? { progress: { direction: 'send', required: false, schema: { type: 'string' } } }
        : name === 'worker'
          ? {
              progress: { direction: 'send', schema: { type: 'string' } },
              gate: { direction: 'receive', schema: { type: 'null' } },
            }
          : {
              progress: {
                direction: 'receive',
                schema: { type: name === 'mismatch' ? 'number' : 'string' },
              },
              display: { direction: 'send', schema: { type: 'string' } },
            }
    await writeFile(
      join(directory, 'flow.meta.json'),
      metadata(`child-channel-${name}`, 'Exercise exact child communication.'),
    )
    await writeFile(
      join(directory, 'FLOW.contract.json'),
      JSON.stringify({
        $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
        channels,
      }),
    )
  }
  await writeFile(
    join(root, 'flows/worker/FLOW.contract.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
      result: {
        type: 'object',
        properties: {
          outcome: { const: 'done' },
          output: {
            type: 'object',
            properties: {
              completed: { const: true },
              observationLost: { type: ['string', 'null'] },
            },
            required: ['completed', 'observationLost'],
            additionalProperties: false,
          },
        },
        required: ['outcome', 'output'],
        additionalProperties: false,
      },
      channels: {
        progress: { direction: 'send', schema: { type: 'string' } },
        gate: { direction: 'receive', schema: { type: 'null' } },
      },
    }),
  )
  await writeFile(
    join(root, 'flows/root/FLOW.ts'),
    `
    import { handle } from './sdk/index.js';
    await handle(async run => {
      const mode = run.input.mode;
      const progress = await run.channel({schema:{type:'string'}});
      const display = await run.channel({schema:{type:'string'}});
      const gate = await run.channel({schema:{type:'null'}});
      const stop = new AbortController();
      let retained = false, displayIncomplete = null;
      async function closeOffered(endpoint) {
        try { await endpoint.close(); return true; }
        catch(error) { if(error.code !== 'PERMISSION_DENIED') throw error; return false; }
      }
      const showing = (async () => {
        try {
          for await(const line of display.receive) {
            if(run.channels.progress) await run.channels.progress.send(line);
            if(mode === 'monitor-cancel') stop.abort();
            if(line === 'monitor:first' && mode !== 'monitor-cancel' && mode !== 'monitor-fail') {
              await gate.send.send(null); await gate.send.close();
            }
          }
        } catch(error) { displayIncomplete = error.code; }
      })();
      const monitor = run.call({operationId:'monitor',slot:mode === 'mismatch' ? 'mismatch' : 'monitor',
        input:{mode}, channels:{progress:progress.receive,display:display.send}}, {signal:stop.signal})
        .catch(async error => {
          retained = await closeOffered(progress.receive);
          await closeOffered(display.send);
          await gate.send.send(null); await gate.send.close();
          return {error:error.code};
        });
      if(mode === 'early-monitor-fail') await monitor;
      const worker = run.call({operationId:'worker',slot:'worker',input:{mode},channels:{progress:progress.send,gate:gate.receive}})
        .catch(error => ({error:error.code}));
      const results = await Promise.all([worker,monitor]);
      await showing;
      return {outcome:'done',output:{worker:results[0],monitor:results[1],retained,displayIncomplete}};
    });
  `,
  )
  await writeFile(
    join(root, 'flows/worker/FLOW.ts'),
    `
    import { handle } from './sdk/index.js';
    await handle(async run => {
      let observationLost = null;
      for(const phase of ['first','last']) {
        try { await run.channels.progress.send(phase); }
        catch(error) { observationLost = error.code; }
        if(run.input.mode === 'root-cancel') await Bun.sleep(60_000);
        if(phase === 'first') {
          // Wait for the sender's clean close, not just its release message.
          // Disposing after one value could race and disconnect that close.
          for await(const _ of run.channels.gate) {}
        }
        await Bun.sleep(500);
      }
      return {outcome:'done',output:{completed:run.input.mode !== 'invalid-result',observationLost}};
    });
  `,
  )
  const monitor = `
    import { handle } from './sdk/index.js';
    await handle(async run => {
      console.log('monitor-started');
      if(run.input.mode === 'early-monitor-fail') throw new Error('monitor failed before producer admission');
      let count = 0, incomplete = null;
      try {
        for await(const phase of run.channels.progress) {
          count++;
          await run.channels.display.send('monitor:' + phase);
          if(run.input.mode === 'monitor-fail') throw new Error('deliberate monitor failure');
        }
      } catch(error) {
        if(run.input.mode === 'monitor-fail') throw error;
        incomplete = error.code;
      }
      return {outcome:'done',output:{count,incomplete}};
    });
  `
  await writeFile(join(root, 'flows/monitor/FLOW.ts'), monitor)
  await writeFile(join(root, 'flows/mismatch/FLOW.ts'), monitor)
}

async function writeBroadcastChannelProject(root: string): Promise<void> {
  await mkdir(join(root, 'bindings'), { recursive: true })
  await writeFile(
    join(root, 'jig.ts'),
    `
    import {defineJig,discover} from '@jigging/jig';
    export default defineJig({flows:discover('flows'),bindings:discover('bindings')});
  `,
  )
  await writeFile(
    join(root, 'bindings/composition.ts'),
    `
    import {defineBinding} from '@jigging/jig';
    export default defineBinding({package:'./flows/root',slots:{worker:'flow:flows/worker',monitor:'flow:flows/monitor'}});
  `,
  )
  for (const name of ['root', 'worker', 'monitor']) {
    const directory = join(root, 'flows', name)
    await mkdir(directory, { recursive: true })
    await cp(join(import.meta.dir, '../../flow-sdk/dist'), join(directory, 'sdk'), {
      recursive: true,
    })
    const channels =
      name === 'root'
        ? { progress: { direction: 'send', delivery: 'broadcast' } }
        : name === 'worker'
          ? {
              events: { direction: 'send', delivery: 'broadcast' },
              credit: { direction: 'receive' },
            }
          : {
              events: { direction: 'receive', delivery: 'broadcast', schema: { type: 'number' } },
              go: { direction: 'receive' },
              ready: { direction: 'send' },
            }
    await writeFile(
      join(directory, 'flow.meta.json'),
      metadata(`broadcast-${name}`, 'Exercise isolated broadcast delivery.'),
    )
    await writeFile(
      join(directory, 'FLOW.contract.json'),
      JSON.stringify({
        $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
        channels,
      }),
    )
  }
  await writeFile(
    join(root, 'flows/root/FLOW.ts'),
    `
    import {handle} from './sdk/index.js';
    await handle(async run => {
      const source = await run.channel({delivery:'broadcast'});
      const monitoring = await source.subscribe();
      const recording = await source.subscribe();
      const credit = await run.channel();
      const go = await run.channel();
      const ready = await run.channel();
      const monitor = run.call({operationId:'monitor',slot:'monitor',input:run.input,
        channels:{events:monitoring,go:go.receive,ready:ready.send}});
      for await(const _ of ready.receive) {}
      if(run.input.mode === 'dispose') await monitor;
      const recorded = [];
      const capture = (async () => {
        for await(const value of recording) {
          recorded.push(value);
          await run.channels.progress.send(value);
          await credit.send.send(null);
        }
        await credit.send.close();
      })();
      const worker = await run.call({operationId:'worker',slot:'worker',input:run.input,
        channels:{events:source.send,credit:credit.receive}});
      await capture;
      if(run.input.mode !== 'dispose') { await go.send.send(null); await go.send.close(); }
      const monitored = await monitor;
      return {outcome:'done',output:{worker,monitor:monitored,recorded}};
    });
  `,
  )
  await writeFile(
    join(root, 'flows/worker/FLOW.ts'),
    `
    import {handle} from './sdk/index.js';
    await handle(async run => {
      const count = run.input.mode === 'lagged' ? 20 : run.input.mode === 'schema' ? 2 : 1;
      for(let index=0; index<count; index++) {
        await run.channels.events.send(run.input.mode === 'schema' && index === 1 ? 'invalid for monitor' : index);
        await run.channels.credit.next();
        if(run.input.mode === 'cancel') await Bun.sleep(60_000);
      }
      await run.channels.events.close();
      for await(const _ of run.channels.credit) {}
      return {outcome:'done',output:{completed:true,sent:count}};
    });
  `,
  )
  await writeFile(
    join(root, 'flows/monitor/FLOW.ts'),
    `
    import {handle} from './sdk/index.js';
    await handle(async run => {
      await run.channels.ready.send(null); await run.channels.ready.close();
      if(run.input.mode === 'dispose') {
        await run.channels.events.close(); await run.channels.go.close();
        return {outcome:'done',output:{count:0,incomplete:null,disposed:true}};
      }
      for await(const _ of run.channels.go) {}
      let count = 0, incomplete = null;
      try { for await(const _ of run.channels.events) count++; }
      catch(error) { incomplete = error.code; }
      return {outcome:'done',output:{count,incomplete,disposed:false}};
    });
  `,
  )
}

type DatasetPeer = 'normal' | 'fahrenheit' | 'duplicate' | 'unexpected' | 'eof' | 'held'

async function writeChannelConversationProject(root: string, peer: DatasetPeer): Promise<void> {
  await cp(join(import.meta.dir, 'fixtures/channel-conversation'), root, {
    recursive: true,
    filter: (source) => !['node_modules', '.jig', 'jig.lock'].includes(basename(source)),
  })
  // Source-candidate host evidence uses the current SDK in disposable copies;
  // prepared archive qualification separately checks the distribution closure.
  for (const name of ['investigate', 'analysis', 'dataset']) {
    const flow = join(root, 'flows', name)
    await cp(join(import.meta.dir, '../../flow-sdk/dist'), join(flow, 'sdk'), { recursive: true })
    for (const file of await readdir(flow)) {
      if (!file.endsWith('.ts')) continue
      const path = join(flow, file)
      await writeFile(
        path,
        (await readFile(path, 'utf8')).replaceAll("'@jigging/flow'", "'./sdk/index.js'"),
      )
    }
  }
  if (peer === 'normal') return

  if (peer === 'fahrenheit') {
    const path = join(root, 'flows/dataset/contracts/sample-celsius.json')
    const contract = JSON.parse(await readFile(path, 'utf8'))
    contract.id = 'https://example.org/dataset-analysis/sample-fahrenheit'
    contract.semantics =
      'Each celsius field reports degrees Fahrenheit, despite the unchanged field name.'
    await writeFile(path, JSON.stringify(contract))
    const requested = JSON.parse(
      await readFile(join(root, 'flows/investigate/contracts/sample-celsius.json'), 'utf8'),
    )
    expect(contract.item).toEqual(requested.item)
    expect(contract.id).not.toBe(requested.id)
  }
  // Deliberate peers belong to this test, never to the maintained application's
  // public input. Their messages remain shape-valid to exercise domain checks.
  await writeFile(
    join(root, 'flows/dataset/FLOW.ts'),
    `
    import {handle} from './sdk/index.js';
    await handle(async run => {
      console.log('dataset-dispatched');
      const served = [];
      const requests = run.channels.requests[Symbol.asyncIterator]();
      try {
        for (;;) {
          const next = await requests.next();
          if(next.done) break;
          const request = next.value;
          if(${JSON.stringify(peer)} === 'held') {
            console.log('dataset-outstanding');
            await Bun.sleep(60_000);
          }
          if(${JSON.stringify(peer)} === 'eof') {
            await run.channels.replies.close();
            while(!(await requests.next()).done) {}
            return {outcome:'done',output:{served}};
          }
          const sample = run.input.samples.find(value => value.sample === request.sample);
          const reply = {sample:${JSON.stringify(peer)} === 'unexpected' ? 'unrequested' : request.sample,
            celsius:sample.celsius};
          await run.channels.replies.send(reply);
          served.push(request.sample);
          if(${JSON.stringify(peer)} === 'duplicate') await run.channels.replies.send(reply);
        }
        await run.channels.replies.close();
        return {outcome:'done',output:{served}};
      } catch(error) {
        if(error.code !== 'DISCONNECTED') throw error;
        await run.channels.requests.close();
        try { await run.channels.replies.close(); }
        catch(error) { if(error.code !== 'DISCONNECTED') throw error; }
        // This faulty peer has finished emitting; its done flag does not
        // establish protocol correctness or satisfy the root acceptance check.
        return {outcome:'done',output:{served}};
      }
    });
  `,
  )
}

async function invokeChannelCli(
  root: string,
  args: readonly string[],
  observe: {
    record?(value: { readonly type?: string }, running: boolean, cancel: () => void): void
    diagnostic?(text: string, running: boolean, cancel: () => void): void
  } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([join(import.meta.dir, '../bin/jig'), ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const cancel = () => child.kill('SIGINT')
  const timeout = setTimeout(cancel, 45_000)
  let buffered = ''
  const stdout = consume(child.stdout, (text) => {
    if (!observe.record) return
    buffered += text
    for (;;) {
      const newline = buffered.indexOf('\n')
      if (newline === -1) return
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      observe.record(JSON.parse(line), child.exitCode === null, cancel)
    }
  })
  const stderr = consume(child.stderr, (text) =>
    observe.diagnostic?.(text, child.exitCode === null, cancel),
  )
  try {
    const [code, out, error] = await Promise.all([child.exited, stdout, stderr])
    return { code, stdout: out, stderr: error }
  } finally {
    clearTimeout(timeout)
    if (child.exitCode === null) cancel()
    await child.exited
    await Promise.allSettled([stdout, stderr])
  }

  async function consume(stream: ReadableStream<Uint8Array>, chunk: (text: string) => void) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let text = ''
    try {
      for (;;) {
        const result = await reader.read()
        if (result.done) return text + decoder.decode()
        const next = decoder.decode(result.value, { stream: true })
        text += next
        if (text.length > 4 * 1024 * 1024)
          throw new Error('channel CLI fixture output exceeded its bound')
        chunk(next)
      }
    } finally {
      reader.releaseLock()
    }
  }
}

// Ordinary public Run/1 consumer: no repository SDK injection or host imports.
async function writeBoundResourceProject(root: string): Promise<void> {
  await writeFile(
    join(root, 'jig.ts'),
    'import { defineJig, discover } from "@jigging/jig"; export default defineJig({flows: discover("flows"), bindings: discover("bindings")});',
  )
  await mkdir(join(root, 'bindings'))
  await mkdir(join(root, 'flows/decode'), { recursive: true })
  await writeFile(
    join(root, 'flows/decode/FLOW.contract.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
      attachments: { decoder: 'read' },
      outcomes: { blocked: 'The selected decoder refused its input.' },
    }),
  )
  await writeFile(
    join(root, 'flows/decode/FLOW.ts'),
    `
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method !== 'flow/run') continue;
  const tool = request.params.attachments.decoder.path + '/decode.ts';
  const original = readFileSync(tool);
  let immutable = false;
  try { writeFileSync(tool, 'overwrite'); } catch { immutable = true; }
  if (!readFileSync(tool).equals(original)) throw new Error('resource changed');
  const child = spawn(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', tool, String(request.params.input)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const bytes = [];
  child.stdout.on('data', data => bytes.push(data));
  child.stderr.pipe(process.stderr);
  const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const result = exitCode === 0 ? { outcome: 'done', output: { bytes: [...Buffer.concat(bytes)], immutable, hostAbsent: !existsSync(${JSON.stringify(root)}) } } : { outcome: 'blocked', output: { exitCode } };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
  lines.close(); break;
}
`,
  )
  for (const [id, decode] of [
    ['first', 'Buffer.from(value, "base64")'],
    ['second', 'Uint8Array.from(atob(value), c => c.charCodeAt(0))'],
  ]) {
    await mkdir(join(root, 'tools', id!), { recursive: true })
    await writeFile(
      join(root, 'tools', id!, 'decode.ts'),
      `const value = process.argv[2];
if (value === 'bad') process.exit(2);
if (value === 'hold') { console.error('bound-tool-started'); setInterval(() => {}, 1000); }
else process.stdout.write(${decode});`,
    )
    await writeFile(
      join(root, 'bindings', id! + '.ts'),
      `import { defineBinding } from '@jigging/jig'; export default defineBinding({ package: 'flows/decode', attachments: { decoder: 'tools/${id}' } });`,
    )
  }
}

function bunWorkerProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.ts";',
    '',
    'await handle(async (context) => {',
    '  const delayMs = typeof context.input === "object" && context.input !== null &&',
    '    "delayMs" in context.input && typeof context.input.delayMs === "number"',
    '    ? context.input.delayMs',
    '    : 0;',
    '  if (delayMs > 0) await Bun.sleep(delayMs);',
    '  return { outcome: "done", output: { worker: context.input } };',
    '});',
    '',
  ].join('\n')
}

async function invoke(arguments_: readonly string[]): Promise<unknown> {
  const subprocess = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, '..', 'scripts', 'private-foreground.ts'),
      ...arguments_,
    ],
    {
      cwd: join(import.meta.dir, '..', '..', '..'),
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])
  if (exitCode !== 0) throw new Error(`private foreground failed (${exitCode}): ${stderr}`)
  expect(stderr).toBe('')
  return JSON.parse(stdout)
}

async function invokeRun(root: string, request: unknown): Promise<ForegroundRunResult> {
  return (await invoke(['run', root, '--request', JSON.stringify(request)])) as ForegroundRunResult
}

function firstRun(result: ForegroundRunResult): ForegroundRunEntry {
  expect(result.kind).toBe('private-foreground-run/1')
  expect(result.runs).toHaveLength(1)
  return result.runs[0]!
}

async function invokeFailure(arguments_: readonly string[]): Promise<string> {
  const subprocess = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, '..', 'scripts', 'private-foreground.ts'),
      ...arguments_,
    ],
    {
      cwd: join(import.meta.dir, '..', '..', '..'),
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])
  expect(exitCode).not.toBe(0)
  expect(stdout).toBe('')
  return stderr
}

function inspectPlanningState(root: string): {
  readonly candidateRevision: number
  readonly candidates: number
  readonly plans: number
  readonly admissions: number
  readonly rootRuns: number
  readonly planDigest: string
} {
  return withStore(root, (database) => {
    const scalar = (query: string, field: string): unknown => database.query(query).get()[field]
    return {
      candidateRevision: Number(
        scalar('SELECT revision FROM candidate_head WHERE singleton = 1', 'revision'),
      ),
      candidates: Number(scalar('SELECT count(*) AS count FROM candidates', 'count')),
      plans: Number(scalar('SELECT count(*) AS count FROM review_plans', 'count')),
      admissions: Number(scalar('SELECT count(*) AS count FROM admissions', 'count')),
      rootRuns: Number(scalar('SELECT count(*) AS count FROM root_runs', 'count')),
      planDigest: String(scalar('SELECT plan_digest FROM review_plans', 'plan_digest')),
    }
  })
}

function inspectRootExecution(
  root: string,
  runId: string,
): {
  readonly rows: number
  readonly sandboxDigest: string
  readonly preparedDigest: string
} {
  return withStore(root, (database) => {
    const row = database
      .query(
        [
          'SELECT count(*) AS rows, max(sandbox_digest) AS sandbox_digest,',
          'max(prepared_digest) AS prepared_digest FROM root_execution_lifecycles WHERE run_id = ?1',
        ].join(' '),
      )
      .get(runId)
    return {
      rows: Number(row.rows),
      sandboxDigest: String(row.sandbox_digest),
      preparedDigest: String(row.prepared_digest),
    }
  })
}

function inspectChildOwnerCount(root: string): number {
  return withStore(root, (database) =>
    Number(database.query('SELECT count(*) AS count FROM root_child_owners').get().count),
  )
}

function inspectRunOwnership(
  root: string,
  runId: string,
): {
  readonly childOwners: number
  readonly terminals: number
} {
  return withStore(root, (database) => ({
    childOwners: Number(
      database
        .query('SELECT count(*) AS count FROM root_child_owners WHERE parent_run_id = ?1')
        .get(runId).count,
    ),
    terminals: Number(
      database.query('SELECT count(*) AS count FROM root_terminals WHERE run_id = ?1').get(runId)
        .count,
    ),
  }))
}

async function expectNoChildResidue(root: string): Promise<void> {
  expect(inspectChildOwnerCount(root)).toBe(0)
  const [materializations, owners] = await Promise.all([
    directoryEntries(join(root, '.jig', 'private-root-materializations')),
    directoryEntries(join(root, '.jig', 'private-root-linux-owners')),
  ])
  expect(materializations.filter((entry) => entry.startsWith('child-'))).toEqual([])
  expect(owners.filter((entry) => /^(c-|a-|x-)/.test(entry))).toEqual([])
}

async function treeContains(root: string, needle: string): Promise<boolean> {
  const encoded = Buffer.from(needle)
  for (const relative of await readdir(root, { recursive: true })) {
    const path = join(root, relative)
    const information = await lstat(path)
    if (information.isFile() && Buffer.from(await readFile(path)).includes(encoded)) return true
  }
  return false
}

async function directoryEntries(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      return []
    throw error
  }
}

function withStore<Value>(root: string, use: (database: any) => Value): Value {
  const sqlite = createRequire(import.meta.url)('bun:sqlite') as any
  const database = sqlite.Database.open(
    join(root, '.jig', 'jig.sqlite3'),
    sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
  )
  try {
    return use(database)
  } finally {
    database.close(true)
  }
}

async function waitForPrepared(root: string, runId: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const prepared = withStore(root, (database) =>
        database
          .query(
            [
              'SELECT count(*) AS count FROM root_execution_lifecycles',
              'WHERE run_id = ?1 AND sandbox_digest IS NOT NULL AND prepared_digest IS NOT NULL',
            ].join(' '),
          )
          .get(runId),
      )
      if (Number(prepared.count) === 1) return
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== 'SQLITE_BUSY') throw error
    }
    await Bun.sleep(50)
  }
  throw new Error('root Run did not reach the prepared ownership boundary')
}

async function waitForChildSandbox(root: string, runId: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const child = withStore(root, (database) =>
        database
          .query(
            [
              'SELECT count(*) AS count FROM root_child_owners',
              'WHERE parent_run_id = ?1 AND sandbox_digest IS NOT NULL',
            ].join(' '),
          )
          .get(runId),
      )
      if (Number(child.count) === 1) return
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== 'SQLITE_BUSY') throw error
    }
    await Bun.sleep(50)
  }
  throw new Error('child Flow did not reach the durable sandbox ownership boundary')
}

async function waitForTerminalStatus(
  administration: RootAdministration,
  receipt: StartRootRunReceipt,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await administration.runStatus(receipt)
    if (status.state === 'terminal') return status
    await Bun.sleep(20)
  }
  throw new Error('root Run did not reach a terminal status')
}

async function rootlessCgroups(): Promise<string[]> {
  const delegated = process.env.AGENT_DELEGATED_CGROUP
  if (delegated === undefined) {
    if (HOSTILE) throw new Error('rootless project proof has no delegated cgroup')
    return []
  }
  return (await readdir(delegated)).filter((entry) => entry.startsWith('jig-run-')).sort()
}

async function waitForRootlessCgroups(expected: ReadonlySet<string>): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const current = await rootlessCgroups()
    if (sameMembers(current, expected)) return
    await Bun.sleep(20)
  }
  throw new Error('rootless project Runs left cgroup residue')
}

function rootlessTemporaryEntry(entry: string): boolean {
  return (
    entry.startsWith('jig-rootless-control-') ||
    entry.startsWith('jig-rootless-owner-') ||
    entry.startsWith('jig-rootless-devices-')
  )
}

async function waitForRootlessTemporaryState(expected: ReadonlySet<string>): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const current = (await readdir(tmpdir())).filter(rootlessTemporaryEntry)
    if (sameMembers(current, expected)) return
    await Bun.sleep(20)
  }
  throw new Error('rootless project Runs left temporary owner state')
}

function sameMembers(values: readonly string[], expected: ReadonlySet<string>): boolean {
  return (
    values.every((value) => expected.has(value)) &&
    [...expected].every((value) => values.includes(value))
  )
}

async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) throw new Error('project-session fixture ended before its receipt')
      buffered += decoder.decode(next.value, { stream: true })
      const newline = buffered.indexOf('\n')
      if (newline !== -1) return buffered.slice(0, newline)
    }
  } finally {
    reader.releaseLock()
  }
}

interface WithheldChildFenceState {
  allowRecovery: boolean
  childAdmits: number
  recoverAttempts: number
}

const withheldChildFenceStates = new WeakMap<WithheldChildFenceBackend, WithheldChildFenceState>()

class WithheldChildFenceBackend extends PrivateLinuxCgroupBackend {
  constructor(options: PrivateLinuxCgroupBackendOptions) {
    super(options)
    withheldChildFenceStates.set(this, {
      allowRecovery: false,
      childAdmits: 0,
      recoverAttempts: 0,
    })
  }

  override async seal(
    ...arguments_: Parameters<PrivateLinuxCgroupBackend['seal']>
  ): Promise<PrivateLinuxSealedOwner> {
    const sealed = await super.seal(...arguments_)
    if (!sealed.identity.runId.startsWith('child-')) return sealed
    return Object.freeze({
      identity: sealed.identity,
      admit: async (...admitArguments: Parameters<PrivateLinuxSealedOwner['admit']>) => {
        const state = withheldState(this)
        state.childAdmits += 1
        const component = await sealed.admit(...admitArguments)
        return Object.freeze({
          ...component,
          enforcement: component.enforcement.then(() => {
            throw new PrivateLinuxFenceUnconfirmedError(
              new Error('test withheld the confirmed child fence'),
            )
          }),
        })
      },
    })
  }

  override async recoverFence(owner: unknown): Promise<PrivateLinuxConfirmedEnforcementReceipt> {
    if (childOwner(owner)) {
      const state = withheldState(this)
      state.recoverAttempts += 1
      if (!state.allowRecovery) {
        throw new PrivateLinuxFenceUnconfirmedError(
          new Error('test withheld the durable child fence'),
        )
      }
    }
    return await super.recoverFence(owner)
  }

  allowRecovery(): void {
    withheldState(this).allowRecovery = true
  }

  childAdmits(): number {
    return withheldState(this).childAdmits
  }

  async waitForRecoverAttempts(count: number): Promise<void> {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      if (withheldState(this).recoverAttempts >= count) return
      await Bun.sleep(20)
    }
    throw new Error('child fence recovery was not attempted')
  }
}

function withheldState(backend: WithheldChildFenceBackend): WithheldChildFenceState {
  const state = withheldChildFenceStates.get(backend)
  if (state === undefined) throw new Error('withheld child fence Backend state is absent')
  return state
}

function childOwner(value: unknown): value is PrivateLinuxSealedOwnerIdentity {
  return (
    value !== null &&
    typeof value === 'object' &&
    'runId' in value &&
    typeof value.runId === 'string' &&
    value.runId.startsWith('child-')
  )
}
