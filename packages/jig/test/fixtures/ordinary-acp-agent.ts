import { expect } from 'bun:test'
import { cp, lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
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

/** A normal workspace Flow importing the published conversation helper subpath. */
export async function writeConversationHelperCaller(root: string): Promise<void> {
  const sdk = await installWorkspaceArtifact(root, 'flow-sdk', 'FLOW_SDK_PACKAGE_ARCHIVE')
  const method = await installWorkspaceArtifact(
    root,
    'agent-method',
    'AGENT_METHOD_PACKAGE_ARCHIVE',
  )
  const flow = join(root, 'flows/conversation-helper')
  await mkdir(flow, { recursive: true })
  await cp(
    join(import.meta.dir, '../../../../docs/jig/spec/contracts/agent-run'),
    join(flow, 'contracts/agent-run'),
    { recursive: true },
  )
  await writeFile(
    join(flow, 'package.json'),
    JSON.stringify({
      name: 'native-conversation-helper-caller',
      private: true,
      type: 'module',
      dependencies: { [sdk.name]: sdk.version, [method.name]: method.version },
    }),
  )
  await writeFile(
    join(flow, 'FLOW.meta.json'),
    JSON.stringify({
      uses: {
        agent: {
          contract: './contracts/agent-run/contract.json',
          requires: ['conversation'],
        },
      },
    }),
  )
  await writeFile(
    join(flow, 'FLOW.ts'),
    `import { handle } from '@jigging/flow';
import { withAgentConversation } from '@jigging/agent-method/conversation';

await handle(async run => {
  const completed = await withAgentConversation(run, {
    operationId: 'immediate-follow-up-interruption',
    slot: 'agent',
    input: { instructions: 'Reply with a short greeting.' },
  }, async conversation => {
    const initial = await conversation.initial;
    if (initial.type !== 'result' || initial.result.outcome !== 'done')
      throw new Error('The initial Agent turn did not complete.');

    const followup = conversation.prompt({
      instructions: 'Write a detailed explanation of how to design a reliable public library. Continue until interrupted.',
    });
    const interruption = await conversation.interrupt();
    const turn = await followup;
    if (turn.type !== 'result' && turn.type !== 'cancelled')
      throw new Error('The follow-up Agent turn did not settle normally.');
    return { interruption, turn: turn.type, turnNumber: turn.turn };
  });

  return {
    outcome: 'done',
    output: {
      ...completed.value,
      turns: completed.turns.map(turn => ({ turn: turn.turn, type: turn.type })),
      settlement: completed.settlement,
    },
  };
});`,
  )
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ private: true, type: 'module', workspaces: ['flows/*', 'packages/*'] }),
  )
  const install = Bun.spawn(
    [process.execPath, '--no-env-file', 'install', '--ignore-scripts', '--config=/dev/null'],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  )
  const [exit, stdout, stderr] = await Promise.all([
    install.exited,
    new Response(install.stdout).text(),
    new Response(install.stderr).text(),
  ])
  expect(exit, `${stdout}\n${stderr}`).toBe(0)
}

