import { decodeJson1, type JsonObject, type JsonValue, JSON_1_LIMITS } from '../json.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'

export const PRIVATE_FINITE_ACP_LIMITS = Object.freeze({
  frameBytes: JSON_1_LIMITS.bytes,
  adapterBytes: 8 * 1024 * 1024,
  clientBytes: 32 * 1024 * 1024,
  adapterFrames: 32,
  clientFrames: 8_192,
  identifierBytes: 1_024,
  promptBytes: 1_048_576,
  textBytes: 8_388_608,
  updates: 4_096,
  permissions: 256,
})

type Id = string | number
type Configuration =
  | { readonly configId: string; readonly value: string }
  | { readonly configId: string; readonly type: 'boolean'; readonly value: boolean }

export interface PrivateFiniteAcpConfiguration {
  readonly configuration?: readonly Configuration[]
  readonly modeId?: string
}

export interface PrivateFiniteAcpDelivery {
  readonly toAdapter?: JsonObject
  readonly toClient?: JsonObject
}

export class PrivateFiniteAcpPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrivateFiniteAcpPolicyError'
  }
}

const encoder = new TextEncoder()
const INITIALIZE = 'initialize'
const NEW = 'session/new'
const CONFIGURE = 'session/set_config_option'
const MODE = 'session/set_mode'
const PROMPT = 'session/prompt'
const CANCEL = 'session/cancel'
const CLOSE = 'session/close'
const UPDATE = 'session/update'
const PERMISSION = 'session/request_permission'

/**
 * Private authority accounting for one finite ACP conversation. A returned frame
 * is already consumed: failure to write it cannot restore an allowance. This
 * owns no process, credentials, transport, or application-result interpretation.
 */
export class PrivateFiniteAcpPolicy {
  private readonly configuration: readonly Configuration[]
  private readonly modeId?: string
  private poisoned = false
  private initialized = false
  private sessionId?: string
  private configured = 0
  private modeSet = false
  private promptSent = false
  private promptSettled = false
  private peerFailed = false
  private cancelSent = false
  private closeSent = false
  private canClose = false
  private pending: { readonly id: Id; readonly method: string } | undefined
  private readonly adapterIds = new Set<Id>()
  private readonly clientIds = new Set<Id>()
  private adapterBytes = 0
  private clientBytes = 0
  private adapterFrames = 0
  private clientFrames = 0
  private updates = 0
  private textBytes = 0

  constructor(configuration: PrivateFiniteAcpConfiguration = {}) {
    const policy = object(snapshotPrivateOrdinaryJson(configuration, 'finite ACP policy', invalid))
    keys(policy, [], ['configuration', 'modeId'])
    const options = Object.hasOwn(policy, 'configuration') ? policy.configuration : []
    if (!Array.isArray(options) || options.length > 16) fail('Invalid finite ACP configuration')
    const ids = new Set<string>()
    for (const item of options) {
      const option = object(item)
      keys(option, ['configId', 'value'], ['type'])
      const id = identifier(option.configId)
      if (ids.has(id)) fail('Duplicate finite ACP configuration')
      ids.add(id)
      if (option.type === 'boolean') {
        if (typeof option.value !== 'boolean') fail('Invalid finite ACP configuration')
      } else {
        if (Object.hasOwn(option, 'type')) fail('Invalid finite ACP configuration')
        identifier(option.value)
      }
    }
    this.configuration = options as unknown as readonly Configuration[]
    if (Object.hasOwn(policy, 'modeId')) this.modeId = identifier(policy.modeId)
  }

