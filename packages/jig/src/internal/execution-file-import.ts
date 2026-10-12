import { createHash } from 'node:crypto'
import { constants, fstatSync } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { posix } from 'node:path'
import {
  inspectPrivateOutput,
  privateOutputFileChunks,
  requirePrivateCapturedOutput,
} from './captured-output.js'
import { privateDescriptorByteChunks } from './descriptor-byte-stream.js'
import { mkdirPrivateFile, openPrivateChild, privateChildLocation } from './descriptor-files.js'
import type { PrivateExecutionOutput } from './execution-output.js'
import { PRIVATE_FILE_LIMITS, privateFilePath } from './file-input.js'

export interface PrivateFileImportRequest {
  readonly directory: string
  readonly operationId: string
  readonly deadlineUnixMs: number
  readonly signal: AbortSignal
}

export interface PrivateFileImportStage {
  readonly directory: FileHandle
  commit(): Promise<'committed' | 'absent'>
  close(): Promise<void>
}

export interface PrivateFileImportTarget {
  stage(request: PrivateFileImportRequest): Promise<PrivateFileImportStage>
  close(): Promise<void>
}

const targets = new WeakSet<object>()
// Unknown retirement still owns the original native closures and any copy FDs.
const retainedTargets = new Set<PrivateFileImportTarget>()
interface StageLease {
  readonly native: PrivateFileImportStage
  readonly stop: AbortController
  readonly handles: Set<FileHandle>
  copy?: Promise<void>
  close?: Promise<void>
}
const stages = new WeakMap<object, StageLease>()

export class PrivateFileImportUnconfirmedError extends Error {
  constructor(cause: unknown) {
    super('native file transfer or cleanup could not be confirmed', { cause })
  }
}

/** Native issuers retain the actual caller directories and own commit/cleanup. */
export function createPrivateFileImportTarget(
  methods: PrivateFileImportTarget,
): PrivateFileImportTarget {
  const active = new Set<PrivateFileImportStage>()
  const preparing = new Set<Promise<PrivateFileImportStage>>()
  let closed = false
  let closing: Promise<void> | undefined
  let setupFailure: PrivateFileImportUnconfirmedError | undefined
  const target: PrivateFileImportTarget = Object.freeze({
    stage(request: PrivateFileImportRequest) {
      if (closed) return Promise.reject(new Error('native caller no longer accepts file imports'))
      const prepare = (async () => {
        const stage = await methods.stage(request)
        const lease: StageLease = { native: stage, stop: new AbortController(), handles: new Set() }
        const retained: PrivateFileImportStage = Object.freeze({
          directory: stage.directory,
          commit: () =>
            lease.close === undefined
              ? stage.commit()
              : Promise.reject(new PrivateFileImportUnconfirmedError('private stage is retiring')),
          close() {
            lease.close ??= (async () => {
              lease.stop.abort()
              const errors: unknown[] = []
              await lease.copy?.catch((cause) => {
                if (cause instanceof PrivateFileImportUnconfirmedError) errors.push(cause)
              })
              try {
                await stage.close()
              } catch (cause) {
                errors.push(cause)
              }
              if (errors.length !== 0)
                throw new PrivateFileImportUnconfirmedError(
                  new AggregateError(errors, 'private stage retirement failed'),
                )
              active.delete(retained)
            })()
            return lease.close
          },
        })
        stages.set(retained, lease)
        active.add(retained)
        if (closed) {
          await retained.close()
          throw new Error('native caller ended during file import setup')
        }
        return retained
      })()
      preparing.add(prepare)
      void prepare.then(
        () => preparing.delete(prepare),
        (cause) => {
          preparing.delete(prepare)
          if (cause instanceof PrivateFileImportUnconfirmedError) setupFailure ??= cause
        },
      )
      return prepare
    },
    close() {
      closed = true
      closing ??= (async () => {
        const prepared = await Promise.allSettled([...preparing])
        for (const result of prepared)
          if (
            result.status === 'rejected' &&
            result.reason instanceof PrivateFileImportUnconfirmedError
          )
            setupFailure ??= result.reason
        const settled = await Promise.allSettled([...active].map((stage) => stage.close()))
        const errors: unknown[] = setupFailure === undefined ? [] : [setupFailure]
        errors.push(
          ...settled.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
        )
        try {
          await methods.close()
        } catch (cause) {
          errors.push(cause)
        }
        if (errors.length !== 0)
          throw new PrivateFileImportUnconfirmedError(
            new AggregateError(errors, 'native caller file imports did not retire'),
          )
        retainedTargets.delete(target)
      })()
      return closing
    },
  })
  targets.add(target)
  retainedTargets.add(target)
  return target
}

export function requirePrivateFileImportTarget(value: unknown): PrivateFileImportTarget {
  if (value === null || typeof value !== 'object' || !targets.has(value))
    throw new TypeError('file import requires its original native caller target')
  return value as PrivateFileImportTarget
}

