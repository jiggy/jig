import { type ChannelSender, type JsonValue, OperationError, type RunContext } from '@jigging/flow'
import {
  canonicalUserUpdate,
  USER_UPDATES_LIMITS as limits,
  type Progress,
  USER_UPDATES_CONTRACT,
  type UserUpdate,
  validateUserUpdate,
} from './message.js'

export interface UserUpdates {
  notice(text: string): void
  activity(id: string, label: string, progress?: Progress): void
  clear(id: string): void
}

const claims = new WeakSet<ChannelSender>()
type Item = { value: UserUpdate; bytes: number }
type Outcome = { ok: true } | { ok: false; error: unknown }
const settle = (promise: Promise<void>): Promise<Outcome> =>
  promise.then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error }),
  )

class Publisher implements UserUpdates {
  #phase: 'accepting' | 'draining' | 'finished' = 'accepting'
  #enabled: boolean
  #queue: Item[] = []
  #retained = 0
  #bytes = 0
  #attempts = 0
  #traffic = 0
  #notices = 0
  #noticeBytes = 0
  #keys = new Set<string>()
  #pump: Promise<void> | undefined
  #close: Promise<Outcome> | undefined
  #failure: unknown
  #failed = false
  #nextSend = 0
  #wake = new Set<() => void>()
  readonly #abort = () => this.#stop()

