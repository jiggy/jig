import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

// Deterministic native peer for the actual installed ACP adapter. No credentials,
// network or native models. Accept hidden turns so the regression can detect them.
let requests = 0
let threads = 0
let turns = 0
const reply = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
for await (const line of createInterface({ input: process.stdin })) {
  if (line.length > 64 * 1024 || ++requests > 128) process.exit(2)
  const request = JSON.parse(line)
  appendFileSync(process.env.RECORD_PATH!, JSON.stringify(request) + '\n')
  if (request.id === undefined) continue
  const ok = (result: unknown) => reply({ id: request.id, result })
  switch (request.method) {
    case 'initialize':
      ok({ userAgent: 'recording-peer', codexHome: process.cwd() })
      break
    case 'account/read':
      ok({ account: { type: 'apiKey' }, requiresOpenaiAuth: false })
      break
    case 'skills/list':
      ok({ data: [] })
      break
    case 'skills/extraRoots/set':
      ok({})
      break
    case 'config/read':
      ok({ config: {}, origins: {}, layers: [] })
      break
    case 'model/list':
      ok({
        data: [
          {
            id: 'fixture',
            model: 'fixture',
            displayName: 'Fixture',
            description: 'Local peer',
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'low' }],
            defaultReasoningEffort: 'low',
          },
        ],
        nextCursor: null,
      })
      break
    case 'thread/start':
      ok({
        thread: { id: `thread-${++threads}`, turns: [] },
        model: 'fixture',
        modelProvider: 'openai',
        reasoningEffort: 'low',
        cwd: process.cwd(),
      })
      break
    case 'thread/goal/get':
      ok({ goal: null })
      break
    case 'thread/unsubscribe':
    case 'thread/name/set':
      ok({})
      break
    case 'turn/start': {
      if (process.env.RECORD_SCENARIO === 'rejected') {
        reply({ id: request.id, error: { code: -32603, message: 'fixture rejection' } })
        break
      }
      const turn = { id: `turn-${++turns}`, items: [], status: 'completed', error: null }
      ok({ turn: { ...turn, status: 'inProgress' } })
      reply({ method: 'turn/completed', params: { threadId: request.params.threadId, turn } })
      break
    }
    default:
      reply({
        id: request.id,
        error: { code: -32601, message: `unsupported fixture method: ${request.method}` },
      })
  }
}
