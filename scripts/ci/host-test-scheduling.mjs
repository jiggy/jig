import { readFileSync } from 'node:fs'

// Source-pinned observations are advisory. Membership, command limits and
// qualification are always reconstructed independently from the suite catalog.
export const HOST_TEST_DURATIONS = JSON.parse(
  readFileSync(new URL('./host-test-durations.json', import.meta.url), 'utf8'),
)

export function hostTestSeconds(file, profile, durations = HOST_TEST_DURATIONS) {
  if (!Object.hasOwn(durations.fileSeconds, profile))
    throw new Error(`Unknown host timing profile: ${profile}`)
  const observed = durations.fileSeconds[profile][file]
  if (observed !== undefined) {
    if (!Number.isFinite(observed) || observed <= 0)
      throw new Error(`Invalid whole-file duration: ${file}`)
    return observed
  }
  // New installed/lifecycle files can take minutes. Do not schedule them as
  // two-second checks merely because they have no historical observation yet.
  return /^packages\/jig\/test\/(?:host|linux-host)\//.test(file) ? 60 : 2
}

export function balanceWholeFiles(files, count, secondsForFile, initialSeconds = []) {
  if (!Number.isInteger(count) || count < 1 || files.length < count)
    throw new Error('Whole-file scheduling requires nonempty shards')
  if (new Set(files).size !== files.length) throw new Error('Whole-file inventory repeats a file')
  const shards = Array.from({ length: count }, (_, index) => {
    const estimatedSeconds = initialSeconds[index] ?? 0
    if (!Number.isFinite(estimatedSeconds) || estimatedSeconds < 0)
      throw new Error('Invalid fixed shard duration')
    return { index, groups: [], estimatedSeconds }
  })
  const groups = files.map((file) => {
    const estimatedSeconds = secondsForFile(file)
    if (!Number.isFinite(estimatedSeconds) || estimatedSeconds <= 0)
      throw new Error(`Invalid whole-file duration: ${file}`)
    return { file, estimatedSeconds }
  })
  groups.sort((a, b) => b.estimatedSeconds - a.estimatedSeconds || a.file.localeCompare(b.file))
  for (const group of groups) {
    const target = [...shards].sort(
      (a, b) => a.estimatedSeconds - b.estimatedSeconds || a.index - b.index,
    )[0]
    target.groups.push(group)
    target.estimatedSeconds += group.estimatedSeconds
  }
  if (shards.some((shard) => shard.groups.length === 0))
    throw new Error('Whole-file scheduling leaves an empty shard')
  return shards
}
