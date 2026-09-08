import type { Writable } from 'node:stream'

/** Bounded command output; a blocked or disconnected pipe cancels owned work. */
export class PrivateCliOutput {
  private bytes = 0
  private readonly pending = new Set<Promise<void>>()
  private readonly settlements = new Set<(error: Error) => void>()
  private failure: Error | undefined
  constructor(
    private readonly stream: Writable,
    private readonly stop: AbortController,
  ) {
    stream.on('error', this.failed)
  }

  write(text: string): Promise<void> {
    const bytes = Buffer.byteLength(text)
    if (this.failure !== undefined) return Promise.reject(this.failure)
    if (bytes === 0) return Promise.resolve()
    if (this.bytes + bytes > 20 * 1024 * 1024 || this.settlements.size >= 256) {
      this.failed(new Error('command output capacity exceeded'))
      return Promise.reject(this.failure)
    }
    this.bytes += bytes
    const pending = new Promise<void>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => finish(new Error('command output delivery timed out')), 1_000)
      const finish = (error?: Error | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.settlements.delete(finish)
        this.bytes -= bytes
        if (error != null) {
          this.failed(error)
          reject(error)
        } else resolve()
      }
      this.settlements.add(finish)
      try {
        this.stream.write(text, finish)
      } catch (error) {
        finish(error as Error)
      }
    })
    this.pending.add(pending)
    void pending.finally(() => this.pending.delete(pending)).catch(() => undefined)
    return pending
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.pending)
    if (this.failure !== undefined) throw this.failure
  }

  private readonly failed = (error: Error): void => {
    if (this.failure !== undefined) return
    this.failure = error
    this.stop.abort()
    for (const finish of [...this.settlements]) finish(error)
  }
}
