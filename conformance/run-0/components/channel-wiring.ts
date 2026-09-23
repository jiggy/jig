import {
  type ChannelEndpoint,
  handle,
  type JsonValue,
  OperationError,
  type RunResult,
} from '../../../packages/flow-sdk/src/index'

await handle(async (run): Promise<RunResult> => {
  const input = run.input
  if (!input || typeof input !== 'object' || !('role' in input))
    throw new TypeError('role required')
  if (input.role === 'root') {
    const source = await run.channel({ contract: './updates.json' })
    let incompatible = false
    try {
      await run.call({
        operationId: 'incompatible',
        slot: 'incompatible',
        input: null,
        channels: { events: source.send },
      })
    } catch (error) {
      if (!(error instanceof OperationError) || error.code !== 'INVALID_INPUT') throw error
      incompatible = true
    }
    const work = run.call({
      operationId: 'worker',
      slot: 'worker',
      input: { role: 'worker' },
      channels: { events: source.send },
    })
    const channels: Record<string, ChannelEndpoint> = { events: source.receive }
    if (run.channels.progress) channels.progress = run.channels.progress
    const monitor = run.call({
      operationId: 'monitor',
      slot: 'monitor',
      input: { role: 'monitor', stop: input.stop === true },
      channels,
    })
    const [worked, watched] = await Promise.allSettled([work, monitor])
    if (worked.status === 'rejected') throw worked.reason
    if (watched.status === 'rejected') throw watched.reason
    return { outcome: 'done', output: { incompatible, work: worked.value, monitor: watched.value } }
  }
  if (input.role === 'worker') {
    const result = await run.call({
      operationId: 'answer',
      slot: 'agent',
      input: null,
      channels: { events: run.channels.events! },
    })
    return result
  }
  if (input.role !== 'monitor') throw new TypeError('unknown role')
  const events = run.channels.events
  if (!events || events.direction !== 'receive') throw new TypeError('events receiver required')
  const progress = run.channels.progress
  if (progress && progress.direction !== 'send') throw new TypeError('progress sender required')
  const selected: JsonValue[] = []
  let complete = true
  try {
    for await (const value of events) {
      if (!value || typeof value !== 'object' || !('text' in value)) continue
      selected.push(value.text)
      if (progress) await progress.send(value.text)
      if (input.stop === true) {
        complete = false
        break
      }
    }
  } catch (error) {
    if (!(error instanceof OperationError) || error.code !== 'LAGGED') throw error
    complete = false
  } finally {
    await events.close()
  }
  if (progress) await progress.close()
  return { outcome: 'done', output: { complete, selected } }
})
