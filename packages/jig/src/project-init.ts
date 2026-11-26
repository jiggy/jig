import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { CheckError } from './diagnostics.js'
import { privateJigVersion } from './installation-version.js'
import { importContract } from './internal/contract-import.js'
import { openPrivateChild } from './internal/descriptor-files.js'
import { privatePublishDirectory } from './internal/file-input.js'
import { validateLogicalPath } from './package/paths.js'
import { doxFramework, doxLicense } from './project-dox.js'
import { kitchenShiftFiles } from './project-starter.js'

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
const GREETING_SDK_VERSION = '0.1.0-alpha.15'
const AGENT_ACP_VERSION = '0.1.0-alpha.16'
const AUTHORING_SKILLS_README = [
  '## Develop with an Agent',
  '',
  'Follow [AGENTS.md](./AGENTS.md) and the bundled [Jig skill](./.agents/skills/jig/SKILL.md).',
  'Use the FLOW skill for method design and contracts. See [installation and updates](https://jig.md/for-agents#install-authoring-skills).',
  'Refresh installed project skills with `npx skills update --project`.',
  '',
] as const
export type ProjectInitAgent = 'codex' | 'claude'
export type ProjectInitStarter = 'kitchen-shifts'

export type ProjectInitErrorCode =
  | 'JIG_NEW_INVALID'
  | 'JIG_NEW_EXISTS'
  | 'JIG_NEW_UNAVAILABLE'
  | 'JIG_INIT_CLEANUP_FAILED'
  | 'JIG_INIT_DESTINATION_EXISTS'
  | 'JIG_INIT_PATH_EXISTS'
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
export async function createFlow(
  project: string,
  name: string,
  uses: readonly { slot: string; source: string }[] = [],
  signal?: AbortSignal,
  standardContractDirectory?: string,
): Promise<string> {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?![\s\S])/.test(name) || name.length > 64)
    throw new ProjectInitError(
      'invalid',
      'JIG_NEW_INVALID',
      'Use a name of at most 64 lowercase letters, digits and single hyphens, starting with a letter.',
    )
  if (
    uses.length > 16 ||
    new Set(uses.map(({ slot }) => slot)).size !== uses.length ||
    uses.some(
      ({ slot, source }) =>
        !/^[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/.test(slot) ||
        slot.length > 64 ||
        source.length === 0 ||
        source.length > 2048 ||
        source.includes('\0'),
    )
  )
    throw new ProjectInitError(
      'invalid',
      'JIG_NEW_INVALID',
      'Supply at most 16 distinct --use slot=source declarations. Slots use up to 64 lowercase letters, digits and single hyphens. Sources select Jig standard agreements, local descriptors or installed npm packages.',
    )
  signal?.throwIfAborted()
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
  let staged: string | undefined
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
      if (uses.length === 0) {
        await mkdir(destination)
        createdDestination = true
      } else {
        // Keep incomplete source outside ordinary flows discovery. Only the complete
        // selected contract closures and authored files are published together.
        try {
          await lstat(destination)
          throw Object.assign(new Error('exists'), { code: 'EEXIST' })
        } catch (error) {
          if (errorCode(error) !== 'ENOENT') throw error
        }
        staged = await mkdtemp(join(project, '.jig-new-'))
      }
    } catch (error) {
      if (errorCode(error) === 'EEXIST')
        throw new ProjectInitError(
          'invalid',
          'JIG_NEW_EXISTS',
          'That Flow directory already exists. Choose a different name. Existing files were not changed.',
        )
      throw error
    }
    const projectName = basename(resolve(project))
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 64)
    const authoredAt = staged ?? destination
    const declarations: Record<string, { contract: string }> = Object.create(null)
    if (uses.length > 0) await mkdir(join(authoredAt, 'contracts'))
    for (const { slot, source } of uses) {
      const imported = await importContract(
        /^(npm:|jig:)/.test(source) ? source : resolve(project, source),
        join(authoredAt, 'contracts', slot),
        signal,
        standardContractDirectory,
      )
      if (imported.kind !== 'invocation')
        throw new CheckError(
          'invalid',
          'JIG_NEW_CONTRACT',
          'A used slot requires an invocation contract. Declare channel agreements under channels instead.',
          source,
        )
      declarations[slot] = { contract: `./contracts/${slot}/${basename(imported.descriptor)}` }
    }
    const files: Record<string, string> = {
      'AGENTS.md': flowAgentGuidance(name),
      'FLOW.meta.json': `${JSON.stringify({ name, description: 'Describe what this method does.', ...(uses.length === 0 ? {} : { uses: declarations }) }, null, 2)}\n`,
      'package.json': `${JSON.stringify({ name: `${projectName || 'jig'}-${name}-flow`, private: true, type: 'module', dependencies: { '@jigging/flow': sdk } }, null, 2)}\n`,
      'FLOW.ts':
        'import { handle } from "@jigging/flow";\n\nawait handle(async (run) => {\n  return { outcome: "done", output: run.input };\n});\n',
    }
    for (const [file, content] of Object.entries(files)) {
      signal?.throwIfAborted()
      const path = join(authoredAt, file)
      await writeFile(path, content, { flag: 'wx' })
      if (staged === undefined) created.push(path)
    }
    if (staged !== undefined) {
      const projectDirectory = await open(
        project,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      try {
        const flowsDirectory = await openPrivateChild(
          projectDirectory,
          'flows',
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        )
        try {
          signal?.throwIfAborted()
          privatePublishDirectory(flowsDirectory.fd, basename(staged), name, projectDirectory.fd)
          staged = undefined
        } finally {
          await flowsDirectory.close()
        }
      } finally {
        await projectDirectory.close()
      }
    }
    return `flows/${name}`
  } catch (error) {
    try {
      if (staged !== undefined) await rm(staged, { recursive: true, force: true })
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
    if (signal?.aborted || error instanceof ProjectInitError || error instanceof CheckError)
      throw error
    if (errorCode(error) === 'EEXIST')
      throw new ProjectInitError(
        'invalid',
        'JIG_NEW_EXISTS',
        'That Flow directory already exists. Choose a different name. Existing files were not changed.',
      )
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
  starter?: ProjectInitStarter,
  inPlace = false,
): Promise<boolean> {
  const target = resolve(destination)
  const created: Array<{ readonly kind: 'directory' | 'file'; readonly path: string }> = []
  try {
    if (inPlace) {
      if (!(await lstat(target)).isDirectory()) throw Error('Invalid project directory')
    } else {
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
    }

    const sourceFiles: readonly (readonly [string, string])[] = [
      ['jig.ts', renderJigModule(agent)],
      ...(!bare && agent === undefined
        ? ([['package.json', renderProjectManifest()]] as const)
        : []),
      ...(starter === 'kitchen-shifts'
        ? kitchenShiftFiles(GREETING_SDK_VERSION, flowAgentGuidance, AUTHORING_SKILLS_README)
        : !bare
          ? greetingFiles().filter(([path]) => agent === undefined || path !== 'README.md')
          : agent === undefined
            ? ([['README.md', bareReadme]] as const)
            : []),
      ...(agent === undefined ? [] : agentFiles(agent)),
    ]
    const hasTests = !bare
    const skills = await readAuthoringSkills()
    const flowSkillBundled = skills.some(([path]) => path === '.agents/skills/flow/SKILL.md')
    const files: readonly (readonly [string, string])[] = [
      ['.gitignore', '.jig/\n'],
      ['AGENTS.md', projectAgentGuidance(hasTests, flowSkillBundled)],
      ...(hasTests ? ([['tests/AGENTS.md', testAgentGuidance]] as const) : []),
      ['flows/AGENTS.md', flowsAgentGuidance(sourceFiles)],
      [
        'bindings/AGENTS.md',
        '# Bindings\n\nBindings select collaborators and settings for an application.\nUse `jig inspect --flow` to identify shared uses before changing a selection.\nCheck the changed caller and its preserved neighbors after approval.\n',
      ],
      ['.agents/DOX.LICENSE', doxLicense],
      ['skills-lock.json', authoringSkillsLock(flowSkillBundled)],
      ...skills,
      ...sourceFiles,
    ]
    if (inPlace) {
      const names = new Set(['.jig', 'jig.lock', ...files.map(([path]) => path.split('/')[0]!)])
      for (const name of names) {
        try {
          await lstat(join(target, name))
        } catch (error) {
          if (errorCode(error) === 'ENOENT') continue
          throw error
        }
        throw new ProjectInitError('invalid', 'JIG_INIT_PATH_EXISTS', `${name} already exists`)
      }
    }
    const directories = new Set(['flows', 'bindings'])
    for (const [name] of files) {
      const parts = name.split('/')
      for (let depth = 1; depth < parts.length; depth++)
        directories.add(parts.slice(0, depth).join('/'))
    }
    for (const name of directories) {
      const path = join(target, name)
      await fileSystem.mkdir(path)
      created.push({ kind: 'directory', path })
    }
    for (const [name, contents] of files) {
      const path = join(target, name)
      await fileSystem.writeFile(path, contents, {
        encoding: 'utf8',
        flag: 'wx',
      })
      created.push({ kind: 'file', path })
    }
    return flowSkillBundled
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
    if (errorCode(error) === 'EEXIST')
      throw new ProjectInitError(
        'invalid',
        'JIG_INIT_PATH_EXISTS',
        'a scaffold path already exists',
      )
    throw new ProjectInitError(
      'unavailable',
      'JIG_INIT_UNAVAILABLE',
      'the destination cannot be initialized',
    )
  }
}

const bareReadme = [
  '# Your Jig project',
  '',
  'Create a Flow and edit its method in `flows/first-flow/FLOW.ts`.',
  '',
  '```sh',
  'jig new first-flow',
  '```',
  '',
  'Check the project and review the source when you are ready to run it.',
  '',
  '```sh',
  'jig check',
  'jig review --allow-resolution-network',
  'jig run flow:flows/first-flow',
  '```',
  '',
  'Approve the exact revision at the review prompt. The flag permits dependency resolution before approval.',
  '',
  ...AUTHORING_SKILLS_README,
].join('\n')

function authoringSkillsLock(flowSkillBundled: boolean): string {
  const names = flowSkillBundled ? ['flow', 'jig'] : ['jig']
  const skills = Object.fromEntries(
    names.map((name) => [
      name,
      {
        source: `jiggy/${name}`,
        sourceType: 'github',
        sourceUrl: `https://github.com/jiggy/${name}.git`,
        skillPath: `skills/${name}/SKILL.md`,
        // The first skills update records its upstream commit and content hash.
        computedHash: '',
        installMode: 'copy',
      },
    ]),
  )
  return JSON.stringify({ version: 2, skills }, null, 2) + '\n'
}

async function readAuthoringSkills(): Promise<readonly (readonly [string, string])[]> {
  const bundle = JSON.parse(
    await readFile(new URL('../libexec/init-skills.json', import.meta.url), 'utf8'),
  ) as { readonly files?: unknown } | null
  if (!Array.isArray(bundle?.files)) throw Error('Invalid packaged authoring skills')
  return bundle.files.map((entry: unknown) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      !/^(flow|jig)\//.test(entry[0]) ||
      typeof entry[1] !== 'string'
    )
      throw Error('Invalid packaged authoring skill file')
    return [`.agents/skills/${validateLogicalPath(entry[0])}`, entry[1]] as const
  })
}

