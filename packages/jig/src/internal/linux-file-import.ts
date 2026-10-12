import { randomBytes } from 'node:crypto'
import { constants, fstatSync, lstatSync, readFileSync, statfsSync } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import {
  mkdirPrivateFile,
  openPrivateFile,
  privateChildLocation,
  rmdirPrivateFile,
} from './descriptor-files.js'
import {
  createPrivateFileImportTarget,
  type PrivateFileImportStage,
  type PrivateFileImportTarget,
  PrivateFileImportUnconfirmedError,
} from './execution-file-import.js'
import { removePrivateDeliveryStage } from './file-delivery-storage.js'
import { privateAttachmentName } from './file-input-policy.js'

const DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW

/** The already-independent Run supervisor owns accepted stop versus publication. */
export interface PrivateLinuxImportOwner {
  begin(input: {
    readonly name: string
    readonly directory: string
    readonly operationId: string
    readonly deadlineUnixMs: number
    readonly device: string
    readonly inode: string
  }): Promise<'staged' | 'absent'>
  cancel(name: string): void
  commit(name: string): Promise<'committed' | 'absent'>
  end(name: string): Promise<void>
}

/** Only the native Backend supplies the original pre-projection backing/public pair. */
export function createPrivateLinuxFileImportTarget(input: {
  readonly backing: FileHandle
  readonly publicDirectory: FileHandle
  readonly deadlineUnixMs: number
  readonly signal?: AbortSignal | undefined
  readonly alive: () => boolean
  readonly owner: PrivateLinuxImportOwner
}): PrivateFileImportTarget {
  if (process.platform !== 'linux' || process.arch !== 'x64')
    throw new Error('native Linux file import is unavailable')
  const backing = fstatSync(input.backing.fd, { bigint: true })
  const publicDirectory = fstatSync(input.publicDirectory.fd, { bigint: true })
  const mount = (fd: number) =>
    /^mnt_id:\s+(\d+)$/m.exec(readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8'))?.[1]
  const originalMount = mount(input.backing.fd)
  const named = lstatSync(`/proc/self/fd/${input.backing.fd}/public`, { bigint: true })
  if (
    !backing.isDirectory() ||
    !publicDirectory.isDirectory() ||
    !named.isDirectory() ||
    backing.dev !== publicDirectory.dev ||
    named.dev !== publicDirectory.dev ||
    named.ino !== publicDirectory.ino ||
    originalMount === undefined ||
    mount(input.publicDirectory.fd) !== originalMount ||
    BigInt(statfsSync(`/proc/self/fd/${input.backing.fd}`).type) !== 0x01021994n
  )
    throw new Error('native file import does not retain its original backing/public mount')

  let closing: Promise<void> | undefined
  let reservations = 0
  const acquired = new Set<FileHandle>()
  const stages = new Set<PrivateFileImportStage>()
  const check = (deadline = input.deadlineUnixMs, signal?: AbortSignal) => {
    if (
      closing !== undefined ||
      !input.alive() ||
      input.signal?.aborted ||
      signal?.aborted ||
      Date.now() >= Math.min(input.deadlineUnixMs, deadline)
    )
      throw new Error('native file import caller has stopped')
    const root = fstatSync(input.backing.fd, { bigint: true })
    const destination = fstatSync(input.publicDirectory.fd, { bigint: true })
    if (
      root.dev !== backing.dev ||
      root.ino !== backing.ino ||
      destination.dev !== publicDirectory.dev ||
      destination.ino !== publicDirectory.ino ||
      mount(input.backing.fd) !== originalMount ||
      mount(input.publicDirectory.fd) !== originalMount
    )
      throw new Error('native file import original directories changed')
  }
  const target = createPrivateFileImportTarget({
    stage(request) {
      const allocate = async (): Promise<PrivateFileImportStage> => {
        const directory = privateAttachmentName(request.directory)
        if (
          !Number.isSafeInteger(request.deadlineUnixMs) ||
          request.deadlineUnixMs < 0 ||
          typeof request.operationId !== 'string' ||
          request.operationId.length === 0 ||
          request.operationId.length > 256
        )
          throw new TypeError('invalid native file import request')
        check(request.deadlineUnixMs, request.signal)
        if (reservations >= 2) throw new Error('native file import staging capacity is occupied')
        try {
          lstatSync(`/proc/self/fd/${input.publicDirectory.fd}/${directory}`)
          throw new Error('native file import destination is occupied')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        const name = `import-${randomBytes(12).toString('hex')}`
        const location = privateChildLocation(input.backing, name)
        reservations++
        let created = false
        let owned: FileHandle | undefined
        let retained: PrivateFileImportStage | undefined
        let nativeAttempted = false
        const cancel = () => input.owner.cancel(name)
        try {
          await mkdirPrivateFile(location)
          created = true
          owned = await openPrivateFile(location, DIRECTORY)
          acquired.add(owned)
          const reader = owned
          const identity = await reader.stat({ bigint: true })
          if (
            !identity.isDirectory() ||
            identity.dev !== backing.dev ||
            mount(reader.fd) !== originalMount
          )
            throw new Error('native import stage escaped original backing')
          nativeAttempted = true
          const begun = await input.owner.begin({
            name,
            directory,
            operationId: request.operationId,
            deadlineUnixMs: request.deadlineUnixMs,
            device: identity.dev.toString(),
            inode: identity.ino.toString(),
          })
          if (begun === 'absent')
            throw new Error('native import destination or caller is unavailable')
          let committed = false
          let commitAttempted = false
          let pendingCommit: Promise<'committed' | 'absent'> | undefined
          let close: Promise<void> | undefined
          const stage: PrivateFileImportStage = {
            directory: reader,
            commit() {
              if (commitAttempted || close !== undefined)
                return Promise.reject(
                  new PrivateFileImportUnconfirmedError('native import commit already attempted'),
                )
              commitAttempted = true
              pendingCommit = (async () => {
                if (request.signal.aborted || input.signal?.aborted) cancel()
                const outcome = await input.owner.commit(name)
                committed = outcome === 'committed'
                return outcome
              })()
              return pendingCommit
            },
            close() {
              close ??= (async () => {
                request.signal.removeEventListener('abort', cancel)
                input.signal?.removeEventListener('abort', cancel)
                const errors: unknown[] = []
                await pendingCommit?.catch((error) => {
                  errors.push(error)
                })
                // Retirement must win before any private tree is changed. A
                // timed-out commit ACK can still have a queued native rename.
                let nativeClosed = false
                try {
                  await input.owner.end(name)
                  nativeClosed = true
                } catch (error) {
                  errors.push(error)
                }
                if (nativeClosed && !committed) {
                  try {
                    await removePrivateDeliveryStage(location, {
                      device: identity.dev,
                      inode: identity.ino,
                    })
                  } catch (error) {
                    errors.push(error)
                  }
                }
                if (nativeClosed) {
                  try {
                    await reader.close()
                    acquired.delete(reader)
                  } catch (error) {
                    errors.push(error)
                  }
                }
                if (errors.length !== 0)
                  throw new PrivateFileImportUnconfirmedError(
                    new AggregateError(errors, 'native stage close failed'),
                  )
                stages.delete(stage)
                reservations--
              })()
              return close
            },
          }
          retained = stage
          stages.add(stage)
          request.signal.addEventListener('abort', cancel, { once: true })
          input.signal?.addEventListener('abort', cancel, { once: true })
          check(request.deadlineUnixMs, request.signal)
          return stage
        } catch (error) {
          const cleanup: unknown[] = []
          if (retained !== undefined) {
            try {
              await retained.close()
            } catch (cause) {
              cleanup.push(cause)
            }
          } else {
            let nativeClosed = !nativeAttempted
            if (nativeAttempted) {
              try {
                await input.owner.end(name)
                nativeClosed = true
              } catch (cause) {
                cleanup.push(cause)
              }
            }
            if (owned !== undefined) {
              try {
                if (!nativeClosed)
                  throw new PrivateFileImportUnconfirmedError('native stage retirement is unknown')
                const identity = await owned.stat({ bigint: true })
                await removePrivateDeliveryStage(location, {
                  device: identity.dev,
                  inode: identity.ino,
                })
              } catch (cause) {
                cleanup.push(cause)
              }
              if (nativeClosed) {
                try {
                  await owned.close()
                  acquired.delete(owned)
                } catch (cause) {
                  cleanup.push(cause)
                }
              }
            } else if (created && nativeClosed) {
              try {
                await rmdirPrivateFile(location)
              } catch (cause) {
                cleanup.push(cause)
              }
            }
            if (cleanup.length === 0) reservations--
          }
          if (cleanup.length !== 0)
            throw new PrivateFileImportUnconfirmedError(
              new AggregateError([error, ...cleanup], 'native stage setup cleanup failed'),
            )
          throw error
        }
      }
      return allocate()
    },
    close() {
      closing ??= (async () => {
        for (const stage of stages) await stage.close()
        if (acquired.size !== 0)
          throw new PrivateFileImportUnconfirmedError(
            'native import readers retain uncertain closure',
          )
        try {
          await input.backing.close()
        } catch (error) {
          throw new PrivateFileImportUnconfirmedError(error)
        }
      })()
      return closing
    },
  })
  return target
}
