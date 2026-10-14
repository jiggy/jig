import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { privateImagePreviewProcess } from '../../src/internal/image-preview.js'

const fixture = fileURLToPath(
  new URL('../fixtures/image-preview-process-fixture.ts', import.meta.url),
)
const parentFixture = fileURLToPath(
  new URL('../fixtures/image-preview-parent-fixture.ts', import.meta.url),
)

async function waitForReady(
  path: string,
): Promise<{ pid: number; capped?: boolean; bytes?: number }> {
  const end = performance.now() + 3000
  while (performance.now() < end) {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch {}
    await Bun.sleep(20)
  }
  throw new Error('decoder did not enter the busy fixture')
}

for (const mode of ['javascript', 'wasm']) {
  test(`whole-process cancellation joins an actual busy ${mode} decoder`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-image-lifetime-'))
    const ready = join(root, 'ready.json')
    const abort = new AbortController()
    const result = privateImagePreviewProcess(
      fixture,
      Buffer.from(JSON.stringify({ mode, ready })),
      abort.signal,
    )
    try {
      const evidence = await waitForReady(ready)
      expect(evidence.pid).not.toBe(process.pid)
      if (mode === 'wasm') {
        expect(evidence.capped).toBeTrue()
        expect(evidence.bytes).toBe(5 * 1024 * 1024)
      }
      abort.abort()
      expect(await result).toBeUndefined()
      expect(() => process.kill(evidence.pid, 0)).toThrow()
    } finally {
      abort.abort()
      await result
      await rm(root, { recursive: true, force: true })
    }
  }, 8000)

  test(`the child deadline stops busy ${mode} without a parent timeout`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-image-deadline-'))
    const ready = join(root, 'ready.json')
    const bytes = Buffer.from(JSON.stringify({ mode, ready }))
    const child = spawn(process.execPath, ['--no-env-file', fixture, String(bytes.length)], {
      env: {},
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    const exited = new Promise((resolve) => child.once('close', resolve))
    child.stdin.on('error', () => {})
    child.stdin.write(bytes)
    try {
      expect((await waitForReady(ready)).pid).toBe(child.pid)
      expect(await exited).not.toBe(0)
      expect(() => process.kill(child.pid!, 0)).toThrow()
    } finally {
      child.kill('SIGKILL')
      await exited
      child.stdin.destroy()
      await rm(root, { recursive: true, force: true })
    }
  }, 8000)
}

test('closing the input lease stops a busy decoder while its parent remains alive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-image-lease-loss-'))
  const ready = join(root, 'ready.json')
  const bytes = Buffer.from(JSON.stringify({ mode: 'wasm', ready }))
  const child = spawn(process.execPath, ['--no-env-file', fixture, String(bytes.length)], {
    env: {},
    stdio: ['pipe', 'ignore', 'ignore'],
  })
  const exited = new Promise((resolve) => child.once('close', resolve))
  child.stdin.on('error', () => {})
  child.stdin.write(bytes)
  try {
    await waitForReady(ready)
    const started = performance.now()
    child.stdin.end()
    expect(await exited).not.toBe(0)
    expect(performance.now() - started).toBeLessThan(2000)
    expect(() => process.kill(child.pid!, 0)).toThrow()
  } finally {
    child.kill('SIGKILL')
    await exited
    child.stdin.destroy()
    await rm(root, { recursive: true, force: true })
  }
}, 8000)

test('parent loss stops a busy Wasm decoder before its own deadline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-image-parent-loss-'))
  const ready = join(root, 'ready.json')
  const parent = Bun.spawn(
    [process.execPath, parentFixture, JSON.stringify({ mode: 'wasm', ready })],
    {
      env: {},
      stdout: 'pipe',
      stderr: 'ignore',
    },
  )
  try {
    const evidence = await waitForReady(ready)
    parent.kill('SIGKILL')
    await parent.exited
    const end = performance.now() + 2000
    let alive = true
    while (performance.now() < end) {
      try {
        process.kill(evidence.pid, 0)
      } catch {
        alive = false
        break
      }
      // Linux may retain an orphan zombie until the runner's PID 1 reaps it.
      if (process.platform === 'linux') {
        try {
          if (
            (await readFile(`/proc/${evidence.pid}/stat`, 'utf8')).split(') ')[1]?.startsWith('Z ')
          ) {
            alive = false
            break
          }
        } catch {
          alive = false
          break
        }
      }
      await Bun.sleep(20)
    }
    expect(alive).toBeFalse()
  } finally {
    parent.kill('SIGKILL')
    await parent.exited
    await rm(root, { recursive: true, force: true })
  }
}, 8000)

test('decoder crashes and oversized replies settle as unavailable', async () => {
  for (const mode of ['crash', 'oversize']) {
    expect(
      await privateImagePreviewProcess(fixture, Buffer.from(JSON.stringify({ mode }))),
    ).toBeUndefined()
  }
})
