import {
  privateCliHeading,
  privateCliSecondary,
  privateCliStyleEnabled,
} from './cli-presentation.js'

/** One bounded active line on terminal stderr; never infers completed work. */
export class PrivateCliProgress {
  #stage = ''
  #started = performance.now()
  #timer: ReturnType<typeof setInterval> | undefined
  #cancelled = false
  #visible = false
  readonly #abort = () => {
    this.pause()
    this.#cancelled = true
    this.#stage = 'Cancellation requested; waiting for work to stop and clean up'
    this.#started = performance.now()
    this.#write()
  }

  constructor(
    readonly enabled: boolean,
    readonly write: (text: string) => void,
    readonly signal?: AbortSignal,
    readonly animated = privateCliStyleEnabled(enabled),
    readonly columns: () => number = () => process.stderr.columns || 80,
  ) {}

  stage(value: string): void {
    if (!this.enabled || this.#cancelled || value === this.#stage) return
    this.pause()
    if (this.#timer === undefined) {
      this.signal?.addEventListener('abort', this.#abort, { once: true })
      if (this.animated) {
        this.#timer = setInterval(() => this.#write(), 1_000)
        this.#timer.unref()
      }
    }
    this.#stage = value
    this.#started = performance.now()
    if (this.signal?.aborted) this.#abort()
    else this.#write()
  }

  /** Finish the line before another writer, a prompt, or a terminal result. */
  pause(): void {
    if (this.#visible) this.write('\r\u001b[2K')
    if (this.#stage && this.animated) this.write(`  - ${this.#stage}\n`)
    this.#visible = false
    this.#stage = ''
  }

  /** A complete notice preserves the known active stage and its heartbeat. */
  notice(value: string): void {
    if (this.#visible) this.write('\r\u001b[2K')
    this.#visible = false
    this.write(value)
    if (this.animated) this.#write()
  }

  complete(timing = false): void {
    if (this.#cancelled) {
      this.pause()
      return
    }
    if (!this.#stage) return
    if (this.#visible) this.write('\r\u001b[2K')
    if (this.animated)
      this.write(
        `${privateCliHeading('  ✓', 'success', true)} ${privateCliSecondary(this.#stage + (timing ? ` (${((performance.now() - this.#started) / 1000).toFixed(1)}s)` : ''), true)}\n`,
      )
    this.#visible = false
    this.#stage = ''
  }

  note(value: string): void {
    this.pause()
    if (this.enabled) this.write(`${value}\n`)
  }

  close(): void {
    this.pause()
    clearInterval(this.#timer)
    this.#timer = undefined
    this.signal?.removeEventListener('abort', this.#abort)
  }

  #write(): void {
    if (!this.#stage) return
    if (!this.animated) {
      this.write(`  - ${this.#stage}\n`)
      return
    }
    const elapsed = ` ${((performance.now() - this.#started) / 1000).toFixed(0)}s`
    const width = Math.max(1, this.columns() - elapsed.length - 5)
    const label =
      this.#stage.length > width
        ? width < 4
          ? '.'.repeat(width)
          : `${this.#stage.slice(0, width - 3)}...`
        : this.#stage
    this.write(`\r\u001b[2K  … ${label}${privateCliSecondary(elapsed, true)}`)
    this.#visible = true
  }
}
