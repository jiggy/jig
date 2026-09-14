import { handle, type JsonValue, OperationError } from '../../../packages/flow-sdk/src/index'

await handle(async (run) => {
  const channel = await run.channel()
  if (run.input === 'producer-close') {
    await channel.send.send('prefix')
    await channel.send.close({ error: 'LAGGED' })
    try {
      await channel.receive.next()
    } catch (error) {
      if (!(error instanceof OperationError) || error.code !== 'LAGGED') throw error
      await channel.receive.close()
      return { outcome: 'done', output: { complete: false, cause: error.code } }
    }
    throw new Error('producer failure became clean EOF')
  }
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
