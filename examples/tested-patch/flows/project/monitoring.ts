import {
  type ChannelPair,
  type ChannelReceiver,
  type JsonValue,
  OperationError,
  type RunContext,
  type RunResult,
} from '@jigging/flow'

export const phaseSchema = {
  type: 'object',
  properties: {
    phase: { type: 'string', enum: ['baseline', 'proposal', 'check', 'finished'] },
    attempt: { type: 'integer', minimum: 0, maximum: 2 },
  },
  required: ['phase', 'attempt'],
  additionalProperties: false,
} as const
export const displaySchema = { type: 'string', maxLength: 256 } as const

// These settled, local failures may lose optional presentation, not the patch.
// Transport loss, uncertain ownership and root cancellation remain fatal.
function optionalFailure(error: unknown): boolean {
  return (
    error instanceof OperationError &&
    [
      'LAGGED',
      'DISCONNECTED',
      'RESOURCE_EXHAUSTED',
      'INVALID_INPUT',
      'INVALID_RESULT',
      'UNAVAILABLE',
      'EXECUTION_FAILED',
      'PERMISSION_DENIED',
      'CANCELLED',
      'DEADLINE_EXCEEDED',
    ].includes(error.code)
  )
}

/** A bounded application trace, not command evidence or durable channel storage. */
export async function recordPhases(receiver: ChannelReceiver, signal: AbortSignal) {
  const trace = {
    complete: true,
    startSequence: receiver.startSequence,
    records: [] as JsonValue[],
  }
  const recover = (error: unknown) => {
    signal.throwIfAborted()
    if (!optionalFailure(error)) throw error
    trace.complete = false
  }
  try {
    for await (const value of receiver) {
      signal.throwIfAborted()
      const record = value as { phase?: unknown; attempt?: unknown } | null
      if (
        trace.records.length === 6 ||
        !record ||
        Object.keys(record).sort().join(',') !== 'attempt,phase' ||
        typeof record.phase !== 'string' ||
        !['baseline', 'proposal', 'check', 'finished'].includes(record.phase) ||
        !Number.isInteger(record.attempt) ||
        (record.attempt as number) < 0 ||
        (record.attempt as number) > 2
      )
        throw new OperationError('INVALID_RESULT', 'The repair phase trace exceeded its contract.')
      trace.records.push({ phase: record.phase, attempt: record.attempt as number })
    }
  } catch (error) {
    recover(error)
  } finally {
    try {
      await receiver.close()
    } catch (error) {
      recover(error)
    }
  }
  return trace
}

