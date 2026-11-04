import { constants, Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type FoundationArchives,
  type FoundationQualification,
  foundationCommands,
  foundationResidue,
  lockFoundationWorkspace,
} from './host-foundation/materialize.js'

/** Qualify actual child cancellation after an acknowledged save in a fresh installed consumer. */
export async function runInstalledChildCheckpointCancellation(
  directory: string,
  archives: FoundationArchives,
  qualification: FoundationQualification,
): Promise<void> {
  await mkdir(directory)
  const command = foundationCommands(join(directory, 'commands'))
  const before = await foundationResidue(qualification, command, directory)
  async function put(path: string, value: string | object) {
    const destination = join(directory, path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, typeof value === 'string' ? value : JSON.stringify(value), {
      flag: 'wx',
    })
  }
  await put('package.json', {
    private: true,
    type: 'module',
    dependencies: {
      '@jigging/jig': `file:${archives.jig}`,
      '@jigging/flow': `file:${archives.flow}`,
    },
  })
  await command(['git', 'init', '--quiet'], directory)
  await command(
    [process.execPath, 'install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'],
    directory,
    120_000,
  )
  await put('project/package.json', {
    private: true,
    type: 'module',
    workspaces: ['flows/*', 'libs/*'],
  })
  await put(
    'project/jig.ts',
    `import {defineJig,discover} from '@jigging/jig';
export default defineJig({flows:discover('flows'),bindings:discover('bindings')});`,
  )
  const schema = 'https://flow.jig.md/schemas/invocation-contract-0.schema.json'
  for (const [name, source] of Object.entries(flowSources)) {
    await put(`project/flows/${name}/package.json`, {
      name: `child-checkpoint-cancellation-${name}`,
      private: true,
      version: '0.0.0',
      type: 'module',
      dependencies: { '@jigging/flow': 'workspace:*' },
    })
    await put(`project/flows/${name}/FLOW.meta.json`, {
      name,
      description: 'Preserve accepted child work after local cancellation and confirmed cleanup.',
      uses:
        name === 'outer'
          ? { router: {} }
          : name === 'router'
            ? { worker: {}, retrieve: { contract: './contracts/child-checkpoint/contract.json' } }
            : { progress: { contract: './contracts/progress/contract.json' } },
    })
    await put(`project/flows/${name}/FLOW.contract.json`, {
      $schema: schema,
      ...(name === 'worker'
        ? { channels: { ready: { direction: 'send' }, hold: { direction: 'receive' } } }
        : { artifactResults: ['checkpoint'] }),
    })
    await put(`project/flows/${name}/FLOW.ts`, source)
  }
  await put(
    'project/bindings/outer.ts',
    `import {defineBinding} from '@jigging/jig';
export default defineBinding({package:'flows/outer',slots:{router:'binding:router'}});`,
  )
  await put(
    'project/bindings/router.ts',
    `import {defineBinding} from '@jigging/jig';
export default defineBinding({package:'flows/router',slots:{worker:'flow:flows/worker'}});`,
  )
  const project = join(directory, 'project')
  await mkdir(join(project, 'libs/flow'), { recursive: true })
  await command(
    ['tar', '-xzf', archives.flow, '--strip-components=1', '-C', join(project, 'libs/flow')],
    directory,
  )
  const cli = join(directory, 'node_modules/.bin/jig')
  for (const [name, native, destination] of [
    ['worker', 'jig:run-checkpoint', 'progress'],
    ['router', 'jig:child-checkpoint', 'child-checkpoint'],
  ] as const) {
    await mkdir(join(project, `flows/${name}/contracts`), { recursive: true })
    await command(
      [cli, 'import-contract', native, `flows/${name}/contracts/${destination}`],
      project,
    )
  }
  const sourceLock = await lockFoundationWorkspace(project, command)
  await command([cli, 'review', '--yes'], project)
  assert.equal(await readFile(join(project, 'bun.lock'), 'utf8'), sourceLock)
  await put('client.ts', consumer)
  await command(
    [process.execPath, '--no-env-file', '--no-install', join(directory, 'client.ts'), cli],
    project,
    600_000,
  )
  const database = Database.open(
    join(project, '.jig/jig.sqlite3'),
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW,
  )
  try {
    database.exec('PRAGMA query_only = ON')
    for (const [query, expected] of [
      ['SELECT count(*) AS n FROM root_runs', 1],
      ['SELECT count(*) AS n FROM root_spawn_intents', 1],
      ['SELECT count(*) AS n FROM root_child_owners', 0],
      ['SELECT count(*) AS n FROM attempt_export_pins WHERE released = 0', 0],
    ] as const) {
      const row = database.query<{ readonly n: unknown }, []>(query).get()
      assert.ok(row)
      assert.deepEqual(Object.keys(row), ['n'])
      assert.equal(row.n, expected)
    }
  } finally {
    database.close()
  }
  assert.deepEqual(await foundationResidue(qualification, command, directory), before)
  assert.deepEqual(JSON.parse(await readFile(join(project, 'verified.json'), 'utf8')), {
    activeRefused: true,
    cancelled: true,
    checkpoints: 1,
    rootCheckpoint: false,
  })
}

