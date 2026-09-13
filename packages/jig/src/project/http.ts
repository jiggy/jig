/** Local request names select operator resources, not URLs or credentials. */
export function normalizeHttpSelections(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('http must be a resource-name map')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length > 8) throw new TypeError('http exceeds eight resource selections')
  const output: Record<string, string> = Object.create(null)
  for (const name of Object.keys(input).sort()) {
    if (!httpResourceName(name) || !httpResourceName(input[name]))
      throw new TypeError('HTTP resource selections must be local names')
    output[name] = input[name] as string
  }
  return Object.freeze(output)
}

export function httpResourceName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}
