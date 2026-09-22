import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('ordinary packing retains editable source, registry dependencies and a standalone runtime', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const temporary = await mkdtemp(join(tmpdir(), 'agent-acp-pack-test-'))
  const originalManifest = await readFile(join(root, 'package.json'), 'utf8')
  try {
    const first = join(temporary, 'first')
    const extracted = join(temporary, 'extracted')
    const repacked = join(temporary, 'repacked')
    await mkdir(extracted)
    await mkdir(first)
    await mkdir(repacked)
    const pack = (cwd: string, destination: string) =>
      execFileSync(
        process.execPath,
        ['pm', 'pack', '--ignore-scripts', '--destination', destination],
        {
          cwd,
          stdio: 'pipe',
        },
      )
    pack(root, first)
    const archives = (await readdir(first)).filter((name) => name.endsWith('.tgz'))
    expect(archives).toHaveLength(1)
    const archive = join(first, archives[0]!)
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
    expect(entries).toContain('package/src/flow.ts')
    expect(entries).toContain('package/FLOW.contract.json')
    expect(entries.some((name) => name.includes('/tooling/') || name.endsWith('.tgz'))).toBe(false)
    expect(entries.some((name) => name.includes('/node_modules/'))).toBe(false)
    execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', extracted])
    const manifest = JSON.parse(await readFile(join(extracted, 'package.json'), 'utf8'))
    for (const name of ['@jigging/flow', '@jigging/agent-method']) {
      const version = manifest.devDependencies[name]
      expect(version).toMatch(/^\d+\.\d+\.\d+/)
      expect(version).not.toMatch(/workspace:|file:/)
    }
    expect(Object.keys(manifest.dependencies ?? {})).toHaveLength(0)
    // Public built exports and the complete Flow bundle work without development dependencies.
    execFileSync(
      process.execPath,
      [
        '-e',
        `await import('./dist/flow.js');
        const transport = await import('@jigging/agent-acp/transport');
        new transport.FiniteAcpFrames('requests').finish();
        const ready = transport.readFiniteAcpReady({ kind: 'ready', protocolVersion: 1, cwd: '/work', configuration: [], maxTurns: 1, restoreSessionId: 'owned-session' });
        if (ready.restoreSessionId !== 'owned-session') throw new Error('missing owned restore identity')`,
      ],
      { cwd: extracted, stdio: 'pipe' },
    )
    pack(extracted, repacked)
    const next = (await readdir(repacked)).filter((name) => name.endsWith('.tgz'))
    expect(next).toHaveLength(1)
    const nextManifest = JSON.parse(
      execFileSync('tar', ['-xOf', join(repacked, next[0]!), 'package/package.json'], {
        encoding: 'utf8',
      }),
    )
    expect(nextManifest.devDependencies).toEqual(manifest.devDependencies)
    expect(
      execFileSync('tar', ['-xOf', join(repacked, next[0]!), 'package/src/flow.ts'], {
        encoding: 'utf8',
      }),
    ).toBe(await readFile(join(extracted, 'src/flow.ts'), 'utf8'))
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(originalManifest)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}, 30_000)
