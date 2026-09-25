import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { arch, platform, release } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = join(root, 'packages/jig/test/fixtures/channel-conversation')
const warmupCount = 1
const measuredCount = 5
const maxRetainedOutputBytes = 64 * 1024
const maxCommandOutputBytes = 4 * 1024 * 1024
const commandTimeoutMs = 10 * 60_000
const totalProfileTimeoutMs = 30 * 60_000
const projectDeadlineMs = 5 * 60_000

type TracePhase =
  | 'author-configuration-evaluation'
  | 'project-planning'
  | 'installed-host-opening'
  | 'project-session-opening'
  | 'dependency-preparation'
  | 'dependency-reuse'
  | 'root-submission-persistence'
  | 'linux-owner-state-initialization'
  | 'rootless-containment-startup'
  | 'flow-execution'
  | 'operation-owner-settlement'
  | 'root-fence'
  | 'root-settlement'
  | 'project-session-close'

interface CapturedCommand {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly timedOut: boolean
  readonly outputExceeded: boolean
  readonly elapsedMs: number
  readonly stdoutBytes: number
  readonly stderrBytes: number
  readonly stdoutDigest: string
  readonly stderrDigest: string
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
  readonly stdout: string
  readonly stderr: string
}

const environment = requireProfileEnvironment()
const profileDeadlineMs = performance.now() + totalProfileTimeoutMs
const outputDirectory = resolve(environment.outputDirectory)
const archiveDigests = {
  jig: await digestFile(environment.jigArchive),
  flowSdk: await digestFile(environment.flowSdkArchive),
}
const profilePath = join(outputDirectory, 'profile.jsonl')
const summaryPath = join(outputDirectory, 'summary.json')
const profileOutput = await openProfileOutput(outputDirectory, profilePath)
const workDirectory = await mkdtemp(join(environment.runnerTemp, 'jig-startup-profile-work-'))
const measured: Array<{
  readonly reviewMs: number
  readonly runMs: number
  readonly phaseSpansMs: Readonly<Partial<Record<TracePhase, readonly number[]>>>
  readonly phaseEvents: Readonly<Partial<Record<TracePhase, number>>>
}> = []
let allSuccessful = false

