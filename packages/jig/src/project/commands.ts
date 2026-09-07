/** Reviewed invocation policy; runtime and containment remain host choices. */
export type ProjectCommand = { readonly run: string } | { readonly test: readonly string[] }

export type ProjectCommands = Readonly<Record<string, ProjectCommand>>

export function projectCommandPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    !/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..') ||
    value.split('/').length > 16
  )
    throw new TypeError('command file paths must be bounded relative paths without traversal')
  return value
}

/** Input must already be an ordinary JSON snapshot at the owning boundary. */
export function normalizeProjectCommands(value: unknown): ProjectCommands {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('commands must be an object')
  const entries = Object.entries(value)
  if (entries.length > 8) throw new TypeError('commands exceed eight entries')
  const output: Record<string, ProjectCommand> = Object.create(null)
  for (const [name, item] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64)
      throw new TypeError('command name must be a LocalName')
    if (
      item === null ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      Object.keys(item).length !== 1
    )
      throw new TypeError(`command ${name} must contain run or test`)
    const command = item as Record<string, unknown>
    if (Object.hasOwn(command, 'run')) {
      const path = projectCommandPath(command.run)
      if (!path.endsWith('.ts') && !path.endsWith('.js'))
        throw new TypeError('command run must name a .ts or .js entrypoint')
      output[name] = Object.freeze({ run: path })
    } else if (Object.hasOwn(command, 'test') && Array.isArray(command.test)) {
      if (command.test.length === 0 || command.test.length > 16)
        throw new TypeError('command test must select one to sixteen test files')
      const paths = command.test.map(projectCommandPath)
      if (
        new Set(paths).size !== paths.length ||
        paths.some((path) => !/\.(test|spec)\.(ts|js)$/.test(path))
      )
        throw new TypeError('command test must name distinct .test or .spec files')
      output[name] = Object.freeze({ test: Object.freeze(paths) })
    } else throw new TypeError(`command ${name} must contain run or test`)
  }
  return Object.freeze(output)
}
