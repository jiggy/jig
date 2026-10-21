import { PRIVATE_FILE_LIMITS, PRIVATE_READ_INPUT_BYTES, privateAttachmentName, privateFilePath } from './file-input-policy.js'
import { type PrivateCapturedInput, requirePrivateCapturedInput } from './input-capture.js'

export interface PrivateReadInputFile {
  readonly path: string
  readonly input: PrivateCapturedInput
}
/** A host-created alias of an entire identical immutable view, never a file selector. */
export interface PrivateReadInputAlias {
  readonly name: string
  readonly target: string
}

export function normalizePrivateInputEmptyDirectories(
  value: readonly string[],
  roots: readonly string[],
  paths: readonly string[],
): readonly string[] {
  if (!Array.isArray(value) || value.length > PRIVATE_FILE_LIMITS.entries ||
    new Set(value).size !== value.length)
    throw new TypeError('invalid input empty directories')
  const allowed = new Set(normalizePrivateReadInputDirectories(roots))
  const files = new Set(paths)
  const directories = value.map((path) => {
    splitPath(path, allowed)
    if (files.has(path) || paths.some((file) => path.startsWith(`${file}/`)))
      throw new TypeError('input directory conflicts with a file')
    return path
  }).sort(ordinal)
  const entries = new Set(paths)
  for (const path of [...paths, ...directories]) {
    const parts = path.split('/')
    for (let count = 2; count <= parts.length; count++)
      entries.add(parts.slice(0, count).join('/'))
  }
  if (entries.size > PRIVATE_FILE_LIMITS.entries)
    throw new TypeError('input tree exceeds its entry limit')
  return Object.freeze(directories)
}

export function normalizePrivateReadInputDirectories(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 8 || new Set(value).size !== value.length)
    throw new TypeError('invalid input projection directories')
  return Object.freeze(value.map(privateAttachmentName))
}

/** Validate the closed native recipe. Its producer must separately prove whole-view identity. */
export function normalizePrivateReadInputAliases(
  value: unknown,
  directories: readonly string[],
  canonicalPaths: readonly string[],
): readonly PrivateReadInputAlias[] {
  const roots = new Set(normalizePrivateReadInputDirectories(directories))
  if (!Array.isArray(value) || value.length > Math.max(0, roots.size - 1))
    throw new TypeError('invalid input projection aliases')
  const fileRoots = new Set(canonicalPaths.map((path) => splitPath(path, roots).root))
  const names = new Set<string>()
  const aliases = value.map((item: unknown) => {
    if (
      item === null ||
      typeof item !== 'object' ||
      Object.keys(item).sort().join() !== 'name,target'
    )
      throw new TypeError('invalid input projection alias')
    const entry = item as PrivateReadInputAlias
    const name = privateAttachmentName(entry.name),
      target = privateAttachmentName(entry.target)
    if (
      !roots.has(name) ||
      !roots.has(target) ||
      name === target ||
      names.has(name) ||
      fileRoots.has(name)
    )
      throw new TypeError('input projection alias conflicts with its physical roots')
    names.add(name)
    return Object.freeze({ name, target })
  })
  if (aliases.some((alias) => names.has(alias.target) || !fileRoots.has(alias.target)))
    throw new TypeError('input projection aliases must name a nonempty physical view')
  return Object.freeze(aliases.sort((a, b) => ordinal(a.name, b.name)))
}

/** Derive aliases only from complete views with identical paths and original capture objects.
 * Equal hashes or bytes never establish shared capture authority. Empty views remain directories. */
