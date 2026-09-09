#!/usr/bin/env bun

import { randomBytes } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { setTimeout as delay } from 'node:timers/promises'
import manifest from '../package.json' with { type: 'json' }

import { ProjectAdministrationError, type ProjectSession } from './administration/project.js'
import {
  type RootAdministration,
  RootAdministrationError,
  type RootRunStatus,
  type RootRunTerminal,
} from './administration/root.js'
import { PrivateCliProgress } from './cli-progress.js'
import type { PrivateDeliveryConnection, PrivateDeliveryReceipt } from './internal/file-delivery.js'
import {
  PrivateFileInputError,
  privateAttachmentName,
  privateCaptureAttachments,
  privateFilePath,
  privateReadOperatorFile,
  sha256,
} from './internal/linux-file-input.js'
import { PrivateRootRunFiles } from './internal/root-run-files.js'
import {
  PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS,
  PRIVATE_MAX_ROOT_RUN_TIMEOUT_MS,
  PRIVATE_ROOTLESS_COMMAND_OVERHEAD_ALLOWANCE_MS,
  privateRootlessCommandLifetime,
} from './internal/root-run-timeout-policy.js'
import type { PrivateRunChannelOutput } from './internal/run-channels.js'
import { canonicalJson, decodeJson1, JSON_1_LIMITS, Json1Error, type JsonValue } from './json.js'
import { bindingRef, flowRef, type RunTargetRef } from './project/author.js'
import { createProject, ProjectInitError } from './project-init.js'

const HELP = `Jig runs reusable methods with powers you approve.

Usage:
  jig init <directory>       Create a project with a small greeting Flow
  jig review [project]       Review changes and approve an exact revision
  jig run <target>           Run a reviewed Flow or Binding
  jig --version             Print the installed version

Start here:
  jig init hello-jig
  cd hello-jig
  jig review --allow-resolution-network
  jig run flow:flows/hello --input '{"name":"Ada"}'

Use jig <command> --help for options and examples.
Guide: https://jig.md/guide/`

const COMMAND_HELP = {
  init: `Usage: jig init [--bare] <directory>

Create a new editable project and greeting Flow. No installation, network
requests, approval, or execution happens during initialization.

  --bare     Create only jig.ts and empty flows/ and bindings/ directories

Example: jig init hello-jig
The destination must not exist; existing files are never replaced.`,
  review: `Usage: jig review [project] [--allow-resolution-network] [--yes] [--details]

Capture source, prepare dependencies, show changes, then ask for approval.
The project defaults to the current directory. This command has side effects:
it retains private snapshots and, after approval, updates jig.lock.

  --allow-resolution-network  Permit fresh resolution for missing dependency locks
  --yes                      Approve the displayed revision without a prompt
  --details                  Show complete policy when proposing a change

Examples:
  jig review
  jig review --allow-resolution-network
  jig review ./my-project --yes

Resolution can contact dependency-selected public or private-network services
before graph validation. Requests cannot be undone by declining approval.
--yes does not grant resolution networking. Runs gain no network access.
Supplied locks stay frozen; stale locks must be updated explicitly.`,
  run: `Usage: jig run <flow:path|binding:id> [options]

Run an exact reviewed target in the current project. No dependencies are
installed and source changes are not approved automatically.

  --input JSON|@FILE  Supply JSON inline or from a file (default: {})
  --attach NAME=DIR   Capture a declared read attachment; repeat for each name
  --select NAME=FILE  Select a relative file within an attachment; repeat as needed
  --out DIR          Save a result packet to a new directory outside input roots
  --receive CHANNEL  Stream a declared output channel; repeat for distinct names
  --timeout DURATION Set the execution deadline (default: 30s; maximum: 24h)
                     Units: ms, s, m, h. Cleanup still runs after the deadline.

Examples:
  jig run flow:flows/hello --input '{"name":"Ada"}'
  jig run binding:repair --input @issue.json --attach source=./src --out ./review
  jig run binding:worker --receive progress --timeout 2m

Ctrl-C cancels owned work and waits for cleanup. Repeating a run starts new work.
Stdout is JSON, or NDJSON with --receive. Diagnostics and terminal status use
stderr; scripts should check the result and exit status.`,
} as const

function usage(command: keyof typeof COMMAND_HELP, message: string): never {
  throw new CliDiagnostic('JIG_USAGE', `${message}\n\n${COMMAND_HELP[command]}`, 2)
}

