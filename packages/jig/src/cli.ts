#!/usr/bin/env bun

import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { setTimeout as delay } from 'node:timers/promises'
import manifest from '../package.json' with { type: 'json' }

import { ProjectAdministrationError, type ProjectSession } from './administration/project.js'
import {
  RootAdministrationError,
  type RootAdministration,
  type RootRunStatus,
  type RootRunTerminal,
} from './administration/root.js'
import { BareInitError, initializeBareProject } from './bare-init.js'
import { canonicalJson, decodeJson1, type JsonValue } from './json.js'
import { bindingRef, flowRef, type RunTargetRef } from './project/author.js'
import {
  PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS,
  PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS,
  PRIVATE_ROOTLESS_COMMAND_OVERHEAD_ALLOWANCE_MS,
  privateRootlessCommandLifetime,
} from './internal/root-run-timeout-policy.js'

const HELP = `Usage:
  jig init --bare <directory>
  jig review [project] [--yes]
  jig run <flow:path|binding:id> [--input JSON] [--timeout DURATION]
  jig --version`

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** Private injection seam until the installed host owns project acquisition. */
export interface PrivateCliCommandHost {
  acquire(project: string, options?: { readonly runTimeoutMs?: number }): Promise<ProjectSession>
  pause?(milliseconds: number): Promise<void>
}

export interface PrivateCliOptions {
  readonly host?: PrivateCliCommandHost
  readonly currentDirectory?: string
  readonly signal?: AbortSignal
  readonly interactive?: boolean
  readonly confirm?: (prompt: string, signal?: AbortSignal) => Promise<boolean>
  readonly writeOutput?: (text: string) => void
  readonly writeError?: (text: string) => void
  readonly createSubmissionId?: () => string
}

interface CliRuntime {
  readonly host: PrivateCliCommandHost
  readonly currentDirectory: string
  readonly signal?: AbortSignal
  readonly interactive: boolean
  readonly confirm: (prompt: string, signal?: AbortSignal) => Promise<boolean>
  readonly writeOutput: (text: string) => void
  readonly writeError: (text: string) => void
  readonly createSubmissionId: () => string
}

class CliDiagnostic extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: 1 | 2,
  ) {
    super(message)
    this.name = 'CliDiagnostic'
  }
}

export async function main(
  arguments_: readonly string[] = process.argv.slice(2),
  options: PrivateCliOptions = {},
): Promise<number> {
  const runtime = cliRuntime(options)
  if (arguments_.length === 1 && arguments_[0] === '--version') {
    runtime.writeOutput(`${manifest.version}\n`)
    return 0
  }
  if (isHelpRequest(arguments_)) {
    runtime.writeOutput(`${HELP}\n`)
    return 0
  }

  try {
    if (arguments_[0] === 'init') return await executeInit(arguments_, runtime)
    if (arguments_[0] === 'review') return await executeReview(arguments_, runtime)
    if (arguments_[0] === 'run') return await executeRun(arguments_, runtime)
    runtime.writeError(`${HELP}\n`)
    return 2
  } catch (error) {
    if (runtime.signal?.aborted) {
      runtime.writeError(renderDiagnostic('JIG_COMMAND_INTERRUPTED', 'the command was interrupted'))
      return 2
    }
    return renderFailure(error, runtime)
  }
}

/** Whether the installed command needs to acquire the private execution host. */
export function privateCliRequiresHost(arguments_: readonly string[]): boolean {
  return !isHelpRequest(arguments_) && (arguments_[0] === 'review' || arguments_[0] === 'run')
}

function isHelpRequest(arguments_: readonly string[]): boolean {
  const help = arguments_.at(-1) === '--help' || arguments_.at(-1) === '-h'
  return (
    help &&
    (arguments_.length === 1 ||
      (arguments_.length === 2 &&
        (arguments_[0] === 'init' || arguments_[0] === 'review' || arguments_[0] === 'run')))
  )
}

async function executeInit(arguments_: readonly string[], runtime: CliRuntime): Promise<number> {
  if (arguments_.length !== 3 || arguments_[1] !== '--bare') {
    runtime.writeError(`${HELP}\n`)
    return 2
  }
  try {
    await initializeBareProject(arguments_[2]!)
    runtime.writeOutput('created bare Jig project\n')
    return 0
  } catch (error) {
    if (error instanceof BareInitError) {
      runtime.writeError(renderDiagnostic(error.code, error.message))
      return error.kind === 'invalid' ? 1 : 2
    }
    throw error
  }
}