  fromAdapter(bytes: Uint8Array): JsonObject {
    return this.guard(() => {
      const frame = this.frame(bytes, 'adapter')
      keys(frame, ['jsonrpc', 'method', 'params'], ['id'])
      const method = frame.method
      const params = object(frame.params)
      if (method === CANCEL) {
        keys(frame, ['jsonrpc', 'method', 'params'])
        this.ownedSession(params, [])
        if (!this.promptSent || this.cancelSent || this.closeSent)
          fail('ACP cancellation is not available')
        this.cancelSent = true
        return frame
      }
      if (this.pending !== undefined) fail('An ACP request is already pending')
      const id = requestId(frame.id)
      if (this.adapterIds.has(id)) fail('ACP request identity was reused')
      if (this.closeSent || (this.peerFailed && method !== CLOSE))
        fail('The finite ACP conversation has ended')
      switch (method) {
        case INITIALIZE: {
          if (this.initialized || this.adapterIds.size > 0)
            fail('ACP initialization is not available')
          keys(params, ['protocolVersion'], ['clientCapabilities', 'clientInfo'])
          if (params.protocolVersion !== 1) fail('Unsupported ACP version')
          if (params.clientCapabilities !== undefined) keys(object(params.clientCapabilities), [])
          if (params.clientInfo !== undefined) {
            const info = object(params.clientInfo)
            keys(info, ['name'], ['version', 'title'])
            for (const value of Object.values(info)) identifier(value)
          }
          break
        }
        case NEW:
          if (!this.initialized || this.sessionId !== undefined)
            fail('ACP session creation is not available')
          keys(params, ['cwd', 'mcpServers'])
          if (
            params.cwd !== '/work' ||
            !Array.isArray(params.mcpServers) ||
            params.mcpServers.length !== 0
          )
            fail('ACP session authority differs from its policy')
          break
        case CONFIGURE: {
          this.ownedSession(params, ['configId', 'value'], ['type'])
          const required = this.configuration[this.configured]
          if (this.promptSent || required === undefined || this.modeSet)
            fail('ACP configuration is not available')
          if (
            params.configId !== required.configId ||
            params.value !== required.value ||
            params.type !== ('type' in required ? required.type : undefined)
          )
            fail('ACP configuration differs from its policy')
          break
        }
        case MODE:
          this.ownedSession(params, ['modeId'])
          if (
            this.promptSent ||
            this.configured !== this.configuration.length ||
            this.modeSet ||
            this.modeId === undefined ||
            params.modeId !== this.modeId
          )
            fail('ACP mode differs from its policy')
          break
        case PROMPT: {
          this.ownedSession(params, ['prompt'])
          if (
            this.promptSent ||
            this.configured !== this.configuration.length ||
            (this.modeId !== undefined && !this.modeSet)
          )
            fail('ACP prompt is not available')
          if (!Array.isArray(params.prompt) || params.prompt.length !== 1)
            fail('ACP requires one text prompt')
          const content = object(params.prompt[0])
          keys(content, ['type', 'text'])
          if (
            content.type !== 'text' ||
            typeof content.text !== 'string' ||
            !content.text ||
            content.text.includes('\0') ||
            content.text.trimStart().startsWith('/') ||
            encoder.encode(content.text).byteLength > PRIVATE_FINITE_ACP_LIMITS.promptBytes
          )
            fail('ACP prompt exceeds its authority or bounds')
          this.promptSent = true
          break
        }
        case CLOSE:
          this.ownedSession(params, [])
          if (!this.canClose || (!this.promptSettled && !this.peerFailed))
            fail('ACP close is not available')
          this.closeSent = true
          break
        default:
          fail('ACP operation is not permitted')
      }
      this.adapterIds.add(id)
      this.pending = { id, method: method as string }
      return frame
    })
  }

