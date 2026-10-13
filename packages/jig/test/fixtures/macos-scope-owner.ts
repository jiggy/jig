import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acquirePrivateMacosCoalition } from '../../src/internal/macos-process-controls.js'
import {
  type PrivateMacosStopReason,
  preparePrivateMacosScope,
} from '../../src/internal/macos-scope-execution.js'

const [launcher, payload, directory] = process.argv.slice(2) as [string, string, string]
const owner = acquirePrivateMacosCoalition()
const scratch = realpathSync(mkdtempSync(`${directory}-data-`))
let failed: unknown
let completed = 0
let fileOnly = false
let refusedCwds = 0
try {
  const controlCanary = join(directory, 'file-only-private-control')
  writeFileSync(controlCanary, 'private-control-canary', { flag: 'wx', mode: 0o600 })
  const marker = join(scratch, 'file-only-write-refusal')
  const fileOnlyInput = {
    owner,
    launcher,
    cwd: '/',
    command: [payload, 'file-only', marker, controlCanary] as const,
    environment: {},
    files: {
      readOnlyFiles: [payload],
      readOnlyTrees: [] as string[],
      writableTrees: [] as string[],
      protectedRoots: [directory],
      network: 'isolated' as const,
    },
    limits: {
      memoryBytes: 32 * 1024 * 1024,
      pids: 4,
      cpuQuotaMicros: 50_000,
      cpuPeriodMicros: 100_000,
      deadlineUnixMs: Date.now() + 10_000,
      cleanupTimeoutMs: 3000,
    },
  }
  for (const invalid of [
    { cwd: '//', files: fileOnlyInput.files },
    { cwd: '/./', files: fileOnlyInput.files },
    { cwd: scratch, files: fileOnlyInput.files },
    { cwd: '/private', files: fileOnlyInput.files },
    { cwd: '/', files: { ...fileOnlyInput.files, readOnlyTrees: [scratch] } },
    { cwd: '/', files: { ...fileOnlyInput.files, writableTrees: [scratch] } },
  ]) {
    let unexpected: Awaited<ReturnType<typeof preparePrivateMacosScope>> | undefined
    let refused = false
    try {
      unexpected = await preparePrivateMacosScope({ ...fileOnlyInput, ...invalid })
    } catch (error) {
      if (
        !(error instanceof TypeError) ||
        error.message !== 'macOS working directory is outside its directory projections'
      )
        throw error
      refused = true
    } finally {
      if (unexpected) {
        unexpected.stdout.resume()
        unexpected.stderr.resume()
        unexpected.stop('cancelled')
        await unexpected.completion
      }
    }
    if (!refused || !owner.empty() || existsSync(marker))
      throw Error('Invalid cwd admitted file-only authority')
    refusedCwds++
  }
  const execution = await preparePrivateMacosScope(fileOnlyInput)
  const collect = async (stream: NodeJS.ReadableStream) => {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of stream) {
      bytes += Buffer.byteLength(chunk)
      if (bytes > 4096) throw Error('File-only fixture output exceeded its bound')
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks).toString()
  }
  const stdout = collect(execution.stdout),
    stderr = collect(execution.stderr)
  execution.admit()
  const result = await execution.completion
  if (
    result.reason !== 'payload_exit' ||
    result.exitCode !== 0 ||
    !result.fenced ||
    !owner.empty() ||
    (await stdout) !== 'file-only-sandbox-proved\n' ||
    (await stderr) !== '' ||
    existsSync(marker)
  )
    throw Error('File-only native sandbox evidence did not match')
  fileOnly = true
  const cases: [string, PrivateMacosStopReason, number, number][] = [
    ['cpu', 'payload_exit', 32, 4],
    ['memory', 'payload_exit', 32, 4],
    ['memory', 'memory_limit', 8, 4],
    ['processes', 'process_limit', 32, 3],
    ['orphan', 'payload_exit', 32, 4],
    ['crash', 'payload_exit', 32, 4],
    ['waiting', 'deadline', 32, 4],
    ['cancelled', 'cancelled', 32, 4],
    ['unadmitted', 'cancelled', 32, 4],
  ]
  for (const [mode, reason, memory, pids] of cases) {
    const marker = join(scratch, String(completed))
    const execution = await preparePrivateMacosScope({
      owner,
      launcher,
      cwd: scratch,
      command: [payload, mode, marker],
      environment: {},
      files: {
        readOnlyFiles: [payload],
        readOnlyTrees: [],
        writableTrees: [scratch],
        protectedRoots: [directory],
        network: 'isolated',
      },
      limits: {
        memoryBytes: memory * 1024 * 1024,
        pids,
        cpuQuotaMicros: 50_000,
        cpuPeriodMicros: 100_000,
        deadlineUnixMs: Date.now() + (mode === 'waiting' ? 1500 : 10_000),
        cleanupTimeoutMs: 3000,
      },
    })
    execution.stdout.resume()
    execution.stderr.resume()
    if (mode === 'unadmitted') {
      await Bun.sleep(30)
      if (existsSync(marker)) throw new Error('scope executed before admission')
      execution.stop('cancelled')
    } else {
      execution.admit()
      if (mode === 'cancelled') {
        const end = performance.now() + 2000
        while (!existsSync(marker) && performance.now() < end) await Bun.sleep(10)
        if (!existsSync(marker)) throw new Error('cancellation fixture never started')
        execution.stop('cancelled')
      }
    }
    const result = await execution.completion
    if (result.reason !== reason || !result.fenced || !owner.empty())
      throw new Error(`incorrect scope result ${mode}: ${JSON.stringify(result)}`)
    if (mode === 'cpu' && BigInt(result.evidence.cpuNanoseconds) < 400_000_000n)
      throw new Error('CPU ledger missed the completed computation')
    if (mode === 'crash' && result.signal !== 6) throw new Error('native crash signal lost')
    if (reason === 'payload_exit' && mode !== 'crash' && result.exitCode !== 0)
      throw new Error('native successful exit lost')
    completed++
  }
} catch (error) {
  failed = error
  console.error(error)
} finally {
  owner.signalMembers('kill')
  const end = performance.now() + 3000
  while (!owner.empty() && performance.now() < end) await Bun.sleep(20)
}
if (!owner.empty()) throw new Error('supervision fixture cleanup is unconfirmed')
rmSync(scratch, { recursive: true })
console.log(
  JSON.stringify({ empty: true, passed: failed === undefined, completed, fileOnly, refusedCwds }),
)
if (failed !== undefined) throw failed
