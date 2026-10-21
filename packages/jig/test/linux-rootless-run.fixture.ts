import type { spawn } from 'node:child_process'
import { mkdtemp, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPrivateInstalledBunSupport } from '../src/internal/installed-bun-support.js'
import {
  PrivateLinuxCgroupBackend,
  PrivateLinuxFenceUnconfirmedError,
  type PrivateLinuxLaunchPlan,
  type PrivateLinuxReadOnlyMount,
} from '../src/internal/linux-rootless-backend.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

const HOSTILE = process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1'
const delegatedCgroup = process.env.AGENT_DELEGATED_CGROUP
const initialRootlessTemporaryState = new Set(
  (await readdir(tmpdir())).filter(rootlessTemporaryEntry),
)
interface HostConfiguration {
  readonly backend: PrivateLinuxCgroupBackend
  readonly bun: string
  readonly bunHostLibraryPath: string
  readonly supervisorPath: string
  readonly mounts: readonly PrivateLinuxReadOnlyMount[]
}
async function hostConfiguration(): Promise<HostConfiguration> {
  if (delegatedCgroup === undefined)
    throw new Error('rootless proof host did not expose its delegated cgroup')
  const support = await openPrivateInstalledBunSupport(installedBunLocation)
  const bun = support.executablePath
  const bunHostLibraryPath = support.hostLibraryDirectory
  const supervisorPath = support.supervisorPath
  return {
    bun,
    bunHostLibraryPath,
    supervisorPath,
    mounts: support.runtimeMounts,
    backend: new PrivateLinuxCgroupBackend({ bunPath: bun, bunHostLibraryPath, supervisorPath }),
  }
}
function plan(
  host: HostConfiguration,
  fixture: string,
  runId: string,
  overrides: {
    readonly memoryBytes?: number
    readonly pids?: number
    readonly cpuQuotaMicros?: number
    readonly deadlineMs?: number
  } = {},
): PrivateLinuxLaunchPlan {
  return {
    runId,
    limits: {
      memoryBytes: overrides.memoryBytes ?? 256 * 1024 * 1024,
      pids: overrides.pids ?? 64,
      cpuQuotaMicros: overrides.cpuQuotaMicros ?? 50_000,
      cpuPeriodMicros: 100_000,
      deadlineUnixMs: Date.now() + (overrides.deadlineMs ?? 5_000),
      cancellationGraceMs: 250,
    },
    readOnlyMounts: [...host.mounts, { source: fixture, destination: '/package' }],
    command: [
      '/jig-runtime/bun',
      ...['--no-env-file', '--no-install', '--config=/dev/null'],
      '/package/FLOW.ts',
    ],
  }
}
async function createFixture(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'jig-rootless-fixture-'))
  await writeFile(join(directory, 'FLOW.ts'), source, 'utf8')
  return directory
}
async function collect(
  stream: AsyncIterable<Uint8Array>,
  maximumBytes = Number.POSITIVE_INFINITY,
): Promise<string> {
  let result = ''
  let total = 0
  for await (const bytes of stream) {
    total += bytes.byteLength
    if (total > maximumBytes) throw new Error('diagnostic output exceeded its bound')
    result += Buffer.from(bytes).toString('utf8')
  }
  return result
}
async function missing(path: string): Promise<boolean> {
  try {
    await stat(path)
    return false
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return true
    }
    throw error
  }
}
async function waitForMissing(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (await missing(path)) return
    await Bun.sleep(20)
  }
  throw new Error(`timed out waiting for ${path} removal`)
}
async function waitForPresent(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (!(await missing(path))) return
    await Bun.sleep(10)
  }
  throw new Error(`timed out waiting for ${path} creation`)
}
async function waitForNoRunCgroups(): Promise<void> {
  if (delegatedCgroup === undefined) return
  const deadline = Date.now() + 5_000
  while (Date.now() <= deadline) {
    const entries = await Array.fromAsync(
      new Bun.Glob('jig-run-*').scan({ cwd: delegatedCgroup, onlyFiles: false }),
    )
    if (entries.length === 0) return
    await Bun.sleep(20)
  }
  throw new Error('rootless Runs left cgroup residue')
}
async function readLine(stream: NodeJS.ReadableStream): Promise<string> {
  let buffer = ''
  for await (const chunk of stream) {
    buffer += String(chunk)
    const newline = buffer.indexOf('\n')
    if (newline !== -1) return buffer.slice(0, newline)
    if (buffer.length > 16_384) throw new Error('coordinator output line is too long')
  }
  throw new Error('coordinator exited before reporting its cgroup')
}
async function childExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => child.once('close', () => resolve()))
}
function rootlessTemporaryEntry(entry: string): boolean {
  return (
    entry.startsWith('jig-rootless-control-') ||
    entry.startsWith('jig-rootless-owner-') ||
    entry.startsWith('jig-rootless-deadline-owner-')
  )
}
async function waitForFence(backend: PrivateLinuxCgroupBackend, owner: unknown, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return await backend.recoverFence(owner)
    } catch (error) {
      if (!(error instanceof PrivateLinuxFenceUnconfirmedError) || Date.now() > deadline)
        throw error
      await Bun.sleep(20)
    }
  }
}

export type { HostConfiguration }
export {
  childExit,
  collect,
  createFixture,
  delegatedCgroup,
  HOSTILE,
  hostConfiguration,
  initialRootlessTemporaryState,
  missing,
  plan,
  readLine,
  rootlessTemporaryEntry,
  waitForFence,
  waitForMissing,
  waitForNoRunCgroups,
  waitForPresent,
}
