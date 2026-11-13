import { randomUUID } from 'node:crypto'
import { decodeJson1, JSON_1_LIMITS, type JsonObject, type JsonValue } from '../json.js'
import { PrivateAcpV2Foreground, PrivateAcpV2ForegroundError } from './finite-acp-v2-foreground.js'
import {
  isPrivateNativeTurnAllowance,
  PRIVATE_NATIVE_TURN_POLICY,
} from './native-agent-turn-policy.js'
import {
  type PrivateNativeSessionReportedReason,
  privateNativeSessionReportedReason,
} from './native-session-diagnostics.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'

export const PRIVATE_FINITE_ACP_LIMITS = Object.freeze({
  frameBytes: JSON_1_LIMITS.bytes,
  adapterBytes: 8 * 1024 * 1024,
  clientBytes: 32 * 1024 * 1024,
  adapterFrames: 64,
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
  readonly maxTurns?: number
  readonly configuration?: readonly Configuration[]
  readonly modeId?: string
  readonly restoreSessionId?: string
}

export interface PrivateFiniteAcpDelivery {
  readonly toAdapter?: JsonObject
  readonly afterResponse?: JsonObject
  readonly toClient?: JsonObject
}

const nativeCategories = ['connection', 'access', 'limit', 'request', 'service', 'unknown'] as const

export class PrivateFiniteAcpPolicyError extends Error {
  constructor(
    message: string,
    readonly reason: 'protocol' | 'native-session' = 'protocol',
    readonly nativeCategory?: (typeof nativeCategories)[number],
    readonly nativeHttpStatusCode?: number,
    readonly nativeReportedReason?: PrivateNativeSessionReportedReason,
  ) {
    super(message)
    this.name = 'PrivateFiniteAcpPolicyError'
  }
}

const encoder = new TextEncoder()
const INITIALIZE = 'initialize'
const NEW = 'session/new'
const RESUME = 'session/resume'
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
  private readonly maxTurns: number
  private readonly v2 = new PrivateAcpV2Foreground()
  private turns = 0
  private readonly configuration: readonly Configuration[]
  private readonly modeId?: string
  private readonly restoreSessionId?: string
  private canResume = false
  private poisoned = false
  private initialized = false
  private sessionId?: string
  private configured = 0
  private modeSet = false
  private promptSent = false
  private promptRpcResultReceived = false
  private promptSettled = false
  private peerFailed = false
  private pendingNotice = false
  private cancelSent = false
  private closeSent = false
  private canClose = false
  private resumeAccepted = false
  private pending: { readonly id: Id; readonly method: string } | undefined
  private readonly adapterIds = new Set<Id>()
  private readonly clientIds = new Set<Id>()
  private adapterBytes = 0
  private clientBytes = 0
  private adapterFrames = 0
  private clientFrames = 0
  private updates = 0
  private textBytes = 0
  private planOutputEmitted = false
  private piStatusMessageId: string | undefined

  constructor(
    configuration: PrivateFiniteAcpConfiguration = {},
    private readonly nativeClient?: string,
  ) {
    if (nativeClient !== undefined) identifier(nativeClient)
    const policy = object(snapshotPrivateOrdinaryJson(configuration, 'finite ACP policy', invalid))
    keys(policy, [], ['configuration', 'modeId', 'maxTurns', 'restoreSessionId'])
    if (Object.hasOwn(policy, 'restoreSessionId'))
      this.restoreSessionId = identifier(policy.restoreSessionId)
    const maxTurns = Object.hasOwn(policy, 'maxTurns')
      ? policy.maxTurns
      : PRIVATE_NATIVE_TURN_POLICY.default
    if (!isPrivateNativeTurnAllowance(maxTurns)) fail('Invalid ACP turn allowance')
    this.maxTurns = maxTurns
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
    if (this.modeId !== undefined && ids.has('mode'))
      fail('ACP v2 mode configuration is duplicated')
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
        if (!this.promptSent || this.cancelSent || this.closeSent || this.peerFailed)
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
          keys(params, ['protocolVersion', 'capabilities', 'info'])
          if (params.protocolVersion !== 2) fail('Unsupported ACP version')
          keys(object(params.capabilities), [])
          const info = object(params.info)
          keys(info, ['name', 'version'], ['title'])
          for (const value of Object.values(info)) identifier(value)
          break
        }
        case NEW:
          if (
            !this.initialized ||
            this.sessionId !== undefined ||
            this.restoreSessionId !== undefined
          )
            fail('ACP session creation is not available')
          keys(params, ['cwd'], ['mcpServers'])
          if (
            params.cwd !== '/work' ||
            (params.mcpServers !== undefined &&
              (!Array.isArray(params.mcpServers) || params.mcpServers.length !== 0))
          )
            fail('ACP session authority differs from its policy')
          break
        case RESUME:
          if (
            !this.initialized ||
            !this.canResume ||
            this.sessionId !== undefined ||
            this.restoreSessionId === undefined
          )
            fail('ACP session restoration is not available')
          keys(params, ['sessionId', 'cwd'], ['mcpServers'])
          if (
            params.sessionId !== this.restoreSessionId ||
            params.cwd !== '/work' ||
            (params.mcpServers !== undefined &&
              (!Array.isArray(params.mcpServers) || params.mcpServers.length !== 0))
          )
            fail('ACP restoration authority differs from its policy')
          break
        case CONFIGURE: {
          this.ownedSession(params, ['configId', 'value'], ['type'])
          const required =
            this.configuration[this.configured] ??
            (this.modeId !== undefined && !this.modeSet
              ? { configId: 'mode', value: this.modeId }
              : undefined)
          if (this.promptSent || required === undefined || this.modeSet)
            fail('ACP configuration is not available')
          if (
            params.configId !== required.configId ||
            params.value !== required.value ||
            params.type !== ('type' in required ? required.type : 'id')
          )
            fail('ACP configuration differs from its policy')
          break
        }
        case MODE:
          fail('ACP v2 modes are configuration options')
          break
        case PROMPT: {
          this.ownedSession(params, ['prompt'])
          if (
            this.turns >= this.maxTurns ||
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
          this.v2?.begin()
          this.planOutputEmitted = false
          this.piStatusMessageId = undefined
          this.promptSent = true
          this.promptRpcResultReceived = false
          this.promptSettled = false
          this.cancelSent = false
          this.turns += 1
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
        // Recognize the installed Codex report without forwarding its private
        // guidance suffix. This reports a client claim, not its underlying cause.
        const managedPreferencesUnavailable =
          this.nativeClient === 'openai-codex' &&
          pending.method === NEW &&
          error.code === -32603 &&
          error.message === 'Internal error' &&
          typeof error.data === 'string' &&
          error.data.startsWith(
            'failed to load configuration: Failed to synchronize managed preferences\n\nCheck ',
          )
        if (pending.method === PROMPT) this.v2.reject(error)
        this.pending = undefined
        this.peerFailed = true
        return freeze({
          toAdapter: response(
            id,
            {
              code: error.code!,
              message: 'Native ACP request failed',
              ...(managedPreferencesUnavailable
                ? { data: { reason: 'managed-preferences-unavailable' } }
                : {}),
            },
            true,
          ),
        })
      }
      const result = object(frame.result)
      if (pending.method === PROMPT) this.promptRpcResultReceived = true
      if (this.notice(result._meta)) this.pendingNotice = true
      let projected: JsonObject
      switch (pending.method) {
        case INITIALIZE: {
          if (result.protocolVersion !== 2) fail('Unsupported ACP version')
          const capabilities = optionalObject(result.capabilities)
          if (capabilities.session === undefined || capabilities.session === null)
            fail('ACP v2 client does not advertise baseline sessions')
          this.canClose = true
          this.canResume = true
          this.initialized = true
          projected = {
            protocolVersion: 2,
            capabilities: { session: {} },
            info: { name: 'jig-selected-native-agent', version: '2' },
          }
          break
        }
        case NEW:
          this.sessionId = identifier(result.sessionId)
          projected = { sessionId: this.sessionId }
          break
        case RESUME:
          this.sessionId = this.restoreSessionId!
          this.resumeAccepted = true
          projected = {}
          break
        case CONFIGURE: {
          const required =
            this.configuration[this.configured] ??
            (this.modeId !== undefined && !this.modeSet
              ? { configId: 'mode', value: this.modeId }
              : undefined)
          if (required === undefined) fail('ACP configuration is not available')
          if (!Array.isArray(result.configOptions)) fail('ACP configuration was not confirmed')
          // The pinned native Codex/Pi adapters can identify options by `id`.
          // Normalize only this closed, reviewed option before returning v2 data.
          const matches = result.configOptions.filter((option) => {
            const nativeOption = object(option)
            return (nativeOption.configId ?? nativeOption.id) === required.configId
          })
          if (matches.length !== 1 || object(matches[0]).currentValue !== required.value)
            fail('ACP configuration was not confirmed')
          const option =
            typeof required.value === 'boolean'
              ? {
                  configId: required.configId,
                  name: required.configId,
                  type: 'boolean',
                  currentValue: required.value,
                }
              : {
                  configId: required.configId,
                  name: required.configId,
                  type: 'select',
                  currentValue: required.value,
                  options: [{ value: required.value, name: required.value }],
                }
          projected = { configOptions: [option] }
          if (required.configId === 'mode' && this.configured === this.configuration.length)
            this.modeSet = true
          else this.configured += 1
          break
        }
        case MODE:
          fail('ACP v2 modes are configuration options')
          break
        case PROMPT:
          this.v2.accept(result)
          this.settleV2IfReady()
          projected = { messageId: this.v2.acceptedMessageId! }
          break
        case CLOSE:
          projected = {}
          break
        default:
          fail('ACP response has no matching request')
      }
      this.pending = undefined
      const afterResponse =
        this.pendingNotice && this.sessionId !== undefined ? this.noticeFrame() : undefined
      if (afterResponse) this.pendingNotice = false
      return freeze({
        toAdapter: response(id, projected),
        ...(afterResponse ? { afterResponse } : {}),
      })
    })
  }

  /** Protocol accounting only: whether `session/resume` returned success on the wire. */
  get hasAcceptedResume(): boolean {
    return this.resumeAccepted
  }

  /** Protocol accounting only: whether the peer failed the protocol policy. */
  get hasPeerFailed(): boolean {
    return this.peerFailed
  }

  /** Protocol accounting only: this does not establish process or Agent success. */
  get turnActive(): boolean {
    return this.pending?.method === PROMPT || this.v2?.waitingForCompletion === true
  }

  get hasProducedTurnOutput(): boolean {
    return this.textBytes > 0 || this.planOutputEmitted || this.v2?.hasOutput === true
  }

  /** Protocol accounting only: whether the pending prompt was explicitly rejected before insertion. */
  get hasExplicitPromptRejection(): boolean {
    return this.v2.hasRejected
  }

  /** Protocol accounting only: whether the pending prompt has been accepted, inserted, or started. */
  get hasAcceptedOrInsertedPrompt(): boolean {
    return this.promptRpcResultReceived || this.v2.hasAcceptedOrInserted
  }

  /** An owned, finally settled conversation, not a persistence receipt. */
  get settledSessionId(): string | undefined {
    this.assertSettled()
    return this.peerFailed || !this.promptSettled ? undefined : this.sessionId
  }

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
    let update = object(params.update)
    const notice = this.notice(update._meta)
    // Initial client notifications can precede session/new's response. They
    // cannot nominate our session or be exposed before its identity is known.
    if (
      this.sessionId === undefined &&
      (this.pending?.method === NEW || this.pending?.method === RESUME)
    ) {
      keys(params, ['sessionId', 'update'], ['_meta'])
      identifier(params.sessionId)
      object(params.update)
      if (notice) this.pendingNotice = true
      return Object.freeze({})
    }
    this.ownedSession(params, ['update'], ['_meta'])
    if (typeof update.sessionUpdate !== 'string') fail('Invalid ACP update')
    if (
      [
        'user_message',
        'user_message_chunk',
        'state_update',
        'agent_message',
        'agent_message_chunk',
      ].includes(update.sessionUpdate)
    ) {
      try {
        if (
          this.promptSettled &&
          (update.sessionUpdate !== 'state_update' || update.state !== 'idle')
        )
          fail('ACP v2 update attempted to reopen a settled turn')
        // Pinned Pi emits unaddressed retry/compaction progress chunks.
        // Give those chunks a bounded, host-owned turn ID at the native edge;
        // they remain counted as output and cannot authorize a replay.
        const foregroundUpdate =
          this.nativeClient === 'pi' &&
          update.sessionUpdate === 'agent_message_chunk' &&
          update.messageId === undefined &&
          this.turnActive
            ? {
                ...update,
                messageId: (this.piStatusMessageId ??= `jig-pi-status-${randomUUID()}`),
              }
            : update
        this.v2.update(foregroundUpdate)
        update = foregroundUpdate
        this.settleV2IfReady()
      } catch (error) {
        if (error instanceof PrivateAcpV2ForegroundError)
          fail('ACP v2 foreground protocol or work failed')
        throw error
      }
      if (
        update.sessionUpdate === 'user_message' ||
        update.sessionUpdate === 'user_message_chunk'
      ) {
        // Only the Agent-owned ID crosses. The native echoed user prompt
        // remains private to the invoked Flow and need not be replayed.
        return freeze({
          toAdapter: {
            jsonrpc: '2.0',
            method: UPDATE,
            params: {
              sessionId: this.sessionId!,
              update: {
                sessionUpdate: update.sessionUpdate,
                messageId: identifier(update.messageId),
              },
            },
          },
        })
      }
      if (update.sessionUpdate === 'state_update') {
        const reason = update.stopReason
        const projected: JsonObject = {
          sessionUpdate: 'state_update',
          state: update.state!,
          ...(typeof reason === 'string' ? { stopReason: reason } : {}),
        }
        return freeze({
          toAdapter: {
            jsonrpc: '2.0',
            method: UPDATE,
            params: { sessionId: this.sessionId!, update: projected },
          },
        })
      }
      if (update.sessionUpdate === 'agent_message') {
        const content = update.content
        const projected: JsonObject = {
          sessionUpdate: 'agent_message',
          messageId: identifier(update.messageId),
          ...(content === undefined
            ? {}
            : {
                content:
                  content === null
                    ? null
                    : (content as JsonValue[]).map((block) => ({
                        type: 'text',
                        text: object(block).text as string,
                      })),
              }),
        }
        return freeze({
          toAdapter: {
            jsonrpc: '2.0',
            method: UPDATE,
            params: { sessionId: this.sessionId!, update: projected },
          },
        })
      }
    }
    let projected: JsonObject
    if (notice) {
      projected = {
        sessionUpdate: 'session_info_update',
        _meta: { notice: { code: 'NATIVE_WARNING' } },
      }
    } else if (update.sessionUpdate === 'agent_message_chunk') {
      if (this.pending?.method !== PROMPT && this.v2.waitingForCompletion !== true)
        fail('ACP text arrived outside an active turn')
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
      if (this.pending?.method !== PROMPT && this.v2.waitingForCompletion !== true)
        fail('ACP plan arrived outside an active turn')
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
      this.planOutputEmitted = true
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

  private settleV2IfReady(): void {
    if (!this.v2?.waitingForCompletion || this.promptSettled) return
    try {
      this.v2.settle()
      this.promptSettled = true
    } catch (error) {
      if (error instanceof PrivateAcpV2ForegroundError) {
        if (error.kind === 'unsettled') return
        if (error.kind === 'stopped' && this.cancelSent && error.message.includes('cancelled')) {
          this.promptSettled = true
          return
        }
      }
      fail('Native ACP v2 work was not successfully settled')
    }
  }

  private noticeFrame(): JsonObject {
    return {
      jsonrpc: '2.0',
      method: UPDATE,
      params: {
        sessionId: this.sessionId!,
        update: {
          sessionUpdate: 'session_info_update',
          _meta: { notice: { code: 'NATIVE_WARNING' } },
        },
      },
    }
  }

  private notice(metadata: JsonValue | undefined): boolean {
    const air = optionalObject(optionalObject(optionalObject(metadata).jetbrains).air)
    if (air.sessionFailure === undefined || air.sessionFailure === null) return false
    if (air.version !== 1) fail('Unsupported native ACP diagnostic version')
    const notice = object(air.sessionFailure)
    // Never ignore an authoritative native error, including a late error or
    // one carried only on the correlated result. Raw titles/actions can hold
    // private paths or credentials and must not cross this boundary.
    if (notice.severity === 'error') {
      const category = nativeCategories.find((value) => value === notice.category)
      const status = notice.httpStatusCode
      throw new PrivateFiniteAcpPolicyError(
        'Native ACP reported a session failure',
        'native-session',
        category,
        category !== undefined &&
          typeof status === 'number' &&
          Number.isInteger(status) &&
          status >= 400 &&
          status <= 599
          ? status
          : undefined,
        category === undefined ? undefined : privateNativeSessionReportedReason(notice.title),
      )
    }
    if (notice.severity !== 'warning') fail('Invalid native ACP diagnostic severity')
    return true
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
