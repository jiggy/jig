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