try {
  const metadata = await collectMetadata()
  await appendRecord(profileOutput.profile, {
    kind: 'metadata',
    protocol: 'jig-startup-profile/1',
    sourceRevision: process.env.GITHUB_SHA ?? 'unknown',
    artifacts: archiveDigests,
    host: metadata,
    warmups: warmupCount,
    measuredTrials: measuredCount,
    cacheCohort: 'one-warmup-then-fresh-projects-on-warm-host',
    measurementBoundary:
      'Installed CLI/package setup and fixture extraction/installation are excluded; Review and Run command walls are measured.',
    overlap: 'phase spans may nest; do not sum durations',
  })

  const cliDirectory = join(workDirectory, 'cli')
  await mkdir(cliDirectory)
  await writeFile(
    join(cliDirectory, 'package.json'),
    JSON.stringify({
      name: 'jig-startup-profile-cli',
      private: true,
      dependencies: { '@jigging/jig': `file:${environment.jigArchive}` },
    }),
  )
  const cliInstall = await command(
    process.execPath,
    ['install', '--offline', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'],
    cliDirectory,
    environment.child,
  )
  await appendRecord(profileOutput.profile, commandEvidence('install-jig', cliInstall))
  assertCommand(cliInstall, 'install exact Jig archive')
  const jig = join(cliDirectory, 'node_modules', '.bin', 'jig')
  const version = await command(jig, ['--version'], cliDirectory, environment.child)
  await appendRecord(profileOutput.profile, commandEvidence('installed-jig-version', version))
  assertCommand(version, 'identify installed Jig archive')

  const trials = [
    ...Array.from({ length: warmupCount }, (_, index) => ({ kind: 'warmup' as const, index })),
    ...Array.from({ length: measuredCount }, (_, index) => ({ kind: 'measured' as const, index })),
  ]

  for (const trial of trials) {
    const project = join(workDirectory, `project-${trial.kind}-${trial.index + 1}`)
    await createProject(project, environment.flowSdkArchive, trial)

    const reviewProfile = join(workDirectory, `review-${trial.kind}-${trial.index + 1}.jsonl`)
    const review = await profiledCommand(
      jig,
      ['review', '--yes'],
      project,
      reviewProfile,
      environment.child,
    )
    const reviewRecord = await summarizeCommand(review, reviewProfile, trial, 'review')
    await appendRecord(profileOutput.profile, reviewRecord)
    if (review.exitCode !== 0 || review.timedOut || review.outputExceeded) {
      throw new Error(
        `review failed during ${trial.kind} ${trial.index + 1}; see retained profile records`,
      )
    }
    if (
      !reviewRecord.traceValid ||
      reviewRecord.traceTruncated ||
      reviewRecord.traceRecordCount === 0 ||
      review.stdoutTruncated ||
      !review.stdout.includes('Project ready')
    ) {
      throw new Error('review did not produce the expected installed profile and ready result')
    }

    const runProfile = join(workDirectory, `run-${trial.kind}-${trial.index + 1}.jsonl`)
    const run = await profiledCommand(
      jig,
      [
        'run',
        'flow:flows/investigate',
        '--input',
        '@input.json',
        '--timeout',
        `${projectDeadlineMs / 60_000}m`,
      ],
      project,
      runProfile,
      environment.child,
    )
    const conversation = inspectConversationResult(run)
    const runRecord = {
      ...(await summarizeCommand(run, runProfile, trial, 'run', conversation.accepted)),
      conversation,
    }
    await appendRecord(profileOutput.profile, runRecord)
    if (!conversation.accepted || run.exitCode !== 0 || run.timedOut || run.outputExceeded) {
      throw new Error(
        `Run failed its fixed conversation check during ${trial.kind} ${trial.index + 1}; see retained profile records`,
      )
    }
    if (!runRecord.traceValid || runRecord.traceTruncated || runRecord.traceRecordCount === 0) {
      throw new Error('Run did not produce an installed startup trace')
    }

    if (trial.kind === 'measured') {
      const reviewPhases = (reviewRecord.phaseSpansMs ?? {}) as Partial<
        Record<TracePhase, number[]>
      >
      const runPhases = (runRecord.phaseSpansMs ?? {}) as Partial<Record<TracePhase, number[]>>
      measured.push({
        reviewMs: review.elapsedMs,
        runMs: run.elapsedMs,
        phaseSpansMs: Object.freeze(mergePhaseSpans(reviewPhases, runPhases)),
        phaseEvents: Object.freeze(
          mergePhaseEvents(
            reviewRecord.phaseEvents as Partial<Record<TracePhase, number>>,
            runRecord.phaseEvents as Partial<Record<TracePhase, number>>,
          ),
        ),
      })
    }
    console.log(
      `${trial.kind} ${trial.index + 1}: review ${review.elapsedMs.toFixed(1)} ms; Run ${run.elapsedMs.toFixed(1)} ms; accepted`,
    )
  }

  const summary = summarizeTrials(measured, metadata, archiveDigests, version.stdout.trim())
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await appendRecord(profileOutput.profile, { kind: 'summary', ...summary })
  await rm(workDirectory, { recursive: true })
  allSuccessful = true
  console.log(`Retained startup profile: ${basename(profilePath)} and ${basename(summaryPath)}`)
} catch (error) {
  await appendRecord(profileOutput.profile, {
    kind: 'failure',
    reason: 'startup profile did not complete; consult the bounded CI step output',
  }).catch(() => undefined)
  throw error
} finally {
  await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined)
  if (!allSuccessful)
    console.error('Startup profile failed; bounded profile records were retained.')
}

async function createProject(
  project: string,
  flowSdkArchive: string,
  trial: { readonly kind: 'warmup' | 'measured'; readonly index: number },
): Promise<void> {
  await mkdir(project)
  await cp(fixture, project, {
    recursive: true,
    filter(source) {
      const name = basename(source)
      return !['AGENTS.md', 'README.md', 'node_modules', '.jig', 'jig.lock'].includes(name)
    },
  })
  const sdkDirectory = join(project, 'sdk')
  await mkdir(sdkDirectory)
  const extraction = await command(
    'tar',
    ['-xzf', flowSdkArchive, '-C', sdkDirectory, '--strip-components=1'],
    project,
    environment.child,
  )
  await appendRecord(profileOutput.profile, commandEvidence('extract-flow-sdk', extraction))
  assertCommand(extraction, 'extract exact FLOW SDK archive into local workspace')

  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({
      name: 'jig-startup-profile-workspace',
      private: true,
      type: 'module',
      workspaces: ['sdk', 'flows/*'],
    }),
  )
  for (const name of ['investigate', 'analysis', 'dataset']) {
    await writeFile(
      join(project, 'flows', name, 'package.json'),
      JSON.stringify({
        name: `startup-profile-${name}`,
        private: true,
        type: 'module',
        dependencies: { '@jigging/flow': 'workspace:*' },
      }),
    )
  }
  const install = await command(
    process.execPath,
    ['install', '--offline', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'],
    project,
    environment.child,
  )
  await appendRecord(profileOutput.profile, {
    ...commandEvidence('prepare-project', install),
    cohort: trial.kind,
    trial: trial.index + 1,
  })
  assertCommand(install, 'prepare the deterministic fixture workspace without scripts')
}

