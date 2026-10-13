import { expect, test } from 'bun:test'
import { closeSync, fstatSync, readFileSync, readSync, writeSync } from 'node:fs'
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PrivateFileInputError,
  privateCaptureAttachments,
  privateOpenFileRoot,
  privatePublishDirectory,
} from '../../src/internal/file-input.js'
import {
  capturePrivateInput,
  readPrivateCapturedInput,
  requirePrivateCapturedInput,
} from '../../src/internal/input-capture.js'
import {
  privateDuplicateInputForStdio,
  privateVerifyLinuxSealedFile,
} from '../../src/internal/linux-file-input.js'
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
