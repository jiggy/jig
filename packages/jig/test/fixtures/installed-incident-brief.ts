import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import {
  type FoundationArchives,
  type FoundationQualification,
  foundationCommands,
  foundationResidue,
  lockFoundationWorkspace,
} from './host-foundation/materialize.js'

const application = resolve(import.meta.dir, 'incident-brief')
const hash = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

async function tree(directory: string, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const path = join(prefix, entry.name)
    if (entry.isDirectory()) Object.assign(result, await tree(directory, path))
    else {
      assert.ok((await lstat(join(directory, path))).isFile())
      result[path] = await hash(join(directory, path))
    }
  }
  return result
}

export type IncidentScenario = 'replacement' | 'commentary' | 'budget' | 'refused-successor'

/** Ordinary archive input, never a rewritten runtime or native session fixture. */
export async function freezeIncidentLibraries(
  root: string,
  command: ReturnType<typeof foundationCommands>,
) {
  const result: Record<string, string> = {}
  for (const [name, variable] of [
    ['reporting', 'REPORTING_PACKAGE_ARCHIVE'],
    ['agent-method', 'AGENT_METHOD_PACKAGE_ARCHIVE'],
  ] as const) {
    const directory = resolve(import.meta.dir, '../../../', name)
    let source = process.env[variable]
    if (!source) {
      const destination = join(root, `${name}-pack`)
      await mkdir(destination)
      await command(
        [process.execPath, 'pm', 'pack', '--ignore-scripts', '--destination', destination],
        directory,
        120_000,
      )
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      source = join(destination, `jigging-${name}-${manifest.version}.tgz`)
    }
    const frozen = join(root, 'archives', `${name}.tgz`)
    await copyFile(source, frozen)
    assert.equal(await hash(frozen), await hash(source))
    result[name] = frozen
  }
  return result
}

