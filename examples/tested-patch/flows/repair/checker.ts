import { join } from 'node:path'
import { sha256 } from './policy.ts'

const script = join(import.meta.dir, 'check.ts')
const cases = join(import.meta.dir, 'checks.json')
const LOG_LIMIT = 16384

async function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  let kept = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    const chunk = value.subarray(0, Math.max(0, LOG_LIMIT - kept))
    if (chunk.byteLength) chunks.push(chunk)
    kept += chunk.byteLength
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes, truncated: bytes > LOG_LIMIT }
}

export async function checkValues(values: unknown[], signal: AbortSignal) {
  signal.throwIfAborted()
  const identity = {
    checkerSha256: sha256(await Bun.file(script).text()),
    casesSha256: sha256(await Bun.file(cases).text()),
  }
  signal.throwIfAborted()
  const child = Bun.spawn(
    [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', script],
    {
      cwd: import.meta.dir,
      // Inherit the enclosing Flow's host-supplied runtime environment. Clearing
      // it breaks the installed executable's dynamic-library closure.
      env: process.env,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const cancel = () => child.kill('SIGKILL')
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const timer = setTimeout(cancel, 5000)
  try {
    child.stdin.write(JSON.stringify(values))
    await child.stdin.end()
    const [stdout, stderr] = await Promise.all([
      collect(child.stdout),
      collect(child.stderr),
      child.exited,
    ])
    signal.throwIfAborted()
    return {
      ...identity,
      exitCode: child.exitCode,
      signal: child.signalCode ?? null,
      stdout,
      stderr,
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
    if (child.exitCode === null) child.kill('SIGKILL')
    await child.exited
  }
}
