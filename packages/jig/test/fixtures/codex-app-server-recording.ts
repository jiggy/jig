import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

// Deterministic native peer for the actual installed ACP adapter. No credentials,
// network or native models. Accept hidden turns so the regression can detect them.
let requests = 0
let threads = 0
let turns = 0
let interruptible: { threadId: string; turn: Record<string, unknown> } | undefined
const reply = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
if (process.env.RECORD_SCENARIO === 'forced-clean') {
  process.on('SIGTERM', () => {
    appendFileSync(
      process.env.RECORD_PATH!,
      JSON.stringify({ event: 'native-forced-exit-zero' }) + '\n',
    )
    process.exit(0)
  })
}
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
      const scenario = process.env.RECORD_SCENARIO
      const started = () => {
        interruptible = { threadId: request.params.threadId, turn }
        reply({
          method: 'turn/started',
          params: { threadId: request.params.threadId, turn: { ...turn, status: 'inProgress' } },
        })
      }
      if (scenario?.startsWith('immediate-follow-up') && turns === 2) {
        if (scenario === 'immediate-follow-up-start-after-reply') {
          ok({ turn: { ...turn, status: 'inProgress' } })
          // Neither an old turn nor another thread makes this turn interruptible.
          reply({
            method: 'turn/started',
            params: { threadId: request.params.threadId, turn: { ...turn, id: 'turn-1' } },
          })
          reply({ method: 'turn/started', params: { threadId: 'unrelated', turn } })
          setTimeout(started, 100)
        } else if (scenario === 'immediate-follow-up-start-before-reply') {
          started()
          setTimeout(() => ok({ turn: { ...turn, status: 'inProgress' } }), 100)
        } else {
          setTimeout(() => {
            started()
            ok({ turn: { ...turn, status: 'inProgress' } })
          }, 100)
        }
        break
      }
      const completed = () =>
        reply({ method: 'turn/completed', params: { threadId: request.params.threadId, turn } })
      if (scenario === 'completion-before-reply') {
        completed()
        setTimeout(() => ok({ turn: { ...turn, status: 'inProgress' } }), 100)
      } else {
        ok({ turn: { ...turn, status: 'inProgress' } })
        completed()
      }
      break
    }
    case 'turn/interrupt': {
      if (!interruptible || request.params.turnId !== interruptible.turn.id) {
        reply({ id: request.id, error: { code: -32600, message: 'no active turn to interrupt' } })
        break
      }
      ok({})
      reply({
        method: 'turn/completed',
        params: {
          threadId: interruptible.threadId,
          turn: { ...interruptible.turn, status: 'interrupted' },
        },
      })
      interruptible = undefined
      break
    }
    default:
      reply({
        id: request.id,
        error: { code: -32601, message: `unsupported fixture method: ${request.method}` },
      })
  }
}
appendFileSync(
  process.env.RECORD_PATH!,
  JSON.stringify({ event: 'native-stdin-end', time: Date.now() }) + '\n',
)
if (process.env.RECORD_SCENARIO === 'shutdown-fail') process.exit(23)
if (process.env.RECORD_SCENARIO === 'shutdown-signal') process.kill(process.pid, 'SIGTERM')
if (process.env.RECORD_SCENARIO === 'forced-clean') setInterval(() => {}, 1000)
