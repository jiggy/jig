import type {
  Artifact,
  CallResult,
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
  const made: CallResult = await run.call({
    operationId: 'p1',
    slot: 'producer',
    input: null,
    attachments: { files: { create: true } },
  })
  const artifact: Artifact = made.artifacts!.files!
  await run.call({
    operationId: 'e1',
    slot: 'reader',
    input: null,
    attachments: { candidate: { read: artifact } },
  })
  await run.release({ operationId: 'release:1', artifact })
  // @ts-expect-error A reference spelling cannot manufacture a held artifact.
  const forged: Artifact = { reference: 'artifact:1' }
  void forged
}
