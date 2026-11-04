import { writeFile } from 'node:fs/promises'
import { main, publicTerminal } from '../../src/cli.js'
import { executePrivateCliAttempt } from '../../src/cli-attempt-execution.js'
import { privateConnectFileOwner, privateFileRecovery } from '../../src/internal/file-command.js'
import { withPrivateInstallationVerification } from '../../src/internal/installation-verification.js'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import {
  openPrivateProjectSession,
  recoverPrivateCheckpointRun,
} from '../../src/internal/project-session-controller.js'
import type { PrivateRunChannelOutput } from '../../src/internal/run-channels.js'
import { canonicalJson } from '../../src/json.js'
import { installedBunLocation } from './installed-bun-location.js'

const [root, ...args] = process.argv.slice(2)
await withPrivateInstallationVerification({}, async () => {
  const host = await openPrivateInstalledBunHost(installedBunLocation, {}, root)
  const recovery = privateFileRecovery()
  if (recovery) {
    process.stdout.write(
      Buffer.from(
        canonicalJson(publicTerminal(await recoverPrivateCheckpointRun(recovery, host))),
      ).toString() + '\n',
    )
  } else {
    const delivery = await privateConnectFileOwner()
    const attemptSubmission = args[0] === 'attempt' && args[1] === 'submit'
    if (delivery === undefined && !attemptSubmission)
      throw new Error('checkpoint command requires its independent delivery owner')
    // Attempt submit has no live command presentation. Observe actual child
    // stderr without supplying acceptance, channel data or execution authority.
    const attemptObservation: PrivateRunChannelOutput | undefined = attemptSubmission
      ? {
          receive: [],
          record: async () => {
            throw new Error('checkpoint submit observer selected no channel records')
          },
          diagnostic: (bytes) => {
            process.stderr.write(bytes)
          },
        }
      : undefined
    // The parent's real channel/protected-store barriers can stop us only after
    // this identity marker exists. Preserve forced cancellation escalation on
    // Darwin, whose default SIGTERM action also terminates stopped processes.
    process.on('SIGTERM', () => {})
    await writeFile(`${root}/coordinator.started`, String(process.pid))
    try {
      process.exitCode = await main(args, {
        currentDirectory: root,
        executeAttempt: executePrivateCliAttempt,
        host: {
          ...(delivery === undefined ? {} : { delivery }),
          acquire: (directory, options) => {
            const channelOutput = options?.channelOutput ?? attemptObservation
            return openPrivateProjectSession({
              directory,
              host: {
                ...host,
                ...(options?.expectedAdmissionDigest === undefined
                  ? {}
                  : { expectedAdmissionDigest: options.expectedAdmissionDigest }),
                runTimeoutMs: options?.runTimeoutMs ?? host.runTimeoutMs,
                ...(options?.files === undefined ? {} : { files: options.files }),
                ...(channelOutput === undefined ? {} : { channelOutput }),
              },
            })
          },
        },
      })
    } finally {
      delivery?.close()
    }
  }
})
