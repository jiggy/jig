import { constants, Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ATTEMPT_FAILURE_CODES } from '../../src/attempt-contract.js'
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
  try {
    await command(
      [process.execPath, '--no-env-file', '--no-install', join(directory, 'client.ts'), cli],
      project,
      600_000,
    )
  } catch (error) {
    await reportFailure(project)
    throw error
  }
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

/** A failed command keeps its original exception and exposes only closed fixture observations. */
async function reportFailure(project: string): Promise<void> {
  try {
    const file = await open(
      join(project, 'checkpoint-failure.json'),
      fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW,
    )
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096)
        throw new Error('invalid diagnostic file')
      const bytes = Buffer.alloc(4097)
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
      if (bytesRead !== stat.size) throw new Error('diagnostic file changed')
      const value: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'))
      if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error('invalid diagnostic value')
      const choices: Readonly<Record<string, readonly string[]>> = {
        stage: ['completion'],
        terminal: ['succeeded', 'failed', 'lost', 'unavailable'],
        terminalCode: [...ATTEMPT_FAILURE_CODES, 'COORDINATOR_LOST'],
        cleanup: ['pending', 'confirmed', 'unresolved', 'unavailable'],
        checkpointPhase: [
          'barrier',
          'active-retrieval',
          'cancel-waiter',
          'join',
          'retrieve',
          'checkpoint-result',
          'return',
        ],
        checkpointCauseCode: [...ATTEMPT_FAILURE_CODES, 'ASSERTION'],
      }
      const summary: Record<string, string> = { application: 'child-checkpoint-cancellation' }
      for (const [key, allowed] of Object.entries(choices)) {
        const selected = (value as Record<string, unknown>)[key]
        if (typeof selected === 'string' && allowed.includes(selected)) summary[key] = selected
      }
      if (
        summary.stage === undefined ||
        summary.terminal === undefined ||
        summary.cleanup === undefined
      )
        throw new Error('incomplete diagnostic value')
      console.error(`Child checkpoint failure: ${JSON.stringify(summary)}`)
    } finally {
      await file.close()
    }
  } catch {
    console.error('Child checkpoint failure: bounded observation unavailable')
  }
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
  let checkpointPhase='barrier', checkpointCauseCode;
  const phase=value=>{checkpointPhase=value;checkpointCauseCode=undefined;};
  const expectedCode=code=>error=>{
    if(error instanceof OperationError) checkpointCauseCode=error.code;
    return error instanceof OperationError&&error.code===code;
  };
  try {
    const saved=await Promise.race([ready.receive.next({signal:run.signal}),premature]);
    assert.equal(saved.done,false);
    assert.equal(saved.value.sequence,1);
    assert.match(saved.value.digest,/^sha256:[0-9a-f]{64}$/);
    // The acknowledged child is still blocked on the held channel, not a timer.
    phase('active-retrieval');
    await assert.rejects(run.call({operationId:'active-read',slot:'retrieve',
      input:{operationId:'attempt'}}),expectedCode('UNAVAILABLE'));
    phase('cancel-waiter');
    stop.abort();
    const cancelled=await work;
    if('error' in cancelled&&cancelled.error instanceof OperationError)
      checkpointCauseCode=cancelled.error.code;
    assert.ok('error' in cancelled&&cancelled.error instanceof OperationError);
    assert.equal(cancelled.error.code,'CANCELLED');
    // A fresh waiter for the exact original call joins native subtree cleanup.
    phase('join');
    await assert.rejects(run.call(call),expectedCode('CANCELLED'));
    run.signal.throwIfAborted();
    phase('retrieve');
    const retained=await run.call({operationId:'settled-read',slot:'retrieve',
      input:{operationId:'attempt'}});
    phase('checkpoint-result');
    assert.equal(retained.outcome,'done');
    assert.equal(retained.output.checkpoint.sequence,1);
    assert.equal(retained.output.checkpoint.digest,saved.value.digest);
    assert.deepEqual(retained.output.checkpoint.evidence,{role:'worker',accepted:true});
    assert.equal(retained.output.checkpoint.files['draft.txt'],'accepted before local cancellation');
    assert.ok(retained.artifacts?.checkpoint);
    phase('return');
    return {outcome:'done',output:{activeRefused:true,cancelled:true,
      sequence:retained.output.checkpoint.sequence,digest:retained.output.checkpoint.digest},
      artifactResults:{checkpoint:retained.artifacts.checkpoint}};
  } catch(error) {
    const code=error instanceof OperationError?error.code:'EXECUTION_FAILED';
    const failure=new OperationError(code,'Child checkpoint cancellation fixture failed',{
      checkpointPhase,checkpointCauseCode:checkpointCauseCode??(error instanceof OperationError?error.code:'ASSERTION')});
    Object.defineProperty(failure,'cause',{value:error});
    throw failure;
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
import {ATTEMPT_FAILURE_CODES,AttemptClientError,createAttemptClient} from '@jigging/jig/client';
let stage='inspect', terminalCode;
process.on('uncaughtExceptionMonitor',error=>{
  console.error('Foundation client failure: '+JSON.stringify({application:'child-checkpoint-cancellation',stage,
    ...(terminalCode===undefined?{}:{terminalCode}),
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
  terminalCode=observation.terminal?.code;
  if(observation.cleanup!=='confirmed'||observation.terminal?.status!=='succeeded') {
    const failure={stage,terminal:observation.terminal?.status??'unavailable',
      cleanup:observation.cleanup??'unavailable',...(terminalCode===undefined?{}:{terminalCode})};
    const details=observation.terminal?.details;
    if(details!==null&&typeof details==='object'&&!Array.isArray(details)) {
      if(['barrier','active-retrieval','cancel-waiter','join','retrieve','checkpoint-result','return']
        .includes(details.checkpointPhase)) failure.checkpointPhase=details.checkpointPhase;
      if([...ATTEMPT_FAILURE_CODES,'ASSERTION'].includes(details.checkpointCauseCode))
        failure.checkpointCauseCode=details.checkpointCauseCode;
    }
    try { await writeFile('checkpoint-failure.json',JSON.stringify(failure),{flag:'wx',mode:0o600}); }
    catch { /* Diagnostic capture never replaces the original completion assertion. */ }
  }
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
