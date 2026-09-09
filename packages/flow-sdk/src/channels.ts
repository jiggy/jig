import { decodeJson, encodeJson } from './json.js'
import {
  parseChannelGrant,
  requireExactKeys,
  requireLocalName,
  requireObject,
  requireWireId,
  type ChannelGrant,
} from './protocol.js'
import {
  OperationError,
  OPERATION_ERROR_CODES,
  type CallOptions,
  type ChannelBroadcast,
  type ChannelEndpoint,
  type ChannelOptions,
  type ChannelPair,
  type ChannelReceiver,
  type ChannelSender,
  type JsonObject,
  type JsonValue,
} from './types.js'

export type ChannelMethod =
  | 'channel/create'
  | 'channel/subscribe'
  | 'channel/send'
  | 'channel/next'
  | 'channel/close'
  | 'channel/release'
export type Settlement = { readonly result: JsonValue } | { readonly error: unknown }
export interface RequestHooks {
  readonly control?: boolean
  readonly settled?: (settlement: Settlement, exposed: boolean, fromWire: boolean) => void
  readonly cancelled?: () => void
}
type Request = (
  method: ChannelMethod,
  params: JsonObject,
  options?: CallOptions,
  hooks?: RequestHooks,
) => Promise<JsonValue>

interface EndpointState {
  readonly grant: ChannelGrant
  readonly endpoint: ChannelEndpoint
  pair?: EndpointState
  used: boolean
  connected: boolean
  offered: boolean
  closed: boolean
  iterator: boolean
  sends: number
  lastSequence: number
  endSequence?: number
  releasedEndSequence?: number
  read?: Promise<void>
  seal?: Promise<void>
  disposal?: Promise<void>
  cause?: unknown
  exposed: boolean
}

/** Process-local endpoint bookkeeping; the host alone commits transfer rights. */
export class Channels {
  private readonly states = new Map<string, EndpointState>()
  private readonly sources = new Set<string>()
  private readonly brands = new WeakMap<ChannelEndpoint, EndpointState>()
  private readonly background = new Set<Promise<unknown>>()
  private allocationCleanupFailed = false

  constructor(private readonly request: Request) {}

  get size(): number {
    return this.states.size
  }

  incoming(
    grants: Readonly<Record<string, ChannelGrant>>,
  ): Readonly<Record<string, ChannelEndpoint>> {
    const result: Record<string, ChannelEndpoint> = Object.create(null)
    for (const [name, grant] of Object.entries(grants)) {
      const state = this.register(grant)
      // Inherited receivers are connected even before their first read.
      state.connected = grant.direction === 'receive'
      result[name] = state.endpoint
    }
    return Object.freeze(result)
  }

  mappings(value: Readonly<Record<string, ChannelEndpoint>> | undefined): JsonObject | undefined {
    if (value === undefined) return undefined
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError('channels must be a map')
    if (Object.keys(value).length > 256) throw new TypeError('too many channel mappings')
    const result: Record<string, JsonValue> = Object.create(null)
    const states: EndpointState[] = []
    for (const [name, endpoint] of Object.entries(value)) {
      requireLocalName(name)
      const state = this.brands.get(endpoint)
      if (!state || state.used || state.closed)
        throw new TypeError('channels require owned unused endpoints')
      if (states.includes(state)) throw new TypeError('one endpoint cannot fill multiple channels')
      states.push(state)
      result[name] = state.grant.endpoint
    }
    // Offered does not mean moved. Rejected admission leaves rights at the host;
    // joins and explicit later endpoint operations remain host-authoritative.
    for (const state of states) state.offered = true
    return result
  }

