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
} from '../src/internal/file-input.js'
import {
  capturePrivateInput,
  readPrivateCapturedInput,
  requirePrivateCapturedInput,
} from '../src/internal/input-capture.js'
import {
  privateDuplicateInputForStdio,
  privateVerifyLinuxSealedFile,
} from '../src/internal/linux-file-input.js'
async function fixture(work: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-file-input-')))
  try {
    await work(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
export { fixture }
