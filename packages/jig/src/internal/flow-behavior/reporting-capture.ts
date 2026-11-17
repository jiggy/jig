import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CheckError } from '../../diagnostics.js'
import { captureOpenedPackageDirectory } from '../../package/capture.js'
import { isProtectedProjectPath } from '../../project/paths.js'
import { openPrivateProjectRoot } from '../../project/root.js'

const version = '0.1.0-alpha.6'
const profile = new Map([
  ['dist/index.js', 'e2da67791f615666185d5174705dd31ada69fe964656d8e167933daa3b0ab07c'],
  ['dist/publisher.js', '04cc22508d5c5abcff985f0bb6794f71eaba49ec7ab45030ac598d5aa8662d12'],
])

/** Match local installed Reporting bytes without loading the dependency. */
export async function captureReportingProfile(
  project: string,
  directory: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  for (let depth = 0; depth < 24; depth++, directory = dirname(directory)) {
    signal?.throwIfAborted()
    const selected = join(directory, 'node_modules', '@jigging', 'reporting')
    let path: string
    try {
      path = await realpath(selected)
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
        directory === project ||
        dirname(directory) === directory
      )
        return undefined
      continue
    }
    if (path.split('/').some(isProtectedProjectPath)) return undefined
    try {
      const root = await openPrivateProjectRoot(path)
      try {
        const captured = await captureOpenedPackageDirectory(
          'installed Reporting profile',
          root.handle,
          {
            includes: (file) => file === 'package.json' || file === 'dist' || profile.has(file),
            maximumFiles: profile.size + 1,
            maximumBytes: 128 * 1024,
          },
        )
        try {
          const manifest = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(
              await captured.read('package.json', 8192),
            ),
          )
          const entry = manifest?.exports?.['.']
          if (
            manifest?.name !== '@jigging/reporting' ||
            manifest.version !== version ||
            manifest.type !== 'module' ||
            entry?.import !== './dist/index.js' ||
            Object.keys(entry).some((condition) => condition !== 'types' && condition !== 'import')
          )
            return undefined
          for (const [file, hash] of profile)
            if (
              createHash('sha256')
                .update(await captured.read(file, 32 * 1024))
                .digest('hex') !== hash
            )
              return undefined
          await root.verify()
          return (await realpath(selected)) === path ? captured.digest : undefined
        } finally {
          await captured.dispose()
        }
      } finally {
        await root.dispose()
      }
    } catch (error) {
      // Reporting evidence is optional. Integrity, disposal and cancellation faults still propagate.
      if (
        error instanceof SyntaxError ||
        (error instanceof CheckError &&
          [
            'PACKAGE_CAPTURE_INVALID',
            'PACKAGE_FILE_MISSING',
            'PACKAGE_FILE_LIMIT',
            'PROJECT_ROOT_IO',
          ].includes(error.code))
      )
        return undefined
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  return undefined
}