async function executeReview(arguments_: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseReview(arguments_, runtime.currentDirectory)
  return await withProjectSession(parsed.project, runtime, async (session) => {
    const plan = await session.plan({ lockMode: 'update' })
    if (plan.state === 'unchanged') {
      runtime.writeOutput('project is ready\n')
      return 0
    }

    runtime.writeOutput(
      plan.review.text.endsWith('\n') ? plan.review.text : `${plan.review.text}\n`,
    )
    if (!parsed.yes) {
      if (!runtime.interactive) {
        throw new CliDiagnostic(
          'JIG_APPROVAL_REQUIRED',
          'project changes require confirmation; rerun with --yes',
          2,
        )
      }
      const accepted = await runtime.confirm(
        'Admit this exact project revision? [y/N] ',
        runtime.signal,
      )
      if (!accepted) {
        runtime.writeError(
          renderDiagnostic('JIG_CHANGES_DECLINED', 'project changes were not admitted'),
        )
        return 1
      }
    }

    runtime.signal?.throwIfAborted()
    await session.apply({ planDigest: plan.planDigest })
    runtime.writeOutput('project is ready\n')
    return 0
  })
}

async function executeRun(arguments_: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseRun(arguments_)
  const status = await withProjectSession(
    runtime.currentDirectory,
    runtime,
    async (session) => {
      const receipt = await session.rootAdministration.startRun({
        submissionId: runtime.createSubmissionId(),
        target: parsed.target,
        input: parsed.input,
      })
      return await waitForTerminal(
        session.rootAdministration,
        receipt.runId,
        runtime.host.pause ?? defaultPause,
        runtime.signal,
      )
    },
    { runTimeoutMs: parsed.timeoutMs },
  )
  runtime.writeOutput(`${textDecoder.decode(canonicalJson(publicTerminal(status.terminal)))}\n`)
  return status.terminal.status === 'succeeded' ? 0 : status.terminal.status === 'failed' ? 1 : 2
}

function parseReview(
  arguments_: readonly string[],
  currentDirectory: string,
): { readonly project: string; readonly yes: boolean } {
  if (arguments_.length === 1) return { project: currentDirectory, yes: false }
  if (arguments_.length === 2 && arguments_[1] === '--yes') {
    return { project: currentDirectory, yes: true }
  }
  if (arguments_.length === 2 && !arguments_[1]!.startsWith('-')) {
    return { project: arguments_[1]!, yes: false }
  }
  if (arguments_.length === 3 && !arguments_[1]!.startsWith('-') && arguments_[2] === '--yes') {
    return { project: arguments_[1]!, yes: true }
  }
  throw new CliDiagnostic('JIG_USAGE', HELP, 2)
}

function parseRun(arguments_: readonly string[]): {
  readonly target: RunTargetRef
  readonly input: JsonValue
  readonly timeoutMs: number
} {
  if (arguments_.length < 2) throw new CliDiagnostic('JIG_USAGE', HELP, 2)
  const target = parseTarget(arguments_[1]!)
  let input: JsonValue = {}
  let timeoutMs = PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS
  let sawInput = false
  let sawTimeout = false
  for (let index = 2; index < arguments_.length; index += 2) {
    const option = arguments_[index]
    const value = arguments_[index + 1]
    if (value === undefined) throw new CliDiagnostic('JIG_USAGE', HELP, 2)
    if (option === '--input' && !sawInput) {
      sawInput = true
      try {
        input = decodeJson1(textEncoder.encode(value))
      } catch {
        throw new CliDiagnostic('JIG_RUN_INPUT_INVALID', '--input must be FLOW JSON/1', 1)
      }
      continue
    }
    if (option === '--timeout' && !sawTimeout) {
      sawTimeout = true
      timeoutMs = parseRunTimeout(value)
      continue
    }
    throw new CliDiagnostic('JIG_USAGE', HELP, 2)
  }
  return { target, input, timeoutMs }
}

function parseRunTimeout(value: string): number {
  const match = /^([1-9][0-9]*)(ms|s|m|h)$/.exec(value)
  if (match === null) return invalidRunTimeout()
  const quantity = Number(match[1])
  const factor =
    match[2] === 'ms' ? 1 : match[2] === 's' ? 1_000 : match[2] === 'm' ? 60_000 : 3_600_000
  const milliseconds = quantity * factor
  if (!Number.isSafeInteger(milliseconds) || milliseconds > PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS) {
    return invalidRunTimeout()
  }
  return milliseconds
}

function invalidRunTimeout(): never {
  throw new CliDiagnostic(
    'JIG_RUN_TIMEOUT_INVALID',
    '--timeout must be a positive integer followed by ms, s, m, or h, up to 24h',
    1,
  )
}

