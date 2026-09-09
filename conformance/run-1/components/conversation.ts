import {
  type ChannelReceiver,
  type ChannelSender,
  handle,
  type JsonValue,
} from '../../../packages/flow-sdk/src/index'

const sampleName = /^[A-Za-z0-9_-]{1,32}$/
const requestId = 'https://example.org/dataset-analysis/sample-request'
const replyId = 'https://example.org/dataset-analysis/sample-celsius'

function record(value: JsonValue): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('object required')
  return value
}
function name(value: JsonValue | undefined): string {
  if (typeof value !== 'string' || !sampleName.test(value)) throw new TypeError('invalid sample')
  return value
}
function reading(value: JsonValue) {
  const item = record(value)
  if (Object.keys(item).sort().join(',') !== 'celsius,sample' || typeof item.celsius !== 'number')
    throw new TypeError('invalid reading')
  return { sample: name(item.sample), celsius: item.celsius }
}
async function dispose(incoming: ChannelReceiver, outgoing: ChannelSender) {
  const settled = await Promise.allSettled([incoming.close(), outgoing.close()])
  for (const result of settled) if (result.status === 'rejected') throw result.reason
}

await handle(async (run) => {
  const input = record(run.input)
  const role = input.role
  if (role !== 'analysis' && role !== 'dataset') throw new TypeError('invalid role')
  const requests = run.channels.requests
  const replies = run.channels.replies
  if (
    !requests ||
    !replies ||
    requests.delivery !== 'direct' ||
    replies.delivery !== 'direct' ||
    requests.contract?.id !== requestId ||
    replies.contract?.id !== replyId
  )
    throw new TypeError('two named direct channels required')
  const incoming = (role === 'analysis' ? replies : requests) as ChannelReceiver
  const outgoing = (role === 'analysis' ? requests : replies) as ChannelSender
  if (
    incoming.direction !== 'receive' ||
    outgoing.direction !== 'send' ||
    incoming.startSequence !== 1
  )
    throw new TypeError('beginning receiver and sender required')
  const iterator = incoming[Symbol.asyncIterator]()
  try {
    if (!Array.isArray(input.samples) || input.samples.length < 1 || input.samples.length > 128)
      throw new TypeError('one to 128 samples required')
    if (role === 'dataset') {
      const samples = input.samples.map(reading)
      if (
        new Set(samples.map((item) => item.sample)).size !== samples.length ||
        samples.some((item, index) => index > 0 && samples[index - 1]!.celsius > item.celsius)
      )
        throw new TypeError('unique monotone samples required')
      const served: string[] = []
      while (true) {
        const next = await iterator.next()
        if (next.done) break
        const request = record(next.value)
        if (Object.keys(request).join(',') !== 'sample') throw new TypeError('invalid request')
        const sample = name(request.sample)
        const selected = samples.find((item) => item.sample === sample)
        if (!selected || served.includes(sample) || served.length === 8)
          throw new TypeError('unexpected, duplicate, or excessive request')
        served.push(sample)
        if (input.mode === 'early-eof') break
        await outgoing.send({
          sample:
            input.mode === 'unexpected'
              ? 'unknown'
              : input.mode === 'duplicate' && served.length > 1
                ? served[0]!
                : sample,
          celsius: selected.celsius,
        })
      }
      return { outcome: 'done', output: { served } }
    }
    const samples = input.samples.map(name)
    if (new Set(samples).size !== samples.length || typeof input.threshold !== 'number')
      throw new TypeError('unique sample IDs and threshold required')
    const observations: { sample: string; celsius: number }[] = []
    let lower = 0
    let upper = samples.length
    let crossing: { sample: string; index: number; celsius: number } | null = null
    while (lower < upper) {
      if (observations.length === 8) throw new Error('query budget exhausted')
      const index = Math.floor((lower + upper) / 2)
      const sample = samples[index]!
      await outgoing.send({ sample })
      const next = await iterator.next()
      if (next.done) throw new Error('reply stream ended with an outstanding request')
      const item = reading(next.value)
      if (item.sample !== sample || observations.some((old) => old.sample === item.sample))
        throw new Error('unexpected or duplicate reply')
      observations.push(item)
      if (item.celsius >= input.threshold) {
        crossing = { ...item, index }
        upper = index
      } else lower = index + 1
    }
    await outgoing.close()
    if (!(await iterator.next()).done) throw new Error('unsolicited trailing reply')
    return { outcome: 'done', output: { threshold: input.threshold, crossing, observations } }
  } finally {
    // Both held directions settle even when domain validation rejects a value.
    await dispose(incoming, outgoing)
  }
})
