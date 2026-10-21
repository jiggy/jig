import { type BigIntStats, constants } from 'node:fs'
import { type FileHandle, open } from 'node:fs/promises'
import { posix } from 'node:path'
import { privateFilePath } from './file-input-policy.js'
import {
  privateMacosDirectory,
  privateMacosMkdirAt,
  privateMacosOpenAt,
} from './macos-descriptor-files.js'

/** Candidate, reviewed inputs, prepared dependencies and immutable prior outputs.
 * Writable-volume capacity remains independently fixed at 512 MiB. */
export const PRIVATE_MACOS_EVALUATION_WORKSPACE_LIMITS = Object.freeze({
  files: 8448,
  bytes: 192 * 1024 * 1024,
})

export interface PrivateMacosEvaluationWorkspace {
  readonly phase: 'generate' | 'compile' | 'test'
  readonly source: string
  readonly emptyDirectories: readonly string[]
}
export interface PrivateMacosEvaluationGrant {
  readonly phase: PrivateMacosEvaluationWorkspace['phase']
  readonly root: string
}
export function normalizePrivateMacosEvaluationWorkspace(
  value: unknown,
): PrivateMacosEvaluationWorkspace {
  const item = value as PrivateMacosEvaluationWorkspace
  if (
    item === null ||
    typeof item !== 'object' ||
    Object.keys(item).sort().join() !== 'emptyDirectories,phase,source' ||
    !['generate', 'compile', 'test'].includes(item.phase) ||
    typeof item.source !== 'string' ||
    !item.source.startsWith('/') ||
    item.source === '/' ||
    posix.normalize(item.source) !== item.source ||
    item.source.includes('\0')
  )
    throw new TypeError('invalid macOS evaluation workspace')
  if (!Array.isArray(item.emptyDirectories) || item.emptyDirectories.length > 256)
    throw new TypeError('invalid macOS evaluation empty directories')
  const names = new Set<string>()
  for (const value of item.emptyDirectories) {
    const name = privateFilePath(value)
    const root = name.split('/')[0]!
    if (
      root === 'scratch' ||
      privateMacosEvaluationWritableRoots(item.phase).includes(root) ||
      (item.phase === 'generate' && root === 'dist') ||
      names.has(name)
    )
      throw new TypeError('invalid macOS evaluation empty directory root')
    names.add(name)
  }
  const entries = new Set<string>()
  for (const name of names) {
    const parts = name.split('/')
    for (let count = 1; count <= parts.length; count++) entries.add(parts.slice(0, count).join('/'))
  }
  if (entries.size > 256) throw new TypeError('macOS evaluation directories exceed entry bound')
  return Object.freeze({
    phase: item.phase,
    source: item.source,
    emptyDirectories: Object.freeze([...names].sort()),
  })
}
export function privateMacosEvaluationWritableRoots(
  phase: PrivateMacosEvaluationWorkspace['phase'],
): readonly string[] {
  if (!['generate', 'compile', 'test'].includes(phase))
    throw new TypeError('invalid macOS evaluation phase')
  return phase === 'generate'
    ? ['generated', 'reports']
    : phase === 'compile'
      ? ['dist']
      : ['reports']
}
export function requirePrivateMacosEvaluationEnvironment(
  environment: Readonly<Record<string, string>>,
  mountPath: string,
): void {
  if (
    Object.entries(environment).some(([name, value]) =>
      name === 'TMPDIR'
        ? value !== posix.join(mountPath, 'tmp')
        : name === 'BUN_RUNTIME_TRANSPILER_CACHE_PATH'
          ? value !== '0'
          : name === 'BUN_CONFIG_NO_CLEAR_TERMINAL'
            ? value !== '1'
            : true,
    )
  )
    throw new TypeError('invalid macOS evaluation environment')
}
const DIRECTORY = constants.O_RDONLY | constants.O_DIRECTORY | 0x20000000 | 0x01000000
const same = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs &&
  a.mode === b.mode &&
  a.nlink === b.nlink

