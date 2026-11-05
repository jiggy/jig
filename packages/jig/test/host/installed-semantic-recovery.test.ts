import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  foundationCommands, foundationResidue, freezeFoundationArchives,
  lockFoundationWorkspace, qualifyFoundationHost, requireFoundationOptIn,
} from '../fixtures/host-foundation/materialize.js'

requireFoundationOptIn()
const qualification = await qualifyFoundationHost()

test('installed semantic selector composes nested checkpoint recovery and independent acceptance', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-semantic-recovery-')))
  const command = foundationCommands(join(root, 'commands'))
  let passed = false
  try {
    const before = await foundationResidue(qualification, command, root)
    const archives = await freezeFoundationArchives(root, command)
    let router = process.env.SEMANTIC_ROUTER_PACKAGE_ARCHIVE
    if (!router) {
      const destination = join(root, 'router-archive')
      await mkdir(destination)
      await command([process.execPath, 'pm', 'pack', '--ignore-scripts', '--destination', destination], resolve(import.meta.dir, '../../../semantic-router'))
      const names = (await readdir(destination)).filter((name) => name.endsWith('.tgz'))
      assert.equal(names.length, 1)
      router = join(destination, names[0]!)
    }
    const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
    const routerDigest = await digest(router)
    const consumer = join(root, 'consumer')
    await mkdir(consumer)
    await writeFile(join(consumer, 'package.json'), JSON.stringify({
      private: true, type: 'module', dependencies: {
        '@jigging/jig': `file:${archives.jig}`, '@jigging/flow': `file:${archives.flow}`,
        '@jigging/semantic-router': `file:${router}`,
      },
    }))
    await command(['git', 'init', '--quiet'], consumer)
    await command([process.execPath, 'install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'], consumer, 120_000)
    const installedRouter = join(consumer, 'node_modules/@jigging/semantic-router')
    const project = join(consumer, 'project')
    // The example comes from the installed archive, not a private source fixture.
    await cp(join(installedRouter, 'examples/recover-draft'), project, { recursive: true })
    const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
    delete manifest.dependencies['@jigging/agent-acp']
    // Authoring uses the exact public SDK already installed in the parent consumer.
    delete manifest.devDependencies
    manifest.workspaces.push('libs/*')
    await writeFile(join(project, 'package.json'), JSON.stringify(manifest))
    // Native preparation admits ordinary registry and workspace declarations.
    // Supply the unchanged frozen packages as workspace members, as in the other
    // installed application consumers, rather than inserting file overrides.
    const libraries: [string, string][] = [
      ['flow-sdk', archives.flow], ['semantic-router', router],
    ]
    // Workspace installation resolves members' development dependencies too.
    // Keep the selector's sibling package versions on the same frozen candidate.
    for (const [name, variable] of [
      ['agent-method', 'AGENT_METHOD_PACKAGE_ARCHIVE'],
      ['reporting', 'REPORTING_PACKAGE_ARCHIVE'],
    ] as const) {
      let archive = process.env[variable]
      if (!archive) {
        const destination = join(root, `${name}-archive`)
        await mkdir(destination)
        await command([process.execPath, 'pm', 'pack', '--ignore-scripts', '--destination', destination], resolve(import.meta.dir, '../../../', name))
        const names = (await readdir(destination)).filter(name => name.endsWith('.tgz'))
        assert.equal(names.length, 1)
        archive = join(destination, names[0]!)
      }
      libraries.push([name, archive])
    }
    for (const [name, archive] of libraries) {
      const library = join(project, 'libs', name)
      await mkdir(library, { recursive: true })
      await command(['tar', '-xzf', archive, '--strip-components=1', '-C', library], project)
    }
    // Replace the operator-selected Agent using an ordinary public Flow and Binding.
    const peer = join(project, 'flows/test-agent')
    await mkdir(peer)
    await cp(join(installedRouter, 'contracts/agent-run'), peer, { recursive: true })
    await writeFile(join(peer, 'FLOW.contract.json'), await readFile(join(peer, 'contract.json')))
    await writeFile(join(peer, 'package.json'), JSON.stringify({ name: 'recovery-test-agent', private: true, type: 'module', dependencies: { '@jigging/flow': 'workspace:*' } }))
    await writeFile(join(peer, 'FLOW.ts'), `import {handle} from '@jigging/flow';
await handle(async run=>{
  const text=run.input.instructions;
  if(text.includes('Case: blocked.'))return {outcome:'blocked',output:{text:'Controlled Agent refusal.'}};
  if(text.includes('Case: limit.'))return {outcome:'limit',output:{text:'Controlled Agent limit.'}};
  const decision={candidateId:text.includes('Case: abstain.')?null:'finish',reason:'Controlled protocol decision, without a live model.'};
  return {outcome:'done',output:{text:JSON.stringify(decision),structured:decision}};
});`)
    await writeFile(join(project, 'bindings/agent.ts'), "import {defineBinding} from '@jigging/jig';export default defineBinding({package:'flows/test-agent'});\n")
    await lockFoundationWorkspace(project, command)
    const cli = join(consumer, 'node_modules/.bin/jig')
    await command([cli, 'review', '--yes', '--allow-resolution-network', '--allow-authority-changes'], project)
    await writeFile(join(consumer, 'client.ts'), clientSource)
    await command([process.execPath, '--no-env-file', '--no-install', join(consumer, 'client.ts'), cli], project, 600_000)
    assert.equal(await digest(router), routerDigest)
    assert.equal(await digest(archives.jig), archives.jigDigest.replace('sha256:', ''))
    assert.equal(await digest(archives.flow), archives.flowDigest.replace('sha256:', ''))
    assert.deepEqual(await foundationResidue(qualification, command, root), before)
    passed = true
  } finally {
    if (passed) await rm(root, { recursive: true, force: true })
    else {
      console.error(`Semantic recovery consumer and private transcripts retained at ${root}`)
      const names = (await readdir(join(root, 'commands'))).filter(name => name.endsWith('.stderr')).sort()
      const last = names.at(-1)
      if (last) {
        const diagnostic = await readFile(join(root, 'commands', last), 'utf8')
        console.error(`Last consumer command stderr: ${diagnostic.replaceAll(root, '<consumer>').slice(0, 4096)}`)
      }
    }
  }
}, 900_000)

