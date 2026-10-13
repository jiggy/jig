import { closeSync, constants, fstatSync } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { privateChildLocation } from './descriptor-files.js'
import {
  createPrivateFileImportTarget,
  type PrivateFileImportRequest,
  type PrivateFileImportStage,
  type PrivateFileImportTarget,
  PrivateFileImportUnconfirmedError,
} from './execution-file-import.js'
import { removePrivateDeliveryStage } from './file-delivery-storage.js'
import { privateAttachmentName } from './file-input-policy.js'
import {
  privateMacosDuplicate,
  privateMacosFilesystem,
  privateMacosMkdirAt,
  privateMacosOpenAt,
  privateMacosOpenFdAt,
  privateMacosRenameAt,
  privateMacosStatAt,
} from './macos-descriptor-files.js'
import {
  type PrivateMacosReceivedDescriptors,
  requirePrivateMacosReceivedDescriptors,
} from './macos-descriptor-handoff.js'

const DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY
const MAX_ACTIVE_IMPORTS = 2
type State = 'committed' | 'absent'
type ReplyState = State | 'ready'
export type PrivateMacosImportMessage =
  | {
      readonly type: 'import-begin'
      readonly id: number
      readonly directory: string
      readonly deadlineUnixMs: number
      readonly device: string
      readonly inode: string
    }
  | { readonly type: 'import-commit' | 'import-cancel' | 'import-end'; readonly id: number }
export interface PrivateMacosImportReply {
  readonly type: 'import-result'
  readonly action: PrivateMacosImportMessage['type']
  readonly id: number
  readonly state: ReplyState
  readonly refusal: string | null
}
const stageName = (id: number) => `s-${id}`
function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}
function absent(parent: number, name: string): boolean {
  try {
    privateMacosStatAt(parent, name)
    return false
  } catch (error) {
    if (!missing(error)) throw error
    return true
  }
}
function requireMessage(value: unknown): PrivateMacosImportMessage {
  const message = value as PrivateMacosImportMessage
  if (
    message === null ||
    typeof message !== 'object' ||
    !['import-begin', 'import-commit', 'import-cancel', 'import-end'].includes(message.type) ||
    !Number.isSafeInteger(message.id) ||
    message.id < 1 ||
    Object.keys(message).sort().join() !==
      (message.type === 'import-begin'
        ? 'deadlineUnixMs,device,directory,id,inode,type'
        : 'id,type')
  )
    throw new TypeError('invalid macOS file import message')
  if (message.type === 'import-begin') {
    privateAttachmentName(message.directory)
    if (
      !Number.isSafeInteger(message.deadlineUnixMs) ||
      message.deadlineUnixMs <= 0 ||
      !/^(?:0|[1-9][0-9]{0,19})$/.test(message.device) ||
      !/^[1-9][0-9]{0,19}$/.test(message.inode)
    )
      throw new TypeError('invalid macOS file import identity')
  }
  return message
}

