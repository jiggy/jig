import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  writeSync,
} from 'node:fs'
import { privateFilePath } from './file-input-policy.js'
import {
  normalizePrivateProjectEvaluationWorkspace,
  type PrivateProjectEvaluationWorkspace,
  privateEvaluationWritableRoots,
} from './project-evaluation-workspace.js'

export const PRIVATE_LINUX_EVALUATION_BYTES = 192 * 1024 * 1024
export const PRIVATE_LINUX_EVALUATION_FILES = 8448

/** Outer lowering never exposes a writable aggregate or source aliases. */
export function privateLinuxEvaluationWorkspaceArguments(input: {
  readonly workspace: unknown
  readonly source: string
  readonly entries: readonly string[]
}): readonly string[] {
  if (normalizePrivateProjectEvaluationWorkspace(input.workspace) === undefined)
    throw new TypeError('missing evaluation workspace')
  if (
    !input.source.startsWith('/') ||
    input.source.includes('\0') ||
    input.entries.length > PRIVATE_LINUX_EVALUATION_FILES ||
    new Set(input.entries).size !== input.entries.length ||
    input.entries.some((entry) => {
      privateFilePath(entry)
      return entry.includes('/')
    })
  )
    throw new TypeError('invalid native evaluation workspace')
  return ['--size', String(256 * 1024 * 1024), '--tmpfs', '/work', '--remount-ro', '/run']
}

/** Trusted setup, after cgroup admission and before the payload gate. The
 * namespace's private tmpfs is charged to the existing phase memory owner. */
export function privateCopyLinuxEvaluationWorkspace(
  workspace: PrivateProjectEvaluationWorkspace,
  sourcePath = '/jig-evaluation',
  destinationPath = '/work',
): void {
  const spec = normalizePrivateProjectEvaluationWorkspace(workspace)!
  const directory = 0x10000 | 0x20000
  const chunk = Buffer.alloc(64 * 1024)
  const source = openSync(sourcePath, directory)
  let destination: number
  try {
    destination = openSync(destinationPath, directory)
  } catch (error) {
    chunk.fill(0)
    closeSync(source)
    throw error
  }
  const budget = { files: 0, bytes: 0, entries: 0 }
  const end = performance.now() + 20_000
  const check = () => {
    if (performance.now() >= end) throw new Error('Linux evaluation copy expired')
  }
  const at = (fd: number, name: string) => `/proc/self/fd/${fd}/${name}`
  const forbidden = new Set([
    'scratch',
    ...privateEvaluationWritableRoots(spec),
    ...(spec.phase === 'generate' ? ['dist'] : []),
  ])
  const visit = (from: number, to: number, depth: number) => {
    check()
    const before = fstatSync(from, { bigint: true })
    if (!before.isDirectory() || (before.mode & 0o222n) !== 0n || depth > 64)
      throw new Error('Linux evaluation source is not immutable regular material')
    for (const bytes of readdirSync(`/proc/self/fd/${from}`, { encoding: 'buffer' })) {
      check()
      const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      privateFilePath(name)
      if (++budget.entries > 32768 || (depth === 0 && forbidden.has(name)))
        throw new Error('Linux evaluation source exceeds closed scope')
      const input = openSync(at(from, name), 0x20000 | 0x800)
      try {
        const identity = fstatSync(input, { bigint: true })
        if (identity.dev !== before.dev || (identity.mode & 0o222n) !== 0n)
          throw new Error('Linux evaluation source crossed its immutable scope')
        if (identity.isDirectory()) {
          mkdirSync(at(to, name), { mode: 0o700 })
          const output = openSync(at(to, name), directory)
          try {
            visit(input, output, depth + 1)
          } finally {
            closeSync(output)
          }
        } else {
          if (
            !identity.isFile() ||
            identity.nlink !== 1n ||
            ++budget.files > PRIVATE_LINUX_EVALUATION_FILES ||
            identity.size < 0n ||
            identity.size > BigInt(PRIVATE_LINUX_EVALUATION_BYTES - budget.bytes)
          )
            throw new Error('Linux evaluation file exceeds closed bound')
          budget.bytes += Number(identity.size)
          const output = openSync(
            at(to, name),
            0x20000 | 0x1 | 0x40 | 0x80,
            (identity.mode & 0o111n) === 0n ? 0o444 : 0o555,
          )
          try {
            for (let offset = 0; offset < Number(identity.size); ) {
              check()
              const count = readSync(
                input,
                chunk,
                0,
                Math.min(chunk.length, Number(identity.size) - offset),
                offset,
              )
              if (count === 0) throw new Error('Linux evaluation source ended early')
              for (let written = 0; written < count; ) {
                const size = writeSync(output, chunk, written, count - written, offset + written)
                if (size === 0) throw new Error('Linux evaluation copy made no progress')
                written += size
              }
              offset += count
            }
          } finally {
            closeSync(output)
          }
        }
        const after = fstatSync(input, { bigint: true })
        if (
          identity.ino !== after.ino ||
          identity.size !== after.size ||
          identity.mtimeNs !== after.mtimeNs ||
          identity.ctimeNs !== after.ctimeNs
        )
          throw new Error('Linux evaluation source changed')
      } finally {
        closeSync(input)
      }
    }
    const after = fstatSync(from, { bigint: true })
    if (before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
      throw new Error('Linux evaluation directory changed')
  }
  try {
    visit(source, destination, 0)
    // Count implicit parents; authenticated metadata never becomes a sentinel
    // file or a mutation of retained source.
    const directories = new Set<string>()
    for (const path of spec.emptyDirectories) {
      privateFilePath(path)
      const parts = path.split('/')
      if (forbidden.has(parts[0]!)) throw new Error('Linux evaluation directory overlaps output')
      for (let count = 1; count <= parts.length; count++)
        directories.add(parts.slice(0, count).join('/'))
    }
    if (directories.size > 256) throw new Error('Linux evaluation directory metadata exceeds bound')
    for (const path of [...directories].sort()) {
      let parent = openSync(destinationPath, directory)
      try {
        for (const name of path.split('/')) {
          try {
            mkdirSync(at(parent, name), { mode: 0o700 })
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          }
          const child = openSync(at(parent, name), directory)
          closeSync(parent)
          parent = child
        }
      } finally {
        closeSync(parent)
      }
    }
    for (const root of ['generated', 'dist', 'reports', 'scratch']) {
      try {
        mkdirSync(at(destination, root), { mode: 0o700 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      const fd = openSync(at(destination, root), directory)
      closeSync(fd)
    }
  } finally {
    chunk.fill(0)
    try {
      closeSync(destination)
    } finally {
      closeSync(source)
    }
  }
}
