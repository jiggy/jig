#!/usr/bin/env bun

import { randomBytes } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import manifest from '../package.json' with { type: 'json' }
import { ProjectAdministrationError, type ProjectSession } from './administration/project.js'
import {
  type RootAdministration,
  RootAdministrationError,
  type RootRunStatus,
  type RootRunTerminal,
} from './administration/root.js'
import {
  privateCliHumanText,
  privateCliStyleEnabled,
  privateCliDiagnostic as renderDiagnostic,
} from './cli-presentation.js'
import { PrivateCliProgress } from './cli-progress.js'
import { PrivateCliRunPresentation } from './cli-run-presentation.js'
import { privateCliValueFields } from './cli-value-presentation.js'
import { CheckError } from './diagnostics.js'
import { ACP_SETUP_HINTS } from './internal/acp-setup-diagnostics.js'
import {
  inspectPrivateApprovedProject,
  type PrivateInspectionEnvironmentCheck,
} from './internal/activation-admission-store.js'
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
import { PrivateRunDiagnostics } from './internal/run-diagnostics.js'
import { canonicalJson, decodeJson1, JSON_1_LIMITS, Json1Error, type JsonValue } from './json.js'
import { bindingRef, flowRef, type RunTargetRef } from './project/author.js'
import { flowSelector, npmPackageName } from './project/package-selector.js'
import { createProject, type ProjectInitAgent, ProjectInitError } from './project-init.js'
import { schemaTypeMismatchText } from './schema/types.js'

const HELP = `Jig runs reusable methods with powers you approve.

Usage:
  jig init <directory>       Create a project with a small greeting Flow
  jig review [project]       Review changes and approve an exact revision
  jig run <target>           Run a reviewed Flow or Binding
  jig inspect [target]       Show the approved targets or a target's interface
  jig --version             Print the installed version

Start here:
  jig init hello-jig
  cd hello-jig
  jig review --allow-resolution-network
  jig run flow:flows/hello --input '"Ada"'

Use jig <command> --help for options and examples.
Guide: https://jig.md/guide/`

const COMMAND_HELP = {
  inspect: `Usage: jig inspect [flow:path|binding:id] [--json]

List the current project's approved targets, or show one target's retained
input/result schemas, settings, child slots, capabilities, files and channels.

Compare the last approval with the current local execution environment.
Changed environments require review; unverifiable environments remain unchecked.
No source evaluation, installation, provider requests, recovery or state writes.
Visible edits, launch readiness and remote provider availability are not checked.

  --json     Emit JSON even in a terminal (redirected output is always JSON)

Examples:
  jig inspect
  jig inspect flow:flows/hello
  jig inspect binding:repair --json`,
  init: `Usage: jig init [--bare] <directory> [--agent [codex|claude|pi]]

Create a new editable project and greeting Flow. No installation, network
requests, approval, or execution happens during initialization.

  --bare     Create only jig.ts and empty flows/ and bindings/ directories

Example: jig init hello-jig
With an ordinary Agent: jig init my-app --agent codex
Use --agent without a client for an interactive choice. It writes a visible
dependency, Binding and default selection; client installation and authority
approval remain separate. Without --agent the greeting needs no Agent.
The destination must not exist; existing files are never replaced.`,
  review: `Usage: jig review [project] [--generate-contracts] [--allow-resolution-network] [--yes] [--allow-authority-changes] [--details]

Capture source, prepare dependencies, show changes, then ask for approval.
The project defaults to the current directory. This command has side effects:
it retains private snapshots and, after approval, updates jig.lock.

  --allow-resolution-network  Permit fresh resolution for missing dependency locks
  --yes                      Approve the displayed revision without a prompt
  --allow-authority-changes   Also approve new or changed resource grants
  --details                  Show complete policy when proposing a change
  --generate-contracts                 Generate contracts with Jig's bundled TypeSpec tool
                             Writes managed companions before Run approval

Examples:
  jig review
  jig review --allow-resolution-network
  jig review ./my-project --yes

Resolution can contact dependency-selected public or private-network services
before graph validation. Requests cannot be undone by declining approval.
--yes alone does not approve new resource authority or resolution networking.
Supplied locks stay frozen; stale locks must be updated explicitly.`,
  run: `Usage: jig run <flow:path|binding:id> [options]

Run an exact reviewed target in the current project. No dependencies are
installed and source changes are not approved automatically.

  --json             Emit exact JSON/NDJSON even in a terminal
  --input JSON|@FILE  Supply JSON inline or from a file (default: {})
  --attach NAME=DIR   Capture a declared read attachment; repeat for each name
  --select NAME=FILE  Select a relative file within an attachment; repeat as needed
  --out DIR          Save a result packet to a new directory outside input roots
  --receive CHANNEL  Stream a declared output channel; repeat for distinct names
  --timeout DURATION Set the execution deadline (default: 30s; maximum: 24h)
                     Units: ms, s, m, h. Cleanup still runs after the deadline.

Examples:
  jig run flow:flows/hello --input '"Ada"'
  jig run binding:repair --input @issue.json --attach source=./src --out ./review
  jig run binding:worker --receive progress --timeout 2m

Ctrl-C cancels owned work and waits for cleanup. Repeating a run starts new work.
Terminal stdout shows readable results and live channel text. Redirect stdout or
use --json for JSON (NDJSON with --receive). Diagnostics and status use stderr.
Scripts should check the result and exit status.`,
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
      readonly onNotice?: (text: string) => void
      readonly onStage?: (stage: string) => void
      readonly generateContracts?: boolean
      readonly onGeneration?: (packagePath: string, files: readonly string[]) => void
    },
  ): Promise<ProjectSession>
  readonly delivery?: PrivateDeliveryConnection
  pause?(milliseconds: number): Promise<void>
}

