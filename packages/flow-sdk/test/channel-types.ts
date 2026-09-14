import type {
  ChannelBroadcast,
  ChannelEndpoint,
  ChannelOptions,
  ChannelPair,
  ChannelReceiver,
  RunContext,
} from '../src/index.js'

export async function channelTypes(run: RunContext, options: ChannelOptions): Promise<void> {
  const direct: ChannelPair = await run.channel()
  const explicit: ChannelOptions = { delivery: 'direct' }
  const selectedDirect: ChannelPair = await run.channel(explicit)
  const broadcast: ChannelBroadcast = await run.channel({ delivery: 'broadcast' })
  const receiver: ChannelReceiver = await broadcast.subscribe()
  await broadcast.send.close({ error: 'LAGGED', signal: run.signal })
  // @ts-expect-error Producer stream failure is a closed enum, not execution status.
  await direct.send.close({ error: 'UNCERTAIN' })
  const dynamic: ChannelPair | ChannelBroadcast = await run.channel(options)
  // @ts-expect-error Subscription authority is not a transferable endpoint.
  const endpoint: ChannelEndpoint = broadcast
  // @ts-expect-error Broadcast has subscriptions rather than an implicit receiver.
  broadcast.receive
  void [direct, selectedDirect, receiver, dynamic, endpoint]
}
