import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  main,
  privateCliPrepareArguments,
  privateCliRequiresHost,
  privateCliVerification,
} from '../../src/cli.js'
import {
  approvedTargets,
  cliShellWord,
  completionScript,
  invocationGuide,
} from '../../src/cli-discovery.js'
import { flowContextRecord, renderFlowContext } from '../../src/cli-flow-context.js'
import {
  inspectionImplementation,
  inspectionSources,
} from '../../src/internal/inspection-source.js'
import type { JsonValue } from '../../src/json.js'
import { capturePackageDirectory } from '../../src/package/capture.js'
import { checkPackageDirectory } from '../../src/package/inspect.js'
import { createFlow, createProject } from '../../src/project-init.js'

test('implementation bundles include imported method candidates and local data with explicit exclusions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-implementation-source-'))
  try {
    await mkdir(join(root, 'contracts'))
    await writeFile(join(root, 'FLOW.ts'), "import { method } from './method.ts';")
    await writeFile(join(root, 'method.ts'), 'export const method = () => 1')
    await writeFile(join(root, 'policy.json'), '{"limit":2}')
    await writeFile(join(root, 'README.md'), 'Documentation')
    await writeFile(join(root, 'contracts/vendor.json'), '{}')
    const captured = await capturePackageDirectory(root)
    try {
      const bundle = await inspectionImplementation(captured, 'FLOW.ts')
      expect(bundle.sources.map((member) => member.sourcePath)).toEqual([
        'FLOW.ts',
        'method.ts',
        'policy.json',
      ])
      expect(bundle.sources[1]!.source).toBe('export const method = () => 1')
      expect(bundle.implementation.omittedMembers).toBe(2)
    } finally {
      await captured.dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('related captured sources preserve order and share one aggregate byte allowance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-related-source-'))
  try {
    await writeFile(join(root, 'first.ts'), 'a'.repeat(120000))
    await writeFile(join(root, 'second.ts'), 'b'.repeat(120000))
    await writeFile(join(root, 'third.ts'), 'c'.repeat(30000))
    await writeFile(join(root, 'binary.txt'), '\0')
    const captured = await capturePackageDirectory(root)
    try {
      const selected = await inspectionSources(captured, ['second.ts', 'first.ts'])
      expect(selected.sources.map((member) => member.sourcePath)).toEqual(['second.ts', 'first.ts'])
      expect(selected.sources[0]!.source).toBe('b'.repeat(120000))
      for (const members of [
        ['first.ts', 'second.ts', 'third.ts'],
        ['first.ts', 'first.ts'],
        ['first.ts', 'missing.ts'],
        ['first.ts', 'binary.txt'],
      ])
        await expect(inspectionSources(captured, members)).rejects.toMatchObject({
          code: 'INSPECTION_SOURCE_UNAVAILABLE',
        })
    } finally {
      await captured.dispose()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('usage mistakes show one correction, not the entire manual', async () => {
  for (const [args, expected] of [
    [['rn'], 'Did you mean run?'],
    [['run', 'flow:flows/hello', '--timeot', '2m'], 'Did you mean --timeout?'],
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
    expect(text).toMatch(/Help:\s+\$ jig/)
    expect(text).not.toContain('Startup verification:')
    expect(text.split('\n').length).toBeLessThan(13)
    expect(privateCliRequiresHost(args)).toBe(false)
  }
})
test('selection without an approved entrypoint never guesses and validates options before asking', async () => {
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

test('review source roots use bounded repeatable operands before host acquisition', () => {
  const repeated = [
    'review',
    './apps/demo',
    '--source-root',
    './packages/local library',
    '--source-root',
    './packages/another',
    '--verification',
    'strict',
  ]
  expect(privateCliRequiresHost(repeated)).toBe(true)
  expect(privateCliVerification(repeated)).toBe('strict')
  expect(
    privateCliRequiresHost([
      'review',
      ...Array.from({ length: 32 }, (_, index) => ['--source-root', `../root-${index}`]).flat(),
    ]),
  ).toBe(true)
  expect(privateCliRequiresHost(['review', '--source-root', `/${'a'.repeat(4095)}`])).toBe(true)
  expect(privateCliRequiresHost(['review', '--source-root', './-library'])).toBe(true)
  for (const args of [
    ['review', '--source-root'],
    ['review', '--source-root', ''],
    ['review', '--source-root', '--yes'],
    ['review', '--source-root', 'private-invalid-value\u0000'],
    ['review', '--source-root', 'private-invalid-value\n'],
    ['review', '--source-root', 'private-invalid-value\ud800'],
    ['review', '--source-root', 'é'.repeat(2049)],
    [
      'review',
      ...Array.from({ length: 33 }, (_, index) => ['--source-root', `../root-${index}`]).flat(),
    ],
    ['run', 'flow:flows/hello', '--source-root', '../library'],
    ['inspect', '--source-root', '../library'],
  ]) {
    expect(privateCliRequiresHost(args)).toBe(false)
    expect(() => privateCliVerification(args)).toThrow()
  }
})

test('explicit argument preparation renders usage failures before the installed host is acquired', async () => {
  for (const [args, exitCode, code] of [
    [['run', 'binding:work', '--out', 'fixed', '--out', 'other'], 2, 'JIG_USAGE'],
    [['run', 'binding:work', '--unknown'], 2, 'JIG_USAGE'],
    [['run', 'bad-target'], 1, 'JIG_RUN_TARGET_INVALID'],
  ] as const) {
    let diagnostic = ''
    expect(
      await privateCliPrepareArguments(args, {
        writeError: (text) => {
          diagnostic += text
        },
      }),
    ).toEqual({ exitCode })
    expect(diagnostic).toContain(code as string)
    expect(diagnostic).not.toContain('at privateCliPrepareArguments')
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
    "jig run 'binding:repair' --input @input.json --attach 'source=./source-input'",
  )
  expect(guide).toContain('fresh temporary packet')
  expect(guide).toContain('use --out DIR')
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
    expect(script).not.toMatch(/\beval\b/)
    expect(script).toContain(shell === 'fish' ? '-l verification' : '--verification')
    expect(script).toContain(shell === 'fish' ? '-l source-root' : '--source-root')
    for (const flag of ['flow', 'approved', 'impact', 'source'])
      expect(script).toContain(shell === 'fish' ? '-l ' + flag : '--' + flag)
    if (shell === 'fish') expect(script).toContain('-l source -r')
  }
  expect(completionScript('sh')).toBeUndefined()
  const bash =
    ['/bin/bash', 'bash'].find((candidate) => {
      try {
        const result = Bun.spawnSync([candidate, '-c', 'type complete >/dev/null 2>&1'])
        return result.exitCode === 0
      } catch {
        return false
      }
    }) ?? 'bash'
  const check = Bun.spawn([bash, '-n'], {
    stdin: new Blob([completionScript('bash')!]),
    stderr: 'pipe',
  })
  expect(await check.exited).toBe(0)
  const completion = Bun.spawn([bash], {
    stdin: new Blob([
      completionScript('bash')!,
      `
jig() { [[ "$3" == flow:flows/h ]] && printf '%s\\n' 'flow:flows/hello'; }
COMP_WORDS=(jig run flow : flows/h)
COMP_CWORD=4
COMP_WORDBREAKS=:
_jig
[[ "\${COMPREPLY[*]}" == flows/hello ]] || exit 1
COMP_WORDS=(jig import-contract jig : report)
COMP_CWORD=4
_jig
[[ "\${COMPREPLY[*]}" == reporting ]]
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

test('source-root completion preserves directory spaces without executing Jig', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-source-root-completion-'))
  try {
    await mkdir(join(root, 'local library'))
    await writeFile(join(root, 'local-file'), 'ordinary file')
    const bash =
      ['/bin/bash', 'bash'].find((candidate) => {
        try {
          const result = Bun.spawnSync([candidate, '-c', 'type complete >/dev/null 2>&1'])
          return result.exitCode === 0
        } catch {
          return false
        }
      }) ?? 'bash'
    const completion = Bun.spawn([bash], {
      cwd: root,
      stdin: new Blob([
        completionScript('bash')!,
        `
COMP_WORDS=(jig review --source-root ./loc)
COMP_CWORD=3
_jig
printf '%s\\n' "\${COMPREPLY[@]}"
`,
      ]),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await new Response(completion.stdout).text()).toBe('./local library\n')
    expect(await completion.exited).toBe(0)
    expect(await new Response(completion.stderr).text()).toBe('')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('target discovery distinguishes unavailable alternatives from ready choices', () => {
  const snapshot = {
    targets: [
      { target: 'binding:code', availability: { state: 'ready' } },
      {
        target: 'binding:model',
        availability: { state: 'unavailable', code: 'RUNTIME_UNAVAILABLE' },
      },
    ],
  }
  expect(approvedTargets(snapshot, true).map(({ target }) => target)).toEqual(['binding:code'])
  expect(approvedTargets(snapshot).map(({ target, available }) => [target, available])).toEqual([
    ['binding:code', true],
    ['binding:model', false],
  ])
  expect(invocationGuide(snapshot)).toContain('unavailable')
  const unavailableDefault = invocationGuide({
    ...snapshot,
    entrypoint: 'binding:model --timeout 1m',
  })
  expect(unavailableDefault).toContain('default target is unavailable')
  expect(unavailableDefault).not.toContain('Start this application')
  expect(
    invocationGuide({
      targets: [{ target: 'flow:flows/work', availability: { state: 'unavailable' } }],
      entrypoint: 'flow:./flows/work',
    }),
  ).toContain('default target is unavailable')
  expect(
    invocationGuide({ target: 'binding:model', availability: { state: 'unavailable' } }),
  ).toContain('$ jig review')
})

test('inspection templates omit read attachments already captured by the Binding', () => {
  const guide = invocationGuide({
    target: 'binding:work',
    attachments: { source: 'read', rules: 'read', files: 'read-write' },
    boundReadAttachments: ['rules'],
  })
  expect(guide).toContain("--attach 'source=./source-input'")
  expect(guide).not.toContain("--attach 'rules=")
  expect(guide).toContain('already supplied: "rules"')
  expect(guide).toContain('use --out DIR')
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
      'FLOW.meta.json',
      'FLOW.ts',
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

test('flow inspection grammar refuses ambiguous source and result combinations before acquisition', async () => {
  for (const flags of [
    ['--approved'],
    ['--impact'],
    ['--source', 'FLOW.ts'],
    ['--flow', '--impact'],
    ['--flow', '--result', 'packet'],
    ['--flow', 'binding:work', '--source', '../secret'],
    ['--flow', 'binding:work', '--source', '/secret'],
    ['--flow', '--flow'],
    ['--implementation'],
    ['--flow', '--implementation'],
    ['--flow', 'binding:work', '--implementation', '--source', 'FLOW.ts'],
    ['--flow', 'binding:work', '--source', 'FLOW.ts', '--source', 'FLOW.ts'],
  ]) {
    let text = ''
    const result = await main(['inspect', ...flags], {
      writeError: (value) => {
        text += value
      },
    })
    expect(result).toBe(2)
    expect(text).toContain('JIG_USAGE')
  }
})

test('flow context follows callers and Binding peers while preserving configured semantics', () => {
  const flow = (routes: JsonValue[], settings: JsonValue = {}) => ({
    routes,
    settings,
    contract: { outcomes: { blocked: 'abstention' } },
    files: [{ path: 'method.ts', bytes: 30 }],
    entrypoint: 'FLOW.ts',
    digest: 'abc',
    attachments: {},
    artifactResults: [],
  })
  const snapshot: JsonValue = {
    state: 'unchecked',
    agentOverride: 'claude',
    revision: 'approval',
    entrypoint: 'binding:root',
    targets: [
      {
        target: 'binding:root',
        package: 'flows/root',
        state: 'unchecked',
        flow: flow([
          { slot: 'first', target: 'binding:one' },
          { slot: 'second', target: 'binding:two' },
        ]),
      },
      {
        target: 'binding:one',
        package: 'flows/repair',
        state: 'unchecked',
        flow: flow([{ slot: 'agent', resource: 'finite-acp' }], { attempts: 1 }),
      },
      {
        target: 'binding:two',
        package: 'flows/repair',
        state: 'unchecked',
        flow: flow([], { attempts: 2 }),
      },
      { target: 'flow:unrelated', package: 'flows/other', state: 'unchecked', flow: flow([]) },
    ],
  }
  const context = renderFlowContext(snapshot, { target: 'binding:one', impact: true })
  expect(context).toContain('Approved project review Agent choice:')
  expect(context).toContain('claude')
  expect(context).toContain('binding:root')
  expect(context).toContain('binding:two')
  expect(context).toContain('"attempts":1')
  expect(context).toContain('"attempts":2')
  expect(context).not.toContain('flow:unrelated')
  expect(context).toContain('1 other targets')
  expect(
    (flowContextRecord(snapshot, { target: 'binding:one', impact: true }) as any).scope,
  ).toEqual({ target: 'binding:one', impact: true, omittedTargets: 1 })
  expect(
    JSON.stringify(flowContextRecord(snapshot, { target: 'binding:one', impact: true })),
  ).not.toContain('flow:unrelated')
  expect(context).toContain('Configured connections describe potential calls')
  expect(renderFlowContext(snapshot)).toContain('finite-acp')
})

test('captured source cannot terminate its Markdown fence or inject terminal control sequences', () => {
  const output = renderFlowContext(
    {
      state: 'unchecked',
      revision: 'x',
      targets: [
        {
          target: 'binding:work',
          package: 'flows/work',
          flow: {
            contract: {},
            routes: [],
            files: [],
            sources: [
              {
                source: 'const x = "[31m";\n' + '`'.repeat(6) + '\n<script>literal</script>',
                sourcePath: 'method.ts',
              },
            ],
          },
        },
      ],
    },
    { target: 'binding:work' },
  )
  expect(output).not.toContain(String.fromCharCode(27))
  expect(output).toContain('\\u001b')
  expect(output).toContain('`'.repeat(7) + 'text')
})

test('lean flow reading retains exact result contracts in JSON without inventing summaries', () => {
  const snapshot: JsonValue = {
    state: 'unchecked',
    revision: 'x',
    targets: [
      {
        target: 'flow:policy',
        package: 'policy',
        state: 'unchecked',
        flow: {
          contract: {
            result: {
              type: 'object',
              properties: {
                outcome: { const: 'done' },
                output: {
                  type: 'object',
                  properties: { disposition: { enum: ['credit_eligible', 'manual_review'] } },
                },
              },
            },
          },
          routes: [],
          files: [],
        },
      },
    ],
  }
  const exact = flowContextRecord(snapshot, {}) as any
  expect(
    exact.targets[0].flow.contract.result.properties.output.properties.disposition.enum,
  ).toEqual(['credit_eligible', 'manual_review'])
  expect(renderFlowContext(snapshot)).not.toContain('Input:')
})

test('source framing handles many backtick runs within the source bound', () => {
  const output = renderFlowContext(
    {
      state: 'unchecked',
      revision: 'x',
      targets: [
        {
          target: 'flow:many',
          package: 'many',
          flow: {
            routes: [],
            files: [],
            sources: [{ source: '` '.repeat(130000), sourcePath: 'many.txt' }],
          },
        },
      ],
    },
    { target: 'flow:many' },
  )
  expect(output).toContain('Captured source: many.txt')
})

test('flow context separates retained unavailability from a matching environment', () => {
  const output = renderFlowContext({
    state: 'environment-matches',
    revision: 'x',
    targets: [
      {
        target: 'flow:work',
        package: 'work',
        state: 'environment-matches',
        availability: { state: 'unavailable', code: 'RUNTIME_UNAVAILABLE' },
        flow: {
          routes: [],
          files: [],
          installedDependency: { version: '1.0.0', agreement: 'unchecked' },
        },
      },
    ],
  })
  expect(output).toContain('Environment: environment-matches')
  expect(output).toContain('Approved availability: unavailable (RUNTIME\\_UNAVAILABLE)')
})

test('reverse flow traversal preserves complete JSON scope beyond the Markdown graph bound', () => {
  const targets = Array.from({ length: 1200 }, (_, i) => ({
    target: 'flow:step-' + i,
    package: 'step-' + i,
    state: 'unchecked',
    flow: { routes: i < 1199 ? [{ slot: 'next', target: 'flow:step-' + (i + 1) }] : [], files: [] },
  }))
  const snapshot: JsonValue = { state: 'unchecked', revision: 'x', targets }
  const context = flowContextRecord(snapshot, { target: 'flow:step-1199', impact: true }) as any
  expect(context.targets).toHaveLength(1200)
  expect(context.scope.omittedTargets).toBe(0)
  expect(renderFlowContext(snapshot, { target: 'flow:step-1199', impact: true })).toContain(
    'No graph was truncated',
  )
})

test('named-operation contracts never acquire a synthetic default interface in flow context', () => {
  const output = renderFlowContext({
    state: 'unchecked',
    revision: 'x',
    targets: [
      {
        target: 'flow:named',
        package: 'named',
        availability: { state: 'unavailable' },
        flow: {
          routes: [],
          files: [],
          contract: { operations: { check: { input: { type: 'string' } } } },
        },
      },
    ],
  })
  expect(output).toContain('Named operations:')
  expect(output).toContain('No default executable operation is supported')
  expect(output).not.toContain('Declared outcomes: done')
  expect(output).not.toContain('Input: unconstrained')
})

test('flow Markdown uses asynchronous raw output even on a terminal and leaves an unreviewed project untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-flow-raw-output-'))
  try {
    let output = '',
      delivered = false
    const result = await main(['inspect', '--flow', '--approved'], {
      currentDirectory: root,
      terminalOutput: true,
      writeOutput: () => {
        throw new Error('Unexpected human formatting')
      },
      writeRecord: async (text) => {
        await new Promise((resolve) => setImmediate(resolve))
        output += text
        delivered = true
      },
    })
    expect(result).toBe(0)
    expect(delivered).toBe(true)
    expect(output).toStartWith('# Application flow\n')
    expect(output).toContain('`jig review`')
    expect(await readdir(root)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('working-tree flow inspection requires the contained evaluator while approved inspection stays inert', () => {
  expect(privateCliRequiresHost(['inspect', '--flow'])).toBe(true)
  expect(privateCliRequiresHost(['inspect', '--flow', '--source', 'jig.ts'])).toBe(true)
  expect(privateCliRequiresHost(['inspect', '--flow', '--approved'])).toBe(false)
  expect(privateCliRequiresHost(['inspect', '--approved'])).toBe(false)
  const snapshot: JsonValue = {
    basis: 'working-tree',
    state: 'unreviewed',
    revision: 'source',
    targets: [
      {
        target: 'flow:flows/work',
        package: 'flows/work',
        state: 'unreviewed',
        flow: {
          routes: [],
          files: [],
          installedDependency: { version: '1.0.0', agreement: 'unchecked' },
        },
      },
    ],
  }
  const output = renderFlowContext(snapshot)
  expect(output).toContain('captured working tree (unapproved)')
  expect(output).toContain('Agreement with the manifest request and lock is unchecked')
  expect(output).toContain('flow:flows/work')
  expect(output).not.toContain('Approved availability')
  expect(output).not.toContain('No locally approved revision')
  expect((flowContextRecord(snapshot, {}) as any).targets).toHaveLength(1)
})
