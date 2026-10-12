import { type StdioOptions, spawn, spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { acquirePrivateMacosCoalition } from '../../src/internal/macos-process-controls.js'
import { privateMacosSandboxProfile } from '../../src/internal/macos-sandbox-profile.js'

const [launcher, payload, directory] = process.argv.slice(2) as [string, string, string]
const owner = acquirePrivateMacosCoalition()
const scratch = realpathSync(mkdtempSync(`${directory}-data-`))
const forbidden = join(directory, 'host-only')
writeFileSync(forbidden, 'synthetic-private-value')
const { text: profile, bootstrap } = privateMacosSandboxProfile({
  readOnlyFiles: [payload],
  readOnlyTrees: [],
  writableTrees: [scratch],
  protectedRoots: [directory],
  network: 'isolated',
})
let failed: unknown
try {
  const inherited = openSync(forbidden, 'r')
  try {
    const descriptors: StdioOptions = Array.from({ length: 201 }, () => 'ignore')
    descriptors[200] = inherited
    const positive = spawnSync(payload, ['--inherited-control'], {
      env: {},
      stdio: descriptors,
      timeout: 2000,
    })
    if (positive.status !== 0) throw new Error('inherited descriptor positive control failed')
  } finally {
    closeSync(inherited)
  }
  const environmentControl = spawnSync(payload, ['--environment-control', String(process.pid)], {
    env: {},
    stdio: 'ignore',
    timeout: 2000,
  })
  if (environmentControl.status !== 0) throw new Error('environment positive control failed')
  for (const mode of ['refused', 'admitted', 'crash']) {
    const admitted = mode !== 'refused'
    const marker = join(scratch, mode)
    const inherited = openSync(forbidden, 'r')
    const descriptors: StdioOptions = Array.from({ length: 201 }, () => 'ignore')
    for (const fd of [1, 2, 3, 4, 5]) descriptors[fd] = 'pipe'
    descriptors[200] = inherited
    const child = spawn(
      launcher,
      [
        '--launch',
        String(Buffer.byteLength(profile)),
        scratch,
        bootstrap,
        payload,
        ...(mode === 'crash' ? ['--crash-control'] : [marker, forbidden, String(process.pid)]),
      ],
      {
        env: {},
        stdio: descriptors,
      },
    )
    closeSync(inherited)
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolve(code))
    })
    let errors = ''
    child.stderr?.on('data', (bytes) => {
      errors = (errors + bytes.toString()).slice(0, 4096)
    })
    const configuration = child.stdio[3] as Writable
    const gate = child.stdio[4] as Writable
    const ready = child.stdio[5] as Readable
    const framesEnded = new Promise<void>((resolve) => ready.once('end', resolve))
    configuration.end(profile)
    let frame = Buffer.alloc(0)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('readiness expired')), 2000)
      ready.on('data', (bytes) => {
        frame = Buffer.concat([frame, bytes])
        if (frame.length >= 16) {
          clearTimeout(timer)
          resolve()
        }
      })
      child.once('exit', () => {
        if (frame.length !== 16) {
          clearTimeout(timer)
          reject(new Error('launcher exited before readiness'))
        }
      })
    })
    if (frame.length !== 16 || frame.readUInt32LE(0) !== 0x4a49474d || frame.readUInt32LE(12) !== 0)
      throw new Error('invalid private readiness')
    await Bun.sleep(50)
    if (existsSync(marker)) throw new Error('unadmitted native code executed')
    const sample = owner.sample()
    if (!sample.complete || sample.active !== 3n) throw new Error('pre-exec owner is incomplete')
    gate.end(admitted ? 'A' : 'X')
    const code = await exited
    await framesEnded
    if (
      code !== 0 ||
      frame.length !== 32 ||
      frame.readUInt32LE(16) !== 0x4a494758 ||
      frame.readUInt32LE(20) !== frame.readUInt32LE(4) ||
      frame.readUInt32LE(24) !== (mode === 'crash' ? 0xffffffff : admitted ? 0 : 78) ||
      frame.readUInt32LE(28) !== (mode === 'crash' ? 6 : 0)
    )
      throw new Error(
        `unexpected launcher exit: admitted=${admitted} ${code}/${child.signalCode} ${errors}`,
      )
    if (existsSync(marker) !== (mode === 'admitted')) throw new Error('admission result mismatch')
    if (mode === 'admitted' && readFileSync(marker, 'utf8') !== 'executed')
      throw new Error('invalid payload result')
    const settledBy = performance.now() + 3000
    while (!owner.empty() && performance.now() < settledBy) await Bun.sleep(20)
    if (!owner.empty()) throw new Error('launcher left descendants')
  }
} catch (error) {
  failed = error
  console.error(error)
} finally {
  owner.signalMembers('kill')
  const end = performance.now() + 3000
  while (!owner.empty() && performance.now() < end) await Bun.sleep(20)
}
if (!owner.empty()) {
  console.error(
    JSON.stringify({ identity: owner.identity, sample: owner.sample() }, (_, value) =>
      typeof value === 'bigint' ? String(value) : value,
    ),
  )
  throw new Error('owned cleanup is unconfirmed')
}
rmSync(scratch, { recursive: true })
console.log(JSON.stringify({ empty: true, passed: failed === undefined }))
if (failed !== undefined) throw failed
