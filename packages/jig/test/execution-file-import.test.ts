import { expect, spyOn, test } from 'bun:test'
import { fstatSync, writeFileSync } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { mkdir, mkdtemp, open, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capturePrivateOutput } from '../src/internal/captured-output.js'
import {
  copyPrivateFileImportOutput,
  createPrivateFileImportTarget,
  PrivateFileImportUnconfirmedError,
  requirePrivateFileImportStage,
  requirePrivateFileImportTarget,
} from '../src/internal/execution-file-import.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jig-private-import-'))
  const source = join(root, 'source'),
    stagePath = join(root, 'stage')
  await mkdir(source)
  await mkdir(stagePath)
  const sourceFd = await open(source),
    stageFd = await open(stagePath)
  let rawCloses = 0,
    targetCloses = 0
  const target = createPrivateFileImportTarget({
    async stage() {
      return {
        directory: stageFd,
        async commit() {
          return 'committed' as const
        },
        async close() {
          rawCloses++
          await stageFd.close()
        },
      }
    },
    async close() {
      targetCloses++
    },
  })
  const stage = await target.stage({
    directory: 'copied',
    operationId: 'copy',
    deadlineUnixMs: Date.now() + 60_000,
    signal: new AbortController().signal,
  })
  return {
    root,
    source,
    stagePath,
    sourceFd,
    target,
    stage,
    rawCloses: () => rawCloses,
    targetCloses: () => targetCloses,
    async close() {
      await target.close()
      await sourceFd.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('copy streams binary and empty snapshot files/directories from immutable captured bytes', async () => {
  const owned = await fixture()
  let snapshot: ReturnType<typeof capturePrivateOutput> | undefined
  try {
    await mkdir(join(owned.source, 'nested'))
    await mkdir(join(owned.source, 'nested', 'empty-directory'))
    await writeFile(join(owned.source, 'binary'), Buffer.from([0, 128, 255]))
    await writeFile(join(owned.source, 'nested', 'empty'), '')
    snapshot = capturePrivateOutput(owned.sourceFd.fd)
    await rm(join(owned.source, 'binary'))
    await copyPrivateFileImportOutput({
      stage: owned.stage,
      output: { kind: 'snapshot', ready: Promise.resolve(snapshot) },
      prefix: 'parent/copied',
      signal: new AbortController().signal,
    })
    expect(await readFile(join(owned.stagePath, 'binary'))).toEqual(Buffer.from([0, 128, 255]))
    expect((await readFile(join(owned.stagePath, 'nested', 'empty'))).length).toBe(0)
    expect(await readdir(join(owned.stagePath, 'nested', 'empty-directory'))).toEqual([])
    expect(() =>
      copyPrivateFileImportOutput({
        stage: owned.stage,
        output: { kind: 'snapshot', ready: Promise.resolve(snapshot!) },
        prefix: 'copied',
        signal: new AbortController().signal,
      }),
    ).toThrow('single-use')
  } finally {
    snapshot?.close()
    await owned.close()
  }
})

test('prefix and source profile rejection writes no private entries and rejects copied capabilities', async () => {
  for (const kind of ['prefix', 'symlink', 'clone-stage', 'clone-snapshot']) {
    const owned = await fixture()
    let snapshot: ReturnType<typeof capturePrivateOutput> | undefined
    try {
      await writeFile(join(owned.source, 'safe'), 'safe')
      if (kind === 'symlink') await symlink('/outside', join(owned.source, 'bad'))
      if (kind === 'clone-snapshot') snapshot = capturePrivateOutput(owned.sourceFd.fd)
      expect(() => requirePrivateFileImportTarget({ ...owned.target })).toThrow('original native')
      expect(() => requirePrivateFileImportStage({ ...owned.stage })).toThrow('original native')
      const input = {
        stage: kind === 'clone-stage' ? { ...owned.stage } : owned.stage,
        output:
          kind === 'clone-snapshot'
            ? { kind: 'snapshot' as const, ready: Promise.resolve({ ...snapshot! }) }
            : { kind: 'linux-directory' as const, directory: owned.sourceFd },
        prefix: kind === 'prefix' ? '../copied' : 'copied',
        signal: new AbortController().signal,
      }
      if (kind === 'clone-stage')
        expect(() => copyPrivateFileImportOutput(input)).toThrow('original native')
      else await expect(copyPrivateFileImportOutput(input)).rejects.toThrow()
      expect(await readdir(owned.stagePath)).toEqual([])
    } finally {
      snapshot?.close()
      await owned.close()
    }
  }
})

test('fenced source mutation between inspection and streaming prevents successful import', async () => {
  const owned = await fixture()
  try {
    await writeFile(join(owned.source, 'data'), 'before')
    const copying = copyPrivateFileImportOutput({
      stage: owned.stage,
      output: { kind: 'linux-directory', directory: owned.sourceFd },
      prefix: 'copied',
      signal: new AbortController().signal,
    })
    // Inspection is synchronous; destination acquisition yields before streaming.
    writeFileSync(join(owned.source, 'data'), 'after!')
    await expect(copying).rejects.toThrow('changed')
  } finally {
    await owned.close()
  }
})

test('closing a stage aborts and joins the original copy before raw descriptor cleanup', async () => {
  const owned = await fixture()
  let snapshot: ReturnType<typeof capturePrivateOutput> | undefined
  try {
    await writeFile(join(owned.source, 'data'), 'bytes')
    snapshot = capturePrivateOutput(owned.sourceFd.fd)
    const ready = deferred<ReturnType<typeof capturePrivateOutput>>()
    const copying = copyPrivateFileImportOutput({
      stage: owned.stage,
      output: { kind: 'snapshot', ready: ready.promise },
      prefix: 'copied',
      signal: new AbortController().signal,
    })
    const rejected = copying.then(
      () => {
        throw new Error('copy unexpectedly completed')
      },
      (cause) => cause,
    )
    const closing = owned.stage.close()
    await Promise.resolve()
    expect(owned.rawCloses()).toBe(0)
    ready.resolve(snapshot)
    expect(await rejected).toBeInstanceOf(Error)
    await closing
    expect(owned.rawCloses()).toBe(1)
    await owned.stage.close()
    expect(owned.rawCloses()).toBe(1)
  } finally {
    snapshot?.close()
    await owned.close()
  }
})

test('target retirement joins preparing allocations and preserves unknown setup cleanup', async () => {
  for (const rejectBeforeClose of [false, true]) {
    const setup = deferred<any>()
    let closed = false
    const target = createPrivateFileImportTarget({
      stage: () => setup.promise,
      async close() {
        closed = true
      },
    })
    const preparing = target.stage({
      directory: 'copied',
      operationId: 'copy',
      deadlineUnixMs: Date.now() + 60_000,
      signal: new AbortController().signal,
    })
    const observed = preparing.then(
      () => {
        throw new Error('setup unexpectedly completed')
      },
      (cause) => cause,
    )
    const failure = new PrivateFileImportUnconfirmedError(new Error('setup ownership unknown'))
    if (rejectBeforeClose) {
      setup.reject(failure)
      expect(await observed).toBeInstanceOf(PrivateFileImportUnconfirmedError)
    }
    const retirement = target.close()
    if (!rejectBeforeClose) {
      expect(closed).toBe(false)
      setup.reject(failure)
      expect(await observed).toBeInstanceOf(PrivateFileImportUnconfirmedError)
    }
    await expect(retirement).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
    expect(closed).toBe(true)
    await expect(target.close()).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
  }
})

test('failed stage retirement stays visible to later target closure without another raw close', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-import-close-'))
  const directory = await open(root)
  let rawCloses = 0,
    targetCloses = 0
  const target = createPrivateFileImportTarget({
    async stage() {
      return {
        directory,
        async commit() {
          return 'committed' as const
        },
        async close() {
          rawCloses++
          await directory.close()
          throw new PrivateFileImportUnconfirmedError(
            new Error('descriptor close acknowledgement unknown'),
          )
        },
      }
    },
    async close() {
      targetCloses++
    },
  })
  try {
    const stage = await target.stage({
      directory: 'copied',
      operationId: 'copy',
      deadlineUnixMs: Date.now() + 60_000,
      signal: new AbortController().signal,
    })
    await expect(stage.close()).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
    await expect(target.close()).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
    expect(rawCloses).toBe(1)
    expect(targetCloses).toBe(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('original target and leases remain owned through uncertain retirement and release after clean close', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-import-retention-'))
  async function mint(failure: 'setup' | 'stage' | 'target' | undefined) {
    const directory = await open(root)
    const target = createPrivateFileImportTarget({
      async stage() {
        if (failure === 'setup') throw new PrivateFileImportUnconfirmedError('unknown stage setup')
        return {
          directory,
          async commit() {
            return 'committed' as const
          },
          async close() {
            await directory.close()
            if (failure === 'stage')
              throw new PrivateFileImportUnconfirmedError('unknown stage retirement')
          },
        }
      },
      async close() {
        if (failure === 'setup') await directory.close()
        if (failure === 'target')
          throw new PrivateFileImportUnconfirmedError('unknown target retirement')
      },
    })
    let stage: Awaited<ReturnType<typeof target.stage>> | undefined
    try {
      stage = await target.stage({
        directory: 'copied',
        operationId: 'copy',
        deadlineUnixMs: Date.now() + 60_000,
        signal: new AbortController().signal,
      })
    } catch (cause) {
      expect(failure).toBe('setup')
      expect(cause).toBeInstanceOf(PrivateFileImportUnconfirmedError)
    }
    if (failure === undefined) await target.close()
    else await expect(target.close()).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
    return {
      failure,
      target: new WeakRef(target),
      stage: stage === undefined ? undefined : new WeakRef(stage),
      directory: new WeakRef(directory),
    }
  }
  try {
    const clean = await mint(undefined)
    const unknown = await Promise.all([mint('setup'), mint('stage'), mint('target')])
    // Leave the WeakRef creation job before forcing full collection.
    await Bun.sleep(0)
    Bun.gc(true)
    expect(clean.target.deref()).toBeUndefined()
    expect(clean.stage?.deref()).toBeUndefined()
    for (const retained of unknown) {
      expect(retained.target.deref()).toBeDefined()
      expect(retained.directory.deref()).toBeDefined()
      if (retained.failure === 'stage') expect(retained.stage?.deref()).toBeDefined()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('uncertain copied-file close keeps its actual FileHandle reachable after caller references leave', async () => {
  async function retire() {
    const owned = await fixture()
    await writeFile(join(owned.source, 'data'), 'bytes')
    const prototype = Object.getPrototypeOf(owned.stage.directory) as FileHandle
    const originalClose = prototype.close
    let copied: WeakRef<FileHandle> | undefined
    let copiedCloses = 0
    const close = spyOn(prototype, 'close').mockImplementation(async function (this: FileHandle) {
      if (!fstatSync(this.fd).isFile()) return originalClose.call(this)
      copied = new WeakRef(this)
      copiedCloses++
      await originalClose.call(this)
      throw new PrivateFileImportUnconfirmedError('copied descriptor close acknowledgement unknown')
    })
    try {
      await expect(
        copyPrivateFileImportOutput({
          stage: owned.stage,
          output: { kind: 'linux-directory', directory: owned.sourceFd },
          prefix: 'copied',
          signal: new AbortController().signal,
        }),
      ).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
      await expect(owned.target.close()).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
      expect(copiedCloses).toBe(1)
      return copied
    } finally {
      close.mockRestore()
      await owned.sourceFd.close()
      await rm(owned.root, { recursive: true, force: true })
    }
  }
  const copied = await retire()
  await Bun.sleep(0)
  Bun.gc(true)
  expect(copied?.deref()).toBeDefined()
})
