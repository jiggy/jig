import { setTimeout as delay } from 'node:timers/promises'

export function transientGitHubRead(error, allow404 = false) {
  const detail = `${error?.stderr ?? ''} ${error?.message ?? ''}`
  const observed = /HTTP[ /:](\d{3})\b/i.exec(detail)
  const status = observed ? Number(observed[1]) : Number(error?.statusCode ?? error?.status)
  if (status >= 400 && status <= 599) return status >= 500 || (allow404 && status === 404)
  return (
    (error?.code === 'ABORT_ERR' && error.cause?.name === 'TimeoutError') ||
    /^unexpected end of JSON input\r?$/im.test(String(error?.stderr ?? '')) ||
    [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EAI_AGAIN',
      'ENOTFOUND',
      'EPIPE',
    ].includes(error?.code) ||
    /TLS handshake timeout|i\/o timeout|connection reset by peer|unexpected EOF|temporary failure in name resolution|stream error: stream ID \d+; CANCEL; received from peer/i.test(
      detail,
    )
  )
}

export async function retryGitHubRead(read, { sleep = delay, decode = (bytes) => bytes } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response
    try {
      response = await read()
      return decode(response)
    } catch (error) {
      const position = /position (\d+)/.exec(error.message ?? '')
      const truncated =
        typeof response === 'string' &&
        error instanceof SyntaxError &&
        (/Unexpected end of JSON input|Unterminated string in JSON/.test(error.message) ||
          (position !== null && Number(position[1]) >= response.trimEnd().length))
      if (attempt === 3 || (!truncated && !transientGitHubRead(error))) throw error
      await sleep(1000)
    }
  }
}

export function readGitHubApiJson(read, options) {
  return retryGitHubRead(read, { ...options, decode: JSON.parse })
}
