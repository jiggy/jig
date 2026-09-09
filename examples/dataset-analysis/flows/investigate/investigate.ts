import {
  type ChannelEndpoint,
  type ChannelPair,
  type JsonObject,
  type JsonValue,
  OperationError,
  type RunContext,
  type RunResult,
} from '@jigging/flow'

type Reading = { sample: string; celsius: number }
type Input = { threshold: number; samples: Reading[] }
type Children = { analysis: RunResult | null; dataset: RunResult | null }

export function validateInput(value: JsonValue): Input {
  const input = value as Input | null
  const validNumber = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  if (
    !input ||
    Object.keys(input).sort().join(',') !== 'samples,threshold' ||
    !validNumber(input.threshold) ||
    !Array.isArray(input.samples) ||
    input.samples.length < 1 ||
    input.samples.length > 128
  )
    throw new TypeError('Supply a finite threshold and 1–128 ordered sample readings.')
  const seen = new Set<string>()
  let previous = Number.NEGATIVE_INFINITY
  const samples = input.samples.map((reading) => {
    if (
      !reading ||
      Object.keys(reading).sort().join(',') !== 'celsius,sample' ||
      typeof reading.sample !== 'string' ||
      !/^[A-Za-z0-9_-]{1,32}$/.test(reading.sample) ||
      !validNumber(reading.celsius) ||
      seen.has(reading.sample) ||
      reading.celsius < previous
    )
      throw new TypeError('Use unique ASCII sample identifiers and nondecreasing Celsius readings.')
    seen.add(reading.sample)
    previous = reading.celsius
    return { sample: reading.sample, celsius: reading.celsius }
  })
  return { threshold: input.threshold, samples }
}

/** The application checks original values; neither channel EOF nor a child pass flag is a verdict. */
export function verify(input: Input, children: Children): boolean {
  if (children.analysis?.outcome !== 'done' || children.dataset?.outcome !== 'done') return false
  const analysis = children.analysis.output as JsonObject | null
  const dataset = children.dataset.output as JsonObject | null
  if (
    !analysis ||
    !dataset ||
    analysis.threshold !== input.threshold ||
    !Array.isArray(analysis.observations) ||
    !Array.isArray(dataset.served)
  )
    return false
  const expected: Reading[] = []
  let low = 0,
    high = input.samples.length
  while (low < high) {
    const index = Math.floor((low + high) / 2),
      reading = input.samples[index]!
    expected.push(reading)
    if (reading.celsius >= input.threshold) high = index
    else low = index + 1
  }
  if (analysis.observations.length !== expected.length || dataset.served.length !== expected.length)
    return false
  for (let index = 0; index < expected.length; index++) {
    const actual = analysis.observations[index] as JsonObject | null,
      reading = expected[index]!
    if (
      !actual ||
      Object.keys(actual).sort().join(',') !== 'celsius,sample' ||
      actual.sample !== reading.sample ||
      actual.celsius !== reading.celsius ||
      dataset.served[index] !== reading.sample
    )
      return false
  }
  // Deliberately use a linear reference, independent of the search algorithm.
  const index = input.samples.findIndex((reading) => reading.celsius >= input.threshold)
  if (index === -1) return analysis.crossing === null
  const crossing = analysis.crossing as JsonObject | null,
    reading = input.samples[index]!
  return (
    !!crossing &&
    Object.keys(crossing).sort().join(',') === 'celsius,index,sample' &&
    crossing.index === index &&
    crossing.sample === reading.sample &&
    crossing.celsius === reading.celsius
  )
}

function recoverable(error: unknown): error is OperationError {
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
      'CONTRACT_MISMATCH',
    ].includes(error.code)
  )
}

export async function investigate(
  run: Pick<RunContext, 'input' | 'signal' | 'channel' | 'runChildFlow'>,
): Promise<RunResult> {
  run.signal.throwIfAborted()
  const input = validateInput(run.input)
  const children: Children = { analysis: null, dataset: null }
  const failures: Record<string, JsonValue> = {},
    stop = new AbortController()
  const cancel = () => stop.abort()
  const pairs: ChannelPair[] = [],
    offered = new Set<ChannelEndpoint>()
  const tasks: Promise<void>[] = []
  let fatal: unknown
  const dispose = async (endpoint: ChannelEndpoint) => {
    try {
      await endpoint.close()
    } catch (error) {
      // A transferred endpoint is no longer ours; rejected dispatch can leave it held.
      if (
        offered.has(endpoint) &&
        error instanceof OperationError &&
        error.code === 'PERMISSION_DENIED'
      )
        return
      if (!recoverable(error)) fatal ??= error
    }
  }
  const disposeHeld = () =>
    Promise.all(pairs.flatMap((pair) => [dispose(pair.send), dispose(pair.receive)]))
  run.signal.throwIfAborted()
  run.signal.addEventListener('abort', cancel, { once: true })
  try {
    const requests = await run.channel({ contract: './contracts/sample-request.json' })
    pairs.push(requests)
    const replies = await run.channel({ contract: './contracts/sample-celsius.json' })
    pairs.push(replies)
    const invoke = async (
      slot: keyof Children,
      value: JsonValue,
      channels: Record<string, ChannelEndpoint>,
    ) => {
      for (const endpoint of Object.values(channels)) offered.add(endpoint)
      try {
        children[slot] = await run.runChildFlow(
          { operationId: slot, slot, input: value, channels },
          { signal: stop.signal },
        )
        if (children[slot]?.outcome !== 'done') {
          stop.abort()
          await disposeHeld()
        }
      } catch (error) {
        if (recoverable(error)) failures[slot] = error.code
        else fatal ??= error
        // A peer might be blocked waiting for an endpoint that never moved.
        stop.abort()
        await disposeHeld()
      }
    }
    tasks.push(
      invoke(
        'dataset',
        { samples: input.samples },
        { requests: requests.receive, replies: replies.send },
      ),
    )
    tasks.push(
      invoke(
        'analysis',
        { threshold: input.threshold, samples: input.samples.map((item) => item.sample) },
        { requests: requests.send, replies: replies.receive },
      ),
    )
    await Promise.all(tasks)
  } catch (error) {
    if (recoverable(error)) failures.setup = error.code
    else fatal ??= error
  } finally {
    stop.abort()
    await disposeHeld()
    await Promise.allSettled(tasks)
    run.signal.removeEventListener('abort', cancel)
  }
  run.signal.throwIfAborted()
  if (fatal !== undefined) throw fatal
  const accepted = Object.keys(failures).length === 0 && verify(input, children)
  const analysis = children.analysis?.output as JsonObject | undefined
  return {
    outcome: accepted ? 'done' : 'blocked',
    output: {
      threshold: input.threshold,
      crossing: accepted ? analysis!.crossing! : null,
      observations: Array.isArray(analysis?.observations) ? analysis.observations : [],
      verification: { accepted },
      children,
      failures,
      reason: accepted
        ? 'The threshold-search result agrees with the original dataset and both completed participants.'
        : 'The conversation did not produce a verified threshold crossing; inspect the retained child results and failures.',
    },
  }
}
