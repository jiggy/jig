import { spawn } from 'node:child_process'

import { JSON_1_LIMITS } from '../json.js'
import {
  PRIVATE_AUTHOR_EVALUATOR_ENTRY_MS,
  PRIVATE_AUTHOR_EVALUATOR_MACOS_ENTRY_MS,
  PRIVATE_AUTHOR_EVALUATOR_WORKER,
} from './project-evaluator-policy.js'

export class PrivateAuthorEvaluatorChildError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PrivateAuthorEvaluatorChildError'
  }
}

/** Trusted review work only. Runs inside the already-contained batch manager. */
export async function runPrivateAuthorEvaluatorChild(
  request: Uint8Array,
  // Package-private fault-test seam; authored declarations cannot select this.
  workerPath = PRIVATE_AUTHOR_EVALUATOR_WORKER,
  sdkPath?: string,
): Promise<Uint8Array> {
  const entryWallClockCeilingMs =
    process.platform === 'darwin'
      ? PRIVATE_AUTHOR_EVALUATOR_MACOS_ENTRY_MS
      : PRIVATE_AUTHOR_EVALUATOR_ENTRY_MS
  const started = performance.now()
  const child = spawn(
    process.execPath,
    ['--no-env-file', '--no-install', '--config=/dev/null', workerPath],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: sdkPath === undefined ? process.env : { ...process.env, JIG_EVALUATOR_SDK: sdkPath },
    },
  )
  let timedOut = false
  let closed = false
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      closed = true
      resolve({ code, signal })
    })
  })
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, entryWallClockCeilingMs)
  const stdout = collect(child.stdout, JSON_1_LIMITS.bytes)
  const stderr = collect(child.stderr, 64 * 1024)
  const input = new Promise<void>((resolve, reject) => {
    child.stdin.once('error', reject)
    child.stdin.end(request, () => resolve())
  })
  try {
    const [output, , exit] = await Promise.all([stdout, stderr, exited, input])
    if (timedOut || performance.now() - started >= entryWallClockCeilingMs) {
      throw failure('PROJECT_EVALUATOR_DEADLINE', 'declaration reached its hard wall deadline')
    }
    if (exit.code !== 0 || exit.signal !== null) {
      throw failure('PROJECT_EVALUATION_FAILED', 'declaration worker did not exit successfully')
    }
    return output
  } catch (error) {
    if (timedOut) {
      throw failure('PROJECT_EVALUATOR_DEADLINE', 'declaration reached its hard wall deadline')
    }
    throw error
  } finally {
    clearTimeout(timer)
    if (!closed) child.kill('SIGKILL')
    // Reap even after output overflow or cancellation. The outer supervisor
    // remains responsible for fatal cleanup failure and the complete cohort.
    await Promise.allSettled([stdout, stderr, exited, input])
  }
}

async function collect(stream: AsyncIterable<Uint8Array>, maximum: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.byteLength
    if (size > maximum)
      throw failure('PROJECT_EVALUATION_LIMIT', 'declaration output exceeds its byte bound')
    chunks.push(chunk.slice())
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function failure(code: string, message: string): PrivateAuthorEvaluatorChildError {
  return new PrivateAuthorEvaluatorChildError(code, message)
}
