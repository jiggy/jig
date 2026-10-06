import {
  privateCliHeading,
  privateCliSecondary,
  privateCliStyleEnabled,
} from './cli-presentation.js'
import {
  PrivateCliUserUpdates,
  type PrivateUserUpdateSource,
  privateTerminalWidth,
  privateTruncateUpdate,
} from './cli-user-updates.js'

type WriteJob = {
  readonly bytes: number
  readonly transient: boolean
  readonly dispatch: () => void | Promise<void>
}

/** One bounded active line on terminal stderr; never infers completed work. */
export class PrivateCliProgress {
  #stage = ''
  #started = performance.now()
  #timer: ReturnType<typeof setInterval> | undefined
  #cancelled = false
  #visible = false
  #jobs: WriteJob[] = []
  #pendingBytes = 0
  #dispatching = false
  #settlement: Promise<void> | undefined
  #outputFailure: unknown
  #outputFailed = false
  #lastRefresh = 0
  #refresh: ReturnType<typeof setTimeout> | undefined
  #failedOutput: ((error: unknown) => void) | undefined
  #attached = false
  readonly #resize = () => this.#flowChanged()
  readonly #updates = new PrivateCliUserUpdates(
    (text) => this.#flowNotice(text),
    (plain, current) => this.#flowChanged(plain, current),
    (text) => {
      this.#flowNotice(text, false)
    },
  )
  readonly #abort = () => {
    this.pause()
    this.#cancelled = true
    this.#updates.stop()
    this.#stage = 'Cancellation requested; waiting for work to stop and clean up'
    this.#started = performance.now()
    this.#write()
  }

  constructor(
    readonly enabled: boolean,
    readonly write: (text: string) => void | Promise<void>,
    readonly signal?: AbortSignal,
    readonly animated = privateCliStyleEnabled(enabled),
    readonly columns: () => number = () => process.stderr.columns || 80,
    readonly hostFormat: (text: string) => string = (text) => text,
  ) {}

  observe(port: string): PrivateUserUpdateSource {
    return this.#updates.open(port)
  }
  onOutputFailure(handler: (error: unknown) => void): void {
    this.#failedOutput = handler
    if (this.#outputFailed) handler(this.#outputFailure)
  }

  /** Host stopping/terminal presentation permanently fences future Flow callbacks. */
  stopUpdates(): void {
    clearTimeout(this.#refresh)
    this.#refresh = undefined
    this.#updates.stop()
  }

  async flush(): Promise<void> {
    while (this.#settlement !== undefined) await this.#settlement
    if (this.#outputFailed) throw this.#outputFailure
  }

  #enqueue(job: WriteJob, flow = false): boolean {
    if (this.#outputFailed) return false
    if (job.transient) {
      this.#jobs = this.#jobs.filter((old) => {
        if (!old.transient) return true
        this.#pendingBytes -= old.bytes
        return false
      })
    }
    // Reserve one bounded job for an observation-unavailable explanation.
    if (
      flow &&
      (this.#jobs.length + Number(this.#dispatching) >= 15 ||
        this.#pendingBytes + job.bytes > 262_144 - 512)
    )
      return false
    if (
      this.#jobs.length + Number(this.#dispatching) >= 16 ||
      this.#pendingBytes + job.bytes > 262_144
    ) {
      if (job.transient) return false
      this.#outputFailed = true
      this.#outputFailure = new Error('Terminal presentation exceeded bounded output capacity')
      this.#failedOutput?.(this.#outputFailure)
      return false
    }
    this.#pendingBytes += job.bytes
    this.#jobs.push(job)
    this.#dispatch()
    return true
  }

  #dispatch(): void {
    if (this.#dispatching || this.#outputFailed) return
    const job = this.#jobs.shift()
    if (job === undefined) return
    this.#dispatching = true
    const finished = () => {
      this.#pendingBytes -= job.bytes
      this.#dispatching = false
      this.#settlement = undefined
      this.#dispatch()
    }
    try {
      const result = job.dispatch()
      if (result !== undefined) {
        this.#settlement = Promise.resolve(result)
          .catch((error) => {
            this.#outputFailed = true
            this.#outputFailure = error
            this.#failedOutput?.(error)
            for (const queued of this.#jobs) this.#pendingBytes -= queued.bytes
            this.#jobs = []
          })
          .finally(finished)
      } else finished()
    } catch (error) {
      this.#outputFailed = true
      this.#outputFailure = error
      this.#failedOutput?.(error)
      for (const queued of this.#jobs) this.#pendingBytes -= queued.bytes
      this.#jobs = []
      finished()
    }
  }

  #emit(text: string): void {
    text = this.hostFormat(text)
    this.#enqueue({
      bytes: Buffer.byteLength(text),
      transient: false,
      dispatch: () => this.write(text),
    })
  }

  #flowNotice(text: string, flow = true): boolean {
    const accepted = this.#enqueue(
      {
        bytes: Buffer.byteLength(text) + 5,
        transient: false,
        dispatch: () => {
          const erase = this.#visible ? '\r\u001b[2K' : ''
          this.#visible = false
          return this.write(erase + text)
        },
      },
      flow,
    )
    if (accepted) this.#flowChanged()
    return accepted
  }

  #flowChanged(plain?: string, project: () => string | undefined = () => plain): boolean {
    if (!this.enabled) return true
    if (!this.animated) {
      if (plain !== undefined && !this.#cancelled)
        return this.#enqueue(
          {
            bytes: 4096,
            transient: false,
            dispatch: () => {
              const latest = project()
              if (latest !== undefined && !this.#cancelled) return this.write(latest)
            },
          },
          true,
        )
      return true
    }
    if (this.#refresh !== undefined) return true
    const delay = Math.max(0, this.#lastRefresh + 200 - performance.now())
    if (delay === 0) this.#write()
    else
      this.#refresh = setTimeout(() => {
        this.#refresh = undefined
        this.#write()
      }, delay)
    return true
  }

  stage(value: string): void {
    if (!this.enabled || this.#cancelled || value === this.#stage) return
    this.pause()
    if (!this.#attached) {
      this.#attached = true
      this.signal?.addEventListener('abort', this.#abort, { once: true })
      process.stderr.on('resize', this.#resize)
      if (this.animated) {
        this.#timer = setInterval(() => this.#flowChanged(), 1_000)
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
    this.#jobs = this.#jobs.filter((job) => {
      if (!job.transient) return true
      this.#pendingBytes -= job.bytes
      return false
    })
    if (this.#visible) this.#emit('\r\u001b[2K')
    if (this.#stage && this.animated) this.#emit(`  - ${this.#stage}\n`)
    this.#visible = false
    this.#stage = ''
  }

  /** A complete notice preserves the known active stage and its heartbeat. */
  notice(value: string): void {
    value = this.hostFormat(value)
    this.#enqueue({
      bytes: Buffer.byteLength(value) + 5,
      transient: false,
      dispatch: () => {
        const erase = this.#visible ? '\r\u001b[2K' : ''
        this.#visible = false
        return this.write(erase + value)
      },
    })
    if (this.animated) this.#write()
  }

  diagnostic(text: string): void {
    this.#flowNotice(text, false)
  }

  complete(timing = false): void {
    if (this.#cancelled) {
      this.pause()
      return
    }
    if (!this.#stage) return
    if (this.#visible) this.#emit('\r\u001b[2K')
    if (this.animated)
      this.#emit(
        `${privateCliHeading('  ✓', 'success', true)} ${privateCliSecondary(this.#stage + (timing ? ` (${((performance.now() - this.#started) / 1000).toFixed(1)}s)` : ''), true)}\n`,
      )
    this.#visible = false
    this.#stage = ''
  }

  note(value: string): void {
    this.pause()
    if (this.enabled) this.#emit(`${value}\n`)
  }

  close(): void {
    this.stopUpdates()
    this.pause()
    clearTimeout(this.#refresh)
    this.#refresh = undefined
    clearInterval(this.#timer)
    this.#timer = undefined
    this.signal?.removeEventListener('abort', this.#abort)
    process.stderr.removeListener('resize', this.#resize)
    this.#attached = false
  }

  #write(): void {
    if (!this.#stage) return
    if (!this.animated) {
      this.#emit(`  - ${this.#stage}\n`)
      return
    }
    if (this.#updates.labels.length && performance.now() < this.#lastRefresh + 200) {
      this.#flowChanged()
      return
    }
    // Cell width alone does not bound UTF-8 bytes: combining marks may occupy
    // no extra cells. Reserve the complete sixteen-slot projection bound.
    this.#enqueue({ bytes: 32_768, transient: true, dispatch: () => this.#paint() })
  }

  #paint(): void | Promise<void> {
    this.#lastRefresh = performance.now()
    if (!this.#stage) return
    const elapsed = ` ${((performance.now() - this.#started) / 1000).toFixed(0)}s`
    const width = Math.max(1, this.columns() - elapsed.length - 5)
    const label =
      this.#stage.length > width
        ? width < 4
          ? '.'.repeat(width)
          : `${this.#stage.slice(0, width - 3)}...`
        : this.#stage
    const labels = this.#cancelled ? [] : this.#updates.labels
    let projection = label + elapsed
    if (labels.length) {
      const columns = Math.max(1, Math.min(4096, this.columns()))
      if (columns <= 5) {
        this.#visible = true
        return this.write(`\r\u001b[2K${privateTruncateUpdate(`+${labels.length}`, columns)}`)
      }
      const available = columns - 5
      if (available < privateTerminalWidth(` | +${labels.length} more`) + 1) {
        this.#visible = true
        return this.write(`\r\u001b[2K  … ${privateTruncateUpdate(`+${labels.length}`, available)}`)
      }
      projection = privateTruncateUpdate(this.#stage, Math.min(24, Math.floor(available / 3)))
      let shown = 0
      for (const _activity of labels) {
        const suffix = labels.length > shown + 1 ? ` | +${labels.length - shown - 1} more` : ''
        const room = available - privateTerminalWidth(projection + ' | ' + suffix)
        if (room < 8) break
        const activity = this.#updates.project(shown, room)
        if (activity === undefined) break
        projection += ` | ${activity}`
        shown++
      }
      if (shown < labels.length) projection += ` | +${labels.length - shown} more`
      projection = privateTruncateUpdate(projection, available)
    }
    this.#visible = true
    const text = `\r\u001b[2K  … ${labels.length ? projection : label + privateCliSecondary(elapsed, true)}`
    return this.write(labels.length ? text : this.hostFormat(text))
  }
}