/** Ordinary consumer assembled from exact published npm prerelease packages. */
export async function writePublishedConversationHelperProject(
  root: string,
  cliRoot: string,
): Promise<{ readonly command: string; readonly versions: Readonly<Record<string, string>> }> {
  const flow = join(root, 'flows/conversation-helper')
  await mkdir(join(flow, 'contracts'), { recursive: true })
  await mkdir(join(root, 'bindings'), { recursive: true })
  await mkdir(cliRoot, { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'published-conversation-consumer',
      private: true,
      type: 'module',
      workspaces: ['flows/*'],
      dependencies: { '@jigging/agent-acp': '0.1.0-alpha.3' },
    }),
  )
  await writeFile(
    join(cliRoot, 'package.json'),
    JSON.stringify({
      name: 'published-jig-cli-consumer',
      private: true,
      type: 'module',
      dependencies: { '@jigging/jig': '0.1.0-alpha.22' },
    }),
  )
  await writeFile(
    join(flow, 'package.json'),
    JSON.stringify({
      name: 'published-conversation-flow',
      private: true,
      type: 'module',
      dependencies: {
        '@jigging/flow': '0.1.0-alpha.12',
        '@jigging/agent-method': '0.1.0-alpha.3',
      },
    }),
  )
  await writeFile(
    join(root, 'jig.ts'),
    `import { defineJig, discover } from '@jigging/jig'
export default defineJig({
  flows: discover('flows'),
  bindings: discover('bindings'),
  defaultProviders: { 'https://jig.md/contracts/agent-run': 'binding:agent' },
})
`,
  )
  await writeFile(
    join(root, 'bindings/agent.ts'),
    `import { defineBinding } from '@jigging/jig'
export default defineBinding({
  package: 'npm:@jigging/agent-acp',
  slots: { native: { kind: 'acp', client: 'codex', maxTurns: 2 } },
})
`,
  )
  await writeFile(
    join(flow, 'FLOW.meta.json'),
    JSON.stringify({
      uses: {
        agent: {
          contract: './contracts/agent-run/FLOW.contract.json',
          requires: ['conversation'],
        },
      },
    }),
  )
  await writeFile(
    join(flow, 'FLOW.ts'),
    `import { handle } from '@jigging/flow'
import { withAgentConversation } from '@jigging/agent-method/conversation'

await handle(async run => {
  const completed = await withAgentConversation(run, {
    operationId: 'immediate-follow-up-interruption',
    slot: 'agent',
    input: { instructions: 'Reply with a short greeting.' },
  }, async conversation => {
    const initial = await conversation.initial
    if (initial.type !== 'result' || initial.result.outcome !== 'done')
      throw new Error('The initial Agent turn did not complete.')

    const followup = conversation.prompt({
      instructions: 'Write a detailed explanation of how to design a reliable public library. Continue until interrupted.',
    })
    const interruption = await conversation.interrupt()
    const turn = await followup
    if (turn.type !== 'result' && turn.type !== 'cancelled')
      throw new Error('The follow-up Agent turn did not settle normally.')
    return { interruption, turn: turn.type, turnNumber: turn.turn }
  })

  return {
    outcome: 'done',
    output: {
      ...completed.value,
      turns: completed.turns.map(turn => ({ turn: turn.turn, type: turn.type })),
      settlement: completed.settlement,
    },
  }
})
`,
  )

  const safeEnvironment: Record<string, string> = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'XDG_CACHE_HOME']) {
    const value = process.env[key]
    if (value !== undefined) safeEnvironment[key] = value
  }
  const cliInstall = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      '--config=/dev/null',
      'install',
      '--ignore-scripts',
      '--registry=https://registry.npmjs.org/',
    ],
    {
      cwd: cliRoot,
      env: { ...safeEnvironment, NPM_CONFIG_USERCONFIG: '/dev/null' },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [cliExit, cliStdout, cliStderr] = await Promise.all([
    cliInstall.exited,
    new Response(cliInstall.stdout).text(),
    new Response(cliInstall.stderr).text(),
  ])
  expect(cliExit, `${cliStdout}\n${cliStderr}`).toBe(0)
  const install = Bun.spawn(
    [process.execPath, '--no-env-file', '--config=/dev/null', 'install', '--ignore-scripts'],
    { cwd: root, env: safeEnvironment, stdout: 'pipe', stderr: 'pipe' },
  )
  const [exit, stdout, stderr] = await Promise.all([
    install.exited,
    new Response(install.stdout).text(),
    new Response(install.stderr).text(),
  ])
  expect(exit, `${stdout}\n${stderr}`).toBe(0)
  const [jig, acp, sdk, method] = await Promise.all([
    packageVersion(join(cliRoot, 'node_modules/@jigging/jig/package.json')),
    packageVersion(join(root, 'node_modules/@jigging/agent-acp/package.json')),
    packageVersion(join(flow, 'node_modules/@jigging/flow/package.json')),
    packageVersion(join(flow, 'node_modules/@jigging/agent-method/package.json')),
  ])
  const versions = Object.freeze({ jig, acp, flow: sdk, method })
  return { command: join(cliRoot, 'node_modules/.bin/jig'), versions }
}

async function packageVersion(path: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(path, 'utf8')) as { version?: unknown }
  if (typeof packageJson.version !== 'string') throw new Error('Published package omitted version')
  return packageJson.version
}

async function installWorkspaceArtifact(
  root: string,
  name: 'flow-sdk' | 'agent-method',
  archiveVariable: 'FLOW_SDK_PACKAGE_ARCHIVE' | 'AGENT_METHOD_PACKAGE_ARCHIVE',
): Promise<{ readonly name: string; readonly version: string }> {
  const destination = join(root, 'packages', name)
  const artifacts = join(root, 'artifacts', name)
  await mkdir(destination, { recursive: true })
  await mkdir(artifacts, { recursive: true })
  let archive = process.env[archiveVariable]
  if (archive === undefined) {
    const packageDirectory = join(import.meta.dir, `../../../${name}`)
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
      { cwd: packageDirectory, stdout: 'pipe', stderr: 'pipe' },
    )
    const [exit, stdout, stderr] = await Promise.all([
      pack.exited,
      new Response(pack.stdout).text(),
      new Response(pack.stderr).text(),
    ])
    expect(exit, `${stdout}\n${stderr}`).toBe(0)
    const archives = (await readdir(artifacts)).filter((entry) => entry.endsWith('.tgz'))
    expect(archives).toHaveLength(1)
    const [packedArchive] = archives
    if (packedArchive === undefined) throw new Error(`Bun did not pack ${name}`)
    archive = join(artifacts, packedArchive)
  }
  archive = await realpath(resolve(archive))
  if (!(await lstat(archive)).isFile()) throw new Error(`${archiveVariable} must be a regular file`)
  const extract = Bun.spawn(['tar', '-xzf', archive, '--strip-components=1', '-C', destination], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exit, stdout, stderr] = await Promise.all([
    extract.exited,
    new Response(extract.stdout).text(),
    new Response(extract.stderr).text(),
  ])
  expect(exit, `${stdout}\n${stderr}`).toBe(0)
  const manifest = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8')) as {
    name?: unknown
    version?: unknown
  }
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string')
    throw new Error(`The packed ${name} artifact omitted its package identity`)
  return { name: manifest.name, version: manifest.version }
}
