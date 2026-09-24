import { spawn } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import {
  type PrivateMacosCoalitionControl,
  requirePrivateMacosCoalition,
} from './macos-process-controls.js'
import {
  type PrivateMacosSandboxFiles,
  privateMacosSandboxProfile,
} from './macos-sandbox-profile.js'

export interface PrivateMacosScopeLimits {
  readonly memoryBytes: number
  readonly pids: number
  readonly cpuQuotaMicros: number
  readonly cpuPeriodMicros: number
  readonly deadlineUnixMs: number
  readonly cleanupTimeoutMs: number
}
export type PrivateMacosStopReason =
  | 'payload_exit'
  | 'cancelled'
  | 'coordinator_lost'
  | 'deadline'
  | 'setup_failed'
  | 'memory_limit'
  | 'process_limit'
  | 'cpu_limit'
  | 'accounting_failed'
export interface PrivateMacosScopeResult {
  readonly reason: PrivateMacosStopReason
  readonly exitCode: number | null
  readonly signal: number | null
  readonly fenced: true
  readonly evidence: Readonly<{
    cpuNanoseconds: string
    peakFootprintBytes: string
    peakTasks: number
    samples: number
    pauses: number
    incompleteSamples: number
    maxSampleMilliseconds: number
  }>
}

export interface PrivateMacosScopeExecution {
  readonly stdin: Writable
  readonly stdout: Readable
  readonly stderr: Readable
  readonly pid: number
  readonly version: number
  readonly completion: Promise<PrivateMacosScopeResult>
  admit(): void
  stop(reason: 'cancelled' | 'coordinator_lost'): void
}

/** Inert result decoding; only an authenticated guardian can supply enforcement evidence. */
export function normalizePrivateMacosScopeResult(value: unknown): PrivateMacosScopeResult {
  const result = value as Record<string, unknown>
  if (
    result === null ||
    typeof result !== 'object' ||
    Object.keys(result).sort().join() !== 'evidence,exitCode,fenced,reason,signal' ||
    result.fenced !== true ||
    typeof result.reason !== 'string' ||
    ![
      'payload_exit',
      'cancelled',
      'coordinator_lost',
      'deadline',
      'setup_failed',
      'memory_limit',
      'process_limit',
      'cpu_limit',
      'accounting_failed',
    ].includes(result.reason)
  )
    throw new Error('invalid macOS scope result')
  const integer = (n: unknown, min: number, max: number) =>
    Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max
  if (
    (result.exitCode !== null && !integer(result.exitCode, 0, 255)) ||
    (result.signal !== null && !integer(result.signal, 1, 31)) ||
    (result.exitCode !== null && result.signal !== null) ||
    (result.reason === 'payload_exit' && result.exitCode === null && result.signal === null)
  )
    throw new Error('invalid macOS termination result')
  const evidence = result.evidence as Record<string, unknown>
  if (
    evidence === null ||
    typeof evidence !== 'object' ||
    Object.keys(evidence).sort().join() !==
      'cpuNanoseconds,incompleteSamples,maxSampleMilliseconds,pauses,peakFootprintBytes,peakTasks,samples' ||
    ['cpuNanoseconds', 'peakFootprintBytes'].some(
      (key) =>
        typeof evidence[key] !== 'string' ||
        !/^(?:0|[1-9][0-9]{0,19})$/.test(evidence[key] as string) ||
        BigInt(evidence[key] as string) > 0xffffffffffffffffn,
    ) ||
    ['incompleteSamples', 'pauses', 'peakTasks', 'samples'].some(
      (key) => !integer(evidence[key], 0, Number.MAX_SAFE_INTEGER),
    ) ||
    typeof evidence.maxSampleMilliseconds !== 'number' ||
    !Number.isFinite(evidence.maxSampleMilliseconds) ||
    evidence.maxSampleMilliseconds < 0
  )
    throw new Error('invalid macOS resource evidence')
  return Object.freeze({
    ...result,
    evidence: Object.freeze({ ...evidence }),
  }) as unknown as PrivateMacosScopeResult
}

export function requirePrivateMacosScopeLimits(
  value: PrivateMacosScopeLimits,
): Readonly<PrivateMacosScopeLimits> {
  const limits = Object.freeze({ ...value })
  if (
    Object.keys(limits).sort().join() !==
      'cleanupTimeoutMs,cpuPeriodMicros,cpuQuotaMicros,deadlineUnixMs,memoryBytes,pids' ||
    Object.values(limits).some((value) => !Number.isSafeInteger(value) || value <= 0) ||
    limits.memoryBytes > 512 * 1024 * 1024 ||
    limits.pids > 128 ||
    limits.cpuQuotaMicros > limits.cpuPeriodMicros ||
    limits.cpuPeriodMicros !== 100_000 ||
    limits.cleanupTimeoutMs > 5000 ||
    limits.deadlineUnixMs - Date.now() > 86_400_000
  )
    throw new TypeError('invalid macOS scope limits')
  return limits
}

