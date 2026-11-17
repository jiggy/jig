import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import QUALIFIED_BUN from './qualified-bun.json' with { type: 'json' }

// Admission records observed builds; complete native tests establish behavior.
export const MAC_HOST_POLICY = Object.freeze({
  architecture: 'arm64',
  minimumDarwinMajor: 24,
  releaseMajors: Object.freeze([15, 26]),
  bun: QUALIFIED_BUN.version,
  revision: QUALIFIED_BUN.revision,
})

export function requireMacHostPrerequisites(evidence, architecture) {
  const kernel = typeof evidence?.kernel === 'string' && /^(\d+)\.\d+\.\d+$/.exec(evidence.kernel)
  if (
    architecture !== MAC_HOST_POLICY.architecture ||
    evidence?.kind !== 'macos-host-prerequisites/1' ||
    evidence.arch !== architecture ||
    !kernel ||
    kernel[0] !== evidence.kernel ||
    Number(kernel[1]) < MAC_HOST_POLICY.minimumDarwinMajor ||
    typeof evidence.build !== 'string' ||
    evidence.build.trim() !== evidence.build ||
    !/^[0-9]{2}[A-Z][0-9A-Za-z]{2,15}$/.test(evidence.build) ||
    evidence.bun !== MAC_HOST_POLICY.bun ||
    evidence.revision !== MAC_HOST_POLICY.revision ||
    evidence.processIdentityBytes !== 56 ||
    evidence.coalitionIdentityBytes !== 40 ||
    evidence.coalitionUsageBytes !== 296 ||
    !Number.isSafeInteger(evidence.pidVersion) ||
    evidence.pidVersion < 0 ||
    evidence.backendQualified !== false
  )
    throw new Error(
      'Mac host prerequisites require native ARM macOS 15+ accounting capabilities and the qualified Bun runtime',
    )
  return evidence
}

export function readMacHostPrerequisites(path, architecture) {
  if (!constants.O_NOFOLLOW || !constants.O_NONBLOCK)
    throw new Error('Mac prerequisite reads require no-follow and nonblocking support')
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile() || metadata.size > 8192)
      throw new Error('Mac prerequisites require a bounded regular file')
    const bytes = Buffer.alloc(8193)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null)
      if (count === 0) break
      length += count
    }
    if (length > 8192) throw new Error('Mac prerequisites require a bounded regular file')
    return requireMacHostPrerequisites(
      JSON.parse(bytes.subarray(0, length).toString('utf8')),
      architecture,
    )
  } finally {
    closeSync(descriptor)
  }
}
