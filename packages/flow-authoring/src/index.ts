import { Worker } from 'node:worker_threads'
import { type AuthoringDiagnostic, AuthoringError, fail } from './errors.js'
import { getToolchain, readHeader, type SourceHeader } from './toolchain.js'

export type { AuthoringDiagnostic } from './errors.js'
export { AuthoringError } from './errors.js'
export type { SourceHeader, Toolchain } from './toolchain.js'
export { getToolchain, stampSource } from './toolchain.js'
export interface Compilation {
  readonly source: string
  readonly authoring: SourceHeader
  readonly artifacts: Readonly<Record<string, string>>
}

/** Compile explicit source into a bounded artifact packet, with no publication. */
export async function compileContract(
  source: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Compilation> {
  if ('bun' in process.versions)
    fail('RUNTIME_UNSUPPORTED', 'Run the authoring prototype with Node 22 or newer.')
  const timeout = options.timeoutMs ?? 10000
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 10000) {
    fail('SOURCE_INVALID', 'Compilation timeout must be 1–10000 milliseconds.')
  }
  if (options.signal?.aborted) fail('CANCELLED', 'Compilation was cancelled before it started.')
  const header = readHeader(source, await getToolchain())
  if (options.signal?.aborted) fail('CANCELLED', 'Compilation was cancelled before it started.')
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: { source, types: header.types },
      env: {},
      execArgv: [],
      stdout: true,
      stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
    })
    let settled = false,
      diagnosticBytes = 0
    const diagnostic = (code: string, message: string) => ({ code, message, line: 1, column: 1 })
    async function finish(result?: Record<string, string>, error?: AuthoringDiagnostic) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      try {
        await worker.terminate()
        if (error) reject(new AuthoringError(error))
        else resolve({ source, authoring: header, artifacts: Object.freeze(result!) })
      } catch {
        reject(
          new AuthoringError(
            diagnostic('COMPILER_CLEANUP_FAILED', 'Compiler settlement could not be confirmed.'),
          ),
        )
      }
    }
    const abort = () => {
      void finish(
        undefined,
        diagnostic('CANCELLED', 'Compilation was cancelled; no artifacts were returned.'),
      )
    }
    const timer = setTimeout(() => {
      void finish(undefined, diagnostic('COMPILER_LIMIT', 'Compilation exceeded its time limit.'))
    }, timeout)
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    worker.on(
      'message',
      (message: { artifacts?: Record<string, string>; diagnostic?: AuthoringDiagnostic }) => {
        void finish(message.artifacts, message.diagnostic)
      },
    )
    worker.on('error', () => {
      void finish(
        undefined,
        diagnostic('COMPILER_FAILED', 'Compiler worker failed; no artifacts were returned.'),
      )
    })
    worker.on('exit', () => {
      if (!settled)
        void finish(undefined, diagnostic('COMPILER_FAILED', 'Compiler exited without a result.'))
    })
    for (const stream of [worker.stdout, worker.stderr])
      stream.on('data', (chunk: Buffer) => {
        diagnosticBytes += chunk.length
        if (diagnosticBytes > 4096)
          void finish(
            undefined,
            diagnostic('COMPILER_LIMIT', 'Compiler diagnostics exceeded their bound.'),
          )
      })
  })
}