const RESOLUTION_WARNING =
  'Bun may contact dependency-selected public or private-network services before graph validation; requests cannot be undone, and unsupported dependencies may still fail. Applies only to this review; Runs gain no network access.'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** Private injection seam until the installed host owns project acquisition. */
export interface PrivateCliCommandHost {
  acquire(
    project: string,
    options?: {
      readonly runTimeoutMs?: number
      readonly files?: PrivateRootRunFiles
      readonly channelOutput?: PrivateRunChannelOutput
      readonly allowResolutionNetwork?: boolean
      readonly onResolution?: (packagePath: string) => void
    },
  ): Promise<ProjectSession>
  readonly delivery?: PrivateDeliveryConnection
  readonly agentUnavailableHint?: string
  pause?(milliseconds: number): Promise<void>
}

export interface PrivateCliOptions {
  readonly host?: PrivateCliCommandHost
  readonly currentDirectory?: string
  readonly signal?: AbortSignal
  readonly interactive?: boolean
  readonly terminalOutput?: boolean
  readonly confirm?: (prompt: string, signal?: AbortSignal) => Promise<boolean>
  readonly writeOutput?: (text: string) => void
  readonly writeRecord?: (text: string) => Promise<void>
  readonly writeError?: (text: string) => void
  readonly createSubmissionId?: () => string
}

interface CliRuntime {
  readonly progress: PrivateCliProgress
  readonly host: PrivateCliCommandHost
  readonly currentDirectory: string
  readonly signal?: AbortSignal
  readonly interactive: boolean
  readonly confirm: (prompt: string, signal?: AbortSignal) => Promise<boolean>
  readonly writeOutput: (text: string) => void
  readonly writeRecord: (text: string) => Promise<void>
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
    runtime.writeOutput(
      `${arguments_.length === 1 ? HELP : COMMAND_HELP[arguments_[0] as keyof typeof COMMAND_HELP]}\n`,
    )
    return 0
  }
  if (arguments_.length === 0) {
    runtime.writeOutput(`${HELP}\n`)
    return 0
  }

  try {
    if (arguments_[0] === 'init') return await executeInit(arguments_, runtime)
    if (arguments_[0] === 'review') return await executeReview(arguments_, runtime)
    if (arguments_[0] === 'run') return await executeRun(arguments_, runtime)
    runtime.writeError(`Unknown command. Use jig --help to see available commands.\n\n${HELP}\n`)
    return 2
  } catch (error) {
    if (runtime.signal?.aborted) {
      runtime.writeError(renderDiagnostic('JIG_COMMAND_INTERRUPTED', 'the command was interrupted'))
      return 2
    }
    return renderFailure(error, runtime)
  } finally {
    runtime.progress.close()
  }
}

/** Whether the installed command needs to acquire the private execution host. */
export function privateCliRequiresHost(arguments_: readonly string[]): boolean {
  if (isHelpRequest(arguments_)) return false
  try {
    if (arguments_[0] === 'review') {
      parseReview(arguments_, '.')
      return true
    }
    if (arguments_[0] === 'run') {
      parseRun(arguments_)
      return true
    }
  } catch {
    // Invalid syntax must be explained even on an unsupported host.
  }
  return false
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
  const bare = arguments_[1] === '--bare'
  const destination = arguments_[bare ? 2 : 1]
  if (
    arguments_.length !== (bare ? 3 : 2) ||
    destination === undefined ||
    destination.startsWith('-')
  )
    usage('init', 'Specify a new project directory.')
  try {
    await createProject(resolve(runtime.currentDirectory, destination), undefined, bare)
    runtime.writeOutput(
      bare
        ? 'created bare Jig project\n'
        : `Created Jig project ${asciiJsonString(destination)}.\n\nNext:\n${/^[\x20-\x7e]+$/.test(destination) ? `  cd ${shellWord(destination)}\n` : '  Open the created directory in your terminal, then:\n'}  jig review --allow-resolution-network\n  jig run flow:flows/hello --input '{"name":"Ada"}'\n\nNo dependencies installed or execution approved. See jig review --help.\n`,
    )
    return 0
  } catch (error) {
    if (error instanceof ProjectInitError) {
      runtime.writeError(renderDiagnostic(error.code, error.message))
      return error.kind === 'invalid' ? 1 : 2
    }
    throw error
  }
}