export interface PrivateCliOptions {
  readonly inspectEnvironment?: PrivateInspectionEnvironmentCheck
  readonly host?: PrivateCliCommandHost
  readonly currentDirectory?: string
  readonly signal?: AbortSignal
  readonly interactive?: boolean
  readonly terminalOutput?: boolean
  readonly confirm?: (prompt: string, signal?: AbortSignal) => Promise<boolean>
  readonly answer?: (prompt: string, signal?: AbortSignal) => Promise<string>
  readonly writeOutput?: (text: string) => void
  readonly writeRecord?: (text: string) => Promise<void>
  readonly writeError?: (text: string) => void
  readonly createSubmissionId?: () => string
}

interface CliRuntime {
  readonly inspectEnvironment?: PrivateInspectionEnvironmentCheck
  readonly humanOutput: boolean
  readonly outputColor: boolean
  readonly outputColumns: number
  readonly progress: PrivateCliProgress
  readonly host: PrivateCliCommandHost
  readonly currentDirectory: string
  readonly signal?: AbortSignal
  readonly interactive: boolean
  readonly confirm: (prompt: string, signal?: AbortSignal) => Promise<boolean>
  readonly answer: (prompt: string, signal?: AbortSignal) => Promise<string>
  readonly writeOutput: (text: string) => void
  readonly writeRecord: (text: string) => Promise<void>
  readonly writeError: (text: string) => void
  readonly writeDiagnostic: (text: string) => void
  readonly writeNotice: (text: string) => void
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
    if (arguments_[0] === 'inspect') return await executeInspect(arguments_, runtime)
    runtime.writeError(
      renderDiagnostic(
        'JIG_USAGE',
        `Unknown command. Use jig --help to see available commands.\n\n${HELP}`,
      ),
    )
    return 2
  } catch (error) {
    if (runtime.signal?.aborted) {
      runtime.writeError(
        renderDiagnostic(
          'JIG_COMMAND_INTERRUPTED',
          'The command was interrupted. Inspect any result and completed steps before starting new work; cancellation does not undo completed effects.',
        ),
      )
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
      (arguments_.length === 2 && Object.hasOwn(COMMAND_HELP, arguments_[0]!)))
  )
}

async function executeInspect(arguments_: readonly string[], runtime: CliRuntime): Promise<number> {
  let selector: string | undefined
  let json = false
  for (const value of arguments_.slice(1)) {
    if (value === '--json' && !json) json = true
    else if (!value.startsWith('-') && selector === undefined) {
      // Reuse the exact selector grammar without resolving or executing it.
      try {
        parseTarget(value)
      } catch {
        usage('inspect', 'Use an exact flow:path or binding:id target.')
      }
      selector = value
    } else usage('inspect', 'Specify at most one target and one --json option.')
  }
  let snapshot: JsonValue
  runtime.signal?.throwIfAborted()
  try {
    snapshot = await inspectPrivateApprovedProject(
      runtime.currentDirectory,
      selector,
      runtime.inspectEnvironment,
    )
  } catch (error) {
    if (error instanceof CheckError && error.code === 'INSPECTION_TARGET_MISSING')
      throw new CliDiagnostic(
        'JIG_TARGET_NOT_FOUND',
        'That target is not in the approved revision. Use jig inspect to list approved targets, or jig review to review source changes.',
        1,
      )
    throw new CliDiagnostic(
      'JIG_INSPECTION_UNAVAILABLE',
      'The approved snapshot could not be read safely. No state was changed. If a review is in progress, wait and retry; otherwise use jig review to diagnose the project state.',
      2,
    )
  }
  runtime.signal?.throwIfAborted()
  if (runtime.humanOutput && !json) {
    const state =
      typeof snapshot === 'object' && snapshot !== null && 'state' in snapshot
        ? snapshot.state
        : 'unchecked'
    const explanation =
      state === 'review-required'
        ? 'Review required\n\n  The execution environment has changed since approval.\n  Run jig review, inspect the changes, and approve before running again.'
        : state === 'environment-matches'
          ? 'Approval environment matches\n\n  Current local execution identities match this approval.\n  Run still revalidates launch authority; remote provider availability is not checked.'
          : 'Approval validity not checked\n\n  The current execution environment could not be verified.\n  Use jig review to diagnose missing support or configuration before running.'
    runtime.writeOutput(
      state === 'unreviewed'
        ? 'No approved revision\n\n  Run jig review to review and approve this project. Nothing was changed.\n'
        : `${explanation}\n\n  The interfaces below belong to the last approved revision. Visible source changes are not checked.\n\n${privateCliValueFields(snapshot)}\n`,
    )
  } else await runtime.writeRecord(`${textDecoder.decode(canonicalJson(snapshot))}\n`)
  return 0
}

