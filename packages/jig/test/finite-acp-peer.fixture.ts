// Registration-free, finite ACP wire peer. No native ownership or receipts.
import { createInterface } from 'node:readline'

const mode = process.argv[2]
const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`)
for await (const line of createInterface({ input: process.stdin })) {
  const frame = JSON.parse(line)
  const reply = (result: unknown) => emit({ jsonrpc: '2.0', id: frame.id, result })
  if (mode === 'malformed') {
    process.stdout.write('not-json\n')
    break
  }
  if (frame.method === 'initialize') {
    emit({
      jsonrpc: '2.0',
      id: mode === 'wrong-id' ? 'unrequested' : frame.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {},
        authMethods: [{ id: 'token' }],
        _meta: { secret: 'private-server-meta' },
      },
    })
  } else if (frame.method === 'session/new') {
    if (mode === 'failed-new')
      emit({
        jsonrpc: '2.0',
        id: frame.id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: 'failed to load configuration: Failed to synchronize managed preferences\n\nCheck /private/secret-token and private configuration.',
        },
      })
    else reply({ sessionId: 'owned', _meta: { secret: 'private-session' } })
  } else if (frame.method === 'session/prompt') {
    if (mode === 'signal') process.kill(process.pid, 'SIGTERM')
    else if (mode === 'session-failure')
      emit({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'owned',
          update: {
            sessionUpdate: 'session_info_update',
            _meta: {
              jetbrains: {
                air: {
                  version: 1,
                  sessionFailure: {
                    severity: 'error',
                    category: 'connection',
                    title: '/private/secret-token',
                    actions: [{ private: 'secret-token' }],
                  },
                },
              },
            },
          },
        },
      })
    else {
      emit({
        jsonrpc: '2.0',
        id: `permission-${frame.id}`,
        method: 'session/request_permission',
        params: { sessionId: 'foreign', options: [{ optionId: 'allow' }] },
      })
      emit({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'owned',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'answer', _meta: { secret: 'not-public' } },
          },
        },
      })
      reply({ stopReason: 'end_turn', _meta: { secret: 'private-result' } })
    }
  } else if (frame.result?.outcome?.outcome === 'cancelled') {
    process.stderr.write('permission denied\n')
  } else throw new Error('unexpected peer input')
}
if (mode === 'slow-close') await Bun.sleep(650)
