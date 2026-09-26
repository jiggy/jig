import { existsSync, writeFileSync } from 'node:fs'
import { recordPrivateMacosOwner } from '../../src/internal/macos-owner-state.js'
import { acquirePrivateMacosCoalition } from '../../src/internal/macos-process-controls.js'
import { preparePrivateMacosScope } from '../../src/internal/macos-scope-execution.js'

const [launcher, payload, scratch, directory] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
]
const owner = acquirePrivateMacosCoalition()
recordPrivateMacosOwner(directory, 'a'.repeat(64), owner)
writeFileSync(`${directory}/phase`, 'recorded\n', { mode: 0o600 })
const execution = await preparePrivateMacosScope({
  owner,
  launcher,
  cwd: scratch,
  command: [payload, 'recovery', `${scratch}/started`],
  environment: {},
  files: {
    readOnlyFiles: [payload],
    readOnlyTrees: [],
    writableTrees: [scratch],
    protectedRoots: [directory],
    network: 'isolated',
  },
  limits: {
    memoryBytes: 32 * 1024 * 1024,
    pids: 8,
    cpuQuotaMicros: 50_000,
    cpuPeriodMicros: 100_000,
    deadlineUnixMs: Date.now() + 12_000,
    cleanupTimeoutMs: 3000,
  },
})
execution.stdout.resume()
execution.stderr.resume()
execution.admit()
writeFileSync(`${directory}/phase`, 'admitted\n')
const end = performance.now() + 5000
while (owner.sample().active < 5n && performance.now() < end) await Bun.sleep(10)
if (owner.sample().active < 5n) {
  execution.stop('cancelled')
  await execution.completion
  throw new Error('recovery fixture did not establish bounded descendants')
}
writeFileSync(`${directory}/ready`, 'ready\n', { mode: 0o600 })
while (!existsSync(`${directory}/lose-guardian`) && performance.now() < end) await Bun.sleep(10)
if (!existsSync(`${directory}/lose-guardian`)) {
  execution.stop('cancelled')
  await execution.completion
  throw new Error('recovery fixture did not receive guardian-loss request')
}
process.kill(process.pid, 'SIGKILL')
