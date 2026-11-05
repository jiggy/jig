import { createHash } from 'node:crypto'
import type {
  DisplayProjectRun,
  DisplayProjectRunRequest,
  DisplayProjectSnapshot,
  WebAssets,
} from '@jigging/display-model'
import type {
  PrivateExploreLaunch,
  PrivateExploreProcessResult,
  PrivateExploreRunProcess,
} from './cli-explore-launch.js'
import { PRIVATE_EXPLORER_LIMITS } from './cli-explore-policy.js'
import {
  PrivateWebExplorer,
  type PrivateExplorerRunBridge,
  type PrivateExplorerRunEvent,
} from './cli-explorer-web.js'
import {
  PrivateProjectProjection,
  PrivateProjectProjectionError,
} from './cli-project-projection.js'
import { CliDiagnostic, usage } from './cli-usage.js'
import { privatePresentationNow } from './internal/root-run-timeout-policy.js'
import { canonicalJson, type JsonValue } from './json.js'
import { parseRun, parseTarget } from './run-arguments.js'

type Entry = {
  readonly digest: string
  status: Exclude<DisplayProjectRun, { state: 'idle' }>
  viewerUrl?: string
}
type Child = {
  readonly entry: Entry
  readonly process: PrivateExploreRunProcess
  readonly bridge: PrivateExplorerRunBridge
  interrupted: boolean
}
type RegisterBridge = (
  onEvent: (event: PrivateExplorerRunEvent) => void,
) => PrivateExplorerRunBridge

/** Grammar is checked without installation acquisition or execution. */
export function parsePrivateExploreArguments(arguments_: readonly string[]): Readonly<{
  target?: string
  timeoutMs: number
  verification?: string
}> {
  let index = 1
  let target: string | undefined
  if (arguments_[index] !== undefined && !arguments_[index]!.startsWith('-')) {
    target = arguments_[index++]!
    parseTarget(target)
  }
  const options: string[] = []
  const seen = new Set<string>()
  for (; index < arguments_.length; index += 2) {
    const name = arguments_[index]!
    const value = arguments_[index + 1]
    if (!['--timeout', '--verification'].includes(name) || seen.has(name))
      usage('explore', 'Use one optional target, --timeout, and --verification.')
    if (value === undefined || value.startsWith('--')) usage('explore', `${name} needs a value.`)
    seen.add(name)
    options.push(name, value)
  }
  try {
    const parsed = parseRun(['run', target ?? 'flow:flows/placeholder', ...options])
    return {
      ...(target === undefined ? {} : { target }),
      timeoutMs: parsed.timeoutMs,
      ...(parsed.verification === undefined ? {} : { verification: parsed.verification }),
    }
  } catch (error) {
    if (error instanceof CliDiagnostic) usage('explore', error.message.split('\n\nHelp:')[0]!)
    throw error
  }
}

/** The explorer owns launch intent; every execution remains an ordinary installed Run. */
export class PrivateExploreSession {
  readonly #projection: PrivateProjectProjection
  readonly #entries = new Map<string, Entry>()
  #current: DisplayProjectRun = { state: 'idle' }
  #child: Child | undefined
  #registerBridge: RegisterBridge | undefined
  #pending: Promise<DisplayProjectRun> | undefined
  #closing = false
  #closeTask: Promise<void> | undefined

  constructor(
    readonly options: Readonly<{
      projectRoot: string
      timeoutMs: number
      verification?: string
      launch?: PrivateExploreLaunch
    }>,
  ) {
    this.#projection = new PrivateProjectProjection(options.projectRoot)
  }

