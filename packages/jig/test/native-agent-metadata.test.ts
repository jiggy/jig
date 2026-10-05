import { expect, test } from 'bun:test'
import { lstat, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPrivateNativeAgentElfMetadata } from '../src/internal/native-agent-runtime.js'
import { nativeElf } from './fixtures/native-elf.js'

const metadataReaders = [
  ['Mach-O', 'macos-agent-runtime.ts', 'readPrivateMacosAgentMetadata'],
  ['ELF', 'native-agent-runtime.ts', 'readPrivateNativeAgentElfMetadata'],
] as const

test('reads inert ELF installation metadata without executing it', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-native-metadata-')))
  try {
    const file = join(root, 'client')
    await writeFile(
      file,
      nativeElf({
        needed: ['libexample.so'],
        search: '$ORIGIN/lib',
        interpreter: '/lib/ld-linux-x86-64.so.2',
      }),
    )
    expect(await readPrivateNativeAgentElfMetadata(file)).toMatchObject({
      interpreter: '/lib/ld-linux-x86-64.so.2',
      needed: ['libexample.so'],
      search: ['$ORIGIN/lib'],
      runpath: true,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

const posix = test.skipIf(!['linux', 'darwin'].includes(process.platform))
posix.each(metadataReaders)(
  '%s metadata refuses an unread named pipe without waiting for a writer',
  async (_format, filename, reader) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-native-metadata-')))
    let child: ReturnType<typeof Bun.spawn> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let output: readonly Promise<string>[] = []
    try {
      const executable = join(root, 'client')
      const fifo = Bun.spawnSync(['/usr/bin/mkfifo', '-m', '600', executable])
      expect(fifo.exitCode).toBe(0)
      const module = new URL(`../src/internal/${filename}`, import.meta.url).href
      const owned = Bun.spawn(
        [
          process.execPath,
          '--eval',
          `import { ${reader} as read } from ${JSON.stringify(module)};
try { await read(Bun.argv.at(-1)); process.exitCode = 2; }
catch (error) { console.log(error instanceof Error ? error.message : 'unknown refusal'); }`,
          executable,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      )
      child = owned
      const stdout = new Response(owned.stdout).text()
      const stderr = new Response(owned.stderr).text()
      output = [stdout, stderr]
      const result = await Promise.race([
        owned.exited,
        new Promise<'deadline'>((resolve) => {
          timer = setTimeout(() => resolve('deadline'), 5_000)
        }),
      ])
      expect(result).not.toBe('deadline')
      expect(result).toBe(0)
      expect(await stdout).toBe('native Agent runtime is not a regular file\n')
      expect(await stderr).toBe('')
      expect((await lstat(executable)).isFIFO()).toBe(true)
    } finally {
      clearTimeout(timer)
      if (child?.exitCode === null) child.kill('SIGKILL')
      await child?.exited
      await Promise.all(output)
      await rm(root, { recursive: true, force: true })
    }
  },
  15_000,
)
