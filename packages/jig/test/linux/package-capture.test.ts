import { describe, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expectCaptureError, metadata, withDirectory } from '.././package-capture.fixture.js'

describe('Native Package/0 directory capture', () => {
  test('rejects case-fold collisions on a case-sensitive source filesystem', async () => {
    await withDirectory(async (root) => {
      const collisionPackage = join(root, 'collision-package')
      await mkdir(collisionPackage)
      await writeFile(join(collisionPackage, 'FLOW.md'), metadata)
      await writeFile(join(collisionPackage, 'Readme'), 'first')
      await writeFile(join(collisionPackage, 'README'), 'second')
      await expectCaptureError(collisionPackage, 'PACKAGE_PATH_COLLISION')
    })
  })
  test('rejects a non-UTF-8 directory entry without decoded replacement', async () => {
    await withDirectory(async (source) => {
      await writeFile(join(source, 'FLOW.md'), metadata)
      const invalidPath = Buffer.concat([Buffer.from(`${source}/`), Buffer.from([0xff])])
      await writeFile(invalidPath, 'invalid name')
      await expectCaptureError(source, 'PACKAGE_PATH_UTF8')
    })
  })
})

if (process.platform !== 'linux') throw Error('This suite requires Linux')
