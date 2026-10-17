import { afterAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FiniteAcpFrames, fragmentFiniteAcpFrame } from '@jigging/agent-acp/transport'
import type { PrivateAcpAgentRuntime } from '../src/internal/acp-agent-provider.js'
import { privateCaptureAttachments } from '../src/internal/file-input.js'
import {
  PRIVATE_FINITE_ACP_CHANNELS,
  runPrivateFiniteAcpResource,
} from '../src/internal/finite-acp-resource.js'
import { resolvePrivateLinuxHostLoader } from '../src/internal/linux-host-paths.js'
import {
  PrivateLinuxCgroupBackend,
  PrivateLinuxFenceUnconfirmedError,
  type PrivateLinuxLaunchPlan,
  type PrivateLinuxReadOnlyMount,
  type PrivateLinuxSealedOwnerIdentity,
  releasePrivateLinuxOwnerState,
  requirePrivateLinuxMechanismUnchanged,
} from '../src/internal/linux-rootless-backend.js'
import type { JsonObject, JsonValue } from '../src/json.js'
import { ChannelBroker } from '../src/run/channels.js'
import { RunHostSession } from '../src/run/session.js'
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
  readonly mounts: readonly PrivateLinuxReadOnlyMount[]
}
async function hostConfiguration(): Promise<HostConfiguration> {
  if (delegatedCgroup === undefined)
    throw new Error('rootless proof host did not expose its delegated cgroup')
  const bun = installedBunLocation.executablePath
  const loader = await resolvePrivateLinuxHostLoader()
  const bunHostLibraryPath = dirname(loader)
  const mounts = await runtimeMounts(bun, loader, bunHostLibraryPath)
  return {
    bun,
    bunHostLibraryPath,
    mounts,
    backend: new PrivateLinuxCgroupBackend({ bunPath: bun, bunHostLibraryPath }),
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
async function runtimeMounts(
  bun: string,
  loader: string,
  libraryDirectory: string,
): Promise<readonly PrivateLinuxReadOnlyMount[]> {
  const libraries = ['libc.so.6', 'libm.so.6', 'libdl.so.2', 'libpthread.so.0']
  return Object.freeze([
    Object.freeze({ source: bun, destination: '/jig-runtime/bun' }),
    Object.freeze({ source: loader, destination: '/lib64/ld-linux-x86-64.so.2' }),
    ...(await Promise.all(
      libraries.map(async (name) =>
        Object.freeze({
          source: await realpath(join(libraryDirectory, name)),
          destination: `/jig-runtime/lib/${name}`,
        }),
      ),
    )),
  ])
}
async function createFixture(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'jig-rootless-fixture-'))
  await writeFile(join(directory, 'FLOW.ts'), source, 'utf8')
  return directory
}
async function unavailableDescriptorRestrictionSupervisor(): Promise<{
  readonly path: string
  readonly root: string
}> {
  const sourcePath = fileURLToPath(
    new URL('../src/internal/linux-rootless-supervisor.ts', import.meta.url),
  )
  const source = replaceOnce(
    await readFile(sourcePath, 'utf8'),
    'if (controls.symbols.close_range!(3, 0xffffffff, 4) !== 0)',
    'if (-1 !== 0)',
  )
  const root = await mkdtemp(join(tmpdir(), 'jig-rootless-delayed-supervisor-'))
  const path = join(root, 'linux-rootless-supervisor.ts')
  try {
    await writeFile(path, source, { mode: 0o600 })
    return Object.freeze({ path: await realpath(path), root })
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
async function outputDiagnosticSupervisor(
  tracePath: string,
  fault?: 'projection' | 'custody',
): Promise<{ path: string; root: string }> {
  let source = await readFile(
    new URL('../src/internal/linux-rootless-supervisor.ts', import.meta.url),
    'utf8',
  )
  source = replaceOnce(
    source,
    "  writeSync,\n} from 'node:fs'",
    "  appendFileSync,\n  writeSync,\n} from 'node:fs'",
  )
  source = replaceOnce(
    source,
    "        stdio: [\n          'inherit',\n          'inherit',\n          'inherit',",
    "        stdio: [\n          'inherit',\n          'inherit',\n          'pipe',",
  )
  source = replaceOnce(
    source,
    '    childExit = childClose(launched)\n',
    `    let diagnosticBytes = 0\n    launched.stderr?.on('data', (bytes: Buffer) => {\n      const chunk = bytes.subarray(0, Math.max(0, 8192 - diagnosticBytes))\n      diagnosticBytes += chunk.length\n      if (chunk.length > 0) appendFileSync(${JSON.stringify(tracePath)}, chunk)\n    })\n    childExit = childClose(launched)\n`,
  )
  if (fault === 'projection')
    source = replaceOnce(
      source,
      "  const publicDirectory = openSync('/jig-output/public', 0x10000 | 0x20000)\n",
      "  throw new Error('fixture: projection unavailable')\n  const publicDirectory = openSync('/jig-output/public', 0x10000 | 0x20000)\n",
    )
  if (fault === 'custody')
    source = replaceOnce(
      source,
      '        const projectedReady = outputReady(launched)\n',
      `        appendFileSync(${JSON.stringify(tracePath)}, JSON.stringify({ custody: true, cgroup: runCgroup, entryPid: launched.pid }) + String.fromCharCode(10))\n        await childExit\n        throw new Error('fixture: original custody interrupted')\n        const projectedReady = outputReady(launched)\n`,
    )
  const root = await mkdtemp(join(tmpdir(), 'jig-rootless-delayed-supervisor-'))
  const path = join(root, 'linux-rootless-supervisor.ts')
  await writeFile(tracePath, '')
  await writeFile(path, source, { mode: 0o600 })
  return { root, path: await realpath(path) }
}
async function deliberatelySignalledInnerSupervisor(): Promise<{ path: string; root: string }> {
  const source = replaceOnce(
    await readFile(
      fileURLToPath(new URL('../src/internal/linux-rootless-supervisor.ts', import.meta.url)),
      'utf8',
    ),
    '  restrictInheritedDescriptors(SANDBOX_LIBRARY_PATH, [])\n',
    "  restrictInheritedDescriptors(SANDBOX_LIBRARY_PATH, [])\n  console.error('fixture: inner deliberately raising SIGSEGV');\n  process.kill(process.pid, 'SIGSEGV');\n",
  )
  const root = await mkdtemp(join(tmpdir(), 'jig-rootless-delayed-supervisor-'))
  const path = join(root, 'linux-rootless-supervisor.ts')
  try {
    await writeFile(path, source, { mode: 0o600 })
    return { root, path: await realpath(path) }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
async function delayedReadinessSupervisor(
  enteredMarker: string,
  settledMarker: string,
): Promise<{
  readonly path: string
  readonly root: string
}> {
  const sourcePath = fileURLToPath(
    new URL('../src/internal/linux-rootless-supervisor.ts', import.meta.url),
  )
  let source = await readFile(sourcePath, 'utf8')
  source = replaceOnce(
    source,
    "  writeSync,\n} from 'node:fs'",
    "  writeFileSync,\n  writeSync,\n} from 'node:fs'",
  )
  source = replaceOnce(
    source,
    '  await requireActiveClaim(ownerStateDirectory!, ownerToken!, ownerStateAllocationDigest!)\n' +
      '  writeSync(3, `${process.pid}\\n`)',
    '  await requireActiveClaim(ownerStateDirectory!, ownerToken!, ownerStateAllocationDigest!)\n' +
      `  writeFileSync(${JSON.stringify(enteredMarker)}, "entered\\n");\n` +
      '  await Bun.sleep(20_000);\n' +
      '  writeSync(3, `${process.pid}\\n`);',
  )
  source = replaceOnce(
    source,
    '    let failure: unknown\n',
    '    let failure: unknown = new Error("forced child-close failure");\n',
  )
  source = replaceOnce(
    source,
    "    child.once('close', (code, signal) => {\n" +
      '      if (failure === undefined) resolve({ code, signal })\n' +
      '      else reject(failure)\n' +
      '    })',
    '    child.once("close", (code, signal) => {\n' +
      '      setTimeout(() => {\n' +
      `        writeFileSync(${JSON.stringify(settledMarker)}, "settled\\n");\n` +
      '        if (failure === undefined) resolve({ code, signal });\n' +
      '        else reject(failure);\n' +
      '      }, 1_000);\n' +
      '    });',
  )
  const root = await mkdtemp(join(tmpdir(), 'jig-rootless-delayed-supervisor-'))
  const path = join(root, 'linux-rootless-supervisor.ts')
  try {
    await writeFile(path, source, { mode: 0o600 })
    return Object.freeze({ path: await realpath(path), root })
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
async function delayedReadyForwardingSupervisor(): Promise<{
  readonly path: string
  readonly root: string
}> {
  const sourcePath = fileURLToPath(
    new URL('../src/internal/linux-rootless-supervisor.ts', import.meta.url),
  )
  const source = replaceOnce(
    await readFile(sourcePath, 'utf8'),
    '    const ready = await readReady(launched)\n',
    '    const ready = await readReady(launched)\n' +
      // An ungated fast command settles before its ready message is forwarded.
      // A correctly gated entry remains alive until the coordinator validates
      // its cgroup membership; the bounded delay then permits normal admission.
      '    if (!configuration.output) await Promise.race([childExit, Bun.sleep(1_000)])\n',
  )
  const root = await mkdtemp(join(tmpdir(), 'jig-rootless-delayed-supervisor-'))
  const path = join(root, 'linux-rootless-supervisor.ts')
  try {
    await writeFile(path, source, { mode: 0o600 })
    return Object.freeze({ path: await realpath(path), root })
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
async function heldContinuationSupervisor(
  waitingMarker: string,
  launchMarker: string,
): Promise<{ readonly path: string; readonly root: string }> {
  const sourcePath = fileURLToPath(
    new URL('../src/internal/linux-rootless-supervisor.ts', import.meta.url),
  )
  let source = replaceOnce(
    await readFile(sourcePath, 'utf8'),
    "  writeSync,\n} from 'node:fs'",
    "  writeFileSync,\n  writeSync,\n} from 'node:fs'",
  )
  source = replaceOnce(
    source,
    '    const ready = await readReady(launched)\n',
    '    const ready = await readReady(launched)\n' +
      // Withhold coordinator continuation while the real stop listener remains
      // active. Its normal cancellation/loss/deadline path ends this wait.
      '    while (stopReason === undefined) await Bun.sleep(10)\n',
  )
  source = replaceOnce(
    source,
    '  if (!output) {\n',
    `  if (!output) {\n    writeFileSync(${JSON.stringify(waitingMarker)}, "waiting\\n")\n`,
  )
  source = replaceOnce(
    source,
    '  const child = spawn(bubblewrap!, bubblewrapArguments_, {\n',
    `  writeFileSync(${JSON.stringify(launchMarker)}, "launch\\n")\n` +
      '  const child = spawn(bubblewrap!, bubblewrapArguments_, {\n',
  )
  const root = await mkdtemp(join(tmpdir(), 'jig-rootless-delayed-supervisor-'))
  const path = join(root, 'linux-rootless-supervisor.ts')
  try {
    await writeFile(path, source, { mode: 0o600 })
    return Object.freeze({ path: await realpath(path), root })
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
function replaceOnce(source: string, pattern: string, replacement: string): string {
  const offset = source.indexOf(pattern)
  if (offset === -1 || source.indexOf(pattern, offset + pattern.length) !== -1) {
    throw new Error('rootless delayed-supervisor fixture no longer matches its trusted source')
  }
  return `${source.slice(0, offset)}${replacement}${source.slice(offset + pattern.length)}`
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
    entry.startsWith('jig-rootless-deadline-owner-') ||
    entry.startsWith('jig-rootless-delayed-supervisor-')
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
  delayedReadinessSupervisor,
  delayedReadyForwardingSupervisor,
  delegatedCgroup,
  deliberatelySignalledInnerSupervisor,
  HOSTILE,
  heldContinuationSupervisor,
  hostConfiguration,
  initialRootlessTemporaryState,
  missing,
  outputDiagnosticSupervisor,
  plan,
  readLine,
  replaceOnce,
  rootlessTemporaryEntry,
  runtimeMounts,
  unavailableDescriptorRestrictionSupervisor,
  waitForFence,
  waitForMissing,
  waitForNoRunCgroups,
  waitForPresent,
}
