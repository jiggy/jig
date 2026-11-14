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
import type { JsonValue } from '../../src/json.js'

import { checkPackageDirectory } from '../../src/package/inspect.js'
import { createFlow, createProject } from '../../src/project-init.js'

type TopologyView = { targets: { target: string }[]; scope: Record<string, JsonValue> }

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
    for (const flag of ['flow', 'approved'])
      expect(script).toContain(shell === 'fish' ? '-l ' + flag : '--' + flag)
    for (const removed of ['impact', 'implementation']) {
      expect(script).not.toContain(`--${removed}`)
      expect(script).not.toContain(`-l ${removed}`)
    }
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

test('configured topology grammar rejects removed source and impact modes before acquisition', async () => {
  for (const flag of ['--source', '--implementation', '--impact']) {
    expect(privateCliRequiresHost(['inspect', '--flow', 'binding:work', flag])).toBe(false)
    expect(await main(['inspect', '--flow', 'binding:work', flag], { writeError: () => {} })).toBe(
      2,
    )
  }
  expect(privateCliRequiresHost(['inspect', '--flow'])).toBe(true)
  expect(privateCliRequiresHost(['inspect', '--flow', '--approved'])).toBe(false)
})

test('configured topology keeps identities stable and does not emit source inventories', () => {
  const root = {
    target: 'binding:root',
    package: 'flows/root',
    state: 'unchecked',
    flow: {
      settings: {},
      routes: [
        { slot: 'first', target: 'binding:one' },
        { slot: 'second', target: 'binding:two' },
      ],
    },
  }
  const one = {
    target: 'binding:one',
    package: 'flows/shared',
    state: 'unchecked',
    flow: { settings: { attempts: 1 }, routes: [{ slot: 'agent', resource: 'finite-acp' }] },
  }
  const two = {
    target: 'binding:two',
    package: 'flows/shared',
    state: 'unchecked',
    flow: { settings: { attempts: 2 }, routes: [] },
  }
  const snapshot: JsonValue = {
    basis: 'working-tree',
    revision: 'x',
    state: 'unreviewed',
    entrypoint: 'binding:root',
    targets: [root, one, two],
  }
  const first = renderFlowContext(snapshot)
  const reordered = renderFlowContext({
    ...(snapshot as object),
    targets: [two, root, one],
  } as JsonValue)
  const lines = (text: string) =>
    text
      .split('\n')
      .filter((line) => line.startsWith('    '))
      .sort()
  expect(lines(first)).toEqual(lines(reordered))
  expect(first).toContain('binding:one')
  expect(first).toContain('binding:two')
  expect(first).toContain('finite-acp')
  expect(first).toContain('attempts')
  expect(first).toContain('binding:root uses flows/root.')
  expect(first).toContain('binding_root -->|"first"| binding_one')
  expect(first).toContain('binding_one -->|"agent"| resource_binding_one_agent')
  expect(first).not.toContain('Source for behavioral reading')
  expect(first).not.toContain('Captured source:')
  expect((flowContextRecord(snapshot, { target: 'binding:one' }) as TopologyView).scope).toEqual({
    target: 'binding:one',
    entrypoint: 'binding:root',
    sharedImplementation: ['binding:two'],
    boundaries: [],
    omittedTargets: 0,
    omittedConnections: 0,
  })
})

test('focused topology retains upstream paths, caller slots and other uses of the implementation', () => {
  const target = (name: string, packageId: string, routes: JsonValue[] = []) => ({
    target: `binding:${name}`,
    package: packageId,
    flow: { routes },
  })
  const snapshot: JsonValue = {
    basis: 'working-tree',
    revision: 'x',
    entrypoint: 'binding:factory',
    targets: [
      target('factory', 'flows/factory', [
        { slot: 'router', target: 'binding:router' },
        { slot: 'checked', target: 'binding:checked' },
        { slot: 'other', target: 'binding:other' },
      ]),
      target('router', 'flows/router'),
      target('checked', 'flows/repair', [{ slot: 'agent', target: 'binding:agent' }]),
      target('single', 'flows/repair'),
      target('other-entry', 'flows/other-entry', [{ slot: 'single', target: 'binding:single' }]),
      target('other', 'flows/other', [{ slot: 'hidden', target: 'binding:hidden' }]),
      target('agent', 'npm:agent', [{ slot: 'native', resource: 'finite-acp' }]),
      target('hidden', 'flows/hidden'),
      target('unrelated', 'flows/unrelated', [{ slot: 'agent', target: 'binding:agent' }]),
    ],
  }
  const selected = flowContextRecord(snapshot, { target: 'binding:checked' }) as TopologyView
  expect(selected.targets.map((item) => item.target).sort()).toEqual([
    'binding:agent',
    'binding:checked',
    'binding:factory',
    'binding:other',
    'binding:other-entry',
    'binding:router',
    'binding:single',
  ])
  expect(selected.scope).toEqual({
    target: 'binding:checked',
    entrypoint: 'binding:factory',
    sharedImplementation: ['binding:single'],
    boundaries: [
      { target: 'binding:other', incoming: 0, outgoing: 1 },
      { target: 'binding:agent', incoming: 1, outgoing: 0 },
    ],
    omittedTargets: 2,
    omittedConnections: 2,
  })
  const graph = renderFlowContext(snapshot, { target: 'binding:checked' })
  expect(graph).toContain('Focus: binding:checked.\nEntrypoint: binding:factory.')
  expect(graph).toContain('binding_factory -->|"router"| binding_router')
  expect(graph).toContain('binding_other_entry -->|"single"| binding_single')
  expect(graph).toContain('Shared implementation with binding:checked: binding:single.')
  expect(graph).toContain(
    'binding:other: 0 incoming and 1 outgoing configured connections outside this view.',
  )
  expect(graph).toContain(
    'binding:agent: 1 incoming and 0 outgoing configured connections outside this view.',
  )
  expect(graph).not.toContain('binding_hidden[')
  expect(graph).not.toContain('binding_unrelated[')
  expect(graph).not.toContain('undefined')
  // The default application view does not expand into independent callers.
  const application = flowContextRecord(snapshot, {}) as TopologyView
  expect(application.targets.map((item) => item.target)).not.toContain('binding:other-entry')
})

