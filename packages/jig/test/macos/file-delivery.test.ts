import { dirname as suiteDirname } from 'node:path'

const suiteTestRoot = suiteDirname(import.meta.dir)

import { expect, test } from 'bun:test'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { privateOwnFileCommand } from '../../src/internal/file-command.js'
import { fixture } from '.././file-delivery.fixture.js'

test(
  'native inspection retains immutable preview within the unchanged command lifetime',
  async () =>
    fixture(async (root) => {
      const ready = join(root, 'ready')
      const exit = await privateOwnFileCommand(
        [
          process.execPath,
          '--no-env-file',
          '--no-install',
          '--config=/dev/null',
          join(suiteTestRoot, 'fixtures/file-delivery-client.ts'),
        ],
        [join(root, 'packet'), join(root, 'pid'), 'preview', ready],
        undefined,
        10_000,
      )
      expect(exit).toEqual({ exitCode: 0, signal: null })
      expect(await readFile(ready, 'utf8')).toBe('verified')
    }),
  15000,
)
test(
  'settled native inspection cannot waive the original command expiry',
  async () =>
    fixture(async (root) => {
      const ready = join(root, 'ready'),
        destination = join(root, 'packet')
      const exit = await privateOwnFileCommand(
        [
          process.execPath,
          '--no-env-file',
          '--no-install',
          '--config=/dev/null',
          join(suiteTestRoot, 'fixtures/file-delivery-client.ts'),
        ],
        [destination, join(root, 'pid'), 'preview-expiry', ready],
        undefined,
        5_000,
      )
      expect(exit.signal).toBe('SIGTERM')
      expect(await readFile(ready, 'utf8')).toBe('published')
      expect(JSON.parse(await readFile(join(destination, 'result.json'), 'utf8')).status).toBe(
        'succeeded',
      )
    }),
  15_000,
)
test(
  'native command authenticates its parent and transfers renamed input roots and immutable final output',
  async () =>
    fixture(async (root) => {
      const before = (await readdir('/private/tmp'))
        .filter((name) => name.startsWith('jig-file-owner-'))
        .sort()
      for (const mode of ['snapshot', 'wrong-parent']) {
        const destination = join(root, mode)
        const exit = await privateOwnFileCommand(
          [
            process.execPath,
            '--no-env-file',
            '--no-install',
            '--config=/dev/null',
            join(suiteTestRoot, 'fixtures/file-delivery-client.ts'),
          ],
          [destination, join(root, `${mode}.pid`), mode],
          undefined,
          10_000,
        )
        if (mode === 'snapshot') {
          expect(exit).toEqual({ exitCode: 0, signal: null })
          expect([...(await readFile(join(destination, 'files/nested/binary')))]).toEqual([
            0, 255, 128,
          ])
          expect((await readFile(join(destination, 'files/empty'))).length).toBe(0)
          expect(
            JSON.parse(await readFile(join(destination, 'result.json'), 'utf8')).delivery.source,
          ).toBe('final')
        } else {
          expect(exit.exitCode).not.toBe(0)
          await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
        }
      }
      expect(
        (await readdir('/private/tmp')).filter((name) => name.startsWith('jig-file-owner-')).sort(),
      ).toEqual(before)
    }),
  25_000,
)

if (process.platform !== 'darwin') throw Error('This suite requires a native Mac')