async function profiledCommand(
  executable: string,
  args: readonly string[],
  cwd: string,
  trace: string,
  childEnvironment: NodeJS.ProcessEnv,
): Promise<CapturedCommand> {
  return command(executable, args, cwd, {
    ...childEnvironment,
    JIG_PRIVATE_PROFILE_FILE: trace,
  })
}

async function command(
  executable: string,
  args: readonly string[],
  cwd: string,
  childEnvironment: NodeJS.ProcessEnv,
): Promise<CapturedCommand> {
  const commandBudgetMs = Math.min(
    commandTimeoutMs,
    Math.max(0, profileDeadlineMs - performance.now()),
  )
  if (commandBudgetMs === 0) throw new Error('startup profile reached its total time budget')
  const started = performance.now()
  const stdoutHash = createHash('sha256')
  const stderrHash = createHash('sha256')
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let stdoutRetained = 0
  let stderrRetained = 0
  let outputExceeded = false
  let timedOut = false
  let interrupted = false
  let escalation: NodeJS.Timeout | undefined
  const child = spawn(executable, [...args], {
    cwd,
    env: childEnvironment,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stdoutStream = child.stdout
  const stderrStream = child.stderr
  if (stdoutStream === null || stderrStream === null) {
    child.kill('SIGKILL')
    throw new Error('profile subprocess streams were unavailable')
  }
  const interruptChild = () => {
    if (interrupted || child.pid === undefined) return
    interrupted = true
    try {
      process.kill(-child.pid, 'SIGINT')
    } catch {
      child.kill('SIGINT')
    }
    escalation = setTimeout(() => {
      if (child.pid === undefined) return
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, 2_000)
    escalation.unref()
  }
  const capture = (
    chunks: Buffer[],
    hash: ReturnType<typeof createHash>,
    stream: NodeJS.ReadableStream,
    count: (size: number) => void,
    retainedBytes: () => number,
    retainBytes: (size: number) => void,
  ) => {
    stream.on('data', (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      hash.update(chunk)
      count(chunk.length)
      if (!outputExceeded && stdoutBytes + stderrBytes > maxCommandOutputBytes) {
        outputExceeded = true
        interruptChild()
        child.stdout?.destroy()
        child.stderr?.destroy()
      }
      const retained = retainedBytes()
      if (retained < maxRetainedOutputBytes) {
        const keep = Math.min(chunk.length, maxRetainedOutputBytes - retained)
        chunks.push(chunk.subarray(0, keep))
        retainBytes(keep)
      }
    })
  }
  capture(
    stdout,
    stdoutHash,
    stdoutStream,
    (size) => (stdoutBytes += size),
    () => stdoutRetained,
    (size) => (stdoutRetained += size),
  )
  capture(
    stderr,
    stderrHash,
    stderrStream,
    (size) => (stderrBytes += size),
    () => stderrRetained,
    (size) => (stderrRetained += size),
  )

  const timer = setTimeout(() => {
    timedOut = true
    interruptChild()
  }, commandBudgetMs)
  timer.unref()

  let spawnError: Error | undefined
  const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (resolveResult) => {
      child.once('error', (error) => {
        spawnError = error
      })
      child.once('close', (exitCode, signal) => resolveResult({ exitCode, signal }))
    },
  ).finally(() => {
    clearTimeout(timer)
    if (escalation !== undefined) clearTimeout(escalation)
  })
  if (spawnError !== undefined) throw new Error('profile subprocess could not be started')
  const elapsedMs = Math.round((performance.now() - started) * 1000) / 1000
  return {
    ...result,
    timedOut,
    outputExceeded,
    elapsedMs,
    stdoutBytes,
    stderrBytes,
    stdoutDigest: stdoutHash.digest('hex'),
    stderrDigest: stderrHash.digest('hex'),
    stdoutTruncated: stdoutRetained < stdoutBytes,
    stderrTruncated: stderrRetained < stderrBytes,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  }
}

async function summarizeCommand(
  result: CapturedCommand,
  tracePath: string,
  trial: { readonly kind: 'warmup' | 'measured'; readonly index: number },
  commandName: 'review' | 'run',
  accepted?: boolean,
) {
  const trace = await readTrace(tracePath)
  return {
    kind: 'command',
    cohort: trial.kind,
    trial: trial.index + 1,
    command: commandName,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    outputExceeded: result.outputExceeded,
    elapsedMs: result.elapsedMs,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    stdoutDigest: result.stdoutDigest,
    stderrDigest: result.stderrDigest,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    diagnosticCodes: [...result.stderr.matchAll(/Diagnostic code: ([A-Z0-9_]+)/g)].map(
      (match) => match[1],
    ),
    ...(accepted === undefined ? {} : { accepted }),
    traceValid: trace.valid,
    traceTruncated: trace.truncated,
    traceRecordCount: trace.events.length,
    phaseSpansMs: measurePhases(trace.events),
    phaseEvents: measureInstantEvents(trace.events),
  }
}

function inspectConversationResult(result: CapturedCommand) {
  if (result.exitCode !== 0 || result.timedOut || result.outputExceeded || result.stdoutTruncated)
    return {
      accepted: false,
      reason: 'command-not-complete',
      status: 'unavailable',
      outcome: 'unavailable',
      verificationAccepted: null,
      analysisOutcome: 'unavailable',
      datasetOutcome: 'unavailable',
    } as const
  let terminal: Record<string, unknown>
  try {
    terminal = JSON.parse(result.stdout.trim()) as Record<string, unknown>
  } catch {
    return {
      accepted: false,
      reason: 'invalid-terminal-json',
      status: 'unavailable',
      outcome: 'unavailable',
      verificationAccepted: null,
      analysisOutcome: 'unavailable',
      datasetOutcome: 'unavailable',
    } as const
  }
  const output = terminal.output as Record<string, unknown> | undefined
  const verification = output?.verification as Record<string, unknown> | undefined
  const children = output?.children as Record<string, Record<string, unknown>> | undefined
  const status = closedLabel(terminal.status, ['succeeded', 'failed'])
  const outcome = closedLabel(terminal.outcome, ['done', 'blocked', 'cancelled', 'failed'])
  const verificationAccepted =
    verification?.accepted === true ? true : verification?.accepted === false ? false : null
  const analysisOutcome = closedLabel(children?.analysis?.outcome, [
    'done',
    'blocked',
    'cancelled',
    'failed',
  ])
  const datasetOutcome = closedLabel(children?.dataset?.outcome, [
    'done',
    'blocked',
    'cancelled',
    'failed',
  ])
  const accepted =
    status === 'succeeded' &&
    outcome === 'done' &&
    verificationAccepted === true &&
    analysisOutcome === 'done' &&
    datasetOutcome === 'done'
  return {
    accepted,
    reason: accepted ? 'fixed-acceptance-passed' : 'fixed-acceptance-not-passed',
    status,
    outcome,
    verificationAccepted,
    analysisOutcome,
    datasetOutcome,
  }
}

function closedLabel(value: unknown, allowed: readonly string[]): string {
  return typeof value === 'string' && allowed.includes(value) ? value : 'other'
}

interface TraceRead {
  readonly valid: boolean
  readonly truncated: boolean
  readonly events: readonly Record<string, unknown>[]
}

async function readTrace(path: string): Promise<TraceRead> {
  let contents: string
  try {
    const metadata = await stat(path)
    if (!metadata.isFile() || metadata.size > 128 * 1024)
      return { valid: false, truncated: false, events: [] }
    contents = await readFile(path, 'utf8')
  } catch {
    return { valid: false, truncated: false, events: [] }
  }
  if (Buffer.byteLength(contents) > 128 * 1024)
    return { valid: false, truncated: false, events: [] }
  try {
    const records = contents
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const valid = records[0]?.kind === 'header' && records[0]?.protocol === 'jig-startup-profile/1'
    return {
      valid,
      truncated: records.some((record) => record.kind === 'truncated'),
      events: records.filter(
        (record) => record.kind === 'start' || record.kind === 'end' || record.kind === 'instant',
      ),
    }
  } catch {
    return { valid: false, truncated: false, events: [] }
  }
}

function measurePhases(
  records: readonly Record<string, unknown>[],
): Partial<Record<TracePhase, number[]>> {
  const starts = new Map<number, { phase: TracePhase; timeMs: number }>()
  const result: Partial<Record<TracePhase, number[]>> = {}
  for (const record of records) {
    if (record.kind === 'start') {
      if (
        typeof record.spanId === 'number' &&
        isTracePhase(record.phase) &&
        typeof record.timeMs === 'number'
      ) {
        starts.set(record.spanId, { phase: record.phase, timeMs: record.timeMs })
      }
    } else if (
      record.kind === 'end' &&
      typeof record.spanId === 'number' &&
      typeof record.timeMs === 'number'
    ) {
      const start = starts.get(record.spanId)
      if (start === undefined || start.phase !== record.phase) continue
      const spans = result[start.phase] ?? []
      spans.push(Math.round((record.timeMs - start.timeMs) * 1000) / 1000)
      result[start.phase] = spans
    }
  }
  return result
}

function measureInstantEvents(
  records: readonly Record<string, unknown>[],
): Partial<Record<TracePhase, number>> {
  const result: Partial<Record<TracePhase, number>> = {}
  for (const record of records) {
    if (record.kind !== 'instant' || !isTracePhase(record.phase)) continue
    result[record.phase] = (result[record.phase] ?? 0) + 1
  }
  return result
}

function isTracePhase(value: unknown): value is TracePhase {
  return typeof value === 'string' && tracePhases.has(value as TracePhase)
}

const tracePhases = new Set<TracePhase>([
  'author-configuration-evaluation',
  'project-planning',
  'installed-host-opening',
  'project-session-opening',
  'dependency-preparation',
  'dependency-reuse',
  'root-submission-persistence',
  'linux-owner-state-initialization',
  'rootless-containment-startup',
  'flow-execution',
  'operation-owner-settlement',
  'root-fence',
  'root-settlement',
  'project-session-close',
])

function mergePhaseSpans(
  first: Partial<Record<TracePhase, readonly number[]>>,
  second: Partial<Record<TracePhase, readonly number[]>>,
): Partial<Record<TracePhase, number[]>> {
  const result: Partial<Record<TracePhase, number[]>> = {}
  for (const phase of tracePhases) {
    const values = [...(first[phase] ?? []), ...(second[phase] ?? [])]
    if (values.length) result[phase] = values
  }
  return result
}

function mergePhaseEvents(
  first: Partial<Record<TracePhase, number>>,
  second: Partial<Record<TracePhase, number>>,
): Partial<Record<TracePhase, number>> {
  const result: Partial<Record<TracePhase, number>> = {}
  for (const phase of tracePhases) {
    const count = (first[phase] ?? 0) + (second[phase] ?? 0)
    if (count > 0) result[phase] = count
  }
  return result
}

function summarizeTrials(
  trials: typeof measured,
  host: Awaited<ReturnType<typeof collectMetadata>>,
  artifacts: typeof archiveDigests,
  jigVersion: string,
) {
  const phaseValues = new Map<TracePhase, number[]>()
  const phaseEvents: Partial<Record<TracePhase, number>> = {}
  for (const trial of trials) {
    for (const [phase, spans] of Object.entries(trial.phaseSpansMs) as [TracePhase, number[]][]) {
      const values = phaseValues.get(phase) ?? []
      values.push(...spans)
      phaseValues.set(phase, values)
    }
    for (const [phase, count] of Object.entries(trial.phaseEvents) as [TracePhase, number][]) {
      phaseEvents[phase] = (phaseEvents[phase] ?? 0) + count
    }
  }
  return {
    protocol: 'jig-startup-profile/1',
    sourceRevision: process.env.GITHUB_SHA ?? 'unknown',
    jigVersion,
    artifacts,
    host,
    cacheCohort: 'one-warmup-then-fresh-projects-on-warm-host',
    measuredTrials: trials.length,
    totalWallMs: stats(trials.map((trial) => trial.reviewMs + trial.runMs)),
    reviewWallMs: stats(trials.map((trial) => trial.reviewMs)),
    runWallMs: stats(trials.map((trial) => trial.runMs)),
    phaseSpansMs: Object.fromEntries(
      [...phaseValues].map(([phase, values]) => [phase, stats(values)]),
    ),
    phaseEvents,
    phaseInterpretation:
      'Per-span measurements; nested or concurrent spans overlap and must not be summed.',
    trials,
  }
}

function stats(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const lower = sorted[middle - 1]
  const upper = sorted[middle]
  const medianMs =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? (upper ?? null)
        : lower === undefined || upper === undefined
          ? null
          : (lower + upper) / 2
  return {
    count: sorted.length,
    medianMs,
    minMs: sorted[0] ?? null,
    maxMs: sorted.at(-1) ?? null,
  }
}

async function collectMetadata() {
  const [bun, bubblewrap, machine] = await Promise.all([
    command(process.execPath, ['--version'], root, environment.child),
    command('/usr/bin/bwrap', ['--version'], root, environment.child),
    command('uname', ['-m'], root, environment.child),
  ])
  await Promise.all([
    appendRecord(profileOutput.profile, commandEvidence('host-bun-version', bun)),
    appendRecord(profileOutput.profile, commandEvidence('host-bubblewrap-version', bubblewrap)),
    appendRecord(profileOutput.profile, commandEvidence('host-architecture', machine)),
  ])
  assertCommand(bun, 'read Bun version')
  assertCommand(bubblewrap, 'read Bubblewrap version')
  assertCommand(machine, 'read host architecture')
  return {
    os: platform(),
    osRelease: release(),
    architecture: arch(),
    machine: machine.stdout.trim(),
    bun: bun.stdout.trim(),
    bubblewrap: bubblewrap.stdout.trim(),
    image: process.env.ImageOS ?? 'unknown',
    verification: 'cached (installed CLI default)',
  }
}

function commandEvidence(name: string, result: CapturedCommand) {
  return {
    kind: 'command',
    command: name,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    outputExceeded: result.outputExceeded,
    elapsedMs: result.elapsedMs,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    stdoutDigest: result.stdoutDigest,
    stderrDigest: result.stderrDigest,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    diagnosticCodes: [...result.stderr.matchAll(/Diagnostic code: ([A-Z0-9_]+)/g)].map(
      (match) => match[1],
    ),
  }
}

async function openProfileOutput(directory: string, profile: string) {
  await mkdir(directory, { recursive: false, mode: 0o700 })
  await writeFile(profile, '', { flag: 'wx', mode: 0o600 })
  return { profile }
}

async function appendRecord(path: string, record: unknown): Promise<void> {
  await appendFile(path, `${JSON.stringify(record)}\n`, { mode: 0o600 })
}

async function digestFile(path: string): Promise<string> {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}

function assertCommand(result: CapturedCommand, task: string): void {
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.outputExceeded) {
    throw new Error(
      `${task} failed (exit=${result.exitCode ?? 'null'}, signal=${result.signal ?? 'none'})`,
    )
  }
}

function requireProfileEnvironment() {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_OS !== 'Linux' ||
    process.env.ImageOS !== 'ubuntu24' ||
    platform() !== 'linux' ||
    arch() !== 'x64' ||
    process.env.JIG_CI_BUN === undefined ||
    process.execPath !== process.env.JIG_CI_BUN
  ) {
    throw new Error(
      'installed startup profiling requires the provisioned Ubuntu 24.04 x86-64 workflow host',
    )
  }
  const runnerTemp = requiredAbsolute('RUNNER_TEMP')
  const outputDirectory = requiredAbsolute('JIG_STARTUP_PROFILE_DIRECTORY')
  const jigArchive = requiredAbsolute('JIG_PACKAGE_ARCHIVE')
  const flowSdkArchive = requiredAbsolute('FLOW_SDK_PACKAGE_ARCHIVE')
  const child: NodeJS.ProcessEnv = {}
  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'XDG_RUNTIME_DIR',
    'DBUS_SESSION_BUS_ADDRESS',
    'BUN_INSTALL',
  ]) {
    const value = process.env[key]
    if (value !== undefined) child[key] = value
  }
  if (child.PATH === undefined) throw new Error('host PATH is unavailable')
  return { runnerTemp, outputDirectory, jigArchive, flowSdkArchive, child }
}

function requiredAbsolute(name: string): string {
  const value = process.env[name]
  if (value === undefined || !value.startsWith('/') || value.includes('\0')) {
    throw new Error(`required profile input ${name} is missing or invalid`)
  }
  return value
}
