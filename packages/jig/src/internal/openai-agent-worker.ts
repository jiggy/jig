import { requestPrivateOpenAIAgent } from './openai-agent-client.js'
import {
  decodePrivateOpenAIAgentRequest,
  encodePrivateOpenAIAgentFailure,
  encodePrivateOpenAIAgentSuccess,
  PrivateOpenAIAgentError,
  PRIVATE_OPENAI_AGENT_REQUEST_BYTES,
  type PrivateOpenAIAgentErrorCode,
} from './openai-agent-protocol.js'

await main()

async function main(): Promise<void> {
  let output: Uint8Array
  try {
    const input = await readBoundedInput(PRIVATE_OPENAI_AGENT_REQUEST_BYTES)
    const request = decodePrivateOpenAIAgentRequest(input)
    const value = await requestPrivateOpenAIAgent(request, {
      apiKey: request.apiKey,
    })
    output = encodePrivateOpenAIAgentSuccess(value)
  } catch (error) {
    const failure = safeFailure(error)
    output = encodePrivateOpenAIAgentFailure(failure.code, failure.message)
  }
  try {
    await writeOutput(output)
  } catch {
    process.exitCode = 1
  }
}

async function readBoundedInput(maximum: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const raw of process.stdin) {
    const chunk =
      typeof raw === 'string'
        ? new TextEncoder().encode(raw)
        : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    total += chunk.byteLength
    if (total > maximum) {
      throw new PrivateOpenAIAgentError(
        'AGENT_PROVIDER_PROTOCOL',
        'OpenAI Agent worker request exceeds its byte bound',
      )
    }
    chunks.push(chunk.slice())
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function safeFailure(error: unknown): {
  readonly code: PrivateOpenAIAgentErrorCode
  readonly message: string
} {
  if (error instanceof PrivateOpenAIAgentError) {
    return Object.freeze({ code: error.code, message: error.message })
  }
  return Object.freeze({
    code: 'AGENT_PROVIDER_UNAVAILABLE',
    message: 'OpenAI Agent worker failed',
  })
}

function writeOutput(bytes: Uint8Array): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(bytes, (error) => {
      if (error === null || error === undefined) resolve()
      else reject(error)
    })
  })
}
