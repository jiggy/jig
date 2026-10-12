// Actual main with controlled host/transport/visual faults. No native capability
// is issued; this fixture proves portable lifecycle selection and ordering only.
import { mock, spyOn } from 'bun:test'
import { fstatSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrivateCliProgress } from '../../src/cli-progress.js'
import { CliDiagnostic } from '../../src/cli-usage.js'
import * as fileInput from '../../src/internal/file-input.js'
import { PrivateRootRunFiles } from '../../src/internal/root-run-files.js'
import { privatePresentationNow } from '../../src/internal/root-run-timeout-policy.js'
import type { JsonValue } from '../../src/json.js'

interface CaseState {
  scenario: string
  events: string[]
  fileCloses: number
  captureCloses: number
  capturedRootFd: number | undefined
  capturedInputFiles: number
}
let active: CaseState
const originalCapture = fileInput.privateCaptureAttachments
mock.module('../../src/internal/file-input.js', () => ({
  ...fileInput,
  privateCaptureAttachments(...input: Parameters<typeof originalCapture>) {
    const capture = originalCapture(...input)
    const state = active
    state.capturedRootFd = capture.attachments[0]?.rootFd
    state.capturedInputFiles = capture.attachments.reduce(
      (count, item) => count + item.files.length,
      0,
    )
    return {
      attachments: capture.attachments,
      close() {
        state.captureCloses++
        state.events.push('capture-close')
        capture.close()
        // A second close would heal. The caller must preserve the first failure.
        if (
          state.captureCloses === 1 &&
          [
            'capture-close-failure',
            'retire-and-capture-failure',
            'primary-and-close-failure',
          ].includes(state.scenario)
        )
          throw new Error('controlled secondary capture close failure')
      },
    }
  },
}))
const originalFileClose = PrivateRootRunFiles.prototype.close
spyOn(PrivateRootRunFiles.prototype, 'close').mockImplementation(function () {
  active.fileCloses++
  active.events.push('files-close')
  return originalFileClose.call(this)
})
spyOn(PrivateCliProgress.prototype, 'prepareTuiDisplay').mockImplementation(async () => {})
spyOn(PrivateCliProgress.prototype, 'prepareWeb').mockImplementation(() => {})
spyOn(PrivateCliProgress.prototype, 'configureDisplay').mockImplementation(async () => {
  active.events.push('display-enter')
})
spyOn(PrivateCliProgress.prototype, 'closeWorkspace').mockImplementation(async () => {
  active.events.push('workspace-close')
})
spyOn(PrivateCliProgress.prototype, 'settleDisplay').mockImplementation(async () => {
  active.events.push('display-settle')
  if (['late-report-failure', 'retire-and-capture-failure'].includes(active.scenario))
    throw new CliDiagnostic('JIG_REPORT_LIMIT', 'controlled primary report failure', 2)
})
const { main } = await import('../../src/cli.js')

