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

  const inspect = (...args: string[]) =>
    command([cli, 'inspect', '--flow', '--behavior', ...args], project)
  const before = await inspect()
  expect(before.stdout).toContain('# Source behavior')
  expect(before.stdout).toMatch(/\[converter\]\(#call-converter-[^)]+\) → \[exporter\]/)
  expect(before.stdout).toContain('exporter → flow:flows/export · outcome "done"')
  expect(before.stdout).toContain('status = "exported"')
  await put('flows/convert/FLOW.ts', converter('needs_mapping'))
  const after = await inspect()
  const callerOnly = after.stdout.split('\n## binding:code\n')[1]?.split('\n## ')[0]
  expect(callerOnly).toContain('status = "attention"')
  expect(callerOnly).not.toContain('exporter → flow:flows/export')
  expect(before.stdout).toMatch(/Revision sha256:[a-f0-9]{64}/)
  expect(after.stdout.match(/Revision (sha256:[a-f0-9]{64})/)?.[1]).not.toBe(
    before.stdout.match(/Revision (sha256:[a-f0-9]{64})/)?.[1],
  )
  expect(await readFile(join(project, 'flows/import/FLOW.ts'), 'utf8')).toBe(importer)
  const alternative = await inspect('binding:manual')
  expect(alternative.stdout).toContain('Other configured uses of this implementation: binding:code')
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
  expect((await readdir(project)).sort()).toEqual(['bindings', 'flows', 'jig.ts'])

  await command([cli, 'review', '--yes', '--allow-resolution-network'], project)
  const observed = await command([cli, 'run', 'binding:code', '--input', '{}', '--json'], project)
  expect(JSON.parse(observed.stdout)).toMatchObject({
    status: 'succeeded',
    outcome: 'done',
    output: { status: 'attention' },
  })
}