function projectAgentGuidance(hasTests: boolean, flowSkillBundled: boolean): string {
  return [
    '# Workflow edits',
    '',
    'Read the bundled [Jig skill](./.agents/skills/jig/SKILL.md)',
    'for project wiring, review, Runs, and tests.',
    flowSkillBundled
      ? 'Read the bundled [FLOW skill](./.agents/skills/flow/SKILL.md) for method design and contracts.'
      : '[Install the FLOW skill](https://jig.md/for-agents#install-authoring-skills) for method design and contracts.',
    'For a change within one Flow, work from its own guidance, source, and tests.',
    '',
    'For a routing or shared Binding change, run `jig inspect --flow` from the',
    'project root. Use `jig inspect --flow --find TEXT` to search for a task phrase.',
    'Pass a known Flow file or Binding declaration by its relative',
    'path. Find the caller, its slot, and the routes to preserve. Give a caller',
    'its own Binding when it needs a different collaborator.',
    '',
    'Check configuration changes with `jig check` before review. Use',
    '`jig check --diff` when a prior approval exists. After authorized review,',
    'replay the changed and preserved routes with the same fixture. When routing',
    'matters, verify the exact caller, slot, and target in the Run evidence.',
    '',
    'Use the composition testing guide for route changes.',
    '[Bundled guide](./.agents/skills/jig/reference/build/compose.md#test-callers-in-your-application) · [Public guide](https://jig.md/build/compose#test-callers-in-your-application)',
    '',
    doxFramework.trimEnd(),
    '',
    '## Child DOX Index',
    '',
    '- [Flows](./flows/AGENTS.md) — portable methods and their packages.',
    '- [Bindings](./bindings/AGENTS.md) — project-owned settings and selections.',
    ...(hasTests ? ['- [Tests](./tests/AGENTS.md) — input fixtures and application tests.'] : []),
    '',
  ].join('\n')
}

