import { expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { privateCaptureAttachments, privateOpenFileRoot } from '../../src/internal/file-input.js'
import { fixture } from '.././file-input.fixture.js'

test('Mac capture refuses case variants of private Jig state', async () =>
  fixture(async (root) => {
    await mkdir(join(root, '.jig'))
    await writeFile(join(root, '.jig', 'private'), 'authority')
    for (const select of ['.JIG/private', '.JiG/private', '.jig/private'])
      expect(() =>
        privateCaptureAttachments([{ name: 'source', directory: root, select: [select] }]),
      ).toThrow()
    expect(() => privateOpenFileRoot(join(root, '.JIG'))).toThrow('cannot be selected')
  }))

if (process.platform !== 'darwin') throw Error('This suite requires a native Mac')
