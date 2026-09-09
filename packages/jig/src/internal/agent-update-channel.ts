import descriptor from '../../../../docs/jig/spec/contracts/acp-public-updates.json' with {
  type: 'json',
}
import { parseChannelContract } from '../channel-contract.js'
import { canonicalJson, decodeJson1, type JsonValue } from '../json.js'
import {
  ChannelOperationError,
  type ChannelDeclaration,
  type ChannelParticipant,
  type ResolvedChannelContract,
} from '../run/channels.js'

const parsed = parseChannelContract(canonicalJson(descriptor as JsonValue))
export const ACP_PUBLIC_UPDATES: ResolvedChannelContract = Object.freeze({
  identity: Object.freeze({
    id: parsed.descriptor.id,
    version: parsed.descriptor.version,
    digest: parsed.digest,
  }),
  schema: parsed.descriptor.item,
  validate(value: JsonValue) {
    parsed.itemSchema.validate(value, 'INVALID_INPUT')
  },
})

export const PRIVATE_AGENT_UPDATE_CHANNELS: Readonly<Record<string, ChannelDeclaration>> =
  Object.freeze({
    events: Object.freeze({
      direction: 'send',
      required: false,
      contract: ACP_PUBLIC_UPDATES,
    }),
  })

/** Nonblocking ACP ingress; a failed projection never stalls the ACP reader. */
export class PrivateAgentUpdateChannel {
  private readonly queue: { value: JsonValue; bytes: number }[] = []
  private bytes = 0
  private pending: Promise<void> | undefined
  private stopped = false
  constructor(
    private readonly owner: ChannelParticipant,
    private readonly endpoint: string,
    private readonly signal: AbortSignal,
  ) {}

  offer(value: JsonValue): void {
    if (this.stopped) return
    try {
      ACP_PUBLIC_UPDATES.validate(value)
      const encoded = canonicalJson(value)
      const bytes = encoded.byteLength
      if (bytes > 65_536 || this.queue.length >= 16 || this.bytes + bytes > 262_144) {
        this.fail('LAGGED', 'native update ingress exceeded its bounded capacity')
        return
      }
      this.queue.push({ value: decodeJson1(encoded), bytes })
      this.bytes += bytes
      this.pending ??= this.drain()
    } catch {
      this.fail('INVALID_RESULT', 'native update is not a supported public value')
    }
  }

  async finish(): Promise<void> {
    await this.pending
    if (!this.stopped) {
      this.stopped = true
      try {
        this.owner.close(this.endpoint)
      } catch {
        /* Receiver disposal is independent of the Agent result. */
      }
    }
  }

  abort(): void {
    this.fail('DISCONNECTED', 'Agent update production ended without a complete interval')
  }

  private fail(code: ChannelOperationError['code'], message: string): void {
    this.stopped = true
    this.queue.length = 0
    this.bytes = 0
    this.owner.failWriter(this.endpoint, code, message)
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length && !this.stopped) {
        const item = this.queue[0]!
        await this.owner.send(this.endpoint, item.value, this.signal)
        if (this.stopped) return
        this.queue.shift()
        this.bytes -= item.bytes
      }
    } catch (error) {
      this.fail(
        error instanceof ChannelOperationError ? error.code : 'DISCONNECTED',
        'Agent update delivery stopped before the selected interval completed',
      )
    } finally {
      this.pending = undefined
    }
  }
}