export function planPrivateReadInputProjection(input: {
  readonly files: readonly PrivateReadInputFile[]
  readonly directories: readonly string[]
  readonly emptyDirectories?: readonly string[]
}): Readonly<{
  files: readonly PrivateReadInputFile[]
  directories: readonly string[]
  emptyDirectories: readonly string[]
  aliases: readonly PrivateReadInputAlias[]
}> {
  const directories = normalizePrivateReadInputDirectories(input.directories)
  if (!Array.isArray(input.files) || input.files.length > 8 * PRIVATE_FILE_LIMITS.files)
    throw new TypeError('input projection exceeds its view bound')
  const roots = new Set(directories)
  const emptyDirectories = directories.flatMap((root) =>
    normalizePrivateInputEmptyDirectories(
      (input.emptyDirectories ?? []).filter((path) => path.startsWith(`${root}/`)),
      [root],
      input.files.filter((file) => file.path.startsWith(`${root}/`)).map((file) => file.path),
    ),
  )
  if (emptyDirectories.length !== (input.emptyDirectories?.length ?? 0))
    throw new TypeError('input directory is outside its declared root')
  const views = new Map(
    directories.map((root) => [root, [] as { relative: string; file: PrivateReadInputFile }[]]),
  )
  const authority = new Map<PrivateCapturedInput, ReturnType<typeof requirePrivateCapturedInput>>()
  for (const file of input.files) {
    if (file === null || typeof file !== 'object')
      throw new TypeError('invalid input projection file')
    const { root, relative } = splitPath(file.path, roots)
    if (!authority.has(file.input))
      authority.set(file.input, requirePrivateCapturedInput(file.input))
    const view = views.get(root)
    if (view === undefined) throw new TypeError('input projection lost its declared view')
    view.push({ relative, file: Object.freeze({ path: file.path, input: file.input }) })
  }
  const canonical: { root: string; files: { relative: string; file: PrivateReadInputFile }[] }[] =
    []
  const aliases: PrivateReadInputAlias[] = []
  for (const root of [...directories].sort(ordinal)) {
    const view = views.get(root)
    if (view === undefined) throw new TypeError('input projection lost its declared view')
    const files = view.sort((a, b) => ordinal(a.relative, b.relative))
    validateView(files.map((entry) => entry.relative))
    const existing =
      files.length === 0
        ? undefined
        : canonical.find(
            (view) =>
              JSON.stringify(emptyDirectories.filter((path) => path.startsWith(`${root}/`)).map((path) => path.slice(root.length))) ===
              JSON.stringify(emptyDirectories.filter((path) => path.startsWith(`${view.root}/`)).map((path) => path.slice(view.root.length))) &&
              view.files.length === files.length &&
              view.files.every((entry, index) => {
                const file = files[index]
                return (
                  file !== undefined &&
                  entry.relative === file.relative &&
                  entry.file.input === file.file.input
                )
              }),
          )
    if (existing === undefined) canonical.push({ root, files })
    else aliases.push(Object.freeze({ name: root, target: existing.root }))
  }
  const files = canonical.flatMap((view) => view.files.map((entry) => entry.file))
  const physicalDirectories = normalizePrivateInputEmptyDirectories(
    emptyDirectories.filter((path) => !aliases.some((alias) => path.startsWith(`${alias.name}/`))),
    directories, files.map((file) => file.path),
  )
  const bytes = files.reduce((sum, file) => {
    const original = authority.get(file.input)
    if (original === undefined) throw new TypeError('input projection lost its original authority')
    return sum + original.bytes
  }, 0)
  const entries = canonical.reduce(
    (sum, view) => sum + validateView(view.files.map((entry) => entry.relative)),
    0,
  )
  if (
    files.length > PRIVATE_FILE_LIMITS.files ||
    bytes > PRIVATE_READ_INPUT_BYTES ||
    entries > PRIVATE_FILE_LIMITS.entries
  )
    throw new TypeError('input projection exceeds its unique physical bounds')
  return Object.freeze({
    files: Object.freeze(files),
    directories,
    emptyDirectories: physicalDirectories,
    aliases: normalizePrivateReadInputAliases(
      aliases,
      directories,
      files.map((file) => file.path),
    ),
  })
}

function splitPath(path: string, roots: ReadonlySet<string>): { root: string; relative: string } {
  if (typeof path !== 'string') throw new TypeError('invalid input projection path')
  const separator = path.indexOf('/')
  const root = path.slice(0, separator)
  if (separator < 1 || !roots.has(root))
    throw new TypeError('input projection is outside its declared root')
  return { root, relative: privateFilePath(path.slice(separator + 1)) }
}

function validateView(paths: readonly string[]): number {
  const files = new Set(paths),
    directories = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/')
    for (let count = 1; count < parts.length; count++)
      directories.add(parts.slice(0, count).join('/'))
  }
  if (
    files.size !== paths.length ||
    paths.length > PRIVATE_FILE_LIMITS.files ||
    files.size + directories.size > PRIVATE_FILE_LIMITS.entries ||
    paths.some((path) => directories.has(path))
  )
    throw new TypeError('input projection paths conflict or exceed their view bounds')
  return files.size + directories.size
}
function ordinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
