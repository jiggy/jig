import { OperationError, type RunContext, type RunResult } from '@jigging/flow'

type Reading = { sample: string; celsius: number }
class RequestProblem extends Error {
  constructor(readonly problem: string) {
    super(problem)
  }
}

export async function readDataset(
  run: Pick<RunContext, 'input' | 'channels' | 'signal'>,
): Promise<RunResult> {
  const input = run.input as { samples?: unknown } | null
  if (
    !input ||
    Object.keys(input).join(',') !== 'samples' ||
    !Array.isArray(input.samples) ||
    input.samples.length < 1 ||
    input.samples.length > 128
  )
    throw new TypeError('Supply 1–128 sample readings.')
  const samples = new Map<string, number>()
  for (const value of input.samples as Reading[]) {
    if (
      !value ||
      Object.keys(value).sort().join(',') !== 'celsius,sample' ||
      typeof value.sample !== 'string' ||
      !/^[A-Za-z0-9_-]{1,32}$/.test(value.sample) ||
      typeof value.celsius !== 'number' ||
      !Number.isFinite(value.celsius) ||
      (Number.isInteger(value.celsius) && !Number.isSafeInteger(value.celsius)) ||
      samples.has(value.sample)
    )
      throw new TypeError(
        'Sample identifiers must be unique and readings must be finite JSON/1 numbers.',
      )
    samples.set(value.sample, value.celsius)
  }
  const requests = run.channels.requests,
    replies = run.channels.replies
  if (requests?.direction !== 'receive' || replies?.direction !== 'send')
    throw new TypeError('The dataset needs request input and reply output channels.')
  const served: string[] = []
  let problem: string | undefined, fatal: unknown
  const failed = (error: unknown) => {
    if (error instanceof RequestProblem) problem ??= error.problem
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
    for await (const request of requests) {
      run.signal.throwIfAborted()
      const value = request as { sample?: unknown } | null
      if (!value || Object.keys(value).join(',') !== 'sample' || typeof value.sample !== 'string')
        throw new RequestProblem('invalid-request')
      const sample = value.sample
      if (!samples.has(sample)) throw new RequestProblem('unknown-sample')
      if (served.includes(sample)) throw new RequestProblem('duplicate-request')
      if (served.length === 8) throw new RequestProblem('request-limit')
      await replies.send({ sample, celsius: samples.get(sample)! })
      served.push(sample)
    }
  } catch (error) {
    failed(error)
  } finally {
    for (const endpoint of [replies, requests]) {
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
    ? { outcome: 'blocked', output: { served, problem } }
    : { outcome: 'done', output: { served } }
}
