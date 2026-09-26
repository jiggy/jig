import { posix } from 'node:path'

export interface PrivateMacosSandboxFiles {
  readonly readOnlyFiles: readonly string[]
  readonly readOnlyTrees: readonly string[]
  readonly writableTrees: readonly string[]
  /** Host control roots must be outside every payload data grant. */
  readonly protectedRoots: readonly string[]
  readonly network: 'isolated' | 'inherited'
}

// JavaScriptCore loads its system Unicode tables lazily for Intl operations.
const SYSTEM_TREES = ['/usr/lib', '/System/Library', '/usr/share/icu'] as const
const RESOLVER_FILES = [
  '/etc',
  '/var',
  '/etc/resolv.conf',
  '/private/etc/resolv.conf',
  '/private/var/run/resolv.conf',
  '/etc/hosts',
  '/private/etc/hosts',
  '/var/run/mDNSResponder',
  '/private/var/run/mDNSResponder',
] as const

function path(value: string): string {
  if (
    typeof value !== 'string' ||
    !posix.isAbsolute(value) ||
    posix.normalize(value) !== value ||
    Buffer.byteLength(value) > 4096 ||
    Buffer.from(value).toString('utf8') !== value ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new TypeError('invalid macOS sandbox path')
  return value
}
function inside(value: string, root: string): boolean {
  return root === '/' || value === root || value.startsWith(`${root}/`)
}
const intersects = (left: string, right: string) => inside(left, right) || inside(right, left)
const literal = (value: string) => `(literal ${JSON.stringify(value)})`
const tree = (value: string) => `(subpath ${JSON.stringify(value)})`
function paths(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length > 128) throw new TypeError('too many sandbox paths')
  return [...new Set(values.map(path))].sort()
}

/**
 * Format only host-owned projections. The caller must seal filesystem identity
 * and aliases before use; a profile string does not authenticate mutable files.
 */
export function privateMacosSandboxProfile(input: PrivateMacosSandboxFiles): Readonly<{
  text: string
  bootstrap: 'closed' | 'dns'
}> {
  const readOnlyFiles = paths(input.readOnlyFiles)
  const readOnlyTrees = paths(input.readOnlyTrees)
  const writableTrees = paths(input.writableTrees)
  const protectedRoots = paths(input.protectedRoots)
  if (protectedRoots.length === 0 || !['isolated', 'inherited'].includes(input.network))
    throw new TypeError('macOS sandbox requires explicit control roots and network policy')
  const grants = [...SYSTEM_TREES, ...readOnlyFiles, ...readOnlyTrees, ...writableTrees]
  if (input.network === 'inherited') grants.push(...RESOLVER_FILES)
  if (grants.some((grant) => protectedRoots.some((root) => intersects(grant, root))))
    throw new TypeError('macOS payload grant overlaps host control')
  if (
    writableTrees.some((write) =>
      [...SYSTEM_TREES, ...readOnlyFiles, ...readOnlyTrees].some((read) => intersects(write, read)),
    )
  )
    throw new TypeError('macOS writable grant overlaps immutable data')

  const ancestors = new Set<string>(['/'])
  for (const grant of grants) {
    let parent = posix.dirname(grant)
    for (;;) {
      ancestors.add(parent)
      if (parent === '/') break
      parent = posix.dirname(parent)
    }
  }
  const fileParents = [...new Set(readOnlyFiles.map((file) => posix.dirname(file)))].sort()
  const rules = [
    '(version 1)',
    '(deny default)',
    '(deny process-info* (require-not (target self)))',
    '(allow process-fork process-exec)',
    '(allow signal (target same-sandbox))',
    // Broad sysctl-read reopens other-process environment queries on this kernel.
    '(allow sysctl-read (sysctl-name-regex #"^hw[.]") (sysctl-name "kern.osrelease") (sysctl-name "kern.osversion") (sysctl-name "kern.ostype"))',
    '(allow file-read-data (literal "/"))',
    `(allow file-read-metadata ${[...ancestors].sort().map(literal).join(' ')})`,
    ...(fileParents.length === 0
      ? []
      : [`(allow file-read-data ${fileParents.map(literal).join(' ')})`]),
    `(allow file-read* file-map-executable ${SYSTEM_TREES.map(tree).join(' ')} ${readOnlyFiles.map(literal).join(' ')} ${readOnlyTrees.map(tree).join(' ')})`,
    ...(writableTrees.length
      ? [`(allow file-read* file-write* file-map-executable ${writableTrees.map(tree).join(' ')})`]
      : []),
    '(allow file-read-data file-write-data (literal "/dev/null") (literal "/dev/zero"))',
    '(allow file-read-data (literal "/dev/random") (literal "/dev/urandom"))',
    // Optional global Codex configuration must appear absent, never be exposed.
    '(deny file-read* file-test-existence (with errno ENOENT) (subpath "/etc/codex") (subpath "/private/etc/codex"))',
  ]
  if (input.network === 'inherited')
    rules.push(
      '(allow network-outbound (remote ip "*:*"))',
      `(allow file-read* ${RESOLVER_FILES.map(literal).join(' ')})`,
      '(allow network-outbound (literal "/var/run/mDNSResponder") (literal "/private/var/run/mDNSResponder"))',
      '(allow mach-lookup (global-name "com.apple.SystemConfiguration.DNSConfiguration"))',
    )
  const text = `${rules.join('\n')}\n`
  if (Buffer.byteLength(text) > 32768)
    throw new TypeError('macOS sandbox profile exceeds its bound')
  return Object.freeze({ text, bootstrap: input.network === 'inherited' ? 'dns' : 'closed' })
}
