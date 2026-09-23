import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fail } from './errors.js'
import { checkText } from './values.js'

export interface Toolchain {
  profile: 'flow-authoring-typespec/0'
  tool: string
  compiler: '1.16.0'
  digest: string
}
export interface SourceHeader extends Toolchain {
  types: boolean
}
const prefix = '// flow-authoring: '
let cached: Promise<Toolchain> | undefined

/** Identify installed trusted tool bytes, including the resolved dependency closure. */
export function getToolchain(): Promise<Toolchain> {
  cached ??= fingerprint()
  return cached
}

async function fingerprint(): Promise<Toolchain> {
  const root = await realpath(fileURLToPath(new URL('..', import.meta.url)))
  const hashes = new Map<string, string>()
  const roots = new Set<string>()
  let files = 0,
    bytes = 0
  async function file(path: string) {
    if (++files > 20000) fail('TOOLCHAIN_LIMIT', 'Installed toolchain has too many files.')
    const data = await readFile(path)
    bytes += data.length
    if (bytes > 134217728) fail('TOOLCHAIN_LIMIT', 'Installed toolchain exceeds 128 MiB.')
    return createHash('sha256').update(data).digest('hex')
  }
  async function walk(path: string, relative: string, hash: ReturnType<typeof createHash>) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (entry.name === 'node_modules') continue
      const full = join(path, entry.name),
        name = relative + entry.name
      if (entry.isDirectory()) await walk(full, name + '/', hash)
      else if (entry.isFile()) hash.update(JSON.stringify([name, await file(full)]))
      else
        fail(
          'TOOLCHAIN_INVALID',
          'Toolchain package contents must be regular files or directories.',
        )
    }
  }
  async function resolveDependency(from: string, name: string) {
    let cursor = from
    for (;;) {
      const candidate = join(cursor, 'node_modules', name)
      try {
        await lstat(join(candidate, 'package.json'))
        return await realpath(candidate)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const parent = dirname(cursor)
      if (parent === cursor)
        fail('TOOLCHAIN_INVALID', `Install the declared toolchain dependency ${name}.`)
      cursor = parent
    }
  }
  async function capture(path: string, own = false): Promise<string> {
    const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
    const id = `${manifest.name}@${manifest.version}`
    if (roots.has(path)) return id
    roots.add(path)
    const hash = createHash('sha256')
    if (own) {
      hash.update(await file(join(path, 'package.json')))
      await walk(join(path, 'dist'), 'dist/', hash)
    } else await walk(path, '', hash)
    const digest = hash.digest('hex')
    if (hashes.has(id) && hashes.get(id) !== digest)
      fail('TOOLCHAIN_INVALID', 'Conflicting bytes for one dependency identity.')
    hashes.set(id, digest)
    for (const name of Object.keys(manifest.dependencies ?? {}).sort()) {
      const dependency = await capture(await resolveDependency(path, name))
      hashes.set(`${id} -> ${name}`, dependency)
    }
    return id
  }
  const tool = await capture(root, true)
  if (!hashes.has('@typespec/compiler@1.16.0'))
    fail('TOOLCHAIN_INVALID', 'This profile requires TypeSpec 1.16.0.')
  const digest =
    'sha256:' +
    createHash('sha256')
      .update('FLOW-Authoring-Toolchain/0\0')
      .update(JSON.stringify([...hashes].sort(([a], [b]) => (a < b ? -1 : 1))))
      .digest('hex')
  return Object.freeze({ profile: 'flow-authoring-typespec/0', tool, compiler: '1.16.0', digest })
}

/** Return source with an explicit pin. This function never writes the source file. */
export async function stampSource(source: string, options: { types: boolean }): Promise<string> {
  checkText(source, 65536)
  if (typeof options.types !== 'boolean')
    fail('SOURCE_INVALID', 'Choose whether to generate types.')
  const newline = source.indexOf('\n')
  const body = source.startsWith(prefix)
    ? source.slice(newline < 0 ? source.length : newline + 1)
    : source
  const header: SourceHeader = { ...(await getToolchain()), types: options.types }
  const result = prefix + JSON.stringify(header) + '\n' + body
  checkText(result, 65536)
  return result
}

export function readHeader(source: string, toolchain: Toolchain): SourceHeader {
  checkText(source, 65536)
  const first = source.split('\n', 1)[0]!
  if (!first.startsWith(prefix) || first.length > 2048) {
    fail(
      'SOURCE_HEADER',
      'Use stampSource() to select this installed authoring profile explicitly.',
    )
  }
  let parsed: SourceHeader
  try {
    parsed = JSON.parse(first.slice(prefix.length))
  } catch {
    fail('SOURCE_HEADER', 'The authoring header is not valid JSON.')
  }
  const expected = { ...toolchain, types: parsed?.types }
  if (typeof parsed?.types !== 'boolean' || first !== prefix + JSON.stringify(expected)) {
    fail(
      'SOURCE_HEADER',
      'Header differs from the installed toolchain or canonical options; select the intended tool explicitly.',
    )
  }
  return parsed
}
