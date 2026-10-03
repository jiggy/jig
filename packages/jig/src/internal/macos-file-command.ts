import { fstatSync, lstatSync } from 'node:fs'
import { mkdtemp, open, rmdir } from 'node:fs/promises'
import type { Socket } from 'node:net'
import { join } from 'node:path'
import { capturePrivateTransferredOutput, type PrivateCapturedOutput } from './captured-output.js'
import { privateMacosStatAt, privateMacosUnlinkAt } from './macos-descriptor-files.js'
import {
  createPrivateMacosDescriptorReceiver,
  requirePrivateMacosReceivedDescriptors,
} from './macos-descriptor-handoff.js'
import {
  privateMacosCurrentProcessIdentity,
  privateMacosPeerIdentity,
} from './macos-process-controls.js'

type Peer = Readonly<{ pid: number; version: number }>

export function requirePrivateMacosFilePeer(
  socket: Socket,
  expected: { pid: number; version?: number },
): Peer {
  const peer = privateMacosPeerIdentity(socket)
  if (
    peer.uid !== process.getuid!() ||
    peer.realUid !== peer.uid ||
    peer.pid !== expected.pid ||
    (expected.version !== undefined && peer.version !== expected.version)
  )
    throw new Error('native file owner peer does not match')
  return Object.freeze({ pid: peer.pid, version: peer.version })
}

/** An ordinary user command owns these endpoints outside every payload grant. */
export async function createPrivateMacosFileCommand() {
  const peer = privateMacosCurrentProcessIdentity()
  const directory = await mkdtemp('/private/tmp/jig-file-owner-')
  const parent = await open(directory, 'r')
  const identity = await parent.stat({ bigint: true })
  let roots: Awaited<ReturnType<typeof createPrivateMacosDescriptorReceiver>> | undefined
  let output: Awaited<ReturnType<typeof createPrivateMacosDescriptorReceiver>> | undefined
  let control: { dev: bigint; ino: bigint } | undefined
  let closed = false
  const verifyParent = () => {
    const held = fstatSync(parent.fd, { bigint: true }),
      visible = lstatSync(directory, { bigint: true })
    if (
      held.ino !== identity.ino ||
      held.dev !== identity.dev ||
      visible.ino !== identity.ino ||
      visible.dev !== identity.dev ||
      !visible.isDirectory() ||
      visible.uid !== BigInt(process.getuid!()) ||
      (visible.mode & 0o077n) !== 0n
    )
      throw new Error('native file owner directory changed')
  }
  const controlIdentity = () => {
    verifyParent()
    const info = privateMacosStatAt(parent.fd, 'control')
    if (
      !info.isSocket() ||
      info.uid !== BigInt(process.getuid!()) ||
      (control !== undefined && (control.dev !== info.dev || control.ino !== info.ino))
    )
      throw new Error('native file owner socket changed')
    return info
  }
  const close = async () => {
    if (closed) return
    closed = true
    const failures: unknown[] = []
    for (const receiver of [roots, output]) {
      try {
        await receiver?.close()
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      verifyParent()
      if (control !== undefined) {
        try {
          controlIdentity()
          privateMacosUnlinkAt(parent.fd, 'control')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      if (!failures.length) await rmdir(directory)
    } catch (error) {
      failures.push(error)
    }
    try {
      await parent.close()
    } catch (error) {
      failures.push(error)
    }
    if (failures.length) throw new AggregateError(failures, 'native file owner cleanup failed')
  }
  try {
    roots = await createPrivateMacosDescriptorReceiver(directory, 'roots')
    output = await createPrivateMacosDescriptorReceiver(directory, 'output')
    return Object.freeze({
      directory,
      peer,
      socket: join(directory, 'control'),
      close,
      controlReady() {
        const info = controlIdentity()
        control = { dev: info.dev, ino: info.ino }
      },
      beforeServerClose() {
        controlIdentity()
      },
      async roots<T>(
        peer: Peer,
        count: number,
        signal: AbortSignal,
        work: (roots: readonly number[]) => Promise<T>,
      ): Promise<T> {
        if (!Number.isSafeInteger(count) || count < 0 || count > 8)
          throw new TypeError('invalid native input root count')
        if (!count) return work([])
        const bundle = await roots!.receive(peer, 5000, signal)
        try {
          const descriptors = requirePrivateMacosReceivedDescriptors(bundle)
          if (
            descriptors.length !== count ||
            descriptors.some((fd) => !fstatSync(fd).isDirectory())
          )
            throw new Error('native input root handoff changed')
          return await work(descriptors)
        } finally {
          bundle.close()
        }
      },
      async output<T>(
        peer: Peer,
        manifest: unknown,
        signal: AbortSignal,
        work: (output: PrivateCapturedOutput) => Promise<T>,
      ): Promise<T> {
        const bundle = await output!.receive(peer, 5000, signal)
        let capture: PrivateCapturedOutput | undefined
        try {
          capture = capturePrivateTransferredOutput(bundle, manifest)
          return await work(capture)
        } finally {
          try {
            capture?.close()
          } finally {
            bundle.close()
          }
        }
      },
    })
  } catch (error) {
    await close()
    throw error
  }
}
