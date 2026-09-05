import * as acp from '@agentclientprotocol/sdk'

import type { ExactComponentProcess } from '../run/session.js'

const ACP_PROTOCOL_BYTES = 32 * 1024 * 1024
const ACP_UPDATE_COUNT = 4_096
const ACP_INSTRUCTION_BYTES = 1_048_576
const ACP_TEXT_BYTES = 8_388_608
const encoder = new TextEncoder()

export interface PrivateAcpTurnRequest {
  readonly cwd: string
  readonly instructions: string
  readonly signal?: AbortSignal
  readonly sessionMeta?: Readonly<Record<string, unknown>>
  readonly configuration?: readonly PrivateAcpSessionConfiguration[]
  readonly modeId?: string
  readonly authentication?: {
    readonly request: acp.AuthenticateRequest
    readonly clientAuthCapabilities?: NonNullable<acp.ClientCapabilities['auth']>
  }
}

export type PrivateAcpSessionConfiguration =
  | {
      readonly configId: string
      readonly value: string
    }
  | {
      readonly configId: string
      readonly type: 'boolean'
      readonly value: boolean
    }

export interface PrivateAcpTurnResult {
  readonly stopReason: acp.StopReason
  readonly text: string
}

/**
 * Run one headless ACP v1 turn. The native agent owns its tools inside the
 * caller-provided containment envelope; Jig exposes no editor filesystem or
 * terminal capability and never grants a persistent permission.
 */
export async function runPrivateAcpTurn(
  stream: acp.Stream,
  request: PrivateAcpTurnRequest,
): Promise<PrivateAcpTurnResult> {
  requireTurnRequest(request)
  let updateCount = 0
  let text = ''
  let textBytes = 0

  const app = acp
    .client({ name: 'jig' })
    .onRequest(acp.methods.client.session.requestPermission, ({ agent, params }) => {
      if (request.signal?.aborted) {
        return { outcome: { outcome: 'cancelled' as const } }
      }
      const rejected = params.options.find(({ kind }) => kind === 'reject_once')
      if (rejected !== undefined) {
        return { outcome: { outcome: 'selected' as const, optionId: rejected.optionId } }
      }
      void agent
        .notify(acp.methods.agent.session.cancel, { sessionId: params.sessionId })
        .catch(() => undefined)
      return { outcome: { outcome: 'cancelled' as const } }
    })

  return await app.connectWith(stream, async (agent) => {
    const initialized = await agent.request(
      acp.methods.agent.initialize,
      {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities:
          request.authentication?.clientAuthCapabilities === undefined
            ? {}
            : { auth: request.authentication.clientAuthCapabilities },
        clientInfo: { name: 'jig', version: '1' },
      },
      cancellationOptions(request.signal),
    )
    if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
      throw new PrivateAcpProtocolError('the ACP agent selected an unsupported protocol version')
    }
    if (request.authentication !== undefined) {
      const methodId = request.authentication.request.methodId
      if (!initialized.authMethods?.some(({ id }) => id === methodId)) {
        throw new PrivateAcpProtocolError(
          'the ACP agent did not advertise the required authentication method',
        )
      }
      await agent.request(
        acp.methods.agent.authenticate,
        request.authentication.request,
        cancellationOptions(request.signal),
      )
    }

    const canClose = initialized.agentCapabilities?.sessionCapabilities?.close != null
    const session = await agent
      .buildSession({
        cwd: request.cwd,
        mcpServers: [],
        ...(request.sessionMeta === undefined ? {} : { _meta: request.sessionMeta }),
      })
      .start(cancellationOptions(request.signal))
    try {
      for (const option of request.configuration ?? []) {
        const configured = await agent.request(
          acp.methods.agent.session.setConfigOption,
          {
            sessionId: session.sessionId,
            ...option,
          },
          cancellationOptions(request.signal),
        )
        const current = configured.configOptions.find(({ id }) => id === option.configId)
        if (current === undefined || current.currentValue !== option.value) {
          throw new PrivateAcpProtocolError(
            'the ACP agent did not apply the required session configuration',
          )
        }
      }
      if (request.modeId !== undefined) {
        await agent.request(
          acp.methods.agent.session.setMode,
          {
            sessionId: session.sessionId,
            modeId: request.modeId,
          },
          cancellationOptions(request.signal),
        )
      }
      const cancel = (): void => {
        void agent
          .notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId })
          .catch(() => undefined)
      }
      request.signal?.addEventListener('abort', cancel, { once: true })
      try {
        const prompt = session.prompt(request.instructions, cancellationOptions(request.signal))
        for (;;) {
          const message = await session.nextUpdate()
          if (message.kind === 'stop') {
            await prompt
            return Object.freeze({ stopReason: message.stopReason, text })
          }
          updateCount += 1
          if (updateCount > ACP_UPDATE_COUNT) {
            throw new PrivateAcpProtocolError('the ACP agent exceeded its update limit')
          }
          const update = message.update
          if (update.sessionUpdate !== 'agent_message_chunk' || update.content.type !== 'text')
            continue
          const bytes = encoder.encode(update.content.text).byteLength
          if (textBytes + bytes > ACP_TEXT_BYTES) {
            throw new PrivateAcpProtocolError('the ACP agent exceeded its text limit')
          }
          textBytes += bytes
          text += update.content.text
        }
      } finally {
        request.signal?.removeEventListener('abort', cancel)
      }
    } finally {
      session.dispose()
      if (canClose) {
        await boundedClose(
          agent.request(acp.methods.agent.session.close, { sessionId: session.sessionId }),
        )
      }
    }
  })
}

