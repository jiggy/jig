import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import {
  FiniteAcpFrames,
  fragmentFiniteAcpFrame,
  readFiniteAcpReady,
} from '@jigging/agent-acp/transport'
import requestsDescriptor from '../../../../docs/jig/spec/contracts/finite-acp/requests.json' with {
  type: 'json',
}
import responsesDescriptor from '../../../../docs/jig/spec/contracts/finite-acp/responses.json' with {
  type: 'json',
}
import { parseChannelContract } from '../channel-contract.js'
import { canonicalJson, decodeJson1, type JsonObject, type JsonValue } from '../json.js'
import {
  CHANNEL_LIMITS,
  type ChannelDeclaration,
  type ChannelParticipant,
  type ResolvedChannelContract,
} from '../run/channels.js'
import type { PrivateAcpAgentRuntime } from './acp-agent-provider.js'
import type {
  PrivateExecutionComponentProcess,
  PrivateExecutionConfirmedEnforcementReceipt,
} from './execution-backend.js'
import {
  PRIVATE_FINITE_ACP_LIMITS,
  PrivateFiniteAcpPolicy,
  PrivateFiniteAcpPolicyError,
} from './finite-acp-policy.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
// Allow the adapter's bounded native shutdown (two seconds) to settle and
// report its actual exit before host fencing. Cancellation still interrupts.
const CLOSE_GRACE_MS = 3_000
const STDERR_BYTES = 65_536

function channel(value: JsonValue): ResolvedChannelContract {
  const parsed = parseChannelContract(canonicalJson(value))
  return Object.freeze({
    identity: Object.freeze({
      id: parsed.descriptor.id,
      version: parsed.descriptor.version,
      digest: parsed.digest,
    }),
    schema: parsed.descriptor.item,
    validate(item: JsonValue) {
      parsed.itemSchema.validate(item, 'INVALID_INPUT')
    },
  })
}

export const PRIVATE_FINITE_ACP_CHANNELS: Readonly<Record<string, ChannelDeclaration>> =
  Object.freeze({
    requests: Object.freeze({
      direction: 'receive',
      required: true,
      delivery: 'direct',
      contract: channel(requestsDescriptor as JsonValue),
    }),
    responses: Object.freeze({
      direction: 'send',
      required: true,
      delivery: 'direct',
      contract: channel(responsesDescriptor as JsonValue),
    }),
  })

export interface PrivateFiniteAcpEndpoints {
  readonly owner: ChannelParticipant
  readonly requests: string
  readonly responses: string
}

