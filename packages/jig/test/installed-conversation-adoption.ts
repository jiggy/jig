import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { MACOS_FIXTURE_SETTLEMENT_MS } from './fixtures/agent-fixture-host.js'
import { settleTestCommand } from './fixtures/bounded-command.js'

// Consume only installed public packages and the guide's unchanged caller.
// The peer is an ordinary Flow, not a native-client or model-quality proof.
export async function checkInstalledConversation(options: {
  directory: string
  cli: string
  sdkArchive: string
  methodArchive: string
}) {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'XDG_RUNTIME_DIR',
    'DBUS_SESSION_BUS_ADDRESS',
    'FLOW_NODE',
    'JIG_AUTHORING_NODE_PATH',
  ]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key]
  }
  const evidence = `${options.directory}.commands`
  await mkdir(evidence, { mode: 0o700 })
  let commandIndex = 0
  async function command(args: string[], cwd = options.directory, expected = 0) {
    const child = Bun.spawn(args, { cwd, env: environment, stdout: 'pipe', stderr: 'pipe' })
    const { code, stdout, stderr } = await settleTestCommand(child, {
      evidence: join(evidence, String(++commandIndex).padStart(3, '0')),
      timeoutMs: MACOS_FIXTURE_SETTLEMENT_MS,
    })
    assert.equal(code, expected, `${args[1]} failed (${code})\n${stdout}${stderr}`)
    return stdout
  }
  await command(
    [options.cli, 'init', options.directory, '--bare'],
    resolve(options.directory, '..'),
  )
  await writeFile(
    join(options.directory, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      workspaces: ['flows/*', 'libs/*'],
      dependencies: {
        '@jigging/agent-method': 'workspace:*',
      },
    }),
  )
  for (const [name, archive] of [
    ['flow', options.sdkArchive],
    ['method', options.methodArchive],
  ] as const) {
    const library = join(options.directory, 'libs', name)
    await mkdir(library, { recursive: true })
    await command(['tar', '-xzf', archive, '--strip-components=1', '-C', library])
  }
  await command([process.execPath, 'install', '--ignore-scripts', '--backend', 'copyfile'])
  await command([options.cli, 'new', 'worker', '--use', 'agent=npm:@jigging/agent-method'])
  await command([options.cli, 'import-contract', 'npm:@jigging/agent-method', 'flows/peer'])
  const worker = join(options.directory, 'flows/worker'),
    peer = join(options.directory, 'flows/peer')
  for (const directory of [worker, peer]) {
    const manifest =
      directory === worker
        ? JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
        : { name: 'offline-peer', private: true, type: 'module', dependencies: {} }
    manifest.dependencies['@jigging/flow'] = 'workspace:*'
    if (directory === worker) manifest.dependencies['@jigging/agent-method'] = 'workspace:*'
    await writeFile(join(directory, 'package.json'), JSON.stringify(manifest))
  }
  const guide = await readFile(
    resolve(import.meta.dir, '../../../docs/jig/guide/conversations.md'),
    'utf8',
  )
  const caller = [...guide.matchAll(/```ts\n([\s\S]*?)\n```/g)]
    .map((match) => match[1])
    .find((source) => source?.includes('import { withAgentConversation }'))
  assert.ok(caller, 'Conversation guide must contain its complete public caller')
  await writeFile(join(worker, 'FLOW.ts'), caller)
  const metadata = JSON.parse(await readFile(join(worker, 'FLOW.meta.json'), 'utf8'))
  metadata.uses.agent.requires = ['conversation', 'events']
  await writeFile(join(worker, 'FLOW.meta.json'), JSON.stringify(metadata))
  await writeFile(
    join(peer, 'FLOW.meta.json'),
    JSON.stringify({ supports: ['conversation', 'events'] }),
  )
  await writeFile(
    join(peer, 'settings.schema.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/schema-0.json',
      type: 'object',
      properties: {
        firstOutcome: { enum: ['done', 'blocked'] },
        lagged: { type: 'boolean' },
        hold: { type: 'boolean' },
      },
      additionalProperties: false,
    }),
  )
  await writeFile(
    join(peer, 'FLOW.ts'),
    `import {handle} from '@jigging/flow'
await handle(async run => {
  const {commands,replies,events}=run.channels
  if(commands?.direction!=='receive'||replies?.direction!=='send'||events?.direction!=='send') throw Error('Conversation ports required')
  let turn=0, settled=true
  async function answer(text,outcome='done') {
    await events.send({sessionUpdate:'agent_message_chunk',turn,content:{type:'text',text}})
    await replies.send({type:'result',turn,result:{outcome,output:{text}}})
    settled=true
  }
  await answer('Draft: recovery 09:48; cause unknown.',run.settings.firstOutcome??'done')
  for await(const control of commands) {
    if(control.type==='prompt'&&control.turn===1&&turn===0) {
      turn=1; settled=false
      await replies.send({type:'accepted',command:'prompt',turn})
      if(!run.settings.hold) await answer('Revision: recovery 09:47; cause unknown.')
    } else if(control.type==='interrupt'&&control.turn===turn&&!settled) {
      await replies.send({type:'accepted',command:'interrupt',turn})
      await replies.send({type:'cancelled',turn}); settled=true
    } else if(control.type==='close'&&control.turn===turn&&settled) {
      await replies.send({type:'accepted',command:'close',turn})
      if(!(await commands.next()).done) throw Error('Control after close')
      await replies.close(); await events.close(run.settings.lagged?{error:'LAGGED'}:{})
      await commands.close()
      return {outcome:'done',output:{turns:turn+1}}
    } else throw Error('Unexpected control')
  }
  throw Error('Missing clean conversation close')
})`,
  )
  await mkdir(join(options.directory, 'bindings'), { recursive: true })
  await writeFile(
    join(options.directory, 'jig.ts'),
    `import {defineJig,discover} from '@jigging/jig'
export default defineJig({flows:discover('flows'),bindings:discover('bindings'),defaultProviders:{'https://jig.md/contracts/agent-run':'binding:agent'}})`,
  )
  async function review(settings: object) {
    await writeFile(
      join(options.directory, 'bindings/agent.ts'),
      `import {defineBinding} from '@jigging/jig'
export default defineBinding({package:'flows/peer',settings:${JSON.stringify(settings)}})`,
    )
    await command([options.cli, 'review', '--yes', '--allow-resolution-network'])
  }
  const input = JSON.stringify({
    facts: 'Recovery at 09:48; cause unknown.',
    correction: 'Reconciled recovery time: 09:47. Keep cause uncertain.',
  })
  async function run(value = input, expected = 0) {
    return JSON.parse(
      await command(
        [options.cli, 'run', 'flow:flows/worker', '--timeout', '180s', '--input', value, '--json'],
        options.directory,
        expected,
      ),
    )
  }
  await command([process.execPath, 'install', '--ignore-scripts', '--backend', 'copyfile'])
  await review({})
  const completed = await run()
  assert.equal(completed.status, 'succeeded')
  assert.deepEqual(completed.output.turn, {
    type: 'result',
    turn: 1,
    result: { outcome: 'done', output: { text: 'Revision: recovery 09:47; cause unknown.' } },
  })
  assert.deepEqual(completed.output.settlement, { outcome: 'done', output: { turns: 2 } })
  assert.equal(completed.output.observation, 'complete')
  const malformed = await run('{"facts":17,"correction":"Keep uncertainty."}', 1)
  assert.equal(malformed.status, 'failed')
  assert.match(malformed.diagnostics.stderr, /Supply facts and correction strings/)
  await review({ firstOutcome: 'blocked' })
  const blocked = await run()
  assert.equal(blocked.output.turn.result.outcome, 'blocked')
  assert.deepEqual(blocked.output.settlement, { outcome: 'done', output: { turns: 1 } })
  await review({ lagged: true })
  const lagged = await run()
  assert.equal(lagged.output.observation, 'incomplete')
  assert.deepEqual(lagged.output.settlement, { outcome: 'done', output: { turns: 2 } })
  // Follow the public interruption instructions without a call-specific abort:
  // accepted interruption, settled turn and settled invocation remain distinct.
  await writeFile(
    join(worker, 'FLOW.ts'),
    `import {handle} from '@jigging/flow'
import {withAgentConversation} from '@jigging/agent-method/conversation'
await handle(async run=>{
  const completed=await withAgentConversation(run,{operationId:'interrupt',slot:'agent',input:{instructions:'Draft'},onEvent(){}},async conversation=>{
    await conversation.initial
    const pending=conversation.prompt({instructions:'Wait for interruption'})
    await conversation.interrupt()
    return await pending
  })
  return {outcome:'done',output:{turn:completed.value,settlement:completed.settlement}}
})`,
  )
  await review({ hold: true })
  const interrupted = await run()
  assert.equal(interrupted.status, 'succeeded')
  assert.deepEqual(interrupted.output.turn, { type: 'cancelled', turn: 1 })
  assert.deepEqual(interrupted.output.settlement, { outcome: 'done', output: { turns: 2 } })
  console.log(
    'Installed public conversation adoption passed: unchanged caller, malformed input, blocked turn, observation loss and settled interruption; no model calls.',
  )
}
