import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createPrivateAcpAgentProvider } from '../../src/internal/acp-agent-provider.js'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import type { PrivateInstalledBunLocation } from '../../src/internal/installed-bun-support.js'
import { openPrivateAcpResources } from '../../src/internal/private-acp-resources.js'

/** Real finite owner/transport with only the external native peer replaced by a test program. */
export async function openDeterministicFiniteAcpHost(
  location: PrivateInstalledBunLocation,
  environment: Readonly<Record<string, string | undefined>>,
  projectDirectory: string = process.cwd(),
) {
  const host = await openPrivateInstalledBunHost(location, environment, projectDirectory)
  return {
    ...host,
    acpResources: openPrivateAcpResources(
      host.installedBunSupport,
      environment,
      projectDirectory,
      async (client, support, frozenEnvironment) => {
        const endpoint = frozenEnvironment.ACP_TEST_ENDPOINT
        const credential = frozenEnvironment.METHOD_TEST_TOKEN
        if (
          client !== 'codex' ||
          endpoint === undefined ||
          !/^http:\/\/127\.0\.0\.1:\d+\/dispatch$/.test(endpoint) ||
          credential === undefined
        )
          throw new Error('The finite ACP fixture requires its exact recorder and authority')
        return await createPrivateAcpAgentProvider({
          client: 'openai-codex',
          model: 'fixture-model',
          credentialMode: 'test-authentication',
          adapterPath: await realpath(join(support.releaseRoot, 'libexec/agent/fixture-acp.js')),
          sandboxAdapterPath: '/agent/fixture-acp.js',
          executablePath: await realpath(support.executablePath),
          sandboxExecutablePath: '/agent/client',
          environment: {},
          authentication: {
            identity: { method: 'fixture', endpoint },
            request: { methodId: 'fixture', _meta: { endpoint, credential } },
          },
        })
      },
    ),
  }
}

export async function writeDeterministicAcpAgent(releaseRoot: string): Promise<void> {
  await mkdir(join(releaseRoot, 'libexec/agent'), { recursive: true })
  await writeFile(join(releaseRoot, 'libexec/agent/fixture-acp.js'), deterministicAcpProgram())
}

export function deterministicAcpProgram(): string {
  return `import { createInterface } from 'node:readline';
let authentication;
let cancel;
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const reply = (id, result) => send({jsonrpc:'2.0', id, result});
async function prompt(message) {
  const text = message.params.prompt.map(item => item.text ?? '').join('');
  const scenario = ['schema-invalid','malformed','recovery','success','slow'].find(value => text.includes('scenario:' + value));
  if (!scenario || !authentication) throw new Error('invalid fixture prompt');
  let wait;
  if (scenario === 'slow' || scenario === 'recovery') wait = new Promise(resolve => {
    const timer = setTimeout(resolve, 60000);
    cancel = () => { clearTimeout(timer); resolve(); };
  });
  const event = {scenario, selectedSkill:text.includes('SELECTED_SKILL_MARKER'), hiddenSkill:text.includes('HIDDEN_SKILL_MARKER'), keyInEnvironment:process.env.METHOD_TEST_TOKEN !== undefined};
  const recorded = await fetch(authentication.endpoint, {method:'POST', headers:{authorization:'Bearer ' + authentication.credential}, body:JSON.stringify(event)});
  if (!recorded.ok) throw new Error('fixture recorder rejected dispatch');
  if (scenario === 'slow' || scenario === 'recovery') {
    await wait;
    reply(message.id, {stopReason:'cancelled'});
    return;
  }
  if (scenario === 'malformed') { reply(message.id, {stopReason:'invalid-fixture-stop'}); return; }
  const result = {decision:{route:scenario === 'schema-invalid' ? 'invalid' : 'technical', evidence:[{keyLocation:event.keyInEnvironment ? 'environment' : 'stdin', selectedSkill:event.selectedSkill ? 'present' : 'absent', hiddenSkill:event.hiddenSkill ? 'present' : 'absent', sourceLine:1, amount:null}], ambiguity:null}};
  send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify(result)}}}});
  reply(message.id, {stopReason:'end_turn'});
}
for await (const line of createInterface({input:process.stdin})) {
  const message = JSON.parse(line);
  switch (message.method) {
    case 'initialize': reply(message.id, {protocolVersion:1,agentCapabilities:{sessionCapabilities:{close:{}}},authMethods:[{id:'fixture',name:'Fixture'}]}); break;
    case 'authenticate': authentication = message.params._meta; reply(message.id, {}); break;
    case 'session/new': reply(message.id, {sessionId:'fixture-session'}); break;
    case 'session/prompt': void prompt(message).catch(() => { console.error('ACP fixture failed'); process.exitCode = 1; process.stdin.destroy(); }); break;
    case 'session/cancel': cancel?.(); break;
    case 'session/close': reply(message.id, {}); break;
    default: if (message.id !== undefined) send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'unsupported fixture operation'}});
  }
}
`
}
