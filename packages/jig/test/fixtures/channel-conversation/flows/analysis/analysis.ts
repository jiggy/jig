import { OperationError, type RunContext, type RunResult } from '@jigging/flow'

type Reading = { sample: string; celsius: number }
type Crossing = Reading & { index: number }
class ExchangeProblem extends Error {
  constructor(readonly problem: string) {
    super(problem)
  }
}

function number(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  )
}

export async function analyze(
  run: Pick<RunContext, 'input' | 'channels' | 'signal'>,
): Promise<RunResult> {
  const input = run.input as { threshold?: unknown; samples?: unknown } | null
  if (
    !input ||
    Object.keys(input).sort().join(',') !== 'samples,threshold' ||
    !number(input.threshold) ||
    !Array.isArray(input.samples) ||
    input.samples.length < 1 ||
    input.samples.length > 128 ||
    input.samples.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(id)) ||
    new Set(input.samples).size !== input.samples.length
  )
    throw new TypeError('Supply a finite threshold and 1–128 unique ordered sample identifiers.')
  const threshold = input.threshold,
    samples = input.samples as string[]
  const requests = run.channels.requests,
    replies = run.channels.replies
  if (requests?.direction !== 'send' || replies?.direction !== 'receive')
    throw new TypeError('The analysis needs request output and reply input channels.')
  const observations: Reading[] = []
  let crossing: Crossing | null = null,
    problem: string | undefined,
    fatal: unknown
  const failed = (error: unknown) => {
    if (error instanceof ExchangeProblem) problem ??= error.problem
    else if (
      error instanceof OperationError &&
      [
        'LAGGED',
        'OWNER_CLOSED',
        'DISCONNECTED',
        'RESOURCE_EXHAUSTED',
        'INVALID_INPUT',
        'INVALID_RESULT',
        'EXECUTION_FAILED',
        'CANCELLED',
        'DEADLINE_EXCEEDED',
      ].includes(error.code)
    )
      problem ??= 'exchange-failed'
    else fatal ??= error
  }
  try {
    let low = 0,
      high = samples.length
    while (low < high) {
      run.signal.throwIfAborted()
      if (observations.length === 8) throw new ExchangeProblem('request-limit')
      const index = Math.floor((low + high) / 2),
        sample = samples[index]!
      await requests.send({ sample })
      // Keep one persistent iterator: ending a temporary for-await loop would
      // dispose the receiver before the next adaptive request.
      const item = await replies.next()
      if (item.done) throw new ExchangeProblem('missing-reply')
      const value = item.value as { sample?: unknown; celsius?: unknown } | null
      if (
        !value ||
        Object.keys(value).sort().join(',') !== 'celsius,sample' ||
        typeof value.sample !== 'string' ||
        !number(value.celsius)
      )
        throw new ExchangeProblem('invalid-reply')
      if (value.sample !== sample || observations.some((old) => old.sample === sample))
        throw new ExchangeProblem('unexpected-reply')
      observations.push({ sample, celsius: value.celsius })
      if (value.celsius >= threshold) {
        high = index
        crossing = { sample, index, celsius: value.celsius }
      } else low = index + 1
    }
    // EOF ends the conversation, not either participant's execution result.
    await requests.close()
    if (!(await replies.next()).done) throw new ExchangeProblem('extra-reply')
  } catch (error) {
    failed(error)
  } finally {
    for (const endpoint of [requests, replies]) {
      try {
        await endpoint.close()
      } catch (error) {
        failed(error)
      }
    }
  }
  run.signal.throwIfAborted()
  if (fatal !== undefined) throw fatal
  return problem
    ? { outcome: 'blocked', output: { threshold, crossing: null, observations, problem } }
    : { outcome: 'done', output: { threshold, crossing, observations } }
}