function flowsAgentGuidance(files: readonly (readonly [string, string])[]): string {
  const guides = files.flatMap(([path]) => {
    const match = /^flows\/([^/]+)\/AGENTS\.md$/.exec(path)
    return match ? [`- [${match[1]}](./${match[1]}/AGENTS.md)`] : []
  })
  return [
    '# Flows',
    '',
    'Each package owns its method, invocation contract, and local `AGENTS.md`.',
    'Keep methods reusable. Leave project-specific policy selections to Bindings.',
    'When adding a Flow, add its guide to the index.',
    '',
    '## Child DOX Index',
    '',
    ...(guides.length ? guides : ['Add package guides here as you create Flows.']),
    '',
  ].join('\n')
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
    ['package.json', renderProjectManifest({ '@jigging/agent-acp': AGENT_ACP_VERSION })],
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
        'Edit `client` in `bindings/agent.ts` to select codex or claude.',
        'For this approval only, use `jig review --agent CLIENT` without editing source.',
        'Repeat that argument on later reviews; a bare review uses source choices again.',
        '',
        'Configure the native installation and operator authentication described in',
        'https://jig.md/build/agents, then run:',
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
        ...AUTHORING_SKILLS_README,
      ].join('\n'),
    ],
  ]
}

function renderProjectManifest(dependencies?: Readonly<Record<string, string>>): string {
  return (
    JSON.stringify(
      {
        private: true,
        ...(dependencies === undefined ? {} : { dependencies }),
        engines: { jig: privateJigVersion },
      },
      null,
      2,
    ) + '\n'
  )
}

