import { createRequire } from 'node:module'
import type { Socket } from 'node:net'
import { release } from 'node:os'
import {
  type PrivateMacosRecoveryOwner,
  requirePrivateMacosRecoveryOwner,
} from './macos-owner-state.js'

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
  | 'getsockopt'
  | '__error'
interface Native {
  ptr(bytes: Uint8Array): number
  read: { i32(pointer: number): number }
  symbols: Record<NativeSymbol, NativeFunction>
}
let native: Native | undefined
const authenticCoalitions = new WeakSet<object>()

function calls(): Native {
  if (native !== undefined) return native
  if (process.platform !== 'darwin' || process.arch !== 'x64' || release() !== '23.4.0')
    throw new Error('macOS process controls are not qualified on this kernel')
  const ffi = createRequire(import.meta.url)('bun:ffi') as {
    ptr(bytes: Uint8Array): number
    read: { i32(pointer: number): number }
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
    getsockopt: { args: ['i32', 'i32', 'i32', 'ptr', 'ptr'], returns: 'i32' },
    __error: { args: [], returns: 'ptr' },
  })
  const opened = { ptr: ffi.ptr, read: ffi.read, symbols: library.symbols }
  if (kernelString(opened, 'kern.osversion') !== '23E224')
    throw new Error('macOS process controls are not qualified on this kernel build')
  native = opened
  return native
}

/** Kernel identity of the connected Unix peer, never a field from its message. */
export function privateMacosPeerIdentity(socket: Socket): Readonly<{
  uid: number
  realUid: number
  pid: number
  version: number
}> {
  // Private, pinned Bun Node-compatibility handle; absence is a hard refusal.
  const fd = (socket as unknown as { _handle?: { fd?: number } })._handle?.fd
  if (socket.destroyed || fd === undefined || !Number.isSafeInteger(fd) || fd < 0)
    throw new Error('macOS control socket descriptor is unavailable')
  return privateMacosDescriptorPeerIdentity(fd)
}