const clientSource = String.raw`
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createAttemptClient} from '@jigging/jig/client';
const client=createAttemptClient({executable:resolve(process.argv[2]),cwd:process.cwd(),timeoutMs:375000});
const cases=[{label:'first',mode:'throw'},{label:'second',mode:'reject'},
  ...['no-save','bad-fallback'].map(mode=>({label:'other',mode})),
  {label:'other',mode:'throw',attemptLimit:1},
  ...['bad-context','abstain','blocked','limit'].map(mode=>({label:'other',mode})),
  {label:'other',mode:'throw',candidates:'none'}];
const inspected=await client.inspect({target:'binding:outer'});
const runs=[];
// Each real Run keeps the normal 16-artifact retention bound. Two composed
// recoveries still prove independent child scopes and repeated local IDs.
for(let offset=0;offset<cases.length;offset+=2){
  const prepared=await client.prepare({expectedApproval:inspected.approval,target:'binding:outer',input:{cases:cases.slice(offset,offset+2)},files:[],
    constraints:{durationMs:300000,resultBytes:1048576,artifactBytes:4194304},
    outputIntent:{packet:true,receive:['first','second']}});
  await writeFile('prepared-'+offset+'.json',JSON.stringify(prepared),{flag:'wx',mode:0o600});
  const owner=await client.submit({ticket:prepared.ticket,request:prepared.canonicalRequest});
  try {
    const observation=await owner.completion;
    assert.equal(observation.cleanup,'confirmed');
    assert.equal(observation.terminal.status,'succeeded');
    runs.push({ticket:prepared.ticket,result:await client.result({ticket:prepared.ticket})});
  } finally {owner.close(); await owner.completion;}
}
const results=runs.flatMap(run=>run.result.output.results);
const expected=['done','done','blocked','blocked','limit','blocked','blocked','blocked','limit','blocked'];
assert.deepEqual(results.map(item=>item.outcome),expected,
  JSON.stringify(results.flatMap((item,index)=>item.outcome===expected[index]?[]:[{index,...item}])));
const first=results[0].output,second=results[1].output;
assert.equal(first.attempts,2);assert.equal(second.attempts,2);
assert.equal(first.trace[0].error,'EXECUTION_FAILED');
assert.equal(second.trace[0].outcome,'done');
assert.equal(second.trace.find(item=>item.stage==='evaluate-primary').output.accepted,false);
for(const [index,item] of results.entries()){
  assert.equal(item.output.trace.filter(step=>step.stage==='primary').length,1);
  assert.equal(item.output.trace.filter(step=>step.stage==='fallback').length,[0,1,3].includes(index)?1:0);
}
assert.match(results[2].output.reason,/without a saved checkpoint/);
assert.equal(results[3].output.trace.find(step=>step.stage==='evaluate-fallback').output.accepted,false);
assert.equal(results[4].output.trace.some(step=>step.stage==='selection'),false);
assert.equal(results[5].output.trace.find(step=>step.stage==='repair').outcome,'blocked');
assert.equal(results[6].output.trace.find(step=>step.stage==='selection').output.candidateId,null);
assert.equal(results[7].output.trace.find(step=>step.stage==='selection').outcome,'blocked');
assert.equal(results[8].output.trace.find(step=>step.stage==='selection').outcome,'limit');
assert.equal(results[9].output.trace.find(step=>step.stage==='selection').output.candidateId,null);
assert.equal(first.trace.find(item=>item.stage==='fallback').outcome,'done');
assert.equal(first.trace.find(item=>item.stage==='evaluate-fallback').output.accepted,true);
const checkpoints=runs.flatMap(run=>run.result.checkpoints.map(entry=>({...entry,ticket:run.ticket})));
assert.equal(checkpoints.length,9);
assert.equal(new Set(checkpoints.map(item=>item.ticket+':'+item.scope)).size,9);
for(const run of runs){
  assert.equal(new Set(run.result.checkpoints.map(item=>item.scope)).size,run.result.checkpoints.length);
}
assert.equal(runs[0].result.checkpoints.length,2);
const workerDigests=[first,second].map(item=>item.trace.find(step=>step.stage==='checkpoint').output.checkpoint.digest);
assert.notEqual(workerDigests[0],workerDigests[1]);
for(const digest of workerDigests){
  const entry=checkpoints.find(item=>item.digest===digest);
  assert.ok(entry);
  const selected=await client.result({ticket:entry.ticket,checkpointScope:entry.scope});
  assert.equal(selected.checkpoint.availability,'available');
  assert.equal(selected.checkpoint.digest,digest);
}
const destination=resolve('accepted-reports');
await client.export({ticket:runs[0].ticket,source:'final',destination});
for(const label of ['first','second']){
  const prefix=destination+'/files/'+label;
  assert.equal(await readFile(prefix+'/report.txt','utf8'),'Partial draft for '+label+'.\nCompleted for '+label+'.\n');
  assert.deepEqual(await readFile(prefix+'/binary.bin'),Buffer.from([0,255,128]));
  assert.equal((await readFile(prefix+'/empty.bin')).length,0);
}
`
