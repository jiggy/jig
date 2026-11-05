// Versioned workspace packages and the artifact inputs that connect them.
// Qualification archives do not acquire permission to publish by having a version.
export const PACKAGES = Object.freeze([
  { kind: 'agent-method', name: '@jigging/agent-method', publish: true },
  { kind: 'agent-acp', name: '@jigging/agent-acp', publish: true },
  { kind: 'semantic-router', name: '@jigging/semantic-router', publish: true },
  { kind: 'jig', name: '@jigging/jig', publish: true },
  { kind: 'reporting', name: '@jigging/reporting', publish: false },
  { kind: 'display-model', name: '@jigging/display-model', publish: false },
  { kind: 'display-web', name: '@jigging/display-web', publish: false },
  { kind: 'display-tui', name: '@jigging/display-tui', publish: false },
])

export const PACKAGE_NAMES = new Set(PACKAGES.map(({ name }) => name))
export const PUBLISHED_PACKAGES = PACKAGES.filter(({ publish }) => publish)
export const MANIFESTS = PACKAGES.map(({ kind }) => `packages/${kind}/package.json`)
export const MARKER = '.changeset/release.json'

// These edges include bundled development dependencies and generated project pins.
// Changesets' ordinary dependency graph cannot discover those artifact edges.
const dependents = {
  '@jigging/agent-method': ['@jigging/agent-acp', '@jigging/semantic-router', '@jigging/jig'],
  '@jigging/agent-acp': ['@jigging/jig'],
  '@jigging/semantic-router': [],
  '@jigging/reporting': [
    '@jigging/semantic-router',
    '@jigging/display-model',
    '@jigging/display-web',
    '@jigging/display-tui',
    '@jigging/jig',
  ],
  '@jigging/display-model': ['@jigging/display-web', '@jigging/display-tui', '@jigging/jig'],
  '@jigging/display-web': ['@jigging/jig'],
  '@jigging/display-tui': ['@jigging/jig'],
  // The router archive ships a recovery example with synchronized Jig version pins.
  '@jigging/jig': ['@jigging/semantic-router'],
}

export function releaseClosure(names) {
  const result = new Set(names)
  for (const name of result) {
    if (!PACKAGE_NAMES.has(name)) throw new Error(`Unknown release package: ${name}`)
    for (const dependent of dependents[name]) result.add(dependent)
  }
  return [...result].sort()
}

export function packageInputs(path) {
  const owner = PACKAGES.find(({ kind }) => path.startsWith(`packages/${kind}/`))
  if (owner) {
    const relative = path.slice(`packages/${owner.kind}/`.length)
    // The Agent archives ship their tests and guidance. Other package tests do not ship.
    if (
      !['agent-method', 'agent-acp', 'semantic-router'].includes(owner.kind) &&
      (relative.startsWith('test/') || relative === 'AGENTS.md')
    )
      return []
    return [owner.name]
  }
  if (
    path.startsWith('docs/jig/spec/') ||
    path === 'scripts/build-jig-candidate.sh' ||
    path === 'packages/jiggy-reporting/src/jiggy/reporting/reporting.json'
  )
    return ['@jigging/jig']
  if (['LICENSE.md', 'PRICING.md', 'LICENSES.md'].includes(path) || path.startsWith('LICENSES/'))
    return [
      '@jigging/jig',
      '@jigging/display-model',
      '@jigging/display-web',
      '@jigging/display-tui',
    ]
  if (path === 'scripts/ci/build-candidates.mjs') return PACKAGES.map(({ name }) => name)
  if (path === 'scripts/build-agent-candidate.ts')
    return PACKAGES.filter(({ kind }) => ['agent-method', 'agent-acp', 'jig'].includes(kind)).map(({ name }) => name)
  if (path.startsWith('patches/') || /^(?:tsconfig(?:\.[^/]+)?\.json|bunfig\.toml)$/.test(path))
    return PACKAGES.map(({ name }) => name)
  return []
}

// Root development tools do not enter package archives. Workspace membership,
// overrides and patched dependencies can change every built package's inputs.
export function rootPackageInputs(before, after) {
  const buildKeys = [
    'workspaces',
    'dependencies',
    'optionalDependencies',
    'overrides',
    'resolutions',
    'patchedDependencies',
  ]
  return buildKeys.some((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
    ? PACKAGES.map(({ name }) => name)
    : []
}
