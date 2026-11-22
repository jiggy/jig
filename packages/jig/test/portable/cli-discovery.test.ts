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
import { compareConfiguredRouting, renderCheck } from '../../src/cli-check.js'
import {
  approvedTargets,
  cliShellWord,
  completionScript,
  invocationGuide,
} from '../../src/cli-discovery.js'
import { flowContextRecord, renderFlowContext } from '../../src/cli-flow-context.js'
import { CheckError } from '../../src/diagnostics.js'
import type { JsonValue } from '../../src/json.js'

import { checkPackageDirectory } from '../../src/package/inspect.js'
import { createFlow, createProject } from '../../src/project-init.js'

type TopologyView = { targets: { target: string }[]; scope: Record<string, JsonValue> }

test('usage mistakes show one correction, not the entire manual', async () => {
  for (const [args, expected] of [
    [['rn'], 'Did you mean run?'],
    [['run', 'flow:flows/hello', '--timeot', '2m'], 'Did you mean --timeout?'],
    [['review', '--oops'], 'Unknown or repeated review option'],
    [['check', '--diff', '--diff'], 'Use only --diff and --json'],
    [['inspect', '--flow', '--find'], 'Specify --find with one search phrase'],
    [['inspect', '--flow', '--find', 'release', '--json'], 'Use --flow --find TEXT'],
    [['inspect', '--flow', '--find', 'release', 'binding:book'], 'Use --flow --find TEXT'],
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

test('composition diff compares exact selectors, caller slots, settings, and entrypoint targets', () => {
  const packageName = 'flows/worker'
  const row = (target: string, settings: JsonValue, routes: JsonValue[]) => ({
    target,
    package: packageName,
    flow: { settings, routes },
  })
  const approved = {
    entrypoint: `flow:${packageName} --input '1'`,
    targets: [
      row('binding:old', {}, []),
      row('binding:adjusted', { a: 1 }, []),
      row(`flow:${packageName}`, { a: 1, b: { x: [2, 3], z: 4 } }, [
        { slot: 'provider', resource: 'finite-acp' },
        { slot: 'optional', target: 'binding:old' },
      ]),
    ],
  }
  const working = {
    entrypoint: "flow:./flows/worker --input '2'",
    targets: [
      row(`flow:${packageName}`, { b: { z: 4, x: [2, 3] }, a: 1 }, [
        { slot: 'provider', resource: 'finite-acp' },
        { slot: 'extra', target: 'binding:adjusted' },
      ]),
      { ...row('binding:adjusted', { a: 2 }, []), package: 'flows/replacement' },
    ],
  }
  const expected = {
    basis: 'approved',
    targets: [
      { target: 'binding:adjusted', before: packageName, after: 'flows/replacement' },
      { target: 'binding:old', before: packageName, after: null },
    ],
    slots: [
      {
        caller: `flow:${packageName}`,
        slot: 'extra',
        before: null,
        after: { target: 'binding:adjusted' },
      },
      {
        caller: `flow:${packageName}`,
        slot: 'optional',
        before: { target: 'binding:old' },
        after: null,
      },
    ],
    settingsChanged: ['binding:adjusted'],
  }
  expect(compareConfiguredRouting(approved, working).diff).toEqual(expected)
  expect(
    compareConfiguredRouting(approved, { ...working, entrypoint: 'binding:adjusted' }).diff,
  ).toEqual({
    ...expected,
    entrypoint: { before: `flow:${packageName}`, after: 'binding:adjusted' },
  })
})

test('composition diff bounds split context and escapes captured identifiers', () => {
  const packagePath = 'flows/producer\n\u202e`'
  const direct = `flow:${packagePath}`
  const original = 'binding:shared-producer'
  const added = 'binding:offer-producer'
  const row = (target: string, packageName: string, slot = '', selected?: string) => ({
    target,
    package: packageName,
    flow: { routes: selected === undefined ? [] : [{ slot, target: selected }] },
  })
  const callers = Array.from({ length: 10 }, (_, index) => `binding:offer-${index}`)
  const retained = Array.from({ length: 10 }, (_, index) =>
    row(`binding:book-${index}`, 'flows/book', 'production', original),
  )
  const unchanged = [row(original, packagePath), ...retained, row(direct, packagePath)]
  const approved = {
    targets: [
      ...callers.map((caller) => row(caller, 'flows/offer', 'sample', original)),
      ...unchanged,
    ],
  }
  const working = {
    targets: [
      row(added, packagePath),
      ...callers.map((caller) => row(caller, 'flows/offer', 'sample', added)),
      ...unchanged,
    ].reverse(),
  }
  const comparison = compareConfiguredRouting(approved, working)
  const output = renderCheck(false, comparison)
  expect(output).toContain('Context omitted for additional Binding split slots: 2.')
  expect(output).toContain('More retained caller slots omitted: 2.')
  expect(output).toContain(
    'Direct Flow selector still configured: "flow:flows/producer\\u000a\\u202e`"',
  )
  expect(output).not.toContain('\u202e')
  expect(output).not.toContain('"binding:book-8"')
  expect(output).toContain('Slot "binding:offer-9" / "sample"')
  expect(JSON.parse(renderCheck(true, comparison))).toEqual({
    basis: 'working-tree',
    status: 'linked',
    diff: comparison.diff,
  })
  const directRemoved = { targets: working.targets.filter((target) => target.target !== direct) }
  expect(renderCheck(false, compareConfiguredRouting(approved, directRemoved))).not.toContain(
    'Direct Flow selector still configured',
  )
  const existing = { targets: [...approved.targets, row(added, packagePath)] }
  expect(renderCheck(false, compareConfiguredRouting(existing, working))).not.toContain(
    'Original selector still configured',
  )
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
    const rootNotes = join(project, 'AGENTS.md')
    await writeFile(rootNotes, '# Editorial team\n')
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
      'AGENTS.md',
      'FLOW.meta.json',
      'FLOW.ts',
      'package.json',
    ])
    expect((await checkPackageDirectory(join(project, 'flows/summarize'))).entrypoint.path).toBe(
      'FLOW.ts',
    )
    expect(await readFile(join(project, 'jig.ts'), 'utf8')).toBe(before)
    expect(await readFile(rootNotes, 'utf8')).toBe('# Editorial team\n')
    const flowNotes = join(project, 'flows/summarize/AGENTS.md')
    expect(await readFile(flowNotes, 'utf8')).toContain('# summarize Flow\n')
    await writeFile(flowNotes, '# Preserve citations\n')
    await expect(createFlow(project, 'summarize')).rejects.toMatchObject({ code: 'JIG_NEW_EXISTS' })
    expect(await readFile(flowNotes, 'utf8')).toBe('# Preserve citations\n')
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
  const orientation = graph.split('```mermaid')[0]!
  expect(orientation).toContain('binding:checked uses flows/repair.')
  expect(orientation).toContain('Other configured uses of flows/repair')
  expect(orientation).toContain('binding:single · called by binding:other-entry · single')
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

test('complete topology includes disconnected targets and resources without entrypoint focus', () => {
  const snapshot: JsonValue = {
    basis: 'working-tree',
    revision: 'complete',
    state: 'unreviewed',
    entrypoint: 'binding:main',
    targets: [
      { target: 'binding:main', package: 'flows/main', flow: { routes: [] } },
      {
        target: 'binding:separate',
        package: 'flows/separate',
        flow: { routes: [{ slot: 'fetch', resource: 'http-request' }] },
      },
    ],
  }
  expect((flowContextRecord(snapshot, {}) as TopologyView).scope.omittedTargets).toBe(1)
  const all = flowContextRecord(snapshot, { all: true }) as TopologyView
  expect(all.targets.map((target) => target.target)).toEqual(['binding:main', 'binding:separate'])
  expect(all.scope).toMatchObject({
    target: null,
    entrypoint: 'binding:main',
    omittedTargets: 0,
    omittedConnections: 0,
  })
  const text = renderFlowContext(snapshot, { all: true })
  expect(text).toContain('binding:separate')
  expect(text).toContain('http-request')
  expect(text).toContain('Entrypoint: binding:main.')
  expect(text).not.toContain('Root:')
  expect(() => flowContextRecord(snapshot, { all: true, target: 'binding:main' })).toThrow()
})

test('navigation places only slots selecting the same target beside its own selections', () => {
  const target = (id: string, pkg: string, routes: JsonValue[] = []) => ({
    target: id,
    package: pkg,
    flow: { routes },
  })
  const snapshot = {
    basis: 'working-tree',
    targets: [
      target('binding:books', 'flows/books', [{ slot: 'production', target: 'binding:produce' }]),
      target('flow:flows/offers', 'flows/offers', [{ slot: 'sample', target: 'binding:produce' }]),
      target('binding:archive', 'flows/books', [
        { slot: 'production', target: 'binding:archive-producer' },
      ]),
      target('binding:produce', 'flows/producer', [{ slot: 'review', target: 'flow:flows/read' }]),
      target('binding:archive-producer', 'flows/producer'),
      target('flow:flows/read', 'flows/read'),
    ],
  }
  const output = renderFlowContext(snapshot, {
    indexDeclarations: new Map([
      ['binding:books', 'config/(books).ts'],
      ['binding:produce', 'policy/producer.ts'],
    ]),
  })
  const row = output
    .split('\n')
    .find((line) => line.includes('`jig inspect --flow binding:produce`'))
  expect(row).toContain('[wiring](./policy/producer.ts)')
  expect(row).toContain('[binding:books · production](./config/%28books%29.ts)')
  expect(row).toContain('flow:flows/offers · sample')
  expect(row).toContain('Independent Run · binding:produce')
  expect(row).toContain('review → flow:flows/read')
  expect(row).not.toContain('archive')
  const archive = output
    .split('\n')
    .find((line) => line.includes('`jig inspect --flow binding:archive-producer`'))
  expect(archive).toBeDefined()
  expect(archive).not.toContain('Independent Run')
})

test('package inspection retains every configured use and its direct callers', () => {
  const item = (target: string, pkg: string, settings: JsonValue, routes: JsonValue = []) => ({
    target,
    package: pkg,
    state: 'environment-matches',
    flow: { settings, routes },
  })
  const snapshot: JsonValue = {
    revision: 'approved',
    entrypoint: 'binding:root',
    targets: [
      item('binding:root', 'flows/root', {}, [{ slot: 'work', target: 'binding:producer' }]),
      item('binding:producer', 'flows/producer', {}, [
        { slot: 'chapter', target: 'binding:chapter' },
        { slot: 'polish', target: 'binding:chapter' },
      ]),
      item('binding:comparison', 'flows/compare', {}, [
        { slot: 'baseline', target: 'binding:control' },
      ]),
      item('binding:chapter', 'flows/draft', { prompt: 'chapter', shared: { b: 2, a: 1 } }),
      item('binding:control', 'flows/draft', { shared: { a: 1, b: 2 } }),
      item('binding:standalone', 'flows/draft', { prompt: 'control', shared: { a: 1, b: 2 } }),
    ],
  }
  const options = { packagePath: 'flows/draft' }
  const view = flowContextRecord(snapshot, options) as TopologyView
  expect(view.scope).toMatchObject({
    target: null,
    package: 'flows/draft',
    configuredUses: ['binding:chapter', 'binding:control', 'binding:standalone'],
    omittedTargets: 1,
  })
  expect(view.targets.map((item) => item.target).sort()).toEqual([
    'binding:chapter',
    'binding:comparison',
    'binding:control',
    'binding:producer',
    'binding:standalone',
  ])
  const output = renderFlowContext(snapshot, options)
  expect(output).toContain('last locally approved configuration')
  expect(output).toContain(
    '### binding:chapter\n\n    jig inspect --flow --approved binding:chapter\n\nSettings that differ: prompt = "chapter".',
  )
  expect(output).toContain('- binding:producer · chapter\n- binding:producer · polish')
  expect(output).toContain(
    '### binding:control\n\n    jig inspect --flow --approved binding:control\n\nSettings that differ: prompt = unset.',
  )
  expect(output).toContain('- binding:comparison · baseline')
  expect(output).toContain('### binding:standalone')
  expect(output).toContain('No configured callers.')
  expect(output).not.toContain('shared')
  expect(output).not.toContain('binding:root')
  expect(renderFlowContext(snapshot, { packagePath: 'flows/unused' })).toContain(
    'No configured uses.',
  )
})

test('inspection grammar rejects conflicting scopes before host acquisition', async () => {
  for (const args of [
    ['inspect', '--all'],
    ['inspect', '--flow', '--all', '--all'],
    ['inspect', '--flow', '--all', 'binding:main'],
    ['inspect', '--flow', '--all', '--result', 'saved'],
    ['inspect', '--package', 'flows/repair'],
    ['inspect', '--flow', '--package'],
    ['inspect', '--flow', '--package', '../flows/repair'],
    ['inspect', '--flow', '--package', 'flows/repair', '--package', 'flows/retry'],
    ['inspect', '--flow', '--package', 'flows/repair', 'binding:main'],
    ['inspect', '--flow', '--package', 'flows/repair', 'flows/other'],
    ['inspect', '--flow', '--package', 'flows/repair', '--all'],
    ['inspect', '--flow', 'flows/repair', '--all'],
    ['inspect', '--flow', '../flows/repair'],
    ['inspect', 'flows/repair'],
    ['inspect', '--flow', '--package', 'flows/repair', '--snapshot'],
    ['inspect', '--flow', '--package', 'flows/repair', '--compare', 'before.json'],
  ]) {
    expect(privateCliRequiresHost(args)).toBe(false)
    expect(await main(args, { writeError: () => {} })).toBe(2)
  }
  expect(privateCliRequiresHost(['inspect', '--flow', '--package', './flows/repair'])).toBe(true)
  expect(
    privateCliRequiresHost(['inspect', '--flow', '--package', 'npm:@test/repair', '--approved']),
  ).toBe(false)
  expect(privateCliRequiresHost(['inspect', '--flow', '--all'])).toBe(true)
  expect(privateCliRequiresHost(['inspect', '--flow', '--snapshot'])).toBe(true)
  expect(privateCliRequiresHost(['inspect', '--flow', '--compare', 'before.json'])).toBe(true)
  expect(privateCliRequiresHost(['inspect', '--flow', '--compare', 'before.json', '--all'])).toBe(
    true,
  )
  for (const flags of [
    ['--snapshot'],
    ['--topology'],
    ['--flow', '--compare'],
    ['--flow', '--snapshot', '--approved'],
    ['--flow', '--snapshot', '--all'],
    ['--flow', '--compare', 'before.json', 'binding:main'],
    ['--flow', '--compare', 'before.json', '--json'],
    ['--flow', '--compare', 'before.json', '--snapshot'],
  ]) {
    expect(privateCliRequiresHost(['inspect', ...flags])).toBe(false)
    expect(await main(['inspect', ...flags], { writeError: () => {} })).toBe(2)
  }
  expect(privateCliRequiresHost(['inspect', '--flow', '--all', '--approved'])).toBe(false)
})

test('positional package and file paths select flow inspection', () => {
  for (const args of [
    ['inspect', '--flow', 'flows/repair'],
    ['inspect', './flows/repair', '--flow'],
    ['inspect', '--flow', 'flows/repair/FLOW.ts'],
  ]) {
    expect(privateCliRequiresHost(args)).toBe(true)
    expect(privateCliRequiresHost([...args, '--approved'])).toBe(false)
  }
})

test('unknown Flow selectors direct the reader to complete topology on the same basis', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-flow-selector-'))
  try {
    for (const approved of [false, true]) {
      for (const [selector, kind] of [
        ['flows/missing/FLOW.ts', 'PACKAGE'],
        ['binding:missing', 'TARGET'],
      ]) {
        let stderr = ''
        const args = ['inspect', '--flow', selector]
        if (approved) args.push('--approved')
        const code = await main(args, {
          currentDirectory: directory,
          terminalError: false,
          writeError: (value) => {
            stderr += value
          },
          host: {
            acquire: async () => {
              throw new Error('Inspection cannot acquire Run authority')
            },
            inspectFlowReport: async () => {
              throw new CheckError(
                'invalid',
                `INSPECTION_${kind}_MISSING`,
                'Selector did not match.',
              )
            },
          },
        })
        expect(code).toBe(1)
        expect(stderr).toContain(`Diagnostic code: JIG_${kind}_NOT_FOUND`)
        expect(stderr).toContain(
          `$ jig inspect --flow --topology --all${approved ? ' --approved' : ''}\n`,
        )
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