  create(
    options: ChannelOptions & { readonly delivery: 'broadcast' },
    callOptions?: CallOptions,
  ): Promise<ChannelBroadcast>
  create(
    options?: ChannelOptions & { readonly delivery?: 'direct' },
    callOptions?: CallOptions,
  ): Promise<ChannelPair>
  create(
    options: ChannelOptions,
    callOptions?: CallOptions,
  ): Promise<ChannelPair | ChannelBroadcast>
  async create(
    options: ChannelOptions = {},
    callOptions?: CallOptions,
  ): Promise<ChannelPair | ChannelBroadcast> {
    if (options === null || typeof options !== 'object' || Array.isArray(options))
      throw new TypeError('channel options must be an object')
    const params = decodeJson(encodeJson(options as unknown as JsonValue)) as JsonObject
    if (Object.keys(params).some((key) => !['delivery', 'schema', 'contract'].includes(key)))
      throw new TypeError('unknown channel option')
    if (
      params.delivery !== undefined &&
      params.delivery !== 'direct' &&
      params.delivery !== 'broadcast'
    )
      throw new TypeError('unsupported channel delivery')
    if (Object.hasOwn(params, 'schema') && Object.hasOwn(params, 'contract'))
      throw new TypeError('schema and contract are exclusive')
    if (
      params.contract !== undefined &&
      (typeof params.contract !== 'string' || !params.contract.startsWith('./'))
    )
      throw new TypeError('contract must be package-local')
    let channel: ChannelPair | ChannelBroadcast | undefined
    await this.request('channel/create', params, callOptions, {
      settled: (settlement, exposed) => {
        if ('error' in settlement) return
        const raw = requireObject(settlement.result, 'channel/create result')
        if (params.delivery === 'broadcast') {
          requireExactKeys(raw, ['send', 'source'])
          const sendGrant = parseChannelGrant(raw.send as JsonValue)
          const source = requireWireId(raw.source as JsonValue)
          if (sendGrant.direction !== 'send' || sendGrant.delivery !== 'broadcast')
            throw new Error('invalid broadcast writer')
          if (this.sources.has(source)) throw new Error('host reused channel source')
          this.sources.add(source)
          const sender = this.register(sendGrant)
          channel = Object.freeze({
            send: sender.endpoint as ChannelSender,
            subscribe: (options?: CallOptions) => this.subscribe(source, sendGrant, options),
          })
          // This writer was never exposed or offered: explicit allocation
          // cleanup is safe, unlike guessing who holds an offered endpoint.
          if (!exposed) this.cleanupAllocation(this.seal(sender))
          return
        }
        requireExactKeys(raw, ['send', 'receive'])
        const sendGrant = parseChannelGrant(raw.send as JsonValue)
        const receiveGrant = parseChannelGrant(raw.receive as JsonValue)
        if (
          sendGrant.direction !== 'send' ||
          receiveGrant.direction !== 'receive' ||
          sendGrant.delivery !== 'direct' ||
          receiveGrant.delivery !== 'direct' ||
          sendGrant.endpoint === receiveGrant.endpoint
        )
          throw new Error('invalid channel pair')
        if (JSON.stringify(sendGrant.contract) !== JSON.stringify(receiveGrant.contract))
          throw new Error('channel pair contract mismatch')
        const sender = this.register(sendGrant)
        const receiver = this.register(receiveGrant)
        sender.pair = receiver
        receiver.pair = sender
        channel = Object.freeze({
          send: sender.endpoint as ChannelSender,
          receive: receiver.endpoint as ChannelReceiver,
        })
        if (!exposed) this.cleanupAllocation(this.dispose(receiver))
      },
    })
    if (!channel) throw new Error('channel allocation did not return endpoints')
    return channel
  }

  private async subscribe(
    source: string,
    writer: ChannelGrant,
    options?: CallOptions,
  ): Promise<ChannelReceiver> {
    let receiver: ChannelReceiver | undefined
    await this.request('channel/subscribe', { source }, options, {
      settled: (settlement, exposed) => {
        if ('error' in settlement) return
        const grant = parseChannelGrant(settlement.result)
        if (grant.direction !== 'receive' || grant.delivery !== 'broadcast')
          throw new Error('invalid broadcast subscription')
        if (JSON.stringify(grant.contract) !== JSON.stringify(writer.contract))
          throw new Error('broadcast subscription contract mismatch')
        const state = this.register(grant)
        // Allocation commits a live subscription even before its first read.
        state.connected = true
        receiver = state.endpoint as ChannelReceiver
        if (!exposed) this.cleanupAllocation(this.dispose(state))
      },
    })
    if (!receiver) throw new Error('subscription allocation did not return a receiver')
    return receiver
  }

  abandoned(): string | undefined {
    for (const state of this.states.values()) {
      if (
        state.grant.direction === 'receive' &&
        !state.offered &&
        !state.closed &&
        !state.disposal &&
        (state.connected || state.used || state.pair?.used || state.pair?.offered)
      )
        return state.grant.endpoint
    }
    return undefined
  }

  async settle(): Promise<void> {
    while (this.background.size) await Promise.allSettled([...this.background])
  }

