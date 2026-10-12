import { expect, test } from 'bun:test'
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { checkNativeSupport } from '../scripts/native-support.mjs'
import { privateMacosKernelPlatform } from '../src/internal/macos-process-controls.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

let qualified = false
if (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1') {
  try {
    qualified = privateMacosKernelPlatform() === 'darwin-x64-23.4.0-23E224'
  } catch {
    // Unsupported hosts have their Codex refusal checks in native-agent-startup.
  }
}
const native = test.skipIf(!qualified)
type Identity = Readonly<{ pid: number; version: number; owner: number }>

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('observer qualification deadline expired')),
          milliseconds,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

native(
  'actual preference observer refuses caller sandboxes and synthetic managed policy, and expires after parent loss',
  async () => {
    expect(privateMacosKernelPlatform()).toBe('darwin-x64-23.4.0-23E224')
    const root = await realpath(await mkdtemp('/private/tmp/jig-preferences-observer-'))
    const library = join(root, 'interpose.dylib'),
      ownerProgram = join(root, 'owner')
    const packageRoot = installedBunLocation.releaseRoot
    const observer = join(packageRoot, 'support', 'macos-codex-preferences-universal')
    let owner: ChildProcess | undefined
    let terminal:
      | Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>
      | undefined
    let identity: Identity | undefined
    let completed = false
    let cleanupConfirmed = false
    const inspect = (operation: 'state' | 'kill') => {
      if (identity === undefined) throw new Error('observer identity is unavailable')
      return spawnSync(ownerProgram, [operation, String(identity.pid), String(identity.version)], {
        env: {},
        stdio: 'ignore',
        timeout: 1000,
      }).status
    }
    const settle = async (milliseconds: number) => {
      const deadline = performance.now() + milliseconds
      do {
        const state = inspect('state')
        if (state === 0) return true
        if (state !== 1) return false
        await Bun.sleep(50)
      } while (performance.now() < deadline)
      return false
    }
    try {
      const manifest = checkNativeSupport(packageRoot)
      const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
      expect(digest(observer)).toBe(manifest.sha256['support/macos-codex-preferences-universal'])
      const installed = join(packageRoot, 'libexec', 'macos-codex-preferences')
      const actualAssets = [observer]
      if (existsSync(installed)) {
        expect(digest(installed)).toBe(digest(observer))
        actualAssets.push(installed)
      }
      for (const actual of actualAssets) {
        // This qualification requires a host with no configured Codex MDM.
        // Both calls use the unchanged actual executable and no interposer.
        const ordinary = spawnSync(actual, [], { env: {}, encoding: 'utf8', timeout: 6000 })
        expect({
          status: ordinary.status,
          signal: ordinary.signal,
          stdout: ordinary.stdout,
          stderr: ordinary.stderr,
        }).toEqual({ status: 0, signal: null, stdout: '', stderr: '' })
        for (const profile of [
          '(version 1)(allow default)',
          '(version 1)(allow default)(deny user-preference-read managed-preference-read)',
        ]) {
          const sandboxed = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, actual], {
            env: {},
            encoding: 'utf8',
            timeout: 6000,
          })
          expect({
            status: sandboxed.status,
            signal: sandboxed.signal,
            stdout: sandboxed.stdout,
            stderr: sandboxed.stderr,
          }).toEqual({ status: 70, signal: null, stdout: '', stderr: '' })
        }
      }
      const compile = (source: string, output: string, flags: readonly string[] = []) => {
        const result = spawnSync(
          '/usr/bin/clang',
          [
            '-O2',
            '-Wall',
            '-Wextra',
            '-Werror',
            '-Wno-deprecated-declarations',
            ...flags,
            join(import.meta.dir, 'fixtures', source),
            '-o',
            output,
          ],
          { encoding: 'utf8', timeout: 15_000 },
        )
        expect({ status: result.status, errors: result.stderr }).toEqual({ status: 0, errors: '' })
      }
      compile('macos-preferences-observer-interpose.m', library, [
        '-dynamiclib',
        '-fobjc-arc',
        '-framework',
        'Foundation',
      ])
      compile('macos-preferences-observer-owner.c', ownerProgram)
      for (const [mode, code] of [
        ['clear', 0],
        ['sync-fail', 70],
        ['sync-final-fail', 70],
        ['forced-config', 71],
        ['forced-requirements', 71],
        ['future-forced', 71],
      ] as const) {
        const result = spawnSync(observer, [], {
          env: { DYLD_INSERT_LIBRARIES: library, JIG_OBSERVER_FIXTURE_MODE: mode },
          encoding: 'utf8',
          timeout: 6000,
        })
        expect({
          mode,
          status: result.status,
          signal: result.signal,
          stdout: result.stdout,
          stderr: result.stderr,
        }).toEqual({ mode, status: code, signal: null, stdout: '', stderr: '' })
      }
      const observerOwner = spawn(ownerProgram, ['owner', observer, library], {
        env: {},
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      owner = observerOwner
      const ownerTerminal = new Promise<
        Readonly<{ code: number | null; signal: NodeJS.Signals | null }>
      >((resolve, reject) => {
        observerOwner.once('error', reject)
        observerOwner.once('exit', (code, signal) => resolve({ code, signal }))
      })
      terminal = ownerTerminal
      void ownerTerminal.catch(() => undefined)
      const readinessOutput = observerOwner.stdout
      const ownerPid = observerOwner.pid
      if (readinessOutput === null || ownerPid === undefined)
        throw new Error('observer owner readiness channel is unavailable')
      const ready = new Promise<void>((resolve, reject) => {
        let frames = Buffer.alloc(0)
        let spawnedIdentity: Identity | undefined
        readinessOutput.on('data', (bytes: Buffer) => {
          try {
            frames = Buffer.concat([frames, bytes])
            writeFileSync(join(root, 'readiness.bin'), frames, { mode: 0o600 })
            if (frames.length > 32) throw new Error('unexpected observer readiness bytes')
            if (frames.length >= 16 && spawnedIdentity === undefined) {
              if (frames.readUInt32LE(0) !== 0x4a4f5350 || frames.readUInt32LE(12) !== ownerPid)
                throw new Error('invalid spawned observer identity')
              spawnedIdentity = Object.freeze({
                pid: frames.readUInt32LE(4),
                version: frames.readUInt32LE(8),
                owner: frames.readUInt32LE(12),
              })
              if (spawnedIdentity.pid <= 1 || spawnedIdentity.version === 0)
                throw new Error('invalid spawned observer PID version')
              // This frame proves the owned PID. Use the live post-exec version
              // instead of assuming it matches the spawn frame for cleanup.
              writeFileSync(
                join(root, 'spawned-identity.json'),
                `${JSON.stringify(spawnedIdentity)}\n`,
                { mode: 0o600 },
              )
            }
            if (frames.length === 32) {
              if (
                spawnedIdentity === undefined ||
                frames.readUInt32LE(16) !== 0x4a4f424c ||
                frames.readUInt32LE(20) !== spawnedIdentity.pid ||
                frames.readUInt32LE(24) === 0 ||
                frames.readUInt32LE(28) !== spawnedIdentity.owner
              )
                throw new Error('observer did not reach the injected synchronization block')
              identity = Object.freeze({
                pid: frames.readUInt32LE(20),
                version: frames.readUInt32LE(24),
                owner: frames.readUInt32LE(28),
              })
              writeFileSync(join(root, 'identity.json'), `${JSON.stringify(identity)}\n`, {
                mode: 0o600,
              })
              resolve()
            }
          } catch (error) {
            reject(error)
          }
        })
        ownerTerminal.then(
          () => reject(new Error('observer owner exited before readiness')),
          reject,
        )
      })
      await bounded(ready, 3000)
      expect(inspect('state')).toBe(1)
      const killedAt = performance.now()
      expect(owner.kill('SIGKILL')).toBe(true)
      expect(await bounded(terminal, 2000)).toEqual({ code: null, signal: 'SIGKILL' })
      // No kill of the observer occurs until after this independent observation.
      expect(await settle(6000)).toBe(true)
      expect(performance.now() - killedAt).toBeLessThan(6000)
      cleanupConfirmed = true
      completed = true
    } finally {
      if (owner !== undefined && owner.exitCode === null && owner.signalCode === null)
        owner.kill('SIGKILL')
      if (terminal !== undefined) await bounded(terminal, 2000).catch(() => undefined)
      if (identity !== undefined && !cleanupConfirmed) {
        const state = inspect('state')
        if (state === 0) cleanupConfirmed = true
        else if (state === 1 && inspect('kill') === 0) cleanupConfirmed = await settle(2000)
      } else if (owner === undefined) cleanupConfirmed = true
      if (!cleanupConfirmed) {
        // biome-ignore lint/correctness/noUnsafeFinally: Unconfirmed orphan ownership must override the test failure and retain cleanup evidence.
        throw new Error(
          `observer orphan cleanup is unconfirmed; owned evidence retained at ${root}`,
        )
      }
      if (completed) await rm(root, { recursive: true })
    }
  },
  60_000,
)
