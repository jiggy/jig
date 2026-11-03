import type { StdioOptions } from 'node:child_process'

/** Keep descriptor custody with the caller instead of transferring numeric extra stdio to Bun. */
export function privateLinuxInheritedStdio(
  prefix: readonly ('pipe' | 'ignore' | 'inherit')[],
  descriptors: readonly number[],
): StdioOptions {
  if (
    prefix.length !== 6 ||
    descriptors.length > 64 ||
    new Set(descriptors).size !== descriptors.length ||
    descriptors.some((fd) => !Number.isSafeInteger(fd) || fd < 6 || fd >= 1_048_576)
  )
    throw new TypeError('invalid inherited input descriptors')
  const stdio: ('pipe' | 'ignore' | 'inherit')[] = Array.from(
    { length: Math.max(prefix.length, ...descriptors.map((fd) => fd + 1)) },
    () => 'ignore',
  )
  for (const [index, value] of prefix.entries()) stdio[index] = value
  for (const fd of descriptors) stdio[fd] = 'inherit'
  return stdio
}
