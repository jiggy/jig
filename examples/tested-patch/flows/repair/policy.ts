export interface SourceFile {
  path: string
  content: string
}
export interface RepairInput {
  issue: string
  snapshot: { files: SourceFile[]; sha256: string }
  editPath: string
}

export function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

export function snapshotDigest(files: readonly SourceFile[]): string {
  return sha256(
    JSON.stringify(
      files
        .map(({ path, content }) => ({ path, content }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    ),
  )
}

export function parseInput(value: unknown): RepairInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected repair input.')
  const input = value as RepairInput
  if (
    typeof input.issue !== 'string' ||
    !input.issue.trim() ||
    input.issue.length > 8000 ||
    typeof input.editPath !== 'string' ||
    !input.editPath.endsWith('.ts')
  ) {
    throw new TypeError('Supply an issue and one existing TypeScript editPath.')
  }
  const files = input.snapshot?.files
  if (!Array.isArray(files) || files.length < 1 || files.length > 16)
    throw new TypeError('Expected 1–16 text files.')
  const paths = new Set<string>()
  let bytes = 0
  const normalized = files.map((file) => {
    if (
      !file ||
      typeof file.path !== 'string' ||
      !/^[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*$/.test(file.path) ||
      paths.has(file.path) ||
      typeof file.content !== 'string'
    )
      throw new TypeError('Invalid or duplicate source path/content.')
    paths.add(file.path)
    bytes += Buffer.byteLength(file.content)
    return { path: file.path, content: file.content }
  })
  if (bytes > 65536 || !paths.has(input.editPath))
    throw new TypeError('Snapshot too large or editPath absent.')
  if (input.snapshot.sha256 !== snapshotDigest(normalized))
    throw new TypeError('Snapshot identity does not match its contents.')
  return {
    issue: input.issue,
    editPath: input.editPath,
    snapshot: { files: normalized, sha256: input.snapshot.sha256 },
  }
}

export function parseReplacement(value: unknown): { replacement: string; summary: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('The Agent omitted its patch.')
  const patch = value as { replacement: unknown; summary: unknown }
  if (
    typeof patch.replacement !== 'string' ||
    Buffer.byteLength(patch.replacement) > 65536 ||
    typeof patch.summary !== 'string' ||
    !patch.summary.trim() ||
    patch.summary.length > 2000
  ) {
    throw new TypeError('The Agent returned an invalid replacement or summary.')
  }
  if (Object.keys(value).some((key) => key !== 'replacement' && key !== 'summary')) {
    throw new TypeError('Only replacement content and summary are accepted, not paths or commands.')
  }
  return { replacement: patch.replacement, summary: patch.summary }
}

export function unifiedPatch(path: string, before: string, after: string): string {
  const lines = (text: string) =>
    text === '' ? [] : text.split('\n').slice(0, text.endsWith('\n') ? -1 : undefined)
  const oldLines = lines(before)
  const newLines = lines(after)
  const body = (text: string, content: string[], prefix: string) =>
    content.map((line) => prefix + line + '\n').join('') +
    (content.length && !text.endsWith('\n') ? '\\ No newline at end of file\n' : '')
  return (
    `--- a/${path}\n+++ b/${path}\n@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@\n` +
    body(before, oldLines, '-') +
    body(after, newLines, '+')
  )
}