test('focused topology terminates on cycles and distinguishes package identity from equal bytes', () => {
  const snapshot: JsonValue = {
    basis: 'working-tree',
    revision: 'x',
    targets: [
      {
        target: 'binding:a',
        package: 'flows/a',
        flow: { digest: 'same', routes: [{ slot: 'b', target: 'binding:b' }] },
      },
      {
        target: 'binding:b',
        package: 'flows/b',
        flow: { routes: [{ slot: 'a', target: 'binding:a' }] },
      },
      { target: 'binding:copy', package: 'flows/copy', flow: { digest: 'same', routes: [] } },
      { target: 'binding:other', flow: { routes: [] } },
    ],
  }
  const selected = flowContextRecord(snapshot, { target: 'binding:a' }) as TopologyView
  expect(selected.targets.map((item) => item.target)).toEqual(['binding:a', 'binding:b'])
  expect(selected.scope.sharedImplementation).toEqual([])
  expect(selected.scope.omittedTargets).toBe(2)
  expect(() => flowContextRecord(snapshot, { target: 'binding:missing' })).toThrow(
    'Configured target is missing',
  )
})

test('readable topology names disambiguate punctuation and preserve identity in focused views', () => {
  const targets = [
    {
      target: 'binding:a-b',
      flow: {
        routes: [
          { slot: 'a-b', resource: 'project-command' },
          { slot: 'a_b', resource: 'project-command' },
        ],
      },
    },
    { target: 'binding:a_b', flow: { routes: [] } },
    { target: 'binding:a__b', flow: { routes: [] } },
    { target: 'flow:a-b', flow: { routes: [] } },
  ]
  const snapshot: JsonValue = { basis: 'working-tree', revision: 'x', targets }
  const graph = renderFlowContext(snapshot)
  const definitions = (value: string) => [
    ...value.matchAll(/^ {4}([A-Za-z][A-Za-z0-9_]*)\["([^"\n]*)"\]/gm),
  ]
  const nodes = definitions(graph)
  expect(nodes).toHaveLength(6)
  expect(new Set(nodes.map((node) => node[1])).size).toBe(6)
  expect(graph).not.toContain('undefined')
  expect(graph).toContain('flow_a_b["flow:a-b"]')
  const focused = definitions(renderFlowContext(snapshot, { target: 'binding:a-b' }))
  for (const node of focused)
    expect(nodes.some((other) => other[1] === node[1] && other[2] === node[2])).toBe(true)
  const reordered = definitions(
    renderFlowContext({ ...(snapshot as object), targets: targets.toReversed() } as JsonValue),
  )
  expect(reordered.map((node) => node.slice(1)).sort()).toEqual(
    nodes.map((node) => node.slice(1)).sort(),
  )
})

test('configured topology retains literal framing and refuses oversized graphs without truncation', () => {
  const hostile = renderFlowContext({
    basis: 'working-tree',
    revision: 'x',
    targets: [
      {
        target: 'flow:a"<script>\u001b\u202e',
        flow: { settings: { label: 'a\u202eb' }, routes: [] },
      },
    ],
  })
  expect(hostile).not.toContain(String.fromCharCode(27))
  expect(hostile).not.toContain('<script>')
  expect(hostile).not.toContain('\u202e')
  expect(hostile).toContain('U+202E')
  const oversized = {
    targets: Array.from({ length: 257 }, (_, i) => ({ target: `flow:${i}`, flow: { routes: [] } })),
  }
  expect(renderFlowContext(oversized)).toContain('No graph was truncated')
  // Presentation limits do not remove exact configured records from explicit JSON inspection.
  expect((flowContextRecord(oversized, {}) as TopologyView).targets).toHaveLength(257)
})

test('working-tree topology remains unreviewed even when the project has no targets', () => {
  for (const targets of [
    [],
    [{ target: 'binding:work', state: 'unreviewed', flow: { routes: [] } }],
  ]) {
    expect(
      (
        flowContextRecord({ basis: 'working-tree', state: 'unreviewed', targets }, {}) as {
          state: string
        }
      ).state,
    ).toBe('unreviewed')
  }
})

test('approved configured Markdown uses awaited literal output without creating approval state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-topology-'))
  try {
    let output = ''
    expect(
      await main(['inspect', '--flow', '--approved'], {
        currentDirectory: root,
        terminalOutput: true,
        writeOutput: () => {
          throw Error('Unexpected styling')
        },
        writeRecord: async (value) => {
          await new Promise((resolve) => setImmediate(resolve))
          output += value
        },
      }),
    ).toBe(0)
    expect(output).toStartWith('# Configured topology')
    expect(await readdir(root)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
