/**
 * Executable raw ACP transport peer for direct contained-resource tests.
 * This is not a Codex, Claude or Pi adapter and must never be installed as one.
 */
export function rawFiniteAcpPeerProgram(): string {
  return `import { createInterface } from 'node:readline';
let authentication;
let shutdownScenario;
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const reply = (id, result) => send({jsonrpc:'2.0', id, result});
async function prompt(message) {
  const text = message.params.prompt.map(item => item.text ?? '').join('');
  const scenario = ['credential-text','credential-id','credential-plan','cancel','signal','exit','linger'].find(value => text.includes('scenario:' + value));
  if (!scenario || !authentication) throw new Error('invalid fixture prompt');
  const event = {scenario, keyInEnvironment:process.env.METHOD_TEST_TOKEN !== undefined};
  const recorded = await fetch(authentication.endpoint, {method:'POST', headers:{authorization:'Bearer ' + authentication.credential}, body:JSON.stringify(event)});
  if (!recorded.ok) throw new Error('fixture recorder rejected dispatch');
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
      : {sessionUpdate:'agent_message_chunk',content:{type:'text',text:scenario === 'credential-text' ? secret : 'ordinary answer'},...(scenario === 'credential-id' ? {messageId:secret} : {})};
    send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update}});
    return;
  }
  if (scenario === 'linger') {
    shutdownScenario = scenario;
    // Keep this real process alive after protocol completion and stdin EOF.
    // The production resource's shutdown grace must fence it, not the test.
    setInterval(() => {}, 1000);
  }
  send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'raw peer completed requested turn; waiting for stdin EOF'}}}});
  reply(message.id, {stopReason:'end_turn'});
}
for await (const line of createInterface({input:process.stdin})) {
  const message = JSON.parse(line);
  switch (message.method) {
    case 'initialize': reply(message.id, {protocolVersion:1,agentCapabilities:{sessionCapabilities:{close:{}}},authMethods:[{id:'fixture',name:'Fixture'}]}); break;
    case 'authenticate': authentication = message.params._meta; reply(message.id, {}); break;
    case 'session/new': reply(message.id, {sessionId:'fixture-session'}); break;
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
