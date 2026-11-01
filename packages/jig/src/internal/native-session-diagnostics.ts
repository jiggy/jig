export type PrivateNativeSessionReportedReason =
  | 'unsupported-namespace-tools'
  | 'invalid-responses-request'
  | 'unsupported-reasoning-summary'

/** Classify the exact failed native exchange without releasing its private title.
 * These are attributed reports, never proof of dispatch or permission to retry. */
export function privateNativeSessionReportedReason(
  title: unknown,
): PrivateNativeSessionReportedReason | undefined {
  if (typeof title !== 'string' || title.length > 16_384) return undefined
  let message = title
  try {
    const start = title.indexOf('{')
    if (start >= 0) {
      const error = JSON.parse(title.slice(start)).error
      if (error?.code === 'invalid_prompt') return 'invalid-responses-request'
      if (typeof error?.message === 'string') message = error.message
    }
  } catch {
    // Unrecognized private text stays private, including malformed provider JSON.
  }
  if (message.includes('No endpoints found that support the native `namespace` tool type.'))
    return 'unsupported-namespace-tools'
  if (message.includes('Invalid Responses API request')) return 'invalid-responses-request'
  if (
    message.includes("Unsupported parameter: 'reasoning.summary'") ||
    message.includes('Unsupported parameter: reasoning.summary')
  )
    return 'unsupported-reasoning-summary'
  return undefined
}