/** Private installed-launcher seam; it deliberately exposes no package API. */
export function privateCliCommandLifetimeMs(arguments_: readonly string[]): number {
  if (arguments_[0] !== 'run') return PRIVATE_ROOTLESS_COMMAND_OVERHEAD_ALLOWANCE_MS
  try {
    return privateRootlessCommandLifetime(parseRun(arguments_).timeoutMs)
  } catch {
    // `main` renders invalid invocations inside this short bounded envelope.
    return PRIVATE_ROOTLESS_COMMAND_OVERHEAD_ALLOWANCE_MS
  }
}

function parseTarget(value: string): RunTargetRef {
  try {
    if (value.startsWith('flow:')) return flowRef(value.slice('flow:'.length))
    if (value.startsWith('binding:')) return bindingRef(value.slice('binding:'.length))
  } catch {
    // The public diagnostic intentionally does not repeat project-controlled input.
  }
  throw new CliDiagnostic(
    'JIG_RUN_TARGET_INVALID',
    'the target must be flow:<path> or binding:<id>',
    1,
  )
}

async function withProjectSession<T>(
  project: string,
  runtime: CliRuntime,
  operation: (session: ProjectSession) => Promise<T>,
  acquisition?: { readonly runTimeoutMs?: number },
): Promise<T> {
  runtime.signal?.throwIfAborted()
  const session = await runtime.host.acquire(project, acquisition)
  let closePromise: Promise<void> | undefined
  const close = () => (closePromise ??= session.close())
  const onAbort = () => {
    void close().catch(() => undefined)
  }
  runtime.signal?.addEventListener('abort', onAbort, { once: true })

  let completed = false
  let result: T | undefined
  let failure: unknown
  try {
    runtime.signal?.throwIfAborted()
    result = await operation(session)
    completed = true
  } catch (error) {
    failure = error
  }

  let closeFailed = false
  let closeFailure: unknown
  try {
    await close()
  } catch (error) {
    closeFailed = true
    closeFailure = error
  } finally {
    runtime.signal?.removeEventListener('abort', onAbort)
  }

  if (!completed && closeFailed) {
    throw new AggregateError([failure, closeFailure], 'project command and close both failed')
  }
  if (!completed) throw failure
  if (closeFailed) throw closeFailure
  return result as T
}

async function waitForTerminal(
  administration: RootAdministration,
  runId: string,
  pause: (milliseconds: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<Extract<RootRunStatus, { readonly state: 'terminal' }>> {
  while (true) {
    signal?.throwIfAborted()
    const status = await administration.runStatus({ runId })
    if (status.state === 'terminal') return status
    await pause(10)
  }
}

function publicTerminal(terminal: RootRunTerminal): JsonValue {
  if (terminal.status === 'succeeded') {
    return {
      status: terminal.status,
      outcome: terminal.outcome,
      output: terminal.output,
      diagnostics: terminal.diagnostics,
    } as unknown as JsonValue
  }
  if (terminal.status === 'failed') {
    return {
      status: terminal.status,
      code: terminal.code,
      message: terminal.message,
      ...(terminal.details === undefined ? {} : { details: terminal.details }),
      diagnostics: terminal.diagnostics,
    } as unknown as JsonValue
  }
  return {
    status: terminal.status,
    code: terminal.code,
    message: terminal.message,
  }
}

function cliRuntime(options: PrivateCliOptions): CliRuntime {
  return {
    host: options.host ?? unavailableHost,
    currentDirectory: options.currentDirectory ?? process.cwd(),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    interactive:
      options.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true),
    confirm: options.confirm ?? terminalConfirmation,
    writeOutput:
      options.writeOutput ??
      ((text) => {
        process.stdout.write(text)
      }),
    writeError:
      options.writeError ??
      ((text) => {
        process.stderr.write(text)
      }),
    createSubmissionId:
      options.createSubmissionId ?? (() => `jig-cli-${randomBytes(16).toString('hex')}`),
  }
}

const unavailableHost: PrivateCliCommandHost = {
  async acquire() {
    throw new ProjectAdministrationError('UNAVAILABLE', 'the installed Jig host is unavailable')
  },
}

async function terminalConfirmation(prompt: string, signal?: AbortSignal): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer =
      signal === undefined
        ? await terminal.question(prompt)
        : await terminal.question(prompt, { signal })
    return /^(?:y|yes)$/i.test(answer.trim())
  } finally {
    terminal.close()
  }
}

async function defaultPause(milliseconds: number): Promise<void> {
  await delay(milliseconds)
}

