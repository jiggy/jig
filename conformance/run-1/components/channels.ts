import { handle, type JsonValue, OperationError } from '../../../packages/flow-sdk/src/index'

await handle(async (run) => {
  const channel = await run.channel()
  const work = run.call({
    operationId: 'answer',
    slot: 'worker',
    input: run.input,
    channels: { events: channel.send },
  })
  const values: JsonValue[] = []
  let complete = true
  try {
    for await (const value of channel.receive) values.push(value)
  } catch (error) {
    if (!(error instanceof OperationError) || error.code !== 'LAGGED') {
      await Promise.allSettled([work])
      throw error
    }
    complete = false
  }
  return { outcome: 'done', output: { complete, values, work: await work } }
})