function flowAgentGuidance(
  name: string,
  purpose = 'See the method description in [FLOW.meta.json](./FLOW.meta.json).',
): string {
  return [
    `# ${name} Flow`,
    '',
    '## Purpose',
    '',
    purpose,
    '',
    '## Ownership',
    '',
    '[FLOW.ts](./FLOW.ts) is the entrypoint for this method.',
    '',
    '## Local Contracts',
    '',
    '## Work Guidance',
    '',
    '## Verification',
    '',
    '## Child DOX Index',
    '',
  ].join('\n')
}

const testAgentGuidance = `# Application tests

Run \`bun test\` from the project root after the operator approves the revision.
Keep fixture files in \`tests/fixtures\` so tests and Explorer can use the same JSON.
After a route change, check the requested behavior and the routes that should still work.
Require complete call evidence before asserting that a call did not occur.
`

const greetingTest = `import { $ } from 'bun'
import { expect, test } from 'bun:test'

test('Greets Ada', async () => {
  const result = await $\`jig run flow:flows/hello --input '"Ada"' --json\`
    .cwd(\`\${import.meta.dir}/..\`).quiet().json()

  expect(result).toMatchObject({
    status: 'succeeded',
    outcome: 'done',
    output: { message: 'Hello, Ada!' },
  })
}, 60_000)
`

function greetingFiles(): readonly (readonly [string, string])[] {
  return [
    ['tests/greeting.test.ts', greetingTest],
    ['flows/hello/AGENTS.md', flowAgentGuidance('hello')],
    [
      'flows/hello/FLOW.meta.json',
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
        'jig check',
        'jig review --allow-resolution-network',
        `jig run flow:flows/hello --input '"Ada"'`,
        '```',
        '',
        'Expect `Hello, Ada!`. You can also enter `"Ada"` in `jig explore`.',
        '',
        'Review prepares dependencies privately, shows changes, and asks for approval.',
        'The resolution flag permits dependency-selected network requests before approval;',
        'declining cannot undo those requests. It does not grant network access to Runs.',
        'Initialization itself makes no network requests and approves nothing.',
        '',
        'Edit `flows/hello/FLOW.ts`, check the working project, and review the change.',
        'Run the accepted revision with the same input. Code edits can require fresh dependency',
        'resolution until you add an authored lock; unchanged reviews reuse admitted bytes.',
        'This ordinary package names the exact SDK revision tested with this Jig build.',
        'Resolution retains exact versions privately; add an authored Bun lock when',
        'sharing reproducible dependencies.',
        'With Bun on your PATH, run `bun test` after approval. The test runs Jig with the same input.',
        '',
        'Help: `jig review --help`, `jig run --help`, https://jig.md/start/',
        '',
        ...AUTHORING_SKILLS_README,
      ].join('\n'),
    ],
  ]
}
