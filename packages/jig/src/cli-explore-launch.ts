import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DISPLAY_EXPLORER_FILE_BYTES,
  DISPLAY_EXPLORER_FILE_COUNT,
  DISPLAY_EXPLORER_TOTAL_BYTES,
  type DisplayExplorerInputFile,
} from '@jigging/display-model'
import type { PrivateExplorerRunBridge, PrivateExplorerRunEvent } from './cli-explorer-web.js'
import { canonicalJson, type JsonValue } from './json.js'
import type { RunTargetRef } from './project/author.js'
import { flowSelector } from './project/package-selector.js'

const HANDOFF = 'JIG_PRIVATE_EXPLORE_HANDOFF'
const STOP_GRACE_MS = 65_000
const STOP_EXIT_MS = 5_000
const VIEWER_EXIT_MS = 10_000

export type PrivateExploreProcessResult = Readonly<{
  exitCode: number | null
  signal: NodeJS.Signals | null
}>
export interface PrivateExploreRunProcess {
  readonly finished: Promise<PrivateExploreProcessResult>
  /** Interrupts this exact ordinary command; its installed owners settle execution. */
  interrupt(): Promise<void>
  /** Joins a settled command, closing its read-only inspector when one was handed off. */
  closeViewer(url?: string): Promise<void>
}
export type PrivateExploreLaunch = (
  input: Readonly<{
    projectRoot: string
    target: RunTargetRef
    approval: string
    input: JsonValue
    files: readonly DisplayExplorerInputFile[]
    timeoutMs: number
    verification?: string
    bridge: Pick<PrivateExplorerRunBridge, 'url' | 'capability'>
  }>,
) => Promise<PrivateExploreRunProcess>

function viewerUrl(value: string): URL {
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/#cap=([A-Za-z0-9_-]{43})$/.exec(value)
  if (!match || Number(match[1]) > 65535) throw new Error('Run inspector is unavailable')
  return new URL(value)
}

function handoff(value: unknown): Readonly<{ url: string; capability: string }> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Explorer handoff is unavailable')
  const object = value as Record<string, unknown>
  if (
    Object.keys(object).sort().join(',') !== 'capability,url' ||
    typeof object.url !== 'string' ||
    typeof object.capability !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(object.capability)
  )
    throw new Error('Explorer handoff is unavailable')
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/internal\/run$/.exec(object.url)
  if (!match || Number(match[1]) > 65535) throw new Error('Explorer handoff is unavailable')
  return Object.freeze({ url: object.url, capability: object.capability })
}

/** Installed-host-only notification. No invocation input or authority is returned. */
export function privateExploreHandoff(environment: Readonly<NodeJS.ProcessEnv> = process.env):
  | Readonly<{
      onWebDisplay(url: string): Promise<void>
      onRunSettled(): Promise<void>
    }>
  | undefined {
  const encoded = environment[HANDOFF]
  if (encoded === undefined) return undefined
  if (Buffer.byteLength(encoded) > 1024) throw new Error('Explorer handoff is unavailable')
  const selected = handoff(JSON.parse(encoded))
  let pending = Promise.resolve()
  const send = (event: PrivateExplorerRunEvent): Promise<void> => {
    const next = pending.then(async () => {
      const response = await fetch(selected.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${selected.capability}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
        redirect: 'error',
        signal: AbortSignal.timeout(2_000),
      })
      try {
        if (!response.ok) throw new Error('Explorer handoff is unavailable')
      } finally {
        await response.body?.cancel()
      }
    })
    pending = next.catch(() => {})
    return next
  }
  return Object.freeze({
    async onWebDisplay(url: string) {
      viewerUrl(url)
      await send({ event: 'viewer', url })
    },
    async onRunSettled() {
      await send({ event: 'settled' })
    },
  })
}

function wait<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Run command closure was not confirmed')),
        milliseconds,
      )
    }),
  ]).finally(() => clearTimeout(timer))
}

/** Stage selected bytes only under the fresh private explorer directory. No caller paths. */
export async function privateStageExploreFiles(
  directory: string,
  files: readonly DisplayExplorerInputFile[],
): Promise<readonly string[]> {
  const staged: string[] = []
  if (files.length > DISPLAY_EXPLORER_FILE_COUNT)
    throw new Error('Too many selected input attachments')
  const names = new Set<string>()
  let totalBytes = 0
  if (files.length) await mkdir(join(directory, 'attachments'), { mode: 0o700 })
  for (const file of files) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(file.attachment) ||
      names.has(file.attachment) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(file.filename)
    )
      throw new Error('Invalid selected input attachment')
    names.add(file.attachment)
    const decoded = Buffer.from(file.base64, 'base64')
    try {
      if (
        decoded.toString('base64') !== file.base64 ||
        decoded.length > DISPLAY_EXPLORER_FILE_BYTES ||
        (totalBytes += decoded.length) > DISPLAY_EXPLORER_TOTAL_BYTES
      )
        throw new Error('Selected input exceeds the immutable capture allowance')
      const root = join(directory, 'attachments', file.attachment)
      await mkdir(root, { mode: 0o700 })
      await writeFile(join(root, file.filename), decoded, { flag: 'wx', mode: 0o600 })
      staged.push(file.attachment + '=' + root)
    } finally {
      decoded.fill(0)
    }
  }
  return staged
}

