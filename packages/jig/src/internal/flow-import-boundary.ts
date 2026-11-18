import { posix } from 'node:path'
import { invalid } from '../diagnostics.js'
import type { CapturedPackage } from '../package/capture.js'

export interface FlowImportBoundary {
  readonly file: string
  readonly line: number
  readonly specifier: string
  readonly target: string
}

const SOURCE_FILE_LIMIT = 64
const SOURCE_BYTE_LIMIT = 512 * 1024
const FILE_BYTE_LIMIT = 96 * 1024
const BOUNDARY_CHECK_LIMIT = 64
const MODULE_PATH = /^(?:\.\.?\/)[a-zA-Z0-9_@./-]+\.(?:[cm]?[jt]s|[jt]sx)$/

type ScannedImport = { readonly kind: string; readonly path: string }

/** Follow eager, exact relative source imports from the captured entrypoint. */
export async function findFlowImportBoundary(
  captured: CapturedPackage,
  entrypoint: string,
  options: {
    readonly root?: string
    readonly relevant?: (target: string) => boolean
    readonly signal?: AbortSignal | undefined
  } = {},
): Promise<FlowImportBoundary | undefined> {
  if (entrypoint !== 'FLOW.ts') return undefined
  const transpiler = (
    globalThis as unknown as {
      readonly Bun?: {
        readonly Transpiler?: new (options: {
          loader: 'ts' | 'tsx' | 'jsx'
        }) => { scanImports(source: string): readonly ScannedImport[] }
      }
    }
  ).Bun?.Transpiler
  if (transpiler === undefined) return undefined
  const root = options.root ? options.root + '/' : ''
  const sizes = new Map(captured.files.map(({ path, size }) => [path, size]))
  const visited = new Set([entrypoint])
  const queue = [entrypoint]
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let checked = 0
  for (const file of queue) {
    options.signal?.throwIfAborted()
    const size = sizes.get(root + file)
    if (size === undefined || size > FILE_BYTE_LIMIT || bytes + size > SOURCE_BYTE_LIMIT) continue
    bytes += size
    const contents = await captured.read(root + file, FILE_BYTE_LIMIT)
    let source: string
    let imports: readonly ScannedImport[]
    try {
      source = decoder.decode(contents)
      const loader = file.endsWith('.tsx') ? 'tsx' : file.endsWith('.jsx') ? 'jsx' : 'ts'
      imports = new transpiler({ loader }).scanImports(source)
    } catch {
      // Unreadable syntax does not establish a module relationship.
      continue
    }
    for (const { kind, path: specifier } of imports) {
      if (
        kind !== 'import-statement' ||
        specifier.length > 512 ||
        !MODULE_PATH.test(specifier) ||
        specifier.includes('//') ||
        specifier.split('/').includes('node_modules')
      )
        continue
      const target = posix.join(posix.dirname(file), specifier)
      if (target.startsWith('../')) {
        options.signal?.throwIfAborted()
        if (++checked > BOUNDARY_CHECK_LIMIT) return undefined
        if (options.relevant && !options.relevant(target)) continue
        const line = await importLine(file, source, specifier)
        if (line !== undefined) return { file, line, specifier, target }
      } else if (
        visited.size < SOURCE_FILE_LIMIT &&
        !visited.has(target) &&
        sizes.has(root + target)
      ) {
        visited.add(target)
        queue.push(target)
      }
    }
  }
  return undefined
}

async function importLine(
  path: string,
  source: string,
  specifier: string,
): Promise<number | undefined> {
  const { default: ts } = await import('typescript-parser')
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest)
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
    const module = statement.moduleSpecifier
    if (!module || !ts.isStringLiteral(module) || module.text !== specifier) continue
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause
      if (clause?.isTypeOnly) continue
      if (
        clause &&
        !clause.name &&
        clause.namedBindings &&
        ts.isNamedImports(clause.namedBindings)
      ) {
        const bindings = clause.namedBindings.elements
        if (bindings.length > 0 && bindings.every((binding) => binding.isTypeOnly)) continue
      }
    } else {
      if (statement.isTypeOnly) continue
      const clause = statement.exportClause
      if (
        clause &&
        ts.isNamedExports(clause) &&
        clause.elements.length > 0 &&
        clause.elements.every((binding) => binding.isTypeOnly)
      )
        continue
    }
    return file.getLineAndCharacterOfPosition(module.getStart(file)).line + 1
  }
  return undefined
}

/** Refuse only absent imports in the actual execution file set. */
export async function checkFlowImportBoundary(
  captured: CapturedPackage,
  entrypoint: string,
  packagePath: string,
  root: string,
  signal: AbortSignal,
): Promise<void> {
  if (packagePath.startsWith('npm:')) return
  let paths: readonly string[] | undefined
  const boundary = await findFlowImportBoundary(captured, entrypoint, {
    root,
    signal,
    relevant(relative) {
      const target = posix.join(root, relative)
      // Dependency aliases and loader-specific paths are outside this check.
      if (target.split('/').includes('node_modules')) return false
      const requested = target.toLowerCase()
      const stem = requested.replace(/\.(?:[cm]?[jt]s|[jt]sx)$/, '')
      paths ??= captured.files.map(({ path }) => path.toLowerCase())
      // Keep uncertainty when Bun could substitute a suffix or load a directory.
      return !paths.some((path) => path.startsWith(stem + '.') || path.startsWith(requested + '/'))
    },
  })
  if (boundary === undefined) return
  invalid(
    'PACKAGE_FLOW_IMPORT_OUTSIDE_CAPTURE',
    `Line ${boundary.line} imports ${JSON.stringify(boundary.specifier)}, which has no matching module in the execution package. Use the configured Flow call or declare a shared dependency, then run jig review again.`,
    packagePath + '/' + boundary.file,
  )
}
