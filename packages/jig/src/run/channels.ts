import { randomUUID } from 'node:crypto'

import { canonicalJson, decodeJson1, type JsonObject, type JsonValue } from '../json.js'
import { compileEmbeddedSchema } from '../schema/index.js'
import type { WireFailureCode } from './session.js'

const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const DIRECT_CHANNEL_LIMITS = Object.freeze({
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
  readonly delivery: 'direct'
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
  readonly delivery?: 'direct'
  readonly schema?: JsonValue
  readonly contract?: string
}

export interface ChannelParticipantOptions {
  readonly resolveContract?: (
    path: string,
  ) => ResolvedChannelContract | Promise<ResolvedChannelContract>
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
  holder: ChannelParticipant
  used: boolean
  transferred: boolean
}

interface Source {
  readonly owner: ChannelParticipant
  readonly contract?: ChannelIdentity
  readonly constraints: Constraint[]
  readonly queue: Item[]
  readonly pending: PendingSend[]
  send: Endpoint
  receive: Endpoint
  sealed: boolean
  released: boolean
  ended: boolean
  sequence: number
  totalBytes: number
  bufferedBytes: number
  inFlight?: Item
  read?: PendingRead
  failure?: ChannelOperationError
}

/** Private finite root broker. Tokens have meaning only with their current participant. */
export class DirectChannelBroker {
  private readonly endpoints = new Map<string, Endpoint>()
  private readonly participants = new Map<string, ChannelParticipant>()
  private readonly sources: Source[] = []
  private pendingSends = 0
  private pendingBytes = 0
  private failure?: ChannelOperationError

  participant(id: string, options: ChannelParticipantOptions = {}): ChannelParticipant {
    if (this.participants.has(id)) throw new TypeError('channel participant already exists')
    const participant = new ChannelParticipant(this, id, options)
    this.participants.set(id, participant)
    return participant
  }

  async create(
    owner: ChannelParticipant,
    options: ChannelCreationOptions,
  ): Promise<{
    send: ChannelGrant
    receive: ChannelGrant
  }> {
    this.assertOpen(owner)
    if (options.delivery !== undefined && options.delivery !== 'direct') {
      throw new ChannelOperationError('UNAVAILABLE', 'only direct channels are supported')
    }
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
    if (this.sources.length >= DIRECT_CHANNEL_LIMITS.sources) {
      throw new ChannelOperationError('RESOURCE_EXHAUSTED', 'root channel allocation limit reached')
    }
    const source = {
      owner,
      ...(contract === undefined ? {} : { contract: Object.freeze({ ...contract.identity }) }),
      constraints: [constraint],
      queue: [],
      pending: [],
      sealed: false,
      released: false,
      ended: false,
      sequence: 0,
      totalBytes: 0,
      bufferedBytes: 0,
    } as unknown as Source
    source.send = this.endpoint(owner, source, 'send')
    source.receive = this.endpoint(owner, source, 'receive')
    this.sources.push(source)
    return { send: grant(source.send), receive: grant(source.receive) }
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
      if (declaration.delivery === 'broadcast') {
        throw new ChannelOperationError(
          'UNAVAILABLE',
          'direct endpoint cannot satisfy broadcast delivery',
        )
      }
      const source = endpoint.source
      if (source.released || source.failure !== undefined) {
        throw new ChannelOperationError(
          'DISCONNECTED',
          'channel is no longer available for connection',
        )
      }
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
        ...staged
          .filter((entry) => entry.endpoint.source === source)
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
      for (const item of source.queue) validateConstraint(constraint, item.value)
      if (source.inFlight !== undefined) validateConstraint(constraint, source.inFlight.value)
      staged.push({ name, endpoint, constraint })
    }
    // No rights or constraints change until all entries and their prefix validate.
    const grants: Record<string, ChannelGrant> = Object.create(null)
    for (const entry of staged) {
      entry.endpoint.source.constraints.push(entry.constraint)
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
        this.release(owner, pair.receive.endpoint)
        throw cancelled()
      }
      return pair as unknown as JsonValue
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
      if (bytes > DIRECT_CHANNEL_LIMITS.itemBytes) {
        throw new ChannelOperationError('RESOURCE_EXHAUSTED', 'channel item exceeds 64 KiB')
      }
      item = decodeJson1(encoded)
      for (const constraint of source.constraints) validateConstraint(constraint, item)
      if (source.totalBytes + bytes > DIRECT_CHANNEL_LIMITS.sourceBytes) {
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
    if (source.pending.length === 0 && this.hasCapacity(source, bytes)) {
      this.accept(source, item, bytes)
      return null
    }
    if (
      this.pendingSends >= DIRECT_CHANNEL_LIMITS.pendingSends ||
      this.pendingBytes + bytes > DIRECT_CHANNEL_LIMITS.pendingBytes
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
    if (source.read !== undefined)
      throw new ChannelOperationError('INVALID_INPUT', 'channel already has a pending read')
    // A subsequent read gives back capacity for the prior committed response.
    if (source.inFlight !== undefined) {
      source.bufferedBytes -= source.inFlight.bytes
      delete source.inFlight
    }
    this.flush(source)
    if (source.failure !== undefined) throw source.failure
    if (source.released)
      throw new ChannelOperationError('DISCONNECTED', 'channel receiver was released')
    if (signal?.aborted) {
      this.release(owner, token)
      throw cancelled()
    }
    if (source.queue.length !== 0) return this.readItem(source)
    if (source.sealed) {
      source.ended = true
      return { end: { lastSequence: source.sequence } }
    }
    return new Promise<JsonValue>((resolve, reject) => {
      const onAbort = () => {
        if (source.read !== pending) return
        delete source.read
        pending.dispose()
        this.release(owner, token)
        reject(cancelled())
      }
      const pending: PendingRead = {
        resolve,
        reject,
        dispose: () => signal?.removeEventListener('abort', onAbort),
      }
      source.read = pending
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
    if (source.released)
      throw new ChannelOperationError('DISCONNECTED', 'channel receiver was released')
    if (source.pending.length !== 0)
      throw new ChannelOperationError('INVALID_INPUT', 'channel has unaccepted sends')
    source.sealed = true
    this.deliver(source)
  }

  release(owner: ChannelParticipant, token: string): JsonValue {
    const endpoint = this.held(owner, token, 'receive')
    endpoint.used = true
    const source = endpoint.source
    const result: JsonValue =
      source.failure !== undefined
        ? {
            status: 'failed',
            code: source.failure.code,
            ...(source.failure.details === undefined ? {} : { details: source.failure.details }),
          }
        : source.ended
          ? { status: 'ended', lastSequence: source.sequence }
          : { status: 'released' }
    source.released = true
    source.queue.length = 0
    source.bufferedBytes = 0
    delete source.inFlight
    const failure =
      source.failure ?? new ChannelOperationError('DISCONNECTED', 'channel receiver was released')
    if (source.read !== undefined) {
      const read = source.read
      delete source.read
      read.dispose()
      read.reject(source.failure ?? cancelled())
    }
    for (const pending of source.pending.splice(0)) {
      this.removePending(pending)
      pending.reject(failure)
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
      const unusedPair =
        !source.send.used &&
        !source.receive.used &&
        !source.send.transferred &&
        !source.receive.transferred
      return (
        endpoint.direction === 'receive' &&
        !unusedPair &&
        !source.released &&
        !source.ended &&
        source.failure === undefined
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
          !endpoint.source.released
        )
          this.close(owner, endpoint.token)
      }
      for (const endpoint of held)
        if (endpoint.direction === 'receive' && !endpoint.source.released)
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
      if (source.receive.holder === owner && !source.released)
        this.release(owner, source.receive.token)
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
    if (source.released)
      throw new ChannelOperationError('DISCONNECTED', 'channel receiver was released')
    if (source.sealed) throw new ChannelOperationError('OWNER_CLOSED', 'channel source is sealed')
  }

  private hasCapacity(source: Source, bytes: number): boolean {
    return (
      source.queue.length + (source.inFlight === undefined ? 0 : 1) <
        DIRECT_CHANNEL_LIMITS.bufferedItems &&
      source.bufferedBytes + bytes <= DIRECT_CHANNEL_LIMITS.bufferedBytes
    )
  }

  private accept(source: Source, value: JsonValue, bytes: number): void {
    if (source.totalBytes + bytes > DIRECT_CHANNEL_LIMITS.sourceBytes) {
      const error = new ChannelOperationError(
        'RESOURCE_EXHAUSTED',
        'channel source lifetime byte limit reached',
      )
      this.fail(source, error)
      throw error
    }
    source.totalBytes += bytes
    source.bufferedBytes += bytes
    source.queue.push({ sequence: ++source.sequence, value, bytes })
    this.deliver(source)
  }

  private readItem(source: Source): JsonValue {
    const item = source.queue.shift()!
    source.inFlight = item
    return { item: { sequence: item.sequence, value: item.value } }
  }

  private deliver(source: Source): void {
    const read = source.read
    if (read === undefined || (source.queue.length === 0 && !source.sealed)) return
    delete source.read
    read.dispose()
    if (source.queue.length !== 0) read.resolve(this.readItem(source))
    else {
      source.ended = true
      read.resolve({ end: { lastSequence: source.sequence } })
    }
  }

  private removePending(pending: PendingSend): void {
    this.pendingSends -= 1
    this.pendingBytes -= pending.bytes
    pending.dispose()
  }

  private flush(source: Source): void {
    while (source.pending.length !== 0 && this.hasCapacity(source, source.pending[0]!.bytes)) {
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
    if (source.failure !== undefined || (source.sealed && !includeSealed) || source.ended) return
    source.failure = error
    source.queue.length = 0
    source.bufferedBytes = source.inFlight?.bytes ?? 0
    if (source.read !== undefined) {
      const read = source.read
      delete source.read
      read.dispose()
      read.reject(error)
    }
    for (const pending of source.pending.splice(0)) {
      this.removePending(pending)
      pending.reject(error)
    }
  }
}

/** A private participant handle; packages receive only its process-bound grants. */
export class ChannelParticipant {
  finalized = false
  stopped: ChannelOperationError | undefined
  constructor(
    private readonly broker: DirectChannelBroker,
    readonly id: string,
    private readonly options: ChannelParticipantOptions,
  ) {}
  create(options: ChannelCreationOptions = {}) {
    return this.broker.create(this, options)
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
    delivery: 'direct' as const,
    ...(endpoint.source.contract === undefined ? {} : { contract: endpoint.source.contract }),
    ...(endpoint.direction === 'receive' ? { startSequence: 1 } : {}),
  })
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
