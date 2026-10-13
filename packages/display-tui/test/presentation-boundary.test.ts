import { expect, test } from 'bun:test'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

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
function presentationBoundary(file: string, source: string, modules: ReadonlySet<string>) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const refuse = () => {
    throw new Error(`Presentation boundary refused: ${file}`)
  }
  const unwrap = (expression: ts.Expression): ts.Expression => {
    while (
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
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
        node.importClause?.isTypeOnly === true,
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
        ts.isPropertySignature(node.parent) ||
        ts.isMethodSignature(node.parent)
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
          !ts.isIdentifier(call.arguments[0]!) ||
          call.arguments[0]!.text !== 'text'
        )
          refuse()
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(parsed, visit)
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

test('presentation modules depend only on semantic data and their own non-native component', async () => {
  const sources = await presentationSources(resolve(import.meta.dir, '../src/presentation'))
  const modules = new Set(sources.keys())
  for (const file of ['projection.ts', 'viewer-model.ts', 'text.ts', 'style.ts'])
    expect(modules.has(file)).toBeTrue()
  for (const [file, source] of sources)
    expect(() => presentationBoundary(file, source, modules)).not.toThrow()
})

test('native, input, lifecycle and ambient execution cannot enter the presentation boundary', () => {
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
    expect(() => presentationBoundary('projection.ts', source, modules)).toThrow(
      'Presentation boundary refused',
    )
})

test('semantic imports, explicit preview inputs and qualified width measurement remain allowed', () => {
  const modules = new Set(['projection.ts', 'text.ts', 'style.ts', 'viewer-model.ts'])
  expect(() =>
    presentationBoundary(
      'viewer-model.ts',
      `
    import { validateDisplaySnapshot } from '@jigging/display-model'
    import type { ViewItem } from '@jigging/reporting'
    import type { PreviewService } from '../types.js'
    import { terminalWidth } from './text.js'
    export const preview = (service: PreviewService, input: never) => service(input)
  `,
      modules,
    ),
  ).not.toThrow()
  expect(() =>
    presentationBoundary(
      'text.ts',
      `
    export function terminalWidth(text: string) {
      return (globalThis as unknown as { Bun: { stringWidth(value: string): number } }).Bun.stringWidth(text)
    }
  `,
      modules,
    ),
  ).not.toThrow()
  expect(() =>
    presentationBoundary('projection.ts', 'globalThis.Bun.stringWidth(text)', modules),
  ).toThrow()
  expect(() =>
    presentationBoundary('text.ts', 'globalThis.Bun.stringWidth(other)', modules),
  ).toThrow()
})
