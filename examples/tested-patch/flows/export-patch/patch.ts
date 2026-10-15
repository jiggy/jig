/** Build applicable complete-file hunks from captured originals, never from model diff text. */
export function unifiedPatch(path: string, before: string, after: string): string {
  if (before === after) return ''
  const lines = (text: string) =>
    text === '' ? [] : text.split('\n').slice(0, text.endsWith('\n') ? -1 : undefined)
  const oldLines = lines(before),
    newLines = lines(after)
  const body = (text: string, content: string[], prefix: string) =>
    content.map((line) => prefix + line + '\n').join('') +
    (content.length && !text.endsWith('\n') ? '\\ No newline at end of file\n' : '')
  return (
    `--- a/${path}\n+++ b/${path}\n@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@\n` +
    body(before, oldLines, '-') +
    body(after, newLines, '+')
  )
}
