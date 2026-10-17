import { writeFile } from 'node:fs/promises'
import { main, publicTerminal } from '../../src/cli.js'
import { privateConnectFileOwner, privateFileRecovery } from '../../src/internal/file-command.js'
import { withPrivateInstallationVerification } from '../../src/internal/installation-verification.js'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import {
  openPrivateProjectSession,
  recoverPrivateCheckpointRun,
} from '../../src/internal/project-session-controller.js'
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
    const delivery = (await privateConnectFileOwner())!
    // The parent's real channel/protected-store barriers can stop us only after
    // this identity marker exists. Preserve forced cancellation escalation on
    // Darwin, whose default SIGTERM action also terminates stopped processes.
    process.on('SIGTERM', () => {})
    await writeFile(`${root}/coordinator.started`, String(process.pid))
    try {
      process.exitCode = await main(args, {
        currentDirectory: root,
        host: {
          delivery,
          acquire: (directory, options) =>
            openPrivateProjectSession({
              directory,
              host: {
                ...host,
                runTimeoutMs: options?.runTimeoutMs ?? host.runTimeoutMs,
                ...(options?.files === undefined ? {} : { files: options.files }),
              },
            }),
        },
      })
    } finally {
      delivery.close()
    }
  }
})
