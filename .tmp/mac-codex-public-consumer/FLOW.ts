import { handle, OperationError, type JsonValue } from '@jigging/flow'
import { FiniteAcpFrames, fragmentFiniteAcpFrame, readFiniteAcpReady } from '@jigging/agent-acp/transport'

// No prompt or successful zero-turn completion. An outside application cancels
// only this fresh root after the accepted session-ready checkpoint.
await handle(async run => {
  let checkpointSequence = 0
  let phase = 'flow-started'
  let initialized = false
  let sessionCreated = false
  const save = async (stage: string, extra: Record<string, JsonValue> = {}) => {
    await run.call({ operationId: `startup-progress-${++checkpointSequence}`, slot: 'progress', input: {
      sequence: checkpointSequence,
      evidence: { stage, initialized, sessionCreated, promptSent: false, ...extra }, files: {},
    } })
  }
  await save('flow-started')
  phase = 'create-channels'
  const requests = await run.channel({ contract: './contracts/finite-acp/requests.json' })
  const responses = await run.channel({ contract: './contracts/finite-acp/responses.json' })
  const work = run.call({ operationId: 'codex-startup', slot: 'native', input: null,
    channels: { requests: requests.receive, responses: responses.send },
  }, { signal: run.signal }).then(result => ({ result }), error => ({ error }))
  const ended = work.then(value => {
    // Preserve the public OperationError code without exposing its message/details.
    if ('error' in value) throw value.error
    throw Error('Native resource ended before root cancellation')
  })
  void ended.catch(() => {})
  const next = () => Promise.race([responses.receive.next({ signal: run.signal }), ended])
  const frames = new FiniteAcpFrames('responses')
  let sequence = 0
  const rpc = async (method: 'initialize' | 'session/new', params: object) => {
    const id = ++sequence
    for (const fragment of fragmentFiniteAcpFrame(JSON.stringify({ jsonrpc: '2.0', id, method, params })))
      await requests.send.send({ ...fragment }, { signal: run.signal })
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
    phase = 'await-native-ready'
    const item = await next()
    if (item.done) throw Error('Native resource omitted its ready record')
    const ready = readFiniteAcpReady(item.value)
    await save('native-ready')
    phase = 'initialize'
    const initialization = await rpc('initialize', {
      protocolVersion: 2, capabilities: {}, info: { name: 'ordinary-startup-consumer', version: '1' },
    })
    if (initialization.protocolVersion !== 2) throw Error('Unsupported native protocol')
    initialized = true
    await save('native-initialized')
    phase = 'session-new'
    const session = await rpc('session/new', { cwd: ready.cwd, mcpServers: [] })
    if (typeof session.sessionId !== 'string' || session.sessionId.length === 0)
      throw Error('Genuine native session creation omitted its identity')
    sessionCreated = true
    phase = 'checkpoint-ready'
    await save('codex-session-ready')
    phase = 'await-root-cancel'
    await Promise.race([ended, new Promise<never>((_, reject) => {
      const abort = () => reject(Error('Root cancellation observed'))
      if (run.signal.aborted) abort()
      else run.signal.addEventListener('abort', abort, { once: true })
    })])
    throw Error('Startup consumer unexpectedly resumed')
  } catch (error) {
    if (!run.signal.aborted) {
      const codes = ['CANCELLED', 'DEADLINE_EXCEEDED', 'OWNER_CLOSED', 'OPERATION_CONFLICT', 'UNAVAILABLE', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'INVALID_INPUT', 'INVALID_RESULT', 'UNCERTAIN', 'EXECUTION_FAILED', 'LAGGED', 'DISCONNECTED', 'PROTOCOL_ERROR', 'CHANNEL_LOST']
      const cause = error instanceof OperationError && codes.includes(error.code) ? error.code : 'APPLICATION'
      await save('native-startup-failed', { startupPhase: phase, startupCause: cause }).catch(() => {})
      throw new OperationError('EXECUTION_FAILED', 'Ordinary startup consumer failed before cancellation', { startupPhase: phase, startupCause: cause })
    }
    throw error
  } finally {
    await work
    await Promise.allSettled([requests.send.close(), responses.receive.close()])
  }
})
