// Isolated fault injection: never replace file controls in the shared test process.
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as files from '../../src/internal/linux-file-input.js'

let readFailure: Error
mock.module('../../src/internal/linux-file-input.js', () => ({
  ...files,
  privateReadRegularFile: () => {
    throw readFailure
  },
}))
const { collectPrivateCodexSession, PrivateNativeHistoryUnavailable } = await import(
  '../../src/internal/codex-session-state.js'
)
const nativeId = '013579ab-cdef-4567-89ab-0123456789ab'
const root = await mkdtemp(join(tmpdir(), 'jig-history-errors-'))
const path = join(root, `sessions/2026/09/17/rollout-2026-09-17T00-00-00-${nativeId}.jsonl`)
const output = await open(root, 'r')
try {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '')
  for (const reason of ['bytes', 'linked'] as const) {
    readFailure = new files.PrivateFileInputError(reason)
    assert.throws(
      () => collectPrivateCodexSession(output, nativeId, []),
      (error) =>
        error instanceof PrivateNativeHistoryUnavailable && error.reason === 'unsupported-history',
    )
  }
  for (const error of [
    ...(['native', 'kernel', 'access', 'missing', 'changed'] as const).map(
      (reason) => new files.PrivateFileInputError(reason),
    ),
    Object.assign(new Error('I/O failure'), { code: 'EIO' }),
    new Error('unexpected collector failure'),
  ]) {
    readFailure = error
    assert.throws(
      () => collectPrivateCodexSession(output, nativeId, []),
      (caught) => caught === error,
    )
  }
} finally {
  await output.close()
  await rm(root, { recursive: true, force: true })
}
console.log('native history error classification passed')
