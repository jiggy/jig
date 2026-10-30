import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)))
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path)
  }
  return files.sort()
}

/** Check the authored declarations and real package imports, without launching a Run. */
export async function checkExampleProject(directory: string): Promise<void> {
  const root = resolve(directory)
  const projectPath = join(root, 'jig.ts')
  const project = (await import(pathToFileURL(projectPath).href)).default
  assert.ok(project && typeof project === 'object', 'jig.ts must export a project definition')
  assert.ok(
    typeof project.entrypoint === 'string' && project.entrypoint.trim(),
    'The example must declare a default entrypoint',
  )

  // Import the original declarations: defineBinding validates them against the
  // installed candidate's public API. No alternate project definition is written.
  const bindings = await sourceFiles(join(root, 'bindings'))
  assert.ok(bindings.length, 'The example must include Binding declarations')
  for (const path of bindings) {
    const binding = (await import(pathToFileURL(path).href)).default
    assert.equal(binding?.kind, 'package', `Invalid Binding declaration: ${path}`)
  }

  // FLOW.ts calls handle() at module startup. Compile its actual dependency
  // closure here; the application's tests exercise its procedure separately.
  const flows = (await sourceFiles(join(root, 'flows'))).filter(
    (path) => basename(path) === 'FLOW.ts',
  )
  assert.ok(flows.length, 'The example must include executable Flows')
  const built = await Bun.build({
    entrypoints: [projectPath, ...bindings, ...flows],
    target: 'bun',
    format: 'esm',
    write: false,
  }).catch((cause: unknown) => {
    throw new Error('Example package compilation failed', { cause })
  })
  if (!built.success) throw new AggregateError(built.logs, 'Example package compilation failed')
  console.log(
    `Example source smoke passed: ${basename(root)} (${flows.length} Flows, ${bindings.length} Bindings)`,
  )
}

if (import.meta.main) {
  assert.equal(process.argv.length, 3, 'Usage: bun scripts/check-example-project.ts PROJECT')
  const directory = process.argv[2]
  assert.ok(directory, 'An example directory is required')
  await checkExampleProject(directory)
}
