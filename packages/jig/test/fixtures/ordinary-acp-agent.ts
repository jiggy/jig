import { expect } from 'bun:test'
import { cp, lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { flowSdkDirectory, flowSdkRuntimeDirectory } from './flow-dependency'

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
  await cp(flowSdkRuntimeDirectory, join(flow, 'sdk'), {
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

type ConversationArchives = Readonly<
  Partial<Record<'jig' | 'acp' | 'flow' | 'method', string | undefined>>
>

/** Ordinary installed consumer of one frozen Jig, ACP, method and SDK candidate set. */
export async function writeInstalledConversationHelperProject(
  root: string,
  cliRoot: string,
  selectedArchives: ConversationArchives = {
    jig: process.env.JIG_PACKAGE_ARCHIVE,
    acp: process.env.AGENT_ACP_PACKAGE_ARCHIVE,
    flow: process.env.FLOW_SDK_PACKAGE_ARCHIVE,
    method: process.env.AGENT_METHOD_PACKAGE_ARCHIVE,
  },
): Promise<{ readonly command: string; readonly versions: Readonly<Record<string, string>> }> {
  async function select(name: keyof ConversationArchives, variable: string): Promise<string> {
    const selected = selectedArchives[name]
    if (selected === undefined)
      throw new Error(`${variable} is required to qualify the native conversation candidate`)
    const archive = await realpath(resolve(selected))
    if (!(await lstat(archive)).isFile()) throw new Error(`${variable} must be a regular file`)
    return archive
  }
  const archives = {
    jig: await select('jig', 'JIG_PACKAGE_ARCHIVE'),
    acp: await select('acp', 'AGENT_ACP_PACKAGE_ARCHIVE'),
    flow: await select('flow', 'FLOW_SDK_PACKAGE_ARCHIVE'),
    method: await select('method', 'AGENT_METHOD_PACKAGE_ARCHIVE'),
  }
  const safeEnvironment: Record<string, string> = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'XDG_CACHE_HOME']) {
    const value = process.env[key]
    if (value !== undefined) safeEnvironment[key] = value
  }
  await installWorkspaceArtifact(
    root,
    'flow-sdk',
    'FLOW_SDK_PACKAGE_ARCHIVE',
    archives.flow,
    safeEnvironment,
  )
  await installWorkspaceArtifact(
    root,
    'agent-method',
    'AGENT_METHOD_PACKAGE_ARCHIVE',
    archives.method,
    safeEnvironment,
  )
  await installWorkspaceArtifact(
    root,
    'agent-acp',
    'AGENT_ACP_PACKAGE_ARCHIVE',
    archives.acp,
    safeEnvironment,
  )
  const flow = join(root, 'flows/conversation-helper')
  await mkdir(join(flow, 'contracts'), { recursive: true })
  await mkdir(join(root, 'bindings'), { recursive: true })
  await mkdir(cliRoot, { recursive: true })
  await cp(
    join(import.meta.dir, 'native-conversation-diagnostics.ts'),
    join(flow, 'native-conversation-diagnostics.ts'),
  )
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'native-conversation-consumer',
      private: true,
      type: 'module',
      workspaces: ['flows/*', 'packages/*'],
      dependencies: { '@jigging/agent-acp': 'workspace:*' },
    }),
  )
  await writeFile(
    join(cliRoot, 'package.json'),
    JSON.stringify({
      name: 'candidate-jig-cli-consumer',
      private: true,
      type: 'module',
      dependencies: { '@jigging/jig': archives.jig },
    }),
  )
  await writeFile(
    join(flow, 'package.json'),
    JSON.stringify({
      name: 'native-conversation-flow',
      private: true,
      type: 'module',
      dependencies: {
        '@jigging/flow': 'workspace:*',
        '@jigging/agent-method': 'workspace:*',
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
import { AgentConversationError, withAgentConversation } from '@jigging/agent-method/conversation'
import { nativeConversationErrorDiagnostic } from './native-conversation-diagnostics.js'

await handle(async run => {
  let phase = 'conversation-start'
  let interruption: 'accepted' | 'not-running' | undefined
  try {
    const completed = await withAgentConversation(run, {
      operationId: 'immediate-follow-up-interruption',
      slot: 'agent',
      input: { instructions: 'Reply with a short greeting.' },
    }, async conversation => {
      phase = 'await-initial'
      const initial = await conversation.initial
      if (initial.type !== 'result' || initial.result.outcome !== 'done')
        throw new Error('The initial Agent turn did not complete.')

      phase = 'send-follow-up'
      const followup = conversation.prompt({
        instructions: 'Write a detailed explanation of how to design a reliable public library. Continue until interrupted.',
      })
      phase = 'interrupt-follow-up'
      interruption = await conversation.interrupt()
      phase = 'await-follow-up'
      const turn = await followup
      if (turn.type !== 'result' && turn.type !== 'cancelled')
        throw new Error('The follow-up Agent turn did not settle normally.')
      phase = 'callback-return'
      return { interruption, turn: turn.type, turnNumber: turn.turn }
    })

    phase = 'complete'
    return {
      outcome: 'done',
      output: {
        ...completed.value,
        turns: completed.turns.map(turn => ({ turn: turn.turn, type: turn.type })),
        settlement: completed.settlement,
      },
    }
  } catch (error) {
    try {
      if (error instanceof AgentConversationError) {
        console.error(
          'agent-conversation-diagnostic ' +
            JSON.stringify({
              phase,
              interruption: interruption ?? null,
              turns: error.turns.map(turn =>
                turn.type === 'result'
                  ? { turn: turn.turn, type: turn.type, outcome: turn.result.outcome }
                  : turn.type === 'error'
                    ? { turn: turn.turn, type: turn.type, code: turn.code }
                    : { turn: turn.turn, type: turn.type },
              ),
              settlement: error.settlement?.outcome ?? null,
              ...nativeConversationErrorDiagnostic(error),
            }),
        )
      }
    } catch {
      // Diagnostic observation and output must preserve the original failure.
    }
    throw error
  }
})
`,
  )

  // Bun's default Linux backend hardlinks registry files to its shared cache.
  // This consumer exercises npm-style extracted package contents, which Jig
  // can safely capture as a self-contained selected source tree.
  const cliInstall = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      '--config=/dev/null',
      'install',
      '--ignore-scripts',
      '--backend=copyfile',
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
    [
      process.execPath,
      '--no-env-file',
      '--config=/dev/null',
      'install',
      '--ignore-scripts',
      '--backend=copyfile',
    ],
    { cwd: root, env: safeEnvironment, stdout: 'pipe', stderr: 'pipe' },
  )
  const [exit, stdout, stderr] = await Promise.all([
    install.exited,
    new Response(install.stdout).text(),
    new Response(install.stderr).text(),
  ])
  expect(exit, `${stdout}\n${stderr}`).toBe(0)
  const [jig, acp, sdk, method] = await Promise.all([
    packageVersion(join(cliRoot, 'node_modules/@jigging/jig/package.json'), '@jigging/jig'),
    packageVersion(
      join(root, 'node_modules/@jigging/agent-acp/package.json'),
      '@jigging/agent-acp',
    ),
    packageVersion(join(flow, 'node_modules/@jigging/flow/package.json'), '@jigging/flow'),
    packageVersion(
      join(flow, 'node_modules/@jigging/agent-method/package.json'),
      '@jigging/agent-method',
    ),
  ])
  const versions = Object.freeze({ jig, acp, flow: sdk, method })
  return { command: join(cliRoot, 'node_modules/.bin/jig'), versions }
}

async function packageVersion(path: string, name: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(path, 'utf8')) as {
    name?: unknown
    version?: unknown
  }
  if (packageJson.name !== name || typeof packageJson.version !== 'string')
    throw new Error(`Installed ${name} package has an invalid identity`)
  return packageJson.version
}

async function installWorkspaceArtifact(
  root: string,
  name: 'flow-sdk' | 'agent-method' | 'agent-acp',
  archiveVariable:
    | 'FLOW_SDK_PACKAGE_ARCHIVE'
    | 'AGENT_METHOD_PACKAGE_ARCHIVE'
    | 'AGENT_ACP_PACKAGE_ARCHIVE',
  selectedArchive?: string,
  environment?: Record<string, string>,
): Promise<{ readonly name: string; readonly version: string }> {
  const destination = join(root, 'packages', name)
  const artifacts = join(root, 'artifacts', name)
  await mkdir(destination, { recursive: true })
  await mkdir(artifacts, { recursive: true })
  let archive = selectedArchive ?? process.env[archiveVariable]
  if (archive === undefined) {
    const packageDirectory =
      name === 'flow-sdk' ? flowSdkDirectory : join(import.meta.dir, `../../../${name}`)
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
    ...(environment === undefined ? {} : { env: environment }),
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
  if (
    manifest.name !== `@jigging/${name === 'flow-sdk' ? 'flow' : name}` ||
    typeof manifest.version !== 'string'
  )
    throw new Error(`The packed ${name} artifact omitted its package identity`)
  return { name: manifest.name, version: manifest.version }
}
