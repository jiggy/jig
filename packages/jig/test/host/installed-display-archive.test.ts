import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { settleTestCommand } from '../fixtures/bounded-command.js'
import {
  foundationCommands,
  foundationEnvironment,
  foundationResidue,
  freezeFoundationArchives,
  lockFoundationWorkspace,
  qualifyFoundationHost,
  requireFoundationOptIn,
} from '../fixtures/host-foundation/materialize.js'

requireFoundationOptIn()
const qualification = await qualifyFoundationHost()
const digest = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

test('installed final display publication preserves evidence and original receipts without restoring removed views or publishing checkpoints', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-installed-display-archive-')))
  let passed = false
  try {
    const command = foundationCommands(join(root, 'commands'))
    const archives = await freezeFoundationArchives(root, command)
    const reportingRoot = resolve(import.meta.dir, '../../../reporting')
    let reporting = process.env.REPORTING_PACKAGE_ARCHIVE
    if (!reporting) {
      const destination = join(root, 'reporting-pack')
      await mkdir(destination)
      await command(
        [process.execPath, 'pm', 'pack', '--ignore-scripts', '--destination', destination],
        reportingRoot,
        120_000,
      )
      const manifest = JSON.parse(await readFile(join(reportingRoot, 'package.json'), 'utf8'))
      reporting = join(destination, `jigging-reporting-${manifest.version}.tgz`)
    }
    const frozenReporting = join(root, 'archives/reporting.tgz')
    await copyFile(reporting, frozenReporting)
    assert.deepEqual(await readFile(frozenReporting), await readFile(reporting))
    const frozen = [archives.jig, archives.flow, frozenReporting]
    const frozenDigests = await Promise.all(
      frozen.map(async (path) => digest(await readFile(path))),
    )
    const candidates = {
      '@jigging/jig': `file:${archives.jig}`,
      '@jigging/flow': `file:${archives.flow}`,
      '@jigging/reporting': `file:${frozenReporting}`,
    }
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ private: true, dependencies: candidates, overrides: candidates }),
    )
    await command(
      [process.execPath, 'install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'],
      root,
      120_000,
    )
    const cli = join(root, 'node_modules/.bin/jig')
    const project = join(root, 'project')
    const put = async (path: string, value: string | object) => {
      const destination = join(project, path)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, typeof value === 'string' ? value : JSON.stringify(value), {
        flag: 'wx',
      })
    }
    await put('package.json', { private: true, type: 'module', workspaces: ['flows/*', 'libs/*'] })
    await put(
      'jig.ts',
      `import {defineJig,discover} from '@jigging/jig';
export default defineJig({flows:discover('flows'),bindings:discover('bindings')});`,
    )
    await mkdir(join(project, 'bindings'))
    await put('flows/report/package.json', {
      name: 'installed-display-report',
      version: '0.0.0',
      private: true,
      type: 'module',
      dependencies: { '@jigging/flow': 'workspace:*', '@jigging/reporting': 'workspace:*' },
    })
    await put('flows/report/FLOW.meta.json', {
      name: 'installed-display-report',
      description: 'Publish selected final material through ordinary declared output.',
      uses: { progress: { contract: './contracts/progress/contract.json' } },
    })
    await put('flows/report/FLOW.contract.json', {
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      attachments: { source: 'read', files: 'read-write' },
    })
    const report = 'Original delivered evidence.\n'
    const source = 'Original captured input.\n'
    await put('source/seed.txt', source)
    await put(
      'flows/report/FLOW.ts',
      `import {handle} from '@jigging/flow';
import {createDisplayBundle,encodeDisplayBundle,type DisplayPublicationContext} from '@jigging/reporting';
import {readFile,writeFile} from 'node:fs/promises';
await handle(async run=>{
  const task=run.input as unknown as {context:DisplayPublicationContext;requestId:string;checkpoint?:boolean};
  const sourcePort=run.attachments.source, filesPort=run.attachments.files;
  if(!sourcePort||!filesPort) throw Error('Required file ports are missing');
  const original=await readFile(sourcePort.path+'/seed.txt','utf8');
  const output={kind:'artifact',attachment:'files',path:'report.txt'} as const;
  const input={kind:'input-artifact',attachment:'source',path:'seed.txt'} as const;
  const view={kind:'view',id:'summary',title:'Application report',summary:original,
    target:{definitionId:'report',instanceKey:'example',subjectKey:'example'},
    sections:[{blocks:[{kind:'report',text:'Inspect exact captured evidence.',references:[output,input]}]}]} as const;
  const bundle=createDisplayBundle(task.context,{requestId:task.requestId,edition:'Accepted edition',
    views:[{view,completeness:'complete',domainRevision:'domain-1'}],requiredEvidence:[output,input]});
  const encoded=encodeDisplayBundle(bundle);
  if(task.checkpoint){
    await run.call({operationId:'checkpoint',slot:'progress',input:{sequence:1,evidence:{saved:true},
      files:{'display.json':encoded,'report.txt':${JSON.stringify(report)}}}});
    throw Error('Requested failure after accepted checkpoint');
  }
  await writeFile(filesPort.path+'/display.json',encoded);
  await writeFile(filesPort.path+'/report.txt',${JSON.stringify(report)});
  return {outcome:'done',output:{published:true}};
});`,
    )
    for (const [name, archive] of [
      ['flow', archives.flow],
      ['reporting', frozenReporting],
    ] as const) {
      const library = join(project, 'libs', name)
      await mkdir(library, { recursive: true })
      await command(['tar', '-xzf', archive, '--strip-components=1', '-C', library], root)
    }
    await command(['git', 'init', '--quiet'], project)
    await mkdir(join(project, 'flows/report/contracts'))
    await command(
      [cli, 'import-contract', 'jig:run-checkpoint', 'flows/report/contracts/progress'],
      project,
    )
    const before = await foundationResidue(qualification, command, root)
    const sourceLock = await lockFoundationWorkspace(project, command)
    await command([cli, 'review', '--yes'], project)
    assert.equal(await readFile(join(project, 'bun.lock'), 'utf8'), sourceLock)
    const approval = await readFile(join(project, 'jig.lock'), 'utf8')
    const context = JSON.parse((await command([cli, 'views', 'context', '--json'], project)).stdout)
    assert.deepEqual(context.heads, [])
    const task = { context, requestId: 'first-publication' }
    const runArguments = (input: object, packet: string) => [
      cli,
      'run',
      'flow:flows/report',
      '--input',
      JSON.stringify(input),
      '--attach',
      'source=source',
      '--out',
      join(root, packet),
      '--display-bundle',
      'files=display.json',
      '--timeout',
      '2m',
      '--json',
    ]
    const accepted = JSON.parse((await command(runArguments(task, 'first-packet'), project)).stdout)
    assert.equal(accepted.status, 'succeeded')
    assert.equal(accepted.delivery.source, 'final')
    assert.equal(accepted.delivery.status, 'written')
    const lookup = async (request: string) =>
      JSON.parse(
        (
          await command(
            [
              cli,
              'views',
              'receipt',
              '--request',
              request,
              '--generation',
              context.generation,
              '--json',
            ],
            project,
          )
        ).stdout,
      )
    const receipt = await lookup(task.requestId)
    assert.equal(receipt.kind, 'display-receipt')
    assert.equal(receipt.generation, context.generation)
    assert.deepEqual(receipt.source, { runId: accepted.runId, sourceId: 'root' })
    assert.equal(
      receipt.capturedBundleDigest,
      digest(await readFile(join(root, 'first-packet/files/display.json'))),
    )
    assert.equal(receipt.targets.length, 1)
    for (const [kind, attachment, path, text] of [
      ['artifact', 'files', 'report.txt', report],
      ['input-artifact', 'source', 'seed.txt', source],
    ] as const) {
      const evidence = receipt.evidence.find(
        (item: { reference: { kind: string; attachment?: string; path?: string } }) =>
          item.reference.kind === kind &&
          item.reference.attachment === attachment &&
          item.reference.path === path,
      )
      assert.ok(evidence)
      assert.equal(evidence.state, 'retained')
      assert.equal(evidence.digest, digest(new TextEncoder().encode(text)))
      assert.equal(evidence.bytes, Buffer.byteLength(text))
    }
    const list = async (definition = 'report', instance = 'example') =>
      JSON.parse(
        (
          await command(
            [cli, 'views', 'list', '--definition', definition, '--instance', instance, '--json'],
            project,
          )
        ).stdout,
      )
    const retained = await list()
    assert.equal(retained.matched, 1)
    assert.equal(retained.omitted, 0)
    assert.equal(retained.views[0].publication.view.summary, source)
    assert.deepEqual(retained.views[0].source, receipt.source)
    assert.equal(retained.views[0].revision, receipt.targets[0].revision)
    assert.equal((await list('report', 'absent')).matched, 0)
    // Mutable delivery paths cannot change retained acceptance or evidence metadata.
    await rm(join(root, 'first-packet'), { recursive: true })
    assert.deepEqual(await lookup(task.requestId), receipt)
    assert.deepEqual(await list(), retained)
    await command(
      [
        cli,
        'views',
        'remove',
        '--definition',
        'report',
        '--instance',
        'example',
        '--expected-revision',
        receipt.targets[0].revision,
      ],
      project,
    )
    assert.equal((await list()).matched, 0)
    assert.deepEqual(await lookup(task.requestId), receipt)
    const replay = JSON.parse(
      (await command(runArguments(task, 'recovery-packet'), project)).stdout,
    )
    assert.equal(replay.status, 'succeeded')
    assert.notEqual(replay.runId, accepted.runId)
    assert.deepEqual(await lookup(task.requestId), receipt)
    assert.equal(
      (await list()).matched,
      0,
      'Recovering acceptance must not reinstall a removed view',
    )
    assert.deepEqual(await foundationResidue(qualification, command, root), before)
    const checkpointContext = JSON.parse(
      (await command([cli, 'views', 'context', '--json'], project)).stdout,
    )
    const failed = await settleTestCommand(
      Bun.spawn(
        runArguments(
          {
            context: checkpointContext,
            requestId: 'checkpoint-only',
            checkpoint: true,
          },
          'checkpoint-packet',
        ),
        {
          cwd: project,
          env: foundationEnvironment(),
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ),
      {
        evidence: join(root, 'checkpoint-publication-refusal'),
        timeoutMs: 195_000,
        graceMs: 10_000,
      },
    )
    assert.equal(failed.code, 2)
    const checkpoint = JSON.parse(failed.stdout)
    assert.equal(checkpoint.status, 'failed')
    assert.equal(checkpoint.delivery.status, 'written')
    assert.equal(checkpoint.delivery.source, 'checkpoint')
    assert.equal(checkpoint.checkpoint.sequence, 1)
    assert.equal(await readFile(join(root, 'checkpoint-packet/files/report.txt'), 'utf8'), report)
    assert.equal(
      JSON.parse(await readFile(join(root, 'checkpoint-packet/files/display.json'), 'utf8'))
        .requestId,
      'checkpoint-only',
    )
    assert.ok(failed.stderr.includes('JIG_DISPLAY_BUNDLE_UNAVAILABLE'))
    const absent = await settleTestCommand(
      Bun.spawn(
        [
          cli,
          'views',
          'receipt',
          '--request',
          'checkpoint-only',
          '--generation',
          context.generation,
          '--json',
        ],
        {
          cwd: project,
          env: foundationEnvironment(),
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ),
      { evidence: join(root, 'checkpoint-receipt-absent'), timeoutMs: 120_000, graceMs: 10_000 },
    )
    assert.equal(absent.code, 1)
    assert.equal(JSON.parse(absent.stdout), null)
    assert.equal((await list()).matched, 0)
    assert.equal(await readFile(join(project, 'jig.lock'), 'utf8'), approval)
    assert.equal(await readFile(join(project, 'source/seed.txt'), 'utf8'), source)
    assert.deepEqual(await foundationResidue(qualification, command, root), before)
    assert.deepEqual(
      await Promise.all(frozen.map(async (path) => digest(await readFile(path)))),
      frozenDigests,
    )
    passed = true
  } finally {
    if (passed) await rm(root, { recursive: true, force: true })
    else console.error(`Installed display consumer and bounded transcripts retained at ${root}`)
  }
}, 900_000)
