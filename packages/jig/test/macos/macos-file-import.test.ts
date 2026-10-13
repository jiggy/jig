import { expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrivateFileImportUnconfirmedError } from '../../src/internal/execution-file-import.js'
import { writePrivateDeliveryFile } from '../../src/internal/file-delivery-storage.js'
import { privateReadRegularFile } from '../../src/internal/file-input.js'
import {
  preparePrivateMacosGuardian,
  recoverPrivateMacosGuardian,
  releasePrivateMacosGuardian,
} from '../../src/internal/macos-guardian-client.js'
import { requirePrivateMacosGuardianStorage } from '../../src/internal/macos-guardian-storage.js'
import type { PrivateMacosGuardianStart } from '../../src/internal/macos-native-supervisor.js'
import { samePrivateMacosOwnedProcess } from '../../src/internal/macos-process-controls.js'
import {
  source,
  configurationFixture,
  fixture,
  faultSupervisor,
  exists,
  proveIndependentStorageCleanup,
  type Fault,
} from '.././macos-file-import.fixture.js'

test('two sibling imports remain private, commit complete folders and release original loans', async () => {
  const run = await fixture()
  try {
    const signal = new AbortController().signal
    const [copy, sheet] = await Promise.all([
      run.target.stage({
        directory: 'copies',
        operationId: 'copy',
        deadlineUnixMs: run.deadlineUnixMs,
        signal,
      }),
      run.target.stage({
        directory: 'overview',
        operationId: 'sheet',
        deadlineUnixMs: run.deadlineUnixMs,
        signal,
      }),
    ])
    await writePrivateDeliveryFile(copy.directory, 'copy.txt', Buffer.from('copy'), () =>
      signal.throwIfAborted(),
    )
    await writePrivateDeliveryFile(sheet.directory, 'sheet.txt', Buffer.from('sheet'), () =>
      signal.throwIfAborted(),
    )
    run.guardian.stdin.write('C')
    await run.wait('private')
    expect(await Promise.all([copy.commit(), sheet.commit()])).toEqual(['committed', 'committed'])
    await Promise.all([copy.close(), sheet.close()])
    const fd = await run.finish('D')
    expect(privateReadRegularFile(fd, 'copies/copy.txt', 16).toString()).toBe('copy')
    expect(privateReadRegularFile(fd, 'overview/sheet.txt', 16).toString()).toBe('sheet')
    await run.release()
  } finally {
    await run.close()
  }
}, 90_000)
test('accepted cancellation and occupied destinations commit nothing and preserve caller files', async () => {
  const run = await fixture()
  try {
    const cancellation = new AbortController()
    const cancelled = await run.target.stage({
      directory: 'cancelled',
      operationId: 'cancelled',
      deadlineUnixMs: run.deadlineUnixMs,
      signal: cancellation.signal,
    })
    await writePrivateDeliveryFile(
      cancelled.directory,
      'partial.txt',
      Buffer.from('discard'),
      () => {},
    )
    cancellation.abort()
    expect(await cancelled.commit()).toBe('absent')
    await cancelled.close()
    const signal = new AbortController().signal
    const collision = await run.target.stage({
      directory: 'copies',
      operationId: 'collision',
      deadlineUnixMs: run.deadlineUnixMs,
      signal,
    })
    await writePrivateDeliveryFile(collision.directory, 'copy.txt', Buffer.from('copy'), () => {})
    run.guardian.stdin.write('X')
    await run.wait('occupied')
    expect(await collision.commit()).toBe('absent')
    await collision.close()
    const fd = await run.finish('E')
    expect(privateReadRegularFile(fd, 'copies/caller.txt', 16).toString()).toBe('caller')
    expect(() => privateReadRegularFile(fd, 'copies/copy.txt', 16)).toThrow()
    expect(() => privateReadRegularFile(fd, 'cancelled/partial.txt', 16)).toThrow()
    await run.release()
  } finally {
    await run.close()
  }
}, 90_000)
test('cancelled and nonzero callers join active stages before non-collecting storage cleanup', async () => {
  for (const mode of ['cancelled', 'nonzero'] as const) {
    const run = await fixture()
    let cleaned = false
    try {
      const stage = await run.target.stage({
        directory: 'copies',
        operationId: mode,
        deadlineUnixMs: run.deadlineUnixMs,
        signal: new AbortController().signal,
      })
      await writePrivateDeliveryFile(
        stage.directory,
        'partial.txt',
        Buffer.from('discard'),
        () => {},
      )
      if (mode === 'cancelled') run.guardian.cancel()
      else run.guardian.stdin.end('F')
      const fenced = await run.guardian.fenced
      expect(fenced.outputFd).toBeUndefined()
      expect(fenced.result?.reason).toBe(mode === 'cancelled' ? 'cancelled' : 'payload_exit')
      if (mode === 'nonzero') expect(fenced.result?.exitCode).toBe(12)
      await run.target.close()
      await stage.close()
      const result = await run.guardian.completion
      expect(result.fenced).toBe(true)
      expect(result.result?.reason).toBe(fenced.result?.reason)
      await proveIndependentStorageCleanup(run.input)
      cleaned = true
    } finally {
      if (!cleaned) {
        run.guardian.cancel()
        await run.guardian.completion.catch(() => undefined)
        await proveIndependentStorageCleanup(run.input)
      }
      if (cleaned) await rm(run.input.root, { recursive: true })
    }
  }
}, 120_000)
test('coordinator loss during original loans, an active stage and a committed stage cleans independently', async () => {
  for (const phase of ['roots-transfer', 'active-stage', 'committed-stage'] as const) {
    const input = await configurationFixture()
    const marker = join(input.root, 'loan.marker')
    if (phase === 'roots-transfer')
      input.supervisor = await faultSupervisor(input.root, phase, marker)
    const configPath = join(input.root, 'coordinator.json')
    await writeFile(configPath, JSON.stringify({ phase, marker, input }), {
      mode: 0o600,
      flag: 'wx',
    })
    const coordinator = spawn(
      process.execPath,
      [
        '--no-env-file',
        '--no-install',
        '--config=/dev/null',
        fileURLToPath(new URL('.././fixtures/macos-file-import-coordinator.ts', import.meta.url)),
        configPath,
      ],
      { env: {}, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let output = '',
      errors = ''
    coordinator.stdout.on('data', (bytes: Buffer) => {
      output += bytes.toString()
    })
    coordinator.stderr.on('data', (bytes: Buffer) => {
      errors += bytes.toString()
    })
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        coordinator.once('error', reject)
        coordinator.once('close', (code, signal) => resolve({ code, signal }))
      },
    )
    void exited.catch(() => undefined)
    let cleaned = false
    try {
      const end = performance.now() + 25_000
      while (
        !output.includes(`${phase}\n`) &&
        performance.now() < end &&
        coordinator.exitCode === null &&
        coordinator.signalCode === null
      ) {
        if (output.length + errors.length > 8192)
          throw new Error('coordinator fixture output exceeded its bound')
        await Bun.sleep(5)
      }
      expect({ output, errors }).toEqual({ output: `${phase}\n`, errors: '' })
      expect(coordinator.kill('SIGKILL')).toBe(true)
      expect(await exited).toEqual({ code: null, signal: 'SIGKILL' })
      await proveIndependentStorageCleanup(input)
      cleaned = true
    } finally {
      if (coordinator.exitCode === null && coordinator.signalCode === null)
        coordinator.kill('SIGKILL')
      await exited
      if (!cleaned) await proveIndependentStorageCleanup(input)
      if (cleaned) await rm(input.root, { recursive: true })
    }
  }
}, 180_000)
test('applied begin and commit with lost ACK remain unconfirmed and fence the original caller', async () => {
  for (const action of ['import-begin', 'import-commit'] as const) {
    const input = await configurationFixture()
    const marker = join(input.root, 'ack.marker')
    input.supervisor = await faultSupervisor(input.root, action, marker)
    const run = await fixture(input)
    let cleaned = false
    try {
      const opening = run.target.stage({
        directory: 'copies',
        operationId: action,
        deadlineUnixMs: run.deadlineUnixMs,
        signal: new AbortController().signal,
      })
      if (action === 'import-begin') {
        await expect(opening).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
        expect(await readFile(marker, 'utf8')).toBe('ready')
      } else {
        const stage = await opening
        await writePrivateDeliveryFile(stage.directory, 'copy.txt', Buffer.from('copy'), () => {})
        await expect(stage.commit()).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
        expect(await readFile(marker, 'utf8')).toBe('committed')
        await expect(stage.close()).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
      }
      await expect(run.guardian.completion).rejects.toBeInstanceOf(Error)
      await expect(run.target.close()).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
      await proveIndependentStorageCleanup(input)
      cleaned = true
    } finally {
      if (!cleaned) {
        run.guardian.cancel()
        await run.guardian.completion.catch(() => undefined)
        await proveIndependentStorageCleanup(input)
      }
      if (cleaned) await rm(input.root, { recursive: true })
    }
  }
}, 120_000)

if (process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1')
  throw Error('This suite requires opted-in native Mac qualification')
