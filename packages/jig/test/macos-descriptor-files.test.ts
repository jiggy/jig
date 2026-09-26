import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  privateMacosDescriptorPath,
  privateMacosDirectory,
  privateMacosDuplicate,
  privateMacosMkdirAt,
  privateMacosOpenAt,
  privateMacosReadlinkAt,
  privateMacosRenameAt,
  privateMacosStatAt,
  privateMacosSymlinkAt,
  privateMacosUnlinkAt,
} from '../src/internal/macos-descriptor-files.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)

native(
  'native descriptor operations stay with the opened directory after rename and reject replacement links',
  async () => {
    const root = await mkdtemp('/private/tmp/jig-descriptor-')
    const path = join(root, 'source'),
      moved = join(root, 'moved'),
      unrelated = join(root, 'unrelated')
    await mkdir(path)
    await mkdir(unrelated)
    await writeFile(join(path, 'é.txt'), 'owned original')
    await writeFile(join(unrelated, 'é.txt'), 'replacement canary')
    const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY)
    try {
      const abi = join(root, 'abi')
      const compiled = spawnSync(
        '/usr/bin/clang',
        [
          '-O2',
          '-Wall',
          '-Wextra',
          '-Werror',
          fileURLToPath(new URL('./fixtures/macos-file-abi.c', import.meta.url)),
          '-o',
          abi,
        ],
        { encoding: 'utf8', timeout: 15_000 },
      )
      expect({ code: compiled.status, err: compiled.stderr }).toEqual({ code: 0, err: '' })
      const executed = spawnSync(abi, [], { encoding: 'utf8', timeout: 10_000 })
      expect({
        status: executed.status,
        signal: executed.signal,
        error: executed.error,
        stderr: executed.stderr,
      }).toEqual({ status: 0, signal: null, error: undefined, stderr: '' })
      expect(executed.stdout).toBe('{"statBytes":144,"directoryNameOffset":21}\n')
      const actual = await lstat(join(path, 'é.txt'), { bigint: true })
      const anchored = privateMacosStatAt(directory.fd, 'é.txt')
      for (const key of [
        'dev',
        'ino',
        'mode',
        'nlink',
        'uid',
        'gid',
        'rdev',
        'size',
        'blocks',
        'blksize',
        'atimeNs',
        'mtimeNs',
        'ctimeNs',
        'birthtimeNs',
      ] as const)
        expect(anchored[key]).toBe(actual[key])
      expect(anchored.isFile()).toBe(true)
      await rename(path, moved)
      await symlink(unrelated, path)
      expect(privateMacosDescriptorPath(directory.fd)).toBe(moved)
      const copy = await privateMacosDuplicate(directory.fd)
      await directory.close()
      try {
        expect((await copy.stat()).isDirectory()).toBe(true)
        const file = await privateMacosOpenAt(
          copy.fd,
          'é.txt',
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        )
        try {
          expect(await file.readFile('utf8')).toBe('owned original')
        } finally {
          await file.close()
        }
        privateMacosSymlinkAt(copy.fd, 'link', join(unrelated, 'é.txt'))
        expect(privateMacosStatAt(copy.fd, 'link').isSymbolicLink()).toBe(true)
        expect(privateMacosReadlinkAt(copy.fd, 'link').toString()).toBe(join(unrelated, 'é.txt'))
        await expect(privateMacosOpenAt(copy.fd, 'link', constants.O_RDONLY)).rejects.toMatchObject(
          { code: 'ELOOP' },
        )
        await expect(
          privateMacosOpenAt(copy.fd, '../unrelated/é.txt', constants.O_RDONLY),
        ).rejects.toThrow('leaf name')
        const entries: string[] = []
        for await (const entry of privateMacosDirectory(copy.fd))
          entries.push(entry.name.toString())
        expect(entries.sort()).toEqual(['link', 'é.txt'])
        const repeated: string[] = []
        for await (const entry of privateMacosDirectory(copy.fd))
          repeated.push(entry.name.toString())
        expect(repeated.sort()).toEqual(entries)
        privateMacosMkdirAt(copy.fd, 'new', 0o700)
        privateMacosMkdirAt(copy.fd, 'existing', 0o700)
        expect(() => privateMacosRenameAt(copy.fd, 'new', copy.fd, 'existing', true)).toThrow()
        privateMacosRenameAt(copy.fd, 'new', copy.fd, 'published', true)
        expect(privateMacosStatAt(copy.fd, 'published').isDirectory()).toBe(true)
        privateMacosUnlinkAt(copy.fd, 'published', true)
        privateMacosUnlinkAt(copy.fd, 'existing', true)
        privateMacosUnlinkAt(copy.fd, 'link')
        expect(await readFile(join(unrelated, 'é.txt'), 'utf8')).toBe('replacement canary')
        expect(await readFile(join(moved, 'é.txt'), 'utf8')).toBe('owned original')
      } finally {
        await copy.close()
      }
    } finally {
      await directory.close()
      await rm(root, { recursive: true, force: true })
    }
  },
  30_000,
)