  bindBridge(register: RegisterBridge): void {
    if (this.#registerBridge || this.#closing) throw new Error('Explorer bridge is unavailable')
    this.#registerBridge = register
  }

  project(targetId?: string): Promise<DisplayProjectSnapshot> {
    return this.#projection.project(targetId)
  }

  projectForTarget(selector?: string): Promise<DisplayProjectSnapshot> {
    return this.#projection.projectForTarget(selector)
  }

  snapshot(): DisplayProjectRun {
    return this.#current
  }

  async run(request: DisplayProjectRunRequest): Promise<DisplayProjectRun> {
    const bytes = canonicalJson(request as unknown as JsonValue)
    const digest = createHash('sha256').update(bytes).digest('hex')
    bytes.fill(0)
    const existing = this.#entries.get(request.requestId)
    if (existing) {
      if (existing.digest !== digest)
        return {
          state: 'refused',
          requestId: request.requestId,
          targetId: request.targetId,
          reason: 'This request identity already names different input. Start a new explicit Run.',
        }
      return existing.status
    }
    const refused = (reason: string): DisplayProjectRun => ({
      state: 'refused',
      requestId: request.requestId,
      targetId: request.targetId,
      reason,
    })
    if (this.#closing) return refused('The explorer is closing. No new Run was started.')
    if (this.#entries.size >= PRIVATE_EXPLORER_LIMITS.requestIdentities)
      return refused(
        'This explorer has reached its Run request limit. Close it and open jig explore again.',
      )
    const previous = this.#child
    const uncertain = this.#current.state === 'uncertain'
    const busy =
      uncertain ||
      this.#pending !== undefined ||
      (previous !== undefined && previous.entry.status.state !== 'settled')
    const entry: Entry = {
      digest,
      status: busy
        ? (refused(
            uncertain
              ? 'The previous Run needs inspection. Check its terminal result and effects, then open a new explorer.'
              : 'A Run already belongs to this explorer. Wait for it to settle before starting another.',
          ) as Entry['status'])
        : { state: 'starting', requestId: request.requestId, targetId: request.targetId },
    }
    this.#entries.set(request.requestId, entry)
    if (busy) return entry.status
    this.#current = entry.status
    const pending = this.#start(request, entry, previous)
    this.#pending = pending
    try {
      return await pending
    } finally {
      if (this.#pending === pending) this.#pending = undefined
    }
  }

  #set(entry: Entry, status: Entry['status']): void {
    entry.status = Object.freeze(status)
    if (this.#current.state !== 'idle' && this.#current.requestId === status.requestId)
      this.#current = entry.status
  }

  #observe(entry: Entry, event: PrivateExplorerRunEvent): void {
    const { requestId, targetId } = entry.status
    if (event.event === 'viewer') {
      if (!['starting', 'running'].includes(entry.status.state)) return
      entry.viewerUrl = event.url
      this.#set(entry, { state: 'running', requestId, targetId, viewerUrl: event.url })
    } else if (['starting', 'running'].includes(entry.status.state)) {
      this.#set(entry, {
        state: 'settled',
        requestId,
        targetId,
        ...(entry.viewerUrl === undefined ? {} : { viewerUrl: entry.viewerUrl }),
      })
    }
  }

  async #start(
    request: DisplayProjectRunRequest,
    entry: Entry,
    previous?: Child,
  ): Promise<DisplayProjectRun> {
    const { requestId, targetId } = request
    let bridge: PrivateExplorerRunBridge | undefined
    let previousClosure = false
    try {
      const selection = await this.#projection.selection(
        request.revision,
        request.targetId,
        request.input,
      )
      if (this.options.launch === undefined || this.#registerBridge === undefined)
        throw new Error('The installed explorer launcher is unavailable')
      if (this.#closing) throw new Error('The explorer is closing')
      if (previous !== undefined) {
        previousClosure = true
        if (previous.entry.viewerUrl !== undefined)
          await previous.process.closeViewer(previous.entry.viewerUrl)
        else await previous.process.finished
        previous.bridge.close()
        if (this.#child === previous) this.#child = undefined
        previousClosure = false
      }
      if (this.#closing) throw new Error('The explorer is closing')
      bridge = this.#registerBridge((event) => this.#observe(entry, event))
      const process = await this.options.launch({
        projectRoot: this.options.projectRoot,
        target: selection.target,
        approval: selection.approval,
        input: request.input,
        timeoutMs: this.options.timeoutMs,
        ...(this.options.verification === undefined
          ? {}
          : { verification: this.options.verification }),
        bridge: { url: bridge.url, capability: bridge.capability },
      })
      const child: Child = { entry, process, bridge, interrupted: false }
      this.#child = child
      void process.finished.then(
        (result) => this.#exited(child, result),
        () => this.#exited(child),
      )
      return entry.status
    } catch (error) {
      bridge?.close()
      this.#set(entry, {
        state: previousClosure ? 'uncertain' : 'refused',
        requestId,
        targetId,
        reason: previousClosure
          ? 'The previous inspector did not confirm closure. Inspect the terminal before starting new work.'
          : error instanceof PrivateProjectProjectionError
            ? error.message
            : this.#closing
              ? 'The explorer is closing. No new Run was started.'
              : 'The ordinary Run could not be prepared. Check the terminal and the installed Jig command.',
      })
      return entry.status
    }
  }

  #exited(child: Child, result?: PrivateExploreProcessResult): void {
    child.bridge.close()
    if (this.#child === child) this.#child = undefined
    const { requestId, targetId } = child.entry.status
    if (
      child.entry.status.state === 'settled' &&
      result?.signal === null &&
      (result.exitCode === 0 ||
        result.exitCode === 1 ||
        (child.interrupted && result.exitCode === 2))
    )
      this.#set(child.entry, { state: 'settled', requestId, targetId })
    else
      this.#set(child.entry, {
        state: 'uncertain',
        requestId,
        targetId,
        reason:
          'The Run command ended without a confirmed settlement handoff. Inspect its terminal result and effects before starting new work.',
      })
  }

  close(): Promise<void> {
    this.#closing = true
    this.#closeTask ??= (async () => {
      await this.#pending
      const child = this.#child
      if (child === undefined) {
        if (this.#current.state === 'uncertain')
          throw new Error('The Run command ended without confirmed settlement')
        return
      }
      try {
        if (child.entry.status.state === 'settled' && child.entry.viewerUrl !== undefined)
          await child.process.closeViewer(child.entry.viewerUrl)
        else {
          child.interrupted = true
          await child.process.interrupt()
        }
        if (child.entry.status.state !== 'settled')
          throw new Error('The Run command did not confirm execution and resource settlement')
      } finally {
        child.bridge.close()
      }
    })()
    return this.#closeTask
  }
}

