import type { FileHandle } from 'node:fs/promises'
import type { CapturedPackage } from '../package/capture.js'
import type { PrivateBunPreparationMode } from './bun-native-preparation-protocol.js'
import { capturePrivateBunPreparationOutput } from './bun-preparation-output.js'
import { capturePrivateOutput, type PrivateCapturedOutput } from './captured-output.js'
import {
  closePrivateExecutionDirectory,
  isPrivateOutputRetirementUnconfirmed,
  privateSnapshotExecutionOutput,
} from './execution-output.js'
import { privateMacosDuplicate } from './macos-descriptor-files.js'
import type { PrivateMacosGuardian } from './macos-guardian-client.js'

/** Borrow the authenticated work collector only between fencing and volume retirement. */
export function retainPrivateMacosPreparationOutput(
  guardian: PrivateMacosGuardian,
  mode: PrivateBunPreparationMode,
) {
  let captured: CapturedPackage | undefined
  let captureError: unknown
  const collected = guardian.fenced.then(async (result) => {
    let directory: FileHandle | undefined
    const failures: unknown[] = []
    try {
      if (
        result.outputFd === undefined ||
        result.outputLost ||
        result.recovered ||
        result.result?.reason !== 'payload_exit' ||
        result.result.exitCode !== 0 ||
        result.result.signal !== null
      )
        throw new Error('native preparation collection is unavailable')
      directory = await privateMacosDuplicate(result.outputFd)
      captured = await capturePrivateBunPreparationOutput(directory, mode)
    } catch (error) {
      captureError = error
      failures.push(error)
    }
    const closed = await Promise.allSettled([
      directory === undefined ? undefined : closePrivateExecutionDirectory(directory),
    ])
    if (closed[0]!.status === 'rejected') failures.push(closed[0]!.reason)
    let releaseFailed = false
    try {
      if (result.outputFd !== undefined) guardian.release()
    } catch (error) {
      releaseFailed = true
      failures.push(error)
    }
    if (
      closed[0]!.status === 'rejected' ||
      releaseFailed ||
      failures.some(isPrivateOutputRetirementUnconfirmed)
    ) {
      const disposed = await Promise.allSettled([captured?.dispose()])
      captured = undefined
      if (disposed[0]!.status === 'rejected') failures.push(disposed[0]!.reason)
      if (failures.length === 1) throw failures[0]
      throw new AggregateError(
        failures,
        'native preparation capture and collector retirement failed',
      )
    }
  })
  void collected.catch(() => undefined)
  const completion = Promise.allSettled([collected, guardian.completion]).then(async (results) => {
    const failures = results
      .filter((result) => result.status === 'rejected')
      .map((result) => (result as PromiseRejectedResult).reason)
    if (failures.length !== 0) {
      const disposed = await Promise.allSettled([captured?.dispose()])
      captured = undefined
      if (disposed[0]!.status === 'rejected') failures.push(disposed[0]!.reason)
      throw new AggregateError(failures, 'native preparation collection and cleanup failed')
    }
    return (results[1] as PromiseFulfilledResult<Awaited<typeof guardian.completion>>).value
  })
  const packageOutput = completion.then(async (result) => {
    if (
      captured === undefined ||
      result.outputLost ||
      result.recovered ||
      result.result?.reason !== 'payload_exit' ||
      result.result.exitCode !== 0 ||
      result.result.signal !== null
    ) {
      const primary = captureError ?? new Error('native preparation bytes lack successful cleanup')
      const disposed = await Promise.allSettled([captured?.dispose()])
      captured = undefined
      if (disposed[0]!.status === 'rejected')
        throw new AggregateError(
          [primary, disposed[0]!.reason],
          'native preparation refusal and retirement failed',
        )
      throw primary
    }
    return captured
  })
  void packageOutput.catch(() => undefined)
  return Object.freeze({ completion, packageOutput })
}

/** Bind an output snapshot to both writer fencing and complete native cleanup. */
export function retainPrivateMacosGuardianOutput(
  guardian: PrivateMacosGuardian,
  collection: 'output' | 'evaluation' = 'output',
) {
  let captured: PrivateCapturedOutput | undefined
  let captureError: unknown
  const collected = guardian.fenced.then(
    (result) => {
      try {
        if (result.outputFd === undefined || result.outputLost || result.recovered)
          throw new Error('native output collection is unavailable')
        captured = capturePrivateOutput(result.outputFd)
      } catch (error) {
        captureError = error
      } finally {
        if (result.outputFd !== undefined) guardian.release()
      }
    },
    (error) => {
      captureError = error
    },
  )
  const completion = Promise.allSettled([collected, guardian.completion]).then((results) => {
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason)
    if (errors.length) throw new AggregateError(errors, 'native output cleanup failed')
    return (results[1] as PromiseFulfilledResult<Awaited<typeof guardian.completion>>).value
  })
  const ready = completion.then(
    (result) => {
      // Recovery can confirm removal after an authenticated terminal while the
      // original collector is gone. Bytes already copied after fencing belong
      // to this immutable snapshot, independently of that collector's lifetime.
      const retainedAfterRecovery =
        captured !== undefined &&
        result.recovered &&
        result.result?.reason === 'payload_exit' &&
        (result.result.exitCode === 0 ||
          (collection === 'evaluation' && result.result.exitCode !== null)) &&
        result.result.signal === null
      if ((result.outputLost || result.recovered) && !retainedAfterRecovery) {
        captured?.close()
        throw new Error('native output was lost during cleanup')
      }
      if (captured === undefined) throw captureError ?? new Error('native output was not captured')
      return captured
    },
    (error) => {
      captured?.close()
      throw error
    },
  )
  return Object.freeze({ output: privateSnapshotExecutionOutput(ready), completion })
}