/** Data-plane seam only. The caller must admit, own, fence and release the process. */
export async function runPrivateFiniteAcpResource(
  component: PrivateExecutionComponentProcess,
  runtime: PrivateAcpAgentRuntime,
  endpoints: PrivateFiniteAcpEndpoints,
  signal: AbortSignal,
  maxTurns = 1,
  session?: {
    readonly bootstrap: Uint8Array
    readonly restoreSessionId?: string
    readonly credentialBootstrap?: Uint8Array
  },
): Promise<{
  readonly fence: PrivateExecutionConfirmedEnforcementReceipt
  readonly closed: boolean
  readonly sessionId?: string
}> {
  const local = new AbortController()
  const enforcement = component.enforcement.then(
    (receipt): PrivateExecutionConfirmedEnforcementReceipt => receipt,
  )
  const stopped = (): void => local.abort(signal.reason)
  const policy = new PrivateFiniteAcpPolicy({
    maxTurns,
    configuration: runtime.configuration,
    ...(runtime.modeId === undefined ? {} : { modeId: runtime.modeId }),
    ...(session?.restoreSessionId === undefined
      ? {}
      : { restoreSessionId: session.restoreSessionId }),
  })
  const ready = readFiniteAcpReady({
    kind: 'ready',
    protocolVersion: 1,
    cwd: '/work',
    maxTurns,
    configuration: runtime.configuration,
    ...(runtime.modeId === undefined ? {} : { modeId: runtime.modeId }),
    ...(session?.restoreSessionId === undefined
      ? {}
      : { restoreSessionId: session.restoreSessionId }),
  })
  // Validate before native startup; configuration is public policy, never auth.
  PRIVATE_FINITE_ACP_CHANNELS.responses!.contract!.validate(ready as unknown as JsonValue)
  if (canonicalJson(ready as unknown as JsonValue).byteLength > CHANNEL_LIMITS.itemBytes)
    invalid('Finite ACP ready record exceeds the channel item bound')
  signal.addEventListener('abort', stopped, { once: true })
  if (signal.aborted) stopped()
  const frames = new FiniteAcpFrames('requests')
  let writes = Promise.resolve()
  let closed = false
  let interruptTimer: ReturnType<typeof setTimeout> | undefined
  let initialize: JsonObject | undefined
  let authenticationId: string | undefined
  const tasks: Promise<unknown>[] = []
  const write = (value: JsonObject): Promise<void> => {
    const bytes = encoder.encode(`${JSON.stringify(value)}\n`)
    const pending = writes.then(async () => {
      local.signal.throwIfAborted()
      if (value.method === 'session/cancel' && !policy.turnActive) return
      await component.write(bytes)
    })
    writes = pending.catch(() => undefined)
    return pending
  }
  const send = async (value: JsonObject): Promise<void> => {
    for (const fragment of fragmentFiniteAcpFrame(decoder.decode(canonicalJson(value)))) {
      await endpoints.owner.send(
        endpoints.responses,
        fragment as unknown as JsonValue,
        local.signal,
      )
    }
  }
  const requests = async (): Promise<void> => {
    for (;;) {
      const item = object(await endpoints.owner.next(endpoints.requests, local.signal))
      if (Object.hasOwn(item, 'end')) break
      const text = frames.accept(object(item.item).value)
      if (text === undefined) continue
      if (authenticationId !== undefined) invalid('Private ACP authentication is not settled')
      // The finite policy is the final authority check before each native write.
      const accepted = policy.fromAdapter(encoder.encode(text))
      if (accepted.method === 'session/cancel') {
        // Native settlement may race the queued cancellation notification.
        // Consume an idle cancellation without sending it into a later turn.
        if (!policy.turnActive) continue
        interruptTimer = setTimeout(() => {
          local.abort(new Error('ACP interruption did not settle'))
          void component.terminate().catch(() => undefined)
        }, 5_000)
      }
      let native = accepted
      if (accepted.method === 'initialize') {
        native = {
          ...accepted,
          params: {
            ...(accepted.params as JsonObject),
            clientCapabilities: {
              // Request typed notices, never native warnings disguised as answer text.
              // This metadata grants no tools, filesystem or session-control powers.
              _meta: { jetbrains: { air: { version: 1, capabilities: ['sessionFailure'] } } },
              ...(runtime.authentication?.clientAuthCapabilities === undefined
                ? {}
                : {
                    auth: runtime.authentication.clientAuthCapabilities as unknown as JsonValue,
                  }),
            },
          },
        }
      } else if (accepted.method === 'session/new' && runtime.sessionMeta !== undefined) {
        native = {
          ...accepted,
          params: {
            ...(accepted.params as JsonObject),
            _meta: runtime.sessionMeta as unknown as JsonValue,
          },
        }
      }
      if (
        component.owner.kind === 'private-macos-prepared-owner/1' &&
        ['session/new', 'session/load'].includes(accepted.method as string)
      ) {
        native = {
          ...native,
          params: {
            ...(native.params as JsonObject),
            cwd: join(component.owner.owner.allocation.directory, 'data', 'work'),
          },
        }
      }
      await write(native)
    }
    frames.finish()
    policy.assertSettled()
    await writes
    await component.closeInput()
    const natural = await within(enforcement, CLOSE_GRACE_MS, local.signal)
    if (natural === undefined) {
      local.signal.throwIfAborted()
      closed = true
      await component.terminate()
    }
  }
  const responses = async (): Promise<void> => {
    for await (const bytes of nativeFrames(component.stdout)) {
      const raw = object(decodeJson1(bytes))
      if (authenticationId !== undefined && raw.id === authenticationId) {
        if (
          raw.jsonrpc !== '2.0' ||
          !Object.hasOwn(raw, 'result') ||
          Object.hasOwn(raw, 'error') ||
          Object.hasOwn(raw, 'method')
        )
          invalid('Native ACP authentication failed')
        object(raw.result)
        authenticationId = undefined
        const delivery = initialize!
        initialize = undefined
        await send(delivery)
        continue
      }
      if (runtime.authentication !== undefined && isInitializeReply(raw)) {
        // Authenticate on the private side before exposing the sanitized initialization.
        const result = object(raw.result)
        if (
          !Array.isArray(result.authMethods) ||
          !result.authMethods.some(
            (value) => object(value).id === runtime.authentication!.request.methodId,
          )
        )
          invalid('Native ACP authentication is unavailable')
        // Authenticate only a matched, already validated initialization reply.
        initialize = policy.fromClient(bytes).toAdapter!
        authenticationId = `jig-auth-${randomUUID()}`
        await write({
          jsonrpc: '2.0',
          id: authenticationId,
          method: 'authenticate',
          params: runtime.authentication.request as unknown as JsonValue,
        })
        continue
      }
      const delivery = policy.fromClient(bytes)
      if (!policy.turnActive && interruptTimer !== undefined) {
        clearTimeout(interruptTimer)
        interruptTimer = undefined
      }
      if (delivery.toClient !== undefined) await write(delivery.toClient)
      if (delivery.toAdapter !== undefined) await send(delivery.toAdapter)
      if (delivery.afterResponse !== undefined) await send(delivery.afterResponse)
    }
    if (authenticationId !== undefined) invalid('Native ACP authentication did not settle')
    policy.assertSettled()
    endpoints.owner.close(endpoints.responses)
  }
  let initializedReply = false
  function isInitializeReply(value: JsonObject): boolean {
    if (initializedReply || !Object.hasOwn(value, 'result') || value.method !== undefined)
      return false
    const result = object(value.result)
    if (result.protocolVersion !== 1) return false
    initializedReply = true
    return true
  }
  try {
    local.signal.throwIfAborted()
    const stderr = discard(component.stderr)
    track(stderr)
    // The trusted launcher consumes startup bytes before it starts the native client.
    const credential =
      session === undefined ? runtime.startupInput?.() : session.credentialBootstrap
    if (credential !== undefined) {
      try {
        await component.write(credential)
      } finally {
        credential.fill(0)
      }
    }
    if (session !== undefined) await component.write(session.bootstrap)
    await endpoints.owner.send(endpoints.responses, ready as unknown as JsonValue, local.signal)
    track(requests())
    track(responses())
    track(enforcement)
    await Promise.all(tasks)
    const sessionId = policy.settledSessionId
    return Object.freeze({
      fence: await enforcement,
      closed,
      ...(sessionId === undefined ? {} : { sessionId }),
    })
  } catch (error) {
    local.abort()
    endpoints.owner.failWriter(
      endpoints.responses,
      'DISCONNECTED',
      'Finite ACP transport did not complete',
    )
    await component.terminate().catch(() => undefined)
    await Promise.allSettled(tasks)
    throw error
  } finally {
    if (interruptTimer !== undefined) clearTimeout(interruptTimer)
    signal.removeEventListener('abort', stopped)
    local.abort()
  }
  function track(task: Promise<unknown>): void {
    tasks.push(task)
    void task.catch(() => {
      local.abort()
      void component.terminate().catch(() => undefined)
    })
  }
}

