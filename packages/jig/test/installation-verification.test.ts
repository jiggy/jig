import { expect, test } from 'bun:test'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPrivateAcpAgentProvider,
  revalidatePrivateAcpAgentProvider,
} from '../src/internal/acp-agent-provider.js'
import { privateFileDigest } from '../src/internal/identity.js'
import {
  excludePrivateVerificationProject,
  privateInstallationFileDigest,
  withPrivateInstallationVerification,
} from '../src/internal/installation-verification.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

async function fixture(work: (f: Awaited<ReturnType<typeof createFixture>>) => Promise<void>) {
  const f = await createFixture()
  try {
    await work(f)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
}
async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'jig-verification-'))
  const project = join(root, 'project')
  const source = join(root, 'tool')
  const cache = join(root, 'cache')
  const directory = join(cache, 'jig/installation-verification')
  await mkdir(project)
  await writeFile(source, 'old bytes', { mode: 0o700 })
  const environment = { XDG_CACHE_HOME: cache }
  const run = <T>(
    mode: string | undefined,
    work: () => Promise<T> = () => privateInstallationFileDigest(source) as Promise<T>,
    readOnly = false,
  ) =>
    withPrivateInstallationVerification(
      { ...environment, JIG_VERIFICATION: mode },
      async () => {
        await excludePrivateVerificationProject(project)
        return work()
      },
      { readOnly },
    )
  return {
    root,
    project,
    source,
    cache,
    directory,
    environment,
    file: join(directory, 'entries.json'),
    run,
  }
}

test('cached default persists exact digests and refreshes same-size edits with restored mtime', async () => {
  await fixture(async (f) => {
    const time = new Date('2025-01-01T00:00:00Z')
    await utimes(f.source, time, time)
    const original = await f.run(undefined)
    expect(original).toBe(await privateFileDigest(f.source))
    const cache = await readFile(f.file, 'utf8')
    expect(await f.run('cached')).toBe(original)
    expect(await readFile(f.file, 'utf8')).toBe(cache)
    expect((await lstat(f.file)).mode & 0o777).toBe(0o600)
    expect((await lstat(f.directory)).mode & 0o777).toBe(0o700)
    await writeFile(f.source, 'new bytes')
    await utimes(f.source, time, time)
    expect((await lstat(f.source)).mtimeMs).toBe(time.getTime())
    expect(await f.run('cached')).toBe(await privateFileDigest(f.source))
    expect(await f.run('cached')).not.toBe(original)
  })
})

test('fast deliberately reuses old identity; strict bypasses it; cold fast hashes first', async () => {
  await fixture(async (f) => {
    const original = await f.run('fast')
    await writeFile(f.source, 'new bytes')
    expect(await f.run('fast')).toBe(original)
    expect(await f.run('strict')).toBe(await privateFileDigest(f.source))
    // Strict neither consults nor rewrites the optional cache.
    expect(await f.run('fast')).toBe(original)
    const fresh = await f.run('cached')
    expect(fresh).not.toBe(original)
    expect(await f.run('fast')).toBe(fresh)
    await rm(f.file)
    expect(await f.run('fast')).toBe(fresh)
  })
})

test('cached detects rename replacement, permission changes and symlink substitution', async () => {
  await fixture(async (f) => {
    const original = await f.run('cached')
    const replacement = join(f.root, 'replacement')
    await writeFile(replacement, 'new bytes', { mode: 0o700 })
    await rename(replacement, f.source)
    expect(await f.run('cached')).not.toBe(original)
    const previous = await readFile(f.file, 'utf8')
    await chmod(f.source, 0o600)
    await f.run('cached')
    expect(await readFile(f.file, 'utf8')).not.toBe(previous)
    await rename(f.source, replacement)
    await symlink(replacement, f.source)
    await expect(f.run('cached')).rejects.toThrow('regular file')
    await rm(f.source)
    await expect(f.run('cached')).rejects.toThrow()
  })
})

test.each([
  'malformed',
  'oversized',
  'public-file',
  'linked-file',
  'symlink-file',
  'public-directory',
])('unsafe %s cache falls back to fresh hashes even in fast mode', async (kind) => {
  await fixture(async (f) => {
    await f.run('cached')
    if (kind === 'malformed') await writeFile(f.file, '[{"digest":"invented"}]')
    if (kind === 'oversized') await writeFile(f.file, ' '.repeat(1024 * 1024 + 1))
    if (kind === 'public-file') await chmod(f.file, 0o644)
    if (kind === 'public-directory') await chmod(f.directory, 0o755)
    if (kind === 'linked-file') await link(f.file, join(f.root, 'alias'))
    if (kind === 'symlink-file') {
      await rename(f.file, join(f.root, 'alias'))
      await symlink(join(f.root, 'alias'), f.file)
    }
    await writeFile(f.source, 'new bytes')
    expect(await f.run('fast')).toBe(await privateFileDigest(f.source))
    expect(await readdir(f.directory)).toEqual(['entries.json'])
  })
})