export function requirePrivateFileImportStage(value: unknown): PrivateFileImportStage {
  if (value === null || typeof value !== 'object' || !stages.has(value))
    throw new TypeError('file copy requires its original native private stage')
  return value as PrivateFileImportStage
}

/** Copy only fenced source bytes into the native owner's inaccessible stage. */
export function copyPrivateFileImportOutput(input: {
  readonly stage: PrivateFileImportStage
  readonly output: PrivateExecutionOutput
  readonly signal: AbortSignal
  readonly prefix: string
}): Promise<void> {
  const stage = requirePrivateFileImportStage(input.stage)
  const lease = stages.get(stage)!
  if (lease.copy !== undefined || lease.close !== undefined)
    throw new TypeError('private child output copy is single-use')
  lease.copy = copyIntoPrivateStage(input, lease.stop.signal, lease.handles)
  return lease.copy
}

async function copyIntoPrivateStage(
  input: Parameters<typeof copyPrivateFileImportOutput>[0],
  stopped: AbortSignal,
  retainedHandles: Set<FileHandle>,
): Promise<void> {
  const stage = requirePrivateFileImportStage(input.stage)
  const end = performance.now() + PRIVATE_FILE_LIMITS.deliveryMs
  const check = () => {
    input.signal.throwIfAborted()
    stopped.throwIfAborted()
    if (performance.now() >= end) throw new Error('child file copy allowance expired')
  }
  check()
  const source =
    input.output.kind === 'linux-directory'
      ? inspectPrivateOutput(input.output.directory.fd, input.signal)
      : requirePrivateCapturedOutput(await input.output.ready)
  const prefix = privateFilePath(input.prefix)
  if (
    source.files.length + source.directories.length + prefix.split('/').length >
    PRIVATE_FILE_LIMITS.entries
  )
    throw new TypeError('child output exceeds the caller entry limit')
  for (const path of [...source.directories, ...source.files.map((file) => file.path)])
    privateFilePath(`${prefix}/${path}`)

  const directories = new Map<string, FileHandle>([['', stage.directory]])
  let primary: unknown
  let failed = false
  try {
    for (const path of source.directories) {
      check()
      const parent = directories.get(posix.dirname(path) === '.' ? '' : posix.dirname(path))
      if (parent === undefined) throw new Error('child output directory has no verified parent')
      const name = posix.basename(path)
      await mkdirPrivateFile(privateChildLocation(parent, name), 0o700)
      const directory = await openPrivateChild(
        parent,
        name,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NONBLOCK,
      )
      retainedHandles.add(directory)
      directories.set(path, directory)
    }
    for (const file of source.files) {
      check()
      const parent = directories.get(
        posix.dirname(file.path) === '.' ? '' : posix.dirname(file.path),
      )
      if (parent === undefined) throw new Error('child output file has no verified parent')
      const destination = await openPrivateChild(
        parent,
        posix.basename(file.path),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NONBLOCK,
        0o600,
      )
      retainedHandles.add(destination)
      let fileFailure: unknown
      let fileFailed = false
      try {
        const chunks =
          input.output.kind === 'linux-directory'
            ? privateOutputFileChunks(input.output.directory.fd, file, check)
            : privateDescriptorByteChunks(
                (source as ReturnType<typeof requirePrivateCapturedOutput>).fd,
                file.bytes,
                file.offset,
              )
        const hash = createHash('sha256')
        let bytes = 0
        for (const chunk of chunks) {
          check()
          hash.update(chunk)
          for (let offset = 0; offset < chunk.length; ) {
            check()
            const written = await destination.write(chunk, offset, chunk.length - offset, null)
            if (written.bytesWritten === 0) throw new Error('child output copy made no progress')
            offset += written.bytesWritten
            bytes += written.bytesWritten
          }
        }
        if (bytes !== file.bytes || `sha256:${hash.digest('hex')}` !== file.digest)
          throw new Error('child output copy differs from its validated source')
        const after = fstatSync(destination.fd, { bigint: true })
        if (!after.isFile() || after.nlink !== 1n || after.size !== BigInt(file.bytes))
          throw new Error('private child output stage changed during copy')
      } catch (cause) {
        fileFailure = cause
        fileFailed = true
      }
      try {
        await destination.close()
        retainedHandles.delete(destination)
      } catch (cause) {
        throw new PrivateFileImportUnconfirmedError(
          fileFailed
            ? new AggregateError([fileFailure, cause], 'child file copy descriptor did not close')
            : cause,
        )
      }
      if (fileFailed) throw fileFailure
    }
    check()
  } catch (cause) {
    primary = cause
    failed = true
  }
  const closed = await Promise.allSettled(
    [...directories.entries()]
      .filter(([path]) => path !== '')
      .reverse()
      .map(async ([, directory]) => {
        await directory.close()
        retainedHandles.delete(directory)
      }),
  )
  const errors = closed.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []))
  if (errors.length !== 0)
    throw new PrivateFileImportUnconfirmedError(
      new AggregateError(
        failed ? [primary, ...errors] : errors,
        'child file copy descriptors did not close',
      ),
    )
  if (failed) throw primary
}
