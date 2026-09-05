/** Closed Bun 1.3.3 lock policy for the direct alpha's one preparer. */
export function requirePrivateBunLockPolicy(value: unknown): void {
  const lock = ordinaryRecord(value)
  const workspaces = ordinaryRecord(lock?.workspaces)
  const rootWorkspace = ordinaryRecord(workspaces?.[''])
  const packages = ordinaryRecord(lock?.packages)
  if (
    lock?.lockfileVersion !== 1 ||
    workspaces === undefined ||
    rootWorkspace === undefined ||
    packages === undefined ||
    Object.keys(workspaces).length !== 1 ||
    lock.patchedDependencies !== undefined
  ) {
    throw new TypeError('unsupported Bun lock source')
  }
  requireRegistryDependencyMaps(rootWorkspace)
  for (const resolution of Object.values(packages)) {
    const metadata = Array.isArray(resolution) ? ordinaryRecord(resolution[2]) : undefined
    if (
      !Array.isArray(resolution) ||
      resolution.length !== 4 ||
      !isExactRegistryResolution(resolution[0]) ||
      typeof resolution[1] !== 'string' ||
      (resolution[1] !== '' &&
        resolution[1] !== 'https://registry.npmjs.org' &&
        resolution[1] !== 'https://registry.npmjs.org/') ||
      metadata === undefined ||
      !isExactIntegrity(resolution[3])
    ) {
      throw new TypeError('unsupported Bun lock source')
    }
    requireRegistryDependencyMaps(metadata)
  }
}

const DEPENDENCY_MAPS = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const)

function requireRegistryDependencyMaps(container: Record<string, unknown>): void {
  for (const field of DEPENDENCY_MAPS) {
    if (container[field] === undefined) continue
    const dependencies = ordinaryRecord(container[field])
    if (dependencies === undefined) throw new TypeError('unsupported Bun lock source')
    for (const [name, request] of Object.entries(dependencies)) {
      if (!isPackageName(name) || !isRegistryRequest(request)) {
        throw new TypeError('unsupported Bun lock source')
      }
    }
  }
}

function isRegistryRequest(value: unknown): boolean {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 512) return false
  if (!value.startsWith('npm:')) return isRegistrySelector(value)
  const target = value.slice(4)
  const separator = target.lastIndexOf('@')
  return (
    separator > 0 &&
    isPackageName(target.slice(0, separator)) &&
    isRegistrySelector(target.slice(separator + 1))
  )
}

function isRegistrySelector(value: string): boolean {
  return value.length > 0 && /^[0-9A-Za-z._+*<>=~^| -]+$/.test(value)
}

function isExactRegistryResolution(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const separator = value.lastIndexOf('@')
  if (separator < 1) return false
  const name = value.slice(0, separator)
  const version = value.slice(separator + 1)
  return (
    isPackageName(name) &&
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      version,
    )
  )
}

function isPackageName(value: string): boolean {
  const valid = value.startsWith('@')
    ? /^@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*$/.test(value)
    : /^[a-z0-9][a-z0-9._~-]*$/.test(value)
  return valid && Buffer.byteLength(value) <= 214
}

function isExactIntegrity(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const match = /^(sha256|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (match === null) return false
  const bytes = Buffer.from(match[2]!, 'base64')
  const expectedBytes = match[1] === 'sha256' ? 32 : 64
  return bytes.byteLength === expectedBytes && bytes.toString('base64') === match[2]
}

function ordinaryRecord(value: unknown): Record<string, unknown> | undefined {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return undefined
  return value as Record<string, unknown>
}
