import {
  handle,
  OperationError,
  type ChannelReceiver,
  type JsonValue,
} from '../../../packages/flow-sdk/src/index'

async function collect(receiver: ChannelReceiver) {
  const values: JsonValue[] = []
  let complete = true
  try {
    for await (const value of receiver) values.push(value)
  } catch (error) {
    if (!(error instanceof OperationError) || error.code !== 'LAGGED') throw error
    complete = false
  }
  return { start: receiver.startSequence, values, complete }
}

await handle(async (run) => {
  const source = await run.channel({ delivery: 'broadcast' })
  const early = await source.subscribe()
  await source.send.send('before-late')
  const late = await source.subscribe()
  await source.send.send('after-late')
  await source.send.close()
  const [first, second] = await Promise.all([collect(early), collect(late)])
  return { outcome: 'done', output: { early: first, late: second } }
})
