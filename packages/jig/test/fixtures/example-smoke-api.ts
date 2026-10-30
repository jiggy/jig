import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { createServer } from 'node:https'
import { isAbsolute } from 'node:path'

const REQUEST_BYTES = 2 * 1024 * 1024
const REPLY_BYTES = 1024 * 1024

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Read only the Responses API's typed message/text positions, never arbitrary JSON fields. */
function promptText(body: Record<string, unknown>): string {
  const parts: string[] = []
  if (body.instructions !== undefined) {
    assert.equal(typeof body.instructions, 'string', 'Invalid Responses instructions')
    parts.push(body.instructions as string)
  }
  if (typeof body.input === 'string') parts.push(body.input)
  else {
    assert.ok(Array.isArray(body.input), 'Responses input must contain messages')
    for (const message of body.input) {
      assert.ok(record(message), 'Invalid Responses input item')
      assert.ok(message.type === undefined || message.type === 'message', 'Unexpected input item')
      if (typeof message.content === 'string') parts.push(message.content)
      else {
        assert.ok(Array.isArray(message.content), 'Invalid Responses message content')
        for (const content of message.content) {
          assert.ok(record(content), 'Invalid Responses content item')
          assert.ok(
            content.type === 'input_text' || content.type === 'output_text',
            'Unexpected non-text Responses content',
          )
          assert.equal(typeof content.text, 'string', 'Invalid Responses text')
          parts.push(content.text as string)
        }
      }
    }
  }
  const prompt = parts.join('\n')
  assert.ok(prompt.length > 0, 'Responses prompt is empty')
  return prompt
}

/**
 * A real HTTPS Responses endpoint for genuine native Codex clients. Only the
 * remote model boundary is controlled; Jig still owns admission and execution.
 * The disposable proof host must trust certFile through its ordinary CA bundle.
 */
export async function startExampleSmokeApi(options: {
  readonly certFile: string
  readonly keyFile: string
  readonly model: string
  readonly token: string
  readonly expectedRequests: number
  readonly reply: (prompt: string) => string | Promise<string>
}) {
  assert.ok(
    isAbsolute(options.certFile) && isAbsolute(options.keyFile),
    'Absolute TLS paths required',
  )
  assert.ok(options.model.length > 0 && options.model.length <= 200, 'A model identity is required')
  assert.ok(
    options.token.length >= 8,
    'A synthetic API credential of at least eight bytes is required',
  )
  assert.ok(
    Number.isSafeInteger(options.expectedRequests) &&
      options.expectedRequests >= 0 &&
      options.expectedRequests <= 32,
    'A bounded exact model-request count is required',
  )
  const [cert, key] = await Promise.all([readFile(options.certFile), readFile(options.keyFile)])
  const failures = new Map<string, number>()
  let requests = 0
  let completed = 0
  const fail = (reason: string) => failures.set(reason, (failures.get(reason) ?? 0) + 1)
  const refuse = (response: ServerResponse, reason: string, status: number) => {
    fail(reason)
    response.writeHead(status, { 'content-type': 'application/json', connection: 'close' })
    response.end(
      JSON.stringify({ error: { type: 'fixture_error', code: reason, message: reason } }),
    )
  }
  const server = createServer({ cert, key }, (request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/v1/responses') {
        request.resume()
        return refuse(response, 'unexpected-endpoint', 404)
      }
      if (request.headers.authorization !== `Bearer ${options.token}`) {
        request.resume()
        return refuse(response, 'authentication', 401)
      }
      let body: unknown
      try {
        const chunks: Buffer[] = []
        let bytes = 0
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytes += buffer.length
          assert.ok(bytes <= REQUEST_BYTES, 'Request body exceeds fixture limit')
          chunks.push(buffer)
        }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return refuse(response, 'invalid-request', 400)
      }
      if (!record(body) || body.model !== options.model || body.stream !== true)
        return refuse(response, 'unexpected-model-request', 400)
      if (++requests > options.expectedRequests) return refuse(response, 'extra-model-request', 409)
      const ordinal = requests
      let text: string
      try {
        text = await options.reply(promptText(body))
        assert.ok(typeof text === 'string' && text.length > 0, 'A text reply is required')
        assert.ok(Buffer.byteLength(text) <= REPLY_BYTES, 'Reply exceeds fixture limit')
      } catch {
        return refuse(response, 'unexpected-task', 422)
      }

      const id = `resp_example_${ordinal}`
      const item = {
        id: `msg_example_${ordinal}`,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      }
      const result = {
        id,
        object: 'response',
        created_at: 1,
        status: 'completed',
        model: options.model,
        output: [item],
        usage: {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 1,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 2,
        },
      }
      // Codex's own protocol tests use created, output_item.done and completed.
      // The done item carries the complete answer, without fabricated tool calls.
      const events = [
        { type: 'response.created', response: { ...result, status: 'in_progress', output: [] } },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: result },
      ]
      response.once('finish', () => completed++)
      response.once('close', () => {
        if (!response.writableFinished) fail('response-aborted')
      })
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        'x-request-id': id,
      })
      for (const [sequence_number, event] of events.entries())
        response.write(
          `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`,
        )
      response.end()
    })().catch(() => {
      fail('request-handler')
      if (!response.headersSent) {
        response.writeHead(500, { connection: 'close' })
        response.end()
      } else response.destroy()
    })
  })
  server.on('upgrade', (_request, socket) => {
    fail('unexpected-upgrade')
    socket.destroy()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    baseURL: `https://127.0.0.1:${address.port}/v1`,
    get consumedRequests() {
      return completed
    },
    assertConsumed() {
      assert.equal(
        failures.size,
        0,
        `Example smoke API refused requests: ${JSON.stringify([...failures])}`,
      )
      assert.equal(requests, options.expectedRequests, 'Unexpected model-request count')
      assert.equal(completed, options.expectedRequests, 'Not every model reply completed')
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          server.closeAllConnections()
          reject(new Error('Example smoke API did not close within five seconds'))
        }, 5000)
        server.close((error) => {
          clearTimeout(timer)
          if (error) reject(error)
          else resolve()
        })
        server.closeIdleConnections()
      })
    },
  }
}
