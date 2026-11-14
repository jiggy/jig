import type {
  DisplayJsonValue,
  DisplayExplorerInputFile,
  DisplayProjectRun,
  DisplayProjectSnapshot,
} from '@jigging/display-model'
import {
  DISPLAY_PROJECT_BYTE_LIMIT,
  DISPLAY_PROJECT_RUN_REQUEST_BYTE_LIMIT,
  validateDisplayProjectRun,
  validateDisplayProjectSnapshot,
} from '@jigging/display-model'

export type PrivateExplorerConnection =
  | 'connecting'
  | 'current'
  | 'stale'
  | 'unavailable'
  | 'unauthorized'
  | 'closed'

const STATUS_BYTES = 16 * 1024
const CLOSE_UNCONFIRMED =
  'Closing the explorer was not confirmed. New runs remain paused. Check the terminal or try Close explorer again.'
export const PRIVATE_EXPLORER_INPUT_BYTES = DISPLAY_PROJECT_RUN_REQUEST_BYTE_LIMIT

export function privateExplorerInput(
  text: string,
): { state: 'valid'; value: DisplayJsonValue } | { state: 'empty' | 'invalid'; reason: string } {
  if (!text.trim()) return { state: 'empty', reason: 'Enter the JSON input for this run.' }
  if (new TextEncoder().encode(text).byteLength > PRIVATE_EXPLORER_INPUT_BYTES)
    return { state: 'invalid', reason: 'Input exceeds the 16 MiB request limit.' }
  try {
    const value = JSON.parse(text) as DisplayJsonValue
    const pending: { value: DisplayJsonValue; depth: number }[] = [{ value, depth: 1 }]
    let count = 0
    while (pending.length) {
      const item = pending.pop()!
      if (++count > 262144 || item.depth > 128)
        return { state: 'invalid', reason: 'Input has too many values or nested levels.' }
      if (typeof item.value === 'number' && !Number.isFinite(item.value))
        return { state: 'invalid', reason: 'JSON numbers must be finite.' }
      if (item.value !== null && typeof item.value === 'object') {
        const children = Array.isArray(item.value) ? item.value : Object.values(item.value)
        if (children.length > 65536 || children.length + pending.length + count > 262144)
          return { state: 'invalid', reason: 'Input has too many values or container entries.' }
        for (const child of children) pending.push({ value: child, depth: item.depth + 1 })
      }
    }
    return { state: 'valid', value }
  } catch {
    return {
      state: 'invalid',
      reason: 'Input is not valid JSON. Check quotes, commas, and brackets.',
    }
  }
}

