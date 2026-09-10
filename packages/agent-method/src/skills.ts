import { constants } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AgentMethodError } from './errors.js'
import type { SkillText } from './index.js'
import { compareUtf8, localName, snapshot } from './values.js'

/** Read explicit selections from an immutable package root, never from the CWD. */
export async function readPackageSkills(
  packageRoot: URL,
  names: readonly string[],
): Promise<readonly SkillText[]> {
  const selection = snapshot(names, 'INVALID_INPUT')
  if (
    !Array.isArray(selection) ||
    selection.some((name) => !localName(name)) ||
    new Set(selection).size !== selection.length
  )
    invalid('Select unique Skill LocalNames')
  if (selection.length > 64) exhausted('Skill selection exceeds 64 groups')
  if (
    !(packageRoot instanceof URL) ||
    packageRoot.protocol !== 'file:' ||
    packageRoot.search !== '' ||
    packageRoot.hash !== '' ||
    !packageRoot.pathname.endsWith('/')
  ) {
    invalid('Supply an absolute file URL for the package directory')
  }
  let root: string
  try {
    root = fileURLToPath(packageRoot)
    await assertRealDirectory(root)
  } catch {
    invalid('Package root must be a real directory without symlink components')
  }
  if (selection.length === 0) return Object.freeze([])
  let fileCount = 0
  let contentBytes = 0
  let entries = 0
  const skills: SkillText[] = []
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  try {
    for (const name of [...selection].sort((a, b) =>
      compareUtf8(a as string, b as string),
    ) as string[]) {
      const directory = join(root!, 'skills', name)
      await assertRealDirectory(directory)
      const files: { path: string; text: string }[] = []
      const visit = async (current: string): Promise<void> => {
        const reader = await opendir(current)
        for await (const entry of reader) {
          entries += 1
          if (entries > 4096) exhausted('Skill traversal exceeds 4,096 entries')
          const path = join(current, entry.name)
          if (Buffer.byteLength(relative(directory, path)) > 4096)
            exhausted('Skill path exceeds 4,096 bytes')
          const info = await lstat(path)
          if (info.isSymbolicLink()) invalid('Skill trees must not contain symlinks')
          if (info.isDirectory()) {
            await assertRealDirectory(path)
            await visit(path)
          } else if (info.isFile()) {
            fileCount += 1
            contentBytes += info.size
            if (fileCount > 1024 || contentBytes > 1_048_576)
              exhausted('Selected Skills exceed 1,024 files or 1 MiB content')
            if ((await realpath(path)) !== path) invalid('Skill file path contains a symlink')
            const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
            try {
              const opened = await handle.stat()
              if (
                !opened.isFile() ||
                opened.dev !== info.dev ||
                opened.ino !== info.ino ||
                opened.size !== info.size
              ) {
                invalid('Skill file changed during reading')
              }
              const bytes = new Uint8Array(info.size + 1)
              let length = 0
              while (length < bytes.length) {
                const chunk = await handle.read(bytes, length, bytes.length - length, length)
                if (chunk.bytesRead === 0) break
                length += chunk.bytesRead
              }
              if (length !== info.size || (await realpath(path)) !== path)
                invalid('Skill file changed during reading')
              files.push(
                Object.freeze({
                  path: relative(directory, path).split('\\').join('/'),
                  text: decoder.decode(bytes.subarray(0, length)),
                }),
              )
            } finally {
              await handle.close()
            }
          } else {
            invalid('Skill trees may contain only directories and regular files')
          }
        }
      }
      await visit(directory)
      if (!files.some((file) => file.path === 'SKILL.md'))
        invalid('Selected Skill requires SKILL.md')
      files.sort((a, b) => compareUtf8(a.path, b.path))
      skills.push(Object.freeze({ name, files: Object.freeze(files) }))
    }
  } catch (error) {
    if (error instanceof AgentMethodError) throw error
    invalid('Selected Skill is unavailable or is not valid UTF-8 text')
  }
  return Object.freeze(skills)
}

async function assertRealDirectory(path: string): Promise<void> {
  const absolute = resolve(path)
  if (!isAbsolute(path)) invalid('Package path must be absolute')
  let cursor = parse(absolute).root
  for (const part of relative(cursor, absolute).split('/').filter(Boolean)) {
    cursor = join(cursor, part)
    const info = await lstat(cursor)
    if (!info.isDirectory() || info.isSymbolicLink())
      invalid('Package directory path contains a symlink or non-directory')
  }
  if ((await realpath(absolute)) !== absolute || dirname(absolute) === absolute)
    invalid('Select a package directory')
}

function invalid(message: string): never {
  throw new AgentMethodError('INVALID_INPUT', message)
}

function exhausted(message: string): never {
  throw new AgentMethodError('RESOURCE_EXHAUSTED', message)
}