  constructor(
    readonly sender: ChannelSender | undefined,
    readonly signal: AbortSignal,
  ) {
    this.#enabled = sender !== undefined && !signal.aborted
    signal.addEventListener('abort', this.#abort, { once: true })
  }

  notice(text: string): void {
    this.#offer({ kind: 'notice', text })
  }
  activity(id: string, label: string, progress?: Progress): void {
    this.#offer({ kind: 'activity', id, label, ...(progress === undefined ? {} : { progress }) })
  }
  clear(id: string): void {
    this.#offer({ kind: 'clear', id })
  }

  #offer(input: unknown): void {
    const value = validateUserUpdate(input)
    const bytes = Buffer.byteLength(canonicalUserUpdate(value))
    if (this.#phase !== 'accepting')
      throw new Error('User updates scope is no longer accepting offers')
    if (!this.#enabled) return
    const tail = this.#queue.at(-1)
    const replace =
      value.kind === 'activity' && tail?.value.kind === 'activity' && tail.value.id === value.id
    const previousBytes = replace ? tail.bytes : 0
    if (value.kind === 'notice') {
      this.#notices++
      this.#noticeBytes += bytes
      if (this.#notices > limits.notices || this.#noticeBytes > limits.noticeBytes) {
        this.#stop()
        return
      }
    }
    if (value.kind === 'activity') {
      this.#keys.add(value.id)
      if (this.#keys.size > limits.slots) {
        this.#stop()
        return
      }
    } else if (value.kind === 'clear') this.#keys.delete(value.id)
    if (
      this.#retained + (replace ? 0 : 1) > limits.retainedItems ||
      this.#bytes - previousBytes + bytes > limits.retainedBytes
    ) {
      this.#stop()
      return
    }
    const item = { value, bytes }
    if (replace) this.#queue[this.#queue.length - 1] = item
    else {
      this.#queue.push(item)
      this.#retained++
    }
    this.#bytes += bytes - previousBytes
    this.#start()
  }

  #start(): void {
    if (this.#pump !== undefined) return
    // Admission remains synchronous; dispatch starts after adjacent offers can coalesce.
    this.#pump = Promise.resolve()
      .then(() => this.#run())
      .catch((error) => {
        this.#remember(error)
        this.#stop()
      })
      .finally(() => {
        this.#pump = undefined
        if (this.#enabled && this.#queue.length) this.#start()
      })
  }

  #remember(error: unknown): void {
    if (!this.#failed) {
      this.#failure = error
      this.#failed = true
    }
  }

  #inspect(outcome: Outcome): void {
    if (outcome.ok) return
    if (
      outcome.error instanceof OperationError &&
      (outcome.error.code === 'LAGGED' || outcome.error.code === 'DISCONNECTED')
    )
      return
    this.#remember(outcome.error)
  }

  #stop(): void {
    if (!this.#enabled) return
    this.#enabled = false
    for (const item of this.#queue) {
      this.#retained--
      this.#bytes -= item.bytes
    }
    this.#queue = []
    this.#keys.clear()
    for (const wake of this.#wake) wake()
    if (this.sender !== undefined && this.#close === undefined) {
      // This control operation is concurrent with the original send and never replaces it.
      this.#close = settle(Promise.resolve().then(() => this.sender!.close({ error: 'LAGGED' })))
    }
  }

  async #delay(ms: number): Promise<void> {
    if (ms <= 0 || !this.#enabled) return
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        this.#wake.delete(done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      this.#wake.add(done)
    })
  }

  async #run(): Promise<void> {
    while (this.#enabled && this.#queue.length) {
      await this.#delay(this.#nextSend - performance.now())
      if (!this.#enabled) break
      const item = this.#queue.shift()!
      this.#attempts++
      this.#traffic += item.bytes
      if (this.#attempts > limits.attempts || this.#traffic > limits.trafficBytes) {
        this.#retained--
        this.#bytes -= item.bytes
        this.#stop()
        break
      }
      this.#nextSend = performance.now() + limits.intervalMs
      const original = settle(
        Promise.resolve().then(() => this.sender!.send(item.value as JsonValue)),
      )
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), limits.sendWaitMs)
      })
      const first = await Promise.race([original, timeout])
      clearTimeout(timer)
      if (first === 'timeout') this.#stop()
      const outcome = first === 'timeout' ? await original : first
      this.#retained--
      this.#bytes -= item.bytes
      this.#inspect(outcome)
      if (!outcome.ok) this.#stop()
    }
  }

  async finish(): Promise<void> {
    if (this.#phase === 'finished') return
    this.#phase = 'draining'
    let timer: ReturnType<typeof setTimeout> | undefined
    if (this.#pump !== undefined) {
      timer = setTimeout(() => this.#stop(), limits.drainMs)
      await this.#pump
      clearTimeout(timer)
    }
    if (this.sender !== undefined && this.#close === undefined)
      this.#close = settle(Promise.resolve().then(() => this.sender!.close()))
    if (this.#close !== undefined) this.#inspect(await this.#close)
    this.#phase = 'finished'
    this.#enabled = false
    this.#keys.clear()
    this.signal.removeEventListener('abort', this.#abort)
    this.signal.throwIfAborted()
    if (this.#failed) throw this.#failure
  }
}

/** Own one optional writer for the body and settle all publisher operations before returning. */
export async function withUserUpdates<T>(
  run: Pick<RunContext, 'channels' | 'signal'>,
  channel: string,
  body: (updates: UserUpdates) => T | Promise<T>,
): Promise<T> {
  const endpoint = run.channels[channel]
  if (endpoint !== undefined) {
    const expected = USER_UPDATES_CONTRACT
    if (
      endpoint.direction !== 'send' ||
      endpoint.contract?.id !== expected.id ||
      endpoint.contract.version !== expected.version ||
      endpoint.contract.digest !== expected.digest
    )
      throw new TypeError('User updates requires a sender with the exact supported contract')
    if (claims.has(endpoint)) throw new Error('User updates writer already has a scope owner')
    claims.add(endpoint)
  }
  const publisher = new Publisher(endpoint as ChannelSender | undefined, run.signal)
  let result!: T
  let primary: unknown
  let bodyFailed = false
  try {
    result = await body(publisher)
  } catch (error) {
    primary = error
    bodyFailed = true
  }
  try {
    await publisher.finish()
  } catch (error) {
    if (run.signal.aborted) throw error
    if (!bodyFailed) throw error
    console.error('User updates publisher also failed; the application error remains primary.')
  }
  // A used endpoint cannot be wrapped again, even after this scope ends.
  if (bodyFailed) throw primary
  return result
}
