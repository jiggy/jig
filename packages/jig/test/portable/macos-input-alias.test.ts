import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256 } from '../../src/internal/file-input-policy.js'
import { capturePrivateInput } from '../../src/internal/input-capture.js'
import {
  planPrivateMacosOwnerStateAllocation,
  releasePrivateMacosOwnerState,
} from '../../src/internal/macos-backend-state.js'
import { normalizePrivateMacosInputs } from '../../src/internal/macos-input-projection.js'
import {
  PrivateMacosBackend,
  type PrivateMacosComponentProcess,
  type PrivateMacosSealedOwner,
} from '../../src/internal/macos-native-backend.js'

test('Mac input manifests pin only canonical files and closed whole-root aliases', () => {
  const file = { path: 'first/file', bytes: 1, digest: sha256(Buffer.from('x')) }
  const aliases = [{ name: 'second', target: 'first' }]
  expect(normalizePrivateMacosInputs([file], ['first', 'second'], aliases)).toEqual([file])
  expect(() =>
    normalizePrivateMacosInputs(
      [file, { ...file, path: 'second/file' }],
      ['first', 'second'],
      aliases,
    ),
  ).toThrow()
  expect(() =>
    normalizePrivateMacosInputs(
      [file],
      ['first', 'second'],
      [{ name: 'second', target: '../host' }],
    ),
  ).toThrow()
  expect(() =>
    normalizePrivateMacosInputs(
      [file],
      ['first', 'second'],
      [{ name: 'second', target: 'first', extra: true }],
    ),
  ).toThrow()
})
