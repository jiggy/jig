import { afterEach, describe, expect, test } from 'bun:test'
import { access, lstat, mkdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createPrivateAcpAgentProvider,
  revalidatePrivateAcpAgentProvider,
} from '../../src/internal/acp-agent-provider.js'
import {
  inspectPrivateMacosAgentRuntime as inspect,
  privateMacosCachedLibrary,
  readPrivateMacosAgentMetadata as read,
} from '../../src/internal/macos-agent-runtime.js'
import { binary, fixture, roots } from '.././macos-agent-runtime.fixture.js'

afterEach(async () => {
  await Promise.all([...roots].map((path) => rm(path, { recursive: true, force: true })))
  roots.clear()
})
describe('qualified Mac native runtime closure', () => {
  test('inspects the native OS sandbox executable without running it', async () => {
    const { project } = await fixture()
    expect((await read('/usr/bin/sandbox-exec')).executable).toBe(true)
    expect((await inspect('/usr/bin/sandbox-exec', project)).pathPrefix).toBe('')
  })
  test('retains transitive loader, executable and run-path libraries as exact files', async () => {
    const { root, project, executable } = await fixture()
    const directory = join(root, 'lib')
    await mkdir(directory)
    const first = join(directory, 'first.dylib'),
      second = join(directory, 'second.dylib'),
      third = join(root, 'third.dylib')
    await binary(executable, {
      search: ['@executable_path/lib'],
      needed: ['@rpath/first.dylib', '/usr/lib/libSystem.B.dylib'],
    })
    await binary(first, { library: '@rpath/first.dylib', needed: ['@loader_path/second.dylib'] })
    await binary(second, {
      library: '@rpath/second.dylib',
      needed: ['@executable_path/third.dylib'],
    })
    await binary(third, { library: '@rpath/third.dylib' })
    const result = await inspect(executable, project)
    expect(result.pathPrefix).toBe('')
    expect(result.mounts).toEqual(
      [first, second, third].map((path) => ({ source: path, destination: path, role: 'support' })),
    )
    expect(privateMacosCachedLibrary('/usr/lib/libSystem.B.dylib')).toBe(true)
    expect(privateMacosCachedLibrary('/usr/lib/jig-does-not-exist.dylib')).toBe(false)
  })
  test('allows absent weak libraries, refuses required libraries and project traversal', async () => {
    const { root, project, executable } = await fixture()
    const library = join(root, 'library.dylib')
    await binary(executable, { weak: [library] })
    expect((await inspect(executable, project)).mounts).toEqual([])
    await binary(executable, { needed: [library] })
    await expect(inspect(executable, project)).rejects.toThrow('unavailable')
    await binary(library, { library })
    await symlink(library, join(project, 'library.dylib'))
    await symlink(project, join(root, 'shortcut'))
    await binary(executable, { weak: ['@rpath/library.dylib'], search: ['@loader_path/shortcut'] })
    await expect(inspect(executable, project)).rejects.toThrow('enters the project')
    await binary(executable, { needed: ['@loader_path/shortcut/../library.dylib'] })
    await expect(inspect(executable, project)).rejects.toThrow('enters the project')
  })
  test('inherits run paths and reuses a directly selected library', async () => {
    const { root, project, executable } = await fixture()
    const a = join(root, 'a.dylib'),
      b = join(root, 'b.dylib'),
      c = join(root, 'c.dylib')
    await binary(executable, {
      search: ['@loader_path'],
      needed: ['@rpath/a.dylib', '@rpath/b.dylib'],
    })
    await binary(a, { library: '@rpath/a.dylib', needed: ['@rpath/b.dylib', '@rpath/c.dylib'] })
    await binary(b, { library: '@rpath/b.dylib' })
    await binary(c, { library: '@rpath/c.dylib' })
    expect((await inspect(executable, project)).mounts.map((mount) => mount.source).sort()).toEqual(
      [a, b, c],
    )
  })
  for (const [suiteCaseIndex, suiteCaseValue] of [
    'relative',
    '@unknown/lib',
    '@rpath/lib',
    '/absolute/../ambient',
  ].entries()) {
    test('refuses ambient library search %s' + ` (case ${suiteCaseIndex + 1})`, () =>
      Reflect.apply(
        async (path) => {
          const { project, executable } = await fixture()
          await binary(executable, { search: [path] })
          await expect(inspect(executable, project)).rejects.toThrow('path is invalid')
        },
        undefined,
        Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
      ),
    )
  }
  test('checks full-file identities through provider construction and again before launch', async () => {
    const { root, project, executable } = await fixture()
    const library = join(root, 'library.dylib')
    await binary(executable, { needed: [library] })
    await binary(library, { library })
    const bytes = Buffer.concat([await readFile(library), Buffer.alloc(2 * 1024 * 1024)])
    await writeFile(library, bytes)
    const inspected = await inspect(executable, project)
    const create = () =>
      createPrivateAcpAgentProvider({
        client: 'test',
        model: 'test',
        credentialMode: 'none',
        adapterPath: executable,
        sandboxAdapterPath: '/agent/adapter',
        executablePath: executable,
        sandboxExecutablePath: executable,
        environment: {},
        readOnlyMounts: inspected.mounts,
      })
    const provider = await create()
    expect(() => inspected.verifyProvider(provider)).not.toThrow()
    const before = await lstat(library)
    bytes[bytes.length - 1] = 1
    await writeFile(library, bytes)
    await utimes(library, before.atime, before.mtime)
    const replacement = await create()
    expect(() => inspected.verifyProvider(replacement)).toThrow('runtime changed')
    await expect(revalidatePrivateAcpAgentProvider(provider)).rejects.toThrow('support changed')
  })
  test('inspects real SDK-linked code without running library constructors', async () => {
    const { root, project, executable } = await fixture()
    const marker = join(root, 'constructor-ran'),
      library = join(root, 'libfixture.dylib')
    const source = join(root, 'fixture.c'),
      main = join(root, 'main.c')
    await writeFile(
      source,
      `#include <stdio.h>\n__attribute__((constructor)) static void start(void) { FILE *f = fopen(${JSON.stringify(marker)}, "w"); if (f) fclose(f); }\nint answer(void) { return 42; }\n`,
    )
    await writeFile(
      main,
      'extern int answer(void); int main(void) { return answer() == 42 ? 0 : 1; }\n',
    )
    for (const args of [
      ['-dynamiclib', '-install_name', '@rpath/libfixture.dylib', source, '-o', library],
      [main, '-L', root, '-lfixture', '-Wl,-rpath,@executable_path', '-o', executable],
    ]) {
      const result = Bun.spawnSync(
        ['/usr/bin/clang', '-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64', ...args],
        {
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 20_000,
        },
      )
      expect(result.exitCode).toBe(0)
    }
    const inspected = await inspect(executable, project)
    expect(inspected.mounts).toEqual([{ source: library, destination: library, role: 'support' }])
    await expect(access(marker)).rejects.toThrow()
    // Positive control: the bounded authored binary really invokes its dylib.
    expect(Bun.spawnSync([executable], { env: {}, cwd: root, timeout: 5000 }).exitCode).toBe(0)
    await access(marker)
  }, 45_000)
})

if (process.platform !== 'darwin') throw Error('This suite requires a native Mac')
