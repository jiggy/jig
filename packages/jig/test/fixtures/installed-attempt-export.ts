import { constants, Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type FoundationArchives,
  type FoundationQualification,
  foundationCommands,
  foundationResidue,
} from './host-foundation/materialize.js'

/** Registration-free installed consumer. Only public archive exports enter its sources. */
export async function runInstalledAttemptExport(
  directory: string,
  archives: FoundationArchives,
  qualification: FoundationQualification,
): Promise<void> {
  await mkdir(directory)
  const command = foundationCommands(join(directory, 'commands'))
  const before = await foundationResidue(qualification, command, directory)
  async function put(path: string, value: string | object) {
    await mkdir(dirname(join(directory, path)), { recursive: true })
    await writeFile(
      join(directory, path),
      typeof value === 'string' ? value : JSON.stringify(value),
      {
        flag: 'wx',
      },
    )
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
  for (const name of ['root', 'producer']) {
    await put(`project/flows/${name}/package.json`, {
      name: `export-${name}`,
      private: true,
      version: '0.0.0',
      type: 'module',
      dependencies: { '@jigging/flow': 'workspace:*' },
    })
    await put(`project/flows/${name}/FLOW.meta.json`, {
      name,
      description: 'Produce and retain immutable export evidence.',
      ...(name === 'root'
        ? {
            uses: {
              producer: {},
              progress: { contract: './contracts/progress/contract.json' },
            },
          }
        : {}),
    })
    await put(`project/flows/${name}/FLOW.contract.json`, {
      $schema: schema,
      ...(name === 'root'
        ? { artifactResults: ['report'] }
        : { attachments: { report: 'read-write' } }),
    })
  }
  await put(
    'project/flows/producer/FLOW.ts',
    `import {handle} from '@jigging/flow';
import {writeFile,mkdir} from 'node:fs/promises';
await handle(async run=>{
  const root=run.attachments.report.path;
  await writeFile(root+'/binary.bin',new Uint8Array([0,255,128]));
  await writeFile(root+'/empty.bin',new Uint8Array());
  await mkdir(root+'/empty');
  return {outcome:'done',output:{produced:true}};
});`,
  )
  await put(
    'project/flows/root/FLOW.ts',
    `import {handle} from '@jigging/flow';
await handle(async run=>{
  const child=await run.call({operationId:'produce',slot:'producer',input:null,
    attachments:{report:{create:true}}});
  if(child.outcome!=='done'||!child.artifacts?.report) throw Error('No artifact');
  await run.call({operationId:'save',slot:'progress',input:{
    sequence:1,evidence:{saved:true},files:{'progress.txt':'accepted checkpoint'},
    artifacts:{report:child.artifacts.report.reference}}});
  if(run.input==='fail') throw Error('Requested application failure after checkpoint');
  if(run.input==='cancel') await new Promise(resolve=>setTimeout(resolve,100000));
  return {outcome:'done',output:{completed:true},artifactResults:{report:child.artifacts.report}};
});`,
  )
  await put(
    'project/bindings/root.ts',
    `import {defineBinding} from '@jigging/jig';
export default defineBinding({package:'flows/root',slots:{
  producer:{target:'flow:flows/producer',attachments:{report:{create:true}}}
}});`,
  )
  const project = join(directory, 'project')
  await mkdir(join(project, 'libs/flow'), { recursive: true })
  await command(
    ['tar', '-xzf', archives.flow, '--strip-components=1', '-C', join(project, 'libs/flow')],
    directory,
  )
  const cli = join(directory, 'node_modules/.bin/jig')
  await mkdir(join(project, 'flows/root/contracts'), { recursive: true })
  await command(
    [cli, 'import-contract', 'jig:run-checkpoint', 'flows/root/contracts/progress'],
    project,
  )
  await command([cli, 'review', '--yes', '--allow-resolution-network'], project)
  await put('client.ts', consumer)
  await command(
    [process.execPath, '--no-env-file', '--no-install', join(directory, 'client.ts'), cli],
    project,
    600_000,
  )
  // Observation only: never insert acceptance, pin, owner, or delivery records.
  const db = Database.open(
    join(project, '.jig/jig.sqlite3'),
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW,
  )
  try {
    db.exec('PRAGMA query_only = ON')
    for (const query of [
      'SELECT count(*) AS n FROM attempt_export_pins WHERE released = 0',
      'SELECT count(*) AS n FROM root_child_owners',
    ]) {
      const row = db.query<{ readonly n: unknown }, []>(query).get()
      assert.ok(row)
      assert.deepEqual(Object.keys(row), ['n'])
      assert.equal(row.n, 0)
    }
  } finally {
    db.close()
  }
  assert.deepEqual(await foundationResidue(qualification, command, directory), before)
  assert.equal(JSON.parse(await readFile(join(project, 'verified.json'), 'utf8')).exports, true)
}

const consumer = `
import assert from 'node:assert/strict';
import {mkdir,open,readFile,rename,writeFile,readdir,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {AttemptClientError,createAttemptClient} from '@jigging/jig/client';
let stage='inspect', modeLabel='initial', terminalCode;
process.on('uncaughtExceptionMonitor',error=>{
  console.error('Foundation client failure: '+JSON.stringify({
    application:'attempt-export',stage,mode:modeLabel,terminalCode,
    ...(error instanceof AttemptClientError
      ? {code:error.code,operation:error.operation,uncertain:error.uncertain}:{})
  }));
});
const client=createAttemptClient({executable:resolve(process.argv[2]),cwd:process.cwd(),timeoutMs:195000});
let resultOrdinal=0;
const resultPhases=new Set(['result-open','result-authenticate','result-retention',
  'result-observe','result-checkpoint','result-finish','result-dispose']);
async function readResult(ticket){
  const trace=resolve('result-profile-'+(++resultOrdinal)+'.jsonl');
  const observer=createAttemptClient({executable:resolve(process.argv[2]),cwd:process.cwd(),
    timeoutMs:195000,env:{...process.env,JIG_PRIVATE_PROFILE_FILE:trace}});
  try {
    const result=await observer.result({ticket});
    await unlink(trace).catch(()=>{});
    return result;
  } catch(error) {
    try {
      const file=await open(trace,'r');
      let text;
      try {
        const bytes=Buffer.alloc(8193);
        const {bytesRead}=await file.read(bytes,0,bytes.length,0);
        if(bytesRead>8192) throw Error('Diagnostic exceeds bound');
        text=bytes.subarray(0,bytesRead).toString('utf8');
      } finally { await file.close(); }
      const phases=[];
      for(const line of text.trim().split('\\n')){
        const record=JSON.parse(line);
        if(record.kind!=='start'&&record.kind!=='end') continue;
        if(!resultPhases.has(record.phase)||!Number.isFinite(record.timeMs)||
          record.timeMs<0||record.timeMs>86400000) continue;
        if(record.kind==='end'&&record.outcome!=='returned'&&record.outcome!=='failed') continue;
        if(phases.length===14) break;
        phases.push({phase:record.phase,kind:record.kind,timeMs:record.timeMs,
          ...(record.kind==='end'?{outcome:record.outcome}:{})});
      }
      console.error('Foundation result phases: '+JSON.stringify(phases));
    } catch {}
    throw error;
  }
}
const inspected=await client.inspect({target:'binding:root'});
const request={expectedApproval:inspected.approval,target:'binding:root',input:null,files:[],
  constraints:{durationMs:120000,resultBytes:1048576,artifactBytes:1048576},
  outputIntent:{packet:true,receive:['report']}};
for(const mode of ['complete','fail','cancel']){
  modeLabel=mode; stage='prepare'; terminalCode=undefined;
  const prepared=await client.prepare({...request,input:mode});
  await writeFile(mode+'-prepared.json',JSON.stringify(prepared),{flag:'wx',mode:0o600});
  stage='submit';
  const owner=await client.submit({ticket:prepared.ticket,request:prepared.canonicalRequest});
  try {
    assert.equal(owner.role,'owner');
    if(mode==='cancel'){
      stage='checkpoint-wait';
      const until=performance.now()+100000;
      for(;;){
        const result=await readResult(prepared.ticket);
        if(result.checkpoint?.sequence===1) break;
        if(performance.now()>until) throw Error('No real accepted checkpoint');
        await Bun.sleep(50);
      }
      stage='cancel';
      assert.equal((await client.cancel({ticket:prepared.ticket})).acknowledged,true);
    }
    stage='completion';
    const observation=await owner.completion;
    stage='completion-result';
    terminalCode=observation?.terminal?.status==='failed'?observation.terminal.code:undefined;
    assert.equal(observation.cleanup,'confirmed');
    assert.equal(observation.terminal.status,mode==='complete'?'succeeded':'failed');
    if(mode==='cancel') assert.equal(observation.terminal.code,'CANCELLED');
    stage='result';
    const result=await readResult(prepared.ticket);
    assert.equal(result.checkpoint.sequence,1);
    assert.equal(result.observation.receipt.runId,owner.receipt.runId);
    const source=mode==='complete'?'final':'checkpoint';
    const destination=mode+'-packet';
    stage='export';
    const receipt=await client.export({ticket:prepared.ticket,destination,source});
    assert.equal(receipt.source,source);
    stage='verify-export';
    const packet=JSON.parse(await readFile(destination+'/result.json','utf8'));
    stage='verify-export-status';
    assert.equal(packet.status,observation.terminal.status);
    stage='verify-export-run';
    assert.equal(packet.runId,owner.receipt.runId);
    const artifactPrefix=source==='checkpoint'?'artifacts/report':'report';
    stage='verify-export-binary';
    assert.deepEqual(await readFile(destination+'/files/'+artifactPrefix+'/binary.bin'),Buffer.from([0,255,128]));
    stage='verify-export-empty-file';
    assert.equal((await readFile(destination+'/files/'+artifactPrefix+'/empty.bin')).length,0);
    stage='verify-export-inventory';
    // Packets preserve files, not empty directories (public file delivery contract).
    assert.deepEqual((await readdir(destination+'/files/'+artifactPrefix)).sort(),['binary.bin','empty.bin']);
    stage='verify-export-checkpoint-text';
    if(source==='checkpoint')
      assert.equal(await readFile(destination+'/files/progress.txt','utf8'),'accepted checkpoint');
    // Prove reconciliation consumes protected evidence, not the now absent packet.
    await rename(destination,destination+'-moved');
    stage='reconcile-export';
    assert.deepEqual(await client.export({ticket:prepared.ticket,destination,source}),receipt);
    await assert.rejects(readFile(destination+'/result.json'));
    const collision=mode+'-collision';
    stage='collision-export';
    await mkdir(collision); await writeFile(collision+'/sentinel','original');
    await assert.rejects(client.export({ticket:prepared.ticket,destination:collision,source}));
    assert.deepEqual(await readdir(collision),['sentinel']);
    assert.equal(await readFile(collision+'/sentinel','utf8'),'original');
    stage='aborted-export';
    const abort=new AbortController(); abort.abort();
    await assert.rejects(client.export({ticket:prepared.ticket,destination:mode+'-aborted',source},{signal:abort.signal}));
    await assert.rejects(readFile(mode+'-aborted/result.json'));
    stage='final-unavailable';
    if(mode!=='complete') await assert.rejects(client.export({ticket:prepared.ticket,destination:mode+'-final'}));
    stage='final-lookup';
    assert.equal((await client.lookup({ticket:prepared.ticket})).receipt.runId,owner.receipt.runId);
  } finally { owner.close(); await owner.completion; }
}
await writeFile('verified.json',JSON.stringify({exports:true}),{flag:'wx',mode:0o600});
`