export async function monitoredRepair(
  run: Pick<RunContext, 'signal' | 'channels' | 'channel' | 'runChildFlow'>,
  input: JsonValue,
  retain: (result: RunResult) => Promise<void>,
): Promise<RunResult> {
  const output = run.channels.progress
  if (output && output.direction !== 'send') throw new TypeError('progress must be a send channel.')
  const repairStop = new AbortController(),
    monitorStop = new AbortController()
  const stop = () => {
    repairStop.abort()
    monitorStop.abort()
  }
  run.signal.throwIfAborted()
  run.signal.addEventListener('abort', stop, { once: true })
  const progress = { complete: true, displayed: 0 }
  let monitorFeed: ChannelReceiver | undefined,
    recordingFeed: ChannelReceiver | undefined,
    display: ChannelPair | undefined
  let tasks: Promise<unknown>[] = []
  const dispose = async (receiver: ChannelReceiver, offered = false) => {
    try {
      await receiver.close()
    } catch (error) {
      // Admission, not the eventual child result, decides whether this right moved.
      if (offered && error instanceof OperationError && error.code === 'PERMISSION_DENIED') return
      run.signal.throwIfAborted()
      if (!optionalFailure(error)) throw error
      progress.complete = false
    }
  }
  const guarded = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action()
    } catch (error) {
      stop()
      // A rejected repair may never have received its writer. Child cancellation
      // cannot end the root's independently owned subscription in that case.
      if (recordingFeed) await dispose(recordingFeed)
      throw error
    }
  }
  try {
    const phases = await run.channel({ delivery: 'broadcast', schema: phaseSchema })
    // Subscribe before dispatch: each consumer receives the complete interval,
    // with independent capacity and disposal, within the existing two-child limit.
    monitorFeed = await phases.subscribe()
    recordingFeed = await phases.subscribe()
    display = await run.channel({ schema: displaySchema })
    const phaseReceiver = monitorFeed,
      displayPair = display
    const recording = guarded(() => recordPhases(recordingFeed!, run.signal))
    const monitoring = guarded(async () => {
      try {
        const result = await run.runChildFlow(
          {
            operationId: 'monitor',
            slot: 'monitor',
            input: {},
            channels: { phases: phaseReceiver, display: displayPair.send },
          },
          { signal: monitorStop.signal },
        )
        if (result.outcome !== 'done') progress.complete = false
      } catch (error) {
        await dispose(displayPair.receive)
        run.signal.throwIfAborted()
        if (!optionalFailure(error)) throw error
        progress.complete = false
      } finally {
        // If admission failed, no producer can finish this reader. After a
        // successful call, keep draining its sealed interval instead.
        await dispose(phaseReceiver, true)
      }
    })
    const execution = guarded(async () => {
      const result = await run.runChildFlow(
        {
          operationId: 'repair',
          slot: 'repair',
          input,
          channels: { progress: phases.send },
        },
        { signal: repairStop.signal },
      )
      run.signal.throwIfAborted()
      // Check and retain actual evidence as soon as repair settles, even if
      // the optional monitor is still displaying its last records.
      await retain(result)
      const reported = (result.output as Record<string, JsonValue>).progress
      if (
        reported !== null &&
        typeof reported === 'object' &&
        !Array.isArray(reported) &&
        (reported as Record<string, JsonValue>).complete === false
      )
        progress.complete = false
      return result
    })
    const presentation = guarded(async () => {
      let destinationAvailable = true
      try {
        for await (const value of displayPair.receive) {
          run.signal.throwIfAborted()
          if (typeof value !== 'string' || Array.from(value).length > 256)
            throw new OperationError('INVALID_RESULT', 'The monitor returned invalid display text.')
          if (!destinationAvailable) continue
          try {
            if (output) await output.send(value)
            else console.log(value)
            progress.displayed++
          } catch (error) {
            run.signal.throwIfAborted()
            if (!optionalFailure(error)) throw error
            progress.complete = false
            destinationAvailable = false
          }
        }
      } catch (error) {
        run.signal.throwIfAborted()
        if (!optionalFailure(error)) throw error
        progress.complete = false
      } finally {
        await dispose(displayPair.receive)
      }
    })
    tasks = [execution, monitoring, presentation, recording]
    const results = await Promise.allSettled(tasks)
    run.signal.throwIfAborted()
    for (const result of results) if (result.status === 'rejected') throw result.reason
    const result = (results[0] as PromiseFulfilledResult<RunResult>).value
    const trace = (results[3] as PromiseFulfilledResult<Awaited<ReturnType<typeof recordPhases>>>)
      .value
    const reported = (result.output as Record<string, JsonValue>).progress
    if (
      reported &&
      typeof reported === 'object' &&
      !Array.isArray(reported) &&
      reported.complete === false
    )
      trace.complete = false
    return {
      ...result,
      output: {
        ...(result.output as Record<string, JsonValue>),
        monitoring: progress,
        recording: trace,
      },
    }
  } finally {
    stop()
    await Promise.allSettled(tasks)
    run.signal.removeEventListener('abort', stop)
    if (monitorFeed) await dispose(monitorFeed, true)
    if (recordingFeed) await dispose(recordingFeed)
    if (display) await dispose(display.receive)
  }
}
