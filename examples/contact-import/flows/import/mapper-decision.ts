import type { ChannelBroadcast, ChannelReceiver, RunContext } from '@jigging/flow'
import { validateReportingMessage } from '@jigging/reporting'

export const mapperOperation = 'map-columns'

export interface MapperDecision {
  readonly matched: 'yes' | 'no'
  readonly choice: 'Use code to select known columns' | 'Select the Agent-proposal branch'
}

/** Project only the two bounded facts from the mapper's authored Columns view. */
export function readMapperDecision(raw: unknown): MapperDecision | undefined {
  const message = validateReportingMessage(raw)
  if (message.kind !== 'view' || message.id !== 'columns') return
  for (const section of message.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'facts') continue
      const matched = block.items.find(({ label }) => label === 'Condition matched')?.value
      const choice = block.items.find(({ label }) => label === 'Reported choice')?.value
      if (
        (matched === 'yes' || matched === 'no') &&
        (choice === 'Use code to select known columns' ||
          choice === 'Select the Agent-proposal branch')
      )
        return { matched, choice }
    }
  }
}

async function observeDecision(
  receiver: ChannelReceiver,
  publish: (decision: MapperDecision) => void,
) {
  let reported = false
  try {
    for await (const message of receiver) {
      if (reported) continue
      const decision = readMapperDecision(message)
      if (decision !== undefined) {
        publish(decision)
        reported = true
      }
    }
  } catch {
    // Optional presentation can end independently of the mapper invocation.
  }
}

export async function callMapper(
  run: Pick<RunContext, 'call' | 'channel' | 'channels' | 'signal'>,
  headers: string[],
  publish: (decision: MapperDecision) => void,
) {
  const request = {
    operationId: mapperOperation,
    slot: 'mapper',
    intent: 'Choose name, email and organization columns',
    input: { headers },
  }
  if (run.channels.progress === undefined) return run.call(request)

  let feed: ChannelBroadcast | undefined
  let receiver: ChannelReceiver
  try {
    feed = await run.channel({
      delivery: 'broadcast',
      contract: './contracts/reporting/reporting.json',
    })
    receiver = await feed.subscribe()
  } catch {
    // Fall back before dispatch when optional observation cannot connect.
    await feed?.send.close().catch(() => undefined)
    run.signal.throwIfAborted()
    return run.call(request)
  }

  const observation = observeDecision(receiver, publish)
  try {
    const result = await run.call({ ...request, channels: { progress: feed.send } })
    await observation
    return result
  } finally {
    // A failed admission can leave the receiver waiting for a writer.
    await receiver.close().catch(() => undefined)
    await observation
  }
}
