import { dlopen, ptr } from 'bun:ffi'
import { strict as assert } from 'node:assert'
import { release } from 'node:os'
import { MAC_HOST_PROFILES, requireMacHostPrerequisites } from './macos-host-profiles.mjs'

// Candidate prerequisite evidence only; this does not authorize the host backend.
assert.equal(process.platform, 'darwin')
assert.ok(process.arch === 'x64' || process.arch === 'arm64')
assert.notEqual(process.getuid?.(), 0)
assert.equal(Bun.version, '1.4.2')
assert.ok(
  process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--hosted'),
)
const library = dlopen('/usr/lib/libSystem.B.dylib', {
  proc_pidinfo: { args: ['i32', 'i32', 'u64', 'ptr', 'i32'], returns: 'i32' },
  coalition_info_resource_usage: { args: ['u64', 'ptr', 'u64'], returns: 'i32' },
  proc_signal_with_audittoken: { args: ['ptr', 'i32'], returns: 'i32' },
  sysctlbyname: { args: ['ptr', 'ptr', 'ptr', 'ptr', 'u64'], returns: 'i32' },
})
try {
  function kernel(key: string): string {
    const name = Buffer.from(`${key}\0`),
      value = Buffer.alloc(128),
      length = Buffer.alloc(8)
    length.writeBigUInt64LE(BigInt(value.length))
    assert.equal(library.symbols.sysctlbyname(ptr(name), ptr(value), ptr(length), null, 0), 0)
    const size = Number(length.readBigUInt64LE())
    assert.ok(size > 1 && size <= value.length && value[size - 1] === 0)
    return value.subarray(0, size - 1).toString('ascii')
  }
  const identity = {
    kind: 'macos-host-prerequisites/1',
    arch: process.arch,
    kernel: release(),
    build: kernel('kern.osversion'),
    bun: Bun.version,
    revision: Bun.revision,
    backendQualified: false,
  }
  if (process.argv[2] === '--hosted') {
    const expected = MAC_HOST_PROFILES[process.arch as keyof typeof MAC_HOST_PROFILES]
    if (
      Object.entries(expected).some(
        ([key, value]) => identity[key as keyof typeof identity] !== value,
      )
    ) {
      console.log(JSON.stringify(identity, null, 2))
      throw new Error(
        `Hosted Mac runner drift: require ${process.arch} Darwin ${expected.kernel} build ${expected.build} and Bun ${expected.bun} (${expected.revision}); observed Darwin ${identity.kernel} build ${identity.build} and Bun ${identity.bun} (${identity.revision}).`,
      )
    }
  }
  const unique = Buffer.alloc(56),
    coalition = Buffer.alloc(40)
  assert.equal(library.symbols.proc_pidinfo(process.pid, 17, 0, ptr(unique), 56), 56)
  assert.equal(library.symbols.proc_pidinfo(process.pid, 20, 0, ptr(coalition), 40), 40)
  const usage = Buffer.alloc(37 * 8)
  assert.equal(
    library.symbols.coalition_info_resource_usage(
      coalition.readBigUInt64LE(0),
      ptr(usage),
      usage.length,
    ),
    0,
  )
  assert.ok(usage.readBigUInt64LE(0) > usage.readBigUInt64LE(8))
  const evidence = {
    ...identity,
    processIdentityBytes: unique.length,
    coalitionIdentityBytes: coalition.length,
    coalitionUsageBytes: usage.length,
    pidVersion: unique.readUInt32LE(32),
  }
  console.log(JSON.stringify(evidence, null, 2))
  if (process.argv[2] === '--hosted') requireMacHostPrerequisites(evidence, process.arch)
} finally {
  library.close()
}
