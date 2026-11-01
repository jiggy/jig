import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'

// Branch-only experiment. No credentials, protected environments or qualification evidence.
const install = resolve(process.argv[2])
const root = await mkdtemp(join(tmpdir(), 'jig-codex-reproduction-'))
let child
let timer
let requests = 0
const peer = createServer(async (request, response) => {
  let bytes = ''
  for await (const chunk of request) {
    bytes += chunk
    if (bytes.length > 1024 * 1024) throw new Error('request overflow')
  }
  if (!request.url.endsWith('/responses')) {
    response.writeHead(404).end('{}')
    return
  }
  requests++
  const body = JSON.parse(bytes)
  console.log('REQUEST', JSON.stringify({ path: request.url, keys: Object.keys(body), model: body.model, reasoning: body.reasoning, tools: body.tools?.map(tool => ({ type: tool.type, name: tool.name })) }))
  const text = 'READY'
  const item = { id: 'msg_local', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
  const result = { id: 'resp_local', object: 'response', created_at: 1, status: 'completed', model: body.model, output: [item], usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 } }
  const location = { item_id: item.id, output_index: 0, content_index: 0 }
  const events = [
    { type: 'response.created', response: { ...result, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
    { type: 'response.content_part.added', ...location, part: { ...item.content[0], text: '' } },
    { type: 'response.output_text.delta', ...location, delta: text, logprobs: [] },
    { type: 'response.output_text.done', ...location, text, logprobs: [] },
    { type: 'response.content_part.done', ...location, part: item.content[0] },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: result },
  ]
  response.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'local-only' })
  for (const [sequence_number, event] of events.entries()) response.write(`event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
  response.end()
})
await new Promise(resolve => peer.listen(0, '127.0.0.1', resolve))
try {
  const home = join(root, 'home')
  const project = join(root, 'project')
  await mkdir(home)
  await mkdir(project)
  const features = { apps: false, code_mode: false, code_mode_host: false, plugins: false, remote_plugin: false, tool_suggest: false }
  await writeFile(join(home, 'config.toml'), `cli_auth_credentials_store = "ephemeral"\nmodel_provider = "custom-gateway"\n[model_providers.custom-gateway]\nname = "local-only"\nbase_url = "http://127.0.0.1:${peer.address().port}/v1"\nwire_api = "responses"\n[features]\n${Object.entries(features).map(([key, value]) => `${key} = ${value}`).join('\n')}\n`)
  const wrapper = join(root, 'native-wrapper')
  await writeFile(wrapper, `#!${process.execPath}\nimport { spawn } from 'node:child_process'; import { createInterface } from 'node:readline'; const child = spawn(process.env.NATIVE_CODEX, process.argv.slice(2), { stdio: ['pipe', 'pipe', 'inherit'] }); process.stdin.pipe(child.stdin); for await (const line of createInterface({ input: child.stdout })) { const frame = JSON.parse(line); if (frame.method === 'error' || frame.params?.turn?.error) process.stderr.write('NATIVE_LOCAL_ERROR ' + line + '\\n'); process.stdout.write(line + '\\n'); } child.on('close', code => {process.exitCode = code});`, { mode: 0o700 })
  child = spawn(process.execPath, [join(install, 'node_modules/@agentclientprotocol/codex-acp/dist/index.js')], { cwd: project, env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, CODEX_PATH: wrapper, NATIVE_CODEX: join(install, 'node_modules/.bin/codex'), CODEX_CONFIG: JSON.stringify({ model: 'openrouter/free', features, 'analytics.enabled': false, check_for_update_on_startup: false, 'history.persistence': 'none', log_dir: join(root, 'logs'), sqlite_home: join(root, 'state') }), INITIAL_AGENT_MODE: 'read-only' }, stdio: ['pipe', 'pipe', 'pipe'] })
  timer = setTimeout(() => { console.error('DEADLINE'); child.kill('SIGKILL') }, 45000)
  child.stderr.on('data', bytes => process.stderr.write(bytes))
  const pending = new Map()
  const lines = (async () => {
    for await (const line of createInterface({ input: child.stdout })) {
      const frame = JSON.parse(line)
      if (frame.id !== undefined) {
        pending.get(frame.id)?.(frame)
        pending.delete(frame.id)
      } else if (frame.params?.update?._meta?.jetbrains?.air?.sessionFailure) {
        console.log('ACP_LOCAL_FAILURE', JSON.stringify(frame))
      }
    }
    for (const reject of pending.values()) reject({ error: 'ACP ended' })
  })()
  let id = 0
  const request = (method, params) => new Promise((resolve, reject) => {
    const number = ++id
    pending.set(number, frame => {
      console.log('REPLY', method, JSON.stringify(method === 'session/new' ? { sessionId: frame.result?.sessionId, error: frame.error } : frame))
      if (frame.error) reject(new Error(JSON.stringify(frame.error)))
      else resolve(frame.result)
    })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: number, method, params }) + '\n')
  })
  await request('initialize', { protocolVersion: 1, clientCapabilities: { _meta: { jetbrains: { air: { version: 1, capabilities: ['sessionFailure'] } } } } })
  await request('authenticate', { methodId: 'gateway', _meta: { gateway: { baseUrl: `http://127.0.0.1:${peer.address().port}/v1`, providerName: 'local-only', headers: { Authorization: 'Bearer not-a-real-credential' } } } })
  const opened = await request('session/new', { cwd: project, mcpServers: [] })
  await request('session/set_mode', { sessionId: opened.sessionId, modeId: 'read-only' })
  const answer = await request('session/prompt', { sessionId: opened.sessionId, prompt: [{ type: 'text', text: 'Reply exactly READY. Do not use tools.' }] })
  console.log('RESULT', JSON.stringify({ requests, answer }))
  await request('session/close', { sessionId: opened.sessionId })
  child.stdin.end()
  await lines
  if (requests !== 1 || answer.stopReason !== 'end_turn' || answer._meta?.jetbrains?.air?.sessionFailure?.severity === 'error') process.exitCode = 1
} finally {
  clearTimeout(timer)
  child?.kill('SIGKILL')
  peer.closeAllConnections()
  await new Promise(resolve => peer.close(resolve))
  await rm(root, { force: true, recursive: true })
}
