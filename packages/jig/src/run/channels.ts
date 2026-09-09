import { randomUUID } from 'node:crypto'

import { canonicalJson, decodeJson1, type JsonObject, type JsonValue } from '../json.js'
import { compileEmbeddedSchema } from '../schema/index.js'
import type { WireFailureCode } from './session.js'

const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const CHANNEL_LIMITS = Object.freeze({
  sources: 16,
  receivers: 16,
  itemBytes: 64 * 1024,
  sourceBytes: 8 * 1024 * 1024,
  bufferedItems: 16,
  bufferedBytes: 256 * 1024,
  pendingSends: 16,
  pendingBytes: 256 * 1024,
})

export interface ChannelIdentity {
  readonly id: string
  readonly version: string
  readonly digest: string
}

export interface ResolvedChannelContract {
  readonly identity: ChannelIdentity
  readonly schema: JsonValue
  validate(value: JsonValue): void
}

export interface ChannelGrant {
  readonly endpoint: string
  readonly direction: 'send' | 'receive'
  readonly delivery: 'direct' | 'broadcast'
  readonly contract?: ChannelIdentity
  readonly startSequence?: number
}

export interface ChannelDeclaration {
  readonly direction: 'send' | 'receive'
  readonly required?: boolean
  readonly delivery?: 'direct' | 'broadcast'
  readonly start?: 'beginning' | 'suffix'
  readonly schema?: JsonValue
  readonly contract?: ResolvedChannelContract
}

export interface ChannelCreationOptions {
  readonly delivery?: 'direct' | 'broadcast'
  readonly schema?: JsonValue
  readonly contract?: string
}

export interface ChannelParticipantOptions {
  readonly resolveContract?: (
    path: string,
  ) => ResolvedChannelContract | Promise<ResolvedChannelContract>
}

interface DirectAllocation {
  readonly send: ChannelGrant
  readonly receive: ChannelGrant
}

interface BroadcastAllocation {
  readonly send: ChannelGrant
  readonly source: string
}

export class ChannelOperationError extends Error {
  constructor(
    readonly code: WireFailureCode,
    message: string,
    readonly details?: JsonValue,
  ) {
    super(message)
    this.name = 'ChannelOperationError'
  }
}

interface Constraint {
  readonly schema: string | undefined
  readonly validate: (value: JsonValue) => void
}

interface Item {
  readonly sequence: number
  readonly value: JsonValue
  readonly bytes: number
}

interface PendingSend {
  readonly value: JsonValue
  readonly bytes: number
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
  dispose(): void
}

interface PendingRead {
  readonly resolve: (value: JsonValue) => void
  readonly reject: (error: unknown) => void
  dispose(): void
}

interface Endpoint {
  readonly token: string
  readonly direction: 'send' | 'receive'
  readonly source: Source
  receiver?: Receiver
  holder: ChannelParticipant
  used: boolean
  transferred: boolean
}

interface Source {
  readonly owner: ChannelParticipant
  readonly delivery: 'direct' | 'broadcast'
  readonly contract?: ChannelIdentity
  readonly constraints: Constraint[]
  readonly receivers: Receiver[]
  readonly pending: PendingSend[]
  send: Endpoint
  sealed: boolean
  sequence: number
  totalBytes: number
  failure?: ChannelOperationError
}

interface Receiver {
  readonly endpoint: Endpoint
  readonly startSequence: number
  readonly constraints: Constraint[]
  readonly queue: Item[]
  released: boolean
  ended: boolean
  bufferedBytes: number
  inFlight?: Item
  read?: PendingRead
  failure?: ChannelOperationError
}

/** Private finite root broker. Tokens have meaning only with their current participant. */
export class ChannelBroker {
  private readonly endpoints = new Map<string, Endpoint>()
  private readonly participants = new Map<string, ChannelParticipant>()
  private readonly sources: Source[] = []
  private readonly subscriptions = new Map<string, Source>()
  private receivers = 0
  private pendingSends = 0
  private pendingBytes = 0
  private failure?: ChannelOperationError

  participant(id: string, options: ChannelParticipantOptions = {}): ChannelParticipant {
    if (this.participants.has(id)) throw new TypeError('channel participant already exists')
    const participant = new ChannelParticipant(this, id, options)
    this.participants.set(id, participant)
    return participant
  }

