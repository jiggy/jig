import { closeSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { capturePrivateOutput } from '../../src/internal/captured-output.js'
import { privateSnapshotExecutionOutput } from '../../src/internal/execution-output.js'
import { privateConnectFileOwner } from '../../src/internal/file-command.js'
import { privateOpenFileRoot } from '../../src/internal/file-input.js'

const [destination, pidFile, stopAt, readyFile] = process.argv.slice(2)
const cancellation = new AbortController()
if (stopAt?.startsWith('settled-')) process.once('SIGTERM', () => cancellation.abort())
// Force the escalation path on both kernels; Darwin otherwise terminates a
// stopped process immediately when its default SIGTERM action is selected.
if (['before', 'during', 'after'].includes(stopAt!)) process.on('SIGTERM', () => {})
if (stopAt === 'wrong-parent') {
  const marker = JSON.parse(process.env.JIG_PRIVATE_FILE_OWNER!)
  marker.peer.version++
  process.env.JIG_PRIVATE_FILE_OWNER = JSON.stringify(marker)
}
const owner = await privateConnectFileOwner().catch((error) => {
  if (stopAt === 'wrong-parent' && error.message === 'native file owner peer does not match')
    process.exit(2)
  throw error
})
if (owner === undefined || destination === undefined || pidFile === undefined)
  throw new Error('missing test owner')
try {
  await writeFile(pidFile, String(process.pid))
  if (stopAt === 'snapshot') {
    const source = await mkdtemp(join(dirname(pidFile), 'source-'))
    const input = join(source, 'input')
    await mkdir(input)
    const root = privateOpenFileRoot(input)
    try {
      await rename(input, join(source, 'renamed-input'))
      await owner.prepare(destination, [root])
    } finally {
      closeSync(root)
    }
    const output = join(source, 'output')
    await mkdir(join(output, 'nested'), { recursive: true })
    await writeFile(join(output, 'nested/binary'), Buffer.from([0, 255, 128]))
    await writeFile(join(output, 'empty'), '')
    const directory = privateOpenFileRoot(output)
    const capture = capturePrivateOutput(directory)
    closeSync(directory)
    await rm(source, { recursive: true })
    try {
      const receipt = await owner.publish(
        { status: 'succeeded', outcome: 'done', output: null },
        privateSnapshotExecutionOutput(Promise.resolve(capture)),
      )
      if (receipt.status !== 'written')
        throw new Error(`fixture publication failed: ${receipt.code}`)
    } finally {
      capture.close()
    }
  } else {
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
  }
} finally {
  owner.close()
}