/** A fresh ordinary installed Run owns every launch, including native and file recovery. */
export function privateInstalledExploreLaunch(
  location: Readonly<{
    releaseRoot: string
  }>,
): PrivateExploreLaunch {
  return async (input) => {
    const bridge = handoff(input.bridge)
    if (!/^sha256:[a-f0-9]{64}$/.test(input.approval))
      throw new Error('Reviewed selection is unavailable')
    const bytes = canonicalJson(input.input)
    const directory = await mkdtemp(join(await realpath(tmpdir()), 'jig-explore-'))
    let child: ChildProcess | undefined
    try {
      const path = join(directory, 'input.json')
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
      const staged = await privateStageExploreFiles(directory, input.files)
      const environment = { ...process.env }
      // An explorer never lends another command's coordinator, file owner or approval.
      for (const name of Object.keys(environment))
        if (name.startsWith('JIG_PRIVATE_') && name !== 'JIG_PRIVATE_PRESENTATION_DEADLINE')
          delete environment[name]
      environment.JIG_PRIVATE_RUN_ADMISSION = input.approval
      environment[HANDOFF] = JSON.stringify(bridge)
      const selector =
        input.target.kind === 'flow'
          ? flowSelector(input.target.path)
          : `binding:${input.target.id}`
      const arguments_ = [
        'run',
        selector,
        '--input',
        `@${path}`,
        ...staged.flatMap((attachment) => ['--attach', attachment]),
        '--timeout',
        `${input.timeoutMs}ms`,
        '--display',
        'web',
        ...(input.verification === undefined ? [] : ['--verification', input.verification]),
      ]
      // Fresh work crosses the public installed launcher again, including the
      // contributor build check; only the Run's own owners use direct reexecution.
      child = spawn(join(location.releaseRoot, 'bin/jig'), arguments_, {
        cwd: input.projectRoot,
        env: environment,
        // Input was captured above; the explorer and its child never contend for stdin.
        stdio: ['ignore', 'inherit', 'inherit'],
        // Terminal signals belong to the explorer. Keep this child referenced
        // and joined, but outside the terminal's foreground process group so
        // Ctrl-C cannot race ordinary interruption against a settled viewer close.
        detached: true,
        windowsHide: true,
      })
      const command = child
      const finished = new Promise<PrivateExploreProcessResult>((resolve, reject) => {
        let failed = false
        // A failed signal can also emit error after a successful spawn. It is
        // not process-exit evidence and cannot release this command's owner.
        command.on('error', () => {
          failed = true
        })
        command.once('close', (exitCode, signal) => {
          if (failed) reject(new Error('The ordinary Run command did not close normally'))
          else resolve({ exitCode, signal })
        })
      }).finally(async () => {
        await rm(directory, { recursive: true, force: true })
      })
      // The session always joins this exact promise; an early child failure is still observed.
      void finished.catch(() => {})
      let interruption: Promise<void> | undefined
      const interrupt = (): Promise<void> => {
        interruption ??= (async () => {
          if (command.exitCode === null && command.signalCode === null) command.kill('SIGINT')
          try {
            await wait(finished, STOP_GRACE_MS)
          } catch (error) {
            if (command.exitCode === null && command.signalCode === null) {
              command.kill('SIGKILL')
              await wait(finished, STOP_EXIT_MS).catch(() => {})
            }
            // Escalation or an unconfirmed exit is not evidence of native cleanup.
            throw error
          }
        })()
        return interruption
      }
      return Object.freeze({
        finished,
        interrupt,
        async closeViewer(value?: string) {
          const deadline = performance.now() + VIEWER_EXIT_MS
          let closeFailure: unknown
          if (value !== undefined) {
            const url = viewerUrl(value)
            const capability = url.hash.slice('#cap='.length)
            try {
              const response = await fetch(`${url.origin}/api/close`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${capability}`, Origin: url.origin },
                redirect: 'error',
                signal: AbortSignal.timeout(2_000),
              })
              try {
                if (!response.ok && response.status !== 410)
                  throw new Error('The previous inspector could not be closed')
              } finally {
                await response.body?.cancel()
              }
            } catch (error) {
              closeFailure = error
            }
          }
          // The user may have just closed this inspector directly. Only the
          // exact command's normal exit resolves that race or a missing viewer
          // handoff. Never retry a POST or accept an unchecked bare join.
          const result = await wait(finished, Math.max(1, deadline - performance.now())).catch(
            (error) => {
              throw closeFailure ?? error
            },
          )
          if (result.signal !== null || (result.exitCode !== 0 && result.exitCode !== 1))
            throw new Error('The previous Run command did not confirm normal closure')
        },
      })
    } catch (error) {
      if (child === undefined) await rm(directory, { recursive: true, force: true })
      throw error
    } finally {
      bytes.fill(0)
    }
  }
}
