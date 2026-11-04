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

/** A fresh installed consumer; methods and application use only public package exports. */
export async function runInstalledChildCheckpoints(
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
      name: `child-checkpoint-${name}`,
      private: true,
      version: '0.0.0',
      type: 'module',
      dependencies: { '@jigging/flow': 'workspace:*' },
    })
    const progress = { contract: './contracts/progress/contract.json' }
    const retrieve = { contract: './contracts/child-checkpoint/contract.json' }
    await put(`project/flows/${name}/FLOW.meta.json`, {
      name,
      description: 'Repair retained child work through ordinary reviewed calls.',
      ...(name === 'outer'
        ? { uses: { router: {}, retrieve } }
        : name === 'router'
          ? { uses: { worker: {}, repair: {}, progress, retrieve } }
          : name === 'worker'
            ? { uses: { producer: {}, progress } }
            : {}),
    })
    await put(`project/flows/${name}/FLOW.contract.json`, {
      $schema: schema,
      ...(name === 'outer'
        ? { artifactResults: ['first', 'second'] }
        : name === 'router'
          ? { artifactResults: ['repaired'] }
          : name === 'repair'
            ? { attachments: { source: 'read', repaired: 'read-write' } }
            : name === 'producer'
              ? { attachments: { payload: 'read-write' } }
              : {}),
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
export default defineBinding({package:'flows/router',slots:{
  worker:'binding:worker',
  repair:{target:'flow:flows/repair',attachments:{source:{supplied:'read'},repaired:{create:true}}}
}});`,
  )
  await put(
    'project/bindings/worker.ts',
    `import {defineBinding} from '@jigging/jig';
export default defineBinding({package:'flows/worker',slots:{
  producer:{target:'flow:flows/producer',attachments:{payload:{create:true}}}
}});`,
  )
  const project = join(directory, 'project')
  await mkdir(join(project, 'libs/flow'), { recursive: true })
  await command(
    ['tar', '-xzf', archives.flow, '--strip-components=1', '-C', join(project, 'libs/flow')],
    directory,
  )
  const cli = join(directory, 'node_modules/.bin/jig')
  for (const name of ['router', 'worker']) {
    await mkdir(join(project, `flows/${name}/contracts`), { recursive: true })
    await command(
      [cli, 'import-contract', 'jig:run-checkpoint', `flows/${name}/contracts/progress`],
      project,
    )
  }
  for (const name of ['outer', 'router']) {
    await mkdir(join(project, `flows/${name}/contracts`), { recursive: true })
    await command(
      [cli, 'import-contract', 'jig:child-checkpoint', `flows/${name}/contracts/child-checkpoint`],
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
  // These are observations of the actual owner, never fabricated acceptance or cleanup.
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
    repaired: ['first', 'second'],
    checkpoints: 4,
    rootCheckpoint: false,
  })
}

const flowSources: Readonly<Record<string, string>> = {
  producer: String.raw`
import {handle} from '@jigging/flow';
import {mkdir,writeFile} from 'node:fs/promises';
await handle(async run=>{
  const path=run.attachments.payload.path;
  await writeFile(path+'/binary.bin',new Uint8Array([0,255,128]));
  await writeFile(path+'/empty.bin',new Uint8Array());
  await mkdir(path+'/empty');
  return {outcome:'done',output:{produced:true}};
});
`,
  worker: String.raw`
import {handle} from '@jigging/flow';
await handle(async run=>{
  const {label,mode}=run.input;
  if(mode==='none') return {outcome:'needs-repair',output:{saved:false}};
  const produced=await run.call({operationId:'produce',slot:'producer',input:null,
    attachments:{payload:{create:true}}});
  if(produced.outcome!=='done'||!produced.artifacts?.payload) throw Error('No payload artifact');
  const save={sequence:1,evidence:{role:'worker',label,mode},
    files:{'draft.txt':'draft:'+label+':unrepaired'},
    artifacts:{payload:produced.artifacts.payload.reference}};
  const receipt=await run.call({operationId:'save',slot:'progress',input:save});
  save.files['draft.txt']='mutated after acknowledgement';
  await run.release({operationId:'release-payload',artifact:produced.artifacts.payload});
  if(mode==='fail') throw Error('Application failure after accepted child checkpoint');
  if(mode!=='bad') throw Error('Unknown worker mode');
  return {outcome:'needs-repair',output:{saved:true,accepted:false,digest:receipt.output.digest}};
});
`,
  repair: String.raw`
import {handle} from '@jigging/flow';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
await handle(async run=>{
  const source=run.attachments.source.path;
  const text=await readFile(source+'/draft.txt','utf8');
  assert.equal(text,'draft:'+run.input.label+':unrepaired');
  assert.deepEqual(await readFile(source+'/artifacts/payload/binary.bin'),Buffer.from([0,255,128]));
  assert.equal((await readFile(source+'/artifacts/payload/empty.bin')).length,0);
  await assert.rejects(writeFile(source+'/draft.txt','unauthorized replacement'));
  const repaired=text.replace(':unrepaired',':repaired');
  await writeFile(run.attachments.repaired.path+'/repaired.txt',repaired);
  return {outcome:'done',output:{repaired:true,text:repaired}};
});
`,
  router: String.raw`
import {handle,OperationError} from '@jigging/flow';
await handle(async run=>{
  const {label,mode}=run.input;
  const retrieve=(operationId,child)=>run.call({operationId,slot:'retrieve',input:{operationId:child}});
  const unavailable=async(operationId,child)=>{
    try { await retrieve(operationId,child); }
    catch(error) { if(error instanceof OperationError&&error.code==='UNAVAILABLE') return; throw error; }
    throw Error('Unowned operation exposed a checkpoint');
  };
  await unavailable('before-child','attempt');
  await unavailable('foreign-parent','router:first');
  let failed=false, result;
  try { result=await run.call({operationId:'attempt',slot:'worker',input:{label,mode}}); }
  catch(error) { if(!(error instanceof OperationError)) throw error; failed=true; }
  if(failed!==(mode==='fail')) throw Error('Worker failure was changed');
  if(!failed&&result?.outcome!=='needs-repair') throw Error('Expected an unsuccessful application outcome');
  const retained=await retrieve('retrieve','attempt');
  if(retained.outcome!=='done') throw Error('Checkpoint retrieval failed');
  const checkpoint=retained.output.checkpoint;
  if(mode==='none') {
    if(checkpoint!==null||retained.artifacts?.checkpoint!==undefined)
      throw Error('Unsaved child invented checkpoint evidence');
    return {outcome:'done',output:{label,mode,saved:false}};
  }
  if(!checkpoint||checkpoint.sequence!==1||checkpoint.evidence.role!=='worker'||
    checkpoint.evidence.label!==label||checkpoint.evidence.mode!==mode||
    checkpoint.files['draft.txt']!=='draft:'+label+':unrepaired'||!retained.artifacts?.checkpoint)
    throw Error('Child checkpoint lost its accepted identity or bytes');
  const repeated=await retrieve('retrieve','attempt');
  if(repeated.output.checkpoint.digest!==checkpoint.digest||
    repeated.artifacts?.checkpoint!==retained.artifacts.checkpoint)
    throw Error('Repeated retrieval changed the ordinary operation result');
  const repaired=await run.call({operationId:'repair',slot:'repair',input:{label},
    attachments:{source:{read:retained.artifacts.checkpoint},repaired:{create:true}}});
  if(repaired.outcome!=='done'||repaired.output.repaired!==true||!repaired.artifacts?.repaired)
    throw Error('Repair method did not use the retained child work');
  await run.release({operationId:'release-checkpoint',artifact:retained.artifacts.checkpoint});
  const receipt=await run.call({operationId:'router-save',slot:'progress',input:{
    sequence:1,evidence:{role:'router',label,mode,workerDigest:checkpoint.digest},
    files:{'router.txt':'repaired '+label},artifacts:{repair:repaired.artifacts.repaired.reference}}});
  await unavailable('native-operation','router-save');
  const noSave=await retrieve('repair-checkpoint','repair');
  if(noSave.output.checkpoint!==null||noSave.artifacts?.checkpoint!==undefined)
    throw Error('Repair without save invented a checkpoint');
  return {outcome:'done',output:{label,mode,repaired:true,failedBeforeRepair:failed,
    workerDigest:checkpoint.digest,routerDigest:receipt.output.digest},
    artifactResults:{repaired:repaired.artifacts.repaired}};
});
`,
  outer: String.raw`
import {handle,OperationError} from '@jigging/flow';
await handle(async run=>{
  const results=[], artifacts={};
  for(const [label,mode] of [['first','fail'],['second','bad'],['none','none']]) {
    const operationId='router:'+label;
    const result=await run.call({operationId,slot:'router',input:{label,mode}});
    if(result.outcome!=='done') throw Error('Router did not recover its worker');
    const retained=await run.call({operationId:'checkpoint:'+label,slot:'retrieve',input:{operationId}});
    if(mode==='none') {
      if(result.output.saved!==false||retained.output.checkpoint!==null)
        throw Error('Unsaved router invented checkpoint evidence');
    } else {
      if(!result.artifacts?.repaired||result.output.repaired!==true||
        retained.output.checkpoint?.evidence.role!=='router'||
        retained.output.checkpoint?.digest!==result.output.routerDigest)
        throw Error('Outer observed a different router checkpoint');
      artifacts[label]=result.artifacts.repaired;
    }
    results.push(result.output);
  }
  try {
    await run.call({operationId:'foreign-grandchild',slot:'retrieve',input:{operationId:'attempt'}});
  } catch(error) {
    if(!(error instanceof OperationError)||error.code!=='UNAVAILABLE') throw error;
    return {outcome:'done',output:{results,grandchildHidden:true},artifactResults:artifacts};
  }
  throw Error('A descendant local operation ID crossed its caller boundary');
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
  console.error('Foundation client failure: '+JSON.stringify({application:'child-checkpoints',stage,
    ...(error instanceof AttemptClientError?{code:error.code,operation:error.operation,uncertain:error.uncertain}:{})}));
});
const client=createAttemptClient({executable:resolve(process.argv[2]),cwd:process.cwd(),timeoutMs:255000});
const inspected=await client.inspect({target:'binding:outer'});
stage='prepare';
const prepared=await client.prepare({expectedApproval:inspected.approval,target:'binding:outer',
  input:null,files:[],constraints:{durationMs:180000,resultBytes:1048576,artifactBytes:4194304},
  outputIntent:{packet:true,receive:['first','second']}});
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
  assert.equal(result.output.grandchildHidden,true);
  assert.deepEqual(result.output.results.map(item=>[item.label,item.mode,item.repaired??false]),
    [['first','fail',true],['second','bad',true],['none','none',false]]);
  assert.equal(result.output.results[0].failedBeforeRepair,true);
  assert.equal(result.output.results[1].failedBeforeRepair,false);
  assert.equal(result.checkpoint.scope,'root');
  assert.equal(result.checkpoint.availability,'unavailable');
  assert.equal(result.checkpoints.length,4);
  assert.equal(new Set(result.checkpoints.map(item=>item.scope)).size,4);
  const selected=new Map();
  let firstExport;
  for(const entry of result.checkpoints){
    assert.match(entry.scope,/^sha256:[0-9a-f]{64}$/);
    assert.equal(entry.sequence,1);
    stage='select-checkpoint';
    const detail=await client.result({ticket:prepared.ticket,checkpointScope:entry.scope});
    assert.equal(detail.observation.terminal.status,'succeeded');
    assert.equal(detail.observation.cleanup,'confirmed');
    const checkpoint=detail.checkpoint;
    assert.equal(checkpoint.scope,entry.scope);
    assert.equal(checkpoint.availability,'available');
    assert.equal(checkpoint.sequence,1);
    assert.equal(checkpoint.digest,entry.digest);
    const {role,label,mode}=checkpoint.evidence;
    assert.ok(role==='worker'||role==='router');
    assert.ok(label==='first'||label==='second');
    assert.equal(mode,label==='first'?'fail':'bad');
    const key=role+':'+label;
    assert.equal(selected.has(key),false);
    selected.set(key,checkpoint);
    const router=result.output.results.find(item=>item.label===label);
    assert.equal(entry.digest,role==='worker'?router.workerDigest:router.routerDigest);
    const destination='checkpoint-'+role+'-'+label;
    stage='export-checkpoint';
    const request={ticket:prepared.ticket,destination,source:'checkpoint',checkpointScope:entry.scope};
    const receipt=await client.export(request);
    assert.equal(receipt.source,'checkpoint');
    assert.equal(receipt.checkpointScope,entry.scope);
    assert.deepEqual(await client.export(request),receipt);
    const packet=JSON.parse(await readFile(destination+'/result.json','utf8'));
    assert.equal(packet.status,'succeeded');
    assert.equal(packet.runId,owner.receipt.runId);
    if(role==='worker'){
      assert.equal(await readFile(destination+'/files/draft.txt','utf8'),'draft:'+label+':unrepaired');
      assert.deepEqual(await readFile(destination+'/files/artifacts/payload/binary.bin'),Buffer.from([0,255,128]));
      assert.equal((await readFile(destination+'/files/artifacts/payload/empty.bin')).length,0);
    } else {
      assert.equal(await readFile(destination+'/files/router.txt','utf8'),'repaired '+label);
      assert.equal(await readFile(destination+'/files/artifacts/repair/repaired.txt','utf8'),'draft:'+label+':repaired');
    }
    if(firstExport){
      stage='scope-collision';
      await assert.rejects(client.export({...request,destination:firstExport.destination}));
      assert.equal(await readFile(firstExport.destination+'/result.json','utf8'),firstExport.packet);
    } else firstExport={destination,packet:await readFile(destination+'/result.json','utf8')};
  }
  assert.deepEqual([...selected.keys()].sort(),['router:first','router:second','worker:first','worker:second']);
  stage='root-checkpoint-unavailable';
  await assert.rejects(client.export({ticket:prepared.ticket,destination:'no-root-checkpoint',source:'checkpoint'}));
  stage='export-final';
  const final=await client.export({ticket:prepared.ticket,destination:'final-packet'});
  assert.equal(final.source,'final');
  for(const label of ['first','second'])
    assert.equal(await readFile('final-packet/files/'+label+'/repaired.txt','utf8'),'draft:'+label+':repaired');
  stage='original-result';
  assert.deepEqual((await client.result({ticket:prepared.ticket})).checkpoints,result.checkpoints);
  assert.equal((await client.lookup({ticket:prepared.ticket})).receipt.runId,owner.receipt.runId);
} finally { owner.close(); await owner.completion; }
await writeFile('verified.json',JSON.stringify({repaired:['first','second'],checkpoints:4,rootCheckpoint:false}),
  {flag:'wx',mode:0o600});
`
