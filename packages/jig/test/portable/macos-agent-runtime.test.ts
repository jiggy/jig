import { afterEach, describe, expect, test } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import { readPrivateMacosAgentMetadata as read } from '../../src/internal/macos-agent-runtime.js'
import { nativeElf } from '.././fixtures/native-elf.js'
import { nativeMachO, universalMachO } from '.././fixtures/native-macho.js'
import { fixture, roots } from '.././macos-agent-runtime.fixture.js'

afterEach(async () => {
  await Promise.all([...roots].map((path) => rm(path, { recursive: true, force: true })))
  roots.clear()
})
describe('bounded static Mach-O metadata', () => {
  for (const [suiteCaseIndex, suiteCaseValue] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ].entries()) {
    test('reads universal metadata (wide=%s little=%s)' + ` (case ${suiteCaseIndex + 1})`, () =>
      Reflect.apply(
        async (wide, little) => {
          const { executable } = await fixture()
          await writeFile(
            executable,
            universalMachO(
              nativeMachO({ needed: ['/usr/lib/libSystem.B.dylib'], search: ['@loader_path/lib'] }),
              wide,
              little,
            ),
          )
          expect(await read(executable)).toEqual({
            executable: true,
            needed: [{ path: '/usr/lib/libSystem.B.dylib', weak: false }],
            search: ['@loader_path/lib'],
          })
        },
        undefined,
        Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
      ),
    )
  }
  test('rejects an operator-selected arm64e executable', async () => {
    const { executable } = await fixture()
    const bytes = nativeMachO()
    bytes.writeUInt32LE(0x0100000c, 4)
    bytes.writeUInt32LE(0x80000002, 8)
    await writeFile(executable, bytes)
    await expect(read(executable)).rejects.toThrow()
  })
  for (const [suiteCaseIndex, suiteCaseValue] of [false, true].entries()) {
    test('accepts baseline LIB64 metadata (universal=%s)' + ` (case ${suiteCaseIndex + 1})`, () =>
      Reflect.apply(
        async (universal) => {
          const { executable } = await fixture()
          const slice = nativeMachO()
          slice.writeUInt32LE(process.arch === 'arm64' ? 0x80000000 : 0x80000003, 8)
          const bytes = universal ? universalMachO(slice) : slice
          if (universal) bytes.writeUInt32BE(process.arch === 'arm64' ? 0x80000000 : 0x80000003, 12)
          await writeFile(executable, bytes)
          expect((await read(executable)).executable).toBe(true)
        },
        undefined,
        Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
      ),
    )
  }
  for (const [suiteCaseIndex, suiteCaseValue] of (
    [
      ['truncated header', (b: Buffer) => b.subarray(0, 16)],
      [
        'wrong architecture',
        (b: Buffer) => {
          b.writeUInt32LE(process.arch === 'arm64' ? 0x01000007 : 0x0100000c, 4)
          return b
        },
      ],
      [
        'CPU dispatch',
        (b: Buffer) => {
          b.writeUInt32LE(8, 8)
          return b
        },
      ],
      [
        'non executable',
        (b: Buffer) => {
          b.writeUInt32LE(1, 12)
          return b
        },
      ],
      [
        'table bounds',
        (b: Buffer) => {
          b.writeUInt32LE(0x7fffffff, 20)
          return b
        },
      ],
      [
        'table count',
        (b: Buffer) => {
          b.writeUInt32LE(4097, 16)
          return b
        },
      ],
      [
        'command alignment',
        (b: Buffer) => {
          b.writeUInt32LE(13, 36)
          return b
        },
      ],
      [
        'command overflow',
        (b: Buffer) => {
          b.writeUInt32LE(0xfffffff8, 36)
          return b
        },
      ],
      [
        'embedded environment',
        (b: Buffer) => {
          b.writeUInt32LE(0x27, 32)
          return b
        },
      ],
      [
        'unknown required command',
        (b: Buffer) => {
          b.writeUInt32LE(0x80000070, 32)
          return b
        },
      ],
      [
        'string offset',
        (b: Buffer) => {
          b.writeUInt32LE(4, 40)
          return b
        },
      ],
      [
        'bad interpreter',
        (b: Buffer) => {
          b[44] = 65
          return b
        },
      ],
      [
        'missing command',
        (b: Buffer) => {
          b.writeUInt32LE(1, 16)
          return b
        },
      ],
      [
        'wrong platform',
        (b: Buffer) => {
          b.writeUInt32LE(2, b.length - 16)
          return b
        },
      ],
      [
        'newer platform',
        (b: Buffer) => {
          b.writeUInt32LE(0x00100000, b.length - 12)
          return b
        },
      ],
    ] as const
  ).entries()) {
    test('rejects %s' + ` (case ${suiteCaseIndex + 1})`, () =>
      Reflect.apply(
        async (_name, mutate) => {
          const { executable } = await fixture()
          await writeFile(executable, mutate(nativeMachO()))
          await expect(read(executable)).rejects.toThrow()
        },
        undefined,
        Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
      ),
    )
  }
  test('rejects cross-format files and shell wrappers without executing them', async () => {
    const { executable } = await fixture()
    await writeFile(executable, nativeElf())
    await expect(read(executable)).rejects.toThrow('Mach-O')
    await writeFile(executable, '#!/bin/sh\nprintf secret-token\n')
    await expect(read(executable)).rejects.toMatchObject({ stage: 'wrapper' })
  })
  for (const [suiteCaseIndex, suiteCaseValue] of [
    'outside',
    'overlap',
    'unaligned',
    'wrong cpu',
    'unsafe integer',
  ].entries()) {
    test('rejects universal %s' + ` (case ${suiteCaseIndex + 1})`, () =>
      Reflect.apply(
        async (kind) => {
          const { executable } = await fixture()
          const bytes = universalMachO(nativeMachO(), true)
          if (kind === 'outside') bytes.writeBigUInt64BE(BigInt(bytes.length), 16)
          if (kind === 'unaligned') bytes.writeBigUInt64BE(4097n, 16)
          if (kind === 'wrong cpu')
            bytes.writeUInt32BE(process.arch === 'arm64' ? 0x01000007 : 0x0100000c, 8)
          if (kind === 'unsafe integer') bytes.writeBigUInt64BE(2n ** 63n, 16)
          if (kind === 'overlap') {
            bytes.writeUInt32BE(2, 4)
            bytes.copy(bytes, 40, 8, 40)
          }
          await writeFile(executable, bytes)
          await expect(read(executable)).rejects.toThrow()
        },
        undefined,
        Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
      ),
    )
  }
})