function renderFailure(error: unknown, runtime: CliRuntime): 1 | 2 {
  if (error instanceof CliDiagnostic) {
    runtime.writeError(
      error.code === 'JIG_USAGE'
        ? `${error.message}\n`
        : renderDiagnostic(error.code, error.message),
    )
    return error.exitCode
  }
  if (error instanceof ProjectAdministrationError) {
    const projected = projectError(error.code)
    const hint =
      error.diagnostic?.code === 'PROJECT_AGENT_UNAVAILABLE'
        ? 'configure the host Agent before review; check credentials, model, and selected client'
        : error.diagnostic?.code === 'PACKAGE_BUN_PREPARATION_FAILED'
          ? 'locked dependencies could not be prepared; check registry access and package availability'
          : undefined
    runtime.writeError(
      error.diagnostic !== undefined
        ? renderProjectDiagnostic(error, hint ?? projected.message)
        : renderDiagnostic(error.code, projected.message),
    )
    return projected.exitCode
  }
  if (error instanceof RootAdministrationError) {
    const projected = rootError(error.code)
    runtime.writeError(renderDiagnostic(error.code, projected.message))
    return projected.exitCode
  }
  runtime.writeError(
    renderDiagnostic('JIG_COMMAND_UNAVAILABLE', 'the command could not be completed'),
  )
  return 2
}

function projectError(code: ProjectAdministrationError['code']): {
  readonly message: string
  readonly exitCode: 1 | 2
} {
  const invalid =
    code === 'INVALID_REQUEST' ||
    code === 'PROJECT_NOT_FOUND' ||
    code === 'PROJECT_UNSAFE' ||
    code === 'INVALID_CANDIDATE' ||
    code === 'LOCK_MISMATCH' ||
    code === 'PLAN_NOT_FOUND' ||
    code === 'STALE_PLAN'
  const messages: Record<ProjectAdministrationError['code'], string> = {
    INVALID_REQUEST: 'the project request is invalid',
    PROJECT_NOT_FOUND: 'the project was not found',
    PROJECT_UNSAFE: 'the project cannot be opened safely',
    INVALID_CANDIDATE: 'the project definition is invalid',
    LOCK_MISMATCH: 'the project lock does not match the reviewed state',
    PLAN_NOT_FOUND: 'the reviewed project changes are no longer available',
    STALE_PLAN: 'the project changed before its review could be applied',
    PROJECT_BUSY: 'the project is already in use',
    PROJECT_CLOSED: 'the project session is closed',
    UNAVAILABLE: 'the project command is unavailable',
    INTERNAL: 'the project command failed',
  }
  return { message: messages[code], exitCode: invalid ? 1 : 2 }
}

function rootError(code: RootAdministrationError['code']): {
  readonly message: string
  readonly exitCode: 1 | 2
} {
  const invalid =
    code === 'INVALID_REQUEST' || code === 'SUBMISSION_CONFLICT' || code === 'RUN_NOT_FOUND'
  const messages: Record<RootAdministrationError['code'], string> = {
    INVALID_REQUEST: 'the Run request is invalid',
    SUBMISSION_CONFLICT: 'the Run could not be submitted',
    RUN_NOT_FOUND: 'the Run was not found',
    PROJECT_BUSY: 'the project is already in use',
    PROJECT_CLOSED: 'the project session is closed',
    UNAVAILABLE: 'the Run command is unavailable',
    INTERNAL: 'the Run command failed',
  }
  return { message: messages[code], exitCode: invalid ? 1 : 2 }
}

function renderDiagnostic(code: string, message: string): string {
  return `${code}: ${message}\n`
}

function renderProjectDiagnostic(error: ProjectAdministrationError, message: string): string {
  const diagnostic = error.diagnostic
  if (diagnostic === undefined) return renderDiagnostic(error.code, message)
  const pointer =
    diagnostic.pointer === undefined ? '' : ` pointer ${asciiJsonString(diagnostic.pointer)}`
  return (
    `${error.code}: ${message}; ${diagnostic.code} at ` +
    `${asciiJsonString(diagnostic.path)}${pointer}\n`
  )
}

function asciiJsonString(value: string): string {
  let output = '"'
  for (const scalar of value) {
    const code = scalar.codePointAt(0)!
    if (scalar === '"' || scalar === '\\') output += `\\${scalar}`
    else if (code >= 0x20 && code <= 0x7e) output += scalar
    else if (code <= 0xffff) output += `\\u${code.toString(16).padStart(4, '0')}`
    else {
      const adjusted = code - 0x10000
      output += `\\u${(0xd800 + (adjusted >> 10)).toString(16)}\\u${(0xdc00 + (adjusted & 0x3ff)).toString(16)}`
    }
  }
  return `${output}"`
}

if (import.meta.main) {
  const controller = new AbortController()
  const interrupt = () => {
    controller.abort()
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    process.exitCode = await main(process.argv.slice(2), { signal: controller.signal })
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
  }
}
