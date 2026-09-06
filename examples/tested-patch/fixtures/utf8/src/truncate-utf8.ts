/** Keep the longest prefix that fits without splitting a Unicode code point. */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Invalid byte budget')
  return text.slice(0, maxBytes)
}
