import { lstat, mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

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

// Pair the generated source with its tested SDK, not a moving registry tag.
const GREETING_SDK_VERSION = '0.1.0-alpha.11'
const AGENT_ACP_VERSION = '0.1.0-alpha.1'
export type ProjectInitAgent = 'codex' | 'claude' | 'pi'

export type ProjectInitErrorCode =
  | 'JIG_NEW_INVALID'
  | 'JIG_NEW_EXISTS'
  | 'JIG_NEW_UNAVAILABLE'
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

/** Authoring only: no evaluation of jig.ts, dependency installation or approval. */
export async function createFlow(project: string, name: string): Promise<string> {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length > 64)
    throw new ProjectInitError(
      'invalid',
      'JIG_NEW_INVALID',
      'Use a name of at most 64 lowercase letters, digits and single hyphens, starting with a letter.',
    )
  let sdk = GREETING_SDK_VERSION
  try {
    const definition = await lstat(join(project, 'jig.ts'))
    if (!definition.isFile() || definition.isSymbolicLink())
      throw new Error('not a regular project definition')
    try {
      const path = join(project, 'package.json')
      const info = await lstat(path)
      if (!info.isFile() || info.size > 262_144) throw new Error('unsafe manifest')
      const manifest = JSON.parse(await readFile(path, 'utf8'))
      const declared =
        manifest.dependencies?.['@jigging/flow'] ?? manifest.devDependencies?.['@jigging/flow']
      if (declared !== undefined) {
        if (typeof declared !== 'string' || declared.length === 0 || declared.length > 2048)
          throw new Error('invalid SDK dependency')
        sdk = declared
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
    }
  } catch {
    throw new ProjectInitError(
      'invalid',
      'JIG_NEW_INVALID',
      'Run jig new from a project with a regular jig.ts and a readable, valid package.json if present. No source was evaluated.',
    )
  }
  const flows = join(project, 'flows')
  const destination = join(flows, name)
  const created: string[] = []
  let createdFlows = false,
    createdDestination = false
  try {
    try {
      await mkdir(flows)
      createdFlows = true
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      if (!(await lstat(flows)).isDirectory())
        throw new Error('flows must be a directory, not a link')
    }
    try {
      await mkdir(destination)
      createdDestination = true
    } catch (error) {
      if (errorCode(error) === 'EEXIST')
        throw new ProjectInitError(
          'invalid',
          'JIG_NEW_EXISTS',
          'That Flow directory already exists. Choose a different name; existing files were not changed.',
        )
      throw error
    }
    const projectName = basename(resolve(project))
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 64)
    const files: Record<string, string> = {
      'flow.meta.json': `${JSON.stringify({ name, description: 'Describe what this method does.' }, null, 2)}\n`,
      'package.json': `${JSON.stringify({ name: `${projectName || 'jig'}-${name}-flow`, private: true, type: 'module', dependencies: { '@jigging/flow': sdk } }, null, 2)}\n`,
      'FLOW.ts':
        'import { handle } from "@jigging/flow";\n\nawait handle(async (run) => {\n  return { outcome: "done", output: run.input };\n});\n',
    }
    for (const [file, content] of Object.entries(files)) {
      const path = join(destination, file)
      await writeFile(path, content, { flag: 'wx' })
      created.push(path)
    }
    return `flows/${name}`
  } catch (error) {
    try {
      for (const path of created.reverse()) await unlink(path)
      if (createdDestination) await rmdir(destination)
      if (createdFlows) await rmdir(flows)
    } catch {
      throw new ProjectInitError(
        'unavailable',
        'JIG_INIT_CLEANUP_FAILED',
        'Flow creation failed and its created files could not all be removed. Inspect flows before retrying.',
      )
    }
    if (error instanceof ProjectInitError) throw error
    throw new ProjectInitError(
      'unavailable',
      'JIG_NEW_UNAVAILABLE',
      'The Flow could not be created. Check that flows is a writable directory without a symbolic link.',
    )
  }
}

