import { writeFile } from 'node:fs/promises'
import { privateConnectFileOwner } from '../../src/internal/file-command.js'

const [destination, pidFile] = process.argv.slice(2)
const owner = await privateConnectFileOwner()
if (owner === undefined || destination === undefined || pidFile === undefined)
  throw new Error('missing test owner')
try {
  await writeFile(pidFile, String(process.pid))
  await owner.prepare(destination, [])
  const receipt = await owner.publish(
    { status: 'succeeded', outcome: 'blocked', output: { reason: 'synthetic owner test' } },
    undefined,
  )
  process.exitCode = receipt.status === 'written' ? 0 : 2
} finally {
  owner.close()
}
