import type { Reference } from '@jigging/user-updates'
import { PrivateDashboardInput, privateDashboardFrame } from './cli-dashboard.js'
import {
  privateCliHeading,
  privateCliSecondary,
  privateCliStyleEnabled,
} from './cli-presentation.js'
import { type PrivateCallEvent, type PrivatePreview, PrivateRunModel } from './cli-run-model.js'
import {
  PrivateCliUserUpdates,
  type PrivateUserUpdateSource,
  privateTerminalWidth,
  privateTruncateUpdate,
  privateUpdateText as privateUpdateTextForProgress,
} from './cli-user-updates.js'
import type { JsonValue } from './json.js'

type WriteJob = {
  readonly bytes: number
  readonly transient: boolean
  readonly dispatch: () => void | Promise<void>
}

/** One bounded active line on terminal stderr; never infers completed work. */
export class PrivateCliProgress {
  readonly model = new PrivateRunModel()
  #plain = false
  #dashboard: PrivateDashboardInput | undefined
  #paintedRows = 0
  #reportedViews = false
  #callTranscriptStopped = false
  #unavailableReported = false
  #committingCauses = false
  #pendingErase = false
  #eraseQueued = false
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
      this.#unavailable(text)
    },
    () => this.animation,
    this.model,
  )
  readonly #abort = () => {
    this.#dashboard?.leave()
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
  ) {
    this.model.onChange = () => this.#flowChanged()
  }

  get animation(): boolean {
    return this.animated && !this.#plain
  }
  configureDisplay(
    display: 'auto' | 'plain' | 'dashboard',
    usableInput: boolean,
    input = process.stdin,
  ): void {
    this.#plain = display === 'plain'
    if (display === 'dashboard') {
      if (
        !this.enabled ||
        !usableInput ||
        typeof input.setRawMode !== 'function' ||
        process.env.TERM === 'dumb'
      ) {
        this.#plain = true
        this.notice(
          'Dashboard unavailable without terminal input and stderr; using plain display.\n',
        )
      } else {
        this.#dashboard = new PrivateDashboardInput(
          this.model,
          () => this.#flowChanged(),
          () => process.emit('SIGINT'),
          input,
        )
        this.#dashboard.start()
      }
    }
  }
  observeCall(event: PrivateCallEvent): void {
    if (this.model.stopped) return
    const prior = this.model.calls.get(JSON.stringify([event.publisher, event.operationId]))
    this.model.observeCall(event)
    this.#commitCauses()
    if (this.#callTranscriptStopped) return
    let accepted = true
    if (
      !event.cause &&
      !this.animation &&
      (prior === undefined || ['returned', 'failed', 'uncertain'].includes(event.state))
    )
      accepted = this.#flowNotice(
        `  Jig / ${privateUpdateTextForProgress(event.slot)}: ${event.state}${event.intent ? ` — ${privateUpdateTextForProgress(event.intent)}` : ''}\n`,
      )
    if (!accepted) {
      this.#callTranscriptStopped = true
      this.#unavailable(
        '  Jig: Live call reports incomplete: presentation capacity reached. Check the final result.\n',
      )
    }
  }
  #commitCauses(): void {
    if (this.#committingCauses || this.#outputFailed) return
    this.#committingCauses = true
    try {
      for (const cause of this.model.attention) {
        if (cause.committed) continue
        cause.committed = true
        const accepted = this.#flowNotice(
          `  ${cause.priority >= 3 ? 'Jig / ' : ''}${privateUpdateTextForProgress(cause.source)}: ${cause.priority >= 3 ? 'host-reported cause' : cause.priority === 2 ? 'Flow-reported error' : 'Flow-reported warning'}\n    ${privateUpdateTextForProgress(cause.text).replaceAll('\n', '\n    ')}\n`,
        )
        if (!accepted) {
          cause.committed = false
          this.#callTranscriptStopped = true
          this.#unavailable(
            '  Jig: Live call reports incomplete: presentation capacity reached. Check the final result.\n',
          )
          break
        }
      }
    } finally {
      this.#committingCauses = false
    }
  }
  #unavailable(text: string): void {
    this.model.incomplete = 'Live observation is incomplete; see the transcript and final result'
    if (this.#unavailableReported) return
    this.model.addAttention('Jig', text, 3)
    this.#unavailableReported = true
    this.#flowNotice(text, false)
  }
  async settleDashboard(
    record: JsonValue,
    artifact?: {
      resolve: (
        publisher: string,
        ref: Extract<Reference, { kind: 'artifact' }>,
      ) => string | undefined
      preview: (path: string) => Promise<PrivatePreview | undefined>
    },
  ): Promise<void> {
    this.#dashboard?.markSettled()
    this.stopUpdates()
    const r = record as Record<string, JsonValue>
    const result = r.result as Record<string, JsonValue> | undefined
    const delivery = r.delivery as Record<string, JsonValue> | undefined
    this.model.context = `Settled · execution: ${String(r.status)} · application outcome: ${JSON.stringify(result?.outcome ?? r.outcome ?? null)} · delivery: ${String(delivery?.status ?? 'not requested')}`
    const causes = [
      ...(r.status !== 'succeeded' && typeof r.message === 'string' ? [r.message] : []),
      ...(r.cleanup
        ? ['Cleanup could not be confirmed; inspect effects before starting new work.']
        : []),
      ...(delivery && delivery.status !== 'written'
        ? [
            'Result packet delivery was not confirmed; inspect the destination before starting new work.',
          ]
        : []),
    ]
    await this.flush()
    for (const cause of causes) {
      this.model.addAttention('Jig', cause, 4)
      if (this.#dashboard?.active)
        this.#flowNotice(`  Jig: ${privateUpdateTextForProgress(cause)}\n`, false)
      await this.flush()
    }
    if (artifact) this.model.setArtifacts(artifact.resolve, artifact.preview)
    if (!this.#cancelled && this.#dashboard?.active) {
      this.#write()
      await this.flush()
      await this.#dashboard.settled()
    }
    this.pause()
    if (!this.#reportedViews) {
      this.#reportedViews = true
      await this.flush()
      for (const view of this.model.views.values()) {
        this.#flowNotice(
          `  ${this.model.sourceLabel(view.publisher)} / ${privateUpdateTextForProgress(view.value.title)} (${view.ended ?? 'observation ended'}):\n    ${privateUpdateTextForProgress(view.value.summary).replaceAll('\n', '\n    ')}\n`,
          false,
        )
        await this.flush()
      }
    }
    await this.flush()
  }

  #erase(): string {
    this.#pendingErase = false
    const rows = this.#paintedRows
    this.#paintedRows = 0
    if (!this.#visible) return ''
    this.#visible = false
    return rows > 1 ? `\r\u001b[${rows - 1}A\u001b[J` : '\r\u001b[2K'
  }

  observe(port: string, compact = false): PrivateUserUpdateSource {
    return this.#updates.open(port, compact)
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
        this.#pendingBytes + job.bytes > 262_144 - 32_768)
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
      this.#scheduleErase()
      this.#commitCauses()
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

  #emit(text: string, optional = false): void {
    text = this.hostFormat(text)
    const accepted = this.#enqueue(
      {
        bytes: Buffer.byteLength(text),
        transient: false,
        dispatch: () => this.write(text),
      },
      optional,
    )
    if (!accepted && optional)
      this.#unavailable(
        '  Jig: Some stage history was omitted; the final result retains the outcome.\n',
      )
  }
  #scheduleErase(): void {
    if (!this.#pendingErase || this.#eraseQueued) return
    if (!this.#visible) {
      this.#pendingErase = false
      return
    }
    this.#eraseQueued = true
    if (
      !this.#enqueue(
        {
          bytes: 32,
          transient: false,
          dispatch: () => {
            this.#eraseQueued = false
            const erase = this.#erase()
            return erase ? this.write(erase) : undefined
          },
        },
        true,
      )
    )
      this.#eraseQueued = false
  }
  #requestErase(): void {
    if (this.#visible) {
      this.#pendingErase = true
      this.#scheduleErase()
    }
  }

  #flowNotice(text: string, flow = true): boolean {
    const accepted = this.#enqueue(
      {
        bytes: Buffer.byteLength(text) + 5,
        transient: false,
        dispatch: () => {
          const erase = this.#erase()
          return this.write(erase + text)
        },
      },
      flow,
    )
    if (accepted) this.#flowChanged()
    return accepted
  }

  #flowChanged(plain?: string, project: () => string | undefined = () => plain): boolean {
    if (!this.enabled) return plain === undefined ? true : this.#flowNotice(plain)
    if (plain !== undefined && !this.#cancelled) {
      return this.#enqueue(
        {
          bytes: 32_768,
          transient: false,
          dispatch: () => {
            const latest = project()
            if (latest !== undefined && !this.#cancelled) {
              const erase = this.#erase()
              return this.write(erase + latest)
            }
          },
        },
        true,
      )
    }
    if (!this.animation && !this.#dashboard?.active) return true
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
      if (this.animation) {
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
    this.#requestErase()
    if (this.#stage && this.animation) this.#emit(`  - ${this.#stage}\n`, true)
    this.#stage = ''
  }

  /** A complete notice preserves the known active stage and its heartbeat. */
  notice(value: string): void {
    value = this.hostFormat(value)
    this.#enqueue({
      bytes: Buffer.byteLength(value) + 5,
      transient: false,
      dispatch: () => {
        const erase = this.#erase()
        return this.write(erase + value)
      },
    })
    if (this.animation) this.#write()
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
    this.#requestErase()
    if (this.animation)
      this.#emit(
        `${privateCliHeading('  ✓', 'success', true)} ${privateCliSecondary(this.#stage + (timing ? ` (${((performance.now() - this.#started) / 1000).toFixed(1)}s)` : ''), true)}\n`,
        true,
      )
    this.#stage = ''
  }

  note(value: string): void {
    this.pause()
    if (this.enabled) this.#emit(`${value}\n`)
  }

  close(): void {
    this.#dashboard?.leave()
    this.stopUpdates()
    this.pause()
    clearTimeout(this.#refresh)
    this.#refresh = undefined
    clearInterval(this.#timer)
    this.#timer = undefined
    this.signal?.removeEventListener('abort', this.#abort)
    process.stderr.removeListener('resize', this.#resize)
    this.#attached = false
    this.model.close()
  }

  #write(): void {
    if (!this.#stage && !this.#dashboard?.active) return
    if (!this.animation && !this.#dashboard?.active) {
      const stage = this.#stage
      const text = this.hostFormat(`  - ${stage}\n`)
      // An ordinary stage projection is optional current state. A saturated
      // live feed must leave the critical explanation/final result owner usable.
      this.#enqueue({
        bytes: Buffer.byteLength(text),
        transient: true,
        dispatch: () => (this.#stage === stage ? this.write(text) : undefined),
      })
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
    if (!this.#stage && !this.#dashboard?.active) return
    const columns = Math.max(1, Math.min(4096, this.columns()))
    if (this.model.calls.size || this.model.views.size || this.#dashboard?.active) {
      const inspecting = this.#dashboard?.active === true
      const frame = privateDashboardFrame(
        this.model,
        columns,
        Math.min(
          inspecting ? process.stderr.rows || 24 : 16,
          Math.max(3, (process.stderr.rows || 24) - 4),
        ),
        this.animation,
        inspecting,
        this.#dashboard?.scroll,
        this.#dashboard?.anchor,
      )
      this.#dashboard?.frame(frame.references, frame.scroll, frame.anchor)
      const erase = this.#erase()
      this.#visible = true
      this.#paintedRows = frame.lines.length
      return this.write(erase + frame.lines.join('\n'))
    }
    const elapsed = ` ${((performance.now() - this.#started) / 1000).toFixed(0)}s`
    const prefix = columns > 5 ? '  … ' : ''
    const available = Math.max(0, columns - 1 - privateTerminalWidth(prefix))
    const projection =
      available > elapsed.length + 3
        ? privateTruncateUpdate(this.#stage, available - elapsed.length) +
          privateCliSecondary(elapsed, true)
        : privateTruncateUpdate(this.#stage + elapsed, available)
    this.#visible = true
    this.#paintedRows = 1
    return this.write(`\r\u001b[2K${prefix}${projection}`)
  }
}
