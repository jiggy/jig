/** Optional terminal controls for the browser inspector; never reads piped input. */
export class PrivateWebInput {
  #active = false
  #settled = false
  #raw = false
  #paused = true
  #escape: ReturnType<typeof setTimeout> | undefined
  #sequence = false
  readonly #data = (bytes: Buffer | string) => {
    // Only a few literal controls are owned. Bound a malicious pasted chunk;
    // arrow/escape sequences must not turn into an accidental inspector exit.
    const text = typeof bytes === 'string' ? bytes : bytes.toString('utf8')
    if (text.includes('\u0003')) {
      if (!this.#settled) this.cancel()
      this.leave()
      return
    }
    for (const character of text.slice(0, 4096)) {
      if (!this.#active) break
      if (this.#escape !== undefined) {
        clearTimeout(this.#escape)
        this.#escape = undefined
        if (character === '[' || character === 'O') {
          this.#sequence = true
          continue
        }
        this.leave()
        break
      }
      if (this.#sequence) {
        if (/[A-Za-z~]/.test(character)) this.#sequence = false
        continue
      }
      if (character === '\u001b') {
        this.#escape = setTimeout(() => {
          this.#escape = undefined
          this.leave()
        }, 30)
      } else if (character === 'q' || character === '\u0004') this.leave()
      else if (character === '\u0003') {
        if (!this.#settled) this.cancel()
        this.leave()
      }
    }
  }
  readonly #ended = () => this.leave()
  constructor(
    readonly input: NodeJS.ReadStream,
    readonly close: () => void,
    readonly cancel: () => void,
  ) {}
  get active(): boolean {
    return this.#active
  }
  markSettled(): void {
    this.#settled = true
  }
  start(): boolean {
    if (this.#active) return true
    if (!this.input.isTTY || typeof this.input.setRawMode !== 'function') return false
    this.#raw = this.input.isRaw
    this.#paused = this.input.isPaused() || this.input.readableFlowing !== true
    this.#active = true
    try {
      this.input.setRawMode(true)
      this.input.on('data', this.#data)
      this.input.once('end', this.#ended)
      this.input.once('close', this.#ended)
      this.input.once('error', this.#ended)
      this.input.resume()
      return true
    } catch {
      this.restore()
      return false
    }
  }
  leave(): void {
    if (!this.#active) return
    this.restore()
    this.close()
  }
  restore(): void {
    clearTimeout(this.#escape)
    this.#escape = undefined
    this.#sequence = false
    if (!this.#active) return
    this.#active = false
    this.input.removeListener('data', this.#data)
    this.input.removeListener('end', this.#ended)
    this.input.removeListener('close', this.#ended)
    this.input.removeListener('error', this.#ended)
    try {
      this.input.setRawMode(this.#raw)
    } catch {}
    if (this.#paused) this.input.pause()
    else this.input.resume()
  }
}
