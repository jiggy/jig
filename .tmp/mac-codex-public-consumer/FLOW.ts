import { handle, type JsonValue } from '@jigging/flow'
import {
  FiniteAcpFrames,
  fragmentFiniteAcpFrame,
  readFiniteAcpReady,
} from '@jigging/agent-acp/transport'

// This ordinary application deliberately creates no prompt and returns no successful
// finite-ACP result. Its external application cancels this fresh root identity.
await handle(async run => {
  const requests = await run.channel({ contract: './contracts/finite-acp/requests.json' })
  const responses = await run.channel({ contract: './contracts/finite-acp/responses.json' })
  const work = run.call({
    operationId: 'codex-startup', slot: 'native', input: null,
    channels: { requests: requests.receive, responses: responses.send },
  }, { signal: run.signal }).then(result => ({ result }), error => ({ error }))
  const ended = work.then(() => { throw Error('Native resource ended before root cancellation') })
  void ended.catch(() => {})
  const next = () => Promise.race([responses.receive.next({ signal: run.signal }), ended])
  const frames = new FiniteAcpFrames('responses')
  let sequence = 0
  const rpc = async (method: 'initialize' | 'session/new', params: object) => {
    const id = ++sequence
    for (const fragment of fragmentFiniteAcpFrame(JSON.stringify({ jsonrpc: '2.0', id, method, params })))
      await requests.send.send(fragment as unknown as JsonValue, { signal: run.signal })
    for (;;) {
      const item = await next()
      if (item.done) throw Error('Native response stream ended before reply')
      const text = frames.accept(item.value)
      if (text === undefined) continue
      const frame = JSON.parse(text)
      if (frame.method !== undefined) continue
      if (frame.jsonrpc !== '2.0' || frame.id !== id || frame.error !== undefined || !frame.result)
        throw Error('Genuine native startup request did not succeed')
      return frame.result
    }
  }
  try {
    const item = await next()
    if (item.done) throw Error('Native resource omitted its ready record')
    const ready = readFiniteAcpReady(item.value)
    const initialized = await rpc('initialize', {
      protocolVersion: 2, capabilities: {}, info: { name: 'ordinary-startup-consumer', version: '1' },
    })
    if (initialized.protocolVersion !== 2) throw Error('Unsupported native protocol')
    const session = await rpc('session/new', { cwd: ready.cwd, mcpServers: [] })
    if (typeof session.sessionId !== 'string' || session.sessionId.length === 0)
      throw Error('Genuine native session creation omitted its identity')
    // Native session IDs, credentials and native response bodies are never saved.
    await run.call({ operationId: 'startup-ready', slot: 'progress', input: {
      sequence: 1,
      evidence: { stage: 'codex-session-ready', initialized: true, sessionCreated: true, promptSent: false },
      files: {},
    } })
    await Promise.race([ended, new Promise<never>((_, reject) => {
      const abort = () => reject(Error('Root cancellation observed'))
      if (run.signal.aborted) abort()
      else run.signal.addEventListener('abort', abort, { once: true })
    })])
    throw Error('Startup consumer unexpectedly resumed')
  } finally {
    // Root cancellation owns the real native operation. Join it before closing
    // request EOF, which is not valid zero-turn finite-ACP completion.
    await work
    await Promise.allSettled([requests.send.close(), responses.receive.close()])
  }
})
