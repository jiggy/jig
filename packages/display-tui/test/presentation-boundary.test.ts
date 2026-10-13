import { expect, test } from 'bun:test'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import * as ts from 'typescript/unstable/ast'
import { API } from 'typescript/unstable/async'
import { createVirtualFileSystem } from 'typescript/unstable/fs'

const purePackages = new Set(['@jigging/display-model'])
const ambientEffects = new Set([
  'process',
  'Bun',
  'fetch',
  'require',
  'eval',
  'Function',
  'console',
  'window',
  'document',
  'navigator',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'MessageChannel',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'clearTimeout',
  'clearInterval',
  'clearImmediate',
  'queueMicrotask',
])

// Package-scoped dependency regression check, not an arbitrary-JavaScript sandbox.
async function presentationBoundary(file: string, source: string, modules: ReadonlySet<string>) {
  const refuse = (): never => {
    throw new Error(`Presentation boundary refused: ${file}`)
  }
  const unwrap = (expression: ts.Expression): ts.Expression => {
    while (
      ts.isAsExpression(expression) ||
      ts.isTypeAssertion(expression) ||
      ts.isParenthesizedExpression(expression)
    )
      expression = expression.expression
    return expression
  }
  const members = (expression: ts.Expression): string[] => {
    expression = unwrap(expression)
    if (ts.isIdentifier(expression)) return [expression.text]
    if (ts.isPropertyAccessExpression(expression))
      return [...members(expression.expression), expression.name.text]
    return []
  }
  const imports = (specifier: string, typeOnly: boolean) => {
    if (purePackages.has(specifier)) return
    if (specifier === '@jigging/reporting' && typeOnly) return
    if (specifier === '../types.js' && typeOnly && dirname(file) === '.') return
    if (
      /^\.\/[A-Za-z0-9_./-]+\.js$/.test(specifier) &&
      !specifier.split('/').includes('..') &&
      modules.has(join(dirname(file), specifier).replace(/\.js$/, '.ts'))
    )
      return
    refuse()
  }
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      if (!ts.isStringLiteral(node.moduleSpecifier) || !node.importClause) refuse()
      imports(
        (node.moduleSpecifier as ts.StringLiteral).text,
        node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword,
      )
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) refuse()
      imports((node.moduleSpecifier as ts.StringLiteral).text, node.isTypeOnly)
    } else if (ts.isImportEqualsDeclaration(node) || ts.isImportTypeNode(node)) refuse()
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      refuse()
    else if (ts.isIdentifier(node)) {
      // Ignore member/type names. Only ambient value references cross this seam.
      if (
        (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
        ts.isPropertySignatureDeclaration(node.parent) ||
        ts.isMethodSignatureDeclaration(node.parent)
      )
        return
      if (ambientEffects.has(node.text)) refuse()
      if (node.text === 'globalThis') {
        let parent: ts.Node = node
        while (parent.parent && !ts.isCallExpression(parent.parent)) parent = parent.parent
        const call = parent.parent
        if (
          file !== 'text.ts' ||
          !call ||
          !ts.isCallExpression(call) ||
          members(call.expression).join('.') !== 'globalThis.Bun.stringWidth' ||
          call.arguments.length !== 1 ||
          !call.arguments[0] ||
          !ts.isIdentifier(call.arguments[0]) ||
          call.arguments[0].text !== 'text'
        )
          refuse()
      }
    }
    node.forEachChild(visit)
  }
  const path = `/${file}`
  const api = new API({
    cwd: '/',
    fs: createVirtualFileSystem({
      '/tsconfig.json': JSON.stringify({
        files: [path],
        compilerOptions: { noLib: true, noResolve: true },
      }),
      [path]: source,
    }),
  })
  try {
    const snapshot = await api.updateSnapshot({ openProjects: ['/tsconfig.json'] })
    try {
      const project = snapshot.getProject('/tsconfig.json')
      if (!project) refuse()
      const program = project.program
      const parsed = await program.getSourceFile(path)
      if (!parsed || (await program.getSyntacticDiagnostics(path)).length) refuse()
      parsed.forEachChild(visit)
    } finally {
      await snapshot.dispose()
    }
  } finally {
    await api.close()
  }
}

