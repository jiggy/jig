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
  const dynamic: ChannelPair | ChannelBroadcast = await run.channel(options)
  // @ts-expect-error Subscription authority is not a transferable endpoint.
  const endpoint: ChannelEndpoint = broadcast
  // @ts-expect-error Broadcast has subscriptions rather than an implicit receiver.
  broadcast.receive
  void [direct, selectedDirect, receiver, dynamic, endpoint]
}