/** Native stdio is NDJSON, unlike the frame fragments exposed to the Flow. */
async function* nativeFrames(source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  let buffer = new Uint8Array(8_192)
  let length = 0
  let total = 0
  let count = 0
  for await (const chunk of source) {
    total += chunk.byteLength
    if (total > PRIVATE_FINITE_ACP_LIMITS.clientBytes)
      invalid('Native ACP output exceeds its bound')
    let start = 0
    for (let index = 0; index < chunk.byteLength; index++) {
      if (chunk[index] !== 10) continue
      append(chunk.subarray(start, index))
      const line = buffer.slice(0, length)
      length = 0
      start = index + 1
      if (line.byteLength === 0) invalid('Native ACP emitted an empty frame')
      if (++count > PRIVATE_FINITE_ACP_LIMITS.clientFrames)
        invalid('Native ACP frame capacity exceeded')
      yield line
    }
    append(chunk.subarray(start))
  }
  if (length !== 0) invalid('Native ACP ended inside a frame')
  function append(bytes: Uint8Array): void {
    const required = length + bytes.byteLength
    if (required > PRIVATE_FINITE_ACP_LIMITS.frameBytes)
      invalid('Native ACP frame exceeds its bound')
    if (required > buffer.byteLength) {
      const grown = new Uint8Array(
        Math.min(PRIVATE_FINITE_ACP_LIMITS.frameBytes, Math.max(required, buffer.byteLength * 2)),
      )
      grown.set(buffer.subarray(0, length))
      buffer = grown
    }
    buffer.set(bytes, length)
    length = required
  }
}

async function discard(source: AsyncIterable<Uint8Array>): Promise<void> {
  let bytes = 0
  for await (const chunk of source) {
    bytes += chunk.byteLength
    if (bytes > STDERR_BYTES) invalid('Native ACP diagnostics exceed their bound')
  }
}

async function within<T>(
  pending: Promise<T>,
  milliseconds: number,
  signal: AbortSignal,
): Promise<T | undefined> {
  signal.throwIfAborted()
  let cancelTimer = (): void => {}
  let removeAbort = (): void => {}
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        removeAbort = () => signal.removeEventListener('abort', abort)
      }),
      new Promise<undefined>((resolve) => {
        const timer = setTimeout(resolve, milliseconds)
        cancelTimer = () => clearTimeout(timer)
      }),
    ])
  } finally {
    cancelTimer()
    removeAbort()
  }
}

function object(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    invalid('Invalid native ACP frame')
  return value as JsonObject
}

function invalid(message: string): never {
  throw new PrivateFiniteAcpPolicyError(message)
}