/** Created only by the admitted guardian from its original attached volume. */
export async function preparePrivateMacosImportRoots(
  volume: FileHandle,
  deadlineUnixMs: number,
  accepts: () => boolean,
  refusal: () => string | null,
) {
  privateMacosMkdirAt(volume.fd, 'imports', 0o700)
  const imports = await privateMacosOpenAt(volume.fd, 'imports', DIRECTORY)
  let output: FileHandle
  try {
    output = await privateMacosOpenAt(volume.fd, 'output', DIRECTORY)
  } catch (error) {
    await imports.close()
    throw error
  }
  const active = new Map<
    number,
    {
      readonly message: Extract<PrivateMacosImportMessage, { type: 'import-begin' }>
      readonly hardDeadline: number
      cancelled: boolean
      committed: boolean
    }
  >()
  let closed = false
  let closing: Promise<void> | undefined
  const sameStage = (message: Extract<PrivateMacosImportMessage, { type: 'import-begin' }>) => {
    const fd = privateMacosOpenFdAt(imports.fd, stageName(message.id), DIRECTORY)
    try {
      const opened = fstatSync(fd, { bigint: true })
      const named = privateMacosStatAt(imports.fd, stageName(message.id))
      if (
        !opened.isDirectory() ||
        opened.dev !== BigInt(message.device) ||
        opened.ino !== BigInt(message.inode) ||
        named.dev !== opened.dev ||
        named.ino !== opened.ino ||
        opened.uid !== BigInt(process.getuid!()) ||
        (opened.mode & 0o777n) !== 0o700n
      )
        throw new Error('macOS private import stage changed')
    } finally {
      closeSync(fd)
    }
  }
  return Object.freeze({
    descriptors: Object.freeze([imports.fd, output.fd]),
    handle(value: unknown): PrivateMacosImportReply {
      const message = requireMessage(value)
      if (closed) throw new Error('macOS import roots are closed')
      let state: ReplyState = 'absent'
      let refused: string | null = null
      if (message.type === 'import-begin') {
        if (
          active.has(message.id) ||
          active.size >= MAX_ACTIVE_IMPORTS ||
          message.deadlineUnixMs > deadlineUnixMs
        )
          throw new Error('macOS import stage does not match its caller lifetime')
        sameStage(message)
        const remaining = Math.min(deadlineUnixMs, message.deadlineUnixMs) - Date.now()
        const hardDeadline = performance.now() + Math.max(0, remaining)
        if (accepts() && remaining > 0 && absent(output.fd, message.directory)) {
          active.set(message.id, { message, hardDeadline, cancelled: false, committed: false })
          state = 'ready'
        } else {
          refused = refusal() ?? (Date.now() >= message.deadlineUnixMs ? 'deadline' : 'destination')
        }
      } else {
        const held = active.get(message.id)
        if (held === undefined) throw new Error('macOS import stage is unavailable')
        if (message.type === 'import-cancel') held.cancelled = true
        else if (message.type === 'import-end') {
          if (!absent(imports.fd, stageName(message.id)))
            throw new Error('macOS import stage cleanup is unconfirmed')
          active.delete(message.id)
        } else if (!held.committed && !held.cancelled) {
          sameStage(held.message)
          // The actual guardian arbitrates cancellation and commit on this control loop.
          if (accepts() && performance.now() < held.hardDeadline) {
            try {
              privateMacosRenameAt(
                imports.fd,
                stageName(message.id),
                output.fd,
                held.message.directory,
                true,
              )
              held.committed = true
            } catch (error) {
              if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException)?.code ?? ''))
                throw error
            }
          }
        }
        state = held.committed ? 'committed' : 'absent'
      }
      return Object.freeze({
        type: 'import-result',
        action: message.type,
        id: message.id,
        state,
        refusal: refused,
      })
    },
    close(): Promise<void> {
      closed = true
      if (closing === undefined)
        closing = (async () => {
          const results = await Promise.allSettled([imports.close(), output.close()])
          const errors = results
            .filter((result) => result.status === 'rejected')
            .map((result) => result.reason)
          if (errors.length) throw new AggregateError(errors, 'macOS import root close failed')
        })()
      return closing
    },
  })
}

