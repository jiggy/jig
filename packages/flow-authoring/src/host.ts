import { posix } from 'node:path'
import {
  type CompilerHost,
  compile,
  createSourceFile,
  NodeHost,
  type Program,
} from '@typespec/compiler'
import { type Node, parse, SyntaxKind, visitChildren } from '@typespec/compiler/ast'
import { fail } from './errors.js'
import { decorators, library } from './library.js'

export const sourcePath = '/flow-authoring/FLOW.contract.tsp'
const libRoot = '/flow-authoring/node_modules/@jigging/flow-authoring'
const allowedDecorators = new Set([
  'invocation',
  'closed',
  'oneOf',
  'agentResponse',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minValue',
  'maxValue',
  'minValueExclusive',
  'maxValueExclusive',
  'doc',
])

// Reject active or unqualified syntax BEFORE the compiler evaluates decorators.
function inspect(source: string) {
  const script = parse(createSourceFile(source, sourcePath))
  if (script.parseDiagnostics.length) {
    const diagnostic = script.parseDiagnostics[0]!
    fail('SOURCE_INVALID', diagnostic.message, diagnostic.target)
  }
  let nodes = 0,
    namespaces = 0
  function walk(node: Node, depth: number) {
    if ('decorators' in node) {
      const names = node.decorators.map((d) =>
        d.target.kind === SyntaxKind.Identifier ? d.target.sv : '',
      )
      if (new Set(names).size !== names.length)
        fail('SOURCE_INVALID', 'Duplicate decorators are not supported.', node)
    }
    if (++nodes > 8192 || depth > 64)
      fail('SOURCE_LIMIT', 'Source exceeds the bounded AST profile.', node)
    if (node.directives?.length)
      fail('SOURCE_UNSUPPORTED', 'Compiler directives are not supported.', node)
    switch (node.kind) {
      case SyntaxKind.NamespaceStatement:
        if (++namespaces > 1 || ['FLOW', 'TypeSpec'].includes(node.id.sv)) {
          fail('SOURCE_UNSUPPORTED', 'Use one non-reserved invocation namespace.', node)
        }
        break
      case SyntaxKind.TypeReference:
        if (node.arguments.length)
          fail(
            'SOURCE_UNSUPPORTED',
            'Template applications are not supported; use T[] for arrays.',
            node,
          )
        break
      case SyntaxKind.ImportStatement:
        if (node.path.value !== '@jigging/flow-authoring/typespec') {
          fail(
            'SOURCE_UNSUPPORTED',
            'Only the bundled FLOW authoring library may be imported.',
            node,
          )
        }
        break
      case SyntaxKind.DecoratorExpression:
        if (node.target.kind !== SyntaxKind.Identifier || !allowedDecorators.has(node.target.sv)) {
          fail('SOURCE_UNSUPPORTED', 'This decorator is outside the FLOW authoring profile.', node)
        }
        break
      case SyntaxKind.ModelStatement:
        if (node.extends || node.is || node.templateParameters.length) {
          fail(
            'SOURCE_UNSUPPORTED',
            'Model inheritance, aliases and templates are not supported.',
            node,
          )
        }
        break
      case SyntaxKind.ScalarStatement:
        if (node.templateParameters.length || node.members.length) {
          fail('SOURCE_UNSUPPORTED', 'Scalar templates and constructors are not supported.', node)
        }
        break
      case SyntaxKind.ModelProperty:
        if (node.default)
          fail(
            'SOURCE_UNSUPPORTED',
            'Defaults are not supported; requiredness must remain explicit.',
            node,
          )
        break
      case SyntaxKind.InterfaceStatement:
      case SyntaxKind.OperationStatement:
      case SyntaxKind.AliasStatement:
      case SyntaxKind.EnumStatement:
      case SyntaxKind.ConstStatement:
      case SyntaxKind.DecoratorDeclarationStatement:
      case SyntaxKind.FunctionDeclarationStatement:
      case SyntaxKind.AugmentDecoratorStatement:
      case SyntaxKind.CallExpression:
      case SyntaxKind.ModelSpreadProperty:
      case SyntaxKind.ObjectLiteralSpreadProperty:
      case SyntaxKind.IntersectionExpression:
      case SyntaxKind.StringTemplateExpression:
      case SyntaxKind.ValueOfExpression:
      case SyntaxKind.TypeOfExpression:
        fail(
          'SOURCE_UNSUPPORTED',
          'This syntax is outside the single-file authoring profile.',
          node,
        )
    }
    visitChildren(node, (child) => {
      walk(child, depth + 1)
    })
  }
  walk(script, 0)
}

export async function compileProgram(source: string): Promise<Program> {
  inspect(source)
  const virtual = new Map([
    [sourcePath, source],
    [
      `${libRoot}/package.json`,
      JSON.stringify({
        name: '@jigging/flow-authoring',
        version: '0.1.0-alpha.0',
        exports: { './typespec': { typespec: './lib/main.tsp' } },
      }),
    ],
    [`${libRoot}/lib/main.tsp`, library],
    [`${libRoot}/lib/decorators.js`, ''],
  ])
  const trustedRoot = NodeHost.getExecutionRoot()
  const trusted = (path: string) =>
    path.startsWith(`${trustedRoot}/`) && posix.normalize(path) === path
  const missing = () =>
    Object.assign(new Error('File is outside the captured compiler inputs.'), { code: 'ENOENT' })
  const host: CompilerHost = {
    ...NodeHost,
    async readFile(path) {
      if (virtual.has(path)) return createSourceFile(virtual.get(path)!, path)
      if (trusted(path)) return NodeHost.readFile(path)
      throw missing()
    },
    async stat(path) {
      if (virtual.has(path)) return { isFile: () => true, isDirectory: () => false }
      if ([...virtual.keys()].some((key) => key.startsWith(`${path}/`))) {
        return { isFile: () => false, isDirectory: () => true }
      }
      if (trusted(path)) return NodeHost.stat(path)
      throw missing()
    },
    async realpath(path) {
      if (virtual.has(path) || [...virtual.keys()].some((key) => key.startsWith(`${path}/`)))
        return path
      if (trusted(path)) return NodeHost.realpath(path)
      throw missing()
    },
    async readDir(path) {
      if (trusted(path)) return NodeHost.readDir(path)
      throw missing()
    },
    async getJsImport(path) {
      if (path === `${libRoot}/lib/decorators.js`) return decorators
      if (
        path === `${trustedRoot}/dist/src/lib/tsp-index.js` ||
        path === `${trustedRoot}/dist/src/lib/intrinsic/tsp-index.js`
      )
        return NodeHost.getJsImport(path)
      throw missing()
    },
    async readUrl() {
      throw missing()
    },
    async writeFile() {
      throw new Error('The authoring compiler cannot write files.')
    },
    async mkdirp() {
      throw new Error('The authoring compiler cannot create directories.')
    },
    async rm() {
      throw new Error('The authoring compiler cannot remove files.')
    },
    logSink: { log() {} },
  }
  const program = await compile(host, sourcePath, { noEmit: true, warningAsError: true })
  if (program.diagnostics.length) {
    const diagnostic = program.diagnostics[0]!
    fail('SOURCE_INVALID', diagnostic.message, diagnostic.target)
  }
  return program
}
