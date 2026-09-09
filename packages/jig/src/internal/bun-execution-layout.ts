import { posix } from 'node:path'
import { types as utilTypes } from 'node:util'
import { comparePathBytes, validateLogicalPath } from '../package/paths.js'

export interface PrivateBunExecutionAlias {
  readonly path: string
  /** Canonical artifact-root-relative directory, never raw symlink text. */
  readonly target: string
}

export interface PrivateBunExecutionLayout {
  readonly flowRoot: string
  readonly members: readonly string[]
  readonly aliases: readonly PrivateBunExecutionAlias[]
}

export const PRIVATE_BUN_EXECUTION_LAYOUT_LIMITS = Object.freeze({
  members: 256,
  aliases: 4_096,
  bytes: 1024 * 1024,
})

export const EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT: PrivateBunExecutionLayout = Object.freeze({
  flowRoot: '',
  members: Object.freeze([]),
  aliases: Object.freeze([]),
})

export function normalizePrivateBunExecutionLayout(value: unknown): PrivateBunExecutionLayout {
  const record = exact(value, ['flowRoot', 'members', 'aliases'])
  const memberValues = array(record.members, PRIVATE_BUN_EXECUTION_LAYOUT_LIMITS.members)
  const aliasValues = array(record.aliases, PRIVATE_BUN_EXECUTION_LAYOUT_LIMITS.aliases)
  if (typeof record.flowRoot !== 'string') invalid()
  const flowRoot = record.flowRoot as string
  if (flowRoot !== '') validateLogicalPath(flowRoot)
  const members: string[] = []
  for (const member of memberValues) {
    if (typeof member !== 'string') invalid()
    validateLogicalPath(member as string)
    if (
      (member as string).split('/').includes('node_modules') ||
      members.some((prior) => (member as string).startsWith(`${prior}/`)) ||
      (members.length > 0 && comparePathBytes(members.at(-1)!, member as string) >= 0)
    )
      invalid()
    members.push(member as string)
  }
  const aliases: PrivateBunExecutionAlias[] = []
  for (const raw of aliasValues) {
    const alias = exact(raw, ['path', 'target'])
    if (typeof alias.path !== 'string' || typeof alias.target !== 'string') invalid()
    const path = alias.path as string,
      target = alias.target as string
    validateLogicalPath(path)
    validateLogicalPath(target)
    if (
      !members.includes(target) ||
      privateBunAliasPackageName(path) === undefined ||
      (aliases.length > 0 && comparePathBytes(aliases.at(-1)!.path, path) >= 0)
    )
      invalid()
    aliases.push(Object.freeze({ path, target }))
  }
  if (flowRoot === '') {
    if (members.length !== 0 || aliases.length !== 0) invalid()
  } else if (!members.includes(flowRoot)) invalid()
  const layout = Object.freeze({
    flowRoot,
    members: Object.freeze(members),
    aliases: Object.freeze(aliases),
  })
  if (Buffer.byteLength(JSON.stringify(layout)) > PRIVATE_BUN_EXECUTION_LAYOUT_LIMITS.bytes)
    invalid()
  const aliasPaths = new Set(aliases.map(({ path }) => path))
  for (const alias of aliases) {
    const parts = alias.path.split('/')
    while (parts.length > 1) {
      parts.pop()
      if (aliasPaths.has(parts.join('/'))) invalid()
    }
  }
  // Canonical member targets exclude node_modules, so cannot traverse an alias.
  return layout
}

/** Validate topology against inert regular-file paths before creating any links. */
export function assertPrivateBunExecutionLayoutFiles(
  layout: PrivateBunExecutionLayout,
  files: readonly { readonly path: string; readonly size?: number }[],
): void {
  const paths = new Set(files.map((file) => file.path))
  const directories = new Set<string>([''])
  for (const path of paths) {
    const parts = path.split('/')
    while (parts.length > 1) {
      parts.pop()
      directories.add(parts.join('/'))
    }
  }
  for (const member of layout.members) if (!paths.has(`${member}/package.json`)) invalid()
  for (const alias of layout.aliases) {
    if (!directories.has(alias.target) || paths.has(alias.path) || directories.has(alias.path))
      invalid()
    const parts = alias.path.split('/')
    while (parts.length > 1) {
      parts.pop()
      if (paths.has(parts.join('/'))) invalid()
    }
  }
}

export function privateBunAliasText(alias: PrivateBunExecutionAlias): string {
  return posix.relative(posix.dirname(alias.path), alias.target)
}

export function privateBunAliasPackageName(path: string): string | undefined {
  const match = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(path)
  const name = match?.[1]
  return name === undefined ||
    name.startsWith('.') ||
    name.split('/').some((part) => part === '.bin')
    ? undefined
    : name
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    utilTypes.isProxy(value) ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    invalid()
  const record = value as Record<string, unknown>
  const actual = Reflect.ownKeys(record)
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    invalid()
  const copy = Object.create(null) as Record<string, unknown>
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid()
    copy[key] = descriptor.value
  }
  return copy
}

function array(value: unknown, maximum: number): unknown[] {
  if (
    value === null ||
    typeof value !== 'object' ||
    utilTypes.isProxy(value) ||
    !Array.isArray(value)
  )
    invalid()
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximum ||
    Reflect.ownKeys(value).length !== length + 1
  )
    invalid()
  const result: unknown[] = []
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid()
    result.push(descriptor.value)
  }
  return result
}

function invalid(): never {
  throw new TypeError('invalid private Bun execution layout')
}