  async finish(): Promise<void> {
    // Host terminal processing owns offered rights. Never close a token merely
    // because the associated invocation returned success or failure.
    for (const state of this.states.values()) {
      if (state.offered) continue
      if (state.grant.direction === 'receive' && !state.closed) this.track(this.dispose(state))
    }
    await this.settle()
    for (const state of this.states.values()) {
      if (state.grant.direction === 'receive' && !state.offered && state.disposal && !state.closed)
        throw new OperationError('UNCERTAIN', 'channel receiver disposal did not settle')
    }
    if (this.allocationCleanupFailed)
      throw new OperationError('UNCERTAIN', 'cancelled channel allocation cleanup failed')
    // Implicit writer completion belongs to the host's authoritative terminal
    // decision. A caught send error does not reveal whether the source failed.
    // Only an explicit author close issues channel/close from this SDK.
  }

  private register(grant: ChannelGrant): EndpointState {
    if (this.states.has(grant.endpoint)) throw new Error('host reused channel endpoint')
    // A bounded protocol map is the SDK ceiling; hosts may impose lower caps.
    if (this.states.size >= 512) throw new Error('host exceeded endpoint bookkeeping capacity')
    let state: EndpointState
    const common = {
      direction: grant.direction,
      delivery: grant.delivery,
      ...(grant.contract ? { contract: grant.contract } : {}),
    }
    const endpoint: ChannelEndpoint =
      grant.direction === 'send'
        ? Object.freeze({
            ...common,
            direction: 'send' as const,
            send: (value: JsonValue, options?: CallOptions) =>
              this.sendValue(state, value, options),
            close: async (options?: CallOptions) => {
              this.checkSignal(options)
              await this.wait(this.seal(state), options)
            },
          })
        : Object.freeze({
            ...common,
            direction: 'receive' as const,
            startSequence: grant.startSequence!,
            next: (options?: CallOptions) => this.next(state, options),
            close: (options?: CallOptions) => this.closeReceiver(state, options),
            return: async () => {
              await this.closeReceiver(state)
              return { done: true as const, value: undefined }
            },
            [Symbol.asyncIterator]: () => {
              if (state.iterator) throw new TypeError('channel receiver has one iterator')
              state.iterator = true
              state.used = true
              return endpoint as ChannelReceiver
            },
          })
    state = {
      grant,
      endpoint,
      used: false,
      connected: false,
      offered: false,
      closed: false,
      iterator: false,
      sends: 0,
      lastSequence: (grant.startSequence ?? 1) - 1,
      exposed: false,
    }
    this.states.set(grant.endpoint, state)
    this.brands.set(endpoint, state)
    return state
  }

  private async sendValue(
    state: EndpointState,
    value: JsonValue,
    options?: CallOptions,
  ): Promise<void> {
    if (state.closed || state.seal)
      throw new OperationError('DISCONNECTED', 'channel writer is closed')
    const params = decodeJson(encodeJson({ endpoint: state.grant.endpoint, value })) as JsonObject
    state.used = true
    state.sends += 1
    await this.request('channel/send', params, options, {
      settled: (settlement) => {
        state.sends -= 1
        if ('result' in settlement && settlement.result !== null)
          throw new Error('invalid channel/send result')
      },
    })
  }

  private seal(state: EndpointState): Promise<void> {
    if (state.seal) return state.seal
    if (state.closed) return Promise.resolve()
    if (state.sends)
      return Promise.reject(
        new OperationError('INVALID_INPUT', 'channel writer has unaccepted sends'),
      )
    state.used = true
    const promise = this.request('channel/close', { endpoint: state.grant.endpoint }, undefined, {
      control: true,
      settled: (settlement) => {
        if ('result' in settlement) {
          if (settlement.result !== null) throw new Error('invalid channel/close result')
          state.closed = true
        }
      },
    }).then(() => undefined)
    state.seal = promise
    this.track(promise)
    return promise
  }