/** Every lookup descends from a held no-link descriptor. No installer aliases,
 * ambient links, install commands or candidate-supplied current outputs. */
export async function projectPrivateMacosEvaluationWorkspace(
  volume: FileHandle,
  workspace: PrivateMacosEvaluationWorkspace,
  signal: AbortSignal,
): Promise<void> {
  const spec = normalizePrivateMacosEvaluationWorkspace(workspace)
  const source = await open(spec.source, DIRECTORY)
  try {
    privateMacosMkdirAt(volume.fd, 'evaluation', 0o700)
    const target = await privateMacosOpenAt(volume.fd, 'evaluation', DIRECTORY)
    try {
      const budget = { files: 0, bytes: 0, entries: 0 }
      await copyTree(
        source,
        target,
        signal,
        true,
        new Set([
          'scratch',
          ...privateMacosEvaluationWritableRoots(spec.phase),
          ...(spec.phase === 'generate' ? ['dist'] : []),
        ]),
        budget,
      )
      for (const path of spec.emptyDirectories)
        await projectEmptyDirectory(target, path.split('/'), signal, budget)
      await target.chmod(0o700)
      for (const name of ['generated', 'dist', 'reports', 'scratch']) {
        let child: FileHandle
        try {
          child = await privateMacosOpenAt(target.fd, name, DIRECTORY)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          privateMacosMkdirAt(target.fd, name, 0o700)
          child = await privateMacosOpenAt(target.fd, name, DIRECTORY)
        }
        try {
          await child.chmod(
            name === 'scratch' || privateMacosEvaluationWritableRoots(spec.phase).includes(name)
              ? 0o700
              : 0o555,
          )
        } finally {
          await child.close()
        }
      }
      await target.chmod(0o555)
    } finally {
      await target.close()
    }
  } finally {
    await source.close()
  }
}

/** Trusted setup only: temporarily unfreeze held target ancestors to restore
 * snapshot directory metadata, then freeze them before any payload exists. */
async function projectEmptyDirectory(
  parent: FileHandle,
  parts: readonly string[],
  signal: AbortSignal,
  budget: { entries: number },
): Promise<void> {
  signal.throwIfAborted()
  const name = parts[0]
  if (name === undefined) return
  let child: FileHandle | undefined
  await parent.chmod(0o700)
  try {
    try {
      child = await privateMacosOpenAt(parent.fd, name, DIRECTORY)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (++budget.entries > 32768) throw new Error('macOS evaluation tree exceeds entry bound')
      privateMacosMkdirAt(parent.fd, name, 0o700)
      child = await privateMacosOpenAt(parent.fd, name, DIRECTORY)
    }
    await projectEmptyDirectory(child, parts.slice(1), signal, budget)
    await child.chmod(0o555)
  } finally {
    await child?.close()
    await parent.chmod(0o555)
  }
}

/** Called only after whole-scope fencing. The existing output owner receives
 * root-prefixed files, never workspace inputs or scratch. */
export async function collectPrivateMacosEvaluationWorkspace(
  mountPath: string,
  collector: FileHandle,
  phase: PrivateMacosEvaluationWorkspace['phase'],
  signal: AbortSignal,
): Promise<void> {
  const volume = await open(mountPath, DIRECTORY)
  const budget = { files: 0, bytes: 0, entries: 0 }
  try {
    const evaluation = await privateMacosOpenAt(volume.fd, 'evaluation', DIRECTORY)
    try {
      for (const name of privateMacosEvaluationWritableRoots(phase)) {
        const source = await privateMacosOpenAt(evaluation.fd, name, DIRECTORY)
        try {
          privateMacosMkdirAt(collector.fd, name, 0o700)
          const target = await privateMacosOpenAt(collector.fd, name, DIRECTORY)
          try {
            await copyTree(source, target, signal, false, new Set(), budget)
          } finally {
            await target.close()
          }
        } finally {
          await source.close()
        }
      }
    } finally {
      await evaluation.close()
    }
  } finally {
    await volume.close()
  }
}

