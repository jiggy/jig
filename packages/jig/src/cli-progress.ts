import type { Reference } from '@jigging/user-updates'
import { PrivateDashboardInput, privateDashboardFrame } from './cli-dashboard.js'
import {
  privateCliHeading,
  privateCliSecondary,
  privateCliStyleEnabled,
} from './cli-presentation.js'
import {
  type PrivateAttention,
  type PrivateCallEvent,
  type PrivatePreview,
  PrivateRunModel,
  privateAttentionReceipt,
} from './cli-run-model.js'
import { privateSavedResultViews } from './cli-saved-result-presentation.js'
import {
  PrivateCliUserUpdates,
  type PrivateUserUpdateSource,
  privateTerminalWidth,
  privateTruncateUpdate,
  privateUpdateText as privateUpdateTextForProgress,
} from './cli-user-updates.js'
import { privatePresentationNow } from './internal/root-run-timeout-policy.js'
import type { PrivateSavedResult } from './internal/saved-result.js'
import type { JsonValue } from './json.js'

type WriteJob = {
  readonly bytes: number
  readonly transient: boolean
  readonly dispatch: () => void | Promise<void>
}

export interface PrivateProgressLifetime {
  readonly presentationDeadline?: number | undefined
  readonly clock?: () => number
  readonly rows?: () => number
}

const SCREEN_ENTER = '\u001b[?1049h\u001b[?25l\u001b[H\u001b[2J'
const SCREEN_RESTORE = '\u001b[?25h\u001b[?1049l'
const FRAME_PREFIX = '\u001b[H\u001b[2J'
const OUTPUT_JOB_BYTES = 32_768

