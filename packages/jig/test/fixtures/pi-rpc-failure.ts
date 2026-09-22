// Trusted local RPC fixture. No model, network, configuration, or tool execution.
import { createInterface } from 'node:readline'

const model = { provider: 'fixture', id: 'fixture-model', name: 'Fixture' }
const send = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}
const message = (stopReason: string): void => {
  send({
    type: 'message_end',
    message: { role: 'assistant', stopReason, errorMessage: 'private-provider-detail' },
  })
}

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line)
  const response = (data: unknown = {}): void =>
    send({
      type: 'response',
      id: request.id,
      command: request.type,
      success: true,
      data,
    })
  if (request.type === 'get_state') response({ model, thinkingLevel: 'off', sessionFile: null })
  else if (request.type === 'get_available_models') response({ models: [model] })
  else if (request.type === 'get_commands') response({ commands: [] })
  else if (request.type === 'prompt') {
    const scenario = process.env.PI_FAILURE_SCENARIO!
    if (scenario.startsWith('rpc-error')) {
      send({
        type: 'response',
        id: request.id,
        command: 'prompt',
        success: false,
        error: 'private-provider-detail',
      })
      if (scenario === 'rpc-error-racing-settlement') send({ type: 'agent_settled' })
      continue
    }
    response()
    send({ type: 'agent_start' })
    if (scenario !== 'empty-success')
      send({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'partial answer' },
      })
    if (scenario === 'assistant-error') message('error')
    else if (scenario === 'assistant-aborted') message('aborted')
    else if (scenario === 'assistant-length') message('length')
    else if (scenario === 'recovered-error') {
      message('error')
      message('stop')
    } else message('stop')
    send({ type: 'agent_end', messages: [] })
    send({ type: 'agent_settled' })
  } else response()
}
