import { spawn } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { invalid, unavailable } from '../diagnostics.js'
import { decodeJson1 } from '../json.js'

export interface GeneratedContract {
  source: string
  artifacts: Record<string, string>
}

export async function generateContract(
  source: string,
  signal: AbortSignal,
  workerPath?: string,
): Promise<GeneratedContract> {
  signal.throwIfAborted()
  const override = process.env.JIG_AUTHORING_NODE_PATH
  if (override !== undefined && !isAbsolute(override))
    unavailable('AUTHORING_NODE', 'Select an absolute Node executable.')
  let node: string | undefined
  for (const path of override
    ? [override]
    : ['/usr/bin/node', '/usr/local/bin/node', '/run/current-system/sw/bin/node']) {
    try {
      const resolved = await realpath(path)
      if ((await lstat(resolved)).isFile()) {
        node = resolved
        break
      }
    } catch {}
  }
  if (!node)
    unavailable(
      'AUTHORING_NODE',
      'Contract generation requires Node 22+; set JIG_AUTHORING_NODE_PATH to its absolute executable.',
    )
  const worker =
    workerPath ??
    fileURLToPath(new URL('./authoring/contract-authoring-worker.js', import.meta.url))
  return await new Promise((resolve, reject) => {
    const child = spawn(node, [worker], { cwd: '/', env: {}, stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    let bytes = 0,
      stderrBytes = 0,
      failed = false
    const abort = () => {
      failed = true
      child.kill('SIGKILL')
    }
    const timer = setTimeout(abort, 22000)
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 2097152) abort()
      else stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > 4096) abort()
    })
    child.stdin.on('error', () => {
      failed = true
    })
    child.on('error', () => {
      failed = true
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      try {
        signal.throwIfAborted()
        if (failed || stdout.length === 0 || (code !== 0 && code !== 1))
          unavailable(
            'AUTHORING_COMPILER',
            'The bounded compiler did not complete. Check Node 22+ and retry generation.',
          )
        const result = decodeJson1(Buffer.concat(stdout)) as unknown as GeneratedContract & {
          error?: { code?: string; message?: string; line?: number; column?: number }
        }
        if (result.error)
          invalid(
            'AUTHORING_COMPILE',
            `Contract generation failed: ${String(result.error.code).slice(0, 80)} at line ${Number(result.error.line) || 1}, column ${Number(result.error.column) || 1}. ${String(result.error.message).slice(0, 1024)}`,
            'FLOW.contract.tsp',
          )
        resolve(result)
      } catch (error) {
        reject(error)
      }
    })
    if (signal.aborted) abort()
    else child.stdin.write(JSON.stringify({ source }) + '\n')
  })
}