const flowSources: Readonly<Record<string, string>> = {
  worker: String.raw`
import {handle} from '@jigging/flow';
await handle(async run=>{
  const ready=run.channels.ready, hold=run.channels.hold;
  if(ready?.direction!=='send'||hold?.direction!=='receive') throw Error('Missing selected barrier');
  const receipt=await run.call({operationId:'save',slot:'progress',input:{sequence:1,
    evidence:{role:'worker',accepted:true},files:{'draft.txt':'accepted before local cancellation'}}});
  await ready.send({sequence:receipt.output.sequence,digest:receipt.output.digest});
  await hold.next({signal:run.signal});
  throw Error('The held child resumed without cancellation');
});
`,
  router: String.raw`
import {handle,OperationError} from '@jigging/flow';
import assert from 'node:assert/strict';
await handle(async run=>{
  const ready=await run.channel({schema:{}}), hold=await run.channel({schema:{}});
  const stop=new AbortController();
  const call={operationId:'attempt',slot:'worker',input:null,
    channels:{ready:ready.send,hold:hold.receive}};
  const work=run.call(call,{signal:stop.signal}).then(result=>({result}),error=>({error}));
  const premature=work.then(value=>{
    if('error' in value) throw value.error;
    throw Error('Child settled before its selected barrier');
  });
  void premature.catch(()=>{});
  try {
    const saved=await Promise.race([ready.receive.next({signal:run.signal}),premature]);
    assert.equal(saved.done,false);
    assert.equal(saved.value.sequence,1);
    assert.match(saved.value.digest,/^sha256:[0-9a-f]{64}$/);
    // The acknowledged child is still blocked on the held channel, not a timer.
    await assert.rejects(run.call({operationId:'active-read',slot:'retrieve',
      input:{operationId:'attempt'}}),error=>error instanceof OperationError&&error.code==='UNAVAILABLE');
    stop.abort();
    const cancelled=await work;
    assert.ok('error' in cancelled&&cancelled.error instanceof OperationError);
    assert.equal(cancelled.error.code,'CANCELLED');
    // A fresh waiter for the exact original call joins native subtree cleanup.
    await assert.rejects(run.call(call),error=>error instanceof OperationError&&error.code==='CANCELLED');
    run.signal.throwIfAborted();
    const retained=await run.call({operationId:'settled-read',slot:'retrieve',
      input:{operationId:'attempt'}});
    assert.equal(retained.outcome,'done');
    assert.equal(retained.output.checkpoint.sequence,1);
    assert.equal(retained.output.checkpoint.digest,saved.value.digest);
    assert.deepEqual(retained.output.checkpoint.evidence,{role:'worker',accepted:true});
    assert.equal(retained.output.checkpoint.files['draft.txt'],'accepted before local cancellation');
    assert.ok(retained.artifacts?.checkpoint);
    return {outcome:'done',output:{activeRefused:true,cancelled:true,
      sequence:retained.output.checkpoint.sequence,digest:retained.output.checkpoint.digest},
      artifactResults:{checkpoint:retained.artifacts.checkpoint}};
  } finally {
    stop.abort();
    await work;
    await Promise.allSettled([ready.receive.close(),hold.send.close()]);
  }
});
`,
  outer: String.raw`
import {handle} from '@jigging/flow';
import assert from 'node:assert/strict';
await handle(async run=>{
  const result=await run.call({operationId:'router',slot:'router',input:null});
  assert.equal(result.outcome,'done');
  assert.equal(result.output.activeRefused,true);
  assert.equal(result.output.cancelled,true);
  assert.ok(result.artifacts?.checkpoint);
  return {outcome:'done',output:result.output,artifactResults:{checkpoint:result.artifacts.checkpoint}};
});
`,
}

