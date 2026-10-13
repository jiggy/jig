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
import { createPrivateLinuxFileImportTarget } from '../src/internal/linux-file-import.js'
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
export { deferred, fixture }
