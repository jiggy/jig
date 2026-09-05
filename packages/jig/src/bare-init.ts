import { mkdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** @internal Not exported from the package. */
export interface BareInitFileSystem {
  readonly mkdir: typeof mkdir
  readonly rmdir: typeof rmdir
  readonly unlink: typeof unlink
  readonly writeFile: typeof writeFile
}

const DEFAULT_FILE_SYSTEM: BareInitFileSystem = {
  mkdir,
  rmdir,
  unlink,
  writeFile,
}

export type BareInitErrorCode =
  | 'JIG_INIT_CLEANUP_FAILED'
  | 'JIG_INIT_DESTINATION_EXISTS'
  | 'JIG_INIT_UNAVAILABLE'

export class BareInitError extends Error {
  readonly code: BareInitErrorCode
  readonly kind: 'invalid' | 'unavailable'

  constructor(kind: 'invalid' | 'unavailable', code: BareInitErrorCode, message: string) {
    super(message)
    this.name = 'BareInitError'
    this.kind = kind
    this.code = code
  }
}

export async function initializeBareProject(destination: string): Promise<void> {
  await createBareProject(destination)
}

/** @internal Exported only for focused fault-injection tests; not a package export. */
export async function createBareProject(
  destination: string,
  fileSystem: BareInitFileSystem = DEFAULT_FILE_SYSTEM,
): Promise<void> {
  const target = resolve(destination)
  const created: Array<{ readonly kind: 'directory' | 'file'; readonly path: string }> = []
  try {
    try {
      await fileSystem.mkdir(target)
    } catch (error) {
      if (errorCode(error) === 'EEXIST') {
        throw new BareInitError(
          'invalid',
          'JIG_INIT_DESTINATION_EXISTS',
          'the destination already exists',
        )
      }
      throw error
    }
    created.push({ kind: 'directory', path: target })

    for (const name of ['flows', 'bindings'] as const) {
      const path = join(target, name)
      await fileSystem.mkdir(path)
      created.push({ kind: 'directory', path })
    }

    const files = [
      ['.gitignore', '.jig/\n'],
      ['jig.ts', renderJigModule()],
    ] as const
    for (const [name, contents] of files) {
      const path = join(target, name)
      await fileSystem.writeFile(path, contents, {
        encoding: 'utf8',
        flag: 'wx',
      })
      created.push({ kind: 'file', path })
    }
  } catch (error) {
    let cleanupFailed = false
    for (const entry of created.reverse()) {
      try {
        if (entry.kind === 'file') await fileSystem.unlink(entry.path)
        else await fileSystem.rmdir(entry.path)
      } catch (cleanupError) {
        if (errorCode(cleanupError) !== 'ENOENT') cleanupFailed = true
      }
    }
    if (cleanupFailed) {
      throw new BareInitError(
        'unavailable',
        'JIG_INIT_CLEANUP_FAILED',
        'initialization failed and its created files could not be removed',
      )
    }
    if (error instanceof BareInitError) throw error
    throw new BareInitError(
      'unavailable',
      'JIG_INIT_UNAVAILABLE',
      'the destination cannot be initialized',
    )
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

function renderJigModule(): string {
  return [
    'import { defineJig, discover } from "@jigging/jig";',
    '',
    'export default defineJig({',
    '  flows: discover("./flows"),',
    '  bindings: discover("./bindings"),',
    '});',
    '',
  ].join('\n')
}
