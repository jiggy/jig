import { dirname as suiteDirname } from 'node:path'

const suiteTestRoot = suiteDirname(import.meta.dir)

import { describe, expect, test } from 'bun:test'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import { normalizePrivateLinuxSealedOwnerIdentity } from '../../src/internal/linux-rootless-backend.js'
import { openPrivateProjectSession } from '../../src/internal/project-session-controller.js'
import { installedBunLocation } from '.././fixtures/installed-bun-location.js'
import {
  type ApplicablePlan,
  directoryEntries,
  expectNoChildResidue,
  type ForegroundRunResult,
  firstLine,
  firstRun,
  inspectPlanningState,
  inspectRootExecution,
  inspectRunOwnership,
  invoke,
  invokeChannelCli,
  invokeFailure,
  invokeRun,
  rootlessCgroups,
  rootlessTemporaryEntry,
  waitForChildSandbox,
  waitForPrepared,
  waitForRootlessCgroups,
  waitForRootlessTemporaryState,
  waitForTerminalStatus,
  withStore,
  writeAgentFreeProject,
  writeBoundResourceProject,
  writeBroadcastChannelProject,
  writeChannelConversationProject,
  writeChannelProject,
  writeChildChannelProject,
  writeProject,
} from '.././private-foreground.fixture.js'

const initialRootlessTemporaryState = new Set(
  (await readdir(tmpdir())).filter(rootlessTemporaryEntry),
)
const initialRootlessCgroups = new Set(await rootlessCgroups())

