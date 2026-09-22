import { expect } from 'bun:test'
import { cp, lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Install the unchanged built Agent Flow and authorize only its selected native profile. */
export async function writeOrdinaryAcpAgent(
  root: string,
  client: 'codex' | 'claude' | 'pi',
  maxTurns?: number,
): Promise<void> {
  const method = join(root, 'flows/agent')
  const artifacts = join(root, 'artifacts/acp')
  await mkdir(method, { recursive: true })
  await mkdir(artifacts, { recursive: true })
  let archive = process.env.AGENT_ACP_PACKAGE_ARCHIVE
  if (archive !== undefined) {
    archive = await realpath(resolve(archive))
    if (!(await lstat(archive)).isFile())
      throw new Error('ACP Agent archive must be a regular file')
  } else {
    const pack = Bun.spawn(
      [
        process.execPath,
        '--no-env-file',
        'pm',
        'pack',
        '--ignore-scripts',
        '--destination',
        artifacts,
      ],
      { cwd: join(import.meta.dir, '../../../agent-acp'), stdout: 'pipe', stderr: 'pipe' },
    )
    const [exit, stdout, stderr] = await Promise.all([
      pack.exited,
      new Response(pack.stdout).text(),
      new Response(pack.stderr).text(),
    ])
    expect(exit, `${stdout}\n${stderr}`).toBe(0)
    const archives = (await readdir(artifacts)).filter((name) => name.endsWith('.tgz'))
    expect(archives).toHaveLength(1)
    archive = join(artifacts, archives[0]!)
  }
  const extract = Bun.spawn(['tar', '-xzf', archive, '--strip-components=1', '-C', method], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exit, stdout, stderr] = await Promise.all([
    extract.exited,
    new Response(extract.stdout).text(),
    new Response(extract.stderr).text(),
  ])
  expect(exit, `${stdout}\n${stderr}`).toBe(0)
  await mkdir(join(root, 'bindings'), { recursive: true })
  await writeFile(
    join(root, 'bindings/agent.ts'),
    `import {defineBinding} from "@jigging/jig"; export default defineBinding(${JSON.stringify({
      package: 'flows/agent',
      slots: { native: { kind: 'acp', client, ...(maxTurns === undefined ? {} : { maxTurns }) } },
    })});`,
  )
  await writeFile(
    join(root, 'jig.ts'),
    'import {defineJig,discover} from "@jigging/jig"; export default defineJig({flows:discover("flows"),bindings:discover("bindings"),defaultProviders: { "https://jig.md/contracts/agent-run": "binding:agent" }});',
  )
}

/** Public call/channel consumer; bundled SDK fixture, not a live-client claim. */
export async function writeConversationCaller(root: string): Promise<void> {
  const flow = join(root, 'flows/conversation')
  await mkdir(flow, { recursive: true })
  await cp(join(import.meta.dir, '../../../flow-sdk/dist'), join(flow, 'sdk'), {
    recursive: true,
  })
  await cp(
    join(import.meta.dir, '../../../../docs/jig/spec/contracts/agent-run'),
    join(flow, 'contracts/agent-run'),
    { recursive: true },
  )
  await writeFile(
    join(flow, 'FLOW.meta.json'),
    JSON.stringify({ uses: { agent: { contract: './contracts/agent-run/contract.json' } } }),
  )
  await writeFile(
    join(flow, 'FLOW.ts'),
    `import {handle} from './sdk/index.js';
await handle(async run => {
  const commands = await run.channel({contract:'./contracts/agent-run/contracts/agent-commands.json'});
  const replies = await run.channel({contract:'./contracts/agent-run/contracts/agent-replies.json'});
  const stop = new AbortController();
  const work = run.call({operationId:'conversation',slot:'agent',input:{instructions:run.input.first,conversation:true},channels:{commands:commands.receive,replies:replies.send}},{signal:stop.signal}).then(result=>({result}),error=>({error}));
  const records = [];
  const terminal = work.then(value=>{if ('error' in value) throw value.error; throw Error('Conversation ended before expected reply')});
  void terminal.catch(()=>{});
  const next = async () => {
    const item = await Promise.race([replies.receive.next({signal:run.signal}),terminal]);
    if(item.done) throw Error('Replies ended before expected reply');
    records.push(item.value); return item.value;
  };
  let failure;
  let result;
  try {
    let current = await next();
    if(current.type !== 'result' || current.turn !== 0) throw Error('Missing first result');
    for(let turn=1;turn<=run.input.followups.length;turn++) {
      await commands.send.send({type:'prompt',turn,input:{instructions:run.input.followups[turn-1]}});
      current=await next();
      if(current.type!=='accepted' || current.command!=='prompt' || current.turn!==turn) throw Error('Prompt not accepted');
      if(run.input.interrupt===turn) {
        await commands.send.send({type:'interrupt',turn});
        current=await next();
        if(current.type!=='accepted' || current.command!=='interrupt') throw Error('Interrupt not accepted');
      }
      current=await next();
      if(!['result','cancelled','error'].includes(current.type) || current.turn!==turn) throw Error('Missing turn result');
    }
    await commands.send.send({type:'close',turn:run.input.followups.length});
    await commands.send.close();
    current=await next();
    if(current.type!=='accepted' || current.command!=='close') throw Error('Close not accepted');
    const settled=await work;
    if('error' in settled) throw settled.error;
    result={outcome:'done',output:{records,conversation:settled.result}};
  } catch(error) {failure=error}
  finally {
    stop.abort(); await work;
    const closed=await Promise.allSettled([commands.send.close(),replies.receive.close()]);
    for(const value of closed) if(value.status==='rejected' && !failure) failure=value.reason;
  }
  if(failure) throw failure;
  return result;
});`,
  )
}
