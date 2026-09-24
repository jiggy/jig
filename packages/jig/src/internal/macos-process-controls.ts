import { createRequire } from 'node:module'
import { release } from 'node:os'

// Private Darwin 23 ABI. Qualification of another kernel is a separate change.
const PROC_PIDUNIQIDENTIFIERINFO = 17
const PROC_PIDCOALITIONINFO = 20
const RESOURCE_USAGE_BYTES = 37 * 8
const MAX_PROCESSES = 65_536
const signals = Object.freeze({ stop: 17, continue: 19, kill: 9 })
type NativeFunction = (...args: (number | bigint)[]) => number
type NativeSymbol =
  | 'coalition_info_resource_usage'
  | 'proc_pidinfo'
  | 'proc_listallpids'
  | 'proc_pid_rusage'
  | 'proc_signal_with_audittoken'
  | 'sysctlbyname'
interface Native {
  ptr(bytes: Uint8Array): number
  symbols: Record<NativeSymbol, NativeFunction>
}
let native: Native | undefined

function calls(): Native {
  if (native !== undefined) return native
  if (process.platform !== 'darwin' || process.arch !== 'x64' || release() !== '23.4.0')
    throw new Error('macOS process controls are not qualified on this kernel')
  const ffi = createRequire(import.meta.url)('bun:ffi') as {
    ptr(bytes: Uint8Array): number
    dlopen(
      path: string,
      declarations: Record<string, { args: string[]; returns: string }>,
    ): { symbols: Record<NativeSymbol, NativeFunction> }
  }
  const library = ffi.dlopen('/usr/lib/libSystem.B.dylib', {
    coalition_info_resource_usage: { args: ['u64', 'ptr', 'u64'], returns: 'i32' },
    proc_pidinfo: { args: ['i32', 'i32', 'u64', 'ptr', 'i32'], returns: 'i32' },
    proc_listallpids: { args: ['ptr', 'i32'], returns: 'i32' },
    proc_pid_rusage: { args: ['i32', 'i32', 'ptr'], returns: 'i32' },
    proc_signal_with_audittoken: { args: ['ptr', 'i32'], returns: 'i32' },
    sysctlbyname: { args: ['ptr', 'ptr', 'ptr', 'ptr', 'u64'], returns: 'i32' },
  })
  const opened = { ptr: ffi.ptr, symbols: library.symbols }
  if (kernelString(opened, 'kern.osversion') !== '23E224')
    throw new Error('macOS process controls are not qualified on this kernel build')
  native = opened
  return native
}

function kernelString(native: Native, key: string): string {
  const name = Buffer.from(`${key}\0`)
  const bytes = Buffer.alloc(64)
  const size = Buffer.alloc(8)
  size.writeBigUInt64LE(BigInt(bytes.length))
  if (
    native.symbols.sysctlbyname(native.ptr(name), native.ptr(bytes), native.ptr(size), 0, 0) !== 0
  )
    throw new Error('macOS kernel identity is unavailable')
  const length = size.readBigUInt64LE()
  const end = bytes.indexOf(0)
  if (length < 1n || length > 64n || end !== Number(length) - 1)
    throw new Error('macOS kernel identity is invalid')
  return bytes.subarray(0, end).toString('ascii')
}

function processIdentity(pid: number): { version: number; coalition: bigint } | undefined {
  const { ptr, symbols } = calls()
  const unique = Buffer.alloc(56)
  const coalitions = Buffer.alloc(40)
  // Read the PID version first. A later recycled PID cannot receive its signal.
  if (symbols.proc_pidinfo(pid, PROC_PIDUNIQIDENTIFIERINFO, 0, ptr(unique), 56) !== 56)
    return undefined
  if (symbols.proc_pidinfo(pid, PROC_PIDCOALITIONINFO, 0, ptr(coalitions), 40) !== 40)
    return undefined
  return { version: unique.readUInt32LE(32), coalition: coalitions.readBigUInt64LE(0) }
}

