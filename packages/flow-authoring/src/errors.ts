import { type DiagnosticTarget, getSourceLocation, NoTarget } from '@typespec/compiler'

export interface AuthoringDiagnostic {
  code: string
  message: string
  line: number
  column: number
  output?: string
}

export class AuthoringError extends Error {
  constructor(public readonly diagnostic: AuthoringDiagnostic) {
    super(`FLOW.contract.tsp:${diagnostic.line}:${diagnostic.column}: ${diagnostic.message}`)
    this.name = 'AuthoringError'
  }
}

export function fail(
  code: string,
  message: string,
  target?: DiagnosticTarget | typeof NoTarget,
  output?: string,
): never {
  let line = 1,
    column = 1
  if (target && target !== NoTarget) {
    const location = getSourceLocation(target)
    const position = location.file.getLineAndCharacterOfPosition(location.pos)
    line = position.line + 1
    column = position.character + 1
  }
  throw new AuthoringError({ code, message, line, column, ...(output ? { output } : {}) })
}
