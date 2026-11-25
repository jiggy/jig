import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`)
if (process.argv.includes('auth') && process.argv.includes('status')) {
  send({ loggedIn: false, apiKeySource: 'ANTHROPIC_API_KEY' })
  process.exit(0)
}
if (process.argv.includes('--version')) {
  console.log('2.1.300 (Claude Code)')
  process.exit(0)
}

const recording = process.env.RECORD_PATH!
const supportedEffortLevels =
  process.env.RECORD_EFFORT_UNAVAILABLE === '1' ? ['high'] : ['high', 'low']
let frames = 0
let turns = 0
let effortChanges = 0
for await (const line of createInterface({ input: process.stdin })) {
  if (++frames > 128 || line.length > 64 * 1024) process.exit(2)
  const frame = JSON.parse(line)
  appendFileSync(recording, `${line}\n`)
  if (frame.type === 'control_request') {
    if (
      frame.request.subtype === 'apply_flag_settings' &&
      ++effortChanges === 3 &&
      process.env.RECORD_EFFORT_CONFIRMATION_LOST === '1'
    ) {
      send({
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: frame.request_id,
          error: 'Private native refusal',
        },
      })
      continue
    }
    const response =
      frame.request.subtype === 'initialize'
        ? {
            commands: [],
            models: [
              {
                value: 'fixture',
                displayName: 'Fixture',
                description: 'Local peer',
                supportsEffort: true,
                supportedEffortLevels,
              },
            ],
            account: {},
          }
        : {}
    send({
      type: 'control_response',
      response: { subtype: 'success', request_id: frame.request_id, response },
    })
  } else if (frame.type === 'user') {
    send({ ...frame, isReplay: true })
    send({
      type: 'result',
      subtype: 'success',
      session_id: frame.session_id,
      uuid: crypto.randomUUID(),
      is_error: false,
      result: 'Recorded response',
      num_turns: ++turns,
      duration_ms: 1,
      duration_api_ms: 1,
      stop_reason: 'end_turn',
      total_cost_usd: 0,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      modelUsage: {},
      permission_denials: [],
    })
  }
}
