import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import {
  type FoundationArchives,
  type FoundationQualification,
  foundationCommands,
  foundationResidue,
} from './host-foundation/materialize.js'

const example = resolve(import.meta.dir, '../../../../examples/support-case')
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

/** Real installed composition, not native Agent or model-quality qualification. */
export async function runInstalledSupportProject(options: {
  directory: string
  archives: FoundationArchives
  reporting: string
  qualification: FoundationQualification
}) {
  const { directory, archives, reporting, qualification } = options
  const command = foundationCommands(join(directory, 'commands'))
  const frozen = await Promise.all([archives.jig, archives.flow, reporting].map(hash))
  await put(directory, 'package.json', {
    name: 'installed-support-tooling',
    private: true,
    type: 'module',
    dependencies: {
      '@jigging/jig': `file:${archives.jig}`,
      '@jigging/flow': `file:${archives.flow}`,
      '@jigging/reporting': `file:${reporting}`,
    },
  })
  await command(['git', 'init', '--quiet'], directory)
  await command(
    [process.execPath, 'install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'],
    directory,
    120_000,
  )
  const project = join(directory, 'project')
  await cp(join(example, 'flows'), join(project, 'flows'), {
    recursive: true,
    filter: (source) => basename(source) !== 'node_modules',
  })
  await cp(join(example, 'fixtures'), join(project, 'fixtures'), { recursive: true })
  await put(project, 'package.json', {
    name: 'installed-support-project',
    private: true,
    type: 'module',
    workspaces: ['flows/*', 'libs/*'],
  })
  await put(
    project,
    'jig.ts',
    `import {defineJig,discover} from '@jigging/jig'
export default defineJig({flows:discover('flows'),bindings:discover('bindings'),
defaultProviders:{'https://jig.md/contracts/agent-run':'binding:assessment-task'}})
`,
  )
  await mkdir(join(project, 'bindings'))
  await cp(join(example, 'bindings/support.ts'), join(project, 'bindings/support.ts'))
  await put(
    project,
    'bindings/assessment-task.ts',
    `import {defineBinding} from '@jigging/jig'
export default defineBinding({package:'flows/assessment-task'})
`,
  )
  await put(project, 'flows/assessment-task/package.json', {
    name: 'support-assessment-task',
    private: true,
    type: 'module',
    dependencies: { '@jigging/flow': 'workspace:*' },
  })
  const bundle = join(example, 'flows/assess/contracts/agent-run')
  await cp(join(bundle, 'contract.json'), join(project, 'flows/assessment-task/FLOW.contract.json'))
  await cp(join(bundle, 'contracts'), join(project, 'flows/assessment-task/contracts'), {
    recursive: true,
  })
  // This ordinary bounded task parses explicit charge/amount requests. It does
  // actual domain work, never authorizes credit or manufactures execution evidence.
  await put(
    project,
    'flows/assessment-task/FLOW.ts',
    `import assert from 'node:assert/strict'
import {handle} from '@jigging/flow'
await handle(async run => {
  const {instructions,responseSchema} = run.input
  assert.equal(responseSchema.additionalProperties,false)
  assert.deepEqual(responseSchema.required,['chargeId','requestedCreditCents'])
  const request = JSON.parse(instructions.slice(instructions.lastIndexOf('\\n\\n')+2))
  const named = request.account.charges.filter(charge => request.message.includes(charge.id))
  const amount = /USD (\\d+)(?:\\.(\\d{2}))?/.exec(request.message)
  const structured = named.length === 1 && amount
    ? {chargeId:named[0].id,requestedCreditCents:Number(amount[1])*100+Number(amount[2] || 0)}
    : {chargeId:null,requestedCreditCents:0}
  return {outcome:'done',output:{text:JSON.stringify(structured),structured}}
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
  await command(
    [cli, 'review', '--yes', '--allow-authority-changes', '--allow-resolution-network'],
    project,
  )
  const lock = await hash(join(project, 'jig.lock'))
  for (const [fixture, disposition, reason, amount] of [
    ['duplicate', 'credit_eligible', 'verified_duplicate', 2400],
    ['not-duplicate', 'no_credit', 'no_duplicate_payment', 2400],
    ['over-limit', 'manual_review', 'above_credit_limit', 7500],
  ] as const) {
    const invoked = await command(
      [
        cli,
        'run',
        'binding:support',
        '--input',
        `@fixtures/${fixture}.json`,
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
    assert.equal(result.output.disposition, disposition)
    assert.equal(result.output.reason, reason)
    assert.deepEqual(result.output.proposal, { chargeId: 'ch-102', requestedCreditCents: amount })
    assert.deepEqual(
      result.output.credit,
      disposition === 'credit_eligible' ? { chargeId: 'ch-102', amountCents: amount } : null,
    )
    if (disposition !== 'no_credit') assert.match(result.output.reply, /No credit has been issued/)
  }
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
    application: 'support-case',
    scenarios: 3,
    residue: 'unchanged',
    archiveDigests: frozen,
  })
}
