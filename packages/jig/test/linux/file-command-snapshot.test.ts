import { expect, test } from 'bun:test'
import { closeSync, constants, openSync, unlinkSync, writeSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  capturePrivateLinuxTransferredOutput,
  capturePrivateRetainedOutput,
  readPrivateCapturedOutput,
  requirePrivateCapturedOutput,
} from '../../src/internal/captured-output.js'
import { privateOwnFileCommand } from '../../src/internal/file-command.js'
import { sha256 } from '../../src/internal/file-input.js'
import { fixture } from '../file-delivery.fixture.js'

test('Linux command owner imports a held sealed snapshot after its source tree disappears', async () =>
  fixture(async (root) => {
    const destination = join(root, 'packet')
    const exit = await privateOwnFileCommand(
      [
        process.execPath,
        '--no-env-file',
        '--no-install',
        '--config=/dev/null',
        join(import.meta.dir, '../fixtures/file-delivery-client.ts'),
      ],
      [destination, join(root, 'pid'), 'snapshot'],
      undefined,
      10_000,
    )
    expect(exit).toEqual({ exitCode: 0, signal: null })
    expect(await readFile(join(destination, 'files/nested/binary'))).toEqual(
      Buffer.from([0, 255, 128]),
    )
    expect(await readFile(join(destination, 'files/empty'))).toEqual(Buffer.alloc(0))
    expect(await readFile(join(destination, 'files/large.bin'))).toEqual(
      Buffer.from(Array.from({ length: 131079 }, (_, index) => index % 251)),
    )
    const packet = JSON.parse(await readFile(join(destination, 'result.json'), 'utf8'))
    expect(packet.status).toBe('succeeded')
    expect(packet.delivery.source).toBe('final')
    expect((await readdir(root)).sort()).toEqual(['packet', 'pid'])
  }))

test('Linux transferred snapshots require seals and exact bounded manifest identity', async () =>
  fixture(async (root) => {
    const bytes = Buffer.from([0, 255, 128])
    const original = capturePrivateRetainedOutput({
      files: [{ path: 'nested/binary', bytes, digest: sha256(bytes) }],
      directories: ['nested', 'unused'],
    })
    const held = requirePrivateCapturedOutput(original)
    const manifest = {
      bytes: held.bytes,
      digest: held.digest,
      files: held.files,
      directories: held.directories,
    }
    const reader = openSync(`/proc/self/fd/${held.fd}`, constants.O_RDONLY)
    try {
      const copy = capturePrivateLinuxTransferredOutput(reader, manifest)
      original.close()
      try {
        expect(readPrivateCapturedOutput(copy)[0]!.contents).toEqual(bytes)
        expect(copy.directories).toEqual(['nested', 'unused'])
      } finally {
        copy.close()
      }
      for (const invalid of [
        { ...manifest, extra: true },
        { ...manifest, bytes: 16 * 1024 * 1024 + 1 },
        { ...manifest, digest: sha256(Buffer.from('wrong')) },
        { ...manifest, files: [{ ...held.files[0]!, offset: 1 }] },
        { ...manifest, files: [{ ...held.files[0]!, digest: sha256(Buffer.from('wrong')) }] },
        { ...manifest, directories: [] },
        { ...manifest, directories: ['nested', 'nested'] },
        { ...manifest, directories: ['nested', 'nested/binary'] },
        { ...manifest, files: [{ ...held.files[0]!, path: '../escape' }] },
      ])
        expect(() => capturePrivateLinuxTransferredOutput(reader, invalid)).toThrow()

      const path = join(root, 'unsealed')
      const writable = openSync(
        path,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL,
        0o600,
      )
      try {
        writeSync(writable, bytes)
        unlinkSync(path)
        // Anonymous and byte-identical is insufficient without kernel seals.
        expect(() => capturePrivateLinuxTransferredOutput(writable, manifest)).toThrow()
      } finally {
        closeSync(writable)
      }
    } finally {
      original.close()
      closeSync(reader)
    }
  }))

if (process.platform !== 'linux') throw new Error('This suite requires Linux')