test('cache locations exclude actual projects and symlink routes without writing there', async () => {
  await fixture(async (f) => {
    const route = join(f.root, 'route')
    await symlink(f.project, route)
    for (const cache of [f.project, route, 'relative-cache']) {
      await withPrivateInstallationVerification(
        { JIG_VERIFICATION: 'fast', XDG_CACHE_HOME: cache },
        async () => {
          await excludePrivateVerificationProject(f.project)
          const original = await privateInstallationFileDigest(f.source)
          await writeFile(f.source, `${original}\n`)
          expect(await privateInstallationFileDigest(f.source)).toBe(
            await privateFileDigest(f.source),
          )
        },
      )
    }
    expect(await readdir(f.project)).toEqual([])
    // A project route pointing back outside is excluded too.
    await symlink(f.cache, join(f.project, 'outside'))
    await withPrivateInstallationVerification(
      { XDG_CACHE_HOME: join(f.project, 'outside') },
      async () => {
        await excludePrivateVerificationProject(f.project)
        await privateInstallationFileDigest(f.source)
      },
    )
    expect(await readdir(f.project)).toEqual(['outside'])
    expect(await Bun.file(f.file).exists()).toBe(false)
  })
})

test('read-only inspection neither creates nor refreshes caches', async () => {
  await fixture(async (f) => {
    await f.run('cached', undefined, true)
    expect(await Bun.file(f.file).exists()).toBe(false)
    await f.run('cached')
    const bytes = await readFile(f.file, 'utf8')
    await writeFile(f.source, 'new bytes')
    expect(await f.run('cached', undefined, true)).toBe(await privateFileDigest(f.source))
    expect(await readFile(f.file, 'utf8')).toBe(bytes)
  })
})

test('operator settings are captured and concurrent strict/fast contexts are isolated', async () => {
  await fixture(async (f) => {
    const original = await f.run('cached')
    await writeFile(f.source, 'new bytes')
    const environment = { ...f.environment, JIG_VERIFICATION: 'strict' }
    const strict = withPrivateInstallationVerification(environment, async () => {
      environment.JIG_VERIFICATION = 'fast'
      await excludePrivateVerificationProject(f.project)
      return privateInstallationFileDigest(f.source)
    })
    const [strictDigest, fastDigest] = await Promise.all([strict, f.run('fast')])
    expect(strictDigest).not.toBe(original)
    expect(fastDigest).toBe(original)
    expect(await privateInstallationFileDigest(f.source)).toBe(strictDigest)
    await expect(f.run('typo')).rejects.toThrow('invalid verification mode')
  })
})

test('persisted cache is reusable by a separate process', async () => {
  await fixture(async (f) => {
    const original = await f.run('cached')
    await writeFile(f.source, 'new bytes')
    const module = new URL('../src/internal/installation-verification.ts', import.meta.url).pathname
    const child = Bun.spawn(
      [
        process.execPath,
        '--eval',
        `
      const { withPrivateInstallationVerification, excludePrivateVerificationProject, privateInstallationFileDigest } = await import(${JSON.stringify(module)});
      const digest = await withPrivateInstallationVerification({XDG_CACHE_HOME: ${JSON.stringify(f.cache)}, JIG_VERIFICATION: 'fast'}, async () => {
        await excludePrivateVerificationProject(${JSON.stringify(f.project)});
        return privateInstallationFileDigest(${JSON.stringify(f.source)});
      }); console.log(digest);
    `,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    expect(await new Response(child.stdout).text()).toBe(`${original}\n`)
    expect(await child.exited).toBe(0)
  })
})

test('cached provider launch rejects changed bytes; fast still rejects lost executable permission', async () => {
  await fixture(async (f) => {
    const provider = await f.run('cached', () =>
      createPrivateAcpAgentProvider({
        client: 'test',
        model: 'test',
        credentialMode: 'test',
        adapterPath: f.source,
        sandboxAdapterPath: '/adapter',
        executablePath: f.source,
        sandboxExecutablePath: '/client',
        environment: {},
      }),
    )
    await writeFile(f.source, 'new bytes')
    await expect(
      f.run('cached', () => revalidatePrivateAcpAgentProvider(provider)),
    ).rejects.toThrow()
    // Refresh provider under current bytes, then remove execution eligibility.
    const fresh = await f.run('cached', () =>
      createPrivateAcpAgentProvider({
        client: 'test',
        model: 'test',
        credentialMode: 'test',
        adapterPath: f.source,
        sandboxAdapterPath: '/adapter',
        executablePath: f.source,
        sandboxExecutablePath: '/client',
        environment: {},
      }),
    )
    await chmod(f.source, 0o600)
    await expect(f.run('fast', () => revalidatePrivateAcpAgentProvider(fresh))).rejects.toThrow()
  })
})

test('installed invalid verification is actionable and safe; help remains usable', async () => {
  for (const args of [
    ['run', 'flow:flows/hello'],
    ['inspect'],
    ['run', '--help'],
    ['inspect', '-h'],
  ]) {
    const child = Bun.spawn([join(installedBunLocation.releaseRoot, 'bin/jig'), ...args], {
      env: { ...process.env, JIG_VERIFICATION: 'private-untrusted-value', NO_COLOR: '' },
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    const help = args.includes('--help') || args.includes('-h')
    expect(code).toBe(help ? 0 : 2)
    if (help) expect(stdout).toContain('JIG_VERIFICATION=fast')
    else {
      expect(stdout).toBe('')
      expect(stderr).toContain('JIG_VERIFICATION_INVALID')
      expect(stderr).toContain('No Flow was started')
      expect(stderr).toContain('cached (default), strict, or fast')
    }
    expect(stdout + stderr).not.toContain('private-untrusted-value')
    expect(stdout + stderr).not.toContain('\u001b')
  }
})
