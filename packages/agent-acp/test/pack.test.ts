import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('packs the complete public dependencies and repacks without workspace resolution', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const temporary = await mkdtemp(join(tmpdir(), 'agent-acp-pack-test-'))
  try {
    const first = join(temporary, 'first')
    const extracted = join(temporary, 'extracted')
    const repacked = join(temporary, 'repacked')
    await mkdir(extracted)
    execFileSync(process.execPath, ['scripts/pack.ts', '--destination', first], {
      cwd: root,
      stdio: 'pipe',
    })
    const archive = (await readdir(first)).find((name) => name.endsWith('.tgz'))!
    expect(archive).toBeDefined()
    execFileSync('tar', ['-xzf', join(first, archive), '--strip-components=1', '-C', extracted])
    const manifest = JSON.parse(await readFile(join(extracted, 'package.json'), 'utf8'))
    const inventory = JSON.parse(
      await readFile(join(extracted, 'tooling', 'dependencies.json'), 'utf8'),
    )
    for (const [name, file] of [
      ['@jigging/flow', 'flow-sdk.tgz'],
      ['@jigging/agent-method', 'agent-method.tgz'],
    ]) {
      expect(manifest.devDependencies[name!]).toBe(`file:./tooling/${file}`)
      const bytes = await readFile(join(extracted, 'tooling', file!))
      expect(inventory[name!].sha256).toBe(
        `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      )
      const included = JSON.parse(
        execFileSync('tar', ['-xOf', join(extracted, 'tooling', file!), 'package/package.json'], {
          encoding: 'utf8',
        }),
      )
      expect(included.name).toBe(name)
      expect(included.version).toBe(inventory[name!].version)
    }
    expect(Object.keys(manifest.dependencies ?? {})).toHaveLength(0)
    expect(await readFile(join(extracted, 'dist', 'transport.js'), 'utf8')).toContain(
      'class FiniteAcpFrames',
    )
    const runtime = await readFile(join(extracted, 'dist', 'flow.js'), 'utf8')
    expect(runtime).toContain('session/prompt')
    expect(runtime).not.toMatch(/from ["']@jigging\//)
    // Import the documented packed helper and bundled runtime without installing.
    execFileSync(
      process.execPath,
      [
        '-e',
        'await import("./dist/flow.js"); const transport = await import("./dist/transport.js"); new transport.FiniteAcpFrames("requests").finish()',
      ],
      { cwd: extracted, stdio: 'pipe' },
    )
    execFileSync(process.execPath, ['scripts/pack.ts', '--destination', repacked], {
      cwd: extracted,
      stdio: 'pipe',
    })
    const next = (await readdir(repacked)).find((name) => name.endsWith('.tgz'))!
    for (const file of ['flow-sdk.tgz', 'agent-method.tgz']) {
      const bytes = execFileSync('tar', ['-xOf', join(repacked, next), `package/tooling/${file}`])
      expect(Buffer.compare(bytes, await readFile(join(extracted, 'tooling', file)))).toBe(0)
    }
    await writeFile(join(extracted, 'tooling', 'agent-method.tgz'), new Uint8Array([0]))
    expect(() =>
      execFileSync(process.execPath, ['scripts/pack.ts', '--destination', repacked], {
        cwd: extracted,
        stdio: 'pipe',
      }),
    ).toThrow()
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}, 30_000)
