import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import {
  type FoundationArchives,
  type FoundationQualification,
  foundationCommands,
  foundationResidue,
  lockFoundationWorkspace,
} from './host-foundation/materialize.js'

const example = resolve(import.meta.dir, '../../../../examples/kitchen-roster')
const hash = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

async function put(root: string, path: string, value: string | object) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value), {
    flag: 'wx',
  })
}

/** Real installed composition with a deterministic public proposal Flow. */
export async function runInstalledKitchenProject(options: {
  directory: string
  archives: FoundationArchives
  reporting: string
  qualification: FoundationQualification
}) {
  const { directory, archives, reporting, qualification } = options
  const command = foundationCommands(join(directory, 'commands'))
  const frozen = await Promise.all([archives.jig, archives.flow, reporting].map(hash))
  const candidates = {
    '@jigging/jig': `file:${archives.jig}`,
    '@jigging/flow': `file:${archives.flow}`,
    '@jigging/reporting': `file:${reporting}`,
  }
  await put(directory, 'package.json', {
    name: 'installed-kitchen-tooling',
    private: true,
    type: 'module',
    dependencies: candidates,
    overrides: candidates,
  })
  await command(['git', 'init', '--quiet'], directory)
  await command(
    [process.execPath, 'install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'],
    directory,
    120_000,
  )
  const project = join(directory, 'project')
  for (const name of ['roster', 'read-roster', 'check-roster', 'export-roster']) {
    await cp(join(example, 'flows', name), join(project, 'flows', name), {
      recursive: true,
      filter: (source) => basename(source) !== 'node_modules',
    })
  }
  await cp(join(example, 'fixtures'), join(project, 'fixtures'), { recursive: true })
  await put(project, 'package.json', {
    name: 'installed-kitchen-project',
    private: true,
    type: 'module',
    workspaces: ['flows/*', 'libs/*'],
  })
  await put(
    project,
    'jig.ts',
    `import {defineJig,discover} from '@jigging/jig'
export default defineJig({flows:discover('flows'),bindings:discover('bindings')})
`,
  )
  await mkdir(join(project, 'bindings'))
  await cp(join(example, 'bindings/roster.ts'), join(project, 'bindings/roster.ts'))
  await put(
    project,
    'bindings/propose.ts',
    `import {defineBinding} from '@jigging/jig'
export default defineBinding({package:'flows/proposal-task'})
`,
  )
  await put(project, 'flows/proposal-task/package.json', {
    name: 'kitchen-proposal-task',
    private: true,
    type: 'module',
    dependencies: { '@jigging/flow': 'workspace:*' },
  })
  await cp(
    join(example, 'flows/propose-roster/FLOW.contract.json'),
    join(project, 'flows/proposal-task/FLOW.contract.json'),
  )
  await cp(
    join(example, 'flows/propose-roster/contracts'),
    join(project, 'flows/proposal-task/contracts'),
    { recursive: true },
  )
  // This independent method performs a bounded exhaustive feasibility search.
  // It does not impersonate an Agent client or replace native host machinery.
  await put(
    project,
    'flows/proposal-task/FLOW.ts',
    `import {handle} from '@jigging/flow'
await handle(async run => {
  const {scenario} = run.input
  const tasks = scenario.shifts.flatMap(shift =>
    ['cook','serve'].map(role => ({shift,role})))
  const assignments = []
  const chosen = []
  function search(index) {
    run.signal.throwIfAborted()
    if (index === tasks.length) return true
    const {shift,role} = tasks[index]
    for (const person of scenario.volunteers) {
      if (!person.roles.includes(role)) continue
      if (!person.available.some(interval =>
        interval.from <= shift.from && interval.until >= shift.until)) continue
      const previous = chosen.filter(item => item.volunteerId === person.id)
      if (previous.some(item => item.from < shift.until && shift.from < item.until)) continue
      const minutes = previous.reduce((total,item) => total + item.until - item.from,0)
      if (minutes + shift.until - shift.from > person.maxMinutes) continue
      assignments.push({shiftId:shift.id,role,volunteerId:person.id})
      chosen.push({volunteerId:person.id,from:shift.from,until:shift.until})
      if (search(index + 1)) return true
      assignments.pop()
      chosen.pop()
    }
    return false
  }
  const possible = search(0)
  return {outcome:'done',output:possible
    ? {status:'proposed',reason:'',assignments}
    : {status:'review',reason:'No complete feasible roster.',assignments:[]}}
})
`,
  )
  for (const [name, archive] of [
    ['flow', archives.flow],
    ['reporting', reporting],
  ] as const) {
    const library = join(project, 'libs', name)
    await mkdir(library, { recursive: true })
    await command(['tar', '-xzf', archive, '--strip-components=1', '-C', library], directory)
  }
  const cli = join(directory, 'node_modules/.bin/jig')
  const before = await foundationResidue(qualification, command, directory)
  const sourceBefore = await readFile(join(project, 'fixtures/feasible/scenario.json'))
  const sourceLock = await lockFoundationWorkspace(project, command)
  await command([cli, 'review', '--yes', '--allow-authority-changes'], project)
  assert.equal(await readFile(join(project, 'bun.lock'), 'utf8'), sourceLock)
  const lock = await hash(join(project, 'jig.lock'))
  const packet = join(directory, 'packet')
  const invoked = await command(
    [
      cli,
      'run',
      'binding:roster',
      '--input',
      '{}',
      '--attach',
      'source=fixtures/feasible',
      '--out',
      packet,
      '--timeout',
      '2m',
      '--json',
    ],
    project,
  )
  const result = JSON.parse(invoked.stdout)
  assert.equal(result.status, 'succeeded')
  assert.equal(result.outcome, 'done')
  assert.equal(result.cleanup, undefined)
  assert.equal(result.output.status, 'ready')
  assert.equal(result.output.count, 8)
  assert.equal(result.output.roster, 'schedule/roster.csv')
  assert.equal(result.output.rows.length, 8)
  const csv = await readFile(join(packet, 'files/schedule/roster.csv'))
  const lines = [
    'shift,start,end,role,volunteer_id,volunteer',
    'shift-1,09:00,10:00,cook,alex,Alex',
    'shift-1,09:00,10:00,serve,bea,Bea',
    'shift-2,10:00,11:00,cook,alex,Alex',
    'shift-2,10:00,11:00,serve,bea,Bea',
    'shift-3,11:00,12:00,cook,casey,Casey',
    'shift-3,11:00,12:00,serve,drew,Drew',
    'shift-4,12:00,13:00,cook,casey,Casey',
    'shift-4,12:00,13:00,serve,drew,Drew',
    '',
  ]
  assert.equal(csv.toString('utf8'), lines.join('\n'))
  assert.equal(result.delivery.status, 'written')
  assert.equal(result.delivery.source, 'final')
  assert.deepEqual(result.delivery.files, [
    {
      path: 'schedule/roster.csv',
      bytes: csv.length,
      digest: `sha256:${createHash('sha256').update(csv).digest('hex')}`,
    },
  ])
  assert.deepEqual(await readdir(join(packet, 'files')), ['schedule'])
  assert.deepEqual(await readdir(join(packet, 'files/schedule')), ['roster.csv'])
  assert.deepEqual(await readFile(join(project, 'fixtures/feasible/scenario.json')), sourceBefore)
  const stoppedPacket = join(directory, 'impossible-packet')
  const impossible = await command(
    [
      cli,
      'run',
      'binding:roster',
      '--input',
      '{}',
      '--attach',
      'source=fixtures/impossible',
      '--out',
      stoppedPacket,
      '--timeout',
      '2m',
      '--json',
    ],
    project,
  )
  const stopped = JSON.parse(impossible.stdout)
  assert.equal(stopped.status, 'succeeded')
  assert.equal(stopped.outcome, 'blocked')
  assert.equal(stopped.cleanup, undefined)
  assert.deepEqual(stopped.output, {
    reason: 'No qualified, available volunteer can cover shift-4 as cook.',
  })
  assert.equal(stopped.delivery.status, 'written')
  // No artifact was forwarded: this packet retains only the stopped result.
  assert.equal(stopped.delivery.source, 'none')
  assert.deepEqual(stopped.delivery.files, [])
  assert.deepEqual(await readdir(join(stoppedPacket, 'files')), [])
  assert.equal(await hash(join(project, 'jig.lock')), lock)
  assert.deepEqual(
    (await readdir(join(project, '.jig/private-root-owners'))).filter((name) =>
      /^(x-|c-)/.test(name),
    ),
    [],
  )
  assert.deepEqual(await foundationResidue(qualification, command, directory), before)
  assert.deepEqual(await Promise.all([archives.jig, archives.flow, reporting].map(hash)), frozen)
  await put(directory, 'verified.json', {
    application: 'kitchen-roster',
    assignments: 8,
    impossible: 'blocked',
    residue: 'unchanged',
    archiveDigests: frozen,
  })
}
