import { realpath } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  main,
  type PrivateCliCommandHost,
  privateCliCommandLifetimeMs,
  privateCliRequiresHost,
  publicTerminal,
} from './cli.js'
import { privateCliStderrDiagnostic } from './cli-presentation.js'
import { PrivateCliOutput } from './internal/cli-output.js'
import {
  privateConnectFileOwner,
  privateFileRecovery,
  privateNeedsFileOwner,
  privateOwnFileCommand,
} from './internal/file-command.js'
import {
  openPrivateInstalledBunHost,
  privateInstalledEnvironmentCheck,
} from './internal/installed-bun-host.js'
import { PrivateRootlessLinuxAcquisitionError } from './internal/linux-rootless-acquisition.js'
import { acquireOrReexecutePrivateRootlessLinux } from './internal/linux-rootless-delegation.js'
import {
  openPrivateProjectSession,
  recoverPrivateCheckpointRun,
} from './internal/project-session-controller.js'
import { canonicalJson } from './json.js'

interface InstalledCliOutcome {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

const BUN_POLICY = Object.freeze(['--no-env-file', '--no-install', '--config=/dev/null'] as const)
let installedCliPath: string
let releaseRoot: string
let executablePath: string
try {
  installedCliPath = await realpath(fileURLToPath(import.meta.url))
  releaseRoot = dirname(dirname(installedCliPath))
  executablePath = await realpath(process.execPath)
  if (
    process.argv[0] !== executablePath ||
    process.argv[1] !== installedCliPath ||
    (await realpath('/proc/self/exe')) !== executablePath ||
    process.execArgv.length !== BUN_POLICY.length ||
    process.execArgv.some((value, index) => value !== BUN_POLICY[index])
  ) {
    throw new Error('the installed Jig command has an invalid startup posture')
  }
} catch {
  process.stderr.write(
    privateCliStderrDiagnostic(
      'JIG_COMMAND_UNAVAILABLE',
      'Jig could not validate its installed launcher. Invoke the installed jig command directly. If that fails, restore the complete installation; see https://jig.md/guide/#install.',
    ),
  )
  process.exit(2)
}

/** The one installed alpha entrypoint. It is bundled into `libexec`. */
async function runPrivateInstalledCli(
  arguments_: readonly string[] = process.argv.slice(2),
  signal?: AbortSignal,
): Promise<InstalledCliOutcome> {
  if (!privateCliRequiresHost(arguments_)) {
    return exit(
      await main(arguments_, {
        ...(signal === undefined ? {} : { signal }),
        ...(arguments_[0] !== 'inspect'
          ? {}
          : {
              inspectEnvironment: privateInstalledEnvironmentCheck(
                { releaseRoot, executablePath, installedCliPath },
                process.env,
                process.cwd(),
              ),
            }),
      }),
    )
  }

  const operatorEnvironment = Object.freeze({ ...process.env })
  try {
    const recovery = privateFileRecovery()
    if (recovery === undefined && privateNeedsFileOwner(arguments_)) {
      return await privateOwnFileCommand(
        [executablePath, ...BUN_POLICY, installedCliPath],
        arguments_,
        signal,
        privateCliCommandLifetimeMs(arguments_),
      )
    }
    const delegation = await acquireOrReexecutePrivateRootlessLinux({
      commandLifetimeMs: privateCliCommandLifetimeMs(arguments_),
    })
    if (delegation.kind === 'private-rootless-linux-reexecuted/1') return delegation

    const delivery = await privateConnectFileOwner()
    try {
      const location = Object.freeze({
        releaseRoot: await realpath(releaseRoot),
        executablePath,
        installedCliPath,
      })
      let selectedHost: Awaited<ReturnType<typeof openPrivateInstalledBunHost>> | undefined
      if (recovery !== undefined) {
        delete process.env.JIG_PRIVATE_FILE_RECOVERY
        const installedHost = await openPrivateInstalledBunHost(
          location,
          operatorEnvironment,
          recovery.project,
          undefined,
          { remember: false },
        )
        const terminal = await recoverPrivateCheckpointRun(recovery, installedHost)
        process.stdout.write(`${Buffer.from(canonicalJson(publicTerminal(terminal))).toString()}\n`)
        return exit(0)
      }
      const host: PrivateCliCommandHost = Object.freeze({
        ...(delivery === undefined ? {} : { delivery }),
        get agentUnavailableHint() {
          return selectedHost?.agentUnavailableHint
        },
        acquire: async (
          project: string,
          options?: Parameters<PrivateCliCommandHost['acquire']>[1],
        ) => {
          const installedHost = await openPrivateInstalledBunHost(
            location,
            operatorEnvironment,
            project,
            options?.onStage,
            {
              remember: arguments_[0] === 'review',
              ...(options?.chooseAgent === undefined ? {} : { choose: options.chooseAgent }),
            },
          )
          selectedHost = installedHost
          const noticeAgent = () => {
            if (arguments_[0] !== 'review') return
            const selected = installedHost.agentExecutable
            const provider = installedHost.agentProvider
            const quote = (value: string) =>
              JSON.stringify(value).replace(
                /[\u007f-\uffff]/g,
                (value) => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`,
              )
            if (selected !== undefined)
              options?.onNotice?.(
                `Selected Agent:\n\n  Client: ${selected.client}\n  Executable: ${quote(selected.path)}\n\n`,
              )
            else if (provider?.kind === 'private-openai-agent-provider/1')
              options?.onNotice?.(
                `Selected Agent:\n\n  Client: API endpoint (final result only)\n  Endpoint: ${quote(provider.baseURL)}\n  Model: ${quote(provider.model)}\n\n`,
              )
          }
          noticeAgent()
          options?.onStage?.('Opening project state and checking recovery')
          return openPrivateProjectSession({
            directory: project,
            host: Object.freeze({
              ...installedHost,
              ...(options?.generateContracts ? { generateContracts: true } : {}),
              ...(options?.onGeneration ? { onGeneration: options.onGeneration } : {}),
              ...(options?.runTimeoutMs === undefined
                ? {}
                : { runTimeoutMs: options.runTimeoutMs }),
              ...(options?.files === undefined ? {} : { files: options.files }),
              ...(options?.channelOutput === undefined
                ? {}
                : { channelOutput: options.channelOutput }),
              ...(options?.allowResolutionNetwork !== true
                ? {}
                : {
                    allowResolutionNetwork: true,
                    ...(options.onResolution === undefined
                      ? {}
                      : { onResolution: options.onResolution }),
                  }),
            }),
          })
        },
      })
      const outputStop = new AbortController()
      const stdout = new PrivateCliOutput(process.stdout, outputStop)
      const stderr = new PrivateCliOutput(process.stderr, outputStop)
      try {
        return exit(
          await main(arguments_, {
            host,
            writeOutput: (text) => {
              void stdout.write(text).catch(() => undefined)
            },
            writeRecord: async (text) => {
              await stderr.flush()
              await stdout.write(text)
            },
            writeError: (text) => {
              void stderr.write(text).catch(() => undefined)
            },
            signal: AbortSignal.any([
              outputStop.signal,
              ...(signal === undefined ? [] : [signal]),
              ...(delivery === undefined ? [] : [delivery.signal]),
            ]),
          }),
        )
      } finally {
        await Promise.all([stdout.flush(), stderr.flush()])
      }
    } finally {
      delivery?.close()
    }
  } catch (error) {
    if (error instanceof PrivateRootlessLinuxAcquisitionError) {
      process.stderr.write(
        privateCliStderrDiagnostic(
          'SANDBOX_UNAVAILABLE',
          'Check the supported-host requirements: systemd user service, delegated cgroups, namespaces and Bubblewrap >= 0.12.\nNext step: https://jig.md/guide/#supported-host',
        ),
      )
    } else {
      process.stderr.write(
        privateCliStderrDiagnostic(
          'JIG_COMMAND_UNAVAILABLE',
          'The cause could not be determined. Inspect any result and effects before starting new work.\nNext step: Check https://jig.md/guide/results and include this code when reporting the failure.',
        ),
      )
    }
    return exit(2)
  }
}

function exit(exitCode: number): InstalledCliOutcome {
  return Object.freeze({ exitCode, signal: null })
}

function applyOutcome(outcome: InstalledCliOutcome): void {
  if (outcome.signal !== null) {
    process.kill(process.pid, outcome.signal)
    return
  }
  process.exitCode = outcome.exitCode ?? 2
}

if (import.meta.main) {
  const controller = new AbortController()
  const interrupt = () => {
    controller.abort()
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  let outcome: InstalledCliOutcome
  try {
    outcome = await runPrivateInstalledCli(process.argv.slice(2), controller.signal)
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
  }
  applyOutcome(outcome)
}