  private async next(
    state: EndpointState,
    options?: CallOptions,
  ): Promise<IteratorResult<JsonValue>> {
    this.checkSignal(options)
    if (state.read)
      throw new OperationError('INVALID_INPUT', 'channel receiver already has a pending read')
    if (state.cause !== undefined) {
      state.exposed = true
      throw state.cause
    }
    if (state.closed || state.disposal) return { done: true, value: undefined }
    state.used = true
    let resolveRead!: () => void
    state.read = new Promise<void>((resolve) => {
      resolveRead = resolve
    })
    let item: IteratorResult<JsonValue> | undefined
    const promise = this.request('channel/next', { endpoint: state.grant.endpoint }, options, {
      cancelled: () => {
        this.track(this.dispose(state))
      },
      settled: (settlement, exposed, fromWire) => {
        try {
          if ('error' in settlement) {
            if (!fromWire) return
            if (
              !(
                settlement.error instanceof OperationError &&
                settlement.error.code === 'CANCELLED' &&
                state.disposal
              )
            ) {
              state.cause ??= settlement.error
              state.closed = true
              if (exposed) state.exposed = true
            }
            return
          }
          const result = requireObject(settlement.result, 'channel/next result')
          if (Object.hasOwn(result, 'item')) {
            requireExactKeys(result, ['item'])
            const data = requireObject(result.item as JsonValue, 'channel item')
            requireExactKeys(data, ['sequence', 'value'])
            if (data.sequence !== state.lastSequence + 1)
              throw new Error('non-contiguous channel sequence')
            if (
              state.releasedEndSequence !== undefined &&
              data.sequence > state.releasedEndSequence
            )
              throw new Error('channel item exceeds the released end sequence')
            state.lastSequence += 1
            item = { done: false, value: data.value as JsonValue }
          } else {
            requireExactKeys(result, ['end'])
            const end = requireObject(result.end as JsonValue, 'channel end')
            requireExactKeys(end, ['lastSequence'])
            if (end.lastSequence !== state.lastSequence)
              throw new Error('invalid channel end sequence')
            if (
              state.releasedEndSequence !== undefined &&
              state.releasedEndSequence !== state.lastSequence
            )
              throw new Error('channel release disagrees with delivered end')
            state.endSequence = state.lastSequence
            state.closed = true
            item = { done: true, value: undefined }
          }
        } finally {
          delete state.read
          resolveRead()
        }
      },
    })
    await promise
    return item!
  }

  private dispose(state: EndpointState): Promise<void> {
    if (state.disposal) return state.disposal
    const earlierRead = state.read
    state.disposal = this.request(
      'channel/release',
      { endpoint: state.grant.endpoint },
      undefined,
      {
        control: true,
        settled: (settlement) => {
          if ('error' in settlement) return
          const result = requireObject(settlement.result, 'channel/release result')
          if (result.status === 'released') requireExactKeys(result, ['status'])
          else if (result.status === 'ended') {
            requireExactKeys(result, ['status', 'lastSequence'])
            if (
              typeof result.lastSequence !== 'number' ||
              !Number.isSafeInteger(result.lastSequence) ||
              result.lastSequence < state.lastSequence
            )
              throw new Error('invalid released end sequence')
            if (state.endSequence !== undefined && result.lastSequence !== state.endSequence)
              throw new Error('channel release disagrees with delivered end')
            state.releasedEndSequence = result.lastSequence
          } else if (result.status === 'failed') {
            requireExactKeys(result, [
              'status',
              'code',
              ...(Object.hasOwn(result, 'details') ? ['details'] : []),
            ])
            if (
              typeof result.code !== 'string' ||
              !OPERATION_ERROR_CODES.some(
                (code) =>
                  code === result.code && code !== 'CHANNEL_LOST' && code !== 'PROTOCOL_ERROR',
              )
            )
              throw new Error('invalid released channel failure')
            state.cause ??= new OperationError(
              result.code as OperationError['code'],
              'channel delivery failed during disposal',
              result.details,
            )
          } else throw new Error('invalid channel release status')
          state.closed = true
        },
      },
    ).then(async () => {
      await earlierRead
    })
    this.track(state.disposal)
    return state.disposal
  }

  private async closeReceiver(state: EndpointState, options?: CallOptions): Promise<void> {
    this.checkSignal(options)
    await this.wait(this.dispose(state), options)
    if (state.cause !== undefined && !state.exposed) {
      state.exposed = true
      throw state.cause
    }
  }

  private wait<T>(promise: Promise<T>, options?: CallOptions): Promise<T> {
    const signal = options?.signal
    if (!signal) return promise
    if (signal.aborted)
      return Promise.reject(new OperationError('CANCELLED', 'operation wait was cancelled'))
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener('abort', abort)
        reject(new OperationError('CANCELLED', 'operation wait was cancelled'))
      }
      signal.addEventListener('abort', abort, { once: true })
      promise.then(
        (value) => {
          signal.removeEventListener('abort', abort)
          resolve(value)
        },
        (error) => {
          signal.removeEventListener('abort', abort)
          reject(error)
        },
      )
    })
  }

  private track<T>(promise: Promise<T>): void {
    this.background.add(promise)
    void promise.finally(() => this.background.delete(promise)).catch(() => undefined)
  }

  private checkSignal(options?: CallOptions): void {
    if (options?.signal?.aborted)
      throw new OperationError('CANCELLED', 'operation wait was cancelled')
  }

  private cleanupAllocation(promise: Promise<void>): void {
    this.track(
      promise.catch(() => {
        this.allocationCleanupFailed = true
      }),
    )
  }
}