  create(
    owner: ChannelParticipant,
    options: ChannelCreationOptions & { delivery: 'broadcast' },
  ): Promise<BroadcastAllocation>
  create(
    owner: ChannelParticipant,
    options: ChannelCreationOptions & { delivery?: 'direct' },
  ): Promise<DirectAllocation>
  create(
    owner: ChannelParticipant,
    options: ChannelCreationOptions,
  ): Promise<DirectAllocation | BroadcastAllocation>
  async create(
    owner: ChannelParticipant,
    options: ChannelCreationOptions,
  ): Promise<DirectAllocation | BroadcastAllocation> {
    this.assertOpen(owner)
    const delivery = options.delivery ?? 'direct'
    if (options.schema !== undefined && options.contract !== undefined) {
      throw new TypeError('channel schema and contract are mutually exclusive')
    }
    let contract: ResolvedChannelContract | undefined
    if (options.contract !== undefined) {
      try {
        contract = await owner.resolve(options.contract)
      } catch (error) {
        if (error instanceof ChannelOperationError) throw error
        throw new ChannelOperationError(
          'INVALID_INPUT',
          'channel contract could not be resolved from the admitted package',
        )
      }
    }
    const constraint =
      contract === undefined ? compileConstraint(options.schema) : namedConstraint(contract)
    this.assertOpen(owner)
    if (
      this.sources.length >= CHANNEL_LIMITS.sources ||
      (delivery === 'direct' && this.receivers >= CHANNEL_LIMITS.receivers)
    ) {
      throw new ChannelOperationError('RESOURCE_EXHAUSTED', 'root channel allocation limit reached')
    }
    const source = {
      owner,
      delivery,
      ...(contract === undefined ? {} : { contract: Object.freeze({ ...contract.identity }) }),
      constraints: [constraint],
      receivers: [],
      pending: [],
      sealed: false,
      sequence: 0,
      totalBytes: 0,
    } as unknown as Source
    source.send = this.endpoint(owner, source, 'send')
    this.sources.push(source)
    if (delivery === 'broadcast') {
      const reference = `source:${randomUUID()}`
      this.subscriptions.set(reference, source)
      return { send: grant(source.send), source: reference }
    }
    return { send: grant(source.send), receive: grant(this.receiver(owner, source).endpoint) }
  }

  subscribe(owner: ChannelParticipant, reference: string): ChannelGrant {
    this.assertOpen(owner)
    const source = this.subscriptions.get(reference)
    if (source === undefined || source.owner !== owner)
      throw new ChannelOperationError(
        'PERMISSION_DENIED',
        'channel subscription authority is not held by this participant',
      )
    this.assertWritable(source)
    if (this.receivers >= CHANNEL_LIMITS.receivers)
      throw new ChannelOperationError(
        'RESOURCE_EXHAUSTED',
        'root channel receiver allocation limit reached',
      )
    return grant(this.receiver(owner, source).endpoint)
  }

