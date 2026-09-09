import { types as utilTypes } from 'node:util'
import { comparePathBytes, validateLogicalPath } from '../package/paths.js'
import {
  assertPrivatePackageAliasFiles,
  normalizePrivatePackageAliases,
  PRIVATE_PACKAGE_ALIAS_LIMITS,
  type PrivatePackageAlias,
} from './package-aliases.js'
import { normalizePackageArtifactRef, type PackageArtifactRef } from './package-artifact-store.js'

export interface PrivateBunExecutionLayout {
  readonly flowRoot: string
  readonly members: readonly string[]
  readonly aliases: readonly PrivatePackageAlias[]
}

export const PRIVATE_BUN_EXECUTION_LAYOUT_LIMITS = Object.freeze({
  members: 256,
  aliases: PRIVATE_PACKAGE_ALIAS_LIMITS.records,
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
  const aliases = normalizePrivatePackageAliases(record.aliases)
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
  for (const alias of aliases) {
    if (!members.includes(alias.target) || privateBunAliasPackageName(alias.path) === undefined)
      invalid()
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
  return layout
}

/** Validate topology against inert regular-file paths before creating any links. */
export function assertPrivateBunExecutionLayoutFiles(
  layout: PrivateBunExecutionLayout,
  files: readonly { readonly path: string; readonly size?: number }[],
): void {
  for (const member of layout.members)
    if (!files.some(({ path }) => path === `${member}/package.json`)) invalid()
  assertPrivatePackageAliasFiles(layout.aliases, files)
}

/** One retained execution value; callers cannot independently substitute its layout. */
export interface PrivateBunExecutionArtifact {
  readonly package: PackageArtifactRef
  readonly layout: PrivateBunExecutionLayout
}

export function normalizePrivateBunExecutionArtifact(value: unknown): PrivateBunExecutionArtifact {
  const record = exact(value, ['package', 'layout'])
  return Object.freeze({
    package: normalizePackageArtifactRef(exact(record.package, ['kind', 'digest'])),
    layout: normalizePrivateBunExecutionLayout(record.layout),
  })
}

export function privateBunExecutionArtifact(
  artifact: PackageArtifactRef,
  layout: PrivateBunExecutionLayout = EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
): PrivateBunExecutionArtifact {
  return normalizePrivateBunExecutionArtifact({ package: artifact, layout })
}

/** Project runtime meaning into the materializer's runtime-independent file contract. */
export function privateBunExecutionMaterialization(execution: PrivateBunExecutionArtifact) {
  return Object.freeze({
    packageDigest: execution.package.digest,
    aliases: execution.layout.aliases,
  })
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