/** Adapt one already-contained Jig component to ACP's bounded NDJSON stream. */
export function privateAcpComponentStream(component: ExactComponentProcess): acp.Stream {
  let readBytes = 0
  const iterator = component.stdout[Symbol.asyncIterator]()
  const input = new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      try {
        const item = await iterator.next()
        if (item.done) {
          controller.close()
          return
        }
        readBytes += item.value.byteLength
        if (readBytes > ACP_PROTOCOL_BYTES) {
          throw new PrivateAcpProtocolError('the ACP agent exceeded its protocol byte limit')
        }
        controller.enqueue(item.value.slice())
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel(): Promise<void> {
      await iterator.return?.()
    },
  })
  const output = new WritableStream<Uint8Array>({
    async write(bytes): Promise<void> {
      await component.write(bytes.slice())
    },
    async close(): Promise<void> {
      await component.closeInput()
    },
    async abort(): Promise<void> {
      await component.terminate()
    },
  })
  return acp.ndJsonStream(output, input)
}

export class PrivateAcpProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrivateAcpProtocolError'
  }
}

function requireTurnRequest(request: PrivateAcpTurnRequest): void {
  if (
    !request.cwd.startsWith('/') ||
    request.cwd.includes('\0') ||
    request.instructions.length === 0 ||
    request.instructions.includes('\0') ||
    encoder.encode(request.instructions).byteLength > ACP_INSTRUCTION_BYTES ||
    (request.configuration?.length ?? 0) > 16 ||
    request.configuration?.some(
      ({ configId, value }) =>
        !validIdentifier(configId) || (typeof value === 'string' && !validIdentifier(value)),
    ) ||
    (request.modeId !== undefined && !validIdentifier(request.modeId))
  ) {
    throw new PrivateAcpProtocolError('the ACP turn request is invalid')
  }
}

function validIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 1_024 && !value.includes('\0')
}

function cancellationOptions(signal: AbortSignal | undefined): acp.SendRequestOptions {
  return signal === undefined ? {} : { cancellationSignal: signal }
}

async function boundedClose(closing: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      closing,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 500)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    void closing.catch(() => undefined)
  }
}