  fromClient(bytes: Uint8Array): PrivateFiniteAcpDelivery {
    return this.guard(() => {
      const frame = this.frame(bytes, 'client')
      if (Object.hasOwn(frame, 'method')) return this.clientMessage(frame)
      keys(frame, ['jsonrpc', 'id'], ['result', 'error'])
      const id = requestId(frame.id)
      const pending = this.pending
      if (
        pending === undefined ||
        id !== pending.id ||
        Object.hasOwn(frame, 'result') === Object.hasOwn(frame, 'error')
      )
        fail('ACP response has no matching request')
      if (Object.hasOwn(frame, 'error')) {
        const error = object(frame.error)
        if (!Number.isSafeInteger(error.code) || typeof error.message !== 'string')
          fail('Invalid ACP error response')
        this.pending = undefined
        this.peerFailed = true
        return freeze({
          toAdapter: response(
            id,
            { code: error.code!, message: 'Native ACP request failed' },
            true,
          ),
        })
      }
      const result = object(frame.result)
      let projected: JsonObject
      switch (pending.method) {
        case INITIALIZE: {
          if (result.protocolVersion !== 1) fail('Unsupported ACP version')
          const capabilities = optionalObject(result.agentCapabilities)
          const sessions = optionalObject(capabilities.sessionCapabilities)
          this.canClose = sessions.close !== undefined && sessions.close !== null
          if (this.canClose) object(sessions.close)
          this.initialized = true
          projected = {
            protocolVersion: 1,
            agentCapabilities: this.canClose ? { sessionCapabilities: { close: {} } } : {},
          }
          break
        }
        case NEW:
          this.sessionId = identifier(result.sessionId)
          projected = { sessionId: this.sessionId }
          break
        case CONFIGURE: {
          const required = this.configuration[this.configured]!
          if (!Array.isArray(result.configOptions)) fail('ACP configuration was not confirmed')
          const matches = result.configOptions.filter(
            (option) => object(option).id === required.configId,
          )
          if (matches.length !== 1 || object(matches[0]).currentValue !== required.value)
            fail('ACP configuration was not confirmed')
          const option =
            typeof required.value === 'boolean'
              ? {
                  id: required.configId,
                  name: required.configId,
                  type: 'boolean',
                  currentValue: required.value,
                }
              : {
                  id: required.configId,
                  name: required.configId,
                  type: 'select',
                  currentValue: required.value,
                  options: [{ value: required.value, name: required.value }],
                }
          projected = { configOptions: [option] }
          this.configured += 1
          break
        }
        case MODE:
          this.modeSet = true
          projected = {}
          break
        case PROMPT:
          if (
            !['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'].includes(
              result.stopReason as string,
            )
          )
            fail('Invalid ACP terminal response')
          this.promptSettled = true
          projected = { stopReason: result.stopReason! }
          break
        case CLOSE:
          projected = {}
          break
        default:
          fail('ACP response has no matching request')
      }
      this.pending = undefined
      return freeze({ toAdapter: response(id, projected) })
    })
  }

  /** Protocol accounting only: this does not establish process or Agent success. */
  assertSettled(): void {
    this.guard(() => {
      if (this.pending !== undefined || (!this.promptSettled && !this.peerFailed))
        fail('The finite ACP conversation is not settled')
    })
  }

