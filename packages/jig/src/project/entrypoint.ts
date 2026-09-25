import { resolve } from 'node:path'
import type { InvocationOperationDescriptor } from '../invocation-contract.js'
import { parseRun } from '../run-arguments.js'
import { isProtectedProjectPath, normalizeProjectPath } from './paths.js'

const OPTIONS = new Set(['--input', '--attach', '--select', '--out', '--receive', '--timeout'])

/** Argument quoting only. This never invokes a shell or expands values. */
export function entrypointWords(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim() || value.length > 16384 || value.includes('\0'))
    throw new TypeError('entrypoint must be a nonempty string of at most 16384 characters')
  const words: string[] = []
  let word = '',
    active = false,
    quote = ''
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!
    if (char === '\\' && quote !== "'") {
      const next = value[++index]
      if (next === undefined) throw new TypeError('entrypoint has an unfinished escape')
      if (quote === '"' && !['"', '\\', '$', '`', '\n'].includes(next)) word += '\\'
      if (next !== '\n') {
        word += next
        active = true
      }
    } else if (quote) {
      if (char === quote) quote = ''
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      active = true
    } else if (/\s/.test(char)) {
      if (active) words.push(word)
      word = ''
      active = false
    } else {
      if ('|&;<>()`$'.includes(char))
        throw new TypeError(
          'entrypoint accepts arguments, not shell operators or expansions; quote literal values',
        )
      word += char
      active = true
    }
  }
  if (quote) throw new TypeError('entrypoint has an unclosed quote')
  if (active) words.push(word)
  if (words.length === 0 || words.length > 512)
    throw new TypeError('entrypoint requires a target and at most 511 argument words')
  return words
}

export function parseProjectEntrypoint(value: unknown): ReturnType<typeof parseRun> {
  const words = entrypointWords(value)
  for (let index = 1; index < words.length; index += 2)
    if (!OPTIONS.has(words[index]!))
      throw new TypeError(
        'entrypoint accepts only --input, --attach, --select, --out, --receive and --timeout',
      )
  const parsed = parseRun(['run', ...words])
  for (const path of [
    parsed.inputFile,
    parsed.output,
    ...parsed.attachments.map((item) => item.directory),
  ]) {
    if (path === undefined) continue
    const normalized = normalizeProjectPath(path, 'entrypoint path')
    if (isProtectedProjectPath(normalized))
      throw new TypeError('entrypoint paths cannot select .jig')
  }
  return parsed
}

/** Supplied defaults must match the interface; omitted inputs can be supplied at Run time. */
export function validateEntrypointInterface(
  value: ReturnType<typeof parseRun>,
  invocation: InvocationOperationDescriptor,
  bound: Readonly<Record<string, unknown>> = {},
): void {
  for (const { name } of value.attachments)
    if (invocation.attachments?.[name] !== 'read' || Object.hasOwn(bound, name))
      throw new TypeError('entrypoint attachment must name an unbound read attachment')
  for (const name of value.receive)
    if (invocation.channels?.[name]?.direction !== 'send')
      throw new TypeError('entrypoint --receive must name an outgoing channel')
}

/** Merge parsed option groups, preserving which origin owns each relative path. */
export function resolveProjectEntrypoint(
  value: string,
  overrides: readonly string[],
  projectDirectory: string,
): readonly string[] {
  const defaults = entrypointWords(value)
  parseProjectEntrypoint(value)
  // Preserve duplicates within each source so the shared parser rejects them.
  // Selectors may refer to an attachment supplied by the other source.
  const defaultGroups = groups(defaults.slice(1))
  const explicitGroups = groups(overrides)
  const result = new Map(defaultGroups)
  for (const [key, entries] of explicitGroups) {
    result.set(key, entries)
    if (key.startsWith('--attach:') && !explicitGroups.has(key.replace('--attach:', '--select:')))
      result.delete(key.replace('--attach:', '--select:'))
  }
  const args = ['run', defaults[0]!]
  for (const [key, entries] of result) {
    for (const [option, original] of entries) {
      let argument = original
      if (!explicitGroups.has(key)) {
        if (option === '--input' && argument?.startsWith('@'))
          argument = `@${resolve(projectDirectory, argument.slice(1))}`
        else if (option === '--out') argument = resolve(projectDirectory, argument!)
        else if (option === '--attach') {
          const equals = argument!.indexOf('=')
          argument = `${argument!.slice(0, equals)}=${resolve(projectDirectory, argument!.slice(equals + 1))}`
        }
      }
      args.push(option)
      if (argument !== undefined) args.push(argument)
    }
  }
  parseRun(args)
  return args
}

function groups(args: readonly string[]): Map<string, [string, string | undefined][]> {
  const grouped = new Map<string, [string, string | undefined][]>()
  for (let index = 0; index < args.length; index++) {
    const option = args[index]!
    const argument = option === '--json' ? undefined : args[++index]
    const key =
      option === '--attach' || option === '--select'
        ? `${option}:${argument?.split('=', 1)[0]}`
        : option
    const entries = grouped.get(key) ?? []
    entries.push([option, argument])
    grouped.set(key, entries)
  }
  return grouped
}
