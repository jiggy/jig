import { mkdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** @internal Not exported from the package. */
export interface ProjectInitFileSystem {
  readonly mkdir: typeof mkdir
  readonly rmdir: typeof rmdir
  readonly unlink: typeof unlink
  readonly writeFile: typeof writeFile
}

const DEFAULT_FILE_SYSTEM: ProjectInitFileSystem = {
  mkdir,
  rmdir,
  unlink,
  writeFile,
}

export type ProjectInitErrorCode =
  | 'JIG_INIT_CLEANUP_FAILED'
  | 'JIG_INIT_DESTINATION_EXISTS'
  | 'JIG_INIT_UNAVAILABLE'

export class ProjectInitError extends Error {
  readonly code: ProjectInitErrorCode
  readonly kind: 'invalid' | 'unavailable'

  constructor(kind: 'invalid' | 'unavailable', code: ProjectInitErrorCode, message: string) {
    super(message)
    this.name = 'ProjectInitError'
    this.kind = kind
    this.code = code
  }
}

/** @internal Exported only for focused fault-injection tests; not a package export. */
export async function createProject(
  destination: string,
  fileSystem: ProjectInitFileSystem = DEFAULT_FILE_SYSTEM,
  bare = false,
): Promise<void> {
  const target = resolve(destination)
  const created: Array<{ readonly kind: 'directory' | 'file'; readonly path: string }> = []
  try {
    try {
      await fileSystem.mkdir(target)
    } catch (error) {
      if (errorCode(error) === 'EEXIST') {
        throw new ProjectInitError(
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

    if (!bare) {
      const path = join(target, 'flows', 'hello')
      await fileSystem.mkdir(path)
      created.push({ kind: 'directory', path })
    }
    const files: readonly (readonly [string, string])[] = [
      ['.gitignore', '.jig/\n'],
      ['jig.ts', renderJigModule()],
      ...(!bare ? greetingFiles() : []),
    ]
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
      throw new ProjectInitError(
        'unavailable',
        'JIG_INIT_CLEANUP_FAILED',
        'initialization failed and its created files could not be removed',
      )
    }
    if (error instanceof ProjectInitError) throw error
    throw new ProjectInitError(
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

function greetingFiles(): readonly (readonly [string, string])[] {
  return [
    [
      'flows/hello/FLOW.md',
      '---\nname: hello\ndescription: Return a greeting for the supplied name.\n---\n\n# Hello\n\nAn editable first Flow. It needs no Agent or file access.\n',
    ],
    [
      'flows/hello/package.json',
      `${JSON.stringify({ private: true, dependencies: { '@jigging/flow': 'alpha' } }, null, 2)}\n`,
    ],
    [
      'flows/hello/flow.ts',
      [
        'import { handle } from "@jigging/flow";',
        '',
        'await handle(async (run) => {',
        '  const input = run.input;',
        '  const name = typeof input === "object" && input !== null &&',
        '      !Array.isArray(input) && typeof input.name === "string"',
        '    ? input.name : "world";',
        '  return { outcome: "done", output: { message: `Hello, ${name}!` } };',
        '});',
        '',
      ].join('\n'),
    ],
    [
      'README.md',
      [
        '# Your Jig project',
        '',
        'From this directory:',
        '',
        '```sh',
        'jig review --allow-resolution-network',
        'jig run flow:flows/hello --input \'{"name":"Ada"}\'',
        '```',
        '',
        'Review prepares dependencies privately, shows changes, and asks for approval.',
        'The resolution flag permits dependency-selected network requests before approval;',
        'declining cannot undo those requests. It does not grant network access to Runs.',
        'Initialization itself makes no network requests and approves nothing.',
        '',
        'Edit `flows/hello/flow.ts`, repeat `jig review --allow-resolution-network`,',
        'then run the accepted revision. Code edits can require fresh dependency',
        'resolution until you add an authored lock; unchanged reviews reuse admitted bytes.',
        'This ordinary package uses the published SDK alpha tag. Resolution retains exact',
        'versions privately; add an authored Bun lock when sharing reproducible dependencies.',
        'You do not need a separate Bun install to run this project.',
        '',
        'Help: `jig review --help`, `jig run --help`, https://jig.md/guide/',
        '',
      ].join('\n'),
    ],
  ]
}