async function executeInit(arguments_: readonly string[], runtime: CliRuntime): Promise<number> {
  let bare = false
  let destination: string | undefined
  let agent: ProjectInitAgent | 'choose' | undefined
  for (let index = 1; index < arguments_.length; index++) {
    const value = arguments_[index]!
    if (value === '--bare' && !bare) bare = true
    else if (value === '--agent' && agent === undefined) {
      const next = arguments_[index + 1]
      if (next !== undefined && ['codex', 'claude', 'pi'].includes(next)) {
        agent = next as ProjectInitAgent
        index++
      } else agent = 'choose'
    } else if (!value.startsWith('-') && destination === undefined) destination = value
    else usage('init', 'Specify one new directory and an optional supported Agent client.')
  }
  if (destination === undefined) usage('init', 'Specify a new project directory.')
  if (agent === 'choose') {
    if (!runtime.interactive)
      usage(
        'init',
        'Choose explicitly: --agent codex, --agent claude or --agent pi. Interactive selection requires a terminal.',
      )
    runtime.writeNotice(
      'Choose your native Agent client. This writes ordinary project files only; installation, authentication and grant approval remain separate.\n',
    )
    const answer = (
      await runtime.answer('Client [codex / claude / pi; empty cancels]: ', runtime.signal)
    ).trim()
    runtime.signal?.throwIfAborted()
    if (answer === '') {
      runtime.writeOutput('Initialization cancelled. No files were created.\n')
      return 0
    }
    if (!['codex', 'claude', 'pi'].includes(answer))
      usage('init', 'Choose codex, claude or pi; no files were created.')
    agent = answer as ProjectInitAgent
  }
  try {
    runtime.signal?.throwIfAborted()
    await createProject(resolve(runtime.currentDirectory, destination), undefined, bare, agent)
    runtime.writeOutput(
      agent !== undefined
        ? `Created Jig project ${asciiJsonString(destination)} with ${agent} selected.\n\nNext:\n  Open the project README for native client prerequisites and the first Run.\n  Review bindings/agent.ts for the requested authority, then run jig review --allow-resolution-network.\n\nNo client installed, credentials copied or execution approved.\n`
        : bare
          ? `Created bare Jig project ${asciiJsonString(destination)}.\n\nNext:\n  Add a Flow under flows/ and select it in jig.ts, then run jig review.\n`
          : `Created Jig project ${asciiJsonString(destination)}.\n\nNext:\n${/^[\x20-\x7e]+$/.test(destination) ? `  cd ${shellWord(destination)}\n` : '  Open the created directory in your terminal, then:\n'}  jig review --allow-resolution-network\n  jig run flow:flows/hello --input '"Ada"'\n\nNo dependencies installed or execution approved. See jig review --help.\n`,
    )
    return 0
  } catch (error) {
    if (error instanceof ProjectInitError) {
      runtime.writeError(
        renderDiagnostic(
          error.code,
          `${error.message}.\nNext step: ${error.code === 'JIG_INIT_DESTINATION_EXISTS' ? 'Choose a new directory; existing files are never replaced.' : error.code === 'JIG_INIT_CLEANUP_FAILED' ? 'Inspect the incomplete destination and preserve unfamiliar files before removing it; see jig init --help.' : 'Check the destination parent directory and its write permissions; see jig init --help.'}`,
        ),
      )
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
  runtime.progress.note(
    `Reviewing ${asciiJsonString(basename(resolve(runtime.currentDirectory, parsed.project)))}`,
  )
  const result = await withProjectSession(
    parsed.project,
    runtime,
    async (session) => {
      runtime.progress.stage('Capturing source and preparing dependencies')
      const plan = await session.plan({ lockMode: 'update' })
      runtime.progress.complete()
      if (plan.state === 'unchanged') return 0

      runtime.writeOutput(
        `${(parsed.details ? plan.review.details : plan.review.text).trimEnd()}\n`,
      )
      if (parsed.yes && plan.review.authorityChanges && !parsed.allowAuthorityChanges)
        throw new CliDiagnostic(
          'JIG_AUTHORITY_APPROVAL_REQUIRED',
          'New or changed resource grants need explicit approval. Review the delegation changes, then use interactive review or add --allow-authority-changes to --yes.',
          2,
        )
      if (!parsed.yes) {
        if (!runtime.interactive) {
          throw new CliDiagnostic(
            'JIG_APPROVAL_REQUIRED',
            'Review the displayed changes. To approve this exact revision without a prompt, rerun jig review --yes (with the same project and resolution options).',
            2,
          )
        }
        runtime.progress.note('Waiting for your approval. No Flow has been started.')
        const accepted = await runtime.confirm(
          'Approve this exact revision for execution? [y/N] ',
          runtime.signal,
        )
        if (!accepted) {
          runtime.writeError(
            renderDiagnostic(
              'JIG_CHANGES_DECLINED',
              'The proposed changes were not approved. Your previous approval is unchanged. Dependency requests already made cannot be undone.',
            ),
          )
          return 1
        }
      }

      runtime.signal?.throwIfAborted()
      runtime.progress.stage('Recording approval for the reviewed revision')
      await session.apply({
        planDigest: plan.planDigest,
        allowAuthorityChanges: !parsed.yes || parsed.allowAuthorityChanges,
      })
      runtime.progress.complete()
      return 0
    },
    {
      ...(parsed.allowResolutionNetwork
        ? {
            allowResolutionNetwork: true,
            onResolution: (path: string) =>
              runtime.writeNotice(
                `Warning: Dependency network access allowed\n\n  Package: ${asciiJsonString(path)}\n  Scope: This review only; Runs gain no network access.\n  Bun may contact dependency-selected public or private-network services\n  before graph validation. Requests cannot be undone; unsupported\n  dependencies may still fail.\n\n`,
              ),
          }
        : {}),
      ...(parsed.generate
        ? {
            generateContracts: true,
            onGeneration: (path: string, files: readonly string[]) =>
              runtime.writeNotice(
                `Generating ${asciiJsonString(path)}: ${files.map(asciiJsonString).join(', ')}. These writes do not approve execution.\n`,
              ),
          }
        : {}),
    },
  )
  runtime.signal?.throwIfAborted()
  if (result === 0)
    runtime.writeOutput(
      'Project ready\n\n  The exact reviewed revision is approved. No Flow was started.\n  Next: jig run <target> (see jig run --help).\n',
    )
  return result
}

async function executeRun(arguments_: readonly string[], runtime: CliRuntime): Promise<number> {
  const parsed = parseRun(arguments_)
  runtime.progress.note(
    `Running ${asciiJsonString(parsed.target.kind === 'flow' ? flowSelector(parsed.target.path) : `binding:${parsed.target.id}`)}`,
  )
  runtime.progress.stage('Reading selected inputs')
  const outputStop = new AbortController()
  runtime = {
    ...runtime,
    signal: AbortSignal.any([
      outputStop.signal,
      ...(runtime.signal === undefined ? [] : [runtime.signal]),
    ]),
  }
  const presentation =
    runtime.humanOutput && !parsed.json
      ? new PrivateCliRunPresentation(
          runtime.writeRecord,
          runtime.outputColor,
          runtime.outputColumns,
        )
      : undefined
  const submissionId = runtime.createSubmissionId()
  let settledRoot: Extract<RootRunStatus, { state: 'terminal' }> | undefined
  const diagnostics = new PrivateRunDiagnostics()
  let diagnosticSource = '[]'
  const writeLive = (text: string, diagnostic = false): void => {
    try {
      if (diagnostic) runtime.writeDiagnostic(text)
      else runtime.writeOutput(text)
    } catch (error) {
      outputStop.abort()
      throw error
    }
  }
  const channelOutput: PrivateRunChannelOutput = {
    receive: parsed.receive,
    terminal(status) {
      if (status.submissionId === submissionId) settledRoot = status
    },
    async record(value) {
      try {
        if (presentation) await presentation.channel(value)
        else await runtime.writeRecord(`${textDecoder.decode(canonicalJson(value))}\n`)
      } catch (error) {
        outputStop.abort()
        throw error
      }
    },
    diagnostic(bytes, operations = []) {
      const decoded = diagnostics.record(bytes, operations)
      const source = JSON.stringify(operations)
      if (source !== diagnosticSource) {
        diagnosticSource = source
        writeLive(
          `\nDiagnostics (${operations.length === 0 ? 'root' : asciiJsonString(operations.join(' / '))}):\n`,
          true,
        )
      }
      // Diagnostics are untrusted text, not terminal-control instructions.
      writeLive(
        decoded.replace(
          // biome-ignore lint/suspicious/noControlCharactersInRegex: Escape untrusted terminal controls while preserving tabs and line feeds.
          /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g,
          (value) => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`,
        ),
        true,
      )
      presentation?.diagnostic(decoded, operations)
    },
  }
  const emitTerminal = async (record: JsonValue): Promise<void> => {
    if (presentation) {
      await presentation.result(record)
      return
    }
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
    runtime.progress.complete()
    let cleanupFailed = false
    let status: Extract<RootRunStatus, { state: 'terminal' }>
    try {
      status = await withProjectSession(
        runtime.currentDirectory,
        runtime,
        async (session) => {
          runtime.progress.stage('Submitting the reviewed target')
          const receipt = await session.rootAdministration.startRun({
            submissionId,
            target: parsed.target,
            input,
          })
          runtime.progress.complete()
          runtime.progress.stage('Waiting for the Flow result (Ctrl-C to cancel)')
          try {
            return await waitForTerminal(
              session.rootAdministration,
              receipt.runId,
              runtime.host.pause ?? defaultPause,
              runtime.signal,
            )
          } finally {
            await presentation?.finish()
          }
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
    } catch (error) {
      if (!runtime.signal?.aborted || settledRoot === undefined || outputStop.signal.aborted)
        throw error
      status = settledRoot
    }
    let record = publicTerminal(status.terminal)
    const runDiagnostics = diagnostics.snapshot()
    if (runDiagnostics.entries.length !== 0 || runDiagnostics.truncated)
      record = { ...(record as Record<string, JsonValue>), runDiagnostics }
    if (runtime.signal?.aborted)
      record = { ...(record as Record<string, JsonValue>), command: { status: 'interrupted' } }
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
          !cleanupFailed && !runtime.signal?.aborted && status.terminal.status === 'succeeded'
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
    // Publication can itself be interrupted after the first record snapshot.
    if (runtime.signal?.aborted)
      record = { ...(record as Record<string, JsonValue>), command: { status: 'interrupted' } }
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
    const terminal = status.terminal
    // State the failure before expanding its validation or retained-evidence details.
    if (terminal.status !== 'succeeded')
      runtime.writeError(
        renderRunFailure(
          terminal,
          runDiagnostics.entries.some((entry) => entry.stderrBytes > 0),
        ),
      )
    await emitTerminal(decodeJson1(encodedRecord))
    if (terminal.status === 'succeeded')
      runtime.progress.note(
        `Execution completed. Application outcome: ${asciiJsonString(terminal.outcome)}. See output in the ${presentation ? 'result above' : 'JSON result'}.`,
      )
    if (delivery !== undefined)
      runtime.progress.note(
        `Delivery: ${delivery.status}. Destination: ${asciiJsonString(parsed.output!)}.${delivery.status === 'written' ? ' Inspect result.json and files/.' : ' Check the destination before starting new work.'}`,
      )
    if (runtime.host.delivery?.checkpoint != null)
      runtime.progress.note(
        'Retained checkpoint information is in result.json; it is not proof of successful execution.',
      )
    if (cleanupFailed) return 2
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
    if (runtime.signal?.aborted) return 2
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
  readonly allowAuthorityChanges: boolean
  readonly details: boolean
  readonly allowResolutionNetwork: boolean
  readonly generate: boolean
} {
  let project: string | undefined
  let yes = false
  let allowAuthorityChanges = false
  let allowResolutionNetwork = false
  let details = false
  let generate = false
  for (const argument of arguments_.slice(1)) {
    if (argument === '--yes' && !yes) yes = true
    else if (argument === '--allow-authority-changes' && !allowAuthorityChanges)
      allowAuthorityChanges = true
    else if (argument === '--details' && !details) details = true
    else if (argument === '--generate-contracts' && !generate) generate = true
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
  return {
    project: project ?? currentDirectory,
    yes,
    details,
    allowAuthorityChanges,
    allowResolutionNetwork,
    generate,
  }
}

function parseRun(arguments_: readonly string[]): {
  readonly target: RunTargetRef
  readonly input: JsonValue
  readonly inputFile?: string
  readonly attachments: readonly { name: string; directory: string; select: readonly string[] }[]
  readonly output?: string
  readonly timeoutMs: number
  readonly receive: readonly string[]
  readonly json: boolean
} {
  if (arguments_.length < 2)
    usage('run', 'Choose a target, for example flow:flows/hello or binding:repair.')
  const target = parseTarget(arguments_[1]!)
  let input: JsonValue = {}
  let inputFile: string | undefined, output: string | undefined
  const attachments = new Map<string, string>(),
    selectors = new Map<string, string[]>()
  let timeoutMs = PRIVATE_DEFAULT_ROOT_RUN_TIMEOUT_MS
  let json = false
  let sawInput = false
  let sawTimeout = false
  const receive: string[] = []
  for (let index = 2; index < arguments_.length; index += 2) {
    const option = arguments_[index]
    if (option === '--json') {
      if (json) usage('run', '--json may only be supplied once.')
      json = true
      index -= 1
      continue
    }
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
    json,
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
    if (value.startsWith('npm:')) {
      npmPackageName(value)
      return flowRef(value)
    }
    if (value.startsWith('flow:npm:')) throw new TypeError('use npm:<package>')
    if (value.startsWith('flow:')) return flowRef(value.slice('flow:'.length))
    if (value.startsWith('binding:')) return bindingRef(value.slice('binding:'.length))
  } catch {
    // The public diagnostic intentionally does not repeat project-controlled input.
  }
  throw new CliDiagnostic(
    'JIG_RUN_TARGET_INVALID',
    'use flow:<path>, npm:<package> or binding:<id>, for example flow:flows/hello. Run jig review after adding a target.',
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
  runtime.progress.stage('Verifying Jig runtime')
  const session = await runtime.host.acquire(project, {
    ...acquisition,
    onNotice: (text) => runtime.writeNotice(text),
    onStage: (stage) => {
      runtime.progress.complete()
      runtime.progress.stage(stage)
    },
  })
  runtime.progress.complete()
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
    runtime.progress.stage('Stopping remaining work and cleaning up')
    await close()
    runtime.progress.complete()
    if (runtime.signal?.aborted)
      runtime.progress.note('Cleanup complete. The command remains interrupted.')
  } catch (error) {
    closeFailed = true
    closeFailure = error
    onSettledCloseFailure?.()
    // Cleanup uncertainty must survive a missing terminal or broken stdout.
    // The callback enriches a result when available; it does not own this warning.
    runtime.writeError(
      renderDiagnostic(
        'JIG_CLEANUP_FAILED',
        'Cleanup could not be confirmed. Do not start new work until the existing work is settled. See https://jig.md/guide/results.',
      ),
    )
  } finally {
    runtime.signal?.removeEventListener('abort', onAbort)
  }

  if (!completed && closeFailed) {
    throw new AggregateError([failure, closeFailure], 'project command and close both failed')
  }
  if (!completed) throw failure
  if (closeFailed) {
    if (onSettledCloseFailure === undefined) throw closeFailure
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
  const writeOutput =
    options.writeOutput ??
    ((text: string) => {
      process.stdout.write(text)
    })
  const terminal = options.terminalOutput ?? process.stderr.isTTY === true
  const errorColor = privateCliStyleEnabled(terminal)
  const outputColor = privateCliStyleEnabled(
    options.terminalOutput ?? process.stdout.isTTY === true,
  )
  const progress = new PrivateCliProgress(
    terminal,
    (text) =>
      writeError(
        privateCliHumanText(text, errorColor, terminal ? process.stderr.columns || 80 : undefined),
      ),
    options.signal,
  )
  return {
    humanOutput: options.terminalOutput ?? process.stdout.isTTY === true,
    outputColor,
    outputColumns: process.stdout.columns || 80,
    progress,
    host: options.host ?? unavailableHost,
    ...(options.inspectEnvironment === undefined
      ? {}
      : { inspectEnvironment: options.inspectEnvironment }),
    currentDirectory: options.currentDirectory ?? process.cwd(),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    interactive:
      options.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true),
    confirm: options.confirm ?? terminalConfirmation,
    answer: options.answer ?? terminalAnswer,
    writeRecord: async (text) => {
      progress.pause()
      if (options.writeRecord) await options.writeRecord(text)
      else writeOutput(text)
    },
    writeOutput: (text) => {
      progress.pause()
      writeOutput(
        privateCliHumanText(
          text,
          outputColor,
          (options.terminalOutput ?? process.stdout.isTTY === true)
            ? process.stdout.columns || 80
            : undefined,
        ),
      )
    },
    writeError: (text) => {
      progress.pause()
      writeError(
        privateCliHumanText(text, errorColor, terminal ? process.stderr.columns || 80 : undefined),
      )
    },
    writeNotice: (text) => progress.notice(text),
    writeDiagnostic: (text) => {
      progress.pause()
      writeError(text)
    },
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
  return /^(?:y|yes)$/i.test((await terminalAnswer(prompt, signal)).trim())
}

async function terminalAnswer(prompt: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
    // Line prompts need no raw-mode cursor editor, including on plain terminals.
    terminal: false,
  })
  try {
    return await new Promise<string>((resolve, reject) => {
      const abort = () => {
        reject(signal?.reason)
        terminal.close()
      }
      terminal.once('close', () => {
        signal?.removeEventListener('abort', abort)
        resolve('')
      })
      signal?.addEventListener('abort', abort, { once: true })
      terminal.question(prompt, resolve)
    })
  } finally {
    terminal.close()
  }
}

async function defaultPause(milliseconds: number): Promise<void> {
  await delay(milliseconds)
}

function renderFailure(error: unknown, runtime: CliRuntime): 1 | 2 {
  if (
    error instanceof AggregateError &&
    error.message === 'project command and close both failed'
  ) {
    renderFailure(error.errors[0], runtime)
    return 2
  }
  if (error instanceof CliDiagnostic) {
    runtime.writeError(renderDiagnostic(error.code, error.message))
    return error.exitCode
  }
  if (error instanceof ProjectAdministrationError) {
    const projected = projectError(error.code)
    const candidateHints: Record<string, string> = {
      ...ACP_SETUP_HINTS,
      AUTHORING_STALE:
        'run jig review --generate-contracts to refresh the authored contract before review',
      AUTHORING_INTERRUPTED:
        'run jig review --generate-contracts to finish the recorded batch; resolve edited-file conflicts first',
      AUTHORING_CONFLICT:
        'a generated destination was edited or is not owned by this generator; preserve your changes and restore or move the conflicting file before generating',
      AUTHORING_NODE:
        'contract generation needs Node 22+; set JIG_AUTHORING_NODE_PATH to its absolute executable',
      AUTHORING_COMPILER:
        'the bounded compiler did not complete; check Node 22+ and retry generation',
      AUTHORING_COMPILE: asciiJsonString(error.message),
      METADATA_DELIMITER: 'when present, FLOW.md frontmatter needs two exact --- delimiter lines',
      METADATA_INVALID_YAML:
        'FLOW.md metadata is not valid YAML; check indentation, quotes and key/value syntax',
      METADATA_DUPLICATE_KEY: 'FLOW.md repeats a metadata key; keep one value for each key',
      METADATA_DESCRIPTION: 'when present, description must be nonempty text',
      METADATA_FIELD:
        'a metadata field has an unsupported shape; check the indicated field against https://flow.jig.md/spec/package-format',
      METADATA_YAML_FEATURE:
        'use ordinary YAML values without anchors, aliases, tags or merge keys in FLOW.md',
      METADATA_USES: 'use {} for an uncontracted slot or a package-local contract reference',
      METADATA_REFERENCE: 'use a canonical package-local ./ contract reference',
      PACKAGE_ENTRYPOINT_MISSING:
        'the selected package needs one exact-case FLOW.<suffix> entrypoint',
      PACKAGE_METADATA_OWNER:
        'keep Markdown frontmatter in FLOW.md; use flow.meta.json only with a code entrypoint',
      PACKAGE_SCHEMA_OWNER: 'place invocation input and result schemas in FLOW.contract.json',
      PACKAGE_PROFILE_UNSUPPORTED:
        'use a runtime and single-invocation contract supported by this host',
      PACKAGE_METADATA_UNSUPPORTED:
        'this host cannot honor the indicated metadata requirement; use a qualified host or revise that requirement explicitly',
      PACKAGE_TOOLS_UNSUPPORTED:
        'the selected runtime cannot enforce this allowed-tools restriction',
      CONTRACT_FIELD: 'check FLOW.contract.json fields against FLOW Invocation Contract/1',
      CONTRACT_IDENTITY:
        'a required interface must declare both its canonical id and exact version',
      CONTRACT_LIMIT:
        'reduce the invocation descriptor or its referenced channel closure to the documented bounds',
      MARKDOWN_FENCE_UNCLOSED: 'close each executable flow fence explicitly',
      MARKDOWN_LIMIT: 'the Markdown procedure exceeds its parser or recipe bounds',
      PROJECT_BINDING_INTERFACE_MISMATCH:
        'select a Flow offering the identical required contract id, version and digest',
      PROJECT_BINDING_INTERFACE_UNRESOLVED:
        'bind each required Flow slot to an exact compatible Flow or Binding',
      PACKAGE_ENTRYPOINT_AMBIGUOUS:
        'keep only one root FLOW.<suffix> implementation in the package',
      PROJECT_BINDING_SETTINGS_INVALID:
        'Binding settings do not match the Flow settings schema; correct the indicated value',
      PROJECT_BINDING_ATTACHMENTS_INVALID:
        'check the Binding attachment directories: use stable project-relative regular-file trees without links, protected state or nested mounts, within the file limits',
      PROJECT_BINDING_ATTACHMENT_UNDECLARED:
        'select only attachment names declared read-only in the Flow contract',
      PROJECT_BINDING_ATTACHMENTS_NOT_CAPTURED:
        'the selected Binding files could not be retained consistently; review stable source directories again',
      PROJECT_BINDING_PACKAGE_MISSING:
        'the Binding references a Flow not selected by jig.ts; correct the path or project membership',
      PROJECT_DEFAULT_MISSING:
        'defaultProviders in jig.ts names a missing Flow or Binding; create the selected local Binding and include its Flow in discovery, or correct the selector. Provider selection does not create Bindings',
      PROJECT_DEFAULT_CONTRACT:
        'use a contract ID as the defaultProviders key and select an ordinary Flow offering that same named contract; host-only resource contracts are not eligible',
      PROJECT_DEFAULT_INTERFACE_MISMATCH:
        'the selected default must offer the identical required contract id, version and digest; correct the selection or use an explicit compatible slot',
      PROJECT_DEFAULT_UNAVAILABLE:
        'the selected default cannot run with its current configuration; configure its required slots and grants before review',
      PROJECT_PROVIDER_AMBIGUOUS:
        'more than one implementation matches this contract; choose one in defaultProviders or configure the consumer slot explicitly',
      PROJECT_DEPENDENCY_MISSING:
        'declare the selected npm package in this project package.json dependencies, then review its Flow and required grants',
      PROJECT_DEPENDENCY_IDENTITY:
        'the resolved package does not match its declared name; correct the dependency and review again',
      PROJECT_DEPENDENCY_MANIFEST:
        'provide a bounded valid package.json for the project and the selected Flow dependency',
      PROJECT_DEPENDENCY_UNAVAILABLE:
        'this host cannot prepare npm Flow targets; use a host with declared dependency support',
      PROJECT_DEPENDENCY_LIMIT:
        'select at most 256 npm Flow packages within the existing dependency preparation limits',
      PROJECT_BINDING_SLOT_MISSING:
        'a child slot references a target not selected by jig.ts; correct the slot or project membership',
      PROJECT_GRANT_MISSING:
        'the slot names a grant not included by jig.ts; include grants: discover("./grants") and provide the matching <name>.json, or use an inline policy',
      PROJECT_GRANT_INVALID:
        'the grant must contain a supported closed HTTP, command or ACP policy; check its fields against https://jig.md/spec/grants',
      PROJECT_GRANTS_LIMIT:
        'keep the grant catalog within 256 entries and 1 MiB total, with at most 32 KiB per file',
      PROJECT_MEMBER_MISSING:
        'a selected project member is missing; restore it or update the membership in jig.ts',
      PROJECT_MEMBER_COLLISION:
        'project members have colliding paths or names; give each selected member a distinct identity',
      PROJECT_EVALUATION_FAILED:
        'the project definition could not be evaluated; check the indicated module for unknown fields, invalid values, syntax or import errors. defineJig accepts only flows, bindings, grants and defaultProviders',
      PROJECT_EVALUATION_LIMIT:
        'project evaluation exceeded its resource or time limit; keep authoring modules small and inert. If they already are, check host load before retrying review. No Flow was started',
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
        'use default npm registry dependencies or declared workspace members; patches require workspace-root declarations and captured .patch files; overrides and other dependency sources are unsupported',
      PACKAGE_BUN_MANIFEST_SHAPE: 'package.json must contain an object',
      PACKAGE_BUN_MANIFEST_FIELD:
        'the indicated manifest field is unsupported here; use default npm registry dependencies or declared workspace members, with patches declared only at the workspace root',
      PACKAGE_BUN_MANIFEST_DEPENDENCIES:
        'the indicated dependency section must be an object mapping package names to version requests',
      PACKAGE_BUN_MANIFEST_NAME:
        'use valid npm package names; an invalid dependency name is not displayed',
      PACKAGE_BUN_MANIFEST_SOURCE:
        'the indicated dependency request is unsupported; use a default npm registry version or a declared workspace: dependency, not file, Git, URL or custom-registry sources',
      PACKAGE_BUN_MANIFEST_PATCH:
        'patchedDependencies must map exact registry package versions to safe relative .patch files within the documented limits',
      PACKAGE_BUN_WORKSPACE_MISSING:
        'declare the Flow and each workspace dependency in an ancestor package.json workspaces list; workspace dependencies never fall back to npm',
      PACKAGE_BUN_WORKSPACE_INVALID:
        'check workspace membership, unique package names, safe relative paths, root lock, and declared patch files (at most 1 MiB each); links, local member locks, and dependency overrides are unsupported',
      PACKAGE_BUN_WORKSPACE_VERSION:
        'a workspace package version does not satisfy its workspace: declaration; correct the declaration or local package version',
      PACKAGE_BUN_WORKSPACE_BUILD_REQUIRED:
        'a declared workspace export is missing; build the local dependency before jig review',
      PACKAGE_BUN_WORKSPACE_CHANGED:
        'workspace inputs changed during capture; retry review after the edits settle',
      PROJECT_HTTP_UNAVAILABLE:
        'configure the selected slot grants and bearer environment variables before review',
      PROJECT_ACP_UNAVAILABLE:
        'configure the native client named in the affected ACP grant: its operator executable, model and authentication; then retry jig review',
      PACKAGE_BUN_LOCK_INVALID: 'bun.lock is invalid; correct the supplied lock',
      PACKAGE_BUN_LOCK_STALE:
        'package.json and bun.lock disagree; update the supplied lock explicitly',
      PACKAGE_BUN_INPUT_LIMIT:
        'the selected package sources exceed the preparation limit; reduce captured package files and see https://jig.md/guide/dependencies',
      PACKAGE_BUN_OUTPUT_LIMIT:
        'prepared runtime dependencies exceed the 32 MiB or 4096-file limit; check production dependencies in package.json, keep development tools separate, and see https://jig.md/guide/dependencies',
    }
    const hint =
      candidateHints[error.diagnostic?.code ?? ''] ??
      (error.diagnostic?.code === 'PACKAGE_BUN_NODE_MODULES'
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
          'supply exactly the unbound read attachments with --attach and the required writable destination with --out; captured Binding attachments cannot be overridden. Combined inputs must fit the 64-file/8-MiB limit',
        ),
      )
      return 1
    }
    const projected = rootError(error.code)
    runtime.writeError(renderDiagnostic(error.code, projected.message))
    return projected.exitCode
  }
  runtime.writeError(
    renderDiagnostic(
      'JIG_COMMAND_UNAVAILABLE',
      'The cause could not be determined. Inspect the result and any effects before starting new work. Check https://jig.md/guide/results and include this diagnostic code when reporting the failure.',
    ),
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
    AUTHORITY_APPROVAL_REQUIRED: 'Review resource delegation changes and approve them explicitly.',
    INVALID_REQUEST:
      'The project request is invalid. Check the command options with jig review --help.',
    PROJECT_NOT_FOUND:
      'the project was not found; change into a Jig project or pass its directory to jig review',
    PROJECT_UNSAFE:
      'The project cannot be opened safely. Check its ownership and permissions against https://jig.md/guide/#supported-host.',
    PROJECT_STATE_INVALID:
      'the retained .jig state is incompatible with this Jig build or damaged; preserve .jig and jig.lock for recovery. Once prior work is confirmed stopped and cleaned up, move them outside the project and run jig review again',
    INVALID_CANDIDATE:
      'The project definition is invalid. Check jig.ts and the selected Flow declarations; see https://jig.md/guide/.',
    LOCK_MISMATCH:
      'The project lock does not match the reviewed state. Run jig review to inspect and approve the current revision.',
    PLAN_NOT_FOUND:
      'The reviewed project changes are no longer available. Run jig review again to inspect a fresh proposal.',
    STALE_PLAN:
      'The project changed before approval could be recorded. Let source edits settle, then run jig review again.',
    PROJECT_BUSY:
      'the project is already in use; wait for its current command to finish or cancel that command; do not delete .jig to bypass ownership',
    PROJECT_CLOSED:
      'The project session is closed. Inspect any result and cleanup status before starting another command.',
    UNAVAILABLE:
      'The project command is unavailable. Check the supported host and installation requirements at https://jig.md/guide/#supported-host.',
    INTERNAL:
      'The project command failed; its cause could not be determined. Preserve any result and check https://jig.md/guide/results before starting new work.',
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
    INVALID_REQUEST:
      'The Run request is invalid. Check the target and options with jig run --help.',
    SUBMISSION_CONFLICT:
      'The Run request conflicts with existing work. Inspect the existing result and effects before starting new work; see https://jig.md/guide/results.',
    RUN_NOT_FOUND:
      'The Run could not be found. Its effects are not established by this failure. Check https://jig.md/guide/results before starting new work.',
    PROJECT_BUSY:
      'The project is already in use. Wait for the current command to finish or cancel it and wait for cleanup.',
    PROJECT_CLOSED:
      'The project session is closed. Inspect any result and cleanup status before starting another command.',
    UNAVAILABLE:
      'The Run command is unavailable. Check https://jig.md/guide/#supported-host and inspect any existing result before starting new work.',
    INTERNAL:
      'The Run command failed; its cause could not be determined. Inspect the result and any effects, and check https://jig.md/guide/results before starting new work.',
  }
  return { message: messages[code], exitCode: invalid ? 1 : 2 }
}

function renderRunFailure(
  terminal: Exclude<RootRunTerminal, { readonly status: 'succeeded' }>,
  hasRunDiagnostics = false,
): string {
  if (terminal.code === 'PROTOCOL_ERROR')
    return renderDiagnostic(
      'JIG_RUN_PROTOCOL_ERROR',
      'The Flow did not complete the FLOW Run/1 exchange.\nCheck its SDK version against this Jig release and keep stdout reserved for protocol messages.\nInspect the result and any effects before another Run; review source changes first. See https://flow.jig.md/spec/run-sdk.',
    )
  const details =
    terminal.status === 'failed' &&
    terminal.details !== null &&
    typeof terminal.details === 'object' &&
    !Array.isArray(terminal.details)
      ? (terminal.details as Record<string, JsonValue>)
      : undefined
  if (terminal.code === 'REVIEW_REQUIRED')
    return renderDiagnostic(
      'REVIEW_REQUIRED',
      'The current execution environment no longer matches your approval. Jig, its runtime, the selected Agent configuration, or sandbox support has changed.\nNo Flow was started for this Run.\n\nNext step: Run jig review, inspect the changes, and approve the revision before running this target again.',
      'Review required',
    )
  if (details?.code === 'RUN_TARGET_NOT_FOUND') {
    const targets = Array.isArray(details.availableTargets)
      ? details.availableTargets
          .slice(0, 16)
          .filter((value): value is string => typeof value === 'string')
      : []
    return renderDiagnostic(
      'JIG_RUN_TARGET_NOT_FOUND',
      `That target is not in the reviewed revision. No Flow was started.\n\nReviewed targets:\n${targets.length === 0 ? '  None. Add a Flow under flows/ first.' : targets.map((target) => `  ${asciiJsonString(target.slice(0, 512))}`).join('\n')}\n\nNext step: Choose an exact target above, or run jig review after changing jig.ts. No target is selected automatically.`,
    )
  }
  if (terminal.code === 'INVALID_INPUT')
    return renderDiagnostic(
      'JIG_RUN_INPUT_INVALID',
      `Input does not match the target input schema.${typeof details?.instancePointer === 'string' ? `\nValue: ${details.instancePointer === '' ? 'entire input' : asciiJsonString(details.instancePointer.slice(0, 512))}` : ''}${schemaTypeMismatchText(details?.typeMismatch) === undefined ? '' : `\n${schemaTypeMismatchText(details?.typeMismatch)}`}\nNext step: Check --input against the approved schema with jig inspect <target>; see the result for validation details.`,
    )
  if (terminal.status === 'lost')
    return renderDiagnostic(
      terminal.code,
      'Effects may be uncertain; do not blindly repeat the Run. Inspect the result and any effects before starting new work. See https://jig.md/guide/results.',
      'Execution lost',
    )
  if (
    terminal.code === 'EXECUTION_FAILED' &&
    terminal.diagnostics.stderrBytes === 0 &&
    (!terminal.message.trim() || terminal.message === 'root Run execution failed')
  )
    return renderDiagnostic(
      terminal.code,
      `Execution failed, but the host did not retain a more specific cause.\n${hasRunDiagnostics ? 'See attributed runDiagnostics in the result; diagnostic text is not a confirmed cause.' : 'No Flow diagnostic text was captured. This result does not establish whether the Flow started.'}\n\nInspect any effects before starting new work. See https://jig.md/guide/results.`,
      'Run failed',
    )
  const reasons: Record<string, string> = {
    CANCELLED: 'Execution was cancelled.',
    DEADLINE_EXCEEDED: 'Execution reached its deadline.',
    OWNER_CLOSED: 'Execution stopped because its owner closed.',
    OPERATION_CONFLICT: 'The operation conflicts with existing work.',
    UNAVAILABLE: 'Required execution support was unavailable.',
    PERMISSION_DENIED: 'The requested action was outside the approved permissions.',
    RESOURCE_EXHAUSTED: 'Execution reached a resource limit.',
    INVALID_RESULT: 'The Flow returned a result that does not match its declared contract.',
    UNCERTAIN: 'The operation may have produced effects; do not blindly repeat the Run.',
    EXECUTION_FAILED: 'The Flow could not complete execution.',
    CHANNEL_LOST: 'A required connection was lost.',
    LAGGED: 'A required receiver could not keep up with its channel.',
    DISCONNECTED: 'A required participant disconnected.',
  }
  return renderDiagnostic(
    terminal.code,
    `${reasons[terminal.code] ?? 'The cause could not be determined.'}${terminal.message.trim() ? `\n\nReported cause:\n  ${asciiJsonString(terminal.message)}` : ''}\n\nInspect any effects before starting new work. See https://jig.md/guide/results.`,
    terminal.code === 'CANCELLED' ? 'Run cancelled' : 'Run failed',
  )
}

function renderProjectDiagnostic(error: ProjectAdministrationError, message: string): string {
  const diagnostic = error.diagnostic
  if (diagnostic === undefined) return renderDiagnostic(error.code, message)
  const pointer =
    diagnostic.pointer === undefined ? '' : `\n  Value: ${asciiJsonString(diagnostic.pointer)}`
  const mismatch = schemaTypeMismatchText(diagnostic.typeMismatch)
  return `Review could not finish\n\n  Location: ${asciiJsonString(diagnostic.path)}${pointer}${mismatch === undefined ? '' : `\n  ${mismatch}`}\n\n  Next step\n    ${message}\n\n  Diagnostic code: ${diagnostic.code}\n  Category: ${error.code}\n`
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