/**
 * Guardian-local execution, never a coordinator or application entrypoint.
 * Durable ownership must exist before calling this function. The returned gate
 * stays closed until the coordinator's admitted-owner checks have completed.
 */
export async function preparePrivateMacosScope(input: {
  readonly owner: PrivateMacosCoalitionControl
  readonly launcher: string
  readonly cwd: string
  readonly command: readonly [string, ...string[]]
  readonly environment: Readonly<Record<string, string>>
  readonly files: PrivateMacosSandboxFiles
  readonly limits: PrivateMacosScopeLimits
}): Promise<PrivateMacosScopeExecution> {
  const owner = requirePrivateMacosCoalition(input.owner)
  if (!owner.empty()) throw new Error('macOS scope is not initially empty')
  const limits = requirePrivateMacosScopeLimits(input.limits)
  const command = [...input.command]
  const environment = { ...input.environment }
  if (
    !input.launcher.startsWith('/') ||
    !input.cwd.startsWith('/') ||
    !command[0]?.startsWith('/') ||
    command.length > 64 ||
    command.some((value) => typeof value !== 'string' || value.includes('\0')) ||
    Buffer.byteLength(command.join('\0')) > 16_384 ||
    Object.entries(environment).some(
      ([name, value]) =>
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
        /^(?:_?DYLD_|LD_)/.test(name) ||
        typeof value !== 'string' ||
        value.includes('\0'),
    ) ||
    Buffer.byteLength(JSON.stringify(environment)) > 16_384
  )
    throw new TypeError('invalid macOS native launch')
  const profile = privateMacosSandboxProfile(input.files)
  if (
    !input.files.writableTrees.some(
      (root) => input.cwd === root || input.cwd.startsWith(`${root}/`),
    )
  )
    throw new TypeError('macOS working directory is outside its writable projection')
  const hardDeadline = performance.now() + Math.max(0, limits.deadlineUnixMs - Date.now())
  const initial = owner.sample()
  if (!initial.complete || initial.active !== 1n)
    throw new Error('macOS initial accounting is incomplete')
  let previousCpu = initial.cpuNanoseconds
  let previousTime = performance.now()
  let credit = BigInt(limits.cpuQuotaMicros) * 1000n
  const burst = credit
  const debtLimit =
    (2_500_000_000n * BigInt(limits.cpuQuotaMicros)) / BigInt(limits.cpuPeriodMicros)
  let paused = false,
    admitted = false,
    rootExited = false
  let reason: PrivateMacosStopReason | undefined
  let incompleteSince: number | undefined
  let peakFootprint = 0n,
    peakTasks = 0,
    samples = 0,
    pauses = 0,
    incompleteSamples = 0,
    maxSample = 0
  let terminal: { exitCode: number | null; signal: number | null } | undefined
  let readyFrame: { pid: number; version: number } | undefined
  let frameBytes = Buffer.alloc(0)
  const stop = (why: PrivateMacosStopReason) => {
    if (reason === undefined || reason === 'payload_exit') reason = why
  }
  const child = spawn(
    input.launcher,
    ['--launch', String(Buffer.byteLength(profile.text)), input.cwd, profile.bootstrap, ...command],
    { cwd: '/', env: environment, stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'] },
  )
  child.on('error', () => stop('setup_failed'))
  const stdin = child.stdin,
    stdout = child.stdout,
    stderr = child.stderr
  const configuration = child.stdio[3] as Writable
  const gate = child.stdio[4] as Writable
  const frames = (child.stdio as readonly (Readable | Writable | null | undefined)[])[5] as Readable
  if (stdin === null || stdout === null || stderr === null || !configuration || !gate || !frames) {
    const cleanupBy = performance.now() + limits.cleanupTimeoutMs
    while (!owner.empty()) {
      owner.signalMembers('kill')
      if (performance.now() >= cleanupBy) throw new Error('macOS descendant fencing is unconfirmed')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('macOS launch handoffs are unavailable')
  }
  let resolveReady: (value: { pid: number; version: number }) => void = () => {}
  let rejectReady: (error: Error) => void = () => {}
  const ready = new Promise<{ pid: number; version: number }>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  void ready.catch(() => undefined)
  const receiveFrame = (bytes: Buffer) => {
    if (frameBytes.length + bytes.length > 32) return stop('setup_failed')
    frameBytes = Buffer.concat([frameBytes, bytes])
    if (frameBytes.length >= 16 && readyFrame === undefined) {
      const pid = frameBytes.readUInt32LE(4),
        version = frameBytes.readUInt32LE(8)
      if (
        frameBytes.readUInt32LE(0) !== 0x4a49474d ||
        frameBytes.readUInt32LE(12) !== 0 ||
        !owner.contains(pid, version)
      )
        return stop('setup_failed')
      readyFrame = { pid, version }
      resolveReady(readyFrame)
    }
    if (frameBytes.length === 32) {
      const code = frameBytes.readUInt32LE(24),
        signal = frameBytes.readUInt32LE(28)
      if (
        frameBytes.readUInt32LE(16) !== 0x4a494758 ||
        frameBytes.readUInt32LE(20) !== readyFrame?.pid ||
        !((code <= 255 && signal === 0) || (code === 0xffffffff && signal > 0 && signal < 32))
      )
        return stop('setup_failed')
      terminal = { exitCode: code === 0xffffffff ? null : code, signal: signal || null }
    }
  }
  frames.on('data', (bytes: Buffer) => {
    try {
      receiveFrame(bytes)
    } catch {
      stop('setup_failed')
    }
  })
  for (const stream of [stdin, stdout, stderr, configuration, gate, frames])
    stream.on('error', () => stop('setup_failed'))
  const frameEnd = new Promise<void>((resolve) => frames.once('end', resolve))
  const exit = new Promise<void>((resolve) => {
    child.once('error', () => {
      stop('setup_failed')
      rootExited = true
      resolve()
    })
    child.once('exit', (code) => {
      if (code !== 0 && reason === undefined) stop('setup_failed')
      rootExited = true
      resolve()
    })
  })
  configuration.end(profile.text)
  const startupTimeout = setTimeout(() => stop('setup_failed'), 9000)
  const completion = (async (): Promise<PrivateMacosScopeResult> => {
    try {
      while (reason === undefined && !rootExited) {
        const now = performance.now()
        if (now >= hardDeadline) {
          stop('deadline')
          break
        }
        const sample = owner.sample()
        samples++
        maxSample = Math.max(maxSample, sample.sampleMilliseconds)
        if (sample.footprintBytes > peakFootprint) peakFootprint = sample.footprintBytes
        peakTasks = Math.max(peakTasks, Number(sample.active - 1n))
        if (sample.footprintBytes > BigInt(limits.memoryBytes)) {
          stop('memory_limit')
          break
        }
        if (sample.active - 1n > BigInt(limits.pids)) {
          stop('process_limit')
          break
        }
        if (!sample.complete) {
          incompleteSamples++
          incompleteSince ??= now
        } else incompleteSince = undefined
        if (incompleteSince !== undefined && now - incompleteSince > 500) {
          stop('accounting_failed')
          break
        }
        if (sample.cpuNanoseconds < previousCpu) {
          stop('accounting_failed')
          break
        }
        credit +=
          (BigInt(Math.max(0, Math.floor((now - previousTime) * 1e6))) *
            BigInt(limits.cpuQuotaMicros)) /
            BigInt(limits.cpuPeriodMicros) -
          (sample.cpuNanoseconds - previousCpu)
        if (credit > burst) credit = burst
        previousCpu = sample.cpuNanoseconds
        previousTime = now
        if (credit < -debtLimit) {
          stop('cpu_limit')
          break
        }
        if (credit < 0) {
          owner.signalMembers('stop')
          if (!paused) pauses++
          paused = true
        } else if (paused) {
          owner.signalMembers('continue')
          paused = false
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    } catch {
      stop('accounting_failed')
    } finally {
      clearTimeout(startupTimeout)
    }
    reason ??= 'payload_exit'
    rejectReady(new Error('macOS scope stopped before readiness'))
    const cleanupBy = performance.now() + limits.cleanupTimeoutMs
    while (!owner.empty()) {
      owner.signalMembers('kill')
      if (performance.now() >= cleanupBy) throw new Error('macOS descendant fencing is unconfirmed')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    // Neither a PID's exit nor a C proxy's success substitutes for native status.
    await bounded(exit, Math.max(1, cleanupBy - performance.now()))
    await bounded(frameEnd, Math.max(1, cleanupBy - performance.now())).catch(() => undefined)
    if (reason === 'payload_exit' && terminal === undefined) reason = 'setup_failed'
    const final = owner.sample()
    if (!final.complete || final.active !== 1n || final.cpuNanoseconds < previousCpu)
      throw new Error('macOS final resource accounting is unconfirmed')
    return Object.freeze({
      reason,
      exitCode: terminal?.exitCode ?? null,
      signal: terminal?.signal ?? null,
      fenced: true as const,
      evidence: Object.freeze({
        cpuNanoseconds: (final.cpuNanoseconds - initial.cpuNanoseconds).toString(),
        peakFootprintBytes: peakFootprint.toString(),
        peakTasks,
        samples,
        pauses,
        incompleteSamples,
        maxSampleMilliseconds: maxSample,
      }),
    })
  })()
  void completion.catch(() => undefined)
  try {
    const identity = await Promise.race([
      ready,
      completion.then(() => {
        throw new Error('macOS scope ended before readiness')
      }),
    ])
    return Object.freeze({
      stdin,
      stdout,
      stderr,
      ...identity,
      completion,
      admit() {
        if (performance.now() >= hardDeadline) stop('deadline')
        if (admitted || reason !== undefined || !owner.contains(identity.pid, identity.version))
          throw new Error('macOS scope is no longer admissible')
        admitted = true
        clearTimeout(startupTimeout)
        gate.end('A')
      },
      stop: (why: 'cancelled' | 'coordinator_lost') => stop(why),
    })
  } catch (error) {
    stop('setup_failed')
    await completion
    throw error
  }
}

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('macOS native settlement expired')), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