/** Kernel credentials for a privately owned native Unix socket. */
export function privateMacosDescriptorPeerIdentity(fd: number): Readonly<{
  uid: number
  realUid: number
  pid: number
  version: number
}> {
  if (!Number.isSafeInteger(fd) || fd < 0)
    throw new Error('macOS control socket descriptor is unavailable')
  const { ptr, symbols } = calls()
  const token = Buffer.alloc(32)
  const length = Buffer.alloc(4)
  length.writeUInt32LE(token.length)
  if (symbols.getsockopt(fd, 0, 6, ptr(token), ptr(length)) !== 0 || length.readUInt32LE() !== 32)
    throw new Error('macOS control peer identity is unavailable')
  return Object.freeze({
    uid: token.readUInt32LE(4),
    realUid: token.readUInt32LE(12),
    pid: token.readUInt32LE(20),
    version: token.readUInt32LE(28),
  })
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

/** Inert identity for binding a guardian's private control connection. */
export function privateMacosCurrentProcessIdentity(): Readonly<{
  uid: number
  pid: number
  version: number
}> {
  const identity = processIdentity(process.pid)
  const uid = process.getuid?.()
  if (identity === undefined || uid === undefined || uid === 0)
    throw new Error('macOS coordinator identity is unavailable')
  return Object.freeze({ uid, pid: process.pid, version: identity.version })
}

function usage(
  coalition: bigint,
  absentIsEmpty = false,
): { active: bigint; cpuNanoseconds: bigint } {
  const { ptr, read, symbols } = calls()
  const bytes = Buffer.alloc(RESOURCE_USAGE_BYTES)
  // The third size argument is mandatory, including when only reading a prefix.
  if (symbols.coalition_info_resource_usage(coalition, ptr(bytes), bytes.length) !== 0) {
    if (read.i32(symbols.__error()) === 3 && absentIsEmpty)
      return { active: 0n, cpuNanoseconds: 0n }
    throw new Error('macOS coalition accounting is unavailable')
  }
  const started = bytes.readBigUInt64LE(0)
  const exited = bytes.readBigUInt64LE(8)
  if (started < exited) throw new Error('macOS coalition accounting is invalid')
  return { active: started - exited, cpuNanoseconds: bytes.readBigUInt64LE(24) }
}

function coalitionMembers(coalition: bigint, exclude: number): { pid: number; version: number }[] {
  const { ptr, symbols } = calls()
  const bytes = Buffer.alloc(MAX_PROCESSES * 4)
  const count = symbols.proc_listallpids(ptr(bytes), bytes.length)
  if (count < 1 || count >= MAX_PROCESSES)
    throw new Error('macOS process enumeration is incomplete')
  const result: { pid: number; version: number }[] = []
  for (let index = 0; index < count; index++) {
    const candidate = bytes.readInt32LE(index * 4)
    if (candidate <= 1 || candidate === exclude) continue
    const observed = processIdentity(candidate)
    if (observed?.coalition === coalition)
      result.push({ pid: candidate, version: observed.version })
  }
  return result
}

function signalMembers(
  members: { pid: number; version: number }[],
  signal: keyof typeof signals,
): number {
  if (!Object.hasOwn(signals, signal)) throw new TypeError('invalid macOS ownership signal')
  const { ptr, symbols } = calls()
  let count = 0
  for (const member of members) {
    const token = Buffer.alloc(32)
    token.writeUInt32LE(member.pid, 20)
    token.writeUInt32LE(member.version, 28)
    const result = symbols.proc_signal_with_audittoken(ptr(token), signals[signal])
    if (result !== 0 && result !== 3) throw new Error('macOS owned process signaling failed')
    if (result === 0) count++
  }
  return count
}

/** An authenticated guardian journal from a different kernel boot cannot own
 * surviving tasks. Never look up its former PIDs or coalition on this boot:
 * either identifier could now belong to unrelated work. Same-boot journals
 * still require exact coalition fencing. This is separate from storage cleanup. */
export function privateMacosOwnerIsFromPriorBoot(handle: PrivateMacosRecoveryOwner): boolean {
  return requirePrivateMacosRecoveryOwner(handle).bootId !== bootIdentity()
}

/** Fresh coalition recovery accepts authenticated ownership on its recorded boot. */
export async function recoverPrivateMacosCoalition(
  handle: PrivateMacosRecoveryOwner,
  timeoutMs: number,
): Promise<void> {
  const identity = requirePrivateMacosRecoveryOwner(handle)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw new TypeError('invalid macOS recovery deadline')
  if (identity.bootId !== bootIdentity()) throw new Error('macOS recovery boot does not match')
  const coalition = BigInt(identity.coalition)
  const own = processIdentity(process.pid)
  if (own === undefined || own.coalition === coalition)
    throw new Error('macOS recovery must run outside its former owner')
  const guardian = processIdentity(identity.guardianPid)
  if (guardian?.version === identity.guardianVersion)
    throw new Error('macOS recovery guardian is still alive')
  const end = performance.now() + timeoutMs
  // XNU allocates monotonically increasing coalition IDs within one boot.
  // Only ESRCH for this authenticated ID means the kernel has already reaped it.
  while (usage(coalition, true).active !== 0n) {
    signalMembers(coalitionMembers(coalition, process.pid), 'kill')
    if (performance.now() >= end) throw new Error('macOS recovery fencing is unconfirmed')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
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
  contains(pid: number, version: number): boolean
  /** Only this kernel observation, while the guardian lives, proves emptiness. */
  empty(): boolean
}

export function requirePrivateMacosCoalition(value: unknown): PrivateMacosCoalitionControl {
  if (value === null || typeof value !== 'object' || !authenticCoalitions.has(value))
    throw new TypeError('macOS coalition control is not authentic')
  return value as PrivateMacosCoalitionControl
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
    return coalitionMembers(owner.coalition, pid)
  }
  const control: PrivateMacosCoalitionControl = Object.freeze({
    identity,
    contains(pid: number, version: number) {
      validateOwner()
      if (!Number.isSafeInteger(pid) || pid <= 1 || !Number.isSafeInteger(version) || version < 0)
        return false
      const current = processIdentity(pid)
      return current?.version === version && current.coalition === owner.coalition
    },
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
      return signalMembers(members(), signal)
    },
    empty() {
      validateOwner()
      return usage(owner.coalition).active === 1n
    },
  })
  authenticCoalitions.add(control)
  return control
}
