import { Document, parseDocument, Scalar, visit } from 'yaml'

/** Standard YAML for human values only. Quotes preserve JSON string types and safe keys. */
export function privateCliValueFields(value: unknown, depth = 1, ascii = false): string {
  const unsafe = ascii ? /[^\x20-\x7e\n]/ : /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
  const document = new Document(value, { aliasDuplicateObjects: false, sortMapEntries: true })
  visit(document, {
    Scalar(key, node) {
      if (typeof node.value !== 'string') return
      node.type =
        key !== 'key' && node.value.includes('\n') && !unsafe.test(node.value.replaceAll('\n', ''))
          ? Scalar.BLOCK_LITERAL
          : Scalar.QUOTE_DOUBLE
    },
  })
  // YAML's JSON-compatible quoting handles controls. Escape remaining Unicode
  // controls (and all non-ASCII in review) inside quoted tokens, preserving values.
  let yaml = document.toString({ lineWidth: 0, doubleQuotedAsJSON: true })
  const replacements: { start: number; end: number; text: string }[] = []
  if (unsafe.test(yaml.replaceAll('\n', '')))
    visit(parseDocument(yaml), {
      Scalar(_key, node) {
        if (node.type !== Scalar.QUOTE_DOUBLE || !node.range) return
        const [start, end] = node.range
        const text = yaml
          .slice(start, end)
          .replace(ascii ? /[^\x20-\x7e]/g : /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) =>
            character
              .split('')
              .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`)
              .join(''),
          )
        replacements.push({ start, end, text })
      },
    })
  let offset = 0
  const parts: string[] = []
  for (const replacement of replacements.sort((left, right) => left.start - right.start)) {
    parts.push(yaml.slice(offset, replacement.start), replacement.text)
    offset = replacement.end
  }
  parts.push(yaml.slice(offset))
  yaml = parts.join('')
  const indent = '  '.repeat(depth)
  return (
    yaml
      .slice(0, -1)
      .split('\n')
      .map((line) => indent + line)
      .join('\n') + '\n'
  )
}
