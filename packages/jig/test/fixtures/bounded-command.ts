import { open } from 'node:fs/promises'

interface CommandChild {
  readonly exited: Promise<number>
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  kill(signal: 'SIGINT' | 'SIGKILL'): void
}

/** Test-only process ownership. Jig's independent owner still fences its payloads. */
export async function settleTestCommand(
  child: CommandChild,
  options: {
    evidence: string
    timeoutMs?: number
    graceMs?: number
    stdoutLimit?: number
    stderrLimit?: number
  },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const failures: unknown[] = []
  let stopping = false
  let exited = false
  let escalation: ReturnType<typeof setTimeout> | undefined
  const stop = (error: unknown) => {
    failures.push(error)
    if (stopping || exited) return
    stopping = true
    try {
      child.kill('SIGINT')
    } catch (error) {
      failures.push(error)
    }
    escalation = setTimeout(() => {
      if (!exited) {
        try {
          child.kill('SIGKILL')
        } catch (error) {
          failures.push(error)
        }
      }
    }, options.graceMs ?? 5_000)
  }
  const timer = setTimeout(
    () => stop(new Error('Installed command timed out')),
    options.timeoutMs ?? 120_000,
  )
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  const collect = async (stream: ReadableStream<Uint8Array>, limit: number, name: string) => {
    const reader = stream.getReader()
    readers.push(reader)
    const chunks: Uint8Array[] = []
    let size = 0
    let overflow = false
    let file: Awaited<ReturnType<typeof open>> | undefined
    try {
      // Keep already-observed evidence even if the capturing process dies.
      // Refuse collisions rather than replacing an earlier qualification.
      file = await open(`${options.evidence}.${name}`, 'wx')
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const remaining = limit - size
        if (remaining > 0) {
          const kept = value.slice(0, remaining)
          chunks.push(kept)
          size += kept.byteLength
          await file.writeFile(kept)
        }
        if (value.byteLength > remaining && !overflow) {
          overflow = true
          stop(new Error(`Installed ${name} exceeded test bound`))
        }
      }
    } catch (error) {
      stop(error)
    } finally {
      reader.releaseLock()
      try {
        await file?.close()
      } catch (error) {
        stop(error)
      }
    }
    return Buffer.concat(chunks).toString()
  }
  const stdout = collect(child.stdout, options.stdoutLimit ?? 2 * 1024 * 1024, 'stdout')
  const stderr = collect(child.stderr, options.stderrLimit ?? 256 * 1024, 'stderr')
  let code = -1
  try {
    code = await child.exited
  } catch (error) {
    stop(error)
  } finally {
    exited = true
    clearTimeout(timer)
    clearTimeout(escalation)
  }
  // A descendant retaining a pipe must not keep qualification hanging after
  // its coordinator exited. This is a diagnostic failure, not cleanup proof.
  const drain = setTimeout(() => {
    failures.push(new Error('Installed command output did not settle after exit'))
    for (const reader of readers) void reader.cancel().catch(() => {})
  }, options.graceMs ?? 5_000)
  let result: { code: number; stdout: string; stderr: string }
  try {
    result = { code, stdout: await stdout, stderr: await stderr }
  } finally {
    clearTimeout(drain)
  }
  if (failures.length)
    throw new AggregateError(failures, `Installed command failed; evidence: ${options.evidence}`)
  return result
}