function bootIdentity(): string {
  const result = kernelString(calls(), 'kern.bootsessionuuid')
  if (!/^[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$/.test(result))
    throw new Error('macOS boot identity is invalid')
  return result.toLowerCase()
}

function usage(coalition: bigint): { active: bigint; cpuNanoseconds: bigint } {
  const { ptr, symbols } = calls()
  const bytes = Buffer.alloc(RESOURCE_USAGE_BYTES)
  // The third size argument is mandatory, including when only reading a prefix.
  if (symbols.coalition_info_resource_usage(coalition, ptr(bytes), bytes.length) !== 0)
    throw new Error('macOS coalition accounting is unavailable')
  const started = bytes.readBigUInt64LE(0)
  const exited = bytes.readBigUInt64LE(8)
  if (started < exited) throw new Error('macOS coalition accounting is invalid')
  return { active: started - exited, cpuNanoseconds: bytes.readBigUInt64LE(24) }
}

export interface PrivateMacosProcessSample {
  /** Includes the trusted guardian; it remains alive until cleanup is confirmed. */
  readonly active: bigint
  /** Includes exited tasks and the guardian, in kernel ledger nanoseconds. */
  readonly cpuNanoseconds: bigint
  /** Sampled live payload footprint, not an atomic or kernel-enforced ceiling. */
  readonly footprintBytes: bigint
  readonly observedMembers: number
  readonly complete: boolean
  readonly sampleMilliseconds: number
}

export interface PrivateMacosCoalitionControl {
  readonly identity: Readonly<{
    bootId: string
    coalition: string
    guardianPid: number
    guardianVersion: number
  }>
  sample(): PrivateMacosProcessSample
  signalMembers(signal: keyof typeof signals): number
  /** Only this kernel observation, while the guardian lives, proves emptiness. */
  empty(): boolean
}

/**
 * Acquire only this process's initially exclusive resource coalition. launchd
 * must have established it before this call; a decoded coalition ID is never
 * accepted here. Recovery must separately authenticate durable ownership.
 */
export function acquirePrivateMacosCoalition(): PrivateMacosCoalitionControl {
  const pid = process.pid
  const owner = processIdentity(pid)
  if (owner === undefined || owner.coalition === 0n || usage(owner.coalition).active !== 1n)
    throw new Error('macOS guardian requires an exclusive resource coalition')
  const identity = Object.freeze({
    bootId: bootIdentity(),
    coalition: owner.coalition.toString(),
    guardianPid: pid,
    guardianVersion: owner.version,
  })
  const validateOwner = () => {
    const current = processIdentity(process.pid)
    if (
      process.pid !== pid ||
      current?.coalition !== owner.coalition ||
      current.version !== owner.version
    )
      throw new Error('macOS guardian identity changed')
  }
  const members = () => {
    validateOwner()
    const { ptr, symbols } = calls()
    const bytes = Buffer.alloc(MAX_PROCESSES * 4)
    const count = symbols.proc_listallpids(ptr(bytes), bytes.length)
    if (count < 1 || count >= MAX_PROCESSES)
      throw new Error('macOS process enumeration is incomplete')
    const result: { pid: number; version: number }[] = []
    for (let index = 0; index < count; index++) {
      const candidate = bytes.readInt32LE(index * 4)
      if (candidate <= 1 || candidate === pid) continue
      const observed = processIdentity(candidate)
      if (observed?.coalition === owner.coalition)
        result.push({ pid: candidate, version: observed.version })
    }
    return result
  }
  return Object.freeze({
    identity,
    sample() {
      const start = performance.now()
      validateOwner()
      const before = usage(owner.coalition)
      const { ptr, symbols } = calls()
      let footprintBytes = 0n
      let observedMembers = 0
      let complete = true
      for (const member of members()) {
        const bytes = Buffer.alloc(96) // rusage_info_v0, SDK 14.4
        const read = symbols.proc_pid_rusage(member.pid, 0, ptr(bytes))
        const after = processIdentity(member.pid)
        if (
          read !== 0 ||
          after?.version !== member.version ||
          after.coalition !== owner.coalition
        ) {
          complete = false
          continue
        }
        footprintBytes += bytes.readBigUInt64LE(72)
        observedMembers++
      }
      const after = usage(owner.coalition)
      if (after.cpuNanoseconds < before.cpuNanoseconds)
        throw new Error('macOS CPU accounting moved backwards')
      return Object.freeze({
        ...after,
        footprintBytes,
        observedMembers,
        complete:
          complete &&
          before.active === after.active &&
          after.active === BigInt(observedMembers + 1),
        sampleMilliseconds: performance.now() - start,
      })
    },
    signalMembers(signal: keyof typeof signals) {
      if (!Object.hasOwn(signals, signal)) throw new TypeError('invalid macOS ownership signal')
      const { ptr, symbols } = calls()
      let count = 0
      for (const member of members()) {
        const token = Buffer.alloc(32)
        token.writeUInt32LE(member.pid, 20)
        token.writeUInt32LE(member.version, 28)
        const result = symbols.proc_signal_with_audittoken(ptr(token), signals[signal])
        if (result !== 0 && result !== 3)
          // ESRCH: the exact process already exited.
          throw new Error('macOS owned process signaling failed')
        if (result === 0) count++
      }
      return count
    },
    empty() {
      validateOwner()
      return usage(owner.coalition).active === 1n
    },
  })
}