const consumer = String.raw`
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {AttemptClientError,createAttemptClient} from '@jigging/jig/client';
let stage='inspect';
process.on('uncaughtExceptionMonitor',error=>{
  console.error('Foundation client failure: '+JSON.stringify({application:'child-checkpoint-cancellation',stage,
    ...(error instanceof AttemptClientError?{code:error.code,operation:error.operation,uncertain:error.uncertain}:{})}));
});
const client=createAttemptClient({executable:resolve(process.argv[2]),cwd:process.cwd(),timeoutMs:255000});
const inspected=await client.inspect({target:'binding:outer'});
stage='prepare';
const prepared=await client.prepare({expectedApproval:inspected.approval,target:'binding:outer',
  input:null,files:[],constraints:{durationMs:180000,resultBytes:1048576,artifactBytes:4194304},
  outputIntent:{packet:true,receive:['checkpoint']}});
await writeFile('prepared.json',JSON.stringify(prepared),{flag:'wx',mode:0o600});
stage='submit';
const owner=await client.submit({ticket:prepared.ticket,request:prepared.canonicalRequest});
try {
  assert.equal(owner.role,'owner');
  stage='completion';
  const observation=await owner.completion;
  assert.equal(observation.cleanup,'confirmed');
  assert.equal(observation.terminal.status,'succeeded');
  stage='result';
  const result=await client.result({ticket:prepared.ticket});
  assert.equal(result.observation.receipt.runId,owner.receipt.runId);
  assert.equal(result.output.activeRefused,true);
  assert.equal(result.output.cancelled,true);
  assert.equal(result.checkpoint.scope,'root');
  assert.equal(result.checkpoint.availability,'unavailable');
  assert.equal(result.checkpointInventory,'available');
  assert.equal(result.checkpoints.length,1);
  const entry=result.checkpoints[0];
  assert.match(entry.scope,/^sha256:[0-9a-f]{64}$/);
  assert.equal(entry.sequence,1);
  assert.equal(entry.digest,result.output.digest);
  stage='select-checkpoint';
  const selected=await client.result({ticket:prepared.ticket,checkpointScope:entry.scope});
  assert.equal(selected.observation.terminal.status,'succeeded');
  assert.equal(selected.observation.cleanup,'confirmed');
  assert.equal(selected.checkpoint.scope,entry.scope);
  assert.equal(selected.checkpoint.availability,'available');
  assert.equal(selected.checkpoint.digest,entry.digest);
  assert.deepEqual(selected.checkpoint.evidence,{role:'worker',accepted:true});
  assert.equal(selected.checkpoint.files['draft.txt'],'accepted before local cancellation');
  stage='export-checkpoint';
  const exported=await client.export({ticket:prepared.ticket,destination:'retained',
    source:'checkpoint',checkpointScope:entry.scope});
  assert.equal(exported.checkpointScope,entry.scope);
  assert.equal(await readFile('retained/files/draft.txt','utf8'),'accepted before local cancellation');
  const packet=JSON.parse(await readFile('retained/result.json','utf8'));
  assert.equal(packet.status,'succeeded');
  assert.equal(packet.runId,owner.receipt.runId);
  stage='export-final';
  const final=await client.export({ticket:prepared.ticket,destination:'final-packet'});
  assert.equal(final.source,'final');
  assert.equal(await readFile('final-packet/files/checkpoint/draft.txt','utf8'),
    'accepted before local cancellation');
  stage='original-result';
  assert.deepEqual((await client.result({ticket:prepared.ticket})).checkpoints,result.checkpoints);
  assert.equal((await client.lookup({ticket:prepared.ticket})).receipt.runId,owner.receipt.runId);
} finally { owner.close(); await owner.completion; }
await writeFile('verified.json',JSON.stringify({activeRefused:true,cancelled:true,checkpoints:1,rootCheckpoint:false}),
  {flag:'wx',mode:0o600});
`