function shellWord(value: string): string {
  // Do not turn an untrusted path into pasteable shell operators or new lines.
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function executeReview(arguments_: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseReview(arguments_, runtime.currentDirectory)
  return await withProjectSession(
    parsed.project,
    runtime,
    async (session) => {
      runtime.progress.stage('Capturing source and preparing dependencies for review')
      const plan = await session.plan({ lockMode: 'update' })
      if (plan.state === 'unchanged') {
        runtime.writeOutput('project is ready\n')
        return 0
      }

      runtime.writeOutput(
        `${(parsed.details ? plan.review.details : plan.review.text).trimEnd()}\n`,
      )
      if (!parsed.yes) {
        if (!runtime.interactive) {
          throw new CliDiagnostic(
            'JIG_APPROVAL_REQUIRED',
            'project changes require confirmation; rerun with --yes',
            2,
          )
        }
        runtime.progress.stage('Waiting for your approval; no Flow has been started')
        const accepted = await runtime.confirm(
          'Approve this exact revision for execution? [y/N] ',
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
      runtime.progress.stage('Recording approval for the reviewed revision')
      await session.apply({ planDigest: plan.planDigest })
      runtime.writeOutput('project is ready\n')
      return 0
    },
    parsed.allowResolutionNetwork
      ? {
          allowResolutionNetwork: true,
          onResolution: (path) =>
            runtime.writeError(
              `Resolving dependencies for ${asciiJsonString(path)}. ${RESOLUTION_WARNING}\n`,
            ),
        }
      : undefined,
  )
}

async function executeRun(arguments_: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseRun(arguments_)
  runtime.progress.stage('Reading selected inputs')
  const outputStop = new AbortController()
  runtime = {
    ...runtime,
    signal: AbortSignal.any([
      outputStop.signal,
      ...(runtime.signal === undefined ? [] : [runtime.signal]),
    ]),
  }
  const diagnostics = new TextDecoder('utf-8')
  const writeLive = (text: string, diagnostic = false): void => {
    try {
      if (diagnostic) runtime.writeError(text)
      else runtime.writeOutput(text)
    } catch (error) {
      outputStop.abort()
      throw error
    }
  }
  const channelOutput: PrivateRunChannelOutput = {
    receive: parsed.receive,
    async record(value) {
      try {
        await runtime.writeRecord(`${textDecoder.decode(canonicalJson(value))}\n`)
      } catch (error) {
        outputStop.abort()
        throw error
      }
    },
    diagnostic(bytes) {
      // Diagnostics are untrusted text, not terminal-control instructions.
      writeLive(
        diagnostics
          .decode(bytes, { stream: true })
          .replace(
            /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g,
            (value) => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`,
          ),
        true,
      )
    },
  }
  const emitTerminal = async (record: JsonValue): Promise<void> => {
    await runtime.writeRecord(
      `${textDecoder.decode(canonicalJson(parsed.receive.length === 0 ? record : { type: 'terminal', result: record }))}\n`,
    )
  }
  let input = parsed.input
  try {
    if (parsed.inputFile !== undefined) {
      const path = resolve(runtime.currentDirectory, parsed.inputFile)
      input = decodeJson1(privateReadOperatorFile(path, JSON_1_LIMITS.bytes))
    }
  } catch (error) {
    const message =
      error instanceof PrivateFileInputError
        ? error.message
        : error instanceof Json1Error
          ? `the selected --input file is not FLOW JSON/1: ${error.message}`
          : (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'the selected --input file does not exist'
            : (error as NodeJS.ErrnoException).code === 'EACCES'
              ? 'the selected --input file is not readable by the current operator'
              : '--input file capture failed; check that it is a stable, readable regular file'
    throw new CliDiagnostic(
      'JIG_RUN_INPUT_INVALID',
      `${message}\nFile: ${asciiJsonString(parsed.inputFile!.slice(0, 512))}\nCheck --input and the file contents. No Flow was started.`,
      1,
    )
  }
  let capture: ReturnType<typeof privateCaptureAttachments>
  try {
    capture = privateCaptureAttachments(
      parsed.attachments.map((item) => ({
        ...item,
        directory: resolve(runtime.currentDirectory, item.directory),
      })),
    )
  } catch (error) {
    throw new CliDiagnostic(
      'JIG_RUN_FILES_INVALID',
      error instanceof PrivateFileInputError
        ? error.message
        : 'selected input must be a bounded regular-file tree without links or protected host state; check --attach and --select',
      1,
    )
  }
  const files = new PrivateRootRunFiles(
    capture.attachments,
    parsed.output === undefined ? null : resolve(runtime.currentDirectory, parsed.output),
    runtime.host.delivery,
  )
  try {
    if (parsed.output !== undefined) {
      // An explanatory check only: the delivery owner still revalidates and
      // publishes without replacement. This grants no filesystem authority.
      const occupied = await lstat(files.identity.output!).then(
        () => true,
        (error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
          throw new CliDiagnostic(
            'JIG_OUTPUT_INVALID',
            'cannot inspect --out; check its path and directory permissions. No Flow was started.',
            1,
          )
        },
      )
      if (occupied)
        throw new CliDiagnostic(
          'JIG_OUTPUT_EXISTS',
          `output destination ${asciiJsonString(parsed.output.slice(0, 512))} already exists.\nChoose a new --out directory. Existing files are never replaced. No Flow was started.`,
          1,
        )
      if (runtime.host.delivery === undefined)
        throw new CliDiagnostic(
          'JIG_DELIVERY_UNAVAILABLE',
          'the installed file-delivery owner is unavailable',
          2,
        )
      try {
        await runtime.host.delivery.prepare(
          files.identity.output!,
          capture.attachments.map((item) => item.rootFd),
        )
      } catch {
        throw new CliDiagnostic(
          'JIG_OUTPUT_INVALID',
          '--out requires a new destination outside input roots and protected state, beneath an existing supported directory',
          1,
        )
      }
    }
    let cleanupFailed = false
    const status = await withProjectSession(
      runtime.currentDirectory,
      runtime,
      async (session) => {
        runtime.progress.stage('Submitting the reviewed target')
        const receipt = await session.rootAdministration.startRun({
          submissionId: runtime.createSubmissionId(),
          target: parsed.target,
          input,
        })
        runtime.progress.stage('Waiting for the Run result (Ctrl-C to cancel)')
        return await waitForTerminal(
          session.rootAdministration,
          receipt.runId,
          runtime.host.pause ?? defaultPause,
          runtime.signal,
        )
      },
      {
        runTimeoutMs: parsed.timeoutMs,
        channelOutput,
        ...(parsed.attachments.length === 0 && parsed.output === undefined ? {} : { files }),
      },
      () => {
        cleanupFailed = true
      },
    )
    let record = publicTerminal(status.terminal)
    if (cleanupFailed)
      record = {
        ...(record as Record<string, JsonValue>),
        cleanup: { status: 'failed', code: 'PROJECT_CLOSE_FAILED' },
      }
    let delivery: PrivateDeliveryReceipt | undefined
    if (parsed.output !== undefined) {
      record = {
        ...(record as Record<string, JsonValue>),
        runId: status.runId,
        method: files.method ?? null,
        input: { digest: sha256(canonicalJson(input)), attachments: files.identity.attachments },
      } as unknown as JsonValue
      try {
        runtime.progress.stage('Publishing the result packet')
        delivery = await runtime.host.delivery!.publish(
          record,
          !cleanupFailed && status.terminal.status === 'succeeded'
            ? files.outputDirectory?.fd
            : undefined,
          runtime.signal,
        )
      } catch {
        delivery = { status: 'unknown', destination: files.identity.output!, code: 'CHANNEL_LOST' }
      }
      record = {
        ...(record as Record<string, JsonValue>),
        delivery,
        ...(runtime.host.delivery!.checkpoint === undefined
          ? {}
          : { checkpoint: runtime.host.delivery!.checkpoint }),
      } as unknown as JsonValue
    }
    let encodedRecord: Uint8Array
    try {
      encodedRecord = canonicalJson(record)
    } catch {
      // File manifests or late observations may exceed JSON/1 even when the
      // accepted terminal fits. Preserve that terminal; never truncate it or
      // reinterpret a report failure as permission to repeat the Run.
      await emitTerminal(publicTerminal(status.terminal))
      runtime.writeError(
        renderDiagnostic(
          'JIG_REPORT_LIMIT',
          `the expanded report exceeds JSON/1 limits; execution terminal preserved; delivery ${delivery?.status ?? 'not requested'}${cleanupFailed ? '; cleanup failed' : ''}; inspect any --out destination before starting new work`,
        ),
      )
      return 2
    }
    await emitTerminal(decodeJson1(encodedRecord))
    const terminal = status.terminal
    if (
      terminal.status === 'failed' &&
      terminal.details !== undefined &&
      terminal.details !== null &&
      typeof terminal.details === 'object' &&
      !Array.isArray(terminal.details)
    ) {
      const details = terminal.details as Readonly<Record<string, JsonValue>>
      if (details.code === 'RUN_TARGET_NOT_FOUND') {
        runtime.writeError(
          'JIG_RUN_TARGET_NOT_FOUND: that target is not in the reviewed revision. No Flow was started.\n',
        )
        const targets = details.availableTargets
        if (Array.isArray(targets)) {
          runtime.writeError('Reviewed targets:\n')
          for (const target of targets.slice(0, 16))
            if (typeof target === 'string')
              runtime.writeError(`  ${asciiJsonString(target.slice(0, 512))}\n`)
          if (targets.length === 0) runtime.writeError('  None. Add a Flow under flows/ first.\n')
        }
        runtime.writeError(
          'Choose an exact target above, or run jig review after changing jig.ts. No target is selected automatically.\n',
        )
      } else if (terminal.code === 'INVALID_INPUT') {
        runtime.writeError('JIG_RUN_INPUT_INVALID: input does not match the target input schema.\n')
        if (typeof details.instancePointer === 'string')
          runtime.writeError(`Value: ${asciiJsonString(details.instancePointer.slice(0, 512))}\n`)
        runtime.writeError(
          'Check --input against the Flow input.schema.json; see the JSON result for validation details.\n',
        )
      }
    }
    runtime.progress.note(
      terminal.status === 'succeeded'
        ? `Execution completed. Application outcome: ${asciiJsonString(terminal.outcome)}. See output in the JSON result.`
        : `Execution ${terminal.status}. Code: ${asciiJsonString(terminal.code)}. ${terminal.status === 'lost' ? 'Effects may be uncertain; do not blindly repeat the Run.' : 'Inspect the result and diagnostics before starting new work.'}`,
    )
    if (delivery !== undefined)
      runtime.progress.note(
        `Delivery: ${delivery.status}. Destination: ${asciiJsonString(parsed.output!)}.${delivery.status === 'written' ? ' Inspect result.json and files/.' : ' Check the destination before starting new work.'}`,
      )
    if (runtime.host.delivery?.checkpoint != null)
      runtime.progress.note(
        'Retained checkpoint information is in result.json; it is not proof of successful execution.',
      )
    if (cleanupFailed) {
      runtime.writeError(
        renderDiagnostic(
          'JIG_CLEANUP_FAILED',
          'the execution terminal is preserved, but Project Session cleanup failed',
        ),
      )
      return 2
    }
    if (delivery !== undefined && delivery.status !== 'written') {
      runtime.writeError(
        renderDiagnostic(
          'JIG_DELIVERY_FAILED',
          delivery.status === 'unknown'
            ? 'execution is settled; delivery was not acknowledged and the packet may exist; repeating the command starts new work'
            : 'execution is settled, but delivery failed; repeating the command starts new work',
        ),
      )
      return 2
    }
    return status.terminal.status === 'succeeded' ? 0 : status.terminal.status === 'failed' ? 1 : 2
  } finally {
    try {
      await files.close()
    } finally {
      capture.close()
    }
  }
}

function parseReview(
  arguments_: readonly string[],
  currentDirectory: string,
): {
  readonly project: string
  readonly yes: boolean
  readonly details: boolean
  readonly allowResolutionNetwork: boolean
} {
  let project: string | undefined
  let yes = false
  let allowResolutionNetwork = false
  let details = false
  for (const argument of arguments_.slice(1)) {
    if (argument === '--yes' && !yes) yes = true
    else if (argument === '--details' && !details) details = true
    else if (argument === '--allow-resolution-network' && !allowResolutionNetwork)
      allowResolutionNetwork = true
    else if (!argument.startsWith('-') && project === undefined) project = argument
    else
      usage(
        'review',
        argument.startsWith('-')
          ? `Unknown or repeated review option ${asciiJsonString(argument.slice(0, 128))}.`
          : 'Specify only one project directory.',
      )
  }
  return { project: project ?? currentDirectory, yes, details, allowResolutionNetwork }
}

function parseRun(arguments_: readonly string[]): {
  readonly target: RunTargetRef
  readonly input: JsonValue
  readonly inputFile?: string
  readonly attachments: readonly { name: string; directory: string; select: readonly string[] }[]
  readonly output?: string
  readonly timeoutMs: number
  readonly receive: readonly string[]
} {
  if (arguments_.length < 2)
    usage('run', 'Choose a target, for example flow:flows/hello or binding:repair.')
  const target = parseTarget(arguments_[1]!)
  let input: JsonValue = {}
  let inputFile: string | undefined, output: string | undefined
  const attachments = new Map<string, string>(),
    selectors = new Map<string, string[]>()
  let timeoutMs = PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS
  let sawInput = false
  let sawTimeout = false
  const receive: string[] = []
  for (let index = 2; index < arguments_.length; index += 2) {
    const option = arguments_[index]
    const value = arguments_[index + 1]
    if (!['--input', '--attach', '--select', '--out', '--receive', '--timeout'].includes(option!))
      usage('run', `Unknown run option ${asciiJsonString(option!.slice(0, 128))}.`)
    if (value === undefined || value.startsWith('--')) usage('run', `${option} needs a value.`)
    if (option === '--receive') {
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ||
        value.length > 64 ||
        receive.includes(value) ||
        receive.length >= 16
      )
        throw new CliDiagnostic(
          'JIG_USAGE',
          '--receive requires unique channel names, at most 16',
          2,
        )
      receive.push(value)
      continue
    }
    if (option === '--input' && !sawInput) {
      sawInput = true
      if (value.startsWith('@')) {
        if (value.length < 2)
          throw new CliDiagnostic('JIG_RUN_INPUT_INVALID', '@FILE requires a file path', 1)
        inputFile = value.slice(1)
        continue
      }
      try {
        input = decodeJson1(textEncoder.encode(value))
      } catch {
        throw new CliDiagnostic(
          'JIG_RUN_INPUT_INVALID',
          '--input must be valid JSON; quote inline JSON or use --input @file.json. No Flow was started.',
          1,
        )
      }
      continue
    }
    if (option === '--timeout' && !sawTimeout) {
      sawTimeout = true
      timeoutMs = parseRunTimeout(value)
      continue
    }
    if (option === '--out' && output === undefined) {
      output = value
      continue
    }
    if (option === '--attach' || option === '--select') {
      const split = value.indexOf('=')
      try {
        if (split < 1 || split === value.length - 1) throw new Error('missing mapping')
        const name = privateAttachmentName(value.slice(0, split)),
          path = value.slice(split + 1)
        if (option === '--attach') {
          if (attachments.has(name)) throw new Error('duplicate mapping')
          attachments.set(name, path)
        } else {
          privateFilePath(path)
          const selected = selectors.get(name) ?? []
          if (selected.includes(path)) throw new Error('duplicate selector')
          selected.push(path)
          selectors.set(name, selected)
        }
      } catch {
        throw new CliDiagnostic(
          'JIG_RUN_FILES_INVALID',
          'use --attach NAME=DIR and optional unique --select NAME=RELATIVE_FILE values',
          1,
        )
      }
      continue
    }
    usage('run', `${option} may only be supplied once.`)
  }
  if ([...selectors.keys()].some((name) => !attachments.has(name)))
    throw new CliDiagnostic(
      'JIG_RUN_FILES_INVALID',
      '--select requires a matching --attach name',
      1,
    )
  return {
    target,
    input,
    timeoutMs,
    receive,
    attachments: [...attachments].map(([name, directory]) => ({
      name,
      directory,
      select: selectors.get(name) ?? [],
    })),
    ...(inputFile === undefined ? {} : { inputFile }),
    ...(output === undefined ? {} : { output }),
  }
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
    'use flow:<path> or binding:<id>, for example flow:flows/hello. Run jig review after adding a target.',
    1,
  )
}

async function withProjectSession<T>(
  project: string,
  runtime: CliRuntime,
  operation: (session: ProjectSession) => Promise<T>,
  acquisition?: Parameters<PrivateCliCommandHost['acquire']>[1],
  onSettledCloseFailure?: () => void,
): Promise<T> {
  runtime.signal?.throwIfAborted()
  runtime.progress.stage('Opening the project and checking reviewed support')
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
    runtime.progress.stage('Settling owned execution and cleaning up')
    await close()
    if (runtime.signal?.aborted)
      runtime.progress.note('Owned execution cleanup completed. The command remains interrupted.')
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
  if (closeFailed) {
    if (onSettledCloseFailure === undefined) throw closeFailure
    onSettledCloseFailure()
  }
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

export function publicTerminal(terminal: RootRunTerminal): JsonValue {
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
  const writeError =
    options.writeError ??
    ((text: string) => {
      process.stderr.write(text)
    })
  return {
    progress: new PrivateCliProgress(
      options.terminalOutput ?? process.stderr.isTTY === true,
      writeError,
      options.signal,
    ),
    host: options.host ?? unavailableHost,
    currentDirectory: options.currentDirectory ?? process.cwd(),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    interactive:
      options.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true),
    confirm: options.confirm ?? terminalConfirmation,
    writeRecord:
      options.writeRecord ??
      (async (text) => {
        if (options.writeOutput) options.writeOutput(text)
        else process.stdout.write(text)
      }),
    writeOutput:
      options.writeOutput ??
      ((text) => {
        process.stdout.write(text)
      }),
    writeError,
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
    const candidateHints: Record<string, string> = {
      METADATA_DELIMITER:
        'FLOW.md needs YAML metadata between two exact --- lines at the start of the file',
      METADATA_INVALID_YAML:
        'FLOW.md metadata is not valid YAML; check indentation, quotes and key/value syntax',
      METADATA_DUPLICATE_KEY: 'FLOW.md repeats a metadata key; keep one value for each key',
      METADATA_DESCRIPTION: 'provide a nonempty text description in FLOW.md',
      METADATA_FIELD:
        'a FLOW.md field has an unsupported name or shape; check the indicated field against https://flow.jig.md/spec/package-format',
      METADATA_YAML_FEATURE:
        'use ordinary YAML values without anchors, aliases, tags or merge keys in FLOW.md',
      METADATA_USES: 'each uses slot must declare a package-local contract or local: true',
      METADATA_REFERENCE: 'use a canonical package-local ./ reference in FLOW.md',
      PACKAGE_FLOW_MISSING: 'the selected package needs an exact-case FLOW.md file',
      PACKAGE_ENTRYPOINT_AMBIGUOUS:
        'keep only one root flow.<suffix> implementation in the package',
      PROJECT_BINDING_SETTINGS_INVALID:
        'Binding settings do not match the Flow settings schema; correct the indicated value',
      PROJECT_BINDING_PACKAGE_MISSING:
        'the Binding references a Flow not selected by jig.ts; correct the path or project membership',
      PROJECT_BINDING_SLOT_MISSING:
        'a child slot references a target not selected by jig.ts; correct the slot or project membership',
      PROJECT_MEMBER_MISSING:
        'a selected project member is missing; restore it or update the membership in jig.ts',
      PROJECT_MEMBER_COLLISION:
        'project members have colliding paths or names; give each selected member a distinct identity',
      PROJECT_EVALUATION_FAILED:
        'the project definition could not be evaluated; check jig.ts and its imports for syntax or runtime errors',
      PROJECT_DECLARATION_INVALID:
        'export a valid defineJig or defineBinding declaration from the indicated module',
      CHANNEL_FIELD: 'check channel declarations and descriptors against FLOW Channel Contract/1',
      CHANNEL_LIMIT: 'check channel declaration counts and descriptor bounds',
      CHANNEL_REFERENCE: 'use a canonical package-local ./ channel contract path',
      PACKAGE_BUN_RESOLUTION_PERMISSION_REQUIRED: `supply bun.lock or rerun jig review with --allow-resolution-network. ${RESOLUTION_WARNING}`,
      PACKAGE_BUN_RESOLUTION_FAILED:
        'dependency resolution failed; requests may already have occurred; check package declarations and registry availability',
      PACKAGE_BUN_RESOLUTION_VERSION_UNAVAILABLE:
        'a requested dependency version or tag is unavailable in the registry; check package.json against published versions or use a declared local workspace dependency',
      PACKAGE_BUN_RESOLVED_SOURCE_UNSUPPORTED:
        'resolved dependencies are unsupported; requests may already have occurred; use integrity-pinned default npm registry dependencies',
      PACKAGE_BUN_SOURCE_UNSUPPORTED:
        'use default npm registry dependencies or declared workspace members; patches, overrides, and other dependency sources are unsupported',
      PACKAGE_BUN_WORKSPACE_MISSING:
        'declare the Flow and each workspace dependency in an ancestor package.json workspaces list; workspace dependencies never fall back to npm',
      PACKAGE_BUN_WORKSPACE_INVALID:
        'check workspace membership, unique package names, safe relative paths, and the root lock; links, local member locks, and dependency overrides are unsupported',
      PACKAGE_BUN_WORKSPACE_VERSION:
        'a workspace package version does not satisfy its workspace: declaration; correct the declaration or local package version',
      PACKAGE_BUN_WORKSPACE_BUILD_REQUIRED:
        'a declared workspace export is missing; build the local dependency before jig review',
      PACKAGE_BUN_WORKSPACE_CHANGED:
        'workspace inputs changed during capture; retry review after the edits settle',
      PACKAGE_BUN_LOCK_INVALID: 'bun.lock is invalid; correct the supplied lock',
      PACKAGE_BUN_LOCK_STALE:
        'package.json and bun.lock disagree; update the supplied lock explicitly',
    }
    const hint =
      candidateHints[error.diagnostic?.code ?? ''] ??
      (error.diagnostic?.code === 'PROJECT_AGENT_UNAVAILABLE'
        ? (runtime.host.agentUnavailableHint ??
          'configure the host Agent before review; check exported credentials, model, and selected client')
        : error.diagnostic?.code === 'PROJECT_COMMAND_UNCONFIGURED'
          ? 'select a Binding with reviewed commands for this Flow'
          : error.diagnostic?.code === 'PACKAGE_BUN_NODE_MODULES'
            ? 'move generated node_modules outside the Flow package; jig review prepares its locked production dependencies'
            : error.diagnostic?.code === 'PACKAGE_BUN_PREPARATION_FAILED'
              ? 'locked dependencies could not be prepared; check registry access and package availability'
              : undefined)
    runtime.writeError(
      error.diagnostic !== undefined
        ? renderProjectDiagnostic(error, hint ?? projected.message)
        : renderDiagnostic(error.code, projected.message),
    )
    return projected.exitCode
  }
  if (error instanceof RootAdministrationError) {
    if (
      error.code === 'UNAVAILABLE' &&
      error.details !== null &&
      typeof error.details === 'object' &&
      !Array.isArray(error.details) &&
      ['ADMISSION_MISSING', 'STALE_PLAN'].includes(
        String((error.details as Record<string, JsonValue>).code),
      )
    ) {
      runtime.writeError(
        renderDiagnostic(
          String((error.details as Record<string, JsonValue>).code),
          'the project has no usable reviewed revision; complete jig review before running',
        ),
      )
      return 2
    }
    if (
      error.details !== null &&
      typeof error.details === 'object' &&
      !Array.isArray(error.details) &&
      (error.details as Record<string, JsonValue>).code === 'RUN_ATTACHMENTS_INVALID'
    ) {
      runtime.writeError(
        renderDiagnostic(
          'JIG_RUN_FILES_INVALID',
          "supply exactly the admitted target's read attachments with --attach and its required writable destination with --out",
        ),
      )
      return 1
    }
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
    code === 'PROJECT_STATE_INVALID' ||
    code === 'INVALID_CANDIDATE' ||
    code === 'LOCK_MISMATCH' ||
    code === 'PLAN_NOT_FOUND' ||
    code === 'STALE_PLAN'
  const messages: Record<ProjectAdministrationError['code'], string> = {
    INVALID_REQUEST: 'the project request is invalid',
    PROJECT_NOT_FOUND:
      'the project was not found; change into a Jig project or pass its directory to jig review',
    PROJECT_UNSAFE: 'the project cannot be opened safely',
    PROJECT_STATE_INVALID:
      'the retained .jig state is incompatible with this Jig build or damaged; preserve .jig and jig.lock for recovery. Once prior work is confirmed stopped and cleaned up, move them outside the project and run jig review again',
    INVALID_CANDIDATE: 'the project definition is invalid',
    LOCK_MISMATCH: 'the project lock does not match the reviewed state',
    PLAN_NOT_FOUND: 'the reviewed project changes are no longer available',
    STALE_PLAN: 'the project changed before its review could be applied',
    PROJECT_BUSY:
      'the project is already in use; wait for its current command to finish or cancel that command; do not delete .jig to bypass ownership',
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
