import { posix } from 'node:path'
import { types as utilTypes } from 'node:util'
import { comparePathBytes, validateLogicalPath } from '../package/paths.js'
import { snapshotPrivateOrdinaryJson } from './private-ordinary-json.js'

/** Host-authorized links inside one immutable tree, not filesystem authority. */
export interface PrivatePackageAlias {
  readonly path: string
  readonly target: string
}

export const PRIVATE_PACKAGE_ALIAS_LIMITS = Object.freeze({ records: 4_096, bytes: 1024 * 1024 })

export function normalizePrivatePackageAliases(value: unknown): readonly PrivatePackageAlias[] {
  if (
    utilTypes.isProxy(value) ||
    !Array.isArray(value) ||
    value.length > PRIVATE_PACKAGE_ALIAS_LIMITS.records
  )
    invalid()
  const aliases = snapshotPrivateOrdinaryJson(
    value,
    'package aliases',
    () => new TypeError('invalid package aliases'),
  ) as unknown as readonly PrivatePackageAlias[]
  if (Buffer.byteLength(JSON.stringify(aliases)) > PRIVATE_PACKAGE_ALIAS_LIMITS.bytes) invalid()
  let prior: string | undefined
  for (const alias of aliases) {
    if (
      alias === null ||
      typeof alias !== 'object' ||
      Array.isArray(alias) ||
      Object.keys(alias).length !== 2 ||
      typeof alias.path !== 'string' ||
      typeof alias.target !== 'string'
    )
      invalid()
    validateLogicalPath(alias.path)
    validateLogicalPath(alias.target)
    if (prior !== undefined && comparePathBytes(prior, alias.path) >= 0) invalid()
    prior = alias.path
  }
  const paths = new Set(aliases.map(({ path }) => path))
  for (const alias of aliases) {
    // Parents and targets must be real directories, never chains of links.
    for (const path of [posix.dirname(alias.path), alias.target]) {
      const parts = path.split('/')
      while (parts.length > 0) {
        if (paths.has(parts.join('/'))) invalid()
        parts.pop()
      }
    }
  }
  return aliases
}

export function assertPrivatePackageAliasFiles(
  aliases: readonly PrivatePackageAlias[],
  files: readonly { readonly path: string }[],
): void {
  const paths = new Set(files.map(({ path }) => path))
  const directories = new Set<string>([''])
  for (const path of paths) {
    const parts = path.split('/')
    while (parts.length > 1) {
      parts.pop()
      directories.add(parts.join('/'))
    }
  }
  for (const alias of aliases) {
    if (!directories.has(alias.target) || paths.has(alias.path) || directories.has(alias.path))
      invalid()
    const parts = alias.path.split('/')
    while (parts.length > 1) {
      parts.pop()
      if (paths.has(parts.join('/'))) invalid()
    }
  }
}

export function privatePackageAliasText(alias: PrivatePackageAlias): string {
  return posix.relative(posix.dirname(alias.path), alias.target)
}

function invalid(): never {
  throw new TypeError('invalid package aliases')
}