  transfer(
    from: ChannelParticipant,
    to: ChannelParticipant,
    references: Readonly<Record<string, string>>,
    declarations: Readonly<Record<string, ChannelDeclaration>>,
  ): Readonly<Record<string, ChannelGrant>> {
    this.assertOpen(from)
    this.assertOpen(to)
    const staged: { name: string; endpoint: Endpoint; constraint: Constraint }[] = []
    const seen = new Set<string>()
    for (const [name, declaration] of Object.entries(declarations)) {
      if (declaration.required !== false && !Object.hasOwn(references, name)) {
        throw new ChannelOperationError(
          'INVALID_INPUT',
          `required channel ${name} is not connected`,
        )
      }
    }
    for (const [name, token] of Object.entries(references)) {
      const declaration = declarations[name]
      if (!LOCAL_NAME.test(name) || declaration === undefined) {
        throw new ChannelOperationError('INVALID_INPUT', 'channel mapping names an undeclared port')
      }
      const endpoint = this.held(from, token)
      if (seen.has(token) || endpoint.used) {
        throw new ChannelOperationError(
          'PERMISSION_DENIED',
          'a channel endpoint can move only before local use',
        )
      }
      seen.add(token)
      if (endpoint.direction !== declaration.direction) {
        throw new ChannelOperationError('INVALID_INPUT', `channel ${name} has the wrong direction`)
      }
      if (declaration.delivery !== undefined && declaration.delivery !== endpoint.source.delivery) {
        throw new ChannelOperationError('INVALID_INPUT', `channel ${name} delivery differs`)
      }
      const source = endpoint.source
      const receiver = endpoint.receiver
      this.assertOpen(source.owner)
      if (
        source.failure !== undefined ||
        receiver?.released ||
        receiver?.failure !== undefined ||
        (source.sealed && endpoint.direction === 'send')
      ) {
        throw new ChannelOperationError(
          'DISCONNECTED',
          'channel is no longer available for connection',
        )
      }
      // Receiver disposal removes delivery, not the unused writer's authority.
      // A later holder receives the same DISCONNECTED send/close outcome; this
      // permits optional monitoring to stop before its producer is admitted.
      if (receiver !== undefined && declaration.start !== 'suffix' && receiver.startSequence !== 1)
        throw new ChannelOperationError(
          'INVALID_INPUT',
          `channel ${name} requires the beginning of its source`,
        )
      if (declaration.contract !== undefined && source.contract !== undefined) {
        if (!sameIdentity(declaration.contract.identity, source.contract)) {
          throw new ChannelOperationError(
            'INVALID_INPUT',
            `channel ${name} contract identity differs`,
          )
        }
      } else if (declaration.contract !== undefined && endpoint.direction === 'receive') {
        throw new ChannelOperationError('INVALID_INPUT', `channel ${name} requires a named source`)
      } else if (source.contract !== undefined && endpoint.direction === 'send') {
        throw new ChannelOperationError(
          'INVALID_INPUT',
          `channel ${name} writer must declare the source contract`,
        )
      }
      const constraint =
        declaration.contract === undefined
          ? compileConstraint(declaration.schema)
          : namedConstraint(declaration.contract)
      for (const existing of [
        ...source.constraints,
        ...(receiver?.constraints ?? []),
        ...(source.delivery === 'broadcast' && endpoint.direction === 'send'
          ? source.receivers.filter(activeReceiver).flatMap((subscriber) => subscriber.constraints)
          : []),
        ...staged
          .filter(
            (entry) =>
              entry.endpoint.source === source &&
              (source.delivery === 'direct' ||
                endpoint.direction === 'send' ||
                entry.endpoint.direction === 'send' ||
                entry.endpoint === endpoint),
          )
          .map((entry) => entry.constraint),
      ]) {
        if (
          constraint.schema !== undefined &&
          existing.schema !== undefined &&
          constraint.schema !== existing.schema
        ) {
          throw new ChannelOperationError('INVALID_INPUT', `channel ${name} schema differs`)
        }
      }
      for (const prefix of receiver === undefined ? source.receivers : [receiver]) {
        if (!activeReceiver(prefix)) continue
        for (const item of prefix.queue) validateConstraint(constraint, item.value)
        if (prefix.inFlight !== undefined) validateConstraint(constraint, prefix.inFlight.value)
      }
      staged.push({ name, endpoint, constraint })
    }
    // No rights or constraints change until all entries and their prefix validate.
    // A receiver also checks writer constraints staged later in this same map;
    // object key ordering must not change atomic admission.
    for (const entry of staged) {
      if (entry.endpoint.source.delivery !== 'broadcast' || entry.endpoint.direction !== 'receive')
        continue
      for (const writer of staged) {
        if (
          writer.endpoint.source === entry.endpoint.source &&
          writer.endpoint.direction === 'send' &&
          entry.constraint.schema !== undefined &&
          writer.constraint.schema !== undefined &&
          entry.constraint.schema !== writer.constraint.schema
        )
          throw new ChannelOperationError('INVALID_INPUT', `channel ${entry.name} schema differs`)
      }
    }
    const grants: Record<string, ChannelGrant> = Object.create(null)
    for (const entry of staged) {
      const constraints =
        entry.endpoint.source.delivery === 'broadcast' && entry.endpoint.receiver !== undefined
          ? entry.endpoint.receiver.constraints
          : entry.endpoint.source.constraints
      constraints.push(entry.constraint)
      entry.endpoint.holder = to
      entry.endpoint.transferred = true
      grants[entry.name] = grant(entry.endpoint)
    }
    return Object.freeze(grants)
  }

