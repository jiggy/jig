import { spawn } from 'node:child_process'
import { acquirePrivateMacosCoalition } from '../../src/internal/macos-process-controls.js'

const owner = acquirePrivateMacosCoalition()
if (!owner.empty()) throw new Error('new owner is not empty')
const child = spawn(
  process.execPath,
  [
    '--no-env-file',
    '--no-install',
    '--config=/dev/null',
    '-e',
    'const b=Buffer.alloc(12*1024*1024,1);console.log(b.length);setTimeout(()=>{console.log(b[0]);process.exit(0)},5000)',
  ],
  { env: {}, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
)
const exited = new Promise<void>((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', () => resolve())
})
let failed: unknown
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child startup expired')), 2000)
    child.stdout.once('data', () => {
      clearTimeout(timer)
      resolve()
    })
  })
  let refused = false
  try {
    acquirePrivateMacosCoalition()
  } catch {
    refused = true
  }
  if (!refused) throw new Error('nonexclusive acquisition succeeded')
  const sample = owner.sample()
  if (
    sample.active !== 2n ||
    !sample.complete ||
    sample.observedMembers !== 1 ||
    sample.footprintBytes < 12n * 1024n * 1024n ||
    sample.cpuNanoseconds === 0n
  )
    throw new Error(
      `invalid live sample: ${JSON.stringify(sample, (_, v) => (typeof v === 'bigint' ? String(v) : v))}`,
    )
  if (owner.signalMembers('stop') !== 1) throw new Error('stop did not reach owned child')
  if (owner.signalMembers('continue') !== 1) throw new Error('continue did not reach owned child')
} catch (error) {
  failed = error
} finally {
  owner.signalMembers('kill')
  await exited
  const end = performance.now() + 3000
  while (!owner.empty() && performance.now() < end) await Bun.sleep(20)
}
if (!owner.empty()) throw new Error('owned cleanup is unconfirmed')
console.log(JSON.stringify({ empty: true, signal: child.signalCode, passed: failed === undefined }))
if (failed !== undefined) throw failed
