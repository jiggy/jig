import { pathToFileURL } from 'node:url'

const ENDPOINT = 'https://openrouter.ai/api/v1/responses'
const MODEL = 'openrouter/free'
const TIMEOUT_MS = 30_000
const BODY_BYTES = 64 * 1024
const ERROR_CODES = new Set([400, 401, 402, 403, 404, 408, 413, 422, 429, 500, 502, 503, 504])

const observation = (httpStatus, errorCode, terminal) => ({ httpStatus, errorCode, terminal })
const errorCode = (value) => (ERROR_CODES.has(value) ? value : null)

function terminalRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const code = errorCode(value.error?.code ?? value.response?.error?.code)
  if (value.type === 'response.completed') return { errorCode: code, terminal: 'completed' }
  if (value.type === 'response.failed' || value.type === 'error' || value.error)
    return { errorCode: code, terminal: 'failed' }
  if (value.type === 'response.incomplete') return { errorCode: code, terminal: 'incomplete' }
  if (value.status === 'completed') return { errorCode: code, terminal: 'completed' }
  if (value.status === 'failed') return { errorCode: code, terminal: 'failed' }
  if (value.status === 'incomplete') return { errorCode: code, terminal: 'incomplete' }
  return null
}

/** Observe bounded response bytes. Supplied responses are inert diagnostic inputs, never qualification. */
export async function inspectResponsesProbe(response, signal) {
  const httpStatus = response.status >= 100 && response.status <= 599 ? response.status : null
  const reader = response.body?.getReader()
  if (!reader) return observation(httpStatus, null, 'missing')
  let onAbort
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(new Error('probe deadline'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  let bytes = 0
  let buffer = ''
  let data = []
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const stream =
    response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'text/event-stream'
  const event = () => {
    const body = data.join('\n')
    data = []
    return body && body !== '[DONE]' ? terminalRecord(JSON.parse(body)) : null
  }
  try {
    signal.throwIfAborted()
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted])
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > BODY_BYTES) return observation(httpStatus, null, 'overflow')
      buffer += decoder.decode(chunk.value, { stream: true })
      if (!stream) continue
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) break
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
        else if (!line) {
          const found = event()
          if (found) return observation(httpStatus, found.errorCode, found.terminal)
        }
      }
    }
    buffer += decoder.decode()
    const found = stream ? event() : terminalRecord(JSON.parse(buffer))
    return found
      ? observation(httpStatus, found.errorCode, found.terminal)
      : observation(httpStatus, null, 'missing')
  } catch {
    return observation(httpStatus, null, signal.aborted ? 'deadline' : 'malformed')
  } finally {
    signal.removeEventListener('abort', onAbort)
    // The caller aborts the HTTP request too. Cancellation cannot delay or replace its observation.
    void reader.cancel().catch(() => {})
  }
}

export async function nativeResponsesProbe() {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return observation(null, null, 'missing-credential')
  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        input: 'Reply with READY only.',
        stream: true,
        store: false,
        max_output_tokens: 32,
      }),
    })
    return await inspectResponsesProbe(response, controller.signal)
  } catch {
    return observation(null, null, controller.signal.aborted ? 'deadline' : 'transport-error')
  } finally {
    clearTimeout(deadline)
    controller.abort()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await nativeResponsesProbe()))
