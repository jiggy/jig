import { writeFile } from 'node:fs/promises'
import { main, publicTerminal } from '../../src/cli.js'
import { privateConnectFileOwner, privateFileRecovery } from '../../src/internal/file-command.js'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import {
  openPrivateProjectSession,
  recoverPrivateCheckpointRun,
} from '../../src/internal/project-session-controller.js'
import { canonicalJson } from '../../src/json.js'
import { installedBunLocation } from './installed-bun-location.js'

const [root, ready, phase, ...args] = process.argv.slice(2)
const host = await openPrivateInstalledBunHost(installedBunLocation, {})
const recovery = privateFileRecovery()
if (recovery) {
  process.stdout.write(
    Buffer.from(
      canonicalJson(publicTerminal(await recoverPrivateCheckpointRun(recovery, host))),
    ).toString() + '\n',
  )
} else {
  const delivery = (await privateConnectFileOwner())!
  const stop = async () => {
    await writeFile(ready!, String(process.pid))
    process.kill(process.pid, 'SIGSTOP')
    await new Promise(() => {})
  }
  const selected = {
    ...delivery,
    async saveCheckpoint(input: Parameters<NonNullable<typeof delivery.saveCheckpoint>>[0]) {
      if (phase === 'before') await stop()
      if ((phase === 'acknowledged' || phase === 'cancel') && input.sequence === 2) await stop()
      const receipt = await delivery.saveCheckpoint!(input)
      if (phase === 'accepted' || (phase === 'replacement' && input.sequence === 2)) await stop()
      return receipt
    },
  }
  try {
    process.exitCode = await main(args, {
      currentDirectory: root,
      host: {
        delivery: selected,
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
