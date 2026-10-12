import { describe, expect, test } from 'bun:test'
import { createReadStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CapturedFile } from '../../src/package/capture.js'
import { packageDigest } from '../../src/package/digest.js'
import { metadata, withDirectory } from '.././package-capture.fixture.js'

describe('Package/0 digest', () => {
  test('matches an independently generated fixed vector', async () => {
    await withDirectory(async (root) => {
      const flowPath = join(root, 'FLOW.md')
      const binaryPath = join(root, 'a.bin')
      await writeFile(flowPath, metadata)
      await writeFile(binaryPath, Uint8Array.of(0, 1, 255))
      const files: CapturedFile[] = [
        { path: 'FLOW.md', size: Buffer.byteLength(metadata) },
        { path: 'a.bin', size: 3 },
      ]
      const paths = new Map([
        ['FLOW.md', flowPath],
        ['a.bin', binaryPath],
      ])
      expect(await packageDigest(files, (file) => createReadStream(paths.get(file.path)!))).toBe(
        'sha256:71e40c5716a95f11719bfa6d01b8a8f1c37a90ff7ee04470105fa1cfe196f8b1',
      )
    })
  })
  test('length-prefixes paths and contents', async () => {
    await withDirectory(async (root) => {
      const first = join(root, 'first')
      const second = join(root, 'second')
      await writeFile(first, 'bc')
      await writeFile(second, 'c')
      const left = await packageDigest([{ path: 'a', size: 2 }], () => createReadStream(first))
      const right = await packageDigest([{ path: 'ab', size: 1 }], () => createReadStream(second))
      expect(left).not.toBe(right)
    })
  })
  test('canonicalizes record order before hashing', async () => {
    await withDirectory(async (root) => {
      const a = join(root, 'a')
      const b = join(root, 'b')
      await writeFile(a, 'a')
      await writeFile(b, 'b')
      const paths = new Map([
        ['a', a],
        ['b', b],
      ])
      const read = (file: CapturedFile) => createReadStream(paths.get(file.path)!)
      const canonical = await packageDigest(
        [
          { path: 'a', size: 1 },
          { path: 'b', size: 1 },
        ],
        read,
      )
      const reversed = await packageDigest(
        [
          { path: 'b', size: 1 },
          { path: 'a', size: 1 },
        ],
        read,
      )
      expect(reversed).toBe(canonical)
    })
  })
})
