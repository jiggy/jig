/** Escape all authored terminal controls before measuring or rendering them. */
export function privateUpdateText(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) =>
    character === '\n'
      ? character
      : `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`,
  )
}
export function privateTerminalWidth(text: string): number {
  return (globalThis as unknown as { Bun: { stringWidth(text: string): number } }).Bun.stringWidth(
    text,
  )
}
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
/** Both terminal cells and encoded bytes bound every projected physical line. */
export function privateTruncateUpdate(text: string, columns: number, byteLimit = 4096): string {
  columns = Math.max(0, columns)
  if (privateTerminalWidth(text) <= columns && Buffer.byteLength(text) <= byteLimit) return text
  const suffix = columns < 3 ? '.'.repeat(columns) : '...'
  let result = '',
    cells = 0,
    bytes = Buffer.byteLength(suffix)
  for (const { segment } of segmenter.segment(text)) {
    const size = privateTerminalWidth(segment),
      encoded = Buffer.byteLength(segment)
    if (cells + size > columns - suffix.length || bytes + encoded > byteLimit) break
    result += segment
    cells += size
    bytes += encoded
  }
  return result + suffix
}
/** Stream wrapped detail lines; never construct a whole wrapped document. */
export function* privateWrappedUpdate(
  text: string,
  columns: number,
  words = false,
): Generator<string> {
  columns = Math.max(1, columns)
  let line = '',
    cells = 0,
    bytes = 0
  for (const authored of text.split('\n')) {
    for (const { segment } of segmenter.segment(privateUpdateText(authored))) {
      const size = privateTerminalWidth(segment),
        encoded = Buffer.byteLength(segment)
      while (line && (cells + size > columns || bytes + encoded > 4096)) {
        let boundary = 0
        if (words)
          for (const piece of segmenter.segment(line))
            if (piece.index > 0 && piece.segment.startsWith(' '))
              boundary = piece.index + piece.segment.length
        const cut = boundary || line.length
        yield line.slice(0, cut)
        line = line.slice(cut)
        cells = privateTerminalWidth(line)
        bytes = Buffer.byteLength(line)
      }
      // Pathological combining clusters have finite cells but many bytes. Split
      // only this case by scalar so every escaped character remains reachable.
      if (encoded > 4096 || size > columns) {
        for (const scalar of segment) {
          const scalarCells = privateTerminalWidth(scalar),
            scalarBytes = Buffer.byteLength(scalar)
          if (line && (cells + scalarCells > columns || bytes + scalarBytes > 4096)) {
            yield line
            line = ''
            cells = 0
            bytes = 0
          }
          if (scalarCells > columns) {
            yield privateTruncateUpdate(scalar, columns)
            continue
          }
          line += scalar
          cells += scalarCells
          bytes += scalarBytes
        }
      } else {
        line += segment
        cells += size
        bytes += encoded
      }
    }
    yield line
    line = ''
    cells = 0
    bytes = 0
  }
}