  async request(
    owner: ChannelParticipant,
    method: string,
    params: JsonValue | undefined,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    const object = requireObject(params)
    if (method === 'channel/create') {
      exactKeys(object, [], ['delivery', 'schema', 'contract'])
      if (
        object.delivery !== undefined &&
        object.delivery !== 'direct' &&
        object.delivery !== 'broadcast'
      )
        throw new TypeError('invalid delivery')
      if (object.contract !== undefined && typeof object.contract !== 'string')
        throw new TypeError('invalid contract reference')
      if (signal?.aborted) throw cancelled()
      const pair = await this.create(owner, object as unknown as ChannelCreationOptions)
      if (signal?.aborted) {
        if ('receive' in pair) this.release(owner, pair.receive.endpoint)
        else this.close(owner, pair.send.endpoint)
        throw cancelled()
      }
      return pair as unknown as JsonValue
    }
    if (method === 'channel/subscribe') {
      exactKeys(object, ['source'], [])
      if (typeof object.source !== 'string') throw new TypeError('invalid source reference')
      if (signal?.aborted) throw cancelled()
      return this.subscribe(owner, object.source) as unknown as JsonValue
    }
    exactKeys(object, method === 'channel/send' ? ['endpoint', 'value'] : ['endpoint'], [])
    if (typeof object.endpoint !== 'string') throw new TypeError('invalid endpoint')
    switch (method) {
      case 'channel/send':
        return this.send(owner, object.endpoint, object.value!, signal)
      case 'channel/next':
        return this.next(owner, object.endpoint, signal)
      case 'channel/close':
        this.close(owner, object.endpoint)
        return null
      case 'channel/release':
        return this.release(owner, object.endpoint)
      default:
        throw new ChannelOperationError('UNAVAILABLE', 'unsupported channel operation')
    }
  }