async function boundedJson(
  response: Response,
  maximum: number,
  signal: AbortSignal,
): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Response unavailable')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let text = ''
  let bytes = 0
  try {
    while (true) {
      const item = await reader.read()
      if (signal.aborted) throw new Error('Response superseded')
      if (item.done) break
      bytes += item.value.byteLength
      if (bytes > maximum) throw new Error('Response exceeds display capacity')
      text += decoder.decode(item.value, { stream: true })
    }
    return JSON.parse(text + decoder.decode()) as unknown
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function responseReason(value: unknown, fallback: string): string {
  if (
    value &&
    typeof value === 'object' &&
    'reason' in value &&
    typeof value.reason === 'string' &&
    value.reason.length > 0 &&
    value.reason.length <= 1024
  )
    return value.reason
  return fallback
}

/** A local explorer can submit one explicit Run request. Observation retries never submit work. */
export class PrivateExplorerClient {
  project: DisplayProjectSnapshot | undefined
  connection: PrivateExplorerConnection = 'connecting'
  projectError = ''
  projectNotice = ''
  run: DisplayProjectRun | undefined
  runCurrent = false
  runError = ''
  requestError = ''
  sending = false
  closing = false
  unresolvedRequest: string | undefined
  #capability: string | undefined
  #changed: () => void
  #base: string
  #selected: string | undefined
  #submitted: { requestId: string; targetId: string } | undefined
  #stopped = false
  #closeRequested = false
  #projectRequest: AbortController | undefined
  #runRequest: AbortController | undefined
  #submission: AbortController | undefined
  #closeRequest: AbortController | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #projectGeneration = 0
  #runGeneration = 0

  constructor(capability: string, changed: () => void, base = '') {
    this.#capability = capability
    this.#changed = changed
    this.#base = base
  }

  get canLaunch(): boolean {
    return (
      !this.#stopped &&
      !this.#closeRequested &&
      !this.closing &&
      !this.sending &&
      !this.unresolvedRequest &&
      this.connection === 'current' &&
      this.runCurrent &&
      this.project?.selected?.launch.state === 'available' &&
      (this.run?.state === 'idle' || this.run?.state === 'settled' || this.run?.state === 'refused')
    )
  }

  start(): void {
    if (this.#stopped) return
    void this.refreshProject()
    void this.refreshRun()
  }

  #headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.#capability}` }
  }

  #terminal(response: Response): boolean {
    if (![401, 403, 410].includes(response.status)) return false
    this.connection = response.status === 410 ? 'closed' : 'unauthorized'
    this.stop()
    this.#changed()
    return true
  }

  async refreshProject(targetId: string | null = this.#selected ?? null): Promise<void> {
    if (this.#stopped || this.closing) return
    this.#selected = targetId ?? undefined
    this.#projectRequest?.abort()
    const controller = new AbortController()
    const generation = ++this.#projectGeneration
    this.#projectRequest = controller
    this.connection = this.project ? 'stale' : 'connecting'
    this.projectError = ''
    this.projectNotice = ''
    this.#changed()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(
        this.#base + '/api/project' + (targetId ? '?target=' + encodeURIComponent(targetId) : ''),
        {
          headers: this.#headers(),
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
        },
      )
      if (this.#stopped || generation !== this.#projectGeneration || this.#terminal(response))
        return
      const value = await boundedJson(response, DISPLAY_PROJECT_BYTE_LIMIT, controller.signal)
      if (this.#stopped || generation !== this.#projectGeneration) return
      if (!response.ok) {
        if (
          targetId &&
          value &&
          typeof value === 'object' &&
          'code' in value &&
          typeof value.code === 'string' &&
          ['PROJECT_CHANGED', 'TARGET_MISSING', 'PROJECT_UNREVIEWED'].includes(value.code)
        ) {
          const recoveryGeneration = this.#projectGeneration + 1
          await this.refreshProject(null)
          if (
            !this.#stopped &&
            this.#projectGeneration === recoveryGeneration &&
            !this.projectError &&
            this.project
          ) {
            this.projectNotice =
              this.project?.state === 'unreviewed'
                ? 'The local approval is no longer available. Review the project, then refresh.'
                : 'The approved project or selected workflow changed. Review this selection and its input before running.'
            this.#changed()
          }
          return
        }
        this.projectError = responseReason(
          value,
          'The approved project could not be read. Refresh to try again.',
        )
        this.connection = this.project ? 'stale' : 'unavailable'
        return
      }
      const project = validateDisplayProjectSnapshot(value)
      if (!project) throw new Error('Project response is invalid')
      if (targetId && project.selected?.targetId !== targetId)
        throw new Error('Project selection does not match the request')
      this.project = project
      this.#selected = project.selected?.targetId
      this.connection = 'current'
    } catch {
      if (this.#stopped || generation !== this.#projectGeneration) return
      this.connection = this.project ? 'stale' : 'unavailable'
      this.projectError = 'The approved project could not be read. Refresh to try again.'
    } finally {
      clearTimeout(timeout)
      if (this.#projectRequest === controller) this.#projectRequest = undefined
      if (!this.#stopped && generation === this.#projectGeneration) this.#changed()
    }
  }

  #acceptGlobalRun(value: unknown): void {
    const run = validateDisplayProjectRun(value)
    if (!run) throw new Error('Run response is invalid')
    this.run = run
    this.runCurrent = true
    this.runError = this.#closeRequested ? CLOSE_UNCONFIRMED : ''
    if (
      run.state !== 'idle' &&
      run.requestId === this.#submitted?.requestId &&
      run.targetId === this.#submitted.targetId
    ) {
      if (run.requestId === this.unresolvedRequest) this.unresolvedRequest = undefined
      if (run.state === 'refused') this.requestError = ''
    }
  }

  #acceptRequestRun(
    value: unknown,
    requestId: string,
    targetId: string,
  ): Exclude<DisplayProjectRun, { state: 'idle' }> {
    const run = validateDisplayProjectRun(value)
    if (run.state === 'idle' || run.requestId !== requestId || run.targetId !== targetId)
      throw new Error('Request status does not match its identity')
    if (this.unresolvedRequest === requestId) this.unresolvedRequest = undefined
    if (run.state === 'refused') this.requestError = run.reason
    return run
  }

  async refreshRun(): Promise<void> {
    if (this.#stopped || this.closing || this.sending || this.#runRequest) return
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    const controller = new AbortController()
    const generation = ++this.#runGeneration
    this.#runRequest = controller
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const response = await fetch(this.#base + '/api/run', {
        headers: this.#headers(),
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (this.#stopped || generation !== this.#runGeneration || this.#terminal(response)) return
      const value = await boundedJson(response, STATUS_BYTES, controller.signal)
      if (this.#stopped || generation !== this.#runGeneration) return
      if (!response.ok) throw new Error('Run status unavailable')
      this.#acceptGlobalRun(value)
      const pending = this.unresolvedRequest
      const submitted = this.#submitted
      if (pending && submitted?.requestId === pending) {
        const lookup = await fetch(
          this.#base + '/api/run?requestId=' + encodeURIComponent(pending),
          {
            headers: this.#headers(),
            credentials: 'omit',
            cache: 'no-store',
            signal: controller.signal,
          },
        )
        if (this.#stopped || generation !== this.#runGeneration || this.#terminal(lookup)) return
        const result = await boundedJson(lookup, STATUS_BYTES, controller.signal)
        if (this.#stopped || generation !== this.#runGeneration) return
        if (
          lookup.status === 404 &&
          result &&
          typeof result === 'object' &&
          'code' in result &&
          result.code === 'REQUEST_UNKNOWN'
        ) {
          this.runError = this.#closeRequested
            ? CLOSE_UNCONFIRMED
            : responseReason(
                result,
                'No retained result is available for this request. This does not confirm that it did not start.',
              )
        } else {
          if (!lookup.ok) throw new Error('Request status unavailable')
          this.#acceptRequestRun(result, pending, submitted.targetId)
        }
      }
    } catch {
      if (this.#stopped || generation !== this.#runGeneration) return
      this.runCurrent = false
      this.runError = this.#closeRequested
        ? CLOSE_UNCONFIRMED
        : 'Run status is unavailable. New runs stay paused until Jig confirms the current state.'
    } finally {
      clearTimeout(timeout)
      if (this.#runRequest === controller) this.#runRequest = undefined
      if (!this.#stopped && generation === this.#runGeneration) {
        this.#changed()
        const active =
          this.unresolvedRequest || this.run?.state === 'starting' || this.run?.state === 'running'
        this.#timer = setTimeout(
          () => {
            void this.refreshRun()
          },
          active ? 1000 : 3000,
        )
      }
    }
  }

  async launch(input: string, requestId: string, files: readonly DisplayExplorerInputFile[] = []): Promise<boolean> {
    const project = this.project
    const selected = project?.selected
    if (!this.canLaunch || !project || !selected || privateExplorerInput(input).state !== 'valid')
      return false
    const request = { requestId, revision: project.revision, targetId: selected.targetId }
    // Preserve the exact JSON text so the host can reject duplicate object members.
    const body = JSON.stringify(request).slice(0, -1) + ',"input":' + input +
      (files.length ? ',"files":' + JSON.stringify(files) : '') + '}'
    if (new TextEncoder().encode(body).byteLength > DISPLAY_PROJECT_RUN_REQUEST_BYTE_LIMIT) {
      this.requestError =
        'Input and request metadata exceed the 16 MiB request limit. Reduce the input before running.'
      this.#changed()
      return false
    }
    const controller = new AbortController()
    this.#runGeneration++
    this.#runRequest?.abort()
    this.#runRequest = undefined
    this.#submission = controller
    this.sending = true
    this.runCurrent = false
    this.#submitted = { requestId, targetId: selected.targetId }
    this.unresolvedRequest = requestId
    this.runError = ''
    this.requestError = ''
    this.#changed()
    const timeout = setTimeout(() => controller.abort(), 30000)
    try {
      const response = await fetch(this.#base + '/api/run', {
        method: 'POST',
        headers: { ...this.#headers(), 'Content-Type': 'application/json' },
        body,
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (this.#stopped || this.#terminal(response)) return false
      const value = await boundedJson(response, STATUS_BYTES, controller.signal)
      if (this.#stopped) return false
      if ([400, 409, 413, 429].includes(response.status)) {
        this.unresolvedRequest = undefined
        this.runCurrent = false
        this.requestError = responseReason(
          value,
          'Jig refused this request before starting work. Check the input and try again.',
        )
        return false
      }
      if (!response.ok) throw new Error('Submission is unconfirmed')
      const run = this.#acceptRequestRun(value, requestId, selected.targetId)
      return run.state !== 'refused'
    } catch {
      if (!this.#stopped) {
        this.runCurrent = false
        this.runError = this.#closeRequested
          ? CLOSE_UNCONFIRMED
          : 'Jig has not confirmed whether this request started. Checking its status without submitting it again.'
      }
      return false
    } finally {
      clearTimeout(timeout)
      if (this.#submission === controller) this.#submission = undefined
      this.sending = false
      if (!this.#stopped) {
        this.#changed()
        void this.refreshRun()
      }
    }
  }

  async close(): Promise<boolean> {
    if (this.#stopped || this.closing) return this.connection === 'closed'
    // A lost Close reply cannot be resolved by an ordinary idle/settled Run status.
    this.#closeRequested = true
    this.closing = true
    this.runCurrent = false
    this.#runGeneration++
    this.#runRequest?.abort()
    this.#runRequest = undefined
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#changed()
    const controller = new AbortController()
    this.#closeRequest = controller
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch(this.#base + '/api/close', {
        method: 'POST',
        headers: this.#headers(),
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok && response.status !== 410) throw new Error('Close is unconfirmed')
      this.connection = 'closed'
      this.stop()
      return true
    } catch {
      this.runError = CLOSE_UNCONFIRMED
      return false
    } finally {
      clearTimeout(timeout)
      if (this.#closeRequest === controller) this.#closeRequest = undefined
      this.closing = false
      this.#changed()
      if (!this.#stopped) void this.refreshRun()
    }
  }

  stop(): void {
    this.#stopped = true
    this.#projectGeneration++
    this.#runGeneration++
    this.#projectRequest?.abort()
    this.#runRequest?.abort()
    this.#submission?.abort()
    this.#closeRequest?.abort()
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#capability = undefined
    this.project = undefined
    this.run = undefined
    this.#submitted = undefined
    this.runCurrent = false
  }
}
