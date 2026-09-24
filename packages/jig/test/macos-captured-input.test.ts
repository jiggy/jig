import { expect, test } from 'bun:test'
import {
  closeSync,
  constants,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  writeSync,
} from 'node:fs'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  capturePrivateMacosInput,
  requirePrivateMacosCapturedInput,
} from '../src/internal/macos-captured-input.js'

const mac = test.skipIf(process.platform !== 'darwin')

async function fixture(work: (directory: string) => void | Promise<void>) {
  const directory = realpathSync(await mkdtemp(join(tmpdir(), 'jig-macos-input-')))
  try {
    await work(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

mac('captured bytes have no name, writer, or writable descriptor upgrade', async () =>
  fixture((directory) => {
    const source = Buffer.from([0, 255, 128, 42])
    const capture = capturePrivateMacosInput(directory, source)
    try {
      source.fill(7)
      const { fd } = requirePrivateMacosCapturedInput(capture)
      expect(readdirSync(directory)).toEqual([])
      const bytes = Buffer.alloc(4)
      expect(readSync(fd, bytes, 0, bytes.length, 0)).toBe(4)
      expect([...bytes]).toEqual([0, 255, 128, 42])
      expect(() => writeSync(fd, Buffer.from('X'), 0, 1, 0)).toThrow()
      const duplicate = openSync(`/dev/fd/${fd}`, constants.O_RDONLY)
      closeSync(duplicate)
      expect(() => openSync(`/dev/fd/${fd}`, constants.O_RDWR)).toThrow()
      expect(requirePrivateMacosCapturedInput(capture).digest).toBe(capture.digest)
    } finally {
      capture.close()
    }
    expect(() => requirePrivateMacosCapturedInput(capture)).toThrow('not active')
    capture.close()
  }),
)

mac('serialized metadata cannot mint capture authority, including for empty input', async () =>
  fixture((directory) => {
    const capture = capturePrivateMacosInput(directory, new Uint8Array())
    try {
      expect(requirePrivateMacosCapturedInput(capture).bytes).toBe(0)
      expect(() => requirePrivateMacosCapturedInput({ ...capture })).toThrow('not active')
      expect(() => requirePrivateMacosCapturedInput(JSON.parse(JSON.stringify(capture)))).toThrow(
        'not active',
      )
    } finally {
      capture.close()
    }
  }),
)

mac('capture refuses oversized input and an owner directory readable by others', async () =>
  fixture(async (directory) => {
    expect(() => capturePrivateMacosInput(directory, new Uint8Array(8 * 1024 * 1024 + 1))).toThrow(
      'byte limit',
    )
    await chmod(directory, 0o755)
    expect(() => capturePrivateMacosInput(directory, new Uint8Array())).toThrow('private owner')
    expect(readdirSync(directory)).toEqual([])
  }),
)
