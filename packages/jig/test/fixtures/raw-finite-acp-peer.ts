/**
 * Executable raw ACP transport peer for direct contained-resource tests.
 * This is not a Codex, Claude or Pi adapter and must never be installed as one.
 */
export function rawFiniteAcpPeerProgram(
  failBeforePrompt = false,
  rejectBeforePrompt = false,
): string {
  return `import { createInterface } from 'node:readline';
let authentication;
let shutdownScenario;
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const reply = (id, result) => send({jsonrpc:'2.0', id, result});
async function prompt(message) {
  const text = message.params.prompt.map(item => item.text ?? '').join('');
  const scenario = ['credential-text','credential-id','credential-plan','cancel','signal','exit','linger','v2-success'].find(value => text.includes('scenario:' + value));
  if (!scenario || !authentication) throw new Error('invalid fixture prompt');
  const event = {scenario, keyInEnvironment:process.env.METHOD_TEST_TOKEN !== undefined};
  const recorded = await fetch(authentication.endpoint, {method:'POST', headers:{authorization:'Bearer ' + authentication.credential}, body:JSON.stringify(event)});
  if (!recorded.ok) throw new Error('fixture recorder rejected dispatch');
  if (scenario === 'v2-success' || scenario === 'linger') {
    if (scenario === 'linger') {
      shutdownScenario = scenario;
      setInterval(() => {}, 1000);
    }
    const emit = update => send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update}});
    // v2 user insertion is observable before the prompt RPC acknowledges it.
    emit({sessionUpdate:'user_message',messageId:'fixture-user'});
    reply(message.id,{messageId:'fixture-user'});
    emit({sessionUpdate:'state_update',state:'running'});
    emit({sessionUpdate:'agent_message_chunk',messageId:'fixture-answer',content:{type:'text',text:scenario === 'linger' ? 'raw peer completed requested turn; waiting for stdin EOF' : 'v2 result'}});
    emit({sessionUpdate:'state_update',state:'idle',stopReason:'end_turn'});
    return;
  }
  // Explicit fault injection, not a reproduction of an unprompted native crash.
  if (scenario === 'signal') { console.error('fixture: deliberately raising SIGSEGV'); process.kill(process.pid, 'SIGSEGV'); return; }
  if (scenario === 'exit') { console.error('fixture: deliberately exiting 17'); process.exit(17); }
  if (scenario === 'cancel') {
    setInterval(() => {}, 1000);
    return;
  }
  if (scenario.startsWith('credential-')) {
    const secret = authentication.credential;
    const update = scenario === 'credential-plan'
      ? {sessionUpdate:'plan',entries:[{content:secret,priority:'high',status:'pending'}]}
      : {sessionUpdate:'agent_message_chunk',content:{type:'text',text:scenario === 'credential-text' ? secret : 'ordinary answer'},messageId:scenario === 'credential-id' ? secret : 'fixture-answer'};
    send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update}});
    return;
  }
}
for await (const line of createInterface({input:process.stdin})) {
  const message = JSON.parse(line);
  switch (message.method) {
    case 'initialize':
      if (message.params.protocolVersion !== 2) process.exit(29);
      if (message.params.clientCapabilities !== undefined || message.params.info?.name !== 'test-fixture' ||
          message.params.capabilities?.auth?._meta?.fixture !== true) process.exit(29);
      reply(message.id, {protocolVersion:2, capabilities:{session:{}}, info:{name:'fixture',version:'2'}, authMethods:[{id:'fixture',type:'agent',name:'Fixture'}]});
      break;
    case 'authenticate':
    case 'auth/login': authentication = message.params._meta; reply(message.id, {}); break;
    case 'session/new':
      if (${failBeforePrompt}) { console.error('fixture: pre-prompt native startup failure'); process.exit(17); }
      if (${rejectBeforePrompt}) { send({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:'private startup failure'}}); break; }
      reply(message.id, {sessionId:'fixture-session'}); break;
    case 'session/prompt': void prompt(message).catch(() => { console.error('ACP fixture failed'); process.exitCode = 1; process.stdin.destroy(); }); break;
    case 'session/close': reply(message.id, {}); break;
    default: if (message.id !== undefined) send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'unsupported fixture operation'}});
  }
}
if (shutdownScenario === 'linger') {
  const recorded = await fetch(authentication.endpoint, {method:'POST', headers:{authorization:'Bearer ' + authentication.credential}, body:JSON.stringify({scenario:shutdownScenario,phase:'stdin-eof'})});
  if (!recorded.ok) throw new Error('fixture recorder rejected shutdown');
}
`
}