async function runCase(scenario: string, display: string) {
  const state: CaseState = {
    scenario,
    events: [],
    fileCloses: 0,
    captureCloses: 0,
    capturedInputFiles: 0,
    capturedRootFd: undefined,
  }
  active = state
  const events = state.events
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-cli-retirement-order-')))
  const inputDirectory = join(root, 'input')
  if (scenario.startsWith('pending-')) {
    await mkdir(inputDirectory)
    await writeFile(join(inputDirectory, 'input.txt'), 'original bounded input\n')
  }
  const runId = `sha256:${'a'.repeat(64)}`
  const cancellation = new AbortController()
  const presentationDeadline = scenario.startsWith('pending-')
    ? privatePresentationNow() + 120
    : scenario === 'tight-deadline'
      ? privatePresentationNow() + 800
      : scenario === 'expired-deadline'
        ? privatePresentationNow() - 1
        : undefined
  const terminal =
    scenario === 'failed'
      ? {
          status: 'failed',
          code: 'EXECUTION_FAILED',
          message: 'controlled execution failure',
          diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
        }
      : scenario === 'lost'
        ? { status: 'lost', code: 'LOST', message: 'controlled lost result' }
        : {
            status: 'succeeded',
            outcome: 'domain-blocked',
            output: { evidence: 'original result' },
            diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
          }
  let recoveryBound = false
  let retired = false
  let retires = 0
  let previews = 0
  let sessionCloses = 0
  let observedDeadline: number | undefined
  let output = ''
  let error = ''
  const receipt = {
    status: 'written' as const,
    destination: join(root, 'packet'),
    source: 'final' as const,
    files: [
      {
        path: 'first.txt',
        bytes: 15,
        digest: 'sha256:45c0b761a6c6640319e6cddeb492718532f70161ed9174c75ca7f1158c508b2f',
      },
    ],
  }
  const delivery = {
    async prepare() {
      events.push('prepare')
    },
    async bindRootRecovery() {
      recoveryBound = true
      events.push('recovery-bound')
    },
    async publish(record: JsonValue) {
      events.push('publish')
      return scenario === 'invalid-files'
        ? {
            status: 'failed' as const,
            destination: receipt.destination,
            code: 'INVALID_FILES' as const,
          }
        : record !== null &&
            typeof record === 'object' &&
            !Array.isArray(record) &&
            'status' in record &&
            record.status === 'succeeded' &&
            scenario !== 'cancelled'
          ? receipt
          : { ...receipt, files: [], source: 'none' as const }
    },
    async inspectionPreview(path: string) {
      previews++
      events.push('preview')
      if (path !== 'first.txt') throw new Error('preview must belong to the receipt')
      return { state: 'text' as const, text: 'original bytes\n', bytes: 15, clipped: false }
    },
    ...(scenario === 'missing-retire'
      ? {}
      : {
          async retire(options: { deadline: number; signal?: AbortSignal }) {
            retires++
            observedDeadline = options.deadline
            events.push('retire')
            if (options.signal?.aborted) throw new Error('execution cancellation reached cleanup')
            if (
              retires === 1 &&
              ['retire-failure', 'retire-and-capture-failure'].includes(scenario)
            )
              throw new Error('controlled original retirement failure')
            // A controlled timely ACK and channel join, not a native certificate.
            events.push('retirement-ack')
            await Promise.resolve()
            retired = true
            recoveryBound = false
            events.push('spent-channel-joined')
          },
        }),
  }
  const outputRequested = !['record-only', 'no-delivery'].includes(scenario)
  try {
    const code = await main(
      [
        'run',
        'flow:flows/work',
        '--display',
        display === 'json' ? 'plain' : display,
        ...(display === 'json' ? ['--json'] : []),
        ...(outputRequested ? ['--out', receipt.destination] : []),
        ...(scenario.startsWith('pending-') ? ['--attach', `source=${inputDirectory}`] : []),
      ],
      {
        currentDirectory: root,
        runArgumentsPrepared: true,
        interactive: true,
        terminalError: true,
        terminalOutput: false,
        signal: cancellation.signal,
        presentationDeadline,
        host: {
          ...(scenario === 'no-delivery' ? {} : { delivery }),
          async acquire(_project, options) {
            events.push('acquire')
            if (options?.files !== undefined) await options.files.bindRootRecovery(runId, root, 1)
            if (scenario.startsWith('pending-')) {
              // This unresolved original collection issues no native output cap.
              // Its close remains unknown when the existing local bound ends.
              if (scenario.includes('snapshot'))
                options!.files!.retainOutput({
                  kind: 'snapshot',
                  ready: new Promise(() => {}),
                })
              else
                options!.files!.retainOutput({
                  kind: 'macos-directory',
                  ready: new Promise(() => {}),
                })
            }
            if (scenario === 'blocked-setup')
              throw new CliDiagnostic(
                'JIG_RUN_INPUT_INVALID',
                'controlled primary setup failure',
                1,
              )
            return {
              rootAdministration: {
                async startRun() {
                  events.push('dispatched')
                  options?.channelOutput?.dispatched?.()
                  return { runId }
                },
                async runStatus() {
                  if (
                    [
                      'observation-failure',
                      'observation-close-failure',
                      'primary-and-close-failure',
                    ].includes(scenario) ||
                    scenario.endsWith('-observation-failure')
                  )
                    throw new CliDiagnostic(
                      'JIG_RUN_INPUT_INVALID',
                      'controlled primary observation failure',
                      1,
                    )
                  return { state: 'terminal', runId, terminal }
                },
              },
              async close() {
                sessionCloses++
                events.push('project-close')
                if (
                  ['project-close-failure', 'observation-close-failure'].includes(scenario) ||
                  scenario.endsWith('-project-close-failure')
                )
                  throw new Error('controlled project close uncertainty')
                if (scenario === 'cancelled') cancellation.abort()
              },
            } as any
          },
        },
        writeStderr: async (text) => {
          error += text
        },
        writeError: (text) => {
          error += text
        },
        writeOutput: () => {},
        writeRecord: async (text) => {
          events.push('stdout')
          output += text
        },
      },
    )
    let capturedInputRootClosed = false
    if (state.capturedRootFd !== undefined) {
      try {
        fstatSync(state.capturedRootFd)
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== 'EBADF') throw failure
        capturedInputRootClosed = true
      }
    }
    // The original transport's unchanged selector is corroborated separately.
    // This controlled transport retains its binding when main makes no retire.
    events.push('source-exit')
    const originalRecoveryStillSelected = recoveryBound && !retired
    return {
      scenario,
      display,
      code,
      events,
      retires,
      previews,
      sessionCloses,
      fileCloses: state.fileCloses,
      captureCloses: state.captureCloses,
      capturedInputFiles: state.capturedInputFiles,
      capturedInputRootClosed,
      presentationDeadline,
      observedDeadline,
      originalRecoveryStillSelected,
      output,
      error,
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

if (process.argv.slice(2).join() !== 'all') throw new Error('invalid controlled CLI fixture')
const cases: Array<{ scenario: string; display: string }> = []
for (const display of ['plain', 'json', 'tui', 'web']) {
  for (const scenario of [
    'success',
    'project-close-failure',
    'observation-close-failure',
    'observation-failure',
    'blocked-setup',
  ])
    cases.push({ scenario, display })
}
for (const display of ['plain', 'web']) {
  for (const scenario of [
    'record-only',
    'failed',
    'lost',
    'invalid-files',
    'cancelled',
    'no-delivery',
    'missing-retire',
  ])
    cases.push({ scenario, display })
}
for (const scenario of [
  'retire-failure',
  'capture-close-failure',
  'retire-and-capture-failure',
  'primary-and-close-failure',
  'late-report-failure',
  'tight-deadline',
  'expired-deadline',
])
  cases.push({ scenario, display: 'plain' })
for (const display of ['plain', 'web']) {
  for (const output of ['snapshot', 'macos']) {
    for (const fault of ['observation-failure', 'project-close-failure'])
      cases.push({ scenario: `pending-${output}-${fault}`, display })
  }
}
const results = []
for (const item of cases) results.push(await runCase(item.scenario, item.display))
process.stdout.write(JSON.stringify(results) + '\n')
