import type { ChannelSender, JsonValue } from '@jigging/flow'

const encoder = new TextEncoder()
const MAX_ITEMS = 16
const MAX_BYTES = 262_144
const SEND_WAIT_MS = 500

/** Optional presentation never backpressures the essential ACP conversation. */
export class OptionalUpdates {
  private readonly stopped = new AbortController()
  private readonly queue: { value: JsonValue; bytes: number }[] = []
  private bytes = 0
  private pumping: Promise<void> | undefined
  private incomplete = false

  constructor(
    private readonly sender: ChannelSender | undefined,
    private readonly signal: AbortSignal,
  ) {}

  offer(value: JsonValue): void {
    if (!this.sender || this.incomplete || this.signal.aborted) return
    const bytes = encoder.encode(JSON.stringify(value)).byteLength
    if (bytes > 65_536 || this.queue.length >= MAX_ITEMS || this.bytes + bytes > MAX_BYTES) {
      this.stop()
      return
    }
    this.queue.push({ value, bytes })
    this.bytes += bytes
    this.pumping ??= this.pump()
  }

  async finish(): Promise<void> {
    await this.pumping
    if (!this.sender) return
    try {
      await this.sender.close(this.incomplete ? { error: 'LAGGED' } : undefined)
    } catch {
      this.stop()
    }
  }

  private async pump(): Promise<void> {
    try {
      while (this.queue.length && !this.incomplete) {
        const item = this.queue[0]!
        const timer = new AbortController()
        const timeout = setTimeout(() => timer.abort(), SEND_WAIT_MS)
        try {
          await this.sender!.send(item.value, {
            signal: AbortSignal.any([this.signal, this.stopped.signal, timer.signal]),
          })
        } finally {
          clearTimeout(timeout)
        }
        if (!this.incomplete) {
          this.queue.shift()
          this.bytes -= item.bytes
        }
      }
    } catch {
      this.stop()
    } finally {
      this.pumping = undefined
    }
  }

  private stop(): void {
    if (this.incomplete) return
    this.incomplete = true
    this.queue.length = 0
    this.bytes = 0
    this.stopped.abort()
    console.error('Agent progress is incomplete; the execution result remains separate.')
  }
}
