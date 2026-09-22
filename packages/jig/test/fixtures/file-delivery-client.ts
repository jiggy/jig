import { writeFile } from 'node:fs/promises'
import { privateConnectFileOwner } from '../../src/internal/file-command.js'

const [destination, pidFile, stopAt, readyFile] = process.argv.slice(2)
const cancellation = new AbortController()
if (stopAt?.startsWith('settled-')) process.once('SIGTERM', () => cancellation.abort())
const owner = await privateConnectFileOwner()
if (owner === undefined || destination === undefined || pidFile === undefined)
  throw new Error('missing test owner')
try {
  await writeFile(pidFile, String(process.pid))
  if (stopAt === 'before') {
    await writeFile(readyFile!, 'ready')
    process.kill(process.pid, 'SIGSTOP')
  }
  await owner.prepare(destination, [])
  if (stopAt?.startsWith('settled-')) {
    await writeFile(readyFile!, 'ready')
    if (!cancellation.signal.aborted)
      await new Promise<void>((resolve) =>
        cancellation.signal.addEventListener('abort', () => resolve(), { once: true }),
      )
    // A cooperative coordinator needs more than the old 250 ms kill grace
    // to finish independent fencing and cleanup before terminal publication.
    await Bun.sleep(700)
    await writeFile(readyFile!, 'settled')
    const receipt = await owner.publish(
      {
        ...(stopAt === 'settled-success'
          ? { status: 'succeeded', outcome: 'done', output: 'completion won' }
          : { status: 'failed', code: 'CANCELLED', message: 'Run cancelled' }),
        command: { status: 'interrupted' },
        ...(stopAt === 'settled-cleanup-failed'
          ? { cleanup: { status: 'failed', code: 'PROJECT_CLOSE_FAILED' } }
          : {}),
      },
      undefined,
      cancellation.signal,
    )
    process.exitCode = receipt.status === 'written' ? 2 : 3
  } else {
    const receipt = await owner.publish(
      { status: 'succeeded', outcome: 'blocked', output: { reason: 'synthetic owner test' } },
      undefined,
    )
    process.exitCode = receipt.status === 'written' ? 0 : 2
    if (stopAt === 'after') {
      await writeFile(readyFile!, 'ready')
      process.kill(process.pid, 'SIGSTOP')
    }
  }
} finally {
  owner.close()
}
