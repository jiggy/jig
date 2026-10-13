import { describe, expect, test } from 'bun:test'
import { constants } from 'node:fs'
import {
  chmod,
  link,
  mkdir,
  open,
  rename,
  symlink,
  truncate,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import {
  captureOpenedPackageDirectory,
  capturePackageDirectory,
} from '../../src/package/capture.js'
import { packageDigest } from '../../src/package/digest.js'
import {
  expectCaptureError,
  metadata,
  withCapture,
  withDirectory,
} from '.././package-capture.fixture.js'

describe('Native Package/0 directory capture', () => {
  test('captures every regular file in canonical byte order and isolates staged bytes', async () => {
    await withDirectory(async (source) => {
      await writeFile(join(source, 'z.txt'), 'old')
      await mkdir(join(source, 'empty'))
      await mkdir(join(source, 'nested'))
      await writeFile(join(source, 'nested', '.hidden'), 'hidden')
      await writeFile(join(source, 'FLOW.md'), metadata)

      await withCapture(source, async (captured) => {
        expect('stageRoot' in captured).toBe(false)
        expect('stagedPath' in captured.files[0]!).toBe(false)
        expect(captured.files.map((file) => file.path)).toEqual([
          'FLOW.md',
          'nested/.hidden',
          'z.txt',
        ])
        await writeFile(join(source, 'z.txt'), 'new')
        expect(new TextDecoder().decode(await captured.read('z.txt'))).toBe('old')
        expect(await captured.read('nested/.hidden')).toEqual(new TextEncoder().encode('hidden'))
      })
    })
  })
  test('ignores enumeration order and filesystem metadata in identity', async () => {
    await withDirectory(async (left) => {
      await withDirectory(async (right) => {
        await writeFile(join(left, 'FLOW.md'), metadata)
        await writeFile(join(left, 'file'), 'same')
        await writeFile(join(right, 'file'), 'same')
        await writeFile(join(right, 'FLOW.md'), metadata)
        await chmod(join(right, 'file'), 0o700)
        await utimes(join(right, 'file'), new Date(1_000), new Date(2_000))

        await withCapture(left, async (first) => {
          await withCapture(right, async (second) => {
            expect(first.digest).toBe(second.digest)
          })
        })
      })
    })
  })
  test('isolates reused copy bytes across chunks, files and concurrent captures', async () => {
    await withDirectory(async (left) => {
      await withDirectory(async (right) => {
        const chunk = 1024 * 1024
        const large = new Uint8Array(2 * chunk + 17)
        large.fill(0xa1, 0, chunk)
        large.fill(0xb2, chunk, 2 * chunk)
        large.fill(0xc3, 2 * chunk)
        const files = new Map([
          ['large.bin', large],
          ['short.bin', Uint8Array.of(0, 255, 1)],
          ['empty.bin', new Uint8Array(0)],
        ])
        for (const [path, bytes] of files) await writeFile(join(left, path), bytes)
        await writeFile(join(right, 'other.bin'), new Uint8Array(chunk + 3).fill(0xd4))

        const [firstCapture, secondCapture] = await Promise.all([
          capturePackageDirectory(left),
          capturePackageDirectory(right),
        ])
        try {
          for (const [path, bytes] of files) expect(await firstCapture.read(path)).toEqual(bytes)
          expect(await secondCapture.read('other.bin')).toEqual(
            new Uint8Array(chunk + 3).fill(0xd4),
          )
          expect(firstCapture.digest).toBe(
            await packageDigest(
              [...files].map(([path, bytes]) => ({ path, size: bytes.byteLength })),
              async function* (file) {
                const bytes = files.get(file.path)
                if (bytes === undefined) throw new Error('Unexpected fixture file.')
                yield bytes
              },
            ),
          )
          // Snapshot streams own their yielded chunks, unlike the private copier.
          const iterator = firstCapture.stream('large.bin')[Symbol.asyncIterator]()
          try {
            const first = await iterator.next()
            if (first.done || first.value === undefined) throw new Error('Missing captured chunk.')
            const saved = first.value.slice()
            await iterator.next()
            await firstCapture.read('short.bin')
            expect(first.value).toEqual(saved)
          } finally {
            await iterator.return?.()
          }
        } finally {
          await Promise.all([firstCapture.dispose(), secondCapture.dispose()])
        }
      })
    })
  })
  test('changes identity for content, path, extra files, and line endings', async () => {
    const digests = new Set<string>()
    for (const files of [
      { 'FLOW.md': metadata, file: 'one' },
      { 'FLOW.md': metadata, file: 'two' },
      { 'FLOW.md': metadata, renamed: 'one' },
      { 'FLOW.md': metadata, file: 'one', extra: '' },
      { 'FLOW.md': metadata.replaceAll('\n', '\r\n'), file: 'one' },
    ]) {
      await withDirectory(async (source) => {
        for (const [path, content] of Object.entries(files)) {
          await writeFile(join(source, path), content)
        }
        await withCapture(source, async (captured) => {
          digests.add(captured.digest)
        })
      })
    }
    expect(digests.size).toBe(5)
  })
  test('accepts fully contained hardlinks as independent records', async () => {
    await withDirectory(async (source) => {
      await writeFile(join(source, 'FLOW.md'), metadata)
      await writeFile(join(source, 'a'), 'shared')
      await link(join(source, 'a'), join(source, 'b'))
      await withCapture(source, async (captured) => {
        expect(captured.files.map((file) => file.path)).toEqual(['FLOW.md', 'a', 'b'])
        expect(await captured.read('a')).toEqual(await captured.read('b'))
      })
    })
  })
  test('rejects symlinks and escaping hardlinks', async () => {
    await withDirectory(async (root) => {
      const outside = join(root, 'outside')
      await writeFile(outside, 'outside')

      const symlinkPackage = join(root, 'symlink-package')
      await mkdir(symlinkPackage)
      await writeFile(join(symlinkPackage, 'FLOW.md'), metadata)
      await symlink(outside, join(symlinkPackage, 'linked'))
      await expectCaptureError(symlinkPackage, 'PACKAGE_SYMLINK')

      const hardlinkPackage = join(root, 'hardlink-package')
      await mkdir(hardlinkPackage)
      await writeFile(join(hardlinkPackage, 'FLOW.md'), metadata)
      await link(outside, join(hardlinkPackage, 'linked'))
      await expectCaptureError(hardlinkPackage, 'PACKAGE_HARDLINK')
    })
  })
  test('rejects a symlink as the selected source root', async () => {
    await withDirectory(async (root) => {
      const source = join(root, 'source')
      const alias = join(root, 'alias')
      await mkdir(source)
      await writeFile(join(source, 'FLOW.md'), metadata)
      await symlink(source, alias)
      await expectCaptureError(alias, 'PACKAGE_ROOT')
    })
  })
  test('captures an opened directory identity rather than a replaced pathname', async () => {
    await withDirectory(async (root) => {
      const selected = join(root, 'selected')
      const moved = join(root, 'moved')
      await mkdir(selected)
      await writeFile(join(selected, 'FLOW.md'), metadata)
      await writeFile(join(selected, 'value.txt'), 'original')

      const handle = await open(
        selected,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      try {
        await rename(selected, moved)
        await mkdir(selected)
        await writeFile(join(selected, 'FLOW.md'), metadata)
        await writeFile(join(selected, 'value.txt'), 'replacement')

        const captured = await captureOpenedPackageDirectory('flows/selected', handle)
        try {
          expect(new TextDecoder().decode(await captured.read('value.txt'))).toBe('original')
          expect(captured.sourceLabel).toBe('flows/selected')
          expect((await handle.stat()).isDirectory()).toBeTrue()
        } finally {
          await captured.dispose()
        }
      } finally {
        await handle.close()
      }
    })
  })
  test('rejects a file one byte above the absolute Package/0 ceiling before copying', async () => {
    await withDirectory(async (source) => {
      await writeFile(join(source, 'FLOW.md'), metadata)
      const oversized = join(source, 'oversized.bin')
      await writeFile(oversized, '')
      await truncate(oversized, 1_073_741_825)
      await expectCaptureError(source, 'PACKAGE_LIMIT')
    })
  })
})

if (
  !(
    process.platform === 'linux' ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  )
)
  throw Error('This suite requires Linux or opted-in native Mac filesystem qualification')