async function copyTree(
  source: FileHandle,
  target: FileHandle,
  signal: AbortSignal,
  immutable: boolean,
  forbidden = new Set<string>(),
  budget = { files: 0, bytes: 0, entries: 0 },
): Promise<void> {
  const chunk = Buffer.alloc(64 * 1024)
  const end = performance.now() + 20_000
  const check = () => {
    signal.throwIfAborted()
    if (performance.now() >= end) throw new Error('macOS evaluation copy expired')
  }
  const visit = async (from: FileHandle, to: FileHandle, depth: number) => {
    check()
    const before = await from.stat({ bigint: true })
    if (!before.isDirectory() || (immutable && (before.mode & 0o222n) !== 0n) || depth > 64)
      throw new Error('macOS evaluation source is not immutable regular material')
    const reader = privateMacosDirectory(from.fd)
    try {
      for (;;) {
        check()
        const entry = reader.readSync()
        if (entry === null) break
        const name = new TextDecoder('utf-8', { fatal: true }).decode(entry.name)
        if (++budget.entries > 32768 || (depth === 0 && forbidden.has(name)))
          throw new Error('macOS evaluation source contains forbidden output or exceeds bounds')
        if (!entry.isDirectory() && !entry.isFile())
          throw new Error('macOS evaluation source contains a non-regular entry')
        const input = await privateMacosOpenAt(
          from.fd,
          name,
          entry.isDirectory() ? DIRECTORY : constants.O_RDONLY | constants.O_NONBLOCK,
        )
        try {
          const identity = await input.stat({ bigint: true })
          if (entry.isDirectory()) {
            privateMacosMkdirAt(to.fd, name, 0o700)
            const output = await privateMacosOpenAt(to.fd, name, DIRECTORY)
            try {
              await visit(input, output, depth + 1)
              await output.chmod(0o555)
            } finally {
              await output.close()
            }
          } else {
            if (
              !identity.isFile() ||
              identity.nlink !== 1n ||
              (immutable && (identity.mode & 0o222n) !== 0n) ||
              ++budget.files > PRIVATE_MACOS_EVALUATION_WORKSPACE_LIMITS.files ||
              identity.size < 0n ||
              identity.size >
                BigInt(
                  (immutable ? PRIVATE_MACOS_EVALUATION_WORKSPACE_LIMITS.bytes : 16 * 1024 * 1024) -
                    budget.bytes,
                )
            )
              throw new Error('macOS evaluation file exceeds its regular immutable profile')
            budget.bytes += Number(identity.size)
            const output = await privateMacosOpenAt(
              to.fd,
              name,
              constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
              0o600,
            )
            try {
              for (let offset = 0; offset < Number(identity.size); ) {
                check()
                const read = await input.read(
                  chunk,
                  0,
                  Math.min(chunk.length, Number(identity.size) - offset),
                  offset,
                )
                if (read.bytesRead === 0) throw new Error('macOS evaluation source ended early')
                for (let written = 0; written < read.bytesRead; ) {
                  const result = await output.write(
                    chunk,
                    written,
                    read.bytesRead - written,
                    offset + written,
                  )
                  if (result.bytesWritten === 0)
                    throw new Error('macOS evaluation copy ended early')
                  written += result.bytesWritten
                }
                offset += read.bytesRead
              }
              if (!same(identity, await input.stat({ bigint: true })))
                throw new Error('macOS evaluation source changed')
              await output.chmod((identity.mode & 0o111n) !== 0n ? 0o555 : 0o444)
            } finally {
              await output.close()
            }
          }
        } finally {
          await input.close()
        }
      }
      if (!same(before, await from.stat({ bigint: true })))
        throw new Error('macOS evaluation source directory changed')
    } finally {
      reader.closeSync()
    }
  }
  try {
    await visit(source, target, 0)
  } finally {
    chunk.fill(0)
  }
}
