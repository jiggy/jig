export const HTTP_REQUEST_PROXY_ENV = 'JIG_HTTP_REQUEST_HTTPS_PROXY'
export const HTTP_REQUEST_PROXY_HINT =
  'Set JIG_HTTP_REQUEST_HTTPS_PROXY to a valid HTTP or HTTPS proxy URL, or unset it for direct access.'

/** The pinned HTTPS agent receives only a checked CONNECT endpoint. */
export function normalizeHttpRequestProxy(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const url =
    typeof value === 'string' &&
    value.length <= 4096 &&
    /^https?:\/\//i.test(value) &&
    !/[\p{Cc}\s\\?#]/u.test(value)
      ? URL.parse(value)
      : null
  if (url?.pathname !== '/' || Buffer.byteLength(url.href) > 4096)
    throw new TypeError(HTTP_REQUEST_PROXY_HINT)
  try {
    if (
      (!url.username && url.password) ||
      /[:\p{Cc}]/u.test(decodeURIComponent(url.username)) ||
      /\p{Cc}/u.test(decodeURIComponent(url.password))
    )
      throw new Error()
  } catch {
    throw new TypeError(HTTP_REQUEST_PROXY_HINT)
  }
  return url.href
}
