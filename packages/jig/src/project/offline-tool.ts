import { snapshotJsonObject } from './author-value.js'

const STORE_PATH =
  /^\/nix\/store\/[0-9abcdfghijklmnpqrsvwxyz]{32}-[A-Za-z0-9+._?=-]{1,211}(?![\s\S])/
const PATH_COMPONENT = /^[A-Za-z0-9+._@=-]+(?![\s\S])/
export const OFFLINE_TOOL_LIMITS = Object.freeze({
  roots: 8,
  closure: 256,
  timeMs: 60_000,
  outputBytes: 16 * 1024 * 1024,
  memoryBytes: 512 * 1024 * 1024,
  pids: 128,
})

/** Fixed invocation of an operator-provisioned runtime, selected in a Binding. */
export interface OfflineToolInput {
  readonly executable: string
  readonly runtimeRoots: readonly string[]
  readonly args?: readonly string[]
  readonly environment?: Readonly<Record<string, string>>
  readonly exitCodes?: readonly number[]
  readonly timeoutMs?: number
  readonly outputBytes?: number
  readonly nestedUserNamespaces?: true
}

export type OfflineTool = Readonly<Required<Omit<OfflineToolInput, 'nestedUserNamespaces'>>> &
  Pick<OfflineToolInput, 'nestedUserNamespaces'>

export function isOfflineToolStorePath(value: unknown): value is string {
  return typeof value === 'string' && STORE_PATH.test(value)
}

export function normalizeOfflineTool(value: unknown): OfflineTool {
  const item = snapshotJsonObject(value, 'offline tool grant')
  const fields = new Set([
    'executable',
    'runtimeRoots',
    'args',
    'environment',
    'exitCodes',
    'timeoutMs',
    'outputBytes',
    'nestedUserNamespaces',
  ])
  const executable = item.executable
  const roots = item.runtimeRoots
  if (
    Object.keys(item).some((key) => !fields.has(key)) ||
    typeof executable !== 'string' ||
    executable.length > 512 ||
    !Array.isArray(roots) ||
    roots.length === 0 ||
    roots.length > OFFLINE_TOOL_LIMITS.roots ||
    !roots.every(isOfflineToolStorePath) ||
    new Set(roots).size !== roots.length
  )
    throw new TypeError('offline tool requires an executable and distinct Nix store roots')
  const root = roots.find((root) => executable.startsWith(`${root}/`))
  if (
    root === undefined ||
    executable
      .slice(root.length + 1)
      .split('/')
      .some((part) => !PATH_COMPONENT.test(part) || part === '.' || part === '..')
  )
    throw new TypeError('offline tool executable must be inside a selected store root')

  const args = Object.hasOwn(item, 'args') ? item.args : []
  if (!Array.isArray(args) || args.length > 32 || !args.every(toolString))
    throw new TypeError('offline tool accepts at most 32 fixed, bounded arguments')
  const environment = Object.hasOwn(item, 'environment')
    ? snapshotJsonObject(item.environment, 'offline tool environment')
    : {}
  if (
    Object.keys(environment).length > 16 ||
    Object.entries(environment).some(
      ([name, value]) =>
        !/^[A-Z][A-Z0-9_]{0,63}(?![\s\S])/.test(name) ||
        /^(?:LD_|BUN_|JIG_)/.test(name) ||
        !toolString(value),
    )
  )
    throw new TypeError('offline tool accepts at most 16 fixed environment values')
  const exitCodes = Object.hasOwn(item, 'exitCodes') ? item.exitCodes : [0]
  if (
    !Array.isArray(exitCodes) ||
    exitCodes.length === 0 ||
    exitCodes.length > 8 ||
    !exitCodes.every(
      (code) => typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 255,
    ) ||
    new Set(exitCodes).size !== exitCodes.length
  )
    throw new TypeError('offline tool requires distinct accepted exit codes from 0 to 255')
  if (Object.hasOwn(item, 'nestedUserNamespaces') && item.nestedUserNamespaces !== true)
    throw new TypeError('offline tool nestedUserNamespaces must be true when supplied')
  return Object.freeze({
    executable,
    runtimeRoots: Object.freeze([...roots].sort()),
    args: Object.freeze([...args]),
    environment: Object.freeze(environment as Record<string, string>),
    exitCodes: Object.freeze([...exitCodes].sort((left, right) => left - right)),
    timeoutMs: limit(item, 'timeoutMs', 1000, OFFLINE_TOOL_LIMITS.timeMs),
    outputBytes: limit(item, 'outputBytes', 4096, OFFLINE_TOOL_LIMITS.outputBytes),
    ...(item.nestedUserNamespaces === true ? { nestedUserNamespaces: true as const } : {}),
  })
}

function toolString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && !value.includes('\0')
}

function limit(
  item: Readonly<Record<string, unknown>>,
  key: 'timeoutMs' | 'outputBytes',
  minimum: number,
  maximum: number,
): number {
  const value = Object.hasOwn(item, key) ? item[key] : maximum
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new TypeError(`offline tool ${key} must be an integer from ${minimum} to ${maximum}`)
  return value
}
