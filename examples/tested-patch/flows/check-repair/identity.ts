export function hashText(text: string): string {
  return `sha256:${new Bun.CryptoHasher('sha256').update(text).digest('hex')}`
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const fields = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    return `{${fields.join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new TypeError('Evidence identities require JSON values.')
  return encoded
}

export function identity(value: unknown): string {
  return hashText(canonicalJson(value))
}
