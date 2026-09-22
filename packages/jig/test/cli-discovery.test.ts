import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, privateCliPrepareArguments, privateCliRequiresHost } from '../src/cli.js'
import {
  approvedTargets,
  cliShellWord,
  completionScript,
  invocationGuide,
} from '../src/cli-discovery.js'
import { checkPackageDirectory } from '../src/package/inspect.js'
import { createFlow, createProject } from '../src/project-init.js'

test('usage mistakes show one correction, not the entire manual', async () => {
  for (const [args, expected] of [
    [['rn'], 'Did you mean run?'],
    [['run', 'flow:flows/hello', '--timeot', '2m'], 'Did you mean --timeout?'],
    [['run'], 'exact target is required'],
    [['review', '--oops'], 'Unknown or repeated review option'],
  ] as const) {
    let text = ''
    expect(
      await main(args, {
        interactive: false,
        writeError: (value) => {
          text += value
        },
      }),
    ).toBe(2)
    expect(text).toContain(expected)
    expect(text).toContain('Help: jig')
    expect(text).not.toContain('Startup verification:')
    expect(text.split('\n').length).toBeLessThan(13)
    expect(privateCliRequiresHost(args)).toBe(false)
  }
})

test('selection never defaults a target and validates options before asking', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-empty-choice-'))
  try {
    let asked = false,
      text = ''
    for (const args of [['run'], ['run', '--timeout', 'bad']]) {
      const result = await privateCliPrepareArguments(args, {
        currentDirectory: root,
        interactive: true,
        answer: async () => {
          asked = true
          return '1'
        },
        writeError: (value) => {
          text += value
        },
      })
      expect('exitCode' in result).toBe(true)
    }
    expect(asked).toBe(false)
    expect(text).toContain('No approved targets')
    expect(await readdir(root)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('inspection gives honest templates, required files and channels, not guessed values', () => {
  const guide = invocationGuide({
    target: 'binding:repair',
    description: 'Fix supplied source.',
    contract: {
      input: {
        type: 'object',
        required: ['issue'],
        properties: { issue: { type: 'string' }, attempts: { type: 'integer' } },
      },
      channels: { progress: { direction: 'send', required: false } },
    },
    attachments: { source: 'read', files: 'read-write' },
  })
  expect(guide).toContain('"issue" (required): "string"')
  expect(guide).toContain('"attempts" (optional): "integer"')
  expect(guide).toContain('template')
  expect(guide).toContain(
    "jig run 'binding:repair' --input @input.json --attach 'source=./source-input' --out ./result-packet",
  )
  expect(guide).toContain('"progress" (optional)')
  expect(guide).not.toContain('--input \'{"issue"')
  expect(cliShellWord("flow:flows/it's a test")).toBe("'flow:flows/it'\\''s a test'")
  expect(approvedTargets({ state: 'unreviewed', targets: [] })).toEqual([])
  expect(
    invocationGuide({
      target: 'binding:work',
      contract: { channels: { progress: { direction: 'send', required: true } } },
    }),
  ).toContain("--receive 'progress'")
  const incoming = invocationGuide({
    target: 'binding:work',
    contract: { channels: { commands: { direction: 'receive', required: true } } },
  })
  expect(incoming).toContain('CLI cannot supply it')
  expect(incoming).not.toContain("jig run 'binding:work'")
})

test('completion scripts contain only static shell code and read-only target lookup', async () => {
  for (const shell of ['bash', 'zsh', 'fish']) {
    const script = completionScript(shell)!
    expect(script).toContain('jig completion targets')
    expect(script).not.toContain('jig review')
    expect(script).not.toContain('eval')
    expect(script).toContain(shell === 'fish' ? '-l verification' : '--verification')
  }
  expect(completionScript('sh')).toBeUndefined()
  const check = Bun.spawn(['bash', '-n'], {
    stdin: new Blob([completionScript('bash')!]),
    stderr: 'pipe',
  })
  expect(await check.exited).toBe(0)
  const completion = Bun.spawn(['bash'], {
    stdin: new Blob([
      completionScript('bash')!,
      `
jig() { [[ "$3" == flow:flows/h ]] && printf '%s\\n' 'flow:flows/hello'; }
COMP_WORDS=(jig run flow : flows/h)
COMP_CWORD=4
COMP_WORDBREAKS=:
_jig
[[ "\${COMPREPLY[*]}" == flows/hello ]]
`,
    ]),
    stderr: 'pipe',
  })
  expect(await completion.exited).toBe(0)
  let output = ''
  expect(
    await main(['completion', 'bash'], {
      writeRecord: async (value) => {
        output += value
      },
    }),
  ).toBe(0)
  expect(output).toBe(completionScript('bash')!)
  expect(privateCliRequiresHost(['completion', 'targets'])).toBe(false)
})

test('new writes ordinary source, inherits the project SDK and never evaluates authoring', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-new-flow-'))
  const project = join(root, 'project')
  try {
    await createProject(project)
    await writeFile(join(project, 'jig.ts'), 'throw new Error("must not run")')
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ devDependencies: { '@jigging/flow': 'workspace:*' } }),
    )
    const before = await readFile(join(project, 'jig.ts'), 'utf8')
    expect(await createFlow(project, 'summarize')).toBe('flows/summarize')
    expect(
      JSON.parse(await readFile(join(project, 'flows/summarize/package.json'), 'utf8'))
        .dependencies,
    ).toEqual({ '@jigging/flow': 'workspace:*' })
    expect((await readdir(join(project, 'flows/summarize'))).sort()).toEqual([
      'FLOW.ts',
      'flow.meta.json',
      'package.json',
    ])
    expect((await checkPackageDirectory(join(project, 'flows/summarize'))).entrypoint.path).toBe(
      'FLOW.ts',
    )
    expect(await readFile(join(project, 'jig.ts'), 'utf8')).toBe(before)
    await expect(createFlow(project, 'summarize')).rejects.toMatchObject({ code: 'JIG_NEW_EXISTS' })
    await expect(createFlow(project, '../escape')).rejects.toMatchObject({
      code: 'JIG_NEW_INVALID',
    })
    expect((await readdir(project)).includes('.jig')).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('new rejects symlinked flows, malformed manifests, and a nonproject without touching them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-new-unsafe-'))
  try {
    await expect(createFlow(root, 'hello')).rejects.toMatchObject({ code: 'JIG_NEW_INVALID' })
    await writeFile(join(root, 'jig.ts'), 'export default {}')
    await mkdir(join(root, 'outside'))
    await symlink(join(root, 'outside'), join(root, 'flows'))
    await expect(createFlow(root, 'hello')).rejects.toMatchObject({ code: 'JIG_NEW_UNAVAILABLE' })
    expect(await readdir(join(root, 'outside'))).toEqual([])
    await writeFile(join(root, 'package.json'), '{')
    await expect(createFlow(root, 'hello')).rejects.toMatchObject({ code: 'JIG_NEW_INVALID' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
