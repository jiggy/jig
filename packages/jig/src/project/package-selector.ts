import { normalizeProjectPath } from './paths.js'

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** A declared dependency name, not a version, registry URL or package subpath. */
export function npmPackageName(selector: string): string {
  const name = selector.slice(4)
  if (!selector.startsWith('npm:') || name.length > 214 || !NPM_NAME.test(name))
    throw new TypeError('npm: requires an exact declared package name without a version or subpath')
  return name
}

export function normalizeFlowPackage(value: unknown): string {
  if (typeof value === 'string' && value.startsWith('npm:')) {
    npmPackageName(value)
    return value
  }
  return normalizeProjectPath(value, 'Flow package')
}

export function flowSelector(path: string): string {
  return path.startsWith('npm:') ? path : `flow:${path}`
}