async function presentationSources(directory: string, prefix = ''): Promise<Map<string, string>> {
  const owning = await lstat(directory)
  if (!owning.isDirectory() || owning.isSymbolicLink())
    throw new Error('Presentation boundary refuses linked source directories')
  const files = new Map<string, string>()
  for (const name of await readdir(directory)) {
    const path = join(directory, name),
      stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error('Presentation boundary refuses linked source')
    if (stat.isDirectory()) {
      for (const [file, source] of await presentationSources(path, join(prefix, name)))
        files.set(file, source)
    } else if (name.endsWith('.ts') && stat.isFile())
      files.set(join(prefix, name), await readFile(path, 'utf8'))
    else if (name !== 'AGENTS.md')
      throw new Error('Presentation boundary refuses an unknown source kind')
  }
  return files
}

async function expectRefusal(file: string, source: string, modules: ReadonlySet<string>) {
  const error = await presentationBoundary(file, source, modules).then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain('Presentation boundary refused')
}

test('presentation modules depend only on semantic data and their own non-native component', async () => {
  const sources = await presentationSources(resolve(import.meta.dir, '../src/presentation'))
  const modules = new Set(sources.keys())
  for (const file of ['projection.ts', 'viewer-model.ts', 'text.ts', 'style.ts'])
    expect(modules.has(file)).toBeTrue()
  for (const [file, source] of sources) await presentationBoundary(file, source, modules)
})

test('native, input, lifecycle and ambient execution cannot enter the presentation boundary', async () => {
  const modules = new Set(['projection.ts', 'text.ts', 'style.ts', 'viewer-model.ts'])
  for (const source of [
    "import { NativeRenderer } from '../native.js'",
    "import type { ViewerInput } from '../input.js'",
    "export { createInlineOwner } from '../inline-owner.js'",
    "import '../native.js'",
    "import { readFile } from 'node:fs/promises'",
    "import { core } from '@opentui/core'",
    "import { withReporting } from '@jigging/reporting'",
    "import * as Reporting from '@jigging/reporting'",
    "const native = await import('../native.js')",
    'const native = await import(target)',
    "const native = require('../native.js')",
    "const native = eval('private source')",
    "const native = new Function('private source')",
    "process.stdout.write('hidden output')",
    "Bun.spawn(['unowned'])",
    "globalThis.Bun.spawn(['unowned'])",
    'const ambient = globalThis',
    'setTimeout(() => {}, 1)',
    "const preview = fetch('https://example.invalid')",
    "import { TuiOptions } from '../types.js'",
    "import { escaping } from './missing.js'",
  ])
    await expectRefusal('projection.ts', source, modules)
})

test('semantic imports, explicit preview inputs and qualified width measurement remain allowed', async () => {
  const modules = new Set(['projection.ts', 'text.ts', 'style.ts', 'viewer-model.ts'])
  await presentationBoundary(
    'viewer-model.ts',
    `
    import { validateDisplaySnapshot } from '@jigging/display-model'
    import type { ViewItem } from '@jigging/reporting'
    import type { PreviewService } from '../types.js'
    import { terminalWidth } from './text.js'
    export const preview = (service: PreviewService, input: never) => service(input)
  `,
    modules,
  )
  await presentationBoundary(
    'text.ts',
    `
    export function terminalWidth(text: string) {
      return (globalThis as unknown as { Bun: { stringWidth(value: string): number } }).Bun.stringWidth(text)
    }
  `,
    modules,
  )
  await expectRefusal('projection.ts', 'globalThis.Bun.stringWidth(text)', modules)
  await expectRefusal('text.ts', 'globalThis.Bun.stringWidth(other)', modules)
})
