/** Jig borrows the real input stream; the renderer receives only owned bytes. */
export class PrivateTuiInput {
  #active = false
  #captured = false
  #ended = false
  #settled = false
  #raw = false
  #paused = true
  #resolve: (() => void) | undefined
  readonly #data = (bytes: Buffer) => {
    try {
      this.consume(bytes)
    } catch {
      this.leave()
    }
  }
  readonly #end = () => this.leave()

  constructor(
    readonly input: NodeJS.ReadStream,
    readonly consume: (bytes: Uint8Array) => void,
    readonly onLeave: () => void,
    readonly onInterrupt: () => void,
    readonly onRestorationFailure: () => void,
  ) {}
  get active(): boolean {
    return this.#active
  }
  capture(): void {
    if (this.#captured) return
    this.#captured = true
    this.#raw = this.input.isRaw
    this.#paused = this.input.isPaused() || this.input.readableFlowing !== true
  }
  start(): void {
    if (this.#active || this.#ended) return
    this.capture()
    this.#active = true
    try {
      this.input.setRawMode(true)
      this.input.on('data', this.#data)
      this.input.once('end', this.#end)
      this.input.once('close', this.#end)
      this.input.once('error', this.#end)
      this.input.resume()
    } catch (error) {
      this.leave()
      throw error
    }
  }
  action(action: 'close' | 'interrupt'): void {
    if (this.#ended) return
    try {
      if (action === 'interrupt' && !this.#settled) this.onInterrupt()
    } finally {
      this.leave()
    }
  }
  markSettled(): void {
    this.#settled = true
  }
  async settled(): Promise<void> {
    this.markSettled()
    if (this.#active)
      await new Promise<void>((resolve) => {
        this.#resolve = resolve
      })
  }
  leave(): void {
    if (this.#ended) return
    this.#ended = true
    if (this.#active) {
      this.#active = false
      this.input.removeListener('data', this.#data)
      this.input.removeListener('end', this.#end)
      this.input.removeListener('close', this.#end)
      this.input.removeListener('error', this.#end)
      let failed = false
      try {
        this.input.setRawMode(this.#raw)
      } catch {
        failed = true
      }
      try {
        if (this.#paused) this.input.pause()
        else this.input.resume()
      } catch {
        failed = true
      }
      if (failed) {
        try {
          this.onRestorationFailure()
        } finally {
          this.#finish()
        }
        return
      }
    }
    this.#finish()
  }
  #finish(): void {
    this.#resolve?.()
    this.#resolve = undefined
    this.onLeave()
  }
}
