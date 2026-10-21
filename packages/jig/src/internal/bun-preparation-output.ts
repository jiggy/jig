import { constants } from 'node:fs'
import { type FileHandle, open } from 'node:fs/promises'
import {
  type CapturedPackage,
  capturePrivateFencedPreparationDirectory,
} from '../package/capture.js'
import {
  type PrivateBunPreparationMode,
  privateBunPreparationLimits,
} from './bun-native-preparation-protocol.js'
import { closePrivateExecutionDirectory } from './execution-output.js'
import { privateMacosOpenAt } from './macos-descriptor-files.js'

/** Closed collection profile, never a caller-selected path or byte allowance. */
export function requirePrivateBunPreparationOutput(
  value: unknown,
): PrivateBunPreparationMode | undefined {
  if (value === undefined || value === 'production' || value === 'evaluation') return value
  throw new TypeError('invalid Bun preparation collection profile')
}

/** Borrow only an authentic native work collector after complete writer fencing. */
export async function capturePrivateBunPreparationOutput(
  work: FileHandle,
  mode: PrivateBunPreparationMode,
): Promise<CapturedPackage> {
  const selected = requirePrivateBunPreparationOutput(mode)
  if (selected === undefined) throw new TypeError('Bun preparation collection profile is missing')
  const limits = privateBunPreparationLimits(selected)
  const flags =
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  const directory =
    process.platform === 'darwin'
      ? await privateMacosOpenAt(work.fd, 'prepared', flags)
      : await open(`/proc/self/fd/${work.fd}/prepared`, flags)
  let captured: CapturedPackage | undefined
  const failures: unknown[] = []
  try {
    if ((await directory.stat()).dev !== (await work.stat()).dev)
      throw new TypeError('Bun preparation collection crossed a mount')
    captured = await capturePrivateFencedPreparationDirectory(directory, {
      maximumFiles: limits.preparedFiles,
      maximumBytes: limits.preparedBytes,
    })
  } catch (error) {
    failures.push(error)
  }
  const closed = await Promise.allSettled([closePrivateExecutionDirectory(directory)])
  if (closed[0]!.status === 'rejected') {
    failures.push(closed[0]!.reason)
    const disposed = await Promise.allSettled([captured?.dispose()])
    if (disposed[0]!.status === 'rejected') failures.push(disposed[0]!.reason)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1)
    throw new AggregateError(failures, 'Bun preparation capture and retirement failed')
  return captured!
}
