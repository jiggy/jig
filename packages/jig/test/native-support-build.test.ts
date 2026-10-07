import { expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { checkNativeSupport } from '../scripts/native-support.mjs'

const root = resolve(import.meta.dir, '..')
const inputs = [
  'scripts/native-support.mjs',
  'support/macos-native-build.json',
  'support/macos-exec.c',
  'support/macos-exec-universal',
  'support/macos-descriptor-bridge.c',
  'support/macos-descriptor-bridge.dylib',
  'support/macos-codex-preferences.m',
  'support/macos-codex-preferences-universal',
  'src/internal/macos-descriptor-files.ts',
  'src/internal/installed-bun-support.ts',
]

test('native provenance accepts the checked-in source, binaries and runtime pin', () => {
  expect(checkNativeSupport().architectures).toEqual(['x86_64', 'arm64'])
})

for (const input of inputs.filter((path) => !path.endsWith('.json'))) {
  test(`native provenance refuses changed ${input}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'jig-native-provenance-'))
    try {
      for (const path of inputs) {
        mkdirSync(dirname(join(directory, path)), { recursive: true })
        cpSync(join(root, path), join(directory, path))
      }
      const path = join(directory, input)
      if (input.endsWith('macos-descriptor-files.ts')) {
        writeFileSync(
          path,
          readFileSync(path, 'utf8').replace(
            /digest\('hex'\) !== '[a-f0-9]{64}'/,
            "digest('hex') !== 'wrong'",
          ),
        )
      } else if (input.endsWith('installed-bun-support.ts')) {
        writeFileSync(
          path,
          readFileSync(path, 'utf8').replace(
            /descriptorBridgeDigest !==\s*'sha256:[a-f0-9]{64}'/,
            "descriptorBridgeDigest !== 'wrong'",
          ),
        )
      } else {
        writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from('changed')]))
      }
      expect(() => checkNativeSupport(directory)).toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

for (const binary of [
  'macos-exec-universal',
  'macos-descriptor-bridge.dylib',
  'macos-codex-preferences-universal',
]) {
  test(`both ${binary} slices retain the UUID required by newer Darwin loaders`, () => {
    const bytes = readFileSync(join(root, 'support', binary))
    expect(bytes.readUInt32BE(0)).toBe(0xcafebabe)
    expect(bytes.readUInt32BE(4)).toBe(2)
    const architectures = []
    for (let slice = 0; slice < 2; slice++) {
      const entry = 8 + slice * 20
      architectures.push(bytes.readUInt32BE(entry))
      const start = bytes.readUInt32BE(entry + 8)
      const end = start + bytes.readUInt32BE(entry + 12)
      expect(end).toBeLessThanOrEqual(bytes.length)
      expect(bytes.readUInt32LE(start)).toBe(0xfeedfacf)
      const commands = bytes.readUInt32LE(start + 16)
      let offset = start + 32
      let uuids = 0
      for (let command = 0; command < commands; command++) {
        const kind = bytes.readUInt32LE(offset)
        const size = bytes.readUInt32LE(offset + 4)
        expect(size).toBeGreaterThanOrEqual(8)
        expect(offset + size).toBeLessThanOrEqual(end)
        if (kind === 0x1b) {
          expect(size).toBe(24)
          expect(bytes.subarray(offset + 8, offset + 24).some((byte) => byte !== 0)).toBe(true)
          uuids++
        }
        offset += size
      }
      expect(uuids).toBe(1)
    }
    expect(architectures.sort()).toEqual([0x01000007, 0x0100000c])
  })
}
