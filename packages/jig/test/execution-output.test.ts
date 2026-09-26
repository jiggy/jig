import { expect, test } from 'bun:test'
import { closeSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PrivateOutputProfileError,
  readPrivateCapturedOutput,
} from '../src/internal/captured-output.js'
import { closePrivateExecutionOutput } from '../src/internal/execution-output.js'
import { privateOpenFileRoot } from '../src/internal/file-input.js'
import type {
  PrivateMacosGuardian,
  PrivateMacosGuardianResult,
} from '../src/internal/macos-guardian-client.js'
import { retainPrivateMacosGuardianOutput } from '../src/internal/macos-guardian-output.js'

const terminal: PrivateMacosGuardianResult = {
  result: null,
  fenced: true,
  recovered: false,
  outputLost: false,
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('native output becomes readable only after fencing, collection release and storage cleanup', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-output-order-')))
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'result'), 'retained bytes')
  let fd = privateOpenFileRoot(source)
  const fenced = deferred<PrivateMacosGuardianResult & { outputFd?: number }>()
  const completion = deferred<PrivateMacosGuardianResult>()
  let released = false,
    ready = false
  const owner = retainPrivateMacosGuardianOutput({
    fenced: fenced.promise,
    completion: completion.promise,
    release() {
      released = true
      closeSync(fd)
      fd = -1
      rmSync(source, { recursive: true })
    },
  } as PrivateMacosGuardian)
  void owner.output.ready.then(() => {
    ready = true
  })
  try {
    await Bun.sleep(1)
    expect(released).toBe(false)
    expect(ready).toBe(false)
    fenced.resolve({ ...terminal, outputFd: fd })
    await Bun.sleep(1)
    expect(released).toBe(true)
    expect(ready).toBe(false)
    completion.resolve(terminal)
    expect(await owner.completion).toBe(terminal)
    const captured = await owner.output.ready
    expect(readPrivateCapturedOutput(captured)[0]!.contents.toString()).toBe('retained bytes')
    await closePrivateExecutionOutput(owner.output)
    expect(() => readPrivateCapturedOutput(captured)).toThrow('not active')
  } finally {
    if (fd >= 0) closeSync(fd)
    await rm(root, { recursive: true, force: true })
  }
})

test('output profile failure preserves cleanup evidence while cleanup failure refuses retained bytes', async () => {
  for (const mode of ['profile', 'cleanup', 'lost', 'fence', 'no-output']) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-output-failure-')))
    await mkdir(join(root, mode === 'profile' ? '.jig' : 'empty'))
    const fd = privateOpenFileRoot(root)
    let releases = 0
    const failure = new Error('fixture failure')
    const owner = retainPrivateMacosGuardianOutput({
      fenced:
        mode === 'fence'
          ? Promise.reject(failure)
          : Promise.resolve({ ...terminal, ...(mode === 'no-output' ? {} : { outputFd: fd }) }),
      completion:
        mode === 'cleanup'
          ? Promise.reject(failure)
          : Promise.resolve({ ...terminal, outputLost: mode === 'lost' }),
      release() {
        releases++
        closeSync(fd)
      },
    } as PrivateMacosGuardian)
    try {
      if (mode === 'cleanup') await expect(owner.completion).rejects.toThrow('cleanup failed')
      else expect((await owner.completion).fenced).toBe(true)
      if (mode === 'profile')
        await expect(owner.output.ready).rejects.toBeInstanceOf(PrivateOutputProfileError)
      else await expect(owner.output.ready).rejects.toThrow()
      expect(releases).toBe(mode === 'fence' || mode === 'no-output' ? 0 : 1)
      await closePrivateExecutionOutput(owner.output)
    } finally {
      if (!releases) closeSync(fd)
      await rm(root, { recursive: true, force: true })
    }
  }
})
