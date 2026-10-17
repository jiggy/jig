import {
  requirePrivateBunLockPolicy,
  requirePrivateBunResolutionManifest,
} from './bun-native-lock-policy.js'

const EXACT_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** Validate the complete reviewed manifest before the preparer makes any request. */
export function requirePrivateProjectEvaluationManifest(value: unknown): void {
  requirePrivateBunResolutionManifest(value)
  const manifest = value as Record<string, unknown>
  const metadata = new Set([
    'name',
    'version',
    'description',
    'license',
    'private',
    'type',
    'dependencies',
    'devDependencies',
  ])
  if (Object.keys(manifest).some((key) => !metadata.has(key)))
    throw new TypeError('unsupported evaluation manifest field')
  for (const field of ['dependencies', 'devDependencies']) {
    const dependencies = manifest[field] as Record<string, unknown> | undefined
    for (const version of Object.values(dependencies ?? {}))
      if (typeof version !== 'string' || !EXACT_VERSION.test(version))
        throw new TypeError('evaluation dependencies require exact registry versions')
  }
  const dev = manifest.devDependencies as Record<string, unknown> | undefined
  if (dev?.typescript !== '5.7.3')
    throw new TypeError('evaluation requires reviewed TypeScript 5.7.3 as a development dependency')
}

/** Lock metadata is inert; scripts remain disabled and executable/native packages are refused. */
export function requirePrivateProjectEvaluationLock(
  value: unknown,
  manifest: unknown,
  version: 1 | 2 = 1,
): void {
  requirePrivateProjectEvaluationManifest(manifest)
  requirePrivateBunLockPolicy(value, undefined, version)
  const lock = value as {
    workspaces: Record<string, Record<string, unknown>>
    packages: Record<string, unknown[]>
  }
  const source = manifest as Record<string, unknown>
  for (const field of ['dependencies', 'devDependencies']) {
    const entries = (source[field] ?? {}) as Record<string, unknown>
    const locked = (lock.workspaces['']?.[field] ?? {}) as Record<string, unknown>
    if (
      Object.keys(entries).length !== Object.keys(locked).length ||
      Object.entries(entries).some(([name, request]) => locked[name] !== request)
    )
      throw new TypeError('evaluation manifest and lock disagree')
    for (const [name, version] of Object.entries(entries)) {
      const resolution = lock.packages[name]
      if (!Array.isArray(resolution) || resolution[0] !== `${name}@${version}`)
        throw new TypeError('evaluation lock omits an exact direct dependency')
    }
  }
  for (const [key, resolution] of Object.entries(lock.packages)) {
    const metadata = resolution[2] as Record<string, unknown>
    if (metadata.os !== undefined || metadata.cpu !== undefined || metadata.gypfile !== undefined)
      throw new TypeError('evaluation dependencies must be platform-independent JavaScript')
    for (const field of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      const dependencies = (metadata[field] ?? {}) as Record<string, unknown>
      for (const name of Object.keys(dependencies)) {
        let parent = key
        let found = Object.hasOwn(lock.packages, name)
        while (!found && parent !== '') {
          found = Object.hasOwn(lock.packages, `${parent}/${name}`)
          const split = parent.lastIndexOf('/')
          parent = split < 0 ? '' : parent.slice(0, split)
        }
        if (!found) throw new TypeError('evaluation lock omits a transitive dependency')
      }
    }
  }
}
