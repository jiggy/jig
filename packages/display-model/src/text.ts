/** Presentation hints only: filenames never grant file access. */
export type DisplayTextFormat =
  | 'plain'
  | 'csv'
  | 'tsv'
  | 'json'
  | 'markdown'
  | 'yaml'
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'shell'
  | 'diff'
export type DisplayTextToken = Readonly<{
  text: string
  role: 'plain' | 'string' | 'key' | 'number' | 'literal' | 'comment'
  column?: number
}>
const extensions: Record<string, DisplayTextFormat> = {
  csv: 'csv',
  tsv: 'tsv',
  json: 'json',
  jsonl: 'json',
  ndjson: 'json',
  md: 'markdown',
  mdx: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  diff: 'diff',
  patch: 'diff',
}
export function detectDisplayTextFormat(path: string, text: string): DisplayTextFormat {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const extension = name.includes('.') ? name.split('.').pop()! : ''
  if (Object.hasOwn(extensions, extension)) return extensions[extension]!
  if (name === 'dockerfile' || name === '.bashrc' || name === '.zshrc') return 'shell'
  const sample = text.slice(0, 65536)
  if (/^#![^\n]*\bpython[\d.]*\b/.test(sample)) return 'python'
  if (/^#![^\n]*\b(?:ba|z|da)?sh\b/.test(sample)) return 'shell'
  if (sample.startsWith('diff --git ') || /^--- [^\n]+\n\+\+\+ [^\n]+\n@@ /.test(sample))
    return 'diff'
  if (/^\s*[\[{]/.test(sample)) {
    try {
      JSON.parse(sample)
      return 'json'
    } catch {}
  }
  return 'plain'
}
/** Scan CSV without splitting quoted delimiters or multiline fields. */
export function displayDelimitedTokens(text: string, delimiter = ','): DisplayTextToken[] {
  const tokens: DisplayTextToken[] = []
  let start = 0,
    column = 0,
    quoted = false
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') i++
      else quoted = !quoted
    } else if (!quoted && (text[i] === delimiter || text[i] === '\n')) {
      if (i > start) tokens.push({ text: text.slice(start, i), role: 'string', column })
      tokens.push({ text: text[i]!, role: 'plain' })
      column = text[i] === '\n' ? 0 : column + 1
      start = i + 1
    }
  }
  if (start < text.length) tokens.push({ text: text.slice(start), role: 'string', column })
  return tokens
}
/** A complete, rectangular, bounded table; malformed excerpts remain raw. */
export function displayDelimitedRows(text: string, delimiter = ','): string[][] | undefined {
  if (text.length > 65536) return
  const rows: string[][] = [],
    row: string[] = []
  let field = '',
    quoted = false,
    ended = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
          ended = true
        }
      } else field += c
    } else if (c === '"') {
      if (field || ended) return
      quoted = true
    } else if (c === delimiter || c === '\n' || (c === '\r' && text[i + 1] === '\n')) {
      row.push(field)
      field = ''
      ended = false
      if (c !== delimiter) {
        if (c === '\r') i++
        rows.push(row.splice(0))
        if (rows.length > 500) return
      }
      if (row.length > 64) return
    } else {
      if (ended) return
      field += c
    }
  }
  if (quoted) return
  if (field || ended || row.length) {
    row.push(field)
    rows.push(row)
  }
  if (
    !rows.length ||
    rows.length > 500 ||
    rows[0]!.length > 64 ||
    rows.some((r) => r.length !== rows[0]!.length)
  )
    return
  return rows
}
/** Bounded lexical colouring, preserving every character; not a parser or validator. */
export function displayTextTokens(text: string, format: DisplayTextFormat): DisplayTextToken[] {
  if (text.length > 65536 || format === 'plain') return [{ text, role: 'plain' }]
  if (format === 'csv' || format === 'tsv')
    return displayDelimitedTokens(text, format === 'tsv' ? '\t' : ',')
  const tokens: DisplayTextToken[] = []
  const pattern =
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|#[^\n]*|\b(?:true|false|null|None|True|False|const|let|var|function|return|if|else|for|while|import|from|export|class|def|async|await|interface|type)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
  let start = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > start) tokens.push({ text: text.slice(start, match.index), role: 'plain' })
    const value = match[0]
    const comment =
      (value.startsWith('//') && ['javascript', 'typescript'].includes(format)) ||
      (value.startsWith('#') && ['python', 'shell', 'yaml', 'markdown'].includes(format))
    const role =
      format === 'markdown' && /^#{1,6}\s/.test(value)
        ? 'key'
        : comment
          ? 'comment'
          : /^["'`]/.test(value)
            ? /^\s*:/.test(text.slice(match.index + value.length))
              ? 'key'
              : 'string'
            : /^-?\d/.test(value)
              ? 'number'
              : value.startsWith('//') || value.startsWith('#')
                ? 'plain'
                : 'literal'
    tokens.push({ text: value, role })
    start = match.index + value.length
  }
  if (start < text.length) tokens.push({ text: text.slice(start), role: 'plain' })
  return tokens
}
