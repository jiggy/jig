import { expect } from 'bun:test'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

type Command = (argv: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>

export async function checkInstalledFlowBehavior(cli: string, project: string, command: Command) {
  const put = async (path: string, source: string) => {
    const file = join(project, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, source)
  }
  const flow = async (name: string, source: string, uses?: Record<string, object>) => {
    await put(`flows/${name}/FLOW.ts`, source)
    await put(
      `flows/${name}/FLOW.meta.json`,
      JSON.stringify({ name, description: 'Source behavior fixture.', uses }),
    )
    await put(
      `flows/${name}/package.json`,
      JSON.stringify({
        name: 'behavior-' + name,
        private: true,
        type: 'module',
        dependencies: { '@jigging/flow': '0.1.0-alpha.15' },
      }),
    )
  }
  await put(
    'jig.ts',
    `
    import { defineJig, discover } from '@jigging/jig'
    export default defineJig({ flows: discover('flows'), bindings: discover('bindings'), entrypoint: 'binding:code' })
  `,
  )
  for (const [name, target] of [
    ['code', 'convert'],
    ['manual', 'opaque'],
  ]) {
    await put(
      `bindings/${name}.ts`,
      `
      import { defineBinding } from '@jigging/jig'
      export default defineBinding({ package: 'flows/import', slots: {
        converter: 'flow:flows/${target}', exporter: 'flow:flows/export',
      } })
    `,
    )
  }
  const method = (body: string) =>
    `import { handle } from '@jigging/flow'; await handle(async (run) => { ${body} });\n`
  const importer = method(`
    const converted = await run.call({ slot: 'converter', operationId: 'convert', input: {} })
    if (converted.outcome === 'blocked') return { outcome: 'done', output: { status: 'refused' } }
    if (converted.output.status === 'needs_mapping') return { outcome: 'done', output: { status: 'attention' } }
    return await run.call({ slot: 'exporter', operationId: 'export', input: converted.output })
  `)
  const converter = (status: string) =>
    method(`return { outcome: 'done', output: { status: '${status}' } }`)
  await flow('import', importer, { converter: {}, exporter: {} })
  await flow('convert', converter('ready'))
  await flow('export', method(`return { outcome: 'done', output: { status: 'exported' } }`))
  await flow(
    'opaque',
    method(`
    switch (run.input) {
      default: return { outcome: 'blocked', output: { reason: 'Manual decision required.' } }
    }
  `),
  )
  await put(
    'flows/opaque/FLOW.contract.json',
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      outcomes: { blocked: 'Manual decision required.' },
    }),
  )

  const inspect = (...args: string[]) => command([cli, 'inspect', '--flow', ...args], project)
  const before = await inspect()
  expect(before.stdout).toContain('# Source behavior')
  expect(before.stdout).toMatch(/\[converter\]\(#call-converter-[^)]+\) → \[exporter\]/)
  expect(before.stdout).toContain('exporter → flow:flows/export · outcome "done"')
  expect(before.stdout).toContain('status = "exported"')
  const baseline = await inspect('--snapshot')
  await put('behavior-before.json', baseline.stdout)
  const unchanged = await inspect('--compare', 'behavior-before.json')
  expect(unchanged.stdout).toContain('0 changed')
  await put('flows/convert/FLOW.ts', converter('needs_mapping'))
  const after = await inspect()
  const callerOnly = after.stdout.split('\n## binding:code\n')[1]?.split('\n## ')[0]
  expect(callerOnly).toContain('exporter → flow:flows/export')
  const consequences = callerOnly?.split('### Consequences')[1]
  expect(consequences).toContain('status = "attention"')
  expect(consequences).not.toContain('exporter → flow:flows/export')
  const changes = await inspect('--compare', 'behavior-before.json')
  const changedCaller = changes.stdout.split('\n## binding:code\n')[1]?.split('\n## ')[0]
  expect(changedCaller).toContain('Before ·')
  expect(changedCaller).toContain('exporter → flow:flows/export')
  expect(changedCaller).toContain('After ·')
  expect(changedCaller).toContain('status = "attention"')
  expect(changedCaller).toContain('(./flows/import/FLOW.ts#L')
  expect(changes.stdout).not.toContain('## binding:manual')
  const details = await inspect('--compare', 'behavior-before.json', '--all')
  expect(details.stdout).toContain('Before · source')
  expect(details.stdout).toContain('After · source')
  expect(before.stdout).toMatch(/Revision sha256:[a-f0-9]{64}/)
  expect(after.stdout.match(/Revision (sha256:[a-f0-9]{64})/)?.[1]).not.toBe(
    before.stdout.match(/Revision (sha256:[a-f0-9]{64})/)?.[1],
  )
  expect(await readFile(join(project, 'flows/import/FLOW.ts'), 'utf8')).toBe(importer)
  const alternative = await inspect('binding:manual')
  expect(alternative.stdout).toContain(
    '**Other configured uses of flows/import**\n\n- binding:code',
  )
  expect(alternative.stdout).toContain('Unsupported statement: SwitchStatement')
  expect(alternative.stdout).toContain('status = "refused"')
  const application = await inspect('--all')
  expect(application.stdout).toContain('## Application overview')
  expect(application.stdout).toMatch(/binding:code[^\n]+Project entrypoint[^\n]+attention/)
  expect(application.stdout).toMatch(/flow:flows\/export[^\n]+Direct Flow[^\n]+exported/)
  expect(application.stdout.match(/^## Flow flows\/import$/gm)).toHaveLength(1)
  expect(application.stdout).toContain('["binding:code"]')
  expect(application.stdout).toContain('["binding:manual"]')
  expect(application.stdout).toContain('flow:flows/opaque')
  expect((await readdir(project)).sort()).toEqual([
    'behavior-before.json',
    'bindings',
    'flows',
    'jig.ts',
  ])

  await command([cli, 'review', '--yes', '--allow-resolution-network'], project)
  const observed = await command([cli, 'run', 'binding:code', '--input', '{}', '--json'], project)
  expect(JSON.parse(observed.stdout)).toMatchObject({
    status: 'succeeded',
    outcome: 'done',
    output: { status: 'attention' },
  })

  const lock = await readFile(join(project, 'jig.lock'), 'utf8')
  const approved = await inspect('--approved', '--json')
  const entryWithHelper = "import './boundary.ts'\n" + importer
  await put('flows/import/FLOW.ts', entryWithHelper)
  await put('flows/convert/value.ts', 'export const value = "converter-owned"\n')
  await put('flows/import/boundary.ts', "export { value } from '../convert/value.ts'\n")
  const boundary = await inspect('binding:code')
  expect(boundary.stdout).toContain('flows/import/boundary.ts:1')
  expect(boundary.stdout).toContain('imports "../convert/value.ts", outside flows/import.')
  expect(boundary.stdout).toContain('binding:code · converter → flow:flows/convert')
  await expect(
    command([cli, 'review', '--yes', '--allow-resolution-network'], project),
  ).rejects.toThrow('PACKAGE_FLOW_IMPORT_OUTSIDE_CAPTURE')
  expect(await readFile(join(project, 'jig.lock'), 'utf8')).toBe(lock)
  expect((await inspect('--approved', '--json')).stdout).toBe(approved.stdout)

  await put('flows/import/local.ts', 'export const value = "caller-owned"\n')
  await put(
    'flows/import/boundary.ts',
    "import type { Missing } from '../convert/missing.ts'\nexport { value } from './local.ts'\nexport type Optional = Missing\n",
  )
  await put('flows/import/unused.ts', "export * from '../convert/missing.ts'\n")
  const local = await inspect('binding:code')
  expect(local.stdout).not.toContain('**Flow package boundary**')
  await command([cli, 'review', '--yes', '--allow-resolution-network'], project)
  const repaired = await command([cli, 'run', 'binding:code', '--input', '{}', '--json'], project)
  expect(JSON.parse(repaired.stdout)).toMatchObject({
    status: 'succeeded',
    output: { status: 'attention' },
  })
}
