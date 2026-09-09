/** Plain terminal status. Never writes to stdout or infers application success. */
export class PrivateCliProgress {
  #stage = ''
  #started = performance.now()
  #timer?: ReturnType<typeof setInterval>
  #cancelled = false
  readonly #abort = () => {
    this.#cancelled = true
    this.#stage = 'Cancellation requested; waiting for owned work to stop and clean up'
    this.#write()
  }

  constructor(
    readonly enabled: boolean,
    readonly write: (text: string) => void,
    readonly signal?: AbortSignal,
  ) {}

  stage(value: string): void {
    if (!this.enabled || this.#cancelled || value === this.#stage) return
    if (this.#timer === undefined) {
      this.#started = performance.now()
      this.signal?.addEventListener('abort', this.#abort, { once: true })
      this.#timer = setInterval(() => this.#write(), 10_000)
      this.#timer.unref()
    }
    this.#stage = value
    if (this.signal?.aborted) this.#abort()
    else this.#write()
  }

  note(value: string): void {
    if (this.enabled) this.write(`${value}\n`)
  }

  close(): void {
    clearInterval(this.#timer)
    this.signal?.removeEventListener('abort', this.#abort)
  }

  #write(): void {
    this.write(`[${((performance.now() - this.#started) / 1000).toFixed(1)}s] ${this.#stage}\n`)
  }
}