/** Original creator-directory loans arrive only through the authenticated guardian. */
export async function createPrivateMacosFileImportTarget(input: {
  readonly bundle: PrivateMacosReceivedDescriptors
  readonly deadlineUnixMs: number
  readonly request: (message: PrivateMacosImportMessage) => Promise<ReplyState>
  readonly checkLive: () => void
}): Promise<PrivateFileImportTarget> {
  const descriptors = requirePrivateMacosReceivedDescriptors(input.bundle)
  if (descriptors.length !== 2) throw new Error('macOS import root role count changed')
  const [importsFd, outputFd] = descriptors as readonly [number, number]
  const importsInfo = fstatSync(importsFd, { bigint: true })
  const outputInfo = fstatSync(outputFd, { bigint: true })
  if (
    !importsInfo.isDirectory() ||
    !outputInfo.isDirectory() ||
    importsInfo.dev !== outputInfo.dev ||
    importsInfo.ino === outputInfo.ino ||
    importsInfo.uid !== BigInt(process.getuid!()) ||
    outputInfo.uid !== importsInfo.uid ||
    (importsInfo.mode & 0o077n) !== 0n ||
    (outputInfo.mode & 0o077n) !== 0n ||
    privateMacosFilesystem(importsFd).device !== privateMacosFilesystem(outputFd).device
  )
    throw new Error('macOS import roots do not match their creator roles')
  const parent = await privateMacosDuplicate(importsFd)
  const stages = new Set<PrivateFileImportStage>()
  const allocations = new Set<Promise<PrivateFileImportStage>>()
  let counter = 0
  let reserved = 0
  let closed = false
  let closing: Promise<void> | undefined
  const check = () => {
    if (closed) throw new Error('macOS caller import target is closed')
    requirePrivateMacosReceivedDescriptors(input.bundle)
    input.checkLive()
    if (Date.now() >= input.deadlineUnixMs) throw new Error('macOS caller import deadline expired')
  }
  const allocate = async (
    request: PrivateFileImportRequest,
    releaseReservation: () => void,
  ): Promise<PrivateFileImportStage> => {
    check()
    request.signal.throwIfAborted()
    privateAttachmentName(request.directory)
    if (
      !Number.isSafeInteger(request.deadlineUnixMs) ||
      request.deadlineUnixMs > input.deadlineUnixMs ||
      request.deadlineUnixMs <= Date.now()
    )
      throw new Error('macOS child import lifetime is unavailable')
    if (!absent(outputFd, request.directory))
      throw new Error('macOS import destination is occupied')
    const id = ++counter
    let identity: ReturnType<typeof privateMacosStatAt>
    try {
      privateMacosMkdirAt(importsFd, stageName(id), 0o700)
      identity = privateMacosStatAt(importsFd, stageName(id))
    } catch (error) {
      throw new PrivateFileImportUnconfirmedError(error)
    }
    let directory: FileHandle
    try {
      directory = await privateMacosOpenAt(importsFd, stageName(id), DIRECTORY)
    } catch (error) {
      try {
        await removePrivateDeliveryStage(privateChildLocation(parent, stageName(id)), {
          device: identity.dev,
          inode: identity.ino,
        })
      } catch (cleanup) {
        throw new PrivateFileImportUnconfirmedError(new AggregateError([error, cleanup]))
      }
      throw error
    }
    let registered = false
    let commitStarted = false
    let commitState: State | undefined
    let committing: Promise<State> | undefined
    let closingStage: Promise<void> | undefined
    let cancel: Promise<ReplyState> | undefined
    const aborted = () => {
      if (registered) {
        cancel ??= input.request({ type: 'import-cancel', id })
        void cancel.catch(() => undefined)
      }
    }
    const stage: PrivateFileImportStage = Object.freeze({
      directory,
      commit(): Promise<State> {
        if (closingStage !== undefined)
          return Promise.reject(new Error('macOS import stage is closing'))
        if (committing === undefined)
          committing = (async () => {
            try {
              check()
            } catch {
              return 'absent'
            }
            if (request.signal.aborted || Date.now() >= request.deadlineUnixMs) return 'absent'
            commitStarted = true
            const state = await input.request({ type: 'import-commit', id })
            if (state !== 'committed' && state !== 'absent')
              throw new PrivateFileImportUnconfirmedError(
                new Error('invalid native import commit reply'),
              )
            commitState = state
            return state
          })()
        return committing
      },
      close(): Promise<void> {
        if (closingStage === undefined)
          closingStage = (async () => {
            const errors: unknown[] = []
            if (committing !== undefined) {
              try {
                await committing
              } catch (error) {
                errors.push(error)
              }
            }
            if (cancel !== undefined) {
              try {
                await cancel
              } catch (error) {
                errors.push(error)
              }
            }
            request.signal.removeEventListener('abort', aborted)
            try {
              await directory.close()
            } catch (error) {
              errors.push(error)
            }
            if (!commitStarted || commitState === 'absent') {
              try {
                await removePrivateDeliveryStage(privateChildLocation(parent, stageName(id)), {
                  device: identity.dev,
                  inode: identity.ino,
                })
              } catch (error) {
                errors.push(error)
              }
            }
            if (registered && errors.length === 0) {
              try {
                await input.request({ type: 'import-end', id })
              } catch (error) {
                errors.push(error)
              }
            }
            if (errors.length)
              throw new PrivateFileImportUnconfirmedError(
                new AggregateError(errors, 'macOS import stage close failed'),
              )
            stages.delete(stage)
            releaseReservation()
          })()
        return closingStage
      },
    })
    stages.add(stage)
    try {
      const state = await input.request({
        type: 'import-begin',
        id,
        directory: request.directory,
        deadlineUnixMs: request.deadlineUnixMs,
        device: String(identity.dev),
        inode: String(identity.ino),
      })
      if (state !== 'ready') throw new Error('macOS import destination or caller is unavailable')
      registered = true
      request.signal.addEventListener('abort', aborted, { once: true })
      if (request.signal.aborted) aborted()
      request.signal.throwIfAborted()
      check()
      return stage
    } catch (error) {
      try {
        await stage.close()
      } catch (cleanup) {
        throw new PrivateFileImportUnconfirmedError(
          new AggregateError([error, cleanup], 'macOS import stage allocation failed'),
        )
      }
      throw error
    }
  }
  return createPrivateFileImportTarget({
    stage(request) {
      check()
      if (reserved >= MAX_ACTIVE_IMPORTS) throw new Error('macOS caller imports are at capacity')
      reserved++
      let released = false
      const release = () => {
        if (!released) {
          released = true
          reserved--
        }
      }
      const operation = allocate(request, release).catch((error) => {
        if (!(error instanceof PrivateFileImportUnconfirmedError)) release()
        throw error
      })
      allocations.add(operation)
      void operation.finally(() => allocations.delete(operation)).catch(() => undefined)
      return operation
    },
    close(): Promise<void> {
      closed = true
      if (closing === undefined)
        closing = (async () => {
          const allocating = await Promise.allSettled([...allocations])
          const results = await Promise.allSettled([...stages].map((stage) => stage.close()))
          const errors = results
            .filter((result) => result.status === 'rejected')
            .map((result) => result.reason)
          for (const result of allocating)
            if (
              result.status === 'rejected' &&
              result.reason instanceof PrivateFileImportUnconfirmedError
            )
              errors.push(result.reason)
          try {
            await parent.close()
          } catch (error) {
            errors.push(error)
          }
          try {
            input.bundle.close()
          } catch (error) {
            errors.push(error)
          }
          if (errors.length)
            throw new PrivateFileImportUnconfirmedError(
              new AggregateError(errors, 'macOS caller import close failed'),
            )
        })()
      return closing
    },
  })
}
