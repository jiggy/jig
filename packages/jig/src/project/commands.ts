/** Reviewed invocation policy; runtime and containment remain host choices. */
export type ProjectCommand = { readonly run: string } | { readonly test: readonly string[] }

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
export function normalizeProjectCommand(value: unknown): ProjectCommand {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('command must be an object')
  if (Object.keys(value).length !== 1) throw new TypeError('command must contain run or test')
  const command = value as Record<string, unknown>
  if (Object.hasOwn(command, 'run')) {
    const path = projectCommandPath(command.run)
    if (!path.endsWith('.ts') && !path.endsWith('.js'))
      throw new TypeError('command run must name a .ts or .js entrypoint')
    return Object.freeze({ run: path })
  } else if (Object.hasOwn(command, 'test') && Array.isArray(command.test)) {
    if (command.test.length === 0 || command.test.length > 16)
      throw new TypeError('command test must select one to sixteen test files')
    const paths = command.test.map(projectCommandPath)
    if (
      new Set(paths).size !== paths.length ||
      paths.some((path) => !/\.(test|spec)\.(ts|js)$/.test(path))
    )
      throw new TypeError('command test must name distinct .test or .spec files')
    return Object.freeze({ test: Object.freeze(paths) })
  } else throw new TypeError('command must contain run or test')
}
