import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('packs the exact complete SDK archive and preserves it when an extracted method is repacked', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const temporary = await mkdtemp(join(tmpdir(), 'agent-method-pack-test-'))
  try {
    const first = join(temporary, 'first')
    const second = join(temporary, 'second')
    const extracted = join(temporary, 'extracted')
    await mkdir(extracted)
    execFileSync(process.execPath, ['scripts/pack.ts', '--destination', first], {
      cwd: root,
      stdio: 'pipe',
    })
    const archive = (await readdir(first)).find((name) => name.endsWith('.tgz'))
    expect(archive).toBeDefined()
    execFileSync('tar', [
      '-xzf',
      join(first, archive as string),
      '--strip-components=1',
      '-C',
      extracted,
    ])
    const manifest = JSON.parse(await readFile(join(extracted, 'package.json'), 'utf8'))
    expect(manifest.devDependencies['@jigging/flow']).toBe('file:./tooling/flow-sdk.tgz')
    expect(Object.keys(manifest.dependencies ?? {})).toHaveLength(0)
    const sdkBytes = await readFile(join(extracted, 'tooling', 'flow-sdk.tgz'))
    const inventory = JSON.parse(
      await readFile(join(extracted, 'tooling', 'flow-sdk.json'), 'utf8'),
    )
    expect(inventory.sha256).toBe(`sha256:${createHash('sha256').update(sdkBytes).digest('hex')}`)
    expect(inventory.name).toBe('@jigging/flow')
    const sdkManifest = JSON.parse(
      execFileSync(
        'tar',
        ['-xOf', join(extracted, 'tooling', 'flow-sdk.tgz'), 'package/package.json'],
        { encoding: 'utf8' },
      ),
    )
    expect(inventory.version).toBe(sdkManifest.version)
    const types = execFileSync(
      'tar',
      ['-xOf', join(extracted, 'tooling', 'flow-sdk.tgz'), 'package/dist/types.d.ts'],
      { encoding: 'utf8' },
    )
    expect(types).toContain('call(call: FlowCall')
    const frozen = join(temporary, 'frozen')
    execFileSync(process.execPath, ['scripts/pack.ts', '--destination', frozen], {
      cwd: root,
      stdio: 'pipe',
      env: { ...process.env, FLOW_SDK_PACKAGE_ARCHIVE: join(extracted, 'tooling', 'flow-sdk.tgz') },
    })
    const frozenArchive = (await readdir(frozen)).find((name) => name.endsWith('.tgz'))
    expect(
      Buffer.compare(
        execFileSync('tar', [
          '-xOf',
          join(frozen, frozenArchive as string),
          'package/tooling/flow-sdk.tgz',
        ]),
        sdkBytes,
      ),
    ).toBe(0)
    // Repacking needs neither an SDK registry lookup nor an installed node_modules.
    execFileSync(process.execPath, ['scripts/pack.ts', '--destination', second], {
      cwd: extracted,
      stdio: 'pipe',
    })
    const repacked = (await readdir(second)).find((name) => name.endsWith('.tgz'))
    const repackedSdk = execFileSync('tar', [
      '-xOf',
      join(second, repacked as string),
      'package/tooling/flow-sdk.tgz',
    ])
    expect(Buffer.compare(repackedSdk, sdkBytes)).toBe(0)
    expect(
      JSON.parse(
        execFileSync('tar', ['-xOf', join(second, repacked as string), 'package/package.json'], {
          encoding: 'utf8',
        }),
      ).devDependencies['@jigging/flow'],
    ).toBe('file:./tooling/flow-sdk.tgz')
    await writeFile(join(extracted, 'tooling', 'flow-sdk.tgz'), new Uint8Array([0]))
    expect(() =>
      execFileSync(process.execPath, ['scripts/pack.ts', '--destination', second], {
        cwd: extracted,
        stdio: 'pipe',
      }),
    ).toThrow()
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}, 30_000)