export async function runInstalledIncident(options: {
  directory: string
  archives: FoundationArchives
  libraries: Record<string, string>
  qualification: FoundationQualification
  scenario: IncidentScenario
}) {
  const { directory, archives, libraries, qualification, scenario } = options
  await mkdir(directory)
  const command = foundationCommands(join(directory, 'commands'))
  const packages = { jig: archives.jig, flow: archives.flow, ...libraries }
  const hashes = await Promise.all(Object.values(packages).map(hash))
  const candidates = Object.fromEntries(
    Object.entries(packages).map(([name, path]) => [`@jigging/${name}`, `file:${path}`]),
  )
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: candidates,
      // Bind peer edges as well as direct dependencies to these frozen candidates.
      // Direct file declarations alone do not bind Bun's complete peer graph.
      overrides: candidates,
    }),
  )
  await command(['git', 'init', '--quiet'], directory)
  await command(
    [process.execPath, 'install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'],
    directory,
    120_000,
  )
  const reporting = await realpath(join(directory, 'node_modules/@jigging/reporting'))
  assert.equal(
    await realpath(Bun.resolveSync('@jigging/flow', reporting)),
    await realpath(Bun.resolveSync('@jigging/flow', directory)),
    'Reporting must use the same frozen SDK as the ordinary consumer',
  )
  const project = join(directory, 'project')
  await cp(application, project, {
    recursive: true,
    filter: (path) =>
      path !== join(application, 'package.json') &&
      !['node_modules', '.jig', 'test', 'grants', 'AGENTS.md'].includes(basename(path)),
  })
  await mkdir(join(project, 'grants'))
  assert.deepEqual(await tree(join(project, 'flows')), await tree(join(application, 'flows')))
  // The application Flows and their manifests remain byte-for-byte unchanged.
  // Frozen public libraries become ordinary declared workspace members.
  for (const [name, archive] of Object.entries({ flow: archives.flow, ...libraries })) {
    const library = join(project, 'libs', name)
    await mkdir(library, { recursive: true })
    await command(['tar', '-xzf', archive, '--strip-components=1', '-C', library], directory)
    assert.deepEqual(
      await tree(library),
      await tree(join(directory, 'node_modules/@jigging', name)),
    )
  }
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      workspaces: ['flows/*', 'libs/*'],
    }),
  )
  const peer = join(project, 'flows/agent-task')
  await mkdir(peer)
  await copyFile(join(application, 'test/agent-task.ts.txt'), join(peer, 'FLOW.ts'))
  await cp(
    join(application, 'flows/worker/contracts/agent-run/contracts'),
    join(peer, 'contracts'),
    { recursive: true },
  )
  await copyFile(
    join(application, 'flows/worker/contracts/agent-run/contract.json'),
    join(peer, 'FLOW.contract.json'),
  )
  await writeFile(
    join(peer, 'package.json'),
    JSON.stringify({
      name: 'incident-agent-task',
      private: true,
      type: 'module',
      dependencies: { '@jigging/flow': 'workspace:*' },
    }),
  )
  await writeFile(join(peer, 'FLOW.meta.json'), JSON.stringify({ supports: ['conversation'] }))
  await writeFile(
    join(peer, 'settings.schema.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/schema-0.json',
      type: 'object',
      properties: { refuseSuccessor: { type: 'boolean' } },
      additionalProperties: false,
    }),
  )
  await writeFile(
    join(project, 'bindings/agent.ts'),
    `import {defineBinding} from '@jigging/jig'
export default defineBinding({package:'flows/agent-task',settings:{refuseSuccessor:${scenario === 'refused-successor'}}})
`,
  )
  const cli = join(directory, 'node_modules/.bin/jig')
  const before = await foundationResidue(qualification, command, directory)
  const sourceLock = await lockFoundationWorkspace(project, command)
  await command([cli, 'review', '--yes', '--allow-authority-changes'], project)
  assert.equal(await readFile(join(project, 'bun.lock'), 'utf8'), sourceLock)
  const lock = await hash(join(project, 'jig.lock'))
  // Remove all mutable methods after approval: execution must use admitted bytes.
  await rm(join(project, 'flows'), { recursive: true })
  const original = JSON.parse(await readFile(join(application, 'input.json'), 'utf8'))
  const { replacement: _replacement, ...withoutReplacement } = original
  const input =
    scenario === 'commentary'
      ? withoutReplacement
      : scenario === 'budget'
        ? { ...original, turnBudget: 2 }
        : original
  const invoked = await command(
    [cli, 'run', 'binding:brief', '--input', JSON.stringify(input), '--timeout', '3m', '--json'],
    project,
  )
  const result = JSON.parse(invoked.stdout)
  assert.equal(result.status, 'succeeded')
  assert.equal(result.output.results.length, 2)
  assert.equal(result.output.results[0].role, 'draft')
  assert.equal(result.output.results[1].role, 'independent')
  const draft = result.output.results[0].result
  const reviewer = result.output.results[1].result
  assert.equal(reviewer.outcome, 'done')
  assert.equal(reviewer.output.requestedTurns, 2)
  if (scenario !== 'budget') assert.equal(reviewer.output.publication.status, 'submitted')
  else assert.ok(['submitted', 'failed'].includes(reviewer.output.publication.status))
  assert.match(reviewer.output.questions, /What evidence establishes causation/)
  assert.deepEqual(reviewer.output.settlement, { outcome: 'done', output: { turns: 2 } })
  if (scenario === 'budget') {
    assert.equal(result.outcome, 'blocked')
    assert.equal(draft.output.requestedTurns, 0)
    assert.equal(draft.output.successor, null)
    assert.equal(draft.output.predecessor, null)
  } else {
    assert.deepEqual(draft.output.predecessor, { outcome: 'done', output: { turns: 2 } })
    assert.equal(draft.output.requestedTurns, scenario === 'commentary' ? 2 : 3)
    assert.equal(draft.output.revision, scenario === 'refused-successor' ? undefined : 1)
    if (scenario === 'commentary') {
      assert.equal(draft.output.successor, null)
      assert.equal(draft.output.handoff, null)
      assert.equal(result.outcome, 'done')
    } else {
      assert.equal(draft.output.handoff.remainingTurns, 1)
      assert.equal(draft.output.handoff.summaryIsModelText, true)
      assert.equal(draft.output.handoff.reviewNotesAreModelText, true)
      assert.deepEqual(draft.output.handoff.snapshot.files, original.replacement.files)
      assert.deepEqual(
        draft.output.handoff.snapshot.laterInstructions,
        original.replacement.laterInstructions,
      )
      assert.equal(draft.output.handoff.snapshot.earlierContext, original.earlierContext)
      assert.match(draft.output.handoff.summary, /Partial work, not verified evidence/)
      assert.equal(draft.output.revisions.length, 1)
      assert.equal(
        draft.output.successor.outcome,
        scenario === 'refused-successor' ? 'blocked' : 'done',
      )
      assert.equal(result.outcome, scenario === 'refused-successor' ? 'blocked' : 'done')
      if (scenario === 'replacement') {
        assert.match(draft.output.brief, /09:47/)
        assert.match(draft.output.brief, /47-minute duration/)
      }
    }
  }
  for (const excerpt of [result.output.brief, result.output.questions])
    assert.ok(JSON.stringify(excerpt).length <= 800)
  assert.equal(await hash(join(project, 'jig.lock')), lock)
  assert.deepEqual(await Promise.all(Object.values(packages).map(hash)), hashes)
  for (const name of ['private-root-owners', 'private-root-materializations'])
    assert.deepEqual(
      (await readdir(join(project, '.jig', name))).filter((name) =>
        /^(a-|c-|x-|child-)/.test(name),
      ),
      [],
    )
  assert.deepEqual(await foundationResidue(qualification, command, directory), before)
}