export async function privateExecuteExplore(
  arguments_: readonly string[],
  options: Readonly<{
    currentDirectory: string
    terminalError: boolean
    assets: WebAssets
    launch?: PrivateExploreLaunch
    signal?: AbortSignal
    presentationDeadline?: number
    writeError(text: string): void | Promise<void>
  }>,
): Promise<number> {
  const parsed = parsePrivateExploreArguments(arguments_)
  if (!options.terminalError)
    throw new CliDiagnostic(
      'JIG_EXPLORE_TERMINAL_REQUIRED',
      'jig explore needs terminal stderr to publish its private browser link. Use jig inspect for ordinary output.',
      1,
    )
  const session = new PrivateExploreSession({
    projectRoot: options.currentDirectory,
    timeoutMs: parsed.timeoutMs,
    ...(parsed.verification === undefined ? {} : { verification: parsed.verification }),
    ...(options.launch === undefined ? {} : { launch: options.launch }),
  })
  try {
    await session.projectForTarget(parsed.target)
  } catch (error) {
    if (error instanceof PrivateProjectProjectionError)
      throw new CliDiagnostic('JIG_EXPLORE_TARGET_UNAVAILABLE', error.message, 1)
    throw error
  }
  options.signal?.throwIfAborted()
  const server = PrivateWebExplorer.prepare({
    assets: options.assets,
    project: async (targetId) => {
      if (targetId !== undefined) return session.project(targetId)
      try {
        // Re-resolve the operator's selector against the current approval. An
        // old opaque ID cannot keep refresh pinned to a superseded generation.
        return await session.projectForTarget(parsed.target)
      } catch (error) {
        if (error instanceof PrivateProjectProjectionError && error.code === 'TARGET_MISSING')
          return session.project()
        throw error
      }
    },
    session: () => session.snapshot(),
    run: (request) => session.run(request),
    onClose: () => session.close(),
  })
  session.bindBridge((event) => server.registerRunBridge(event))
  let timer: ReturnType<typeof setTimeout> | undefined
  const close = () => {
    void server.close().catch(() => {})
  }
  options.signal?.addEventListener('abort', close, { once: true })
  if (options.signal?.aborted) close()
  if (options.presentationDeadline !== undefined) {
    const remaining = options.presentationDeadline - privatePresentationNow()
    timer = setTimeout(close, Math.max(0, remaining))
  }
  try {
    await options.writeError(
      `Application explorer: ${server.launchUrl}\nNo workflow has started. Close explorer or Ctrl-C stops any active Run and waits for cleanup.\n`,
    )
    await server.closed()
    return options.signal?.aborted ? 2 : 0
  } catch {
    throw new CliDiagnostic(
      'JIG_EXPLORE_CLOSE_FAILED',
      'The explorer could not confirm command cleanup. Inspect the terminal result and effects before starting new work.',
      2,
    )
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', close)
    await server.close()
  }
}