describe.serial('private rootless project session', () => {
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
      expect(override.stderr).toContain('JIG_RUN_FILES_INVALID')
      expect(override.stderr).toContain('No Flow was started')
      expect(override.stderr).toContain('Remove overrides of review-pinned attachments: "decoder".')
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
      expect(refused.stderr).toContain('JIG_RUN_FILES_INVALID')
      expect(refused.stderr).toContain('No Flow was started')
      expect(refused.stderr).toContain('Missing read attachments: "decoder".')
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
        expect(await directoryEntries(join(root, '.jig/private-root-owners'))).toEqual([])
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
      expect(await directoryEntries(join(root, '.jig/private-root-owners'))).toEqual([])
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
        [
          'run',
          'flow:flows/worker',
          '--input',
          '{"mode":"cancel"}',
          '--receive',
          'progress',
          '--out',
          'cancelled-result',
        ],
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
      expect(interrupted.code, interrupted.stdout + interrupted.stderr).toBe(2)
      const terminals = interrupted.stdout
        .trimEnd()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((record) => record.type === 'terminal')
      expect(terminals).toHaveLength(1)
      expect(terminals[0].result).toMatchObject({
        status: 'failed',
        code: 'CANCELLED',
        command: { status: 'interrupted' },
        delivery: { status: 'written', source: 'none', files: [] },
      })
      expect(terminals[0].result.cleanup).toBeUndefined()
      expect(
        JSON.parse(await readFile(join(root, 'cancelled-result/result.json'), 'utf8')),
      ).toEqual(terminals[0].result)
      expect(await readdir(join(root, 'cancelled-result/files'))).toEqual([])
      await expectNoChildResidue(root)
      expect(await directoryEntries(join(root, '.jig/private-root-owners'))).toEqual([])
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
      expect(next.review.text).not.toContain(
        'Flow source, prepared dependencies, settings and permissions are unchanged.',
      )
      expect(next.review.details).toContain(
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
      await writeFile(join(malformed, 'FLOW.meta.json'), 'not Metadata/0\n')
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
          path: 'flows/malformed/FLOW.meta.json',
        },
      })
      expect(JSON.stringify(failure)).not.toContain(root)
      expect(JSON.stringify(failure)).not.toContain('not Metadata/0')
    } finally {
      await session?.close().catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  })
  test('executes exact child slots inside the parent deadline and leaves no child owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-private-child-slots-'))
    let failed = false
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
          join(suiteTestRoot, 'fixtures', 'project-session-runner.ts'),
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

      let heldDiagnostics = ''
      const heldRecords: unknown[] = []
      const uncertainHost = await openPrivateInstalledBunHost(installedBunLocation)
      const uncertainSession = await openPrivateProjectSession({
        directory: root,
        host: {
          ...uncertainHost,
          channelOutput: {
            receive: [],
            async record(value) {
              heldRecords.push(value)
            },
            diagnostic(bytes, operations, source) {
              if (
                operations?.length === 1 &&
                operations[0] === 'errors:fence' &&
                source?.call?.operationId === 'errors:fence' &&
                source.call.publisher === 'root' &&
                source.emitter === 'flow:errors:fence'
              )
                heldDiagnostics = (heldDiagnostics + Buffer.from(bytes).toString('utf8')).slice(
                  -4096,
                )
            },
          },
        },
      })
      const uncertainRequest = {
        submissionId: 'child-slot-owner-identity-loss',
        target: { kind: 'binding' as const, id: 'ticket-router' },
        input: { scenario: 'fence-uncertain', kind: 'bug', ticket: 'owner identity loss' },
      }
      let displaced: { path: string; quarantine: string; device: bigint; inode: bigint } | undefined
      let uncertainReceipt: Awaited<ReturnType<typeof uncertainSession.rootAdministration.startRun>>
      const uncertaintyFailures: unknown[] = []
      try {
        uncertainReceipt = await uncertainSession.rootAdministration.startRun(uncertainRequest)
        await waitForChildSandbox(root, uncertainReceipt.runId)
        const row = withStore(root, (database) =>
          database
            .query('SELECT sandbox_bytes FROM root_child_owners WHERE parent_run_id = ?1')
            .get(uncertainReceipt.runId),
        )
        const sandbox = JSON.parse(Buffer.from(row.sandbox_bytes).toString('utf8'))
        expect(sandbox.kind).toBe('private-root-child-sandbox/1')
        const owner = normalizePrivateLinuxSealedOwnerIdentity(sandbox.owner)
        expect(owner.ownerStateParent).toBe(join(root, '.jig', 'private-root-owners'))
        const parent = await lstat(owner.ownerStateParent, { bigint: true })
        expect(parent.isDirectory()).toBeTrue()
        expect(parent.isSymbolicLink()).toBeFalse()
        expect(String(parent.dev)).toBe(owner.ownerStateParentDevice)
        expect(String(parent.ino)).toBe(owner.ownerStateParentInode)
        const before = await lstat(owner.ownerStateDirectory, { bigint: true })
        expect(before.isDirectory()).toBeTrue()
        expect(before.isSymbolicLink()).toBeFalse()
        expect(String(before.dev)).toBe(owner.ownerStateDevice)
        expect(String(before.ino)).toBe(owner.ownerStateInode)
        // The durable sealed row precedes admission and cgroup creation.
        // Await actual application stderr, correlated to this child call.
        const activeDeadline = Date.now() + 20_000
        while (!heldDiagnostics.includes('held-child-ready\n') && Date.now() < activeDeadline) {
          const status = await uncertainSession.rootAdministration.runStatus(uncertainReceipt)
          if (status.state === 'terminal')
            throw new Error(`held child terminated before readiness: ${JSON.stringify(status)}`)
          const finalText = await readFile(
            join(owner.ownerStateDirectory, 'final.json'),
            'utf8',
          ).catch((error) => {
            if (error.code === 'ENOENT') return undefined
            throw error
          })
          if (finalText !== undefined) {
            const final = JSON.parse(finalText)
            throw new Error(
              `child published final before readiness: ${JSON.stringify({
                stopReason: final.stopReason,
                exitCode: final.exitCode,
                signal: final.signal,
                fenced: final.fenced,
              })}`,
            )
          }
          await Bun.sleep(20)
        }
        expect(heldDiagnostics).toContain('held-child-ready\n')
        expect(heldRecords).toEqual([])
        const pids = (await readFile(join(owner.runCgroup, 'cgroup.procs'), 'utf8'))
          .trim()
          .split(/\s+/)
          .filter(Boolean)
        const activeChildren: { pid: number; startTime: string; command: string }[] = []
        // The launcher and inner supervisor also carry the payload argv.
        // Match the complete bun-direct-run command for this root-entrypoint
        // fixture, not a forwarded FLOW.ts argument in an ancestor's argv.
        const payloadCommand =
          [
            '/jig-runtime/bun',
            '--no-env-file',
            '--no-install',
            '--config=/dev/null',
            '/package/FLOW.ts',
          ].join('\0') + '\0'
        for (const pid of pids) {
          const command = await readFile(`/proc/${pid}/cmdline`, 'utf8')
          if (command === payloadCommand) {
            const status = await readFile(`/proc/${pid}/stat`, 'utf8')
            activeChildren.push({
              pid: Number(pid),
              startTime: status.slice(status.lastIndexOf(')') + 2).split(' ')[19]!,
              command,
            })
          }
        }
        expect(activeChildren).toHaveLength(1)
        const quarantine = `${owner.ownerStateDirectory}-quarantine`
        await expect(lstat(quarantine)).rejects.toMatchObject({ code: 'ENOENT' })
        await rename(owner.ownerStateDirectory, quarantine)
        displaced = {
          path: owner.ownerStateDirectory,
          quarantine,
          device: before.dev,
          inode: before.ino,
        }
        const quarantined = await lstat(quarantine, { bigint: true })
        expect(quarantined.isDirectory()).toBeTrue()
        expect(quarantined.isSymbolicLink()).toBeFalse()
        expect(quarantined.dev).toBe(before.dev)
        expect(quarantined.ino).toBe(before.ino)
        // The supervisor can still publish its genuine final receipt into the
        // original inode. The backend must refuse this noncanonical pathname.
        await symlink(quarantine, owner.ownerStateDirectory)
        const held = activeChildren[0]!
        const currentPids = (await readFile(join(owner.runCgroup, 'cgroup.procs'), 'utf8'))
          .trim()
          .split(/\s+/)
        expect(currentPids).toContain(String(held.pid))
        const currentStatus = await readFile(`/proc/${held.pid}/stat`, 'utf8')
        expect(currentStatus.slice(currentStatus.lastIndexOf(')') + 2).split(' ')[19]).toBe(
          held.startTime,
        )
        expect(await readFile(`/proc/${held.pid}/cmdline`, 'utf8')).toBe(held.command)
        process.kill(held.pid, 'SIGUSR1')
        const completionDeadline = Date.now() + 30_000
        let final: { fenced: boolean; ownerDigest: string } | undefined
        while (final === undefined && Date.now() < completionDeadline) {
          try {
            final = JSON.parse(await readFile(join(quarantine, 'final.json'), 'utf8'))
          } catch (error) {
            if (error.code !== 'ENOENT') throw error
            await Bun.sleep(20)
          }
        }
        expect(final).toMatchObject({ fenced: true })
        // Await real completion and its filesystem refusal before inspecting
        // parent taint. A stopped process alone would not establish this.
        await expect(
          waitForTerminalStatus(uncertainSession.rootAdministration, uncertainReceipt),
        ).rejects.toMatchObject({ code: 'INTERNAL' })
        await expect(
          uncertainSession.rootAdministration.runStatus(uncertainReceipt),
        ).rejects.toMatchObject({ code: 'INTERNAL' })
        expect(inspectRunOwnership(root, uncertainReceipt.runId)).toEqual({
          childOwners: 1,
          terminals: 0,
        })
        const operations = withStore(root, (database) =>
          database
            .query('SELECT operation_id FROM root_child_owners WHERE parent_run_id = ?1')
            .all(uncertainReceipt.runId),
        )
        expect(operations).toEqual([{ operation_id: 'errors:fence' }])
      } catch (error) {
        uncertaintyFailures.push(error)
      } finally {
        try {
          if (displaced !== undefined) {
            const current = await lstat(displaced.quarantine, { bigint: true })
            expect(current.dev).toBe(displaced.device)
            expect(current.ino).toBe(displaced.inode)
            const originalPath = await lstat(displaced.path).catch((error) => {
              if (error.code === 'ENOENT') return undefined
              throw error
            })
            if (originalPath !== undefined) {
              expect(originalPath.isSymbolicLink()).toBeTrue()
              expect(await readlink(displaced.path)).toBe(displaced.quarantine)
              await unlink(displaced.path)
            }
            await rename(displaced.quarantine, displaced.path)
          }
        } catch (error) {
          uncertaintyFailures.push(error)
        } finally {
          try {
            await uncertainSession.close()
          } catch (error) {
            // This session retains the deliberately observed execution failure.
            // Preserve its close error alongside any primary/restoration error.
            if (uncertaintyFailures.length !== 0 || error.code !== 'UNAVAILABLE')
              uncertaintyFailures.push(error)
          }
        }
      }
      if (uncertaintyFailures.length !== 0)
        throw new AggregateError(uncertaintyFailures, 'child owner identity-loss test failed')
      const uncertainRecovery = await openPrivateProjectSession({
        directory: root,
        host: await openPrivateInstalledBunHost(installedBunLocation),
      })
      try {
        expect(await uncertainRecovery.rootAdministration.startRun(uncertainRequest)).toEqual(
          uncertainReceipt!,
        )
        const status = await uncertainRecovery.rootAdministration.runStatus(uncertainReceipt!)
        expect(status).toMatchObject({
          state: 'terminal',
          terminal: { status: 'failed', code: 'UNCERTAIN' },
        })
        expect(status).not.toHaveProperty('terminal.output')
        expect(inspectRunOwnership(root, uncertainReceipt!.runId)).toEqual({
          childOwners: 0,
          terminals: 1,
        })
      } finally {
        await uncertainRecovery.close()
      }
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
    } catch (error) {
      failed = true
      console.error(`Failed child-slot fixture retained at ${root}`)
      throw error
    } finally {
      if (!failed) await rm(root, { recursive: true, force: true })
    }
  }, 300_000)
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
      expect(ran.kind).toBe('private-foreground-run/0')
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
          join(suiteTestRoot, 'fixtures', 'project-session-runner.ts'),
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

if (process.platform !== 'linux' || process.env.JIG_LINUX_ROOTLESS_HOSTILE !== '1')
  throw Error('This suite requires opted-in rootless Linux qualification')