  async send(
    owner: ChannelParticipant,
    token: string,
    value: JsonValue,
    signal?: AbortSignal,
  ): Promise<null> {
    this.assertOpen(owner)
    const endpoint = this.held(owner, token, 'send')
    endpoint.used = true
    const source = endpoint.source
    this.assertWritable(source)
    if (signal?.aborted) throw cancelled()
    let item: JsonValue
    let bytes: number
    try {
      const encoded = canonicalJson(value)
      bytes = encoded.byteLength
      if (bytes > CHANNEL_LIMITS.itemBytes) {
        throw new ChannelOperationError('RESOURCE_EXHAUSTED', 'channel item exceeds 64 KiB')
      }
      item = decodeJson1(encoded)
      for (const constraint of source.constraints) validateConstraint(constraint, item)
      if (source.totalBytes + bytes > CHANNEL_LIMITS.sourceBytes) {
        throw new ChannelOperationError(
          'RESOURCE_EXHAUSTED',
          'channel source lifetime byte limit reached',
        )
      }
    } catch (error) {
      const failure =
        error instanceof ChannelOperationError
          ? error
          : new ChannelOperationError('INVALID_INPUT', 'channel item is not valid JSON/1')
      this.fail(source, failure)
      throw failure
    }
    if (
      source.delivery === 'broadcast' ||
      (source.pending.length === 0 && this.hasCapacity(source.receivers[0]!, bytes))
    ) {
      this.accept(source, item, bytes)
      return null
    }
    if (
      this.pendingSends >= CHANNEL_LIMITS.pendingSends ||
      this.pendingBytes + bytes > CHANNEL_LIMITS.pendingBytes
    ) {
      throw new ChannelOperationError(
        'RESOURCE_EXHAUSTED',
        'root pending channel sends reached their bounded capacity',
      )
    }
    this.pendingSends += 1
    this.pendingBytes += bytes
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const index = source.pending.indexOf(pending)
        if (index < 0) return
        source.pending.splice(index, 1)
        this.removePending(pending)
        reject(cancelled())
        this.flush(source)
      }
      const pending: PendingSend = {
        value: item,
        bytes,
        resolve,
        reject,
        dispose: () => signal?.removeEventListener('abort', onAbort),
      }
      source.pending.push(pending)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
    return null
  }

  async next(owner: ChannelParticipant, token: string, signal?: AbortSignal): Promise<JsonValue> {
    this.assertOpen(owner)
    const endpoint = this.held(owner, token, 'receive')
    endpoint.used = true
    const source = endpoint.source
    const receiver = endpoint.receiver!
    if (receiver.read !== undefined)
      throw new ChannelOperationError('INVALID_INPUT', 'channel already has a pending read')
    // A subsequent read gives back capacity for the prior committed response.
    if (receiver.inFlight !== undefined) {
      receiver.bufferedBytes -= receiver.inFlight.bytes
      delete receiver.inFlight
    }
    this.flush(source)
    if (receiver.failure !== undefined) throw receiver.failure
    if (receiver.released)
      throw new ChannelOperationError('DISCONNECTED', 'channel receiver was released')
    if (signal?.aborted) {
      this.release(owner, token)
      throw cancelled()
    }
    if (receiver.queue.length !== 0) return this.readItem(receiver)
    if (source.sealed) {
      receiver.ended = true
      return { end: { lastSequence: source.sequence } }
    }
    return new Promise<JsonValue>((resolve, reject) => {
      const onAbort = () => {
        if (receiver.read !== pending) return
        delete receiver.read
        pending.dispose()
        this.release(owner, token)
        reject(cancelled())
      }
      const pending: PendingRead = {
        resolve,
        reject,
        dispose: () => signal?.removeEventListener('abort', onAbort),
      }
      receiver.read = pending
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
  }

  close(owner: ChannelParticipant, token: string): void {
    this.assertOpen(owner)
    const endpoint = this.held(owner, token, 'send')
    endpoint.used = true
    const source = endpoint.source
    if (source.failure !== undefined) throw source.failure
    if (source.sealed) return
    if (source.delivery === 'direct' && source.receivers[0]!.released)
      throw new ChannelOperationError('DISCONNECTED', 'channel receiver was released')
    if (source.pending.length !== 0)
      throw new ChannelOperationError('INVALID_INPUT', 'channel has unaccepted sends')
    source.sealed = true
    for (const receiver of source.receivers) this.deliver(receiver)
  }

  release(owner: ChannelParticipant, token: string): JsonValue {
    const endpoint = this.held(owner, token, 'receive')
    endpoint.used = true
    const source = endpoint.source
    const receiver = endpoint.receiver!
    const result: JsonValue =
      receiver.failure !== undefined
        ? {
            status: 'failed',
            code: receiver.failure.code,
            ...(receiver.failure.details === undefined
              ? {}
              : { details: receiver.failure.details }),
          }
        : receiver.ended
          ? { status: 'ended', lastSequence: source.sequence }
          : { status: 'released' }
    receiver.released = true
    receiver.queue.length = 0
    receiver.bufferedBytes = 0
    delete receiver.inFlight
    const failure =
      receiver.failure ?? new ChannelOperationError('DISCONNECTED', 'channel receiver was released')
    if (receiver.read !== undefined) {
      const read = receiver.read
      delete receiver.read
      read.dispose()
      read.reject(receiver.failure ?? cancelled())
    }
    if (source.delivery === 'direct') {
      for (const pending of source.pending.splice(0)) {
        this.removePending(pending)
        pending.reject(failure)
      }
    }
    return result
  }

  failWriter(
    owner: ChannelParticipant,
    token: string,
    code: WireFailureCode,
    message: string,
  ): void {
    const endpoint = this.held(owner, token, 'send')
    this.fail(endpoint.source, new ChannelOperationError(code, message))
  }

  finalize(owner: ChannelParticipant, success: boolean): void {
    if (owner.finalized) return
    const held = [...this.endpoints.values()].filter((endpoint) => endpoint.holder === owner)
    const abandoned = held.some((endpoint) => {
      const source = endpoint.source
      const receiver = endpoint.receiver
      const direct = source.delivery === 'direct' ? source.receivers[0]! : undefined
      const unusedPair =
        direct !== undefined &&
        !source.send.used &&
        !direct.endpoint.used &&
        !source.send.transferred &&
        !direct.endpoint.transferred
      return (
        receiver !== undefined &&
        !unusedPair &&
        !receiver.released &&
        !receiver.ended &&
        receiver.failure === undefined
      )
    })
    const pending = held.some(
      (endpoint) => endpoint.direction === 'send' && endpoint.source.pending.length !== 0,
    )
    const stopped = owner.stopped ?? this.failure
    const eligible = success && !abandoned && !pending && stopped === undefined
    // Evaluate all owned duties before granting any implicit clean writer end.
    if (!eligible) this.abortParticipant(owner, 'OWNER_CLOSED')
    else {
      for (const endpoint of held) {
        if (
          endpoint.direction === 'send' &&
          !endpoint.source.sealed &&
          endpoint.source.failure === undefined &&
          !(endpoint.source.delivery === 'direct' && endpoint.source.receivers[0]!.released)
        )
          this.close(owner, endpoint.token)
      }
      for (const endpoint of held)
        if (endpoint.receiver !== undefined && !endpoint.receiver.released)
          this.release(owner, endpoint.token)
    }
    for (const source of this.sources) {
      if (source.owner === owner)
        this.fail(
          source,
          new ChannelOperationError('OWNER_CLOSED', 'channel source lifetime ended'),
          true,
        )
    }
    owner.finalized = true
    if (success && stopped !== undefined) throw stopped
    if (success && (abandoned || pending)) {
      throw new ChannelOperationError(
        'EXECUTION_FAILED',
        abandoned
          ? 'Run returned with an active unfinished channel receiver'
          : 'Run returned with unaccepted channel sends',
      )
    }
  }

  abortParticipant(owner: ChannelParticipant, code: WireFailureCode): void {
    owner.stopped ??= new ChannelOperationError(code, 'channel participant stopped')
    for (const source of this.sources) {
      if (source.owner === owner)
        this.fail(source, new ChannelOperationError(code, 'channel source owner stopped'), true)
      else if (source.send.holder === owner)
        this.fail(source, new ChannelOperationError(code, 'channel owner stopped before sealing'))
      for (const receiver of source.receivers)
        if (receiver.endpoint.holder === owner && !receiver.released)
          this.release(owner, receiver.endpoint.token)
    }
  }

  abort(code: WireFailureCode = 'OWNER_CLOSED'): void {
    this.failure ??= new ChannelOperationError(code, 'root channel owner stopped')
    for (const source of this.sources) {
      // Root lifetime ends the source, including sealed but undrained buffers.
      this.fail(source, this.failure, true)
    }
  }

  private endpoint(
    owner: ChannelParticipant,
    source: Source,
    direction: Endpoint['direction'],
  ): Endpoint {
    const endpoint = {
      token: `channel:${randomUUID()}`,
      direction,
      source,
      holder: owner,
      used: false,
      transferred: false,
    }
    this.endpoints.set(endpoint.token, endpoint)
    return endpoint
  }

  private receiver(owner: ChannelParticipant, source: Source): Receiver {
    const endpoint = this.endpoint(owner, source, 'receive')
    const receiver: Receiver = {
      endpoint,
      startSequence: source.sequence + 1,
      constraints: [],
      queue: [],
      released: false,
      ended: false,
      bufferedBytes: 0,
    }
    endpoint.receiver = receiver
    source.receivers.push(receiver)
    this.receivers += 1
    return receiver
  }

  private held(
    owner: ChannelParticipant,
    token: string,
    direction?: Endpoint['direction'],
  ): Endpoint {
    const endpoint = this.endpoints.get(token)
    if (
      endpoint === undefined ||
      endpoint.holder !== owner ||
      (direction !== undefined && endpoint.direction !== direction)
    ) {
      throw new ChannelOperationError(
        'PERMISSION_DENIED',
        'channel endpoint is not held by this participant',
      )
    }
    return endpoint
  }

  private assertOpen(owner: ChannelParticipant): void {
    if (this.participants.get(owner.id) !== owner) {
      throw new ChannelOperationError(
        'PERMISSION_DENIED',
        'channel participant belongs to a different root',
      )
    }
    if (this.failure !== undefined) throw this.failure
    if (owner.stopped !== undefined) throw owner.stopped
    if (owner.finalized)
      throw new ChannelOperationError('OWNER_CLOSED', 'channel participant has completed')
  }

  private assertWritable(source: Source): void {
    if (source.failure !== undefined) throw source.failure
    if (source.delivery === 'direct' && source.receivers[0]!.released)
      throw new ChannelOperationError('DISCONNECTED', 'channel receiver was released')
    if (source.sealed) throw new ChannelOperationError('OWNER_CLOSED', 'channel source is sealed')
  }

  private hasCapacity(receiver: Receiver, bytes: number): boolean {
    return (
      receiver.queue.length + (receiver.inFlight === undefined ? 0 : 1) <
        CHANNEL_LIMITS.bufferedItems &&
      receiver.bufferedBytes + bytes <= CHANNEL_LIMITS.bufferedBytes
    )
  }

  private accept(source: Source, value: JsonValue, bytes: number): void {
    if (source.totalBytes + bytes > CHANNEL_LIMITS.sourceBytes) {
      const error = new ChannelOperationError(
        'RESOURCE_EXHAUSTED',
        'channel source lifetime byte limit reached',
      )
      this.fail(source, error)
      throw error
    }
    source.totalBytes += bytes
    const item = { sequence: ++source.sequence, value, bytes }
    for (const receiver of source.receivers) {
      if (receiver.released || receiver.failure !== undefined || receiver.ended) continue
      try {
        for (const constraint of receiver.constraints) validateConstraint(constraint, value)
        if (!this.hasCapacity(receiver, bytes))
          throw new ChannelOperationError(
            'LAGGED',
            'channel receiver exceeded its bounded capacity',
          )
        receiver.bufferedBytes += bytes
        receiver.queue.push(item)
        this.deliver(receiver)
      } catch (error) {
        const failure =
          error instanceof ChannelOperationError
            ? error
            : new ChannelOperationError('INVALID_INPUT', 'channel item failed receiver validation')
        this.failReceiver(receiver, failure)
      }
    }
  }

  private readItem(receiver: Receiver): JsonValue {
    const item = receiver.queue.shift()!
    receiver.inFlight = item
    return { item: { sequence: item.sequence, value: item.value } }
  }

  private deliver(receiver: Receiver): void {
    if (receiver.failure !== undefined || receiver.released || receiver.ended) return
    const source = receiver.endpoint.source
    const read = receiver.read
    if (read === undefined || (receiver.queue.length === 0 && !source.sealed)) return
    delete receiver.read
    read.dispose()
    if (receiver.queue.length !== 0) read.resolve(this.readItem(receiver))
    else {
      receiver.ended = true
      read.resolve({ end: { lastSequence: source.sequence } })
    }
  }

  private removePending(pending: PendingSend): void {
    this.pendingSends -= 1
    this.pendingBytes -= pending.bytes
    pending.dispose()
  }

  private flush(source: Source): void {
    while (
      source.pending.length !== 0 &&
      this.hasCapacity(source.receivers[0]!, source.pending[0]!.bytes)
    ) {
      const pending = source.pending.shift()!
      this.removePending(pending)
      try {
        this.assertWritable(source)
        for (const constraint of source.constraints) validateConstraint(constraint, pending.value)
        this.accept(source, pending.value, pending.bytes)
        pending.resolve()
      } catch (error) {
        const failure =
          error instanceof ChannelOperationError
            ? error
            : new ChannelOperationError('INVALID_INPUT', 'channel item failed validation')
        this.fail(source, failure)
        pending.reject(failure)
      }
    }
  }

  private fail(source: Source, error: ChannelOperationError, includeSealed = false): void {
    if (source.failure !== undefined || (source.sealed && !includeSealed)) return
    source.failure = error
    for (const receiver of source.receivers) this.failReceiver(receiver, error)
    for (const pending of source.pending.splice(0)) {
      this.removePending(pending)
      pending.reject(error)
    }
  }

  private failReceiver(receiver: Receiver, error: ChannelOperationError): void {
    if (receiver.failure !== undefined || receiver.ended || receiver.released) return
    receiver.failure = error
    receiver.queue.length = 0
    receiver.bufferedBytes = receiver.inFlight?.bytes ?? 0
    if (receiver.read !== undefined) {
      const read = receiver.read
      delete receiver.read
      read.dispose()
      read.reject(error)
    }
  }
}

/** A private participant handle; packages receive only its process-bound grants. */
export class ChannelParticipant {
  finalized = false
  stopped: ChannelOperationError | undefined
  constructor(
    private readonly broker: ChannelBroker,
    readonly id: string,
    private readonly options: ChannelParticipantOptions,
  ) {}
  create(options: ChannelCreationOptions & { delivery: 'broadcast' }): Promise<BroadcastAllocation>
  create(options?: ChannelCreationOptions & { delivery?: 'direct' }): Promise<DirectAllocation>
  create(options: ChannelCreationOptions): Promise<DirectAllocation | BroadcastAllocation>
  create(options: ChannelCreationOptions = {}) {
    return this.broker.create(this, options)
  }
  subscribe(source: string) {
    return this.broker.subscribe(this, source)
  }
  request(method: string, params: JsonValue | undefined, signal?: AbortSignal) {
    return this.broker.request(this, method, params, signal)
  }
  transfer(
    to: ChannelParticipant,
    references: Readonly<Record<string, string>>,
    declarations: Readonly<Record<string, ChannelDeclaration>>,
  ) {
    return this.broker.transfer(this, to, references, declarations)
  }
  send(endpoint: string, value: JsonValue, signal?: AbortSignal) {
    return this.broker.send(this, endpoint, value, signal)
  }
  next(endpoint: string, signal?: AbortSignal) {
    return this.broker.next(this, endpoint, signal)
  }
  close(endpoint: string) {
    this.broker.close(this, endpoint)
  }
  release(endpoint: string) {
    return this.broker.release(this, endpoint)
  }
  failWriter(endpoint: string, code: WireFailureCode, message: string) {
    this.broker.failWriter(this, endpoint, code, message)
  }
  finalize(success: boolean) {
    this.broker.finalize(this, success)
  }
  abort(code: WireFailureCode = 'OWNER_CLOSED') {
    this.broker.abortParticipant(this, code)
  }
  resolve(path: string): ResolvedChannelContract | Promise<ResolvedChannelContract> {
    if (
      !path.startsWith('./') ||
      path
        .slice(2)
        .split('/')
        .some((part) => part === '' || part === '.' || part === '..') ||
      path.includes('\\') ||
      path.includes('\0') ||
      this.options.resolveContract === undefined
    ) {
      throw new ChannelOperationError(
        'INVALID_INPUT',
        'channel contract must resolve inside the admitted package',
      )
    }
    return this.options.resolveContract(path)
  }
}

function grant(endpoint: Endpoint): ChannelGrant {
  return Object.freeze({
    endpoint: endpoint.token,
    direction: endpoint.direction,
    delivery: endpoint.source.delivery,
    ...(endpoint.source.contract === undefined ? {} : { contract: endpoint.source.contract }),
    ...(endpoint.receiver === undefined ? {} : { startSequence: endpoint.receiver.startSequence }),
  })
}

function activeReceiver(receiver: Receiver): boolean {
  return !receiver.released && !receiver.ended && receiver.failure === undefined
}

function sameIdentity(a: ChannelIdentity, b: ChannelIdentity): boolean {
  return a.id === b.id && a.version === b.version && a.digest === b.digest
}
function namedConstraint(contract: ResolvedChannelContract): Constraint {
  return { schema: schemaKey(contract.schema), validate: (value) => contract.validate(value) }
}
function schemaKey(schema: JsonValue | undefined): string | undefined {
  return schema === undefined || schema === true
    ? undefined
    : new TextDecoder().decode(canonicalJson(schema))
}
function compileConstraint(schema: JsonValue | undefined): Constraint {
  if (schema === undefined || schema === true)
    return { schema: undefined, validate: () => undefined }
  try {
    const compiled = compileEmbeddedSchema(schema, { path: '<channel>' })
    return {
      schema: schemaKey(schema),
      validate: (value) => compiled.validate(value, 'INVALID_INPUT'),
    }
  } catch {
    throw new ChannelOperationError(
      'INVALID_INPUT',
      'channel schema is not a supported Schema/1 value',
    )
  }
}
function validateConstraint(constraint: Constraint, value: JsonValue): void {
  try {
    constraint.validate(value)
  } catch {
    throw new ChannelOperationError(
      'INVALID_INPUT',
      'channel item does not satisfy its declared schema',
    )
  }
}
function cancelled(): ChannelOperationError {
  return new ChannelOperationError('CANCELLED', 'channel operation was cancelled')
}
function requireObject(value: JsonValue | undefined): JsonObject {
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== 'object')
    throw new TypeError('channel params must be an object')
  return value as JsonObject
}
function exactKeys(value: JsonObject, required: string[], optional: string[]): void {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new TypeError('invalid channel params')
}
