import { capturePrivateOutput, type PrivateCapturedOutput } from './captured-output.js'
import { privateSnapshotExecutionOutput } from './execution-output.js'
import type { PrivateMacosGuardian } from './macos-guardian-client.js'

/** Bind an output snapshot to both writer fencing and complete native cleanup. */
export function retainPrivateMacosGuardianOutput(guardian: PrivateMacosGuardian) {
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
      if (result.outputLost || result.recovered) {
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