/** One bounded active line on terminal stderr; never infers completed work. */
export class PrivateCliProgress {
  readonly model = new PrivateRunModel()
  #plain = false
  #dashboard: PrivateDashboardInput | undefined
  #screen: 'ordinary' | 'entering' | 'live' | 'closing' = 'ordinary'
  #workspaceUsed = false
  #screenEntered = false
  #workspaceClose: Promise<void> | undefined
  #settled = false
  #left = false
  #closingCommand = false
  #exitMessage: string | undefined
  #deadlineTimer: ReturnType<typeof setTimeout> | undefined
  #hostEntry = 0
  #paintedRows = 0
  #reportedViews = false
  #callTranscriptStopped = false
  #unavailableReported = false
  #committingCauses = false
  #causeTask: Promise<void> | undefined
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
    if (this.#settled) {
      this.#dashboard?.leave()
      return
    }
    if (this.#cancelled) return
    this.#cancelled = true
    this.#dashboard?.leave()
    this.pause()
    this.#updates.stop()
    this.#stage = 'Cancellation requested; waiting for work to stop and clean up'
    this.#started = performance.now()
    this.model.workspace.stageStartedAt = this.#now()
    this.model.setHostStage(this.#stage, 'cancellation')
    this.#write()
  }

  constructor(
    readonly enabled: boolean,
    readonly write: (text: string) => void | Promise<void>,
    readonly signal?: AbortSignal,
    readonly animated = privateCliStyleEnabled(enabled),
    readonly columns: () => number = () => process.stderr.columns ?? 80,
    readonly hostFormat: (text: string) => string = (text) => text,
    readonly lifetime: PrivateProgressLifetime = {},
  ) {
    this.model.workspace.startedAt = this.#now()
    this.model.onChange = () => this.#flowChanged()
  }

  get animation(): boolean {
    return this.animated && !this.#plain
  }
  get workspaceUsed(): boolean {
    return this.#workspaceUsed
  }
  get workspaceActive(): boolean {
    return this.#screen === 'entering' || this.#screen === 'live'
  }
  #now(): number {
    return (this.lifetime.clock ?? privatePresentationNow)()
  }
  #attach(): void {
    if (this.#attached) return
    this.#attached = true
    this.signal?.addEventListener('abort', this.#abort, { once: true })
    process.stderr.on('resize', this.#resize)
    if (this.animation || this.workspaceActive) {
      this.#timer = setInterval(() => this.#flowChanged(), 1_000)
      this.#timer.unref()
    }
  }
  async configureDisplay(
    display: 'auto' | 'plain' | 'dashboard',
    usableInput: boolean,
    input = process.stdin,
  ): Promise<void> {
    this.#plain = display === 'plain'
    if (display === 'dashboard') {
      if (this.#left) return
      if (
        this.lifetime.presentationDeadline !== undefined &&
        this.lifetime.presentationDeadline <= this.#now()
      ) {
        this.#left = true
        this.notice('Command lifetime limits the dashboard; work continues in ordinary display.\n')
        return
      }
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
          () => this.#leaveWorkspace(),
          () => this.#withinCommandDeadline(),
        )
        if (this.#settled) this.#dashboard.markSettled()
        try {
          this.#dashboard.capture()
          this.#screen = 'entering'
          this.#attach()
          await this.#drainWrites()
          if (this.#left || this.signal?.aborted) {
            this.#dashboard.leave()
            return
          }
          this.#screenEntered = true
          this.#enqueue({
            bytes: Buffer.byteLength(SCREEN_ENTER),
            transient: false,
            dispatch: () => this.write(SCREEN_ENTER),
          })
          await this.#drainWrites()
          this.#workspaceUsed = true
          if (this.#left || this.signal?.aborted) {
            this.#dashboard.leave()
            await this.closeWorkspace()
            return
          }
          this.#screen = 'live'
          this.#dashboard.start()
          this.#armDeadline()
          this.#write()
        } catch (error) {
          this.#exitMessage = 'Dashboard input unavailable; using plain display.\n'
          this.#dashboard.leave()
          await this.closeWorkspace().catch(() => undefined)
          this.#plain = true
          if (this.#outputFailed) throw error
          if (this.#exitMessage) {
            this.notice(this.#exitMessage)
            this.#exitMessage = undefined
          }
        }
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
    if (this.#committingCauses || this.#outputFailed || this.#screen !== 'ordinary') return
    if (!this.model.attention.some((cause) => !cause.committed)) return
    this.#committingCauses = true
    this.#causeTask = Promise.resolve()
      .then(async () => {
        while (this.#screen === 'ordinary') {
          const causes = this.model.attention.filter((cause) => !cause.committed)
          if (!causes.length) break
          let batch = '',
            bytes = 0
          let completed: PrivateAttention[] = []
          const deliver = async () => {
            if (!batch) return
            await this.#drainWrites()
            const text = batch
            const receipts = completed
            const erase = this.#erase()
            if (erase) {
              this.#enqueue({
                bytes: Buffer.byteLength(erase),
                transient: false,
                dispatch: () => this.write(erase),
              })
              await this.#drainWrites()
            }
            if (
              !this.#enqueue({
                bytes: Buffer.byteLength(text),
                transient: false,
                dispatch: async () => {
                  await this.write(text)
                  for (const receipt of receipts) receipt.committed = true
                },
              })
            )
              throw this.#outputFailure
            await this.#drainWrites()
            batch = ''
            bytes = 0
            completed = []
          }
          for (const cause of causes) {
            for (const scalar of privateAttentionReceipt(cause)) {
              const size = Buffer.byteLength(scalar)
              if (bytes + size > OUTPUT_JOB_BYTES) await deliver()
              batch += scalar
              bytes += size
            }
            completed.push(cause)
          }
          await deliver()
        }
      })
      .catch((error) => this.#failOutput(error))
      .finally(() => {
        this.#committingCauses = false
        this.#causeTask = undefined
        this.#flowChanged()
      })
  }

  #armDeadline(): void {
    clearTimeout(this.#deadlineTimer)
    this.#deadlineTimer = undefined
    const deadline = this.lifetime.presentationDeadline
    if (deadline === undefined || !this.#dashboard?.active) return
    const remaining = deadline - this.#now()
    if (remaining <= 0) {
      this.#exitMessage = this.#settled
        ? 'Results settled; command lifetime limits dashboard inspection. Inspect the result and any written output packet.\n'
        : 'Command lifetime limits the dashboard; work continues in ordinary display.\n'
      this.#dashboard.leave()
      return
    }
    this.#deadlineTimer = setTimeout(
      () => {
        this.#exitMessage = this.#settled
          ? 'Results settled; command lifetime limits dashboard inspection. Inspect the result and any written output packet.\n'
          : 'Command lifetime limits the dashboard; work continues in ordinary display.\n'
        this.#dashboard?.leave()
      },
      Math.min(remaining, 2_147_483_647),
    )
  }

  #withinCommandDeadline(): boolean {
    const deadline = this.lifetime.presentationDeadline
    return deadline === undefined || this.#now() < deadline
  }

  async inspectSavedResult(
    packet: PrivateSavedResult,
    usableInput: boolean,
    input = process.stdin,
  ): Promise<void> {
    this.#settled = true
    this.model.workspace.recorded = true
    this.model.configureWorkspace({ target: packet.directory, startedAt: this.#now() })
    this.model.context =
      'Recorded local claims; file consistency does not authenticate this report. Live views and history were not retained.'
    const r = packet.record
    const delivery = r.delivery as Record<string, JsonValue> | undefined
    this.model.setWorkspaceFacts({
      execution: String(r.status),
      application: JSON.stringify(r.outcome ?? null),
      cleanup: r.cleanup ? 'reported unconfirmed' : 'no failure recorded',
      delivery: String(delivery?.status ?? 'not recorded'),
      completeness: packet.complete
        ? 'files match the recorded manifest'
        : 'file verification incomplete',
    })
    for (const view of privateSavedResultViews(packet)) this.model.acceptView('saved-result', view)
    this.model.select(JSON.stringify(['saved-result', 'recorded-result']))
    this.model.setArtifacts(
      (publisher, ref) =>
        publisher === 'saved-result' &&
        ref.attachment === 'packet' &&
        packet.files.some((file) => file.available && file.path === ref.path)
          ? ref.path
          : undefined,
      async (path) => packet.preview(path),
    )
    this.model.workspace.now = this.#now()
    this.model.setWorkspacePhase('settled')
    await this.configureDisplay('dashboard', usableInput, input)
    if (this.#dashboard?.active) {
      this.#armDeadline()
      this.#write()
      await this.flush()
      await this.#dashboard.settled()
    }
    await this.closeWorkspace()
    this.pause()
    await this.flush()
  }

  #dropFrames(): void {
    clearTimeout(this.#refresh)
    this.#refresh = undefined
    this.#jobs = this.#jobs.filter((job) => {
      if (!job.transient) return true
      this.#pendingBytes -= job.bytes
      return false
    })
  }

  #leaveWorkspace(): void {
    this.#left = true
    if (this.#screen === 'ordinary' || this.#screen === 'closing') return
    this.#screen = 'closing'
    this.#dropFrames()
    clearTimeout(this.#deadlineTimer)
    this.#deadlineTimer = undefined
    this.#visible = false
    this.#paintedRows = 0
    this.#pendingErase = false
    if (this.#screenEntered && !this.#outputFailed)
      this.#enqueue({
        bytes: Buffer.byteLength(SCREEN_RESTORE),
        transient: false,
        dispatch: () => this.write(SCREEN_RESTORE),
      })
    this.#workspaceClose = this.#drainWrites()
      .then(async () => {
        this.#screen = 'ordinary'
        this.#screenEntered = false
        this.#commitCauses()
        if (this.#causeTask) await this.#causeTask
        const message =
          this.#exitMessage ??
          (!this.#settled && !this.#cancelled && !this.#closingCommand
            ? 'Dashboard closed; work continues in ordinary display.\n'
            : undefined)
        this.#exitMessage = undefined
        if (message && !this.#outputFailed) this.notice(message)
        if (this.#cancelled && this.#stage) this.#write()
        await this.#drainWrites()
      })
      .catch((error) => {
        this.#screen = 'ordinary'
        this.#screenEntered = false
        this.#failOutput(error)
      })
  }

  /** Input restoration is synchronous; terminal restoration remains in the one writer. */
  async closeWorkspace(): Promise<void> {
    this.#dashboard?.leave()
    if (this.#screen !== 'ordinary') this.#leaveWorkspace()
    await this.#workspaceClose
    if (this.#outputFailed) throw this.#outputFailure
  }
  #unavailable(text: string): void {
    this.model.incomplete = 'Live observation is incomplete; inspect the final result'
    if (this.#unavailableReported) return
    this.#unavailableReported = true
    this.model.addAttention('Jig', text, 3, false)
    this.#commitCauses()
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
    this.#settled = true
    this.#dashboard?.markSettled()
    this.stopUpdates()
    const r = record as Record<string, JsonValue>
    const result = r.result as Record<string, JsonValue> | undefined
    const delivery = r.delivery as Record<string, JsonValue> | undefined
    this.model.setWorkspaceFacts({
      execution: String(r.status),
      application: JSON.stringify(result?.outcome ?? r.outcome ?? null),
      cleanup: r.cleanup ? 'unconfirmed' : 'complete',
      delivery: String(delivery?.status ?? 'not requested'),
      completeness:
        this.model.incomplete ??
        (Object.values(this.model.journalOmitted).some((count) => count > 0)
          ? 'Activity history omitted'
          : 'observation ended'),
    })
    this.model.context = `Settled · execution: ${String(r.status)} · application outcome: ${JSON.stringify(result?.outcome ?? r.outcome ?? null)} · cleanup: ${r.cleanup ? 'unconfirmed' : 'settled'} · delivery: ${String(delivery?.status ?? 'not requested')}`
    const causes = this.#workspaceUsed
      ? [
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
      : []
    await this.flush()
    for (const cause of causes) {
      this.model.addAttention('Jig', cause, 4, false)
    }
    if (artifact) this.model.setArtifacts(artifact.resolve, artifact.preview)
    if (!this.#cancelled && this.#dashboard?.active) {
      const now = this.#now()
      this.model.workspace.now = now
      this.model.setWorkspacePhase('settled')
      this.#armDeadline()
      this.#write()
      await this.flush()
      await this.#dashboard.settled()
    }
    await this.closeWorkspace()
    this.pause()
    if (!this.#workspaceUsed && !this.#reportedViews) {
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
    await this.#workspaceClose
    this.#commitCauses()
    while (this.#causeTask !== undefined) await this.#causeTask
    await this.#drainWrites()
  }

  async #drainWrites(): Promise<void> {
    while (this.#settlement !== undefined) await this.#settlement
    if (this.#outputFailed) throw this.#outputFailure
  }

  #failOutput(error: unknown): void {
    if (this.#outputFailed) return
    this.#outputFailed = true
    this.#outputFailure = error
    this.#dropFrames()
    for (const queued of this.#jobs) this.#pendingBytes -= queued.bytes
    this.#jobs = []
    this.#dashboard?.leave()
    this.#failedOutput?.(error)
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
      this.#failOutput(new Error('Terminal presentation exceeded bounded output capacity'))
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
      this.#dispatch()
    }
    try {
      const result = job.dispatch()
      if (result !== undefined) {
        this.#settlement = Promise.resolve(result)
          .catch((error) => {
            this.#failOutput(error)
          })
          .finally(finished)
      } else finished()
    } catch (error) {
      this.#failOutput(error)
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
    if (this.workspaceActive) return true
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
    this.#commitCauses()
    if (this.workspaceActive) plain = undefined
    if (this.#screen === 'entering' || this.#screen === 'closing' || this.#committingCauses)
      return true
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
    this.#attach()
    this.#stage = value
    this.#started = performance.now()
    this.model.workspace.stageStartedAt = this.#now()
    if (this.workspaceActive) this.model.setHostStage(value, `stage:${++this.#hostEntry}`)
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
    if (!this.workspaceActive && this.#screen !== 'closing') {
      this.#requestErase()
      if (this.#stage && this.animation) this.#emit(`  - ${this.#stage}\n`, true)
    }
    this.#stage = ''
  }

  /** A complete notice preserves the known active stage and its heartbeat. */
  notice(value: string, importance: 'info' | 'warning' | 'error' = 'info'): void {
    if (this.workspaceActive) {
      this.model.addHostEntry(`notice:${++this.#hostEntry}`, value, importance)
      if (importance !== 'info') this.model.addAttention('Jig', value, 4, false)
      return
    }
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

  diagnostic(text: string, operations: readonly string[] = [], clipped = false): void {
    if (this.workspaceActive) {
      this.model.addDiagnostic(text, operations, clipped)
      return
    }
    this.#flowNotice(text, false)
  }

  complete(timing = false): void {
    if (this.#cancelled) {
      this.pause()
      return
    }
    if (!this.#stage) return
    if (this.workspaceActive) {
      const elapsed = timing ? ` (${((performance.now() - this.#started) / 1000).toFixed(1)}s)` : ''
      this.model.setHostStage(`${this.#stage} — complete${elapsed}`, `stage:${this.#hostEntry}`)
      this.#stage = ''
      return
    }
    this.#requestErase()
    if (this.animation)
      this.#emit(
        `${privateCliHeading('  ✓', 'success', true)} ${privateCliSecondary(this.#stage + (timing ? ` (${((performance.now() - this.#started) / 1000).toFixed(1)}s)` : ''), true)}\n`,
        true,
      )
    this.#stage = ''
  }

  note(value: string): void {
    if (this.workspaceActive) {
      this.model.addHostEntry(`note:${++this.#hostEntry}`, value)
      return
    }
    this.pause()
    if (this.enabled) this.#emit(`${value}\n`)
  }

  close(): void {
    this.#closingCommand = true
    this.#dashboard?.leave()
    this.stopUpdates()
    this.pause()
    clearTimeout(this.#refresh)
    this.#refresh = undefined
    clearInterval(this.#timer)
    this.#timer = undefined
    clearTimeout(this.#deadlineTimer)
    this.#deadlineTimer = undefined
    this.signal?.removeEventListener('abort', this.#abort)
    process.stderr.removeListener('resize', this.#resize)
    this.#attached = false
    this.model.close()
  }

  #write(): void {
    if (this.#screen === 'entering' || this.#screen === 'closing' || this.#committingCauses) return
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
    const physicalRows = Math.max(
      0,
      Math.min(4096, this.lifetime.rows?.() ?? process.stderr.rows ?? 24),
    )
    if (this.#dashboard?.active && (columns < 18 || physicalRows < 4)) {
      this.#exitMessage = 'Dashboard unavailable at this terminal size; using ordinary display.\n'
      this.#dashboard.leave()
      return
    }
    this.model.workspace.now = this.#now()
    if (this.model.calls.size || this.model.views.size || this.#dashboard?.active) {
      const inspecting = this.#dashboard?.active === true
      const frame = privateDashboardFrame(
        this.model,
        columns,
        inspecting ? physicalRows : Math.min(16, Math.max(3, physicalRows - 4)),
        this.animation,
        inspecting,
        this.#dashboard?.scroll,
        this.#dashboard?.anchor,
        this.#dashboard?.state,
      )
      this.#dashboard?.frame(frame.references, frame.scroll, frame.anchor)
      const erase = inspecting ? FRAME_PREFIX : this.#erase()
      this.#visible = true
      this.#paintedRows = frame.lines.length
      const text = erase + frame.lines.join('\n')
      if (Buffer.byteLength(text) > OUTPUT_JOB_BYTES) {
        this.#unavailable(
          'Dashboard projection incomplete: terminal byte limit reached. Inspect full causes and the final result.\n',
        )
        return
      }
      return this.write(text)
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
