import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  statfsSync,
} from 'node:fs'
import {
  privateMacosCopyOwnerAbsent,
  privateMacosCurrentProcessIdentity,
} from './macos-process-controls.js'
import { readPrivateNativeClock } from './native-clock.js'

/** Copy-only process identity. It does not identify or authorize an execution. */
export interface PrivateAttemptExportOwner {
  readonly bootId: string
  readonly pid: number
  readonly generation: string
  readonly platform: 'linux' | 'darwin'
}

function qualifyProc(): void {
  if (realpathSync('/proc') !== '/proc' || BigInt(statfsSync('/proc').type) !== 0x9fa0n)
    throw new Error('Export process identity is unavailable.')
}

/** Linux stat's comm field may contain spaces, parentheses and newlines. */
export function parsePrivateExportProcessStat(text: string, pid: number): string {
  const end = text.lastIndexOf(') ')
  if (!text.startsWith(`${pid} (`) || end < 0 || text.length > 8192)
    throw new Error('Export process identity is unavailable.')
  const fields = text
    .slice(end + 2)
    .trimEnd()
    .split(' ')
  // State is field 3; starttime is field 22.
  const generation = fields[19]
  if (
    !/^[A-Za-z]$/.test(fields[0] ?? '') ||
    !/^[0-9]+$/.test(generation ?? '') ||
    BigInt(generation!) <= 0n ||
    fields.length < 50
  )
    throw new Error('Export process identity is unavailable.')
  return generation!
}

function linuxGeneration(pid: number): string {
  qualifyProc()
  const fd = openSync(
    `/proc/${pid}/stat`,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    if (!fstatSync(fd).isFile() || BigInt(statfsSync(`/proc/${pid}`).type) !== 0x9fa0n)
      throw new Error('Export process identity is unavailable.')
    const bytes = Buffer.alloc(8193)
    const length = readSync(fd, bytes, 0, bytes.length, null)
    return parsePrivateExportProcessStat(bytes.subarray(0, length).toString('utf8'), pid)
  } finally {
    closeSync(fd)
  }
}

export function privateAttemptExportOwner(): PrivateAttemptExportOwner {
  const clock = readPrivateNativeClock()
  if (process.platform === 'linux')
    return {
      bootId: clock.bootId,
      pid: process.pid,
      generation: linuxGeneration(process.pid),
      platform: 'linux',
    }
  if (process.platform === 'darwin')
    return {
      bootId: clock.bootId,
      pid: process.pid,
      generation: String(privateMacosCurrentProcessIdentity().version),
      platform: 'darwin',
    }
  throw new Error('Export process identity is unavailable.')
}

/** Never infer death from a deadline, an unreadable process, or a reused PID.
 * Reboot proves death only for this copy-only owner's tasks, not execution cleanup.
 * Captured immutable FDs retain their own kernel bytes; pins protect future DB reads. */
export function privateAttemptExportOwnerGone(owner: PrivateAttemptExportOwner): boolean {
  try {
    if (
      !Number.isSafeInteger(owner.pid) ||
      owner.pid < 1 ||
      !/^[0-9]+$/.test(owner.generation) ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(owner.bootId) ||
      owner.platform !== process.platform
    )
      return false
    const now = readPrivateNativeClock()
    if (now.bootId !== owner.bootId) return true
    if (owner.platform === 'darwin') return privateMacosCopyOwnerAbsent(owner.pid)
    // Qualify a live native procfs read before interpreting ENOENT as absence.
    linuxGeneration(process.pid)
    try {
      linuxGeneration(owner.pid)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
    }
  } catch {
    return false
  }
}