/** @internal Exported only for focused fault-injection tests; not a package export. */
export async function createProject(
  destination: string,
  fileSystem: ProjectInitFileSystem = DEFAULT_FILE_SYSTEM,
  bare = false,
  agent?: ProjectInitAgent,
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
      ['jig.ts', renderJigModule(agent)],
      ...(!bare
        ? greetingFiles().filter(([path]) => agent === undefined || path !== 'README.md')
        : []),
      ...(agent === undefined ? [] : agentFiles(agent)),
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

function renderJigModule(agent?: ProjectInitAgent): string {
  return [
    'import { defineJig, discover } from "@jigging/jig";',
    '',
    'export default defineJig({',
    '  flows: discover("./flows"),',
    '  bindings: discover("./bindings"),',
    ...(agent === undefined
      ? []
      : ['  defaultProviders: { "https://jig.md/contracts/agent-run": "binding:agent" },']),
    '});',
    '',
  ].join('\n')
}

function agentFiles(client: ProjectInitAgent): readonly (readonly [string, string])[] {
  return [
    [
      'package.json',
      `${JSON.stringify({ private: true, dependencies: { '@jigging/agent-acp': AGENT_ACP_VERSION } }, null, 2)}\n`,
    ],
    [
      'bindings/agent.ts',
      [
        'import { defineBinding } from "@jigging/jig";',
        '',
        'export default defineBinding({',
        '  package: "npm:@jigging/agent-acp",',
        `  slots: { native: { kind: "acp", client: "${client}" } },`,
        '});',
        '',
      ].join('\n'),
    ],
    [
      'README.md',
      [
        '# Your Jig project',
        '',
        `The ordinary Agent Flow uses your selected ${client} client. Its dependency is`,
        'in `package.json`, its resource grant in `bindings/agent.ts`, and its project',
        'selection in `jig.ts`. Change these ordinary files to adapt the selection.',
        '',
        'Configure the native installation and operator authentication described in',
        'https://jig.md/guide/agents, then run:',
        '',
        '```sh',
        'jig review --allow-resolution-network',
        'jig run binding:agent --input \'{"instructions":"Explain one useful check."}\' --receive events',
        '```',
        '',
        'Review prepares the declared dependency, shows its requested authority and',
        'asks for approval. Resolution may contact dependency-selected network',
        'destinations before approval; declining cannot undo those requests.',
        'Keep an authored Bun lock when sharing reproducible dependencies.',
        '',
        'Initialization installs nothing, copies no credentials and approves no work.',
        'Local readiness does not establish remote model availability. The result',
        'and selected live updates are separate; cancellation does not undo remote work.',
        '',
      ].join('\n'),
    ],
  ]
}

function greetingFiles(): readonly (readonly [string, string])[] {
  return [
    [
      'flows/hello/flow.meta.json',
      '{"name":"hello","description":"Greet the supplied string, or world for other input values."}\n',
    ],
    [
      'flows/hello/package.json',
      `${JSON.stringify({ private: true, dependencies: { '@jigging/flow': GREETING_SDK_VERSION } }, null, 2)}\n`,
    ],
    [
      'flows/hello/FLOW.ts',
      [
        'import { handle } from "@jigging/flow";',
        '',
        'await handle(async (run) => {',
        '  const name = typeof run.input === "string" ? run.input : "world";',
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
        'jig run flow:flows/hello --input \'"Ada"\'',
        '```',
        '',
        'Review prepares dependencies privately, shows changes, and asks for approval.',
        'The resolution flag permits dependency-selected network requests before approval;',
        'declining cannot undo those requests. It does not grant network access to Runs.',
        'Initialization itself makes no network requests and approves nothing.',
        '',
        'Edit `flows/hello/FLOW.ts`, repeat `jig review --allow-resolution-network`,',
        'then run the accepted revision. Code edits can require fresh dependency',
        'resolution until you add an authored lock; unchanged reviews reuse admitted bytes.',
        'This ordinary package names the exact SDK revision tested with this Jig build.',
        'Resolution retains exact versions privately; add an authored Bun lock when',
        'sharing reproducible dependencies.',
        'You do not need a separate Bun install to run this project.',
        '',
        'Help: `jig review --help`, `jig run --help`, https://jig.md/guide/',
        '',
      ].join('\n'),
    ],
  ]
}
