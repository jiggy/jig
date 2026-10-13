import { expect, spyOn, test } from 'bun:test'
import { fstatSync, writeFileSync } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { mkdir, mkdtemp, open, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { capturePrivateOutput } from '../../src/internal/captured-output.js'
import {
  copyPrivateFileImportOutput,
  createPrivateFileImportTarget,
  PrivateFileImportUnconfirmedError,
  requirePrivateFileImportStage,
  requirePrivateFileImportTarget,
} from '../../src/internal/execution-file-import.js'
import { createPrivateLinuxFileImportTarget } from '../../src/internal/linux-file-import.js'
import { deferred, fixture } from '.././execution-file-import.fixture.js'

test('Linux target attempts both stages and closes confirmed backing despite sticky commit uncertainty', async () => {
  const root = await mkdtemp('/dev/shm/jig-private-import-close-')
  await mkdir(join(root, 'public'))
  const backing = await open(root)
  const publicDirectory = await open(join(root, 'public'))
  const ended: string[] = []
  const target = createPrivateLinuxFileImportTarget({
    backing,
    publicDirectory,
    deadlineUnixMs: Date.now() + 60_000,
    alive: () => true,
    owner: {
      begin: async () => 'staged',
      cancel() {},
      async commit() {
        throw new PrivateFileImportUnconfirmedError('commit acknowledgement timed out')
      },
      async end(name) {
        ended.push(name)
      },
    },
  })
  try {
    const stages = await Promise.all(
      ['first', 'second'].map((directory) =>
        target.stage({
          directory,
          operationId: directory,
          deadlineUnixMs: Date.now() + 60_000,
          signal: new AbortController().signal,
        }),
      ),
    )
    await expect(stages[0]!.commit()).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
    await expect(target.close()).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
    expect(new Set(ended).size).toBe(2)
    for (const stage of stages)
      await expect(stage.directory.stat()).rejects.toMatchObject({ code: 'EBADF' })
    await expect(backing.stat()).rejects.toMatchObject({ code: 'EBADF' })
    await expect(target.close()).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
    expect(ended).toHaveLength(2)
  } finally {
    await publicDirectory.close()
    await rm(root, { recursive: true, force: true })
  }
})

if (process.platform !== 'linux') throw Error('This suite requires Linux')
