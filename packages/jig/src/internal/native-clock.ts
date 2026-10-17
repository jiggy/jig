import { lstatSync, readFileSync, realpathSync, statfsSync } from 'node:fs'
import { privateMacosBootClock } from './macos-process-controls.js'

/** Closed host elapsed coordinates, shared by processes and including suspend. */
export interface PrivateBootDeadline {
  readonly bootId: string
  readonly monotonicMs: number
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$(?![\s\S])/

function procText(path: string): string {
  const information = lstatSync(path)
  if (
    realpathSync(path) !== path ||
    !information.isFile() ||
    information.isSymbolicLink() ||
    (information.mode & 0o222) !== 0 ||
    BigInt(statfsSync(path).type) !== 0x9fa0n
  )
    throw new Error('Linux boot clock is unavailable')
  return readFileSync(path, 'utf8')
}

export function privateLinuxBootId(): string {
  const text = procText('/proc/sys/kernel/random/boot_id')
  if (!text.endsWith('\n') || !UUID.test(text.slice(0, -1)))
    throw new Error('Linux boot identity is unavailable')
  return text.slice(0, -1)
}

export function readPrivateNativeClock(): PrivateBootDeadline {
  if (process.platform === 'darwin') return privateMacosBootClock()
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch))
    throw new Error('boot-scoped native clock is unavailable')
  const bootId = privateLinuxBootId()
  const text = procText('/proc/uptime')
  if (!/^[0-9]{1,13}\.[0-9]{2} [0-9]{1,16}\.[0-9]{2}\n$(?![\s\S])/.test(text))
    throw new Error('Linux boot clock is unavailable')
  const [seconds, fraction] = text.split(' ')[0]!.split('.')
  const milliseconds = BigInt(seconds!) * 1000n + BigInt(fraction!) * 10n
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Linux boot clock is invalid')
  return Object.freeze({ bootId, monotonicMs: Number(milliseconds) })
}

export function normalizePrivateBootDeadline(value: unknown): PrivateBootDeadline {
  const record = value as Record<string, unknown>
  if (
    record === null ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    Object.keys(record).sort().join() !== 'bootId,monotonicMs' ||
    typeof record.bootId !== 'string' ||
    !UUID.test(record.bootId) ||
    !Number.isSafeInteger(record.monotonicMs) ||
    (record.monotonicMs as number) < 0
  )
    throw new TypeError('invalid native boot deadline')
  return Object.freeze({ bootId: record.bootId, monotonicMs: record.monotonicMs as number })
}

/** A boot change is clock loss, never a fresh allowance or proved expiry. */
export function privateBootRemaining(
  deadline: PrivateBootDeadline,
  now: PrivateBootDeadline = readPrivateNativeClock(),
): number {
  if (deadline.bootId !== now.bootId) throw new Error('native boot clock changed')
  return Math.max(0, deadline.monotonicMs - now.monotonicMs)
}

/** Freeze an internal absolute constraint once, before native sealing/setup. */
export function privateBootDeadlineFromUnix(
  deadlineUnixMs: number,
  now: PrivateBootDeadline = readPrivateNativeClock(),
  unixMs: number = Date.now(),
): PrivateBootDeadline {
  return normalizePrivateBootDeadline({
    bootId: now.bootId,
    monotonicMs: now.monotonicMs + Math.max(0, deadlineUnixMs - unixMs),
  })
}

/** Re-read the suspend-inclusive source; a JS timer alone can pause over sleep. */
export function watchPrivateBootDeadline(
  deadline: PrivateBootDeadline,
  expired: (reason: 'deadline' | 'clock') => void,
  graceMs = 0,
): () => void {
  let stopped = false
  let previousMs: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const check = () => {
    if (stopped) return
    let remaining = 0
    let reason: 'deadline' | 'clock' = 'clock'
    try {
      const now = normalizePrivateBootDeadline(readPrivateNativeClock())
      if (
        now.bootId === deadline.bootId &&
        (previousMs === undefined || now.monotonicMs >= previousMs)
      ) {
        remaining = deadline.monotonicMs + graceMs - now.monotonicMs
        reason = 'deadline'
      }
      previousMs = now.monotonicMs
    } catch {
      // Clock uncertainty stops work, but must not stop cancellation or cleanup.
    }
    if (remaining <= 0) {
      stopped = true
      expired(reason)
    } else timer = setTimeout(check, Math.min(25, remaining))
  }
  check()
  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