  private clientMessage(frame: JsonObject): PrivateFiniteAcpDelivery {
    const params = object(frame.params)
    if (frame.method === PERMISSION) {
      keys(frame, ['jsonrpc', 'method', 'params', 'id'])
      const id = requestId(frame.id)
      if (this.clientIds.has(id) || this.clientIds.size >= PRIVATE_FINITE_ACP_LIMITS.permissions)
        fail('ACP permission request identity or capacity is invalid')
      this.clientIds.add(id)
      // Deny even a peer-named foreign session. It never authorizes cancellation.
      return freeze({ toClient: response(id, { outcome: { outcome: 'cancelled' } }) })
    }
    keys(frame, ['jsonrpc', 'method', 'params'])
    if (frame.method !== UPDATE) fail('ACP client operation is not permitted')
    if (++this.updates > PRIVATE_FINITE_ACP_LIMITS.updates) fail('ACP update capacity exceeded')
    // Initial client notifications can precede session/new's response. They
    // cannot nominate our session or be exposed before its identity is known.
    if (this.sessionId === undefined && this.pending?.method === NEW) {
      keys(params, ['sessionId', 'update'], ['_meta'])
      identifier(params.sessionId)
      object(params.update)
      return Object.freeze({})
    }
    this.ownedSession(params, ['update'], ['_meta'])
    const update = object(params.update)
    if (typeof update.sessionUpdate !== 'string') fail('Invalid ACP update')
    let projected: JsonObject
    if (update.sessionUpdate === 'agent_message_chunk') {
      const content = object(update.content)
      if (content.type !== 'text') return Object.freeze({})
      if (typeof content.text !== 'string') fail('Invalid ACP text update')
      this.textBytes += encoder.encode(content.text).byteLength
      if (this.textBytes > PRIVATE_FINITE_ACP_LIMITS.textBytes) fail('ACP text capacity exceeded')
      projected = {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: content.text },
        ...(update.messageId === undefined || update.messageId === null
          ? {}
          : { messageId: identifier(update.messageId) }),
      }
    } else if (update.sessionUpdate === 'plan') {
      if (!Array.isArray(update.entries)) fail('Invalid ACP plan update')
      const entries = update.entries.map((value) => {
        const entry = object(value)
        if (
          typeof entry.content !== 'string' ||
          !['high', 'medium', 'low'].includes(entry.priority as string) ||
          !['pending', 'in_progress', 'completed'].includes(entry.status as string)
        )
          fail('Invalid ACP plan entry')
        return { content: entry.content, priority: entry.priority!, status: entry.status! }
      })
      projected = { sessionUpdate: 'plan', entries }
    } else {
      // Non-public client updates cannot confer authority or escape as raw diagnostics.
      return Object.freeze({})
    }
    return freeze({
      toAdapter: {
        jsonrpc: '2.0',
        method: UPDATE,
        params: { sessionId: this.sessionId!, update: projected },
      },
    })
  }

  private ownedSession(
    params: JsonObject,
    required: readonly string[],
    optional: readonly string[] = [],
  ): void {
    keys(params, ['sessionId', ...required], optional)
    if (this.sessionId === undefined || params.sessionId !== this.sessionId)
      fail('ACP message does not belong to the owned session')
  }

  private frame(bytes: Uint8Array, direction: 'adapter' | 'client'): JsonObject {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > PRIVATE_FINITE_ACP_LIMITS.frameBytes)
      fail('ACP frame capacity exceeded')
    if (direction === 'adapter') {
      this.adapterBytes += bytes.byteLength
      if (
        ++this.adapterFrames > PRIVATE_FINITE_ACP_LIMITS.adapterFrames ||
        this.adapterBytes > PRIVATE_FINITE_ACP_LIMITS.adapterBytes
      )
        fail('ACP adapter capacity exceeded')
    } else {
      this.clientBytes += bytes.byteLength
      if (
        ++this.clientFrames > PRIVATE_FINITE_ACP_LIMITS.clientFrames ||
        this.clientBytes > PRIVATE_FINITE_ACP_LIMITS.clientBytes
      )
        fail('ACP client capacity exceeded')
    }
    let value: JsonValue
    try {
      value = decodeJson1(bytes)
    } catch {
      fail('Invalid ACP JSON frame')
    }
    const frame = object(value!)
    if (frame.jsonrpc !== '2.0') fail('Invalid ACP protocol frame')
    return freeze(frame)
  }

  private guard<T>(operation: () => T): T {
    if (this.poisoned) fail('The finite ACP policy is closed after failure')
    try {
      return operation()
    } catch (error) {
      this.poisoned = true
      if (error instanceof PrivateFiniteAcpPolicyError) throw error
      throw invalid('Invalid finite ACP protocol operation')
    }
  }
}

function response(id: Id, value: JsonObject, error = false): JsonObject {
  return { jsonrpc: '2.0', id, [error ? 'error' : 'result']: value }
}

function freeze<T extends JsonObject>(value: T): T {
  const descend = (item: JsonValue): void => {
    if (item === null || typeof item !== 'object' || Object.isFrozen(item)) return
    for (const child of Object.values(item)) descend(child)
    Object.freeze(item)
  }
  descend(value)
  return value
}

function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    encoder.encode(value).byteLength > PRIVATE_FINITE_ACP_LIMITS.identifierBytes
  )
    fail('Invalid ACP identifier')
  return value as string
}

function requestId(value: unknown): Id {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  return identifier(value)
}

function object(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('Invalid ACP object')
  return value as JsonObject
}

function optionalObject(value: unknown): JsonObject {
  return value === undefined || value === null ? {} : object(value)
}

function keys(
  value: JsonObject,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    fail('ACP fields exceed the permitted profile')
}

function invalid(message: string): PrivateFiniteAcpPolicyError {
  return new PrivateFiniteAcpPolicyError(message)
}

function fail(message: string): never {
  throw invalid(message)
}
