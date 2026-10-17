import { expect, test } from 'bun:test'
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPrivateInstalledBunSupport } from '../../src/internal/installed-bun-support.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'

test('built Linux supervisor resolves its complete module closure when relocated alone', async () => {
  const support = await openPrivateInstalledBunSupport(installedBunLocation)
  const directory = await mkdtemp(join(tmpdir(), 'jig-supervisor-closure-'))
  const supervisor = join(directory, 'linux-rootless-supervisor.ts')
  try {
    // This is the ordinary production bundle, copied byte-for-byte. The native
    // launcher likewise projects one file, not its source-tree dependencies.
    await copyFile(join(support.releaseRoot, 'libexec', 'linux-rootless-supervisor.js'), supervisor)
    expect(await readdir(directory)).toEqual(['linux-rootless-supervisor.ts'])
    for (const [mode, refusal] of [
      ['--supervisor', 'invalid rootless supervisor arguments'],
      ['--inner', 'invalid rootless inner separator'],
      ['--inner-output-project', 'invalid rootless inner separator'],
    ] as const) {
      const child = Bun.spawn(
        [
          support.executablePath,
          '--no-env-file',
          '--no-install',
          '--config=/dev/null',
          supervisor,
          mode,
        ],
        {
          cwd: directory,
          env: {},
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 1_000,
        },
      )
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      // A missing transitive module fails before main and cannot produce this
      // exact production argument refusal. This does not qualify containment.
      expect(code).toBe(70)
      expect(child.signalCode).toBeNull()
      expect(stdout).toBe('')
      expect(stderr).toBe(`jig rootless supervisor failed: ${refusal}\n`)
    }
    expect(await readdir(directory)).toEqual(['linux-rootless-supervisor.ts'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
