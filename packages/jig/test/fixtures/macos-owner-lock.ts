import { open } from 'node:fs/promises'
import {
  acquirePrivateMacosOwnerLock,
  PrivateMacosOwnerBusyError,
} from '../../src/internal/macos-owner-lock.js'

const directory = await open(process.argv[2]!, 'r')
try {
  const lock = await acquirePrivateMacosOwnerLock(directory)
  try {
    console.log('acquired')
    if (process.argv[3] === 'hold') {
      const timer = setTimeout(() => process.exit(2), 8000)
      for await (const _ of process.stdin) {
      }
      clearTimeout(timer)
    }
  } finally {
    await lock.close()
  }
} catch (error) {
  if (!(error instanceof PrivateMacosOwnerBusyError)) throw error
  console.log('busy')
  process.exitCode = 3
} finally {
  await directory.close()
}
